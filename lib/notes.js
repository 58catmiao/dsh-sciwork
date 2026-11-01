/**
 * 科研模式 0.3 · 课题笔记 / 实验日志（纯 Node，无第三方依赖）
 * ---------------------------------------------------------------------------
 * 笔记就是课题目录下的 Markdown 文件：`projects/<课题>/notes/*.md`
 * （目录布局见 docs/INSTALL.md §2.3「库目录长什么样」）。这一层只做三件事：
 *   1. `listNotes` 列出笔记（文件名 / 标题 / 修改时间 / 字节数 / 前 80 字摘要）；
 *   2. `readNote` 读一份笔记正文；
 *   3. `saveNote` 新建或覆盖一份笔记；**覆盖前先把原文件复制成同名 `.bak`**
 *      （与 `library.js` 的草稿保存 `writeTextBackup` 同一口径：一次保存一份回滚点）。
 *
 * 安全口径（全部收在这一层，动作层不再自己拼路径）：
 *   - 课题只认**一段** slug（与 `createDraft` 同一套正则）；
 *   - 笔记名只认**一层**文件名：带 `/`、`\`、`..`、盘符、绝对路径一律拒；
 *   - 最终路径再过一遍 `resolveInside(root, rel)`，保证落在库根之内；
 *   - 只写 `.md`（没写扩展名自动补 `.md`，其它扩展名拒）；
 *   - 单文件 ≤ 2 MiB（与面板统一，防手滑把二进制塞进来）。
 *
 * 错误一律是普通 `Error`（和 `library.js` 一致），由动作层 / 执行器的
 * `describeError` 翻成 `bad-request` / `denied` / `not-found` 等错误码；
 * 这里的 message 用词要和 `lib/host/errors.js` 的正则对得上（`不合法`、`过大`、
 * `只接受库根相对路径`）。
 */

import path from 'node:path';
import { copyFile, mkdir, open, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { resolveInside } from './library.js';

/** 单份笔记的大小上限（字节）。 */
export const NOTES_MAX_BYTES = 2 * 1024 * 1024;
/** 列笔记时只读每份文件的前 4 KiB 取标题与摘要，不把整库笔记读进内存。 */
const HEAD_BYTES = 4 * 1024;
/** 摘要长度（字符，不是字节）。 */
const SUMMARY_CHARS = 80;
/** 自动文件名里 slug 的长度上限。 */
const SLUG_CHARS = 40;
/** 笔记名的字符上限（含 `.md`）。 */
const NAME_CHARS = 80;

const EXT = '.md';
const PROJECT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/* ------------------------------------------------------------------ 校验 */

function checkProject(project) {
  const slug = String(project || '').trim();
  if (!PROJECT_RE.test(slug)) throw new Error(`课题 slug 不合法：${slug || '(空)'}`);
  return slug;
}

/**
 * 校验并归一化笔记名，返回带 `.md` 的文件名。
 * 只认一层文件名；绝对路径、盘符、`..`、隐藏文件、其它扩展名都拒。
 */
function checkName(name) {
  const raw = String(name || '').trim();
  if (!raw) throw new Error('笔记文件名不合法：（空）');
  if (raw.length > NAME_CHARS) throw new Error(`笔记文件名不合法（超过 ${NAME_CHARS} 字符）：${raw.slice(0, 40)}…`);
  // 先判绝对路径，这样「C:\x.md」「/etc/x.md」报的是越界口径，不是「带了斜杠」。
  if (/^[a-zA-Z]:/.test(raw) || raw.startsWith('/') || raw.startsWith('\\')) {
    throw new Error(`只接受库根相对路径：${raw}`);
  }
  if (raw.includes('/') || raw.includes('\\')) throw new Error(`笔记文件名不合法（只能是一层文件名，不能带目录）：${raw}`);
  if (raw.includes('..') || raw.startsWith('.')) throw new Error(`笔记文件名不合法（不允许 .. 或隐藏文件）：${raw}`);
  if (/[<>:"|?*\u0000-\u001f]/.test(raw)) throw new Error(`笔记文件名不合法（含 Windows 禁用字符）：${raw}`);
  if (raw.endsWith('.') || raw.endsWith(' ')) throw new Error(`笔记文件名不合法（不能以点或空格结尾）：${raw}`);
  const ext = path.extname(raw).toLowerCase();
  if (!ext) return raw + EXT;
  if (ext !== EXT) throw new Error(`笔记文件类型不合法：${ext}（只允许 .md）`);
  return raw;
}

/** 笔记的库根相对路径：`projects/<课题>/notes/<名字>`。 */
function noteRel(project, name) {
  return `projects/${project}/notes/${name}`;
}

/* ------------------------------------------------------------ 读文件头 */

/** 读文件前 N 字节（列笔记只要标题和摘要）。多字节字符被截断时丢掉末尾的替换符。 */
async function readHead(abs, size) {
  const limit = Math.min(Math.max(Number(size) || 0, 0), HEAD_BYTES);
  if (!limit) return '';
  const fh = await open(abs, 'r');
  try {
    const buf = Buffer.alloc(limit);
    const { bytesRead } = await fh.read(buf, 0, limit, 0);
    return buf.subarray(0, bytesRead).toString('utf8').replace(/\uFFFD+$/u, '');
  } finally {
    await fh.close();
  }
}

/** 标题 = 第一个非空行是 `# 标题` 就用它，否则用文件名。 */
function titleOf(text, fallback) {
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = /^#\s+(.+?)\s*$/.exec(line);
    return m ? m[1].trim() : fallback;
  }
  return fallback;
}

/** 摘要 = 去掉标题行后的正文，压平空白，取前 80 个字符。 */
function summaryOf(text) {
  const lines = String(text || '').split(/\r?\n/);
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i += 1;
  const body = i < lines.length && /^#\s+/.test(lines[i].trim()) ? lines.slice(i + 1) : lines;
  return body.join(' ').replace(/\s+/g, ' ').trim().slice(0, SUMMARY_CHARS);
}

/* ------------------------------------------------------------ 自动文件名 */

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * 本机时区的 `YYYY-MM-DD-HHmm`。
 * @param {Date} [date]
 */
export function noteStamp(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
}

/** 标题 → 文件名 slug（只留 ASCII 小写字母数字；中文标题退回 `note`）。 */
function slugify(text) {
  const slug = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_CHARS)
    .replace(/-+$/g, '');
  return slug || 'note';
}

/** 新笔记没给名字：`YYYY-MM-DD-HHmm-<slug>.md`；同一分钟撞名就加 `-2`、`-3`… */
async function autoName(dirAbs, text) {
  const heading = String(text || '').split(/\r?\n/).map((l) => l.trim()).find((l) => /^#\s+\S/.test(l)) || '';
  const base = `${noteStamp()}-${slugify(heading.replace(/^#\s+/, ''))}`;
  for (let i = 1; i <= 50; i += 1) {
    const file = i === 1 ? `${base}${EXT}` : `${base}-${i}${EXT}`;
    const exists = await stat(path.join(dirAbs, file)).then(() => true, () => false);
    if (!exists) return file;
  }
  throw new Error(`自动命名失败：同一分钟里同名笔记太多（${base}）`);
}

/* ------------------------------------------------------------------ 公开面 */

/**
 * 列出一门课题下的笔记。
 * 只认 `notes/` 下**直接**一层 `*.md`（跳过 `.bak`、隐藏文件、子目录）。
 * 目录不存在 → 返回空列表（`exists:false`），不报错：还没写笔记是正常状态。
 * @param {string} root 库根
 * @param {string} project 课题 slug
 */
export async function listNotes(root, project) {
  const slug = checkProject(project);
  const dirRel = `projects/${slug}/notes`;
  const dirAbs = resolveInside(root, dirRel);
  const info = await stat(dirAbs).catch(() => null);
  if (!info || !info.isDirectory()) {
    return { project: slug, dir: dirRel, exists: false, count: 0, notes: [] };
  }
  const entries = await readdir(dirAbs, { withFileTypes: true });
  const notes = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = String(entry.name || '');
    if (name.startsWith('.') || path.extname(name).toLowerCase() !== EXT) continue;
    const abs = resolveInside(root, `${dirRel}/${name}`);
    const st = await stat(abs).catch(() => null);
    if (!st || !st.isFile()) continue;
    const head = await readHead(abs, st.size);
    notes.push({
      name,
      path: `${dirRel}/${name}`,
      title: titleOf(head, name.replace(/\.md$/i, '')),
      bytes: st.size,
      mtime: st.mtime.toISOString(),
      summary: summaryOf(head),
    });
  }
  // 新的在前；同一毫秒按文件名排，保证输出稳定（自检要深比较）。
  notes.sort((a, b) => (b.mtime > a.mtime ? 1 : b.mtime < a.mtime ? -1 : a.name.localeCompare(b.name)));
  return { project: slug, dir: dirRel, exists: true, count: notes.length, notes };
}

/**
 * 读一份笔记正文。
 * @param {string} root 库根
 * @param {{project:string, name:string}} input
 */
export async function readNote(root, input) {
  const project = checkProject(input && input.project);
  const name = checkName(input && input.name);
  const rel = noteRel(project, name);
  const abs = resolveInside(root, rel);
  const info = await stat(abs); // 不存在 → ENOENT（动作层翻成 not-found）
  if (!info.isFile()) throw new Error(`笔记路径不合法（不是普通文件）：${rel}`);
  if (info.size > NOTES_MAX_BYTES) throw new Error(`笔记过大（${info.size} B > ${NOTES_MAX_BYTES} B）`);
  const text = await readFile(abs, 'utf8');
  return {
    project,
    name,
    path: rel,
    title: titleOf(text, name.replace(/\.md$/i, '')),
    bytes: info.size,
    mtime: info.mtime.toISOString(),
    text,
  };
}

/**
 * 新建或覆盖一份笔记。
 *   - 没给 `name` → `YYYY-MM-DD-HHmm-<slug>.md`（本机时区；slug 取正文第一个 `# 标题`）；
 *   - 文件已存在 → 先把它复制成同名 `.bak`，再写入（`backup` 里返回 `.bak` 路径）；
 *   - 新文件 → `created:true`，`backup:null`；
 *   - 课题目录必须已存在（写笔记不会顺手新建课题，免得手滑的 slug 造出幽灵课题）。
 * @param {string} root 库根
 * @param {{project:string, name?:string, text:string}} input
 */
export async function saveNote(root, input) {
  const project = checkProject(input && input.project);
  if (typeof (input && input.text) !== 'string') throw new Error('笔记内容不合法：text 必须是字符串');
  const text = input.text;
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > NOTES_MAX_BYTES) throw new Error(`笔记内容过大（${bytes} B > ${NOTES_MAX_BYTES} B）`);

  const dirRel = `projects/${project}/notes`;
  const projectAbs = resolveInside(root, `projects/${project}`);
  const projectDir = await stat(projectAbs).catch(() => null);
  // 写之前要求课题目录已存在：否则一个手滑的 slug 就会在 projects/ 下造出幽灵课题。
  if (!projectDir || !projectDir.isDirectory()) throw new Error(`课题不存在：projects/${project}`);
  const dirAbs = resolveInside(root, dirRel);
  const given = String((input && input.name) || '').trim();
  // 先把给定名字校验完再建目录：名字不合法时连空 notes/ 都不留下。
  const presetName = given ? checkName(given) : '';
  await mkdir(dirAbs, { recursive: true });

  const name = presetName || (await autoName(dirAbs, text));
  const rel = noteRel(project, name);
  const abs = resolveInside(root, rel);
  const before = await stat(abs).catch(() => null);
  if (before && before.isDirectory()) throw new Error(`笔记路径不合法（已存在同名目录）：${rel}`);

  let backup = null;
  if (before) {
    backup = `${rel}.bak`;
    await copyFile(abs, `${abs}.bak`);
  }
  await writeFile(abs, text, 'utf8');
  const after = await stat(abs);
  return {
    project,
    name,
    path: rel,
    title: titleOf(text, name.replace(/\.md$/i, '')),
    created: !before,
    backup,
    bytes: after.size,
    mtime: after.mtime.toISOString(),
  };
}

/** 回收站目录（库根相对）：`projects/<课题>/notes/.trash`。列笔记时会被跳过（隐藏目录）。 */
function trashRel(project) {
  return `projects/${project}/notes/.trash`;
}

async function existsAt(abs) {
  const info = await stat(abs).catch(() => null);
  return Boolean(info);
}

/**
 * 删除一份笔记 = **移进回收站**，不做物理删除。
 *   - 目标：`projects/<课题>/notes/.trash/<YYYY-MM-DD-HHmm>-<原名>`；
 *   - 同一分钟删同名文件撞车时补 `-2`、`-3`…；
 *   - 返回的 `trash` 是回收站里的库根相对路径，用户能从那儿捞回来。
 * 笔记不存在时让 `stat` 的 ENOENT 继续往上抛（动作层翻成 `not-found`）。
 * @param {string} root 库根
 * @param {{project:string, name:string}} input
 */
export async function deleteNote(root, input) {
  const project = checkProject(input && input.project);
  const name = checkName(input && input.name);
  const rel = noteRel(project, name);
  const abs = resolveInside(root, rel);
  const info = await stat(abs);
  if (!info.isFile()) throw new Error(`笔记路径不合法（不是普通文件）：${rel}`);

  const dirRel = trashRel(project);
  const dirAbs = resolveInside(root, dirRel);
  await mkdir(dirAbs, { recursive: true });

  const stamp = noteStamp();
  let target = `${stamp}-${name}`;
  for (let i = 2; i <= 100; i += 1) {
    if (!(await existsAt(path.join(dirAbs, target)))) break;
    target = `${stamp}-${i}-${name}`;
  }
  if (await existsAt(path.join(dirAbs, target))) {
    throw new Error(`回收站里同名笔记太多（${stamp}）：先清理 ${dirRel}/ 再删`);
  }
  await rename(abs, path.join(dirAbs, target));
  return {
    project,
    name,
    path: rel,
    trash: `${dirRel}/${target}`,
    bytes: info.size,
    moved: true,
  };
}

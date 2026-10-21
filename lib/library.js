/**
 * 科研模式 · 科研库数据层（纯 Node，无第三方依赖）
 * ---------------------------------------------------------------------------
 * 这一层只做三件事：
 *   1. 把科研库读成一份**给面板用的快照**（不写任何文件）。库根目录见 `lib/config.js`：
 *      `SCIWORK_LIBRARY` 优先，否则 `<用户目录>/Research`；
 *   2. 提供**受约束**的文件读取（路径必须落在库根之内，扩展名白名单，大小上限）；
 *   3. 提供**唯一**一处面板可做的原地写入：草稿保存（写前先留 `.bak`，见
 *      `writeTextBackup`）——元数据写入仍然只走 `research.py`。
 *
 * 设计口径（写给后来的人，也写给未来的我）：
 *   - 库的**权威来源是文件系统**，不是 `.research/index/library.json`。索引由
 *     `research.py reindex` 生成，可能是旧的（实测 index 里 counts.journal=1 而
 *     journals\ 下已有 12 份档案）⇒ 索引只用来显示「索引时间」，不用来做判定。
 *   - 写文件的动作只有两个：草稿保存（这里）与导入落位/归档（`import.js` / `archive.js`）。
 *     登记记录（refs.json / 侧车 / submissions）的写入永远是 `research.py` 的职责。
 *   - 所有对外路径都以**库根相对路径**（POSIX 分隔符）出现，绝对路径只在本层内部用。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { parseTable } from './table.js';
import { envLibraryRoot, resolveLibraryRoot, resolveOriginPluginDir, resolveOriginServer } from './config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE_DIR = path.resolve(HERE, '..');

/** 文本类扩展名（可预览）。 */
export const TEXT_EXT = new Set([
  '.md', '.markdown', '.txt', '.csv', '.tsv', '.json', '.bib', '.tex', '.yaml', '.yml', '.log', '.py', '.m',
]);

/** 图片/文档类扩展名 → MIME。 */
export const BINARY_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

const MAX_TEXT_BYTES = 512 * 1024;      // 文本预览上限
const MAX_BINARY_BYTES = 12 * 1024 * 1024; // 图片/base64 上限
const DATA_EXT = new Set(['.csv', '.tsv', '.txt', '.xlsx', '.xls', '.dat', '.json', '.jdx', '.dx']);
const TABLE_EXT = new Set(['.csv', '.tsv', '.xlsx', '.md']);

/* ------------------------------------------------------------------ 基础工具 */

const isDir = async (p) => {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
};

const isFile = async (p) => {
  try { return (await stat(p)).isFile(); } catch { return false; }
};

const readJsonSafe = async (p, fallback = null) => {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
};

/**
 * 库的「内部目录」：`.`（隐藏）与 `_`（历史 / 中间 / 模板，如 `figures/_history`、
 * `figures/_v18_noline`、`origin/_templates`、`journals/_fetched`、`.research/`）。
 * 面板呈现的是**本次交付的视图**，内部目录一律不进快照，否则：
 *   - `figures/_history` 里放的历史登记会被当成本次交付的图显示；
 *   - `origin/_templates` 的模板 opju、`origin/_history` 的旧工程会被算进「工程 N」。
 * 文件不按 `_` 过滤（`_notes.md` 这类文件仍要看得见），只忽略 `.` 开头的隐藏文件。
 */
const isInternalName = (n) => n.startsWith('.') || n.startsWith('_');

const listDir = async (p, { dirs = true, files = true } = {}) => {
  try {
    const items = await readdir(p, { withFileTypes: true });
    return items.filter((e) => (e.isDirectory()
      ? dirs && !isInternalName(e.name)
      : files && !e.name.startsWith('.')));
  } catch { return []; }
};

/** 递归扫描的最深层数（data/图表/草稿/表格 都按这个深度找）。 */
const MAX_SCAN_DEPTH = 4;

/**
 * 递归列文件：库里的数据/图表/草稿允许按文件夹归类存放（`data/ZT-1500-2h/xx.txt`），
 * 所以不能只看一层。返回 `{ abs, sub }`，`sub` 是以起点目录为根的 POSIX 相对子目录
 * （根下直接放的文件是 `''`），面板靠它分组。跳过隐藏目录（`.`）与库内部目录（`_`，见
 * `isInternalName`）——`figures/_history` 里的历史登记不该混进本次交付。
 */
const walkFiles = async (dirAbs, { depth = MAX_SCAN_DEPTH, exts = null } = {}) => {
  const out = [];
  const walk = async (d, left, sub) => {
    for (const e of await listDir(d)) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) {
        if (left <= 0) continue;
        await walk(abs, left - 1, sub ? `${sub}/${e.name}` : e.name);
        continue;
      }
      if (exts && !exts.has(path.extname(e.name).toLowerCase())) continue;
      out.push({ abs, sub });
    }
  };
  await walk(dirAbs, depth, '');
  return out;
};

/** 某一类目录下的子文件夹清单（含空文件夹，面板要显示「（空）」）。 */
const listSubdirs = async (dirAbs, { depth = MAX_SCAN_DEPTH } = {}) => {
  const out = [];
  const walk = async (d, left, sub) => {
    for (const e of await listDir(d, { files: false })) {
      const next = sub ? `${sub}/${e.name}` : e.name;
      out.push(next);
      if (left > 1) await walk(path.join(d, e.name), left - 1, next);
    }
  };
  await walk(dirAbs, depth, '');
  return out.sort();
};

/** 单个文件的 stat；文件在扫描窗口里被删/挪走时返回 null，而不是把整个 snapshot 带崩。 */
async function statSafe(abs) {
  try {
    return await stat(abs);
  } catch {
    return null;
  }
}

/** 把 `{abs, sub}` 收成面板条目（name 取 basename、path 取库根相对路径）。 */
const fileEntries = async (root, items, extra = () => ({})) => {
  const out = [];
  for (const { abs, sub } of items) {
    const st = await statSafe(abs);
    if (!st) continue; // 扫描过程中文件消失了：跳过这个条目，别整个面板 internal
    out.push({ name: path.basename(abs), path: toRel(root, abs), sub, bytes: st.size, mtime: st.mtime.toISOString(), ...extra(abs) });
  }
  return out;
};

/** 库根相对路径（POSIX 分隔符）。 */
export const toRel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');

/* --------------------------------------------------------------- 配置与库根 */

/**
 * 合并三处配置，库里那份权威、最优先：
 *   1. 库里 `.research/config.json`（`research.py` 写的，权威）
 *   2. 随包的 `library/config.json`（`scripts/install.mjs` 写的；首次使用前可能不存在）
 *   3. 环境变量与目录约定（`lib/config.js`：`SCIWORK_LIBRARY` → 默认 `<用户目录>/Research`）
 * 另外补一层 Origin 探测：两份配置都没写 server 时按 DSH 目录约定去找上游插件，
 * 免得用户明明装了 dsh-origin-plugin，却因为没跑安装器而用不了「重画」。
 */
export async function loadSettings() {
  const bundled = (await readJsonSafe(path.join(BUNDLE_DIR, 'library', 'config.json'), {})) || {};
  // 库根优先级：库内 `.research/config.json` ＞ 环境变量 ＞ 随包 `library/config.json` ＞ 默认。
  // 环境变量是运行期显式指定（隔离自检副本、用户换库位置都靠它），必须压过安装期快照；
  // 2026-10-19 之前随包快照抢在环境变量前面，装有 config.json 的机器上「把库指到别处」静默失效。
  const envRoot = envLibraryRoot();
  const root = envRoot ? path.resolve(envRoot) : resolveLibraryRoot(bundled.libraryRoot);
  const inLibrary = (await readJsonSafe(path.join(root, '.research', 'config.json'), {})) || {};
  let origin = inLibrary.origin || bundled.origin || null;
  if (!origin || !origin.server) {
    const server = resolveOriginServer({ pluginDir: (origin && origin.pluginDir) || null });
    if (server) {
      origin = { ...(origin || {}), pluginDir: (origin && origin.pluginDir) || resolveOriginPluginDir(), server };
    }
  }
  return {
    root: inLibrary.libraryRoot || root,
    interpreter: inLibrary.interpreter || bundled.interpreter || null,
    launcher: inLibrary.launcher || bundled.launcher || null,
    origin,
    defaults: inLibrary.defaults || bundled.defaults || {},
    bundleDir: BUNDLE_DIR,
  };
}

/* ------------------------------------------------------------ 路径安全约束 */

/**
 * 把库根相对路径解成绝对路径，并保证它**落在库根之内**。
 * 拒绝：绝对路径、盘符、`..` 逃逸、空路径。
 */
export function resolveInside(root, rel) {
  if (typeof rel !== 'string' || rel.trim() === '') throw new Error('空路径');
  const raw = rel.replace(/\\/g, '/').trim();
  if (/^[a-zA-Z]:/.test(raw) || raw.startsWith('/')) throw new Error('只接受库根相对路径');
  const abs = path.resolve(root, raw);
  const relBack = path.relative(root, abs);
  if (relBack === '' || relBack.startsWith('..') || path.isAbsolute(relBack)) {
    throw new Error('路径越出科研库范围');
  }
  return abs;
}

/* -------------------------------------------------------------- 读文本/图片 */

export async function readText(root, rel, maxBytes = MAX_TEXT_BYTES) {
  const abs = resolveInside(root, rel);
  const ext = path.extname(abs).toLowerCase();
  if (!TEXT_EXT.has(ext)) throw new Error(`不是可预览的文本类型：${ext || '(无扩展名)'}`);
  const info = await stat(abs);
  if (info.size > maxBytes) throw new Error(`文件过大（${info.size} B > ${maxBytes} B）`);
  const text = await readFile(abs, 'utf8');
  return { path: toRel(root, abs), bytes: info.size, mtime: info.mtime.toISOString(), text };
}

export async function readBinary(root, rel, maxBytes = MAX_BINARY_BYTES) {
  const abs = resolveInside(root, rel);
  const ext = path.extname(abs).toLowerCase();
  const mime = BINARY_MIME[ext];
  if (!mime) throw new Error(`不支持的二进制类型：${ext || '(无扩展名)'}`);
  const info = await stat(abs);
  if (info.size > maxBytes) throw new Error(`文件过大（${info.size} B > ${maxBytes} B）`);
  const buf = await readFile(abs);
  return { path: toRel(root, abs), mime, bytes: info.size, mtime: info.mtime.toISOString(), base64: buf.toString('base64') };
}

/** 表的列名（给「重画 / 出图」列选择用）——和出图走同一套读表规则：没有表头的文件列名是 `#1` `#2`。 */
export async function tableColumns(root, rel) {
  const abs = resolveInside(root, rel);
  const head = (await readFile(abs, 'utf8')).slice(0, 65536);
  const t = parseTable(head);
  return { path: toRel(root, abs), columns: t.header, headerless: !!t.headerless, delimiter: t.delimiter };
}

/* ------------------------------------------------------------ 草稿原地保存 */

/**
 * 允许面板原地编辑的文件：**只有草稿**（`projects/<课题>/drafts/*.md|.markdown|.txt`）。
 * 2026-10-11 修正：早先写的是「projects/ refs/ notes/ 三个目录前缀」，
 * 结果 `refs/refs.json`（文献登记索引）也能被面板覆写 —— 冒烟测试真把它写坏了，
 * 靠 `.bak` 才复原。现在改成全路径正则 + 元数据黑名单，双保险。
 */
const EDITABLE_RE = /^projects\/[^/]+\/drafts\/[^/]+\.(md|markdown|txt)$/i;
/** 哪怕路径长得像草稿，这些登记元数据也绝不从面板改。 */
const NEVER_EDIT = new Set(['refs.json', 'project.json', 'migration.json', 'engine.json', 'config.json', '_index.json', 'refs.bib', 'library.json']);
const MAX_EDIT_BYTES = 2 * 1024 * 1024;

/**
 * 面板内保存一份文本（目前只有草稿走这条路）。
 * 安全口径：
 *   - 只允许 `projects/<课题>/drafts/` 下的 .md/.markdown/.txt，且必须**已存在**（不新建文件）；
 *   - 写之前先把原文件复制成同名 `.bak`（覆盖旧 `.bak`）——一次保存一份回滚点；
 *   - 大小上限 2 MiB（防手滑把二进制塞进来）。
 * @param {string} root 库根
 * @param {string} rel 库根相对路径
 * @param {string} text 新内容
 */
export async function writeTextBackup(root, rel, text) {
  const abs = resolveInside(root, rel);
  const relPosix = toRel(root, abs);
  if (!EDITABLE_RE.test(relPosix)) {
    throw new Error(`只允许编辑 projects/<课题>/drafts/ 下的 .md/.markdown/.txt 草稿：${relPosix}`);
  }
  if (NEVER_EDIT.has(path.posix.basename(relPosix).toLowerCase())) {
    throw new Error(`这是登记索引，不能从面板改：${relPosix}`);
  }
  const ext = path.extname(abs).toLowerCase();
  if (!TEXT_EXT.has(ext)) throw new Error(`不是可编辑的文本类型：${ext || '(无扩展名)'}`);
  const body = String(text ?? '');
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > MAX_EDIT_BYTES) throw new Error(`内容过大（${bytes} B > ${MAX_EDIT_BYTES} B）`);
  const info = await stat(abs);              // 不存在 → ENOENT（actions 层翻成 not-found）
  if (!info.isFile()) throw new Error(`不是文件：${relPosix}`);
  const backupAbs = `${abs}.bak`;
  await copyFile(abs, backupAbs);
  await writeFile(abs, body, 'utf8');
  const after = await stat(abs);
  return {
    path: relPosix,
    backup: toRel(root, backupAbs),
    bytes: after.size,
    beforeBytes: info.size,
    mtime: after.mtime.toISOString(),
  };
}

/**
 * 面板内新建一份**空白草稿**（`projects/<课题>/drafts/<名字>.md`）。
 * 与 `writeTextBackup` 的分工：那个只改已存在的文件，这个只创建**不存在**的文件
 * （已存在一律拒，避免手滑覆盖别人的稿子）。文件名由调用方（actions）校验过 slug，
 * 这里再兜一遍：不允许路径分隔符、不允许 `..`、不允许登记索引名字。
 * @param {string} root 库根
 * @param {{project:string, name:string, title?:string}} input
 */
export async function createDraft(root, input) {
  const project = String((input && input.project) || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(project)) throw new Error(`课题 slug 不合法：${project || '(空)'}`);
  const rawName = String((input && input.name) || '').trim();
  if (!/^[^/\\:*?"<>|]{1,80}$/.test(rawName) || rawName.startsWith('.')) throw new Error(`草稿文件名不合法：${rawName || '(空)'}`);
  if (NEVER_EDIT.has(rawName.toLowerCase())) throw new Error(`这是登记索引，不能当草稿名：${rawName}`);
  const file = /\.(md|markdown|txt)$/i.test(rawName) ? rawName : `${rawName}.md`;
  const rel = `projects/${project}/drafts/${file}`;
  if (!EDITABLE_RE.test(rel)) throw new Error(`只允许在 projects/<课题>/drafts/ 下新建草稿：${rel}`);
  const abs = resolveInside(root, rel);
  const exists = await stat(abs).then(() => true, () => false);
  if (exists) throw new Error(`已经有这个草稿了：${rel}（想改内容就点「编辑」，别新建）`);
  const title = String((input && input.title) || '').trim();
  const body = `# ${title || file.replace(/\.(md|markdown|txt)$/i, '')}\n\n`;
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body, 'utf8');
  const after = await stat(abs);
  return { path: rel, bytes: after.size, mtime: after.mtime.toISOString(), created: true, body };
}

/* ------------------------------------------------------------- 引用核查闸门 */

const FENCE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`]*`/g;
const BRACKET_CITE = /\[([^\]]*@[^\]]*)\]/g;
const TEX_CITE = /\\cite[a-z]*\{([^}]*)\}/g;

/** 与 `research.py check-citations` 同口径的键提取。 */
export function extractCiteKeys(markdown) {
  // 口径必须和 research.py 的 extract_keys 一致：
  // 只认以 @ 开头的段（按 ; 切），再取 [,\s] 之前的第一段。
  // 旧实现按下划线 [,;] 切且不等 @，会把 `[see @a2020]` 抽成假键 "see"。
  // 面板与 CLI 结论不一致时，以 CLI（`research.py check-citations`）为准。
  const text = String(markdown).replace(FENCE, ' ').replace(INLINE_CODE, ' ');
  const keys = new Set();
  for (const m of text.matchAll(BRACKET_CITE)) {
    for (const part of m[1].split(';')) {
      const p = part.trim();
      if (!p.startsWith('@')) continue;
      const k = p.slice(1).split(/[,\s]/)[0].trim();
      if (k) keys.add(k);
    }
  }
  for (const m of text.matchAll(TEX_CITE)) {
    for (const part of m[1].split(',')) {
      const k = part.trim();
      if (k) keys.add(k);
    }
  }
  return [...keys].sort();
}

export async function checkCitations(root, rel) {
  const draft = await readText(root, rel);
  const refsFile = await readJsonSafe(path.join(root, 'refs', 'refs.json'), { refs: {} });
  const known = new Set(Object.keys(refsFile?.refs || {}));
  const cited = extractCiteKeys(draft.text);
  return {
    draft: draft.path,
    bytes: draft.bytes,
    cited,
    missing: cited.filter((k) => !known.has(k)),
    known: known.size,
    unusedFromCitingProjects: [...known].filter((k) => {
      const rec = refsFile.refs[k];
      const projects = Array.isArray(rec?.projects) ? rec.projects : [];
      return cited.length > 0 && !cited.includes(k) && projects.includes(currentProjectOf(draft.path));
    }).sort(),
  };
}

function currentProjectOf(rel) {
  const m = /^projects\/([^/]+)\//.exec(String(rel));
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------- 快照 */

/** journals\*.json（跳过 _index.json / README 之类）。 */
async function readJournals(root) {
  const dir = path.join(root, 'journals');
  const out = [];
  for (const e of await listDir(dir, { dirs: false })) {
    if (!e.name.toLowerCase().endsWith('.json')) continue;
    if (e.name.startsWith('_')) continue;
    const j = await readJsonSafe(path.join(dir, e.name));
    if (!j || typeof j !== 'object') continue;
    out.push({
      id: j.id || path.basename(e.name, '.json'),
      name: j.name || '',
      nameZh: j.nameZh || '',
      publisher: j.publisher || '',
      language: j.language || '',
      confidence: j.confidence || 'unknown',
      verifiedAt: j.verifiedAt || null,
      homepage: j.homepage || null,
      note: (j.figure && typeof j.figure.notes === 'string') ? j.figure.notes.slice(0, 400) : '',
      file: toRel(root, path.join(dir, e.name)),
      bytes: ((await statSafe(path.join(dir, e.name)))?.size ?? null),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** 一个课题目录 → 面板需要的全部条目。 */
async function readProject(root, slug) {
  const dir = path.join(root, 'projects', slug);
  const meta = (await readJsonSafe(path.join(dir, 'project.json'), {})) || {};

  // 图：figures\**\*.json 侧车 + 文件是否真的在（侧车允许放在子文件夹里）
  const figures = [];
  for (const { abs: sidecarAbs, sub: figSub } of await walkFiles(path.join(dir, 'figures'), { exts: new Set(['.json']) })) {
    const e = { name: path.basename(sidecarAbs) };
    const s = (await readJsonSafe(sidecarAbs, null));
    if (!s) continue;
    const fileRel = s.file ? String(s.file) : null;
    const fileAbs = fileRel ? resolveInside(root, fileRel) : null;
    let fileInfo = null;
    if (fileAbs && await isFile(fileAbs)) {
      const st = await stat(fileAbs);
      fileInfo = { bytes: st.size, mtime: st.mtime.toISOString() };
    }
    const sources = Array.isArray(s.sourceData) ? s.sourceData : [];
    // 侧车 files[]：同一次交付的**附带件**（PNG/PDF…）。主件单独占 file 字段，这里去掉它免得同一个
    // 路径在卡片里出现两遍；面板要给「旧图留在 files[] 里」一个能看的地方，所以必须读出来。
    const extraFiles = (Array.isArray(s.files) ? s.files : [])
      .map((p) => String(p))
      .filter((p) => p && p !== fileRel);
    figures.push({
      figureId: s.figureId || path.basename(e.name, '.json'),
      project: s.project || slug,
      sidecar: toRel(root, sidecarAbs),
      sub: figSub,
      file: fileRel,
      fileExists: Boolean(fileInfo),
      fileBytes: fileInfo ? fileInfo.bytes : null,
      fileMtime: fileInfo ? fileInfo.mtime : null,
      graph: s.graph || null,
      journal: s.journal || null,
      caption: s.caption || '',
      sources,
      sourcesExist: sources.map((p) => ({ path: p, exists: false, kind: null })), // 下面填
      fileList: [], // 侧车 files[] 的附带件（下面填）
      originProject: s.originProject || null,
      createdAt: s.createdAt || null,
      params: s.params || {},
      verifyPassed: (s.params && s.params.verify_passed === true) ? true : (s.params && s.params.verify_passed === false ? false : null),
      traceId: (s.params && s.params.trace_id) || null,
      warnings: [],
    });
    const fig = figures[figures.length - 1];
    fig.sourcesExist = [];
    for (const p of sources) {
      let exists = false, kind = null;
      try {
        const abs = resolveInside(root, p);
        // 源数据可以登记成一个**目录**（一次出图吃整组数据，fig18 就是 projects/zt-ceremic/data）。
        // 旧口径只认 isFile ⇒ 目录被判「不存在」⇒ 卡片和库级告警一起误报。
        if (await isFile(abs)) { exists = true; kind = 'file'; }
        else if (await isDir(abs)) { exists = true; kind = 'dir'; }
      } catch { exists = false; }
      fig.sourcesExist.push({ path: p, exists, kind });
    }
    fig.fileList = [];
    for (const p of extraFiles) {
      let exists = false, bytes = null, mtime = null;
      try {
        const abs = resolveInside(root, p);
        if (await isFile(abs)) {
          const st = await stat(abs);
          exists = true; bytes = st.size; mtime = st.mtime.toISOString();
        }
      } catch { exists = false; }
      fig.fileList.push({ path: p, ext: path.extname(p).toLowerCase(), exists, bytes, mtime });
    }
    if (!fileRel) fig.warnings.push('侧车没有记录出图文件（file 字段为空）');
    else if (!fileInfo) fig.warnings.push(`图文件不存在：${fileRel}`);
    if (!s.caption) fig.warnings.push('没有图注（caption）');
    for (const s2 of fig.sourcesExist) if (!s2.exists) fig.warnings.push(`源数据不存在：${s2.path}`);
    for (const f2 of fig.fileList) if (!f2.exists) fig.warnings.push(`附带文件不存在：${f2.path}`);
  }

  // 草稿 / 数据 / 表格 / Origin 工程（都允许按子文件夹归类）
  const drafts = await fileEntries(root, await walkFiles(path.join(dir, 'drafts')));
  const datasets = (await fileEntries(root, await walkFiles(path.join(dir, 'data'), { exts: DATA_EXT })))
    .map((d) => ({ ...d, ext: path.extname(d.name).toLowerCase() }));
  const tables = (await fileEntries(root, await walkFiles(path.join(dir, 'tables'), { exts: TABLE_EXT })))
    .map((d) => ({ ...d, ext: path.extname(d.name).toLowerCase() }));
  const opju = [];
  for (const sub of ['opju', 'origin']) {
    for (const it of await walkFiles(path.join(dir, sub), { depth: 2 })) {
      const st = await stat(it.abs);
      opju.push({
        name: path.basename(it.abs), path: toRel(root, it.abs), dir: sub, sub: it.sub,
        bytes: st.size, mtime: st.mtime.toISOString(),
      });
    }
  }
  // 空文件夹也要报给面板（显示成「（空）」），所以单独列一遍子目录
  const folders = {
    data: await listSubdirs(path.join(dir, 'data')),
    figures: await listSubdirs(path.join(dir, 'figures')),
    drafts: await listSubdirs(path.join(dir, 'drafts')),
    tables: await listSubdirs(path.join(dir, 'tables')),
  };

  return {
    slug,
    title: meta.title || slug,
    journal: meta.journal || null,
    keywords: Array.isArray(meta.keywords) ? meta.keywords : [],
    createdAt: meta.createdAt || null,
    updatedAt: meta.updatedAt || null,
    notes: meta.notes || '',
    figures, drafts, datasets, tables, opju, folders,
  };
}

export async function snapshot() {
  const settings = await loadSettings();
  const root = settings.root;
  const warnings = [];

  if (!(await isDir(root))) {
    return { ok: false, root, error: `科研库根目录不存在：${root}`, projects: [], refs: [], pdfs: [], journals: [], counts: {} };
  }

  const projects = [];
  for (const e of await listDir(path.join(root, 'projects'))) {
    projects.push(await readProject(root, e.name));
  }
  projects.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

  // 文献
  const refsFile = (await readJsonSafe(path.join(root, 'refs', 'refs.json'), { refs: {} })) || { refs: {} };
  const refs = Object.values(refsFile.refs || {}).map((r) => ({
    key: r.key,
    type: r.type || 'article',
    title: r.title || '',
    authors: Array.isArray(r.authors) ? r.authors : [],
    year: r.year ?? null,
    container: r.container || '',
    volume: r.volume || null,
    issue: r.issue || null,
    pages: r.pages || null,
    doi: r.doi || null,
    url: r.url || null,
    source: r.source || null,
    verifiedBy: r.verifiedBy || null,
    accessedAt: r.accessedAt || null,
    projects: Array.isArray(r.projects) ? r.projects : [],
    addedAt: r.addedAt || null,
    notes: r.notes || '',
  }));
  if (!refs.every((r) => r.doi)) {
    const n = refs.filter((r) => !r.doi).length;
    if (n) warnings.push(`${n} 条文献没有 DOI（引用时要人工确认）`);
  }

  const journals = await readJournals(root);

  // 投稿台账：submissions/*.json 是 research.py add-submission 写的记录（含事件时间线）。
  // 非 JSON / 下划线开头的文件如实列为 kind='file'，不做任何解释。
  const submissions = [];
  for (const e of await listDir(path.join(root, 'submissions'), { dirs: false })) {
    const abs = path.join(root, 'submissions', e.name);
    const st = await stat(abs);
    const rel = toRel(root, abs);
    const plainFile = { kind: 'file', name: e.name, path: rel, bytes: st.size, mtime: st.mtime.toISOString() };
    if (!e.name.toLowerCase().endsWith('.json') || e.name.startsWith('_')) {
      submissions.push(plainFile);
      continue;
    }
    const rec = await readJsonSafe(abs, null);
    if (!rec || typeof rec !== 'object') {
      submissions.push({ ...plainFile, warnings: ['JSON 解析失败，面板只如实列文件'] });
      continue;
    }
    const events = Array.isArray(rec.events) ? rec.events : [];
    submissions.push({
      kind: 'submission',
      submissionId: rec.submissionId || e.name.replace(/\.json$/i, ''),
      project: rec.project || null,
      journal: rec.journal || null,
      journalName: rec.journalName || null,
      title: rec.title || null,
      type: rec.type || null,
      status: rec.status || 'unknown',
      manuscript: rec.manuscript || null,
      manuscriptId: rec.manuscriptId || null,
      doi: rec.doi || null,
      files: Array.isArray(rec.files) ? rec.files : [],
      submittedAt: rec.submittedAt || null,
      decisionExpectedAt: rec.decisionExpectedAt || null,
      nextAction: rec.nextAction || null,
      nextActionDue: rec.nextActionDue || null,
      eventCount: events.length,
      lastEvent: events.length ? events[events.length - 1] : null,
      updatedAt: rec.updatedAt || st.mtime.toISOString(),
      path: rel,
      bytes: st.size,
    });
  }
  const submissionRecords = submissions.filter((s) => s.kind === 'submission');
  if (submissionRecords.length === 0) {
    warnings.push('还没有登记任何投稿记录：让智能体跑 research.py add-submission --journal <档案键> --project <课题> --title <标题>');
  }
  const CLOSED = ['accepted', 'rejected', 'withdrawn', 'published'];
  const today = new Date().toISOString().slice(0, 10);
  const overdue = submissionRecords.filter((s) => s.nextActionDue && !CLOSED.includes(s.status) && String(s.nextActionDue).slice(0, 10) < today);
  if (overdue.length) warnings.push(`有 ${overdue.length} 条投稿的「下一步」已过期：${overdue.map((s) => s.submissionId).join('、')}`);
  const stray = submissions.filter((s) => s.kind === 'file').length;
  if (stray) warnings.push(`投稿目录里有 ${stray} 个非记录文件（面板只如实列文件名）`);

  // 索引时间（只作展示）
  const indexFile = (await readJsonSafe(path.join(root, '.research', 'index', 'library.json'), null));
  const indexAt = indexFile?.generatedAt || null;

  // 本地 PDF 附件：add-ref 只记 DOI/URL、不记文件路径，所以这里按目录（refs/pdf/）如实列出。
  const pdfs = [];
  for (const e of await listDir(path.join(root, 'refs', 'pdf'), { dirs: false })) {
    const abs = path.join(root, 'refs', 'pdf', e.name);
    const st = await statSafe(abs);
    if (!st) continue; // 同上：PDF 读 stat 失败就跳过，不放过整份 snapshot
    pdfs.push({ name: e.name, path: toRel(root, abs), bytes: st.size, mtime: st.mtime.toISOString() });
  }

  // 库级警告
  const figureCount = projects.reduce((n, p) => n + p.figures.length, 0);
  if (indexAt) {
    const newest = projects.flatMap((p) => p.figures.map((f) => f.createdAt)).filter(Boolean).sort().pop();
    if (newest && newest > indexAt) warnings.push(`库索引（${indexAt}）比最新的图（${newest}）旧，可让智能体跑 research.py reindex`);
  }
  const lowConf = journals.filter((j) => j.confidence === 'low').length;
  if (lowConf) warnings.push(`${lowConf}/${journals.length} 份期刊档案 confidence=low（数值字段多为 null，别当权威）`);
  const broken = projects.flatMap((p) => p.figures.filter((f) => f.warnings.length > 0).map((f) => `${f.figureId}`));
  if (broken.length) warnings.push(`有 ${broken.length} 张图存在告警：${broken.join('、')}`);

  return {
    ok: true,
    root,
    origin: settings.origin ? { server: settings.origin.server, toolPrefix: settings.origin.toolPrefix, pluginDir: settings.origin.pluginDir } : null,
    interpreter: settings.interpreter,
    launcher: settings.launcher,
    defaults: settings.defaults,
    indexAt,
    counts: {
      project: projects.length,
      figure: figureCount,
      draft: projects.reduce((n, p) => n + p.drafts.length, 0),
      dataset: projects.reduce((n, p) => n + p.datasets.length, 0),
      ref: refs.length,
      journal: journals.length,
      submission: submissionRecords.length,
    },
    projects,
    refs,
    pdfs,
    journals,
    submissions,
    warnings,
    readAt: new Date().toISOString(),
  };
}

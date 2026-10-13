/**
 * 科研模式 · 归档 / 删除 / 恢复（宿主侧）
 * ---------------------------------------------------------------------------
 * 面板上唯一会「拿走」东西的动作。三条硬口径：
 *   1. **只动磁盘文件，不动登记记录**。`refs.json`、`journals/`、`.research/` 一律拒绝；
 *      图的侧车（`projects/<slug>/figures/<id>.json`）跟它的图一起走 —— 侧车就是这张图
 *      的登记记录，把它搬走 = 这张图从库里消失（`research.py reindex` 之后索引自然更新）。
 *   2. **归档优先，真删要输名字**。归档落到 `.research/archive/<时间戳>/<原相对路径>`
 *      并写 `manifest.json`（谁、何时、为什么、原路径、字节数）⇒ 可恢复；
 *      真删一次性、要 `confirm` 等于文件名，只留一条 `_removed/<时间戳>.json` 记录
 *      （**不进系统回收站**，面板上必须如实这么写）。
 *   3. 一次只处理用户明确点选的条目；路径全部经 `resolveInside` 收敛在库根之内。
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { loadSettings, resolveInside, toRel } from './library.js';

export const ARCHIVE_ROOT = '.research/archive';
const REMOVED_DIR = '.research/archive/_removed';

/** 允许被归档/删除的路径前缀（其余一律拒绝）。 */
const ALLOW_PREFIX = ['projects/', 'refs/pdf/', 'submissions/'];
/** 即便在允许前缀里也不许碰的文件名。 */
const DENY_BASENAME = new Set(['project.json', 'refs.json', 'config.json', '_index.json']);

const asString = (v) => (typeof v === 'string' ? v.trim() : '');
const fail = (code, message, details = {}) => ({ ok: false, error: { code, message, details } });
const done = (value) => ({ ok: true, value });

const normRel = (p) => asString(p).replace(/\\/g, '/').replace(/^\.\//, '');

const stamp = (d = new Date()) => {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** 路径白名单：返回 '' 表示允许，否则返回拒绝原因。 */
function whyDenied(rel) {
  if (!rel) return '空路径';
  if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return '只接受库根相对路径';
  if (rel.split('/').some((seg) => seg === '..' || seg === '')) return '路径里有 .. 或空段';
  if (!ALLOW_PREFIX.some((p) => rel.startsWith(p))) {
    return `只允许动 ${ALLOW_PREFIX.join(' / ')} 下的文件（登记记录与索引不在这里改）`;
  }
  if (DENY_BASENAME.has(path.posix.basename(rel))) return `${path.posix.basename(rel)} 是登记/配置文件，面板不动它`;
  return '';
}

/** 把线上来的条目收敛成 `{path, sidecar, kind}`，并逐个做白名单校验。 */
function normalizeEntries(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const accepted = [];
  const rejected = [];
  for (const item of list.slice(0, 200)) {
    if (!item || typeof item !== 'object') continue;
    const rel = normRel(item.path);
    const bad = whyDenied(rel);
    if (bad) {
      rejected.push({ path: rel || String(item.path || ''), reason: bad });
      continue;
    }
    const sidecarRaw = normRel(item.sidecar);
    let sidecar = null;
    if (sidecarRaw) {
      const badSide = whyDenied(sidecarRaw);
      const sameDir = path.posix.dirname(sidecarRaw) === path.posix.dirname(rel);
      const isJson = path.posix.extname(sidecarRaw).toLowerCase() === '.json';
      if (badSide) rejected.push({ path: sidecarRaw, reason: badSide });
      // 只要求「同目录 + .json」。图的登记侧车不一定与图片同主名：实测 Graph3.png 的登记叫 fig2.json，
      // 早先的「同主名」规则会让「删掉这张图」只删掉 PNG、把登记留在库里（2026-10-11 用户报「删了还显示」）。
      // 登记索引类文件（refs.json / project.json / config.json / _index.json）已被 DENY_BASENAME 挡住。
      else if (!sameDir || !isJson) rejected.push({ path: sidecarRaw, reason: '侧车必须是同目录的 .json 登记文件（figures/fig1.png + figures/fig1.json；也接受 figures/Graph3.png + figures/fig2.json）' });
      else sidecar = sidecarRaw;
    }
    accepted.push({ path: rel, sidecar, kind: asString(item.kind) || 'file', label: asString(item.label) || path.posix.basename(rel) });
  }
  return { accepted, rejected };
}

async function moveFile(fromAbs, toAbs) {
  await mkdir(path.dirname(toAbs), { recursive: true });
  try {
    await rename(fromAbs, toAbs);
  } catch (error) {
    if (error?.code !== 'EXDEV' && error?.code !== 'EPERM') throw error;
    await copyFile(fromAbs, toAbs);
    await unlink(fromAbs);
  }
}

async function fileBytes(abs) {
  try {
    const st = await stat(abs);
    return st.isFile() ? st.size : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ 归档 */

/**
 * 把选中的文件（图的侧车跟着图一起）移进归档区。
 * @param {{entries?:Array, reason?:string}} input
 */
export async function archiveEntries(input = {}) {
  const settings = await loadSettings();
  const root = settings.root;
  if (!existsSync(root)) return fail('not-found', `科研库根目录不存在：${root}`);
  const { accepted, rejected } = normalizeEntries(input.entries);
  if (accepted.length === 0) {
    // 面板给过来的路径全被拒时，把「为什么」说清楚（别只说一句"没有可归档的条目"）。
    if (rejected.length) {
      const first = rejected[0];
      return fail('denied', `这些路径不能归档：${first.path}（${first.reason}）`, { rejected });
    }
    return fail('bad-request', '没有可归档的条目', { rejected });
  }

  const baseId = stamp();
  let id = baseId;
  for (let i = 2; existsSync(path.join(root, ARCHIVE_ROOT, id)); i += 1) id = `${baseId}-${i}`;
  const dirAbs = path.join(root, ARCHIVE_ROOT, id);

  const moved = [];
  const missing = [];
  const skipped = [...rejected];
  const items = [];
  for (const entry of accepted) {
    const group = [entry.path, ...(entry.sidecar ? [entry.sidecar] : [])];
    const plan = [];
    for (const rel of group) {
      const abs = resolveInside(root, rel);
      const bytes = await fileBytes(abs);
      if (bytes === null) {
        missing.push({ path: rel, reason: '文件不存在（可能已经被别的操作搬走了）' });
        continue;
      }
      plan.push({ rel, abs, bytes });
    }
    if (plan.length === 0) continue;
    for (const file of plan) {
      const toAbs = path.join(dirAbs, file.rel);
      try {
        await moveFile(file.abs, toAbs);
        moved.push({ path: file.rel, to: toRel(root, toAbs), bytes: file.bytes, kind: entry.kind, label: entry.label });
        items.push({ path: file.rel, to: toRel(root, toAbs), bytes: file.bytes, kind: entry.kind, role: file.rel === entry.path ? 'primary' : 'sidecar' });
      } catch (error) {
        skipped.push({ path: file.rel, reason: String(error?.message || error) });
      }
    }
  }

  if (moved.length === 0) {
    return fail('not-found', '选中的文件都不在了，没有可归档的东西', { missing, skipped });
  }

  const at = new Date().toISOString();
  const manifest = {
    schema: 1,
    id,
    at,
    by: 'research-panel',
    reason: asString(input.reason) || '面板归档',
    root,
    items,
    bytes: items.reduce((n, it) => n + (it.bytes || 0), 0),
  };
  await mkdir(dirAbs, { recursive: true });
  await writeFile(path.join(dirAbs, 'manifest.json'), JSON.stringify(manifest, null, 1), 'utf8');

  return done({
    id,
    dir: toRel(root, dirAbs),
    at,
    moved,
    missing,
    skipped,
    bytes: manifest.bytes,
    summary: `已归档 ${moved.length} 个文件到 ${toRel(root, dirAbs)}（可从归档区恢复）。`,
    note: '归档只搬文件；登记记录（refs.json / 投稿记录）里对应的条目仍然在，需要清理请让智能体跑 research.py。',
  });
}

/* ------------------------------------------------------------------ 删除 */

/**
 * 永久删除。要求 `confirm` 等于主文件名；一次只允许一个条目（图 = 主文件 + 侧车算一个）。
 * @param {{entries?:Array, confirm?:string, reason?:string}} input
 */
export async function removeEntries(input = {}) {
  const settings = await loadSettings();
  const root = settings.root;
  if (!existsSync(root)) return fail('not-found', `科研库根目录不存在：${root}`);
  const { accepted, rejected } = normalizeEntries(input.entries);
  if (accepted.length !== 1) {
    if (accepted.length === 0 && rejected.length) {
      const first = rejected[0];
      return fail('denied', `这些路径不能删：${first.path}（${first.reason}）`, { rejected });
    }
    return fail(
      'bad-request',
      accepted.length === 0
        ? '没有可删除的条目（真删一次只允许一个文件；批量请用归档）'
        : `真删一次只能选一个文件，现在选了 ${accepted.length} 个。批量删除请用「归档」。`,
      { rejected },
    );
  }
  const entry = accepted[0];
  const want = path.posix.basename(entry.path);
  const got = asString(input.confirm);
  if (got !== want) {
    return fail('denied', `确认文件名不对：要删的是「${want}」，请原样输入一次。`, { expected: want, got });
  }

  const removed = [];
  const missing = [];
  const skipped = [...rejected];
  for (const rel of [entry.path, ...(entry.sidecar ? [entry.sidecar] : [])]) {
    const abs = resolveInside(root, rel);
    const bytes = await fileBytes(abs);
    if (bytes === null) {
      missing.push({ path: rel, reason: '文件不存在' });
      continue;
    }
    try {
      await unlink(abs);
      removed.push({ path: rel, bytes, kind: entry.kind });
    } catch (error) {
      skipped.push({ path: rel, reason: String(error?.message || error) });
    }
  }
  if (removed.length === 0) return fail('not-found', '文件已经不在了', { missing, skipped });

  const at = new Date().toISOString();
  const logAbs = path.join(root, REMOVED_DIR, `${stamp()}.json`);
  await mkdir(path.dirname(logAbs), { recursive: true });
  await writeFile(
    logAbs,
    JSON.stringify({ schema: 1, at, by: 'research-panel', reason: asString(input.reason) || '面板删除', root, removed, missing, skipped }, null, 1),
    'utf8',
  );

  return done({
    removed,
    missing,
    skipped,
    log: toRel(root, logAbs),
    summary: `已永久删除 ${removed.length} 个文件（不进系统回收站）。`,
    note: `只留了一条删除记录：${toRel(root, logAbs)}。登记记录里对应的条目仍然在，需要清理请让智能体跑 research.py。`,
  });
}

/* ------------------------------------------------------------------ 恢复 */

/**
 * 从某个归档批次里恢复文件。
 * @param {{id?:string, paths?:string[]}} input - paths 为空 = 恢复该批次里还没恢复的全部
 */
export async function restoreEntries(input = {}) {
  const settings = await loadSettings();
  const root = settings.root;
  const id = asString(input.id);
  if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) return fail('bad-request', `归档批次 id 不合法：${id || '(空)'}`);
  const dirAbs = path.join(root, ARCHIVE_ROOT, id);
  const manifestAbs = path.join(dirAbs, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestAbs, 'utf8'));
  } catch (error) {
    return fail('not-found', `读不到归档记录：${toRel(root, manifestAbs)}（${String(error?.message || error)}）`);
  }
  const wanted = Array.isArray(input.paths) ? input.paths.map(normRel).filter(Boolean) : [];
  const items = (Array.isArray(manifest.items) ? manifest.items : []).filter((it) => it && typeof it.path === 'string');
  const selected = wanted.length ? items.filter((it) => wanted.includes(it.path)) : items;
  if (selected.length === 0) return fail('not-found', '这个批次里没有匹配的条目', { id, wanted });

  const restored = [];
  const skipped = [];
  for (const item of selected) {
    const fromAbs = path.join(dirAbs, item.path);
    const destAbs = resolveInside(root, item.path);
    if (existsSync(destAbs)) {
      skipped.push({ path: item.path, reason: '库里已经有同名文件了，先处理它再恢复' });
      continue;
    }
    if (!existsSync(fromAbs)) {
      skipped.push({ path: item.path, reason: '归档区里没有这个文件（可能已恢复过）' });
      continue;
    }
    try {
      await moveFile(fromAbs, destAbs);
      item.restoredAt = new Date().toISOString();
      restored.push({ path: item.path, bytes: item.bytes ?? null });
    } catch (error) {
      skipped.push({ path: item.path, reason: String(error?.message || error) });
    }
  }

  manifest.restoredAt = restored.length ? new Date().toISOString() : manifest.restoredAt || null;
  await writeFile(manifestAbs, JSON.stringify(manifest, null, 1), 'utf8');
  const remaining = items.filter((it) => !it.restoredAt && existsSync(path.join(dirAbs, it.path))).length;

  return done({
    id,
    restored,
    skipped,
    remaining,
    summary: `已恢复 ${restored.length} 个文件${remaining ? `，该批次还剩 ${remaining} 个` : '，该批次已清空'}。`,
  });
}

/* -------------------------------------------------------------- 归档区清单 */

/** 归档区 + 删除记录（只读，给面板展示）。 */
export async function archiveInfo() {
  const settings = await loadSettings();
  const root = settings.root;
  const dirAbs = path.join(root, ARCHIVE_ROOT);
  const archives = [];
  if (existsSync(dirAbs)) {
    for (const e of await readdir(dirAbs, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === '_removed') continue;
      let manifest = null;
      try {
        manifest = JSON.parse(await readFile(path.join(dirAbs, e.name, 'manifest.json'), 'utf8'));
      } catch {
        manifest = null;
      }
      const items = Array.isArray(manifest?.items) ? manifest.items : [];
      const live = [];
      for (const it of items) {
        const there = typeof it?.path === 'string' && existsSync(path.join(dirAbs, e.name, it.path));
        if (there) live.push({ path: it.path, bytes: it.bytes ?? null, kind: it.kind || 'file', role: it.role || 'primary' });
      }
      archives.push({
        id: e.name,
        at: manifest?.at || null,
        reason: manifest?.reason || '(没有 manifest.json)',
        total: items.length,
        remaining: live.length,
        bytes: live.reduce((n, it) => n + (it.bytes || 0), 0),
        items: live,
        readable: Boolean(manifest),
      });
    }
  }
  archives.sort((a, b) => String(b.id).localeCompare(String(a.id)));

  const removed = [];
  const logDir = path.join(root, REMOVED_DIR);
  if (existsSync(logDir)) {
    for (const e of (await readdir(logDir, { withFileTypes: true })).filter((d) => d.isFile()).slice(-50)) {
      let rec = null;
      try {
        rec = JSON.parse(await readFile(path.join(logDir, e.name), 'utf8'));
      } catch {
        rec = null;
      }
      removed.push({
        id: e.name.replace(/\.json$/i, ''),
        at: rec?.at || null,
        reason: rec?.reason || null,
        items: Array.isArray(rec?.removed) ? rec.removed.map((r) => ({ path: r.path, bytes: r.bytes ?? null })) : [],
      });
    }
    removed.sort((a, b) => String(b.id).localeCompare(String(a.id)));
  }

  return done({
    dir: toRel(root, dirAbs),
    archives: archives.slice(0, 50),
    removed: removed.slice(0, 20),
    note: '归档区里的文件不在索引里（不会再出现在图表/草稿/数据页）；恢复之后跑一次 reindex 就回来了。真删的记录只留文件名，内容找不回来。',
  });
}

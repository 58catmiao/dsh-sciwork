/**
 * 科研模式 · 库内文件重命名（宿主侧）
 * ---------------------------------------------------------------------------
 * 这是 0.3 面板第二个「会改名」的动作（删除/归档之后）。三条硬口径：
 *   1. **只改同一目录里的文件**。`from` / `to` 都经 `resolveInside` 收敛在库根之内，
 *      再要求两者目录相同；目录本身一律拒绝（目录改名会一次带走整棵子树，
 *      面板没有对应的确认面，不做）。
 *   2. **图件的登记侧车跟图一起走**。一个 `*.json` 里带 `figureId` + `file`
 *      就是这张图的登记（真实样本：`projects/<slug>/figures/_ZT_v4/XRD_ZT_group_v4.json`）。
 *      改它的名字时，同目录下**同基名**的兄弟文件（.png/.pdf/.svg/.tif…）一起改名，
 *      侧车里的 `file` / `files` 改写成新路径 —— 否则登记指向一张不存在的图。
 *   3. **引用跟着改，改 JSON 之前先备份**。普通文件（数据/草稿/opju）改名后，
 *      扫 `projects/*\/figures/**\/*.json`，把 `sourceData` / `files`（以及恰好等于
 *      旧路径的 `file`）指向旧路径的条目改成新路径；每个被改写的 JSON 先复制一份
 *      同名 `.bak`（沿用 `writeTextBackup` / `archive.js` 的备份习惯）。
 *
 * 返回（路径一律库根相对 + 正斜杠）：
 *   { from, to, kind: 'figure'|'file', moved: [{from,to}], updated: [{path,backup,fields}] }
 *
 * 只做文件系统操作；索引由动作层 `reindexAfter` 重建，这里不碰 `research.py`。
 */

import path from 'node:path';
import { copyFile, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';

import { resolveInside, toRel } from './library.js';
import { badRequest, conflict, denied, notFound } from './host/errors.js';

const IS_WIN = process.platform === 'win32';

/** 同一路径判定（Windows 不区分大小写）。 */
const samePath = (a, b) => (IS_WIN ? a.toLowerCase() === b.toLowerCase() : a === b);
/** 映射表/集合用的规范化键（Windows 折成小写）。 */
const pathKey = (p) => (IS_WIN ? p.toLowerCase() : p);
/** 库根相对路径统一成 POSIX 分隔符。 */
const normRel = (p) => String(p ?? '').replace(/\\/g, '/');
/** 文件名不合法字符（Windows 口径）：控制字符、盘符分隔符与保留字符。 */
const BAD_NAME_RE = /[\\/:*?"<>|\u0000-\u001f]/;

/** 内部目录（历史/归档/模板…）不进引用扫描——那些是旧交付，不该被这次改名带动。 */
const SKIP_DIRS = new Set([
  '_history', '_archive', '_templates', '_fetched', '_trash', '_tmp', '_drill', '_e2e', '_scratch', '_backup',
]);

const statSafe = async (p) => {
  try { return await stat(p); } catch { return null; }
};

const existsSafe = async (p) => Boolean(await statSafe(p));

const parseJson = (raw) => {
  try { return JSON.parse(raw); } catch { return null; }
};

/** 新文件名（单段，来自 `path.basename`）的合法性。 */
function checkNewName(name) {
  if (!name || name === '.' || name === '..') throw badRequest('新名字不能为空');
  if (BAD_NAME_RE.test(name)) throw badRequest(`新文件名不合法（含路径分隔符/保留字符）：${name}`);
  if (/[. ]$/.test(name)) throw badRequest(`新文件名不能以点或空格结尾：${name}`);
  if (name.startsWith('.')) throw badRequest(`新文件名不能是隐藏文件（以点开头）：${name}`);
}

/** 侧车判定：对象、带 figureId 与字符串 file。 */
const isFigureSidecar = (obj) => Boolean(
  obj && typeof obj === 'object' && !Array.isArray(obj)
  && obj.figureId
  && typeof obj.file === 'string' && obj.file.trim(),
);

/** 把一次改名映射成路径引用替换函数；`map` 的键是 POSIX 旧相对路径。 */
function makeRefMapper(pairs) {
  const map = new Map();
  for (const p of pairs) map.set(pathKey(normRel(p.from)), normRel(p.to));
  return (value) => {
    if (typeof value !== 'string') return value;
    const hit = map.get(pathKey(normRel(value)));
    return hit === undefined ? value : hit;
  };
}

/** 递归收 `projects/<slug>/figures/**\/*.json`（侧车允许放在子文件夹里，深度同库快照）。 */
async function figureSidecars(root) {
  const out = [];
  const walk = async (dirAbs, depth) => {
    if (depth < 0) return;
    let entries = [];
    try { entries = await readdir(dirAbs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dirAbs, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name.toLowerCase())) continue;
        await walk(abs, depth - 1);
        continue;
      }
      if (path.extname(e.name).toLowerCase() !== '.json') continue;
      out.push(abs);
    }
  };
  let projects = [];
  try { projects = await readdir(path.join(root, 'projects'), { withFileTypes: true }); } catch { return out; }
  for (const p of projects) {
    if (!p.isDirectory() || p.name.startsWith('.') || SKIP_DIRS.has(p.name.toLowerCase())) continue;
    await walk(path.join(root, 'projects', p.name, 'figures'), 4);
  }
  return out;
}

/**
 * 扫描图件登记，把指向旧路径的 `file` / `files` / `sourceData` 改成新路径。
 * 每个被改写的 JSON 先留同名 `.bak`；返回 `[{ path, backup, fields }]`。
 */
async function rewriteReferences(root, pairs) {
  const mapPath = makeRefMapper(pairs);
  const updated = [];
  for (const abs of await figureSidecars(root)) {
    let raw;
    try { raw = await readFile(abs, 'utf8'); } catch { continue; }
    const obj = parseJson(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
    const fields = [];
    if (typeof obj.file === 'string') {
      const next = mapPath(obj.file);
      if (next !== obj.file) { obj.file = next; fields.push('file'); }
    }
    if (Array.isArray(obj.files)) {
      let hit = false;
      obj.files = obj.files.map((v) => {
        const next = mapPath(v);
        if (next !== v) hit = true;
        return next;
      });
      if (hit) fields.push('files');
    }
    if (Array.isArray(obj.sourceData)) {
      let hit = false;
      obj.sourceData = obj.sourceData.map((v) => {
        const next = mapPath(v);
        if (next !== v) hit = true;
        return next;
      });
      if (hit) fields.push('sourceData');
    }
    if (fields.length === 0) continue;
    const bakAbs = `${abs}.bak`;                 // 先备份再写：一份回滚点
    await copyFile(abs, bakAbs);
    const eol = raw.endsWith('\n') ? '\n' : '';
    await writeFile(abs, JSON.stringify(obj, null, 1) + eol, 'utf8');
    updated.push({ path: toRel(root, abs), backup: toRel(root, bakAbs), fields });
  }
  return updated;
}

/**
 * 执行改名（两阶段：先把源挪到临时名，再落到目标名）。
 * 两阶段是为了兼容「只改大小写」（Windows 上目标名与源名在文件系统里是同一个）
 * 以及「图件组里 A→B、B→A」这类目标暂时被本批源占用的情况。
 */
async function movePairs(pairs) {
  const pending = pairs.filter((p) => p.fromAbs !== p.toAbs);
  if (pending.length === 0) return;
  const sources = new Set(pending.map((p) => pathKey(p.fromAbs)));
  let needTemp = false;
  for (const p of pending) {
    if (await existsSafe(p.toAbs)) {
      if (!sources.has(pathKey(p.toAbs))) throw conflict(`目标已存在：${p.to}`);
      needTemp = true;
    }
  }
  if (!needTemp) {
    for (const p of pending) await rename(p.fromAbs, p.toAbs);
    return;
  }
  const staged = [];
  for (const p of pending) {
    const tmpAbs = path.join(path.dirname(p.fromAbs), `.rename-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    await rename(p.fromAbs, tmpAbs);
    staged.push({ tmpAbs, toAbs: p.toAbs });
  }
  for (const s of staged) await rename(s.tmpAbs, s.toAbs);
}

/**
 * 库内重命名：同一目录内的文件改名；图件侧车带着同基名的兄弟文件一起走，
 * 并把图件登记里指向旧路径的引用改成新路径。
 * @param {string} root 库根（绝对路径）
 * @param {{from:string,to:string}} input 两个库根相对路径
 */
export async function renameEntry(root, input = {}) {
  const fromRaw = typeof input.from === 'string' ? input.from.trim() : '';
  const toRaw = typeof input.to === 'string' ? input.to.trim() : '';
  if (!fromRaw) throw badRequest('rename 需要 from（要改名的文件，库根相对路径）');
  if (!toRaw) throw badRequest('rename 需要 to（改名后的路径，库根相对路径）');

  const fromAbs = resolveInside(root, fromRaw);
  const toAbs = resolveInside(root, toRaw);
  const fromRel = toRel(root, fromAbs);
  if (fromAbs === toAbs) throw badRequest(`新旧路径相同：${fromRel}`);

  const info = await statSafe(fromAbs);
  if (!info) throw notFound(`文件不存在：${fromRel}`);
  if (info.isDirectory()) throw denied(`不能重命名目录：${fromRel}（这条动作只改文件）`);
  if (!info.isFile()) throw badRequest(`不是普通文件：${fromRel}`);

  if (!samePath(path.dirname(fromAbs), path.dirname(toAbs))) {
    throw denied(`只允许在同一个目录里改名：${fromRel} → ${toRel(root, toAbs)}`);
  }

  // 图件侧车：同目录同基名的全组一起改，并把 file/files 改写成新路径。
  let kind = 'file';
  let oldBase = null;
  let newBase = null;
  if (path.extname(fromAbs).toLowerCase() === '.json') {
    let raw = null;
    try { raw = await readFile(fromAbs, 'utf8'); } catch { raw = null; }
    if (raw !== null && isFigureSidecar(parseJson(raw))) kind = 'figure';
  }

  const pairs = [];
  if (kind === 'figure') {
    const toExt = path.extname(toAbs);
    if (toExt && toExt.toLowerCase() !== '.json') {
      throw badRequest(`图件改名要保留 .json 扩展名：${toRel(root, toAbs)}`);
    }
    const jsonName = toExt ? path.basename(toAbs) : `${path.basename(toAbs)}.json`;
    oldBase = path.basename(fromAbs, path.extname(fromAbs));
    newBase = jsonName.slice(0, -'.json'.length);
    checkNewName(jsonName);

    const dir = path.dirname(fromAbs);
    const members = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()
      && path.basename(e.name, path.extname(e.name)) === oldBase);
    if (members.length === 0) throw notFound(`文件不存在：${fromRel}`); // 理论上不可能，防御一下
    const targets = new Map();
    for (const e of members.sort((a, b) => a.name.localeCompare(b.name))) {
      const ext = path.extname(e.name);
      const targetName = ext.toLowerCase() === '.json' ? jsonName : `${newBase}${ext}`;
      const key = pathKey(targetName);
      if (targets.has(key)) throw conflict(`新名字会撞在一起：${targetName}`);
      targets.set(key, true);
      pairs.push({
        fromAbs: path.join(dir, e.name),
        toAbs: path.join(dir, targetName),
        from: toRel(root, path.join(dir, e.name)),
        to: toRel(root, path.join(dir, targetName)),
      });
    }
  } else {
    const name = path.basename(toAbs);
    checkNewName(name);
    pairs.push({ fromAbs, toAbs, from: fromRel, to: toRel(root, toAbs) });
  }

  const moved = pairs.filter((p) => p.fromAbs !== p.toAbs).map((p) => ({ from: p.from, to: p.to }));
  if (moved.length === 0) throw badRequest(`没有文件需要改名：${fromRel}`);

  await movePairs(pairs);

  // 引用跟着改：图件登记（含刚改名的侧车自己）里的旧路径换成新路径。
  const updated = await rewriteReferences(root, pairs);

  const jsonPair = kind === 'figure' ? pairs.find((p) => p.fromAbs === fromAbs) : null;
  return {
    from: fromRel,
    to: jsonPair ? jsonPair.to : toRel(root, toAbs),
    kind,
    moved,
    updated,
  };
}

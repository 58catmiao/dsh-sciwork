/**
 * 科研模式 0.3 · 可复现性与一致性审计（只读）
 * ---------------------------------------------------------------------------
 * 面板「可复现」页的服务端一半：一次把「图/表和源数据对不上」的地方找出来，
 * 顺带提醒侧车缺参数、数据没人用、期刊档案缺字段、草稿引用的文献键不存在。
 *
 * 这是一条**纯读**路径：不写文件、不建索引、不动 `.research` 里的任何东西。
 * 面板刷新就能调，所以这里也不留回执（dispatcher 只给写动作记回执）。
 *
 * 七类问题（`code` 是面板与自测的契约，全部小写短横线）：
 *   figure-no-params       warn   侧车没登记出图参数（params 为空对象）
 *   figure-no-source       warn   侧车没登记源数据（sourceData 为空）
 *   figure-source-missing  err    侧车登记的源数据在库里找不到
 *   figure-file-missing    err    侧车没有同基名的图文件
 *   dataset-unused         warn   数据文件没被任何侧车引用（每个课题最多列 20 条）
 *   journal-field-null     warn   期刊档案关键字段为 null（**整库审计**才查）
 *   draft-cite-missing     warn   草稿引用的文献键在 refs/refs.json 里找不到
 *
 * 口径与面板/写动作保持一致（照抄 `lib/library.js` 与面板血缘逻辑）：
 *   - 「源数据存在」：先把整串按库根相对路径查（文件**或**目录都算）；再在同目录找
 *     同基名、任一扩展名的文件。真实库的侧车常登记成不带扩展名的 `data/ZT-1100-2h`
 *     （它是目录），也可能登记成 `data/ZT-1100` 而文件是 `ZT-1100.txt` —— 两种都算存在。
 *   - 「数据被引用」：整串 / 去掉扩展名 / 目录前缀三种比法（与面板 Lineage 一致）。
 *   - 同一路径的同类问题只报一次：一份侧车缺 3 条源数据时只出一条 issue，文本里列全。
 */

import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';

import { extractCiteKeys, toRel } from './library.js';
import { notFound } from './host/errors.js';

/* ------------------------------------------------------------ 常量与基础工具 */

/** 与 `lib/library.js` 同一份内部目录口径：这些目录里的登记不算本次交付。 */
const INTERNAL_DIRS = new Set([
  '_history', '_archive', '_templates', '_fetched', '_trash', '_tmp', '_drill', '_e2e', '_scratch', '_backup',
]);
const isInternalName = (n) => n.startsWith('.') || INTERNAL_DIRS.has(n.toLowerCase());

/** 递归扫描深度与面板一致（数据/草稿/图表都允许按子文件夹归类）。 */
const MAX_SCAN_DEPTH = 4;

/** 一次审计最多回给面板的 issues 条数（`counts` 里仍是全量）。 */
const MAX_ISSUES = 200;

/** `dataset-unused` 每个课题最多列这么多条（`datasets.unused` 里仍是全量）。 */
const MAX_UNUSED_PER_PROJECT = 20;

/** 侧车「同基名的图文件」认这些扩展名（至少一个存在才算交付完整）。 */
const FIGURE_EXT = new Set(['.png', '.pdf', '.svg', '.tif', '.tiff', '.eps']);

/** 数据目录里算「数据文件」的扩展名，照抄 `lib/library.js` 的 DATA_EXT。 */
const DATA_EXT = new Set(['.csv', '.tsv', '.txt', '.xlsx', '.xls', '.dat', '.json', '.jdx', '.dx']);

/** 草稿扩展名（引用键只从这三类文本里抽）。 */
const DRAFT_EXT = new Set(['.md', '.markdown', '.txt']);

/**
 * 期刊档案的关键字段：缺了会直接影响「按这家刊出图/写作」的可靠性。
 * 只查这些，不把 `lineWidthPt` 之类「官网没规定、天然为 null」的字段算成缺失。
 * （真实库的 nature.json 自己就记着：null = 未规定，而非未知。）
 */
const JOURNAL_KEY_FIELDS = [
  ['figure.singleColumnMm', '单栏图宽'],
  ['figure.maxHeightMm', '图最大高度'],
  ['figure.minFontPt', '图内最小字号'],
  ['figure.rasterDpi.photo', '照片类最低分辨率'],
  ['text.abstractMaxWords', '摘要字数上限'],
];

const isFile = async (p) => {
  try { return (await stat(p)).isFile(); } catch { return false; }
};
const isDir = async (p) => {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
};

/** 读 JSON；文件不存在或解析失败都给 null（审计不该被一份坏登记带崩）。 */
const readJsonSafe = async (p) => {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; }
};

/** readdir 的容错版：目录不存在 / 没权限都当空（缺目录就是「没有」）。 */
async function readdirSafe(dir) {
  try { return await readdir(dir, { withFileTypes: true }); } catch { return []; }
}

/** 列目录：跳过 `.` 开头的隐藏项与内部 `_` 目录，口径同 `lib/library.js` 的 listDir。 */
async function listDir(dir, { dirs = true, files = true } = {}) {
  const items = await readdirSafe(dir);
  return items.filter((e) => (e.isDirectory()
    ? dirs && !isInternalName(e.name)
    : files && !e.name.startsWith('.')));
}

/** 递归列文件（绝对路径），口径同 `lib/library.js` 的 walkFiles。 */
async function walkFiles(dirAbs, { depth = MAX_SCAN_DEPTH, exts = null } = {}) {
  const out = [];
  const walk = async (d, left) => {
    for (const e of await listDir(d)) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) {
        if (left <= 0) continue;
        await walk(abs, left - 1);
        continue;
      }
      if (exts && !exts.has(path.extname(e.name).toLowerCase())) continue;
      out.push(abs);
    }
  };
  await walk(dirAbs, depth);
  return out;
}

/** 库根相对路径的解算；越界 / 绝对路径一律给 null（审计不抛路径异常）。 */
function absOf(root, rel) {
  if (typeof rel !== 'string' || !rel.trim()) return null;
  const raw = rel.replace(/\\/g, '/').trim();
  if (/^[a-zA-Z]:/.test(raw) || raw.startsWith('/')) return null;
  const abs = path.resolve(root, raw);
  const back = path.relative(root, abs);
  if (back === '' || back.startsWith('..') || path.isAbsolute(back)) return null;
  return abs;
}

/** 输出用：统一 POSIX 分隔符（面板和测试都按 `/` 比）。 */
const normRel = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');

const stripExt = (p) => normRel(p).replace(/\.[^./]+$/, '');

/* ------------------------------------------------------------ 源数据 / 图文件 */

/**
 * 一条 `sourceData` 在库里到底有没有：整串（文件或目录）→ 同目录同基名补扩展名。
 * @returns {{ok:boolean, kind?:'file'|'dir', completed?:boolean}}
 */
async function resolveSource(root, entry) {
  const abs = absOf(root, entry);
  if (!abs) return { ok: false };
  if (await isFile(abs)) return { ok: true, kind: 'file' };
  if (await isDir(abs)) return { ok: true, kind: 'dir' };

  // 补全扩展名：真实库登记的是 `data/ZT-1100-2h`（或 `data/ZT-1100`），实际文件带 .txt/.csv。
  // 只认「同目录、同基名」，不做模糊匹配，免得把别的数据算成这份图的源。
  const dir = path.dirname(abs);
  const stem = path.basename(abs, path.extname(abs)).toLowerCase();
  if (!stem) return { ok: false };
  for (const e of await readdirSafe(dir)) {
    if (!e.isFile() || e.name.startsWith('.')) continue;
    const nameStem = path.basename(e.name, path.extname(e.name)).toLowerCase();
    if (nameStem !== stem) continue;
    return { ok: true, kind: 'file', completed: true };
  }
  return { ok: false };
}

/**
 * 侧车对应的图文件在不在：同目录同基名 + 图件扩展名，或侧车 `file` 字段直接指得到的文件。
 * （`files[]` 只算附带件，不能拿来证明主件存在，所以这里不看它。）
 */
async function figureFileExists(root, sidecarAbs, sidecar) {
  const dir = path.dirname(sidecarAbs);
  const stem = path.basename(sidecarAbs, path.extname(sidecarAbs)).toLowerCase();
  for (const e of await readdirSafe(dir)) {
    if (!e.isFile() || e.name.startsWith('.')) continue;
    if (!FIGURE_EXT.has(path.extname(e.name).toLowerCase())) continue;
    if (path.basename(e.name, path.extname(e.name)).toLowerCase() === stem) return true;
  }
  const declared = sidecar && typeof sidecar.file === 'string' ? absOf(root, sidecar.file) : null;
  if (declared && await isFile(declared)) return true;
  return false;
}

/* ---------------------------------------------------------------- 单项审计 */

const issue = (level, code, issuePath, text) => ({ level, code, path: issuePath, text });

/** 一份侧车 → 图相关的四条检查 + 它登记的源数据（给 dataset-unused 用）。 */
async function auditFigure(root, sidecarAbs) {
  const sidecar = await readJsonSafe(sidecarAbs);
  if (!sidecar || typeof sidecar !== 'object' || Array.isArray(sidecar)) return null;

  const rel = toRel(root, sidecarAbs);
  const base = path.basename(sidecarAbs);
  const figId = String(sidecar.figureId || path.basename(sidecarAbs, '.json'));
  const label = `图 ${figId}（${base}）`;
  const issues = [];

  const params = sidecar.params;
  const noParams = !params || typeof params !== 'object' || Array.isArray(params)
    || Object.keys(params).length === 0;
  if (noParams) {
    issues.push(issue('warn', 'figure-no-params', rel,
      `${label}：侧车没登记出图参数（params 为空），换台机器重画容易出偏`));
  }

  const rawSources = Array.isArray(sidecar.sourceData) ? sidecar.sourceData : [];
  const sources = rawSources.map((x) => String(x)).filter((x) => x.trim() !== '');
  if (sources.length === 0) {
    issues.push(issue('warn', 'figure-no-source', rel,
      `${label}：侧车没登记源数据（sourceData 为空），这张图无法回溯到数据`));
  }

  const missing = [];
  for (const src of sources) {
    const found = await resolveSource(root, src);
    if (!found.ok) missing.push(src);
  }
  if (missing.length) {
    const shown = missing.slice(0, 3).join('、');
    const more = missing.length > 3 ? ` 等 ${missing.length} 条` : '';
    issues.push(issue('err', 'figure-source-missing', rel,
      `${label}：登记的源数据在库里找不到：${shown}${more}`));
  }

  const fileOk = await figureFileExists(root, sidecarAbs, sidecar);
  if (!fileOk) {
    issues.push(issue('err', 'figure-file-missing', rel,
      `${label}：没找到同基名的图文件（.png/.pdf/.svg/.tif/.eps 一个都没有）`));
  }

  return {
    issues,
    noParams,
    noSource: sources.length === 0,
    missingSource: missing.length > 0,
    missingFile: !fileOk,
    sources,
  };
}

/** 数据文件没被任何侧车引用：三种比法照抄面板血缘。 */
function unusedDatasets(datasetRels, usedEntries) {
  const used = [];
  const usedNoExt = new Set();
  for (const raw of usedEntries) {
    const u = normRel(raw);
    if (!u) continue;
    used.push(u);
    usedNoExt.add(stripExt(u));
  }
  return datasetRels.filter((rel) => {
    const p = normRel(rel);
    if (used.includes(p)) return false;
    if (usedNoExt.has(stripExt(p))) return false;
    return !used.some((u) => p.startsWith(u + '/'));
  });
}

/** 草稿里的引用键 → 在 refs.json 里找不到的那些。 */
async function auditDrafts(root, draftFiles, knownRefs) {
  const cited = new Set();
  const missing = new Set();
  const issues = [];
  for (const abs of draftFiles) {
    const rel = toRel(root, abs);
    let text = '';
    try { text = await readFile(abs, 'utf8'); } catch { continue; }
    const keys = extractCiteKeys(text);
    if (!keys.length) continue;
    for (const k of keys) cited.add(k);
    if (!knownRefs) continue; // refs.json 读不了：只统计，不瞎报缺失
    const gone = keys.filter((k) => !knownRefs.has(k));
    if (!gone.length) continue;
    for (const k of gone) missing.add(k);
    const shown = gone.slice(0, 5).map((k) => `@${k}`).join('、');
    const more = gone.length > 5 ? ` 等 ${gone.length} 个` : '';
    issues.push(issue('warn', 'draft-cite-missing', rel,
      `草稿 ${path.basename(abs)} 引用的文献键没登记：${shown}${more}`));
  }
  return { cited, missing, issues };
}

/* ---------------------------------------------------------------- 课题审计 */

async function auditProject(root, slug, knownRefs) {
  const dir = path.join(root, 'projects', slug);
  const meta = (await readJsonSafe(path.join(dir, 'project.json'), {})) || {};
  const title = (meta && typeof meta.title === 'string' && meta.title) || slug;
  const issues = [];

  /* 图：figures/** 里的侧车，逐份查参数、源数据、图文件 */
  const sidecars = await walkFiles(path.join(dir, 'figures'), { exts: new Set(['.json']) });
  const figCounts = { total: 0, noParams: 0, noSource: 0, missingSource: 0, missingFile: 0 };
  const usedEntries = [];
  for (const abs of sidecars) {
    const result = await auditFigure(root, abs);
    if (!result) continue;
    figCounts.total += 1;
    if (result.noParams) figCounts.noParams += 1;
    if (result.noSource) figCounts.noSource += 1;
    if (result.missingSource) figCounts.missingSource += 1;
    if (result.missingFile) figCounts.missingFile += 1;
    usedEntries.push(...result.sources);
    issues.push(...result.issues);
  }

  /* 数据：data/** 下的数据文件，有没有被上面任何一份侧车引用 */
  const dataFiles = await walkFiles(path.join(dir, 'data'), { exts: DATA_EXT });
  const dataRels = dataFiles.map((abs) => toRel(root, abs));
  const unused = unusedDatasets(dataRels, usedEntries);
  for (const rel of unused.slice(0, MAX_UNUSED_PER_PROJECT)) {
    issues.push(issue('warn', 'dataset-unused', rel,
      `数据文件 ${path.posix.basename(rel)} 没有被任何图引用（侧车的 sourceData 里没出现）`));
  }

  /* 草稿：`[@键]` 形式的引用键在 refs.json 里有没有 */
  const draftFiles = await walkFiles(path.join(dir, 'drafts'), { exts: DRAFT_EXT });
  const drafts = await auditDrafts(root, draftFiles, knownRefs);
  issues.push(...drafts.issues);

  return {
    slug,
    title,
    figures: figCounts,
    datasets: { total: dataFiles.length, unused: unused.length },
    refs: knownRefs
      ? { total: drafts.cited.size, missing: drafts.missing.size }
      : { total: drafts.cited.size, missing: null },
    issues,
  };
}

/** 期刊档案：关键字段为 null / 缺失（整库才查；给单个课题时与刊无关）。 */
async function auditJournals(root) {
  const issues = [];
  const dir = path.join(root, 'journals');
  for (const e of await listDir(dir, { dirs: false })) {
    if (!e.name.toLowerCase().endsWith('.json') || e.name.startsWith('_')) continue;
    const abs = path.join(dir, e.name);
    const j = await readJsonSafe(abs);
    if (!j || typeof j !== 'object' || Array.isArray(j)) continue;
    const missing = JOURNAL_KEY_FIELDS.filter(([key]) => {
      const v = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), j);
      return v === null || v === undefined;
    });
    if (!missing.length) continue;
    const name = j.nameZh || j.name || j.id || path.basename(e.name, '.json');
    issues.push(issue('warn', 'journal-field-null', toRel(root, abs),
      `期刊档案《${name}》缺关键字段：${missing.map(([, label]) => label).join('、')}`));
  }
  return issues;
}

/* ---------------------------------------------------------------- 对外入口 */

/**
 * 审计一个科研库（只读）。
 * @param {string} rootOverride 库根绝对路径
 * @param {{project?: string|null}} [opts] 给了 project 就只审那个课题
 * @returns {Promise<object>} 面板要的形状，字段见下方 return
 */
export async function auditLibrary(rootOverride, { project = null } = {}) {
  const root = path.resolve(String(rootOverride || ''));
  if (!(await isDir(root))) throw notFound(`科研库根目录不存在：${root}`);

  const scopeProject = project ? String(project).trim() : null;
  if (scopeProject) {
    const safeSlug = /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(scopeProject);
    if (!safeSlug || !(await isDir(path.join(root, 'projects', scopeProject)))) {
      throw notFound(`课题不存在：${scopeProject}`);
    }
  }

  // refs.json：不存在或坏掉就给 null（引用缺失算不了，不瞎报）
  let knownRefs = null;
  const refsAbs = path.join(root, 'refs', 'refs.json');
  if (await isFile(refsAbs)) {
    const refsFile = await readJsonSafe(refsAbs);
    if (refsFile && typeof refsFile === 'object' && refsFile.refs
      && typeof refsFile.refs === 'object' && !Array.isArray(refsFile.refs)) {
      knownRefs = new Set(Object.keys(refsFile.refs));
    }
  }

  const projectDirs = (await listDir(path.join(root, 'projects'), { files: false }))
    .map((e) => e.name)
    .filter((name) => !scopeProject || name === scopeProject)
    .sort((a, b) => a.localeCompare(b));

  const journalIssues = scopeProject ? [] : await auditJournals(root);

  const projects = [];
  for (const slug of projectDirs) {
    projects.push(await auditProject(root, slug, knownRefs));
  }

  const counts = {
    err: journalIssues.filter((i) => i.level === 'err').length,
    warn: journalIssues.filter((i) => i.level === 'warn').length,
    projects: projects.length,
    figures: projects.reduce((n, p) => n + p.figures.total, 0),
    datasets: projects.reduce((n, p) => n + p.datasets.total, 0),
  };
  for (const p of projects) {
    for (const i of p.issues) {
      if (i.level === 'err') counts.err += 1;
      else counts.warn += 1;
    }
  }

  const all = [...journalIssues];
  for (const p of projects) all.push(...p.issues);

  return {
    root,
    scope: { project: scopeProject },
    counts,
    projects,
    issues: all.slice(0, MAX_ISSUES),
  };
}

/**
 * 科研模式 0.3 · 课题模型（project.json + 七阶段机 + 双读）
 * ---------------------------------------------------------------------------
 * 读取顺序（PLAN §11.3）：
 *   1. `projects/<slug>/project.json` 是 0.3 形状（schemaVersion=1 且带 stages）→ 直接用；
 *   2. 有旧形状的 project.json（research.py new-project 写的 schema=1）→ 保留标题/期刊等字段，
 *      阶段与产物从目录**合成**，只读；
 *   3. 没有 project.json → 完全从目录合成（`legacy:true`），写动作要 `needs-migration`。
 *
 * 纪律：project.json 只由动作写（`NEVER_EDIT`）；本文件不做任何写盘之外的副作用，
 * 也不碰 `.research/` 以外的东西。真库迁移只允许发生在副本上（PLAN §11.4）。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { resolveInside, toRel } from './library.js';
import { badRequest, conflict, needsMigration, notFound } from './host/errors.js';

/** 七个阶段，顺序固定（PLAN §6.1）。 */
export const STAGES = Object.freeze(['topic', 'design', 'data', 'analysis', 'figure', 'draft', 'submission']);
/** 阶段状态：同一时刻只有一个 active。 */
export const STAGE_STATUS = Object.freeze(['pending', 'active', 'done', 'skipped']);

export const SCHEMA_VERSION = 1;
export const PROJECT_FILE = 'project.json';
export const MIGRATION_FILE = '.research/migration.json';

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** 旧库里各类产物的目录 → 产物 kind。 */
const ARTIFACT_DIRS = Object.freeze([
  ['data', 'data'],
  ['tables', 'table'],
  ['figures', 'figure'],
  ['drafts', 'draft'],
  ['notes', 'note'],
  ['origin', 'origin'],
]);

export const isStage = (s) => STAGES.includes(String(s || ''));
export const stageIndex = (s) => STAGES.indexOf(String(s || ''));
const nowIso = () => new Date().toISOString();

export function assertSlug(slug) {
  const s = String(slug || '').trim();
  if (!s) throw badRequest('缺 project（课题 slug）', { field: 'project' });
  if (!SLUG_RE.test(s) || s.includes('..')) throw badRequest(`课题名不合法：${s}（字母数字与 - _ .，64 字符内）`, { field: 'project' });
  return s;
}

export const projectDirRel = (slug) => `projects/${assertSlug(slug)}`;
export const projectFileRel = (slug) => `${projectDirRel(slug)}/${PROJECT_FILE}`;

/** 文件 sha256（读不到返回 null，不抛）。 */
export function sha256File(abs) {
  try {
    const h = crypto.createHash('sha256');
    h.update(fs.readFileSync(abs));
    return h.digest('hex');
  } catch {
    return null;
  }
}

/** 库内相对路径的 sha256。 */
export function sha256Of(root, rel) {
  try {
    return sha256File(resolveInside(root, rel));
  } catch {
    return null;
  }
}

function listDir(abs) {
  try {
    return fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
}

function walkFiles(absDir, base, out = []) {
  for (const entry of listDir(absDir)) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) walkFiles(abs, base, out);
    else if (entry.isFile()) out.push(abs);
    if (out.length > 5000) return out;
  }
  return out;
}

/** 从磁盘合成产物清单（旧库专用；0.3 的 project.json 里已有 artifacts 时以它为准）。 */
export function deriveArtifacts(root, slug) {
  const dirRel = projectDirRel(slug);
  const dirAbs = path.join(root, dirRel);
  const artifacts = [];
  let seq = 0;
  for (const [sub, kind] of ARTIFACT_DIRS) {
    for (const abs of walkFiles(path.join(dirAbs, sub), path.join(dirAbs, sub))) {
      const rel = toRel(root, abs);
      const stat = fs.statSync(abs);
      seq += 1;
      artifacts.push({
        id: `a_${String(seq).padStart(3, '0')}`,
        kind,
        path: rel,
        bytes: stat.size,
        sha256: sha256File(abs),
        createdAt: stat.mtime.toISOString(),
        producedBy: 'legacy',
      });
    }
  }
  return artifacts.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function deriveStage(artifacts) {
  const has = (kind) => artifacts.some((a) => a.kind === kind);
  if (has('draft')) return 'draft';
  if (has('figure')) return 'figure';
  if (has('table')) return 'analysis';
  if (has('data')) return 'data';
  return 'design';
}

/** 七个阶段的骨架（当前阶段 active，之前的 done）。 */
function stageSkeleton(activeStage, at) {
  const active = stageIndex(activeStage);
  const stages = {};
  STAGES.forEach((s, i) => {
    stages[s] = { status: i < active ? 'done' : i === active ? 'active' : 'pending' };
    if (i <= active) stages[s].updatedAt = at;
    stages[s].checks = [];
  });
  return stages;
}

/** 读 project.json 原文（不归一）。 */
export function readProjectFile(root, slug) {
  const rel = projectFileRel(slug);
  const abs = path.join(root, rel);
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw badRequest(`project.json 不是合法 JSON：${rel}（${String(error.message || error)}）`);
  }
  return { raw, rel, abs, bytes: Buffer.byteLength(text, 'utf8'), hash: crypto.createHash('sha256').update(text).digest('hex') };
}

/** 0.3 形状？ */
export const isV1Project = (raw) => Boolean(raw) && raw.schemaVersion === SCHEMA_VERSION && !!raw.stages && typeof raw.stages === 'object';

/**
 * 归一成 0.3 形状（不写盘）。
 * @returns {{project:object, source:'project.json'|'derived', legacy:boolean, needsSchemaUpgrade:boolean}}
 */
export function normalizeProject(root, slug, raw, fileInfo) {
  const dirRel = projectDirRel(slug);
  const artifacts = deriveArtifacts(root, slug);

  if (isV1Project(raw)) {
    const project = { ...raw, id: raw.id || slug, artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : artifacts };
    project.history = Array.isArray(project.history) ? project.history : [];
    const skeleton = stageSkeleton(deriveStage(artifacts));
    project.stages = {};
    for (const st of STAGES) project.stages[st] = { ...skeleton[st], ...(raw.stages[st] || {}) };
    project.legacyShape = false;
    return { project, source: 'project.json', legacy: false, needsSchemaUpgrade: false };
  }

  const at = (raw && (raw.createdAt || raw.updatedAt)) || nowIso();
  const stage = deriveStage(artifacts);
  const project = {
    schemaVersion: SCHEMA_VERSION,
    id: slug,
    title: (raw && raw.title) || slug,
    course: (raw && raw.course) || '',
    journal: (raw && raw.journal) || null,
    keywords: Array.isArray(raw && raw.keywords) ? raw.keywords : [],
    notes: (raw && raw.notes) || '',
    createdAt: at,
    updatedAt: (raw && raw.updatedAt) || at,
    stage,
    stages: stageSkeleton(stage, at),
    artifacts,
    history: [],
    ...(fileInfo && fileInfo.rel ? { migratedFrom: fileInfo.rel } : {}),
    legacyShape: true,
  };
  return { project, source: raw ? 'project.json' : 'derived', legacy: !raw, needsSchemaUpgrade: Boolean(raw) };
}

/** 读一个课题（双读 + 内存升级）。 */
export function readProject(root, slug) {
  const info = readProjectFile(root, slug);
  if (!info && !fs.existsSync(path.join(root, projectDirRel(slug)))) {
    throw notFound(`没有这个课题：${slug}`);
  }
  return normalizeProject(root, slug, info ? info.raw : null, info);
}

/** 列全部课题（目录即课题；读不出来的记错误但不整体失败）。 */
export function listProjects(root) {
  const projectsDir = path.join(root, 'projects');
  const out = [];
  for (const entry of listDir(projectsDir)) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    if (!SLUG_RE.test(slug)) continue;
    try {
      const read = readProject(root, slug);
      out.push({ slug, title: read.project.title, stage: read.project.stage, source: read.source, legacy: read.legacy, needsSchemaUpgrade: read.needsSchemaUpgrade });
    } catch (error) {
      out.push({ slug, error: String((error && error.message) || error) });
    }
  }
  return out.sort((a, b) => (a.slug < b.slug ? -1 : 1));
}

/** 原子写 project.json（tmp + rename）。只给动作层调用。 */
export function writeProject(root, slug, project) {
  const rel = projectFileRel(slug);
  const abs = path.join(root, rel);
  const tmp = `${abs}.tmp-${process.pid}`;
  const body = `${JSON.stringify({ ...project, schemaVersion: SCHEMA_VERSION }, null, 1)}\n`;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, abs);
  return { rel, bytes: Buffer.byteLength(body, 'utf8'), hash: crypto.createHash('sha256').update(body).digest('hex') };
}

/** 阶段机：前进一步/退回一步；跳阶段必须 force。 */
export function setStage(project, target, { force = false, at = nowIso() } = {}) {
  if (!isStage(target)) throw badRequest(`没有这个阶段：${target}（可用：${STAGES.join(' → ')}）`);
  const from = project.stage;
  const delta = stageIndex(target) - stageIndex(from);
  const warnings = [];
  if (delta === 0) return { project, from, to: target, warnings };
  if (Math.abs(delta) > 1 && !force) {
    throw badRequest(`阶段只能前进一步或退回一步：${from} → ${target}（要跳阶段需 force=true）`);
  }
  if (Math.abs(delta) > 1 && force) warnings.push(`跳阶段：${from} → ${target}（force=true）`);
  const next = { ...project, stages: {} };
  for (const s of STAGES) next.stages[s] = { ...(project.stages[s] || { status: 'pending', checks: [] }) };
  if (delta > 0) {
    for (let i = stageIndex(from); i < stageIndex(target); i += 1) {
      next.stages[STAGES[i]] = { ...next.stages[STAGES[i]], status: 'done', updatedAt: at };
    }
  } else {
    for (let i = stageIndex(target) + 1; i <= stageIndex(from); i += 1) {
      next.stages[STAGES[i]] = { ...next.stages[STAGES[i]], status: 'pending' };
    }
  }
  next.stages[target] = { ...next.stages[target], status: 'active', updatedAt: at };
  next.stage = target;
  next.updatedAt = at;
  return { project: next, from, to: target, warnings };
}

/* --------------------------------------------------------------- 检查项 / 下一步 */

const check = (id, label, status, hint) => ({ id, label, status, ...(hint ? { hint } : {}) });

/** 每个阶段的检查项（PLAN §6.2）。证据只来自磁盘与 project.json，不猜。 */
export function computeChecks(project, root) {
  const slug = project.id;
  const arts = project.artifacts || [];
  const has = (kind) => arts.some((a) => a.kind === kind);
  const missingFiles = arts.filter((a) => a.path && !fs.existsSync(path.join(root, a.path)));
  const checks = {
    topic: [check('topic.title', '课题有标题', project.title && project.title !== slug ? 'pass' : 'fail', '给课题起一个能看懂的名字')],
    design: [check('design.plan', '研究设计已记录', (project.notes || '').trim().length > 0 ? 'pass' : 'fail', '写一段研究设计（写在 notes 或 notes/ 下）')],
    data: [check('data.artifacts', '至少一个数据产物', has('data') ? 'pass' : 'fail', '导入数据（data.import）')],
    analysis: [
      check('analysis.derived', '至少一个派生表/分析结果', has('table') || has('origin') ? 'pass' : 'fail', '做一次表格变换（data.transform）'),
      check('analysis.provenance', '派生结果带溯源', has('table') ? 'pass' : 'fail', '派生表写 projects/<课题>/tables/ 并带 .research/transforms 溯源'),
    ],
    figure: [
      check('figure.artifacts', '至少一张图', has('figure') ? 'pass' : 'fail', '登记或画一张图'),
      check('figure.sidecar', '图带溯源侧车', arts.some((a) => a.kind === 'figure' && /\.(png|svg|pdf|tif|tiff|eps)$/i.test(a.path) && fs.existsSync(path.join(root, a.path.replace(/\.[^.]+$/, '.json')))) ? 'pass' : 'fail', '侧车 JSON 记数据来源与作图参数'),
    ],
    draft: [check('draft.exists', '至少一份稿子', has('draft') ? 'pass' : 'fail', '新建草稿（draft.new）')],
    submission: [check('submission.record', '有投稿记录', submissionCount(root, slug) > 0 ? 'pass' : 'fail', '登记投稿（submission.add）')],
  };
  for (const stage of STAGES) {
    if (!Array.isArray(checks[stage])) checks[stage] = [];
    if (missingFiles.length) {
      checks[stage].push(check('artifacts.present', '登记的产物都在磁盘上', 'fail', `${missingFiles.length} 个登记产物找不到文件（先迁移/修复，别掩盖）`));
    }
  }
  return checks;
}

/** 投稿记录条数：库级 submissions/*.json 里 project 字段匹配。 */
export function submissionCount(root, slug) {
  const dir = path.join(root, 'submissions');
  let n = 0;
  for (const entry of listDir(dir)) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
      if (rec && (rec.project === slug || (Array.isArray(rec.projects) && rec.projects.includes(slug)))) n += 1;
    } catch { /* 坏记录不算数，但不影响其它 */ }
  }
  return n;
}

/** `workflow.next`：阶段 + 待办 + 阻塞 + 是否就绪（面板与 agent 共用这一个返回值）。 */
export function nextStep(project, root) {
  const stage = project.stage;
  const checks = computeChecks(project, root);
  const current = checks[stage] || [];
  const blockers = current.filter((c) => c.status === 'fail').map((c) => ({ check: c.id, why: c.label, hint: c.hint || '' }));
  const nextAction = {
    data: { action: 'data.import', why: '还没有数据产物' },
    analysis: { action: 'data.transform', why: '还没有派生表' },
    figure: { action: 'journal.check', why: '还没有图或图缺溯源（出图请让智能体走 origin-plot，再 register-figure 登记）' },
    draft: { action: 'draft.new', why: '还没有草稿' },
    submission: { action: 'submission.add', why: '还没有投稿记录' },
  }[stage] || null;
  const todo = [];
  if (blocksWrite(project)) todo.push({ action: 'system.migrate', why: '旧库课题还没有 project.json（先迁移，再写）' });
  if (nextAction && blockers.length) todo.push(nextAction);
  return { stage, todo, blockers, ready: blockers.length === 0 };
}

/** 旧库（没有 0.3 project.json）允许读，写动作必须 needs-migration。 */
export const blocksWrite = (project) => !project || project.legacyShape === true || project.schemaVersion !== SCHEMA_VERSION;

export function assertWritable(project) {
  if (blocksWrite(project)) {
    throw needsMigration('这个课题还是旧库形状（没有 0.3 project.json）：先跑 system.migrate --plan 看清写什么，再 --apply', { project: project && project.id });
  }
}

export { conflict };

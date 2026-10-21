/**
 * 科研模式 0.3 · 动作域：课题（一等公民）
 * ---------------------------------------------------------------------------
 * 课题 = `projects/<slug>/` + `project.json`（schemaVersion=1）+ 七阶段机。
 * 读动作永远双读（有 project.json 用它，没有就从目录合成只读视图）；
 * 写动作只允许 0.3 形状的课题：旧形状先 `system.migrate`，不在这里偷偷补写。
 */

import { runSubcommand } from '../adapters/python.js';
import { readReceipts, summarizeReceipt } from '../host/receipts.js';
import { badRequest, cliFailed } from '../host/errors.js';
import { asString, reindexAfter, settingsNow } from '../host/engine.js';
import {
  assertWritable, blocksWrite, computeChecks, listProjects, nextStep, readProject,
  setStage, writeProject,
} from '../projects.js';

const projectParam = { type: 'string', minLength: 1, maxLength: 64 };

export const projectList = {
  id: 'project.list',
  title: '课题清单',
  domain: 'project',
  description: '题目录 + 阶段 + 是否需要迁移（面板首页/左栏）',
  params: { type: 'object', properties: {}, additionalProperties: false },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  idempotent: true,
  ui: { view: 'projects', primary: true },
  tool: { expose: true, name: 'sciwork_project_list' },
  run: async (ctx) => {
    const projects = listProjects(ctx.root).map((p) => {
      if (p.error) return p;
      const read = readProject(ctx.root, p.slug);
      return { ...p, checks: computeChecks(read.project, ctx.root)[read.project.stage] || [], next: nextStep(read.project, ctx.root) };
    });
    return { projects };
  },
};

export const projectGet = {
  id: 'project.get',
  title: '课题详情',
  domain: 'project',
  description: '课题的阶段条、当前检查项、下一步（一个课题的全部读面）',
  params: {
    type: 'object', required: ['project'], additionalProperties: false,
    properties: { project: projectParam, stage: { type: 'string' } },
  },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  idempotent: true,
  ui: { view: 'project' },
  tool: { expose: true, name: 'sciwork_project_get' },
  run: async (ctx, params) => {
    const read = readProject(ctx.root, asString(params.project));
    const checks = computeChecks(read.project, ctx.root);
    const stage = asString(params.stage) || read.project.stage;
    return {
      project: { ...read.project, checksFor: stage },
      source: read.source,
      legacy: read.legacy,
      needsMigration: blocksWrite(read.project),
      checks: checks[stage] || [],
      allChecks: checks,
      next: nextStep(read.project, ctx.root),
    };
  },
};

export const projectCreate = {
  id: 'project.create',
  title: '新建课题',
  domain: 'project',
  description: 'research.py new-project 建目录，再补 0.3 的 project.json（stage=topic）',
  params: {
    type: 'object', required: ['slug'], additionalProperties: false,
    properties: { slug: projectParam, title: { type: 'string', maxLength: 200 }, journal: { type: 'string', maxLength: 80 } },
  },
  effects: 'write',
  engine: 'python',
  confirm: 'write',
  ui: { view: 'projects' },
  tool: { expose: true, name: 'sciwork_project_create' },
  run: async (ctx, params) => {
    const settings = await settingsNow();
    const slug = asString(params.slug);
    const run = await runSubcommand(settings, 'project.create', {
      slug, title: asString(params.title), journal: asString(params.journal),
    }, { label: `新建课题 ${slug}`, timeoutMs: 60_000 });
    if (!run.raw) throw cliFailed(`new-project 没有返回 JSON：${String(run.stderr || '').slice(0, 1200)}`);
    if (run.raw.ok !== true) throw badRequest(String(run.raw.error || run.raw.message || run.summary || '新建课题失败'));
    const read = readProject(ctx.root, slug);
    const at = new Date().toISOString();
    const projected = {
      ...read.project,
      stage: 'topic',
      legacyShape: false,
      history: [...(read.project.history || []), { at, action: 'project.create', summary: `新建课题 ${slug}` }],
    };
    writeProject(ctx.root, slug, projected);
    return reindexAfter(settings, { slug, title: projected.title, stage: projected.stage, engine: { raw: run.raw, warnings: run.warnings } });
  },
};

export const projectStageSet = {
  id: 'project.stage.set',
  title: '推进/退回阶段',
  domain: 'project',
  description: '前进一步或退回一步；跳阶段必须 force=true（回执记 warning）',
  params: {
    type: 'object', required: ['project', 'stage'], additionalProperties: false,
    properties: {
      project: projectParam,
      stage: { type: 'string', enum: ['topic', 'design', 'data', 'analysis', 'figure', 'draft', 'submission'] },
      force: { type: 'boolean', default: false },
      note: { type: 'string', maxLength: 500 },
    },
  },
  effects: 'write',
  engine: 'node',
  confirm: 'write',
  ui: { view: 'project', primary: true },
  tool: { expose: true, name: 'sciwork_project_stage_set' },
  run: async (ctx, params) => {
    const read = readProject(ctx.root, asString(params.project));
    assertWritable(read.project);
    const at = new Date().toISOString();
    const moved = setStage(read.project, asString(params.stage), { force: params.force === true, at });
    const history = [...(moved.project.history || []), {
      at, action: 'project.stage.set', summary: `${moved.from} → ${moved.to}${params.note ? `：${params.note}` : ''}`,
    }];
    const next = { ...moved.project, history, legacyShape: false };
    writeProject(ctx.root, next.id, next);
    return {
      project: { id: next.id, stage: next.stage, stages: next.stages },
      from: moved.from, to: moved.to,
      warnings: moved.warnings || [],
    };
  },
};

export const workflowNext = {
  id: 'workflow.next',
  title: '下一步做什么',
  domain: 'workflow',
  description: '阶段 + 待办 + 阻塞 + 是否就绪（首页与 agent 共用这一个返回值）',
  params: {
    type: 'object', additionalProperties: false,
    properties: { project: projectParam },
  },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  idempotent: true,
  ui: { view: 'today', primary: true },
  tool: { expose: true, name: 'sciwork_workflow_next' },
  run: async (ctx, params) => {
    const slug = asString(params.project);
    if (slug) {
      const read = readProject(ctx.root, slug);
      return { project: slug, needsMigration: blocksWrite(read.project), ...nextStep(read.project, ctx.root) };
    }
    const rows = listProjects(ctx.root).map((p) => {
      if (p.error) return { project: p.slug, error: p.error, ready: false, todo: [], blockers: [] };
      const read = readProject(ctx.root, p.slug);
      return { project: p.slug, title: p.title, needsMigration: blocksWrite(read.project), ...nextStep(read.project, ctx.root) };
    });
    return { projects: rows, ready: rows.every((r) => r.ready) };
  },
};


/**
 * agent 上下文：一屏之内说清「在哪个课题、哪一步、刚发生了什么」。
 * 硬上限 4 KB（PLAN §10.4）：超了先砍回执摘要，再砍提示，绝不整库注入。
 */
export const workflowContext = {
  id: 'workflow.context',
  title: '课题上下文',
  domain: 'workflow',
  description: '当前课题 + 阶段 + 待办 + 最近 5 条回执（≤4 KB），给阶段预设当上下文',
  params: {
    type: 'object', additionalProperties: false,
    properties: { project: projectParam, limit: { type: 'integer', minimum: 1, maximum: 20 } },
  },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  idempotent: true,
  ui: { view: 'today' },
  tool: { expose: true, name: 'sciwork_workflow_context' },
  run: async (ctx, params) => {
    const slug = asString(params.project) || firstProject(ctx.root);
    if (!slug) return { project: null, hint: '库里还没有课题：先 project.create，或 system.init 建库' };
    const read = readProject(ctx.root, slug);
    const step = nextStep(read.project, ctx.root);
    const limit = Math.max(1, Math.min(20, Number(params.limit) || 5));
    const receipts = recentReceipts(ctx.root, limit).map(summarizeReceipt).filter(Boolean)
      .map((r) => ({ receiptId: r.receiptId, action: r.action, ok: r.ok, at: r.startedAt, summary: r.summary }));
    const value = {
      project: {
        id: slug,
        title: read.project.title || slug,
        stage: read.project.stage,
        needsMigration: blocksWrite(read.project),
        journal: read.project.journal || null,
      },
      next: { stage: step.stage, todo: step.todo.slice(0, 6), blockers: step.blockers.slice(0, 6), ready: step.ready },
      receipts,
      hint: '写动作两步走：先 action.plan 拿 planId+token，再 action.confirm；读动作直接调。',
    };
    return fitContext(value);
  },
};

const CONTEXT_LIMIT = 4096;

function firstProject(root) {
  const rows = listProjects(root);
  const ok = rows.find((p) => !p.error);
  return ok ? ok.slug : '';
}

/** 跨月也要能看到上个月最后几条：本月不足时回退一个月。 */
function recentReceipts(root, limit) {
  const now = new Date();
  let rows = readReceipts(root, { limit, now: now.getTime() });
  if (rows.length < limit) {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const month = `${prev.getFullYear()}${String(prev.getMonth() + 1).padStart(2, '0')}`;
    rows = [...readReceipts(root, { limit, month }), ...rows];
  }
  return rows.slice(-limit);
}

/** 超预算时按「回执 → 待办 → 阻塞」的顺序裁，保留结论字段。 */
function fitContext(value) {
  let out = value;
  for (let i = 0; i < 12 && JSON.stringify(out).length > CONTEXT_LIMIT; i += 1) {
    if (out.receipts.length > 0) out = { ...out, receipts: out.receipts.slice(0, -1) };
    else if (out.next.todo.length > 1) out = { ...out, next: { ...out.next, todo: out.next.todo.slice(0, -1) } };
    else if (out.next.blockers.length > 1) out = { ...out, next: { ...out.next, blockers: out.next.blockers.slice(0, -1) } };
    else break;
  }
  return out;
}

export const PROJECT_ACTIONS = [projectList, projectGet, projectCreate, projectStageSet, workflowNext, workflowContext];

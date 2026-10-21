/**
 * 科研模式 0.3 · 动作域：课题（一等公民）
 * ---------------------------------------------------------------------------
 * 课题 = `projects/<slug>/` + `project.json`（schemaVersion=1）+ 七阶段机。
 * 读动作永远双读（有 project.json 用它，没有就从目录合成只读视图）；
 * 写动作只允许 0.3 形状的课题：旧形状先 `system.migrate`，不在这里偷偷补写。
 */

import { runSubcommand } from '../adapters/python.js';
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

export const PROJECT_ACTIONS = [projectList, projectGet, projectCreate, projectStageSet, workflowNext];

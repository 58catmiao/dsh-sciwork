/**
 * 科研模式 0.3 · 动作域：草稿（写稿 / 新建 / 引用核查 / 投稿包）
 * ---------------------------------------------------------------------------
 * 写边界沿用 0.2：`writeText` 只能改 projects/<课题>/drafts/*.md|markdown|txt，
 * 且每次写前留备份（`writeTextBackup`）。`draft.new` 复用 `createDraft`。
 */

import { checkCitations, createDraft, writeTextBackup } from '../library.js';
import { callResearch } from '../adapters/python.js';
import { badRequest, cliFailed } from '../host/errors.js';
import { asString, reindexAfter, settingsNow } from '../host/engine.js';

export const draftWrite = {
  id: 'draft.write',
  title: '写草稿',
  domain: 'draft',
  description: '写/覆盖一篇草稿（只允许 projects/<课题>/drafts/ 下的 md|markdown|txt；写前自动备份）',
  params: {
    type: 'object', required: ['path', 'text'], additionalProperties: false,
    properties: {
      path: { type: 'string', maxLength: 400 },
      text: { type: 'string', maxLength: 2_000_000 },
    },
  },
  effects: 'write',
  engine: 'node',
  confirm: 'legacy',
  stage: ['draft', 'submission'],
  ui: { view: 'project', primary: true },
  tool: { expose: true, name: 'sciwork_draft_write' },
  legacy: ['writeText'],
  run: async (ctx, params) => {
    const path = asString(params.path);
    if (!path) throw badRequest('writeText 需要 path（库根相对路径）');
    if (typeof params.text !== 'string') throw badRequest('writeText 需要 text（字符串）');
    const settings = await settingsNow();
    return writeTextBackup(settings.root, path, params.text);
  },
};

export const draftNew = {
  id: 'draft.new',
  title: '新建草稿',
  domain: 'draft',
  description: '在课题 drafts/ 下创建一篇新草稿（可省略 .md）',
  params: {
    type: 'object', required: ['project', 'name'], additionalProperties: false,
    properties: {
      project: { type: 'string', maxLength: 120 },
      name: { type: 'string', maxLength: 120 },
      title: { type: 'string', maxLength: 300 },
    },
  },
  effects: 'write',
  engine: 'node',
  confirm: 'legacy',
  stage: ['draft', 'submission'],
  ui: { view: 'project' },
  tool: { expose: true, name: 'sciwork_draft_new' },
  legacy: ['newDraft'],
  run: async (ctx, params) => {
    const project = asString(params.project);
    const name = asString(params.name);
    if (!project) throw badRequest('newDraft 需要 project（课題 slug）');
    if (!name) throw badRequest('newDraft 需要 name（草稿文件名，可省略 .md）');
    const settings = await settingsNow();
    const value = await createDraft(settings.root, { project, name, title: asString(params.title) });
    return reindexAfter(settings, value);
  },
};

export const draftCheckCitations = {
  id: 'draft.check_citations',
  title: '引用核查',
  domain: 'draft',
  description: '校验每个引用键都能在库内找到、且该条带 DOI 或 URL（不证明内容支持这句话）',
  params: {
    type: 'object', required: ['path'], additionalProperties: false,
    properties: {
      path: { type: 'string', maxLength: 400 },
      requireDoi: { type: 'boolean', default: false },
    },
  },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  stage: ['draft', 'submission'],
  ui: { view: 'project' },
  tool: { expose: true, name: 'sciwork_draft_check_citations' },
  legacy: ['checkCitations'],
  run: async (ctx, params) => {
    const settings = await settingsNow();
    const result = await checkCitations(settings.root, asString(params.path));
    return {
      ...result,
      okFlag: result.missing.length === 0 && result.cited.length > 0,
      caveat: '本核查只能证明「每个引用键都能在库里找到、且该条带有 DOI 或 URL」；它不能证明被引文献的内容真的支持这句话。',
    };
  },
};

export const draftPackage = {
  id: 'draft.package',
  title: '导出投稿包',
  domain: 'draft',
  description: '稿件 + 图 + 数据 + refs.bib + manifest 打成 zip（写到 submissions/packages/）',
  params: {
    type: 'object', required: ['project'], additionalProperties: false,
    properties: {
      project: { type: 'string', maxLength: 120 },
      journal: { type: 'string', maxLength: 120 },
      submission: { type: 'string', maxLength: 120 },
      draft: { type: 'string', maxLength: 400 },
    },
  },
  effects: 'write',
  engine: 'python',
  confirm: 'legacy',
  timeoutMs: 180_000,
  stage: ['submission'],
  ui: { view: 'project' },
  tool: { expose: true, name: 'sciwork_draft_package' },
  legacy: ['exportPackage'],
  run: async (ctx, params) => {
    const project = asString(params.project);
    if (!project) throw badRequest('exportPackage 需要 project（课题 slug）');
    const settings = await settingsNow();
    const argv = ['export-package', '--project', project];
    if (asString(params.journal)) argv.push('--journal', asString(params.journal));
    if (asString(params.submission)) argv.push('--submission', asString(params.submission));
    if (asString(params.draft)) argv.push('--draft', asString(params.draft));
    const run = await callResearch(settings, argv, { label: 'export-package', timeoutMs: 180_000 });
    if (!run.raw) throw cliFailed(run.summary || '打包没有返回 JSON', { stderr: String(run.stderr || '').slice(0, 300) });
    if (run.raw.ok !== true) throw badRequest(String(run.raw.error || run.summary || '打包失败'));
    return { ...run.raw, warnings: run.warnings };
  },
};

export const DRAFT_ACTIONS = [draftWrite, draftNew, draftCheckCitations, draftPackage];

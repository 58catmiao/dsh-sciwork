/**
 * 科研模式 0.3 · 动作域：投稿体检
 * ---------------------------------------------------------------------------
 * 规则在 `research.py check-journal` 里，动作层只做「参数 → argv → 归一」。
 * 体检有不合格项时脚本退出码是 1，但 JSON 里 ok 仍是 true——数字是给人看的，
 * 不是请求失败；只有拿不到 JSON 或脚本明确报错时才回错误。
 */

import { runSubcommand } from '../adapters/python.js';
import { badRequest, cliFailed } from '../host/errors.js';
import { asString, settingsNow } from '../host/engine.js';

export const journalCheck = {
  id: 'journal.check',
  title: '投稿体检',
  domain: 'journal',
  description: '对照期刊档案体检：格式、图规格、引用完备性（返回 JSON 与退出码）',
  params: {
    type: 'object', required: ['project'], additionalProperties: false,
    properties: {
      project: { type: 'string', maxLength: 120 },
      journal: { type: 'string', maxLength: 120 },
      draft: { type: 'string', maxLength: 400 },
      submission: { type: 'string', maxLength: 120 },
    },
  },
  effects: 'read',
  engine: 'python',
  confirm: 'never',
  idempotent: true,
  timeoutMs: 120_000,
  stage: ['submission'],
  ui: { view: 'project', primary: true },
  tool: { expose: true, name: 'sciwork_journal_check' },
  legacy: ['checkJournal'],
  run: async (ctx, params) => {
    const project = asString(params.project);
    if (!project) throw badRequest('checkJournal 需要 project（课题 slug）');
    const settings = await settingsNow();
    const run = await runSubcommand(settings, 'journal.check', {
      project,
      journal: asString(params.journal),
      draft: asString(params.draft),
      submission: asString(params.submission),
    }, { label: 'check-journal' });
    if (!run.raw) throw cliFailed(run.summary || '体检没有返回 JSON', { stderr: String(run.stderr || '').slice(0, 300) });
    if (run.raw.ok !== true) throw badRequest(String(run.raw.error || run.summary || '体检失败'));
    return { ...run.raw, exitCode: run.code };
  },
};

export const JOURNAL_ACTIONS = [journalCheck];

/**
 * 科研模式 0.3 · 动作域：文献（查元数据 / 删条目）
 * ---------------------------------------------------------------------------
 * 删文献**不许**面板直接改 `refs.json`（登记索引），一律走库脚本 `remove-ref`：
 * 它会先备份 refs.json，再同步 refs.bib，并报出还有哪些草稿在引用这个键。
 */

import { fetchRefMeta } from '../refmeta.js';
import { runSubcommand } from '../adapters/python.js';
import { badRequest, ResearchError } from '../host/errors.js';
import { asString, reindexAfter, settingsNow, unwrap } from '../host/engine.js';

export const refsFetchMeta = {
  id: 'refs.fetch_meta',
  title: '查文献元数据',
  domain: 'refs',
  description: '按 DOI 查 Crossref/DataCite 元数据（只查询、不入库，DOI 不合法时不发网络）',
  params: {
    type: 'object', required: ['doi'], additionalProperties: false,
    properties: { doi: { type: 'string', maxLength: 300 } },
  },
  effects: 'external',
  engine: 'node',
  confirm: 'never',
  idempotent: true,
  ui: { view: 'refs' },
  tool: { expose: true, name: 'sciwork_refs_fetch_meta' },
  legacy: ['fetchRefMeta'],
  run: async (ctx, params) => {
    const doi = asString(params.doi);
    if (!doi) throw badRequest('fetchRefMeta 需要 doi');
    return unwrap(await fetchRefMeta({ doi }));
  },
};

export const refsRemove = {
  id: 'refs.remove',
  title: '删除文献条目',
  domain: 'refs',
  description: '按引用键或 DOI 删一条文献（脚本先备份 refs.json、同步 refs.bib、报出仍被哪些草稿引用）',
  params: {
    type: 'object', additionalProperties: false,
    properties: {
      key: { type: 'string', maxLength: 120 },
      doi: { type: 'string', maxLength: 300 },
    },
  },
  effects: 'write',
  engine: 'python',
  confirm: 'legacy',
  ui: { view: 'refs' },
  tool: { expose: true, name: 'sciwork_refs_remove' },
  legacy: ['removeRef'],
  run: async (ctx, params) => {
    const key = asString(params.key);
    const doi = asString(params.doi);
    if (!key && !doi) throw badRequest('removeRef 需要 key（引用键）或 doi');
    const settings = await settingsNow();
    const run = await runSubcommand(settings, 'refs.remove', { key, doi }, { label: 'remove-ref' });
    if (!run.ok) {
      const message = run.summary || '删除文献失败';
      const code = /没有这条文献/.test(message) ? 'not-found' : 'bad-request';
      throw new ResearchError(code, message, { stderr: String(run.stderr || '').slice(0, 300) });
    }
    const value = { ...(run.raw || {}) };
    delete value.ok;
    value.warnings = run.warnings;
    return reindexAfter(settings, value);
  },
};

export const REFS_ACTIONS = [refsFetchMeta, refsRemove];

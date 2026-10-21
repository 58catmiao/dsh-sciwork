/**
 * 科研模式 0.3 · Python 引擎适配器（契约 v1）
 * ---------------------------------------------------------------------------
 * `library/scripts/research.py` 是科研逻辑的唯一实现。适配层只做三件事：
 *   构造 argv · 解析 stdout 末尾 JSON · 超时与错误归一（PLAN §7.1）。
 *
 * 纪律：
 *   - 本文件是 research.py 的**唯一调用口**；动作层不许再出现第二套命令拼装。
 *   - 子命令映射表（SUBCOMMANDS）是契约测试的唯一事实源（scripts/test-contract.mjs）。
 *   - 超时默认 60s，重画/打包/体检给 120–180s；超时回 `timeout`，不杀 Origin 进程。
 *   - 引擎抛的是普通 Error，错误码沿用 `describeError` 的正则兜底（旧码不变）。
 */

import { runResearch } from '../import.js';

/** 协议版本：写进 `.research/engine.json`，不匹配直接 unsupported（不尝试兼容）。 */
export const PROTOCOL = 1;

/** 不给默认超时的子命令一律 60s；长任务在调用处显式给值。 */
export const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * 动作 → research.py 子命令映射。
 * args：{ 参数名: '--flag' 或 { flag:'--x', positional:true, list:true, bool:true } }
 * 没列的参数**不会**被传下去（防止面板/agent 随手塞参数）。
 */
export const SUBCOMMANDS = {
  'journal.check': {
    cli: 'check-journal',
    args: { project: '--project', journal: '--journal', draft: '--draft', submission: '--submission' },
  },
  'draft.package': {
    cli: 'export-package',
    args: { project: '--project', journal: '--journal', submission: '--submission', draft: '--draft' },
  },
  'draft.check_citations': {
    cli: 'check-citations',
    args: { draft: '--draft', requireDoi: { flag: '--require-doi', bool: true } },
  },
  'refs.remove': {
    cli: 'remove-ref',
    args: { key: '--key', doi: '--doi' },
  },
  'refs.add': {
    cli: 'add-ref',
    args: {
      title: '--title', authors: '--authors', year: '--year', container: '--container',
      volume: '--volume', issue: '--issue', pages: '--pages', doi: '--doi', url: '--url',
      type: '--type', key: '--key', notes: '--notes', verifiedBy: '--verified-by',
      force: { flag: '--force', bool: true },
    },
  },
  'project.create': {
    cli: 'new-project',
    args: { slug: { flag: 'slug', positional: true }, title: '--title', journal: '--journal' },
  },
  'project.list': { cli: 'list-projects', args: {} },
  'data.list': { cli: 'list-figures', args: { project: '--project' } },
  'refs.list': { cli: 'list-refs', args: { project: '--project', query: '--query' } },
  'submission.list': {
    cli: 'list-submissions',
    args: {
      project: '--project', journal: '--journal', status: '--status',
      active: { flag: '--active', bool: true }, due: { flag: '--due', bool: true },
    },
  },
  'submission.add': {
    cli: 'add-submission',
    args: {
      journal: '--journal', project: '--project', title: '--title', type: '--type', status: '--status',
      manuscript: '--manuscript', manuscriptId: '--manuscript-id', doi: '--doi',
      nextAction: '--next-action', nextActionDue: '--next-action-due', note: '--note',
    },
  },
  'submission.update': {
    cli: 'update-submission',
    args: {
      id: { flag: 'id', positional: true }, status: '--status', note: '--note',
      nextAction: '--next-action', nextActionDue: '--next-action-due',
    },
  },
  'figure.register': {
    cli: 'register-figure',
    args: {
      project: '--project', file: '--file', data: { flag: '--data', list: true }, graph: '--graph',
      journal: '--journal', caption: '--caption', opju: '--opju', spec: '--spec', figureId: '--figure-id',
    },
  },
  'figure.list': { cli: 'list-figures', args: { project: '--project' } },
  'library.search': { cli: 'search', args: { query: '--query', kind: '--kind', project: '--project', limit: '--limit' } },
  'library.reindex': { cli: 'reindex', args: {} },
  'system.init': { cli: 'init', args: {} },
  'refs.export_bib': { cli: 'export-bib', args: {} },
};

export const KIND_TIMEOUTS = {
  'journal.check': 120_000,
  'draft.package': 180_000,
  'figure.register': 120_000,
  'library.reindex': 120_000,
};

const isBlank = (v) => v === undefined || v === null || v === '';

/** params → argv（参数名映射在这里，动作层不拼命令）。 */
export function toArgv(subcommandId, params = {}) {
  const spec = SUBCOMMANDS[subcommandId];
  if (!spec) throw new Error(`没有这个引擎子命令映射：${subcommandId}`);
  const argv = [spec.cli];
  for (const [key, rawSpec] of Object.entries(spec.args)) {
    const value = params[key];
    if (isBlank(value)) continue;
    const conf = typeof rawSpec === 'string' ? { flag: rawSpec } : rawSpec;
    if (conf.bool) {
      if (value === true || value === 'true' || value === '1') argv.push(conf.flag);
      continue;
    }
    if (conf.list) {
      const list = Array.isArray(value) ? value : String(value).split(/[;\n]/);
      for (const one of list.map((x) => String(x).trim()).filter(Boolean)) argv.push(conf.flag, one);
      continue;
    }
    if (!conf.positional) argv.push(conf.flag);
    argv.push(String(value).trim());
  }
  return argv;
}

/**
 * 调一次 research.py 子命令。
 * @returns {Promise<{ok:boolean, code:number|null, summary:string, warnings:string[],
 *                    raw:object|null, stderr:string, argv:string[]}>}
 */
export async function runSubcommand(settings, subcommandId, params = {}, opts = {}) {
  const argv = toArgv(subcommandId, params);
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : (KIND_TIMEOUTS[subcommandId] || DEFAULT_TIMEOUT_MS);
  return callResearch(settings, argv, { label: opts.label || subcommandId, timeoutMs });
}

/**
 * 唯一的引擎调用口（旧的 runResearch 仍是实现，但只能从这里进）。
 * `runResearch` 永不 reject，返回值形状保持 0.2 的兼容。
 */
export function callResearch(settings, argv, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
  return runResearch(settings, argv, { label: opts.label || (argv && argv[0]) || 'research', timeoutMs });
}

/** 引擎握手：协议 + python 版本 + 脚本 mtime（`system.doctor` 写 `.research/engine.json`）。 */
export function engineHandshake(settings) {
  return {
    protocol: PROTOCOL,
    libroot: settings.root,
    interpreter: settings.interpreter || null,
    researchPy: settings.script || null,
  };
}

/**
 * 科研模式 0.3 · 动作域：系统（命令台执行 / 回执）
 * ---------------------------------------------------------------------------
 * `system.cli_run` 是 0.2「命令台」的唯一写入口：只放行 CLI_COMMANDS 白名单，
 * danger 命令仍要显式 confirm；读写结果里的 raw 原样回给面板（人看的数字，不是协议）。
 */

import { CLI_COMMANDS } from '../host/cli.js';
import { buildCliArgs, parseRawArgs } from '../host/cli.js';
import { badRequest } from '../host/errors.js';
import { asString, reindexAfter, settingsNow, callCli } from '../host/engine.js';
import { recentReceipts } from '../host/dispatch.js';

export const systemCliRun = {
  id: 'system.cli_run',
  title: '命令台执行',
  domain: 'system',
  description: '在子命令白名单内跑一次 research.py（danger 命令仍需 confirm=true）',
  params: {
    type: 'object', required: ['id'], additionalProperties: false,
    properties: {
      id: { type: 'string', maxLength: 60 },
      values: { type: 'object' },
      raw: { type: 'string', maxLength: 2000 },
      confirm: { type: ['boolean', 'string'], default: false },
    },
  },
  effects: 'write',
  engine: 'python',
  confirm: 'legacy',
  timeoutMs: 180_000,
  ui: { view: 'library' },
  tool: { expose: true, name: 'sciwork_system_cli_run' },
  legacy: ['runCli'],
  run: async (ctx, params) => {
    const id = asString(params.id);
    const command = CLI_COMMANDS.find((c) => c.id === id);
    if (!command) {
      throw badRequest(`命令台只放行白名单子命令：${CLI_COMMANDS.map((c) => c.id).join(', ')}`);
    }
    if (command.kind === 'danger' && params.confirm !== true) {
      throw badRequest(`「${command.id}」是不可逆操作，需要显式确认（confirm=true）`);
    }
    let argv;
    try {
      argv = params.raw ? [command.id, ...parseRawArgs(params.raw)] : buildCliArgs(command, params.values || {});
    } catch (error) {
      throw badRequest(String(error.message || error));
    }
    if (!params.raw) {
      const values = params.values || {};
      const missing = (command.args || []).filter((a) => a.required && !asString(values[a.name]));
      if (missing.length) throw badRequest(`缺少必填参数：${missing.map((a) => a.name).join('、')}`);
    }
    const settings = await settingsNow();
    const t0 = Date.now();
    const run = await callCli(settings, argv, { label: `命令台 ${command.id}`, timeoutMs: 180_000 });
    const value = {
      command: command.id, kind: command.kind, args: run.args,
      ok: run.ok, code: run.code, summary: run.summary, warnings: run.warnings,
      raw: run.raw, stderr: run.ok ? '' : String(run.stderr || '').slice(0, 1200),
      elapsedMs: Date.now() - t0,
    };
    return command.kind === 'read' ? value : reindexAfter(settings, value);
  },
};

export const systemReceipts = {
  id: 'system.receipts',
  title: '最近操作回执',
  domain: 'system',
  description: '读 `.research/receipts/` 的最近条目（面板「最近操作」）',
  params: {
    type: 'object', additionalProperties: false,
    properties: { limit: { type: 'integer', min: 1, max: 100, default: 20 } },
  },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  idempotent: true,
  ui: { view: 'library' },
  tool: { expose: true, name: 'sciwork_system_receipts' },
  run: async (ctx, params) => {
    const out = recentReceipts(ctx.root, Number(params.limit) || 20);
    if (!out.ok) throw badRequest(out.error && out.error.message ? out.error.message : '读回执失败');
    return out.value;
  },
};

export const SYSTEM_ACTIONS = [systemCliRun, systemReceipts];

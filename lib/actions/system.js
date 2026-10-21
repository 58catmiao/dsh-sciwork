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
import { createBackup, restoreBackup } from '../backup.js';
import { applyMigration, planMigration } from '../migrate.js';

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

export const systemBackup = {
  id: 'system.backup',
  title: '库备份（zip + 核对）',
  domain: 'system',
  description: '打包整个库并解压复算 sha256；核对不过的备份不可用于迁移',
  params: { type: 'object', additionalProperties: false, properties: {} },
  effects: 'write',
  engine: 'node',
  confirm: 'write',
  timeoutMs: 300_000,
  ui: { view: 'settings' },
  tool: { expose: true, name: 'sciwork_system_backup' },
  run: async (ctx) => {
    const out = createBackup(ctx.root);
    return { file: out.file, bytes: out.bytes, files: out.files, verified: out.verified, manifest: out.manifest };
  },
};

export const systemRestore = {
  id: 'system.restore',
  title: '从备份恢复',
  domain: 'system',
  description: '先把 zip 解到空目录核对，再落盘；不替换正在用的库',
  params: {
    type: 'object', required: ['archive', 'target'], additionalProperties: false,
    properties: {
      archive: { type: 'string', minLength: 1, maxLength: 1024 },
      target: { type: 'string', minLength: 1, maxLength: 1024 },
      force: { type: 'boolean', default: false },
    },
  },
  effects: 'write',
  engine: 'node',
  confirm: 'always',
  timeoutMs: 300_000,
  ui: { view: 'settings' },
  tool: { expose: true, name: 'sciwork_system_restore' },
  run: async (ctx, params) => restoreBackup(asString(params.archive), asString(params.target), { force: params.force === true }),
};

export const systemMigratePlan = {
  id: 'system.migrate_plan',
  title: '迁移预演（只读）',
  domain: 'system',
  description: '按课题列出会写哪些 project.json、缺哪些文件；不写盘',
  params: { type: 'object', additionalProperties: false, properties: {} },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  idempotent: true,
  ui: { view: 'settings' },
  tool: { expose: true, name: 'sciwork_system_migrate_plan' },
  run: async (ctx) => planMigration(ctx.root),
};

export const systemMigrate = {
  id: 'system.migrate',
  title: '迁移旧库到 0.3 形状',
  domain: 'system',
  description: '先备份并核对，再逐课题写 project.json；幂等，已是 0.3 的跳过',
  params: {
    type: 'object', additionalProperties: false,
    properties: { backupPath: { type: 'string', maxLength: 1024 } },
  },
  effects: 'write',
  engine: 'node',
  confirm: 'always',
  timeoutMs: 600_000,
  ui: { view: 'settings' },
  tool: { expose: true, name: 'sciwork_system_migrate' },
  run: async (ctx, params) => applyMigration(ctx.root, {
    backupPath: asString(params.backupPath) || undefined,
    ensureBackup: async () => createBackup(ctx.root),
  }),
};

export const SYSTEM_ACTIONS = [
  systemCliRun, systemReceipts, systemBackup, systemRestore, systemMigratePlan, systemMigrate,
];

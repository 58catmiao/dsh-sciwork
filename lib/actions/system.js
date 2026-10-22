/**
 * 科研模式 0.3 · 动作域：系统（命令台执行 / 回执 / 更新）
 * ---------------------------------------------------------------------------
 * `system.cli_run` 是 0.2「命令台」的唯一写入口：只放行 CLI_COMMANDS 白名单，
 * danger 命令仍要显式 confirm；读写结果里的 raw 原样回给面板（人看的数字，不是协议）。
 *
 * 0.3.12 起多了「检查更新」：只读的是 GitHub 上的 package.json（raw.githubusercontent），
 * 更新只在**干净的 git 工作树**里执行 `git pull --ff-only`——pnpm 从 GitHub 拷过来的
 * node_modules 不是 git 目录，那里一律拒绝并给重装命令，不猜、不硬替。
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isNewer } from '../host/version.js';
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

/* ------------------------------------------------------------ 更新（0.3.12） */

const REPO_SLUG = '58catmiao/dsh-sciwork';
const REPO_BRANCH = 'main';
const RAW_PACKAGE = `https://raw.githubusercontent.com/${REPO_SLUG}/${REPO_BRANCH}/package.json`;
/** 插件自己的根目录（lib/actions/ 往上两层）——本机开发态下就是 git 仓库。 */
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RESTART_NOTE = '面板要重启 DSH 才换成新版；宿主动作（工具 / 端点）当场生效。';

/** 跑一次 git，永不抛错（git 没装、不是仓库都收成 ok:false）。 */
function runGit(dir, args, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, ...args], { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        out: String(stdout || '').trim(),
        err: String(stderr || error && error.message || '').trim(),
      });
    });
  });
}

async function readLocalPackage(dir) {
  const file = path.join(dir, 'package.json');
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw badRequest(`读不到插件的 package.json：${file}（${String(error.code || error.message || error)}）`);
  }
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    throw badRequest(`package.json 不是合法 JSON：${file}`);
  }
  return { dir, name: String(pkg.name || ''), version: String(pkg.version || '') };
}

/** 这份安装是不是 git 工作树、干净不干净、跟远端差几个提交。 */
async function readGitState(dir) {
  const inside = await runGit(dir, ['rev-parse', '--is-inside-work-tree'], 20_000);
  if (!inside.ok || inside.out !== 'true') {
    return { ok: false, reason: '不是 git 工作树（pnpm 从 GitHub 拷进 node_modules 的安装都是这种）' };
  }
  const [commit, branch, status, remote, upstream] = await Promise.all([
    runGit(dir, ['rev-parse', '--short', 'HEAD'], 20_000),
    runGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD'], 20_000),
    runGit(dir, ['status', '--porcelain'], 20_000),
    runGit(dir, ['remote', 'get-url', 'origin'], 20_000),
    runGit(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], 20_000),
  ]);
  const files = status.out ? status.out.split('\n').filter(Boolean) : [];
  const state = {
    ok: true, commit: commit.out, branch: branch.out,
    dirty: files.length > 0,
    dirtyFiles: files.slice(0, 6),
    dirtyCount: files.length,
    remote: remote.ok ? remote.out : '',
    upstream: upstream.ok ? upstream.out : '',
    ahead: null, behind: null,
  };
  if (state.upstream) {
    const [ahead, behind] = await Promise.all([
      runGit(dir, ['rev-list', '--count', state.upstream + '..HEAD'], 20_000),
      runGit(dir, ['rev-list', '--count', 'HEAD..' + state.upstream], 20_000),
    ]);
    state.ahead = ahead.ok ? Number(ahead.out) || 0 : null;
    state.behind = behind.ok ? Number(behind.out) || 0 : null;
  }
  return state;
}

/** 读 GitHub 上 main 分支的 package.json（6 秒超时，失败不抛）。 */
async function readRemotePackage(timeoutMs = 6000) {
  try {
    const res = await fetch(RAW_PACKAGE, { signal: AbortSignal.timeout(timeoutMs), headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) return { ok: false, status: res.status, url: RAW_PACKAGE, error: `GitHub 返回 HTTP ${res.status}` };
    const pkg = await res.json();
    return { ok: true, version: String(pkg.version || ''), url: RAW_PACKAGE };
  } catch (error) {
    return { ok: false, url: RAW_PACKAGE, error: `取不到远端版本：${String(error && error.message || error)}` };
  }
}

export const systemUpdateCheck = {
  id: 'system.update_check',
  title: '检查更新',
  domain: 'system',
  description: '比对本地插件版本与 GitHub 上的最新版本（只读：不写盘，只请求 raw.githubusercontent）',
  params: {
    type: 'object', additionalProperties: false,
    properties: {
      dir: { type: 'string', maxLength: 1024 },
      // 面板首屏只要本地版本号（不联网）；点「检查更新」才带 remote:true 去 GitHub 比。
      remote: { type: 'boolean', default: true },
    },
  },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  idempotent: true,
  ui: { view: 'settings' },
  tool: { expose: true, name: 'sciwork_system_update_check' },
  run: async (ctx, params) => {
    const dir = asString(params.dir) || PLUGIN_ROOT;
    const withRemote = params.remote !== false;
    const local = await readLocalPackage(dir);
    const [gitInfo, remote] = await Promise.all([
      readGitState(dir),
      withRemote ? readRemotePackage() : Promise.resolve(null),
    ]);
    const updateAvailable = Boolean(remote && remote.ok) && isNewer(remote.version, local.version);
    const canSelfUpdate = withRemote ? (gitInfo.ok === true && gitInfo.dirty === false) : undefined;
    return {
      plugin: { name: local.name, version: local.version, dir },
      git: gitInfo,
      remote,
      updateAvailable,
      canSelfUpdate,
      hint: !withRemote
        ? '还没比对远端：点「检查更新」去 GitHub 看一眼。'
        : !remote.ok
          ? '取不到远端版本（离线或 GitHub 不通），先照旧用。'
          : updateAvailable
            ? (canSelfUpdate
              ? `有新版本 ${remote.version}，可以在这里更新。`
              : `有新版本 ${remote.version}，但这份安装不是干净的 git 工作树，按 README 的安装方式重装一次。`)
            : '已经是最新版本。',
      repo: `https://github.com/${REPO_SLUG}`,
    };
  },
};

export const systemUpdateApply = {
  id: 'system.update_apply',
  title: '更新到最新版',
  domain: 'system',
  description: '对 git 工作树安装执行 git pull --ff-only 并回报版本变化；有未提交改动时拒绝',
  params: {
    type: 'object', additionalProperties: false,
    properties: { dir: { type: 'string', maxLength: 1024 } },
  },
  effects: 'write',
  engine: 'node',
  confirm: 'write',
  timeoutMs: 180_000,
  ui: { view: 'settings' },
  tool: { expose: true, name: 'sciwork_system_update_apply' },
  run: async (ctx, params) => {
    const dir = asString(params.dir) || PLUGIN_ROOT;
    const before = await readLocalPackage(dir);
    const gitInfo = await readGitState(dir);
    if (!gitInfo.ok) {
      throw badRequest(`这份安装${gitInfo.reason}，面板不能替它更新。请在仓库目录 git pull，或重装：dsh plugin --profile <profile> add github:${REPO_SLUG}`);
    }
    if (gitInfo.dirty) {
      throw badRequest(`仓库有 ${gitInfo.dirtyCount} 处未提交改动（${gitInfo.dirtyFiles.join('、')}），先提交或丢弃再更新。`);
    }
    const pull = await runGit(dir, ['pull', '--ff-only'], 180_000);
    const after = await readLocalPackage(dir);
    const head = await runGit(dir, ['rev-parse', '--short', 'HEAD'], 20_000);
    const applied = pull.ok && (after.version !== before.version || (head.ok && head.out !== gitInfo.commit));
    return {
      dir,
      ok: pull.ok,
      applied,
      from: { version: before.version, commit: gitInfo.commit },
      to: { version: after.version, commit: head.ok ? head.out : '' },
      branch: gitInfo.branch,
      output: (pull.ok ? pull.out : (pull.err || pull.out)).slice(0, 800),
      restartRequired: applied,
      note: pull.ok
        ? (applied ? RESTART_NOTE : '拉过了，版本没变：本来就是最新的。')
        : '更新没成功，上面是 git 的原话（常见是分支分叉，需要手动 merge）。',
    };
  },
};

export const SYSTEM_ACTIONS = [
  systemCliRun, systemReceipts, systemBackup, systemRestore, systemMigratePlan, systemMigrate,
  systemUpdateCheck, systemUpdateApply,
];

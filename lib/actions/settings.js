/**
 * 科研模式 0.4 · 动作域：设置（科研库根目录）
 * ---------------------------------------------------------------------------
 * 面板「设置 → 科研库」就三件事：
 *   - `settings.library`            只读：当前库根、它由哪一层配置说了算、各层的实际取值；
 *   - `settings.library_root_set`   写：把库根写进用户级 `<DSH_HOME>/sciwork/config.json`；
 *   - `settings.library_root_clear` 写：删掉这条用户级设置，退回随包快照 / 默认位置。
 *
 * 为什么要有这条设置（2026-11-08 用户反馈）：原先库根只存在**包内**
 * `library/config.json` 里，而那是 `pnpm install` / 升级插件会整个换掉的文件——
 * 升级一次库根就丢，面板报「科研库根目录不存在：<home>/Research」。
 * 用户级配置生在包外（`<DSH_HOME>/sciwork/config.json`），插件升级、重装都活得过。
 *
 * 纪律：
 *   - 写的是**包外的一份配置文件**，不是库数据；仍然只认绝对路径、只写这一个文件；
 *   - 写前把 diff / warnings 摆给用户看（confirm:'write'，两步确认）；
 *   - 环境变量优先于这里（自检脚本靠环境变量隔离到临时库），被压过时必须明说。
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_LIBRARY_DIRNAME,
  ENV,
  ROOT_SOURCES,
  dshHome,
  envLibraryRoot,
  homeDir,
  inLibraryConfigPath,
  launcherPath,
  pickPython,
  readUserConfig,
  userConfigPath,
  userLibraryRoot,
} from '../config.js';
import { asString, settingsNow } from '../host/engine.js';
import { badRequest } from '../host/errors.js';

/* --------------------------------------------------------------- 小工具 */

const exists = (p) => {
  if (!p) return false;
  try { return fs.existsSync(p); } catch { return false; }
};

const isDir = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};

/** 来源的中文说明：面板要如实告诉用户「这个路径是谁说了算」。 */
const SOURCE_LABEL = Object.freeze({
  'in-library': '库内 .research/config.json（最权威）',
  env: '环境变量（运行期显式指定）',
  user: '面板设置（用户级配置）',
  bundled: '随包安装快照',
  default: '默认位置',
});

const labelOf = (source) => SOURCE_LABEL[source] || '未知';

/** 展示用的优先级表（面板「为什么改了不生效」全靠它解释）。 */
const PRIORITY = Object.freeze([
  { source: 'in-library', label: '库内 .research/config.json', writable: false },
  { source: 'env', label: `环境变量 ${ENV.library} / ${ENV.libraryLegacy}`, writable: false },
  { source: 'user', label: '面板设置（<DSH_HOME>/sciwork/config.json）', writable: true },
  { source: 'bundled', label: '随包 library/config.json', writable: false },
  { source: 'default', label: `默认位置 <用户目录>/${DEFAULT_LIBRARY_DIRNAME}`, writable: false },
]);

/** 环境变量这次到底是谁在压（给提示用）。 */
function activeEnvName() {
  if (process.env[ENV.library]) return ENV.library;
  if (process.env[ENV.libraryLegacy]) return ENV.libraryLegacy;
  return '';
}

/**
 * 把用户输入的路径整理成「绝对路径 + 存储用文本」。
 * 只认绝对路径：相对路径会被解析到宿主的工作目录，用户根本不知道库建到哪去了。
 */
function normalizeRoot(raw) {
  const text = asString(raw);
  if (!text) throw badRequest(`需要 root（科研库根目录的绝对路径，例如 E:/Research）`);
  if (!path.isAbsolute(text)) {
    throw badRequest(`库根必须是绝对路径：${text}（例如 E:/Research；相对路径会被解析到宿主工作目录）`);
  }
  const abs = path.resolve(text);
  // Windows 存成正斜杠：JSON 里不用写双反斜杠，人也看得懂；读回来 path.resolve 一样认。
  const stored = process.platform === 'win32' ? abs.split(path.sep).join('/') : abs;
  return { abs, stored };
}

/** 目录本身不像科研库时，把「怎么初始化」写成人话（不拦，只提醒）。 */
function seedHint(abs, stored) {
  const script = path.join('scripts', 'install.mjs');
  return `这个目录还不是科研库（没有 .research/config.json）。要初始化库骨架请跑：\n` +
    `node ${script} --library-root ${stored || abs}`;
}

/* --------------------------------------------------------------- 只读视图 */

async function inspect() {
  const settings = await settingsNow();
  const root = settings.root;
  const inLibraryFile = inLibraryConfigPath(root);
  const launcher = settings.launcher || launcherPath(root);
  const configFile = userConfigPath();
  const userCfg = readUserConfig();
  const envRoot = settings.envRoot || (envLibraryRoot() ? path.resolve(envLibraryRoot()) : null);
  const bundledRoot = settings.bundledRoot || null;
  const defaultRoot = path.join(homeDir(), DEFAULT_LIBRARY_DIRNAME);
  const source = settings.rootSource || 'default';
  const envName = activeEnvName();
  const notes = [];

  if (!exists(root)) {
    notes.push(`当前库根目录不存在：${root}。先建好目录，或在下面保存时勾上「目录不存在则新建」。`);
  }
  if (exists(root) && !exists(inLibraryFile)) notes.push(seedHint(root, root));
  if (envRoot) {
    notes.push(
      `环境变量 ${envName || ENV.library} 正在压过面板设置（${envRoot}）：在下面改的库根不会生效，` +
      '除非清掉该环境变量并重启宿主。',
    );
  }
  if (!exists(launcher)) {
    notes.push(`库内启动器不存在：${launcher}。它是库自带的 py.cmd，缺了「命令台」相关动作会退化。`);
  }

  return {
    root,
    rootSource: source,
    rootSourceLabel: labelOf(source),
    rootExists: exists(root),
    looksLikeLibrary: exists(inLibraryFile),
    inLibraryConfig: inLibraryFile,
    inLibraryConfigExists: exists(inLibraryFile),
    launcher,
    launcherExists: exists(launcher),
    interpreter: settings.interpreter || null,
    python: pickPython({ root, interpreter: settings.interpreter || undefined }),
    userConfig: configFile,
    userConfigExists: exists(configFile),
    userRoot: settings.userRoot || userLibraryRoot(),
    userUpdatedAt: typeof userCfg.updatedAt === 'string' ? userCfg.updatedAt : null,
    envRoot,
    envNames: { [ENV.library]: process.env[ENV.library] || null, [ENV.libraryLegacy]: process.env[ENV.libraryLegacy] || null },
    bundledRoot,
    defaultRoot,
    dshHome: dshHome(),
    priority: PRIORITY,
    sources: ROOT_SOURCES,
    notes,
  };
}

/* ------------------------------------------------------------- 设置库根 */

/**
 * 计划：只校验 + 算 diff/warnings，不写盘。
 * 注意必须是**同步**函数：`planAction()` 不 await preview（`lib/host/dispatch.js:78`）。
 */
function previewSet(params) {
  const { abs, stored } = normalizeRoot(params.root);
  const create = params.create === true;
  const before = readUserConfig();
  const beforeRoot = typeof before.libraryRoot === 'string' ? before.libraryRoot : null;
  const warnings = [];

  if (exists(abs)) {
    if (!isDir(abs)) throw badRequest(`不是目录：${abs}`);
  } else if (create) {
    warnings.push(`目录不存在，保存时会新建：${abs}（只建这一个目录，不铺库骨架）`);
  } else {
    throw badRequest(`目录不存在：${abs}。先把目录建好，或勾上「目录不存在则新建」。`);
  }
  if (exists(abs) && !exists(inLibraryConfigPath(abs))) warnings.push(seedHint(abs, stored));
  if (activeEnvName()) {
    warnings.push(
      `环境变量 ${activeEnvName()}（${envLibraryRoot()}）仍然优先：保存了也不会立即生效，` +
      '要清掉该变量并重启宿主。',
    );
  }

  return {
    summary: `科研库根目录：${beforeRoot || '（未设置）'} → ${stored}`,
    diff: [{ file: userConfigPath(), before: beforeRoot, after: stored }],
    writes: [userConfigPath()],
    warnings,
    target: { root: stored, absolute: abs, create },
  };
}

async function runSet(ctx, params) {
  const { abs, stored } = normalizeRoot(params.root);
  const create = params.create === true;
  const file = userConfigPath();
  const before = readUserConfig();
  const beforeRoot = typeof before.libraryRoot === 'string' ? before.libraryRoot : null;
  const madeDir = !exists(abs);

  if (madeDir) {
    if (!create) throw badRequest(`目录不存在：${abs}。先把目录建好，或勾上「目录不存在则新建」。`);
    fs.mkdirSync(abs, { recursive: true });
  } else if (!isDir(abs)) {
    throw badRequest(`不是目录：${abs}`);
  }

  const next = { ...before, version: 1, libraryRoot: stored, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');

  // 写完立刻读回来复核：面板上的「已保存」必须对应盘上真实内容。
  const readBack = readUserConfig().libraryRoot || null;
  if (readBack !== stored) {
    throw badRequest(`写入后复核不一致：期望 ${stored}，读回 ${readBack}（${file}）`);
  }

  return {
    file,
    root: stored,
    absolute: abs,
    createdDir: madeDir,
    previous: beforeRoot,
    readBack,
    effectiveNow:
      activeEnvName()
        ? { root: envLibraryRoot(), source: 'env', note: `环境变量 ${activeEnvName()} 仍压过它` }
        : { root: stored, source: 'user' },
    note: activeEnvName()
      ? `已写入 ${file}，但环境变量 ${activeEnvName()} 仍压过它；清掉该变量并重启宿主后才按新库根解析。`
      : `已写入 ${file}；下一次动作/面板刷新即按新库根解析。`,
  };
}

/* ----------------------------------------------------------- 恢复默认库根 */

/** 计划（同步，同上）：清空后由谁接管，只算不写。 */
function previewClear() {
  const before = readUserConfig();
  const beforeRoot = typeof before.libraryRoot === 'string' ? before.libraryRoot : null;
  const envRoot = envLibraryRoot() ? path.resolve(envLibraryRoot()) : null;
  const fallback = envRoot || path.join(homeDir(), DEFAULT_LIBRARY_DIRNAME);
  const warnings = [];
  if (!beforeRoot) warnings.push('本来就没有用户级库根设置，清空不会改变任何东西。');
  if (envRoot) warnings.push(`清空后由环境变量接管：${envRoot}`);

  return {
    summary: `删除用户级库根设置：${beforeRoot || '（未设置）'} → ${envRoot ? '环境变量' : '随包快照/默认位置'}接管（${fallback}）`,
    diff: [{ file: userConfigPath(), before: beforeRoot, after: null }],
    writes: [userConfigPath()],
    warnings,
    target: { fallback, fallbackSource: envRoot ? 'env' : 'bundled-or-default' },
  };
}

async function runClear() {
  const file = userConfigPath();
  const before = readUserConfig();
  const beforeRoot = typeof before.libraryRoot === 'string' ? before.libraryRoot : null;
  const settings = await settingsNow();
  const fallback = settings.envRoot || settings.bundledRoot || path.join(homeDir(), DEFAULT_LIBRARY_DIRNAME);
  const fallbackSource = settings.envRoot ? 'env' : settings.bundledRoot ? 'bundled' : 'default';

  if (!beforeRoot && !exists(file)) {
    return { file, previous: null, removed: false, fallback, fallbackSource, note: '本来就没有用户级库根设置，未改动任何文件。' };
  }

  const next = { ...before };
  delete next.libraryRoot;
  next.version = typeof next.version === 'number' ? next.version : 1;
  next.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');

  return {
    file,
    previous: beforeRoot,
    removed: Boolean(beforeRoot),
    readBack: readUserConfig().libraryRoot || null,
    fallback,
    fallbackSource,
    note: `已删除用户级库根设置；库根改由${labelOf(fallbackSource)}决定（${fallback}）。`,
  };
}

/* ------------------------------------------------------------------ 动作 */

export const settingsLibrary = {
  id: 'settings.library',
  title: '科研库位置',
  domain: 'settings',
  description: '当前科研库根目录、它由哪一层配置说了算，以及环境变量/随包快照/默认位置的实际取值（只读）',
  params: { type: 'object', additionalProperties: false, properties: {} },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  idempotent: true,
  ui: { view: 'settings' },
  tool: { expose: true, name: 'sciwork_settings_library' },
  run: () => inspect(),
};

export const settingsLibraryRootSet = {
  id: 'settings.library_root_set',
  title: '设置科研库根目录',
  domain: 'settings',
  description: '把库根写进用户级 <DSH_HOME>/sciwork/config.json（插件升级后保留；环境变量仍然优先）',
  params: {
    type: 'object',
    required: ['root'],
    additionalProperties: false,
    properties: {
      root: { type: 'string', minLength: 1, maxLength: 400, description: '科研库根目录，必须是绝对路径（例如 E:/Research）' },
      create: { type: 'boolean', default: false, description: '目录不存在时新建（只建目录，不铺库骨架）' },
    },
  },
  effects: 'write',
  engine: 'node',
  confirm: 'write',
  ui: { view: 'settings' },
  tool: { expose: true, name: 'sciwork_settings_library_root_set' },
  preview: (ctx, params) => previewSet(params),
  run: (ctx, params) => runSet(ctx, params),
};

export const settingsLibraryRootClear = {
  id: 'settings.library_root_clear',
  title: '清除科研库根目录设置',
  domain: 'settings',
  description: '删除用户级库根设置，退回随包快照或默认位置（<用户目录>/Research）',
  params: { type: 'object', additionalProperties: false, properties: {} },
  effects: 'write',
  engine: 'node',
  confirm: 'write',
  ui: { view: 'settings' },
  tool: { expose: true, name: 'sciwork_settings_library_root_clear' },
  preview: () => previewClear(),
  run: () => runClear(),
};

export const SETTINGS_ACTIONS = [settingsLibrary, settingsLibraryRootSet, settingsLibraryRootClear];

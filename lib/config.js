/**
 * 科研模式 · 运行时路径解析（可移植层）
 * ---------------------------------------------------------------------------
 * 这一层只有一个职责：**把"东西在哪"从代码里拿出来**。所有本机路径都必须经过
 * 这里的解析，任何模块都不许再写死库根或某个 venv 的绝对路径。
 *
 * 解析优先级（越靠前越优先，全部可缺省）：
 *   1. 库内 `.research/config.json` 的 `libraryRoot`（`research.py` 写的，最权威；在
 *      `library.js#loadSettings` 里做最后一层覆盖）
 *   2. 环境变量 `SCIWORK_LIBRARY` / `RESEARCH_LIBRARY`（运行期显式指定，压过随包快照）
 *   3. 随包的 `library/config.json`（`scripts/install.mjs` 写下的安装期快照）
 *   4. 按 DSH 的既有约定推断（`DSH_PROFILE_DIR`、`node_modules` 布局）
 *   5. 兜底默认值（`<用户目录>/Research` 这样的"合理猜测"，不是某台机器的路径）
 *
 * 注意 2 与 3 的次序：环境变量必须压过随包配置。2026-10-19 之前是反过来的，
 * 结果是「把库指到别处」（隔离自检副本、用户换库位置）在装有 `library/config.json`
 * 的机器上**静默失效**，写动作自检的隔离闸门因此直接拦停。
 *
 * 为什么不用 `import.meta.resolve` / `createRequire` 找 Origin 插件：那两样只能解析
 * **本包的**依赖图，而 Origin 插件是用户自己装进 profile 的、和本包没有依赖关系。
 * 因此这里直接按 DSH 的目录约定探测文件是否存在（`existsSync` 是纯读操作，无副作用）。
 *
 * 设计口径：所有 `resolve*` 函数都**不抛异常**，找不到就返回 null，由调用方决定
 * 怎么退化（面板是辅助视图，路径缺失必须变成一句人话，而不是一次崩溃）。
 */

import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';

/** 环境变量名（新名在前，旧名保留兼容；公开文档里只写新名）。 */
export const ENV = Object.freeze({
  /** 科研库根目录。 */
  library: 'SCIWORK_LIBRARY',
  /** 库根的旧名（科研模式私有时期用的名字，保留兼容）。 */
  libraryLegacy: 'RESEARCH_LIBRARY',
  /** Python 解释器绝对路径。 */
  python: 'SCIWORK_PYTHON',
  /** 上游 Origin 插件目录。 */
  originPlugin: 'SCIWORK_ORIGIN_PLUGIN',
});

/** 科研库默认目录名：`<用户目录>/Research`。 */
export const DEFAULT_LIBRARY_DIRNAME = 'Research';

/** 上游插件的 npm 包名（spike 探测用）。 */
export const ORIGIN_PLUGIN_PACKAGE = 'dsh-origin-plugin';

/** 本包名（日志、诊断信息用）。 */
export const PACKAGE_NAME = 'dsh-sciwork';

/** 用户目录（`~`）。 */
export const homeDir = () => os.homedir();

/** 库内配置目录名（`.research`，由 research.py 维护）。 */
export const IN_LIBRARY_DIR = '.research';

/** 取环境变量，空串按未设置处理。 */
function env(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/* --------------------------------------------------------------- 库根 */

/** 环境变量里显式指定的库根（新名优先，旧名兼容）；都没设返回 null。 */
export const envLibraryRoot = () => env(ENV.library) || env(ENV.libraryLegacy);

/**
 * 科研库根目录。
 * @param {string|null} [configured] 显式配置（库内配置优先于它，调用方负责合并）。
 * @returns {string} 绝对路径。
 */
export function resolveLibraryRoot(configured) {
  const explicit = configured || envLibraryRoot();
  if (explicit) return path.resolve(explicit);
  return path.join(homeDir(), DEFAULT_LIBRARY_DIRNAME);
}

/** 库内那份权威配置的路径：`<库根>/.research/config.json`。 */
export const inLibraryConfigPath = (root) => path.join(root, IN_LIBRARY_DIR, 'config.json');

/** 库内 Python 启动器（Windows 批处理；安装器会写它）。 */
export const launcherPath = (root) =>
  process.platform === 'win32'
    ? path.join(root, IN_LIBRARY_DIR, 'bin', 'py.cmd')
    : path.join(root, IN_LIBRARY_DIR, 'bin', 'py');

/* --------------------------------------------------------------- DSH 目录 */

/** DSH 主目录：`DSH_HOME` → `<用户目录>/.dsh`。 */
export function dshHome() {
  return env('DSH_HOME') || path.join(homeDir(), '.dsh');
}

/**
 * 当前 profile 目录：`DSH_PROFILE_DIR` → `<DSH_HOME>/profiles/<DSH_PROFILE>` → null。
 * 拿不到就返回 null（CLI 脚本可以要求用户用 `--profile` 显式给）。
 */
export function profileDir() {
  const explicit = env('DSH_PROFILE_DIR');
  if (explicit) return path.resolve(explicit);
  const name = env('DSH_PROFILE');
  if (name) return path.join(dshHome(), 'profiles', name);
  return null;
}

/* --------------------------------------------------------------- Python */

/** venv 里的解释器路径（Windows 与 POSIX 布局不同）。 */
export function venvPython(venvDir) {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python3');
}

/**
 * 在 PATH 里找可执行文件（`which` 的纯 JS 版；不 spawn 任何进程）。
 * Windows 上按 `PATHEXT` 补扩展名。找不到返回 null。
 */
export function which(cmd) {
  if (!cmd || typeof cmd !== 'string') return null;
  if (cmd.includes('/') || cmd.includes('\\') || path.isAbsolute(cmd)) {
    return existsSync(cmd) ? path.resolve(cmd) : null;
  }
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Python 解释器候选列表（按优先级，含不存在项，供报错文案展示）。
 * 顺序与库内启动器 `library/bin/py.cmd` 保持一致。
 * @param {{root?:string, interpreter?:string, originPluginDir?:string}} [opts]
 * @returns {string[]}
 */
export function pythonCandidates(opts = {}) {
  const root = opts.root ? path.resolve(opts.root) : null;
  const list = [];
  const push = (p) => { if (p && !list.includes(p)) list.push(p); };

  push(opts.interpreter);
  push(env(ENV.python));
  if (root) {
    push(venvPython(path.join(root, '.venv')));
    push(venvPython(path.join(root, IN_LIBRARY_DIR, '.venv')));
  }
  const origin = opts.originPluginDir || resolveOriginPluginDir();
  if (origin) push(venvPython(path.join(origin, '.venv')));
  // 最后才是 PATH：能跑就行，跑不了由调用方给出人话。
  push(process.platform === 'win32' ? 'python' : 'python3');
  push(process.platform === 'win32' ? 'py' : 'python');
  return list;
}

/**
 * 挑一个**真的能用**的 Python 解释器：优先绝对路径候选里存在的那个，
 * 都不存在时看 PATH（`which`），仍找不到返回 null。
 * @param {{root?:string, interpreter?:string, originPluginDir?:string}} [opts]
 * @returns {string|null} 绝对路径，或 PATH 上的命令名。
 */
export function pickPython(opts = {}) {
  const candidates = pythonCandidates(opts);
  for (const c of candidates) if (c && existsSync(c)) return c;
  for (const c of candidates) {
    if (!c || c.includes('/') || c.includes('\\')) continue;
    const found = which(c);
    if (found) return found;
  }
  return null;
}

/* --------------------------------------------------------------- Origin 插件 */

/**
 * 上游 Origin 插件目录：显式 → `SCIWORK_ORIGIN_PLUGIN` → `<profile>/node_modules/dsh-origin-plugin`。
 * @param {string|null} [configured]
 * @returns {string|null}
 */
export function resolveOriginPluginDir(configured) {
  const explicit = configured || env(ENV.originPlugin);
  if (explicit && existsSync(explicit)) return path.resolve(explicit);
  const profile = profileDir();
  const guesses = [];
  if (profile) guesses.push(path.join(profile, 'node_modules', ORIGIN_PLUGIN_PACKAGE));
  guesses.push(path.join(dshHome(), 'profiles', 'desktop', 'node_modules', ORIGIN_PLUGIN_PACKAGE));
  for (const g of guesses) if (existsSync(g)) return path.resolve(g);
  return explicit ? path.resolve(explicit) : null;
}

/**
 * Origin MCP server 脚本（`origin_mcp_server.py`）：显式 → 插件目录下探测。
 * @param {{pluginDir?:string|null, server?:string|null}} [opts]
 * @returns {string|null}
 */
export function resolveOriginServer(opts = {}) {
  const explicit = opts.server;
  if (explicit && existsSync(explicit)) return path.resolve(explicit);
  const dir = resolveOriginPluginDir(opts.pluginDir);
  if (dir) {
    for (const name of ['origin_mcp_server.py', 'origin_mcp_stdio.py']) {
      const p = path.join(dir, name);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/* --------------------------------------------------------------- 诊断 */

/**
 * 一份给人和给日志看的解析结果快照（面板/CLI 诊断用）。
 * @param {{libraryRoot?:string, originPluginDir?:string}} [opts]
 */
export function describePaths(opts = {}) {
  const root = resolveLibraryRoot(opts.libraryRoot);
  const originDir = resolveOriginPluginDir(opts.originPluginDir);
  return {
    packageName: PACKAGE_NAME,
    platform: process.platform,
    libraryRoot: root,
    libraryRootExists: existsSync(root),
    inLibraryConfig: inLibraryConfigPath(root),
    launcher: launcherPath(root),
    profileDir: profileDir(),
    originPluginDir: originDir,
    originServer: resolveOriginServer({ pluginDir: originDir }),
    python: pickPython({ root, originPluginDir: originDir }),
    pythonCandidates: pythonCandidates({ root, originPluginDir: originDir }),
    env: {
      [ENV.library]: env(ENV.library),
      [ENV.libraryLegacy]: env(ENV.libraryLegacy),
      [ENV.python]: env(ENV.python),
      [ENV.originPlugin]: env(ENV.originPlugin),
      DSH_HOME: env('DSH_HOME'),
      DSH_PROFILE: env('DSH_PROFILE'),
      DSH_PROFILE_DIR: env('DSH_PROFILE_DIR'),
    },
  };
}

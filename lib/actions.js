/**
 * 科研模式 · 面板动作分发（宿主侧，0.3 薄适配层）
 * ---------------------------------------------------------------------------
 * 0.2 时这里是一整张 switch；0.3 把实现搬进 `lib/actions/*` + 登记表，
 * 本文件只剩三件事：
 *   1. 保持旧导出不变（`ACTIONS` / `handleResearchCall` / `probePathGuard` /
 *      命令台元数据），旧面板与 `scripts/selftest-actions.mjs` 零改动；
 *   2. 把 `{action,args}` 交给执行器（旧名走 `confirm:'legacy'`：同请求内代签令牌）；
 *   3. 维持旧的错误信封与路径护栏探针。
 *
 * 纪律：本文件不再实现任何库操作，也不再拼 research.py 命令。
 */

import { loadSettings, resolveInside } from './library.js';
import { CLI_COMMANDS, CLI_HINTS, buildCliArgs, parseRawArgs } from './host/cli.js';
import { fail } from './host/errors.js';
import { callLegacy, ensureRegistered, LEGACY_ORDER } from './actions/index.js';

/** 面板能看懂的动作名（顺序即协议，勿改）。 */
export const ACTIONS = LEGACY_ORDER;

export { CLI_COMMANDS, CLI_HINTS, buildCliArgs, parseRawArgs };

/** 必须带 path 参数的只读动作。空 path 属于**客户端错误**，不要混进 denied（那是安全拒绝）。 */
const PATH_ACTIONS = new Set(['readText', 'readBinary', 'tableColumns', 'checkCitations']);

const asString = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * 处理一次面板调用（旧信封，深比较不许变）。
 * @param {unknown} payload - 线上下来的 `{ action, args }`（可能是任何东西，需自证）。
 * @returns {Promise<{ok:true,value:unknown}|{ok:false,error:{code:string,message:string,details:object}}>}
 */
export async function handleResearchCall(payload) {
  const body = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  const action = asString(body.action);
  const args = (body.args && typeof body.args === 'object' && !Array.isArray(body.args)) ? body.args : {};

  if (!action) return fail('bad-request', `缺少 action。可用动作：${ACTIONS.join(', ')}`);
  if (!ACTIONS.includes(action)) {
    return fail('bad-request', `未知动作：${action}。可用动作：${ACTIONS.join(', ')}`);
  }
  if (PATH_ACTIONS.has(action) && !asString(args.path)) {
    return fail('bad-request', `${action} 需要 path（库根相对路径）`);
  }

  try {
    ensureRegistered();
    return await callLegacy(action, args, { source: 'panel' });
  } catch (error) {
    return fail('internal', String((error && error.message) || error || '未知错误'), { action });
  }
}

/** 给宿主半边自检用：确认路径约束在真实库上生效。 */
export async function probePathGuard() {
  const settings = await loadSettings();
  const probes = ['..\\..\\windows\\win.ini', 'C:\\Windows\\win.ini', '/etc/passwd'];
  const results = [];
  for (const p of probes) {
    try {
      resolveInside(settings.root, p);
      results.push({ path: p, rejected: false, note: '未被拒绝（这是缺陷！）' });
    } catch (error) {
      results.push({ path: p, rejected: true, note: String(error.message) });
    }
  }
  return results;
}

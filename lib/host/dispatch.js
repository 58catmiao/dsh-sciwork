/**
 * 科研模式 0.3 · 执行器
 * ---------------------------------------------------------------------------
 * 三条入口（面板 / agent / CLI）只调这里，不各自拼命令、不各自读库。
 * 流程固定（PLAN §5.2）：
 *   查表 → 校验参数 → 守卫 →（写动作）验令牌 → 执行 → 写回执 → 返回
 * 任何一步失败都返回 `{ok:false, error}`，绝不把异常抛到信封层。
 *
 * 返回值形状（§5.2）：
 *   { ok:true, value, receipt } | { ok:false, error }
 */

import { describeError, fail, ResearchError } from './errors.js';
import {
  consumePlan,
  idempotencyKey,
  issueLegacyToken,
  issuePlan,
  lookupIdempotent,
  needsConfirm,
  paramsHash,
  rememberIdempotent,
} from './guards.js';
import { appendReceipt, newReceiptId, readReceipts, summarizeReceipt } from './receipts.js';
import { listActions, resolveAction, validateParams } from './registry.js';
import { settingsNow } from './engine.js';

/** 默认执行超时；动作可用 `timeoutMs` 覆盖（Origin/重画给 300s，走动作自己的值）。 */
export const DEFAULT_TIMEOUT_MS = 90_000;

/** 注入日志（宿主装配时设置；测试里保持 noop）。 */
let logger = { info() {}, warn() {} };
export function setDispatchLogger(next) { if (next) logger = next; }

/** 给测试/自检用：清空内存态（计划 + 幂等）。 */
export { resetGuardState } from './guards.js';

/** 从回执/结果里抽「写了哪些库内相对路径」。 */
function wroteFrom(value) {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.wrote)) return value.wrote.map(String);
  const out = [];
  for (const key of ['output', 'path', 'file', 'draft', 'package', 'trace', 'rel']) {
    if (typeof value[key] === 'string' && value[key]) out.push(value[key]);
  }
  return [...new Set(out)];
}

function warningsFrom(value) {
  return value && Array.isArray(value.warnings) ? value.warnings.map(String) : [];
}

function summaryFrom(value) {
  if (!value || typeof value !== 'object') return '';
  for (const key of ['summary', 'message', 'title', 'output', 'path', 'draft']) {
    if (typeof value[key] === 'string' && value[key]) return value[key];
  }
  return '';
}

/**
 * 生成计划（写动作的第一步）。读动作也可以调：返回 `diff: []` 与 `confirm:'never'`，
 * 面板据此决定「直接执行」还是「弹确认框」。
 */
export function planAction(actionIdOrAlias, params, ctx = {}) {
  const action = resolveAction(actionIdOrAlias);
  if (!action) return fail('bad-request', `未知动作：${actionIdOrAlias}。可用动作：${listActions().map((a) => a.id).join(', ')}`);
  let clean;
  try {
    clean = validateParams(action, params);
  } catch (error) {
    const d = describeError(error);
    return { ok: false, error: { code: d.code === 'internal' ? 'schema' : d.code, message: d.message, details: d.details } };
  }
  const root = ctx.root || (ctx.settings && ctx.settings.root) || '';
  let preview = null;
  try {
    preview = typeof action.preview === 'function' ? action.preview(ctx, clean) : null;
  } catch (error) {
    const d = describeError(error);
    return { ok: false, error: { code: d.code, message: d.message, details: d.details } };
  }
  if (action.effects === 'read' || action.confirm === 'never') {
    return {
      ok: true,
      value: {
        actionId: action.id, title: action.title, effects: action.effects, confirm: action.confirm,
        paramsHash: paramsHash(clean), confirmRequired: false, params: clean,
        summary: (preview && preview.summary) || '', diff: (preview && preview.diff) || [],
        writes: (preview && preview.writes) || [], warnings: (preview && preview.warnings) || [],
      },
    };
  }
  const issued = issuePlan({ action, params: clean, root, ...(preview || {}) });
  return {
    ok: true,
    value: {
      actionId: action.id, title: action.title, effects: action.effects, confirm: action.confirm,
      confirmRequired: true, params: clean, ...issued,
    },
  };
}

function runWithTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ResearchError('timeout', `${label} 超时（${Math.round(ms / 1000)}s）`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * 执行一次动作。
 * @param {string} actionIdOrAlias 新 id 或旧动作名
 * @param {object} params
 * @param {{source?:string, planId?:string, confirmToken?:string, actor?:string,
 *          settings?:object, root?:string, echoReceipt?:boolean}} ctx
 */
export async function dispatch(actionIdOrAlias, params, ctx = {}) {
  const startedAtMs = Date.now();
  const source = ctx.source || 'panel';
  const action = resolveAction(actionIdOrAlias);
  if (!action) {
    return fail('bad-request', `未知动作：${actionIdOrAlias}。可用动作：${listActions().map((a) => a.id).join(', ')}`);
  }
  const legacyName = action.legacy && action.legacy.includes(String(actionIdOrAlias)) ? String(actionIdOrAlias) : null;

  let clean;
  try {
    clean = validateParams(action, params);
  } catch (error) {
    const d = describeError(error);
    return { ok: false, error: { code: d.code === 'internal' ? 'schema' : d.code, message: d.message, details: d.details } };
  }

  const settings = ctx.settings || null;
  const root = ctx.root || (settings && settings.root) || '';
  if (!root) return fail('internal', '执行器没有拿到库根（settings.root）', { action: action.id });

  const warnings = [];
  let confirmation = 'none';
  try {
    if (needsConfirm(action)) {
      // 旧名调用一律走兼容口：旧面板没有「计划/令牌」两步，还要零改动。
      // 新 id 调用（含面板 0.3 的 `library.remove`）必须持真令牌。
      if (action.confirm === 'legacy' || legacyName) {
        const implicit = issueLegacyToken({ action, params: clean, root });
        confirmation = 'legacy-implicit';
        warnings.push(`兼容口：旧动作名「${legacyName || action.id}」在本次请求内代签并消费了确认令牌（confirmation=legacy-implicit）；新动作需先 action.plan 再确认。`);
        void implicit;
      } else {
        const planId = ctx.planId || (params && params.planId);
        // 两个字段名都收：面板/工具走 action.confirm 时统一叫 confirmToken，
        // 自动化脚本习惯写 token；指向同一把一次性令牌，别名不改变语义。
        const token = ctx.confirmToken || ctx.token || (params && (params.confirmToken || params.token));
        consumePlan({ planId, token, actionId: action.id, params: clean, root });
        confirmation = 'token';
      }
    }
  } catch (error) {
    const d = describeError(error);
    return { ok: false, error: { code: d.code, message: d.message, details: { ...d.details, action: action.id } } };
  }

  const idemKey = action.effects !== 'read' ? idempotencyKey({ action, params: clean, root }) : null;
  if (idemKey) {
    const hit = lookupIdempotent(idemKey);
    if (hit) {
      logger.info(`[research] ${action.id} 幂等命中，回放上次回执 ${hit.receiptId}`);
      return { ok: true, value: hit.value, receipt: hit.receipt, replayed: true };
    }
  }

  // 只有会动库的动作才留回执：读动作（面板每次刷新都会调）不留，否则日志会被读操作淹掉，
  // 而且一次纯浏览就改写库里的 `.research/receipts` 也不合适。需要审计读时传 ctx.auditReads。
  const audited = action.effects !== 'read' || ctx.auditReads === true;
  const receiptId = audited ? newReceiptId(startedAtMs) : null;
  const receipt = {
    receiptId, action: action.id, legacyName, source,
    actor: String(ctx.actor || source), paramsHash: paramsHash(clean),
    confirmation, engine: action.engine, ok: true,
    startedAt: new Date(startedAtMs).toISOString(), startedAtMs,
    durationMs: 0, wrote: [], warnings, summary: '',
  };

  const executionCtx = {
    settings, root, source, action, params: clean, receiptId,
    warnings,
    confirm: { mode: confirmation },
    log: logger,
  };

  let value;
  const timeoutMs = Number(action.timeoutMs) > 0 ? Number(action.timeoutMs) : DEFAULT_TIMEOUT_MS;
  try {
    value = await runWithTimeout(Promise.resolve().then(() => action.run(executionCtx, clean)), timeoutMs, action.title || action.id);
  } catch (error) {
    const d = describeError(error);
    receipt.ok = false;
    receipt.durationMs = Date.now() - startedAtMs;
    receipt.error = { code: d.code, message: d.message };
    if (audited) {
      const written = appendReceipt(root, receipt);
      if (!written.ok) logger.warn(`[research] 回执落盘失败：${written.error}`);
    }
    logger.warn(`[research] ${action.id} 失败：${d.code} ${d.message}`);
    return { ok: false, error: { code: d.code, message: d.message, details: { ...d.details, action: action.id, ...(receiptId ? { receiptId } : {}) } } };
  }

  receipt.durationMs = Date.now() - startedAtMs;
  receipt.wrote = wroteFrom(value);
  receipt.summary = summaryFrom(value);
  for (const w of warningsFrom(value)) if (!warnings.includes(w)) warnings.push(w);
  receipt.warnings = warnings;

  if (!audited) {
    logger.info(`[research] ${action.id} ok ${receipt.durationMs}ms（读动作，不留回执）`);
    return { ok: true, value, receipt: null };
  }
  const written = appendReceipt(root, receipt);
  if (!written.ok) {
    receipt.warnings.push(`回执落盘失败：${written.error}`);
    logger.warn(`[research] 回执落盘失败：${written.error}`);
  }
  receipt.receiptPath = written.rel;

  if (idemKey) rememberIdempotent(idemKey, { value, receipt });
  logger.info(`[research] ${action.id} ok ${receipt.durationMs}ms receipt=${receiptId}`);
  return { ok: true, value, receipt };
}

/**
 * 兼容口：旧面板只发 `{action, args}`。
 * 旧动作名走 `confirm:'legacy'`（请求内代签令牌）；旧信封只保留 `{ok, value|error}`，
 * 不把 receipt 塞进去，避免旧客户端深比较回归。
 */
export async function dispatchLegacy(actionName, args, ctx = {}) {
  const action = resolveAction(actionName);
  if (!action) {
    return fail('bad-request', `未知动作：${actionName}。可用动作：${listActions().map((a) => a.id).join(', ')}`);
  }
  const withSettings = ctx.settings || ctx.root ? ctx : { ...ctx, settings: await settingsNow() };
  const out = await dispatch(actionName, args, { ...withSettings, source: ctx.source || 'panel' });
  if (out.ok) return { ok: true, value: out.value };
  // 旧面板只认 0.2 的 8 个错误码：参数形状问题在兼容口一律报 bad-request。
  const error = out.error.code === 'schema' ? { ...out.error, code: 'bad-request' } : out.error;
  return { ok: false, error };
}

/** 读回执（`system.receipts` / 面板「最近操作」共用）。 */
export function recentReceipts(root, limit = 20) {
  try {
    return { ok: true, value: readReceipts(root, { limit }).map(summarizeReceipt) };
  } catch (error) {
    return fail('internal', String((error && error.message) || error));
  }
}

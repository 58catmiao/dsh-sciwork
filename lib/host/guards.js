/**
 * 科研模式 0.3 · 守卫：路径闸门 / effects 分级 / 确认令牌 / 幂等
 * ---------------------------------------------------------------------------
 * 写动作（`effects !== 'read'` 且 `confirm !== 'never'`）一律两步：
 *   1) `action.plan`  → 改动摘要 + planId + 一次性 token（5 分钟，绑定 actionId+参数哈希+库根）
 *   2) `dispatch(..., { planId, confirmToken })` → 校验并**消费**令牌，再执行
 *
 * 令牌只活在宿主进程内存里：宿主重启后旧计划自然失效（这正是我们要的）。
 * 消费是一次性的（用后即删），参数变了哈希对不上直接拒绝。
 *
 * 兼容口（PLAN §12）：旧动作名在 0.3 期间必须可用，而旧面板不会「先计划再确认」。
 * 因此 `confirm: 'legacy'` 的兼容动作走 `issueLegacyToken`：同一次调用内签发并立即
 * 消费一个令牌，回执里记 `confirmation: 'legacy-implicit'` 并附 warning。
 * 令牌闸门仍然经过，只是由兼容层代签——新动作面永远拿不到这条捷径。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

import { resolveInside } from '../library.js';
import { badRequest, denied, notFound, ResearchError } from './errors.js';

export const EFFECTS = Object.freeze(['read', 'write', 'external']);
export const CONFIRM_MODES = Object.freeze(['never', 'write', 'always', 'legacy']);
export const SOURCES = Object.freeze(['panel', 'agent', 'cli', 'cycle']);

/** 计划默认寿命（PLAN §5.3：5 分钟）。 */
export const PLAN_TTL_MS = 5 * 60 * 1000;

/**
 * 库根相对路径 → 绝对路径；逃逸/绝对路径/空路径都是 `denied`。
 * 这是所有路径参数的**唯一**入口（旧 `resolveInside` 的语义保持不变）。
 */
export function resolvePath(root, rel) {
  try {
    return resolveInside(root, rel);
  } catch (error) {
    const message = String((error && error.message) || error);
    if (message === '空路径') throw badRequest(message);
    throw denied(message, { path: String(rel ?? '') });
  }
}

/** 确认写动作前先确认文件在库里，避免「计划看起来可行、执行才发现没有」。 */
export function requireExisting(root, rel) {
  const abs = resolvePath(root, rel);
  if (!fs.existsSync(abs)) throw notFound(`文件不存在：${String(rel)}`);
  return abs;
}

/** 稳定序列化（键排序），保证同样的参数永远得到同样的哈希。 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export function paramsHash(params) {
  return `sha256:${crypto.createHash('sha256').update(stableStringify(params ?? {})).digest('hex')}`;
}

/** 写动作是否需要确认令牌。 */
export function needsConfirm(action) {
  if (!action || action.effects === 'read') return false;
  return action.confirm !== 'never';
}

/* ---------------------------------------------------------------- 计划存储 */

/** planId → {tokenHash, actionId, paramsHash, root, expiresAt} */
const PLANS = new Map();

const purge = () => {
  const now = Date.now();
  for (const [id, plan] of PLANS) if (plan.expiresAt <= now) PLANS.delete(id);
};

const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/**
 * 签发计划。
 * @param {{action: object, params: object, root: string, diff?: object[]|string[], writes?: string[], warnings?: string[]}} input
 * @returns {{planId:string, token:string, actionId:string, title:string, effects:string,
 *            engine:string, confirm:string, paramsHash:string, expiresAt:string,
 *            diff:object[], writes:string[], warnings:string[]}}
 */
export function issuePlan({ action, params, root, diff, writes, warnings, ttlMs = PLAN_TTL_MS }) {
  purge();
  const token = crypto.randomBytes(24).toString('hex');
  const planId = `p_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
  const expiresAt = Date.now() + ttlMs;
  PLANS.set(planId, {
    tokenHash: tokenHash(token),
    actionId: action.id,
    paramsHash: paramsHash(params),
    root: String(root),
    expiresAt,
  });
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  return {
    planId,
    token,
    actionId: action.id,
    title: action.title,
    effects: action.effects,
    engine: action.engine,
    confirm: action.confirm,
    paramsHash: paramsHash(params),
    expiresAt: new Date(expiresAt).toISOString(),
    diff: list(diff),
    writes: list(writes),
    warnings: list(warnings),
  };
}

/**
 * 校验并消费令牌。一次性：校验通过就删，重复用 → `denied`。
 * @returns {{ok:true}}
 */
export function consumePlan({ planId, token, actionId, params, root }) {
  purge();
  const id = String(planId || '');
  const plan = PLANS.get(id);
  // 「根本没带计划」和「计划坏了」是两件事：前者是正常的第一阶段（面板据此弹确认框），
  // 后者才是拒绝。混成一个码会让面板没法区分「要不要确认」和「确认被拒」。
  if (!id && !token) {
    throw new ResearchError('needs-confirmation',
      `${actionId} 是写动作：先 action.plan 生成计划，再带 planId + token 执行（5 分钟内有效）`,
      { planId: '', planRequired: true });
  }
  if (!plan) throw denied('计划不存在或已过期（重新发起 action.plan）', { planId: id, planRequired: true });
  if (plan.expiresAt <= Date.now()) {
    PLANS.delete(id);
    throw denied('计划已过期（5 分钟），重新发起 action.plan', { planId: id, planRequired: true });
  }
  if (!token || !safeEqual(plan.tokenHash, tokenHash(token))) {
    throw denied('确认令牌不匹配', { planId: id, planRequired: true });
  }
  if (plan.actionId !== actionId) {
    throw denied(`计划绑定的动作是 ${plan.actionId}，不是 ${actionId}`, { planId: id, planRequired: true });
  }
  if (plan.paramsHash !== paramsHash(params)) {
    throw denied('参数与计划不一致（令牌已失效，请重新计划）', { planId: id, planRequired: true });
  }
  if (plan.root !== String(root)) {
    throw denied('计划绑定的库根与当前库根不一致', { planId: id, planRequired: true });
  }
  PLANS.delete(id);   // 一次性：先删再执行，执行失败也不能复用
  return { ok: true };
}

/**
 * 兼容口：给旧动作名代签一个「同请求令牌」。
 * 不落进 PLANS（无需二次调用），但走与 consumePlan 相同的绑定检查语义：
 * 返回值只用于回执里注明确认来源，不改变参数。
 */
export function issueLegacyToken({ action, params, root }) {
  return {
    planId: `legacy_${crypto.randomBytes(6).toString('hex')}`,
    token: crypto.randomBytes(12).toString('hex'),
    actionId: action.id,
    paramsHash: paramsHash(params),
    root: String(root),
    implicit: true,
    expiresAt: new Date().toISOString(),
  };
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

/* ------------------------------------------------------------------ 幂等 */

/**
 * 幂等键：同一 actionId + 参数 + 库根 + 时间窗内重复执行，dispatch 会先把上一次的
 * 回执找出来（`idempotency: 'replayed'`），而不是再跑一遍。窗口默认 10 分钟。
 */
const IDEMPOTENCY_WINDOW_MS = 10 * 60 * 1000;
const IDEMPOTENT_RESULTS = new Map();

export function idempotencyKey({ action, params, root }) {
  return `${action.id}|${paramsHash(params)}|${root}`;
}

export function lookupIdempotent(key) {
  const hit = IDEMPOTENT_RESULTS.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > IDEMPOTENCY_WINDOW_MS) {
    IDEMPOTENT_RESULTS.delete(key);
    return null;
  }
  return hit.value;
}

export function rememberIdempotent(key, value) {
  IDEMPOTENT_RESULTS.set(key, { at: Date.now(), value });
  if (IDEMPOTENT_RESULTS.size > 200) {
    const oldest = [...IDEMPOTENT_RESULTS.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) IDEMPOTENT_RESULTS.delete(oldest[0]);
  }
}

/** 给测试用：清空内存态（令牌 + 幂等）。 */
export function resetGuardState() {
  PLANS.clear();
  IDEMPOTENT_RESULTS.clear();
}

export const planCount = () => PLANS.size;

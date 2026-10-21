/**
 * 科研模式 0.3 · 动作域：能力自述（catalog / plan / confirm）
 * ---------------------------------------------------------------------------
 * 这三个动作让「内置动作面」和「动作登记表」的用法一致：
 *   - `action.catalog` 给面板/agent 自述有哪些能力（不含任何本机路径）；
 *   - `action.plan` + `action.confirm` 是写动作的两步确认（令牌一次性、参数哈希锁定）。
 * 旧面板不需要它们：旧名走 `confirm:'legacy'`，同请求内代签并消费令牌。
 */

import { catalog, legacyNames, ENGINES } from '../host/registry.js';
import { planAction, dispatch } from '../host/dispatch.js';
import { badRequest, ResearchError } from '../host/errors.js';
import { asString } from '../host/engine.js';
import { PROTOCOL } from '../adapters/python.js';
import { CONFIRM_MODES, EFFECTS, SOURCES } from '../host/guards.js';

const throwEnvelope = (out) => {
  throw new ResearchError(out.error.code, out.error.message, out.error.details);
};

export const actionCatalog = {
  id: 'action.catalog',
  title: '能力清单',
  domain: 'action',
  description: '列出已登记动作、旧名别名与出口（面板「我能做什么」/ agent 工具发现）',
  params: {
    type: 'object', additionalProperties: false,
    properties: {
      domain: { type: 'string', maxLength: 40 },
      effects: { type: 'string', maxLength: 20 },
      exposedOnly: { type: 'boolean', default: false },
    },
  },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  idempotent: true,
  ui: { view: 'library' },
  tool: { expose: true, name: 'sciwork_action_catalog' },
  run: async (ctx, params) => {
    let actions = catalog();
    const domain = asString(params.domain);
    const effects = asString(params.effects);
    if (domain) actions = actions.filter((a) => a.domain === domain);
    if (effects) actions = actions.filter((a) => a.effects === effects);
    if (params.exposedOnly === true) actions = actions.filter((a) => Boolean(a.tool));
    return {
      protocol: PROTOCOL,
      actions,
      legacy: legacyNames(),
      engines: ENGINES, effects: EFFECTS, confirmModes: CONFIRM_MODES, sources: SOURCES,
    };
  },
};

export const actionPlan = {
  id: 'action.plan',
  title: '生成计划（写动作第一步）',
  domain: 'action',
  description: '校验参数、算 diff/写入清单，签发一次性确认令牌（5 分钟过期）',
  params: {
    type: 'object', required: ['actionId'], additionalProperties: false,
    properties: {
      actionId: { type: 'string', maxLength: 80 },
      params: { type: 'object' },
    },
  },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  idempotent: true,
  ui: { view: 'library' },
  tool: { expose: true, name: 'sciwork_action_plan' },
  run: async (ctx, params) => {
    const actionId = asString(params.actionId);
    if (!actionId) throw badRequest('action.plan 需要 actionId');
    const out = planAction(actionId, params.params || {}, ctx);
    if (!out.ok) throwEnvelope(out);
    return out.value;
  },
};

export const actionConfirm = {
  id: 'action.confirm',
  title: '执行计划（写动作第二步）',
  domain: 'action',
  description: '带 planId+token 执行目标动作；令牌一次性，参数被改过会被拒',
  params: {
    type: 'object', required: ['actionId'], additionalProperties: false,
    properties: {
      actionId: { type: 'string', maxLength: 80 },
      planId: { type: 'string', maxLength: 120 },
      token: { type: 'string', maxLength: 200 },
      params: { type: 'object' },
    },
  },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  idempotent: true,
  ui: { view: 'library' },
  tool: { expose: true, name: 'sciwork_action_confirm' },
  run: async (ctx, params) => {
    const actionId = asString(params.actionId);
    if (!actionId) throw badRequest('action.confirm 需要 actionId');
    const out = await dispatch(actionId, params.params || {}, {
      ...ctx,
      planId: asString(params.planId) || undefined,
      confirmToken: asString(params.token) || undefined,
      source: ctx.source || 'agent',
    });
    if (!out.ok) throwEnvelope(out);
    return { value: out.value, receipt: out.receipt };
  },
};

export const ACTION_ACTIONS = [actionCatalog, actionPlan, actionConfirm];

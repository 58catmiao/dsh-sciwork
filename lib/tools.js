/**
 * 科研模式 0.3 · 工具暴露（PLAN §10.2）
 * ---------------------------------------------------------------------------
 * 把 `tool.expose: true` 的动作映射成宿主工具（名字显式写在描述符的 `tool.name`，
 * 不从 id 猜）；读动作直接可调，写动作第一次只回计划，必须再调 `sciwork_action_confirm`。
 *
 * 两条硬约束（2026-10-21 对照本机 dsh-comfyui-image 的实现核对）：
 *   1. `tools.register()` 吃普通对象，**不 import 任何 @deepseek-ai/* 宿主包**
 *      （link 安装时从物理路径解析必 ERR_MODULE_NOT_FOUND）。
 *   2. DSH 的 JSON Schema 是子集：`minimum`/`maximum`/`format`/联合类型会被拒，
 *      所以这里把动作参数 schema 窄化成工具 schema，运行时校验仍走 `validateParams`。
 */

import { ensureRegistered } from './actions/index.js';
import { catalog } from './host/registry.js';
import { dispatch, planAction } from './host/dispatch.js';
import { settingsNow } from './host/engine.js';
import { describeError } from './host/errors.js';

/** 工具结果里允许回显的文本上限（避免把整库快照塞进对话）。 */
const RENDER_LIMIT = 6000;

/** 把动作参数 schema 窄化成 DSH 支持的工具 schema（丢掉宿主不认的键）。 */
export function toToolSchema(schema) {
  if (!schema || typeof schema !== 'object') return { type: 'object', properties: {} };
  const out = { type: pickType(schema.type) };
  if (schema.description) out.description = String(schema.description);
  if (out.type === 'object') {
    out.properties = {};
    const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
    for (const [key, value] of Object.entries(props)) {
      out.properties[key] = toToolSchema(value);
      if (value && value.description) out.properties[key].description = String(value.description);
      if (value && Array.isArray(value.enum)) out.properties[key].enum = value.enum.map(String);
    }
    if (Array.isArray(schema.required) && schema.required.length) out.required = schema.required.map(String);
    out.additionalProperties = schema.additionalProperties === false ? false : true;
  }
  if (out.type === 'array') out.items = toToolSchema(schema.items);
  return out;
}

function pickType(type) {
  if (Array.isArray(type)) {
    const found = type.find((t) => t && t !== 'null') || 'string';
    return pickType(found);
  }
  if (type === 'object' || type === 'array' || type === 'number' || type === 'integer' || type === 'boolean') return type;
  return 'string';
}

/** 工具返回：给模型看的一段 JSON（截断），面板与 CLI 看到的仍是完整回执。 */
function renderValue(value) {
  let text;
  try { text = JSON.stringify(value, null, 1); } catch { text = String(value); }
  if (text.length > RENDER_LIMIT) text = `${text.slice(0, RENDER_LIMIT)}\n…（已截断）`;
  return [{ type: 'text', text: text || '（空）' }];
}

function toolDescription(action) {
  const parts = [action.title, action.description].filter(Boolean);
  parts.push(`effects: ${action.effects}；confirm: ${action.confirm}。`);
  if (action.effects !== 'read') {
    parts.push('这是写动作：直接调用只会返回计划（needs-confirmation）；把计划给用户看、得到同意后，再调 sciwork_action_confirm 带 planId+token 执行。');
  }
  return parts.join('\n');
}

/**
 * 注册全部暴露动作。
 * @param {object} tools - 宿主工具注册表（有 register 方法）。
 * @param {{logger?:object}} [opts]
 * @returns {{registered:string[], failed:{name:string,error:string}[]}}
 */
export function registerSciworkTools(tools, { logger } = {}) {
  const log = logger || { info() {}, warn() {} };
  if (!tools || typeof tools.register !== 'function') return { registered: [], failed: [{ name: '*', error: 'no tools registry' }] };
  ensureRegistered();
  const registered = [];
  const failed = [];
  const seen = new Set();
  for (const action of catalog()) {
    // registry.catalog() 把 tool 收窄成「已暴露的工具名」字符串（null = 不暴露）。
    const toolName = typeof action.tool === 'string' ? action.tool : (action.tool && action.tool.expose ? action.tool.name : null);
    if (!toolName) continue;
    if (seen.has(toolName)) { failed.push({ name: toolName, error: `工具名重复：${action.id}` }); continue; }
    seen.add(toolName);
    try {
      tools.register({
        name: toolName,
        description: toolDescription(action),
        parameters: toToolSchema(action.params),
        output: { schema: { type: 'object' }, render: (_args, value) => renderValue(value) },
        async execute(args) {
          const settings = await settingsNow();
          const out = await dispatch(action.id, args || {}, { source: 'agent', root: settings.root });
          if (out.ok) return { ok: true, action: action.id, value: out.value, receipt: out.receipt || null };
          const d = out.error || { code: 'internal', message: '未知错误' };
          const error = new Error(`${d.code}: ${d.message}`);
          error.code = d.code;
          error.details = d.details || {};
          throw error;
        },
      });
      registered.push(toolName);
    } catch (error) {
      failed.push({ name: toolName, error: String((error && error.message) || error) });
    }
  }
  if (failed.length) log.warn(`[research] 工具注册失败 ${failed.length} 个：${failed.map((f) => `${f.name}(${f.error})`).join(', ')}`);
  log.info(`[research] 已注册 ${registered.length} 个工具`);
  return { registered, failed };
}

/** 给测试用：把「计划」也包一层，便于 agent 走两步确认（不在工具表里，走 sciwork_action_plan）。 */
export function previewToolResult(actionId, params, root) {
  const out = planAction(actionId, params, { root });
  if (!out.ok) {
    const d = describeError(out.error);
    return { ok: false, error: { code: d.code, message: d.message } };
  }
  return { ok: true, plan: out.value };
}

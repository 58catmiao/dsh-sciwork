/**
 * 科研模式 0.3 · 动作登记表
 * ---------------------------------------------------------------------------
 * 唯一的动作事实源。任何新功能**只在这里登记一次**：面板（动作清单）、
 * 预设 agent（工具名）、CLI（命令台）三处同时可见（PLAN §1 硬指标 1）。
 *
 * 描述符（PLAN §5.1）：
 *   { id, title, domain, description, params, result, effects, engine, confirm,
 *     idempotent, stage, ui, tool, deprecated, legacy, run(ctx, params) }
 *
 * 参数校验只支持一个小子集（type/required/properties/enum/default/min/max/
 * minLength/maxLength/pattern/items/additionalProperties），自己写、不引依赖。
 * 字符串形态的 "1" / "true" 会被窄化——面板表单与命令行传的都是字符串。
 */

import { CONFIRM_MODES, EFFECTS } from './guards.js';
import { schemaError } from './errors.js';

export const ENGINES = Object.freeze(['node', 'python', 'origin', 'system']);
export const TOOL_PREFIX = 'sciwork_';

const ID_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const TOOL_RE = /^sciwork_[a-z0-9]+(_[a-z0-9]+)*$/;
const PARAM_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);

const BY_ID = new Map();
const BY_TOOL = new Map();
const ALIASES = new Map();     // 旧动作名 → 新动作 id

/* ------------------------------------------------------------------ 校验 */

/** 参数 schema 校验（描述符里声明的那一小撮关键字）。返回问题列表，空 = 合法。 */
export function validateParamSchema(entry, where) {
  const problems = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return [`${where} 必须是对象`];
  }
  if (entry.type !== undefined && entry.type !== 'object') problems.push(`${where}.type 必须是 object`);
  if (entry.required !== undefined) {
    if (!Array.isArray(entry.required) || entry.required.some((x) => typeof x !== 'string')) {
      problems.push(`${where}.required 必须是字符串数组`);
    }
  }
  if (entry.properties !== undefined) {
    if (!entry.properties || typeof entry.properties !== 'object' || Array.isArray(entry.properties)) {
      problems.push(`${where}.properties 必须是对象`);
    } else {
      for (const [name, prop] of Object.entries(entry.properties)) {
        if (!prop || typeof prop !== 'object' || Array.isArray(prop)) { problems.push(`${where}.properties.${name} 必须是对象`); continue; }
        if (prop.type !== undefined) {
          // 允许联合类型（`['boolean','string']`）：旧面板的 remove.confirm 是文件名，新面是布尔，
          // 一个字段要同时接住两种形状（PLAN §5.4 的旧名兼容要求）。
          const types = Array.isArray(prop.type) ? prop.type : [prop.type];
          if (!types.length || types.some((t) => !PARAM_TYPES.has(t))) {
            problems.push(`${where}.properties.${name}.type 不支持：${JSON.stringify(prop.type)}`);
          }
        }
        if (prop.enum !== undefined && !Array.isArray(prop.enum)) problems.push(`${where}.properties.${name}.enum 必须是数组`);
        if (prop.pattern !== undefined) {
          try { new RegExp(prop.pattern); } catch { problems.push(`${where}.properties.${name}.pattern 不是合法正则`); }
        }
        if (prop.items !== undefined && (!prop.items || typeof prop.items !== 'object')) problems.push(`${where}.properties.${name}.items 必须是对象`);
      }
    }
  }
  if (entry.required && entry.properties) {
    for (const name of entry.required) {
      if (!(name in entry.properties)) problems.push(`${where}.required 里的 ${name} 没有对应 properties 定义`);
    }
  }
  return problems;
}

/** 描述符合法性。返回问题列表，空 = 合法。 */
export function validateAction(action) {
  const problems = [];
  if (!action || typeof action !== 'object') return ['描述符必须是对象'];
  const where = action.id || '<无 id>';
  if (typeof action.id !== 'string' || !ID_RE.test(action.id)) problems.push(`${where}: id 必须是 domain.verb 形状（小写，点分隔）`);
  if (!action.title) problems.push(`${where}: 缺 title`);
  if (!action.domain) problems.push(`${where}: 缺 domain`);
  if (!action.description) problems.push(`${where}: 缺 description`);
  if (!EFFECTS.includes(action.effects)) problems.push(`${where}: effects 必须是 ${EFFECTS.join('/')}`);
  if (!ENGINES.includes(action.engine)) problems.push(`${where}: engine 必须是 ${ENGINES.join('/')}`);
  if (!CONFIRM_MODES.includes(action.confirm)) problems.push(`${where}: confirm 必须是 ${CONFIRM_MODES.join('/')}`);
  if (typeof action.run !== 'function') problems.push(`${where}: 缺 run(ctx, params)`);
  if (action.effects === 'read' && action.confirm !== 'never') problems.push(`${where}: 读动作的 confirm 必须是 never`);
  if (action.effects !== 'read' && action.confirm === 'never' && action.idempotent !== true) {
    problems.push(`${where}: 写动作若 confirm=never 必须显式 idempotent:true（PLAN §5.3）`);
  }
  problems.push(...validateParamSchema(action.params, `${where}.params`));
  if (action.stage !== undefined) {
    if (!Array.isArray(action.stage)) problems.push(`${where}.stage 必须是数组`);
  }
  if (action.tool !== undefined) {
    if (!action.tool || typeof action.tool !== 'object') problems.push(`${where}.tool 必须是对象`);
    else if (action.tool.expose === true && (typeof action.tool.name !== 'string' || !TOOL_RE.test(action.tool.name))) {
      problems.push(`${where}.tool.name 必须是 ${TOOL_PREFIX}<domain>_<verb>`);
    }
  }
  if (action.legacy !== undefined) {
    if (!Array.isArray(action.legacy)) problems.push(`${where}.legacy 必须是数组`);
    else if (action.legacy.some((x) => typeof x !== 'string' || !x)) problems.push(`${where}.legacy 里必须是非空字符串`);
  }
  return problems;
}

/* ------------------------------------------------------------------ 登记 */

/** 登记一个动作（重复登记同一 id 会被拒绝，提示先注销——避免悄悄换实现）。 */
export function registerAction(action) {
  const problems = validateAction(action);
  if (problems.length) throw schemaError(`动作描述符不合法：${problems.join('；')}`, { problems });
  if (BY_ID.has(action.id)) throw schemaError(`动作重复登记：${action.id}`);
  if (action.tool && action.tool.expose) {
    const name = action.tool.name;
    if (BY_TOOL.has(name)) throw schemaError(`工具名重复：${name}（已被 ${BY_TOOL.get(name)} 占用）`);
    BY_TOOL.set(name, action.id);
  }
  BY_ID.set(action.id, action);
  for (const alias of action.legacy || []) {
    if (ALIASES.has(alias)) throw schemaError(`旧动作名重复：${alias}`);
    ALIASES.set(alias, action.id);
  }
  return action;
}

/** 批量登记（actions/index.js 用它；先全量校验，避免登记一半）。 */
export function registerAll(actions) {
  const problems = [];
  const seen = new Set();
  const tools = new Set();
  const aliases = new Set();
  for (const a of actions) {
    problems.push(...validateAction(a));
    if (a && a.id) {
      if (seen.has(a.id)) problems.push(`${a.id}: 同一批里重复`);
      seen.add(a.id);
    }
    if (a && a.tool && a.tool.expose && a.tool.name) {
      if (tools.has(a.tool.name)) problems.push(`${a.tool.name}: 工具名在同一批里重复`);
      tools.add(a.tool.name);
    }
    for (const alias of (a && a.legacy) || []) {
      if (aliases.has(alias)) problems.push(`${alias}: 旧动作名在同一批里重复`);
      aliases.add(alias);
    }
  }
  if (problems.length) throw schemaError(`动作表不合法：${problems.join('；')}`, { problems });
  for (const a of actions) registerAction(a);
  return actions;
}

/* ------------------------------------------------------------------ 查询 */

/** 按新 id 或旧动作名解析；解析不到返回 null。 */
export function resolveAction(idOrAlias) {
  const key = String(idOrAlias || '').trim();
  if (!key) return null;
  if (BY_ID.has(key)) return BY_ID.get(key);
  const id = ALIASES.get(key);
  return id ? BY_ID.get(id) || null : null;
}

export const hasAction = (id) => BY_ID.has(String(id || '').trim());

/** 旧动作名（按登记顺序；`ACTIONS` 兼容数组就来自这里）。 */
export const legacyNames = () => [...ALIASES.keys()];

/** 旧动作名的目标 id。 */
export const aliasTarget = (alias) => ALIASES.get(String(alias || '')) || null;

/** 全部动作（可选按域/effects 过滤）。 */
export function listActions({ domain, effects, exposedOnly = false } = {}) {
  let out = [...BY_ID.values()];
  if (domain) out = out.filter((a) => a.domain === domain);
  if (effects) out = out.filter((a) => a.effects === effects);
  if (exposedOnly) out = out.filter((a) => a.tool && a.tool.expose === true);
  return out;
}

export const toolNames = () => [...BY_TOOL.keys()];

/** 给 agent 的紧凑清单：只报 id/title/effects/确认方式/工具名，不带实现。 */
export function catalog() {
  return listActions().map((a) => ({
    id: a.id,
    title: a.title,
    domain: a.domain,
    description: a.description,
    effects: a.effects,
    engine: a.engine,
    confirm: a.confirm,
    stages: a.stage || null,
    tool: a.tool && a.tool.expose ? a.tool.name : null,
    legacy: a.legacy || [],
    deprecated: a.deprecated === true,
    params: a.params || { type: 'object', properties: {} },
  }));
}

/** 测试用：清空登记（selftest 里重建动作表）。 */
export function resetRegistry() {
  BY_ID.clear();
  BY_TOOL.clear();
  ALIASES.clear();
}

/* -------------------------------------------------------------- 参数校验 */

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function coerce(prop, value) {
  if (value === undefined || value === null) return value;
  if (prop.type === 'number' || prop.type === 'integer') {
    if (typeof value === 'number') return value;
    const s = String(value).trim();
    if (!s) return value;
    const n = Number(s);
    return Number.isFinite(n) ? n : value;
  }
  if (prop.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    const s = String(value).trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
    return value;
  }
  return value;
}

function typeOk(type, value) {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return isPlainObject(value);
    default: return true;
  }
}

function checkOne(prop, value, field, out) {
  if (!prop || typeof prop !== 'object') return;
  if (Array.isArray(prop.type)) {
    out[field] = value;
    if (value !== undefined && !prop.type.some((t) => typeOk(t, value))) {
      throw schemaError(`${field} 必须是 ${prop.type.join(' 或 ')}`, { field });
    }
    if (Array.isArray(prop.enum) && value !== undefined && !prop.enum.includes(value)) {
      throw schemaError(`${field} 只能是：${prop.enum.join(' / ')}`, { field });
    }
    return;
  }
  const v = coerce(prop, value);
  out[field] = v;
  if (v === undefined) return;
  switch (prop.type) {
    case 'string':
      if (typeof v !== 'string') throw schemaError(`${field} 必须是字符串`, { field });
      if (prop.minLength !== undefined && v.length < prop.minLength) throw schemaError(`${field} 至少 ${prop.minLength} 个字符`, { field });
      if (prop.maxLength !== undefined && v.length > prop.maxLength) throw schemaError(`${field} 最多 ${prop.maxLength} 个字符`, { field });
      if (prop.pattern && !new RegExp(prop.pattern).test(v)) throw schemaError(`${field} 格式不对（应匹配 ${prop.pattern}）`, { field });
      break;
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) throw schemaError(`${field} 必须是数字`, { field });
      if (prop.min !== undefined && v < prop.min) throw schemaError(`${field} 不能小于 ${prop.min}`, { field });
      if (prop.max !== undefined && v > prop.max) throw schemaError(`${field} 不能大于 ${prop.max}`, { field });
      break;
    case 'integer':
      if (typeof v !== 'number' || !Number.isInteger(v)) throw schemaError(`${field} 必须是整数`, { field });
      if (prop.min !== undefined && v < prop.min) throw schemaError(`${field} 不能小于 ${prop.min}`, { field });
      if (prop.max !== undefined && v > prop.max) throw schemaError(`${field} 不能大于 ${prop.max}`, { field });
      break;
    case 'boolean':
      if (typeof v !== 'boolean') throw schemaError(`${field} 必须是布尔值`, { field });
      break;
    case 'array': {
      if (!Array.isArray(v)) throw schemaError(`${field} 必须是数组`, { field });
      if (prop.items) for (let i = 0; i < v.length; i += 1) checkOne(prop.items, v[i], `${field}[${i}]`, out);
      break;
    }
    case 'object':
      if (!isPlainObject(v)) throw schemaError(`${field} 必须是对象`, { field });
      break;
    default:
      break;
  }
  if (Array.isArray(prop.enum) && !prop.enum.includes(v)) {
    throw schemaError(`${field} 只能是：${prop.enum.join(' / ')}`, { field });
  }
}

/**
 * 校验并窄化参数。
 * @returns {object} 校验后的参数（含 default 填充；未声明的键在 additionalProperties:false 时任其被丢弃）
 */
export function validateParams(action, raw) {
  const schema = action.params || { type: 'object', properties: {} };
  const input = isPlainObject(raw) ? raw : {};
  const props = schema.properties || {};
  const out = {};
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(input)) {
      if (!(key in props)) throw schemaError(`未知参数：${key}`, { field: key });
    }
  }
  for (const [name, prop] of Object.entries(props)) {
    const value = input[name] !== undefined ? input[name] : prop.default;
    checkOne(prop, value, name, out);
  }
  // 未声明的键：`additionalProperties:false` 时上面已经拒绝；否则原样透传
  // （导入器要收 `target/subdir/meta` 这类自由参数，动作层不给它写死白名单）。
  if (schema.additionalProperties !== false) {
    for (const [name, value] of Object.entries(input)) {
      if (!(name in props) && value !== undefined) out[name] = value;
    }
  }
  for (const name of schema.required || []) {
    const v = out[name];
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) {
      throw schemaError(`缺少必填参数：${name}`, { field: name });
    }
  }
  return out;
}

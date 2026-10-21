/**
 * 0.3 · 工具暴露自检（无第三方依赖，直接 node 跑）
 * ---------------------------------------------------------------------------
 * 覆盖 PLAN §10.2 / §14：
 *   - 每个 `tool.expose` 的动作都注册成工具，名字唯一且形如 sciwork_*；
 *   - 参数 schema 已窄化成 DSH 支持的子集（无 minLength/maximum/format/联合类型）；
 *   - 写动作的工具说明里明确「先计划、再确认」；
 *   - 三个 meta 工具（catalog / plan / confirm）都在。
 * 用假注册表，不碰真宿主、不碰真库。
 */

import { registerSciworkTools, toToolSchema } from '../lib/tools.js';
import { catalog } from '../lib/host/registry.js';
import { ensureRegistered } from '../lib/actions/index.js';

let pass = 0;
let fail = 0;
function check(label, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  PASS  ${label}${detail ? `  —— ${detail}` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? `  —— ${detail}` : ''}`); }
}

ensureRegistered();
const exposed = catalog().filter((a) => typeof a.tool === 'string' && a.tool);
const regs = [];
const out = registerSciworkTools({ register: (t) => regs.push(t) });

console.log('工具暴露');
check('每个暴露动作都注册成功', regs.length === exposed.length && out.failed.length === 0,
  `动作 ${exposed.length} / 工具 ${regs.length} / 失败 ${out.failed.length}`);
check('工具名唯一', new Set(regs.map((t) => t.name)).size === regs.length);
check('工具名形如 sciwork_*', regs.every((t) => /^sciwork_[a-z0-9_]+$/.test(t.name)));
check('meta 三件套都在', ['sciwork_action_catalog', 'sciwork_action_plan', 'sciwork_action_confirm']
  .every((n) => regs.some((t) => t.name === n)));

console.log('\nschema 窄化');
const badKeys = [];
const walk = (schema, where) => {
  for (const k of Object.keys(schema)) {
    if (['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'format', 'default', 'minItems', 'maxItems'].includes(k)) badKeys.push(`${where}.${k}`);
    if (k === 'type' && Array.isArray(schema[k])) badKeys.push(`${where}.type[]`);
    if (k === 'properties') for (const [pk, pv] of Object.entries(schema[k])) walk(pv, `${where}.${pk}`);
    if (k === 'items') walk(schema[k], `${where}[]`);
  }
};
regs.forEach((t) => walk(t.parameters, t.name));
check('没有宿主不支持的 schema 键', badKeys.length === 0, badKeys.slice(0, 5).join(', '));
check('顶层都是 object', regs.every((t) => t.parameters.type === 'object'));
check('联合类型窄化成单类型', toToolSchema({ type: ['string', 'boolean'] }).type === 'string');

console.log('\n写动作说明');
const writes = exposed.filter((a) => a.effects !== 'read');
const writeTools = regs.filter((t) => writes.some((a) => a.tool === t.name));
check('写工具说明含两步确认提示', writeTools.length > 0 && writeTools.every((t) => t.description.includes('sciwork_action_confirm')));
check('读工具说明不写确认提示', regs.find((t) => t.name === 'sciwork_project_list').description.includes('effects: read'));

const r = regs.find((t) => t.name === 'sciwork_project_list').output.render({}, { projects: [{ slug: 'x' }] });
check('输出 render 返回 text 块', Array.isArray(r) && r[0].type === 'text' && r[0].text.includes('x'));

console.log(`\n${pass} 通过 · ${fail} 失败`);
process.exit(fail ? 1 : 0);

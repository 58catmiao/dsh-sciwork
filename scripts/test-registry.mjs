#!/usr/bin/env node
/**
 * 0.3 · 动作登记表自检（不连库、不调 python、不起 Origin）
 * ---------------------------------------------------------------------------
 * 覆盖（PLAN §5.1）：
 *   [1] 24 个旧名一个不少、顺序不变；每个旧名都能解析到动作
 *   [2] 描述符合法性：坏 id / 读动作带令牌 / 写动作 confirm=never 无幂等 → 拒
 *   [3] 重复登记（同 id / 同工具名 / 同旧名）→ 拒
 *   [4] 参数校验：必填、类型窄化、联合类型、默认值、enum、additionalProperties
 *   [5] 目录自述：catalog 里的工具名唯一、写动作都带确认方式
 *
 * 退出码 0 = 全绿。
 */

import { ensureRegistered, resetActions, ALL_ACTIONS, LEGACY_ORDER } from '../lib/actions/index.js';
import {
  catalog, legacyNames, listActions, registerAction, resolveAction,
  toolNames, validateAction, validateParams,
} from '../lib/host/registry.js';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  PASS  ${name}${detail ? '  —— ' + detail : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? '  —— ' + detail : ''}`); }
};

console.log('[1] 旧名契约（0.3 期间一个都不许变）');
ensureRegistered();
check('旧名数量 = 23（replot 0.3.2 移除）', legacyNames().length === 23, String(legacyNames().length));
check('旧名集合 = LEGACY_ORDER（一个不多一个不少）',
  [...legacyNames()].sort().join(',') === [...LEGACY_ORDER].sort().join(','), legacyNames().join(','));
check('每个旧名都能解析', LEGACY_ORDER.every((n) => !!resolveAction(n)));
check('ALL_ACTIONS 无重复 id', new Set(ALL_ACTIONS.map((a) => a.id)).size === ALL_ACTIONS.length);
check('动作数 ≥ 旧名数', listActions().length >= 24, `${listActions().length} 个动作`);
check('新名是 domain.verb 形状', listActions().every((a) => /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(a.id)));

console.log('\n[2] 描述符合法性');
const bad = (desc, why) => check(`拒绝：${why}`, validateAction(desc).length > 0, validateAction(desc)[0] || '（没拒）');
const okDesc = (extra) => ({
  id: 'test.thing', title: 't', domain: 'test', description: 'd',
  params: { type: 'object', properties: {} }, effects: 'read', engine: 'node',
  confirm: 'never', run: async () => null, ...extra,
});
check('合法描述符通过', validateAction(okDesc()).length === 0, JSON.stringify(validateAction(okDesc())));
bad(okDesc({ id: 'thing' }), 'id 不是 domain.verb');
bad(okDesc({ id: 'Test.thing' }), 'id 有大写');
bad(okDesc({ effects: 'read', confirm: 'write' }), '读动作要求令牌');
bad(okDesc({ effects: 'write', confirm: 'never' }), '写动作 confirm=never 但没幂等');
check('写动作 confirm=never + idempotent:true 通过',
  validateAction(okDesc({ effects: 'write', confirm: 'never', idempotent: true })).length === 0);
bad(okDesc({ engine: 'shell' }), 'engine 不在白名单');
bad(okDesc({ tool: { expose: true, name: 'bad_tool_name' } }), '工具名不合规');
bad(okDesc({ params: { type: 'object', properties: { x: { type: 'weird' } } } }), '参数类型不支持');
bad(okDesc({ params: { type: 'object', required: ['nope'], properties: {} } }), 'required 指向未定义字段');

console.log('\n[3] 重复登记');
resetActions();
ensureRegistered();
check('重复登记同 id → 抛', (() => { try { registerAction(ALL_ACTIONS[0]); return false; } catch { return true; } })());
check('重复登记同旧名 → 抛', (() => {
  try {
    registerAction({
      id: 'test.alias', title: 't', domain: 'test', description: 'd',
      params: { type: 'object', properties: {} }, effects: 'read', engine: 'node',
      confirm: 'never', legacy: ['snapshot'], run: async () => null,
    });
    return false;
  } catch { return true; }
})());

console.log('\n[4] 参数校验');
resetActions();
ensureRegistered();
const cmd = resolveAction('runCli');
check('默认值填充（confirm=false）', validateParams(cmd, { id: 'status' }).confirm === false, JSON.stringify(validateParams(cmd, { id: 'status' })));
check('联合类型不做窄化：字符串 "true" 原样保留（旧名兼容口自己判真值）',
  validateParams(cmd, { id: 'status', confirm: 'true' }).confirm === 'true');
check('未知参数（additionalProperties:false）→ 抛', (() => { try { validateParams(cmd, { id: 'status', nope: 1 }); return false; } catch { return true; } })());
const rm = resolveAction('remove');
check('联合类型：confirm 收字符串（旧面板文件名）', validateParams(rm, { entries: ['a'], confirm: 'good.md' }).confirm === 'good.md');
check('联合类型：confirm 收布尔（新面）', validateParams(rm, { entries: ['a'], confirm: true }).confirm === true);
check('联合类型：confirm 收数字 → 抛', (() => { try { validateParams(rm, { entries: ['a'], confirm: 7 }); return false; } catch { return true; } })());
const preview = resolveAction('tablePreview');
check('整数窄化（"12" → 12）', validateParams(preview, { data: 'x', limit: '12' }).limit === 12);
check('min/max 越界 → 抛', (() => { try { validateParams(preview, { data: 'x', limit: 999 }); return false; } catch { return true; } })());
check('缺必填 → 抛', (() => { try { validateParams(resolveAction('replot'), {}); return false; } catch { return true; } })());
const imp = resolveAction('import');
check('additionalProperties 未设 false → 自由参数透传（导入器的 target/subdir）',
  validateParams(imp, { target: 'data', project: 'p', files: [{ name: 'a.csv' }], subdir: 'x' }).subdir === 'x');
const plan = resolveAction('action.plan');
check('参数对象（params）原样收下', validateParams(plan, { actionId: 'library.remove', params: { entries: ['a'] } }).params.entries[0] === 'a');

console.log('\n[5] 目录自述');
const cat = catalog();
check('catalog 有 24 个旧名' , cat.length >= 24, `${cat.length}`);
check('工具名唯一', new Set(toolNames()).size === toolNames().length, `${toolNames().length} 个工具`);
check('写动作都带确认方式（never 必须幂等）',
  listActions().filter((a) => a.effects !== 'read').every((a) => a.confirm !== 'never' || a.idempotent === true));
check('catalog 不含实现字段（run）', cat.every((a) => !('run' in a)));

console.log('\n' + '='.repeat(72));
console.log(`${pass} 通过 · ${fail} 失败`);
if (fail) process.exitCode = 1;

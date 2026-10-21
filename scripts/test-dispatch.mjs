#!/usr/bin/env node
/**
 * 0.3 · 执行器自检（临时目录；**不碰真实科研库**）
 * ---------------------------------------------------------------------------
 * 覆盖（PLAN §5.2）：
 *   [1] 读动作直接跑、回执落盘
 *   [2] 写动作没令牌 → needs-confirmation；错误令牌/被改参数 → denied
 *   [3] 两步确认：action.plan → action.confirm（令牌一次性）
 *   [4] 旧名兼容口：同请求内代签（confirmation=legacy-implicit）+ 幂等回放
 *   [5] 回执可读、摘要字段齐全
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { callLegacy, ensureRegistered } from '../lib/actions/index.js';
import { registerAction } from '../lib/host/registry.js';
import { dispatch, planAction, recentReceipts, resetGuardState } from '../lib/host/dispatch.js';
import { readReceipts } from '../lib/host/receipts.js';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  PASS  ${name}${detail ? '  —— ' + detail : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? '  —— ' + detail : ''}`); }
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sciwork-dispatch-'));
fs.mkdirSync(path.join(root, '.research'), { recursive: true });
const ctx = { root, source: 'cycle' };

ensureRegistered();

/** 测试用写动作：confirm 必须走令牌。 */
registerAction({
  id: 'test.write',
  title: '测试写文件',
  domain: 'test',
  description: '写一个占位文件（自检专用）',
  params: {
    type: 'object', required: ['name'], additionalProperties: false,
    properties: { name: { type: 'string', maxLength: 40 } },
  },
  effects: 'write',
  engine: 'node',
  confirm: 'always',
  run: async (c, params) => {
    const abs = path.join(c.root, 'w', params.name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'ok', 'utf8');
    return { path: `w/${params.name}`, wrote: [`w/${params.name}`], summary: `写入 w/${params.name}` };
  },
});

/** 测试用旧名动作：confirm legacy → 请求内代签。 */
registerAction({
  id: 'test.legacy',
  title: '测试旧名写文件',
  domain: 'test',
  description: '旧名兼容口（自检专用）',
  params: {
    type: 'object', required: ['name'], additionalProperties: false,
    properties: { name: { type: 'string', maxLength: 40 } },
  },
  effects: 'write',
  engine: 'node',
  confirm: 'legacy',
  legacy: ['legacyWrite'],
  run: async (c, params) => {
    const abs = path.join(c.root, 'w', params.name);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'ok', 'utf8');
    return { path: `w/${params.name}` };
  },
});

console.log('[1] 读动作不落回执');
const read = await dispatch('action.catalog', {}, ctx);
check('读动作直接执行', read.ok === true, read.ok ? `${read.value.actions.length} 个动作` : JSON.stringify(read.error));
check('读动作不生成回执（不写库）', read.ok && read.receipt === null, read.ok ? String(read.receipt) : '');

console.log('\n[2] 写动作的令牌闸门');
const noToken = await dispatch('test.write', { name: 'a.txt' }, ctx);
check('没令牌 → needs-confirmation', noToken.ok === false && noToken.error.code === 'needs-confirmation', JSON.stringify(noToken.error || {}));
check('拒绝时没有生成文件', !fs.existsSync(path.join(root, 'w', 'a.txt')));

const issued = planAction('test.write', { name: 'b.txt' }, ctx);
check('计划签发成功', issued.ok === true, issued.ok ? issued.value.planId : JSON.stringify(issued.error));
check('写动作计划要求确认', issued.ok && issued.value.confirmRequired === true);
check('计划带 diff/writes/expiresAt', issued.ok && Array.isArray(issued.value.diff) && Array.isArray(issued.value.writes) && !!issued.value.expiresAt);
const planId = issued.ok ? issued.value.planId : '';
const token = issued.ok ? issued.value.token : '';

const badToken = await dispatch('test.write', { name: 'b.txt' }, { ...ctx, planId, confirmToken: 'wrong' });
check('错令牌 → denied', badToken.ok === false && badToken.error.code === 'denied', JSON.stringify(badToken.error || {}));

const changed = await dispatch('test.write', { name: 'c.txt' }, { ...ctx, planId, confirmToken: token });
check('参数被改 → denied（令牌锁参数哈希）', changed.ok === false && changed.error.code === 'denied', JSON.stringify(changed.error || {}));

console.log('\n[3] 两步确认（action.plan → action.confirm）');
const planned2 = await dispatch('action.plan', { actionId: 'test.write', params: { name: 'd.txt' } }, ctx);
check('action.plan 走执行器也能签发', planned2.ok === true && planned2.value.confirmRequired === true, JSON.stringify(planned2.error || {}));
const confirmed = await dispatch('action.confirm', {
  actionId: 'test.write',
  planId: planned2.ok ? planned2.value.planId : '',
  token: planned2.ok ? planned2.value.token : '',
  params: { name: 'd.txt' },
}, ctx);
check('action.confirm 执行成功', confirmed.ok === true, JSON.stringify(confirmed.error || {}));
check('action.confirm 真的写了文件', fs.existsSync(path.join(root, 'w', 'd.txt')));
check('内层回执 confirmation=token', confirmed.ok && confirmed.value.receipt.confirmation === 'token', confirmed.ok ? confirmed.value.receipt.confirmation : '');
const reuse = await dispatch('action.confirm', {
  actionId: 'test.write',
  planId: planned2.ok ? planned2.value.planId : '',
  token: planned2.ok ? planned2.value.token : '',
  params: { name: 'd.txt' },
}, ctx);
check('令牌一次性：重复用 → denied', reuse.ok === false && reuse.error.code === 'denied', JSON.stringify(reuse.error || {}));

console.log('\n[4] 旧名兼容口 + 幂等回放');
const l1 = await callLegacy('legacyWrite', { name: 'e.txt' }, ctx);
check('旧名写动作零改动可用', l1.ok === true, JSON.stringify(l1).slice(0, 160));
const l2 = await dispatch('legacyWrite', { name: 'e.txt' }, ctx);
check('同参数重复调用 → 幂等回放（不重复写）', l2.ok === true && l2.replayed === true, JSON.stringify(l2).slice(0, 160));
const legacyReceipts = readReceipts(root, { limit: 50 });
const implicit = legacyReceipts.filter((r) => r.confirmation === 'legacy-implicit');
check('旧名回执标了 legacy-implicit 并带 warning',
  implicit.length >= 1 && implicit.every((r) => (r.warnings || []).some((w) => /代签/.test(w))), `${implicit.length} 条`);
check('新动作回执不受影响（有 token 记录）', legacyReceipts.some((r) => r.confirmation === 'token'));

console.log('\n[5] 错误与回执读回');
const unknown = await dispatch('nope.nothing', {}, ctx);
check('未知动作 → bad-request', unknown.ok === false && unknown.error.code === 'bad-request');
const badParam = await dispatch('test.write', { nope: 1 }, ctx);
check('未知参数 → schema', badParam.ok === false && badParam.error.code === 'schema', JSON.stringify(badParam.error || {}));
const recents = recentReceipts(root, 10);
check('最近回执可读', recents.ok === true && recents.value.length >= 2, recents.ok ? `${recents.value.length} 条` : '');
check('回执摘要有 action/ok/durationMs',
  recents.ok && recents.value.every((r) => r.action && 'ok' in r && typeof r.durationMs === 'number'));
check('回执落在 .research/receipts 下', fs.existsSync(path.join(root, '.research', 'receipts')));

resetGuardState();
fs.rmSync(root, { recursive: true, force: true });

console.log('\n' + '='.repeat(72));
console.log(`${pass} 通过 · ${fail} 失败`);
if (fail) process.exitCode = 1;

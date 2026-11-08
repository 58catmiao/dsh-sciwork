#!/usr/bin/env node
/**
 * 0.4.10 · 科研库根目录设置自检（不连库、不调 python、不起 Origin）
 * ---------------------------------------------------------------------------
 * 覆盖：
 *   [1] 用户级配置（<DSH_HOME>/sciwork/config.json）落在临时目录，绝不碰真实 ~/.dsh
 *   [2] 优先级：库内 .research/config.json ＞ 环境变量 ＞ 用户级设置 ＞ 随包 ＞ 默认
 *   [3] 写动作两步：plan（含 diff/warnings）→ confirm（一次性令牌，重放必拒）
 *   [4] 校验：绝对路径、目录不存在且没勾新建、目录不存在则新建
 *   [5] 清除设置：退回下一层；本来没有设置时是幂等空操作
 *   [6] 只读视图 settings.library 如实报告来源，并在被环境变量压过时给出提示
 *   [7] 工具暴露：三个动作都登记、工具名合规
 *
 * 退出码 0 = 全绿。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* ---- 隔离必须在 import 之前：config.js 在调用时读 DSH_HOME / SCIWORK_LIBRARY ---- */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sciwork-settings-'));
const DSH = path.join(TMP, 'dsh-home');
process.env.DSH_HOME = DSH;
delete process.env.SCIWORK_LIBRARY;
delete process.env.RESEARCH_LIBRARY;

const LIB_A = path.join(TMP, 'lib-a');
const LIB_B = path.join(TMP, 'lib-b');
const LIB_C = path.join(TMP, 'lib-c');
for (const dir of [LIB_A, LIB_B, LIB_C]) fs.mkdirSync(dir, { recursive: true });

const { ensureRegistered } = await import('../lib/actions/index.js');
const { catalog } = await import('../lib/host/registry.js');
const { planAction, dispatch, resetGuardState } = await import('../lib/host/dispatch.js');
const { loadSettings } = await import('../lib/library.js');
const { userConfigPath, readUserConfig } = await import('../lib/config.js');

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  PASS  ${name}${detail ? '  —— ' + detail : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? '  —— ' + detail : ''}`); }
};
const userFile = userConfigPath();
const readUserFile = () => {
  try { return JSON.parse(fs.readFileSync(userFile, 'utf8')); } catch { return null; }
};
const slash = (p) => p.split(path.sep).join('/');

ensureRegistered();

console.log('[1] 隔离与登记');
check('用户级配置路径在临时 DSH_HOME 下', userFile.startsWith(DSH + path.sep), userFile);
check('开始前用户级配置不存在', !fs.existsSync(userFile));
const ids = catalog().map((a) => a.id);
check('三个设置动作都登记了', ['settings.library', 'settings.library_root_set', 'settings.library_root_clear'].every((id) => ids.includes(id)), ids.filter((id) => id.startsWith('settings.')).join(','));
const tools = catalog().filter((a) => a.domain === 'settings').map((a) => (a.tool && a.tool.name) || (typeof a.tool === 'string' ? a.tool : ''));
check('三个动作都暴露为工具且名字合规', tools.length === 3 && tools.every((n) => /^sciwork_[a-z0-9]+(_[a-z0-9]+)*$/.test(n)), tools.join(','));

console.log('\n[2] 只读视图 → 写 → 优先级');
const base = await loadSettings();
const before = await dispatch('settings.library', {}, { source: 'test', root: base.root });
check('settings.library 可读', before.ok === true, before.ok ? '' : JSON.stringify(before.error));
check('开始前没有用户级库根', before.ok && before.value.userRoot === null, before.ok ? String(before.value.userRoot) : '');
check('来源在五个合法值里', before.ok && ['in-library', 'env', 'user', 'bundled', 'default'].includes(before.value.rootSource), before.ok ? before.value.rootSource : '');

const planA = planAction('settings.library_root_set', { root: slash(LIB_A) }, { root: base.root });
check('plan 成功且要确认', planA.ok && planA.value.confirmRequired === true, planA.ok ? JSON.stringify(planA.value.diff) : JSON.stringify(planA.error));
check('plan 带 writes/warnings 形状', planA.ok && Array.isArray(planA.value.writes) && Array.isArray(planA.value.warnings) && Array.isArray(planA.value.diff));

const noToken = await dispatch('settings.library_root_set', { root: slash(LIB_A) }, { source: 'test', root: base.root });
check('不带令牌直接执行 → 拒', noToken.ok === false, noToken.ok ? '（居然通过了）' : noToken.error.code + ': ' + noToken.error.message);

const doneA = await dispatch('settings.library_root_set', { root: slash(LIB_A) }, {
  source: 'test', root: base.root, planId: planA.value.planId, confirmToken: planA.value.token,
});
check('plan → confirm 写入成功', doneA.ok === true, doneA.ok ? String(doneA.value.file) : JSON.stringify(doneA.error));
check('用户级配置落盘且指向 LIB_A', readUserFile() && readUserFile().libraryRoot === slash(LIB_A), JSON.stringify(readUserFile()));
check('回执里带 readBack 复核', doneA.ok && doneA.value.readBack === slash(LIB_A), doneA.ok ? String(doneA.value.readBack) : '');
const afterA = await loadSettings();
check('库根 = LIB_A 且来源 = user', afterA.root === LIB_A && afterA.rootSource === 'user', `${afterA.root} / ${afterA.rootSource}`);

const replay = await dispatch('settings.library_root_set', { root: slash(LIB_A) }, {
  source: 'test', root: base.root, planId: planA.value.planId, confirmToken: planA.value.token,
});
check('同一令牌重放 → 拒（一次性）', replay.ok === false, replay.ok ? '（居然通过了）' : replay.error.code);

console.log('\n[3] 环境变量压过面板设置');
process.env.SCIWORK_LIBRARY = LIB_B;
const envSettings = await loadSettings();
check('env 优先：root = LIB_B / source = env', envSettings.root === LIB_B && envSettings.rootSource === 'env', `${envSettings.root} / ${envSettings.rootSource}`);
const envView = await dispatch('settings.library', {}, { source: 'test', root: envSettings.root });
check('只读视图给出「被环境变量压过」的提示', envView.ok && envView.value.notes.some((n) => n.includes('环境变量')), envView.ok ? String(envView.value.notes.length) : '');
delete process.env.SCIWORK_LIBRARY;

console.log('\n[4] 库内 .research/config.json 最权威');
fs.mkdirSync(path.join(LIB_B, '.research'), { recursive: true });
fs.writeFileSync(path.join(LIB_B, '.research', 'config.json'), JSON.stringify({ schema: 1, libraryRoot: slash(LIB_C) }));
const planB = planAction('settings.library_root_set', { root: slash(LIB_B) }, { root: base.root });
const doneB = await dispatch('settings.library_root_set', { root: slash(LIB_B) }, {
  source: 'test', root: base.root, planId: planB.value.planId, confirmToken: planB.value.token,
});
check('把库根设成 LIB_B', doneB.ok === true, doneB.ok ? '' : JSON.stringify(doneB.error));
const afterB = await loadSettings();
check('库内配置更权威：root = LIB_C / source = in-library', path.resolve(afterB.root) === LIB_C && afterB.rootSource === 'in-library', `${afterB.root} / ${afterB.rootSource}`);

console.log('\n[5] 校验');
const rel = planAction('settings.library_root_set', { root: 'relative/lib' }, { root: base.root });
check('相对路径 → 拒', rel.ok === false && rel.error.code === 'bad-request', rel.ok ? '（居然通过了）' : rel.error.code);
const missing = path.join(TMP, 'not-there-yet');
const planMissing = planAction('settings.library_root_set', { root: slash(missing) }, { root: base.root });
check('目录不存在且没勾新建 → 拒', planMissing.ok === false, planMissing.ok ? '（居然通过了）' : planMissing.error.code);
const planCreate = planAction('settings.library_root_set', { root: slash(missing), create: true }, { root: base.root });
check('勾了新建 → plan 通过并提醒会新建', planCreate.ok && planCreate.value.warnings.some((w) => w.includes('新建')), planCreate.ok ? String(planCreate.value.warnings.length) : JSON.stringify(planCreate.error));
const doneCreate = await dispatch('settings.library_root_set', { root: slash(missing), create: true }, {
  source: 'test', root: base.root, planId: planCreate.value.planId, confirmToken: planCreate.value.token,
});
check('确认后目录真的建出来了', doneCreate.ok === true && fs.existsSync(missing), doneCreate.ok ? String(doneCreate.value.createdDir) : JSON.stringify(doneCreate.error));

console.log('\n[6] 清除设置 → 退回下一层');
resetGuardState();
const planClear = planAction('settings.library_root_clear', {}, { root: base.root });
check('清除也要确认（写动作）', planClear.ok && planClear.value.confirmRequired === true);
const doneClear = await dispatch('settings.library_root_clear', {}, {
  source: 'test', root: base.root, planId: planClear.value.planId, confirmToken: planClear.value.token,
});
check('清除成功且返回上一值', doneClear.ok && doneClear.value.removed === true && doneClear.value.previous === slash(missing), doneClear.ok ? String(doneClear.value.previous) : JSON.stringify(doneClear.error));
check('用户级配置里已经没有 libraryRoot', readUserFile() && readUserFile().libraryRoot === undefined, JSON.stringify(readUserFile()));
const afterClear = await loadSettings();
check('清除后不再是 user 来源', afterClear.rootSource !== 'user', `${afterClear.root} / ${afterClear.rootSource}`);
const clearAgain = planAction('settings.library_root_clear', {}, { root: base.root });
check('再清一次：plan 通过并说明是空操作', clearAgain.ok && clearAgain.value.warnings.some((w) => w.includes('本来就没有')), clearAgain.ok ? String(clearAgain.value.warnings.length) : JSON.stringify(clearAgain.error));
// 先清幂等缓存：不清的话同样的参数会命中上一次回执（回放 removed:true），测不到空操作路径。
resetGuardState();
const clearThird = planAction('settings.library_root_clear', {}, { root: base.root });
const doneAgain = await dispatch('settings.library_root_clear', {}, {
  source: 'test', root: base.root, planId: clearThird.value.planId, confirmToken: clearThird.value.token,
});
check('空操作返回 removed:false', doneAgain.ok && doneAgain.value.removed === false, doneAgain.ok ? String(doneAgain.value.removed) : JSON.stringify(doneAgain.error));

console.log(`\n${fail === 0 ? 'OK' : 'FAILED'}：${pass} 通过 / ${fail} 失败`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 临时目录留不留都行 */ }
process.exit(fail === 0 ? 0 : 1);

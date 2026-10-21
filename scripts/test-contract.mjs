/**
 * 0.3 · Python 契约 v1 自检（不启动引擎；有解释器时才做真实握手，否则 skip）
 * ---------------------------------------------------------------------------
 * 覆盖 PLAN §7 / §14：适配器映射表逐项 dry-run（toArgv 的参数顺序/布尔 flag/位置参数），
 * 协议号，以及常用子命令的超时覆盖表。绝不执行 research.py。
 */

import { PROTOCOL, SUBCOMMANDS, KIND_TIMEOUTS, toArgv } from '../lib/adapters/python.js';

let pass = 0;
let fail = 0;
function check(label, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  PASS  ${label}${detail ? `  —— ${detail}` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? `  —— ${detail}` : ''}`); }
}

console.log('Python 契约');
check('协议号 = 1', PROTOCOL === 1);
check('映射表非空', Object.keys(SUBCOMMANDS).length >= 15, String(Object.keys(SUBCOMMANDS).length));

// 逐项 dry-run：按映射表自己的 args 规格造一份参数，断言 argv 形状与 flag 顺序。
for (const [id, spec] of Object.entries(SUBCOMMANDS)) {
  check(`映射存在：${id}`, typeof spec.cli === 'string' && spec.cli.length > 0, spec.cli);
  const params = {};
  for (const [key, raw] of Object.entries(spec.args || {})) {
    const conf = typeof raw === 'string' ? { flag: raw } : raw;
    params[key] = conf.bool ? true : 'sample';
  }
  let argv = [];
  try { argv = toArgv(id, params); } catch (error) { check(`argv 形状：${id}`, false, String(error.message)); continue; }
  const missing = [];
  for (const [key, raw] of Object.entries(spec.args || {})) {
    const conf = typeof raw === 'string' ? { flag: raw } : raw;
    if (conf.bool) { if (!argv.includes(conf.flag)) missing.push(conf.flag); continue; }
    if (!conf.positional && !argv.includes(conf.flag)) missing.push(conf.flag);
  }
  check(`argv 形状：${id}`, argv[0] === spec.cli && missing.length === 0, `${argv.join(' ')}${missing.length ? ' 缺 ' + missing.join(',') : ''}`);
}

check('位置参数不带 flag：project.create', JSON.stringify(toArgv('project.create', { slug: 'abc' })) === JSON.stringify(['new-project', 'abc']));
check('布尔 flag 只在 true 时出现', !toArgv('draft.check_citations', { draft: 'd.md' }).includes('--require-doi'));
check('空值跳过', toArgv('journal.check', { project: 'zt', journal: '' }).length === 3);
check('未知子命令抛错', (() => { try { toArgv('nope.nope', {}); return false; } catch { return true; } })());

console.log('\n超时覆盖');
check('journal.check 120s', KIND_TIMEOUTS['journal.check'] === 120_000);
check('draft.package 180s', KIND_TIMEOUTS['draft.package'] === 180_000);

console.log(`\n${pass} 通过 · ${fail} 失败`);
process.exit(fail ? 1 : 0);

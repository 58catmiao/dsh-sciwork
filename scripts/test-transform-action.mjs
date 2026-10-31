#!/usr/bin/env node
/**
 * 数据变换 —— 端到端（scripts/test-transform-action.mjs）
 * ---------------------------------------------------------------------------
 * 前两份测试只管内核（`lib/transform.js`）；这一份从**动作入口**跑，验的是实际会写盘的那条路：
 *
 *   handleResearchCall({ action: 'tableTransform', args }) → runTransform → 写 tables/<名>.csv
 *     → 写 `.research/transforms/<课题>/<名>.json` 溯源 → reindexAfter
 *
 * 断言：
 *   [1] 六个算子各跑一遍，产物文件真的存在，读回来数值与内核一致、行数没变。
 *   [2] 溯源侧车字段齐（schema / source / op / params / output / rows / columns / createdAt），
 *       且 params 里留下了 x / y 的真实取值（不是 undefined）。
 *   [3] 同名产物再跑一次 → `conflict`（不覆盖）；给 overwrite:true 才覆盖。
 *   [4] 错误路径：未知算子、非法 outName、源数据不存在 —— 都是 `bad-request`，且**不留下半截产物**。
 *   [5] 原始数据文件在整轮里一个字节都没变（sha 前后一致）。
 *
 * 全程在临时目录里造库（`SCIWORK_LIBRARY` 指过去），不碰真库。
 * `node scripts/test-transform-action.mjs`
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sciwork-xf-'));
process.env.SCIWORK_LIBRARY = tmp;

const { handleResearchCall } = await import('../lib/actions.js');

let pass = 0;
let fail = 0;
function check(label, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  PASS  ${label}${detail ? `  —— ${detail}` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? `  —— ${detail}` : ''}`); }
}
const near = (a, b, tol = 1e-6) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const readCsv = (p) => {
  const lines = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
  return lines.map((l) => l.split(',').map((c) => (c === '' ? null : Number.isNaN(Number(c)) ? c : Number(c))));
};

/* 造一个最小库：一个课题 + 两张源数据表 */
const proj = path.join(tmp, 'projects', 'p1');
fs.mkdirSync(path.join(proj, 'data'), { recursive: true });
fs.writeFileSync(path.join(proj, 'project.json'), JSON.stringify({ slug: 'p1', title: '测试课题', stage: 'data' }, null, 1), 'utf8');

const xs = Array.from({ length: 20 }, (_, i) => i + 1);
// 峰在 x=5（高 10）与 x=14（高 6），基线 1
const ys = xs.map((x) => (x === 5 ? 11 : x === 14 ? 7 : 1));
const csv1 = ['2theta,intensity', ...xs.map((x, i) => `${x},${ys[i]}`)].join('\n') + '\n';
const dataRel = 'projects/p1/data/scan.csv';
fs.writeFileSync(path.join(proj, 'data', 'scan.csv'), csv1, 'utf8');
const before = sha(path.join(proj, 'data', 'scan.csv'));

const call = async (args) => handleResearchCall({ action: 'tableTransform', args });

console.log('== 1. 六个算子端到端 ==');
const cases = [
  { op: 'normalize', params: { mode: 'minmax' }, expect: (rows) => near(rows[1][1], 0) },
  { op: 'baseline', params: { mode: 'min', x: '0' }, expect: (rows) => near(Math.min(...rows.slice(1).map((r) => r[1])), 0) },
  { op: 'smooth', params: { mode: 'mean', window: '3' }, expect: (rows) => near(rows[4][1], (1 + 1 + 11) / 3, 1e-6) },
  { op: 'peaks', params: { x: '0', minGap: '1', minHeight: '0.1' }, expect: (rows) => rows.slice(1).filter((r) => r[2] !== null).length === 2 },
  { op: 'integrate', params: { x: '0' }, expect: null },
  { op: 'linear', params: { a: '2', b: '1' }, expect: (rows) => near(rows[1][1], 3) },
];

for (const c of cases) {
  const res = await call({
    project: 'p1', data: dataRel, op: c.op, x: c.params.x, y: '1',
    outName: 'out-' + c.op, params: c.params,
  });
  const ok = res && res.ok === true && res.value && res.value.ok === true;
  check(`${c.op}：动作成功`, ok, ok ? `rows ${res.value.rows} · ${res.value.output}` : JSON.stringify(res.error || res.value || {}));
  if (!ok) continue;

  const outAbs = path.join(tmp, res.value.output);
  check(`${c.op}：产物文件真的写出来了`, fs.existsSync(outAbs), res.value.output);
  const rows = readCsv(outAbs);
  check(`${c.op}：行数 = 源表行数 + 表头`, rows.length === xs.length + 1, String(rows.length));
  if (c.expect) check(`${c.op}：数值正确`, c.expect(rows), JSON.stringify(rows[0]));

  const traceAbs = path.join(tmp, '.research', 'transforms', 'p1', `out-${c.op}.json`);
  check(`${c.op}：溯源侧车写出来了`, fs.existsSync(traceAbs));
  if (fs.existsSync(traceAbs)) {
    const tr = JSON.parse(fs.readFileSync(traceAbs, 'utf8'));
    const fields = ['schema', 'source', 'op', 'params', 'output', 'rows', 'columns', 'createdAt'];
    check(`${c.op}：溯源字段齐`, fields.every((f) => tr[f] !== undefined), fields.filter((f) => tr[f] === undefined).join(',') || '齐');
    check(`${c.op}：溯源记住 op 与源文件`, tr.op === c.op && tr.source === dataRel, `${tr.op} ← ${tr.source}`);
    check(`${c.op}：溯源 params 不是 undefined`, tr.params && tr.params.y === '1',
      JSON.stringify(tr.params));
  }
}

console.log('== 2. 幂等重放 / 同名冲突 / 覆盖 ==');
{
  const args = { project: 'p1', data: dataRel, op: 'normalize', y: '1', outName: 'dup', params: { mode: 'max1' } };
  const first = await call(args);
  check('第一次写 dup 成功', first.ok === true && first.value.ok === true);
  // 写动作带幂等键：**同样参数再点一次**会被宿主判成重放，直接把上次的回执还回来，不会重复写盘。
  // （这也意味着「点了两次」不会报冲突，是设计如此——别把它当 bug 去改。）
  const replay = await call(args);
  check('同样的写动作再点一次 → 幂等重放（不重复写盘）',
    replay.ok === true && JSON.stringify(replay.value) === JSON.stringify(first.value),
    replay.ok ? '回执与首次一致' : JSON.stringify(replay.error));
  // 换成另一个算子、同一个输出名 —— 参数不同，不会命中幂等键，应当撞 conflict 而不是静默覆盖。
  const clash = await call({ ...args, op: 'linear', params: { a: '2', b: '0' } });
  const clashCode = clash.ok === false ? clash.error.code : (clash.value || {}).code;
  check('同名产物换个算子写 → conflict（不覆盖）', clash.ok === false && clashCode === 'conflict',
    clashCode || JSON.stringify(clash.value || {}));
  const forced = await call({ ...args, op: 'linear', params: { a: '2', b: '0' }, overwrite: true });
  check('给 overwrite:true 才覆盖', forced.ok === true && forced.value.ok === true);
}

console.log('== 3. 错误路径 ==');
{
  const bad = async (label, args, expectCode = 'bad-request') => {
    const r = await call(args);
    const code = r.ok === false ? r.error.code : null;
    check(label, code === expectCode, code || JSON.stringify(r.value || {}));
  };
  await bad('未知算子 → bad-request', { project: 'p1', data: dataRel, op: 'fft', y: '1', params: {} });
  await bad('非法 outName → bad-request', { project: 'p1', data: dataRel, op: 'normalize', y: '1', outName: '../逃出去', params: {} });
  await bad('源数据不存在 → not-found', { project: 'p1', data: 'projects/p1/data/nope.csv', op: 'normalize', y: '1', params: {} }, 'not-found');
  await bad('缺 project → bad-request', { data: dataRel, op: 'normalize', y: '1', params: {} });
  await bad('没选 Y 列 → bad-request', { project: 'p1', data: dataRel, op: 'normalize', params: {} });
  const leftovers = fs.readdirSync(path.join(proj, 'tables')).filter((f) => f.startsWith('fft') || f.includes('逃'));
  check('错误路径没留下半截产物', leftovers.length === 0, leftovers.join(',') || '干净');
}

console.log('== 4. 源数据一个字节都没动 ==');
{
  check('scan.csv 前后 sha256 一致', sha(path.join(proj, 'data', 'scan.csv')) === before);
  const listings = fs.readdirSync(path.join(proj, 'tables')).sort();
  console.log(`  产物：${listings.join(', ')}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('');
console.log(`汇总  ${pass} 通过 · ${fail} 失败`);
process.exit(fail ? 1 : 0);

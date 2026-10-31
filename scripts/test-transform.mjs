#!/usr/bin/env node
/**
 * 数据变换内核精度自检（scripts/test-transform.mjs）
 * ---------------------------------------------------------------------------
 * 只测 `lib/transform.js` 的 `baseline(..., 'ends')`：口径必须与 Python 侧
 * `library/scripts/analysis.py` 的 `_subtract_baseline(..., 'ends')` 一致 ——
 * **首段 + 末段联合拟合一条直线**（原点序拼接后做一次最小二乘），
 * 不是只拟合首段、不是取其一、也不是两条线。
 *
 * 全部用已知真值的合成曲线（无随机、无外部依赖），断言：
 *   [1] 两端同斜率（+1）、中间数据在基线上方：ends=10 扣完后，
 *       首段与末段的残差均值都 ≈ 0（< 1e-6），中间隆起仍在。
 *   [2] 两端不同斜率（首 +1 / 末 −1）：联合拟合后，
 *       末段残差远小于「只用首段拟合」、首段残差远小于「只用末段拟合」；
 *       且结果与只拟合首段显著不同（末段差得远）。
 *   [3] 点数不足 / X 全同：返回「没扣基线」的结果，不抛错。
 *
 * 纯 JS，直接 `node scripts/test-transform.mjs`；不碰库、不写盘。
 */

import { baseline } from '../lib/transform.js';

let pass = 0;
let fail = 0;
function check(label, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  PASS  ${label}${detail ? `  —— ${detail}` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? `  —— ${detail}` : ''}`); }
}
const fmt = (v) => (Number.isFinite(v) ? (v === 0 ? '0' : v.toExponential(3)) : String(v));
const fixed = (v, d = 4) => (Number.isFinite(v) ? v.toFixed(d) : String(v));
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
const meanAbs = (arr) => mean(arr.map((v) => Math.abs(v)));
const maxAbs = (arr) => Math.max(...arr.map((v) => Math.abs(v)));

/** 最小二乘直线 y = k·x + c（只给 [[x,y], …]；不足 2 点 / X 全同返回 null）。 */
function fitLine(pairs) {
  if (pairs.length < 2) return null;
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  const den = pairs.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  if (Math.abs(den) < 1e-12) return null;
  const k = pairs.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / den;
  return { k, c: my - k * mx };
}
const evalLine = (f, x) => f.k * x + f.c;

/** { header: ['x','y'], rows: [[x,y], …] } */
function tableFrom(xs, ys) {
  return { header: ['x', 'y'], delimiter: ',', rows: xs.map((x, i) => [x, ys[i]]) };
}
const yOf = (res) => res.table.rows.map((r) => r[1]);

console.log('\n数据变换内核自检：baseline ends 联合拟合（对齐 Python analysis.py 口径）');

// ─────────────────────────── [1] 两端同斜率 + 中间隆起 ───────────────────────────

console.log('\n[1] 两端同斜率（+1）、中间数据在基线上方：ends=10 扣完后两端残差均值 ≈ 0');
{
  const xs = Array.from({ length: 100 }, (_, i) => i);
  const line = (x) => x + 20; // 两端所在的真基线
  const bump = (x) => Math.max(0, 45 - Math.abs(x - 50)); // 中间隆起（在基线上方）
  const ys = xs.map((x) => {
    if (x < 10 || x >= 90) return line(x);       // 首段 / 末段严格落在基线上
    return line(x) + bump(x);                    // 中段：基线上方
  });
  const tab = tableFrom(xs, ys);
  const before = JSON.parse(JSON.stringify(tab.rows));
  const res = baseline(tab, 1, 0, 'ends', 10);
  const corrected = yOf(res);
  const head = corrected.slice(0, 10);
  const tail = corrected.slice(-10);
  const mid = corrected.slice(10, 90);

  check('首段残差均值 ≈ 0（< 1e-6）', Math.abs(mean(head)) < 1e-6,
    `mean=${fmt(mean(head))} · max|x|=${fmt(maxAbs(head))}`);
  check('末段残差均值 ≈ 0（< 1e-6）', Math.abs(mean(tail)) < 1e-6,
    `mean=${fmt(mean(tail))} · max|x|=${fmt(maxAbs(tail))}`);
  check('两端残差逐点都为 0 量级（max|x| < 1e-6）', maxAbs([...head, ...tail]) < 1e-6,
    `max|x|=${fmt(maxAbs([...head, ...tail]))}`);
  check('中间隆起没有被一起扣掉（仍明显 > 0）', Math.min(...mid) > 4.9,
    `中段最小残差 ${fixed(Math.min(...mid))}（隆起峰值 ${fixed(Math.max(...mid))}）`);
  // 从「原值 − 校正值」反推拟合出的直线，必须就是 y = x + 20
  const implied = fitLine(xs.slice(0, 10).map((x, i) => [x, ys[i] - corrected[i]]));
  check('拟合出的直线就是 y = x + 20（k=1, c=20）',
    implied && Math.abs(implied.k - 1) < 1e-9 && Math.abs(implied.c - 20) < 1e-9,
    implied ? `k=${fixed(implied.k, 12)}, c=${fixed(implied.c, 12)}` : '拟不出来');
  check('原始表不被就地修改', JSON.stringify(tab.rows) === JSON.stringify(before));
  check('notes 写明「联合拟合」', /联合拟合/.test((res.notes || []).join(' ')),
    (res.notes || []).join(' '));
}

// ─────────────────────────── [2] 两端不同斜率 ───────────────────────────

console.log('\n[2] 两端不同斜率（首 +1 / 末 −1）：联合拟合 vs 只拟合首段 / 末段');
{
  const xs = Array.from({ length: 100 }, (_, i) => i);
  const ys = xs.map((x) => {
    if (x < 10) return x;                        // 首段：斜率 +1，落在 y = x
    if (x >= 90) return 94.5 - x;                // 末段：斜率 −1（x=90..99 → 4.5..−4.5）
    return 9 + 30 * Math.sin((Math.PI * (x - 9)) / 81); // 中段（不参与拟合细节）
  });
  const tab = tableFrom(xs, ys);

  // 参照：只拟合首段 / 只拟合末段（注释里写明这是「旧口径」的两条对照线）
  const headPairs = xs.slice(0, 10).map((x, i) => [x, ys[i]]);
  const tailPairs = xs.slice(-10).map((x, i) => [x, ys[90 + i]]);
  const headOnly = fitLine(headPairs);
  const tailOnly = fitLine(tailPairs);

  const res = baseline(tab, 1, 0, 'ends', 10);
  const corrected = yOf(res);
  const jointHead = corrected.slice(0, 10);
  const jointTail = corrected.slice(-10);

  // 旧口径 A：只拟合首段 → 用它扣全表时，末段还剩下多少残差
  const headOnlyTailResid = ys.slice(90).map((y, i) => y - evalLine(headOnly, 90 + i));
  // 旧口径 B：只拟合末段 → 用它扣全表时，首段还剩下多少残差
  const tailOnlyHeadResid = ys.slice(0, 10).map((y, i) => y - evalLine(tailOnly, i));
  // 旧口径 A 扣全表后的末段校正值（用来证明「联合拟合 ≠ 只拟合首段」）
  const headOnlyTailCorrected = ys.slice(90).map((y, i) => y - evalLine(headOnly, 90 + i));

  const jointTailMA = meanAbs(jointTail);
  const headOnlyTailMA = meanAbs(headOnlyTailResid);
  const jointHeadMA = meanAbs(jointHead);
  const tailOnlyHeadMA = meanAbs(tailOnlyHeadResid);

  check('末段残差远小于「只用首段拟合」时（< 10%）', jointTailMA < headOnlyTailMA * 0.1,
    `联合 ${fixed(jointTailMA, 3)} vs 只拟合首段 ${fixed(headOnlyTailMA, 3)}（${fixed((jointTailMA / headOnlyTailMA) * 100, 1)}%）`);
  check('首段残差远小于「只用末段拟合」时（< 10%）', jointHeadMA < tailOnlyHeadMA * 0.1,
    `联合 ${fixed(jointHeadMA, 3)} vs 只拟合末段 ${fixed(tailOnlyHeadMA, 3)}（${fixed((jointHeadMA / tailOnlyHeadMA) * 100, 1)}%）`);
  check('联合拟合 ≠ 只拟合首段（末段校正值差得很远）',
    maxAbs(jointTail.map((v, i) => v - headOnlyTailCorrected[i])) > 50,
    `末段最大差 ${fixed(maxAbs(jointTail.map((v, i) => v - headOnlyTailCorrected[i])), 2)}`);
  check('两端残差和为零（10 对 10 联合最小二乘的平衡性）',
    Math.abs(mean(jointHead) + mean(jointTail)) < 1e-9,
    `首段均值 ${fmt(mean(jointHead))} + 末段均值 ${fmt(mean(jointTail))} = ${fmt(mean(jointHead) + mean(jointTail))}`);
  check('原始表不被就地修改', JSON.stringify(tab.rows) === JSON.stringify(tableFrom(xs, ys).rows));
  check('notes 写明「联合拟合」', /联合拟合/.test((res.notes || []).join(' ')),
    (res.notes || []).join(' '));
}

// ─────────────────────────── [3] 点数不足 / X 全同 ───────────────────────────

console.log('\n[3] 点数不足 / X 全同：返回「没扣基线」的结果，不抛错');
{
  // 只有 1 个有效点：连直线都定不下来，必须原样返回
  const one = tableFrom([1], [5]);
  let thrown = null;
  let res1 = null;
  try { res1 = baseline(one, 1, 0, 'ends', 10); } catch (e) { thrown = e; }
  check('1 个有效点：不抛错', thrown === null, thrown ? String(thrown.message) : '');
  check('1 个有效点：Y 原样返回', res1 && JSON.stringify(yOf(res1)) === '[5]',
    res1 ? JSON.stringify(yOf(res1)) : '（没返回值）');
  check('1 个有效点：notes 说明有效点不足', res1 && /有效点少于 2/.test((res1.notes || []).join(' ')),
    res1 ? (res1.notes || []).join(' ') : '（没返回值）');
  check('1 个有效点：返回形状仍是 { table, notes }',
    !!res1 && !!res1.table && Array.isArray(res1.table.rows) && Array.isArray(res1.notes));

  // X 全同：最小二乘的分母为 0，不能假装拟出了基线
  const sameX = tableFrom([7, 7, 7, 7, 7], [1, 2, 3, 4, 5]);
  let res2 = null;
  let thrown2 = null;
  try { res2 = baseline(sameX, 1, 0, 'ends', 2); } catch (e) { thrown2 = e; }
  check('X 全同：不抛错', thrown2 === null, thrown2 ? String(thrown2.message) : '');
  check('X 全同：Y 原样返回（不扣基线）',
    res2 && JSON.stringify(yOf(res2)) === JSON.stringify([1, 2, 3, 4, 5]),
    res2 ? JSON.stringify(yOf(res2)) : '（没返回值）');
  check('X 全同：notes 说清拟不出基线', res2 && /X 变化太小/.test((res2.notes || []).join(' ')),
    res2 ? (res2.notes || []).join(' ') : '（没返回值）');

  // Y 全空：连有效点都没有
  const empty = { header: ['x', 'y'], delimiter: ',', rows: [[1, null], [2, null], [3, null]] };
  let res3 = null;
  let thrown3 = null;
  try { res3 = baseline(empty, 1, 0, 'ends', 10); } catch (e) { thrown3 = e; }
  check('Y 全空：不抛错且原样返回', thrown3 === null && res3 && JSON.stringify(yOf(res3)) === '[null,null,null]',
    thrown3 ? String(thrown3.message) : '');
}

// ─────────────────────────── 收尾 ───────────────────────────

console.log(`\n${'='.repeat(72)}`);
console.log(`${pass} 通过 · ${fail} 失败`);
process.exit(fail ? 1 : 0);

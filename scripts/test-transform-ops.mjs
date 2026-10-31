#!/usr/bin/env node
/**
 * 数据变换 —— 六个算子逐个跑一遍（scripts/test-transform-ops.mjs）
 * ---------------------------------------------------------------------------
 * `scripts/test-transform.mjs` 只钉 `baseline ends` 的精度；这一份管「每个算子从面板
 * 传参数进来能不能算对、算不对的时候会不会吭声」：
 *
 *   normalize  minmax / zscore / max1   + 零跨度、空列的原样返回
 *   baseline   min / ends
 *   smooth     mean / median            + 缺口不跨接
 *   integrate                           + 缺口分段、不算跨缺口面积
 *   peaks                               + 最小间距去重、最小相对峰高
 *   linear     y' = a·y + b
 * 以及错误路径：未知算子、没选 Y 列、Y/X 列越界、**空串参数不能悄悄变成第 0 列**、
 * a/b 空串走默认值、表→CSV 的分隔符与引号。
 *
 * 全部用已知真值的合成表（无随机、不碰库、不写盘）。`node scripts/test-transform-ops.mjs`
 */

import {
  runTransform, normalize, baseline, smooth, integrate, peaks, linear, tableToCsv, TRANSFORM_OPS,
} from '../lib/transform.js';

let pass = 0;
let fail = 0;
function check(label, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  PASS  ${label}${detail ? `  —— ${detail}` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? `  —— ${detail}` : ''}`); }
}
const fixed = (v, d = 4) => (Number.isFinite(v) ? v.toFixed(d) : String(v));
const near = (a, b, tol = 1e-9) => Number.isFinite(a) && Math.abs(a - b) <= tol;

/** 造一张表：xs / ys 两列，rows 里 null 表示缺失。 */
function makeTable(xs, ys) {
  return {
    header: ['2θ', 'Intensity'],
    delimiter: ',',
    rows: xs.map((x, i) => [x, ys[i]]),
  };
}

console.log('== 1. normalize 三种方式 ==');
{
  const t = makeTable([0, 1, 2, 3], [10, 20, 30, 40]);
  const a = runTransform(t, 'normalize', { y: '1', mode: 'minmax' });
  check('minmax 把最小值压到 0、最大值压到 1',
    near(a.table.rows[0][1], 0) && near(a.table.rows[3][1], 1), `${fixed(a.table.rows[0][1])} … ${fixed(a.table.rows[3][1])}`);
  check('minmax 改列名（标注做了什么）', String(a.table.header[1]).includes('归一化'), a.table.header[1]);

  const b = runTransform(t, 'normalize', { y: '1', mode: 'zscore' });
  const zs = b.table.rows.map((r) => r[1]);
  check('zscore 均值 ≈ 0', near(zs.reduce((s, v) => s + v, 0) / zs.length, 0, 1e-9));
  const sd = Math.sqrt(zs.reduce((s, v) => s + v ** 2, 0) / (zs.length - 1));
  check('zscore 样本标准差 ≈ 1', near(sd, 1, 1e-9), fixed(sd));

  const c = runTransform(t, 'normalize', { y: '1', mode: 'max1' });
  check('max1 = 除以最大值', near(c.table.rows[3][1], 1) && near(c.table.rows[0][1], 0.25), fixed(c.table.rows[0][1]));

  const flat = makeTable([0, 1, 2], [5, 5, 5]);
  const d = runTransform(flat, 'normalize', { y: '1', mode: 'minmax' });
  check('零跨度：原样返回 + 一条说明，不抛错',
    d.table.rows[1][1] === 5 && d.notes.length === 1, d.notes[0]);

  const allNull = makeTable([0, 1, 2], [null, null, null]);
  const e = runTransform(allNull, 'normalize', { y: '1', mode: 'minmax' });
  check('整列缺失：不崩、不造数', e.table.rows.every((r) => r[1] === null));
}

console.log('== 2. baseline ==');
{
  const t = makeTable([0, 1, 2, 3], [10, 20, 30, 40]);
  const m = runTransform(t, 'baseline', { y: '1', mode: 'min' });
  check('min 方式：减全局最小值 → 最小变 0',
    near(Math.min(...m.table.rows.map((r) => r[1])), 0), fixed(m.table.rows[0][1]));
  check('min 方式不动 X 列', m.table.rows[3][0] === 3);

  // 基线 = 2 + 0.5x，别处无信号 → 扣完应当全 0
  const xs = Array.from({ length: 20 }, (_, i) => i);
  const ys = xs.map((x) => 2 + 0.5 * x);
  const e = runTransform(makeTable(xs, ys), 'baseline', { y: '1', mode: 'ends', ends: '5' });
  check('ends 方式：纯斜坡扣完 ≈ 0', e.table.rows.every((r) => Math.abs(r[1]) < 1e-9),
    fixed(Math.max(...e.table.rows.map((r) => Math.abs(r[1])))));
  check('ends 的 ends 以「点数」计（字符串参数也认）', String(e.notes[0]).includes('首/末各 5 个'), e.notes[0]);
}

console.log('== 3. smooth ==');
{
  const t = makeTable([0, 1, 2, 3, 4], [0, 0, 9, 0, 0]);
  const mean5 = runTransform(t, 'smooth', { y: '1', mode: 'mean', window: '5' });
  check('滑动平均 w=5：尖峰被摊薄到 9/5', near(mean5.table.rows[2][1], 1.8), fixed(mean5.table.rows[2][1]));
  const med3 = runTransform(t, 'smooth', { y: '1', mode: 'median', window: '3' });
  check('滑动中值 w=3：孤立尖峰被抹平', near(med3.table.rows[2][1], 0), fixed(med3.table.rows[2][1]));
  check('平滑改列名并说明窗口', String(med3.table.header[1]).includes('中值') && String(mean5.table.header[1]).includes('w=5'),
    `${med3.table.header[1]} / ${mean5.table.header[1]}`);

  const gap = makeTable([0, 1, 2, 3, 4], [1, 1, null, 1, 1]);
  const g = runTransform(gap, 'smooth', { y: '1', mode: 'mean', window: '3' });
  check('缺口不跨接：缺失点仍是缺失', g.table.rows[2][1] === null);
  check('缺口两侧只用各自有效邻点', near(g.table.rows[1][1], 1) && near(g.table.rows[3][1], 1),
    `${fixed(g.table.rows[1][1])} / ${fixed(g.table.rows[3][1])}`);
}

console.log('== 4. integrate ==');
{
  // y = 1 全程，x 步长 1，10 行 → 面积 9
  const xs = Array.from({ length: 10 }, (_, i) => i);
  const flat = makeTable(xs, xs.map(() => 1));
  const r = runTransform(flat, 'integrate', { x: '0', y: '1' });
  check('常量 1 的梯形积分 = 区间长', near(r.meta.area, 9, 1e-9), fixed(r.meta.area));
  check('积分新增一列，且每行带上所在段面积',
    r.table.header.length === 3 && near(r.table.rows[4][2], 9), r.table.header.join('|'));

  const gap = makeTable(xs, xs.map((i) => (i === 4 || i === 5 ? null : 1)));
  const g = runTransform(gap, 'integrate', { x: '0', y: '1' });
  check('缺口分段：段数 = 2', g.meta.segments === 2, String(g.meta.segments));
  check('缺口不估算面积：8 行 1 → 两段各 3 与 3', near(g.meta.area, 6, 1e-9), fixed(g.meta.area));
  check('缺口行不带面积', g.table.rows[4][2] === null && g.table.rows[5][2] === null);
}

console.log('== 5. peaks ==');
{
  // 两个峰：x=2 处 10，x=7 处 6，其余 0
  const xs = Array.from({ length: 10 }, (_, i) => i);
  const ys = xs.map((x) => (x === 2 ? 10 : x === 7 ? 6 : 0));
  const r = runTransform(makeTable(xs, ys), 'peaks', { x: '0', y: '1', minGap: '1' });
  check('认出两个峰', r.meta.peaks.length === 2, r.meta.peaks.map((p) => p.x).join(','));
  check('峰序号写进新列（按 X 升序 1、2）',
    r.table.rows[2][2] === 1 && r.table.rows[7][2] === 2,
    `${r.table.rows[2][2]} / ${r.table.rows[7][2]}`);
  check('不改变原 Y 值（只加列、不动数据）', r.table.rows[2][1] === 10);

  const close = xs.map((x) => (x === 2 ? 10 : x === 3 ? 8 : 0));
  const d = runTransform(makeTable(xs, close), 'peaks', { x: '0', y: '1', minGap: '5' });
  check('最小间距内只留最高那个', d.meta.peaks.length === 1 && near(d.meta.peaks[0].x, 2),
    d.meta.peaks.map((p) => p.x).join(','));

  const low = xs.map((x) => (x === 2 ? 10 : x === 7 ? 1 : 0));
  const h = runTransform(makeTable(xs, low), 'peaks', { x: '0', y: '1', minGap: '1', minHeight: '0.2' });
  check('最小相对峰高过滤掉矮峰', h.meta.peaks.length === 1 && near(h.meta.peaks[0].x, 2),
    h.meta.peaks.map((p) => p.x).join(','));
}

console.log('== 6. linear ==');
{
  const t = makeTable([0, 1, 2], [1, 2, 3]);
  const r = runTransform(t, 'linear', { y: '1', a: '2', b: '5' });
  check("y' = 2y + 5", r.table.rows[0][1] === 7 && r.table.rows[2][1] === 11,
    r.table.rows.map((x) => x[1]).join(','));
  check('linear 不动 X 列', r.table.rows[2][0] === 2);

  const d = runTransform(t, 'linear', { y: '1', a: '', b: '' });
  check('a / b 空串走默认 1 / 0（不能当 0 用）', d.table.rows[2][1] === 3, String(d.table.rows[2][1]));

  const lbl = runTransform(t, 'linear', { y: '1', a: '1', b: '0', label: 'cps' });
  check('给了 label 就用 label 当列名后缀', String(lbl.table.header[1]).includes('cps'), lbl.table.header[1]);
}

console.log('== 7. 错误路径（必须报错，不能静默算错） ==');
{
  const t = makeTable([0, 1, 2], [1, 2, 3]);
  const throws = (label, fn, expect) => {
    let msg = '';
    try { fn(); } catch (e) { msg = String(e.message || e); }
    const ok = !!msg && (!expect || msg.includes(expect));
    check(label, ok, msg || '（没有抛错）');
  };
  throws('未知算子要报错', () => runTransform(t, 'fft', { y: '1' }), '未知的变换');
  throws('没选 Y 列要报错', () => runTransform(t, 'normalize', {}), '没有选 Y 列');
  throws('Y 空串要报错（不能悄悄当第 0 列）', () => runTransform(t, 'normalize', { y: '' }), '没有选 Y 列');
  throws('Y 列越界要报错', () => runTransform(t, 'normalize', { y: '9' }), '超出范围');
  throws('X 列越界要报错', () => runTransform(t, 'integrate', { x: '9', y: '1' }), '超出范围');
  throws('未知归一化方式要报错', () => normalize(t, 1, 'log'), '未知的归一化方式');
  throws('未知基线方式要报错', () => baseline(t, 1, 0, 'poly'), '未知的基线方式');
  throws('linear 系数不是数字要报错', () => linear(t, 1, { a: 'x', b: 0 }), '必须是数字');
  check('TRANSFORM_OPS 六个算子齐全',
    TRANSFORM_OPS.map((o) => o.id).sort().join(',') === 'baseline,integrate,linear,normalize,peaks,smooth',
    TRANSFORM_OPS.map((o) => o.id).join(','));
}

console.log('== 8. 表 → CSV ==');
{
  const t = { header: ['a', 'b'], delimiter: ',', rows: [[1, 'x,y'], [2, 'he said "hi"']] };
  const csv = tableToCsv(t);
  check('含分隔符的字段加引号', csv.includes('"x,y"'), csv.split('\n')[1]);
  check('字段里的引号转义成两个', csv.includes('"he said ""hi"""'), csv.split('\n')[2]);
  const tab = { header: ['a', 'b'], delimiter: '\t', rows: [[1, 2]] };
  check('沿用原分隔符（制表符表就输出制表符）', tableToCsv(tab).includes('\t'), JSON.stringify(tableToCsv(tab)));
  const noHead = { header: [], delimiter: ',', rows: [[1, 2, 3]] };
  check('没有表头也补一行，否则下游会当数据行吃掉', tableToCsv(noHead).split('\n').length >= 2);
}

console.log('');
console.log(`汇总  ${pass} 通过 · ${fail} 失败`);
process.exit(fail ? 1 : 0);

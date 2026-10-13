/**
 * 科研模式 · 数据变换内核（宿主侧，纯 JS）
 * ---------------------------------------------------------------------------
 * 为什么放宿主而不是走 Origin：
 *   这些都是纯数值运算（归一化/基线/平滑/积分/求峰/线性换算）。放这里 =
 *   点一下就出结果、**不需要开 Origin**、不占 COM 通道，也就不用经 agent 转发。
 *   真正需要 Origin 表格引擎的公式列（`origin_column_formula`）仍然留给智能体。
 *
 * 三条硬纪律（对应你们既有的数据纪律）：
 *   1. **原始数据只读**：本模块只返回新表，绝不就地改传入对象。
 *   2. **缺失值不插值、不填充**：null/NaN 一律保持 null。平滑只在该点本身有值时给出结果。
 *   3. **派生另存 + 写溯源**：产物落到 `projects/<课题>/tables/`，参数记进
 *      `.research/transforms/<课题>/<名字>.json`，谁做的、什么参数、基于哪个文件，一清二楚。
 *
 * 表结构沿用 `table.js` 的 parseTable：{ header: string[], rows: number[][] }。
 */

const EPS = 1e-12;

/** 深拷贝 + 数值清洗：把不可解析的值统一成 null。 */
export function cloneTable(table) {
  return {
    header: table.header.slice(),
    rows: table.rows.map((r) => r.map((v) => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null))),
    headerless: !!table.headerless,
    delimiter: table.delimiter,
  };
}

const valid = (rows, yi) => rows.map((r) => (Number.isFinite(r[yi]) ? r[yi] : null));

/** 统计一批数（忽略 null），返回 count/min/max/mean。 */
export function stats(values) {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return { count: 0, min: null, max: null, mean: null };
  return {
    count: v.length,
    min: Math.min(...v),
    max: Math.max(...v),
    mean: v.reduce((a, b) => a + b, 0) / v.length,
  };
}

/* ------------------------------------------------------------------ 算子 */

/** 归一化：minmax（0~1）/ zscore（0 均值 1 标准差）/ max1（除以最大值）。 */
export function normalize(table, yi, mode = 'minmax') {
  const t = cloneTable(table);
  const y = valid(t.rows, yi);
  const s = stats(y);
  const notes = [];
  if (s.count === 0) return { table: t, notes: ['这一列没有任何有效数值，原样返回。'] };
  if (mode === 'minmax') {
    const span = s.max - s.min;
    if (Math.abs(span) < EPS) return { table: t, notes: ['这一列所有值相同，归一化无意义，原样返回。'] };
    t.rows.forEach((r) => { if (r[yi] !== null) r[yi] = (r[yi] - s.min) / span; });
    t.header[yi] = `${t.header[yi]}（归一化 0~1）`;
  } else if (mode === 'zscore') {
    const sd = Math.sqrt(y.reduce((a, b) => a + (b - s.mean) ** 2, 0) / Math.max(1, s.count - 1));
    if (sd < EPS) return { table: t, notes: ['标准差为 0，z-score 无意义，原样返回。'] };
    t.rows.forEach((r) => { if (r[yi] !== null) r[yi] = (r[yi] - s.mean) / sd; });
    t.header[yi] = `${t.header[yi]}（z-score）`;
  } else if (mode === 'max1') {
    if (Math.abs(s.max) < EPS) return { table: t, notes: ['最大值接近 0，除以它无意义，原样返回。'] };
    t.rows.forEach((r) => { if (r[yi] !== null) r[yi] = r[yi] / s.max; });
    t.header[yi] = `${t.header[yi]}（÷最大值）`;
  } else {
    throw new Error(`未知的归一化方式：${mode}`);
  }
  notes.push(`有效点 ${s.count}/${t.rows.length}，最小 ${round(s.min)}，最大 ${round(s.max)}。`);
  return { table: t, notes };
}

/**
 * 基线扣除：min（减最小值）/ ends（用两端各 n 点线性拟合的基线相减）。
 * 注意：xi 是用户选的 X 列（默认 0）；ends 模式按 X 拟合基线，必须用真正的 X，不能写死第 0 列。
 */
export function baseline(table, yi, xi = 0, mode = 'min', ends = 5) {
  const t = cloneTable(table);
  const y = valid(t.rows, yi);
  const idx = y.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
  if (idx.length < 2) return { table: t, notes: ['有效点少于 2 个，基线无法拟合，原样返回。'] };
  const notes = [];
  if (mode === 'min') {
    const b = Math.min(...idx.map((i) => y[i]));
    t.rows.forEach((r) => { if (r[yi] !== null) r[yi] -= b; });
    t.header[yi] = `${t.header[yi]}（已减基线 ${round(b)}）`;
    notes.push(`减的是全局最小值 ${round(b)}（不是逐段基线）。`);
  } else if (mode === 'ends') {
    const n = Math.max(2, Math.min(ends, Math.floor(idx.length / 2)));
    const head = idx.slice(0, n);
    const tail = idx.slice(-n);
    const xv = valid(t.rows, xi);
    const fit = (ids) => {
      const xs = ids.map((i) => xv[i]).filter((x) => x !== null);
      const ys = ids.map((i) => y[i]);
      if (xs.length < 2) return null;
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
      if (Math.abs(den) < EPS) return null;
      const k = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den;
      return { k, c: my - k * mx };
    };
    const f = fit(head) || fit(tail);
    if (!f) return { table: t, notes: ['X 变化太小，拟不出基线，原样返回。'] };
    t.rows.forEach((r, i) => { if (r[yi] !== null && r[xi] !== null) r[yi] = r[yi] - (f.k * r[xi] + f.c); });
    t.header[yi] = `${t.header[yi]}（已扣两端线性基线）`;
    notes.push(`用首/末各 ${n} 个有效点拟合基线后相减。`);
  } else {
    throw new Error(`未知的基线方式：${mode}`);
  }
  return { table: t, notes };
}

/** 平滑：滑动平均 / 滑动中值。**窗口内全空则该点保持 null**（不跨缺口造值）。 */
export function smooth(table, yi, window = 5, mode = 'mean') {
  const t = cloneTable(table);
  const w = Math.max(1, Math.round(Number(window) || 1));
  const y = valid(t.rows, yi);
  const half = Math.floor(w / 2);
  const out = y.slice();
  for (let i = 0; i < y.length; i += 1) {
    if (y[i] === null) { out[i] = null; continue; } // 缺口本身不补
    const vals = [];
    for (let j = Math.max(0, i - half); j <= Math.min(y.length - 1, i + half); j += 1) {
      if (y[j] !== null) vals.push(y[j]);
    }
    if (!vals.length) { out[i] = null; continue; }
    if (mode === 'median') {
      const sorted = vals.slice().sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      out[i] = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    } else {
      out[i] = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
  }
  t.rows.forEach((r, i) => { r[yi] = out[i]; });
  t.header[yi] = `${t.header[yi]}（${mode === 'median' ? '中值' : '均值'}平滑 w=${w}）`;
  return {
    table: t,
    notes: [`窗口 ${w} 点（${mode === 'median' ? '中值' : '均值'}）；缺口不跨接，窗口内无有效值则该点仍为缺失。`],
  };
}

/** 梯形积分：**按连续有效段分别积分**再汇总，缺口不当成 0（那等于造数据）。 */
export function integrate(table, xi, yi) {
  const t = cloneTable(table);
  const xs = valid(t.rows, xi);
  const ys = valid(t.rows, yi);
  const segments = [];
  let cur = null;
  for (let i = 0; i < ys.length; i += 1) {
    const ok = xs[i] !== null && ys[i] !== null;
    if (!ok) { cur = null; continue; } // 缺口 = 段的边界，不是面积的 0
    if (cur && cur.to === i - 1) {
      cur.area += Math.abs((xs[i] - xs[i - 1]) * (ys[i] + ys[i - 1]) / 2);
      cur.to = i;
    } else {
      cur = { from: i, to: i, area: 0 }; // 新的一段
      segments.push(cur);
    }
  }
  const total = segments.reduce((a, s) => a + s.area, 0);
  t.header.push(`${t.header[yi]} 积分面积`);
  t.rows.forEach((r, i) => {
    const seg = segments.find((s) => i >= s.from && i <= s.to);
    r.push(seg ? seg.area : null);
  });
  return {
    table: t,
    notes: [
      `梯形法，按 ${segments.length} 个连续段积分（取绝对值）。`,
      `合计面积 ${round(total)}；最长段 ${Math.max(0, ...segments.map((s) => s.to - s.from + 1))} 行。`,
      segments.length > 1 ? `注意：有 ${segments.length - 1} 处缺口被分段处理，跨缺口的面积**没有**被估算。` : '',
    ].filter(Boolean),
    meta: { area: total, segments: segments.length },
  };
}

/** 求峰：局部极大 + 最小间隔去重 + 最小峰高（相对满量程）。**不拟合、不改数据。 */
export function peaks(table, xi, yi, { minGap = 5, minHeight = 0 } = {}) {
  const t = cloneTable(table);
  const xs = valid(t.rows, xi);
  const ys = valid(t.rows, yi);
  const found = [];
  // 左右邻居取「最近的**有效**点」：峰紧挨着缺口也要能认出来（缺口不参与比较，但也不该让峰消失）
  const nearest = (arr, i, step) => {
    for (let j = i + step; j >= 0 && j < arr.length; j += step) if (arr[j] !== null) return arr[j];
    return null;
  };
  for (let i = 0; i < ys.length; i += 1) {
    if (ys[i] === null || xs[i] === null) continue;
    const a = i > 0 ? nearest(ys, i, -1) : null;
    const c = nearest(ys, i, 1);
    if (a === null || c === null) continue; // 两边都找不到可比点，不敢叫峰
    if (ys[i] >= a && ys[i] > c) found.push({ i, x: xs[i], y: ys[i] });
  }
  const full = stats(ys);
  const span = (full.max || 0) - (full.min || 0);
  const kept = [];
  for (const pk of found) {
    if (span > EPS && minHeight > 0 && (pk.y - full.min) / span < minHeight) continue;
    const near = kept.find((k) => Math.abs(k.x - pk.x) < minGap);
    if (near) { if (pk.y > near.y) Object.assign(near, pk); continue; }
    kept.push(pk);
  }
  kept.sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
  t.header.push(`${t.header[yi]} 峰序号`);
  t.rows.forEach((r, i) => {
    const k = kept.findIndex((p) => p.i === i);
    r.push(k >= 0 ? k + 1 : null);
  });
  return {
    table: t,
    notes: [
      `找到 ${kept.length} 个峰（局部极大 + 最小间隔 ${minGap}${minHeight > 0 ? ` + 最小相对峰高 ${Math.round(minHeight * 100)}%` : ''}）。`,
      kept.length ? '峰位（' + t.header[xi] + '）：' + kept.slice(0, 12).map((p) => round(p.x)).join('、') + (kept.length > 12 ? ' …' : '') : '',
    ].filter(Boolean),
    meta: { peaks: kept },
  };
}

/** 线性换算 y' = a·y + b（单位换算/放大缩小），不改 X。 */
export function linear(table, yi, { a = 1, b = 0, label = '' } = {}) {
  const t = cloneTable(table);
  const A = Number(a);
  const B = Number(b);
  if (!Number.isFinite(A) || !Number.isFinite(B)) throw new Error('线性换算的系数 a / b 必须是数字');
  t.rows.forEach((r) => { if (r[yi] !== null) r[yi] = A * r[yi] + B; });
  t.header[yi] = label ? `${t.header[yi]}（${label}）` : `${t.header[yi]}（×${A}${B ? ` + ${B}` : ''}）`;
  return { table: t, notes: [`y' = ${A} · y ${B >= 0 ? '+ ' + B : '− ' + Math.abs(B)}。`] };
}

/** 算子注册表：面板下拉直接读它（别在前端再抄一份名字）。 */
export const TRANSFORM_OPS = [
  { id: 'normalize', name: '归一化', needs: ['y'], params: [
    { name: 'mode', label: '方式', type: 'select', options: [['minmax', 'min–max 0~1'], ['zscore', 'z-score'], ['max1', '÷最大值']], def: 'minmax' },
  ], desc: '把 Y 压到统一量纲，便于叠加比较' },
  { id: 'baseline', name: '扣基线', needs: ['y'], params: [
    { name: 'mode', label: '方式', type: 'select', options: [['min', '减全局最小值'], ['ends', '两端线性基线']], def: 'ends' },
    { name: 'ends', label: '两端点数', type: 'int', def: 5 },
  ], desc: '把背景抬起来的那一层扣掉' },
  { id: 'smooth', name: '平滑', needs: ['y'], params: [
    { name: 'mode', label: '方式', type: 'select', options: [['mean', '滑动平均'], ['median', '滑动中值']], def: 'mean' },
    { name: 'window', label: '窗口点数', type: 'int', def: 5 },
  ], desc: '压噪；缺口不跨接' },
  { id: 'peaks', name: '标峰', needs: ['x', 'y'], params: [
    { name: 'minGap', label: '最小间距（X 单位）', type: 'number', def: 5 },
    { name: 'minHeight', label: '最小相对峰高（0~1）', type: 'number', def: 0 },
  ], desc: '局部极大 + 去重，新增一列峰序号' },
  { id: 'integrate', name: '积分', needs: ['x', 'y'], params: [], desc: '梯形法，按连续段分开积（缺口不估算）' },
  { id: 'linear', name: '线性换算', needs: ['y'], params: [
    { name: 'a', label: '系数 a', type: 'number', def: 1 },
    { name: 'b', label: '截距 b', type: 'number', def: 0 },
    { name: 'label', label: '列名标注', type: 'text', def: '' },
  ], desc: "y' = a·y + b，用于单位换算" },
];

/** 执行一个算子（面板只传 id + 参数）。 */
export function runTransform(table, op, params = {}) {
  const spec = TRANSFORM_OPS.find((o) => o.id === op);
  if (!spec) throw new Error(`未知的变换：${op}`);
  const yi = Number(params.y);
  const xi = Number(params.x ?? 0);
  if (!Number.isInteger(yi) || yi < 0) throw new Error('没有选 Y 列');
  switch (op) {
    case 'normalize': return normalize(table, yi, params.mode || 'minmax');
    case 'baseline': return baseline(table, yi, xi, params.mode || 'ends', Number(params.ends) || 5);
    case 'smooth': return smooth(table, yi, Number(params.window) || 5, params.mode || 'mean');
    case 'peaks': return peaks(table, xi, yi, { minGap: Number(params.minGap) || 5, minHeight: Number(params.minHeight) || 0 });
    case 'integrate': return integrate(table, xi, yi);
    case 'linear': return linear(table, yi, { a: params.a, b: params.b, label: params.label || '' });
    default: throw new Error(`未实现的变换：${op}`);
  }
}

/** 表 → CSV 文本（沿用原表的分隔符；无表头就补表头，否则下游会当数据行）。 */
export function tableToCsv(table) {
  const d = table.delimiter && typeof table.delimiter === 'string' ? table.delimiter : ',';
  // 任意字段含分隔符、引号或换行都要加引号并转义引号——否则写出的是坏 CSV（下游 parseTable 会错位）。
  const q = (s) => {
    const t = String(s);
    return /["\n\r]/.test(t) || t.includes(d) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const head = table.header.map((h) => q(h)).join(d);
  const body = table.rows.map((r) => r.map((v) => q(v === null ? '' : v)).join(d)).join('\n');
  return `${head}\n${body}\n`;
}

function round(x) {
  if (!Number.isFinite(x)) return '—';
  const abs = Math.abs(x);
  if (abs >= 1e5 || (abs > 0 && abs < 1e-4)) return x.toExponential(3);
  return String(Math.round(x * 1000) / 1000);
}

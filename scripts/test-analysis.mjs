#!/usr/bin/env node
/**
 * 峰分析引擎精度自检（scripts/test-analysis.mjs）
 * ---------------------------------------------------------------------------
 * 验收标准是「结果真的对」，不是「能跑」。这里全部用**已知参数的合成谱线**，
 * 真跑 `python library/scripts/research.py analyze` 子进程（不 mock），断言：
 *
 *   1. 双峰（高斯 20.50° / 0.12° + 22.10° / 0.18°）+ 1% 白噪声：
 *      峰数 = 2、center 误差 ≤ 0.02°、FWHM/height 相对误差 ≤ 15%。
 *   2. 单峰 + 线性背景：扣基线后 center 误差 ≤ 0.02°、area 相对误差 ≤ 20%。
 *   3. 真洛伦兹单峰：`--lineshape lorentz` 的残差 ≤ 高斯拟合残差的 1.2 倍
 *      （线型选择确实起作用，不是摆设）。
 *   4. 5% 白噪声：峰数仍然 = 2，不出现假峰。
 *   5. 产物契约：CSV 存在、列齐全、行数 = 峰数；侧车 JSON 可 JSON.parse，
 *      带输入 sha256 / 拟合参数 / 曲线点列；索引登记到 .research/index/library.json。
 *   6. 工程纪律：analysis.py 里没有 numpy/scipy；同名产物默认拒绝覆盖（--overwrite 才覆盖）。
 *
 * 全部在 mkdtemp 临时库里造数据，不碰真实库；解释器顺序与 cycle.mjs 一致。
 * 跑法：node scripts/test-analysis.mjs
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RESEARCH = path.join(ROOT, 'library', 'scripts', 'research.py');
const ANALYSIS = path.join(ROOT, 'library', 'scripts', 'analysis.py');

let pass = 0;
let fail = 0;
let skip = 0;
function check(label, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  PASS  ${label}${detail ? `  —— ${detail}` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? `  —— ${detail}` : ''}`); }
}
function skipped(label, why) { skip += 1; console.log(`  SKIP  ${label}  —— ${why}`); }
const fmt = (v, digits = 4) => (Number.isFinite(v) ? v.toFixed(digits) : String(v));
const relError = (got, want) => Math.abs(got - want) / Math.abs(want);
const sha256 = (abs) => crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');

// ─────────────────────────── 解释器 ───────────────────────────

function findPython() {
  const win = process.platform === 'win32';
  const candidates = process.env.SCIWORK_PYTHON
    ? [[process.env.SCIWORK_PYTHON, []]]
    : (win ? [['python', []], ['py', ['-3']], ['python3', []]] : [['python3', []], ['python', []]]);
  for (const [cmd, args] of candidates) {
    const probe = spawnSync(cmd, [...args, '-c', 'import sys; print(sys.version_info[0])'], {
      encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    if (probe.status === 0 && probe.stdout.trim() === '3') return { cmd, args };
  }
  return null;
}

// ─────────────────────────── 合成谱线 ───────────────────────────

const G_FWHM = 2 * Math.sqrt(2 * Math.log(2)); // 2.354820045...

function gaussPeak(x, center, height, fwhm) {
  const sigma = fwhm / G_FWHM;
  return height * Math.exp(-0.5 * ((x - center) / sigma) ** 2);
}
function lorentzPeak(x, center, height, fwhm) {
  const gamma = fwhm / 2;
  return height / (1 + ((x - center) / gamma) ** 2);
}
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function makeNormal(rnd) {
  return () => {
    const u1 = Math.max(rnd(), 1e-12);
    const u2 = rnd();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

/** 生成一列谱线：线性背景 + 若干已知峰 + 白噪声（固定种子，结果可复现）。 */
function synthesize({ peaks, noise, seed, from = 15, to = 25, step = 0.01 }) {
  const rnd = lcg(seed);
  const normal = makeNormal(rnd);
  const xs = [];
  for (let x = from; x <= to + 1e-9; x += step) xs.push(Number(x.toFixed(6)));
  const ys = xs.map((x) => {
    let y = 5 + 0.01 * (x - 20); // 线性背景
    for (const p of peaks) {
      y += p.shape === 'lorentz'
        ? lorentzPeak(x, p.center, p.height, p.fwhm)
        : gaussPeak(x, p.center, p.height, p.fwhm);
    }
    return y + normal() * noise;
  });
  return { xs, ys };
}

function writeCsv(abs, xs, ys) {
  const lines = ['two_theta,intensity'];
  for (let i = 0; i < xs.length; i += 1) lines.push(`${xs[i].toFixed(4)},${ys[i].toFixed(6)}`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${lines.join('\n')}\n`, 'utf8');
}
function writeSpaceTxt(abs, xs, ys) {
  const lines = xs.map((x, i) => `${x.toFixed(4)}\t${ys[i].toFixed(6)}`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${lines.join('\n')}\n`, 'utf8');
}

function makeLibrary(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sciwork-analyze-${tag}-`));
  fs.mkdirSync(path.join(root, '.research'), { recursive: true });
  fs.mkdirSync(path.join(root, 'projects', 'demo', 'data'), { recursive: true });
  return root;
}

// ─────────────────────────── 跑 analyze ───────────────────────────

let python = findPython();

function analyze(root, extraArgs) {
  const result = spawnSync(python.cmd, [...python.args, RESEARCH, 'analyze', ...extraArgs], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      SCIWORK_LIBRARY: root,
      RESEARCH_LIBRARY: root,
      PYTHONIOENCODING: 'utf-8',
    },
  });
  let json = null;
  try { json = JSON.parse(result.stdout); } catch { json = null; }
  return { status: result.status, json, stdout: result.stdout, stderr: result.stderr };
}

function parseCsv(abs) {
  const text = fs.readFileSync(abs, 'utf8').replace(/^\ufeff/, '').trim();
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(',').map((cell) => cell.trim());
  const rows = lines.slice(1).map((line) => line.split(',').map((cell) => cell.trim()));
  return { header, rows };
}

// ─────────────────────────── 开始 ───────────────────────────

console.log('\n峰分析引擎精度自检（真跑 python 子进程，合成数据已知真值）');
if (!python) {
  skipped('找 Python 3 解释器', '试试 SCIWORK_PYTHON=… 或安装 python3');
  console.log(`\n${'='.repeat(72)}`);
  console.log(`0 通过 · 0 失败 · ${skip} 跳过`);
  process.exit(0);
}
console.log(`  python: ${python.cmd} ${python.args.join(' ')}`);
if (!fs.existsSync(RESEARCH)) {
  console.log(`  FAIL  找不到 ${RESEARCH}`);
  process.exit(1);
}

const DOUBLE = {
  peaks: [
    { shape: 'gauss', center: 20.50, height: 100, fwhm: 0.12 },
    { shape: 'gauss', center: 22.10, height: 80, fwhm: 0.18 },
  ],
  noise: 1.0,
  seed: 20261101,
};

// ─────────────────────────── [1] 双峰 + 1% 噪声 ───────────────────────────

console.log('\n[1] 双峰（20.50° / 0.12° 与 22.10° / 0.18°）+ 1% 白噪声');
const lib1 = makeLibrary('doublet');
const data1 = path.join(lib1, 'projects', 'demo', 'data', 'doublet.csv');
{
  const { xs, ys } = synthesize(DOUBLE);
  writeCsv(data1, xs, ys);
  const res = analyze(lib1, ['--project', 'demo', '--data', 'projects/demo/data/doublet.csv']);
  check('退出码 0 且 ok:true', res.status === 0 && res.json && res.json.ok === true,
    res.json ? '' : (res.stderr || res.stdout || '').trim().slice(0, 240));
  const out = res.json || {};
  check('找到 2 个峰（不是简单取最大值）', Array.isArray(out.peaks) && out.peaks.length === 2,
    `peaks=${(out.peaks || []).length}`);
  const found = out.peaks || [];
  const want = DOUBLE.peaks;
  const used = Math.min(found.length, want.length);
  let worstCenter = 0;
  let worstFwhm = 0;
  let worstHeight = 0;
  for (let i = 0; i < used; i += 1) {
    worstCenter = Math.max(worstCenter, Math.abs(found[i].center - want[i].center));
    worstFwhm = Math.max(worstFwhm, relError(found[i].fwhm, want[i].fwhm));
    worstHeight = Math.max(worstHeight, relError(found[i].height, want[i].height));
  }
  check('center 误差 ≤ 0.02°', worstCenter <= 0.02, `实测最大 ${fmt(worstCenter, 5)}°`);
  check('FWHM 相对误差 ≤ 15%', worstFwhm <= 0.15, `实测最大 ${fmt(worstFwhm * 100, 3)}%`);
  check('height 相对误差 ≤ 15%', worstHeight <= 0.15, `实测最大 ${fmt(worstHeight * 100, 3)}%`);
  check('两种线型都给出了拟合结果', found.every((p) => p.fits && p.fits.gauss && p.fits.lorentz));
  check('高斯拟合 R² ≥ 0.99（窗内）', found.every((p) => p.fits.gauss.r2 >= 0.99),
    found.map((p) => fmt(p.fits.gauss.r2, 6)).join(', '));
  check('高斯拟合都收敛', found.every((p) => p.fits.gauss.converged === true));
  check('自动噪声估计接近真值 1%（误差 ≤ 15%）',
    out.noise && Math.abs(out.noise.sigma - 1.0) <= 0.15, `σ=${fmt(out.noise && out.noise.sigma, 4)}`);
  check('自动显著度阈值 > 峰谷噪声、< 小峰峰高', out.params && out.params.minProminence > 3
    && out.params.minProminence < 80, `threshold=${fmt(out.params && out.params.minProminence, 3)}`);

  // 产物契约
  const csvAbs = out.output ? path.join(lib1, out.output) : null;
  check('CSV 落在 projects/<课题>/tables/ 下',
    Boolean(out.output) && /^projects\/demo\/tables\/doublet_peaks\.csv$/.test(out.output), out.output);
  check('CSV 文件存在', Boolean(csvAbs) && fs.existsSync(csvAbs));
  if (csvAbs && fs.existsSync(csvAbs)) {
    const csv = parseCsv(csvAbs);
    check('CSV 列齐全（peak/lineshape/center/height/fwhm/area/r2/…）',
      ['peak', 'lineshape', 'center', 'height', 'fwhm', 'area', 'r2', 'rms_residual',
        'prominence', 'snr', 'points', 'window_min', 'window_max'].every((col) => csv.header.includes(col)),
      csv.header.join(','));
    check('CSV 每峰一行（=2）', csv.rows.length === 2, `rows=${csv.rows.length}`);
    check('CSV 数值与 JSON 一致（center）',
      csv.rows.every((row, i) => Math.abs(Number(row[csv.header.indexOf('center')]) - found[i].center) < 1e-6));
    check('CSV sha256 与返回值一致', out.outputSha256 === sha256(csvAbs));
  }

  const traceAbs = out.trace ? path.join(lib1, out.trace) : null;
  check('侧车 JSON 落在 .research/transforms/ 下',
    Boolean(out.trace) && /^\.research\/transforms\/demo\/doublet_peaks\.json$/.test(out.trace), out.trace);
  check('侧车 JSON 存在且可 JSON.parse', Boolean(traceAbs) && fs.existsSync(traceAbs) && (() => {
    try { JSON.parse(fs.readFileSync(traceAbs, 'utf8')); return true; } catch { return false; }
  })());
  const trace = traceAbs && fs.existsSync(traceAbs) ? JSON.parse(fs.readFileSync(traceAbs, 'utf8')) : {};
  check('侧车记录输入文件 sha256（与现算一致）', trace.sourceSha256 === sha256(data1));
  check('侧车记录方法 / 参数 / 引擎版本',
    Boolean(trace.method && trace.method.fit && /Levenberg/i.test(trace.method.fit.algorithm))
    && Boolean(trace.params) && Boolean(trace.engine && trace.engine.name === 'dsh-sciwork'),
    `engine=${trace.engine && trace.engine.version}`);
  check('侧车记录拟合参数（center/height/fwhm/area 齐全）',
    Array.isArray(trace.peaks) && trace.peaks.length === 2
    && trace.peaks.every((p) => ['center', 'height', 'fwhm', 'area'].every((k) => Number.isFinite(p[k]))));
  check('侧车带拟合曲线点列（每峰 ≥ 50 个点，数值有限）',
    Array.isArray(trace.curves) && trace.curves.length === 2
    && trace.curves.every((c) => Array.isArray(c.points) && c.points.length >= 50
      && c.points.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every((v) => Number.isFinite(v)))));
  check('侧车 sha256 与 CSV 一致', trace.outputSha256 === out.outputSha256);

  // 索引登记
  const indexAbs = path.join(lib1, '.research', 'index', 'library.json');
  let registered = false;
  if (fs.existsSync(indexAbs)) {
    try {
      const index = JSON.parse(fs.readFileSync(indexAbs, 'utf8'));
      registered = (index.entries || []).some((entry) => entry.path === out.output);
    } catch { registered = false; }
  }
  check('产物已登记进 .research/index/library.json', registered);

  console.log(`  实测：center 最大误差 ${fmt(worstCenter, 5)}°，`
    + `FWHM 最大相对误差 ${fmt(worstFwhm * 100, 3)}%，height 最大相对误差 ${fmt(worstHeight * 100, 3)}%`);
}

// ─────────────────────────── [2] 单峰 + 线性背景 ───────────────────────────

console.log('\n[2] 单峰 + 线性背景（扣基线后 center / area 精度）');
const lib2 = makeLibrary('single');
{
  const spec = { peaks: [{ shape: 'gauss', center: 20.50, height: 100, fwhm: 0.12 }], noise: 1.0, seed: 7 };
  const { xs, ys } = synthesize(spec);
  const data = path.join(lib2, 'projects', 'demo', 'data', 'single.csv');
  writeCsv(data, xs, ys);
  const res = analyze(lib2, ['--project', 'demo', '--data', 'projects/demo/data/single.csv']);
  check('退出码 0 且找到 1 个峰', res.status === 0 && res.json && res.json.ok && res.json.peaks.length === 1,
    `peaks=${res.json && res.json.peaks ? res.json.peaks.length : '?'}`);
  const peak = res.json && res.json.peaks ? res.json.peaks[0] : {};
  const wantArea = spec.peaks[0].height * (spec.peaks[0].fwhm / G_FWHM) * Math.sqrt(2 * Math.PI);
  check('扣基线后 center 误差 ≤ 0.02°', Math.abs(peak.center - 20.50) <= 0.02,
    `实测 ${fmt(peak.center, 5)}°（误差 ${fmt(Math.abs(peak.center - 20.50), 5)}）`);
  check('area 相对误差 ≤ 20%', Math.abs(peak.area - wantArea) / wantArea <= 0.2,
    `实测 ${fmt(peak.area, 4)} vs 真值 ${fmt(wantArea, 4)}（${fmt(relError(peak.area, wantArea) * 100, 2)}%）`);
  check('基线按 ends 口径拟出了直线（记录 k / c）',
    res.json.baseline && res.json.baseline.mode === 'ends'
    && Number.isFinite(res.json.baseline.slope) && Number.isFinite(res.json.baseline.intercept),
    `k=${fmt(res.json.baseline && res.json.baseline.slope, 6)}`);
}

// ─────────────────────────── [3] 洛伦兹线型 ───────────────────────────

console.log('\n[3] 真洛伦兹单峰：--lineshape lorentz 残差 ≤ 高斯残差 × 1.2');
const lib3 = makeLibrary('lorentz');
{
  const spec = { peaks: [{ shape: 'lorentz', center: 20.50, height: 100, fwhm: 0.12 }], noise: 1.0, seed: 11 };
  const { xs, ys } = synthesize(spec);
  const data = path.join(lib3, 'projects', 'demo', 'data', 'lorentz.csv');
  writeCsv(data, xs, ys);
  const both = analyze(lib3, ['--project', 'demo', '--data', 'projects/demo/data/lorentz.csv',
    '--lineshape', 'both', '--out-name', 'lorentz_both']);
  const peak = both.json && both.json.ok ? both.json.peaks[0] : null;
  check('both 模式下两种线型都拟合', Boolean(peak && peak.fits.gauss && peak.fits.lorentz));
  if (peak) {
    const rg = peak.fits.gauss.rmsResidual;
    const rl = peak.fits.lorentz.rmsResidual;
    check('洛伦兹残差 ≤ 高斯残差 × 1.2', rl <= rg * 1.2,
      `lorentz ${fmt(rl, 4)} vs gauss ${fmt(rg, 4)}（比值 ${fmt(rl / rg, 3)}）`);
    check('主结果按 R² 选出洛伦兹', peak.lineshape === 'lorentz',
      `lineshape=${peak.lineshape}, r2 gauss=${fmt(peak.fits.gauss.r2, 6)}, lorentz=${fmt(peak.fits.lorentz.r2, 6)}`);
  }
  const only = analyze(lib3, ['--project', 'demo', '--data', 'projects/demo/data/lorentz.csv',
    '--lineshape', 'lorentz', '--out-name', 'lorentz_only']);
  check('--lineshape lorentz 只出洛伦兹结果',
    Boolean(only.json && only.json.ok) && only.json.peaks.length === 1
    && only.json.peaks[0].fits.lorentz && !only.json.peaks[0].fits.gauss);
  check('洛伦兹 FWHM 相对误差 ≤ 15%',
    Boolean(only.json && only.json.peaks.length === 1)
    && relError(only.json.peaks[0].fwhm, 0.12) <= 0.15,
    only.json && only.json.peaks.length === 1 ? `实测 ${fmt(only.json.peaks[0].fwhm, 5)}` : '');
}

// ─────────────────────────── [4] 5% 噪声不造假峰 ───────────────────────────

console.log('\n[4] 5% 白噪声双峰：峰数仍然 = 2，不出现假峰');
const lib4 = makeLibrary('noisy');
{
  const spec = { ...DOUBLE, noise: 5.0, seed: 424242 };
  const { xs, ys } = synthesize(spec);
  const data = path.join(lib4, 'projects', 'demo', 'data', 'noisy.csv');
  writeCsv(data, xs, ys);
  const res = analyze(lib4, ['--project', 'demo', '--data', 'projects/demo/data/noisy.csv']);
  const out = res.json || {};
  check('找到且只找到 2 个峰', res.status === 0 && out.ok && out.peaks.length === 2,
    `peaks=${out.peaks ? out.peaks.length : '?'}`
    + (out.peaks ? `（center=${out.peaks.map((p) => fmt(p.center, 3)).join(', ')}）` : ''));
  check('噪声估计接近真值 5%', out.noise && Math.abs(out.noise.sigma - 5.0) / 5.0 <= 0.2,
    `σ=${fmt(out.noise && out.noise.sigma, 3)}`);
  check('没有「拟合失败 / 未收敛」类警告', Array.isArray(out.warnings)
    && !out.warnings.some((w) => /失败|未完全收敛/.test(w)), (out.warnings || []).join('；'));
  check('双峰 center 依然准确（≤ 0.02°）',
    out.peaks && out.peaks.length === 2
    && Math.abs(out.peaks[0].center - 20.50) <= 0.02 && Math.abs(out.peaks[1].center - 22.10) <= 0.02,
    out.peaks && out.peaks.length === 2
      ? out.peaks.map((p) => fmt(p.center, 4)).join(', ') : '');
}

// ─────────────────────────── [5] 无表头 / 空格分隔 / --baseline min ───────────────────────────

console.log('\n[5] 无表头 + 制表符分隔 + --baseline min（读表口径与基线口径）');
const lib5 = makeLibrary('headerless');
{
  const spec = { peaks: [{ shape: 'gauss', center: 20.50, height: 100, fwhm: 0.12 }], noise: 1.0, seed: 99 };
  const { xs, ys } = synthesize(spec);
  const data = path.join(lib5, 'projects', 'demo', 'data', 'raw.txt');
  writeSpaceTxt(data, xs, ys);
  const res = analyze(lib5, ['--project', 'demo', '--data', 'projects/demo/data/raw.txt', '--baseline', 'min']);
  const out = res.json || {};
  check('无表头文件被识别成 #1 / #2 列', out.ok && Array.isArray(out.header)
    && out.header[0] === '#1' && out.header[1] === '#2', JSON.stringify(out.header));
  check('--baseline min 生效（记录减掉的全局最小值）',
    out.baseline && out.baseline.mode === 'min' && Number.isFinite(out.baseline.offset),
    `offset=${fmt(out.baseline && out.baseline.offset, 4)}`);
  check('仍然找到 1 个峰且 center 准确', out.peaks && out.peaks.length === 1
    && Math.abs(out.peaks[0].center - 20.50) <= 0.02, out.peaks && out.peaks.length === 1
    ? fmt(out.peaks[0].center, 4) : '');
}

// ─────────────────────────── [6] 同名冲突 / --overwrite / 显式阈值 ───────────────────────────

console.log('\n[6] 同名产物默认拒绝覆盖；--overwrite 才覆盖；超高阈值时如实报「0 个峰」');
const lib6 = makeLibrary('conflict');
{
  const { xs, ys } = synthesize(DOUBLE);
  const data = path.join(lib6, 'projects', 'demo', 'data', 'conflict.csv');
  writeCsv(data, xs, ys);
  const args = ['--project', 'demo', '--data', 'projects/demo/data/conflict.csv'];
  const first = analyze(lib6, args);
  const second = analyze(lib6, args);
  check('第一次分析成功', first.status === 0 && first.json && first.json.ok === true);
  check('第二次同名默认失败（退出码 2、ok:false、error 提示 --overwrite）',
    second.status === 2 && second.json && second.json.ok === false
    && /已存在/.test(second.json.error || '') && /overwrite/.test(second.json.error || ''),
    second.json ? second.json.error : '');
  check('原始数据文件没被动过', sha256(data) === first.json.sha256);
  const third = analyze(lib6, [...args, '--overwrite']);
  check('--overwrite 后覆盖成功', third.status === 0 && third.json && third.json.ok === true);

  const none = analyze(lib6, [...args, '--overwrite', '--min-prominence', '500']);
  check('阈值高到没有峰时如实返回 0 个峰 + 警告',
    none.status === 0 && none.json && none.json.ok === true && none.json.peaks.length === 0
    && none.json.warnings.some((w) => /没有找到显著峰/.test(w)),
    none.json ? `warnings=${(none.json.warnings || []).length}` : '');
  const noneCsv = none.json && none.json.output ? path.join(lib6, none.json.output) : null;
  check('没有峰时 CSV 仍只有表头（不留半截数据）', Boolean(noneCsv) && fs.existsSync(noneCsv)
    && parseCsv(noneCsv).rows.length === 0);
}

// ─────────────────────────── [7] 真实数据的怪情况 ───────────────────────────

console.log('\n[7] 脏数据/边界：全平、单行、缺测、倒序导出、负值、重叠峰');
const lib7 = makeLibrary('robust');
{
  // 全平数据：不该造峰
  const flat = path.join(lib7, 'projects', 'demo', 'data', 'flat.csv');
  const flatLines = ['x,y'];
  for (let i = 0; i < 200; i += 1) flatLines.push(`${(15 + i * 0.01).toFixed(2)},3.000`);
  fs.writeFileSync(flat, `${flatLines.join('\n')}\n`, 'utf8');
  const flatRes = analyze(lib7, ['--project', 'demo', '--data', 'projects/demo/data/flat.csv']);
  check('全平数据：0 个峰 + 如实警告', flatRes.status === 0 && flatRes.json && flatRes.json.ok
    && flatRes.json.peaks.length === 0 && flatRes.json.warnings.some((w) => /没有找到显著峰/.test(w)));

  // 只有 1 个数据点：报错而不是硬算
  fs.writeFileSync(path.join(lib7, 'projects', 'demo', 'data', 'one.csv'), 'x,y\n1,2\n', 'utf8');
  const oneRes = analyze(lib7, ['--project', 'demo', '--data', 'projects/demo/data/one.csv']);
  check('有效点太少时退出码 2 + 说明原因', oneRes.status === 2 && oneRes.json && oneRes.json.ok === false
    && /至少需要/.test(oneRes.json.error || ''), oneRes.json ? oneRes.json.error : '');

  // 缺测值（nan / 空）：跳过缺口，仍能拟合
  const gapLines = ['x,y'];
  for (let i = 0; i < 400; i += 1) {
    const x = 20 + i * 0.01;
    const y = 5 + 100 * Math.exp(-0.5 * ((x - 21) / 0.05) ** 2);
    if (i % 37 === 0) gapLines.push(`${x.toFixed(4)},nan`);
    else if (i % 53 === 0) gapLines.push(`${x.toFixed(4)},`);
    else gapLines.push(`${x.toFixed(4)},${y.toFixed(4)}`);
  }
  fs.writeFileSync(path.join(lib7, 'projects', 'demo', 'data', 'gaps.csv'), `${gapLines.join('\n')}\n`, 'utf8');
  const gapRes = analyze(lib7, ['--project', 'demo', '--data', 'projects/demo/data/gaps.csv']);
  check('缺测值被跳过（pointsUsed < rows）且仍拟出 1 个峰',
    gapRes.status === 0 && gapRes.json && gapRes.json.ok
    && gapRes.json.peaks.length === 1 && Math.abs(gapRes.json.peaks[0].center - 21) <= 0.02
    && gapRes.json.pointsUsed < gapRes.json.rows,
    gapRes.json ? `rows=${gapRes.json.rows} used=${gapRes.json.pointsUsed}` : '');

  // X 递减导出：排序后仍然正确
  const descLines = ['two_theta,intensity'];
  for (let i = 0; i < 400; i += 1) {
    const x = 25 - i * 0.01;
    const y = 5 + 100 * Math.exp(-0.5 * ((x - 22.5) / 0.05) ** 2);
    descLines.push(`${x.toFixed(4)},${y.toFixed(6)}`);
  }
  fs.writeFileSync(path.join(lib7, 'projects', 'demo', 'data', 'desc.csv'), `${descLines.join('\n')}\n`, 'utf8');
  const descRes = analyze(lib7, ['--project', 'demo', '--data', 'projects/demo/data/desc.csv']);
  check('X 递减导出的文件排序后照样找峰', descRes.status === 0 && descRes.json && descRes.json.ok
    && descRes.json.peaks.length === 1 && Math.abs(descRes.json.peaks[0].center - 22.5) <= 0.02,
    descRes.json && descRes.json.peaks.length === 1 ? fmt(descRes.json.peaks[0].center, 4) : '');

  // 负基线 + --baseline none：峰高不应被基线偏移污染
  const negLines = ['x,y'];
  for (let i = 0; i < 400; i += 1) {
    const x = 20 + i * 0.01;
    const y = -20 + 100 * Math.exp(-0.5 * ((x - 21) / 0.05) ** 2);
    negLines.push(`${x.toFixed(4)},${y.toFixed(4)}`);
  }
  fs.writeFileSync(path.join(lib7, 'projects', 'demo', 'data', 'neg.csv'), `${negLines.join('\n')}\n`, 'utf8');
  const negRes = analyze(lib7, ['--project', 'demo', '--data', 'projects/demo/data/neg.csv',
    '--baseline', 'none', '--min-prominence', '10']);
  check('--baseline none + 负基线：峰高仍是真实的 100',
    negRes.status === 0 && negRes.json && negRes.json.ok && negRes.json.peaks.length === 1
    && relError(negRes.json.peaks[0].height, 100) <= 0.05,
    negRes.json && negRes.json.peaks.length === 1 ? fmt(negRes.json.peaks[0].height, 2) : '');

  // 重叠双峰：结果照给，但必须自己声明「没做联合解卷积」
  const closeLines = ['x,y'];
  for (let i = 0; i < 600; i += 1) {
    const x = 20 + i * 0.01;
    const y = 5 + gaussPeak(x, 20.40, 80, 0.12) + gaussPeak(x, 20.60, 80, 0.12);
    closeLines.push(`${x.toFixed(4)},${y.toFixed(4)}`);
  }
  fs.writeFileSync(path.join(lib7, 'projects', 'demo', 'data', 'close.csv'), `${closeLines.join('\n')}\n`, 'utf8');
  const closeRes = analyze(lib7, ['--project', 'demo', '--data', 'projects/demo/data/close.csv']);
  check('重叠双峰给出结果并明确警告「未联合解卷积」',
    closeRes.status === 0 && closeRes.json && closeRes.json.ok && closeRes.json.peaks.length === 2
    && closeRes.json.warnings.some((w) => /重叠峰没有联合解卷积/.test(w)),
    closeRes.json ? closeRes.json.warnings.join('；') : '');
}

// ─────────────────────────── [8] 零依赖纪律 ───────────────────────────

console.log('\n[8] 零第三方依赖纪律');
{
  const source = fs.readFileSync(ANALYSIS, 'utf8');
  check('analysis.py 不 import numpy / scipy',
    !/^\s*(import|from)\s+(numpy|scipy)\b/m.test(source));
  const allowed = new Set(['__future__', 'argparse', 'csv', 'datetime', 'hashlib', 'json', 'math',
    'os', 're', 'sys', 'pathlib', 'typing']);
  const modules = [...source.matchAll(/^\s*(?:import|from)\s+([a-zA-Z_][\w.]*)/gm)]
    .map((match) => match[1].split('.')[0]);
  const foreign = modules.filter((name) => !allowed.has(name));
  check('import 的模块都在标准库白名单内', foreign.length === 0, foreign.join(', ') || '无越界');
}

// ─────────────────────────── 收尾 ───────────────────────────

for (const lib of [lib1, lib2, lib3, lib4, lib5, lib6, lib7]) {
  try { fs.rmSync(lib, { recursive: true, force: true }); } catch { /* 临时目录清理失败不算测试失败 */ }
}

console.log(`\n${'='.repeat(72)}`);
console.log(`${pass} 通过 · ${fail} 失败${skip ? ` · ${skip} 跳过` : ''}`);
process.exit(fail ? 1 : 0);

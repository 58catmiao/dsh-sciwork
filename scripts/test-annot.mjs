#!/usr/bin/env node
/**
 * 矢量标注层验收（scripts/test-annot.mjs）
 * ---------------------------------------------------------------------------
 * 验收标准是「结果真的对」，不是「能跑」。这里全部真跑
 * `python library/scripts/research.py annot …` 子进程（不 mock），在 mkdtemp
 * 临时库里造图与侧车，断言：
 *
 *   1. add rect + add text 后 `.research/annot/<图号>.json` 里 items 长 2、
 *      九个字段原样（含缺省字段为 null），annotFile 落在 .research/annot/。
 *   2. 二次 add 覆盖前留 `<图号>.json.bak`，bak 是同一次覆盖前的快照（1 条 → 2 条）。
 *   3. 坐标越界（x=1.5 / y=-0.1）退出码非 0、报错中文、**标注文件根本没被写**（不 clamp）。
 *   4. 必填参数缺失（text 缺 --text / rect 缺 --w / arrow 缺 --x2）、--color 非法、
 *      kind 不认识、项目或图号不存在，全部非 0 且给中文原因。
 *   5. render 产出 `<基名>.annot.svg`：一个 `<image href="<基名>.svg">` 引原图 +
 *      rect / text / arrow / point 四种元素按归一化 × 画布尺寸换算到位（0.1×800=80 …），
 *      画布就是原图 viewBox（不裁剪页码图版）；已存在的输出不加 --overwrite 拒绝覆盖。
 *   6. 图组子目录（figures/<图组>/<基名>.json）能被扫到；侧车文件名与 figureId 不同时
 *      两个都能查到；没有同名 .svg 的图 add 给 warning、render 明确失败。
 *   7. 负 min-x/min-y 的 viewBox 也换算正确（-10 + 0.1×400 = 30）。
 *   8. 工程纪律：research.py 的 annot 子命令真的在转发（--help 里有、缺动作报错），
 *      annot.py 只 import 标准库、不引 XML 解析器。
 *
 * 全部在临时库里跑，不碰真实库；解释器顺序与 cycle.mjs 一致。
 * 跑法：node scripts/test-annot.mjs
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RESEARCH = path.join(ROOT, 'library', 'scripts', 'research.py');
const ANNOT = path.join(ROOT, 'library', 'scripts', 'annot.py');

let pass = 0;
let fail = 0;
let skip = 0;
function check(label, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  PASS  ${label}${detail ? `  —— ${detail}` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? `  —— ${detail}` : ''}`); }
}
function skipped(label, why) { skip += 1; console.log(`  SKIP  ${label}  —— ${why}`); }

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

// ─────────────────────────── 夹具：图 + 侧车 ───────────────────────────

const SVG_800 = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <rect x="0" y="0" width="800" height="600" fill="#ffffff"/>
  <polyline points="0,500 200,300 400,380 600,180 800,240" fill="none" stroke="#1f77b4" stroke-width="2"/>
</svg>
`;

const SVG_NEGBOX = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="-10 -20 400 300">
  <line x1="-10" y1="-20" x2="390" y2="280" stroke="#999999" stroke-width="1"/>
</svg>
`;

function makeFigure(root, { slug = 'demo', rel, figureId = null, svgText = null }) {
  const base = path.join(root, 'projects', slug, 'figures', rel);
  fs.mkdirSync(path.dirname(base), { recursive: true });
  const id = figureId || path.basename(rel);
  if (svgText !== null) fs.writeFileSync(`${base}.svg`, svgText, 'utf8');
  const sidecar = {
    schema: 'sciwork/figure/1',
    figureId: id,
    project: slug,
    file: `projects/${slug}/figures/${rel}.svg`,
    files: [],
    createdAt: '2026-11-01T00:00:00+08:00',
  };
  fs.writeFileSync(`${base}.json`, `${JSON.stringify(sidecar, null, 1)}\n`, 'utf8');
  return { svg: `${base}.svg`, sidecar: `${base}.json` };
}

function makeLibrary(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sciwork-annot-${tag}-`));
  fs.mkdirSync(path.join(root, '.research'), { recursive: true });
  makeFigure(root, { rel: 'fig1', svgText: SVG_800 });
  makeFigure(root, { rel: 'fig2', svgText: SVG_800 });
  makeFigure(root, { rel: 'curve/fig3', svgText: SVG_800 }); // 图组子目录
  makeFigure(root, { rel: 'fig4', figureId: '图四', svgText: SVG_800 }); // 文件名 ≠ figureId
  makeFigure(root, { rel: 'fig5' }); // 只有侧车、没有同名 .svg
  makeFigure(root, { rel: 'fig6', svgText: SVG_NEGBOX }); // 负 min-x/min-y 的 viewBox
  return root;
}

const annotFile = (root, figureId) => path.join(root, '.research', 'annot', `${figureId}.json`);
const readJson = (abs) => JSON.parse(fs.readFileSync(abs, 'utf8'));
const readText = (abs) => fs.readFileSync(abs, 'utf8');
const canonical = (obj) => JSON.stringify(Object.fromEntries(
  Object.keys(obj || {}).sort().map((key) => [key, obj[key]]),
));

// ─────────────────────────── 跑 annot ───────────────────────────

let python = findPython();

function runRaw(root, args) {
  const result = spawnSync(python.cmd, [...python.args, RESEARCH, ...args], {
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
  return { status: result.status, json, stdout: result.stdout || '', stderr: result.stderr || '' };
}
const runAnnot = (root, args) => runRaw(root, ['annot', ...args]);
const errorOf = (res) => (res.json && res.json.error) || (res.stderr || res.stdout || '').trim().slice(0, 240);

// ─────────────────────────── 开始 ───────────────────────────

console.log('\n矢量标注层验收（真跑 python 子进程，临时库里造图与侧车）');
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
if (!fs.existsSync(ANNOT)) {
  console.log(`  FAIL  找不到 ${ANNOT}`);
  process.exit(1);
}

const lib1 = makeLibrary('main');
const lib2 = makeLibrary('fresh');

// ─────────────────────────── [1] add：rect + text ───────────────────────────

console.log('\n[1] add：往 fig1 加一条 rect、一条 text（归一化坐标进标注文件）');
{
  const rect = runAnnot(lib1, ['add', '--project', 'demo', '--figure', 'fig1',
    '--kind', 'rect', '--x', '0.1', '--y', '0.2', '--w', '0.3', '--h', '0.4',
    '--color', '#00FF00', '--width', '3']);
  check('rect：退出码 0 且 ok:true', rect.status === 0 && rect.json && rect.json.ok === true,
    rect.json ? '' : errorOf(rect));
  check('rect：annotFile 落在 .research/annot/fig1.json',
    rect.json && rect.json.annotFile === '.research/annot/fig1.json', rect.json ? rect.json.annotFile : '');
  check('rect：首次 add 没有 .bak（原来没文件）', rect.json && rect.json.backup === null,
    rect.json ? String(rect.json.backup) : '');
  check('rect：颜色规范化为小写带 #', rect.json && rect.json.item && rect.json.item.color === '#00ff00',
    rect.json && rect.json.item ? rect.json.item.color : '');
  check('rect：没给的字段是 null（不瞎填 0）', rect.json && rect.json.item
    && rect.json.item.x2 === null && rect.json.item.y2 === null && rect.json.item.text === null);

  const text = runAnnot(lib1, ['add', '--project', 'demo', '--figure', 'fig1',
    '--kind', 'text', '--x', '0.5', '--y', '0.65', '--text', '峰值 A',
    '--color', '#1F77B4', '--width', '20']);
  check('text：退出码 0 且 items 计数 2', text.status === 0 && text.json && text.json.items === 2,
    text.json ? `items=${text.json.items}` : errorOf(text));

  const record = readJson(annotFile(lib1, 'fig1'));
  check('标注文件 figureId / project 正确', record.figureId === 'fig1' && record.project === 'demo',
    `${record.figureId} / ${record.project}`);
  check('updatedAt 是带时区的 ISO 时间', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(record.updatedAt || ''),
    record.updatedAt);
  check('items 长度 2', Array.isArray(record.items) && record.items.length === 2,
    `items=${(record.items || []).length}`);
  const wantRect = { kind: 'rect', x: 0.1, y: 0.2, x2: null, y2: null, w: 0.3, h: 0.4, text: null, color: '#00ff00', width: 3 };
  check('第 1 条 rect 的九个字段原样（不夹取、不改写）',
    canonical(record.items && record.items[0]) === canonical(wantRect), canonical(record.items && record.items[0]));
  const wantText = { kind: 'text', x: 0.5, y: 0.65, x2: null, y2: null, w: null, h: null, text: '峰值 A', color: '#1f77b4', width: 20 };
  check('第 2 条 text 原样（含中文文字）',
    canonical(record.items && record.items[1]) === canonical(wantText), canonical(record.items && record.items[1]));
}

// ─────────────────────────── [2] 二次 add 留 .bak ───────────────────────────

console.log('\n[2] 二次 add：覆盖前留 .bak，且 bak 是覆盖前的快照');
{
  const bak = `${annotFile(lib1, 'fig1')}.bak`;
  check('二次 add 后有 fig1.json.bak', fs.existsSync(bak), bak);
  const before = readJson(bak);
  check('bak 里是覆盖前的 1 条（rect）', Array.isArray(before.items) && before.items.length === 1
    && before.items[0].kind === 'rect', `items=${((before.items) || []).length}`);

  const arrow = runAnnot(lib1, ['add', '--project', 'demo', '--figure', 'fig1',
    '--kind', 'arrow', '--x', '0.2', '--y', '0.3', '--x2', '0.6', '--y2', '0.4', '--width', '2']);
  check('三次 add：退出码 0、items 计数 3、payload 报出 backup',
    arrow.status === 0 && arrow.json && arrow.json.items === 3
    && arrow.json.backup === '.research/annot/fig1.json.bak',
    arrow.json ? `items=${arrow.json.items} backup=${arrow.json.backup}` : errorOf(arrow));
  check('bak 被刷新为覆盖前的 2 条',
    readJson(bak).items.length === 2, `items=${readJson(bak).items.length}`);
  check('当前标注仍是 3 条（没被 bak 覆盖回去）',
    readJson(annotFile(lib1, 'fig1')).items.length === 3);
}

// ─────────────────────────── [3] 坐标越界：报错且不写盘 ───────────────────────────

console.log('\n[3] 坐标越界：退出码非 0、中文报错、标注文件不生成（不静默 clamp）');
{
  check('起点：fig2 没有标注文件', !fs.existsSync(annotFile(lib1, 'fig2')));
  const badX = runAnnot(lib1, ['add', '--project', 'demo', '--figure', 'fig2',
    '--kind', 'rect', '--x', '1.5', '--y', '0.2', '--w', '0.1', '--h', '0.1']);
  check('x=1.5：退出码 2 且 ok:false', badX.status === 2 && badX.json && badX.json.ok === false,
    `status=${badX.status} ${errorOf(badX)}`);
  check('x=1.5：报错说明越界含义', /越界/.test(errorOf(badX)) && /0\.\.1/.test(errorOf(badX)), errorOf(badX));
  check('x=1.5：fig2 的标注文件没有被写出来', !fs.existsSync(annotFile(lib1, 'fig2')));

  const badY = runAnnot(lib1, ['add', '--project', 'demo', '--figure', 'fig2',
    '--kind', 'point', '--x', '0.2', '--y', '-0.1']);
  check('y=-0.1：退出码非 0 且报越界', badY.status !== 0 && /越界/.test(errorOf(badY)), errorOf(badY));
  check('y=-0.1：fig2 的标注文件仍然不存在', !fs.existsSync(annotFile(lib1, 'fig2')));

  const badW = runAnnot(lib1, ['add', '--project', 'demo', '--figure', 'fig2',
    '--kind', 'rect', '--x', '0.2', '--y', '0.2', '--w', '1.5', '--h', '0.1']);
  check('尺寸越界（w=1.5）：报错而不是夹到 1', badW.status !== 0 && /越界/.test(errorOf(badW)), errorOf(badW));

  check('越界失败没碰 fig1 已存的标注',
    readJson(annotFile(lib1, 'fig1')).items.length === 3);
}

// ─────────────────────────── [4] 必填/非法参数 ───────────────────────────

console.log('\n[4] 必填参数与非法取值：一律非 0 + 中文原因');
{
  const cases = [
    ['text 缺 --text',
      ['add', '--project', 'demo', '--figure', 'fig1', '--kind', 'text', '--x', '0.1', '--y', '0.1'],
      /缺 --text/],
    ['rect 缺 --w / --h',
      ['add', '--project', 'demo', '--figure', 'fig1', '--kind', 'rect', '--x', '0.1', '--y', '0.1', '--h', '0.2'],
      /缺 --w/],
    ['arrow 缺 --x2 / --y2',
      ['add', '--project', 'demo', '--figure', 'fig1', '--kind', 'arrow', '--x', '0.1', '--y', '0.1'],
      /缺 --x2/],
    ['--color 不是 #rrggbb',
      ['add', '--project', 'demo', '--figure', 'fig1', '--kind', 'point', '--x', '0.1', '--y', '0.1', '--color', 'red'],
      /--color/],
    ['--kind 不认识',
      ['add', '--project', 'demo', '--figure', 'fig1', '--kind', 'circle', '--x', '0.1', '--y', '0.1'],
      /--kind 不认识/],
    ['坐标不是数字',
      ['add', '--project', 'demo', '--figure', 'fig1', '--kind', 'point', '--x', 'abc', '--y', '0.1'],
      /不是数字/],
    ['缺 --project',
      ['add', '--figure', 'fig1', '--kind', 'point', '--x', '0.1', '--y', '0.1'],
      /缺 --project/],
    ['课题不存在',
      ['add', '--project', 'nope', '--figure', 'fig1', '--kind', 'point', '--x', '0.1', '--y', '0.1'],
      /课题不存在/],
    ['图号不存在',
      ['add', '--project', 'demo', '--figure', 'fig404', '--kind', 'point', '--x', '0.1', '--y', '0.1'],
      /图号找不到/],
    ['缺动作',
      [],
      /缺动作/],
    ['动作不认识',
      ['delete', '--figure', 'fig1'],
      /动作不认识/],
  ];
  for (const [label, args, pattern] of cases) {
    const res = runAnnot(lib1, args);
    check(`${label}：非 0 + 中文原因（${pattern.source}）`,
      res.status === 2 && res.json && res.json.ok === false && pattern.test(errorOf(res)),
      `status=${res.status} ${errorOf(res)}`);
  }
  check('这些失败没有改动 fig1 的标注（仍是 3 条）',
    readJson(annotFile(lib1, 'fig1')).items.length === 3);
}

// ─────────────────────────── [5] render：叠加 SVG ───────────────────────────

console.log('\n[5] render：把标注烧成 <基名>.annot.svg（原图 image 引用 + 四种元素）');
{
  const point = runAnnot(lib1, ['add', '--project', 'demo', '--figure', 'fig1',
    '--kind', 'point', '--x', '0.7', '--y', '0.5', '--width', '2']);
  check('补一条 point：items 计数 4', point.status === 0 && point.json && point.json.items === 4,
    point.json ? `items=${point.json.items}` : errorOf(point));

  const out = path.join(lib1, 'projects', 'demo', 'figures', 'fig1.annot.svg');
  const res = runAnnot(lib1, ['render', '--figure', 'fig1']);
  check('render：退出码 0 且 ok:true', res.status === 0 && res.json && res.json.ok === true,
    res.json ? '' : errorOf(res));
  check('render：默认输出 <同目录>/<基名>.annot.svg',
    res.json && res.json.output === 'projects/demo/figures/fig1.annot.svg', res.json ? res.json.output : '');
  check('render：source 指向原 SVG',
    res.json && res.json.source === 'projects/demo/figures/fig1.svg', res.json ? res.json.source : '');
  check('render：画布 = 原图 viewBox（800×600，不裁页码图版）',
    res.json && res.json.canvas && res.json.canvas.width === 800 && res.json.canvas.height === 600,
    res.json ? JSON.stringify(res.json.canvas) : '');
  check('render：href 相对于输出目录 = fig1.svg',
    res.json && res.json.href === 'fig1.svg', res.json ? res.json.href : '');
  check('render：文件真的落盘', fs.existsSync(out), out);

  const svg = readText(out);
  check('叠加图是完整 XML 文档（声明 + svg 根 + 换行结尾）',
    svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>') && svg.trimEnd().endsWith('</svg>'));
  check('原图只有一个 <image> 引用（不是内联展开）',
    (svg.match(/<image\b/g) || []).length === 1 && /<image [^>]*href="fig1\.svg"/.test(svg)
    && /xlink:href="fig1\.svg"/.test(svg));
  check('image 覆盖整个画布并禁用缩放', /<image [^>]*preserveAspectRatio="none"/.test(svg));
  check('标注层分组存在', svg.includes('<g id="annot-layer">'));
  check('rect：0.1×800=80、0.2×600=120、0.3×800=240、0.4×600=240',
    /<rect [^>]*x="80" y="120" width="240" height="240"/.test(svg));
  check('rect：描边色与线宽来自 add 参数',
    /<rect [^>]*stroke="#00ff00" stroke-width="3"/.test(svg));
  check('text：0.5×800=400、0.65×600=390、字号 20、文字原样',
    /<text [^>]*x="400" y="390"[^>]*font-size="20"[^>]*>峰值 A<\/text>/.test(svg));
  check('arrow：起点 (160,180) → 终点 (480,240) 带 marker 头',
    /<line [^>]*x1="160" y1="180" x2="480" y2="240" marker-end="url\(#annot-head-3\)"/.test(svg)
    && svg.includes('<marker id="annot-head-3"') && svg.includes('M0,0 L10,5 L0,10 z'));
  check('point：0.7×800=560、0.5×600=300、半径 3.6',
    /<circle [^>]*cx="560" cy="300" r="3\.6"/.test(svg));
  check('每条标注都带 id 与 data-kind（可回溯）',
    svg.includes('data-kind="rect"') && svg.includes('data-kind="text"')
    && svg.includes('data-kind="arrow"') && svg.includes('data-kind="point"'));
  check('metadata 自描述带 figureId 与整份标注',
    svg.includes('<metadata id="annot-record">') && svg.includes('"figureId": "fig1"')
    && svg.includes('"count": 4'));

  const again = runAnnot(lib1, ['render', '--figure', 'fig1']);
  check('再次 render 不加 --overwrite：拒绝覆盖',
    again.status !== 0 && /输出已存在/.test(errorOf(again)), errorOf(again));
  const forced = runAnnot(lib1, ['render', '--figure', 'fig1', '--overwrite']);
  check('加 --overwrite 才覆盖', forced.status === 0 && forced.json && forced.json.ok === true, errorOf(forced));

  const custom = runAnnot(lib1, ['render', '--figure', 'fig1', '--out', 'out/fig1-annot.svg']);
  const customAbs = path.join(lib1, 'out', 'fig1-annot.svg');
  check('--out 相对路径按库根解析、href 相对输出目录',
    custom.status === 0 && fs.existsSync(customAbs)
    && custom.json.href === '../projects/demo/figures/fig1.svg',
    custom.json ? custom.json.href : errorOf(custom));
  const badOut = runAnnot(lib1, ['render', '--figure', 'fig1', '--out', 'out/fig1.png']);
  check('--out 不是 .svg：报错', badOut.status !== 0 && /--out/.test(errorOf(badOut)), errorOf(badOut));
}

// ─────────────────────────── [6] 图组子目录 / figureId≠文件名 / 缺原件 ───────────────────────────

console.log('\n[6] 图组子目录、figureId 与文件名不同名、缺同名 .svg');
{
  const sub = runAnnot(lib1, ['add', '--project', 'demo', '--figure', 'fig3', '--kind', 'rect',
    '--x', '0.2', '--y', '0.2', '--w', '0.2', '--h', '0.2']);
  check('图组子目录里的 fig3 侧车能被递归扫到',
    sub.status === 0 && sub.json && sub.json.figureId === 'fig3' && sub.json.project === 'demo',
    sub.json ? `${sub.json.project}/${sub.json.figureId}` : errorOf(sub));
  const subRender = runAnnot(lib1, ['render', '--figure', 'fig3']);
  check('fig3 的叠加图落在它自己的图组目录',
    subRender.status === 0 && subRender.json.output === 'projects/demo/figures/curve/fig3.annot.svg'
    && fs.existsSync(path.join(lib1, 'projects', 'demo', 'figures', 'curve', 'fig3.annot.svg')),
    subRender.json ? subRender.json.output : errorOf(subRender));

  const byStem = runAnnot(lib1, ['add', '--project', 'demo', '--figure', 'fig4',
    '--kind', 'point', '--x', '0.3', '--y', '0.3']);
  check('侧车文件名 fig4 → figureId 图四：按文件名也能查到，标注文件用 figureId',
    byStem.status === 0 && byStem.json.figureId === '图四'
    && byStem.json.annotFile === '.research/annot/图四.json'
    && fs.existsSync(annotFile(lib1, '图四')),
    byStem.json ? byStem.json.annotFile : errorOf(byStem));
  const byId = runAnnot(lib1, ['render', '--figure', '图四']);
  check('用 figureId 图四 也能渲染，输出仍在侧车同目录',
    byId.status === 0 && byId.json.output === 'projects/demo/figures/fig4.annot.svg'
    && byId.json.href === 'fig4.svg',
    byId.json ? byId.json.output : errorOf(byId));

  const noSvgAdd = runAnnot(lib1, ['add', '--project', 'demo', '--figure', 'fig5',
    '--kind', 'point', '--x', '0.1', '--y', '0.1']);
  check('没有同名 .svg 时 add 仍记账，但明确 warning「找不到原始 SVG」',
    noSvgAdd.status === 0 && noSvgAdd.json
    && (noSvgAdd.json.warnings || []).some((w) => /找不到原始 SVG/.test(w)),
    noSvgAdd.json ? (noSvgAdd.json.warnings || []).join('；') : errorOf(noSvgAdd));
  const noSvgRender = runAnnot(lib1, ['render', '--figure', 'fig5']);
  check('缺原件时 render 明确失败（不偷偷出空图）',
    noSvgRender.status !== 0 && /找不到原始 SVG/.test(errorOf(noSvgRender)), errorOf(noSvgRender));

  const empty = runAnnot(lib2, ['render', '--figure', 'fig2']);
  check('没 add 过的图 render：报「还没有标注」',
    empty.status !== 0 && /还没有标注/.test(errorOf(empty)), errorOf(empty));
}

// ─────────────────────────── [7] 负 min-x/min-y 的 viewBox ───────────────────────────

console.log('\n[7] 负 min-x/min-y 的 viewBox：坐标换算带偏移');
{
  const add = runAnnot(lib1, ['add', '--project', 'demo', '--figure', 'fig6',
    '--kind', 'rect', '--x', '0.1', '--y', '0.2', '--w', '0.25', '--h', '0.5']);
  const res = runAnnot(lib1, ['render', '--figure', 'fig6']);
  check('fig6 add + render 都成功',
    add.status === 0 && res.status === 0 && res.json.canvas.width === 400 && res.json.canvas.height === 300,
    res.json ? JSON.stringify(res.json.canvas) : errorOf(res));
  const svg = readText(path.join(lib1, 'projects', 'demo', 'figures', 'fig6.annot.svg'));
  check('叠加图保留原 viewBox（含负 min）',
    svg.includes('viewBox="-10 -20 400 300"'));
  check('image 也带负偏移，盖住原坐标系',
    /<image x="-10" y="-20" width="400" height="300"/.test(svg));
  check('rect：-10+0.1×400=30、-20+0.2×300=40、宽 100、高 150',
    /<rect [^>]*x="30" y="40" width="100" height="150"/.test(svg));
}

// ─────────────────────────── [8] 转发与零依赖纪律 ───────────────────────────

console.log('\n[8] research.py 转发 + 零第三方依赖');
{
  const help = runRaw(lib1, ['--help']);
  check('research.py --help 里有 annot 子命令',
    help.status === 0 && /\bannot\b/.test(help.stdout));

  const source = readText(ANNOT);
  const allowed = new Set(['__future__', 'argparse', 'datetime', 'json', 'math', 'os', 're', 'sys',
    'pathlib', 'typing', 'xml']);
  const modules = [...source.matchAll(/^\s*(?:import|from)\s+([a-zA-Z_][\w.]*)/gm)]
    .map((match) => match[1].split('.')[0]);
  const foreign = modules.filter((name) => !allowed.has(name));
  check('annot.py import 的模块都在标准库白名单内', foreign.length === 0, foreign.join(', ') || '无越界');
  check('annot.py 不引 XML 解析器（只做字符串拼装 + saxutils 转义）',
    !/^\s*(?:import|from)\s+(?:lxml|xml\.etree)/m.test(source));
  check('annot.py 有 __main__ 入口（能当库 import，也能单跑）', /__main__/.test(source));
}

// ─────────────────────────── 收尾 ───────────────────────────

for (const lib of [lib1, lib2]) {
  try { fs.rmSync(lib, { recursive: true, force: true }); } catch { /* 临时目录清理失败不算测试失败 */ }
}

console.log(`\n${'='.repeat(72)}`);
console.log(`${pass} 通过 · ${fail} 失败${skip ? ` · ${skip} 跳过` : ''}`);
process.exit(fail ? 1 : 0);

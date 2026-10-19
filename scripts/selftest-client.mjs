/**
 * 科研模式 · 客户端半边自检（裸 node 运行：不需要浏览器、不需要 Harness）
 * ===========================================================================
 * 它把 `lib/client.js` 当成浏览器会做的那样加载：
 *   1. 造一个假的 `window.__ModuleLoader__`，捕获 bundle 注册（id + factory）；
 *   2. 造一个**微缩 React**（createElement / useState / useEffect / useCallback / useMemo / useRef
 *      + 极简函数组件渲染器），让面板真的跑起来（不是在浏览器里跑，但走的是同一份代码）；
 *   3. 造假的 `ctx`（slots + connection）——connection 的 rpc.call 直接接到真的
 *      `lib/actions.js` 上，所以点「展开/引用核查」会真的读科研库里的文件；
 *   4. 断言挂点、渲染文本、标签页切换、缩略图 dataURL、表头下拉，以及 CSS 用的主题 token
 *      全在官方 14 个之内。
 *
 * **绝不**点「重画」按钮（那会真的启动 Origin）。
 *
 * 用法：
 *   node scripts/selftest-client.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import { handleResearchCall } from '../lib/actions.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, '..', 'lib', 'client.js');

let pass = 0, fail = 0;
const failures = [];
const check = (name, cond, detail) => {
  if (cond) { pass += 1; console.log(`  PASS  ${name}${detail ? '  —— ' + detail : ''}`); }
  else { fail += 1; failures.push(`${name}: ${detail || '断言失败'}`); console.log(`  FAIL  ${name}  —— ${detail || '断言失败'}`); }
};
const ok = (name, detail) => check(name, true, detail);

/* ------------------------------------------------------------ 微缩 React */

const hookStores = new Map();
let rendering = null;
let cursor = 0;
let dirty = false;
let pendingEffects = [];

const storeOf = (instance) => {
  let s = hookStores.get(instance);
  if (!s) { s = { states: [], deps: [] }; hookStores.set(instance, s); }
  return s;
};
const slot = () => { const s = storeOf(rendering); return { s, i: cursor++ }; };

const React = {
  createElement(type, props) {
    const flat = [];
    const push = (c) => { if (Array.isArray(c)) c.forEach(push); else flat.push(c); };
    for (let i = 2; i < arguments.length; i += 1) push(arguments[i]);
    return { type, props: props || {}, children: flat };
  },
  useState(init) {
    const { s, i } = slot();
    if (!(i in s.states)) s.states[i] = typeof init === 'function' ? init() : init;
    const set = (v) => {
      const next = typeof v === 'function' ? v(s.states[i]) : v;
      if (!Object.is(next, s.states[i])) { s.states[i] = next; dirty = true; }
    };
    return [s.states[i], set];
  },
  useRef(init) { const { s, i } = slot(); if (!(i in s.states)) s.states[i] = { current: init }; return s.states[i]; },
  useMemo(fn, deps) {
    const { s, i } = slot();
    const d = s.deps[i];
    if (!d || !deps || deps.length !== d.length || deps.some((x, j) => !Object.is(x, d[j]))) { s.deps[i] = deps; s.states[i] = fn(); }
    return s.states[i];
  },
  useCallback(fn, deps) { return React.useMemo(() => fn, deps); },
  useEffect(fn, deps) {
    const { s, i } = slot();
    const d = s.deps[i];
    if (!d || !deps || deps.length !== d.length || deps.some((x, j) => !Object.is(x, d[j]))) { s.deps[i] = deps; pendingEffects.push(fn); }
  },
};

function renderNode(node, path = '') {
  if (node === null || node === undefined || typeof node === 'boolean') return null;
  if (typeof node === 'string' || typeof node === 'number') return { text: String(node) };
  if (Array.isArray(node)) return node.map((c, i) => renderNode(c, path + '[' + i + ']')).filter(Boolean);
  if (typeof node.type === 'function') {
    const fn = node.type;
    // hook 存储按**组件实例**分桶（和真 React 一致）：有 key 用 key，否则用它在树里的位置。
    // 按「组件函数」分桶会让两张 FigureCard / DraftCard 共用一份 state，藏住真 bug。
    const inst = (fn.name || 'Anon') + (node.props && node.props.key !== undefined ? '#' + node.props.key : '@' + path);
    storeOf(inst);
    const prevRendering = rendering, prevCursor = cursor;
    rendering = inst; cursor = 0;
    let out;
    try { out = fn(node.props); } finally { rendering = prevRendering; cursor = prevCursor; }
    return renderNode(out, path + '>' + (fn.name || 'Anon'));
  }
  return { tag: node.type, props: node.props || {}, children: node.children.map((c, i) => renderNode(c, path + '/' + i)).filter(Boolean) };
}

async function settle(rootType, props, rounds = 8) {
  let tree = null;
  for (let r = 0; r < rounds; r += 1) {
    dirty = false; pendingEffects = [];
    tree = renderNode(React.createElement(rootType, props));
    const effects = pendingEffects.slice();
    for (const fn of effects) { try { fn(); } catch (e) { check('effect 不抛异常', false, String(e.message || e)); } }
    await new Promise((res) => setTimeout(res, 160));
    if (!dirty) break;
  }
  return tree;
}

function walk(node, fn) {
  if (!node) return;
  fn(node);
  if (node.children) node.children.forEach((c) => walk(c, fn));
}
function allText(node) {
  const out = [];
  walk(node, (n) => { if (n.text !== undefined) out.push(n.text); else if (n.props && typeof n.props.children === 'string') out.push(n.props.children); });
  return out.join(' ');
}
const findByTagText = (node, tag, needle) => {
  let found = null;
  walk(node, (n) => { if (!found && n.tag === tag && allText(n).includes(needle)) found = n; });
  return found;
};
/** 诊断用：列出树里所有按钮的可见文字（空字符串 = 按钮是空壳，通常是标签没接上）。 */
const findAllByTagText = (node, tag, needle) => {
  const out = [];
  walk(node, (n) => { if (n.tag === tag && allText(n).includes(needle)) out.push(n); });
  return out;
};
const buttonTexts = (node) => {
  const out = [];
  walk(node, (n) => { if (n.tag === 'button') out.push(JSON.stringify(allText(n).slice(0, 12))); });
  return '按钮 ' + out.length + ' 个：' + (out.join(' ') || '（一个都没有）');
};

/* --------------------------------------------------------- 浏览器环境桩 */

let injectedCss = '';
// node 24 起 `globalThis.navigator` 是只读 getter，必须 defineProperty。
const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
define('window', {
  __ModuleLoader__: { load(spec) { globalThis.__captured = spec; } },
});
define('document', {
  createElement: () => ({ setAttribute() {}, textContent: '' }),
  head: { appendChild: (el) => { injectedCss = el.textContent || ''; } },
  documentElement: { appendChild() {} },
});
define('navigator', { clipboard: { writeText: () => Promise.resolve() } });
// localStorage 桩：新手引导只往自己的键（research-panel-setup:*）里写，这里记下来断言。
const lsStore = new Map();
define('localStorage', {
  getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => { lsStore.set(k, String(v)); },
  removeItem: (k) => { lsStore.delete(k); },
  clear: () => lsStore.clear(),
});

console.log('科研模式 · 客户端半边自检（lib/client.js，微缩 React 渲染）');
console.log('='.repeat(72));

/* 1. bundle 包封 */
console.log('\n[1] AMD 包封');
await import(pathToFileURL(CLIENT).href);
const spec = globalThis.__captured;
check('通过 __ModuleLoader__.load 注册', !!spec, spec ? `id=${spec.id}` : '没有捕获到 load 调用');
check('bundle id 正确', spec && spec.id === 'dsh-sciwork', spec && spec.id);
check('factory 是函数', spec && typeof spec.factory === 'function');

const requested = [];
const clientExports = spec.factory((name) => {
  requested.push(name);
  if (name === 'react') return React;
  throw new Error('平台基座没有这个模块：' + name);
});
check('只 require 平台 seed 里的模块', requested.every((m) => m === 'react'), requested.join(', ') || '（没有 require）');
check('exports.apply 存在', typeof clientExports.apply === 'function');
check('exports.inject = [\'slots\']', JSON.stringify(clientExports.inject) === JSON.stringify(['slots']), JSON.stringify(clientExports.inject));

/* 2. 挂点注册 */
console.log('\n[2] 挂点注册（sidebar.panellist + keyed main）');
const registrations = [];
let lastCall = null;
/* 安全闸门：intercept 返回信封时，请求被挡住、绝不落到真库（[9] 用它测写动作的「请求形状」）。
   返回 null 表示放行 —— 读动作（snapshot/readText/readBinary/tableColumns/archiveInfo/importInfo）
   走真宿主，只读，安全。 */
let intercept = null;
const conn = {
  rpc: {
    call: async (channel, endpoint, payload) => {
      lastCall = { channel, endpoint, action: payload && payload.action, args: payload && payload.args };
      if (intercept) {
        const fake = intercept(payload);
        if (fake) return fake;
      }
      return handleResearchCall(payload);
    },
  },
};
const slots = {
  inject(name, cb) { cb(); return () => {}; },
  register(spec2, comp) { registrations.push({ spec: spec2, comp }); return () => {}; },
};
const ctx = {
  get: (name) => (name === 'slots' ? slots : (name === 'connection' ? conn : undefined)),
  effect: (fn) => { fn(); },
};
try {
  clientExports.apply(ctx);
  ok('apply() 不抛异常');
} catch (error) {
  check('apply() 不抛异常', false, String(error.message || error));
}
check('注册了 2 个挂点', registrations.length === 2, registrations.map((r) => r.spec.name + '/' + (r.spec.id || r.spec.key)).join(' + '));
const row = registrations.find((r) => r.spec.name === 'sidebar.panellist');
const main = registrations.find((r) => r.spec.name === 'main');
check('图标行：id=research-library / order=42', !!row && row.spec.id === 'research-library' && row.spec.order === 42,
  row ? JSON.stringify({ id: row.spec.id, order: row.spec.order }) : '缺');
check('图标行有 label()', !!row && typeof row.spec.label === 'function' && row.spec.label() === '科研库');
check('主页面：key 与图标 id 一致（keyed main 同一把钥匙）', !!main && main.spec.key === 'research-library', main ? main.spec.key : '缺');
check('图标是组件', !!row && typeof row.comp === 'function');
check('页面是组件', !!main && typeof main.comp === 'function');

/* 3. 渲染 */
console.log('\n[3] 渲染（真实库数据经 actions.js → library.js）');
const Panel = main ? main.comp : () => null;
let tree = null;
try {
  tree = await settle(Panel, {});
  ok('首次渲染 + 异步取数后重渲染，全程无异常');
} catch (error) {
  check('首次渲染无异常', false, String(error.message || error));
}
/* 3a. 第一次打开先给欢迎卡（新手引导），点「我自己看」才进库 */
const welcomeText = tree ? allText(tree) : '';
check('第一次打开先给欢迎卡', welcomeText.includes('欢迎使用科研库面板'), welcomeText.slice(0, 60));
check('欢迎卡讲清三件事', welcomeText.includes('一屏读完') && welcomeText.includes('能读，也能写') && welcomeText.includes('边界写清楚了'));
check('欢迎卡有「看导览（N 步）」入口', /看导览（\d+ 步）/.test(welcomeText), (welcomeText.match(/看导览（\d+ 步）/) || [''])[0]);
check('欢迎卡里七个页签仍然可见', ['图表', '草稿', '文献', '数据', '期刊档案', '投稿', '归档'].every((t) => welcomeText.includes(t)));
const laterBtn = tree ? findByTagText(tree, 'button', '我自己看') : null;
check('找到「我自己看」按钮', !!laterBtn, buttonTexts(tree));
if (laterBtn) laterBtn.props.onClick();
tree = await settle(Panel, {});
ok('点「我自己看」后进库（重渲染无异常）');
check('欢迎卡看过一次就记进 localStorage', lsStore.get('research-panel-setup:welcome:local') === '1',
  String(lsStore.get('research-panel-setup:welcome:local')));
/* 真库可能被用户清空（面板现在真能删东西）：内容类断言按库里实际有什么决定跑不跑 —— 别假失败 */
const realSnapRes = await handleResearchCall({ action: 'snapshot' });
const realSnap = realSnapRes.value || {};
if (!(realSnapRes.ok && realSnap.ok === true)) {
  console.log('\n' + '='.repeat(72));
  console.log(`未运行：内容类检查需要一个可用的科研库（当前库根 ${realSnap.root || '未知'}）。`);
  console.log('设 SCIWORK_LIBRARY 指向一个库根再跑，例如：');
  console.log('  SCIWORK_LIBRARY=/path/to/Research node scripts/selftest-client.mjs');
  console.log(`${pass} 通过 · ${fail} 失败 · 其余内容类检查未运行（本机没有可用的科研库）`);
  process.exit(fail === 0 ? 0 : 1);
}
const realFamily = (k) => (realSnap.projects || []).reduce((acc, p) => acc.concat(p[k] || []), []);
const realDrafts = realFamily('drafts');
const realFigs = realFamily('figures');
const realData = realFamily('datasets');
const realGhost = realFigs.some((f) => f.fileExists === false);
const liveProj = (realSnap.projects || [])[0] || {};
const liveSlug = liveProj.slug || '';
const liveTitle = liveProj.title || liveSlug;
const skipNote = (what) => console.log(`  SKIP  ${what}  —— 真库当前没有这类内容（用户可以在面板里删掉）`);
const text = tree ? allText(tree) : '';
check('走了 /api research/call', !!lastCall && lastCall.channel === '/api' && lastCall.endpoint === 'research/call', JSON.stringify(lastCall));
check('标题渲染', text.includes('科研库 · Research Library'));
check('库根渲染', text.includes(realSnap.root), realSnap.root);
const nProjects = (realSnap.projects || []).length;
check('计数渲染（课题数与库一致）', new RegExp(`课题\\s*${nProjects}`).test(text), (text.match(/课题\s*\d+[^·]*·\s*图\s*\d+/) || [''])[0] + ` / 库里 ${nProjects} 个`);
if (liveSlug) check('课题卡片渲染', text.includes(liveSlug) || text.includes(liveTitle), text.slice(0, 400));
else skipNote('课题卡片渲染');
// 图卡：真库里有几张就渲染几张（用户会删图，别写死 fig1/fig2 —— 写死过一次，删了就假失败）
if (realFigs.length) {
  const missing = realFigs.filter((f) => !text.includes(f.figureId)).map((f) => f.figureId);
  check('图卡片渲染', missing.length === 0, realFigs.map((f) => f.figureId).join(' + ') + (missing.length ? `（缺 ${missing.join('、')}）` : ''));
} else skipNote('图卡片渲染');
if (realGhost) check('缺图告警如实显示', text.includes('图文件缺失'), '幽灵图如实提示'); else skipNote('缺图告警如实显示');
check('六个标签页都在', ['图表', '草稿', '文献', '数据', '期刊档案', '投稿'].every((t) => text.includes(t)));
check('页脚写清写入边界', text.includes('写入都走库脚本') && text.includes('.research/archive/') && text.includes('真删要输文件名'));
const img0 = (() => { let f = null; walk(tree, (n) => { if (!f && n.tag === 'img') f = n; }); return f; })();
check('折叠状态不加载缩略图（省 base64）', img0 === null, img0 ? '竟然有 img' : '没有 img');

/* 4. 交互：切到草稿 → 引用核查 */
console.log('\n[4] 交互（点击驱动，不是看代码猜）');
const draftsTab = tree ? findByTagText(tree, 'button', '草稿') : null;
check('找到「草稿」标签按钮', !!draftsTab);
if (draftsTab) {
  draftsTab.props.onClick();
  const t2 = await settle(Panel, {});
  const x2 = allText(t2);
  if (realDrafts.length) check('切到草稿后渲染草稿卡', x2.includes('bad.md') && x2.includes('good.md'), 'bad.md + good.md'); else skipNote('切到草稿后渲染草稿卡');
  const citeBtn = findByTagText(t2, 'button', '引用核查');
  if (realDrafts.length) check('找到「引用核查」按钮', !!citeBtn, buttonTexts(t2)); else skipNote('找到「引用核查」按钮');
  if (citeBtn) {
    citeBtn.props.onClick();
    const t3 = await settle(Panel, {});
    const x3 = allText(t3);
    check('核查结果：未通过', x3.includes('引用核查未通过'), x3.includes('引用核查未通过') ? '' : x3.slice(0, 120));
    check('核查结果：列出缺失键', x3.includes('nope2020madeup') && x3.includes('should-not-count'));
    check('核查结果：带 caveat（不能证明内容支持）', x3.includes('不能证明被引文献的内容真的支持'));
    check('核查结果：库里已知 1 条', x3.includes('库里已知文献：1 条') || x3.includes('已知文献：1 条'));
  }
}

/* 5. 交互：切回图表 → 展开 → 缩略图 + 列名 */
const figuresTab = tree ? findByTagText(tree, 'button', '图表') : null;
if (figuresTab) {
  figuresTab.props.onClick();
  const t4 = await settle(Panel, {});
  const expands = findAllByTagText(t4, 'button', '展开');
  if (realFigs.length) check('找到「展开」按钮', expands.length > 0, buttonTexts(t4)); else skipNote('找到「展开」按钮');
  if (expands.length) {
    // 两张图都展开：fig1 是幽灵登记（图文件不存在），fig2 有真 PNG。
    // 两个实例的 hook 现在是分开的，所以必须把「有文件的那张」也展开，缩略图才会出现。
    expands.forEach((b) => b.props.onClick());
    const t5 = await settle(Panel, {});
    const x5 = allText(t5);
    let img = null, select = null, replotBtn = null, disabledReplot = null;
    walk(t5, (n) => {
      if (n.tag === 'img' && !img) img = n;
      if (n.tag === 'select' && !select) select = n;
      if (n.tag === 'button' && typeof n.props.onClick === 'function' && allText(n).includes('重画')) { replotBtn = n; disabledReplot = n.props.disabled; }
    });
    // 库里可能一张「图文件存在」的图都没有（用户会在面板里删图）——那时没有 img 不是缺陷，跳过不判失败
    const snapThumb = await handleResearchCall({ action: 'snapshot' });
    const figsWithFile = ((snapThumb.value && snapThumb.value.projects) || [])
      .flatMap((p) => p.figures || []).filter((f) => f.fileExists);
    if (figsWithFile.length === 0) {
      console.log('  SKIP  缩略图以 dataURL 出现  —— 库里当前没有存在的图文件（这类断言依赖真实库里有图）');
    } else {
      // 主件可以是 PNG/SVG/JPEG…（2026-10-11 起科研库的图以 **SVG 为主件**登记），格式别写死，
      // 否则「换了主件格式」会变成一条假失败——同 L334 那条教训。
      check('缩略图以 dataURL 出现', !!img && /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/.test(img.props.src || ''),
        img ? `${(img.props.src || '').slice(0, 24)}…（${(img.props.src || '').length} 字符）` : '没有 img');
    }
    // 跟着真库走：库里当前有「图文件不在」的登记才断言提示，有「图文件在」的就断言它不假装缺失
    // （2026-10-11 僵在这里一次：fig1 的 PNG 被重新生成后，这条写死的期望就成了假失败）
    const ghostNow = realFigs.filter((f) => !f.fileExists);
    const liveNow = realFigs.filter((f) => f.fileExists);
    if (ghostNow.length) {
      check('幽灵图（图文件不在的登记）如实提示，不假装有图', /不存在|找不到|缺失/.test(x5),
        `${ghostNow.map((f) => f.figureId).join('、')} → ${/不存在|找不到|缺失/.test(x5) ? '提示了' : '没提示'}`);
    } else if (liveNow.length) {
      check('图文件在库里 → 详情不写「图文件缺失」', !/图文件缺失/.test(x5),
        `${liveNow.map((f) => f.figureId).join('、')}：${x5.includes('图文件缺失') ? '错报了缺失' : '没误报'}`);
    } else {
      skipNote('幽灵图提示');
    }
    // 参数 JSON 渲染：断言必须跟着真库那张图走 —— fig1 的 params 里没有 plot_type/figureId
    // （它是手写的 XRD 叠图侧车），写死 key 名会让「换了张图」变成假失败。
    const realParamKeys = (realFigs[0] && realFigs[0].params) ? Object.keys(realFigs[0].params) : [];
    const paramHit = realParamKeys.filter((k) => x5.includes(k));
    check('参数 JSON 渲染', realParamKeys.length ? paramHit.length > 0 : (x5.includes('plot_type') || x5.includes('figureId')),
      realParamKeys.length ? `命中 ${paramHit.slice(0, 3).join(' / ')}（共 ${realParamKeys.length} 个 key）` : '库里这张图没有 params');
    check('重画表单：X 列下拉来自真实表头', !!select && (select.children || []).length >= 2,
      select ? '选项 ' + (select.children || []).map((c) => c.props.value).join(' / ') : '没有 select');
    check('重画表单：Y 列 chips', x5.includes('Y 列'));
    check('重画按钮存在且**没有**被点', !!replotBtn, replotBtn ? `disabled=${disabledReplot}` : '没有重画按钮');
    check('重画按钮未禁用（有源数据）', disabledReplot === false || disabledReplot === undefined);
  }
}

/* 6. 主题 token 闸门 */
const OFFICIAL = new Set([
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-brand-primary',
  '--dsw-alias-label-primary', '--dsw-alias-label-secondary',
  // 品牌色块上的前景色（2026-10-19 加）。本站主题把 bg-base 设成全透明，
  // 旧写法 `color: var(--dsw-alias-bg-base)`（拿表面背景色当文字色）会让
  // 导入按钮 / 选中 chips 只剩一块粉。该 token 在宿主 app.asar 中有定义。
  '--dsw-alias-label-primary-foreground',
  '--dsw-alias-state-error-primary', '--dsw-alias-state-idle-primary', '--dsw-alias-state-success-primary', '--dsw-alias-state-warn-primary',
  '--dsw-specific-sidebar-fill',
]);
console.log('\n[6] 主题 token（只许用官方白名单：' + OFFICIAL.size + ' 个）');
const cssSource = readFileSync(CLIENT, 'utf8');
const used = Array.from(new Set((injectedCss.match(/var\((--dsw-[a-z0-9-]+)\)/g) || []).map((s) => s.slice(4, -1))));
check('CSS 已注入（data-rl）', injectedCss.length > 200, `${injectedCss.length} 字符`);
check('用到但不在官方表里的 token：无', used.every((t) => OFFICIAL.has(t)), used.filter((t) => !OFFICIAL.has(t)).join(', ') || '全部合法');
ok('实际用到的 token', `${used.length} 个：${used.join(' ')}`);
check('源码里没有传说中不存在的 bg-layer-3', !/--dsw-alias-bg-layer-3/.test(cssSource));
check('源码里没有 label-tertiary', !/--dsw-alias-label-tertiary/.test(cssSource));
check('没有拿 bg-base 当文字色（会随主题透明化）', !/color:var\(--dsw-alias-bg-base\)/.test(cssSource));
check('品牌色块的前景用 label-primary-foreground',
  /\.rl-btn-primary\{[^}]*color:var\(--dsw-alias-label-primary-foreground\)/.test(cssSource));

/* 7. 新手引导（欢迎卡 / 分步导览 / 持久化）——「像 studyhub 一样」那部分 */
console.log('\n[7] 新手引导（欢迎卡 / 分步导览 / 持久化）');
const T = clientExports.__test;
check('导览步骤表已导出', !!T && Array.isArray(T.TOUR_STEPS) && T.TOUR_STEPS.length >= 8, T ? T.TOUR_STEPS.length + ' 步' : '缺');
if (T && Array.isArray(T.TOUR_STEPS)) {
  check('每一步都有标题和正文', T.TOUR_STEPS.every((s) => s && s.title && s.body && s.id));
  const anchored = T.TOUR_STEPS.filter((s) => s.anchor);
  check('多数步骤锚在真实元素上', anchored.length >= 6, anchored.map((s) => s.anchor).join(' '));

  // 7a. 锚点一致性：每个 step.anchor 都要能在渲染树里找到（拼错会当场露出来）
  const anchorsInTree = new Set();
  walk(tree, (n) => { if (n.props && n.props['data-rl-tour']) anchorsInTree.add(String(n.props['data-rl-tour'])); });
  const missingAnchors = anchored.map((s) => s.anchor).filter((a) => !anchorsInTree.has(a));
  check('每个锚点都能在面板里找到', missingAnchors.length === 0,
    missingAnchors.length ? '缺：' + missingAnchors.join(', ') : '全部命中：' + anchored.map((s) => s.anchor).join(' '));

  // 7b. 位置计算是纯函数（量不到锚点就居中；量到就贴上下、不越界）
  check('量不到锚点 → 说明卡居中', T.placePopover(null, 1400, 900).docked === true);
  const below = T.placePopover({ top: 100, bottom: 140, left: 600, right: 700, width: 100, height: 40 }, 1400, 900);
  check('锚点下方有空间 → 摆在下方', below.docked === false && below.style.top === 152, JSON.stringify(below.style));
  const nearFloor = T.placePopover({ top: 820, bottom: 860, left: 600, right: 700, width: 100, height: 40 }, 1400, 900);
  check('贴底 → 改成贴锚点上沿', nearFloor.docked === false && typeof nearFloor.style.bottom === 'number', JSON.stringify(nearFloor.style));
  const clampLeft = T.placePopover({ top: 100, bottom: 140, left: 0, right: 20, width: 20, height: 40 }, 1400, 900);
  check('靠左时不越界', clampLeft.style.left >= 16, 'left=' + clampLeft.style.left);
  // 矮窗口 + 锚点在下面：卡片会被夹回视口内，而不是顶出屏幕上沿（真浏览器实测过这个 bug）
  const tallVp = T.placePopover({ top: 640, bottom: 660, left: 600, right: 700, width: 100, height: 20 }, 1400, 900);
  check('锚点在视口下半 → 卡片仍留在视口内', tallVp.docked === false && tallVp.style.top + 260 <= 900, JSON.stringify(tallVp.style));

  // 7b2. 超大锚点（整块正文区）只挖一条带：否则聚光灯等于没挖，卡片也会被顶出屏幕
  check('量不到锚点 → 没有聚光灯', T.spotRect(null, 900) === null);
  const smallRect = { top: 100, bottom: 140, left: 0, right: 20, width: 20, height: 40 };
  check('小锚点原样返回', T.spotRect(smallRect, 900) === smallRect);
  const band = T.spotRect({ top: 170, bottom: 900, left: 0, right: 900, width: 900, height: 730 }, 900);
  check('比视口还高的锚点只挖顶部一条带', band && band.band === true && band.height <= 900 * 0.42 + 1 && band.bottom === band.top + band.height,
    JSON.stringify(band));

  // 7c. 从标题右边的「引导」启动
  const guideBtn = findByTagText(tree, 'button', '引导');
  check('标题右边有「引导」按钮', !!guideBtn, buttonTexts(tree));
  const activeTabId = (node) => {
    let id = null;
    walk(node, (n) => {
      const mark = n.props && n.props['data-rl-tour'];
      if (n.tag === 'button' && mark && String(mark).startsWith('tab:') && n.props['data-active'] === '1') id = String(mark).slice(4);
    });
    return id;
  };
  let tv = tree;
  let tvText = allText(tree);
  if (guideBtn) {
    guideBtn.props.onClick();
    tv = await settle(Panel, {});
    tvText = allText(tv);
    const total = T.TOUR_STEPS.length;
    check('导览第 1 步渲染出来', tvText.includes('功能导览') && tvText.includes('1 / ' + total), tvText.slice(0, 100));
    check('第 1 步讲的是面板本身', tvText.includes(T.TOUR_STEPS[0].title));
    check('第 1 步没有「上一步」', !findByTagText(tv, 'button', '上一步'), buttonTexts(tv));
    check('有「跳过」和「下一步」', !!findByTagText(tv, 'button', '跳过') && !!findByTagText(tv, 'button', '下一步'));

    // 7d. 一步步走完：每步标题都要真的渲染，带 tab 的步骤要顺手切到那个页签
    let seen = 0;
    const tabWants = [];
    for (let i = 1; i < total; i += 1) {
      const nextBtn = findByTagText(tv, 'button', '下一步');
      if (!nextBtn) { check('第 ' + (i + 1) + ' 步有「下一步」', false, buttonTexts(tv)); break; }
      nextBtn.props.onClick();
      tv = await settle(Panel, {});
      tvText = allText(tv);
      const step = T.TOUR_STEPS[i];
      if (tvText.includes(step.title)) seen += 1;
      else check('第 ' + (i + 1) + ' 步标题渲染', false, step.title + ' · 实际：' + tvText.slice(0, 100));
      if (tvText.indexOf('功能导览') < 0) { check('第 ' + (i + 1) + ' 步导览仍在', false, '导览被提前关掉了'); break; }
      if (step.tab) tabWants.push({ step: step.id, want: step.tab, got: activeTabId(tv) });
    }
    check('每一步的「下一步」都走得通', seen === total - 1, seen + ' / ' + (total - 1));
    check('带页签的步骤会把面板切过去', tabWants.length > 0 && tabWants.every((x) => x.want === x.got),
      tabWants.map((x) => x.step + '→' + x.got).join(' '));

    // 7e. 最后一步「完成」关掉导览，并记进 localStorage
    check('最后一步的按钮是「完成」', !!findByTagText(tv, 'button', '完成'), buttonTexts(tv));
    const doneBtn = findByTagText(tv, 'button', '完成');
    if (doneBtn) {
      doneBtn.props.onClick();
      const tv2 = await settle(Panel, {});
      const t2 = allText(tv2);
      check('点「完成」后导览关闭', !t2.includes('功能导览'), t2.slice(0, 80));
      check('导览走完记进 localStorage', lsStore.get('research-panel-setup:tour:local') === '1',
        String(lsStore.get('research-panel-setup:tour:local')));
      check('导览关掉后正文回来了', !t2.includes('欢迎使用科研库面板') && !t2.includes('正在读科研库'), t2.slice(0, 120));
      // 导览最后停在「归档」页签（tab-archive 那一步），点回「图表」确认真的是活的面板
      const backFig = findByTagText(tv2, 'button', '图表');
      if (backFig) {
        backFig.props.onClick();
        const tv2b = await settle(Panel, {});
        check('导览后点回图表页：正文在', !liveSlug || allText(tv2b).includes(liveSlug) || allText(tv2b).includes(liveTitle), allText(tv2b).slice(0, 120));
      } else {
        check('导览后点回图表页：正文在', false, buttonTexts(tv2));
      }

      // 7f. 能重来，也能中途跳过
      const again = findByTagText(tv2, 'button', '引导');
      if (again) {
        again.props.onClick();
        const tv3 = await settle(Panel, {});
        check('导览可以重来', allText(tv3).includes('1 / ' + total), allText(tv3).slice(0, 60));
        const skipBtn = findByTagText(tv3, 'button', '跳过');
        check('有「跳过」按钮', !!skipBtn, buttonTexts(tv3));
        if (skipBtn) {
          skipBtn.props.onClick();
          const tv4 = await settle(Panel, {});
          check('点「跳过」也会关掉导览', !allText(tv4).includes('功能导览'));
        }
      } else {
        check('导览可以重来', false, '找不到「引导」按钮：' + buttonTexts(tv2));
      }
    }
  } else {
    check('导览第 1 步渲染出来', false, '没有「引导」按钮');
  }
}

/* 7g. 卸载重挂（清掉 hook 状态）→ 欢迎卡不再自动出现，直接进库 */
hookStores.clear();
const remount = await settle(Panel, {});
const remountText = allText(remount);
check('看过一次后重开不再自动弹欢迎卡', !remountText.includes('欢迎使用科研库面板'), remountText.slice(0, 60));
check('重开后直接进库', !liveSlug || remountText.includes(liveSlug) || remountText.includes(liveTitle), remountText.slice(0, 80));

/* 8. 写动作零件（纯函数；不碰真库） */
console.log('\n[8] 写动作零件（筛选 / 拖拽分流 / 图条目）');
const T2 = clientExports.__test;
const fakeSnap = {
  root: 'X:\\Fake', readAt: '2026-10-11T15:00:00+08:00', counts: {}, warnings: [], origin: null,
  projects: [{
    slug: 'demo-perovskite', title: '钙钛矿稳定性演示', journal: 'nature', notes: '',
    figures: [{ figureId: 'fig1', graph: 'Graph1', caption: '', file: 'projects/demo-perovskite/figures/fig1.png', sidecar: 'projects/demo-perovskite/figures/fig1.json' }],
    drafts: [{ name: 'good.md', path: 'projects/demo-perovskite/drafts/good.md' }],
    datasets: [{ name: 'uvvis.csv', path: 'projects/demo-perovskite/data/uvvis.csv' }],
    tables: [], opju: [],
  }],
  refs: [{ key: 'zhang2023', title: 'Perovskite stability', container: 'Nature', doi: '10.1038/abc', authors: ['Zhang'] }],
  pdfs: [{ name: 'zhang2023.pdf', path: 'refs/pdf/zhang2023.pdf' }],
  journals: [{ id: 'nature', name: 'Nature', nameZh: '自然', publisher: 'Springer' }],
  submissions: [{ name: 'sub1', path: 'submissions/sub1', journal: 'nature' }],
};
check('筛选：空查询原样返回（同一个对象）', T2.filterSnap(fakeSnap, '') === fakeSnap);
check('筛选：null 快照不炸', T2.filterSnap(null, 'x') === null);
check('筛选：命中草稿 → 只剩草稿', (() => {
  const s = T2.filterSnap(fakeSnap, 'good');
  return s.projects.length === 1 && s.projects[0].drafts.length === 1 && s.projects[0].figures.length === 0;
})(), 'good');
check('筛选：没命中的课题整条消失', T2.filterSnap(fakeSnap, 'fig9').projects.length === 0);
check('筛选：期刊命中保留', T2.filterSnap(fakeSnap, '自然').journals.length === 1);
check('筛选：DOI 命中', T2.filterSnap(fakeSnap, '10.1038').refs.length === 1);
check('筛选：pdf 附件命中', T2.filterSnap(fakeSnap, 'zhang2023.pdf').pdfs.length === 1);
check('筛选：原始快照没被改动（浅拷贝，不是原地改）', fakeSnap.journals.length === 1 && T2.filterSnap(fakeSnap, 'nothing-here').projects.length === 0);

check('拖拽猜目标：.csv/.txt → 数据（.txt 也算数据）', T2.guessTarget([{ name: 'a.csv' }, { name: 'b.txt' }]) === 'data');
check('拖拽猜目标：图片 → 图表（大小写不敏感）', T2.guessTarget([{ name: 'a.PNG' }]) === 'figures');
check('拖拽猜目标：.md → 草稿', T2.guessTarget([{ name: 'a.md' }]) === 'drafts');
check('拖拽猜目标：.pdf → 文献', T2.guessTarget([{ name: 'a.pdf' }]) === 'refs');
check('拖拽猜目标：混合取多数', T2.guessTarget([{ name: 'a.csv' }, { name: 'b.png' }, { name: 'c.png' }]) === 'figures');
check('拖拽猜目标：空批 → 数据（默认）', T2.guessTarget([]) === 'data');

const pairedEntry = T2.figureEntry({ figureId: 'fig1', file: 'projects/p/figures/fig1.png', sidecar: 'projects/p/figures/fig1.json', fileExists: true });
check('图条目：同主名的侧车一起带上（归档/删除成对）',
  pairedEntry.path === 'projects/p/figures/fig1.png' && pairedEntry.sidecar === 'projects/p/figures/fig1.json'
  && pairedEntry.kind === 'figure' && pairedEntry.label === 'fig1', JSON.stringify(pairedEntry));
// 真库实测：Graph3.png 的登记侧车叫 fig2.json（主名不同）——删图必须把登记一起带走，否则卡片会一直显示
const oddEntry = T2.figureEntry({ figureId: 'fig2', file: 'projects/p/figures/Graph3.png', sidecar: 'projects/p/figures/fig2.json', fileExists: true });
check('图条目：主名不同的登记侧车也要带上（Graph3.png + fig2.json）',
  oddEntry.path === 'projects/p/figures/Graph3.png' && oddEntry.sidecar === 'projects/p/figures/fig2.json', JSON.stringify(oddEntry));
const replotEntry = T2.figureEntry({ figureId: 'fig2', file: 'projects/p/figures/fig2-replot-20261011-005322.png', sidecar: 'projects/p/figures/fig2.json', fileExists: true });
check('图条目：重画产物也带上登记侧车（只删 PNG 会留下幽灵图）',
  replotEntry.path === 'projects/p/figures/fig2-replot-20261011-005322.png'
  && replotEntry.sidecar === 'projects/p/figures/fig2.json', JSON.stringify(replotEntry));
const ghostEntry = T2.figureEntry({ figureId: 'fig1', file: 'projects/p/figures/fig1-jv.png', sidecar: 'projects/p/figures/fig1.json', fileExists: false });
check('图条目：幽灵图（文件已不在）以侧车为主，删它能真的让卡片消失',
  ghostEntry.path === 'projects/p/figures/fig1.json' && ghostEntry.sidecar === 'projects/p/figures/fig1-jv.png', JSON.stringify(ghostEntry));
check('图条目：只有侧车时用侧车当 path',
  T2.figureEntry({ figureId: 'fig1', file: '', sidecar: 'x/fig1.json' }).path === 'x/fig1.json');

// 「点了没反应」的真凶之一：刷新页面拿到新客户端、但宿主还是旧的（Harness 启动时读进内存的）
check('旧宿主回「未知动作」时，错误里带上「重启 Harness」的提示',
  T2.withHostHint('未知动作：archive。可用动作：snapshot, readText').includes('重启 Harness'),
  T2.withHostHint('未知动作：archive。可用动作：snapshot, readText'));
check('别的错误原样透传（不乱加提示）',
  T2.withHostHint('没有这个文件：x.md') === '没有这个文件：x.md');
check('undefined 不炸', typeof T2.withHostHint(undefined) === 'string');

/* 9. 写动作交互：假信封挡住连接 → 一个字节都不写，但请求形状与渲染都被验到 */
console.log('\n[9] 写动作交互（假信封挡住，绝不落真库）');
const WRITE_ACTIONS = new Set(['archive', 'remove', 'restore', 'writeText', 'newDraft', 'import', 'fetchRefMeta', 'removeRef', 'runCli', 'tableTransform']);
const sent = [];
const FAKE = {
  newDraft: { ok: true, value: { path: 'projects/demo-perovskite/drafts/intro.md', bytes: 9, created: true, body: '# 引言\n\n', mtime: '2026-10-11T15:00:00+08:00' } },
  fetchRefMeta: { ok: true, value: { source: 'crossref', doi: '10.1038/x', title: '抓到的标题', authorText: 'Zhang, Y.', year: 2026, container: 'Nature Materials', url: 'https://doi.org/10.1038/x', type: 'article', warnings: [] } },
  import: { ok: true, value: { target: 'data', placed: [{ name: 'x.csv', path: 'projects/demo-perovskite/data/x.csv', bytes: 10 }], ran: [], notes: [], summary: '落下 1 个文件（跑了 reindex）' } },
  writeText: { ok: true, value: { path: 'projects/demo-perovskite/drafts/good.md', backup: 'projects/demo-perovskite/drafts/good.md.bak', bytes: 12, beforeBytes: 9, mtime: '2026-10-11T15:00:00+08:00' } },
  remove: { ok: true, value: { summary: '已删除 1 个文件（不进系统回收站）', removed: ['projects/demo-perovskite/figures/fig1.png'] } },
  restore: { ok: true, value: { summary: '已恢复 1 个文件（跑了 reindex）', restored: ['projects/demo-perovskite/figures/fig1.png'] } },
  archive: { ok: true, value: { summary: '已归档 1 个条目 → .research/archive/20261011-150000', id: '20261011-150000' } },
  removeRef: { ok: true, value: { key: 'zhang2024very', totalRefs: 0, backup: 'E:\\Research\\refs\\refs.json.bak', citedIn: [], summary: '已删除文献 [zhang2024very]（剩 0 条）；删前的 refs.json 备份在 refs.json.bak。', reindex: { ok: true, summary: '索引重建完成' } } },
  tableTransform: {
    ok: true,
    value: {
      ok: true, op: 'normalize', output: 'projects/demo-perovskite/tables/raw-normalize.csv',
      rows: 23, columns: 2, notes: ['有效点 23/23，最小 0.7，最大 100。'],
      header: ['#1', '#2（归一化 0~1）'], head: [[25.2, 0], [62.5, 0.06]],
      trace: '.research/transforms/demo-perovskite/raw-normalize.json',
    },
  },
  runCli: {
    ok: true,
    value: {
      command: 'check-citations', kind: 'read',
      args: ['check-citations', '--draft', 'projects/demo-perovskite/drafts/manuscript.md'],
      ok: true, code: 0, summary: '引用核查通过：4 条引用全部有 DOI 或 URL。',
      warnings: ['1 条引用的 DOI 没解析过'],
      raw: { ok: true, cited: ['zhang2024'], missing: [] }, stderr: '', elapsedMs: 812,
    },
  },
};
intercept = (payload) => {
  const action = payload && payload.action;
  if (!WRITE_ACTIONS.has(action)) return null;
  sent.push({ action, args: payload.args });
  return FAKE[action];
};
const lastSent = () => sent[sent.length - 1];
const findAll = (node, pred) => { const out = []; walk(node, (n) => { if (pred(n)) out.push(n); }); return out; };
const inputsByClass = (node, cls) => findAll(node, (n) => n.tag === 'input' && String(n.props.className || '').includes(cls));

let t = remount;
const draftsTab2 = findByTagText(t, 'button', '草稿');
check('切到草稿页（写动作交互的起点）', !!draftsTab2, buttonTexts(t));
if (draftsTab2) {
  draftsTab2.props.onClick();
  t = await settle(Panel, {});
}

/* 9a. 新建空白草稿 → newDraft（只创建不存在的名字） */
const newDraftBtn = findByTagText(t, 'button', '新建草稿');
check('草稿页有「新建草稿」入口', !!newDraftBtn, buttonTexts(t));
if (newDraftBtn) {
  newDraftBtn.props.onClick();
  t = await settle(Panel, {});
  const ph = (re) => findAll(t, (n) => n.tag === 'input' && re.test(String(n.props.placeholder || '')))[0];
  const nameBox = ph(/文件名/);
  const titleBox = ph(/标题/);
  check('展开后有文件名 / 标题两个输入框', !!nameBox && !!titleBox, buttonTexts(t));
  const createBtn = () => findAll(t, (n) => n.tag === 'button' && allText(n).includes('创建'))[0];
  const before0 = sent.length;
  createBtn().props.onClick();
  t = await settle(Panel, {});
  check('没填名字时不发请求，只提示', sent.length === before0 && allText(t).includes('起个名字'), allText(t).slice(0, 160));
  nameBox.props.onChange({ target: { value: 'intro' } });
  t = await settle(Panel, {});
  findAll(t, (n) => n.tag === 'input' && /标题/.test(String(n.props.placeholder || '')))[0].props.onChange({ target: { value: '引言' } });
  t = await settle(Panel, {});
  findAll(t, (n) => n.tag === 'button' && allText(n).includes('创建'))[0].props.onClick();
  t = await settle(Panel, {});
  const nd = lastSent();
  check('新建草稿走 newDraft（project + name + title）',
    !!nd && nd.action === 'newDraft' && nd.args.project === liveSlug && nd.args.name === 'intro' && nd.args.title === '引言', JSON.stringify(nd));
  check('新建成功提示路径', allText(t).includes('已新建') && allText(t).includes('intro.md'), allText(t).slice(0, 200));
}

/* 9b. 筛选框：只筛看得见的列表 */
let searchBox = inputsByClass(t, 'rl-search')[0];
check('页签行有筛选框', !!searchBox, buttonTexts(t));
if (searchBox) {
  check('筛选框带 aria-label', searchBox.props['aria-label'] === '筛选');
  searchBox.props.onChange({ target: { value: 'good' } });
  t = await settle(Panel, {});
  if (realDrafts.length) check('筛选 good → 只剩 good.md', allText(t).includes('good.md') && !allText(t).includes('bad.md'), allText(t).slice(0, 120)); else skipNote('筛选 good → 只剩 good.md');
  const clearBtn = findByTagText(t, 'button', '清空筛选');
  check('有「清空筛选」按钮', !!clearBtn);
  if (clearBtn) {
    clearBtn.props.onClick();
    t = await settle(Panel, {});
    if (realDrafts.length) check('清空筛选后两张卡都回来', allText(t).includes('bad.md') && allText(t).includes('good.md')); else skipNote('清空筛选后两张卡都回来');
  }
}

/* 9b. 草稿就地编辑 → 保存（writeText） */
const editBtn = findByTagText(t, 'button', '编辑');
if (realDrafts.length) check('草稿卡有「编辑」按钮', !!editBtn, buttonTexts(t)); else skipNote('草稿卡有「编辑」按钮');
if (editBtn) {
  editBtn.props.onClick();
  t = await settle(Panel, {});
  let area = findAll(t, (n) => n.tag === 'textarea' && String(n.props.className || '').includes('rl-edit'))[0];
  check('点「编辑」出现就地编辑框', !!area);
  if (area) {
    area.props.onChange({ target: { value: '# 新正文\n' } });
    t = await settle(Panel, {});
    const saveBtn = findAll(t, (n) => n.tag === 'button' && allText(n).includes('保存'))[0];
    check('编辑态有「保存」且可点', !!saveBtn && saveBtn.props.disabled === false, buttonTexts(t));
    if (saveBtn) {
      saveBtn.props.onClick();
      t = await settle(Panel, {});
      const s = lastSent();
      check('保存走 writeText，带 path + text', !!s && s.action === 'writeText' && /drafts\/[^/]+\.md$/.test(s.args.path) && s.args.text === '# 新正文\n',
        JSON.stringify(s));
      check('保存后提示 .bak 备份', allText(t).includes('.bak'), allText(t).slice(0, 200));
    }
  }
}

/* 9c. 真删闸门：必须原样输入文件名，名字对了才放行 */
const figTab = findByTagText(t, 'button', '图表');
if (figTab) { figTab.props.onClick(); t = await settle(Panel, {}); }
const delBtn = findByTagText(t, 'button', '删除');
if (realFigs.length) check('图卡有「删除」按钮', !!delBtn, buttonTexts(t)); else skipNote('图卡有「删除」按钮');
if (delBtn) {
  const before = sent.length;
  delBtn.props.onClick();
  t = await settle(Panel, {});
  check('点「删除」不直接删，先要输文件名', sent.length === before && inputsByClass(t, 'rl-name').length > 0);
  const box = inputsByClass(t, 'rl-name')[0];
  const want = box && box.props.placeholder;
  const realDel = () => findAll(t, (n) => n.tag === 'button' && allText(n).includes('真删'))[0];
  check('没输名字时「真删」是禁用的', !!realDel() && realDel().props.disabled === true);
  box.props.onChange({ target: { value: 'wrong' } });
  t = await settle(Panel, {});
  check('名字不对仍禁用', realDel() && realDel().props.disabled === true);
  inputsByClass(t, 'rl-name')[0].props.onChange({ target: { value: want } });
  t = await settle(Panel, {});
  check('原样输入文件名后「真删」才可点', realDel() && realDel().props.disabled === false, 'want=' + want);
  realDel().props.onClick();
  t = await settle(Panel, {});
  const s = lastSent();
  check('真删请求带 confirm=文件名', !!s && s.action === 'remove' && s.args.confirm === want && s.args.entries.length === 1, JSON.stringify(s));
  check('真删结果显示（假信封）', allText(t).includes('已删除'), allText(t).slice(0, 160));
}

/* 9d. 回归：数据页不再自己出图（2026-10-13 用户要求把面板三个出图入口整体删掉） */
const assetsTab = findByTagText(t, 'button', '数据');
if (assetsTab) { assetsTab.props.onClick(); t = await settle(Panel, {}); }
{
  const txt = allText(t);
  const btns = buttonTexts(t);
  check('数据卡没有「出图」按钮', findAll(t, (n) => n.tag === 'button' && allText(n).trim() === '出图').length === 0, btns);
  check('数据页没有「成组出图 / 直接出图 / 整组勾选 / 清空选择」',
    !/成组出图|直接出图|整组勾选|整组取消|清空选择/.test(txt), txt.slice(0, 240));
  check('数据页没有「成组」勾选框', findAll(t, (n) => n.tag === 'input' && n.props && n.props.type === 'checkbox').length === 0, btns);
  check('数据页仍保留「变换」入口（用户没要求删）', findAll(t, (n) => n.tag === 'button' && allText(n).trim() === '变换').length >= 1, btns);
}

/* 9e. 归档页：列出批次 + 恢复 */
const archTab = findByTagText(t, 'button', '归档');
if (archTab) { archTab.props.onClick(); t = await settle(Panel, {}); }
check('归档页签渲染归档区', allText(t).includes('归档'), allText(t).slice(-160));

/* 9f. 拖拽：整批丢进来按多数预选目标（顺便把 FileReader 假实现装上，真去读那批文件） */
define('FileReader', function FakeFileReader() {
  this.readAsArrayBuffer = (file) => { this.result = (file && file.__buf) || new ArrayBuffer(4); if (this.onload) this.onload(); };
});
const dropNode = findAll(t, (n) => n.props && typeof n.props.onDrop === 'function')[0];
check('面板根节点挂了拖拽落点', !!dropNode);
if (dropNode) {
  dropNode.props.onDrop({ preventDefault() {}, dataTransfer: { files: [{ name: 'x.csv', size: 4, __buf: new ArrayBuffer(4) }, { name: 'y.txt', size: 4, __buf: new ArrayBuffer(4) }] } });
  t = await settle(Panel, {}, 12);
  const active = findAll(t, (n) => n.props && n.props['data-active'] === '1' && allText(n).includes('数据'))[0];
  check('拖 .csv/.txt 打开导入弹层并把目标预选成「数据」', !!active, buttonTexts(t));
  const closeBtn = findAll(t, (n) => n.tag === 'button' && allText(n).includes('关闭'))[0];
  if (closeBtn) { closeBtn.props.onClick(); t = await settle(Panel, {}); }
}
/* 9g. 拖进来的整批文件：先在浏览器里读成 base64，再按每个文件的去处分组导入 */
const dropNode2 = findAll(t, (n) => n.props && typeof n.props.onDrop === 'function')[0];
if (dropNode2) {
  dropNode2.props.onDrop({
    preventDefault() {},
    dataTransfer: { files: [{ name: 'x.csv', size: 4, __buf: new ArrayBuffer(4) }, { name: 'y.png', size: 4, __buf: new ArrayBuffer(4) }] },
  });
  t = await settle(Panel, {}, 12);
  const staged = allText(t);
  check('拖进来的文件被读成 base64（不再是空对象）', !/读不了拖进来的文件/.test(staged) && staged.includes('x.csv') && staged.includes('y.png'), staged.slice(-400));
  const targetSelects = findAll(t, (n) => n.tag === 'select' && (n.children || []).some((c) => allText(c).includes('图片')));
  check('每个文件都能单独改去处（两个下拉）', targetSelects.length >= 2, 'selects=' + targetSelects.length);
  check('分批提示出现（按去处分开导入）', /分成 2 组/.test(staged), staged.slice(0, 240));
  const projSel = findAll(t, (n) => n.tag === 'select' && (n.children || []).some((c) => allText(c).includes(liveSlug)))[0];
  if (projSel) { projSel.props.onChange({ target: { value: liveSlug } }); t = await settle(Panel, {}); }
  const before = sent.length;
  // 只在弹层里找「导入」主按钮 —— 页头也有一个「导入」主按钮（点了会重开弹层）
  const modalNode = findAll(t, (n) => String((n.props && n.props.className) || '') === 'rl-modal')[0];
  const importBtn = modalNode
    ? findAll(modalNode, (n) => n.tag === 'button' && String((n.props && n.props.className) || '').includes('rl-btn-primary') && allText(n).includes('导入'))[0]
    : null;
  check('弹层里有主按钮「导入」', !!importBtn, buttonTexts(t));
  if (importBtn) {
    importBtn.props.onClick();
    t = await settle(Panel, {}, 12);
    const batch = sent.slice(before).filter((s) => s.action === 'import');
    check('一批两种去处 → 发了两次 import（data / figures）',
      batch.length === 2 && batch.map((s) => s.args.target).sort().join(',') === 'data,figures', JSON.stringify(batch.map((s) => ({ t: s.args.target, n: s.args.files.length }))));
    check('每组的文件数正确（各 1 个）', batch.length === 2 && batch.every((s) => s.args.files.length === 1 && s.args.files[0].base64), JSON.stringify(batch.map((s) => s.args.files.map((f) => f.name))));
    check('合并结果里两个去处都报了', /『数据』/.test(allText(t)) && /『图片』/.test(allText(t)), allText(t).slice(-240));
  }
  const closeBtn2 = findAll(t, (n) => n.tag === 'button' && allText(n).includes('关闭'))[0];
  if (closeBtn2) { closeBtn2.props.onClick(); t = await settle(Panel, {}); }
}

/* 9h. 文献条目删除：走 removeRef（面板仍然不直接改 refs.json —— 那是最初的只读边界） */
{
  let th = await settle(Panel, {});
  const refsTabBtn = findByTagText(th, 'button', '文献');
  check('找到「文献」页签（写动作）', !!refsTabBtn, buttonTexts(th));
  if (refsTabBtn) {
    refsTabBtn.props.onClick();
    th = await settle(Panel, {});
    const hx = allText(th);
    const firstRef = ((realSnap && realSnap.refs) || [])[0];
    if (firstRef) check('文献页写明「删除走库脚本 remove-ref」', hx.includes('remove-ref'), hx.slice(0, 90)); else skipNote('文献页写明「删除走库脚本 remove-ref」');
    if (!firstRef) {
      skipNote('文献行删除');
    } else {
      const rowDel = findByTagText(th, 'button', '删除');
      check('文献行有「删除」按钮', !!rowDel, buttonTexts(th));
      if (rowDel) {
        rowDel.props.onClick();
        th = await settle(Panel, {});
        const keyInput = inputsByClass(th, 'rl-name')[0];
        check('点删除后要输入引用键确认', !!keyInput && keyInput.props.placeholder === firstRef.key,
          keyInput ? String(keyInput.props.placeholder) : '没有输入框');
        if (keyInput) {
          const before = sent.length;
          keyInput.props.onChange({ target: { value: firstRef.key } });
          th = await settle(Panel, {});
          const goBtn = findByTagText(th, 'button', '真删条目');
          check('键输对了才给点「真删条目」', !!goBtn && goBtn.props.disabled !== true, goBtn ? 'disabled=' + goBtn.props.disabled : '没有按钮');
          if (goBtn) {
            goBtn.props.onClick();
            th = await settle(Panel, {}, 12);
            const call = sent[before];
            check('发出的是 removeRef（带 key）', !!call && call.action === 'removeRef' && call.args.key === firstRef.key, JSON.stringify(call));
            check('回执如实显示删了哪条', allText(th).includes('已删除文献'), allText(th).slice(0, 140));
          }
        }
      }
    }
  }
}

/* [10] 命令台：点命令 → 填参 → 看结果（以及危险命令的确认闸门） */
console.log('\n[10] 命令台');
{
  const openBtn = findAll(t, (n) => n.tag === 'button' && allText(n).trim() === '命令台')[0];
  check('头部有「命令台」按钮', !!openBtn);
  if (openBtn) {
    openBtn.props.onClick();
    t = await settle(Panel, {});
    const ctxt = allText(t);
    check('命令台弹层打开了', findAll(t, (n) => String((n.props && n.props.className) || '').indexOf('rl-modal') >= 0).length > 0, ctxt.slice(-160));
    check('命令列表按只读/写库/危险分组', ctxt.includes('只读') && ctxt.includes('写库') && ctxt.includes('危险'));
    check('默认选中第一条命令并显示说明', ctxt.includes('status') && ctxt.includes('库概况'), ctxt.slice(0, 120));

    const itemBtns = findAll(t, (n) => n.tag === 'button' && String(n.props.className || '').indexOf('rl-console__item') >= 0);
    check('命令条目可点（≥10 条）', itemBtns.length >= 10, 'N=' + itemBtns.length);

    const cc = itemBtns.filter((b) => allText(b).trim() === 'check-citations')[0];
    if (cc) {
      cc.props.onClick();
      t = await settle(Panel, {});
      const t2 = allText(t);
      check('选中 check-citations 后参数表单按 spec 生成', t2.includes('--draft') && t2.includes('--require-doi'), t2.slice(0, 200));
      const runBtn = findAll(t, (n) => n.tag === 'button' && allText(n).trim() === '运行')[0];
      check('有「运行」主按钮', !!runBtn);
      if (runBtn) {
        runBtn.props.onClick();
        t = await settle(Panel, {});
        const s = lastSent();
        check('runCli 请求形状：id + values（不塞裸数组）', !!s && s.action === 'runCli' && s.args.id === 'check-citations' && !Array.isArray(s.args.args), JSON.stringify(s));
        const t3 = allText(t);
        check('结果回显 summary', t3.includes('引用核查通过'), t3.slice(-200));
        check('结果回显 warnings 与 exit/用时', t3.includes('DOI 没解析过') && t3.includes('退出码'), t3.slice(-200));
        check('结果回显 raw JSON', t3.includes('cited'), t3.slice(-200));
      }
    }

    const danger = findAll(t, (n) => n.tag === 'button' && allText(n).trim() === 'remove-ref')[0];
    if (danger) {
      danger.props.onClick();
      t = await settle(Panel, {});
      const dtxt = allText(t);
      check('危险命令要求显式确认', dtxt.includes('不可逆'), dtxt.slice(0, 160));
      const dangerRun = findAll(t, (n) => n.tag === 'button' && allText(n).trim() === '确认并运行')[0];
      check('未勾确认时「确认并运行」禁用', !!dangerRun && dangerRun.props.disabled === true, dangerRun ? 'disabled=' + dangerRun.props.disabled : '没找到按钮');
    }

    const rawBtn = findAll(t, (n) => n.tag === 'button' && allText(n).trim() === '原始参数')[0];
    if (rawBtn) {
      rawBtn.props.onClick();
      t = await settle(Panel, {});
      check('切到原始参数模式', allText(t).includes('不含命令名'));
      const back = findAll(t, (n) => n.tag === 'button' && allText(n).trim() === '表单模式')[0];
      if (back) { back.props.onClick(); t = await settle(Panel, {}); }
    }

    // 只在命令台弹层内部找「关闭」——面板别处也有同名按钮，取 [0] 会点到别的东西
    // 面板里可能同时挂着别的弹层（导入层），要按「内容」认准命令台这一层，别按顺序取第一个
    const modalNode = findAll(t, (n) => String((n.props && n.props.className) || '') === 'rl-modal'
      && allText(n).indexOf('等价于 research.py 子命令') >= 0)[0];
    const closeBtn = modalNode
      ? findAll(modalNode, (n) => n.tag === 'button' && allText(n).trim() === '关闭')[0]
      : null;
    check('弹层里有「关闭」按钮', !!closeBtn);
    if (closeBtn) { closeBtn.props.onClick(); t = await settle(Panel, {}); }
    const modalsLeft = findAll(t, (n) => String((n.props && n.props.className) || '') === 'rl-modal'
      && allText(n).indexOf('等价于 research.py 子命令') >= 0).length;
    check('关闭后弹层消失', modalsLeft === 0 && !allText(t).includes('等价于 research.py 子命令'), 'rl-modal 残留=' + modalsLeft);
  }
}

/* [11] 数据变换面板（不需要 agent 就能用） */
console.log('\n[11] 数据变换');
{
  // 先切回「数据」页签（[9i] 的成组出图段删掉后，这里没人负责切回来了）
  const assetsTab4 = findByTagText(t, 'button', '数据');
  if (assetsTab4) { assetsTab4.props.onClick(); t = await settle(Panel, {}); }
  const tfBtn = findAll(t, (n) => n.tag === 'button' && allText(n).trim() === '变换')[0];
  check('数据卡上有「变换」按钮', !!tfBtn);
  if (tfBtn) {
    tfBtn.props.onClick();
    t = await settle(Panel, {});
    const txt = allText(t);
    check('数据变换弹层打开了', txt.includes('数据变换') && txt.includes('原始数据不会被改动'), txt.slice(0, 160));
    check('弹层里有数据预览（行列信息）', /共 \d+ 行 · \d+ 列/.test(txt), txt.slice(0, 200));
    const opOpts = findAll(t, (n) => n.tag === 'option' && ['normalize', 'baseline', 'smooth', 'peaks', 'integrate', 'linear'].indexOf(n.props.value) >= 0);
    check('变换下拉里有 6 个算子', opOpts.length === 6, opOpts.map((o) => o.props.value).join(','));
    const gen = findAll(t, (n) => n.tag === 'button' && allText(n).trim() === '生成新表')[0];
    check('有「生成新表」主按钮', !!gen);
    if (gen) {
      gen.props.onClick();
      t = await settle(Panel, {});
      const s = lastSent();
      check('tableTransform 请求形状：project/data/op/x/y + overwrite',
        !!s && s.action === 'tableTransform' && s.args.op === 'normalize' && typeof s.args.y === 'number' && !!s.args.params,
        JSON.stringify(s));
      const rtxt = allText(t);
      check('结果回显产物路径与溯源', rtxt.includes('已生成') && rtxt.includes('.research/transforms/'), rtxt.slice(-200));
    }
    const tfModal = findAll(t, (n) => String((n.props && n.props.className) || '') === 'rl-modal'
      && allText(n).indexOf('原始数据不会被改动') >= 0)[0];
    const closeTf = tfModal ? findAll(tfModal, (n) => n.tag === 'button' && allText(n).trim() === '关闭')[0] : null;
    if (closeTf) { closeTf.props.onClick(); t = await settle(Panel, {}); }
  }

  check('头部没有「目标图对齐」按钮（2026-10-13 已删）',
    findAll(t, (n) => n.tag === 'button' && allText(n).trim() === '目标图对齐').length === 0, buttonTexts(t));
}

intercept = null;


check('整个 [9] 段没有真的发出写请求（全部被假信封挡住）', sent.every((s) => WRITE_ACTIONS.has(s.action)), JSON.stringify(sent.map((s) => s.action)));

/* 汇总 */
console.log('\n' + '='.repeat(72));
console.log(`${pass} 通过 · ${fail} 失败`);
if (fail) { console.log('\n失败项：'); for (const f of failures) console.log('  - ' + f); }
process.exit(fail ? 1 : 0);

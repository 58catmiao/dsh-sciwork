#!/usr/bin/env node
/**
 * 科研模式 · 真联调自检（真面板 ↔ 真动作层 ↔ 真写盘）
 * ===========================================================================
 * 为什么要有这一条（0.4.4 起进门禁）：
 *   `scripts/selftest-client.mjs` 与 `scripts/e2e-panel.mjs` 里的 `connection.rpc.call`
 *   是**假夹具**：它们只回答「点了有没有发出 RPC」，既不核对参数，也不核对返回值形状。
 *   于是这些真缺陷在门禁下全绿、到用户手里却是「点了没反应」：
 *     · 0.4.0 的「确认漏传 actionId」；
 *     · 0.4.3 的「图卡存进笔记 → 确认时把 click 事件当参数发给宿主」（未知参数：preventDefault）；
 *     · 0.4.3 的「问模型 → 模型一条 text-delta 都没给 → 气泡一片空白」。
 *   这一条把假夹具换成**真的**：真的 `lib/index.js` 端点（connection.fetch.register 抓精确路由）、
 *   真的 `lib/actions.js` 入口、真的 dispatch / 令牌 / 回执 / 写盘，只有 DSH 宿主的 llm
 *   服务是可控假件（它本来就在宿主外面，且要能造「空流」「卡住」「异步流」这几种病态）。
 *
 * 判定口径：每一格都是「界面上能看见的结果」或「盘上真的多/少了一个文件」，
 * 断言对象是用户能验证的东西，不是「内部函数被调用过」。
 *
 * 覆盖：
 *   T1  notes.save 动作层真写盘            T2  笔记面板：新建 → 保存 → 计划 → 确认
 *   T3  图卡问模型（走宿主 llm.chat）      T4  图卡问模型（走渲染进程流式）
 *   T5  流是异步 Promise（DSH 真实签名）   T6  图卡「存进笔记」确认
 *   T7  空流：不许一片空白                T8  流卡住：超时兜底，别永远「等模型…」
 *   T9  全动作冒烟（每个动作都给出结构化回复，不许 internal 崩）
 *
 * 用法：
 *   node scripts/selftest-live.mjs                 临时真库 + 假 llm（默认可写，安全）
 *   node scripts/selftest-live.mjs --real <库根>   只读巡检一个真库（一个字节都不写）
 *   node scripts/selftest-live.mjs --help
 *
 * 退出码：0 = 全通过；1 = 有失败；2 = 环境/参数问题。
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = join(HERE, 'lib', 'client.js');

const ARGV = process.argv.slice(2);
if (ARGV.includes('--help') || ARGV.includes('-h')) {
  console.log('用法：node scripts/selftest-live.mjs [--real <库根>]');
  console.log('  （不带参数）临时真库 + 假 llm：会把笔记真写进临时目录，跑完删掉。');
  console.log('  --real <库根>  只跑读动作巡检指定库，不写任何文件。');
  process.exit(0);
}
const REAL_IDX = ARGV.indexOf('--real');
const REAL_ROOT = REAL_IDX >= 0 ? String(ARGV[REAL_IDX + 1] || '').trim() : '';
const REAL_MODE = Boolean(REAL_ROOT);
if (REAL_IDX >= 0 && !REAL_ROOT) {
  console.error('✗ --real 后面要跟库根路径');
  process.exit(2);
}
if (REAL_MODE && !existsSync(REAL_ROOT)) {
  console.error('✗ 库根不存在：' + REAL_ROOT);
  process.exit(2);
}

/* ---------------------------------------------------------------- 库根 */
/** 临时真库：形状和真库一样（projects/refs/journals/submissions/.research），只是 mkdtemp 出来的。 */
let LIB = '';
if (REAL_MODE) {
  LIB = resolve(REAL_ROOT);
} else {
  LIB = mkdtempSync(join(tmpdir(), 'sciwork-live-'));
  for (const d of ['projects', 'refs', 'journals', 'submissions', '.research']) mkdirSync(join(LIB, d), { recursive: true });
  mkdirSync(join(LIB, 'projects', 'demo', 'notes'), { recursive: true });
  writeFileSync(join(LIB, 'projects', 'demo', 'project.json'), JSON.stringify({ slug: 'demo', title: 'Demo' }, null, 2));
}
// 必须在 import 动作层之前设好：lib/settings.js 在模块初始化时就把库根定下来了。
process.env.SCIWORK_LIBRARY = LIB;

/* ---------------------------------------------------------------- 微缩 React */
/* 和 scripts/e2e-panel.mjs 用的是同一套：hook 按组件实例分桶，函数组件直接调用后再渲染。 */
const hookStores = new Map();
let rendering = null;
let cursor = 0;
let dirty = false;
let pendingEffects = [];
const storeOf = (inst) => {
  let s = hookStores.get(inst);
  if (!s) { s = { states: [], deps: [] }; hookStores.set(inst, s); }
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
const effectErrors = [];
function renderNode(node, path = '') {
  if (node === null || node === undefined || typeof node === 'boolean') return null;
  if (typeof node === 'string' || typeof node === 'number') return { text: String(node) };
  if (Array.isArray(node)) return node.map((c, i) => renderNode(c, path + '[' + i + ']')).filter(Boolean);
  if (typeof node.type === 'function') {
    const fn = node.type;
    const inst = (fn.name || 'Anon') + (node.props && node.props.key !== undefined ? '#' + node.props.key : '@' + path);
    storeOf(inst);
    const pr = rendering, pc = cursor;
    rendering = inst; cursor = 0;
    let out;
    try { out = fn(node.props); } finally { rendering = pr; cursor = pc; }
    return renderNode(out, path + '>' + (fn.name || 'Anon'));
  }
  return { tag: node.type, props: node.props || {}, children: node.children.map((c, i) => renderNode(c, path + '/' + i)).filter(Boolean) };
}
async function settle(rootType, props, rounds = 6, wait = 30) {
  let tree = null;
  for (let r = 0; r < rounds; r += 1) {
    dirty = false; pendingEffects = [];
    tree = renderNode(React.createElement(rootType, props));
    for (const fn of pendingEffects.slice()) { try { fn(); } catch (e) { effectErrors.push(String((e && e.message) || e)); } }
    await new Promise((res) => setTimeout(res, wait));
    if (!dirty) break;
  }
  return tree;
}
function walk(node, fn) { if (!node) return; fn(node); if (node.children) node.children.forEach((c) => walk(c, fn)); }
function allText(node) {
  const out = [];
  walk(node, (n) => {
    if (n.text !== undefined) out.push(n.text);
    else if (n.props && typeof n.props.children === 'string') out.push(n.props.children);
  });
  return out.join(' ');
}
function* nodes(tree) {
  if (!tree) return;
  if (Array.isArray(tree)) { for (const t of tree) yield* nodes(t); return; }
  yield tree;
  if (tree.children) for (const c of tree.children) yield* nodes(c);
}
const byText = (tree, text, tag) => {
  for (const n of nodes(tree)) {
    if (tag && n.tag !== tag) continue;
    if (!n.props || typeof n.props.onClick !== 'function') continue;
    if (allText(n).replace(/\s+/g, ' ').trim() === text) return n;
  }
  return null;
};
const byClass = (tree, cls) => {
  for (const n of nodes(tree)) {
    if (n.props && typeof n.props.className === 'string' && n.props.className.split(/\s+/).indexOf(cls) >= 0) return n;
  }
  return null;
};
const byTag = (tree, tag) => { const out = []; for (const n of nodes(tree)) { if (n.tag === tag) out.push(n); } return out; };
const click = (n) => {
  if (!n) throw new Error('找不到要点的元素');
  n.props.onClick({ preventDefault() {}, stopPropagation() {}, target: {}, currentTarget: {} });
};

/* ---------------------------------------------------------------- 浏览器桩 */
const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
let captured = null;
define('window', {
  __ModuleLoader__: { load(spec) { captured = spec; } },
  addEventListener() {}, removeEventListener() {},
});
define('document', {
  createElement: () => ({ setAttribute() {}, textContent: '' }),
  head: { appendChild() {} },
  documentElement: { appendChild() {} },
});
define('navigator', { clipboard: { writeText: () => Promise.resolve() } });
const lsStore = new Map();
define('localStorage', {
  getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => { lsStore.set(k, String(v)); },
  removeItem: (k) => { lsStore.delete(k); },
  clear: () => lsStore.clear(),
  get length() { return lsStore.size; },
  key: (i) => Array.from(lsStore.keys())[i] ?? null,
});
lsStore.set('research-panel-setup:welcome:local', '1');
lsStore.set('research-panel-setup:ui.version:local', 'v2');

/* ---------------------------------------------------------------- 假 llm 服务（照 DSH 真实契约） */
/*
 * 契约来自 cordis_inspect_query 的 host/Service `llm`：
 *   stream(options: GenerateOptions): AsyncIterable<StreamChunk>   ← 同步返回可迭代对象
 *   StreamChunk = block-start | text-delta | reasoning-delta | tool-call-delta | block-end | usage | finish
 * 关键：**没有 `{ type:'error' }`**。适配器失败会变成终态 `finish{ reason:{ kind:'error', failure } }`，
 * 一条 text-delta 都不给。0.4.4 只认 text-delta，于是「失败」被当成「空回答」——用户看到的就是
 * 「问完模型没反应」。这里的病态模式就是照这个形状造的。
 */
const llmCalls = [];
let llmMode = 'text';
const fakeLlm = {
  listConfigurableProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }],
  listModels: () => [{ provider: 'deepseek', id: 'deepseek-flash', name: 'Flash', vision: true }],
  async *gen() {
    yield { type: 'block-start', index: 0, blockType: 'text' };
    if (llmMode === 'text') {
      yield { type: 'text-delta', index: 0, text: '这块的峰' };
      yield { type: 'text-delta', index: 0, text: '和标尺对不上。' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '这块的峰和标尺对不上。' } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    } else if (llmMode === 'empty') {
      /* 流开了，一条 text-delta 都没有，但正常结束 */
      yield { type: 'finish', reason: { kind: 'stop' } };
    } else if (llmMode === 'error') {
      /* DSH 的失败形态：没有 text-delta，只有终态 finish */
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'invalid api key', code: 'auth', status: 401 } } };
    } else if (llmMode === 'hang') {
      await new Promise(() => {});
    } else if (llmMode === 'reasoning-only') {
      yield { type: 'reasoning-delta', index: 0, text: '想了很久' };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  },
  stream(req) {
    llmCalls.push(req);
    return fakeLlm.gen();
  },
};

/* 假附件服务：图片内容块只能引用 saveImage() 生成的 ImageAttachmentRef。 */
const imageSaves = [];
const fakeAttachments = {
  imageLimits: {
    maxImageBytes: 2 * 1024 * 1024,
    maxImagesPerMessage: 4,
    maxMessageImageBytes: 8 * 1024 * 1024,
    maxImagePixels: 40000000,
    maxImageDimension: 8000,
    mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  },
  async saveImage(input) {
    imageSaves.push(input);
    return {
      attachmentId: 'att_' + imageSaves.length,
      mediaType: input.mediaType,
      bytes: input.data.length,
      width: 1,
      height: 1,
      name: input.name,
    };
  },
};

/* ---------------------------------------------------------------- 真宿主：lib/index.js */
const routes = [];
const services = { llm: fakeLlm, attachments: fakeAttachments };
function makeHostCtx() {
  return {
    logger: { info() {}, warn() {}, error() {} },
    get: (n) => services[n],
    inject(names, cb) {
      const params = { get: (n) => services[n] };
      for (const n of names) params[n] = services[n];
      cb(params);
      return () => {};
    },
    effect(fn) { try { fn(); } catch (e) { effectErrors.push('effect: ' + e.message); } return () => {}; },
  };
}

let host = null;
let route = null;
async function mountHost() {
  host = await import(pathToFileURL(join(HERE, 'lib', 'index.js')).href);
  services.connection = { fetch: { register(r) { routes.push(r); return () => {}; } } };
  host.apply(makeHostCtx());
  route = routes.find((r) => r.path === host.ROUTE_PATH);
  if (!route) { console.error('✗ 端点没注册（lib/index.js 的 ROUTE_PATH 没抓到这个路径）'); process.exit(2); }
}
await mountHost();

/* ---------------------------------------------------------------- 面板侧 connection（rpc.call → 真路由） */
let rpcSeq = 0;
const rpcLog = [];
const conn = {
  rpc: {
    call: async (channel, endpoint, payload) => {
      rpcSeq += 1;
      const rpcId = 'r' + rpcSeq;
      rpcLog.push({ channel, endpoint, action: payload && payload.action });
      // 信封不是凑数的：carry(rpcId, …) 要求 type/method/rpcId 对得上，这里照真宿主的形状造。
      const body = { type: 'client-request', rpcId, method: endpoint, payload };
      const res = await route.fetch({ json: async () => body });
      const envelope = await res.json();
      if (!envelope || envelope.type !== 'server-response' || envelope.rpcId !== rpcId) {
        throw new Error('宿主信封不对：' + JSON.stringify(envelope).slice(0, 200));
      }
      return envelope.result;
    },
  },
};

/** 面板内部的 call = hostCall(ctx, …)：判 ok 后拆 value，保持与 lib/client.js:352 完全一致的契约。 */
async function hostCall(action, args) {
  const res = await conn.rpc.call('/api', 'research/call', { action, args });
  if (!res || res.ok !== true) {
    const e = res && res.error;
    const err = new Error((e && e.message) || ('宿主调用失败：' + action));
    if (e && e.code) err.code = e.code;
    throw err;
  }
  return res.value;
}

/* ---------------------------------------------------------------- 断言小工具 */
let pass = 0;
let fail = 0;
const skips = [];
function ok(name) { pass += 1; console.log('  PASS ' + name); }
function bad(name, detail) { fail += 1; console.log('  FAIL ' + name + (detail ? '  —— ' + detail : '')); }
const check = (name, cond, detail) => (cond ? ok(name) : bad(name, detail || ''));
const skip = (name, why) => { skips.push(name); console.log('  SKIP ' + name + ' —— ' + why); };
const noteFiles = () => {
  const d = join(LIB, 'projects', 'demo', 'notes');
  return existsSync(d) ? readdirSync(d).sort() : [];
};
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB8gEDXwZ0yAAAAABJRU5ErkJggg==';
const figOf = (id) => ({ figureId: id, graph: 'Graph' + id.slice(-1), caption: '测试图', file: 'a.png', sources: [], journal: '' });

/* ---------------------------------------------------------------- 载入真面板 */
const registrations = [];
const slots = { inject(name, cb) { cb(); return () => {}; }, register(spec, comp) { registrations.push({ spec, comp }); return () => {}; } };
const panelCtx = {
  get: (n) => (n === 'slots' ? slots : n === 'connection' ? conn : (n === 'llm' ? services.llm : undefined)),
  effect(fn) { fn(); },
  inject(names, cb) { cb({}); return () => {}; },
};
const ctxNoLlm = { get: (n) => (n === 'connection' ? conn : undefined) };

let NotesPanel = null;
let FigureChat = null;
if (!REAL_MODE) {
  await import(pathToFileURL(CLIENT).href);
  const spec = captured;
  const mod = spec.factory((name) => { if (name === 'react') return React; throw new Error('未知模块 ' + name); });
  mod.apply(panelCtx);
  NotesPanel = mod.__test.NotesPanel;
  FigureChat = mod.__test.FigureChat;
  if (!NotesPanel || !FigureChat) { console.error('✗ lib/client.js 没导出 __test.NotesPanel / __test.FigureChat'); process.exit(2); }
}

console.log(REAL_MODE ? '真库（只读）：' + LIB : '临时库：' + LIB);

/* ================================================================ 只读巡检：真库 */
if (REAL_MODE) {
  console.log('\n[R1] 读动作真库巡检（一个字节都不写）');
  const snap = await hostCall('library.snapshot').catch((e) => ({ error: String(e.message || e) }));
  check('library.snapshot 可读', !snap || !snap.error, snap && snap.error);
  const projects = (snap && snap.projects) || [];
  check('快照给出课题列表', Array.isArray(projects), JSON.stringify(snap).slice(0, 200));
  let first = null;
  for (const p of projects.slice(0, 3)) {
    if (!first) first = p.slug;
    const notes = await hostCall('notes.list', { project: p.slug }).catch((e) => ({ error: String(e.message || e) }));
    check('notes.list(' + p.slug + ') 可读', notes && !notes.error, notes && notes.error);
  }
  if (first) {
    const proj = await hostCall('project.get', { project: first }).catch((e) => ({ error: String(e.message || e) }));
    check('project.get(' + first + ') 可读', proj && !proj.error, proj && proj.error);
  } else {
    skip('project.get', '真库里没有课题');
  }
  const audit = await hostCall('library.audit', {}).catch((e) => ({ error: String(e.message || e) }));
  check('library.audit 可读', audit && !audit.error, audit && audit.error);
  const cat = await hostCall('action.catalog');
  check('action.catalog 可读', Array.isArray((cat && cat.actions) || []), JSON.stringify(cat).slice(0, 160));
  finish();
}

/* ================================================================ T1 动作层真写盘 */
console.log('\n[T1] notes.save：动作层计划 → 确认 → 真落地');
{
  const params = { project: 'demo', text: '# 一\n\n- a' };
  const plan = await hostCall('action.plan', { actionId: 'notes.save', params });
  check('plan 返回 confirmRequired', plan && plan.confirmRequired === true, JSON.stringify(plan).slice(0, 200));
  check('plan 带 actionId/planId/token', !!(plan && plan.actionId && plan.planId && plan.token), JSON.stringify(plan).slice(0, 200));
  const out = await hostCall('action.confirm', { actionId: 'notes.save', planId: plan.planId, token: plan.token, params });
  check('confirm 返回笔记名', !!(out && out.value && out.value.name), JSON.stringify(out).slice(0, 200));
  check('文件真落地', noteFiles().length === 1, JSON.stringify(noteFiles()));
}

/* ================================================================ T2 笔记面板 */
console.log('\n[T2] 笔记面板：新建 → 输入 → 保存 → 计划 → 确认');
{
  hookStores.clear(); lsStore.clear();
  const props = { call: hostCall, ctx: panelCtx, snap: { projects: [{ slug: 'demo', title: 'Demo' }] }, q: 'demo' };
  let tree = await settle(NotesPanel, props);
  check('挂载后读完笔记列表', !allText(tree).includes('读取中…'), allText(tree).slice(0, 120));
  click(byText(tree, '新建笔记', 'button'));
  tree = await settle(NotesPanel, props);
  const areas = byTag(tree, 'textarea');
  const ta = areas[areas.length - 1];
  check('出现编辑区', !!(ta && ta.props && ta.props.onChange), '没有 textarea');
  if (ta) ta.props.onChange({ target: { value: '# 面板写的一条\n\n- 通过真动作层' } });
  tree = await settle(NotesPanel, props);
  const saveBtn = byText(tree, '保存', 'button');
  check('「保存」可点', !!(saveBtn && saveBtn.props.disabled !== true), JSON.stringify(saveBtn && saveBtn.props.disabled));
  if (saveBtn) click(saveBtn);
  tree = await settle(NotesPanel, props);
  const hasModal = allText(tree).includes('确认写动作');
  check('出现计划弹窗', hasModal, '界面里没有「确认写动作」：' + allText(tree).slice(0, 160));
  if (hasModal) {
    const confirmBtn = byText(tree, '确认执行', 'button');
    check('弹窗里有「确认执行」', !!confirmBtn);
    if (confirmBtn) click(confirmBtn);
    tree = await settle(NotesPanel, props);
  }
  check('界面出现「已保存」', allText(tree).includes('已保存'), allText(tree).slice(0, 200));
  check('盘上多了一条笔记', noteFiles().length === 2, JSON.stringify(noteFiles()));
}

/* ================================================================ T3 图卡问模型（宿主 llm.chat） */
console.log('\n[T3] 图卡问模型：面板拿不到渲染进程 llm → 走宿主 llm.chat');
{
  hookStores.clear(); lsStore.clear();
  llmMode = 'text'; llmCalls.length = 0;
  const props = { ctx: ctxNoLlm, call: hostCall, project: 'demo', fig: figOf('figX'), img: PNG, zoom: false, onToggleZoom() {} };
  let tree = await settle(FigureChat, props);
  check('模型下拉有选项', allText(tree).includes('deepseek'), allText(tree).slice(0, 160));
  const areas = byTag(tree, 'textarea');
  const ta = areas[areas.length - 1];
  if (ta) ta.props.onChange({ target: { value: '这块峰对不对？' } });
  tree = await settle(FigureChat, props);
  const sendBtn = byText(tree, '问模型', 'button');
  check('「问模型」可点', !!(sendBtn && sendBtn.props.disabled !== true), JSON.stringify(sendBtn && sendBtn.props.disabled));
  if (sendBtn) click(sendBtn);
  tree = await settle(FigureChat, props, 12, 40);
  const txt = allText(tree);
  check('回答出现在对话里', txt.includes('这块的峰') || txt.includes('和标尺对不上'), txt.slice(0, 300));
  check('不再卡在「等模型…」', !txt.includes('等模型…'), txt.slice(0, 200));
  check('宿主 llm.chat 真被调用', llmCalls.length >= 1, 'llmCalls=' + llmCalls.length);
}

/* ================================================================ T4 宿主报错必须露出来 */
console.log('[T4] 模型调用失败：只有 finish(error)、没有 text-delta，界面必须露出真实原因');
{
  hookStores.clear(); lsStore.clear();
  llmMode = 'error'; llmCalls.length = 0;
  const props = { ctx: panelCtx, call: hostCall, project: 'demo', fig: figOf('figY'), img: PNG, zoom: false, onToggleZoom() {} };
  let tree = await settle(FigureChat, props);
  const areas = byTag(tree, 'textarea');
  const ta = areas[areas.length - 1];
  if (ta) ta.props.onChange({ target: { value: '失败问一句' } });
  tree = await settle(FigureChat, props);
  const sendBtn = byText(tree, '问模型', 'button');
  if (sendBtn) click(sendBtn);
  tree = await settle(FigureChat, props, 12, 40);
  const txt = allText(tree);
  check('失败原因出现在界面（invalid api key / 401）', txt.includes('invalid api key') || txt.includes('401'), txt.slice(0, 320));
  check('不是「一个字都没返回」这种笼统话', !txt.includes('一个字都没返回'), txt.slice(0, 320));
  check('明确写了「模型出错」', txt.includes('模型出错'), txt.slice(0, 320));
}

/* ================================================================ T5 带图提问（附件 + 内容块形状） */
console.log('[T5] 带图提问：图片先 saveImage() 登记，内容块是 {type:image, attachment}');
{
  hookStores.clear(); lsStore.clear();
  llmMode = 'text'; llmCalls.length = 0; imageSaves.length = 0;
  const props = { ctx: panelCtx, call: hostCall, project: 'demo', fig: figOf('figP'), img: PNG, zoom: false, onToggleZoom() {} };
  let tree = await settle(FigureChat, props);
  const areas = byTag(tree, 'textarea');
  const ta = areas[areas.length - 1];
  if (ta) ta.props.onChange({ target: { value: '带图问一句' } });
  tree = await settle(FigureChat, props);
  const sendBtn = byText(tree, '问模型', 'button');
  if (sendBtn) click(sendBtn);
  tree = await settle(FigureChat, props, 14, 40);
  const txt = allText(tree);
  check('带图提问也有回答', txt.includes('这块的峰'), txt.slice(0, 300));
  check('宿主 attachments.saveImage 被调用（整图 1 次）', imageSaves.length === 1, 'imageSaves=' + imageSaves.length);
  const last = llmCalls[llmCalls.length - 1];
  const content = last && last.messages && last.messages[0] && last.messages[0].content;
  const blocks = Array.isArray(content) ? content : [];
  const imgBlock = blocks.find((b) => b && b.type === 'image');
  check('内容块里有 image 块', Boolean(imgBlock), JSON.stringify(blocks).slice(0, 300));
  check('image 块用 attachment 引用（不是 base64 source）', Boolean(imgBlock && imgBlock.attachment && imgBlock.attachment.attachmentId) && !/source/.test(JSON.stringify(blocks)), JSON.stringify(imgBlock).slice(0, 300));
}

/* ================================================================ T6 图卡存进笔记 */
console.log('\n[T6] 图卡「存进笔记」→ 计划 → 确认（确认按钮不许把事件当参数）');
{
  hookStores.clear(); lsStore.clear();
  const fig = figOf('figZ');
  lsStore.set('research-panel-chat:figZ', JSON.stringify([{ q: '问', a: '答', at: new Date().toISOString() }]));
  const props = { ctx: panelCtx, call: hostCall, project: 'demo', fig, img: PNG, zoom: false, onToggleZoom() {} };
  let tree = await settle(FigureChat, props);
  const btn = byText(tree, '存进笔记', 'button');
  check('有「存进笔记」按钮', !!btn, allText(tree).slice(0, 200));
  if (btn) click(btn);
  tree = await settle(FigureChat, props);
  const hasModal = allText(tree).includes('确认写动作');
  check('出现计划弹窗', hasModal, allText(tree).slice(0, 200));
  if (hasModal) click(byText(tree, '确认执行', 'button'));
  tree = await settle(FigureChat, props);
  const txt = allText(tree);
  check('界面出现「已存进笔记」', txt.includes('已存进笔记'), txt.slice(0, 240));
  check('没有「未知参数 / 参数被改过」这类拒收', !txt.includes('未知参数') && !txt.includes('参数被改过'), txt.slice(0, 240));
  check('盘上又多一条', noteFiles().length === 3, JSON.stringify(noteFiles()));
}

/* ================================================================ T7 空流 */
console.log('\n[T7] 流开了但一个字都没给：界面必须有可见提示');
{
  hookStores.clear(); lsStore.clear();
  llmMode = 'empty'; llmCalls.length = 0;
  const props = { ctx: panelCtx, call: hostCall, project: 'demo', fig: figOf('figE'), img: PNG, zoom: false, onToggleZoom() {} };
  let tree = await settle(FigureChat, props);
  const areas = byTag(tree, 'textarea');
  const ta = areas[areas.length - 1];
  if (ta) ta.props.onChange({ target: { value: '空流问一句' } });
  tree = await settle(FigureChat, props);
  const sendBtn = byText(tree, '问模型', 'button');
  if (sendBtn) click(sendBtn);
  tree = await settle(FigureChat, props, 12, 40);
  const txt = allText(tree);
  const hinted = txt.includes('没有返回任何文字') || txt.includes('没拿到回答') || txt.includes('模型出错');
  check('空流给出人话提示（不是一片空白）', hinted, '界面里既没回答也没提示：' + txt.slice(0, 260));
}

/* ================================================================ T8 流卡住 */
console.log('\n[T8] 流卡住不动：超时兜底，不能永远「等模型…」');
{
  hookStores.clear(); lsStore.clear();
  llmMode = 'hang'; llmCalls.length = 0;
  // 测试钩子：宿主里这个全局不存在，默认 120 秒；这里压到 120 毫秒，门禁才跑得动。
  window.__sciworkChatTimeoutMs = 120;
  const props = { ctx: panelCtx, call: hostCall, project: 'demo', fig: figOf('figH'), img: PNG, zoom: false, onToggleZoom() {} };
  let tree = await settle(FigureChat, props);
  const areas = byTag(tree, 'textarea');
  const ta = areas[areas.length - 1];
  if (ta) ta.props.onChange({ target: { value: '卡住问一句' } });
  tree = await settle(FigureChat, props);
  const sendBtn = byText(tree, '问模型', 'button');
  if (sendBtn) click(sendBtn);
  // 超时是定时器给的：settle 会在「没有脏状态」时提前收工，所以先按住等过超时点。
  await new Promise((r) => setTimeout(r, 260));
  tree = await settle(FigureChat, props, 14, 60);
  const txt = allText(tree);
  check('超时后给出提示', txt.includes('等模型超过'), txt.slice(0, 260));
  check('按钮回到「问模型」（不再一直等）', !txt.includes('等模型…'), txt.slice(0, 200));
  delete window.__sciworkChatTimeoutMs;
}

/* ================================================================ T9 全动作冒烟 */
console.log('\n[T9] 全动作冒烟：每个动作都给出结构化回复（不许 internal 崩）');
{
  const cat = await hostCall('action.catalog');
  const actions = (cat && cat.actions) || [];
  check('action.catalog 给出动作表', actions.length > 20, 'actions=' + actions.length);
  // 这些动作会真发网络 / 真备份 / 真改本机，冒烟只到计划为止，或干脆跳过。
  const SKIP = new Set(['llm.chat', 'system.update_check', 'system.update_apply', 'system.restore', 'system.migrate', 'system.backup']);
  const internal = [];
  const weird = [];
  let ran = 0;
  for (const a of actions) {
    if (!a || !a.id) continue;
    if (SKIP.has(a.id)) { skips.push(a.id); continue; }
    const isWrite = a.effects && a.effects !== 'read' && a.confirm !== 'never';
    let res = null;
    try {
      res = isWrite
        ? await hostCall('action.plan', { actionId: a.id, params: {} })
        : await hostCall(a.id, {});
    } catch (e) {
      const code = e.code || '(无 code)';
      if (code === 'internal') internal.push(a.id + '：' + e.message);
      else ran += 1;
      continue;
    }
    ran += 1;
    if (isWrite && !(res && typeof res.confirmRequired === 'boolean')) weird.push(a.id + '：计划没有 confirmRequired');
  }
  check('每个动作都回了结构化结果（' + ran + ' 个）', ran > 30, '有效回复只有 ' + ran + ' 个');
  check('没有动作抛 internal', internal.length === 0, internal.join(' | '));
  check('写动作的计划形状一致', weird.length === 0, weird.join(' | '));
}

finish();

function finish() {
  if (effectErrors.length) console.log('\n渲染期异常：' + JSON.stringify(effectErrors.slice(0, 6)));
  console.log('');
  if (skips.length) console.log('跳过 ' + skips.length + ' 项：' + skips.slice(0, 12).join(', '));
  // 门禁（scripts/cycle.mjs）按这个口径数：`N 通过 · M 失败`
  console.log(pass + ' 通过 · ' + fail + ' 失败' + (skips.length ? ' · ' + skips.length + ' 跳过' : ''));
  if (!REAL_MODE && existsSync(LIB)) {
    // maxRetries/retryDelay：Windows 上刚写完的文件偶尔还被索引器占着，直接删会 EPERM，
    // 少一次重试就在系统临时目录里留一个空壳（0.4.4 收尾时发现的历史遗留）。
    try { rmSync(LIB, { recursive: true, force: true, maxRetries: 6, retryDelay: 80 }); } catch (e) { /* 临时目录删不掉不影响结论 */ }
  }
  process.exit(fail ? 1 : 0);
}

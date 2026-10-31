#!/usr/bin/env node
/**
 * 科研模式面板 · 端到端点击巡检（裸 node 运行：不需要浏览器、不需要 Harness、不连科研库）
 * ===========================================================================
 * 目的：把面板「点一遍」，回答一个问题——**每个可点的东西，点下去到底有没有反应**。
 * 以后加了新功能，只要 `--only <页签名>` 只跑那一页，就知道新按钮是不是死的。
 *
 * 干活方式（地基照抄 scripts/selftest-client.mjs，不改它）：
 *   1. 伪造 `window.__ModuleLoader__`，捕获 lib/client.js 的 bundle 注册；
 *   2. 微缩 React（createElement / useState / useRef / useMemo / useCallback / useEffect
 *      + 极简函数组件渲染器）让面板真的跑起来；
 *   3. 伪造 `ctx.get('slots')` / `ctx.get('connection')`；
 *   4. `connection.rpc.call` **全部**走本地夹具（`fixture()`），既不发网络、也不碰磁盘：
 *      —— 这是「只读派发」的保证：点「归档」「真删」「导出投稿包」都安全，
 *      它们只会在假宿主里换回一段假结果，绝不会写任何文件。
 *
 * 判定口径（一个元素算通过，满足任一条即可）：
 *   a) 点击后发出了 RPC（`action.plan` 的计划弹窗也算 —— 写动作本就该先出计划）；
 *   b) 点击后界面有可见变化（文字变了，或选中态/闪烁这类状态变了；指纹 = 文字 + 标签
 *      + class + data-* 属性，所以工作台「看课题」的 data-flash 也算有反应）。
 *   否则记为「死按钮」；点下去抛错、或异步链路抛未捕获异常，也记失败。
 *
 * 不点这几类（它们在点之前就不该有反应，收进来只会变成假失败）：
 *   - `disabled` 的按钮（当前阶段、数量为 0 的附件位、忙碌中的按钮）；
 *   - `data-active="1"` 的控件（当前页签、已展开的课题行、命令台已选中的命令）。
 *
 * 不点「确认执行」/「真删条目」/「确认并运行」：前两个在假宿主里不会真写，但按面板
 * 自己的口径它们需要用户先输入文件名或勾选危险确认，巡检只到弹窗为止。
 *
 * 每点一个元素都会**重新挂载**一次面板（清 hookStores + localStorage 基线），
 * 保证每个元素都是从「干净的这一页」开始点的，互不串味。所以 N 个元素 ≈ N 次挂载。
 *
 * 用法：
 *   node scripts/e2e-panel.mjs                 全量（11 个页签）
 *   node scripts/e2e-panel.mjs --only 图表      只测一页（也认英文 id：--only figures）
 *   node scripts/e2e-panel.mjs --list          只列页签与元素，一个都不点
 *   node scripts/e2e-panel.mjs --help
 *
 * 退出码：0 = 全通过（无失败）；1 = 有失败；2 = 环境/参数问题（如找不到 main 挂点）。
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, '..', 'lib', 'client.js');

/* ------------------------------------------------------------ 微缩 React */
/* 与 scripts/selftest-client.mjs 同一套语义（hook 按组件实例分桶）。 */

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

/** 每次挂载里被 effect 抛出来的异常（effect 抛错 = 真缺陷，不当场崩）。 */
const effectErrors = [];

function renderNode(node, path = '') {
  if (node === null || node === undefined || typeof node === 'boolean') return null;
  if (typeof node === 'string' || typeof node === 'number') return { text: String(node) };
  if (Array.isArray(node)) return node.map((c, i) => renderNode(c, path + '[' + i + ']')).filter(Boolean);
  if (typeof node.type === 'function') {
    const fn = node.type;
    // hook 按**组件实例**分桶（和真 React 一致）：有 key 用 key，否则用树里的位置。
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

async function settle(rootType, props, rounds = 5, wait = 40) {
  let tree = null;
  for (let r = 0; r < rounds; r += 1) {
    dirty = false; pendingEffects = [];
    tree = renderNode(React.createElement(rootType, props));
    const effects = pendingEffects.slice();
    for (const fn of effects) { try { fn(); } catch (e) { effectErrors.push(String((e && e.message) || e)); } }
    await new Promise((res) => setTimeout(res, wait));
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
// localStorage 桩：面板的新手引导 / 界面版本会读写 research-panel-setup:*:local
const lsStore = new Map();
define('localStorage', {
  getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => { lsStore.set(k, String(v)); },
  removeItem: (k) => { lsStore.delete(k); },
  clear: () => lsStore.clear(),
});

const LS_WELCOME = 'research-panel-setup:welcome:local';
const LS_VERSION = 'research-panel-setup:ui.version:local';

/** 每次挂载前的基线：跳过欢迎卡（它只在首启出现，不是页签）、固定 v2 界面。 */
function resetStorage() {
  lsStore.clear();
  lsStore.set(LS_WELCOME, '1');
  lsStore.set(LS_VERSION, 'v2');
}

/* ------------------------------------------------------------- 假库数据 */
/* 全部是夹具：点任何按钮都只跟这里换数据，科研库一个字节都不会动。 */

const ROOT = 'X:\\FakeLib';
const AT = '2026-10-21T10:00:00+08:00';

const FIG = {
  figureId: 'fig1', graph: 'Graph1', caption: '湿度 60% 下的 XRD 谱',
  sub: '', file: 'projects/demo-perovskite/figures/fig1.png',
  sidecar: 'projects/demo-perovskite/figures/fig1.json',
  fileExists: true, fileBytes: 20480,
  params: { width: 8, height: 6, unit: 'cm' },
  files: [
    { name: 'fig1.png', kind: 'png', role: 'main', bytes: 20480 },
    { name: 'fig1.pdf', kind: 'pdf', role: 'export', bytes: 4096 },
  ],
  createdAt: AT, warnings: [],
};
const DRAFT = {
  name: 'results.md', path: 'projects/demo-perovskite/drafts/results.md',
  sub: '', bytes: 1200, mtime: AT,
};
const DATA = {
  name: 'uvvis.csv', path: 'projects/demo-perovskite/data/uvvis.csv',
  sub: '', bytes: 900, mtime: AT,
};
const TABLE = {
  name: 'uvvis_smooth.csv', path: 'projects/demo-perovskite/data/uvvis_smooth.csv',
  sub: '', bytes: 640, mtime: AT,
};

const NEXT = {
  ready: false,
  todo: [{ action: 'figure.register', why: 'fig1 还没有侧车元数据' }],
  blockers: [{ why: '图缺溯源信息', hint: '先登记侧车再投稿' }],
};

const PROJECT = {
  slug: 'demo-perovskite',
  title: '钙钛矿稳定性演示',
  journal: 'nature',
  notes: '夹具课题',
  stage: 'figure',
  needsSchemaUpgrade: false,
  folders: { data: [''] },
  figures: [FIG],
  drafts: [DRAFT],
  datasets: [DATA],
  tables: [TABLE],
  opju: [],
  next: NEXT,
};

const SNAP = {
  ok: true,
  root: ROOT,
  readAt: AT,
  indexAt: AT,
  counts: { project: 1, figure: 1, draft: 1, dataset: 1, table: 1, ref: 1, journal: 1, submission: 1 },
  warnings: [],
  projects: [PROJECT],
  refs: [{
    key: 'zhang2023', title: 'Stability of perovskite solar cells',
    authors: ['Zhang, S.', 'Li, Y.'], year: 2023, container: 'Nature',
    volume: '615', pages: '100-106', doi: '10.1038/abc',
    verifiedBy: 'crossref', projects: ['demo-perovskite'], addedAt: AT,
  }],
  pdfs: [{ name: 'zhang2023.pdf', path: 'refs/pdf/zhang2023.pdf', bytes: 8192 }],
  journals: [{
    id: 'nature', name: 'Nature', nameZh: '自然', publisher: 'Springer Nature',
    confidence: 'high', language: 'en', verifiedAt: AT,
    homepage: 'https://www.nature.com/nature', note: '夹具档案',
    file: 'journals/nature.json', bytes: 1024,
  }],
  submissions: [{
    kind: 'submission', submissionId: 'sub1', name: 'sub1',
    path: 'submissions/sub1', journal: 'nature', journalName: 'Nature',
    project: 'demo-perovskite', status: 'under-review', title: 'ZT 薄膜的稳定性',
    eventCount: 2, bytes: 800, manuscripts: 1,
    nextAction: '写催稿信', nextActionDue: '2026-12-01',
    submittedAt: AT, lastEvent: { at: AT, status: 'under-review', note: '送审' },
  }],
};

const DETAIL = {
  project: {
    id: 'demo-perovskite', slug: 'demo-perovskite',
    title: '钙钛矿稳定性演示', stage: 'figure', journal: 'nature',
  },
  next: NEXT,
  receipts: [],
};

const CMDS = {
  commands: [
    { id: 'add-ref', title: '登记文献', desc: '往 refs/refs.json 加一条', kind: 'write', args: [] },
    { id: 'register-figure', title: '登记图表', desc: '把已经画好的图收进课题', kind: 'write', args: [] },
    { id: 'add-submission', title: '记一条投稿', desc: '写投稿台账', kind: 'write', args: [] },
    { id: 'doctor', title: '库体检', desc: '检查库结构与缺失文件', kind: 'read', args: [] },
    { id: 'reindex', title: '重建索引', desc: '扫磁盘重建快照', kind: 'read', args: [] },
  ],
  notes: [],
};

/** 假宿主返回值表：action → value（client.js 用 `res.ok / res.value` 信封）。 */
function fixture(action, args) {
  const a = args || {};
  switch (action) {
    case 'snapshot': return SNAP;
    case 'project.list': return { root: ROOT, projects: [PROJECT], counts: SNAP.counts, warnings: [], readAt: AT };
    case 'project.get': return DETAIL;

    case 'system.receipts': {
      const n = Math.max(1, Math.min(3, Number(a.limit) || 3));
      return {
        receipts: Array.from({ length: n }, (_, i) => ({
          id: 'r' + i, at: AT, startedAt: AT, action: 'project.stage.set',
          ok: true, wrote: ['projects/demo-perovskite/project.json'],
          note: '夹具回执 ' + (i + 1),
        })),
      };
    }

    case 'system.update_check':
      return {
        plugin: { version: '0.3.11' },
        remote: a.remote ? { version: '0.3.12' } : null,
        updateAvailable: Boolean(a.remote),
        canSelfUpdate: true,
        hint: '本地热更新（git pull --ff-only）',
        checkedAt: AT,
      };

    case 'library.cli_commands':
    case 'cliCommands':
      return CMDS;

    case 'action.plan':
      return {
        planId: 'p_test', token: 'tok_test', actionId: a.actionId || 'unknown',
        title: '夹具计划：' + (a.actionId || 'unknown'),
        summary: '参数已校验，令牌 5 分钟内一次性有效。',
        writes: ['projects/demo-perovskite/project.json'],
        warnings: [],
      };
    case 'action.confirm': {
      /*
       * 夹具必须像真动作一样**校验参数**：真 `action.confirm` 缺 actionId 直接 bad-request
       * （lib/actions/action.js:104）。以前这里回一句 `{summary}` 就放过，
       * 结果三条写动作路径（重命名 / 笔记保存 / 图卡存笔记）漏了 actionId，巡检照样全绿。
       */
      const miss = ['actionId', 'planId', 'token'].filter((k) => !a[k]);
      if (miss.length) throw new Error('action.confirm 缺参数：' + miss.join(', '));
      if (String(a.planId) !== 'p_test' || String(a.token) !== 'tok_test') {
        throw new Error('action.confirm 的 planId/token 对不上本夹具签发的计划');
      }
      return {
        value: { ok: true, project: 'demo-perovskite', name: '2026-11-01-1200-夹具笔记.md', path: 'projects/demo-perovskite/notes/夹具笔记.md', actionId: a.actionId },
        receipt: { receiptId: 'r_test', action: a.actionId, ok: true, at: AT },
      };
    }

    case 'readText':
      return { text: '# 结果\n\n湿度 60% 下晶格基本稳定。\n', bytes: 120, mtime: AT };
    case 'readBinary':
      return { mime: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wD/6Bb0AAAAAElFTkSuQmCC', bytes: 68 };
    case 'checkCitations':
      return {
        cited: ['zhang2023'], missing: [], unknown: [], known: 1,
        caveat: '只校验键在库内且带 DOI/URL，不证明内容支持这句。',
      };

    case 'tableColumns':
      return { delimiter: ',', columns: ['wl', 'absorbance'], rows: 2, hasHeader: true };
    case 'tablePreview':
      return {
        delimiter: ',', columns: ['wl', 'absorbance'], hasHeader: true, total: 2,
        rows: [{ wl: 400, absorbance: 0.12 }, { wl: 450, absorbance: 0.2 }],
      };
    case 'transformOps':
      // 真动作回的是 `{ ops: TRANSFORM_OPS }`，字段是 name/params/desc（lib/actions/library.js:304）。
      // 夹具以前给的是 `label`，面板下拉渲染 `o.name` 所以是空的——还被判成「点了有界面变化」。
      return {
        ops: [
          { id: 'smooth', name: '平滑', needs: ['y'], params: [{ name: 'mode', type: 'select', options: [['mean', '滑动平均']], def: 'mean' }], desc: '压噪' },
          { id: 'normalize', name: '归一化', needs: ['y'], params: [], desc: '统一量纲' },
          { id: 'baseline', name: '扣基线', needs: ['y'], params: [], desc: '扣掉背景' },
        ],
      };
    case 'tableTransform':
      return { summary: '已另存为新表', path: 'projects/demo-perovskite/data/uvvis_smooth.csv', warnings: [] };

    case 'archiveInfo':
      return {
        note: '归档 = 把文件移进 .research/archive/<时间戳>/，恢复就跑一次 reindex 回来。',
        archives: [{
          id: '20261021-150000', at: AT, reason: '图表页归档',
          remaining: 1, total: 2, readable: true,
          items: [
            { path: 'projects/demo-perovskite/figures/fig0.png', bytes: 1024, role: 'main' },
            { path: 'projects/demo-perovskite/figures/fig0.json', bytes: 256, role: 'sidecar' },
          ],
        }],
        removed: [{ id: '20261020-120000', reason: '图表页删除', items: [{ path: 'old.png' }] }],
      };
    case 'restore': return { summary: '已恢复 1 个文件（夹具）' };

    case 'checkJournal':
      return {
        journalName: 'Nature', journal: 'nature',
        counts: { pass: 2, warn: 1, fail: 0, na: 3 },
        checks: [
          { status: 'warn', label: '图注', detail: '少一条来源' },
          { status: 'pass', label: '字数', detail: '在范围内' },
        ],
        disclaimer: '体检只对照期刊档案，不证明内容正确。',
      };
    case 'exportPackage':
      return { files: 3, bytes: 40960, package: 'submissions/packages/sub1.zip' };

    case 'newDraft':
      return { summary: '已新建草稿（夹具）', path: 'projects/demo-perovskite/drafts/' + (a.name || 'untitled') + '.md' };
    case 'writeText': return { summary: '已保存（夹具，原文件已备份）' };
    case 'removeRef': return { summary: '已删条目 ' + (a.key || '') + '（夹具）' };
    case 'archive': return { summary: '已归档（夹具，可恢复）' };
    case 'remove': return { summary: '已真删（夹具）' };
    case 'runCli': return { summary: '夹具：命令跑完了', exitCode: 0, stdout: 'ok', stderr: '', warnings: [] };
    case 'importInfo':
      return { maxBytes: 33554432, maxFileMb: 32, note: '同名不覆盖；导入只复制。', targets: ['figures', 'drafts', 'assets', 'refs', 'journal', 'project', 'submission'] };
    case 'import': return { summary: '已导入 1 个文件（夹具）', items: [] };
    case 'fetchRefMeta':
      return { doi: a.doi || '10.1038/abc', title: 'Stability of perovskite solar cells', authors: ['Zhang, S.'], year: 2023, container: 'Nature', url: '' };

    default: return {};
  }
}

/* --------------------------------------------------------------- 假宿主 */

const rpcLog = [];
let rpcCalls = 0;

const conn = {
  rpc: {
    call: async (channel, endpoint, payload) => {
      rpcCalls += 1;
      const action = payload && payload.action;
      const args = (payload && payload.args) || {};
      rpcLog.push({ channel, endpoint, action, args });
      let value;
      try { value = fixture(action, args); } catch (e) { return { ok: false, error: '夹具抛错：' + String((e && e.message) || e) }; }
      return { ok: true, value };
    },
  },
};
const registrations = [];
const slots = {
  inject(name, cb) { cb(); return () => {}; },
  register(spec, comp) { registrations.push({ spec, comp }); return () => {}; },
};
const ctx = {
  get: (name) => (name === 'slots' ? slots : (name === 'connection' ? conn : undefined)),
  effect: (fn) => { fn(); },
};

/* --------------------------------------------------------- 树的小工具 */

const classOf = (node) => (node && node.props && typeof node.props.className === 'string' ? node.props.className : '');
const hasClass = (node, cls) => classOf(node).split(/\s+/).indexOf(cls) >= 0;

function findClassNode(node, cls) {
  let hit = null;
  walk(node, (n) => { if (!hit && hasClass(n, cls)) hit = n; });
  return hit;
}

/** 弹层遮罩（点空白关闭）不算「按钮」：它不是功能入口，点了只会关弹层。 */
const isBackdrop = (node) => hasClass(node, 'rl-wbmask') || hasClass(node, 'rl-modal');

/** 已经是「当前选中」的控件（当前页签、已展开的课题行、命令台已选中的命令）。 */
const isAlreadyActive = (node) => node && node.props && node.props['data-active'] === '1';

function labelOf(node) {
  const t = allText(node).replace(/\s+/g, ' ').trim();
  if (t) return t.length > 26 ? t.slice(0, 26) + '…' : t;
  const p = node.props || {};
  const alt = p['aria-label'] || p.title || '';
  if (alt) return '〔' + String(alt).slice(0, 24) + '〕';
  return '〔无文字 ' + (node.tag || '?') + '〕';
}

/**
 * 收集可点元素：`button` 或任何带 onClick 的节点（遮罩除外）。
 * `skipClasses` 里的类名整棵子树都不进（页签条、正文区）。
 * 已经是「当前选中」的控件（data-active="1"）默认不进：点它本来就不该有反应，
 * 收进来只会变成假失败。`--list` 用 skipActive:false 把它们也列出来（带标记）。
 */
function collectClickables(scopeNode, opts) {
  const o = opts || {};
  const skipClasses = o.skipClasses || [];
  const excludeLabels = o.excludeLabels || [];
  const out = [];
  const counter = new Map();
  const visit = (n) => {
    if (!n) return;
    if (skipClasses.some((c) => hasClass(n, c))) return;
    const cls = classOf(n);
    const onClick = n.props && n.props.onClick;
    const isBtn = n.tag === 'button';
    if (typeof onClick === 'function' && !isBackdrop(n) && (isBtn || o.anyOnClick !== false)) {
      const label = labelOf(n);
      const active = isAlreadyActive(n);
      if (!excludeLabels.includes(label) && !(active && o.skipActive !== false)) {
        const base = (n.tag || '?') + '|' + cls + '|' + label;
        const nth = counter.get(base) || 0;
        counter.set(base, nth + 1);
        out.push({
          node: n, label, tag: n.tag, cls, key: base + '#' + nth, active,
          disabled: n.props.disabled === true || n.props['aria-disabled'] === 'true',
        });
      }
    }
    if (n.children) n.children.forEach(visit);
  };
  visit(scopeNode);
  return out;
}

/**
 * 界面指纹：文字 + 结构（标签 / class / data-* 属性）。
 * 只看文字会漏掉「闪一下」「选中态切换」这类真有反馈的交互（例如工作台的
 * `data-flash`）；带上 data-* 又能抓住它们，同时不会把样式类名的噪声算进来。
 */
function fingerprint(node) {
  const parts = [];
  const visit = (n) => {
    if (!n) return;
    if (n.text !== undefined) { parts.push('T' + n.text); return; }
    const p = n.props || {};
    const bits = Object.keys(p)
      .filter((k) => k.indexOf('data-') === 0)
      .sort()
      .map((k) => k + '=' + String(p[k]))
      .join(',');
    parts.push((n.tag || '?') + '.' + String(p.className || '') + (bits ? '{' + bits + '}' : ''));
    if (n.children) n.children.forEach(visit);
  };
  visit(node);
  return parts.join('|');
}

/** 判断「界面有没有变」用的指纹（见 fingerprint：文字 + 结构）。 */
const digest = (tree) => fingerprint(tree);

const FAKE_EVENT = {
  type: 'click', target: null, currentTarget: null, nativeEvent: {},
  preventDefault() {}, stopPropagation() {}, persist() {},
};
const errMsg = (e) => String((e && e.message) || e || '未知错误');

/* ---------------------------------------------------------- 页签与范围 */
/*
 * `entry`  = 点哪个按钮进这一页（null = 默认就在这一页）
 * `scope`  = 收集范围：
 *            'body'  → 只看正文区（.rl-view），页签条/页头不重复计
 *            'workbench' → 工作台整块，但跳过页签条
 *            'shell' → 只看壳（页签条 + 页头 + 页脚），正文区不重复计
 *            'modal' / 'tour' → 只看弹层子树
 * `expect` = 打开后的确认字样
 */
const PAGES = [
  { name: '工作台', id: 'workbench', entry: null, scope: 'workbench', expect: '快速登记' },
  { name: '图表', id: 'figures', entry: '图表', scope: 'body', expect: 'fig1' },
  { name: '草稿', id: 'drafts', entry: '草稿', scope: 'body', expect: 'results.md' },
  // 0.4.0 新增：笔记（实验日志）。夹具里没有笔记文件，expect 取页头那句说明。
  { name: '笔记', id: 'notes', entry: '笔记', scope: 'body', expect: '笔记' },
  { name: '文献', id: 'refs', entry: '文献', scope: 'body', expect: 'zhang2023' },
  { name: '数据', id: 'assets', entry: '数据', scope: 'body', expect: 'uvvis.csv' },
  { name: '期刊档案', id: 'journals', entry: '期刊档案', scope: 'body', expect: 'Nature' },
  { name: '投稿', id: 'submissions', entry: '投稿', scope: 'body', expect: 'sub1' },
  { name: '归档', id: 'archive', entry: '归档', scope: 'body', expect: '20261021-150000' },
  { name: '列表面板', id: 'v1', entry: '列表面板', scope: 'shell', expect: '新建课题', excludeLabels: ['列表面板'] },
  { name: '命令台', id: 'console', entry: '命令台', scope: 'modal', expect: '关闭' },
  { name: '引导', id: 'tour', entry: '引导', scope: 'tour', expect: '下一步' },
];

function scopeOf(tree, page) {
  if (page.scope === 'workbench') return { node: tree, skipClasses: ['rl-tabs'] };
  if (page.scope === 'body') return { node: findClassNode(tree, 'rl-view') || tree, skipClasses: [] };
  if (page.scope === 'shell') return { node: tree, skipClasses: ['rl-view'] };
  if (page.scope === 'modal') return { node: findClassNode(tree, 'rl-modal') || findClassNode(tree, 'rl-wbmask') || null, skipClasses: [] };
  if (page.scope === 'tour') return { node: findClassNode(tree, 'rl-tour-layer') || null, skipClasses: [] };
  return { node: tree, skipClasses: [] };
}

function collectPage(tree, page, opts) {
  const s = scopeOf(tree, page);
  if (!s.node) return [];
  return collectClickables(s.node, Object.assign({
    skipClasses: s.skipClasses,
    excludeLabels: page.excludeLabels || [],
  }, opts || {}));
}

function findEntryButton(tree, label) {
  let hit = null;
  walk(tree, (n) => {
    if (hit || !n.props || typeof n.props.onClick !== 'function') return;
    if (n.tag !== 'button' && !hasClass(n, 'rl-tab')) return;
    if (allText(n).replace(/\s+/g, ' ').trim() === label) hit = n;
  });
  return hit;
}

/* ------------------------------------------------------------ 挂载 + 点击 */

let Panel = null;
const unhandled = [];
process.on('unhandledRejection', (e) => { unhandled.push(errMsg(e)); });
process.on('uncaughtException', (e) => { unhandled.push('uncaught: ' + errMsg(e)); });

async function openPage(page) {
  resetStorage();
  hookStores.clear();
  effectErrors.length = 0;
  rpcLog.length = 0;
  let tree = await settle(Panel, {}, 5, 40);
  if (page.entry) {
    const btn = findEntryButton(tree, page.entry);
    if (!btn) return { tree, error: '找不到入口按钮「' + page.entry + '」' };
    try { btn.props.onClick(FAKE_EVENT); } catch (e) { return { tree, error: '点入口「' + page.entry + '」抛错：' + errMsg(e) }; }
    tree = await settle(Panel, {}, 6, 40);
  }
  if (page.expect && !digest(tree).includes(page.expect)) {
    return { tree, error: '页签没打开（等不到「' + page.expect + '」）' };
  }
  return { tree };
}

function compactArgs(args) {
  if (!args || typeof args !== 'object') return '';
  const keys = Object.keys(args).slice(0, 3);
  if (!keys.length) return '';
  const body = keys.map((k) => {
    let v = args[k];
    if (typeof v === 'string' && v.length > 24) v = v.slice(0, 24) + '…';
    if (v && typeof v === 'object') v = Array.isArray(v) ? '[' + v.length + ']' : '{…}';
    return k + '=' + String(v);
  }).join(', ');
  return '(' + body + ')';
}

const uniq = (list) => Array.from(new Set(list));

/* ------------------------------------------------------------------ 报告 */

const dw = (s) => Array.from(String(s)).reduce((n, ch) => n + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1), 0);
const cut = (s, max) => {
  let out = '';
  let w = 0;
  for (const ch of String(s)) {
    const cw = dw(ch);
    if (w + cw > max) { return out + '…'; }
    out += ch; w += cw;
  }
  return out;
};
const pad = (s, width) => {
  const str = cut(String(s), width);
  return str + ' '.repeat(Math.max(0, width - dw(str)));
};

function printTable(rows) {
  const W = [14, 30, 20, 40];
  const head = ['页签', '元素文字', '结果', '触发的 action'];
  console.log('  ' + head.map((h, i) => pad(h, W[i])).join('') .replace(/\s+$/, ''));
  console.log('  ' + '-'.repeat(W.reduce((a, b) => a + b, 0)));
  for (const r of rows) {
    console.log('  ' + [r.page, r.label, r.result, r.action].map((v, i) => pad(v, W[i])).join('').replace(/\s+$/, ''));
  }
}

const usage = () => {
  console.log([
    '科研模式面板 · 端到端点击巡检',
    '',
    '用法：',
    '  node scripts/e2e-panel.mjs                 全量（11 个页签）',
    '  node scripts/e2e-panel.mjs --only <页签名>   只测一页（也认英文 id）',
    '  node scripts/e2e-panel.mjs --list          只列页签与元素，不点',
    '  node scripts/e2e-panel.mjs --help',
    '',
    '页签：' + PAGES.map((p) => p.name + '(' + p.id + ')').join(' / '),
    '',
    '退出码：0 全通过 / 1 有失败 / 2 环境或参数问题',
  ].join('\n'));
};

/* ------------------------------------------------------------------ main */

const argv = process.argv.slice(2);
let only = null;
let listOnly = false;
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--list') listOnly = true;
  else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
  else if (a === '--only') { only = argv[i + 1]; i += 1; }
  else if (a.startsWith('--only=')) only = a.slice('--only='.length);
  else { console.error('未知参数：' + a); usage(); process.exit(2); }
}

const pickPages = () => {
  if (!only) return PAGES;
  const key = String(only).trim().toLowerCase();
  const hit = PAGES.filter((p) => p.name === only || p.id.toLowerCase() === key || p.name.toLowerCase() === key);
  if (!hit.length) {
    console.error('没有这个页签：' + only);
    console.error('可选：' + PAGES.map((p) => p.name).join(' / '));
    process.exit(2);
  }
  return hit;
};

console.log('科研模式 · 面板端到端点击巡检');
console.log('='.repeat(72));
console.log('假宿主：所有 RPC 走本地夹具，不连科研库、不写任何文件');
console.log('客户端：' + CLIENT);

await import(pathToFileURL(CLIENT).href);
const spec = globalThis.__captured;
if (!spec || typeof spec.factory !== 'function') {
  console.error('✗ 没能捕获 bundle 注册（window.__ModuleLoader__.load 没被调用）');
  process.exit(2);
}
const clientExports = spec.factory((name) => {
  if (name === 'react') return React;
  throw new Error('平台基座没有这个模块：' + name);
});
try { clientExports.apply(ctx); } catch (e) {
  console.error('✗ exports.apply() 抛错：' + errMsg(e));
  process.exit(2);
}
const main = registrations.find((r) => r.spec && r.spec.name === 'main');
if (!main || typeof main.comp !== 'function') {
  console.error('✗ 没注册 main 挂点（面板主页面）');
  process.exit(2);
}
Panel = main.comp;

const pages = pickPages();
const rows = [];
let skipped = 0;
let skippedActive = 0;

if (listOnly) {
  let total = 0;
  for (const page of pages) {
    const opened = await openPage(page);
    if (opened.error) { console.log('\n[' + page.name + ']  ✗ ' + opened.error); continue; }
    const items = collectPage(opened.tree, page, { skipActive: false });
    console.log('\n[' + page.name + ']  ' + items.length + ' 个可点元素');
    items.forEach((it, i) => {
      const flags = [it.disabled ? 'disabled' : '', it.active ? '已是当前选中（不点）' : ''].filter(Boolean);
      console.log('  ' + String(i + 1).padStart(2) + '. ' + pad(it.label, 30) + ' <' + it.tag + ' class="' + (it.cls || '') + '">' + (flags.length ? '  · ' + flags.join(' / ') : ''));
    });
    total += items.length;
  }
  console.log('\n合计 ' + total + ' 个可点元素（--list 模式，什么都没点）');
  process.exit(0);
}

for (const page of pages) {
  const opened = await openPage(page);
  if (opened.error) {
    rows.push({ page: page.name, label: '（整页）', result: '✗ 页面问题', action: opened.error });
    console.log('\n[' + page.name + ']  ✗ ' + opened.error);
    continue;
  }
  const listing = collectPage(opened.tree, page);
  const actives = collectPage(opened.tree, page, { skipActive: false }).filter((x) => x.active);
  skippedActive += actives.length;
  console.log('\n[' + page.name + ']  收集到 ' + listing.length + ' 个可点元素'
    + (actives.length ? '（另 ' + actives.length + ' 个已是当前选中，不点）' : ''));
  if (!listing.length) {
    console.log('  （这一页没有可点元素：纯只读页）');
    continue;
  }

  for (let i = 0; i < listing.length; i += 1) {
    const base = listing[i];
    if (base.disabled) {
      skipped += 1;
      rows.push({ page: page.name, label: base.label, result: '· 跳过禁用', action: '' });
      continue;
    }

    // 每一项都重新挂载：保证从「干净的这一页」开始点，前一个点击的副作用不会串过来。
    const fresh = await openPage(page);
    if (fresh.error) { rows.push({ page: page.name, label: base.label, result: '✗ 页面问题', action: fresh.error }); continue; }
    const again = collectPage(fresh.tree, page);
    const target = again.find((x) => x.key === base.key) || again[i] || null;
    if (!target) { rows.push({ page: page.name, label: base.label, result: '· 跳过（本次没出现）', action: '' }); continue; }
    if (target.disabled) { skipped += 1; rows.push({ page: page.name, label: base.label, result: '· 跳过禁用', action: '' }); continue; }

    rpcLog.length = 0;
    effectErrors.length = 0;
    const unhandledBefore = unhandled.length;
    const before = digest(fresh.tree);

    let thrown = null;
    try { target.node.props.onClick(FAKE_EVENT); } catch (e) { thrown = errMsg(e); }
    const after = await settle(Panel, {}, 5, 40);

    const changed = digest(after) !== before;
    const actions = uniq(rpcLog.map((x) => x.action).filter(Boolean));
    const newUnhandled = unhandled.slice(unhandledBefore);
    const effErrs = effectErrors.slice();

    let result;
    let actionCell = actions.map((a) => {
      const call = rpcLog.find((x) => x.action === a);
      return a + compactArgs(call && call.args);
    }).join(' ');

    if (thrown) result = '✗ 点击抛错: ' + thrown;
    else if (newUnhandled.length) result = '✗ 异步抛错: ' + newUnhandled[0];
    else if (effErrs.length) result = '✗ effect 抛错: ' + effErrs[0];
    else if (actions.length) result = '✓ RPC';
    else if (changed) result = '✓ 界面变化';
    else result = '✗ 死按钮（无 RPC、文字没变）';

    rows.push({ page: page.name, label: base.label, result, action: actionCell });
  }
}

console.log('');
console.log('='.repeat(72));
printTable(rows);

const failed = rows.filter((r) => String(r.result).startsWith('✗'));
const passed = rows.filter((r) => String(r.result).startsWith('✓'));
const tested = rows.length - skipped;
const skipNote = [
  skipped ? skipped + ' 个 disabled' : '',
  skippedActive ? skippedActive + ' 个已是当前选中' : '',
].filter(Boolean).join('，');

console.log('');
// 末行按门禁（scripts/cycle.mjs）的计数口径再报一次：全量 82 通过 · 0 失败。
console.log(tested + ' 通过 · ' + failed.length + ' 失败' + (skipped ? ' · ' + skipped + ' 跳过' : ''));
console.log(tested + ' 个元素 · ' + failed.length + ' 失败' + (skipNote ? '（跳过 ' + skipNote + '）' : ''));
console.log('通过 ' + passed.length + ' 个（RPC ' + passed.filter((r) => r.result === '✓ RPC').length
  + ' · 界面变化 ' + passed.filter((r) => r.result === '✓ 界面变化').length + '）');

if (failed.length) {
  console.log('');
  console.log('✗ 失败明细（真缺陷就在这里，报告时带上页签 / 元素文字 / 现象）');
  failed.forEach((r) => {
    console.log('  · ' + r.page + ' / ' + r.label + ' —— ' + r.result + (r.action ? '（' + r.action + '）' : ''));
  });
  process.exit(1);
}

console.log('');
console.log('全部通过：每个可点元素都发出了 RPC，或者界面确实变了。');
process.exit(0);

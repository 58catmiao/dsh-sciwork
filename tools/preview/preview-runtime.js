/*
 * 科研库面板 · 浏览器预览运行时
 * ===========================================================================
 * 目的：把**真的** lib/client.js 挂进一个真 DOM 页面，用假宿主喂数据，然后
 *       让 chromium 截图、量几何、抓渲染异常。全程只读：不写库、不连 Harness。
 *
 * 地基是 scripts/e2e-panel.mjs 顶部那套微缩 React（hook 按**组件实例**分桶，
 * 语义照抄），唯一区别：renderNode 的产出从「假节点对象」换成真 DOM 节点，
 * 于是 getBoundingClientRect / 滚动 / elementFromPoint / 真 CSS 全都能用。
 *
 * 约定：
 *   - 页面地址带 ?scenario=<名字>，见文件末尾 SCENARIOS。
 *   - 挂载、等异步、动作、再等异步，全在 boot() 里串行做；`window.__preview`
 *     给外面（CDP）一个 ready / probe / errors 的读取口。
 *   - 假 rpc 按 action 分发；没实现的动作回 `{ok:false,error:...}`，面板会把它
 *     当成「预览没实现」显示出来，而不是静默拿到空对象。
 */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var UNITLESS = {
    lineHeight: 1, zIndex: 1, opacity: 1, fontWeight: 1, flex: 1, flexGrow: 1,
    flexShrink: 1, order: 1, zoom: 1, columnCount: 1, tabSize: 1,
  };
  var errors = [];
  var rpcLog = [];

  var errMsg = function (e) { return String((e && e.message) || e || '未知错误'); };
  var wait = function (ms) { return new Promise(function (res) { setTimeout(res, ms); }); };
  var norm = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); };

  /* ------------------------------------------------------------ 微缩 React */
  /* 与 scripts/e2e-panel.mjs:48-127 同一套语义：hook 存储按组件实例分桶。 */

  var hookStores = new Map();
  var rendering = null;
  var cursor = 0;
  var dirty = false;
  var pendingEffects = [];
  var settling = false;      // settle() 期间统一重渲染，setState 只标脏
  var renderQueued = false;

  function storeOf(inst) {
    var s = hookStores.get(inst);
    if (!s) { s = { states: [], deps: [] }; hookStores.set(inst, s); }
    return s;
  }
  function slot() { var s = storeOf(rendering); return { s: s, i: cursor++ }; }

  var React = {
    createElement: function (type, props) {
      var flat = [];
      var push = function (c) { if (Array.isArray(c)) c.forEach(push); else flat.push(c); };
      for (var i = 2; i < arguments.length; i += 1) push(arguments[i]);
      return { type: type, props: props || {}, children: flat };
    },
    useState: function (init) {
      var sl = slot(); var s = sl.s; var i = sl.i;
      if (!(i in s.states)) s.states[i] = typeof init === 'function' ? init() : init;
      var set = function (next) {
        var v = typeof next === 'function' ? next(s.states[i]) : next;
        if (Object.is(v, s.states[i])) return;
        s.states[i] = v;
        dirty = true;
        requestRender();
      };
      return [s.states[i], set];
    },
    useRef: function (init) {
      var sl = slot(); var s = sl.s;
      if (!(sl.i in s.states)) s.states[sl.i] = { current: init };
      return s.states[sl.i];
    },
    useMemo: function (fn, deps) {
      var sl = slot(); var s = sl.s; var i = sl.i; var d = s.deps[i];
      var same = d && deps && deps.length === d.length
        && deps.every(function (x, j) { return Object.is(x, d[j]); });
      if (!same) { s.deps[i] = deps; s.states[i] = fn(); }
      return s.states[i];
    },
    useCallback: function (fn, deps) { return React.useMemo(function () { return fn; }, deps); },
    useEffect: function (fn, deps) {
      var sl = slot(); var s = sl.s; var i = sl.i; var d = s.deps[i];
      var same = d && deps && deps.length === d.length
        && deps.every(function (x, j) { return Object.is(x, d[j]); });
      if (!same) { s.deps[i] = deps; pendingEffects.push(fn); }
    },
  };
  React.useLayoutEffect = React.useEffect;
  React.useDebugValue = function () {};

  /* ------------------------------------------------------ 假节点树 → 真 DOM */

  function applyStyle(el, st) {
    if (st == null) return;
    if (typeof st === 'string') { el.setAttribute('style', st); return; }
    Object.keys(st).forEach(function (k) {
      var v = st[k];
      if (v == null || v === '') return;
      if (k.indexOf('--') === 0) { el.style.setProperty(k, String(v)); return; }
      if (typeof v === 'number' && !UNITLESS[k]) v = v + 'px';
      try { el.style[k] = v; } catch (e) { /* 不认识的样式跳过 */ }
    });
  }

  var EVENT_ALIAS = { doubleclick: 'dblclick', doubletap: 'dblclick' };

  function addListener(el, name, fn) {
    if (typeof fn !== 'function') return;
    var key = name.toLowerCase();
    key = EVENT_ALIAS[key] || key;
    var wrapped = function (ev) {
      try { fn(ev); } catch (e) { errors.push('事件 ' + key + ' 抛错：' + errMsg(e)); }
    };
    // React 的 onChange ≈ 原生 input（<select> 上只有 change，两个都挂；重复触发同值 setState 无副作用）
    if (key === 'change') {
      el.addEventListener('input', wrapped);
      el.addEventListener('change', wrapped);
      return;
    }
    el.addEventListener(key, wrapped);
  }

  function setProp(el, k, v, isSvg) {
    if (v === undefined) return;
    if (v === null || v === false) {
      if (!isSvg && k in el) { try { el[k] = v; } catch (e) { /* 只读属性 */ } }
      el.removeAttribute(k);
      return;
    }
    if (v === true) {
      el.setAttribute(k, '');
      if (!isSvg && k in el) { try { el[k] = true; } catch (e) { /* 只读属性 */ } }
      return;
    }
    if (isSvg) { el.setAttribute(k, String(v)); return; }
    if (k.indexOf('data-') === 0 || k.indexOf('aria-') === 0 || k.indexOf(':') === 0) {
      el.setAttribute(k, String(v));
      return;
    }
    if (k in el) { try { el[k] = v; return; } catch (e) { /* 回退成属性 */ } }
    el.setAttribute(k, String(v));
  }

  function applyProps(el, props, isSvg) {
    var keys = Object.keys(props || {});
    for (var n = 0; n < keys.length; n += 1) {
      var k = keys[n];
      var v = props[k];
      if (k === 'children' || k === 'key' || k === 'ref' || k === 'value' || k === 'checked') continue;
      if (k === 'style') { applyStyle(el, v); continue; }
      if (k === 'dangerouslySetInnerHTML') {
        if (v && typeof v.__html === 'string') el.innerHTML = v.__html;
        continue;
      }
      if (k === 'className') { el.setAttribute('class', v == null ? '' : String(v)); continue; }
      if (/^on[A-Z]/.test(k)) { addListener(el, k.slice(2), v); continue; }
      if (k === 'htmlFor') { el.setAttribute('for', String(v)); continue; }
      setProp(el, k, v, isSvg);
    }
  }

  function setRef(ref, el) {
    if (!ref) return;
    if (typeof ref === 'function') { ref(el); return; }
    if (typeof ref === 'object') { ref.current = el; }
  }

  function applyValue(el, v) {
    var val = v == null ? '' : String(v);
    try { el.value = val; } catch (e) { /* 只读 */ }
  }

  function errorBox(fn, e) {
    var name = (fn && fn.name) || 'Anon';
    // 栈里第一帧通常正好指到 client.js 的出错行，审查报告要的就是它
    var where = '';
    if (e && e.stack) {
      var frames = String(e.stack).split('\n').slice(1, 4)
        .map(function (s) { return s.trim(); })
        .filter(function (s) { return s.indexOf('client.js') >= 0 || s.indexOf('preview-runtime.js') >= 0; });
      if (frames.length) where = ' @ ' + frames.join(' ← ');
    }
    errors.push('组件 ' + name + ' 渲染抛错：' + errMsg(e) + where);
    return {
      type: 'div', props: { className: 'rl-err', 'data-preview-error': name },
      children: ['预览里 ' + name + ' 渲染失败：' + errMsg(e) + where],
    };
  }

  function renderInto(node, path, parent, ns) {
    if (node === null || node === undefined || typeof node === 'boolean') return;
    if (typeof node === 'string' || typeof node === 'number') {
      parent.appendChild(document.createTextNode(String(node)));
      return;
    }
    if (typeof node === 'function') {
      renderInto(node(), path, parent, ns);
      return;
    }
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i += 1) renderInto(node[i], path + '[' + i + ']', parent, ns);
      return;
    }
    if (typeof node.type === 'function') {
      var fn = node.type;
      var key = (fn.name || 'Anon') + (node.props && node.props.key !== undefined ? '#' + node.props.key : '@' + path);
      storeOf(key);
      var prevRendering = rendering, prevCursor = cursor;
      rendering = key;
      cursor = 0;
      var out;
      try { out = fn(node.props || {}); }
      catch (e) { out = errorBox(fn, e); }
      finally { rendering = prevRendering; cursor = prevCursor; }
      renderInto(out, path + '>' + (fn.name || 'Anon'), parent, ns);
      return;
    }

    var tag = node.type;
    if (typeof tag !== 'string') {
      errors.push('预览不认识节点类型：' + String(tag));
      return;
    }
    var isSvg = ns || tag === 'svg';
    var el = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    var props = node.props || {};
    applyProps(el, props, isSvg);
    for (var c = 0; c < node.children.length; c += 1) {
      renderInto(node.children[c], path + '/' + c, el, isSvg);
    }
    if ('value' in props) applyValue(el, props.value);
    if ('checked' in props) { try { el.checked = Boolean(props.checked); } catch (e) { /* 非表单元素 */ } }
    if (props.ref) setRef(props.ref, el);
    parent.appendChild(el);
  }

  /* -------------------------------------------------------------- 渲染循环 */

  var rootEl = null;
  var RootComp = null;

  function requestRender() {
    if (settling || renderQueued) return;
    renderQueued = true;
    setTimeout(function () { renderQueued = false; if (!settling) renderPass(); }, 0);
  }

  function renderPass() {
    if (!rootEl || !RootComp) return;
    dirty = false;
    pendingEffects = [];
    var frag = document.createDocumentFragment();
    renderInto({ type: RootComp, props: {}, children: [] }, 'root', frag, false);
    while (rootEl.firstChild) rootEl.removeChild(rootEl.firstChild);
    rootEl.appendChild(frag);
    var effs = pendingEffects;
    pendingEffects = [];
    for (var i = 0; i < effs.length; i += 1) {
      try {
        var r = effs[i]();
        if (r && typeof r.then === 'function') {
          r.then(null, function (e) { errors.push('异步 effect 抛错：' + errMsg(e)); });
        }
      } catch (e) {
        errors.push('effect 抛错：' + errMsg(e));
      }
    }
  }

  /** 循环渲染到「两轮都没人再 setState」为止；effect 里的异步 rpc 靠等待窗口收敛。 */
  async function settle(opts) {
    var o = opts || {};
    var maxRounds = o.rounds || 40;
    var ms = o.wait || 25;
    settling = true;
    var rounds = 0;
    var stable = 0;
    for (rounds = 0; rounds < maxRounds; rounds += 1) {
      renderPass();
      await wait(ms);
      if (dirty) stable = 0;
      else {
        stable += 1;
        if (stable >= 2) break;
      }
    }
    return { rounds: rounds, stable: stable >= 2, dirty: dirty };
  }

  /* ------------------------------------------------------------- 假库数据 */
  /* 形状照 scripts/e2e-panel.mjs:176-419 的夹具抄；图件换成一张真的谱图 PNG，
     这样缩略图不是 1×1 像素的白点。 */

  var ROOT = 'X:\\FakeLib';
  var AT = '2026-10-21T10:00:00+08:00';
  var AT2 = '2026-10-28T16:40:00+08:00';

  var FIG = {
    figureId: 'fig1', graph: 'Graph1', caption: '湿度 60% 下的 XRD 谱',
    sub: '', file: 'projects/demo-perovskite/figures/fig1.png',
    sidecar: 'projects/demo-perovskite/figures/fig1.json',
    fileExists: true, fileBytes: 20480, fileMtime: AT,
    params: { width: 8, height: 6, unit: 'cm' },
    files: [
      { name: 'fig1.png', kind: 'png', role: 'main', bytes: 20480 },
      { name: 'fig1.pdf', kind: 'pdf', role: 'export', bytes: 4096 },
    ],
    createdAt: AT, warnings: [],
  };
  var DRAFT = {
    name: 'results.md', path: 'projects/demo-perovskite/drafts/results.md',
    sub: '', bytes: 2480, mtime: AT,
  };
  var DATA = {
    name: 'uvvis.csv', path: 'projects/demo-perovskite/data/uvvis.csv',
    sub: '', bytes: 900, mtime: AT,
  };
  var TABLE = {
    name: 'uvvis_smooth.csv', path: 'projects/demo-perovskite/data/uvvis_smooth.csv',
    sub: '', bytes: 640, mtime: AT,
  };

  var NEXT = {
    ready: false,
    todo: [{ action: 'figure.register', why: 'fig1 还没有侧车元数据' }],
    blockers: [{ why: '图缺溯源信息', hint: '先登记侧车再投稿' }],
  };

  var PROJECT = {
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


  /* 第二个课题：让工作台的左列不止一行，也让「课题页」跟首页看得出差别。 */
  var FIG2 = {
    figureId: 'fig2', graph: 'Graph2', caption: 'ZT 薄膜退火前后的电阻率',
    sub: '', file: 'projects/zt-thinfilm/figures/fig2.png',
    sidecar: 'projects/zt-thinfilm/figures/fig2.json',
    fileExists: true, fileBytes: 18432, fileMtime: AT,
    params: { width: 9, height: 7, unit: 'cm' },
    files: [{ name: 'fig2.png', kind: 'png', role: 'main', bytes: 18432 }],
    createdAt: AT, warnings: [],
  };
  var DRAFT2 = {
    name: 'manuscript.md', path: 'projects/zt-thinfilm/drafts/manuscript.md',
    sub: '', bytes: 5120, mtime: AT,
  };
  var NEXT2 = {
    ready: true,
    todo: [{ action: 'draft.write', why: 'manuscript.md 还缺讨论一节' }],
    blockers: [],
  };
  var PROJECT2 = {
    slug: 'zt-thinfilm',
    title: 'ZT 薄膜热稳定性',
    journal: 'nature',
    notes: '投稿窗口内',
    stage: 'draft',
    needsSchemaUpgrade: false,
    folders: { data: ['anneal'] },
    figures: [FIG2],
    drafts: [DRAFT2],
    datasets: [],
    tables: [],
    opju: [],
    next: NEXT2,
  };

  var DETAIL = {
    project: {
      id: 'demo-perovskite', slug: 'demo-perovskite',
      title: '钙钛矿稳定性演示', stage: 'figure', journal: 'nature',
    },
    next: NEXT,
    receipts: [],
  };
  var SNAP = {
    ok: true,
    root: ROOT,
    readAt: AT,
    indexAt: AT,
    counts: { project: 2, figure: 2, draft: 2, dataset: 1, table: 1, ref: 1, journal: 1, submission: 1 },
    warnings: [],
    projects: [PROJECT, PROJECT2],
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

  var CMDS = {
    commands: [
      { id: 'add-ref', title: '登记文献', desc: '往 refs/refs.json 加一条', kind: 'write', args: [] },
      { id: 'register-figure', title: '登记图表', desc: '把已经画好的图收进课题', kind: 'write', args: [] },
      { id: 'add-submission', title: '记一条投稿', desc: '写投稿台账', kind: 'write', args: [] },
      { id: 'doctor', title: '库体检', desc: '检查库结构与缺失文件', kind: 'read', args: [] },
      { id: 'reindex', title: '重建索引', desc: '扫磁盘重建快照', kind: 'read', args: [] },
    ],
    notes: [],
  };

  var NOTE_TEXT = [
    '# 钙钛矿湿度实验 · 10 月 28 日',
    '',
    '- 60% RH、25 ℃ 放 24 h，效率从 21.4% 掉到 19.7%（−8%）',
    '- 对照组（干燥柜）只掉 0.4%，所以主因是水汽不是温度',
    '- XRD 上 14.1° 的主峰右移 0.06°，说明晶格有轻微收缩',
    '',
    '明天：把 40% / 70% RH 两组补上，看是不是线性关系。',
  ].join('\n');

  var CHAT_TURNS = [
    {
      q: '这条 14.1° 的主峰和右边那条标尺对得上吗？',
      a: '主峰位置和标尺上的 (110) 面一致，偏差在半个像素以内。右边 28.4° 那条是 (220)，强度约为主峰的 18%，属于正常比例。',
      at: '2026-10-30T09:12:00+08:00',
    },
    {
      q: '60% 湿度那组的基线怎么是斜的？',
      a: '这是样品架的低角度散射，不是样品本身的信号。建议在 5°–12° 区段做一次线性扣基线，扣完再看主峰半高宽。',
      at: '2026-10-30T09:18:00+08:00',
    },
    {
      q: '主峰比上周那次宽了一点，是晶粒变小了吗？',
      a: '半高宽从 0.21° 涨到 0.27°，按谢乐公式对应晶粒从约 41 nm 降到 32 nm。不过仪器狭缝如果调过也会这样，先确认这两次的狭缝设置一致。',
      at: '2026-10-30T09:24:00+08:00',
    },
    {
      q: '图上这条竖线是我加的参考线，投稿时要去掉吗？',
      a: '要。参考线是给人看的，期刊图里不该出现；把峰位写成坐标轴刻度或图注里的数字更稳。',
      at: '2026-10-30T09:31:00+08:00',
    },
    {
      q: '如果换成灰度印刷，这两组曲线还能分开吗？',
      a: '现在这两条都是蓝色，只差明度，灰度印出来大概率糊在一起。建议一组实线一组虚线，或者一组加空心圆点标记 —— 别只靠颜色区分。',
      at: '2026-10-30T09:40:00+08:00',
    },
    {
      q: '那我把这两条改成实线 + 虚线，颜色都留深灰，可以吗？',
      a: '可以，而且更接近期刊的常见做法。记得在图注里补一句「实线为 60% RH，虚线为干燥对照」，读者不看颜色也能读懂。',
      at: '2026-10-30T09:47:00+08:00',
    },
  ];

  /** 夹具返回表：action → value（client 用 res.ok / res.value 信封）。 */
  function fixture(action, args) {
    var a = args || {};
    switch (action) {
      case 'snapshot': return SNAP;
      case 'project.list':
        return { root: ROOT, projects: [PROJECT, PROJECT2], counts: SNAP.counts, warnings: [], readAt: AT };
      case 'project.get': {
        var slug = a.project || 'demo-perovskite';
        var is2 = slug === 'zt-thinfilm';
        return {
          project: {
            id: slug, slug: slug,
            title: is2 ? 'ZT 薄膜热稳定性' : '钙钛矿稳定性演示',
            stage: is2 ? 'draft' : 'figure',
            journal: 'nature',
          },
          next: is2 ? NEXT2 : NEXT,
          receipts: [],
        };
      }

      case 'system.receipts': {
        var n = Math.max(1, Math.min(3, Number(a.limit) || 3));
        var out = [];
        for (var i = 0; i < n; i += 1) {
          out.push({
            id: 'r' + i, at: AT, startedAt: AT, action: 'project.stage.set',
            ok: true, wrote: ['projects/demo-perovskite/project.json'],
            note: '夹具回执 ' + (i + 1),
          });
        }
        return { receipts: out };
      }

      case 'system.update_check':
        return {
          plugin: { version: '0.4.7' },
          remote: a.remote ? { version: '0.4.8' } : null,
          updateAvailable: Boolean(a.remote),
          canSelfUpdate: true,
          hint: a.remote ? '已经是最新版本。' : '还没比对远端：点「检查更新」去 GitHub 看一眼。',
          checkedAt: AT,
        };

      case 'library.cli_commands':
      case 'cliCommands':
        return CMDS;

      case 'action.plan':
        // 文案照抄宿主真 preview（lib/actions/notes.js:96-103），别自己编 ——
        // 编出来的假标题会让「界面审查」审到不存在的问题。
        return {
          planId: 'p_test', token: 'tok_test', actionId: a.actionId || 'unknown',
          title: a.actionId === 'notes.save' ? '写笔记' : '夹具计划：' + (a.actionId || 'unknown'),
          summary: a.actionId === 'notes.save'
            ? '写入 projects/demo-perovskite/notes/2026-11-01-1350-xrd-chat.md（1248 字节）。'
            : '参数已校验，令牌 5 分钟内一次性有效。',
          diff: [],
          writes: a.actionId === 'notes.save'
            ? ['projects/demo-perovskite/notes/2026-11-01-1350-xrd-chat.md']
            : ['projects/demo-perovskite/project.json'],
          warnings: [],
        };
      case 'action.confirm': {
        var miss = ['actionId', 'planId', 'token'].filter(function (k) { return !a[k]; });
        if (miss.length) throw new Error('action.confirm 缺参数：' + miss.join(', '));
        if (String(a.planId) !== 'p_test' || String(a.token) !== 'tok_test') {
          throw new Error('action.confirm 的 planId/token 对不上本夹具签发的计划');
        }
        return {
          value: {
            ok: true, project: 'demo-perovskite',
            name: '2026-11-01-1350-xrd-chat.md',
            path: 'projects/demo-perovskite/notes/2026-11-01-1350-xrd-chat.md',
            actionId: a.actionId,
          },
          receipt: { receiptId: 'r_test', action: a.actionId, ok: true, at: AT },
        };
      }

      case 'readText':
        return {
          text: [
            '# 结果',
            '',
            '## 3.1 湿度稳定性',
            '',
            '在 60% 相对湿度下放置 24 h 后，器件效率由 21.4% 降至 19.7%，',
            '相对衰减 8.0%；对照组（干燥柜，<5% RH）同期衰减 0.4%。',
            '',
            '## 3.2 结构表征',
            '',
            'XRD 主峰（14.1°）在老化后右移 0.06°，半高宽由 0.21° 增至 0.27°，',
            '对应晶粒尺寸由约 41 nm 降至 32 nm（谢乐公式，形状因子取 0.9）。',
            '',
            '![fig1](../figures/fig1.png)',
            '',
            '> 待补：40% / 70% RH 两组数据。',
          ].join('\n'),
          bytes: 2480, mtime: AT,
        };
      case 'readBinary':
        return {
          mime: 'image/png',
          base64: String(window.__FIXTURE_IMG_BASE64 || ''),
          bytes: 20480,
        };
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
        return {
          ops: [
            { id: 'smooth', name: '平滑', needs: ['y'], params: [{ name: 'mode', type: 'select', options: [['mean', '滑动平均']], def: 'mean' }], desc: '压噪' },
            { id: 'normalize', name: '归一化', needs: ['y'], params: [], desc: '统一量纲' },
            { id: 'baseline', name: '扣基线', needs: ['y'], params: [], desc: '扣掉背景' },
          ],
        };
      case 'llm.info':
        return {
          available: true,
          providers: [{ id: 'stub-provider', name: 'Stub' }],
          models: [
            { provider: 'stub-provider', id: 'stub-chat', name: 'stub-chat', vision: false },
            { provider: 'stub-provider', id: 'stub-vision', name: 'stub-vision', vision: true },
          ],
          reason: '',
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

      case 'notes.list':
        return {
          project: a.project,
          notes: [
            {
              name: '2026-10-28-1640-humidity-stability.md',
              title: '钙钛矿湿度实验：10 月 28 日',
              bytes: 1420, mtime: AT2,
              summary: '60% RH 放 24 h 后效率掉 8%，对照组只掉 0.4%',
            },
            {
              name: '2026-10-21-1010-xrd-notes.md',
              title: 'XRD 谱与标尺对照',
              bytes: 980, mtime: AT,
              summary: '主峰 14.1°，半高宽 0.21°',
            },
          ],
        };
      case 'notes.read':
        return {
          name: a.name,
          path: 'projects/demo-perovskite/notes/' + a.name,
          text: NOTE_TEXT,
          bytes: 1420, mtime: AT2,
        };

      case 'library.audit':
        return {
          counts: { err: 0, warn: 2, projects: 1, figures: 1, datasets: 1 },
          issues: [
            { level: 'warn', text: 'fig1 的侧车缺「采集参数」一栏，投稿前补上' },
            { level: 'warn', text: 'uvvis.csv 没有被任何草稿引用' },
          ],
        };

      default:
        return { __unimplemented: true };
    }
  }

  /* --------------------------------------------------------------- 假宿主 */

  var conn = {
    rpc: {
      call: function (channel, endpoint, payload) {
        var action = payload && payload.action;
        var args = (payload && payload.args) || {};
        rpcLog.push({ channel: channel, endpoint: endpoint, action: action });
        var value;
        try { value = fixture(action, args); }
        catch (e) { return Promise.resolve({ ok: false, error: { code: 'bad-request', message: '预览夹具抛错：' + errMsg(e) } }); }
        if (value && value.__unimplemented) {
          return Promise.resolve({
            ok: false,
            error: { code: 'bad-request', message: 'preview: 未实现 ' + action },
          });
        }
        // 微延迟：让「异步 → 重渲染」这条链按真实节奏走一遍（settle 会等它）
        return new Promise(function (res) { setTimeout(function () { res({ ok: true, value: value }); }, 0); });
      },
    },
  };

  var registrations = [];
  var slots = {
    inject: function (name, cb) { cb(); return function () {}; },
    register: function (spec, comp) { registrations.push({ spec: spec, comp: comp }); return function () {}; },
  };
  var ctx = {
    get: function (name) {
      if (name === 'slots') return slots;
      if (name === 'connection') return conn;
      return undefined;
    },
    effect: function (fn) { try { fn(); } catch (e) { errors.push('ctx.effect 抛错：' + errMsg(e)); } },
  };

  /* ------------------------------------------------------------- 存储基线 */

  var LS_WELCOME = 'research-panel-setup:welcome:local';
  var LS_VERSION = 'research-panel-setup:ui.version:local';
  var SETTINGS_PREFIX = 'research-panel-settings:';
  var FIGCHAT_KEY = 'research-panel-chat:';

  function storageUsable() {
    try { window.localStorage.setItem('__preview_probe', '1'); window.localStorage.removeItem('__preview_probe'); return true; }
    catch (e) { return false; }
  }

  /** file:// 下个别 Chrome 版本不给 localStorage：退化成一个内存实现，面板照常跑。 */
  function installStorageShim() {
    var map = new Map();
    var shim = {
      getItem: function (k) { return map.has(String(k)) ? map.get(String(k)) : null; },
      setItem: function (k, v) { map.set(String(k), String(v)); },
      removeItem: function (k) { map.delete(String(k)); },
      clear: function () { map.clear(); },
      key: function (i) { return Array.from(map.keys())[i] || null; },
    };
    Object.defineProperty(shim, 'length', { get: function () { return map.size; } });
    try {
      Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
      errors.push('file:// 下 localStorage 不可用，已换成内存实现（会话不留存）');
      return true;
    } catch (e) {
      errors.push('localStorage 不可用且无法替换：' + errMsg(e));
      return false;
    }
  }

  function seedStorage(scenario) {
    var ls = window.localStorage;
    ls.setItem(LS_WELCOME, '1');                 // 跳过首屏欢迎卡
    if (LS_VERSION) ls.setItem(LS_VERSION, 'v2');
    ls.setItem(SETTINGS_PREFIX + 'model', 'stub-provider/stub-vision');
    // 「问模型」的两张重点图需要一段有 6 条历史的对话
    if (scenario === 'chat' || scenario === 'chat-confirm') {
      ls.setItem(FIGCHAT_KEY + 'fig1', JSON.stringify(CHAT_TURNS));
    }
  }

  /* ------------------------------------------------------------- DOM 工具 */

  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function btn(text, root) {
    var list = qa('button', root || document);
    for (var i = 0; i < list.length; i += 1) if (norm(list[i].textContent) === text) return list[i];
    return null;
  }
  function btnHas(text, root) {
    var list = qa('button', root || document);
    for (var i = 0; i < list.length; i += 1) if (norm(list[i].textContent).indexOf(text) >= 0) return list[i];
    return null;
  }

  function click(el) {
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  }

  function clickText(text) {
    var el = btn(text);
    if (!el) { errors.push('预览驱动：找不到按钮「' + text + '」'); return false; }
    return click(el);
  }

  async function act(fn) {
    try { fn(); } catch (e) { errors.push('预览动作抛错：' + errMsg(e)); }
    await settle();
  }

  function rectOf(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left), y: Math.round(r.top),
      w: Math.round(r.width), h: Math.round(r.height),
      bottom: Math.round(r.bottom), right: Math.round(r.right),
    };
  }

  function hitAt(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    var x = r.left + r.width / 2;
    var y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return '超出视口中心点';
    var hit = document.elementFromPoint(x, y);
    if (!hit) return null;
    return hit.tagName.toLowerCase() + (hit.className ? '.' + String(hit.className).split(/\s+/).join('.') : '');
  }

  /* ------------------------------------------------------------ 场景剧本 */
  /* 每个场景 = 从默认挂载点走到目标状态的点击序列；截图由 Node 那边定。 */

  async function gotoTab(label) {
    var tab = btn(label);
    if (!tab) { errors.push('预览驱动：找不到页签「' + label + '」'); return; }
    await act(function () { click(tab); });
  }

  async function expandFigure() {
    await gotoTab('图表');
    await act(function () {
      var b = btn('展开');
      if (!b) errors.push('预览驱动：图表页找不到「展开」');
      else click(b);
    });
  }

  async function openChatAll() {
    await expandFigure();
    var more = btnHas('查看全部');
    if (more) await act(function () { click(more); });
    else errors.push('预览驱动：没找到「查看全部 N 条」按钮（对话没读出来？）');
    var chat = q('.rl-chat');
    if (chat) chat.scrollTop = chat.scrollHeight;
    var body = q('.rl-body');
    if (body) { var card = q('.rl-figchat'); if (card) card.scrollIntoView({ block: 'start' }); }
  }

  var SCENARIOS = {
    /* 1 · 首页（工作台） */
    workbench: async function () { /* 默认就在工作台 */ },

    /* 2 · 课题页（工作台选中另一个课题后的详情栏，跟首页看得出差别） */
    project: async function () {
      await act(function () {
        var rows = qa('.rl-wb__row');
        if (rows.length < 2) { errors.push('预览驱动：工作台只有 ' + rows.length + ' 个课题行'); return; }
        click(rows[1]);
      });
    },

    /* 3 · 图页（展开的图卡） */
    figures: async function () { await expandFigure(); },

    /* 4 · 草稿页（展开预览一张草稿） */
    drafts: async function () {
      await gotoTab('草稿');
      await act(function () {
        var b = btn('预览');
        if (!b) errors.push('预览驱动：草稿页找不到「预览」');
        else click(b);
      });
    },

    /* 5 · 笔记页（打开一篇笔记） */
    notes: async function () {
      await gotoTab('笔记');
      await act(function () {
        var row = q('.rl-wb__rowMain');
        if (!row) errors.push('预览驱动：笔记页找不到笔记行');
        else click(row);
      });
    },

    /* 6 · 设置弹层 */
    settings: async function () {
      await act(function () { clickText('设置'); });
    },

    /* 7 · 图卡对话展开全部 6 条 */
    chat: async function () { await openChatAll(); },

    /* 8 · 6 条对话 + 「存进笔记」确认弹层（重点：弹层会不会被长对话挤走） */
    'chat-confirm': async function () {
      await openChatAll();
      // 真实路径：用户读完最后一条回答，回头去点「存进笔记」
      await act(function () {
        var b = btn('存进笔记');
        if (!b) { errors.push('预览驱动：图卡里找不到「存进笔记」'); return; }
        b.scrollIntoView({ block: 'center' });
        click(b);
      });
    },
  };

  /* ---------------------------------------------------------------- 探针 */

  /* 审查用的「量」：字号谱、路径外露、卡片布局、焦点环……量出来比肉眼估靠谱。 */

  function collectAudit() {
    var root = q('.rl-root');
    var out = { fontSizes: {}, smallText: [], odd: [], mono: [], actionIds: [], cards: [], focus: null };
    if (!root) return out;

    var all = root.querySelectorAll('*');
    var small = {};
    for (var i = 0; i < all.length; i += 1) {
      var el = all[i];
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      var cs = window.getComputedStyle(el);
      var fs = Math.round(parseFloat(cs.fontSize) * 10) / 10;
      if (!fs) continue;
      out.fontSizes[fs] = (out.fontSizes[fs] || 0) + 1;
      // 只统计「自己直接有文字」的元素，避免把父容器重复记一遍
      var own = '';
      for (var k = 0; k < el.childNodes.length; k += 1) {
        if (el.childNodes[k].nodeType === 3) own += el.childNodes[k].nodeValue;
      }
      own = norm(own);
      // 设计口径只有 12/14/16 三档；不在三档里的，逐一记下来（含标签与类名）
      if (own && [12, 14, 16].indexOf(fs) < 0 && out.odd.length < 14) {
        out.odd.push({
          px: fs, tag: el.tagName.toLowerCase(),
          cls: String(el.className || '').slice(0, 40), text: own.slice(0, 30),
        });
      }
      if (own && fs < 12 && !small[fs + own.slice(0, 24)]) {
        small[fs + own.slice(0, 24)] = 1;
        if (out.smallText.length < 8) out.smallText.push({ px: fs, text: own.slice(0, 40) });
      }
    }

    qa('.rl-mono', root).slice(0, 6).forEach(function (m) {
      out.mono.push(norm(m.textContent).slice(0, 90));
    });

    var txt = norm((q('.rl-body') || root).textContent);
    var re = /（([a-z][a-z0-9]*(?:\.[a-z0-9_]+)+)）/g;
    var m;
    while ((m = re.exec(txt))) if (out.actionIds.indexOf(m[1]) < 0) out.actionIds.push(m[1]);

    qa('.rl-card', root).slice(0, 4).forEach(function (c) {
      var fc = q('.rl-figchat', c);
      var meta = c.firstElementChild;
      out.cards.push({
        rect: rectOf(c),
        hasFigChat: Boolean(fc),
        figchat: rectOf(fc),
        // 展开后左列（元数据栏）到底空多少：容器高 − 内容高
        leftCol: meta ? { rect: rectOf(meta), textLen: norm(meta.textContent).length } : null,
      });
    });

    var ae = document.activeElement;
    if (ae && ae !== document.body) {
      var acs = window.getComputedStyle(ae);
      out.focus = {
        tag: ae.tagName.toLowerCase(),
        className: String(ae.className || ''),
        outline: acs.outline,
        borderColor: acs.borderColor,
        boxShadow: acs.boxShadow,
      };
    }

    var sel = q('.rl-select', root);    if (sel) {
      var scs = window.getComputedStyle(sel);
      out.select = {
        fontSize: scs.fontSize, borderColor: scs.borderColor,
        background: scs.backgroundColor, appearance: scs.appearance,
        height: scs.height, width: rectOf(sel) ? rectOf(sel).w : null,
      };
    }
    var fb = q('.rl-figbody');
    if (fb) {
      var fgcs = window.getComputedStyle(fb);
      var young = [];
      for (var ci = 0; ci < fb.children.length; ci += 1) {
        var kel = fb.children[ci];
        var kr = rectOf(kel);
        young.push({ cls: String(kel.className || '').slice(0, 26), x: Math.round(kr.x), w: Math.round(kr.w), h: Math.round(kr.h) });
      }
      out.fig = { display: fgcs.display, cols: fgcs.gridTemplateColumns, kids: young };
      var im = fb.querySelector('img');
      if (im) { var ir = rectOf(im); out.fig.img = { x: Math.round(ir.x), w: Math.round(ir.w), h: Math.round(ir.h) }; }
      var sw = fb.querySelector('.rl-selwrap');
      if (sw) { var sr = rectOf(sw); out.fig.selwrap = { x: Math.round(sr.x), w: Math.round(sr.w), h: Math.round(sr.h) }; }
    }
    var turns = root.querySelectorAll('.rl-chat__turn');
    if (turns.length) {
      var t0 = rectOf(turns[0]);
      var tn = rectOf(turns[turns.length - 1]);
      out.turns = { n: turns.length, firstTop: Math.round(t0.y), lastBottom: Math.round(tn.bottom) };
    }

    var ta = q('textarea', root);
    if (ta) {
      var tcs = window.getComputedStyle(ta);
      out.textarea = { fontSize: tcs.fontSize, h: rectOf(ta) ? rectOf(ta).h : null, rows: ta.rows };
    }

    var settings = q('.rl-wbcard.rl-settings');
    if (settings) {
      var s = window.getComputedStyle(settings);
      out.settings = {
        rect: rectOf(settings), width: s.width, maxWidth: s.maxWidth,
        bodyCols: q('.rl-settings__body') ? window.getComputedStyle(q('.rl-settings__body')).gridTemplateColumns : null,
      };
    }

    var rlRoot = window.getComputedStyle(root);
    out.tokens = {
      ac: rlRoot.getPropertyValue('--rl-ac').trim(),
      f1: rlRoot.getPropertyValue('--rl-f1').trim(),
      bg: rlRoot.getPropertyValue('--rl-bg').trim(),
    };
    out.tabCount = qa('.rl-tab', root).length;
    out.maskCount = qa('.rl-wbmask', root).length;
    return out;
  }

  function probe(scenario) {
    var mask = q('.rl-wbmask');
    var card = mask ? q('.rl-wbcard', mask) : null;
    var foot = card ? q('.rl-wbcard__foot', card) : null;
    var confirmBtn = foot ? foot.querySelector('.rl-btn--primary') : null;
    var chat = q('.rl-chat');
    var figchat = q('.rl-figchat');
    var body = q('.rl-body');
    var activeTab = q('.rl-tab[data-active="1"]');

    var labels = [];
    qa('button').forEach(function (b) {
      var t = norm(b.textContent);
      if (t && labels.indexOf(t) < 0) labels.push(t);
    });

    var p = {
      scenario: scenario,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      ready: true,
      renderRounds: window.__preview.lastSettle ? window.__preview.lastSettle.rounds : null,
      activeTab: activeTab ? norm(activeTab.textContent) : null,
      scroll: {
        windowY: Math.round(window.scrollY),
        docH: document.documentElement.scrollHeight,
        bodyTop: body ? Math.round(body.scrollTop) : null,
        bodyH: body ? body.scrollHeight : null,
        bodyClient: body ? body.clientHeight : null,
      },
      mask: rectOf(mask),
      maskCoversViewport: Boolean(mask
        && Math.abs(mask.getBoundingClientRect().top) < 1
        && Math.abs(mask.getBoundingClientRect().height - window.innerHeight) < 1),
      card: rectOf(card),
      cardScroll: card ? { scrollH: card.scrollHeight, clientH: card.clientHeight } : null,
      foot: rectOf(foot),
      confirmInViewport: Boolean(foot && foot.getBoundingClientRect().bottom <= window.innerHeight
        && foot.getBoundingClientRect().top >= 0),
      confirmHit: hitAt(confirmBtn),
      chat: chat ? {
        rect: rectOf(chat), scrollTop: Math.round(chat.scrollTop),
        scrollH: chat.scrollHeight, clientH: chat.clientHeight,
        turns: qa('.rl-chat__turn', chat).length,
      } : null,
      figchat: rectOf(figchat),
      buttons: labels,
      buttonsVisible: labels.length,
      bodyTextHead: body ? norm(body.textContent).slice(0, 160) : null,
    };
    try { p.audit = collectAudit(); } catch (e) { p.audit = { error: errMsg(e) }; }
    return p;
  }

  /* ---------------------------------------------------------------- 启动 */

  function mountPanel() {
    var captured = window.__captured;
    if (!captured || !captured.factory) throw new Error('没捕获到 lib/client.js 的 bundle（__ModuleLoader__ 没生效？）');
    var mod = captured.factory(function (name) {
      if (name === 'react') return React;
      throw new Error('预览运行时没有模块：' + name);
    });
    // factory 直接 `return module.exports`（不是返回 module 对象），两种都兜一下
    var api = (mod && mod.exports) || mod || {};
    if (typeof api.apply !== 'function') throw new Error('bundle 没导出 apply()');
    if (typeof api.inject !== 'undefined' && Array.isArray(api.inject) && api.inject.indexOf('slots') < 0) {
      errors.push('bundle 的 inject 里没有 slots：' + JSON.stringify(api.inject));
    }
    api.apply(ctx);
    var main = null;
    for (var i = 0; i < registrations.length; i += 1) {
      var spec = registrations[i].spec || {};
      if (spec.name === 'main') { main = registrations[i].comp; break; }
    }
    if (!main) throw new Error('apply() 没有注册 main 面板（注册项：' + JSON.stringify(registrations.map(function (r) { return r.spec && r.spec.name; })) + '）');
    return main;
  }

  async function boot() {
    var params = new URLSearchParams(window.location.search);
    var scenario = params.get('scenario') || 'workbench';
    window.__preview = {
      ready: false,
      scenario: scenario,
      errors: errors,
      rpcLog: rpcLog,
      trace: [],
      probe: null,
      /** 截图前重量一次几何（外部在动画/图片解码之后再调它）。 */
      refresh: function () {
        window.__preview.probe = probe(scenario);
        return window.__preview.probe;
      },
      waitReady: function (timeoutMs) {
        var t0 = Date.now();
        var limit = timeoutMs || 20000;
        return new Promise(function (res) {
          (function loop() {
            if (window.__preview.ready) return res(true);
            if (Date.now() - t0 > limit) return res(false);
            setTimeout(loop, 100);
          })();
        });
      },
    };

    try {
      if (!storageUsable()) installStorageShim();
      seedStorage(scenario);
      rootEl = document.getElementById('panel-root');
      RootComp = mountPanel();
      var s1 = await settle();
      window.__preview.trace.push({ step: 'mount', rounds: s1.rounds });

      var run = SCENARIOS[scenario];
      if (run) await run();
      else errors.push('未知场景：' + scenario);

      var s2 = await settle({ rounds: 60 });
      window.__preview.trace.push({ step: 'after-actions', rounds: s2.rounds });
      settling = false;
      window.__preview.lastSettle = s2;
      window.__preview.probe = probe(scenario);
      window.__preview.ready = true;
    } catch (e) {
      errors.push('启动失败：' + errMsg(e) + (e && e.stack ? '\n' + String(e.stack).split('\n').slice(0, 4).join('\n') : ''));
      settling = false;
      window.__preview.ready = true;
      window.__preview.fatal = errMsg(e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { boot(); });
  } else {
    boot();
  }
})();

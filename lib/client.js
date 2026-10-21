/**
 * 科研模式 · 客户端半边（浏览器面板，手写 AMD bundle，无构建步骤）
 * ===========================================================================
 * 刻意**不使用 TS/tsdown**：整个文件就是一段 `window.__ModuleLoader__.load({id, factory})`
 * 包封（与 @nagi-ovo/dsh-visualize 的产物同形），factory 里用 `require("react")`
 * 拿平台基座里的 React，用 `React.createElement` 手写组件（不经过 JSX 编译）。
 *
 * 挂点（官方「中央面板」范式，照抄 @linxin666/dsh-web-all 的 board 面板）：
 *   - `sidebar.panellist`（list/root）注册一个图标行：`{id, order, label}`
 *   - keyed `main` 注册同 id 的页面：`{name:'main', key:id}`
 *   外壳负责行框、标签、高亮、收起与窗口联动；我们只贡献图标与页面。
 *
 * 数据通道：`ctx.get('connection').rpc.call('/api', 'research/call', {action,args})`
 *   → 宿主半边 `lib/index.js` 拦截该端点 → `lib/actions.js` 执行。
 *   面板**只读**；一切写库动作都提示走 `research.py`（见 cliHint）。
 *
 * 主题：面板自带一套「石墨蓝」module 色板（`--rl-bg/surf/surf2/bd/bd2/tx/mu/ac/ink/ok/warn/err`），
 *   深色取 #15171b 冷灰三层 + #7aa2f7 蓝强调，浅色用同色相纸面版；正文对比度 ≥ 13.8:1、
 *   次要文字 ≥ 6.4:1。每组分两行：先给同值十六进制兜底，再给 `light-dark()` 成对值。
 *   不再直接引用 `--dsw-*`：宿主 token 在部分主题下会让次要文字发灰、错落层叠。
 */

window.__ModuleLoader__.load({
  id: 'dsh-sciwork',
  factory: function (require) {
    var React = require('react');
    var module = { exports: {} };
    var exports = module.exports;

    var h = React.createElement;
    var PANEL_ID = 'research-library';
    var PANEL_TITLE = '科研库';
    var PANEL_ORDER = 42;
    var ENDPOINT = 'research/call';
    var CHANNEL = '/api';

    /* ------------------------------------------------------------------ 样式 */

    var CSS = [
      '.rl-root{--rl-bg:#15171b;--rl-bg:light-dark(#f6f3ee,#15171b);--rl-surf:#1b1e24;--rl-surf:light-dark(#fffdf8,#1b1e24);--rl-surf2:#23272f;--rl-surf2:light-dark(#ece6db,#23272f);--rl-bd:#303641;--rl-bd:light-dark(#ded6c8,#303641);--rl-bd2:#3a4250;--rl-bd2:light-dark(#cfc5b4,#3a4250);--rl-tx:#e8eaee;--rl-tx:light-dark(#1f1c18,#e8eaee);--rl-mu:#a9b2bf;--rl-mu:light-dark(#5f574c,#a9b2bf);--rl-ac:#7aa2f7;--rl-ac:light-dark(#3b6fd4,#7aa2f7);--rl-ink:#0d1117;--rl-ink:light-dark(#fffdf8,#0d1117);--rl-ok:#7bd3a0;--rl-ok:light-dark(#2f6b4f,#7bd3a0);--rl-warn:#e8b168;--rl-warn:light-dark(#a35f12,#e8b168);--rl-err:#f08c8c;--rl-err:light-dark(#a5342e,#f08c8c);--rl-s1:4px;--rl-s2:8px;--rl-s3:12px;--rl-s4:16px;--rl-s5:20px;--rl-s6:24px;--rl-s8:32px;--rl-r1:8px;--rl-r2:12px;--rl-r3:16px;--rl-sh1:0 1px 2px rgba(0,0,0,.06);--rl-sh2:0 6px 20px rgba(0,0,0,.08);--rl-ease:cubic-bezier(.2,0,0,1);--rl-d1:120ms;--rl-d2:200ms;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--rl-bg);color:var(--rl-tx);font-size:13px;line-height:1.6;-webkit-font-smoothing:antialiased}',
      '.rl-root *{box-sizing:border-box}',
      '.rl-root *:focus-visible{outline:2px solid var(--rl-ac);outline-offset:2px;border-radius:4px}',
      '.rl-root ::-webkit-scrollbar{width:10px;height:10px}',
      '.rl-root ::-webkit-scrollbar-thumb{background:var(--rl-bd2);border-radius:6px;border:3px solid transparent;background-clip:content-box}',
      '.rl-root ::-webkit-scrollbar-thumb:hover{background:var(--rl-mu);background-clip:content-box;border:3px solid transparent}',
      '.rl-root ::-webkit-scrollbar-track{background:transparent}',
      '.rl-head{padding:var(--rl-s5) var(--rl-s6) var(--rl-s4);border-bottom:1px solid var(--rl-bd);flex:0 0 auto;background:var(--rl-bg)}',
      '.rl-title{display:flex;align-items:center;gap:var(--rl-s2);font-size:15px;font-weight:500;letter-spacing:-.01em;min-height:28px}',
      '.rl-path{font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:11px;color:var(--rl-mu);margin-top:2px;word-break:break-all}',
      '.rl-counts{display:flex;flex-wrap:wrap;gap:var(--rl-s1);margin-top:var(--rl-s3);color:var(--rl-mu);font-size:12px}',
      '.rl-counts span{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border:1px solid var(--rl-bd);border-radius:999px;background:var(--rl-surf);transition:background var(--rl-d1) var(--rl-ease)}',
      '.rl-counts span:hover{background:var(--rl-surf2)}',
      '.rl-counts b{font-weight:500;color:var(--rl-tx);font-variant-numeric:tabular-nums}',
      '.rl-warns{margin:var(--rl-s2) 0 0;padding:0;list-style:none;font-size:12px;color:var(--rl-warn)}',
      '.rl-tabs{display:flex;align-items:center;gap:var(--rl-s1);padding:var(--rl-s2) var(--rl-s6);border-bottom:1px solid var(--rl-bd);flex:0 0 auto;overflow-x:auto;scrollbar-width:thin;background:var(--rl-bg)}',
      '.rl-tab{position:relative;padding:6px 12px;border:0;border-radius:var(--rl-r1);background:transparent;color:var(--rl-mu);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;transition:background var(--rl-d1) var(--rl-ease),color var(--rl-d1) var(--rl-ease)}',
      '.rl-tab:hover{background:var(--rl-surf);color:var(--rl-tx)}',
      '.rl-tab:active{transform:translateY(1px)}',
      '.rl-tab[data-active="1"]{background:var(--rl-surf2);color:var(--rl-tx);font-weight:500}',
      '.rl-tab[data-active="1"]:after{content:"";position:absolute;left:12px;right:12px;bottom:-9px;height:2px;border-radius:2px;background:var(--rl-ac)}',
      '.rl-vertabs{display:flex;gap:2px;padding:2px;border-radius:var(--rl-r1);background:var(--rl-surf);flex:0 0 auto}',
      '.rl-vertabs .rl-tab{font-size:12px;padding:3px 10px}',
      '.rl-vertabs .rl-tab[data-active="1"]:after{display:none}',
      '.rl-body{flex:1 1 auto;min-height:0;overflow:auto;padding:var(--rl-s5) var(--rl-s6) var(--rl-s8);scrollbar-width:thin}',
      '.rl-sub{color:var(--rl-mu);font-size:12px;line-height:1.6}',
      '.rl-card{position:relative;border:1px solid var(--rl-bd);border-radius:var(--rl-r2);background:var(--rl-surf);padding:var(--rl-s4);margin-bottom:var(--rl-s3);transition:box-shadow var(--rl-d2) var(--rl-ease),transform var(--rl-d2) var(--rl-ease),border-color var(--rl-d2) var(--rl-ease)}',
      '.rl-card:hover{box-shadow:var(--rl-sh1);border-color:var(--rl-bd2)}',
      '.rl-card[data-open="1"]{background:var(--rl-surf);border-color:var(--rl-bd2);box-shadow:var(--rl-sh1)}',
      '.rl-card[data-open="1"]:before{content:"";position:absolute;left:-1px;top:14px;bottom:14px;width:2px;border-radius:2px;background:var(--rl-ac)}',
      '.rl-row{display:flex;align-items:center;justify-content:space-between;gap:var(--rl-s3);flex-wrap:wrap}',
      '.rl-mono{font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:12px;word-break:break-all;font-variant-numeric:tabular-nums}',
      '.rl-warn{color:var(--rl-warn);font-weight:600}',
      '.rl-err{color:var(--rl-err)}',
      '.rl-ok{color:var(--rl-ok)}',
      '.rl-idle{color:var(--rl-mu)}',
      '.rl-brand{color:var(--rl-ac)}',
      '.rl-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:0 14px;border:1px solid var(--rl-bd2);border-radius:var(--rl-r1);background:var(--rl-surf);color:var(--rl-tx);font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;transition:background var(--rl-d1) var(--rl-ease),border-color var(--rl-d1) var(--rl-ease),transform var(--rl-d1) var(--rl-ease),box-shadow var(--rl-d1) var(--rl-ease)}',
      '.rl-btn:hover{background:var(--rl-surf2);transform:translateY(-1px);box-shadow:var(--rl-sh1)}',
      '.rl-btn:active{transform:translateY(0)}',
      '.rl-btn[disabled]{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}',
      '.rl-btn-primary{background:var(--rl-ac);border-color:var(--rl-ac);color:var(--rl-ink)}',
      '.rl-btn-primary:hover{background:var(--rl-ac);filter:brightness(1.06)}',
      '.rl-btn--danger{background:transparent;border-color:var(--rl-err);color:var(--rl-err)}',
      '.rl-btn--danger:hover{background:var(--rl-err);color:var(--rl-ink)}',
      '.rl-badge{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;border:1px solid var(--rl-bd);background:var(--rl-surf2);color:var(--rl-mu);font-size:11px;font-weight:500;white-space:nowrap}',
      '.rl-thumb{cursor:zoom-in;display:block;border-radius:var(--rl-r1);border:1px solid var(--rl-bd);transition:transform var(--rl-d2) var(--rl-ease),box-shadow var(--rl-d2) var(--rl-ease);max-width:100%}',
      '.rl-thumb:hover{transform:translateY(-1px);box-shadow:var(--rl-sh2)}',
      '.rl-thumb-big{width:100%}',
      '.rl-pre{max-height:340px;overflow:auto;margin:0;padding:var(--rl-s3);border:1px solid var(--rl-bd);border-radius:var(--rl-r1);background:var(--rl-surf2);color:var(--rl-tx);font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:12px;line-height:1.65;white-space:pre-wrap;word-break:break-word;scrollbar-width:thin}',
      '.rl-input,.rl-select{height:32px;padding:0 10px;border:1px solid var(--rl-bd2);border-radius:var(--rl-r1);background:var(--rl-surf);color:var(--rl-tx);font:inherit;font-size:13px;transition:border-color var(--rl-d1) var(--rl-ease),box-shadow var(--rl-d1) var(--rl-ease)}',
      '.rl-input::placeholder{color:var(--rl-mu)}',
      '.rl-input:focus,.rl-select:focus{outline:none;border-color:var(--rl-ac);box-shadow:0 0 0 3px var(--rl-surf2)}',
      '.rl-field{display:flex;flex-direction:column;gap:6px;min-width:0;font-size:12px;color:var(--rl-mu)}',
      '.rl-field--wide{grid-column:1/-1}',
      '.rl-field input,.rl-field select,.rl-field textarea{width:100%;min-height:32px;padding:6px 10px;border:1px solid var(--rl-bd2);border-radius:var(--rl-r1);background:var(--rl-surf);color:var(--rl-tx);font:inherit;font-size:13px;transition:border-color var(--rl-d1) var(--rl-ease)}',
      '.rl-field input:focus,.rl-field select:focus,.rl-field textarea:focus{outline:none;border-color:var(--rl-ac)}',
      '.rl-field textarea{resize:vertical;line-height:1.6}',
      '.rl-chips{display:flex;flex-wrap:wrap;gap:var(--rl-s1)}',
      '.rl-chip{padding:3px 10px;border:1px solid var(--rl-bd);border-radius:999px;background:var(--rl-surf);color:var(--rl-mu);font:inherit;font-size:12px;cursor:pointer;transition:background var(--rl-d1) var(--rl-ease),color var(--rl-d1) var(--rl-ease),border-color var(--rl-d1) var(--rl-ease)}',
      '.rl-chip:hover{background:var(--rl-surf2);color:var(--rl-tx)}',
      '.rl-chip[data-on="1"]{background:var(--rl-ac);border-color:var(--rl-ac);color:var(--rl-ink)}',
      '.rl-tool{height:30px;padding:0 10px;border:1px solid var(--rl-bd);border-radius:var(--rl-r1);background:var(--rl-surf);color:var(--rl-tx);font:inherit;font-size:12px}',
      '.rl-search{width:220px}',
      '.rl-name{height:30px;padding:0 10px;border:1px solid var(--rl-err);border-radius:var(--rl-r1);background:var(--rl-surf);color:var(--rl-tx);font:inherit;font-size:12px}',
      '.rl-edit{width:100%;min-height:240px;padding:var(--rl-s3);border:1px solid var(--rl-bd2);border-radius:var(--rl-r1);background:var(--rl-surf);color:var(--rl-tx);font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:13px;line-height:1.65;resize:vertical}',
      '.rl-chk{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--rl-mu);cursor:pointer}',
      '.rl-table{width:100%;border-collapse:collapse;font-size:13px}',
      '.rl-table th{text-align:left;font-weight:600;color:var(--rl-mu);padding:6px 8px;border-bottom:1px solid var(--rl-bd);white-space:nowrap}',
      '.rl-table td{padding:7px 8px;border-bottom:1px solid var(--rl-bd);vertical-align:top}',
      '.rl-table tbody tr:hover td{background:var(--rl-surf)}',
      '.rl-actions{display:flex;align-items:center;gap:var(--rl-s2);flex-wrap:wrap}',
      '.rl-empty{padding:var(--rl-s8) var(--rl-s4);text-align:center;color:var(--rl-mu);font-size:13px;line-height:1.8}',
      '.rl-dim{opacity:.72}',
      '.rl-box{padding:var(--rl-s3);border:1px solid var(--rl-bd);border-radius:var(--rl-r1);background:var(--rl-surf);font-size:13px}',
      '.rl-group{border:1px solid var(--rl-bd);border-radius:var(--rl-r2);background:var(--rl-surf);padding:var(--rl-s3);margin-bottom:var(--rl-s3)}',
      '.rl-group__head{display:flex;align-items:center;gap:var(--rl-s2);font-size:13px;color:var(--rl-mu);margin-bottom:var(--rl-s2)}',
      '.rl-group__toggle{border:0;border-radius:var(--rl-r1);background:transparent;color:var(--rl-tx);font:inherit;font-size:13px;font-weight:500;cursor:pointer;padding:2px 6px;transition:background var(--rl-d1) var(--rl-ease)}',
      '.rl-group__toggle:hover{background:var(--rl-surf2)}',
      '.rl-group__empty{padding:var(--rl-s4);text-align:center;color:var(--rl-mu);font-size:12px}',
      '.rl-welcome{display:flex;flex-direction:column;gap:var(--rl-s4);padding:var(--rl-s6);border:1px solid var(--rl-bd);border-radius:var(--rl-r3);background:var(--rl-surf)}',
      '.rl-welcome__lead{font-size:14px;line-height:1.7;color:var(--rl-tx)}',
      '.rl-welcome__cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:var(--rl-s3)}',
      '.rl-welcome__card{padding:var(--rl-s4);border:1px solid var(--rl-bd);border-radius:var(--rl-r2);background:var(--rl-surf);transition:transform var(--rl-d2) var(--rl-ease),box-shadow var(--rl-d2) var(--rl-ease)}',
      '.rl-welcome__card:hover{transform:translateY(-2px);box-shadow:var(--rl-sh2)}',
      '.rl-welcome__card h3{margin:0 0 6px;font-size:13px;font-weight:500}',
      '.rl-welcome__card p{margin:0;font-size:12px;line-height:1.65;color:var(--rl-mu)}',
      '.rl-welcome__foot{font-size:12px;color:var(--rl-mu)}',
      '.rl-tour-layer{position:fixed;inset:0;z-index:2147483000;pointer-events:none;--rl-tour-shade:rgba(10,12,16,.58)}',
      '.rl-tour-spot{position:fixed;border-radius:var(--rl-r2);box-shadow:0 0 0 200vmax var(--rl-tour-shade);pointer-events:none}',
      '.rl-tour-pop{position:fixed;z-index:1;width:min(420px,92vw);padding:var(--rl-s5);border:1px solid var(--rl-bd2);border-radius:var(--rl-r3);background:var(--rl-surf);box-shadow:var(--rl-sh2);pointer-events:auto}',
      '.rl-tour-pop--docked{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%)}',
      '.rl-tour-pop__head{display:flex;align-items:center;gap:var(--rl-s2);font-size:12px;color:var(--rl-mu)}',
      '.rl-tour-pop__count{font-variant-numeric:tabular-nums}',
      '.rl-tour-pop__meter{display:flex;gap:4px;flex:1}',
      '.rl-tour-pop__meter i{width:14px;height:3px;border-radius:2px;background:var(--rl-bd2)}',
      '.rl-tour-pop__title{margin:var(--rl-s2) 0 6px;font-size:14px;font-weight:500}',
      '.rl-tour-pop__body{font-size:13px;line-height:1.7;color:var(--rl-mu)}',
      '.rl-tour-pop__note{margin-top:var(--rl-s2);font-size:12px;color:var(--rl-ac)}',
      '.rl-tour-pop__foot{display:flex;align-items:center;gap:var(--rl-s2);margin-top:var(--rl-s5)}',
      '.rl-tour-pop__spacer{flex:1}',
      '.rl-modal{position:fixed;inset:0;z-index:2147482000;display:flex;align-items:center;justify-content:center;padding:var(--rl-s6);background:rgba(10,12,16,.45);pointer-events:auto}',
      '.rl-modal__box{width:min(760px,96vw);max-height:92vh;overflow:auto;display:flex;flex-direction:column;border:1px solid var(--rl-bd2);border-radius:var(--rl-r3);background:var(--rl-surf);box-shadow:var(--rl-sh2);scrollbar-width:thin}',
      '.rl-modal__head{display:flex;align-items:center;gap:var(--rl-s3);padding:var(--rl-s4) var(--rl-s5);border-bottom:1px solid var(--rl-bd);position:sticky;top:0;background:var(--rl-surf);z-index:1}',
      '.rl-modal__title{margin:0;font-size:15px;font-weight:500;letter-spacing:-.01em}',
      '.rl-modal__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--rl-s3) var(--rl-s4);padding:var(--rl-s5)}',
      '.rl-targets{display:flex;flex-wrap:wrap;gap:var(--rl-s1);padding:0 var(--rl-s5) var(--rl-s4)}',
      '.rl-target{padding:4px 12px;border:1px solid var(--rl-bd);border-radius:999px;background:var(--rl-surf);color:var(--rl-mu);font:inherit;font-size:12px;cursor:pointer;transition:background var(--rl-d1) var(--rl-ease),color var(--rl-d1) var(--rl-ease)}',
      '.rl-target:hover{background:var(--rl-surf2);color:var(--rl-tx)}',
      '.rl-target[data-active="1"]{background:var(--rl-ac);border-color:var(--rl-ac);color:var(--rl-ink)}',
      '.rl-zoom{position:fixed;inset:0;z-index:2147482500;display:flex;align-items:center;justify-content:center;background:rgba(8,10,14,.84);pointer-events:auto}',
      '.rl-zoom__box{max-width:94vw;max-height:94vh;display:flex;flex-direction:column;gap:var(--rl-s2);padding:var(--rl-s4);border:1px solid var(--rl-bd2);border-radius:var(--rl-r3);background:var(--rl-surf);box-shadow:var(--rl-sh2)}',
      '.rl-zoom__img{max-width:92vw;max-height:84vh;border-radius:var(--rl-r1);background:var(--rl-bg)}',
      '.rl-zoom__frame{width:84vw;height:80vh;border:0;border-radius:var(--rl-r1);background:var(--rl-bg)}',
      '.rl-drop{outline:2px dashed var(--rl-ac);outline-offset:-8px}',
      '.rl-console{display:grid;grid-template-columns:minmax(200px,240px) minmax(0,1fr);gap:0;min-height:320px}',
      '.rl-console__list{border-right:1px solid var(--rl-bd);padding:var(--rl-s3);max-height:56vh;overflow:auto;scrollbar-width:thin}',
      '.rl-console__group{margin:0 0 var(--rl-s2);font-size:11px;color:var(--rl-mu);padding:0 6px}',
      '.rl-console__item{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;text-align:left;padding:6px 10px;border:0;border-radius:var(--rl-r1);background:transparent;color:var(--rl-tx);font:inherit;font-size:13px;cursor:pointer;transition:background var(--rl-d1) var(--rl-ease)}',
      '.rl-console__item .rl-console__cmd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--rl-mu);opacity:.8}',
      '.rl-console__item .rl-console__desc{font-size:11px;line-height:1.35;color:var(--rl-mu);opacity:.75;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.rl-console__item:hover{background:var(--rl-surf2)}',
      '.rl-console__item[data-active="1"]{background:var(--rl-surf2);font-weight:500;box-shadow:inset 2px 0 0 var(--rl-ac)}',
      '.rl-console__hint{font-size:12px;color:var(--rl-mu);padding:0 10px 4px}',
      '.rl-console__form{padding:var(--rl-s4);display:flex;flex-direction:column;gap:var(--rl-s3);min-width:0}',
      '.rl-console__foot{display:flex;align-items:center;gap:var(--rl-s2);padding:var(--rl-s3) var(--rl-s5);border-top:1px solid var(--rl-bd)}',
      '.rl-console__raw{margin-top:var(--rl-s3);display:flex;flex-direction:column;gap:6px}',
      '.rl-wb{display:flex;flex-direction:column;gap:var(--rl-s4)}',
      '.rl-wb__head{display:flex;flex-wrap:wrap;align-items:flex-start;gap:var(--rl-s2);justify-content:space-between}',
      '.rl-wb__title{font-size:14px;font-weight:500}',
      '.rl-wb__actions{display:flex;gap:var(--rl-s2);flex-wrap:wrap;margin-top:var(--rl-s2)}',
      '.rl-wb__grid{display:grid;grid-template-columns:minmax(200px,280px) minmax(0,1fr);gap:var(--rl-s4);align-items:start}',
      '.rl-wb__list{display:flex;flex-direction:column;gap:4px}',
      '.rl-wb__row{text-align:left;border:1px solid var(--rl-bd);background:var(--rl-surf);border-radius:var(--rl-r1);padding:8px 10px;cursor:pointer;color:inherit;font:inherit}',
      '.rl-wb__row[data-active="1"]{border-color:var(--rl-ac);background:var(--rl-surf2)}',
      '.rl-wb__rowTitle{font-weight:500;font-size:13px}',
      '.rl-wb__detail{border:1px solid var(--rl-bd);border-radius:var(--rl-r2);padding:var(--rl-s4);display:flex;flex-direction:column;gap:var(--rl-s3);min-height:160px}',
      '.rl-wb__rec{border-top:1px solid var(--rl-bd);padding-top:var(--rl-s3)}',
      '.rl-wb__dash{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--rl-s3)}',
      '.rl-page{display:flex;flex-direction:column;gap:var(--rl-s4)}',
      '.rl-page__head{display:flex;align-items:flex-end;justify-content:space-between;gap:var(--rl-s4);flex-wrap:wrap;padding-bottom:var(--rl-s3);border-bottom:1px solid var(--rl-bd)}',
      '.rl-page__title{font-size:17px;font-weight:600;letter-spacing:-.01em}',
      '.rl-page__sub{font-size:12px;color:var(--rl-mu);margin-top:2px}',
      '.rl-page__acts{display:flex;gap:var(--rl-s2);flex-wrap:wrap}',
      '.rl-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:var(--rl-s3)}',
      '.rl-kpi{border:1px solid var(--rl-bd);border-radius:var(--rl-r1);padding:7px 10px;background:var(--rl-surf)}',
      '.rl-kpi__n{font-size:18px;font-weight:600;line-height:1.25;font-variant-numeric:tabular-nums}',
      '.rl-kpi__u{font-size:11px;font-weight:400;color:var(--rl-mu);margin-left:2px}',
      '.rl-kpi__l{font-size:12px;color:var(--rl-mu)}',
      '.rl-section{display:flex;flex-direction:column;gap:var(--rl-s2)}',
      '.rl-section__head{display:flex;align-items:center;justify-content:space-between;gap:var(--rl-s2)}',
      '.rl-section__title{font-size:14px;font-weight:600}',
      '.rl-table{border:1px solid var(--rl-bd);border-radius:var(--rl-r2);overflow:hidden;background:var(--rl-surf)}',
      '.rl-table__row{display:grid;grid-template-columns:minmax(110px,1.1fr) 64px minmax(0,2.4fr) auto;gap:var(--rl-s3);align-items:center;padding:7px 10px;border-top:1px solid var(--rl-bd);font-size:12px}',
      '.rl-table__row:first-child{border-top:0}',
      '.rl-table__row--head{background:var(--rl-surf2);font-size:11px;color:var(--rl-mu);padding:6px 10px}',
      '.rl-table__proj{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.rl-table__act{display:flex;gap:6px;justify-content:flex-end}',
      '.rl-table__empty{padding:10px;font-size:12px;color:var(--rl-mu)}',
      '.rl-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--rl-s3) var(--rl-s4)}',
      '.rl-form__field{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.rl-form__label{font-size:12px;color:var(--rl-mu)}',
      '.rl-form__ok{position:sticky;bottom:0;background:var(--rl-surf);padding:var(--rl-s3) var(--rl-s5);border-top:1px solid var(--rl-bd);display:flex;gap:var(--rl-s2);justify-content:flex-end}',
      '.rl-dash{border:1px solid var(--rl-bd);border-radius:var(--rl-r2);padding:var(--rl-s3) var(--rl-s4);display:flex;flex-direction:column;gap:6px;background:var(--rl-surf);min-width:0}',
      '.rl-dash__head{display:flex;align-items:center;justify-content:space-between;gap:6px}',
      '.rl-dash__title{font-size:13px;font-weight:500}',
      '.rl-dash__body{display:flex;flex-direction:column;gap:6px;min-width:0}',
      '.rl-dash__item{font-size:12px;line-height:1.45;display:flex;gap:6px;align-items:flex-start}',
      '.rl-dash__item .rl-dash__txt{flex:1;min-width:0}',
      '.rl-dash__txt.rl-warn{color:var(--rl-warn);font-weight:600;background:color-mix(in srgb, var(--rl-warn) 18%, transparent);border-radius:4px;padding:0 5px}',
      '.rl-todos__proj{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:12em}',
      '.rl-tag{font-size:11px;padding:1px 6px;border-radius:999px;border:1px solid var(--rl-bd);color:var(--rl-mu);white-space:nowrap}',
      '.rl-tag[data-tone="warn"]{color:var(--rl-warn);border-color:var(--rl-warn);background:color-mix(in srgb, var(--rl-warn) 14%, transparent)}',
      '.rl-tag[data-tone="err"]{color:var(--rl-err);border-color:var(--rl-err);background:color-mix(in srgb, var(--rl-err) 14%, transparent)}',
      '.rl-stages{display:flex;flex-wrap:wrap;gap:6px}',
      '.rl-stage{font-size:11px;padding:3px 8px;border-radius:999px;border:1px solid var(--rl-bd);color:var(--rl-mu)}',
      '.rl-stage[data-state="done"]{background:var(--rl-surf2);color:var(--rl-tx)}',
      '.rl-stage[data-state="active"]{border-color:var(--rl-ac);color:var(--rl-tx);font-weight:500}',
      '.rl-warnbox{border:1px solid var(--rl-warn);border-radius:var(--rl-r1);padding:var(--rl-s3);display:flex;flex-direction:column;gap:var(--rl-s2);font-size:12px}',
      '.rl-wbmask{position:fixed;inset:0;background:rgba(10,12,16,.45);display:flex;align-items:center;justify-content:center;z-index:2147482000;padding:var(--rl-s6)}',
      '.rl-wbcard{background:var(--rl-bg);border:1px solid var(--rl-bd2);border-radius:var(--rl-r3);box-shadow:var(--rl-sh2);padding:var(--rl-s5);max-width:560px;width:100%;display:flex;flex-direction:column;gap:var(--rl-s3);max-height:80vh;overflow:auto}',
      '.rl-wbcard__title{font-size:14px;font-weight:500}',
      '.rl-wbcard__foot{display:flex;justify-content:flex-end;gap:var(--rl-s2);margin-top:var(--rl-s2)}',
      '.rl-list{margin:4px 0 0;padding-left:18px;font-size:12px;display:flex;flex-direction:column;gap:2px}',
    ].join('\n');

    var styleTag = null;
    function ensureStyle() {
      if (styleTag || typeof document === 'undefined') return;
      styleTag = document.createElement('style');
      styleTag.setAttribute('data-rl', PANEL_ID);
      styleTag.textContent = CSS;
      (document.head || document.documentElement).appendChild(styleTag);
    }

    /* ------------------------------------------------------------- 宿主调用 */

    function getSlots(ctx) {
      return ctx && typeof ctx.get === 'function' ? (ctx.get('slots') || ctx.slots) : (ctx && ctx.slots);
    }

    /**
     * 宿主半边（lib/index.js 那条链路，含 actions.js / library.js / import.js /
     * archive.js / refmeta.js）是 **Harness 启动时**读进内存的：
     * 只刷新页面拿到的是新客户端 + 旧宿主，点「归档/删除/导入」会收到
     * `未知动作：archive…`。这种错必须翻译成人话，否则用户只会觉得「点了没反应」。
     * （2026-10-11 用户真实踩到：输入了文件名，删除/归档都动不了。）
     */
    function withHostHint(msg) {
      var s = String(msg == null ? '' : msg);
      if (/未知动作|unknown action|不认识的?动作|unrecognized action/i.test(s)) {
        return s + '\u3000⟵ 这是旧宿主回的：改过 lib/*.js 之后要「重启 Harness」（关掉再打开），只刷新页面不够。';
      }
      return s;
    }

    function hostCall(ctx, action, args) {
      var conn = ctx && typeof ctx.get === 'function' ? ctx.get('connection') : undefined;
      var rpc = conn && conn.rpc;
      if (!rpc || typeof rpc.call !== 'function') {
        return Promise.reject(new Error('连接服务不可用：ctx.get("connection").rpc 缺失（面板无法访问科研库）'));
      }
      return Promise.resolve(rpc.call(CHANNEL, ENDPOINT, { action: action, args: args || {} })).then(function (res) {
        if (!res || typeof res !== 'object') throw new Error('宿主没有返回结果');
        if (res.ok !== true) throw new Error(withHostHint((res.error && res.error.message) || ('动作失败：' + action)));
        return res.value;
      });
    }

    var imgCache = new Map();

    /**
     * 缩略图缓存键。以前直接用 `fig.file` 当键：同一个路径的图被换成新版本后内容已经变了，
     * 面板却因为键没变而一直显示旧图（刷新页面也一样，缓存是模块级的）。键里带 bytes+mtime。
     */
    function figImgKey(fig) {
      return (fig && fig.file ? fig.file : '') + '@' + ((fig && fig.fileBytes) || 0) + '@' + ((fig && fig.fileMtime) || '');
    }

    function fmtBytes(n) {
      if (n == null) return '—';
      var v = Number(n);
      if (!isFinite(v)) return '—';
      if (v < 1024) return v + ' B';
      if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
      return (v / 1024 / 1024).toFixed(2) + ' MB';
    }

    function fmtTime(iso) {
      if (!iso) return '—';
      return String(iso).replace('T', ' ').slice(0, 19);
    }

    function confClass(conf) {
      if (conf === 'high') return 'rl-ok';
      if (conf === 'medium') return 'rl-idle';
      if (conf === 'low') return 'rl-warn';
      return 'rl-sub';
    }

    var TABS = [
      { id: 'figures', label: '图表' },
      { id: 'drafts', label: '草稿' },
      { id: 'refs', label: '文献' },
      { id: 'assets', label: '数据' },
      { id: 'journals', label: '期刊档案' },
      { id: 'submissions', label: '投稿' },
      { id: 'archive', label: '归档' },
    ];

    /** 搜索框要匹配的字段：一个条目命中任一字段就算命中。 */
    function filterSnap(snap, q) {
      var needle = String(q || '').trim().toLowerCase();
      if (!needle || !snap) return snap;
      var hit = function () {
        for (var i = 0; i < arguments.length; i += 1) {
          var v = arguments[i];
          if (v === null || v === undefined) continue;
          if (String(v).toLowerCase().indexOf(needle) >= 0) return true;
        }
        return false;
      };
      var projects = (snap.projects || []).map(function (p) {
        var out = {
          slug: p.slug, title: p.title, journal: p.journal, notes: p.notes,
          folders: p.folders || null,
          figures: (p.figures || []).filter(function (f) { return hit(f.figureId, f.graph, f.caption, f.file, f.sidecar); }),
          drafts: (p.drafts || []).filter(function (d) { return hit(d.name, d.path); }),
          datasets: (p.datasets || []).filter(function (d) { return hit(d.name, d.path); }),
          tables: (p.tables || []).filter(function (d) { return hit(d.name, d.path); }),
          opju: (p.opju || []).filter(function (d) { return hit(d.name, d.path); }),
        };
        out.__hit = hit(p.slug, p.title, p.journal, p.notes)
          || out.figures.length + out.drafts.length + out.datasets.length + out.tables.length + out.opju.length > 0;
        return out;
      }).filter(function (p) { return p.__hit; });
      return {
        root: snap.root, readAt: snap.readAt, indexAt: snap.indexAt, counts: snap.counts, warnings: snap.warnings,
        origin: snap.origin,
        projects: projects,
        refs: (snap.refs || []).filter(function (r) { return hit(r.key, r.title, r.container, r.doi, r.url, (r.authors || []).join(' '), (r.projects || []).join(' ')); }),
        pdfs: (snap.pdfs || []).filter(function (p) { return hit(p.name, p.path); }),
        journals: (snap.journals || []).filter(function (j) { return hit(j.id, j.name, j.nameZh, j.publisher, j.homepage, j.note); }),
        submissions: (snap.submissions || []).filter(function (x) { return hit(x.name, x.path, x.submissionId, x.title, x.journal, x.status); }),
      };
    }

    /* --------------------------------------------------------------- 小组件 */

    function Btn(props, label) {
      var rest = { type: 'button', className: 'rl-btn' + (props.primary ? ' rl-btn-primary' : '') };
      for (var k in props) if (k !== 'primary' && k !== 'children') rest[k] = props[k];
      // 注意：标签是**第二个参数**（`Btn({...}, '查看')`），不是 props.children——
      // 曾经漏了这个形参，所有按钮变成空壳（由 scripts/selftest-client.mjs 抓到）。
      return h('button', rest, label !== undefined ? label : props.children);
    }

    /** 弹层统一行为：Esc 关最上面那层；点遮罩空白处关闭。 */
    var ESC_STACK = [];
    function useEscape(active, fn) {
      var ref = React.useRef(fn);
      ref.current = fn;
      React.useEffect(function () {
        if (!active) return undefined;
        var entry = { fire: function () { try { ref.current(); } catch (e) { /* ignore */ } } };
        ESC_STACK.push(entry);
        function onKey(e) {
          if (!e || e.key !== 'Escape') return;
          var top = ESC_STACK[ESC_STACK.length - 1];
          if (!top) return;
          e.__rlEscHandled = true;
          try { e.preventDefault(); e.stopPropagation(); } catch (err) { /* ignore */ }
          top.fire();
        }
        var bound = typeof document !== 'undefined' && document && typeof document.addEventListener === 'function';
        if (bound) document.addEventListener('keydown', onKey);
        return function () {
          if (bound) { try { document.removeEventListener('keydown', onKey); } catch (e) { /* ignore */ } }
          var i = ESC_STACK.indexOf(entry);
          if (i >= 0) ESC_STACK.splice(i, 1);
        };
      }, [active]);
    }

    function onBackdrop(onClose) {
      return function (e) { if (e && e.target === e.currentTarget && typeof onClose === 'function') onClose(); };
    }

    function CopyBtn(props) {
      var state = React.useState('复制');
      var label = state[0], setLabel = state[1];
      return Btn({
        onClick: function () {
          try {
            navigator.clipboard.writeText(props.text).then(
              function () { setLabel('已复制'); setTimeout(function () { setLabel('复制'); }, 1500); },
              function () { setLabel('复制失败'); },
            );
          } catch (e) { setLabel('复制失败'); }
        },
      }, label);
    }

    function Card(props) {
      var open = props.open ? '1' : '0';
      return h('div', { className: 'rl-card', 'data-open': open }, props.children);
    }

    function KV(props) {
      return h('div', { className: 'rl-sub' },
        h('span', { className: 'rl-dim' }, props.k + '：'),
        props.mono ? h('span', { className: 'rl-mono' }, props.v) : h('span', null, props.v),
      );
    }

    /* -------------------------------------------------------- 写动作的零件 */

    /* 面板从 2026-10-11 起不再只读：导入 / 归档 / 真删 / 保存草稿 / 抓 DOI
       都走宿主动作。这里的规矩：
         - `act()` 永不抛（onClick 里没有 catch 兜底，抛出去就是静默失败）；
         - 每个条目的按钮组自己收忙/成/败三态，失败显示宿主原话；
         - 真删必须把文件名原样输入一次（用户定的口径），归档随时可恢复。 */

    /** 宿主调用，永不抛：{ok:true,value} / {ok:false,error}。 */
    function act(ctx, action, args) {
      return hostCall(ctx, action, args).then(
        function (v) { return { ok: true, value: v }; },
        function (e) { return { ok: false, error: String((e && e.message) || e || '失败') }; },
      );
    }

    var baseName = function (p) { return String(p || '').split('/').pop(); };

    /**
     * 拖进一批文件时先猜一个目标（用户可以在弹层里改）：
     * .csv/.tsv/.txt/.dat/.jdx/.xlsx → 数据（用户明确说过「.txt 也算数据」）；
     * 图片 → 图表；.md → 草稿；.pdf/.docx/.ris/.bib → 文献。
     * 整批只猜一个目标：取数量最多的那一类。
     */
    function guessTarget(files) {
      var hits = { data: 0, figures: 0, drafts: 0, refs: 0 };
      (files || []).forEach(function (f) {
        var n = String((f && f.name) || '').toLowerCase();
        if (/\.(csv|tsv|txt|dat|jdx|dx|xlsx?)$/.test(n)) hits.data += 1;
        else if (/\.(png|jpe?g|webp|gif|svg|tiff?|eps)$/.test(n)) hits.figures += 1;
        else if (/\.(md|markdown)$/.test(n)) hits.drafts += 1;
        else if (/\.(pdf|docx?|ris|bib|enw)$/.test(n)) hits.refs += 1;
      });
      var best = 'data';
      var top = 0;
      ['data', 'figures', 'drafts', 'refs'].forEach(function (k) { if (hits[k] > top) { top = hits[k]; best = k; } });
      return best;
    }

    /** 三态提示行：忙 / 成 / 败。 */
    function MsgLine(props) {
      var m = props.msg;
      if (!m) return null;
      if (m.busy) return h('div', { className: 'rl-sub' }, props.busyText || '处理中…');
      if (m.kind === 'err') return h('div', { className: 'rl-err' }, '✗ ' + m.text);
      return h('div', { className: 'rl-ok rl-sub' }, m.text || props.okText || '完成');
    }

    /**
     * 一个条目的写动作：归档（默认，可恢复）/ 真删（要输文件名）。
     * props: {ctx, entry:{path,sidecar,kind,label}, reason, onDone, size}
     */
    function EntryActions(props) {
      var st = React.useState({ busy: '', msg: null, ask: false, name: '' });
      var s = st[0], set = st[1];
      var patch = function (o) { set(function (prev) { return Object.assign({}, prev, o); }); };
      var entry = props.entry || {};
      var arg = { path: entry.path };
      if (entry.sidecar) arg.sidecar = entry.sidecar;
      if (entry.kind) arg.kind = entry.kind;
      if (entry.label) arg.label = entry.label;
      var want = baseName(entry.path);
      var note = props.reason || '面板归档';
      // 归档与真删写进 .research/archive/_removed/*.json 的 reason 字段，别都写成「…归档」——
      // 2026-10-11 实测记录里真删被记成「图表页归档」，回头查账会误判。（客户端改动，刷新页面即生效）
      var noteDel = /归档$/.test(note) ? note.replace(/归档$/, '删除') : (note + '·真删');

      var doArchive = function () {
        patch({ busy: 'archive', msg: { busy: true }, ask: false });
        act(props.ctx, 'archive', { entries: [arg], reason: note }).then(function (r) {
          patch({ busy: '', msg: r.ok ? { kind: 'ok', text: r.value.summary || ('已归档：' + want) } : { kind: 'err', text: r.error } });
          if (r.ok && props.onDone) props.onDone();
        });
      };
      var doRemove = function () {
        if (s.name !== want) { patch({ msg: { kind: 'err', text: '待删除项为「' + want + '」，请原样输入一次以确认。' } }); return; }
        patch({ busy: 'remove', msg: { busy: true } });
        act(props.ctx, 'remove', { entries: [arg], confirm: s.name, reason: noteDel }).then(function (r) {
          patch({ busy: '', ask: false, name: '', msg: r.ok ? { kind: 'ok', text: r.value.summary || ('已删除：' + want) } : { kind: 'err', text: r.error } });
          if (r.ok && props.onDone) props.onDone();
        });
      };

      return h('div', { className: 'rl-actions' }, [
        props.size ? h('span', { key: 'z', className: 'rl-sub' }, props.size) : null,
        Btn({ key: 'a', disabled: !!s.busy, 'data-rl-tour': 'archive', onClick: doArchive }, s.busy === 'archive' ? '归档中…' : '归档'),
        s.ask
          ? h('span', { key: 'ask', className: 'rl-row' }, [
            h('span', { key: 'l', className: 'rl-sub' }, '输入文件名以确认：'),
            h('input', {
              key: 'i', className: 'rl-name', value: s.name, placeholder: want,
              onChange: function (e) { patch({ name: e.target.value }); },
            }),
            Btn({ key: 'go', className: 'rl-btn--danger', disabled: !!s.busy || s.name !== want, onClick: doRemove }, s.busy === 'remove' ? '删除中…' : '真删'),
            Btn({ key: 'no', onClick: function () { patch({ ask: false, name: '', msg: null }); } }, '取消'),
          ])
          : Btn({ key: 'd', className: 'rl-btn--danger', disabled: !!s.busy, onClick: function () { patch({ ask: true, msg: null }); } }, '删除'),
        h(MsgLine, { key: 'm', msg: s.msg }),
      ]);
    }

    /**
     * 文献行：删的是**登记条目**（`refs/refs.json` 里的一条），没有对应磁盘文件，
     * 所以不能复用 `EntryActions`（那套是动文件的，而且登记索引在它的黑名单里）。
     * 走 `lib/actions.js` 的 `removeRef` → 库脚本 `research.py remove-ref`：
     * 面板仍然不直接改登记索引，删除由库脚本做（先备份 refs.json，再同步 refs.bib）。
     */
    function RefActions(props) {
      var st = React.useState({ ask: false, name: '', busy: false, msg: null });
      var s = st[0], set = st[1];
      var patch = function (o) { set(function (prev) { return Object.assign({}, prev, o); }); };
      var go = function () {
        if (s.name !== props.refKey) { patch({ msg: { kind: 'err', text: '要删的是引用键「' + props.refKey + '」，请原样输入一次以确认。' } }); return; }
        patch({ busy: true, msg: { busy: true } });
        act(props.ctx, 'removeRef', { key: props.refKey, reason: '文献页删除' }).then(function (r) {
          patch({ busy: false, ask: false, name: '', msg: r.ok ? { kind: 'ok', text: r.value.summary || '已删除' } : { kind: 'err', text: r.error } });
          if (r.ok && props.onReload) props.onReload();
        });
      };
      return h('div', { className: 'rl-actions' }, [
        s.ask
          ? h('span', { key: 'ask', className: 'rl-row' }, [
            h('span', { key: 'l', className: 'rl-sub' }, '输入引用键以确认：'),
            h('input', {
              key: 'i', className: 'rl-name', value: s.name, placeholder: props.refKey,
              onChange: function (e) { patch({ name: e.target.value }); },
            }),
            Btn({ key: 'go', className: 'rl-btn--danger', disabled: s.busy || s.name !== props.refKey, onClick: go }, s.busy ? '删除中…' : '真删条目'),
            Btn({ key: 'no', disabled: s.busy, onClick: function () { patch({ ask: false, name: '', msg: null }); } }, '取消'),
          ])
          : Btn({ key: 'd', className: 'rl-btn--danger', disabled: s.busy, onClick: function () { patch({ ask: true, msg: null }); } }, '删除'),
        h(MsgLine, { key: 'm', msg: s.msg }),
      ]);
    }

    /**
     * 点开看大图（缩略图 / 主件 / 附带件）。
     * 传 `src`=dataURL 直接用；传 `path` 则由宿主读盘（`readBinary`）——以前只认 `src`，
     * 而调用方（FileRow / AssetCard / 附带件）传的都是 `path` ⇒ 弹出的是一个 `src=undefined` 的空图。
     */
    function BigImage(props) {
      useEscape(true, props.onClose);
      var st = React.useState({ src: props.src || '', err: '', bytes: 0 });
      var s = st[0], set = st[1];
      React.useEffect(function () {
        if (props.src || !props.path) return undefined;
        var alive = true;
        hostCall(props.ctx, 'readBinary', { path: props.path }).then(
          function (v) { if (alive) set({ src: 'data:' + v.mime + ';base64,' + v.base64, err: '', bytes: v.bytes }); },
          function (e) { if (alive) set({ src: '', err: String((e && e.message) || e), bytes: 0 }); },
        );
        return function () { alive = false; };
      }, [props.src, props.path]);
      return h('div', { className: 'rl-zoom', onClick: props.onClose }, [
        h('div', { key: 'b', className: 'rl-zoom__box' }, [
          s.err ? h('div', { key: 'e', className: 'rl-err' }, '✗ ' + s.err)
            : (s.src
              ? h('img', { key: 'i', className: 'rl-zoom__img', src: s.src, alt: props.alt || '' })
              : h('div', { key: 'l', className: 'rl-sub' }, '正在读图…')),
          h('div', { key: 'c', className: 'rl-sub' }, (props.caption || props.path || '') + '　（点任意处关闭）'),
        ]),
      ]);
    }

    /** 点开看 PDF：宿主读盘给 base64，塞进 iframe（Chromium 自带阅读器）。 */
    function PdfView(props) {
      useEscape(true, props.onClose);
      var st = React.useState({ busy: true, src: '', err: '', bytes: 0 });
      var s = st[0], set = st[1];
      React.useEffect(function () {
        var alive = true;
        hostCall(props.ctx, 'readBinary', { path: props.path }).then(
          function (v) { if (alive) set({ busy: false, src: 'data:' + v.mime + ';base64,' + v.base64, err: '', bytes: v.bytes }); },
          function (e) { if (alive) set({ busy: false, src: '', err: String((e && e.message) || e), bytes: 0 }); },
        );
        return function () { alive = false; };
      }, [props.path]);
      return h('div', { className: 'rl-zoom', onClick: props.onClose }, [
        h('div', {
          key: 'b', className: 'rl-zoom__box',
          onClick: function (e) { if (e && typeof e.stopPropagation === 'function') e.stopPropagation(); },
        }, [
          h('div', { key: 'h', className: 'rl-sub' }, props.path + (s.bytes ? '（' + fmtBytes(s.bytes) + '）' : '') + '　（点空白处关闭）'),
          s.busy ? h('div', { key: 'l', className: 'rl-sub' }, '正在读 PDF…')
            : (s.err
              ? h('div', { key: 'e', className: 'rl-err' }, '✗ ' + s.err + '（文件较大，可用系统阅读器打开：' + (props.path || '') + '）')
              : h('iframe', { key: 'f', className: 'rl-zoom__frame', src: s.src, title: 'PDF 预览' })),
        ]),
      ]);
    }

    /**
     * 「归档」页签：归档批次（整批或单文件恢复）+ 真删记录（只留名字）。
     * props: {ctx, onDone}
     */
    function ArchiveTab(props) {
      var st = React.useState({ busy: true, info: null, err: '', msg: null });
      var s = st[0], set = st[1];
      var patch = function (o) { set(function (prev) { return Object.assign({}, prev, o); }); };
      var load = function () {
        patch({ busy: true });
        act(props.ctx, 'archiveInfo', {}).then(function (r) {
          if (r.ok) patch({ busy: false, info: r.value, err: '' });
          else patch({ busy: false, err: r.error });
        });
      };
      React.useEffect(function () { load(); }, []);
      var doRestore = function (id, paths) {
        patch({ busy: true, msg: { busy: true } });
        act(props.ctx, 'restore', { id: id, paths: paths }).then(function (r) {
          patch({ busy: false, msg: r.ok ? { kind: 'ok', text: r.value.summary || '已恢复' } : { kind: 'err', text: r.error } });
          // 恢复后必须让面板重读快照：否则数据页/图表页还停在归档前那一份索引上
          // （2026-10-11 真浏览器 E2E 抓到：文件已回到磁盘、归档页也说「已恢复」，
          //  但数据页那张卡不回来，因为 props 名那时写的是 onDone、面板传的是 onReload。）
          if (r.ok) { load(); var back = props.onReload || props.onDone; if (back) back(); }
        });
      };

      var info = s.info;
      var batches = (info && info.archives) || [];
      var removed = (info && info.removed) || [];
      return h('div', null, [
        h('div', { key: 'tip', className: 'rl-sub', style: { marginBottom: '8px' } },
          (info && info.note) || '归档 = 把文件移进 .research/archive/<时间戳>/（登记元数据不动），恢复就跑一次 reindex 回来。'),
        s.err ? h('div', { key: 'e', className: 'rl-err' }, '✗ ' + s.err) : null,
        h(MsgLine, { key: 'm', msg: s.msg }),
        s.busy && !batches.length ? h('div', { key: 'l', className: 'rl-empty' }, '正在读归档区…') : null,
        !s.busy && !batches.length && !s.err ? h('div', { key: 'none', className: 'rl-empty' }, '归档区是空的。') : null,
        batches.map(function (a) {
          return Card({ key: a.id, children: [
            h('div', { key: 'hd', className: 'rl-row' }, [
              h('div', { key: 'l' }, [
                h('strong', { key: 'i', className: 'rl-mono' }, a.id),
                h('span', { key: 's', className: 'rl-sub' }, ' · ' + fmtTime(a.at) + ' · ' + a.reason),
              ]),
              h('div', { key: 'r', className: 'rl-actions' }, [
                h('span', { key: 'c', className: 'rl-badge' }, '剩 ' + a.remaining + '/' + a.total),
                a.remaining ? Btn({ key: 'all', onClick: function () { doRestore(a.id, a.items.map(function (it) { return it.path; })); } }, '全部恢复') : null,
              ]),
            ]),
            !a.readable ? h('div', { key: 'nr', className: 'rl-warn' }, '该批次缺少 manifest.json，仅支持整批恢复。') : null,
            h('ul', { key: 'l', className: 'rl-files' }, a.items.map(function (it) {
              return h('li', { key: it.path, className: 'rl-row' }, [
                h('span', { key: 'p', className: 'rl-mono' }, it.path + (it.role === 'sidecar' ? '（侧车）' : '') + (it.bytes ? ' · ' + fmtBytes(it.bytes) : '')),
                Btn({ key: 'b', disabled: s.busy, onClick: function () { doRestore(a.id, [it.path]); } }, '恢复'),
              ]);
            })),
          ] });
        }),
        removed.length ? h('div', { key: 'rm', style: { marginTop: '12px' } }, [
          h('div', { key: 'h', className: 'rl-sub' }, '真删记录（仅保留文件名，不进回收站，无法恢复）：'),
          h('ul', { key: 'l', className: 'rl-files' }, removed.map(function (r) {
            return h('li', { key: r.id, className: 'rl-mono' }, r.id + ' · ' + (r.reason || '') + ' · ' + (r.items || []).map(function (x) { return x.path; }).join('、'));
          })),
        ]) : null,
      ]);
    }

    /* 投稿页的「体检 / 打包」：判断在 research.py 里，面板只显示结果。
       体检逐条给 pass/warn/fail/na；打包回一个库内 zip 路径。 */
    function SubmissionTools(props) {
      var st = React.useState({ busy: '', report: null, pkg: null, err: '' });
      var s = st[0], set = st[1];
      var patch = function (o) { set(function (prev) { return Object.assign({}, prev, o); }); };
      var sub = props.sub;
      var runCheck = function () {
        patch({ busy: 'check', err: '' });
        act(props.ctx, 'checkJournal', {
          project: sub.project, journal: sub.journal || '', submission: sub.submissionId,
        }).then(function (r) {
          if (r.ok) patch({ busy: '', report: r.value });
          else patch({ busy: '', err: r.error });
        });
      };
      var runExport = function () {
        patch({ busy: 'export', err: '' });
        act(props.ctx, 'exportPackage', {
          project: sub.project, journal: sub.journal || '', submission: sub.submissionId,
        }).then(function (r) {
          if (r.ok) patch({ busy: '', pkg: r.value });
          else patch({ busy: '', err: r.error });
        });
      };
      var report = s.report;
      var counts = (report && report.counts) || null;
      var notable = report ? report.checks.filter(function (c) { return c.status === 'fail' || c.status === 'warn'; }) : [];
      return h('div', { style: { marginTop: '6px' } }, [
        s.err ? h('div', { key: 'e', className: 'rl-err' }, '✗ ' + s.err) : null,
        h('div', { key: 'b', className: 'rl-actions' }, [
          sub.project ? Btn({ key: 'c', disabled: !!s.busy, onClick: runCheck }, s.busy === 'check' ? '体检中…' : '合规体检') : null,
          sub.project ? Btn({ key: 'x', disabled: !!s.busy, onClick: runExport }, s.busy === 'export' ? '打包中…' : '导出投稿包') : null,
        ]),
        counts ? h('div', { key: 'r', className: 'rl-sub', style: { marginTop: '4px' } }, [
          h('span', { key: 'j', className: 'rl-mono' }, (report.journalName || report.journal || '期刊') + ' · '),
          h('span', { key: 'p', className: 'rl-ok' }, counts.pass + ' 通过'),
          h('span', { key: 'w' }, ' · ' + counts.warn + ' 提醒'),
          h('span', { key: 'f', className: counts.fail ? 'rl-err' : '' }, ' · ' + counts.fail + ' 不合格'),
          h('span', { key: 'n', className: 'rl-dim' }, ' · ' + counts.na + ' 未检'),
        ]) : null,
        notable.length ? h('ul', { key: 'l', className: 'rl-files' }, notable.map(function (c, i) {
          return h('li', { key: i, className: c.status === 'fail' ? 'rl-err' : 'rl-warn' },
            (c.status === 'fail' ? '✗ ' : '! ') + c.label + '：' + c.detail);
        })) : null,
        report && !notable.length ? h('div', { key: 'ok', className: 'rl-ok' }, '没有不合格项。') : null,
        report && report.disclaimer ? h('div', { key: 'd', className: 'rl-sub rl-dim', style: { marginTop: '2px' } }, report.disclaimer) : null,
        s.pkg ? h('div', { key: 'pkg', className: 'rl-sub', style: { marginTop: '4px' } }, [
          h('div', { key: 't', className: 'rl-ok' }, '已导出 ' + s.pkg.files + ' 个文件 · ' + fmtBytes(s.pkg.bytes)),
          h('div', { key: 'p', className: 'rl-mono' }, s.pkg.package),
          h('div', { key: 'c', style: { marginTop: '2px' } }, h(CopyBtn, { text: s.pkg.package })),
        ]) : null,
      ]);
    }

    /* -------------------------------------------------------------- 新手引导 */
    /* 与 StudyHub 的分步导览同形：首次打开给一张欢迎卡，导览是一串「高亮锚点 + 说明卡」
       的步骤（锚点用 data-rl-tour 属性找），进度写 localStorage，任何时候能从标题右边
       的「引导」重来。面板只说自己的事：读的是哪个库、七个页签各看什么、写入能做什么、
       边界在哪（同名不覆盖 / 归档可恢复 / 真删要输名字 / 文档写入先备份）。
       全部浏览器 API 都做特性探测——scripts/selftest-client.mjs 用的是微缩 React +
       没有 localStorage/querySelector 的假 DOM，探测不到就退化成「居中说明卡」。 */

    var LS_PREFIX = 'research-panel-setup:';

    function lsGet(key) {
      try {
        if (typeof localStorage === 'undefined' || !localStorage) return null;
        return localStorage.getItem(LS_PREFIX + key + ':local');
      } catch (e) { return null; }   // 无痕模式/禁用存储：降级成「每次打开都提示」
    }

    function lsSet(key, value) {
      try {
        if (typeof localStorage === 'undefined' || !localStorage) return;
        localStorage.setItem(LS_PREFIX + key + ':local', value);
      } catch (e) { /* 存不下就不存，不影响使用 */ }
    }

    var TOUR_STEPS = [
      {
        id: 'what', anchor: null,
        title: '科研库 · 总览',
        body: '在侧栏打开「科研库」即进入本面板。面板读取当前库根下的课题、图、草稿、文献、数据、期刊档案与投稿；导入与归档亦在此完成。',
        note: '导览按页签顺序说明各页签与写操作，可随时「跳过」；再次查看可点标题右侧的「引导」。',
      },
      {
        id: 'head', anchor: 'head',
        title: '顶部：新建课题 / 命令台 / 引导 / 刷新',
        body: '面板仅在打开、点「刷新」或执行写操作时读取库内容，不做后台轮询。智能体修改库后，点「刷新」即可同步。「引导」为重新打开本导览的入口。',
        note: '新建课题为写操作：会在库中创建目录并调用库脚本登记（详见第 3 步）。导入入口位于空状态、拖拽区与 v2 工作台。',
      },
      {
        id: 'import', anchor: 'import',
        title: '导入文件 / 新建课题',
        body: '点「导入」或将文件拖入面板，选择去处（文献 / 数据 / 图片 / 草稿 / 新课题 / 投稿）并挑选文件（亦可仅填本机路径），确认后写入库并登记。数据 / 图片 / 草稿可填「子目录」（如「样品-批号」或「年份/子批」，最多三层），便于按批次分目录存放。',
        note: '文献可由「抓取 DOI」联网补全元数据（CrossRef，仅点击时联网）；同名文件自动追加 -1 / -2 后缀，不覆盖。批量拖入时按扩展名推断去处（.txt 归为数据），导入前仍可逐项调整。',
      },
      {
        id: 'root', anchor: 'root',
        title: '库根目录（面板读取范围）',
        body: '全部内容来自该库根下的 projects / drafts / refs / journals / submissions。路径不符时，说明当前会话指向另一个库。',
        note: '更换库根需在会话中指定；面板不提供切换入口。',
      },
      {
        id: 'counts', anchor: 'counts',
        title: '计数行：库规模与索引时间',
        body: '课题 / 图 / 草稿 / 数据 / 文献 / 期刊档案 / 投稿 的数量，其后为索引时间。数量不变通常表示最近产物尚未登记入库。',
        note: '黄色标注为提示级告警（如 confidence=low、图文件缺失），非错误；可在对应页签查看细节。',
      },
      {
        id: 'tabs', anchor: 'tabs',
        title: '七个页签：库的七个切面',
        body: '图表 / 草稿 / 文献 / 数据 / 期刊档案 / 投稿 / 归档。以下逐个说明；每步会自动切换到对应页签。',
      },
      {
        id: 'tab-figures', anchor: 'tab:figures', tab: 'figures',
        title: '图表页：课题下的每一张图',
        body: '按课题分组，每行一图：图号、图型、图注、源数据状态、verify 徽章（出图自检结果）、文件大小。',
        note: '点「展开」看全：图文件路径、侧车 JSON、源数据、图注、绘图参数；有图文件就会出来缩略图，点开看大图。图表 / 草稿 / 数据三页都按你在库里的子文件夹分组（组头能点着折叠，写清这一组有几个文件）。',
      },
      {
        id: 'tab-drafts', anchor: 'tab:drafts', tab: 'drafts',
        title: '草稿页：新建、预览、引用核查、就地改稿',
        body: '顶部「新建草稿」创建空白 .md（仅创建不存在的文件名）；「预览」读取正文，「引用核查」扫描 [@key] 与 \\cite{} 并列出库中不存在的引用键，「编辑」可就地修改并保存。',
        note: '保存前宿主将原稿复制为同名 .bak（覆盖上一份备份）再写入新内容，可随时恢复。核查仅确认引用键存在于库中，不证明被引文献支持该论点。',
      },
      {
        id: 'tab-refs', anchor: 'tab:refs', tab: 'refs',
        title: '文献页：refs.json 的台账',
        body: '每一条文献的键、年份、作者 / 标题、出处、DOI，以及「核验」列——写清这条是谁验的（智能体核过还是只是登记）。',
        note: '引用零编造：正文引用前先在库中登记该文献（由智能体执行 add-ref），再写引用键。',
      },
      {
        id: 'tab-assets', anchor: 'tab:assets', tab: 'assets',
        title: '数据页：数据集概览',
        body: '每个课题的数据集、表格与 Origin 工程（.opju）。「查看」读取表头与内容开头，用于确认数据存在且列名匹配；「变换」对指定数值列执行平滑 / 归一化 / 求导 / 插值并另存为新文件（原始数据不变）。',
        note: '数据页按入库时的文件夹分组，组头可展开 / 折叠。出图请由智能体经 Origin 完成（面板自 2026-10-13 起不再出图）。',
      },
      {
        id: 'tab-journals', anchor: 'tab:journals', tab: 'journals',
        title: '期刊档案页：投稿规范档案',
        body: '每份档案是一个期刊 / 会议的硬性投稿规范：篇幅、图表、参考文献格式等，附核验时间与出处链接。',
        note: 'confidence 是这份档案的可信度（high/medium/low），不是期刊等级；抓不到的数值留 null，宁缺勿猜。',
      },
      {
        id: 'tab-submissions', anchor: 'tab:submissions', tab: 'submissions',
        title: '投稿页：submissions/ 台账',
        body: '每条投稿的状态、稿件号 / DOI、下一步动作与截止（过期标红）、事件数、最近一次事件。',
        note: '状态变更由 update-submission 执行；本面板仅展示台账。',
      },
      {
        id: 'tab-archive', anchor: 'tab:archive', tab: 'archive',
        title: '归档页：面板动过的文件都在这儿',
        body: '在面板里归档的东西会移到 .research/archive/<时间戳>/，每批都能看清单、「恢复」搬回原位；真删掉的会在下面留一条记录（真删不进系统回收站）。',
        note: '归档与删除仅移动或移除磁盘文件，不改动 refs.json 与投稿台账等登记记录，恢复后登记仍一致。真删需原样输入文件名。',
      },
      {
        id: 'foot', anchor: 'foot',
        title: '页脚：读于什么时候 + 写入边界',
        body: '左侧为本次读取时间；右侧说明写入边界：导入会落文件并登记，归档至 .research/archive/（可恢复），真删需输入文件名且不进回收站。',
        note: '更复杂的写入（改投稿状态、合并文献、重建索引）仍由智能体执行 research.py。',
      },
      {
        id: 'end', anchor: null,
        title: '记住三件事即可',
        body: '① 查看：七个页签 + 顶部计数行 + 黄色告警；② 写入：导入 / 新建课题 / 归档 / 就地改草稿均在面板内完成，写后点「刷新」核对；③ 重看导览：点标题右侧「引导」。',
        note: '具体每一步要看什么，随时回到对应页签即可——面板里的每条信息都写了来源路径。',
      },
    ];

    function viewSize() {
      var w = 1280, ht = 800;
      try {
        if (typeof window !== 'undefined' && window) {
          if (window.innerWidth) w = window.innerWidth;
          if (window.innerHeight) ht = window.innerHeight;
        }
      } catch (e) { /* 用默认值 */ }
      return { w: w, h: ht };
    }

    /** 把说明卡摆在锚点旁边；量不到锚点（或上下都放不下）就居中。 */
    function placePopover(rect, vw, vh) {
      // EST = 说明卡高度的保守估计，只用来夹取位置，真实高度由浏览器排版决定。
      // 不夹的话，矮窗口里「锚点下面」这一支会把卡顶出屏幕（真浏览器实测踩过）。
      var W = 360, GAP = 12, M = 16, EST = 260;
      if (!rect) return { docked: true, style: {} };
      var left = Math.round(rect.left + rect.width / 2 - W / 2);
      var maxLeft = Math.max(M, vw - W - M);
      left = Math.max(M, Math.min(left, maxLeft));
      if (rect.bottom + GAP + 120 <= vh) {
        var top = Math.round(rect.bottom + GAP);
        return { docked: false, style: { left: left, top: Math.max(M, Math.min(top, Math.max(M, vh - EST - M))) } };
      }
      var bottom = Math.round(Math.max(M, vh - rect.top + GAP));
      return { docked: false, style: { left: left, bottom: Math.min(bottom, Math.max(M, vh - EST - M)) } };
    }

    /**
     * 聚光灯要挖的洞。锚点本身比视口还高时（比如整块正文区），照它的矩形挖等于没挖，
     * 说明卡也会被顶到屏幕外 —— 所以只挖顶部一条带，卡就摆在带子下面。
     */
    function spotRect(rect, vh) {
      if (!rect) return null;
      var maxH = Math.max(120, Math.round(vh * 0.42));
      if (rect.height <= maxH) return rect;
      return {
        top: rect.top, left: rect.left, width: rect.width, height: maxH,
        bottom: rect.top + maxH, right: rect.right, band: true,
      };
    }

    /** 找锚点并量它的位置；找不到 / 量不了就返回 null（导览退化成居中卡）。 */
    function measureAnchor(anchor) {
      if (!anchor) return null;
      if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return null;
      var el = null;
      try { el = document.querySelector('[data-rl-tour="' + anchor + '"]'); } catch (e) { return null; }
      if (!el || typeof el.getBoundingClientRect !== 'function') return null;
      try {
        if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', inline: 'nearest' });
        var r = el.getBoundingClientRect();
        if (!r || (!r.width && !r.height)) return null;
        return { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
      } catch (e) { return null; }
    }

    function WelcomeCard(props) {
      var cards = [
        { t: '① 总览', d: '七个页签：图表 / 草稿 / 文献 / 数据 / 期刊档案 / 投稿 / 归档。先看顶部计数行与黄色告警，再进入各页签。' },
        { t: '② 读取与写入', d: '读取：图 / 草稿 / PDF 直接查看。写入：导入、新建课题、归档、就地改草稿，均经库脚本执行，不改登记索引。' },
        { t: '③ 写入边界', d: '同名文件不覆盖；归档至 .research/archive/ 可恢复；真删需输入文件名且不进回收站；文档写入前备份 .bak。' },
      ];
      return h('div', { className: 'rl-welcome', 'data-rl-tour': 'welcome' }, [
        h('h2', { key: 't', style: { margin: '2px 0 4px', fontSize: '15px' } }, '欢迎使用科研库面板'),
        h('p', { key: 'l', className: 'rl-welcome__lead' },
          '本面板汇总当前库根下的课题、图、草稿、文献、数据、期刊档案与投稿；数据只读，路径见标题行。'),
        h('div', { key: 'c', className: 'rl-welcome__cards' }, cards.map(function (c, i) {
          return h('div', { key: i, className: 'rl-welcome__card' }, [
            h('h3', { key: 'h' }, c.t),
            h('p', { key: 'p' }, c.d),
          ]);
        })),
        h('div', { key: 'a', className: 'rl-actions' }, [
          Btn({ key: 'tour', primary: true, onClick: props.onTour }, '看导览（' + TOUR_STEPS.length + ' 步）'),
          Btn({ key: 'later', onClick: props.onDismiss }, '我自己看'),
        ]),
        h('div', { key: 'f', className: 'rl-welcome__foot', style: { marginTop: '10px' } },
          '以后想重看这段导览：点标题右边的「引导」。'),
      ]);
    }

    function TourOverlay(props) {
      var step = props.step, index = props.index, total = props.total;
      var size = viewSize();
      var spot = spotRect(props.rect, size.h);
      var place = placePopover(spot, size.w, size.h);
      var pct = Math.round(((index + 1) / total) * 100);
      var pop = h('div', {
        key: 'pop',
        className: 'rl-tour-pop' + (place.docked ? ' rl-tour-pop--docked' : ''),
        style: place.style,
        role: 'dialog',
        'aria-modal': 'false',
        'aria-label': '科研库面板功能导览',
      }, [
        h('div', { key: 'head', className: 'rl-tour-pop__head' }, [
          h('span', { key: 'a' }, '功能导览'),
          h('span', { key: 'b', className: 'rl-tour-pop__count' }, (index + 1) + ' / ' + total),
        ]),
        h('div', { key: 'meter', className: 'rl-tour-pop__meter' }, h('i', { style: { width: pct + '%' } })),
        h('h2', { key: 'title', className: 'rl-tour-pop__title' }, step.title),
        h('p', { key: 'body', className: 'rl-tour-pop__body' }, step.body),
        step.note ? h('p', { key: 'note', className: 'rl-tour-pop__note' }, step.note) : null,
        h('div', { key: 'foot', className: 'rl-tour-pop__foot' }, [
          Btn({ key: 'skip', onClick: props.onSkip }, '跳过'),
          h('span', { key: 'sp', className: 'rl-tour-pop__spacer' }),
          index > 0 ? Btn({ key: 'back', onClick: props.onBack }, '上一步') : null,
          Btn({ key: 'next', primary: true, onClick: props.onNext }, index >= total - 1 ? '完成' : '下一步'),
        ]),
      ]);
      var kids = [];
      if (spot) {
        kids.push(h('div', {
          key: 'spot',
          className: 'rl-tour-spot',
          style: { left: spot.left, top: spot.top, width: spot.width, height: spot.height },
        }));
      }
      kids.push(pop);
      return h('div', { className: 'rl-tour-layer', 'data-rl-tour': 'layer' }, kids);
    }

    /* ------------------------------------------------------------------ 导入 */

    /** 六个导入目标（与宿主 lib/import.js 的 TARGETS 一一对应）。 */
    var IMPORT_TARGETS = [
      { id: 'refs', label: '文献', hint: '必须带 DOI 或 URL 才登记（引用零编造）；PDF 可选，会落到 refs/pdf/。' },
      { id: 'data', label: '数据', hint: '落到 projects/<课题>/data/（可再填一个子目录，如 样品-批号），然后重建索引。' },
      { id: 'figures', label: '图片', hint: '落到 projects/<课题>/figures/（可填子目录），并登记出图溯源（图注 / 源数据 / Origin 图页）。' },
      { id: 'drafts', label: '草稿', hint: '落到 projects/<课题>/drafts/（可填子目录），草稿页立刻能预览；想从零开始就在草稿页点「新建草稿」。' },
      { id: 'project', label: '新课题', hint: '建骨架（data/figures/origin/drafts/notes/tables）并写 project.json。其中 slug = 课题目录名（英文字母/数字与 - _ .），会落到 projects/<slug>/，以后到处都用它引用这个课题；中文标题填在下面的「标题」里。' },
      { id: 'submission', label: '投稿', hint: '记一条投稿台账（期刊档案 / 状态 / 稿件号 / 下一步）。' },
    ];

    /** 支持「落到哪个子目录」的目标（与宿主 import.js 的 SUBDIR_TARGETS 一致）。 */
    var SUBDIR_TARGET_IDS = ['data', 'figures', 'drafts'];

    /** 单文件上限，与宿主 LIMITS.fileBytes 一致；超了就让用户改用「本机路径」。 */
    var IMPORT_MAX_BYTES = 32 * 1024 * 1024;

    /** 二进制字符串 → base64（浏览器 btoa / node Buffer 都认）。 */
    function b64encode(binary) {
      if (typeof btoa === 'function') return btoa(binary);
      return Buffer.from(binary, 'binary').toString('base64');
    }

    /** ArrayBuffer → base64，分块拼接（大文件一次性 apply 会爆调用栈）。 */
    function toBase64(buf) {
      var bytes = new Uint8Array(buf);
      var chunk = 0x8000, out = '';
      for (var i = 0; i < bytes.length; i += chunk) {
        out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
      }
      return b64encode(out);
    }

    /** 读一个浏览器选中的文件并编码；超过上限直接拒绝（不让浏览器硬扛）。 */
    function readOneFile(file, max) {
      var limit = max || IMPORT_MAX_BYTES;
      if (!file || typeof file !== 'object') return Promise.reject(new Error('没有选中文件'));
      if (file.size > limit) {
        return Promise.reject(new Error('文件较大：' + file.name + '（' + fmtBytes(file.size) + ' > 上限 ' + fmtBytes(limit) + '）——大文件请用下面的「本机路径」方式。'));
      }
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onerror = function () { reject(new Error('读文件失败：' + file.name)); };
        reader.onload = function () {
          try {
            var buf = reader.result;
            resolve({ name: String(file.name || 'unnamed'), base64: toBase64(buf), bytes: buf.byteLength });
          } catch (e) { reject(e); }
        };
        reader.readAsArrayBuffer(file);
      });
    }

    /**
     * 表单 + 已读文件 → 宿主 `import` 动作的 spec（纯函数，自检直接测）。
     * 空字段一律**不发**，让宿主那边的默认值生效（少传比传空串安全）。
     */
    function buildImportSpec(target, form, files) {
      var f = form || {};
      var meta = {};
      var put = function (key, value) {
        var v = (value == null ? '' : String(value)).trim();
        if (v !== '') meta[key] = v;
      };
      if (target === 'refs') {
        put('title', f.title); put('authors', f.authors); put('year', f.year);
        put('container', f.container); put('doi', f.doi); put('url', f.url);
        put('type', f.type); put('notes', f.notes);
      } else if (target === 'figures') {
        put('caption', f.caption); put('graph', f.graph); put('journal', f.journal);
        var datas = String(f.data || '').split(/\r?\n|,/).map(function (s) { return s.trim(); }).filter(Boolean);
        if (datas.length) meta.data = datas;
      } else if (target === 'project') {
        put('slug', f.slug); put('title', f.title); put('journal', f.journal);
      } else if (target === 'submission') {
        put('journal', f.journal); put('title', f.title); put('type', f.type); put('status', f.status);
        put('manuscriptId', f.manuscriptId); put('nextAction', f.nextAction);
        put('nextActionDue', f.nextActionDue); put('note', f.note);
      }
      var spec = {
        target: target,
        project: String(f.project || '').trim(),
        files: Array.isArray(files) ? files : [],
        paths: String(f.paths || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean),
        meta: meta,
      };
      // 子目录只有数据 / 图表 / 草稿支持（宿主也认这一条，别的地方给了会被拒）
      if (SUBDIR_TARGET_IDS.indexOf(target) >= 0) {
        var sub = String(f.subdir == null ? '' : f.subdir).trim();
        if (sub) spec.subdir = sub;
      }
      return spec;
    }

    /** 提交前的客户端体检；返回错误文案或 null。 */
    function validateImport(spec) {
      var meta = spec.meta || {};
      var n = (spec.files || []).length + (spec.paths || []).length;
      if (spec.target === 'refs') {
        if (!meta.title) return '文献至少要填标题';
        if (!meta.doi && !meta.url) return '没有 DOI 也没有 URL 的记录不入库（引用零编造）——补一个再来';
      }
      if (spec.target === 'data' || spec.target === 'figures' || spec.target === 'drafts') {
        if (!spec.project) return '先选一个课题（没有课题就先建：导入目标选「新课题」）';
      }
      if (spec.subdir) {
        if (/^[A-Za-z]:/.test(spec.subdir) || /(^|\/)\.\.?(\/|$)/.test(spec.subdir)) {
          return '子目录只能是课题内的相对路径（不能写盘符或 ..）';
        }
        if (spec.subdir.replace(/\\/g, '/').split('/').filter(Boolean).length > 3) return '子目录最多 3 层';
      }
      if (spec.target === 'figures' && !n) return '至少选一张图片（或填一个本机图片路径）';
      if (spec.target !== 'refs' && spec.target !== 'submission' && spec.target !== 'project' && !n) {
        return '至少选一个文件（或填一个本机路径）';
      }
      if (spec.target === 'project' && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(meta.slug || '')) {
        return '课题 slug 只能是字母数字与 - _ .（60 字符内，字母数字开头）';
      }
      if (spec.target === 'submission' && !meta.journal) return '投稿必须指定一份期刊档案';
      // 文献：--year 在 CLI 侧是 type=int，旧实现把非数字清洗成空串再传过去 → 直接 cli-failed
      if (spec.target === 'refs' && String(meta.year || '').trim() && !/^\d{1,4}$/.test(String(meta.year).trim())) {
        return '年份只能是数字（如 2026）';
      }
      // 投稿：--next-action-due 给错格式同样会被 CLI 拒
      if (spec.target === 'submission' && String(meta.nextActionDue || '').trim()
          && !/^\d{4}-\d{2}-\d{2}$/.test(String(meta.nextActionDue).trim())) {
        return '截止要写成 YYYY-MM-DD（或留空）';
      }
      return null;
    }

    /**
     * 导入弹层：一个表单按目标换字段。
     * 文件两条路 —— 浏览器选择（小文件，base64 走 RPC）或本机绝对路径
     * （大文件，宿主直接读盘，浏览器不碰内容）。
     */
    function ImportModal(props) {
      useEscape(true, props.onClose);
      var ctx = props.ctx;
      var snap = props.snap || {};
      var targetState = React.useState(props.initialTarget || 'refs');
      var target = targetState[0], setTarget = targetState[1];
      var formState = React.useState({});
      var form = formState[0], setForm = formState[1];
      var filesState = React.useState(props.initialFiles || []);
      var files = filesState[0], setFiles = filesState[1];
      var busyState = React.useState(false);
      var busy = busyState[0], setBusy = busyState[1];
      var msgState = React.useState(null);
      var msg = msgState[0], setMsg = msgState[1];
      var infoState = React.useState(null);
      var info = infoState[0], setInfo = infoState[1];
      // 默认只露必填项：作者/年份/出处/子目录这些折叠在「更多选项」里
      var moreState = React.useState(false);
      var moreOpen = moreState[0], setMoreOpen = moreState[1];
      // 去处默认由文件自动判定；要手动换才展开那一排按钮
      var showTargetsState = React.useState(Boolean(props.initialTarget && props.initialTarget !== 'refs'));
      var showTargets = showTargetsState[0], setShowTargets = showTargetsState[1];

      React.useEffect(function () {
        hostCall(ctx, 'importInfo').then(function (v) { setInfo(v); }, function () { setInfo({}); });
      }, []);

      /**
       * 课题自动选中：上次导入用过的那个（存在才算），否则库里只有一个课题就用它。
       * 目的是「拖进来 → 点导入」两步走完，不用每次去下拉框翻。
       */
      React.useEffect(function () {
        // 「新课题 / 投稿」弹层里的 project 是另一个意思（已存在的课题 / 关联课题），别自动填
        var t0 = props.initialTarget || 'refs';
        if (t0 === 'project' || t0 === 'submission') return;
        var known = (snap.projects || []).map(function (p) { return p.slug; });
        var remembered = lsGet('import-project');
        var pick = '';
        if (remembered && known.indexOf(remembered) >= 0) pick = remembered;
        else if (known.length === 1) pick = known[0];
        if (!pick) return;
        setForm(function (prev) {
          if (prev.project) return prev;
          var next = {};
          for (var k in prev) next[k] = prev[k];
          next.project = pick;
          return next;
        });
      }, []);

      /**
       * 拖进来的是一批原生 File 对象 —— 它们过不了 RPC（JSON 化之后是 {}），
       * 必须先在浏览器里读成 base64。每个文件按扩展名猜一个去处，之后可以逐个改。
       */
      React.useEffect(function () {
        var raw = props.initialFiles || [];
        var needRead = raw.filter(function (f) { return f && typeof f === 'object' && !f.base64 && f.name; });
        if (!needRead.length) return;
        if (typeof FileReader === 'undefined') {
          setMsg({ kind: 'err', text: '这个浏览器里读不了拖进来的文件：请用下面的「文件」按钮选一次。' });
          return;
        }
        setBusy(true);
        Promise.all(needRead.map(function (f) {
          return readOneFile(f, maxBytes).then(function (r) {
            r.target = guessTarget([f]);
            return r;
          });
        })).then(function (arr) {
          setBusy(false);
          setFiles(arr);
        }, function (e) {
          setBusy(false);
          setMsg({ kind: 'err', text: String((e && e.message) || e) });
        });
      }, []);

      var meta = IMPORT_TARGETS.filter(function (t) { return t.id === target; })[0] || IMPORT_TARGETS[0];
      var projects = (snap.projects || []).map(function (p) { return { id: p.slug, label: (p.title || p.slug) + '（' + p.slug + '）' }; });
      var journals = (snap.journals || []).map(function (j) { return { id: j.id, label: (j.name || j.id) + (j.nameZh ? ' · ' + j.nameZh : '') }; });
      var accept = (info && info.accept && info.accept[target]) || [];
      var maxBytes = (info && info.limits && info.limits.fileBytes) || IMPORT_MAX_BYTES;

      function setField(key, value) {
        setForm(function (prev) {
          var next = {};
          for (var k in prev) next[k] = prev[k];
          next[key] = value;
          return next;
        });
      }

      function switchTarget(id) {
        if (id === target) return;
        setTarget(id); setMsg(null); setFiles([]);
      }

      function pickFiles(event) {
        var list = Array.prototype.slice.call((event && event.target && event.target.files) || []);
        if (!list.length) return;
        setBusy(true); setMsg(null);
        Promise.all(list.map(function (f) { return readOneFile(f, maxBytes); })).then(
          function (arr) {
            setBusy(false);
            // 整批文件同类就自动换到对应去处；混着才沿用当前下来逐个改
            var first = guessTarget([arr[0]]);
            var same = arr.every(function (f) { return guessTarget([f]) === first; });
            var auto = same ? first : target;
            if (auto !== target) setTarget(auto);
            setFiles(arr.map(function (f) { return Object.assign({}, f, { target: auto }); }));
          },
          function (e) { setBusy(false); setMsg({ kind: 'err', text: String((e && e.message) || e) }); },
        );
      }

      function setFileTarget(index, id) {
        setFiles(files.map(function (f, i) { return i === index ? Object.assign({}, f, { target: id }) : f; }));
      }

      function labelOf(id) {
        var t = IMPORT_TARGETS.filter(function (x) { return x.id === id; })[0];
        return t ? t.label : id;
      }

      /** 按每个文件的去处分组——宿主一次 import 只处理一个目标。 */
      function groupFiles() {
        var order = [];
        var bucket = {};
        files.forEach(function (f) {
          var t = f.target || target;
          if (!bucket[t]) { bucket[t] = []; order.push(t); }
          bucket[t].push(f);
        });
        return order.map(function (t) { return { target: t, files: bucket[t] }; });
      }

      function fetchMeta() {
        var doi = String(form.doi || '').trim();
        if (!doi) { setMsg({ kind: 'err', text: '先填 DOI，再点「抓取」。' }); return; }
        setBusy(true); setMsg(null);
        act(ctx, 'fetchRefMeta', { doi: doi }).then(function (r) {
          setBusy(false);
          if (!r.ok) { setMsg({ kind: 'err', text: r.error }); return; }
          var v = r.value || {};
          setForm(function (prev) {
            var next = {};
            for (var k in prev) next[k] = prev[k];
            if (v.title) next.title = v.title;
            if (v.authorText) next.authors = v.authorText;
            if (v.year) next.year = String(v.year);
            if (v.container) next.container = v.container;
            if (v.url && !next.url) next.url = v.url;
            if (v.type) next.type = v.type;
            return next;
          });
          setMsg({ kind: 'ok', text: '已从 CrossRef 抓到元数据：' + (v.title || '') + '（请自己核对一遍再导）' });
        });
      }

      function submit() {
        var groups = groupFiles();
        var specs = groups.length
          ? groups.map(function (g) { return buildImportSpec(g.target, form, g.files); })
          : [buildImportSpec(target, form, files)];
        for (var i = 0; i < specs.length; i += 1) {
          var bad = validateImport(specs[i]);
          if (bad) {
            var names = (specs[i].files || []).map(function (f) { return f.name; }).join('、');
            setMsg({ kind: 'err', text: '『' + labelOf(specs[i].target) + '』：' + bad + (names ? '（文件：' + names + '）' : '') });
            return;
          }
        }
        setBusy(true); setMsg(null);
        var merged = { placed: [], ran: [], notes: [], bits: [] };
        var chain = Promise.resolve();
        specs.forEach(function (spec) {
          chain = chain.then(function () {
            return hostCall(ctx, 'import', spec).then(function (v) {
              merged.placed = merged.placed.concat((v && v.placed) || []);
              merged.ran = merged.ran.concat((v && v.ran) || []);
              merged.notes = merged.notes.concat((v && v.notes) || []);
              merged.bits.push((specs.length > 1 ? '『' + labelOf(spec.target) + '』' : '') + ((v && v.summary) || '已提交'));
            });
          });
        });
        chain.then(function () {
          setBusy(false);
          setFiles([]);
          // 记住这次用的课题：下次打开导入直接带上，少一步下拉
          if (form.project) lsSet('import-project', String(form.project));
          var value = { placed: merged.placed, ran: merged.ran, notes: merged.notes, summary: merged.bits.join('；') };
          setMsg({ kind: 'ok', value: value, text: '导入完成：' + value.summary });
          if (props.onImported) props.onImported(value);
        }, function (e) {
          setBusy(false);
          var done = merged.bits.length ? '（已经完成的：' + merged.bits.join('；') + '）' : '';
          setMsg({ kind: 'err', text: String((e && e.message) || e) + done });
        });
      }

      function field(label, key, opts) {
        var o = opts || {};
        var value = form[key] == null ? '' : form[key];
        var change = function (e) { setField(key, e.target.value); };
        var control;
        if (o.options) {
          control = h('select', { key: 'i', value: value, onChange: change },
            [h('option', { key: 'empty', value: '' }, o.empty || '—')].concat(
              o.options.map(function (op) { return h('option', { key: op.id, value: op.id }, op.label); }),
            ));
        } else if (o.area) {
          control = h('textarea', { key: 'i', rows: o.rows || 2, value: value, placeholder: o.ph || '', onChange: change });
        } else {
          control = h('input', { key: 'i', type: 'text', value: value, placeholder: o.ph || '', onChange: change });
        }
        return h('label', { key: key, className: 'rl-field' + (o.wide ? ' rl-field--wide' : '') }, [
          h('span', { key: 'l' }, label + (o.required ? ' *' : '')),
          control,
        ]);
      }

      /** 「更多选项」：折叠时这些字段不渲染（表单值仍在，展开后不丢）。 */
      function adv(node) { return moreOpen ? node : null; }

      function fileRow() {
        return h('div', { key: 'file', className: 'rl-field rl-field--wide' }, [
          h('span', { key: 'l' }, '文件' + (target === 'refs' ? '（可选）' : ' *') + '　单个上限 ' + fmtBytes(maxBytes)),
          h('input', { key: 'i', type: 'file', multiple: true, accept: accept.join(','), onChange: pickFiles }),
          adv([
            h('span', { key: 'p', className: 'rl-sub' }, '大文件不经过浏览器：填写本机绝对路径，由宿主直接读盘（仅复制，不移动、不覆盖）。'),
            h('textarea', {
              key: 't', rows: 2, value: form.paths || '', placeholder: '一行一个绝对路径（PDF 文件）',
              onChange: function (e) { setField('paths', e.target.value); },
            }),
          ]),
          files.length
            ? h('ul', { key: 'list', className: 'rl-files' }, files.map(function (f, i) {
              return h('li', { key: i }, [
                f.name + '（' + fmtBytes(f.bytes) + '）',
                '　去向 ',
                h('select', {
                  key: 'tg', className: 'rl-select', value: f.target || target,
                  onChange: function (e) { setFileTarget(i, e.target.value); },
                }, IMPORT_TARGETS.map(function (t) { return h('option', { key: t.id, value: t.id }, t.label); })),
              ]);
            }))
            : null,
          (files.length && groupFiles().length > 1)
            ? h('span', { key: 'g', className: 'rl-sub' }, '这批分成 ' + groupFiles().length + ' 组、按去处分别导入：每组要的必填字段不一样，缺什么会直接指出来。')
            : null,
        ]);
      }

      /** 「落到哪个子目录」——数据/图表/草稿可以按文件夹归类（留空就放这一类目录根下）。 */
      function subdirField() {
        return h('label', { key: 'subdir', className: 'rl-field rl-field--wide' }, [
          h('span', { key: 'l' }, '子目录（可选）'),
          h('input', {
            key: 'i', type: 'text', value: form.subdir || '',
            placeholder: 'ZT-1500-2h　或　2026/XRD　（最多 3 层；留空 = 放在这一类目录的根下）',
            onChange: function (e) { setField('subdir', e.target.value); },
          }),
          h('span', { key: 'h', className: 'rl-sub' }, '同一个课题的数据分几批/几个样品时，各建一个文件夹更清爽：数据页会把同一文件夹的文件归成一组，组头能整组展开 / 折叠。'),
        ]);
      }

      function fields() {
        var out = [];
        if (target === 'refs') {
          out.push(field('标题', 'title', { wide: true, required: true, ph: '论文 / 书的标题' }));
          out.push(adv([
            field('作者', 'authors', { ph: 'Zhang, Y.; Li, W.' }),
            field('年份', 'year', { ph: '2026' }),
          ]));
          out.push(adv(field('出处（期刊 / 会议 / 出版社）', 'container', { wide: true, ph: 'Nature Materials' })));
          out.push(h('label', { key: 'doi', className: 'rl-field' }, [
            h('span', { key: 'l' }, 'DOI'),
            h('div', { key: 'row', className: 'rl-row' }, [
              h('input', {
                key: 'i', type: 'text', value: form.doi || '', placeholder: '10.1038/s41563-026-01234-5',
                onChange: function (e) { setField('doi', e.target.value); },
              }),
              Btn({ key: 'f', disabled: !!busy, onClick: fetchMeta }, busy ? '抓取中…' : '抓取'),
            ]),
            h('span', { key: 'h', className: 'rl-sub' }, '点击「抓取」才会联网（CrossRef）；抓取结果自动填入上述字段，需自行核对。'),
          ]));
          out.push(adv(field('URL', 'url', { ph: '没有 DOI 时至少给这个' })));
          out.push(adv(field('类型', 'type', {
            options: ['article', 'book', 'inproceedings', 'thesis', 'report', 'preprint', 'misc'].map(function (t) { return { id: t, label: REF_TYPE_CN[t] || t }; }),
            empty: '默认：期刊论文（article）',
          })));
          out.push(adv(field('关联课题', 'project', { options: projects, empty: '不关联课题' })));
          out.push(adv(field('备注', 'notes', { wide: true, ph: '为什么引它 / 哪一段用到它' })));
        } else if (target === 'figures') {
          out.push(field('课题', 'project', { required: true, options: projects, empty: projects.length ? '选一个课题' : '库里还没有课题' }));
          out.push(field('图注', 'caption', { wide: true, ph: '这张图画的是什么（写清才好在论文里用）' }));
          out.push(adv(field('Origin 图页', 'graph', { ph: 'Graph1（可选）' })));
          out.push(adv(subdirField()));
          out.push(adv(field('源数据', 'data', { wide: true, area: true, ph: 'projects/demo/data/x.csv（一行一个；库内相对路径或绝对路径都行）' })));
          out.push(adv(field('投给哪个期刊（可选）', 'journal', { options: journals, empty: '不指定' })));
        } else if (target === 'project') {
          out.push(field('课题目录名（slug）', 'slug', { required: true, ph: 'perovskite-stability —— 只收英文/数字与 - _ .，会变成 projects/<slug>/' }));
          out.push(field('标题（中文随便写）', 'title', { ph: '钙钛矿稳定性 —— 这才是在面板上显示的名字' }));
          out.push(adv(field('目标期刊档案（可选）', 'journal', { wide: true, options: journals, empty: '不指定' })));
          out.push(adv(field('已经存在的课题', 'project', { wide: true, options: projects, empty: '（忽略）' })));
        } else if (target === 'submission') {
          out.push(field('期刊档案', 'journal', { required: true, options: journals, empty: journals.length ? '选一份档案' : '库里没有期刊档案' }));
          out.push(field('状态', 'status', {
            options: ['drafting', 'submitted', 'under-review', 'revision', 'accepted', 'rejected', 'withdrawn', 'published'].map(function (s) { return { id: s, label: SUB_STATUS_CN[s] || s }; }),
            empty: '默认：草稿（drafting）',
          }));
          out.push(field('标题', 'title', { wide: true, ph: '稿件的题目' }));
          // 旧实现是自由文本且 placeholder 写 "article / review"，而 CLI 只收下面 8 个枚举
          //（"article" 并不在其中），照 placeholder 填会直接 cli-failed。改成下拉。
          out.push(field('类型', 'type', {
            options: ['research-article', 'review', 'letter', 'communication', 'conference-paper', 'thesis', 'preprint', 'other'].map(function (s) { return { id: s, label: SUB_TYPE_CN[s] || s }; }),
            empty: '默认：研究论文（research-article）',
          }));
          out.push(adv(field('稿件号', 'manuscriptId', { ph: '期刊系统给的编号' })));
          out.push(adv(field('关联课题', 'project', { options: projects, empty: '不关联课题' })));
          out.push(adv(field('下一步动作', 'nextAction', { ph: '补实验 / 改图 / 回复审稿意见' })));
          out.push(adv(field('截止', 'nextActionDue', { ph: 'YYYY-MM-DD' })));
          out.push(adv(field('备注', 'note', { wide: true, ph: '给未来的自己留一句话' })));
        } else {
          out.push(field('课题', 'project', { required: true, options: projects, empty: projects.length ? '选一个课题' : '库里还没有课题' }));
          out.push(adv(subdirField()));
        }
        if (target === 'data' || target === 'figures' || target === 'drafts' || target === 'refs') out.push(fileRow());
        return out;
      }

      function resultLines() {
        var out = [];
        out.push(h('div', { key: 'sum', className: msg.kind === 'ok' ? 'rl-ok' : 'rl-err' },
          (msg.kind === 'ok' ? '✓ ' : '✗ ') + msg.text));
        var v = msg.value;
        if (v) {
          if (v.placed && v.placed.length) {
            out.push(h('ul', { key: 'p', className: 'rl-files' }, v.placed.map(function (f, i) {
              return h('li', { key: i }, f.name + ' → ' + f.path + '（' + fmtBytes(f.bytes) + '）');
            })));
          }
          if (v.ran && v.ran.length) {
            out.push(h('ul', { key: 'r', className: 'rl-files' }, v.ran.map(function (r, i) {
              return h('li', { key: i }, (r.ok ? '✓ ' : '✗ ') + r.label + '：' + (r.summary || '') +
                ((r.warnings && r.warnings.length) ? '（提示：' + r.warnings.join('；') + '）' : ''));
            })));
          }
          if (v.notes && v.notes.length) {
            out.push(h('ul', { key: 'n', className: 'rl-files' }, v.notes.map(function (n, i) { return h('li', { key: i }, n); })));
          }
        }
        return out;
      }

      var pyMissing = Boolean(info && info.python && info.python.available === false);
      return h('div', { className: 'rl-modal', 'data-rl-tour': 'import-modal', onClick: onBackdrop(props.onClose) }, [
        h('div', { key: 'box', className: 'rl-modal__box' }, [
          h('div', { key: 'h', className: 'rl-modal__head' }, [
            h('h2', { key: 't', className: 'rl-modal__title' }, '导入到科研库'),
            h('span', { key: 's', className: 'rl-sub' }, '文件落库 + research.py 登记；同名不覆盖'),
            h('span', { key: 'sp', className: 'rl-tour-pop__spacer' }),
            Btn({ key: 'x', onClick: props.onClose, disabled: busy }, '关闭'),
          ]),
          h('div', { key: 'targets', className: 'rl-row', style: { marginBottom: '6px', alignItems: 'center' } }, [
            h('span', { key: 'auto', className: 'rl-sub' }, '导入到：'),
            h('b', { key: 'b' }, labelOf(target)),
            h('span', { key: 'tip', className: 'rl-sub' }, '　（按文件类型自动判定）'),
            h('span', { key: 'sp', className: 'rl-tour-pop__spacer' }),
            Btn({ key: 'sw', onClick: function () { setShowTargets(!showTargets); }, disabled: busy }, showTargets ? '收起' : '换去处'),
          ]),
          showTargets ? h('div', { key: 'grid', className: 'rl-targets', style: { marginBottom: '6px' } }, IMPORT_TARGETS.map(function (t) {
            return h('button', {
              key: t.id, type: 'button', className: 'rl-target', 'data-active': target === t.id ? '1' : '0',
              onClick: function () { switchTarget(t.id); },
            }, t.label);
          })) : null,
          h('div', { key: 'hint', className: 'rl-sub', style: { marginBottom: '6px' } }, meta.hint),
          h('div', { key: 'more', className: 'rl-row', style: { marginBottom: '6px' } }, [
            Btn({ key: 'm', onClick: function () { setMoreOpen(!moreOpen); }, disabled: busy }, moreOpen ? '收起更多选项' : '更多选项'),
            h('span', { key: 'h', className: 'rl-sub' },
              moreOpen ? '　作者 / 年份 / 出处 / 子目录 / 本机路径都收在这里' : '　默认只露必填项，留空的都按默认值走'),
          ]),
          pyMissing
            ? h('div', { key: 'py', className: 'rl-warn', style: { marginBottom: '6px' } },
              '⚠ 本机没有可用的 Python 解释器 / research.py：文献、图片、课题、投稿都无法登记（数据与草稿仍可落文件）。')
            : null,
          h('div', { key: 'grid', className: 'rl-modal__grid' }, fields()),
          msg
            ? h('div', {
              key: 'msg', className: 'rl-box',
              style: {
                marginTop: '8px',
                borderColor: msg.kind === 'ok' ? 'var(--rl-ok)' : 'var(--rl-err)',
              },
            }, resultLines())
            : null,
          h('div', { key: 'foot', className: 'rl-actions', style: { marginTop: '10px' } }, [
            Btn({ key: 'go', primary: true, onClick: submit, disabled: busy }, busy ? '导入中…' : '导入'),
            Btn({ key: 'cancel', onClick: props.onClose, disabled: busy }, '取消'),
            h('span', { key: 'tip', className: 'rl-sub', style: { marginLeft: '8px' } },
              '导入后回到面板点「刷新」核对计数。'),
          ]),
        ]),
      ]);
    }

    /** 库里一个普通文件（如 refs/pdf/*.pdf）：看内容 + 归档/删除。 */
    function FileRow(props) {
      var f = props.file;
      var zoomState = React.useState(false);
      var zoom = zoomState[0], setZoom = zoomState[1];
      var isPdf = PDF_RE.test(f.path);
      var isImg = IMG_RE.test(f.path);
      return h('div', { className: 'rl-row', style: { padding: '3px 0' } }, [
        h('div', { key: 'n' }, [
          h('span', { key: 'a', className: 'rl-mono' }, f.name),
          h('span', { key: 'b', className: 'rl-sub' }, ' · ' + fmtBytes(f.bytes) + (f.dir ? ' · ' + f.dir : '')),
        ]),
        h('div', { key: 'a', className: 'rl-actions' }, [
          (isPdf || isImg) ? Btn({ key: 'v', onClick: function () { setZoom(true); } }, isPdf ? '看 PDF' : '看图') : null,
          h(EntryActions, {
            key: 'ea', ctx: props.ctx, reason: props.reason || '文件归档', onDone: props.onReload,
            entry: { path: f.path, kind: 'file', label: f.name },
          }),
        ]),
        zoom && isPdf ? h(PdfView, { key: 'z', ctx: props.ctx, path: f.path, onClose: function () { setZoom(false); } }) : null,
        zoom && isImg ? h(BigImage, { key: 'z', ctx: props.ctx, path: f.path, onClose: function () { setZoom(false); } }) : null,
      ]);
    }

    /* ---------------------------------------------------------------- 图表卡 */

    /**
     * 图卡的归档/删除入参：图文件 + 它的登记侧车 JSON 一起动。
     * 侧车与图片**不必同主名**（实测 `Graph3.png` 的登记叫 `fig2.json`），宿主只要求同目录 + .json；
     * 早期的「同主名才配对」让「删掉这张图」只删掉 PNG、登记留在库里 ⇒ 卡片依旧在（用户 2026-10-11 报「删了还显示」）。
     * 主文件缺失的幽灵图（`fileExists===false`，只剩登记）就以侧车为主去动它，那样卡片才会真的消失。
     */
    function figureEntry(fig) {
      var file = fig.file || '';
      var side = fig.sidecar || '';
      var main = fig.fileExists === false ? (side || file) : (file || side);
      var other = main === file ? side : file;
      return {
        path: main,
        sidecar: other || undefined,
        kind: 'figure',
        label: fig.figureId,
      };
    }

    function FigureCard(props) {
      var fig = props.fig;
      var call = props.call;
      var openState = React.useState(false);
      var open = openState[0], setOpen = openState[1];
      var imgState = React.useState(imgCache.get(figImgKey(fig)) || null);
      var img = imgState[0], setImg = imgState[1];
      var imgErrState = React.useState(null);
      var imgErr = imgErrState[0], setImgErr = imgErrState[1];
      var zoomState = React.useState(false);
      var zoom = zoomState[0], setZoom = zoomState[1];
      var previewState = React.useState(null); // 附带件预览：{path, kind:'img'|'pdf'}
      var preview = previewState[0], setPreview = previewState[1];
      var paramsState = React.useState(false);
      var paramsOpen = paramsState[0], setParamsOpen = paramsState[1];

      var source = (fig.sources && fig.sources.length) ? fig.sources[0] : null;
      var extras = fig.fileList || [];

      React.useEffect(function () {
        if (!open && !zoom) return;
        if (!fig.fileExists || !fig.file) return;
        // 主件可能是 pdf/tif（"以 SVG 为主件"之外的登记）：塞进 <img> 只会得到破图，
        // 图区另有文案说明，这里直接不读盘。
        if (!IMG_RE.test(fig.file)) return;
        var key = figImgKey(fig);
        if (imgCache.has(key)) { setImg(imgCache.get(key)); return; }
        var alive = true;
        call('readBinary', { path: fig.file }).then(function (r) {
          var url = 'data:' + r.mime + ';base64,' + r.base64;
          imgCache.set(key, url);
          if (alive) setImg(url);
        }, function (e) { if (alive) setImgErr(String(e.message || e)); });
        return function () { alive = false; };
      }, [open, zoom, fig.file, fig.fileExists, fig.fileBytes, fig.fileMtime]);

      var verifyBadge = fig.verifyPassed === true
        ? h('span', { className: 'rl-badge rl-ok', title: 'verify' }, '自检通过')
        : (fig.verifyPassed === false ? h('span', { className: 'rl-badge rl-err', title: 'verify' }, '自检未通过') : h('span', { className: 'rl-badge', title: 'verify' }, '自检未知'));

      return Card({
        open: open,
        children: [
          h('div', { key: 'hd', className: 'rl-row' },
            h('div', null,
              h('span', { className: 'rl-mono rl-brand' }, fig.figureId),
              h('span', { className: 'rl-sub' }, ' · ' + (fig.graph || '未记录图页')),
              fig.sub ? h('span', { className: 'rl-sub' }, ' · 📁 ' + fig.sub) : null,
              fig.journal ? h('span', { className: 'rl-badge', style: { marginLeft: '6px' } }, fig.journal) : null,
              fig.fileExists
                ? h('span', { className: 'rl-sub' }, ' · ' + fmtBytes(fig.fileBytes))
                : h('span', { className: 'rl-err' }, ' · 图文件缺失'),
            ),
            h('div', { className: 'rl-actions' },
              fig.traceId ? h('span', { className: 'rl-badge rl-mono' }, String(fig.traceId).slice(0, 14)) : null,
              verifyBadge,
              h(EntryActions, {
                key: 'ea', ctx: props.ctx, reason: '图表页归档', onDone: props.onReload,
                entry: figureEntry(fig),
              }),
              Btn({ onClick: function () { setOpen(!open); } }, open ? '收起' : '展开'),
            ),
          ),
          fig.warnings && fig.warnings.length
            ? h('ul', { key: 'w', className: 'rl-warns' }, fig.warnings.map(function (w, i) { return h('li', { key: i }, '⚠ ' + w); }))
            : null,
          open ? h('div', { key: 'bd', style: { marginTop: '8px' } }, [
            h('div', { key: 'meta', className: 'rl-row', style: { alignItems: 'flex-start' } },
              h('div', { style: { minWidth: '240px', flex: '1 1 240px' } }, [
                KV({ key: 'f', k: '图文件', v: fig.file || '未记录', mono: true }),
                KV({ key: 's', k: '侧车', v: fig.sidecar, mono: true }),
                KV({ key: 'd', k: '源数据', v: source || '未记录', mono: true }),
                h('div', { key: 'so', className: 'rl-sub' }, '源数据存在性：' + ((fig.sourcesExist || []).map(function (s) {
                  return (s.exists ? (s.kind === 'dir' ? '✓ 目录 ' : '✓ ') : '✗ 缺失 ') + s.path;
                }).join('　')) || '—'),
                fig.originProject ? KV({ key: 'o', k: 'Origin 工程', v: fig.originProject, mono: true }) : null,
                KV({ key: 'c', k: '建立时间', v: fmtTime(fig.createdAt) }),
                fig.caption ? h('div', { key: 'cap', className: 'rl-sub', style: { marginTop: '4px' } }, '图注：' + fig.caption) : h('div', { key: 'cap0', className: 'rl-warn' }, '没有图注'),
              ]),
              h('div', { key: 'img', style: { flex: '0 0 auto' } },
                imgErr ? h('div', { className: 'rl-err' }, imgErr)
                  : (img ? h('img', { className: zoom ? 'rl-thumb-big' : 'rl-thumb', src: img, alt: fig.figureId, onClick: function () { setZoom(!zoom); } })
                    : h('div', { className: 'rl-sub' }, !fig.fileExists ? '（没有图文件）'
                      : (!IMG_RE.test(fig.file || '')
                        ? '（主件是 ' + ((fig.file || '').split('.').pop() || '') + '，面板不能内联预览'
                          + (extras.some(function (f) { return f.exists && IMG_RE.test(f.path); }) ? '；下面的附带文件里有图片可以点开看' : '') + '）'
                        : '缩略图加载中…'))),
              ),
            ),
            extras.length ? h('div', { key: 'extras', style: { marginTop: '8px' } }, [
              h('div', { key: 'h', className: 'rl-sub' }, '附带文件（侧车 files[]，' + extras.length + ' 个）：'),
              h('div', { key: 'l' }, extras.map(function (f) {
                var fPdf = PDF_RE.test(f.path);
                var fImg = IMG_RE.test(f.path);
                return h('div', { key: f.path, className: 'rl-row', style: { padding: '2px 0' } }, [
                  h('div', { key: 'n' }, [
                    h('span', { key: 'p', className: 'rl-mono' }, f.path),
                    h('span', { key: 'm', className: 'rl-sub' }, ' · ' + (f.ext || '') + (f.bytes != null ? ' · ' + fmtBytes(f.bytes) : '')
                      + (f.mtime ? ' · ' + fmtTime(f.mtime) : '') + (f.exists ? '' : ' · ⚠ 文件不存在')),
                  ]),
                  h('div', { key: 'a', className: 'rl-actions' },
                    (f.exists && (fPdf || fImg))
                      ? Btn({ key: 'v', onClick: function () { setPreview({ path: f.path, kind: fPdf ? 'pdf' : 'img' }); } }, fPdf ? '看 PDF' : '看图')
                      : null,
                  ),
                ]);
              })),
            ]) : null,
            h('div', { key: 'params' }, [
              h('button', {
                key: 't', type: 'button', className: 'rl-btn',
                style: { minHeight: '22px', padding: '0 8px', fontSize: '11px' },
                onClick: function () { setParamsOpen(!paramsOpen); },
              }, (paramsOpen ? '收起参数' : '参数（' + Object.keys(fig.params || {}).length + ' 项）')),
              paramsOpen
                ? h('pre', { key: 'p', className: 'rl-pre', style: { marginTop: '6px' } }, JSON.stringify(fig.params || {}, null, 1))
                : null,
            ]),

          ]) : null,
          preview && preview.kind === 'pdf' ? h(PdfView, { key: 'pvp', ctx: props.ctx, path: preview.path, onClose: function () { setPreview(null); } }) : null,
          preview && preview.kind === 'img' ? h(BigImage, { key: 'pvi', ctx: props.ctx, path: preview.path, onClose: function () { setPreview(null); } }) : null,
        ],
      });
    }

    /* ---------------------------------------------------------------- 草稿卡 */

    /**
     * 草稿页顶部：新建一份空白草稿（`projects/<课题>/drafts/<名字>.md`）。
     * 宿主侧只创建**不存在**的文件名 —— 已有同名一律拒，绝不覆盖别人的稿子。
     */
    function NewDraftForm(props) {
      var st = React.useState({ open: false, project: '', name: '', title: '', busy: false, msg: null });
      var s = st[0], set = st[1];
      var patch = function (o) { set(function (prev) { return Object.assign({}, prev, o); }); };
      var projects = (props.snap && props.snap.projects) || [];
      var project = s.project || (projects[0] && projects[0].slug) || '';

      var submit = function () {
        if (!project) { patch({ msg: { kind: 'err', text: '库里还没有课题：先用上面的「新建课题」建一个。' } }); return; }
        if (!s.name.trim()) { patch({ msg: { kind: 'err', text: '给草稿起个名字（不用写 .md）。' } }); return; }
        patch({ busy: true, msg: null });
        act(props.ctx, 'newDraft', { project: project, name: s.name.trim(), title: s.title.trim() }).then(function (r) {
          patch({
            busy: false,
            msg: r.ok
              ? { kind: 'ok', text: '已新建 ' + ((r.value && r.value.path) || '') + ' —— 点这张卡上的「编辑」就能写。' }
              : { kind: 'err', text: r.error },
          });
          if (r.ok) { patch({ name: '', title: '' }); if (props.onReload) props.onReload(); }
        });
      };

      if (!s.open) {
        return h('div', { className: 'rl-row', style: { marginBottom: '10px' } }, [
          Btn({ key: 'o', onClick: function () { patch({ open: true, msg: null }); } }, '新建草稿'),
          h('span', { key: 'h', className: 'rl-sub' }, '空白 .md 落到 projects/<课题>/drafts/，建完就能在面板里写。'),
        ]);
      }
      return h('div', { className: 'rl-box', style: { marginBottom: '10px' } }, [
        h('div', { key: 'r', className: 'rl-row' }, [
          (projects.length > 1)
            ? h('select', {
              key: 'p', className: 'rl-select', value: project, onChange: function (e) { patch({ project: e.target.value }); },
            }, projects.map(function (p) { return h('option', { key: p.slug, value: p.slug }, (p.title || p.slug) + '（' + p.slug + '）'); }))
            : h('span', { key: 'p', className: 'rl-sub' }, '课题：' + (project || '（库里没有课题）')),
          h('input', {
            key: 'n', className: 'rl-tool', value: s.name, placeholder: '文件名，例如 intro.md',
            onChange: function (e) { patch({ name: e.target.value }); },
          }),
          h('input', {
            key: 't', className: 'rl-tool', value: s.title, placeholder: '标题（可留空）',
            onChange: function (e) { patch({ title: e.target.value }); },
          }),
          Btn({ key: 'go', primary: true, disabled: !!s.busy, onClick: submit }, s.busy ? '新建中…' : '创建'),
          Btn({ key: 'c', disabled: !!s.busy, onClick: function () { patch({ open: false, msg: null }); } }, '取消'),
        ]),
        h(MsgLine, { key: 'm', msg: s.msg }),
      ]);
    }

    function DraftCard(props) {
      var d = props.draft;
      var call = props.call;
      var openState = React.useState(false);
      var open = openState[0], setOpen = openState[1];
      var textState = React.useState(null);
      var text = textState[0], setText = textState[1];
      var errState = React.useState(null);
      var err = errState[0], setErr = errState[1];
      var citeState = React.useState(null);
      var cites = citeState[0], setCites = citeState[1];
      var busyState = React.useState(false);
      var busy = busyState[0], setBusy = busyState[1];
      var editState = React.useState(false);
      var editing = editState[0], setEditing = editState[1];
      var draftState = React.useState('');
      var body = draftState[0], setBody = draftState[1];
      var saveState = React.useState(null);
      var save = saveState[0], setSave = saveState[1];

      React.useEffect(function () {
        if (!open || text !== null) return;
        var alive = true;
        call('readText', { path: d.path }).then(function (r) { if (alive) setText(r.text); }, function (e) { if (alive) setErr(String(e.message || e)); });
        return function () { alive = false; };
      }, [open, d.path, text]);

      function check() {
        // 核查结果渲染在卡片的 open 分支里，所以点核查必须先展开，
        // 否则状态写进去了却什么都看不到（由 scripts/selftest-client.mjs 抓到）。
        setOpen(true);
        setBusy(true); setErr(null);
        call('checkCitations', { path: d.path }).then(function (r) { setBusy(false); setCites(r); }, function (e) { setBusy(false); setErr(String(e.message || e)); });
      }

      /** 就地在面板里改草稿：保存前宿主会先写一份同名 .bak（用户选的边界）。 */
      function startEdit() {
        setOpen(true);
        setSave(null);
        setBody(text === null ? '' : text);
        setEditing(true);
      }

      function doSave() {
        setBusy(true); setSave(null);
        act(props.ctx, 'writeText', { path: d.path, text: body }).then(function (res) {
          setBusy(false);
          if (!res.ok) { setSave({ kind: 'err', text: res.error }); return; }
          var v = res.value || {};
          setText(body);
          setEditing(false);
          setSave({
            kind: 'ok',
            text: '已保存 ' + fmtBytes(v.bytes) + '（原文 ' + fmtBytes(v.beforeBytes) + ' 备份在 ' + baseName(v.backup || '') + '）',
          });
          if (props.onReload) props.onReload();
        });
      }

      return Card({
        open: open,
        children: [
          h('div', { key: 'hd', className: 'rl-row' },
            h('div', null,
              h('span', { className: 'rl-mono rl-brand' }, d.name),
              d.sub ? h('span', { className: 'rl-sub' }, ' · 📁 ' + d.sub) : null,
              h('span', { className: 'rl-sub' }, ' · ' + fmtBytes(d.bytes) + ' · ' + fmtTime(d.mtime)),
            ),
            h('div', { className: 'rl-actions' },
              h(EntryActions, {
                key: 'ea', ctx: props.ctx, reason: '草稿页归档', onDone: props.onReload,
                entry: { path: d.path, kind: 'draft', label: d.name },
              }),
              Btn({ onClick: function () { setOpen(!open); } }, open ? '收起' : '预览'),
              editing
                ? Btn({ onClick: function () { setEditing(false); setBody(text === null ? '' : text); }, disabled: busy }, '取消')
                : Btn({ onClick: startEdit, disabled: busy }, '编辑'),
              editing
                ? Btn({ onClick: doSave, primary: true, disabled: busy }, busy ? '保存中…' : '保存')
                : Btn({ onClick: check, disabled: busy }, busy ? '核查中…' : '引用核查'),
            ),
          ),
          open ? h('div', { key: 'bd' }, [
            h('div', { key: 'p', className: 'rl-sub rl-mono' }, d.path),
            err ? h('div', { key: 'e', className: 'rl-err' }, err) : null,
            save ? h(MsgLine, { key: 'sv', msg: save }) : null,
            editing ? h('textarea', {
              key: 'ed', className: 'rl-edit', value: body, spellCheck: false,
              onChange: function (e) { setBody(e.target.value); },
            }) : null,
            editing ? h('div', { key: 'edn', className: 'rl-sub rl-dim' }, '保存时会先写一份同名 .bak（覆盖上一份备份），然后才改这份草稿。') : null,
            cites ? h('div', { key: 'c', style: { marginTop: '8px' } }, [
              h('div', { key: 'sum', className: cites.missing.length === 0 && cites.cited.length > 0 ? 'rl-ok' : 'rl-warn' },
                cites.missing.length === 0
                  ? (cites.cited.length ? '✓ 引用核查通过：' + cites.cited.length + ' 个键都在库里' : '· 没有检到引用键（[ @key ] 或 \\cite{}）')
                  : '✗ 引用核查未通过：' + cites.missing.length + ' 个键在库里找不到'),
              h('div', { key: 'l', className: 'rl-sub' }, '已引用：' + (cites.cited.join('、') || '—')),
              h('div', { key: 'm', className: 'rl-sub' }, '缺失：' + (cites.missing.join('、') || '无')),
              h('div', { key: 'k', className: 'rl-sub' }, '库里已知文献：' + cites.known + ' 条'),
              h('div', { key: 'cv', className: 'rl-sub rl-dim', style: { marginTop: '4px' } }, cites.caveat || ''),
              h('div', { key: 'cp', style: { marginTop: '4px' } }, h(CopyBtn, { text: '请用 research.py check-citations --draft ' + d.path + ' 复核这份草稿的引用' })),
            ]) : null,
            text !== null && !editing ? h('pre', { key: 'pre', className: 'rl-pre' }, text.length > 6000 ? text.slice(0, 6000) + '\n\n…（已截断，完整 ' + text.length + ' 字符）' : text) : null,
          ]) : null,
        ],
      });
    }

    /* -------------------------------------------------------------- 数据/表格 */

    var DATA_RE = /\.(csv|tsv|txt|dat|jdx|dx|json)$/i;
    var IMG_RE = /\.(png|jpe?g|webp|gif|svg)$/i;
    var PDF_RE = /\.pdf$/i;

    /**
     * 分组标题：数据 / 图 / 草稿按子目录分组（空 sub = 这一类目录的根下），表格与工程各一组。
     * 面板不猜内容，只按落库时的文件夹归堆 —— 与用户在磁盘上的组织方式一致。
     */
    function subLabel(kind, sub) {
      var where = sub ? sub : '（根目录）';
      if (kind === 'data') return '数据 · ' + where;
      if (kind === 'table') return '表格（library/tables）';
      if (kind === 'opju') return 'Origin 工程';
      if (kind === 'figure') return '图 · ' + where;
      if (kind === 'draft') return '草稿 · ' + where;
      return where;
    }

    function AssetCard(props) {
      var a = props.asset;
      var call = props.call;
      var openState = React.useState(false);
      var open = openState[0], setOpen = openState[1];
      var colState = React.useState(null);
      var cols = colState[0], setCols = colState[1];
      var headState = React.useState(null);
      var head = headState[0], setHead = headState[1];
      var errState = React.useState(null);
      var err = errState[0], setErr = errState[1];
      var zoomState = React.useState(false);
      var zoom = zoomState[0], setZoom = zoomState[1];

      var isData = DATA_RE.test(a.path);
      var isImg = IMG_RE.test(a.path);
      var isPdf = PDF_RE.test(a.path);

      function ensureCols() {
        if (cols) return;
        call('tableColumns', { path: a.path }).then(setCols, function (e) { setErr(String(e.message || e)); });
      }

      function load() {
        setOpen(true);
        ensureCols();
        if (/\.(csv|tsv|txt|json|md)$/i.test(a.path)) {
          call('readText', { path: a.path }).then(function (r) { setHead(r.text.slice(0, 1200)); }, function () { /* 预览失败不影响列表 */ });
        }
      }

      return Card({
        open: open,
        children: [
          h('div', { key: 'hd', className: 'rl-row' },
            h('div', null, h('span', { className: 'rl-mono' }, a.name), h('span', { className: 'rl-sub' }, ' · ' + fmtBytes(a.bytes) + (a.dir ? ' · ' + a.dir : '') + (a.sub ? ' · 📁 ' + a.sub : ''))),
            h('div', { className: 'rl-actions' },
              h(EntryActions, {
                key: 'ea', ctx: props.ctx, reason: '数据页归档', onDone: props.onReload,
                entry: { path: a.path, kind: 'asset', label: a.name },
              }),
              (isImg || isPdf) ? Btn({ onClick: function () { setZoom(true); } }, isPdf ? '看 PDF' : '看图') : null,
              isData && props.project && props.onTransform ? Btn({ onClick: function () { props.onTransform({ path: a.path, project: props.project, name: a.name }); } }, '变换') : null,
              Btn({ onClick: function () { open ? setOpen(false) : load(); } }, open ? '收起' : '查看'),
            ),
          ),
          open ? h('div', { key: 'bd' }, [
            h('div', { key: 'p', className: 'rl-sub rl-mono' }, a.path),
            err ? h('div', { key: 'e', className: 'rl-err' }, err) : null,
            cols ? h('div', { key: 'c', className: 'rl-sub' }, '列（' + (cols.delimiter || '?') + '）：' + ((cols.columns || []).join('、') || '未识别到表头')) : null,
            head ? h('pre', { key: 'h', className: 'rl-pre' }, head) : null,
            h('div', { key: 'cp', style: { marginTop: '4px' } }, h(CopyBtn, { text: '请用 ' + a.path + ' 这份数据出图（研究库 ' + props.project + '）' })),
          ]) : null,
          zoom && isImg ? h(BigImage, { key: 'z', ctx: props.ctx, path: a.path, onClose: function () { setZoom(false); } }) : null,
          zoom && isPdf ? h(PdfView, { key: 'z', ctx: props.ctx, path: a.path, onClose: function () { setZoom(false); } }) : null,
        ],
      });
    }

    /* ------------------------------------------------------------- 命令台 */
    /**
     * 命令台：把 research.py 的子命令变成「点命令 → 填参 → 看结果」。
     * 目的很直接 —— 任何 CLI 能力不必再经 agent 转发。
     * 写动作一律走 act()（永不抛），结果三态 {kind,text,value}。
     */

    var CLI_KIND_CN = { read: '只读', write: '写库', danger: '危险' };
    var CONF_CN = { high: '高', medium: '中', low: '低' };
    var SUB_STATUS_CN = { drafting: '草稿', submitted: '已投稿', 'under-review': '审稿中', revision: '返修中', accepted: '已接收', rejected: '已拒稿', withdrawn: '已撤稿', published: '已发表' };
    var SUB_TYPE_CN = { 'research-article': '研究论文', review: '综述', letter: '快报', communication: '通讯', 'conference-paper': '会议论文', thesis: '学位论文', preprint: '预印本', other: '其他' };
    var REF_TYPE_CN = { article: '期刊论文', book: '图书', inproceedings: '会议论文', thesis: '学位论文', report: '报告', preprint: '预印本', misc: '其他' };
    var LANG_CN = { en: '英文', zh: '中文' };
    var VERIFIED_CN = { crossref: 'CrossRef 核验', agent: '智能体核验', manual: '人工核验', none: '仅登记' };

    /** 按 spec 渲染一个参数控件（select / bool / 文本）。 */
    function cliArgField(cmd, arg, values, setValues) {
      var v = values[arg.name];
      var set = function (nv) { setValues(function (prev) { var n = {}; for (var k in prev) n[k] = prev[k]; n[arg.name] = nv; return n; }); };
      var control;
      if (arg.type === 'select') {
        control = h('select', { key: 'i', className: 'rl-select', value: v || '', onChange: function (e) { set(e.target.value); } },
          [h('option', { key: 'e', value: '' }, '（不传）')].concat((arg.options || []).map(function (o) {
            var cn = (arg.optionsCn || {})[o];
            return h('option', { key: o, value: o, title: o }, cn || o);
          })));
      } else if (arg.type === 'bool') {
        control = h('label', { key: 'i', className: 'rl-chk' }, [
          h('input', { type: 'checkbox', checked: v === true, onChange: function (e) { set(e.target.checked); } }),
          arg.label || arg.name,
        ]);
      } else {
        control = h('input', {
          key: 'i', className: 'rl-input', type: 'text', value: v == null ? '' : v,
          placeholder: arg.placeholder || (arg.type === 'list' ? '多个值用分号隔开，例如 a;b;c' : ''),
          onChange: function (e) { set(e.target.value); },
        });
      }
      return h('div', { key: arg.name, className: 'rl-field' }, [
        h('span', { key: 'l' }, (arg.label ? arg.label + '（' + arg.name + '）' : arg.name) + (arg.required ? ' · 必填' : '')),
        control,
        arg.help ? h('span', { key: 'h', className: 'rl-sub' }, arg.help) : null,
      ]);
    }

    /**
     * 命令台：把 research.py 的子命令变成「点命令 → 填参 → 看结果」。
     * 目的很直接 —— 任何 CLI 能力不必再经 agent 转发。
     * 写动作一律走 act()（永不抛），结果三态 {kind,text,value}。
     */
    function ConsoleModal(props) {
      useEscape(true, props.onClose);
      var cmds = props.commands || [];
      var selState = React.useState(cmds.length ? cmds[0].id : '');
      var selectedId = selState[0], setSelectedId = selState[1];
      var valState = React.useState({});
      var values = valState[0], setValues = valState[1];
      var rawState = React.useState(false);
      var rawMode = rawState[0], setRawMode = rawState[1];
      var rawTextState = React.useState('');
      var rawText = rawTextState[0], setRawText = rawTextState[1];
      var okState = React.useState(false);
      var confirmed = okState[0], setConfirmed = okState[1];
      var busyState = React.useState(false);
      var busy = busyState[0], setBusy = busyState[1];
      var msgState = React.useState(null);
      var msg = msgState[0], setMsg = msgState[1];

      if (props.loading || props.error) {
        return h('div', { className: 'rl-modal', 'data-rl-tour': 'console-modal', onClick: onBackdrop(props.onClose) }, [
          h('div', { key: 'box', className: 'rl-modal__box', style: { width: 'min(560px,96vw)' } }, [
            h('div', { key: 'h', className: 'rl-modal__head' }, [
              h('h2', { key: 't', className: 'rl-modal__title' }, '命令台'),
              h('span', { key: 'sp', className: 'rl-tour-pop__spacer' }),
              Btn({ key: 'x', onClick: props.onClose }, '关闭'),
            ]),
            h('div', { key: 'b', className: props.error ? 'rl-err' : 'rl-sub', style: { padding: 'var(--rl-s4)' } },
              props.error ? ('读不到命令清单：' + props.error) : '正在读取命令清单…'),
            props.error
              ? h('div', { key: 'r', style: { padding: '0 var(--rl-s4) var(--rl-s4)' } },
                Btn({ key: 'retry', primary: true, onClick: props.onRetry }, '重试'))
              : null,
          ]),
        ]);
      }

      var cmd = null;
      for (var i = 0; i < cmds.length; i += 1) if (cmds[i].id === selectedId) cmd = cmds[i];
      var isDanger = cmd && cmd.kind === 'danger';

      function pick(id) {
        setSelectedId(id); setValues({}); setRawText(''); setMsg(null); setConfirmed(false);
      }
      function run() {
        if (!cmd || busy) return;
        setBusy(true); setMsg({ busy: true });
        var payload = { id: cmd.id };
        if (rawMode) payload.raw = rawText;
        else payload.values = values;
        if (isDanger) payload.confirm = confirmed === true;
        act(props.ctx, 'runCli', payload).then(function (res) {
          setBusy(false);
          if (!res.ok) { setMsg({ kind: 'err', text: res.error }); return; }
          setMsg({ kind: 'ok', text: (res.value && res.value.summary) || '完成', value: res.value });
        });
      }

      var groups = ['read', 'write', 'danger'];
      var list = h('div', { className: 'rl-console__list' }, groups.map(function (g) {
        var items = cmds.filter(function (c) { return c.kind === g; });
        if (!items.length) return null;
        return h('div', { key: g }, [
          h('div', { key: 'h', className: 'rl-console__group' }, CLI_KIND_CN[g]),
          h('div', { key: 'i' }, items.map(function (c) {
            return h('button', {
              key: c.id, type: 'button', className: 'rl-console__item',
              'data-active': c.id === selectedId ? '1' : '0',
              title: c.desc,
              onClick: function () { pick(c.id); },
            }, [
              h('span', { key: 't', className: 'rl-console__name' }, c.title || c.id),
              h('span', { key: 'i', className: 'rl-console__cmd' }, c.id),
              h('span', { key: 'd', className: 'rl-console__desc' }, c.desc || ''),
            ]);
          })),
        ]);
      }));

      var form = !cmd
        ? h('div', { className: 'rl-sub' }, '左边先挑一个命令。')
        : h('div', { className: 'rl-console__form' }, [
          h('div', { key: 'd', className: 'rl-sub' }, (cmd.title || cmd.id) + '（' + cmd.id + '）' + (cmd.desc ? ' —— ' + cmd.desc : '')),
          rawMode
            ? h('div', { key: 'raw', className: 'rl-console__raw' }, [
              h('span', { key: 'l', className: 'rl-sub' }, '原始参数（直接填写命令行参数，不含命令名；支持 --key value 与 --flag，不可含换行或分号）'),
              h('input', { key: 'i', className: 'rl-input', value: rawText, placeholder: '--project <课题> --draft projects/<课题>/drafts/xx.md', onChange: function (e) { setRawText(e.target.value); } }),
            ])
            : h('div', { key: 'grid', className: 'rl-modal__grid', style: { padding: 0 } },
              (cmd.args || []).length
                ? cmd.args.map(function (a) { return cliArgField(cmd, a, values, setValues); })
                : h('div', { className: 'rl-sub' }, '这个命令没有参数。')),
          isDanger ? h('label', { key: 'cf', className: 'rl-chk' }, [
            h('input', { type: 'checkbox', checked: confirmed, onChange: function (e) { setConfirmed(e.target.checked); } }),
            '我确认这条操作不可逆（会先备份 refs.json，但仍可能影响在写的稿子）',
          ]) : null,
          msg ? renderConsoleMsg(msg) : null,
        ]);

      return h('div', { className: 'rl-modal', 'data-rl-tour': 'console-modal', onClick: onBackdrop(props.onClose) }, [
        h('div', { key: 'box', className: 'rl-modal__box', style: { width: 'min(940px,96vw)' } }, [
          h('div', { key: 'h', className: 'rl-modal__head' }, [
            h('h2', { key: 't', className: 'rl-modal__title' }, '命令台'),
            h('span', { key: 's', className: 'rl-sub' }, '等价于 research.py 子命令；结果原样回显'),
            h('span', { key: 'sp', className: 'rl-tour-pop__spacer' }),
            Btn({ key: 'x', onClick: props.onClose, disabled: busy }, '关闭'),
          ]),
          h('div', { key: 'c', className: 'rl-console' }, [list, form]),
          h('div', { key: 'foot', className: 'rl-console__foot' }, [
            Btn({ key: 'go', primary: true, disabled: busy || !cmd || (isDanger && !confirmed), onClick: run },
              busy ? '运行中…' : (isDanger ? '确认并运行' : '运行')),
            Btn({ key: 'raw', onClick: function () { setRawMode(!rawMode); setMsg(null); } }, rawMode ? '表单模式' : '原始参数'),
          ]),
        ]),
      ]);
    }

    /** 命令台结果：状态行 + 警告 + JSON + stderr。 */
    function renderConsoleMsg(msg) {
      if (!msg) return null;
      if (msg.busy) return h('div', { className: 'rl-sub' }, '运行中…');
      var v = msg.value || null;
      var bad = msg.kind === 'err';
      return h('div', { className: 'rl-box', style: { marginTop: 'var(--rl-s3)' } }, [
        h('div', { key: 's', className: bad ? 'rl-err' : 'rl-ok' }, (bad ? '✗ ' : '✓ ') + msg.text),
        v ? h('div', { key: 'm', className: 'rl-sub' },
          '退出码 ' + (v.code == null ? '未知' : v.code) + ' · 用时 ' + (v.elapsedMs || 0) + ' 毫秒'
          + (v.args && v.args.length ? ' · 命令 ' + v.args.join(' ') : '')) : null,
        v && (v.warnings || []).length
          ? h('ul', { key: 'w', className: 'rl-warns' }, v.warnings.map(function (x, i) { return h('li', { key: i }, '⚠ ' + x); }))
          : null,
        v && v.raw ? h('details', { key: 'r', style: { marginTop: '6px' } }, [
          h('summary', { key: 's', className: 'rl-sub' }, '结构化结果（JSON）'),
          h('pre', { key: 'p', className: 'rl-pre', style: { marginTop: '4px' } }, JSON.stringify(v.raw, null, 1)),
        ]) : null,
        v && v.stderr ? h('details', { key: 'e', style: { marginTop: '6px' } }, [
          h('summary', { key: 's', className: 'rl-sub' }, '错误输出（stderr）'),
          h('pre', { key: 'p', className: 'rl-pre', style: { marginTop: '4px' } }, v.stderr),
        ]) : null,
      ]);
    }

    /* ------------------------------------------------- 数据变换（面板内直接做） */

    /** 参数表单里的一格（数字 / 文本 / 下拉），值走 pvals 字典。 */
    function paramField(spec, pvals, setPvals) {
      var v = pvals[spec.name];
      var set = function (nv) { setPvals(function (prev) { var n = {}; for (var k in prev) n[k] = prev[k]; n[spec.name] = nv; return n; }); };
      var ctl;
      if (spec.type === 'select') {
        ctl = h('select', { key: 'c', className: 'rl-select', value: v || '', onChange: function (e) { set(e.target.value); } },
          (spec.options || []).map(function (o) {
            return h('option', { key: o[0], value: o[0] }, o[1] || o[0]);
          }));
      } else {
        ctl = h('input', { key: 'c', className: 'rl-input', type: 'text', value: v == null ? '' : v, placeholder: spec.def == null ? '' : String(spec.def), onChange: function (e) { set(e.target.value); } });
      }
      return h('div', { key: spec.name, className: 'rl-field' }, [
        h('span', { key: 'l' }, spec.label || spec.name),
        ctl,
      ]);
    }

    /**
     * 数据变换：归一化 / 扣基线 / 平滑 / 标峰 / 积分 / 线性换算。
     * 纯宿主侧计算，不用开 Origin、不经 agent；**原始数据只读**，产物另存到 tables/。
     */
    function DataTransformModal(props) {
      useEscape(true, props.onClose);
      var call = props.call, ctx = props.ctx;
      var pvState = React.useState(null);
      var preview = pvState[0], setPreview = pvState[1];
      var opsState = React.useState(null);
      var ops = opsState[0], setOps = opsState[1];
      var opState = React.useState('normalize');
      var op = opState[0], setOp = opState[1];
      var xState = React.useState(0); var x = xState[0], setX = xState[1];
      var yState = React.useState(1); var y = yState[0], setY = yState[1];
      var pmState = React.useState({});
      var pvals = pmState[0], setPvals = pmState[1];
      var nameState = React.useState(''); var outName = nameState[0], setOutName = nameState[1];
      var ovState = React.useState(false); var overwrite = ovState[0], setOverwrite = ovState[1];
      var busyState = React.useState(true); var busy = busyState[0], setBusy = busyState[1];
      var errState = React.useState(null); var err = errState[0], setErr = errState[1];
      var resState = React.useState(null); var result = resState[0], setResult = resState[1];

      React.useEffect(function () {
        var alive = true;
        call('tablePreview', { data: props.path, limit: 6 }).then(function (r) {
          if (!alive) return;
          if (!r || !r.header) { setErr('这张表读不出来（不是分隔符文本表？）'); setBusy(false); return; }
          setPreview(r);
          setOutName(String(props.path).split('/').pop().replace(/\.[^.]+$/, '') + '-');
          setBusy(false);
        }, function (e) { if (alive) { setErr(String(e.message || e)); setBusy(false); } });
        call('transformOps', {}).then(function (r) { if (alive && r && r.ops) setOps(r.ops); }, function () { /* 预览里已带回 */ });
        return function () { alive = false; };
      }, []);

      var spec = null;
      for (var i = 0; ops && i < ops.length; i += 1) if (ops[i].id === op) spec = ops[i];

      function run() {
        if (busy || !spec) return;
        setBusy(true); setErr(null); setResult(null);
        var args = { project: props.project, data: props.path, op: op, x: x, y: y, params: pvals, overwrite: overwrite };
        if (outName) args.outName = outName;
        act(ctx, 'tableTransform', args).then(function (res) {
          setBusy(false);
          if (!res.ok) { setErr(res.error && (res.error.message || res.error.code) ? (res.error.message || res.error.code) : '操作失败'); return; }
          setResult(res.value || {});
          if (props.onReload) props.onReload();
        });
      }

      var colOpts = preview ? preview.columns : [];
      return h('div', { className: 'rl-modal', onClick: onBackdrop(props.onClose) }, [
        h('div', { key: 'box', className: 'rl-modal__box', style: { width: 'min(820px,96vw)' } }, [
          h('div', { key: 'h', className: 'rl-modal__head' }, [
            h('h2', { key: 't', className: 'rl-modal__title' }, '数据变换'),
            h('span', { key: 's', className: 'rl-sub' }, props.path),
            h('span', { key: 'sp', className: 'rl-tour-pop__spacer' }),
            Btn({ key: 'x', onClick: props.onClose, disabled: busy }, '关闭'),
          ]),
          busy && !preview ? h('div', { key: 'l', className: 'rl-sub', style: { padding: 'var(--rl-s5)' } }, '读取中…') : null,
          preview ? h('div', { key: 'b', style: { padding: 'var(--rl-s5)' } }, [
            h('div', { key: 'info', className: 'rl-box' }, [
              h('div', { key: 'a', className: 'rl-sub' }, '共 ' + preview.rows + ' 行 · ' + colOpts.length + ' 列（原始数据不会被改动，产物另存到本课题的 tables/）'),
              h('table', { key: 't', className: 'rl-table', style: { marginTop: 'var(--rl-s2)' } }, [
                h('thead', { key: 'h' }, h('tr', null, colOpts.map(function (c) {
                  return h('th', { key: c.name }, c.name + '（' + (c.count || 0) + ' 个有效值）');
                }))),
                h('tbody', { key: 'b' }, (preview.head || []).map(function (r, ri) {
                  return h('tr', { key: ri }, r.map(function (v, ci) {
                    return h('td', { key: ci, className: 'rl-mono' }, v === null ? '—' : String(v));
                  }));
                })),
              ]),
              h('div', { key: 'f', className: 'rl-sub' }, '预览前 ' + (preview.head || []).length + ' 行'),
            ]),
            h('div', { key: 'g', className: 'rl-modal__grid' }, [
              h('div', { key: 'op', className: 'rl-field' }, [
                h('span', { key: 'l' }, '变换'),
                h('select', { key: 's', className: 'rl-select', value: op, onChange: function (e) { setOp(e.target.value); setPvals({}); } },
                  (ops || []).map(function (o) { return h('option', { key: o.id, value: o.id }, o.name); })),
              ]),
              h('div', { key: 'xc', className: 'rl-field' }, [
                h('span', { key: 'l' }, 'X 列'),
                h('select', { key: 's', className: 'rl-select', value: String(x), onChange: function (e) { setX(Number(e.target.value)); } },
                  colOpts.map(function (c) { return h('option', { key: c.index, value: String(c.index) }, c.name); })),
              ]),
              h('div', { key: 'yc', className: 'rl-field' }, [
                h('span', { key: 'l' }, 'Y 列'),
                h('select', { key: 's', className: 'rl-select', value: String(y), onChange: function (e) { setY(Number(e.target.value)); } },
                  colOpts.map(function (c) { return h('option', { key: c.index, value: String(c.index) }, c.name); })),
              ]),
              h('div', { key: 'on', className: 'rl-field' }, [
                h('span', { key: 'l' }, '输出文件名'),
                h('input', { key: 'i', className: 'rl-input', value: outName, placeholder: '留空则用「原名-变换」', onChange: function (e) { setOutName(e.target.value); } }),
              ]),
            ].concat(spec ? (spec.params || []).map(function (sp) { return paramField(sp, pvals, setPvals); }) : []).concat([
              h('div', { key: 'ov', className: 'rl-field' }, [
                h('label', { key: 'l', className: 'rl-chk' }, [
                  h('input', { type: 'checkbox', checked: overwrite, onChange: function (e) { setOverwrite(e.target.checked); } }),
                  '覆盖同名产物（原始数据永远不动）',
                ]),
              ]),
            ])),
            spec && spec.desc ? h('div', { key: 'd', className: 'rl-sub', style: { marginTop: 'var(--rl-s2)' } }, spec.desc) : null,
            err ? h('div', { key: 'e', className: 'rl-err', style: { marginTop: 'var(--rl-s2)' } }, '✗ ' + err) : null,
            result ? h('div', { key: 'r', className: 'rl-box', style: { marginTop: 'var(--rl-s3)' } }, [
              h('div', { key: 'a', className: 'rl-ok' }, '✓ 已生成 ' + result.output),
              h('div', { key: 'b', className: 'rl-sub' }, result.rows + ' 行 × ' + result.columns + ' 列 · 溯源 ' + result.trace),
              (result.notes || []).length ? h('ul', { key: 'n', className: 'rl-warns' }, result.notes.map(function (x2, i2) { return h('li', { key: i2 }, '· ' + x2); })) : null,
              result.reindex && !result.reindex.ok ? h('div', { key: 'ri', className: 'rl-warn', style: { marginTop: '4px' } }, '⚠ 库的索引没刷新成功（' + (result.reindex.summary || result.reindex.stderr || '重建索引失败') + '），数据已落盘，下次刷新会自动重算。') : null,
              h('div', { key: 'c', className: 'rl-sub', style: { marginTop: '4px' } }, '新列：' + (result.header || []).join('、')),
            ]) : null,
          ]) : null,
          h('div', { key: 'f', className: 'rl-console__foot' }, [
            Btn({ key: 'go', primary: true, disabled: busy || !preview, onClick: run }, busy ? '计算中…' : '生成新表'),
            Btn({ key: 'c', disabled: busy, onClick: props.onClose }, '关闭'),
          ]),
        ]),
      ]);
    }

    /* ----------------------------------------------------------------- 面板 */

    /* ------------------------------------------------- 工作台 v2（默认关闭） */

    var UI_VERSION_KEY = 'ui.version';
    var STAGE_ORDER = ['topic', 'design', 'data', 'analysis', 'figure', 'draft', 'submission'];
    var STAGE_LABEL = { topic: '选题', design: '设计', data: '数据', analysis: '分析', figure: '图表', draft: '写作', submission: '投稿' };
    var WORKBENCH_VIEWS = ['today', 'projects', 'project', 'library', 'data', 'refs', 'settings'];

    /** 默认 v2（工作台）；老用户把开关切回 v1 会记住。 */
    function uiVersion() { return lsGet(UI_VERSION_KEY) === 'v1' ? 'v1' : 'v2'; }

    /** 页签表：v2 在最前面插一个「工作台」，其余与旧面板完全一致。 */
    function tabsFor(version) {
      var head = version === 'v2' ? [{ id: 'workbench', label: '工作台' }] : [];
      return head.concat(TABS);
    }

    /** 命令面板的搜索：按 id/标题/域/描述筛，纯函数（selftest 直接断言）。 */
    function paletteSearch(actions, q) {
      var needle = String(q == null ? '' : q).trim().toLowerCase();
      var list = Array.isArray(actions) ? actions : [];
      if (!needle) return list.slice();
      return list.filter(function (a) {
        var hay = [a.id, a.title, a.domain, a.description, a.effects, a.ui && a.ui.view].join(' ').toLowerCase();
        return hay.indexOf(needle) >= 0;
      });
    }

    function stageIndex(stage) {
      var i = STAGE_ORDER.indexOf(stage);
      return i < 0 ? 0 : i;
    }

    var QUICK_TABS = [
      { id: 'add-ref', label: '文献入库' },
      { id: 'register-figure', label: '登记图溯源' },
      { id: 'add-submission', label: '记一条投稿' },
    ];

    /**
     * 快速登记：表单直接由命令清单的 args 生成（label / type / optionsCn 都是宿主下发的），
     * 面板不另抄一份；提交后交给 `system.cli_run`，写动作仍然走 PlanModal 二次确认。
     */
    function QuickModal(props) {
      useEscape(true, props.onClose);
      var quick = props.quick || {};
      var moreState = React.useState(false);
      var more = moreState[0], setMore = moreState[1];
      var cmd = null;
      (quick.commands || []).forEach(function (c) { if (c.id === quick.id) cmd = c; });
      var values = quick.values || {};
      var suggest = props.suggest || {};
      var args = (cmd && cmd.args) || [];
      var required = args.filter(function (a) { return a.required; });
      var optional = args.filter(function (a) { return !a.required; });
      var field = function (a) {
        var v = values[a.name] == null ? '' : values[a.name];
        var label = (a.label || a.name.replace(/^--/, '')) + (a.required ? ' *' : '');
        var control;
        if (a.type === 'select') {
          var options = (a.options || []).map(function (o) {
            return h('option', { key: o, value: o }, (a.optionsCn && a.optionsCn[o]) || o);
          });
          control = h('select', { key: 'i', value: v, onChange: function (e) { props.onField(a.name, e.target.value); } },
            [h('option', { key: '__', value: '' }, '（不填）')].concat(options));
        } else if (a.type === 'bool') {
          control = h('input', {
            key: 'i', type: 'checkbox', checked: v === true || v === 'true',
            onChange: function (e) { props.onField(a.name, e.target.checked); },
          });
        } else if (suggest[a.name] && suggest[a.name].length) {
          control = h('select', { key: 'i', value: v, onChange: function (e) { props.onField(a.name, e.target.value); } },
            [h('option', { key: '__', value: '' }, '（不填）')].concat(suggest[a.name].map(function (o) {
              return h('option', { key: o, value: o }, o);
            })));
        } else {
          control = h('input', {
            key: 'i', type: a.type === 'int' ? 'number' : 'text', value: v,
            placeholder: a.type === 'path' ? '库内相对路径或本机路径' : '',
            onChange: function (e) { props.onField(a.name, e.target.value); },
          });
        }
        return h('label', { key: a.name, className: 'rl-form__field' }, [
          h('span', { key: 'l', className: 'rl-form__label' }, label),
          control,
        ]);
      };
      return h('div', { className: 'rl-modal', onClick: onBackdrop(props.onClose) }, [
        h('div', { key: 'box', className: 'rl-modal__box' }, [
          h('div', { key: 'h', className: 'rl-modal__head' }, [
            h('h2', { key: 't', className: 'rl-modal__title' }, '快速登记'),
            h('div', { key: 'tabs', className: 'rl-tabs rl-wb__actions' }, QUICK_TABS.map(function (t) {
              return h('button', {
                key: t.id, type: 'button', className: 'rl-tab', 'data-active': quick.id === t.id ? '1' : '0',
                onClick: function () { props.onSwitch(t.id); },
              }, t.label);
            })),
          ]),
          quick.loading
            ? h('div', { key: 'l', className: 'rl-sub', style: { padding: '16px 20px' } }, '正在读命令清单…')
            : h('div', { key: 'f', className: 'rl-form', style: { padding: '16px 20px' } },
              required.concat(more ? optional : []).map(field)),
          h('div', { key: 'o', className: 'rl-form__ok' }, [
            !quick.loading && optional.length
              ? Btn({ key: 'm', onClick: function () { setMore(!more); } }, more ? '收起选项' : ('更多选项（' + optional.length + '）'))
              : null,
            Btn({ key: 'c', onClick: props.onClose }, '取消'),
            Btn({ key: 's', primary: true, disabled: quick.loading || !cmd, onClick: function () { if (cmd) props.onSubmit(cmd); } }, '生成计划'),
          ]),
        ]),
      ]);
    }

    function StageBar(props) {
      var at = stageIndex(props.stage);
      return h('div', { className: 'rl-stages' }, STAGE_ORDER.map(function (s, i) {
        var state = i < at ? 'done' : (i === at ? 'active' : 'pending');
        return h('span', { key: s, className: 'rl-stage', 'data-state': state }, String(i + 1) + ' ' + STAGE_LABEL[s]);
      }));
    }

    function PlanModal(props) {
      useEscape(Boolean(props.plan), props.onCancel);
      var plan = props.plan;
      if (!plan) return null;
      var writes = Array.isArray(plan.writes) ? plan.writes : [];
      var warnings = Array.isArray(plan.warnings) ? plan.warnings : [];
      return h('div', { className: 'rl-wbmask', role: 'dialog', 'aria-modal': 'true', onClick: onBackdrop(props.onCancel) },
        h('div', { className: 'rl-wbcard' }, [
          h('div', { key: 't', className: 'rl-wbcard__title' }, '确认写动作：' + (plan.title || plan.actionId || '')),
          h('div', { key: 's', className: 'rl-sub' }, plan.summary || '令牌 5 分钟内一次性有效，参数被改过会被拒。'),
          writes.length
            ? h('div', { key: 'w' }, [h('div', { key: 'h', className: 'rl-sub' }, '会写这些文件：')].concat(
              writes.map(function (w, i) { return h('div', { key: i, className: 'rl-mono' }, typeof w === 'string' ? w : JSON.stringify(w)); })))
            : null,
          warnings.length
            ? h('ul', { key: 'wn', className: 'rl-warns' }, warnings.map(function (w, i) { return h('li', { key: i }, '⚠ ' + w); }))
            : null,
          props.error ? h('div', { key: 'e', className: 'rl-err' }, '✗ ' + props.error) : null,
          h('div', { key: 'a', className: 'rl-wbcard__foot' }, [
            h('button', { key: 'c', type: 'button', className: 'rl-btn', onClick: props.onCancel, disabled: props.busy }, '取消'),
            h('button', { key: 'o', type: 'button', className: 'rl-btn rl-btn--primary', onClick: props.onConfirm, disabled: props.busy },
              props.busy ? '执行中…' : '确认执行'),
          ]),
        ]));
    }

    /** 新建课题：slug + 标题 → project.create（写动作走计划/确认）。 */
    function CreateModal(props) {
      useEscape(true, props.onClose);
      var slugState = React.useState('');
      var slug = slugState[0], setSlug = slugState[1];
      var titleState = React.useState('');
      var title = titleState[0], setTitle = titleState[1];
      return h('div', { className: 'rl-wbmask', role: 'dialog', 'aria-modal': 'true', onClick: onBackdrop(props.onClose) },
        h('div', { className: 'rl-wbcard' }, [
          h('div', { key: 't', className: 'rl-wbcard__title' }, '新建课题'),
          h('div', { key: 's', className: 'rl-sub' }, '目录名用字母数字与 . _ -，最多 64 字符；建好后是「选题」阶段。'),
          h('label', { key: 'l1', className: 'rl-sub' }, '目录名 (slug)',
            h('input', {
              className: 'rl-tool', style: { display: 'block', width: '100%', marginTop: '4px' },
              value: slug, placeholder: '例如 zt-ceremic',
              onChange: function (e) { setSlug(e.target.value); },
            })),
          h('label', { key: 'l2', className: 'rl-sub' }, '课题标题',
            h('input', {
              className: 'rl-tool', style: { display: 'block', width: '100%', marginTop: '4px' },
              value: title, placeholder: '例如 硼化锆钛固溶体力学与抗氧化',
              onChange: function (e) { setTitle(e.target.value); },
            })),
          h('div', { key: 'a', className: 'rl-wbcard__foot' }, [
            h('button', { key: 'c', type: 'button', className: 'rl-btn', onClick: props.onClose }, '取消'),
            h('button', {
              key: 'o', type: 'button', className: 'rl-btn rl-btn--primary',
              disabled: !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(slug.trim()),
              onClick: function () { props.onCreate(slug.trim(), title.trim()); },
            }, '下一步：确认计划'),
          ]),
        ]));
    }

    /**
     * v2 工作台：今日（课题 + 下一步 + 回执）+ 课题详情（阶段条 / 检查项 / 两个写动作）。
     * 写动作一律走 action.plan → 用户点确认 → action.confirm（令牌一次性）。
     */
    /* --------------------------------------- 工作台仪表：今日 / 倒计时 / 体检 / 动态 */
    /*
     * 这三块的共同目的只有一个：**打开就告诉你一件你还不知道的事**。
     * 面板以前全是"点它才给信息"的陈列，所以看起来没作用；仪表反过来先说话。
     */

    var SUB_CLOSED_STATUS = ['accepted', 'rejected', 'withdrawn', 'published'];

    /** 'YYYY-MM-DD' → 距今天数（负数=已逾期）；解析不了给 null。 */
    function daysLeft(dateStr) {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').slice(0, 10));
      if (!m) return null;
      var now = new Date();
      var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return Math.round((due.getTime() - today.getTime()) / 86400000);
    }

    function dueText(days) {
      if (days == null) return '';
      if (days < 0) return '逾期 ' + (-days) + ' 天';
      if (days === 0) return '今天到期';
      return '剩 ' + days + ' 天';
    }

    /** 今日该做：过期/临近的投稿 → 课题下一步 → 可推进的课题，取前 N 条。 */
    function todayItems(projects, submissions, limit) {
      var out = [];
      (submissions || []).forEach(function (s) {
        if (s.kind !== 'submission' || SUB_CLOSED_STATUS.indexOf(s.status) >= 0) return;
        var d = daysLeft(s.nextActionDue);
        if (d == null || d > 14) return;
        out.push({
          rank: d, tone: d < 0 ? 'err' : (d <= 3 ? 'warn' : ''),
          text: (s.journalName || s.journal || '投稿') + '：' + (s.nextAction || '处理投稿') + '（' + dueText(d) + '）',
          prompt: '帮我处理投稿《' + (s.title || s.submissionId) + '》：下一步是「' + (s.nextAction || '处理') + '」，截止 ' + (s.nextActionDue || '') + '。',
        });
      });
      (projects || []).forEach(function (p) {
        var next = p.next || {};
        var todo = (next.todo || [])[0];
        if (todo) {
          out.push({
            rank: 30, tone: '',
            text: (p.title || p.slug) + '：' + (todo.why || todo.action),
            prompt: '课题「' + (p.title || p.slug) + '」在「' + (STAGE_LABEL[p.stage] || p.stage || '—')
              + '」阶段：' + (todo.why || '') + '。请执行 ' + todo.action + '（写动作先 plan 再 confirm）。',
          });
        } else if (next.ready) {
          out.push({
            rank: 40, tone: '',
            text: (p.title || p.slug) + '：这阶段做完了，可以推进',
            prompt: '课题「' + (p.title || p.slug) + '」这阶段的检查项已就绪，帮我推进到下一阶段（先 plan 再 confirm）。',
          });
        }
      });
      return out.sort(function (a, b) { return a.rank - b.rank; }).slice(0, limit || 3);
    }

    /** 库体检：只报数 + 几个名字，不在这里修（修要人决定）。 */
    function healthItems(snap) {
      var out = [];
      if (!snap) return out;
      var figs = [];
      (snap.projects || []).forEach(function (p) {
        (p.figures || []).forEach(function (f) { figs.push({ p: p, f: f }); });
      });
      var noCaption = figs.filter(function (x) { return !x.f.caption; });
      var noSource = figs.filter(function (x) { return !(x.f.sources || []).length; });
      var noDoi = (snap.refs || []).filter(function (r) { return !r.doi; });
      var empty = (snap.projects || []).filter(function (p) {
        return !(p.figures || []).length && !(p.drafts || []).length && !(p.datasets || []).length;
      });
      if (noCaption.length) out.push({ tone: 'warn', text: noCaption.length + ' 张图没有图注', names: noCaption.slice(0, 3).map(function (x) { return x.f.figureId; }) });
      if (noSource.length) out.push({ tone: 'warn', text: noSource.length + ' 张图没登记源数据', names: noSource.slice(0, 3).map(function (x) { return x.f.figureId; }) });
      if (noDoi.length) out.push({ tone: '', text: noDoi.length + ' 条文献没有 DOI（引用要人工核对）', names: noDoi.slice(0, 3).map(function (r) { return String(r.title || r.key).slice(0, 40); }) });
      if (empty.length) out.push({ tone: '', text: empty.length + ' 个课题还是空的', names: empty.slice(0, 3).map(function (p) { return p.title || p.slug; }) });
      if (!out.length) out.push({ tone: '', text: '没有发现问题：图注、源数据、DOI 都齐。', names: [] });
      return out;
    }

    /** 最近动态：新图 / 新草稿 / 新数据 / 新文献，按时间倒序。 */
    function recentItems(snap, limit) {
      var out = [];
      if (!snap) return out;
      (snap.projects || []).forEach(function (p) {
        (p.figures || []).forEach(function (f) {
          if (f.createdAt) out.push({ at: f.createdAt, text: '新图 ' + f.figureId + '（' + (p.title || p.slug) + '）' });
        });
        (p.drafts || []).forEach(function (d) { if (d.mtime) out.push({ at: d.mtime, text: '草稿 ' + d.name }); });
        (p.datasets || []).forEach(function (d) { if (d.mtime) out.push({ at: d.mtime, text: '数据 ' + d.name }); });
      });
      (snap.refs || []).forEach(function (r) {
        if (r.addedAt) out.push({ at: r.addedAt, text: '文献 ' + String(r.title || r.key).slice(0, 48) });
      });
      return out.filter(function (x) { return x.at; })
        .sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); })
        .slice(0, limit || 6);
    }

    function Workbench(props) {
      var call = props.call;
      var onImport = props.onImport;
      var onConsole = props.onConsole;
      var onTour = props.onTour;
      var rootPath = props.root;
      var listState = React.useState(null);
      var list = listState[0], setList = listState[1];
      var recState = React.useState([]);
      var receipts = recState[0], setReceipts = recState[1];
      var detState = React.useState(null);
      var detail = detState[0], setDetail = detState[1];
      var selState = React.useState('');
      var sel = selState[0], setSel = selState[1];
      var planState = React.useState(null);
      var plan = planState[0], setPlan = planState[1];
      var paramsRef = React.useRef({});
      var busyState = React.useState(false);
      var busy = busyState[0], setBusy = busyState[1];
      var errState = React.useState(null);
      var error = errState[0], setError = errState[1];
      var msgState = React.useState(null);
      var message = msgState[0], setMessage = msgState[1];
      var createState = React.useState(false);
      var showCreate = createState[0], setShowCreate = createState[1];
      var snapState = React.useState(null);
      var snap = snapState[0], setSnap = snapState[1];
      var aiState = React.useState(null);
      var aiDraft = aiState[0], setAiDraft = aiState[1];
      // 快速登记：文献入库 / 登记图溯源 / 记投稿——表单来自命令清单（只读元数据），提交走命令台。
      var quickState = React.useState(null);
      var quick = quickState[0], setQuick = quickState[1];
      var openQuick = function (id) {
        setQuick({ id: id, values: {}, commands: [], loading: true });
        call('library.cli_commands', {}).then(function (r) {
          setQuick(function (q) {
            return q ? { id: id, values: q.values || {}, commands: (r && r.commands) || [], loading: false } : q;
          });
        }, function (e) {
          setQuick(null);
          setError(String((e && e.message) || e));
        });
      };
      var quickField = function (name, value) {
        setQuick(function (q) {
          if (!q) return q;
          var values = {};
          Object.keys(q.values || {}).forEach(function (k) { values[k] = q.values[k]; });
          values[name] = value;
          return { id: q.id, values: values, commands: q.commands, loading: q.loading };
        });
      };
      var quickSubmit = function (cmd) {
        var values = {};
        var missing = [];
        (cmd.args || []).forEach(function (a) {
          var v = quick && quick.values ? quick.values[a.name] : undefined;
          var blank = v === undefined || v === null || String(v).trim() === '';
          if (blank) { if (a.required) missing.push(a.label || a.name); return; }
          values[a.name] = v;
        });
        if (missing.length) { setError('还差必填项：' + missing.join('、')); return; }
        setQuick(null);
        ask('system.cli_run', { id: cmd.id, values: values });
      };

      var load = React.useCallback(function () {
        return Promise.all([call('project.list', {}), call('system.receipts', { limit: 8 }), call('snapshot', {})])
          .then(function (r) {
            setList(r[0] || { projects: [] });
            setReceipts((r[1] && r[1].receipts) || []);
            setSnap(r[2] && r[2].ok === false ? null : (r[2] || null));
          }, function (e) { setError(String((e && e.message) || e)); });
      }, [call]);

      /**
       * 「生成指令」：把已经写好的指令放进剪贴板/下面那个框，用户回对话里粘一下就行。
       * 面板不发消息（没有对话通道），所以不假装一键执行——只省掉打字。
       */
      var sendToAi = function (text) {
        setAiDraft(text);
        var copied = false;
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text);
            copied = true;
          }
        } catch (e) { copied = false; }
        setMessage(copied
          ? '指令已复制到剪贴板：回到对话里粘贴（Ctrl+V）就行。'
          : '指令已生成，复制后在会话中发送。');
      };

      React.useEffect(function () { load(); }, [load]);

      React.useEffect(function () {
        if (!sel) { setDetail(null); return; }
        call('project.get', { project: sel }).then(setDetail, function (e) { setError(String((e && e.message) || e)); });
      }, [sel, call]);

      var projects = (list && list.projects) || [];
      var current = detail && detail.project ? detail.project : projects.filter(function (p) { return p.slug === sel; })[0];
      var next = (detail && detail.next) || (current && current.next) || null;
      var stage = current ? current.stage : '';

      var ask = function (actionId, params) {
        setError(null); setMessage(null);
        call('action.plan', { actionId: actionId, params: params || {} }).then(function (p) {
          paramsRef.current = params || {};
          setPlan(p);
        }, function (e) { setError(String((e && e.message) || e)); });
      };

      var confirmPlan = function () {
        if (!plan) return;
        setBusy(true);
        call('action.confirm', { actionId: plan.actionId, planId: plan.planId, token: plan.token, params: paramsRef.current || {} })
          .then(function (out) {
            setBusy(false); setPlan(null);
            var rid = out && out.receipt && out.receipt.receiptId;
            setMessage(rid ? '已执行，回执 ' + rid : '已执行');
            setSel('');
            load();
          }, function (e) {
            setBusy(false);
            setPlan(null);
            setError(String((e && e.message) || e));
          });
      };

      var advance = stage && stageIndex(stage) < STAGE_ORDER.length - 1 ? STAGE_ORDER[stageIndex(stage) + 1] : '';
      var readyCount = projects.filter(function (p) { return p.next && p.next.ready; }).length;

      // 仪表数据：全在 snapshot 里，不额外打宿主
      var today = todayItems(projects, (snap && snap.submissions) || []);
      var dueRows = ((snap && snap.submissions) || [])
        .filter(function (s) { return s.kind === 'submission' && SUB_CLOSED_STATUS.indexOf(s.status) < 0; })
        .map(function (s) { return { s: s, d: daysLeft(s.nextActionDue || s.decisionExpectedAt) }; })
        .filter(function (x) { return x.d != null; })
        .sort(function (a, b) { return a.d - b.d; })
        .slice(0, 5)
        .map(function (x) {
          return h('div', { key: x.s.submissionId || String(x.d), className: 'rl-dash__item' }, [
            h('span', { key: 'd', className: 'rl-tag', 'data-tone': x.d < 0 ? 'err' : (x.d <= 3 ? 'warn' : '') }, dueText(x.d)),
            h('span', { key: 't', className: 'rl-dash__txt' }, (x.s.journalName || x.s.journal || '—') + ' · ' + (x.s.title || x.s.submissionId || '')),
          ]);
        });
      var healthRows = healthItems(snap).map(function (x, i) {
        return h('div', { key: 'h' + i, className: 'rl-dash__item' }, [
          h('span', { key: 't', className: 'rl-dash__txt' + (x.tone === 'warn' ? ' rl-warn' : '') },
            x.text + (x.names && x.names.length ? '：' + x.names.join('、') : '')),
        ]);
      });
      var recents = recentItems(snap, 6);
      var lastBackup = (receipts || []).filter(function (r) { return r.action === 'system.backup' && r.ok !== false; })[0];

      // 跨课题待办总表：用户点名要的那一个功能——把散在各课题里的「下一步」合成一张表
      var todoRows = [];
      projects.forEach(function (p) {
        var nx = p.next || {};
        (nx.todo || []).forEach(function (t) {
          todoRows.push({ slug: p.slug, title: p.title || p.slug, stage: p.stage, why: t.why || '', action: t.action, ready: false });
        });
        if (nx.ready) {
          todoRows.push({ slug: p.slug, title: p.title || p.slug, stage: p.stage, why: '这阶段的检查项都过了，可以推进', action: 'project.stage.set', ready: true });
        }
      });

      function card(key, title, body, extra) {
        return h('div', { key: key, className: 'rl-dash' }, [
          h('div', { key: 'h', className: 'rl-dash__head' }, [
            h('div', { key: 't', className: 'rl-dash__title' }, title),
            extra || null,
          ]),
          h('div', { key: 'b', className: 'rl-dash__body' }, body),
        ]);
      }

      function todayRow(it, i) {
        return h('div', { key: 't' + i, className: 'rl-dash__item' }, [
          h('span', { key: 'x', className: 'rl-dash__txt' }, it.text),
          Btn({ key: 'a', onClick: function () { sendToAi(it.prompt); } }, '生成指令'),
        ]);
      }

      var kpiCell = function (k) {
        return h('div', { key: k.key, className: 'rl-kpi' }, [
          h('div', { key: 'n', className: 'rl-kpi__n' }, [String(k.n), h('span', { key: 'u', className: 'rl-kpi__u' }, k.u)]),
          h('div', { key: 'l', className: 'rl-kpi__l' }, k.label),
        ]);
      };
      var counts = (snap && snap.counts) || {};
      var projectCount = counts.project != null ? counts.project : projects.length;
      var figureCount = counts.figure != null
        ? counts.figure
        : projects.reduce(function (n, p) { return n + ((p.figures || []).length); }, 0);
      var refCount = counts.ref != null ? counts.ref : ((snap && snap.refs) || []).length;
      var openSubs = ((snap && snap.submissions) || []).filter(function (s) {
        return s.kind === 'submission' && SUB_CLOSED_STATUS.indexOf(s.status) < 0;
      }).length;
      var quickSuggest = {
        '--project': projects.map(function (p) { return p.slug; }),
        '--journal': ((snap && snap.journals) || []).map(function (j) { return j.id; }).filter(Boolean),
      };

      return h('div', { className: 'rl-wb rl-page' }, [
        h('div', { key: 'h', className: 'rl-page__head', 'data-rl-tour': 'head' }, [
          h('div', { key: 'l' }, [
            h('div', { key: 't', className: 'rl-page__title' }, '科研库'),
            h('div', { key: 's', className: 'rl-page__sub' },
              projects.length
                ? projectCount + ' 个课题 · ' + readyCount + ' 个就绪 · 最近动作 ' + (receipts[0] ? fmtTime(receipts[0].startedAt) : '—')
                : '库里还没有课题。'),
            rootPath ? h('div', { key: 'r', className: 'rl-sub rl-path', 'data-rl-tour': 'root' }, '库根 ' + rootPath) : null,
          ]),
          h('div', { key: 'a', className: 'rl-page__acts' }, [
            h('button', { key: 'q', type: 'button', className: 'rl-btn rl-btn-primary', onClick: function () { openQuick('add-ref'); } }, '快速登记'),
            h('button', { key: 'n', type: 'button', className: 'rl-btn', onClick: function () { setShowCreate(true); } }, '新建课题'),
            h('button', { key: 'i', type: 'button', className: 'rl-btn', 'data-rl-tour': 'import', onClick: function () { if (onImport) onImport(); } }, '导入数据'),
            h('button', { key: 'r', type: 'button', className: 'rl-btn', onClick: load }, '刷新'),
          ]),
        ]),
        snap ? h('div', { key: 'k', className: 'rl-kpis', 'data-rl-tour': 'counts' }, [
          kpiCell({ key: 'p', label: '课题', n: projectCount, u: '个' }),
          kpiCell({ key: 'f', label: '图', n: figureCount, u: '张' }),
          kpiCell({ key: 'r', label: '文献', n: refCount, u: '条' }),
          kpiCell({ key: 's', label: '在投', n: openSubs, u: '项' }),
        ]) : null,
        error ? h('div', { key: 'e', className: 'rl-err' }, '✗ ' + error) : null,
        message ? h('div', { key: 'm', className: 'rl-ok' }, '✓ ' + message) : null,
        snap ? h('section', { key: 'overview', className: 'rl-section' }, [
          h('div', { key: 'h', className: 'rl-section__head' }, [
            h('div', { key: 't', className: 'rl-section__title' }, '概览'),
            Btn({ key: 'b', onClick: function () { ask('system.backup', {}); }, disabled: busy }, '现在备份'),
          ]),
          h('div', { key: 'b', className: 'rl-wb__dash' }, [
            card('today', '今日该做', today.length
              ? today.map(function (it, i) { return todayRow(it, i); })
              : [h('div', { key: 'x', className: 'rl-sub' }, '今天没有必做的事：各课题的阶段检查项都过了。')]),
            card('due', '投稿倒计时', dueRows.length
              ? dueRows
              : [h('div', { key: 'x', className: 'rl-sub' }, '没有在投/返修的条目。')]),
            card('health', '库体检', healthRows),
            card('recent', '最近动态', recents.length
              ? recents.map(function (r, i) {
                return h('div', { key: 'r' + i, className: 'rl-dash__item' }, [
                  h('span', { key: 't', className: 'rl-dash__txt rl-sub' }, fmtTime(r.at) + ' · ' + r.text),
                ]);
              })
              : [h('div', { key: 'x', className: 'rl-sub' }, '库里还没有可显示的新增内容。')]),
            card('backup', '备份', [
              h('div', { key: 'b', className: 'rl-sub' },
                lastBackup ? '上次备份：' + fmtTime(lastBackup.startedAt) : '还没有备份记录'),
              h('div', { key: 'h', className: 'rl-sub' }, '备份落在库根上一级的 sciwork-backups/，写动作前建议先备一次。'),
            ]),
          ]),
        ]) : null,
        aiDraft ? h('div', { key: 'ai', className: 'rl-box' }, [
          h('div', { key: 'h', className: 'rl-sub' }, '待发送指令（已生成，复制即可）'),
          h('textarea', {
            key: 't', rows: 3, readOnly: true, value: aiDraft,
            onFocus: function (e) { try { e.target.select(); } catch (_) { /* 选中失败不影响复制 */ } },
          }),
          h('div', { key: 'f', className: 'rl-wb__actions' }, [
            Btn({ key: 'c', onClick: function () { setAiDraft(null); } }, '收起'),
          ]),
        ]) : null,
        h('section', { key: 'todos', className: 'rl-section' }, [
          h('div', { key: 'h', className: 'rl-section__head' }, [
            h('div', { key: 't', className: 'rl-section__title' }, '跨课题待办'),
            Btn({ key: 'r', onClick: function () { load(); }, disabled: busy }, '刷新'),
          ]),
          h('div', { key: 'b', className: 'rl-table' }, todoRows.length ? [
            h('div', { key: 'hd', className: 'rl-table__row rl-table__row--head' }, [
              h('span', { key: 'p' }, '课题'),
              h('span', { key: 's' }, '阶段'),
              h('span', { key: 'w' }, '要做什么'),
              h('span', { key: 'a', className: 'rl-table__act' }, '操作'),
            ]),
          ].concat(todoRows.map(function (t, i) {
            var label = '课题「' + t.title + '」在「' + (STAGE_LABEL[t.stage] || t.stage || '—') + '」阶段：'
              + (t.why || '') + '。请执行 ' + t.action + '（写动作先 plan 再 confirm）。';
            return h('div', { key: 'td' + i, className: 'rl-table__row' }, [
              h('span', { key: 'p', className: 'rl-table__proj' }, t.title),
              h('span', { key: 's' }, h('span', { key: 'g', className: 'rl-tag' }, STAGE_LABEL[t.stage] || t.stage || '—')),
              h('span', { key: 'w', className: 'rl-sub' }, (t.why || '待处理') + '（' + t.action + '）'),
              h('span', { key: 'a', className: 'rl-table__act' }, [
                Btn({ key: 'g', onClick: function () { setSel(t.slug); } }, '看课题'),
                Btn({ key: 'a', onClick: function () { sendToAi(label); } }, '生成指令'),
              ]),
            ]);
          })) : [h('div', { key: 'x', className: 'rl-table__empty' }, '没有待办：各课题的阶段检查项都过了。')]),
        ]),
        h('div', { key: 'grid', className: 'rl-wb__grid' }, [
          h('div', { key: 'l', className: 'rl-wb__list' }, projects.length
            ? projects.map(function (p) {
              var blocked = p.next && p.next.blockers ? p.next.blockers.length : 0;
              return h('button', {
                key: p.slug, type: 'button', className: 'rl-wb__row', 'data-active': p.slug === sel ? '1' : '0',
                onClick: function () { setSel(p.slug); },
              }, [
                h('div', { key: 't', className: 'rl-wb__rowTitle' }, p.title || p.slug),
                h('div', { key: 's', className: 'rl-sub' },
                  (STAGE_LABEL[p.stage] || p.stage || '—')
                  + (p.needsSchemaUpgrade ? ' · 旧库待迁移' : '')
                  + (p.next && p.next.ready ? ' · 就绪' : (blocked ? ' · ' + blocked + ' 项阻塞' : ''))),
              ]);
            })
            : h('div', { className: 'rl-empty' }, '课题列表是空的。')),
          h('div', { key: 'r', className: 'rl-wb__detail' }, current ? [
            h('div', { key: 't', className: 'rl-wb__title' }, current.title || current.slug),
            h(StageBar, { key: 'st', stage: stage }),
            ((detail && detail.needsMigration) || current.needsSchemaUpgrade)
              ? h('div', { key: 'mg', className: 'rl-warnbox' }, [
                h('div', { key: 't' }, '这个课题还是旧库形状，写动作会被拒绝。'),
                h('button', {
                  key: 'b', type: 'button', className: 'rl-btn rl-btn--primary',
                  onClick: function () { ask('system.migrate', {}); },
                }, '生成迁移计划'),
              ])
              : null,
            h('div', { key: 'cur', className: 'rl-sub' }, '当前阶段：' + (STAGE_LABEL[stage] || stage || '—')),
            h('div', { key: 'todo' }, [
              h('div', { key: 'h', className: 'rl-sub' }, next && next.ready ? '下一步' : '待办 / 阻塞'),
              h('ul', { key: 'ul', className: 'rl-list' },
                ((next && next.todo) || []).map(function (t, i) {
                  return h('li', { key: 't' + i }, [
                    h('span', { key: 's' }, (t.why || '') + '（' + t.action + '）'),
                    Btn({
                      key: 'a',
                      onClick: function () {
                        sendToAi('课题「' + (current.title || current.slug) + '」在「' + (STAGE_LABEL[stage] || stage || '—')
                          + '」阶段：' + (t.why || '') + '。请执行 ' + t.action + '（写动作先 plan 再 confirm）。');
                      },
                    }, '生成指令'),
                  ]);
                }).concat(((next && next.blockers) || []).map(function (b, i) {
                  return h('li', { key: 'b' + i, className: 'rl-warn' }, '✗ ' + (b.why || '') + (b.hint ? '：' + b.hint : ''));
                })).concat(
                  next && ((next.todo || []).length + (next.blockers || []).length) === 0
                    ? [h('li', { key: 'ok' }, '这一阶段没有阻塞。')] : [],
                )),
              h('div', { key: 'a', className: 'rl-wb__actions' }, [
                advance
                  ? h('button', {
                    key: 'n', type: 'button', className: 'rl-btn rl-btn--primary',
                    onClick: function () { ask('project.stage.set', { project: current.slug, stage: advance }); },
                  }, '推进到「' + STAGE_LABEL[advance] + '」')
                  : null,
              ]),
            ]),
          ] : h('div', { key: 'empty', className: 'rl-empty' }, '选一个课题，看它的阶段、检查项与下一步。')),
        ]),
        h('div', { key: 'rec', className: 'rl-wb__rec' }, [
          h('div', { key: 'h', className: 'rl-sub' }, '最近回执'),
          receipts.length
            ? h('ul', { key: 'ul', className: 'rl-list' }, receipts.map(function (r, i) {
              return h('li', { key: i, className: 'rl-mono' },
                fmtTime(r.startedAt) + ' · ' + (r.action || '—') + (r.ok === false ? ' · ✗' : ' · ✓') + (r.wrote && r.wrote.length ? ' · 写 ' + r.wrote.length : ''));
            }))
            : h('div', { key: 'e', className: 'rl-sub' }, '还没有回执；写动作后会记一行 .research/receipts/。'),
        ]),
        quick
          ? h(QuickModal, {
            key: 'quick',
            quick: quick,
            suggest: quickSuggest,
            onField: quickField,
            onSwitch: function (id) { openQuick(id); },
            onClose: function () { setQuick(null); },
            onSubmit: quickSubmit,
          })
          : null,
        showCreate
          ? h(CreateModal, {
            key: 'create',
            onClose: function () { setShowCreate(false); },
            onCreate: function (slug, title) { setShowCreate(false); ask('project.create', { slug: slug, title: title }); },
          })
          : null,
        h(PlanModal, { key: 'plan', plan: plan, busy: busy, error: null, onCancel: function () { setPlan(null); }, onConfirm: confirmPlan }),
      ]);
    }

    function makePanel(ctx) {
      return function ResearchPanel() {
        ensureStyle();
        var snapState = React.useState(null);
        var snap = snapState[0], setSnap = snapState[1];
        var loadState = React.useState(true);
        var loading = loadState[0], setLoading = loadState[1];
        var errState = React.useState(null);
        var error = errState[0], setError = errState[1];
        var uiState = React.useState(uiVersion());
        var uiVer = uiState[0], setUiVer = uiState[1];
        var tabState = React.useState(uiVersion() === 'v2' ? 'workbench' : 'figures');
        var tab = tabState[0], setTab = tabState[1];
        var lastV1State = React.useState(tab === 'workbench' ? 'figures' : tab);
        var lastV1Tab = lastV1State[0], setLastV1Tab = lastV1State[1];
        // 新手引导：welcome = 首屏欢迎卡（看过一次就不再自动出现）；tour = 分步导览的当前步；
        // rect = 当前锚点的位置（量不到就是 null → 说明卡居中）。
        var welcomeState = React.useState(!lsGet('welcome'));
        var welcome = welcomeState[0], setWelcome = welcomeState[1];
        var tourState = React.useState(null);
        var tour = tourState[0], setTour = tourState[1];
        var rectState = React.useState(null);
        var rect = rectState[0], setRect = rectState[1];
        // 导入弹层：null = 关着。可以是 true（默认目标），也可以是 {target, files}（拖进来的文件）。
        var importState = React.useState(null);
        var importOpen = importState[0], setImportOpen = importState[1];
        // 每次打开给弹层一个新身份：拖进来的那批文件、填过的字段都从零开始，不会串上一次的残留。
        var importSeqState = React.useState(0);
        var importSeq = importSeqState[0], setImportSeq = importSeqState[1];
        var openImport = function (payload) { setImportOpen(payload); setImportSeq(function (n) { return n + 1; }); };
        // 搜索框：只筛看得见的列表，不碰磁盘。
        var qState = React.useState('');
        var q = qState[0], setQ = qState[1];
        var dragState = React.useState(false);
        var dragging = dragState[0], setDragging = dragState[1];
        // 数据变换弹层的开关
        var tfState = React.useState(null);
        var tfTarget = tfState[0], setTfTarget = tfState[1];
        // 命令台：null = 关。命令元数据是只读的，开弹层时取一次就够。
        var consoleState = React.useState(null);
        var consoleState_ = consoleState[0], setConsoleState = consoleState[1];
        var cliCmdsState = React.useState(null);
        var cliCmds = cliCmdsState[0], setCliCmds = cliCmdsState[1];
        var consoleErrState = React.useState(null);
        var consoleErr = consoleErrState[0], setConsoleErr = consoleErrState[1];
        var openConsole = function () {
          setConsoleState(true);
          setConsoleErr(null);
          if (cliCmds) return;
          call('cliCommands', {}).then(function (r) { setCliCmds((r && r.commands) || []); },
            function (e) { setConsoleErr(String(e.message || e)); });
        };
        // 同一类目录里的文件按「子文件夹」分组显示（数据/图表/草稿），组头能整组展开 / 折叠。
        var openState = React.useState({});
        var openGroups = openState[0], setOpenGroups = openState[1];
        var isGroupOpen = function (groupKey) { return openGroups[groupKey] !== false; };   // 默认展开
        var toggleGroup = function (groupKey) {
          setOpenGroups(function (prev) {
            var next = {};
            Object.keys(prev).forEach(function (k) { next[k] = prev[k]; });
            next[groupKey] = prev[groupKey] === false;
            return next;
          });
        };
        var call = React.useCallback(function (action, args) { return hostCall(ctx, action, args); }, []);

        var refresh = React.useCallback(function () {
          setLoading(true); setError(null);
          call('snapshot').then(function (s) { setLoading(false); setSnap(s); if (s && s.ok === false) setError(s.error || '科研库不可读'); },
            function (e) { setLoading(false); setError(String(e.message || e)); });
        }, [call]);

        React.useEffect(function () { refresh(); }, [refresh]);

        /* ---- 新手引导的动作（欢迎卡 + 分步导览）---- */

        var tourIndex = tour ? tour.index : -1;

        function startTour(index) {
          dismissWelcome();
          var i = typeof index === 'number' ? index : 0;
          i = Math.max(0, Math.min(TOUR_STEPS.length - 1, i));
          var step = TOUR_STEPS[i];
          if (step && step.tab) setTab(step.tab);
          lsSet('tour', 'open'); lsSet('step', String(i));
          setTour({ index: i });
        }

        function goStep(index) {
          var i = Math.max(0, Math.min(TOUR_STEPS.length - 1, index));
          var step = TOUR_STEPS[i];
          if (step && step.tab) setTab(step.tab);
          lsSet('step', String(i));
          setTour({ index: i });
        }

        function closeTour(done) {
          setTour(null); setRect(null);
          lsSet('tour', done ? '1' : '0'); lsSet('step', '0');
        }

        function tourNext() {
          if (tourIndex < 0) return;
          if (tourIndex >= TOUR_STEPS.length - 1) closeTour(true); else goStep(tourIndex + 1);
        }

        function tourBack() { if (tourIndex > 0) goStep(tourIndex - 1); }

        function dismissWelcome() { setWelcome(false); lsSet('welcome', '1'); }

        function pickTab(id) {
          dismissWelcome();
          setTab(id);
          if (uiVer !== 'v2') setLastV1Tab(id);
        }

        function switchVer(target) {
          lsSet(UI_VERSION_KEY, target);
          setUiVer(target);
          if (target === 'v2') {
            if (tab !== 'workbench') setLastV1Tab(tab);
            setTab('workbench');
          } else {
            setTab(lastV1Tab || 'figures');
          }
        }

        // 每一步都重新量锚点：切页签、用户滚动、窗口拉伸都会让位置变。
        React.useEffect(function () {
          if (tourIndex < 0) { setRect(null); return undefined; }
          var step = TOUR_STEPS[tourIndex];
          function measure() { setRect(measureAnchor(step && step.anchor)); }
          measure();
          var later = null;
          try { if (typeof setTimeout === 'function') later = setTimeout(measure, 60); } catch (e) { /* ignore */ }
          var attached = false;
          function onMove() { measure(); }
          try {
            if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
              window.addEventListener('resize', onMove);
              window.addEventListener('scroll', onMove, true);
              attached = true;
            }
          } catch (e) { attached = false; }
          return function () {
            if (later) { try { clearTimeout(later); } catch (e) { /* ignore */ } }
            if (attached) {
              try {
                window.removeEventListener('resize', onMove);
                window.removeEventListener('scroll', onMove, true);
              } catch (e) { /* ignore */ }
            }
          };
        }, [tourIndex]);

        // 键盘：Esc 关掉，← → 翻页，Enter 下一步。
        React.useEffect(function () {
          if (tourIndex < 0) return undefined;
          if (typeof window === 'undefined' || !window || typeof window.addEventListener !== 'function') return undefined;
          function onKey(e) {
            if (e && e.__rlEscHandled) return;
            var k = e && e.key;
            if (k === 'Escape') closeTour(true);
            else if (k === 'ArrowRight' || k === 'Enter') tourNext();
            else if (k === 'ArrowLeft') tourBack();
          }
          window.addEventListener('keydown', onKey);
          return function () { try { window.removeEventListener('keydown', onKey); } catch (e) { /* ignore */ } };
        }, [tourIndex]);

        function body() {
          if (tab === 'workbench') {
            // v2 的页头在 Workbench 内，shell 头隐藏；提示条改在这里渲染。
            return h('div', null, [
              (snap && snap.warnings && snap.warnings.length)
                ? h('ul', { key: 'w', className: 'rl-warns' }, snap.warnings.map(function (w, i) { return h('li', { key: i }, '⚠ ' + w); }))
                : null,
              h(Workbench, {
                key: 'wb',
                call: call,
                root: rootPath,
                onImport: function () { openImport(true); },
                onConsole: openConsole,
                onTour: function () { startTour(0); },
              }),
            ]);
          }
          if (!snap) return h('div', { className: 'rl-empty' }, loading ? '正在读科研库…' : '（没有数据）');
          // 搜索框只筛「看得见的列表」，不动库里任何东西；filterSnap 返回浅拷贝，
          // 所以 renderBody 里所有 snap.* 的写法自动变成「筛过的视图」。
          return renderBody(filterSnap(snap, q));
        }

        // 注意：参数必须叫 snap（渲染逻辑大量用 snap.*），所以不能写成 body() 里的
        // `var snap = filterSnap(snap, q)` —— var 会提升，把外面的 snap 遮成 undefined，
        // 正文会变成「（没有数据）」。
        function renderBody(snap) {
          if (tab === 'figures') {
            if (!snap.projects.length) return h('div', { className: 'rl-empty' }, [
              h('div', { key: 't' }, '库里还没有课题。'),
              h('div', { key: 'b', style: { marginTop: '8px' } },
                Btn({ onClick: function () { openImport({ target: 'project' }); } }, '新建课题')),
            ]);
            return snap.projects.map(function (p) {
              // 分组只跟「真的有图的子文件夹」有关：以前还把 folders.figures（figures 下的**每个**
              // 目录）并进 subs，于是 _history / _v18_noline 这类目录各顶一个「（空）」组头，
              // 且 subs.length>1 会把本可以平铺的单图强行折叠起来。草稿页一直是只按 entry 收 sub，
              // 这里跟它对齐（空文件夹是数据页的事，图表页只报有图的组）。
              var subs = [];
              p.figures.forEach(function (f) { var s = f.sub || ''; if (subs.indexOf(s) < 0) subs.push(s); });
              subs.sort(function (a, b) { return a === '' ? -1 : (b === '' ? 1 : a.localeCompare(b)); });
              return h('div', { key: p.slug, style: { marginBottom: '14px' } }, [
                h('div', { key: 'h', className: 'rl-row' },
                  h('div', null, h('strong', null, p.title || p.slug), h('span', { className: 'rl-sub' }, ' · ' + p.slug + (p.journal ? ' · ' + p.journal : ''))),
                  h('span', { className: 'rl-sub' }, '图 ' + p.figures.length + ' · 稿 ' + p.drafts.length + ' · 数据 ' + p.datasets.length + ' · 工程 ' + p.opju.length),
                ),
                p.figures.length ? (subs.length > 1
                  ? subs.map(function (s) {
                    var mine = p.figures.filter(function (f) { return (f.sub || '') === s; });
                    var gk = p.slug + '|fig:' + s;
                    var open = isGroupOpen(gk);
                    return h('div', { key: 'g' + s, className: 'rl-group' }, [
                      h('div', { key: 'gh', className: 'rl-group__head' }, [
                        h('button', { key: 't', type: 'button', className: 'rl-group__toggle', onClick: function () { toggleGroup(gk); } },
                          (open ? '▾ ' : '▸ ') + subLabel('figure', s)),
                        h('span', { key: 'c', className: 'rl-sub' }, mine.length ? mine.length + ' 张' : '（空）'),
                      ]),
                      open ? (mine.length ? mine.map(function (f) { return h(FigureCard, { key: f.sidecar, fig: f, call: call, ctx: ctx, onReload: refresh }); })
                        : h('div', { key: 'e', className: 'rl-group__empty' }, '这个文件夹还是空的。')) : null,
                    ]);
                  })
                  : p.figures.map(function (f) { return h(FigureCard, { key: f.sidecar, fig: f, call: call, ctx: ctx, onReload: refresh }); }))
                  : h('div', { key: 'nf', className: 'rl-empty' }, [
                    h('div', { key: 't' }, '这个课题还没有登记过图（智能体用 research.py register-figure 登记）。'),
                    h('div', { key: 'b', style: { marginTop: '8px' } },
                      Btn({ onClick: function () { openImport({ target: 'figures' }); } }, '导入图片')),
                  ]),
              ]);
            });
          }
          if (tab === 'drafts') {
            var newDraft = h(NewDraftForm, { key: 'newdraft', ctx: ctx, snap: snap, onReload: refresh });
            var anyDraft = snap.projects.some(function (p) { return p.drafts.length; });
            if (!anyDraft) {
              return h('div', null, [newDraft, h('div', { key: 'e', className: 'rl-empty' }, '还没有草稿（projects/<课题>/drafts/）。')]);
            }
            return h('div', null, [newDraft].concat(snap.projects.map(function (p) {
              if (!p.drafts.length) return null;
              var subs = [];
              p.drafts.forEach(function (d) { var s = d.sub || ''; if (subs.indexOf(s) < 0) subs.push(s); });
              subs.sort(function (a, b) { return a === '' ? -1 : (b === '' ? 1 : a.localeCompare(b)); });
              var groups = subs.map(function (s) {
                var mine = p.drafts.filter(function (d) { return (d.sub || '') === s; });
                if (subs.length === 1 && s === '') {
                  return h('div', { key: 'g', className: 'rl-group' }, mine.map(function (d) {
                    return h(DraftCard, { key: d.path, draft: d, call: call, ctx: ctx, onReload: refresh });
                  }));
                }
                var gk = p.slug + '|draft:' + s;
                var open = isGroupOpen(gk);
                return h('div', { key: 'g' + s, className: 'rl-group' }, [
                  h('div', { key: 'gh', className: 'rl-group__head' }, [
                    h('button', { key: 't', type: 'button', className: 'rl-group__toggle', onClick: function () { toggleGroup(gk); } },
                      (open ? '▾ ' : '▸ ') + subLabel('draft', s)),
                    h('span', { key: 'c', className: 'rl-sub' }, mine.length + ' 篇'),
                  ]),
                  open ? mine.map(function (d) { return h(DraftCard, { key: d.path, draft: d, call: call, ctx: ctx, onReload: refresh }); }) : null,
                ]);
              });
              return h('div', { key: p.slug, style: { marginBottom: '14px' } }, [
                h('div', { key: 'h', style: { fontWeight: 600, margin: '6px 0 2px' } }, (p.title || p.slug) + '（' + p.drafts.length + ' 篇）'),
              ].concat(groups));
            })));
          }
          if (tab === 'refs') {
            var pdfBlock = (snap.pdfs && snap.pdfs.length)
              ? h('div', { key: 'pdfs', style: { marginTop: '12px' } }, [
                h('div', { key: 'h', className: 'rl-sub' }, '本地 PDF 附件（refs/pdf/，' + snap.pdfs.length + ' 个文件）：'),
                snap.pdfs.map(function (f) { return h(FileRow, { key: f.path, ctx: ctx, file: f, reason: '文献 PDF 归档', onReload: refresh }); }),
              ])
              : null;
            if (!snap.refs.length) {
              return h('div', null, [
                h('div', { key: 'e', className: 'rl-empty' }, [
                h('div', { key: 't' }, '文献库还是空的（refs/refs.json）。引用零编造：先登记再引用。'),
                h('div', { key: 'b', style: { marginTop: '8px' } },
                  Btn({ onClick: function () { openImport({ target: 'refs' }); } }, '导入文献')),
              ]),
                pdfBlock,
              ]);
            }
            return h('div', null, [
              h('div', { key: 'nt', className: 'rl-sub', style: { marginBottom: '6px' } },
                '文献条目写在 refs/refs.json（登记索引）里：面板不直接改它 ——「删除」走库脚本 research.py remove-ref，会先备份 refs.json、同步 refs.bib，并告诉你还有哪些草稿在引用这个键。'),
              h('table', { key: 'tb', className: 'rl-table' }, [
              h('thead', { key: 'th' }, h('tr', null, ['键', '年', '作者 / 标题', '出处', '标识', '核验', '操作'].map(function (x) { return h('th', { key: x }, x); }))),
              h('tbody', { key: 'tb' }, snap.refs.map(function (r) {
                return h('tr', { key: r.key }, [
                  h('td', { key: 'k', className: 'rl-mono' }, r.key),
                  h('td', { key: 'y' }, r.year == null ? '—' : String(r.year)),
                  h('td', { key: 't' }, [h('div', { key: 'a', className: 'rl-sub' }, (r.authors || []).join('; ') || '（无作者）'), h('div', { key: 'b' }, r.title)]),
                  h('td', { key: 'c' }, r.container + (r.volume ? ' ' + r.volume : '') + (r.pages ? ': ' + r.pages : '')),
                  h('td', { key: 'i' }, r.doi
                    ? h('a', { href: 'https://doi.org/' + r.doi, target: '_blank', rel: 'noreferrer', className: 'rl-mono' }, 'DOI')
                    : (r.url ? h('a', { href: r.url, target: '_blank', rel: 'noreferrer', className: 'rl-mono' }, 'URL') : h('span', { className: 'rl-warn' }, '无 DOI/URL'))),
                  h('td', { key: 'v', className: 'rl-sub' }, [VERIFIED_CN[r.verifiedBy || r.source] || r.verifiedBy || r.source || '—', r.projects && r.projects.length ? h('div', { key: 'p', className: 'rl-sub rl-dim' }, r.projects.join('、')) : null]),
                  h('td', { key: 'x' }, h(RefActions, { key: 'ra', refKey: r.key, ctx: ctx, onReload: refresh })),
                ]);
              })),
              ]),
              pdfBlock,
            ]);
          }
          if (tab === 'assets') {
            var any = false;
            var blocks = snap.projects.map(function (p) {
              var items = p.datasets.concat(p.tables, p.opju);
              var folds = p.folders || {};
              var emptyData = ((folds.data || [])).filter(function (f) {
                return !p.datasets.some(function (d) { return (d.sub || '') === f; });
              });
              if (!items.length && !emptyData.length) return null;
              any = true;
              // 分组：数据按子文件夹、表格/工程各一组；顺序 = 数据组（按名字）→ 表格 → 工程
              var order = [];
              var groups = {};
              var push = function (key, kind, sub, a) {
                if (!groups[key]) { groups[key] = { key: key, kind: kind, sub: sub, items: [], names: {} }; order.push(key); }
                if (a) { groups[key].items.push(a); groups[key].names[a.path] = a.name || ''; }
              };
              p.datasets.forEach(function (d) { push('data:' + (d.sub || ''), 'data', d.sub || '', d); });
              emptyData.forEach(function (f) { push('data:' + f, 'data', f, null); });
              if (p.tables.length) push('table', 'table', '', null);
              p.tables.forEach(function (t) { groups.table.items.push(t); groups.table.names[t.path] = t.name || ''; });
              p.opju.forEach(function (o) { push('opju', 'opju', '', o); });
              order.sort(function (a, b) {
                var rank = function (k) { return k.indexOf('table') === 0 ? 1 : (k.indexOf('opju') === 0 ? 2 : 0); };
                return rank(a) - rank(b) || a.localeCompare(b);
              });
              return h('div', { key: p.slug, style: { marginBottom: '16px' } }, [
                h('div', { key: 'h', className: 'rl-row', style: { marginBottom: '6px' } },
                  h('div', { style: { fontWeight: 600 } }, (p.title || p.slug) + '（' + items.length + ' 个文件' + (order.length > 1 ? ' · ' + order.length + ' 组' : '') + '）'),
                  h('span', { className: 'rl-sub' }, '按落库时的文件夹分组 · ' + p.slug),
                ),
              ].concat(groups && order.map(function (gk) {
                var g = groups[gk];
                var open = isGroupOpen(p.slug + '|' + gk);
                return h('div', { key: gk, className: 'rl-group' }, [
                  h('div', { key: 'gh', className: 'rl-group__head' }, [
                    h('button', {
                      key: 't', type: 'button', className: 'rl-group__toggle',
                      onClick: function () { toggleGroup(p.slug + '|' + gk); },
                    }, (open ? '▾ ' : '▸ ') + subLabel(g.kind, g.sub)),
                    h('span', { key: 'c', className: 'rl-sub' }, g.items.length ? (g.items.length + ' 个文件') : '（空）'),
                  ]),
                  open ? (g.items.length
                    ? g.items.map(function (a) {
                      return h(AssetCard, {
                        key: a.path, asset: a, call: call, project: p.slug, ctx: ctx, onReload: refresh,
                        onTransform: function (target) { setTfTarget(target); },
                      });
                    })
                    : h('div', { key: 'e', className: 'rl-group__empty' }, '这个文件夹还是空的（导入时填了子目录但没落文件）。')) : null,
                ]);
              })));
            });
            return any ? blocks : h('div', { className: 'rl-empty' }, '课题里还没有数据文件。');
          }
          if (tab === 'journals') {
            if (!snap.journals.length) return h('div', { className: 'rl-empty' }, [
              h('div', { key: 't' }, '还没有期刊档案。'),
              h('div', { key: 'h', className: 'rl-sub' }, '让智能体抓目标期刊官网规范后建档；也可以先复制这条命令：'),
              h('div', { key: 'b', style: { marginTop: '8px' } },
                h(CopyBtn, { text: '请用 research.py journal-add <期刊名> 抓官网规范建一份期刊档案' })),
            ]);
            return h('div', null, [
              h('div', { key: 'tip', className: 'rl-sub', style: { marginBottom: '8px' } }, '档案里的数值字段可能是 null（抓不到官网规范时宁缺勿猜）；confidence 是这份档案的可信度，不是期刊的等级。'),
              snap.journals.map(function (j) {
                return Card({ key: j.id, children: [
                  h('div', { key: 'hd', className: 'rl-row' },
                    h('div', null, h('strong', null, j.name || j.id), j.nameZh ? h('span', { className: 'rl-sub' }, ' · ' + j.nameZh) : null),
                    h('span', { className: 'rl-badge ' + confClass(j.confidence), title: 'confidence=' + j.confidence }, '可信度：' + (CONF_CN[j.confidence] || j.confidence)),
                  ),
                  h('div', { key: 'm', className: 'rl-sub' }, (j.publisher || '—') + ' · ' + (LANG_CN[j.language] || j.language || '—') + ' · 核验于 ' + (j.verifiedAt || '—')),
                  j.homepage ? h('a', { key: 'hp', href: j.homepage, target: '_blank', rel: 'noreferrer', className: 'rl-mono rl-sub' }, j.homepage) : null,
                  j.note ? h('div', { key: 'n', className: 'rl-sub rl-dim', style: { marginTop: '4px' } }, j.note) : null,
                  h('div', { key: 'f', className: 'rl-sub rl-mono' }, j.file + '（' + fmtBytes(j.bytes) + '）'),
                ] });
              }),
            ]);
          }
          if (tab === 'submissions') {
            var SCLS = { drafting: 'rl-idle', submitted: 'rl-idle', 'under-review': 'rl-idle', revision: 'rl-warn', accepted: 'rl-ok', published: 'rl-ok', rejected: 'rl-err', withdrawn: 'rl-err' };
            var CLOSED = ['accepted', 'published', 'rejected', 'withdrawn'];
            var today = new Date().toISOString().slice(0, 10);
            var rows = (snap.submissions || []).filter(function (s) { return s.kind === 'submission'; });
            var others = (snap.submissions || []).filter(function (s) { return s.kind !== 'submission'; });
            return h('div', null, [
              h('div', { key: 'cnt', className: 'rl-sub', style: { marginBottom: '8px' } },
                '投稿记录 ' + rows.length + ' 条' + (others.length ? '，另有 ' + others.length + ' 个非记录文件' : '') + '（台账来自 submissions/ 目录，只读）'),
              rows.length
                ? rows.map(function (s) {
                  var due = s.nextActionDue ? String(s.nextActionDue).slice(0, 10) : null;
                  var overdue = due && CLOSED.indexOf(s.status) < 0 && due < today;
                  return Card({
                    key: s.path,
                    children: [
                      h('div', { key: 'hd', className: 'rl-row' },
                        h('div', null,
                          h('span', { className: 'rl-mono rl-brand' }, s.submissionId),
                          h('span', { className: 'rl-badge ' + (SCLS[s.status] || ''), style: { marginLeft: '6px' }, title: s.status }, SUB_STATUS_CN[s.status] || s.status),
                          s.journal ? h('span', { className: 'rl-badge', style: { marginLeft: '6px' } }, s.journal + (s.journalName ? ' · ' + s.journalName : '')) : null,
                          s.title ? h('div', { className: 'rl-sub', style: { marginTop: '2px' } }, s.title) : null,
                        ),
                        h('div', { className: 'rl-actions' },
                          s.project ? h('span', { className: 'rl-badge rl-mono' }, s.project) : null,
                          h('span', { className: 'rl-badge rl-mono' }, s.eventCount + ' 事件'),
                        ),
                      ),
                      h('div', { key: 'm', className: 'rl-sub' },
                        '稿件 ' + (s.manuscript || s.coverLetter || '—')
                        + (s.manuscriptId ? ' · 稿件号 ' + s.manuscriptId : '')
                        + (s.doi ? ' · DOI ' + s.doi : '')),
                      (s.submittedAt || s.decisionExpectedAt)
                        ? h('div', { key: 't', className: 'rl-sub' }, '投出 ' + fmtTime(s.submittedAt) + ' · 预计决定 ' + fmtTime(s.decisionExpectedAt))
                        : null,
                      (s.nextAction || s.nextActionDue)
                        ? h('div', { key: 'n', className: overdue ? 'rl-warn' : 'rl-sub' },
                          '下一步：' + (s.nextAction || '（未写具体动作）') + (due ? ' · 截止 ' + due : '') + (overdue ? '（已过期）' : ''))
                        : h('div', { key: 'n0', className: 'rl-warn' }, '没有登记下一步动作'),
                      s.lastEvent
                        ? h('div', { key: 'e', className: 'rl-sub rl-dim' }, '最近事件 ' + fmtTime(s.lastEvent.at) + ' · ' + (s.lastEvent.status || s.status) + (s.lastEvent.note ? ' · ' + s.lastEvent.note : ''))
                        : null,
                      h('div', { key: 'f', className: 'rl-sub rl-mono' }, s.path + '（' + fmtBytes(s.bytes) + '）'),
                      h('div', { key: 'cp', style: { marginTop: '4px' } }, h(CopyBtn, { text: '请用 research.py update-submission ' + s.submissionId + ' --status <新状态> --note <备注> 更新这条投稿记录' })),
                      h(SubmissionTools, { key: 'tools', ctx: ctx, sub: s }),
                    ],
                  });
                })
                : h('div', { key: 'empty', className: 'rl-empty' }, [
                  h('div', { key: 't' }, '还没有投稿记录。'),
                  h('div', { key: 'b', style: { marginTop: '8px' } },
                    Btn({ onClick: function () { openImport({ target: 'submission' }); } }, '记一条投稿')),
                ]),
              others.length
                ? h('div', { key: 'others', style: { marginTop: '10px' } }, [
                  h('div', { key: 'h', className: 'rl-sub' }, '目录里的非记录文件（面板只列名，不做解释）：'),
                  h('ul', { key: 'l', className: 'rl-warns' }, others.map(function (f, i) {
                    return h('li', { key: i, className: 'rl-mono' }, f.name + ' · ' + fmtBytes(f.bytes) + (f.warnings && f.warnings.length ? '（' + f.warnings.join('；') + '）' : ''));
                  })),
                ])
                : null,
              h('div', { key: 'hint', style: { marginTop: '10px' } }, h(CopyBtn, { text: '请用 research.py add-submission --journal <期刊档案键> --project <课题> --title <标题> --status drafting --next-action <下一步> --next-action-due <YYYY-MM-DD> 登记一条投稿记录' })),
            ]);
          }
          if (tab === 'archive') {
            return h(ArchiveTab, { key: 'archive', ctx: ctx, onReload: refresh });
          }
          return null;
        }

        var counts = (snap && snap.counts) || {};
        var rootPath = (snap && snap.root) || '（未知库根）';
        var tourStep = tourIndex >= 0 ? TOUR_STEPS[tourIndex] : null;
        return h('div', {
          className: 'rl-root' + (dragging ? ' rl-drop' : ''),
          onDragOver: function (e) { if (e && e.preventDefault) e.preventDefault(); setDragging(true); },
          onDragLeave: function (e) { if (e && e.preventDefault) e.preventDefault(); setDragging(false); },
          onDrop: function (e) {
            if (e && e.preventDefault) e.preventDefault();
            setDragging(false);
            var dropped = [];
            try { dropped = Array.prototype.slice.call((e && e.dataTransfer && e.dataTransfer.files) || []); } catch (err) { dropped = []; }
            if (!dropped.length) return;
            openImport({ target: guessTarget(dropped), files: dropped });
          },
        }, [
          uiVer === 'v2' ? null : h('div', { key: 'head', className: 'rl-head', 'data-rl-tour': 'head' }, [
            h('div', { key: 't', className: 'rl-title' },
              h('span', null, '科研库'),
              h('span', { className: 'rl-sub', style: { fontWeight: 400 } }, '读取、导入与归档均经库脚本；写入不碰登记索引'),
              h('div', { style: { marginLeft: 'auto' } }, [
                Btn({ key: 'n', 'data-rl-tour': 'newproject', onClick: function () { openImport({ target: 'project' }); } }, '新建课题'),
                uiVer === 'v2' ? null : Btn({ key: 'i', primary: true, 'data-rl-tour': 'import', onClick: function () { openImport(true); } }, '导入'),
                Btn({ key: 'r', onClick: refresh, disabled: loading }, loading ? '读取中…' : '刷新'),
              ]),
            ),
            h('div', { key: 'p', className: 'rl-path', 'data-rl-tour': 'root' }, rootPath),
            h('div', { key: 'c', className: 'rl-counts', 'data-rl-tour': 'counts' },
              [['课题', counts.project], ['图', counts.figure], ['草稿', counts.draft], ['数据', counts.dataset],
               ['文献', counts.ref], ['期刊档案', counts.journal], ['投稿', counts.submission]].map(function (it) {
                return h('span', { key: it[0] }, it[0], ' ', h('b', null, String(it[1] || 0)));
              }).concat(snap && snap.indexAt
                ? [h('span', { key: 'idx' }, '索引 ', h('b', null, fmtTime(snap.indexAt)))]
                : [])),
            error ? h('div', { key: 'e', className: 'rl-err', style: { marginTop: '6px' } }, '✗ ' + error) : null,
            (snap && snap.warnings && snap.warnings.length)
              ? h('ul', { key: 'w', className: 'rl-warns' }, snap.warnings.map(function (w, i) { return h('li', { key: i }, '⚠ ' + w); }))
              : null,
          ]),
          h('div', { key: 'tabs', className: 'rl-tabs', 'data-rl-tour': 'tabs' },
            tabsFor(uiVer).map(function (t) {
              return h('button', {
                key: t.id, type: 'button', className: 'rl-tab', 'data-active': tab === t.id ? '1' : '0',
                'data-rl-tour': 'tab:' + t.id,
                onClick: function () { pickTab(t.id); },
              }, t.label);
            }).concat([
              h('div', { key: 'ver', className: 'rl-vertabs' }, [
                uiVer === 'v2'
                  ? h('button', {
                    key: 'v1', type: 'button', className: 'rl-tab',
                    title: '按页签浏览：图表 / 数据 / 草稿 / 文献 / 期刊 / 投稿 / 归档',
                    onClick: function () { switchVer('v1'); },
                  }, '列表面板')
                  : h('button', {
                    key: 'v2', type: 'button', className: 'rl-tab',
                    title: '工作台：页头、指标、跨课题待办与课题详情',
                    onClick: function () { switchVer('v2'); },
                  }, '工作台'),
              ]),
              h('button', { key: 'c', type: 'button', className: 'rl-tab', onClick: openConsole }, '命令台'),
              h('button', { key: 'g', type: 'button', className: 'rl-tab', onClick: function () { startTour(0); } }, '引导'),
              h('input', {
                key: 'q', className: 'rl-tool rl-search', style: { marginLeft: 'auto' },
                value: q, placeholder: '筛选这一页（课题 / 图 / 草稿 / 文献 / 档案）',
                'aria-label': '筛选',
                onChange: function (e) { setQ(e.target.value); },
              }),
              q ? h('button', {
                key: 'qc', type: 'button', className: 'rl-btn',
                onClick: function () { setQ(''); },
              }, '清空筛选') : null,
            ])),
          h('div', { key: 'body', className: 'rl-body', 'data-rl-tour': 'body' },
            welcome
              ? h(WelcomeCard, {
                root: rootPath,
                onTour: function () { startTour(0); },
                onDismiss: dismissWelcome,
              })
              : body()),
          h('div', {
            key: 'foot', className: 'rl-sub', 'data-rl-tour': 'foot',
            style: { padding: '6px 16px', borderTop: '1px solid var(--rl-bd)' },
          },
            '读于 ' + fmtTime(snap && snap.readAt) + '　·　写入都走库脚本：导入会落文件并登记；归档移到 .research/archive/（可恢复）；真删要输文件名、不进系统回收站。',
            h('span', { style: { marginLeft: '8px' } }, h(CopyBtn, { text: '请用 research.py 完成更复杂的库写入（new-project / add-ref / register-figure / add-submission / reindex）。' })),
          ),
          importOpen
            ? h(ImportModal, {
              key: 'import-' + importSeq, ctx: ctx, snap: snap || {},
              initialTarget: (importOpen && importOpen.target) || undefined,
              initialFiles: (importOpen && importOpen.files) || undefined,
              onClose: function () { setImportOpen(false); },
              onImported: function () { refresh(); },
            })
            : null,
          consoleState_ && (cliCmds || consoleErr)
            ? h(ConsoleModal, {
              key: 'console', ctx: ctx, commands: cliCmds || [], loading: !cliCmds, error: consoleErr,
              onClose: function () { setConsoleState(false); },
              onRetry: function () { setCliCmds(null); setConsoleErr(null); openConsole(); },
            })
            : null,
          tfTarget
            ? h(DataTransformModal, {
              key: 'tf', ctx: ctx, call: call, path: tfTarget.path, project: tfTarget.project,
              onClose: function () { setTfTarget(null); },
              onReload: refresh,
            })
            : null,
          tourStep
            ? h(TourOverlay, {
              key: 'tour', step: tourStep, index: tourIndex, total: TOUR_STEPS.length, rect: rect,
              onNext: tourNext, onBack: tourBack, onSkip: function () { closeTour(true); },
            })
            : null,
        ]);
      };
    }

    /* ------------------------------------------------------------------ 图标 */

    function PanelIcon(props) {
      var size = (props && props.size) || 20;
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
      }, [
        h('path', { key: 'a', d: 'M9.5 3h5' }),
        h('path', { key: 'b', d: 'M10.5 3v5.4a6 6 0 1 0 3 0V3' }),
        h('path', { key: 'c', d: 'M8 15h8' }),
      ]);
    }

    /* --------------------------------------------------------------- 注册 */

    function keep(ctx, disposer, label) {
      if (typeof disposer !== 'function') return;
      try {
        if (ctx && typeof ctx.effect === 'function') ctx.effect(function () { return disposer; }, label);
      } catch (e) { /* 注册已由 slots.inject 自己绑在 fiber 上，这里失败不影响功能 */ }
    }

    function apply(ctx) {
      ensureStyle();
      var slots = getSlots(ctx);
      if (!slots || typeof slots.register !== 'function' || typeof slots.inject !== 'function') {
        console.error('[research-library] 客户端 slots 服务不可用，面板未注册');
        return;
      }
      keep(ctx, slots.inject('sidebar.panellist', function () {
        return slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: function () { return PANEL_TITLE; } }, PanelIcon);
      }), 'research-library sidebar row');
      keep(ctx, slots.inject('main', function () {
        return slots.register({ name: 'main', key: PANEL_ID }, makePanel(ctx));
      }), 'research-library main panel');
    }

    exports.name = 'research-library-client';
    exports.inject = ['slots'];
    exports.apply = apply;
    // 给 scripts/selftest-client.mjs 的只读钩子：导览的步骤表与两个纯函数
    // （浏览器不读它；客户端模块系统不关心多出来的导出）。
    exports.__test = {
      LS_PREFIX: LS_PREFIX,
      TOUR_STEPS: TOUR_STEPS,
      placePopover: placePopover,
      spotRect: spotRect,
      lsGet: lsGet,
      lsSet: lsSet,
      filterSnap: filterSnap,
      UI_VERSION_KEY: UI_VERSION_KEY,
      tabsFor: tabsFor,
      paletteSearch: paletteSearch,
      WORKBENCH_VIEWS: WORKBENCH_VIEWS,
      STAGE_ORDER: STAGE_ORDER,
      Workbench: Workbench,
      guessTarget: guessTarget,
      figureEntry: figureEntry,
      withHostHint: withHostHint,
    };
    return module.exports;
  },
});

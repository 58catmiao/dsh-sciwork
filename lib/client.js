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
      '.rl-root{--rl-bg:#151517;--rl-bg:light-dark(#f9fafb,#151517);--rl-surf:#1b1b1c;--rl-surf:light-dark(#ffffff,#1b1b1c);--rl-surf2:#232324;--rl-surf2:light-dark(#f1f3f5,#232324);--rl-bd:#2a2a2d;--rl-bd:light-dark(#e3e6eb,#2a2a2d);--rl-bd2:#3a3a3f;--rl-bd2:light-dark(#cdd2da,#3a3a3f);--rl-tx:#f9fafb;--rl-tx:light-dark(#0f1115,#f9fafb);--rl-mu:#adb2b8;--rl-mu:light-dark(#61666b,#adb2b8);--rl-ac:#5b8cf0;--rl-ac:light-dark(#3a68d4,#5b8cf0);--rl-ink:#0f1115;--rl-ink:light-dark(#ffffff,#0f1115);--rl-ok:#6fce93;--rl-ok:light-dark(#2f7d4f,#6fce93);--rl-warn:#e0b263;--rl-warn:light-dark(#9a6a12,#e0b263);--rl-err:#ef8a84;--rl-err:light-dark(#b3362f,#ef8a84);--rl-f1:12px;--rl-f2:14px;--rl-f3:16px;--rl-s1:4px;--rl-s2:8px;--rl-s3:12px;--rl-s4:16px;--rl-s5:20px;--rl-s6:24px;--rl-s8:32px;--rl-r1:6px;--rl-r2:8px;--rl-r3:12px;--rl-sh1:0 1px 2px rgba(0,0,0,.06);--rl-sh2:0 8px 24px rgba(0,0,0,.12);--rl-ease:cubic-bezier(.2,0,0,1);--rl-d1:120ms;--rl-d2:200ms;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--rl-bg);color:var(--rl-tx);font-family:"Noto Sans SC","Microsoft YaHei",system-ui,-apple-system,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums;font-size:var(--rl-f2);line-height:1.6;-webkit-font-smoothing:antialiased}',
      '.rl-root *{box-sizing:border-box}',
      '.rl-root *:focus-visible{outline:2px solid var(--rl-ac);outline-offset:2px;border-radius:4px}',
      '.rl-root ::-webkit-scrollbar{width:10px;height:10px}',
      '.rl-root ::-webkit-scrollbar-thumb{background:var(--rl-bd2);border-radius:6px;border:3px solid transparent;background-clip:content-box}',
      '.rl-root ::-webkit-scrollbar-thumb:hover{background:var(--rl-mu);background-clip:content-box;border:3px solid transparent}',
      '.rl-root ::-webkit-scrollbar-track{background:transparent}',
      '.rl-head{padding:var(--rl-s5) var(--rl-s6) var(--rl-s4);border-bottom:1px solid var(--rl-bd);flex:0 0 auto;background:var(--rl-bg)}',
      '.rl-title{display:flex;align-items:center;gap:var(--rl-s2);font-size:var(--rl-f3);font-weight:500;letter-spacing:-.01em;min-height:28px}',
      '.rl-path{font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:var(--rl-f1);color:var(--rl-mu);margin-top:2px;word-break:break-all}',
      '.rl-counts{display:flex;flex-wrap:wrap;gap:var(--rl-s3);margin-top:var(--rl-s2);color:var(--rl-mu);font-size:var(--rl-f1)}',
      '.rl-counts span{display:inline-flex;align-items:baseline;gap:4px}',
      '.rl-counts b{font-weight:600;color:var(--rl-tx);font-variant-numeric:tabular-nums}',
      '.rl-warns{margin:var(--rl-s2) 0 0;padding:0;list-style:none;font-size:var(--rl-f1);color:var(--rl-warn)}',
      '.rl-tabs{display:flex;align-items:center;gap:var(--rl-s3);padding:var(--rl-s2) var(--rl-s6);border-bottom:1px solid var(--rl-bd);flex:0 0 auto;background:var(--rl-bg)}',
      /* 主标不再横向滚动：放不下时由「更多」收走次要页签，滚动条只会让人以为还有东西藏在右边。 */
      '.rl-nav{display:flex;align-items:center;gap:var(--rl-s1);flex:1 1 auto;min-width:0;overflow:visible}',
      '.rl-tools{display:flex;align-items:center;gap:var(--rl-s2);flex:0 0 auto;margin-left:auto}',
      '.rl-more{position:relative}',
      '.rl-more__menu{display:none;position:absolute;top:calc(100% + 6px);right:0;z-index:30;min-width:150px;padding:6px;border:1px solid var(--rl-bd2);border-radius:var(--rl-r2);background:var(--rl-surf);box-shadow:var(--rl-sh2)}',
      '.rl-more:hover .rl-more__menu,.rl-more:focus-within .rl-more__menu{display:block}',
      '.rl-more__menu .rl-tab{display:block;width:100%;text-align:left;padding:6px 10px}',
      '.rl-more__menu .rl-tab:after{display:none}',
      /* 图内选区问模型 */
      '.rl-figchat{width:min(520px,46vw)}',
      // 圈选问模型的悬浮窗：盖在面板上，选图 → 圈一块 → 就着这一块聊。
      '.rl-figover{position:fixed;inset:0;z-index:60;display:flex;align-items:flex-start;justify-content:center;padding:var(--rl-s5);overflow:auto;background:rgba(0,0,0,.42)}',
      '.rl-figover__box{width:min(1080px,100%);padding:var(--rl-s4);border:1px solid var(--rl-bd2);border-radius:var(--rl-r3);background:var(--rl-surf);box-shadow:var(--rl-sh2);animation:rl-pop 180ms var(--rl-ease)}',
      '.rl-figover__head{display:flex;align-items:center;gap:var(--rl-s2);flex-wrap:wrap;margin-bottom:var(--rl-s3)}',
      '.rl-figover__title{font-size:var(--rl-f3);font-weight:600;margin-right:var(--rl-s2)}',
      '.rl-figover__head .rl-actions{margin-left:auto}',
      '.rl-figover .rl-figchat{width:100%}',
      '@media (max-width:860px){.rl-figover{padding:var(--rl-s2)}.rl-figover__box{padding:var(--rl-s3)}}',
      '.rl-selwrap{position:relative;display:inline-block;line-height:0;user-select:none}',
      '.rl-selwrap img{-webkit-user-drag:none}',
      '.rl-selwrap[data-sel="1"]{cursor:crosshair}',
      '.rl-selbox{position:absolute;border:1px dashed var(--rl-ac);background:color-mix(in srgb, var(--rl-ac) 14%, transparent);pointer-events:none}',
      '.rl-selhold{position:absolute;left:6px;top:6px;padding:2px 8px;border-radius:var(--rl-r1);background:var(--rl-bg);color:var(--rl-mu);font-size:var(--rl-f1);line-height:1.6}',
      '.rl-chat{margin-top:var(--rl-s3);display:flex;flex-direction:column;gap:var(--rl-s2);max-height:320px;overflow:auto}',
      '.rl-chat__turn{padding:8px 10px;border:1px solid var(--rl-bd);border-radius:var(--rl-r2);background:var(--rl-surf)}',
      '.rl-chat__q{color:var(--rl-tx);font-size:var(--rl-f2);margin-bottom:4px}',
      '.rl-chat__a{color:var(--rl-mu);font-size:var(--rl-f2);white-space:pre-wrap;line-height:1.7}',
      '.rl-tab{position:relative;padding:6px 12px;border:0;border-radius:var(--rl-r1);background:transparent;color:var(--rl-mu);font:inherit;font-size:var(--rl-f2);cursor:pointer;white-space:nowrap;transition:background var(--rl-d1) var(--rl-ease),color var(--rl-d1) var(--rl-ease)}',
      '.rl-tab:hover{background:var(--rl-surf);color:var(--rl-tx)}',
      '.rl-tab:active{transform:translateY(1px)}',
      '.rl-tab[data-active="1"]{background:var(--rl-surf2);color:var(--rl-tx);font-weight:500}',
      '.rl-tab[data-active="1"]:after{content:"";position:absolute;left:12px;right:12px;bottom:-9px;height:2px;border-radius:2px;background:var(--rl-ac)}',
      '.rl-vertabs{display:flex;gap:2px;padding:2px;border-radius:var(--rl-r1);background:var(--rl-surf);flex:0 0 auto}',
      '.rl-vertabs .rl-tab{font-size:var(--rl-f1);padding:3px 10px}',
      '.rl-vertabs .rl-tab[data-active="1"]:after{display:none}',
      '.rl-body{flex:1 1 auto;min-height:0;overflow:auto;padding:var(--rl-s5) var(--rl-s6) var(--rl-s8);scrollbar-width:thin}',
      '.rl-sub{color:var(--rl-mu);font-size:var(--rl-f1);line-height:1.6}',
      '.rl-card{position:relative;border:1px solid var(--rl-bd);border-radius:var(--rl-r2);background:var(--rl-surf);padding:var(--rl-s4);margin-bottom:var(--rl-s3);transition:border-color var(--rl-d2) var(--rl-ease)}',
      '.rl-card:hover{border-color:var(--rl-bd2)}',
      '.rl-card[data-open="1"]{background:var(--rl-surf);border-color:var(--rl-bd2)}',
      '.rl-row{display:flex;align-items:center;justify-content:space-between;gap:var(--rl-s3);flex-wrap:wrap}',
      '.rl-mono{font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:var(--rl-f1);word-break:break-all;font-variant-numeric:tabular-nums}',
      '.rl-warn{color:var(--rl-warn);font-weight:600}',
      '.rl-err{color:var(--rl-err)}',
      '.rl-ok{color:var(--rl-ok)}',
      '.rl-idle{color:var(--rl-mu)}',
      '.rl-brand{color:var(--rl-ac)}',
      '.rl-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:0 14px;border:1px solid var(--rl-bd2);border-radius:var(--rl-r1);background:var(--rl-surf);color:var(--rl-tx);font:inherit;font-size:var(--rl-f2);cursor:pointer;white-space:nowrap;transition:background var(--rl-d1) var(--rl-ease),border-color var(--rl-d1) var(--rl-ease),transform var(--rl-d1) var(--rl-ease),box-shadow var(--rl-d1) var(--rl-ease)}',
      '.rl-btn:hover{background:var(--rl-surf2);border-color:var(--rl-bd2)}',
      '.rl-btn:active{background:var(--rl-surf2)}',
      '.rl-btn[disabled]{opacity:.45;cursor:not-allowed;}',
      '.rl-btn-primary{background:var(--rl-ac);border-color:var(--rl-ac);color:var(--rl-ink)}',
      '.rl-btn-primary:hover{background:var(--rl-ac);filter:brightness(1.06)}',
      '.rl-btn--danger{background:transparent;border-color:var(--rl-err);color:var(--rl-err)}',
      '.rl-btn--danger:hover{background:var(--rl-err);color:var(--rl-ink)}',
      '.rl-badge{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;border:1px solid var(--rl-bd);background:var(--rl-surf2);color:var(--rl-mu);font-size:var(--rl-f1);font-weight:500;white-space:nowrap}',
      '.rl-thumb{cursor:zoom-in;display:block;border-radius:var(--rl-r1);border:1px solid var(--rl-bd);max-width:100%}',
      '.rl-thumb:hover{border-color:var(--rl-bd2)}',
      '.rl-thumb-big{width:100%}',
      '.rl-pre{max-height:340px;overflow:auto;margin:0;padding:var(--rl-s3);border:1px solid var(--rl-bd);border-radius:var(--rl-r1);background:var(--rl-surf2);color:var(--rl-tx);font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:var(--rl-f1);line-height:1.65;white-space:pre-wrap;word-break:break-word;scrollbar-width:thin}',
      '.rl-input,.rl-select{height:32px;padding:0 10px;border:1px solid var(--rl-bd2);border-radius:var(--rl-r1);background:var(--rl-surf);color:var(--rl-tx);font:inherit;font-size:var(--rl-f2);transition:border-color var(--rl-d1) var(--rl-ease),box-shadow var(--rl-d1) var(--rl-ease)}',
      '.rl-input::placeholder{color:var(--rl-mu)}',
      '.rl-input:focus,.rl-select:focus{outline:none;border-color:var(--rl-ac);box-shadow:0 0 0 3px var(--rl-surf2)}',
      '.rl-field{display:flex;flex-direction:column;gap:6px;min-width:0;font-size:var(--rl-f1);color:var(--rl-mu)}',
      '.rl-field--wide{grid-column:1/-1}',
      '.rl-field input,.rl-field select,.rl-field textarea{width:100%;min-height:32px;padding:6px 10px;border:1px solid var(--rl-bd2);border-radius:var(--rl-r1);background:var(--rl-surf);color:var(--rl-tx);font:inherit;font-size:var(--rl-f2);transition:border-color var(--rl-d1) var(--rl-ease)}',
      '.rl-field input:focus,.rl-field select:focus,.rl-field textarea:focus{outline:none;border-color:var(--rl-ac)}',
      '.rl-field textarea{resize:vertical;line-height:1.6}',
      '.rl-chips{display:flex;flex-wrap:wrap;gap:var(--rl-s1)}',
      '.rl-chip{padding:3px 10px;border:1px solid var(--rl-bd);border-radius:999px;background:var(--rl-surf);color:var(--rl-mu);font:inherit;font-size:var(--rl-f1);cursor:pointer;transition:background var(--rl-d1) var(--rl-ease),color var(--rl-d1) var(--rl-ease),border-color var(--rl-d1) var(--rl-ease)}',
      '.rl-chip:hover{background:var(--rl-surf2);color:var(--rl-tx)}',
      '.rl-chip[data-on="1"]{background:var(--rl-ac);border-color:var(--rl-ac);color:var(--rl-ink)}',
      // 计数为 0 的产物按钮：留着占位（一眼看出「这个课题还没有图」），但不给点。
      '.rl-chip[disabled]{opacity:.55;cursor:default}',
      '.rl-chip[disabled]:hover{background:var(--rl-surf);color:var(--rl-mu)}',
      '.rl-tool{height:30px;padding:0 10px;border:1px solid var(--rl-bd);border-radius:var(--rl-r1);background:var(--rl-surf);color:var(--rl-tx);font:inherit;font-size:var(--rl-f1)}',
      '.rl-search{width:220px}',
      '.rl-name{height:30px;padding:0 10px;border:1px solid var(--rl-err);border-radius:var(--rl-r1);background:var(--rl-surf);color:var(--rl-tx);font:inherit;font-size:var(--rl-f1)}',
      '.rl-edit{width:100%;min-height:240px;padding:var(--rl-s3);border:1px solid var(--rl-bd2);border-radius:var(--rl-r1);background:var(--rl-surf);color:var(--rl-tx);font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:var(--rl-f2);line-height:1.65;resize:vertical}',
      '.rl-chk{display:inline-flex;align-items:center;gap:6px;font-size:var(--rl-f1);color:var(--rl-mu);cursor:pointer}',
      '.rl-table{width:100%;border-collapse:collapse;font-size:var(--rl-f2)}',
      '.rl-table th{text-align:left;font-weight:600;color:var(--rl-mu);padding:6px 8px;border-bottom:1px solid var(--rl-bd);white-space:nowrap}',
      '.rl-table td{padding:7px 8px;border-bottom:1px solid var(--rl-bd);vertical-align:top}',
      '.rl-table tbody tr:hover td{background:var(--rl-surf)}',
      '.rl-actions{display:flex;align-items:center;gap:var(--rl-s2);flex-wrap:wrap}',
      '.rl-empty{padding:var(--rl-s8) var(--rl-s4);text-align:center;color:var(--rl-mu);font-size:var(--rl-f2);line-height:1.8}',
      '.rl-dim{opacity:.72}',
      '.rl-box{padding:var(--rl-s3);border:1px solid var(--rl-bd);border-radius:var(--rl-r1);background:var(--rl-surf);font-size:var(--rl-f2)}',
      '.rl-group{border:0;border-radius:0;background:transparent;padding:0;margin-bottom:var(--rl-s4)}',
      '.rl-group__head{display:flex;align-items:center;gap:var(--rl-s2);font-size:var(--rl-f2);color:var(--rl-mu);margin-bottom:var(--rl-s2)}',
      '.rl-group__toggle{border:0;border-radius:var(--rl-r1);background:transparent;color:var(--rl-tx);font:inherit;font-size:var(--rl-f2);font-weight:500;cursor:pointer;padding:2px 6px;transition:background var(--rl-d1) var(--rl-ease)}',
      '.rl-group__toggle:hover{background:var(--rl-surf2)}',
      '.rl-group__empty{padding:var(--rl-s4);text-align:center;color:var(--rl-mu);font-size:var(--rl-f1)}',
      '.rl-welcome{display:flex;flex-direction:column;gap:var(--rl-s4);padding:var(--rl-s6);border:1px solid var(--rl-bd);border-radius:var(--rl-r3);background:var(--rl-surf)}',
      '.rl-welcome__title{margin:0;font-size:var(--rl-f3);font-weight:600;color:var(--rl-tx)}',
      '.rl-welcome__lead{font-size:var(--rl-f2);line-height:1.7;color:var(--rl-tx);max-width:84ch}',
      '.rl-welcome__list{display:flex;flex-direction:column;gap:var(--rl-s2);margin:0;font-size:var(--rl-f2);line-height:1.7;max-width:84ch}',
      '.rl-welcome__k{color:var(--rl-mu)}',
      '.rl-welcome__foot{font-size:var(--rl-f1);color:var(--rl-mu)}',
      '.rl-tour-layer{position:fixed;inset:0;z-index:2147483000;pointer-events:none;--rl-tour-shade:rgba(10,12,16,.58)}',
      '.rl-tour-spot{position:fixed;border-radius:var(--rl-r2);box-shadow:0 0 0 200vmax var(--rl-tour-shade);pointer-events:none}',
      '.rl-tour-pop{position:fixed;z-index:1;width:min(420px,92vw);padding:var(--rl-s5);border:1px solid var(--rl-bd2);border-radius:var(--rl-r3);background:var(--rl-surf);box-shadow:var(--rl-sh2);pointer-events:auto}',
      '.rl-tour-pop--docked{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%)}',
      '.rl-tour-pop__head{display:flex;align-items:center;gap:var(--rl-s2);font-size:var(--rl-f1);color:var(--rl-mu)}',
      '.rl-tour-pop__count{font-variant-numeric:tabular-nums}',
      '.rl-tour-pop__meter{display:flex;gap:4px;flex:1}',
      '.rl-tour-pop__meter i{width:14px;height:3px;border-radius:2px;background:var(--rl-bd2)}',
      '.rl-tour-pop__title{margin:var(--rl-s2) 0 6px;font-size:var(--rl-f2);font-weight:500}',
      '.rl-tour-pop__body{font-size:var(--rl-f2);line-height:1.7;color:var(--rl-mu)}',
      '.rl-tour-pop__note{margin-top:var(--rl-s2);font-size:var(--rl-f1);color:var(--rl-ac)}',
      '.rl-tour-pop__foot{display:flex;align-items:center;gap:var(--rl-s2);margin-top:var(--rl-s5)}',
      '.rl-tour-pop__spacer{flex:1}',
      '.rl-modal{position:fixed;inset:0;z-index:2147482000;display:flex;align-items:center;justify-content:center;padding:var(--rl-s6);background:rgba(10,12,16,.45);pointer-events:auto}',
      '.rl-modal__box{width:min(760px,96vw);max-height:92vh;overflow:auto;display:flex;flex-direction:column;border:1px solid var(--rl-bd2);border-radius:var(--rl-r3);background:var(--rl-surf);box-shadow:var(--rl-sh2);scrollbar-width:thin}',
      '.rl-modal__head{display:flex;align-items:center;gap:var(--rl-s3);padding:var(--rl-s4) var(--rl-s5);border-bottom:1px solid var(--rl-bd);position:sticky;top:0;background:var(--rl-surf);z-index:1}',
      '.rl-modal__title{margin:0;font-size:var(--rl-f3);font-weight:500;letter-spacing:-.01em}',
      '.rl-modal__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--rl-s3) var(--rl-s4);padding:var(--rl-s5)}',
      '.rl-targets{display:flex;flex-wrap:wrap;gap:var(--rl-s1);padding:0 var(--rl-s5) var(--rl-s4)}',
      '.rl-target{padding:4px 12px;border:1px solid var(--rl-bd);border-radius:999px;background:var(--rl-surf);color:var(--rl-mu);font:inherit;font-size:var(--rl-f1);cursor:pointer;transition:background var(--rl-d1) var(--rl-ease),color var(--rl-d1) var(--rl-ease)}',
      '.rl-target:hover{background:var(--rl-surf2);color:var(--rl-tx)}',
      '.rl-target[data-active="1"]{background:var(--rl-ac);border-color:var(--rl-ac);color:var(--rl-ink)}',
      '.rl-zoom{position:fixed;inset:0;z-index:2147482500;display:flex;align-items:center;justify-content:center;background:rgba(8,10,14,.84);pointer-events:auto}',
      '.rl-zoom__box{max-width:94vw;max-height:94vh;display:flex;flex-direction:column;gap:var(--rl-s2);padding:var(--rl-s4);border:1px solid var(--rl-bd2);border-radius:var(--rl-r3);background:var(--rl-surf);box-shadow:var(--rl-sh2)}',
      '.rl-zoom__img{max-width:92vw;max-height:84vh;border-radius:var(--rl-r1);background:var(--rl-bg)}',
      '.rl-zoom__frame{width:84vw;height:80vh;border:0;border-radius:var(--rl-r1);background:var(--rl-bg)}',
      '.rl-drop{outline:2px dashed var(--rl-ac);outline-offset:-8px}',
      '.rl-console{display:grid;grid-template-columns:minmax(200px,240px) minmax(0,1fr);gap:0;min-height:320px}',
      '.rl-console__list{border-right:1px solid var(--rl-bd);padding:var(--rl-s3);max-height:56vh;overflow:auto;scrollbar-width:thin}',
      '.rl-console__group{margin:0 0 var(--rl-s2);font-size:var(--rl-f1);color:var(--rl-mu);padding:0 6px}',
      '.rl-console__item{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;text-align:left;padding:6px 10px;border:0;border-radius:var(--rl-r1);background:transparent;color:var(--rl-tx);font:inherit;font-size:var(--rl-f2);cursor:pointer;transition:background var(--rl-d1) var(--rl-ease)}',
      '.rl-console__item .rl-console__cmd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--rl-f1);color:var(--rl-mu);opacity:.8}',
      '.rl-console__item .rl-console__desc{font-size:var(--rl-f1);line-height:1.35;color:var(--rl-mu);opacity:.75;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.rl-console__item:hover{background:var(--rl-surf2)}',
      '.rl-console__item[data-active="1"]{background:var(--rl-surf2);font-weight:500;box-shadow:inset 2px 0 0 var(--rl-ac)}',
      '.rl-console__hint{font-size:var(--rl-f1);color:var(--rl-mu);padding:0 10px 4px}',
      '.rl-console__form{padding:var(--rl-s4);display:flex;flex-direction:column;gap:var(--rl-s3);min-width:0}',
      '.rl-console__foot{display:flex;align-items:center;gap:var(--rl-s2);padding:var(--rl-s3) var(--rl-s5);border-top:1px solid var(--rl-bd)}',
      '.rl-console__raw{margin-top:var(--rl-s3);display:flex;flex-direction:column;gap:6px}',
      '.rl-wb{display:flex;flex-direction:column;gap:var(--rl-s4)}',
      '.rl-wb__head{display:flex;flex-wrap:wrap;align-items:flex-start;gap:var(--rl-s2);justify-content:space-between}',
      '.rl-wb__title{font-size:var(--rl-f2);font-weight:500}',
      '.rl-wb__actions{display:flex;gap:var(--rl-s2);flex-wrap:wrap;margin-top:var(--rl-s2)}',
      '.rl-wb__grid{display:grid;grid-template-columns:minmax(200px,280px) minmax(0,1fr);gap:var(--rl-s4);align-items:start}',
      '.rl-wb__list{display:flex;flex-direction:column;gap:4px}',
      '.rl-wb__row{text-align:left;border:1px solid var(--rl-bd);background:var(--rl-surf);border-radius:var(--rl-r1);padding:8px 10px;cursor:pointer;color:inherit;font:inherit}',
      '.rl-wb__row[data-active="1"]{border-color:var(--rl-ac);background:var(--rl-surf2)}',
      '.rl-wb__rowTitle{font-weight:500;font-size:var(--rl-f2)}',
      '.rl-wb__detail{border:1px solid var(--rl-bd);border-radius:var(--rl-r2);padding:var(--rl-s4);display:flex;flex-direction:column;gap:var(--rl-s3);min-height:160px;transition:border-color var(--rl-d2) var(--rl-ease),box-shadow var(--rl-d2) var(--rl-ease)}',
      '.rl-wb__detail[data-flash="1"]{border-color:var(--rl-ac);box-shadow:0 0 0 3px color-mix(in srgb, var(--rl-ac) 16%, transparent)}',
      '.rl-wb__rec{border-top:1px solid var(--rl-bd);padding-top:var(--rl-s3)}',
      '.rl-page{display:flex;flex-direction:column;gap:var(--rl-s4)}',
      '.rl-page__head{display:flex;align-items:flex-end;justify-content:space-between;gap:var(--rl-s4);flex-wrap:wrap;padding-bottom:var(--rl-s3);border-bottom:1px solid var(--rl-bd)}',
      '.rl-page__title{font-size:var(--rl-f3);font-weight:600;letter-spacing:-.01em}',
      '.rl-page__sub{font-size:var(--rl-f1);color:var(--rl-mu);margin-top:2px}',
      '.rl-page__acts{display:flex;gap:var(--rl-s2);flex-wrap:wrap}',
      '.rl-section{display:flex;flex-direction:column;gap:var(--rl-s2)}',
      '.rl-section__head{display:flex;align-items:center;justify-content:space-between;gap:var(--rl-s2)}',
      '.rl-section__title{font-size:var(--rl-f2);font-weight:600}',
      '.rl-table{border:1px solid var(--rl-bd);border-radius:var(--rl-r2);overflow:hidden;background:var(--rl-surf)}',
      '.rl-table__row{display:grid;grid-template-columns:minmax(110px,1.1fr) 64px minmax(0,2.4fr) auto;gap:var(--rl-s3);align-items:center;padding:7px 10px;border-top:1px solid var(--rl-bd);font-size:var(--rl-f1)}',
      '.rl-table__row:first-child{border-top:0}',
      '.rl-table__row--head{background:var(--rl-surf2);font-size:var(--rl-f1);color:var(--rl-mu);padding:6px 10px}',
      '.rl-table__proj{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.rl-table__act{display:flex;gap:6px;justify-content:flex-end}',
      '.rl-table__empty{padding:10px;font-size:var(--rl-f1);color:var(--rl-mu)}',
      '.rl-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--rl-s3) var(--rl-s4)}',
      '.rl-form__field{display:flex;flex-direction:column;gap:4px;min-width:0}',
      '.rl-form__label{font-size:var(--rl-f1);color:var(--rl-mu)}',
      '.rl-form__ok{position:sticky;bottom:0;background:var(--rl-surf);padding:var(--rl-s3) var(--rl-s5);border-top:1px solid var(--rl-bd);display:flex;gap:var(--rl-s2);justify-content:flex-end}',
      '.rl-todos__proj{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:12em}',
      '.rl-tag{font-size:var(--rl-f1);padding:1px 6px;border-radius:999px;border:1px solid var(--rl-bd);color:var(--rl-mu);white-space:nowrap}',
      '.rl-tag[data-tone="warn"]{color:var(--rl-warn);border-color:var(--rl-warn);background:color-mix(in srgb, var(--rl-warn) 14%, transparent)}',
      '.rl-tag[data-tone="err"]{color:var(--rl-err);border-color:var(--rl-err);background:color-mix(in srgb, var(--rl-err) 14%, transparent)}',
      '.rl-tag[data-tone="ok"]{color:var(--rl-ok);border-color:var(--rl-ok);background:color-mix(in srgb, var(--rl-ok) 14%, transparent)}',
      '.rl-tag[data-tone="ac"]{color:var(--rl-ac);border-color:var(--rl-ac);background:color-mix(in srgb, var(--rl-ac) 12%, transparent)}',
      '.rl-code{font-family:ui-monospace, Consolas, "Cascadia Mono", monospace;font-size:.92em;color:var(--rl-ac);background:color-mix(in srgb, var(--rl-ac) 10%, transparent);border-radius:4px;padding:0 4px}',
      '.rl-stages{display:flex;flex-wrap:wrap;gap:6px}',
      '.rl-stage{font-size:var(--rl-f1);padding:3px 8px;border-radius:999px;border:1px solid var(--rl-bd);color:var(--rl-mu)}',
      '.rl-stage[data-state="done"]{background:var(--rl-surf2);color:var(--rl-tx)}',
      '.rl-stage[data-state="active"]{border-color:var(--rl-ac);color:var(--rl-tx);font-weight:500}',
      '.rl-stage--pick{font-family:inherit;background:none;cursor:pointer;transition:border-color .12s,color .12s}',
      '.rl-stage--pick:hover{border-color:var(--rl-ac);color:var(--rl-tx)}',
      '.rl-stage--pick:disabled{cursor:default;opacity:1}',
      '.rl-warnbox{border:1px solid var(--rl-warn);border-radius:var(--rl-r1);padding:var(--rl-s3);display:flex;flex-direction:column;gap:var(--rl-s2);font-size:var(--rl-f1)}',
      '.rl-wbmask{position:fixed;inset:0;background:rgba(10,12,16,.45);display:flex;align-items:center;justify-content:center;z-index:2147482000;padding:var(--rl-s6)}',
      '.rl-wbcard{background:var(--rl-bg);border:1px solid var(--rl-bd2);border-radius:var(--rl-r3);box-shadow:var(--rl-sh2);padding:var(--rl-s5);max-width:560px;width:100%;display:flex;flex-direction:column;gap:var(--rl-s3);max-height:80vh;overflow:auto}',
      '.rl-wbcard__title{font-size:var(--rl-f2);font-weight:500}',
      '.rl-wbcard__foot{display:flex;justify-content:flex-end;gap:var(--rl-s2);margin-top:var(--rl-s2)}',
      '.rl-list{margin:4px 0 0;padding-left:18px;font-size:var(--rl-f1);display:flex;flex-direction:column;gap:2px}',
      // 次要按钮：一屏里出现四五个动作时，让入口不抢主线
      '.rl-btn--quiet{border-color:transparent;background:transparent;color:var(--rl-mu);min-height:28px;padding:0 8px}',
      '.rl-btn--quiet:hover{background:var(--rl-surf2);border-color:transparent;color:var(--rl-tx)}',
      '.rl-btn--quiet.rl-btn--danger{border-color:transparent;background:transparent;color:var(--rl-mu)}',
      '.rl-btn--quiet.rl-btn--danger:hover{background:color-mix(in srgb, var(--rl-err) 16%, transparent);color:var(--rl-err)}',
      '.rl-wb__audit{margin-top:var(--rl-s4)}',
      '.rl-wb__recLine{display:flex;align-items:center;justify-content:space-between;gap:var(--rl-s2);flex-wrap:wrap}',
      // 窄屏（侧栏收窄 / 手机）：表格塌成卡片，正文不再挤成一列单字
      '@media (max-width:860px){',
      '.rl-page__head{align-items:flex-start;gap:var(--rl-s3)}',
      '.rl-page__acts{gap:var(--rl-s1)}',
      '.rl-wb__grid{grid-template-columns:minmax(0,1fr)}',
      '.rl-table__row{grid-template-columns:minmax(0,1fr) auto;gap:var(--rl-s1) var(--rl-s2);padding:var(--rl-s3);font-size:var(--rl-f2)}',
      '.rl-table__row--head{display:none}',
      '.rl-table__row>:nth-child(2){grid-column:2;grid-row:1;justify-self:end}',
      '.rl-table__row>:nth-child(3){grid-column:1/-1;grid-row:2}',
      '.rl-table__row>:nth-child(4){grid-column:1/-1;grid-row:3;justify-content:flex-start}',
      '.rl-table__proj{white-space:normal;overflow:visible}',
      '.rl-tabs{padding:var(--rl-s2) var(--rl-s3)}',
      '.rl-body{padding:var(--rl-s4) var(--rl-s3) var(--rl-s6)}',
      '.rl-head{padding:var(--rl-s4) var(--rl-s3) var(--rl-s3)}',
      '}',
      '@media (prefers-reduced-motion:reduce){.rl-root *{transition:none!important;animation:none!important}}',
      // 切页签：交替两个同名动画，靠 animation-name 变化重放淡入（不 remount，免得丢工作台里选中的课题）。
      '@keyframes rl-view-a{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}',
      '@keyframes rl-view-b{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}',
      '.rl-view[data-anim="a"]{animation:rl-view-a 170ms var(--rl-ease)}',
      '.rl-view[data-anim="b"]{animation:rl-view-b 170ms var(--rl-ease)}',
      // 弹层：背景淡入、盒子从 98.5% 放大到 100%，只用来给「它出现了」一个交代。
      '@keyframes rl-backdrop{from{opacity:0}to{opacity:1}}',
      '@keyframes rl-pop{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}',
      '.rl-modal{animation:rl-backdrop 140ms var(--rl-ease)}',
      '.rl-modal__box{animation:rl-pop 180ms var(--rl-ease)}',
      // 详情里的行（待办 / 近期变动）逐条淡入，间隔 20ms，只给一点先后感。
      '.rl-wb__detail .rl-list li{animation:rl-view-a 200ms var(--rl-ease) both}',
      '.rl-wb__detail .rl-list li:nth-child(2){animation-delay:20ms}',
      '.rl-wb__detail .rl-list li:nth-child(3){animation-delay:40ms}',
      '.rl-wb__detail .rl-list li:nth-child(4){animation-delay:60ms}',
      '.rl-wb__detail .rl-list li:nth-child(n+5){animation-delay:80ms}',
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

    /**
     * 写动作的第二步：把 action.plan 拿到的计划交给 action.confirm。
     * 三个参数一个都不能少——少了 actionId，动作层直接判 bad-request。
     * （2026-11-01 真实踩到：重命名、笔记保存、图卡「存进笔记」三条路都漏了 actionId，
     *  点下去必定失败，而端到端脚本的假夹具不校验参数，所以门禁是绿的。）
     * 回执形状是 `{ value, receipt }`，调用方要的是 `value`。
     */
    function confirmPlan(call, plan, params) {
      if (!plan || !plan.planId) return Promise.reject(new Error('没有待确认的计划（先发起一次 action.plan）'));
      return call('action.confirm', {
        actionId: plan.actionId,
        planId: plan.planId,
        token: plan.token,
        params: params || plan.params || {},
      }).then(function (out) { return (out && out.value) || {}; });
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
      { id: 'notes', label: '笔记' },
      { id: 'refs', label: '文献' },
      { id: 'assets', label: '数据' },
      { id: 'journals', label: '期刊档案' },
      { id: 'submissions', label: '投稿' },
      { id: 'archive', label: '归档' },
    ];

    /**
     * 「命中任一字段」判定器：空筛选词一律算命中（所以调用处不用再判空）。
     * 0.3.11 起 v2 工作台也用它——筛选框以前只对 v1 页签生效，在工作台里敲字毫无反应。
     */
    function makeHit(q) {
      var needle = String(q || '').trim().toLowerCase();
      return function () {
        if (!needle) return true;
        for (var i = 0; i < arguments.length; i += 1) {
          var v = arguments[i];
          if (v === null || v === undefined) continue;
          if (String(v).toLowerCase().indexOf(needle) >= 0) return true;
        }
        return false;
      };
    }

    /**
     * 库体检用：课题是不是「还是空的」。
     * 只有图 / 草稿 / 数据 / 表格 / Origin 工程**全都**没有，才算空课题——
     * 只放了一张表或一个 Origin 工程的课题，也是正经有产物的课题。
     * （2026-10-31 修：原先只看图/草稿/数据，把只有表格或工程的课题误报「还是空的」。）
     */
    function isEmptyProject(p) {
      return !(p.figures || []).length && !(p.drafts || []).length && !(p.datasets || []).length
        && !(p.tables || []).length && !(p.opju || []).length;
    }

    /** 搜索框要匹配的字段：一个条目命中任一字段就算命中。 */
    function filterSnap(snap, q) {
      var needle = String(q || '').trim().toLowerCase();
      if (!needle || !snap) return snap;
      var hit = makeHit(needle);
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
        // x.project 是「按课题筛」的唯一线索：投稿目录叫 SUB-xxxx，路径里不含课题 slug，
        // 少了这个字段就会「按课题筛 → 投稿全没」。
        submissions: (snap.submissions || []).filter(function (x) { return hit(x.name, x.path, x.submissionId, x.title, x.journal, x.journalName, x.status, x.project); }),
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
      var st = React.useState({ busy: '', msg: null, ask: false, name: '', rn: false, rnName: '', rnPlan: null, rnTo: '', rnErr: null });
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

      /*
       * 重命名：走库的 `library.rename`（同目录改名，图件会把同基名的图与侧车一起改）。
       * 面板先拿计划、把「会写哪些文件」摆出来，用户看过再确认 —— 改名是会动登记索引的写动作，
       * 不该像切页签一样一下就生效。
       */
      var rnDir = entry.path ? String(entry.path).split('/').slice(0, -1).join('/') : '';
      var startRename = function () {
        patch({ rn: true, rnName: want, rnPlan: null, rnTo: '', rnErr: null, msg: null, ask: false });
      };
      var planRename = function () {
        var nm = String(s.rnName || '').trim();
        if (!nm) { patch({ rnErr: '新名字不能为空。' }); return; }
        if (nm.indexOf('/') >= 0 || nm.indexOf('\\') >= 0) { patch({ rnErr: '只改文件名，不跨目录（名字里不能带斜杠）。' }); return; }
        if (nm === want) { patch({ rnErr: '和现在的名字一样。' }); return; }
        var to = rnDir ? (rnDir + '/' + nm) : nm;
        patch({ busy: 'rename', rnErr: null, rnPlan: null });
        hostCall(props.ctx, 'action.plan', { actionId: 'library.rename', params: { from: entry.path, to: to } }).then(
          function (p) { patch({ busy: '', rnPlan: p, rnTo: to }); },
          function (e) { patch({ busy: '', rnErr: String((e && e.message) || e || '失败') }); },
        );
      };
      var doRename = function () {
        if (!s.rnPlan) return;
        var to = s.rnTo;
        patch({ busy: 'rename', rnErr: null });
        confirmPlan(function (a, b) { return hostCall(props.ctx, a, b); }, s.rnPlan, { from: entry.path, to: to }).then(function () {
          patch({ busy: '', rn: false, rnName: '', rnPlan: null, rnTo: '', msg: { kind: 'ok', text: '已改名：' + baseName(to) } });
          if (props.onDone) props.onDone();
        }, function (e) { patch({ busy: '', rnErr: String((e && e.message) || e || '失败') }); });
      };

      return h('div', { className: 'rl-actions' }, [
        props.size ? h('span', { key: 'z', className: 'rl-sub' }, props.size) : null,
        Btn({ key: 'rn', className: 'rl-btn--quiet', disabled: !!s.busy, 'data-rl-tour': 'rename', onClick: startRename }, '重命名'),
        Btn({ key: 'a', className: 'rl-btn--quiet', disabled: !!s.busy, 'data-rl-tour': 'archive', onClick: doArchive }, s.busy === 'archive' ? '归档中…' : '归档'),
        s.rn
          ? h('span', { key: 'rnb', className: 'rl-row' }, [
            h('span', { key: 'l', className: 'rl-sub' }, '新文件名：'),
            h('input', {
              key: 'i', className: 'rl-name', value: s.rnName, placeholder: want,
              onChange: function (e) { patch({ rnName: e.target.value, rnPlan: null, rnErr: null }); },
            }),
            Btn({ key: 'g', disabled: !!s.busy, onClick: planRename }, s.busy === 'rename' ? '准备中…' : '下一步'),
            Btn({ key: 'x', className: 'rl-btn--quiet', disabled: !!s.busy, onClick: function () { patch({ rn: false, rnPlan: null, rnErr: null }); } }, '取消'),
            s.rnErr ? h('span', { key: 'e', className: 'rl-err' }, s.rnErr) : null,
          ])
          : null,
        s.ask
          ? h('span', { key: 'ask', className: 'rl-row' }, [
            h('span', { key: 'l', className: 'rl-sub' }, '输入文件名以确认：'),
            h('input', {
              key: 'i', className: 'rl-name', value: s.name, placeholder: want,
              onChange: function (e) { patch({ name: e.target.value }); },
            }),
            Btn({ key: 'go', className: 'rl-btn--danger', disabled: !!s.busy || s.name !== want, onClick: doRemove }, s.busy === 'remove' ? '删除中…' : '真删'),
            Btn({ key: 'no', className: 'rl-btn--quiet', onClick: function () { patch({ ask: false, name: '', msg: null }); } }, '取消'),
          ])
          : Btn({ key: 'd', className: 'rl-btn--quiet rl-btn--danger', disabled: !!s.busy, onClick: function () { patch({ ask: true, msg: null }); } }, '删除'),
        h(MsgLine, { key: 'm', msg: s.msg }),
        s.rnPlan ? h(PlanModal, {
          key: 'pm', plan: s.rnPlan, busy: s.busy === 'rename', error: s.rnErr,
          onCancel: function () { patch({ rnPlan: null, rnErr: null }); },
          onConfirm: doRename,
        }) : null,
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
            Btn({ key: 'no', className: 'rl-btn--quiet', disabled: s.busy, onClick: function () { patch({ ask: false, name: '', msg: null }); } }, '取消'),
          ])
          : Btn({ key: 'd', className: 'rl-btn--quiet rl-btn--danger', disabled: s.busy, onClick: function () { patch({ ask: true, msg: null }); } }, '删除'),
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
        body: '在侧栏打开「科研库」即进入本面板。默认是工作台：页头一行报库的规模，中间一张「跨课题待办」表，下面左边课题列表、右边课题详情。上面一排页签是库的七个切面。',
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
        title: '页头计数行：库的规模',
        body: '课题 / 图 / 文献 / 在投 / 就绪，一行报完。这些是全库统计，不受下面的筛选词影响。数量不变通常表示最近产物尚未登记入库。',
        note: '黄字是提示级告警（如 confidence=low、图文件缺失），不是错误；点开对应页签看细节。',
      },
      {
        id: 'todos', anchor: 'todos',
        title: '跨课题待办：所有课题的下一步在一张表里',
        body: '每行一条：课题 / 投稿、阶段 / 到期、要做什么、操作。投稿的截止日也排进这张表并按到期日靠前，过期标红、三天内标黄。',
        note: '「生成指令」把这一行拼成一句能直接交给智能体的指令；写动作仍要 plan → confirm。',
      },
      {
        id: 'detail', anchor: 'detail',
        title: '课题详情：阶段、产物、下一步',
        body: '点左边任一课题，右侧是它当前的阶段、产物数量（图 / 草稿 / 数据 / 表 / 工程 / 文献 / 在投，点数字跳到对应页签且只看这个课题）、待办与阻塞，以及这个课题最近的变动。',
        note: '阶段检查项都过了会出现「推进到…」，那是写操作，会先出计划等你确认。',
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
        body: '① 查看：工作台的待办表与页头计数行，再加七个页签；② 写入：导入 / 新建课题 / 归档 / 就地改草稿均在面板内完成，写后点「刷新」核对；③ 重看导览：点标题右侧「引导」。',
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
        { t: '总览', d: '七个页签：图表 / 草稿 / 文献 / 数据 / 期刊档案 / 投稿 / 归档。首页把各课题的「下一步」合成一张待办表，投稿的截止日也排在表里；右边一栏是课题详情。' },
        { t: '读取与写入', d: '读取：图 / 草稿 / PDF 直接查看。写入：导入、新建课题、归档、就地改草稿，均经库脚本执行，不改登记索引。' },
        { t: '写入边界', d: '同名文件不覆盖；归档至 .research/archive/ 可恢复；真删需输入文件名且不进回收站；文档写入前备份 .bak。' },
      ];
      return h('div', { className: 'rl-welcome', 'data-rl-tour': 'welcome' }, [
        h('h2', { key: 't', className: 'rl-welcome__title' }, '欢迎使用科研库面板'),
        h('p', { key: 'l', className: 'rl-welcome__lead' },
          '本面板汇总当前库根下的课题、图、草稿、文献、数据、期刊档案与投稿；数据只读，路径见标题行。'),
        h('div', { key: 'c', className: 'rl-welcome__list' }, cards.map(function (c, i) {
          return h('p', { key: 'p' + i, style: { margin: 0 } }, [
            h('span', { key: 'k', className: 'rl-welcome__k' }, c.t + '：'),
            c.d,
          ]);
        })),
        h('div', { key: 'a', className: 'rl-actions' }, [
          Btn({ key: 'tour', primary: true, onClick: props.onTour }, '看导览（' + TOUR_STEPS.length + ' 步）'),
          Btn({ key: 'later', onClick: props.onDismiss }, '我自己看'),
        ]),
        h('div', { key: 'f', className: 'rl-welcome__foot' },
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

      // 自检没跑过就什么都不显示：一排「自检未知」只是占地方（真跑过才值得占一个徽章）。
      var verifyBadge = fig.verifyPassed === true
        ? h('span', { className: 'rl-badge rl-ok', title: 'verify' }, '自检通过')
        : (fig.verifyPassed === false ? h('span', { className: 'rl-badge rl-err', title: 'verify' }, '自检未通过') : null);

      return Card({
        open: open,
        children: [
          h('div', { key: 'hd', className: 'rl-row' },
            h('div', null,
              h('span', { className: 'rl-mono rl-brand' }, fig.figureId),
              h('span', { className: 'rl-sub' }, ' · ' + (fig.graph || '未记录图页')),
              fig.sub ? h('span', { className: 'rl-sub' }, ' · ' + fig.sub) : null,
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
              Btn({ className: 'rl-btn--quiet', onClick: function () { setOpen(!open); } }, open ? '收起' : '展开'),
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
                  : (img ? h(FigureChat, {
                    key: 'fc', ctx: props.ctx, call: call, project: props.project, fig: fig, img: img, zoom: zoom,
                    onToggleZoom: function () { setZoom(!zoom); },
                  })
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
        /*
         * 回归（2026-10-24）：以前这里直接 `setBody(text === null ? '' : text)` 就进编辑态。
         * 原文只在 useEffect 里异步读、写进 text，而 textarea 绑的是 body —— 不点「预览」
         * 直接点「编辑」，编辑框是空的，点一下保存就把整份草稿写成空文件（原文只剩 .bak）。
         * 现在先确保正文到手再进编辑；读不到就留在预览态并报错，宁可不让改也不给空稿。
         */
        if (text !== null) { setBody(text); setEditing(true); return; }
        setBusy(true);
        call('readText', { path: d.path }).then(function (r) {
          setBusy(false);
          setText(r.text);
          setBody(r.text == null ? '' : r.text);
          setEditing(true);
        }, function (e) {
          setBusy(false);
          setErr(String(e.message || e));
        });
      }

      function doSave() {
        // 双保险：正文没读到就绝不发写请求（空 body 会清空草稿）。
        if (text === null) {
          setSave({ kind: 'err', text: '还没读到草稿原文，这次没有保存；先点「预览」再改。' });
          return;
        }
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
              d.sub ? h('span', { className: 'rl-sub' }, ' · ' + d.sub) : null,
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
                ? Btn({ onClick: doSave, primary: true, disabled: busy || text === null }, busy ? '保存中…' : '保存')
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
        call('transformOps', {}).then(
          function (r) { if (alive && r && r.ops && r.ops.length) setOps(r.ops); else if (alive) setErr('拿不到变换算子清单（宿主回的是空表），先重启 Harness 再试。'); },
          function (e) { if (alive) setErr('拿不到变换算子清单：' + String((e && e.message) || e)); },
        );
        return function () { alive = false; };
      }, []);

      var spec = null;
      for (var i = 0; ops && i < ops.length; i += 1) if (ops[i].id === op) spec = ops[i];

      function run() {
        if (busy) return;
        if (!spec) { setErr('还没选变换方式（算子清单没读到的话，先把 Harness 重启一次）。'); return; }
        setBusy(true); setErr(null); setResult(null);
        var args = { project: props.project, data: props.path, op: op, x: x, y: y, params: pvals, overwrite: overwrite };
        if (outName) args.outName = outName;
        call('tableTransform', args).then(function (value) {
          setBusy(false);
          setResult(value || {});
          if (props.onReload) props.onReload();
        }, function (e) {
          setBusy(false);
          setErr(String((e && e.message) || e || '操作失败'));
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
      var pick = typeof props.onPick === 'function' ? props.onPick : null;
      return h('div', { className: 'rl-stages' }, STAGE_ORDER.map(function (s, i) {
        var state = i < at ? 'done' : (i === at ? 'active' : 'pending');
        var label = STAGE_LABEL[s];
        if (!pick) return h('span', { key: s, className: 'rl-stage', 'data-state': state }, label);
        return h('button', {
          key: s, type: 'button', className: 'rl-stage rl-stage--pick', 'data-state': state,
          title: '切换到「' + STAGE_LABEL[s] + '」', disabled: s === props.stage,
          onClick: function () { pick(s); },
        }, label);
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
      var empty = (snap.projects || []).filter(isEmptyProject);
      if (noCaption.length) out.push({ tone: 'warn', text: noCaption.length + ' 张图没有图注', names: noCaption.slice(0, 3).map(function (x) { return x.f.figureId; }) });
      if (noSource.length) out.push({ tone: 'warn', text: noSource.length + ' 张图没登记源数据', names: noSource.slice(0, 3).map(function (x) { return x.f.figureId; }) });
      if (noDoi.length) out.push({ tone: '', text: noDoi.length + ' 条文献没有 DOI（引用要人工核对）', names: noDoi.slice(0, 3).map(function (r) { return String(r.title || r.key).slice(0, 40); }) });
      if (empty.length) out.push({ tone: '', text: empty.length + ' 个课题还是空的', names: empty.slice(0, 3).map(function (p) { return p.title || p.slug; }) });
      if (!out.length) out.push({ tone: '', text: '没有发现问题：图注、源数据、DOI 都齐。', names: [] });
      return out;
    }

    /** 最近动态：新图 / 新草稿 / 新数据 / 新文献，按时间倒序；带 project 供详情按课题收窄。 */
    function recentItems(snap, limit) {
      var out = [];
      if (!snap) return out;
      (snap.projects || []).forEach(function (p) {
        (p.figures || []).forEach(function (f) {
          if (f.createdAt) out.push({ at: f.createdAt, p: p.slug, text: '新图 ' + f.figureId });
        });
        (p.drafts || []).forEach(function (d) { if (d.mtime) out.push({ at: d.mtime, p: p.slug, text: '草稿 ' + d.name }); });
        (p.datasets || []).forEach(function (d) { if (d.mtime) out.push({ at: d.mtime, p: p.slug, text: '数据 ' + d.name }); });
      });
      (snap.refs || []).forEach(function (r) {
        if (r.addedAt) out.push({ at: r.addedAt, text: '文献 ' + String(r.title || r.key).slice(0, 48) });
      });
      return out.filter(function (x) { return x.at; })
        .sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); })
        .slice(0, limit || 6);
    }

    /**
     * 数据血缘：从快照现算「数据文件 → 图」，不发新请求。
     * 值得看的三件事：哪些数据被哪些图用过、哪些数据从来没被图用过、哪些图指着的源数据已经不在了。
     * 只读推断，标不出结论的地方就照实说「没登记源数据」，不猜。
     */
    function Lineage(props) {
      var p = props.project || {};
      var figs = Array.isArray(p.figures) ? p.figures : [];
      var data = Array.isArray(p.datasets) ? p.datasets : [];
      if (!figs.length && !data.length) return null;
      var bySource = {};
      var missing = [];
      var noSource = [];
      figs.forEach(function (f) {
        var id = f.figureId || '?';
        var srcs = Array.isArray(f.sources) ? f.sources : [];
        if (!srcs.length) noSource.push(id);
        srcs.forEach(function (s) {
          var k = String(s);
          if (!bySource[k]) bySource[k] = [];
          if (bySource[k].indexOf(id) < 0) bySource[k].push(id);
        });
        (Array.isArray(f.sourcesExist) ? f.sourcesExist : []).forEach(function (x) {
          if (!x || x.exists) return;
          missing.push(id + ' 的源数据不在了：' + x.path);
        });
      });
      var used = Object.keys(bySource);
      /*
       * 侧车里登记的源数据不一定带扩展名（`data/ZT-1100-2h` 指的就是 `data/ZT-1100-2h.txt`），
       * 也可能登记成整个目录。所以「这个数据文件被用过没有」按三种口径比：整串、去掉扩展名、前缀是目录。
       */
      var usedNoExt = used.map(function (u) { return String(u).replace(/\.[^./]+$/, ''); });
      var unused = data.filter(function (d) {
        var p = String(d.path || '');
        if (used.indexOf(p) >= 0) return false;
        if (usedNoExt.indexOf(p.replace(/\.[^./]+$/, '')) >= 0) return false;
        return !used.some(function (u) { return p.indexOf(String(u).replace(/\/$/, '') + '/') === 0; });
      });
      var lines = [];
      used.slice(0, 8).forEach(function (path) {
        lines.push({ k: 'u' + lines.length, left: path, right: bySource[path].join(' · ') });
      });
      return h('div', { key: 'lineage', 'data-rl-tour': 'lineage' }, [
        h('div', { key: 'h', className: 'rl-sub' }, '数据 → 图（按侧车登记的源数据算）'),
        lines.length
          ? h('ul', { key: 'ul', className: 'rl-list' }, lines.map(function (r) {
            return h('li', { key: r.k }, [
              h('span', { key: 'p', className: 'rl-mono' }, r.left),
              h('span', { key: 'a', className: 'rl-sub' }, ' · ' + r.right),
            ]);
          }))
          : h('div', { key: 'none', className: 'rl-sub' }, '还没有图登记过源数据。'),
        unused.length
          ? h('div', { key: 'uu', className: 'rl-sub' }, '没被任何图引用的数据：' + unused.length + ' 个（'
            + unused.slice(0, 3).map(function (d) { return d.name; }).join('、')
            + (unused.length > 3 ? ' 等' : '') + '）')
          : null,
        noSource.length
          ? h('div', { key: 'ns', className: 'rl-sub' }, noSource.length + ' 张图没登记源数据：' + noSource.slice(0, 4).join(' · '))
          : null,
        missing.length
          ? h('ul', { key: 'ms', className: 'rl-warns' }, missing.slice(0, 4).map(function (t, i) { return h('li', { key: 'm' + i }, t); }))
          : null,
      ]);
    }

    /**
     * 笔记（实验日志）：`projects/<课题>/notes/*.md`。
     * 服务端动作 `notes.list` / `notes.read` / `notes.save`（写要先计划再确认，覆盖前服务端留 `.bak`）。
     * 面板这边只做三件事：列出、读、写；不猜文件名（不给名字就让服务端按时间取一个）。
     */
    function NotesPanel(props) {
      var call = props.call;
      var ctx = props.ctx;
      var snap = props.snap || {};
      var projects = Array.isArray(snap.projects) ? snap.projects : [];
      var q = String(props.q || '').trim();
      var picked = q && projects.filter(function (p) { return p.slug === q; })[0];
      var projState = React.useState(picked ? picked.slug : (projects[0] ? projects[0].slug : ''));
      var proj = projState[0], setProj = projState[1];
      var listState = React.useState(null);
      var list = listState[0], setList = listState[1];
      var curState = React.useState(null);
      var cur = curState[0], setCur = curState[1];
      var editState = React.useState(null);
      var edit = editState[0], setEdit = editState[1];
      var planState = React.useState(null);
      var plan = planState[0], setPlan = planState[1];
      var msgState = React.useState(null);
      var msg = msgState[0], setMsg = msgState[1];
      var busyState = React.useState(false);
      var busy = busyState[0], setBusy = busyState[1];

      var load = React.useCallback(function () {
        if (!proj) { setList({ notes: [] }); return; }
        call('notes.list', { project: proj }).then(
          function (r) { setList(r || { notes: [] }); },
          function (e) { setMsg({ kind: 'err', text: String((e && e.message) || e) }); },
        );
      }, [proj, call]);
      React.useEffect(function () { load(); }, [load]);

      var openNote = function (n) {
        setMsg(null);
        call('notes.read', { project: proj, name: n.name }).then(
          function (r) { setCur(r); setEdit(null); },
          function (e) { setMsg({ kind: 'err', text: String((e && e.message) || e) }); },
        );
      };
      var planSave = function () {
        if (!edit) return;
        var params = { project: proj, text: edit.text };
        if (edit.name) params.name = edit.name;
        setBusy(true);
        call('action.plan', { actionId: 'notes.save', params: params }).then(
          function (p) { setBusy(false); setPlan(p); },
          function (e) { setBusy(false); setMsg({ kind: 'err', text: String((e && e.message) || e) }); },
        );
      };
      var doSave = function () {
        if (!plan || !edit) return;
        var params = { project: proj, text: edit.text };
        if (edit.name) params.name = edit.name;
        setBusy(true);
        confirmPlan(call, plan, params).then(
          function (v) {
            setBusy(false); setPlan(null); setEdit(null);
            setMsg({ kind: 'ok', text: '已保存：' + ((v && v.name) || '笔记') });
            load();
          },
          function (e) { setBusy(false); setMsg({ kind: 'err', text: String((e && e.message) || e) }); },
        );
      };

      var notes = (list && list.notes) || [];
      return h('div', { className: 'rl-page' }, [
        h('div', { key: 'hd', className: 'rl-row', style: { marginBottom: 'var(--rl-s3)' } }, [
          h('div', { key: 'l' }, [
            h('span', { key: 't', style: { fontWeight: 600 } }, '笔记'),
            h('span', { key: 's', className: 'rl-sub' }, '　projects/' + (proj || '<课题>') + '/notes/*.md · 保存前自动留 .bak'),
          ]),
          h('div', { key: 'a', className: 'rl-actions' }, [
            Btn({ key: 'n', disabled: !proj || busy, onClick: function () { setEdit({ name: '', text: '' }); setCur(null); setMsg(null); } }, '新建笔记'),
            Btn({ key: 'r', className: 'rl-btn--quiet', onClick: load }, '刷新'),
          ]),
        ]),
        projects.length > 1
          ? h('div', { key: 'pj', className: 'rl-row', style: { marginBottom: 'var(--rl-s3)' } }, projects.map(function (p) {
            return Btn({
              key: 'p' + p.slug, className: p.slug === proj ? '' : 'rl-btn--quiet',
              onClick: function () { setProj(p.slug); setCur(null); setEdit(null); },
            }, p.title || p.slug);
          }))
          : null,
        msg ? h('div', { key: 'm', className: msg.kind === 'ok' ? 'rl-ok' : 'rl-err', style: { marginBottom: 'var(--rl-s2)' } }, msg.text) : null,
        edit
          ? h('div', { key: 'ed', className: 'rl-card' }, [
            h('div', { key: 'r', className: 'rl-row' }, [
              h('span', { key: 'l', className: 'rl-sub' }, '文件名（留空按时间自动取）'),
              h('input', {
                key: 'i', className: 'rl-name', value: edit.name, placeholder: 'YYYY-MM-DD-HHmm-…md',
                onChange: function (e) { setEdit({ name: e.target.value, text: edit.text }); },
              }),
            ]),
            h('div', { key: 't', className: 'rl-field', style: { marginTop: 'var(--rl-s2)' } },
              h('textarea', {
                key: 'x', rows: 12, value: edit.text, placeholder: '# 今天做了什么\n\n- ',
                onChange: function (e) { setEdit({ name: edit.name, text: e.target.value }); },
              })),
            h('div', { key: 'f', className: 'rl-actions', style: { marginTop: 'var(--rl-s2)' } }, [
              Btn({ key: 's', primary: true, disabled: busy || !String(edit.text || '').trim(), onClick: planSave }, busy ? '准备中…' : '保存'),
              Btn({ key: 'c', className: 'rl-btn--quiet', onClick: function () { setEdit(null); } }, '取消'),
            ]),
          ])
          : (cur
            ? h('div', { key: 'pv', className: 'rl-card' }, [
              h('div', { key: 'h', className: 'rl-row' }, [
                h('span', { key: 't', className: 'rl-mono' }, cur.path || cur.name),
                h('div', { key: 'a', className: 'rl-actions' }, [
                  Btn({ key: 'e', onClick: function () { setEdit({ name: cur.name || '', text: cur.text || '' }); } }, '编辑'),
                  Btn({ key: 'x', className: 'rl-btn--quiet', onClick: function () { setCur(null); } }, '收起'),
                ]),
              ]),
              h('pre', { key: 'b', className: 'rl-draft__body' }, cur.text || '（空）'),
            ])
            : null),
        list === null
          ? h('div', { key: 'ld', className: 'rl-sub' }, '读取中…')
          : (notes.length
            ? h('div', { key: 'ls' }, notes.map(function (n) {
              return h('button', {
                key: n.name, type: 'button', className: 'rl-wb__row', style: { width: '100%', marginBottom: '6px' },
                onClick: function () { openNote(n); },
              }, [
                h('div', { key: 't', className: 'rl-wb__rowTitle' }, n.title || n.name),
                h('div', { key: 's', className: 'rl-sub' }, n.name + ' · ' + fmtTime(n.mtime) + ' · ' + fmtBytes(n.bytes || 0)),
                n.summary ? h('div', { key: 'm', className: 'rl-sub' }, n.summary) : null,
              ]);
            }))
            : h('div', { key: 'e', className: 'rl-empty' }, '这个课题还没有笔记。「新建笔记」写一条，保存后落在 notes/ 下。')),
        plan ? h(PlanModal, {
          key: 'pm', plan: plan, busy: busy, error: null,
          onCancel: function () { setPlan(null); },
          onConfirm: doSave,
        }) : null,
      ]);
    }

    /* --------------------------------------------------- 图内选区问模型 */
    /*
     * 在图上圈一块，把「选区 + 整图 + 该图侧车」一起发给宿主已配置的模型。
     * 模型只回答和给改动计划，**不执行**任何写动作（执行按钮永远是用户按，且走计划+确认）。
     * 每张图一条对话线，先存浏览器本地（重开面板能接上）；要长期留就「存进笔记」。
     */
    var FIGCHAT_KEY = 'research-panel-chat:';

    function figChatLoad(id) {
      try { var s = localStorage.getItem(FIGCHAT_KEY + id); return s ? JSON.parse(s) : []; } catch (e) { return []; }
    }
    function figChatSave(id, turns) {
      try { localStorage.setItem(FIGCHAT_KEY + id, JSON.stringify(turns.slice(-20))); } catch (e) { /* 存不下就不存 */ }
    }
    /** 把归一化选区（0..1）从原图裁出来，返回 PNG 的 base64（不带 data: 前缀）。 */
    function cropFigure(src, box) {
      return new Promise(function (resolve, reject) {
        var im = new Image();
        im.onload = function () {
          var w = Math.max(1, Math.round(box.w * im.naturalWidth));
          var h = Math.max(1, Math.round(box.h * im.naturalHeight));
          var cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(im,
            Math.round(box.x * im.naturalWidth), Math.round(box.y * im.naturalHeight), w, h, 0, 0, w, h);
          resolve(cv.toDataURL('image/png').split(',')[1]);
        };
        im.onerror = function () { reject(new Error('图片解码失败，可能不是位图')); };
        im.src = src;
      });
    }
    function dataUrlBase64(src) {
      var m = /^data:[^;]+;base64,(.*)$/.exec(String(src || ''));
      return m ? m[1] : '';
    }
    function dataUrlMime(src) {
      var m = /^data:([^;]+);/.exec(String(src || ''));
      return m ? m[1] : 'image/png';
    }

    /* ------------------------------------------------------- 可复现性审计 */
    /*
     * `library.audit` 是只读动作，所以面板可以直接调，不需要计划确认。
     * 结果按「错误 / 提醒」分色，最多列 8 条，剩下的说清楚还有多少。
     */
    function Audit(props) {
      var call = props.call;
      var resState = React.useState(null);
      var res = resState[0], setRes = resState[1];
      var busyState = React.useState(false);
      var busy = busyState[0], setBusy = busyState[1];
      var errState = React.useState(null);
      var err = errState[0], setErr = errState[1];

      function run() {
        setBusy(true);
        setErr(null);
        var args = props.project ? { project: props.project } : {};
        call('library.audit', args).then(
          function (r) { setBusy(false); setRes(r); },
          function (e) { setBusy(false); setErr(String((e && e.message) || e)); },
        );
      }

      var counts = (res && res.counts) || null;
      var issues = (res && res.issues) || [];
      return h('div', { key: 'au', className: 'rl-wb__audit' }, [
        h('div', { key: 'h', className: 'rl-wb__recLine' }, [
          h('div', { key: 't', className: 'rl-sub' }, counts
            ? '可复现性审计：' + counts.err + ' 个错误 · ' + counts.warn + ' 个提醒'
            : '可复现性审计（只读，不改库）'),
          h('div', { key: 'a', className: 'rl-actions' }, [
            counts ? h('span', { key: 's', className: 'rl-sub' },
              '课题 ' + counts.projects + ' · 图 ' + counts.figures + ' · 数据 ' + counts.datasets) : null,
            Btn({ key: 'r', className: 'rl-btn--quiet', disabled: busy, onClick: run }, busy ? '检查中…' : (counts ? '重新检查' : '检查一遍')),
          ]),
        ]),
        err ? h('div', { key: 'e', className: 'rl-err' }, err) : null,
        counts
          ? (issues.length
            ? h('ul', { key: 'l', className: 'rl-list' }, issues.slice(0, 8).map(function (it, i) {
              return h('li', { key: i, className: it.level === 'err' ? 'rl-err' : 'rl-warn' },
                (it.level === 'err' ? '错误 · ' : '提醒 · ') + it.text);
            }).concat(issues.length > 8
              ? [h('li', { key: 'more', className: 'rl-sub' }, '…还有 ' + (issues.length - 8) + ' 条')]
              : []))
            : h('div', { key: 'ok', className: 'rl-ok' }, '没有发现问题：图侧车、源数据、草稿引用都对得上。'))
          : null,
      ]);
    }

  function FigureChat(props) {
    var ctx = props.ctx;
    var call = props.call;
    var fig = props.fig;
    var project = props.project;
    var src = props.img;
      var turnsState = React.useState(function () { return figChatLoad(fig.figureId); });
      var turns = turnsState[0], setTurns = turnsState[1];
      var selModeState = React.useState(!!props.autoSel);
      var selMode = selModeState[0], setSelMode = selModeState[1];
      var dragState = React.useState(null);
      var drag = dragState[0], setDrag = dragState[1];
      var selState = React.useState(null);   // { box, data }
      var sel = selState[0], setSel = selState[1];
      var qState = React.useState('');
      var q = qState[0], setQ = qState[1];
      var busyState = React.useState(false);
      var busy = busyState[0], setBusy = busyState[1];
      var errState = React.useState(null);
      var err = errState[0], setErr = errState[1];
      var modelsState = React.useState(null);
      var models = modelsState[0], setModels = modelsState[1];
      var pickState = React.useState('');
      var pick = pickState[0], setPick = pickState[1];
      var wrapRef = React.useRef(null);
      var planState = React.useState(null);
      var plan = planState[0], setPlan = planState[1];
      var noteMsgState = React.useState(null);
      var noteMsg = noteMsgState[0], setNoteMsg = noteMsgState[1];

      /** 把当前这段对话整理成一条笔记，走 notes.save 的计划 → 确认（写盘动作不直连）。 */
      function saveToNotes() {
        if (!project || !turns.length) return;
        var text = ['# 图 ' + fig.figureId + ' 的问答记录', ''].concat(turns.map(function (t) {
          return ['**问：** ' + t.q, '', '**答：** ' + (t.a || '（没有回答）'), ''].join('\n');
        })).join('\n');
        hostCall(ctx, 'action.plan', { actionId: 'notes.save', params: { project: project, text: text } }).then(
          function (r) { setPlan(r); setNoteMsg(null); },
          function (e) { setNoteMsg({ kind: 'err', text: String((e && e.message) || e) }); },
        );
      }
      function confirmNote(confirmParams) {
        if (!plan) return;
        confirmPlan(function (a, b) { return hostCall(ctx, a, b); }, plan, confirmParams).then(
          function (v) {
            setPlan(null);
            setNoteMsg({ kind: 'ok', text: '已存进笔记：' + ((v && v.path) || '') });
          },
          function (e) { setNoteMsg({ kind: 'err', text: String((e && e.message) || e) }); },
        );
      }

      React.useEffect(function () {
        var llm = null;
        try { llm = ctx && ctx.get ? ctx.get('llm') : null; } catch (e) { llm = null; }
        if (!llm) { setModels([]); return undefined; }
        var alive = true;
        Promise.all(llm.listProviders().map(function (p) {
          return Promise.resolve(llm.listModels(p.id)).then(function (ms) {
            return (ms || []).map(function (m) { return { value: p.id + '/' + m.id, label: p.id + ' / ' + m.id }; });
          }, function () { return []; });
        })).then(function (groups) {
          if (!alive) return;
          var flat = groups.reduce(function (a, b) { return a.concat(b); }, []);
          setModels(flat);
          var saved = null;
          try { saved = localStorage.getItem(FIGCHAT_KEY + 'model'); } catch (e) { /* 忽略 */ }
          setPick(saved && flat.some(function (x) { return x.value === saved; }) ? saved : (flat[0] ? flat[0].value : ''));
        });
        return function () { alive = false; };
      }, [ctx]);

      // Alt+Q：在图上开/关选区。只在本图卡片展开时生效（组件只在展开时挂载）。
      React.useEffect(function () {
        // 测试环境（react-test-renderer）里没有 window；宿主里才有。
        if (typeof window === 'undefined' || !window.addEventListener) return undefined;
        function onKey(e) {
          if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'q' || e.key === 'Q')) {
            e.preventDefault();
            setSelMode(function (v) { return !v; });
          }
        }
        window.addEventListener('keydown', onKey);
        return function () { window.removeEventListener('keydown', onKey); };
      }, []);

      function norm(x0, y0, x1, y1) {
        return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
      }
      function onDown(e) {
        if (!selMode || !wrapRef.current) return;
        var r = wrapRef.current.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        setDrag({ x0: x, y0: y, x1: x, y1: y });
      }
      function onMove(e) {
        if (!drag || !wrapRef.current) return;
        var r = wrapRef.current.getBoundingClientRect();
        setDrag({ x0: drag.x0, y0: drag.y0, x1: (e.clientX - r.left) / r.width, y1: (e.clientY - r.top) / r.height });
      }
      function onUp() {
        if (!drag) return;
        var box = norm(drag.x0, drag.y0, drag.x1, drag.y1);
        setDrag(null);
        if (box.w < 0.02 || box.h < 0.02) return;   // 手一抖就忽略
        setBusy(true);
        cropFigure(src, box).then(
          function (data) { setBusy(false); setSel({ box: box, data: data }); setSelMode(false); setErr(null); },
          function (e) { setBusy(false); setErr(String((e && e.message) || e)); },
        );
      }

      function buildPrompt() {
        var lines = [
          '这是一篇论文里的一张图。我在图上圈了一块（第一张图是圈出的部分，第二张是整图）。',
          '图的登记信息：',
          '- 图号：' + fig.figureId + '（图页页签：' + (fig.graph || '未记录') + '）',
          '- 源数据：' + ((fig.sources || [])[0] || '未记录'),
          '- 目标期刊：' + (fig.journal || '未记录'),
          '- 图注：' + (fig.caption || '（还没有写图注）'),
          '',
          '我的问题：' + String(q || '').trim(),
          '',
          '要求：只描述你在这两张图里真的看到的东西，看不清就说看不清，不要编造坐标和数值。',
          '如果你认为需要改文件，只给「改动计划」（改哪个文件、改成什么、影响什么），不要假装你已经改了。',
        ];
        return lines.join('\n');
      }

      function send() {
        var text = String(q || '').trim();
        if (!text || busy) return;
        var llm = null;
        try { llm = ctx && ctx.get ? ctx.get('llm') : null; } catch (e) { llm = null; }
        if (!llm) { setErr('宿主没有模型服务，面板里问不了模型。'); return; }
        if (!pick) { setErr('还没有选模型。'); return; }
        var cut = pick.indexOf('/');
        var provider = pick.slice(0, cut), model = pick.slice(cut + 1);
        var content = [{ type: 'text', text: buildPrompt() }];
        if (sel) content.push({ type: 'image', source: { type: 'base64', data: sel.data, media_type: 'image/png' } });
        var full = dataUrlBase64(src);
        if (full) content.push({ type: 'image', source: { type: 'base64', data: full, media_type: dataUrlMime(src) } });
        var turn = { q: text, a: '', sel: sel ? sel.box : null, at: new Date().toISOString() };
        var next = turns.concat([turn]);
        setTurns(next);
        setBusy(true);
        setErr(null);
        try { localStorage.setItem(FIGCHAT_KEY + 'model', pick); } catch (e) { /* 忽略 */ }
        (async function () {
          var acc = '';
          try {
            var stream = llm.stream({ provider: provider, model: model, messages: [{ role: 'user', content: content }] });
            for await (var chunk of stream) {
              if (chunk && chunk.type === 'text-delta' && chunk.text) {
                acc += chunk.text;
                setTurns(function (prev) {
                  var copy = prev.slice();
                  copy[copy.length - 1] = Object.assign({}, copy[copy.length - 1], { a: acc });
                  return copy;
                });
              }
            }
          } catch (e) {
            var m = String((e && e.message) || e);
            setErr(m);
            acc = acc || '（这次没拿到回答：' + m + '）';
          } finally {
            setBusy(false);
            var finalTurns = next.slice();
            finalTurns[finalTurns.length - 1] = Object.assign({}, turn, { a: acc });
            setTurns(finalTurns);
            figChatSave(fig.figureId, finalTurns);
            setQ('');
          }
        })();
      }

      var box = drag ? norm(drag.x0, drag.y0, drag.x1, drag.y1) : (sel ? sel.box : null);
      var pct = function (v) { return (v * 100).toFixed(2) + '%'; };

      return h('div', { className: 'rl-figchat' }, [
        h('div', {
          key: 'wrap', ref: wrapRef, className: 'rl-selwrap', 'data-sel': selMode ? '1' : '0',
          onMouseDown: onDown, onMouseMove: onMove, onMouseUp: onUp,
        }, [
          h('img', {
            key: 'i', className: props.zoom ? 'rl-thumb-big' : 'rl-thumb', src: src, alt: fig.figureId,
            // 不关掉原生拖拽的话，圈选时浏览器会把 <img> 当成 HTML5 拖放源，
            // 松手时面板的 onDrop 收到一个「文件」，直接弹出导入弹层——圈选变成了导入。
            draggable: false,
            onDragStart: function (e) { if (e && e.preventDefault) e.preventDefault(); },
            onClick: function () { if (!selMode) props.onToggleZoom(); },
          }),
          box ? h('div', {
            key: 'b', className: 'rl-selbox',
            style: { left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h) },
          }) : null,
          selMode ? h('div', { key: 'hint', className: 'rl-selhold' }, '按住拖动圈一块，Alt+Q 退出') : null,
        ]),
        h('div', { key: 'bar', className: 'rl-row', style: { marginTop: 'var(--rl-s2)', gap: 'var(--rl-s2)' } }, [
          h('div', { key: 'l', className: 'rl-sub' },
            sel ? '已圈选一块（' + Math.round(sel.box.w * 100) + '% × ' + Math.round(sel.box.h * 100) + '%），可重新圈'
              : '按 Alt+Q 在图上圈选，就能就这一块提问'),
          h('div', { key: 'r', className: 'rl-actions' }, [
            sel ? Btn({ key: 'c', className: 'rl-btn--quiet', onClick: function () { setSel(null); } }, '取消选区') : null,
            Btn({ key: 's', className: 'rl-btn--quiet', onClick: function () { setSelMode(!selMode); } }, selMode ? '退出圈选' : '圈选'),
          ]),
        ]),
        h('div', { key: 'ask', className: 'rl-field', style: { marginTop: 'var(--rl-s2)' } }, [
          models && models.length
            ? h('select', {
              key: 'm', className: 'rl-name', value: pick, style: { marginBottom: '6px' },
              onChange: function (e) { setPick(e.target.value); },
            }, models.map(function (m) { return h('option', { key: m.value, value: m.value }, m.label); }))
            : h('div', { key: 'm0', className: 'rl-sub' }, models === null ? '读取模型列表…' : '宿主里没有已配置的模型'),
          h('textarea', {
            key: 'q', rows: 3, value: q, placeholder: '比如：这块的峰是不是和标尺对不上？ / 这一处的颜色在期刊印刷后会不会糊？',
            onChange: function (e) { setQ(e.target.value); },
            onKeyDown: function (e) {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send(); }
            },
          }),
          h('div', { key: 'a', className: 'rl-actions', style: { marginTop: '6px' } }, [
            Btn({ key: 'send', primary: true, disabled: busy || !String(q || '').trim(), onClick: send }, busy ? '等模型…' : '问模型'),
            turns.length ? Btn({ key: 'note', className: 'rl-btn--quiet', disabled: busy, onClick: saveToNotes }, '存进笔记') : null,
            Btn({
              key: 'clr',
              className: 'rl-btn--quiet',
              // 回答还在流的时候清空没意义：流结束后 finally 会把旧对话写回去，看着像「清空没用」。
              disabled: busy,
              onClick: function () { setTurns([]); figChatSave(fig.figureId, []); },
            }, '清空对话'),
          ]),
          noteMsg ? h('div', { key: 'nm', className: noteMsg.kind === 'ok' ? 'rl-ok' : 'rl-err', style: { marginTop: '6px' } }, noteMsg.text) : null,
        ]),
        err ? h('div', { key: 'e', className: 'rl-err', style: { marginTop: 'var(--rl-s2)' } }, err) : null,
        turns.length
          ? h('div', { key: 't', className: 'rl-chat' }, turns.map(function (t, i) {
            return h('div', { key: 'turn' + i, className: 'rl-chat__turn' }, [
              h('div', { key: 'q', className: 'rl-chat__q' }, t.q),
              h('div', { key: 'a', className: 'rl-chat__a' }, t.a || (busy && i === turns.length - 1 ? '…' : '')),
            ]);
          }))
          : null,
        plan ? h(PlanModal, {
          key: 'pm', plan: plan, busy: false, error: null,
          onCancel: function () { setPlan(null); },
          onConfirm: confirmNote,
        }) : null,
      ]);
    }

    /* --------------------------------------------- 圈选问模型（悬浮窗） */
    /*
     * 用户要的形态是「一个按钮或快捷键调出来、选好范围就能聊」的浮层，不是图卡里内联。
     * 这里只做外壳：选课题 + 选图 + 读图，圈选与对话交给 FigureChat（同一份实现，不抄第二份）。
     */
    function FigureOverlay(props) {
      var ctx = props.ctx;
      var call = props.call;
      var snap = props.snap;
      var onClose = props.onClose;
      var projects = (snap && snap.projects) || [];

      var projState = React.useState(props.project || (projects[0] && projects[0].slug) || '');
      var projSlug = projState[0], setProjSlug = projState[1];
      var cur = projects.filter(function (p) { return p.slug === projSlug; })[0] || projects[0] || null;
      var figs = (cur && cur.figures) || [];

      var figState = React.useState(props.figureId || '');
      var figId = figState[0], setFigId = figState[1];
      var fig = figs.filter(function (f) { return f.figureId === figId; })[0] || figs[0] || null;

      var imgState = React.useState(null);
      var img = imgState[0], setImg = imgState[1];
      var errState = React.useState(null);
      var err = errState[0], setErr = errState[1];
      var busyState = React.useState(false);
      var busy = busyState[0], setBusy = busyState[1];

      // 图只有展开/缩放时才读盘（图卡那边同样口径）；pdf/tif 塞 <img> 只会破图，直接说清楚。
      React.useEffect(function () {
        setImg(null);
        setErr(null);
        if (!fig) return undefined;
        if (!fig.file || fig.fileExists === false) { setErr('这张图还没有主件文件。'); return undefined; }
        if (!IMG_RE.test(fig.file)) { setErr('主件是 ' + String(fig.file).split('.').pop() + '，悬浮窗里只能看位图或 SVG；用「看 PDF」打开原件。'); return undefined; }
        var key = figImgKey(fig);
        if (imgCache.has(key)) { setImg(imgCache.get(key)); return undefined; }
        var alive = true;
        setBusy(true);
        call('readBinary', { path: fig.file }).then(
          function (r) {
            if (!alive) return;
            var url = 'data:' + r.mime + ';base64,' + r.base64;
            imgCache.set(key, url);
            setBusy(false);
            setImg(url);
          },
          function (e) { if (alive) { setBusy(false); setErr(String((e && e.message) || e)); } },
        );
        return function () { alive = false; };
      }, [fig && fig.file, fig && fig.fileBytes, fig && fig.fileExists]);

      // Esc 关窗；点背景也关（点面板里头不关）。
      React.useEffect(function () {
        if (typeof window === 'undefined' || !window.addEventListener) return undefined;
        function onKey(e) {
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }
        window.addEventListener('keydown', onKey);
        return function () { window.removeEventListener('keydown', onKey); };
      }, [onClose]);

      return h('div', {
        className: 'rl-figover', role: 'dialog', 'aria-label': '圈选问模型',
        onMouseDown: function (e) { if (e.target === e.currentTarget) onClose(); },
      }, [
        h('div', { key: 'box', className: 'rl-figover__box' }, [
          h('div', { key: 'h', className: 'rl-figover__head' }, [
            h('div', { key: 't', className: 'rl-figover__title' }, '圈选问模型'),
            h('select', {
              key: 'p', className: 'rl-name', value: cur ? cur.slug : '',
              'aria-label': '选课题',
              onChange: function (e) { setProjSlug(e.target.value); setFigId(''); },
            }, projects.map(function (p) { return h('option', { key: p.slug, value: p.slug }, p.title || p.slug); })),
            h('select', {
              key: 'f', className: 'rl-name', value: fig ? fig.figureId : '',
              'aria-label': '选图',
              onChange: function (e) { setFigId(e.target.value); },
            }, figs.map(function (f) { return h('option', { key: f.figureId, value: f.figureId }, f.figureId + ' · ' + (f.sidecar || '').split('/').pop()); })),
            h('div', { key: 'a', className: 'rl-actions' }, [
              h('span', { key: 'k', className: 'rl-sub' }, 'Alt+Q 切圈选 · Esc 关闭'),
              Btn({ key: 'x', className: 'rl-btn--quiet', onClick: onClose }, '关闭'),
            ]),
          ]),
          err ? h('div', { key: 'e', className: 'rl-err' }, err) : null,
          (fig && !err && !img && busy) ? h('div', { key: 'l', className: 'rl-sub' }, '读取图片…') : null,
          (fig && img) ? h(FigureChat, {
            key: 'chat' + fig.figureId, ctx: ctx, call: call, project: cur ? cur.slug : '',
            fig: fig, img: img, zoom: true, autoSel: true, onToggleZoom: function () {},
          }) : null,
          (!figs.length) ? h('div', { key: 'none', className: 'rl-empty' }, '这个课题还没有登记图。') : null,
        ]),
      ]);
    }

    function Workbench(props) {
      var call = props.call;
      var onImport = props.onImport;
      var onConsole = props.onConsole;
      var onTour = props.onTour;
      var rootPath = props.root;
      // 顶部筛选词（由 makePanel 传进来）与两个出口：清空 / 跳到 v1 的某个页签。
      var q = props.q || '';
      var onClearQ = props.onClearQ;
      var onOpenTab = props.onOpenTab;
      var listState = React.useState(null);
      var list = listState[0], setList = listState[1];
      var recState = React.useState([]);
      var receipts = recState[0], setReceipts = recState[1];
      var detState = React.useState(null);
      var detail = detState[0], setDetail = detState[1];
      var selState = React.useState('');
      var sel = selState[0], setSel = selState[1];
      /*
       * 「看课题」以前只 setSel：如果这个课题本来就是当前选中的（首屏自动选第一个，
       * 待办表第一行也常是它），同一份 state 写回同一个值 —— React 不重渲染，看起来像点了没反应。
       * 现在统一走 focusProject：重新拉一次详情、把详情滚进视野、再亮一下边框。
       */
      var detailRef = React.useRef(null);
      var flashState = React.useState(0);
      var flashAt = flashState[0], setFlashAt = flashState[1];
      var flashTimer = React.useRef(null);
      React.useEffect(function () {
        return function () {
          if (flashTimer.current) { try { clearTimeout(flashTimer.current); } catch (e) { /* ignore */ } }
        };
      }, []);
      function focusProject(slug) {
        if (!slug) return;
        var same = slug === sel;
        setSel(slug);
        setFlashAt(Date.now());
        if (flashTimer.current) { try { clearTimeout(flashTimer.current); } catch (e) { /* ignore */ } }
        flashTimer.current = setTimeout(function () { setFlashAt(0); }, 900);
        var el = detailRef.current;
        if (el && typeof el.scrollIntoView === 'function') {
          try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { try { el.scrollIntoView(); } catch (e2) { /* 老宿主没有这个 API */ } }
        }
        // 点的是同一个课题时 setSel 不会触发那个 effect（值没变），详情得自己重拉一次。
        if (same) {
          call('project.get', { project: slug }).then(setDetail, function (e) { setError(String((e && e.message) || e)); });
        }
      }
      var planState = React.useState(null);
      var plan = planState[0], setPlan = planState[1];
      var paramsRef = React.useRef({});
      var busyState = React.useState(false);
      var busy = busyState[0], setBusy = busyState[1];
      var errState = React.useState(null);
      var error = errState[0], setError = errState[1];
      var msgState = React.useState(null);
      var message = msgState[0], setMessage = msgState[1];
      // 首屏是空的（数据还没回来）时别写「库里还没有课题」——那是在撒谎，用户会以为库丢了。
      var loadState = React.useState(true);
      var loading = loadState[0], setLoading = loadState[1];
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
        setLoading(true);
        return Promise.all([call('project.list', {}), call('system.receipts', { limit: 8 }), call('snapshot', {})])
          .then(function (r) {
            setList(r[0] || { projects: [] });
            setReceipts((r[1] && r[1].receipts) || []);
            /*
             * 回归（2026-10-24）：snapshot 自己报 ok:false（库根不存在 / 不可读）时，
             * 以前只把 snap 置 null 就完事，于是工作台显示「库里还没有课题。」——
             * 把可诊断的故障说成了空库，用户会跑去重装/重导入。v1 列表页一直是报错的，
             * 两个视图不该对同一个故障说两套话，这里补上 setError 并清掉上一轮的旧错。
             */
            var sn = r[2] || null;
            if (sn && sn.ok === false) {
              setSnap(null);
              setError(String(sn.error || '科研库不可读'));
            } else {
              setSnap(sn);
              setError(null);
            }
            setLoading(false);
          }, function (e) { setLoading(false); setError(String((e && e.message) || e)); });
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
      // 首屏顺手拿一次本地版本号（remote:false，不联网、不阻塞载入）。
      React.useEffect(function () { checkUpdate(false); }, []);

      React.useEffect(function () {
        if (!sel) { setDetail(null); return; }
        call('project.get', { project: sel }).then(setDetail, function (e) { setError(String((e && e.message) || e)); });
      }, [sel, call]);

      /*
       * 没选中就给第一个课题：右边那块详情空着时只是一大块占位，
       * 而「点左边第一个课题」本来也没有第二种答案。
       */
      React.useEffect(function () {
        if (sel) return;
        var rows = (list && list.projects) || [];
        if (rows.length && rows[0].slug) setSel(rows[0].slug);
      }, [sel, list]);

      var projects = (list && list.projects) || [];
      var current = detail && detail.project ? detail.project : projects.filter(function (p) { return p.slug === sel; })[0];
      /*
       * 课题的标识有两个名字：project.list 的行叫 slug，project.get 读出来的是 project.json 里的 id
       * （disk 上只有 id，没有 slug）。以前这里只用 current.slug，详情一来自 project.get 就变成
       * undefined → 点阶段 / 点产物都会带着空项目去发动作，宿主报「缺少必填参数：project」。
       */
      var curId = current ? (current.slug || current.id || '') : '';
      var next = (detail && detail.next) || (current && current.next) || null;
      var stage = current ? current.stage : '';

      var ask = function (actionId, params) {
        setError(null); setMessage(null);
        call('action.plan', { actionId: actionId, params: params || {} }).then(function (p) {
          paramsRef.current = params || {};
          setPlan(p);
        }, function (e) { setError(String((e && e.message) || e)); });
      };

      /*
       * 检查更新（0.3.12）：先只要本地版本号（remote:false，不联网），点按钮才去 GitHub 比。
       * 有新版且这份安装是干净的 git 工作树 → 直接走 action.plan / action.confirm 更新；
       * 拷贝安装则只给一句人话，不假装能自我更新。
       */
      var updateState = React.useState(null);
      var update = updateState[0], setUpdate = updateState[1];
      var checkingState = React.useState(false);
      var checking = checkingState[0], setChecking = checkingState[1];
      var checkUpdate = function (withRemote) {
        setChecking(Boolean(withRemote));
        return call('system.update_check', { remote: withRemote !== false }).then(function (r) {
          setChecking(false);
          setUpdate(r || null);
          return r;
        }, function (e) {
          setChecking(false);
          setError('检查更新失败：' + String((e && e.message) || e));
        });
      };

      var confirmPlan = function () {
        if (!plan) return;
        var applyingUpdate = plan.actionId === 'system.update_apply';
        setBusy(true);
        call('action.confirm', { actionId: plan.actionId, planId: plan.planId, token: plan.token, params: paramsRef.current || {} })
          .then(function (out) {
            setBusy(false); setPlan(null);
            var rid = out && out.receipt && out.receipt.receiptId;
            var value = out && out.value;
            if (applyingUpdate && value) {
              setMessage(value.applied
                ? '已更新：' + value.from.version + ' → ' + value.to.version + '。' + (value.note || '')
                : (value.ok ? '已经是最新版（' + value.to.version + '）。' : '更新没成功：' + (value.output || '看回执')));
            } else {
              setMessage(rid ? '已执行，回执 ' + rid : '已执行');
            }
            setSel('');
            load();
            if (applyingUpdate) checkUpdate(true);
          }, function (e) {
            setBusy(false);
            setPlan(null);
            setError(String((e && e.message) || e));
          });
      };

      var advance = stage && stageIndex(stage) < STAGE_ORDER.length - 1 ? STAGE_ORDER[stageIndex(stage) + 1] : '';
      var readyCount = projects.filter(function (p) { return p.next && p.next.ready; }).length;

      /*
       * 筛选：v2 里这个框以前完全不生效（只对 v1 页签生效，工作台里敲字毫无反应）。
       * 现在同一套「命中任一字段」规则也收到工作台：课题列表 / 跨课题待办 / 库体检一起收窄；
       * 页头的计数仍是全库统计（它是库的体检，不是列表的）。
       */
      var hitQ = makeHit(q);
      var filtering = String(q || '').trim() !== '';
      var shownProjects = projects.filter(function (p) {
        return hitQ(p.slug, p.title, p.journal, STAGE_LABEL[p.stage] || p.stage, p.next && p.next.ready ? '就绪' : '');
      });

      // 仪表数据：全在 snapshot 里，不额外打宿主
      var healthList = healthItems(snap).filter(function (x) { return hitQ(x.text, (x.names || []).join(' ')); });
      // 「没有发现问题」不是问题，别拿它占页面一行的位置。
      var healthIssues = healthList.filter(function (x) { return String(x.text).indexOf('没有发现问题') < 0; });
      /*
       * 库级提示（快照 warnings + 体检项）合成一处，摆在待办表下面。
       * 以前它贴在页头顶上，两条长命令把标题都压下去了；同一件事也只说一遍。
       */
      var notices = ((snap && snap.warnings) || []).map(function (t) { return String(t); })
        .concat(healthIssues.map(function (x) {
          return String(x.text) + (x.names && x.names.length ? '：' + x.names.join('、') : '');
        }))
        .filter(function (t, i, arr) { return t && arr.indexOf(t) === i; });
      var recents = recentItems(snap, 40).filter(function (r) { return hitQ(r.text); });
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
      /*
       * 投稿的截止日也并进这张表（0.4.0）：以前它是首页单独一张「投稿倒计时」卡片，
       * 和这张表说的是同一件事，还占了一整块面积。现在同表同行，按到期日排在最前面。
       */
      var subRows = ((snap && snap.submissions) || [])
        .filter(function (s) { return s.kind === 'submission' && SUB_CLOSED_STATUS.indexOf(s.status) < 0; })
        .map(function (s) { return { s: s, d: daysLeft(s.nextActionDue || s.decisionExpectedAt) }; })
        .filter(function (x) { return x.d != null; })
        .sort(function (a, b) { return a.d - b.d; })
        .slice(0, 5)
        .map(function (x) {
          return {
            slug: x.s.project || '',
            title: x.s.title || x.s.submissionId || '投稿',
            sub: true,
            due: x.d,
            stage: '',
            why: (x.s.journalName || x.s.journal || '投稿') + '：' + (x.s.nextAction || '处理投稿') + '（' + dueText(x.d) + '）',
            action: 'update-submission',
            ready: false,
          };
        });
      var allRows = subRows.concat(todoRows);
      var shownTodos = allRows.filter(function (t) {
        return hitQ(t.slug, t.title, STAGE_LABEL[t.stage] || t.stage || '', t.why, t.action);
      });

      /*
       * 本课题产物速览：详情里直接报数，点一下跳到 v1 的对应页签并把筛选词钉成这个课题的 slug
       * （图/草稿/数据的路径里都含 slug，所以 v1 那边只会剩这个课题的条目）。
       * 数字为 0 的按钮置灰——没有的东西点进去只会看到空页。
       */
      var mine = current && snap
        ? (snap.projects || []).filter(function (p) { return p.slug === curId; })[0] || null
        : null;
      var mineRefs = current ? ((snap && snap.refs) || []).filter(function (r) {
        return (r.projects || []).indexOf(curId) >= 0;
      }).length : 0;
      var mineSubs = current ? ((snap && snap.submissions) || []).filter(function (x) {
        return x.kind === 'submission' && x.project === curId && SUB_CLOSED_STATUS.indexOf(x.status) < 0;
      }).length : 0;
      function artifactChip(key, label, n, tabId) {
        return h('button', {
          key: key, type: 'button', className: 'rl-chip', 'data-on': '0',
          disabled: !n || !onOpenTab,
          title: (n && onOpenTab) ? '只看这个课题的' + label : '这个课题还没有' + label,
          onClick: function () { if (n && onOpenTab && current) onOpenTab(tabId, curId); },
        }, label + ' ' + n);
      }
      var chips = (current && mine) ? h('div', { key: 'arts', className: 'rl-chips', style: { marginTop: '6px' } }, [
        artifactChip('f', '图', (mine.figures || []).length, 'figures'),
        artifactChip('d', '草稿', (mine.drafts || []).length, 'drafts'),
        artifactChip('a', '数据', (mine.datasets || []).length, 'assets'),
        artifactChip('t', '表', (mine.tables || []).length, 'assets'),
        artifactChip('o', '工程', (mine.opju || []).length, 'assets'),
        artifactChip('r', '文献', mineRefs, 'refs'),
        artifactChip('s', '在投', mineSubs, 'submissions'),
      ]) : null;

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
            h('div', { key: 's', className: 'rl-page__sub', 'data-rl-tour': 'counts' },
              loading
                ? '正在载入库索引…'
                : (projects.length
                  ? (snap
                    ? projectCount + ' 个课题 · ' + figureCount + ' 张图 · ' + refCount + ' 条文献 · ' + openSubs + ' 项在投 · ' + readyCount + ' 个就绪'
                    : projectCount + ' 个课题 · ' + readyCount + ' 个就绪')
                  : (error ? '科研库不可读：' + error : '库里还没有课题。'))),
            rootPath ? h('div', { key: 'r', className: 'rl-sub rl-path', 'data-rl-tour': 'root' }, '库根 ' + rootPath) : null,
          ]),
          h('div', { key: 'a', className: 'rl-page__acts' }, [
            h('button', { key: 'q', type: 'button', className: 'rl-btn rl-btn-primary', onClick: function () { openQuick('add-ref'); } }, '快速登记'),
            h('button', { key: 'n', type: 'button', className: 'rl-btn', onClick: function () { setShowCreate(true); } }, '新建课题'),
            h('button', { key: 'i', type: 'button', className: 'rl-btn', 'data-rl-tour': 'import', onClick: function () { if (onImport) onImport(); } }, '导入数据'),
            h('button', { key: 'r', type: 'button', className: 'rl-btn rl-btn--quiet', title: '重新读一遍库（面板不后台轮询）', onClick: load }, '刷新'),
            h('button', {
              key: 'u', type: 'button', className: 'rl-btn rl-btn--quiet', disabled: checking,
              title: '去 GitHub 看一眼有没有新版本',
              onClick: function () { checkUpdate(true); },
            }, checking ? '检查中…' : '检查更新'),
          ]),
        ]),
        // 筛选中：说清「命中多少」，不然列表变短了用户不知道为什么（顺手给清空）。
        filtering ? h('div', { key: 'q', className: 'rl-row', style: { marginBottom: '8px' } }, [
          h('span', { key: 't', className: 'rl-sub' },
            '筛选「' + q.trim() + '」：命中 ' + shownProjects.length + ' 个课题、' + shownTodos.length + ' 条待办、'
            + healthList.length + ' 项体检'),
          onClearQ ? Btn({ key: 'c', onClick: onClearQ }, '清空筛选') : null,
        ]) : null,
        error ? h('div', { key: 'e', className: 'rl-err' }, error) : null,
        message ? h('div', { key: 'm', className: 'rl-ok' }, message) : null,
        // 首屏还没数据时给一句「正在载入」，比空白页更像话（也解释了为什么还没东西）。
        !snap && loading && !error ? h('div', { key: 'ld', className: 'rl-empty' }, '正在载入库索引…') : null,
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
        h('section', { key: 'todos', className: 'rl-section', 'data-rl-tour': 'todos' }, [
          h('div', { key: 'h', className: 'rl-section__head' }, [
            h('div', { key: 't', className: 'rl-section__title' }, '跨课题待办'),
          ]),
          h('div', { key: 'b', className: 'rl-table' }, shownTodos.length ? [
            h('div', { key: 'hd', className: 'rl-table__row rl-table__row--head' }, [
              h('span', { key: 'p' }, '课题 / 投稿'),
              h('span', { key: 's' }, '阶段 / 到期'),
              h('span', { key: 'w' }, '要做什么'),
              h('span', { key: 'a', className: 'rl-table__act' }, '操作'),
            ]),
          ].concat(shownTodos.map(function (t, i) {
            var label = '课题「' + t.title + '」在「' + (STAGE_LABEL[t.stage] || t.stage || '—') + '」阶段：'
              + (t.why || '') + '。请执行 ' + t.action + '（写动作先 plan 再 confirm）。';
            if (t.sub) {
              label = '投稿《' + t.title + '》：' + (t.why || '') + '。请执行 ' + t.action + '（写动作先 plan 再 confirm）。';
            }
            return h('div', { key: 'td' + i, className: 'rl-table__row' }, [
              h('span', { key: 'p', className: 'rl-table__proj' }, t.title),
              h('span', { key: 's' }, t.sub
                ? h('span', { key: 'g', className: 'rl-tag', 'data-tone': t.due < 0 ? 'err' : (t.due <= 3 ? 'warn' : '') }, dueText(t.due))
                : h('span', { key: 'g', className: 'rl-tag', 'data-tone': t.ready ? 'ok' : 'warn' }, STAGE_LABEL[t.stage] || t.stage || '—')),
              h('span', { key: 'w', className: 'rl-sub' }, [
                (t.why || '待处理') + '（',
                h('span', { key: 'c', className: 'rl-code' }, t.action),
                '）',
              ]),
              h('span', { key: 'a', className: 'rl-table__act' }, [
                t.slug ? Btn({ key: 'g', onClick: function () { focusProject(t.slug); } }, '看课题') : null,
                Btn({ key: 'a', onClick: function () { sendToAi(label); } }, '生成指令'),
              ]),
            ]);
          })) : [h('div', { key: 'x', className: 'rl-table__empty' },
            filtering ? '筛选下没有匹配的待办。' : '没有待办：各课题的阶段检查项都过了。')]),
        ]),
        h('div', { key: 'grid', className: 'rl-wb__grid' }, [
          h('div', { key: 'l', className: 'rl-wb__list' }, shownProjects.length
            ? shownProjects.map(function (p) {
              var blocked = p.next && p.next.blockers ? p.next.blockers.length : 0;
              return h('button', {
                key: p.slug, type: 'button', className: 'rl-wb__row', 'data-active': p.slug === sel ? '1' : '0',
                onClick: function () { focusProject(p.slug); },
              }, [
                h('div', { key: 't', className: 'rl-wb__rowTitle' }, p.title || p.slug),
                h('div', { key: 's', className: 'rl-sub' },
                  (STAGE_LABEL[p.stage] || p.stage || '—')
                  + (p.needsSchemaUpgrade ? ' · 旧库待迁移' : '')
                  + (p.next && p.next.ready ? ' · 就绪' : (blocked ? ' · ' + blocked + ' 项阻塞' : ''))),
              ]);
            })
            : h('div', { className: 'rl-empty' },
              filtering ? '没有匹配「' + q.trim() + '」的课题。' : '课题列表是空的。')),
          h('div', {
            key: 'r', ref: detailRef, className: 'rl-wb__detail', 'data-rl-tour': 'detail',
            'data-flash': flashAt ? '1' : '0', 'data-proj': curId || '',
          }, current ? [
            h('div', { key: 't', className: 'rl-wb__title' }, current.title || curId),
            h(StageBar, {
              key: 'st', stage: stage,
              onPick: function (target) {
                if (target === stage) return;
                var jump = Math.abs(stageIndex(target) - stageIndex(stage)) > 1;
                ask('project.stage.set', { project: curId, stage: target, force: jump, note: '面板手动选择阶段' });
              },
            }),
            ((detail && detail.needsMigration) || current.needsSchemaUpgrade)
              ? h('div', { key: 'mg', className: 'rl-warnbox' }, [
                h('div', { key: 't' }, '这个课题还是旧库形状，写动作会被拒绝。'),
                h('button', {
                  key: 'b', type: 'button', className: 'rl-btn rl-btn--primary',
                  onClick: function () { ask('system.migrate', {}); },
                }, '生成迁移计划'),
              ])
              : null,
            chips,
            h('div', { key: 'todo' }, [
              h('div', { key: 'h', className: 'rl-sub' }, next && next.ready ? '下一步' : '待办 / 阻塞'),
              h('ul', { key: 'ul', className: 'rl-list' },
                ((next && next.todo) || []).map(function (t, i) {
                  return h('li', { key: 't' + i }, [
                    h('span', { key: 's' }, (t.why || '') + '（' + t.action + '）'),
                    Btn({
                      key: 'a',
                      onClick: function () {
                        sendToAi('课题「' + (current.title || curId) + '」在「' + (STAGE_LABEL[stage] || stage || '—')
                          + '」阶段：' + (t.why || '') + '。请执行 ' + t.action + '（写动作先 plan 再 confirm）。');
                      },
                    }, '生成指令'),
                  ]);
                }).concat(((next && next.blockers) || []).map(function (b, i) {
                  return h('li', { key: 'b' + i, className: 'rl-warn' }, (b.why || '') + (b.hint ? '：' + b.hint : ''));
                })).concat(
                  next && ((next.todo || []).length + (next.blockers || []).length) === 0
                    ? [h('li', { key: 'ok' }, '这一阶段没有阻塞。')] : [],
                )),
              h('div', { key: 'a', className: 'rl-wb__actions' }, [
                advance
                  ? h('button', {
                    key: 'n', type: 'button', className: 'rl-btn rl-btn--primary',
                    onClick: function () { ask('project.stage.set', { project: curId, stage: advance }); },
                  }, '推进到「' + STAGE_LABEL[advance] + '」')
                  : null,
              ]),
            ]),
            // 数据血缘：哪些数据文件被哪些图用过、哪些没用上、哪些图指向的源数据已经不在了。
            // 全部从快照里现算，不发新请求。注意要用快照里那份（带 figures/datasets 的），
            // project.get 回来的那份只有计数。
            h(Lineage, {
              key: 'lin',
              project: Object.assign({}, current, (snap && snap.projects || []).filter(function (x) { return x.slug === curId; })[0] || {}),
            }),
            // 最近动态：原先是首页一张卡片；现在只在选中的课题里出现，且只列这个课题的。
            (function () {
              var mineRec = recents.filter(function (r) { return r.p === curId; }).slice(0, 4);
              if (!mineRec.length) return null;
              return h('div', { key: 'recent' }, [
                h('div', { key: 'h', className: 'rl-sub' }, '这个课题的近期变动'),
                h('ul', { key: 'ul', className: 'rl-list' }, mineRec.map(function (r, i) {
                  return h('li', { key: i }, fmtTime(r.at) + ' · ' + r.text);
                })),
              ]);
            })(),
          ] : h('div', { key: 'empty', className: 'rl-empty' }, '选一个课题，看它的阶段、检查项与下一步。')),
        ]),
        // 可复现性审计：只读检查（侧车缺参数、源数据对不上、图文件缺失、草稿引用找不到）。
        // 不自动跑——它要读全库，跟着首屏一起跑会把每次打开都拖慢。
        h(Audit, { key: 'audit', call: call }),
        h('div', { key: 'rec', className: 'rl-wb__rec' }, [
          h('div', { key: 'h', className: 'rl-wb__recLine' }, [
            h('div', { key: 't', className: 'rl-sub' }, '最近回执'),
            h('div', { key: 'a', className: 'rl-actions' }, [
              h('span', { key: 'b', className: 'rl-sub' },
                lastBackup ? '上次备份：' + fmtTime(lastBackup.startedAt) : '还没有备份记录'),
              Btn({ key: 'k', onClick: function () { ask('system.backup', {}); }, disabled: busy }, '现在备份'),
            ]),
          ]),
          receipts.length
            ? h('ul', { key: 'ul', className: 'rl-list' }, receipts.map(function (r, i) {
              return h('li', { key: i, className: 'rl-mono' },
                fmtTime(r.startedAt) + ' · ' + (r.action || '—') + (r.ok === false ? ' · 失败' : '') + (r.wrote && r.wrote.length ? ' · 写 ' + r.wrote.length : ''));
            }))
            : h('div', { key: 'e', className: 'rl-sub' }, '还没有回执；写动作后会记一行 .research/receipts/。'),
        ]),
        // 库级提示：摆在页面末尾，不占首屏；干净时一行都不占。
        notices.length ? h('ul', { key: 'health', className: 'rl-warns' }, notices.map(function (t, i) {
          return h('li', { key: 'h' + i }, t);
        })) : null,
        // 版本行：先只报本地版本，检查过才报有没有新版（离线也不吵）。
        update ? h('div', { key: 'ver', className: 'rl-wb__rec rl-wb__recLine' }, [
          h('span', { key: 't', className: 'rl-sub' },
            '插件 v' + String((update.plugin && update.plugin.version) || '?') + ' · ' + String(update.hint || '')),
          update.updateAvailable && update.canSelfUpdate === true && !busy
            ? Btn({ key: 'go', onClick: function () { ask('system.update_apply', {}); } },
              '更新到 v' + String((update.remote && update.remote.version) || ''))
            : null,
        ]) : null,
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
        // 主标页签只留常用的这几个，其余收进「更多」。
        var allTabs = tabsFor(uiVer);
        var PRIMARY_TAB_IDS = uiVer === 'v2'
          ? ['workbench', 'figures', 'assets', 'drafts', 'refs', 'notes']
          : ['figures', 'assets', 'drafts', 'refs', 'notes'];
        var MORE_TAB_IDS = allTabs.map(function (t) { return t.id; }).filter(function (id) {
          return PRIMARY_TAB_IDS.indexOf(id) < 0;
        });
        var viewAnimState = React.useState(0);
        var viewAnim = viewAnimState[0], setViewAnim = viewAnimState[1];
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
        // 圈选问模型的悬浮窗：null = 关着；{ project, figureId } = 开着。
        var figOverState = React.useState(null);
        var figOver = figOverState[0], setFigOver = figOverState[1];
        var openFigOver = function (project, figureId) {
          setFigOver({ project: project || '', figureId: figureId || '' });
        };
        // Alt+Q 是这只浮层的全局开关。图卡里那个内联的圈选自己也在听这个键，
        // 所以「页面上已经有展开的图卡」时让给它，别两个人一起响应。
        React.useEffect(function () {
          if (typeof window === 'undefined' || !window.addEventListener) return undefined;
          function onKey(e) {
            if (!(e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'q' || e.key === 'Q'))) return;
            e.preventDefault();
            // 浮层开着或图卡里已有圈选区时，交给它们自己响应（浮层里 Alt+Q 是切圈选模式）。
            if (figOver) return;
            var inline = typeof document !== 'undefined' ? document.querySelector('.rl-figchat') : null;
            if (inline) return;
            setFigOver({ project: '', figureId: '' });
          }
          window.addEventListener('keydown', onKey);
          return function () { window.removeEventListener('keydown', onKey); };
        }, [figOver]);
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
          // 切页签时重放一次淡入：靠交替 animation-name 触发，不 remount（免得丢掉工作台里选中的课题）。
          setViewAnim(function (n) { return n + 1; });
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

        /**
         * 工作台里点「本课题产物」：跳到 v1 的对应页签，并把筛选词钉成这个课题的 slug。
         * 图/草稿/数据的路径里都含 slug，所以 v1 那边自然只剩这个课题的条目。
         * 这里**不写**版本偏好（UI_VERSION_KEY）：这是一次下钻看产物，不是改用户的默认视图；
         * 想留在 v1，点一下右上角的「列表面板」就行。
         */
        function openArtifactTab(id, needle) {
          setQ(needle || '');
          setLastV1Tab(id);
          setUiVer('v1');
          setTab(id);
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
            // v2 的页头在 Workbench 内，shell 头隐藏；库级提示由 Workbench 自己在待办表下方报（不占页顶）。
            return h('div', null, [
              h(Workbench, {
                key: 'wb',
                call: call,
                root: rootPath,
                q: q,
                onClearQ: function () { setQ(''); },
                onOpenTab: openArtifactTab,
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
                      open ? (mine.length ? mine.map(function (f) { return h(FigureCard, { key: f.sidecar, fig: f, call: call, ctx: ctx, project: p.slug, onReload: refresh }); })
                        : h('div', { key: 'e', className: 'rl-group__empty' }, '这个文件夹还是空的。')) : null,
                    ]);
                  })
                  : p.figures.map(function (f) { return h(FigureCard, { key: f.sidecar, fig: f, call: call, ctx: ctx, project: p.slug, onReload: refresh }); }))
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
          if (tab === 'notes') {
            return h(NotesPanel, { key: 'notes', call: call, ctx: ctx, snap: snap, q: q });
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
          h('div', { key: 'tabs', className: 'rl-tabs', 'data-rl-tour': 'tabs' }, [
            /*
             * 页签分两档：主标只放每天要用的（工作台 / 图表 / 数据 / 草稿 / 文献 / 笔记），
             * 期刊档案 / 投稿 / 归档 与两个开关（版本、命令台、引导）收进「更多」。
             * 11 个页签平铺在一行上，找东西比收起更慢。
             */
            h('div', { key: 'nav', className: 'rl-nav' }, PRIMARY_TAB_IDS.reduce(function (acc, id) {
              var t = allTabs.filter(function (x) { return x.id === id; })[0];
              if (!t) return acc;
              acc.push(h('button', {
                key: t.id, type: 'button', className: 'rl-tab', 'data-active': tab === t.id ? '1' : '0',
                'data-rl-tour': 'tab:' + t.id,
                onClick: function () { pickTab(t.id); },
              }, t.label));
              return acc;
            }, [])),
            h('div', { key: 'tools', className: 'rl-tools' }, [
              h('button', {
                key: 'figover', type: 'button', className: 'rl-btn rl-btn--quiet',
                title: '圈选问模型（Alt+Q）',
                onClick: function () { openFigOver('', ''); },
              }, '圈选问模型'),
              h('div', { key: 'more', className: 'rl-more' }, [
                h('button', {
                  key: 'b', type: 'button', className: 'rl-tab',
                  'data-active': MORE_TAB_IDS.indexOf(tab) >= 0 ? '1' : '0',
                  'aria-haspopup': 'true',
                }, '更多'),
                h('div', { key: 'm', className: 'rl-more__menu', role: 'menu' }, MORE_TAB_IDS.reduce(function (acc, id) {
                  var t = allTabs.filter(function (x) { return x.id === id; })[0];
                  if (!t) return acc;
                  acc.push(h('button', {
                    key: t.id, type: 'button', role: 'menuitem', className: 'rl-tab', 'data-active': tab === t.id ? '1' : '0',
                    'data-rl-tour': 'tab:' + t.id,
                    onClick: function () { pickTab(t.id); },
                  }, t.label));
                  return acc;
                }, []).concat([
                  h('button', {
                    key: 'ver', type: 'button', role: 'menuitem', className: 'rl-tab',
                    title: uiVer === 'v2' ? '按页签浏览：图表 / 数据 / 草稿 / 文献 / 期刊 / 投稿 / 归档' : '工作台：页头、跨课题待办与课题详情',
                    onClick: function () { switchVer(uiVer === 'v2' ? 'v1' : 'v2'); },
                  }, uiVer === 'v2' ? '列表面板' : '工作台'),
                  h('button', { key: 'c', type: 'button', role: 'menuitem', className: 'rl-tab', onClick: openConsole }, '命令台'),
                  h('button', { key: 'g', type: 'button', role: 'menuitem', className: 'rl-tab', onClick: function () { startTour(0); } }, '引导'),
                ])),
              ]),
              h('input', {
                key: 'q', className: 'rl-tool rl-search',
                value: q,
                // 两个版本的筛选对象不一样：v2 筛的是工作台的待办与课题，v1 筛的是当前页签的列表。
                placeholder: uiVer === 'v2' ? '筛选课题 / 待办 / 体检项' : '筛选这一页（课题 / 图 / 草稿 / 文献 / 档案）',
                'aria-label': '筛选',
                onChange: function (e) { setQ(e.target.value); },
              }),
              q ? h('button', {
                key: 'qc', type: 'button', className: 'rl-btn rl-btn--quiet',
                onClick: function () { setQ(''); },
              }, '清空筛选') : null,
            ]),
          ]),
          h('div', { key: 'body', className: 'rl-body', 'data-rl-tour': 'body' },
            welcome
              ? h(WelcomeCard, {
                root: rootPath,
                onTour: function () { startTour(0); },
                onDismiss: dismissWelcome,
              })
              : h('div', { key: 'view', className: 'rl-view', 'data-anim': viewAnim % 2 ? 'a' : 'b' }, body())),
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
          figOver
            ? h(FigureOverlay, {
              key: 'figover', ctx: ctx, call: call, snap: snap || {},
              project: figOver.project, figureId: figOver.figureId,
              onClose: function () { setFigOver(null); },
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
      isEmptyProject: isEmptyProject,
      filterSnap: filterSnap,
      makeHit: makeHit,
      UI_VERSION_KEY: UI_VERSION_KEY,
      tabsFor: tabsFor,
      paletteSearch: paletteSearch,
      WORKBENCH_VIEWS: WORKBENCH_VIEWS,
      STAGE_ORDER: STAGE_ORDER,
      Workbench: Workbench,
      DraftCard: DraftCard,
      guessTarget: guessTarget,
      figureEntry: figureEntry,
      withHostHint: withHostHint,
      confirmPlan: confirmPlan,
      NotesPanel: NotesPanel,
    };
    return module.exports;
  },
});

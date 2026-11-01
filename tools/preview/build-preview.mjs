#!/usr/bin/env node
/*
 * 科研库面板 · 浏览器预览 + 截图脚手架
 * ===========================================================================
 * 一条命令：
 *   node tools/preview/build-preview.mjs
 *
 * 它做四件事，没有第三方依赖（只用 Node 内置模块 + 本机 chromium）：
 *   1. 生成一张真 XRD 谱图 PNG，当图卡的缩略图（不然后台是个 1×1 白点）；
 *   2. 生成 tools/preview/out/preview.html —— 一个只装了「假宿主」的页面，
 *      真样式、真 bundle（<script src="../../../lib/client.js">）；
 *   3. 用 CDP 拉起 headless chromium，逐场景点进去、等异步收敛、截图；
 *   4. 把每张图的探针数据（弹层有没有盖满视口、确认按钮在不在视口里、
 *      对话区滚了多少）写进 out/summary.json，供后续审查对账。
 *
 * 常用参数：
 *   --out <目录>          截图输出目录（默认 E:\Temp\preview）
 *   --only a,b,c          只跑指定场景
 *   --size 1440x1200      视口（默认 1440×1200）
 *   --no-shot             只生成 html，不截图
 *   --keep-profile        保留 chromium profile（复现问题用）
 *   --chrome <exe>        指定 chrome 可执行文件
 *
 * 安全边界：只读 lib/，不碰 .dsh/sciwork 数据，不联网。
 */

import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import net from 'node:net';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUT = join(HERE, 'out');
const CLIENT = join(REPO, 'lib', 'client.js');

/* -------------------------------------------------------------- 命令行 */

function parseArgs(argv) {
  const opts = { out: 'E:\\Temp\\preview', only: null, size: [1440, 1200], shot: true, keepProfile: false, chrome: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--only') opts.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--size') {
      const m = /^(\d+)x(\d+)$/.exec(String(argv[++i] || ''));
      if (m) opts.size = [Number(m[1]), Number(m[2])];
    } else if (a === '--no-shot') opts.shot = false;
    else if (a === '--keep-profile') opts.keepProfile = true;
    else if (a === '--chrome') opts.chrome = argv[++i];
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error(`不认识的参数：${a}`); printHelp(); process.exit(2); }
  }
  return opts;
}

function printHelp() {
  console.log([
    '用法：node tools/preview/build-preview.mjs [选项]',
    '  --out <目录>      截图输出目录（默认 E:\\Temp\\preview）',
    '  --only a,b,c      只跑指定场景（workbench/project/figures/drafts/notes/settings/chat/chat-confirm）',
    '  --size 1440x1200  视口大小',
    '  --no-shot         只生成 out/preview.html',
    '  --keep-profile    保留 chromium profile 目录',
    '  --chrome <exe>    指定 chrome 可执行文件',
  ].join('\n'));
}

/* ------------------------------------------------------- chromium 定位 */

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Users\\ymy\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe',
  'C:\\Users\\ymy\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

function findChrome(explicit) {
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`--chrome 给的路径不存在：${explicit}`);
    return explicit;
  }
  for (const c of CHROME_CANDIDATES) if (c && existsSync(c)) return c;
  throw new Error([
    '没找到 chromium/chrome。用 --chrome <exe> 指定，或设环境变量 CHROME_PATH。',
    '找过的路径：',
    ...CHROME_CANDIDATES.filter(Boolean).map((c) => '  ' + c),
  ].join('\n'));
}

/* --------------------------------------------------------- PNG 编码器 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** 8 位 RGB、无隔行的最小 PNG 编码。 */
function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type: RGB
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filter
  ihdr[12] = 0;  // no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ----------------------------------------------------- 夹具用的谱图 PNG */
/* 画一张 8×6 cm 的 XRD 谱：两条曲线（60% RH 与干燥对照）、一根参考竖线、
   浅灰网格，和预览里那 6 条对话讲的是同一张图。 */

function makeXrdPng() {
  const W = 880;
  const H = 660;
  const rgb = Buffer.alloc(W * H * 3, 0xff);
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 3;
    rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
  };
  const line = (x0, y0, x1, y1, r, g, b, w = 1) => {
    const steps = Math.max(1, Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    for (let i = 0; i <= steps; i += 1) {
      const x = Math.round(x0 + ((x1 - x0) * i) / steps);
      const y = Math.round(y0 + ((y1 - y0) * i) / steps);
      for (let dx = 0; dx < w; dx += 1) for (let dy = 0; dy < w; dy += 1) put(x + dx, y + dy, r, g, b);
    }
  };

  const L = 92, R = W - 44, T = 46, B = H - 84;
  const xMin = 5, xMax = 60;            // 2θ
  const toX = (deg) => L + ((deg - xMin) / (xMax - xMin)) * (R - L);

  // 网格（每 5°，浅灰）
  for (let d = 5; d <= 60; d += 5) {
    const x = Math.round(toX(d));
    for (let y = T; y <= B; y += 1) if (y % 4 < 2) put(x, y, 0xee, 0xf0, 0xf3);
  }
  for (let i = 0; i <= 4; i += 1) {
    const y = Math.round(B - ((B - T) * i) / 4);
    for (let x = L; x <= R; x += 1) if (x % 4 < 2) put(x, y, 0xee, 0xf0, 0xf3);
  }

  const gauss = (x, mu, sig, amp) => { const d = (x - mu) / sig; return amp * Math.exp(-0.5 * d * d); };
  const peaks = [
    [14.1, 0.55, 1.0], [28.4, 0.62, 0.19], [31.7, 0.7, 0.12],
    [40.7, 0.8, 0.07], [43.3, 0.8, 0.05], [52.1, 1.0, 0.04],
  ];
  const base = (x) => 0.06 + (x - xMin) * 0.0022;
  const intensity = (x, scale, shift) => {
    let v = base(x);
    for (const [mu, sig, amp] of peaks) v += gauss(x, mu + (shift || 0), sig, amp * scale);
    return v;
  };
  const curve = (scale, shift, r, g, b, dash) => {
    let prev = null;
    for (let px = L; px <= R; px += 1) {
      const x = xMin + ((px - L) / (R - L)) * (xMax - xMin);
      const v = Math.min(1.02, intensity(x, scale, shift));
      const y = Math.round(B - v * (B - T) * 0.92);
      if (dash && (px >> 1) % 2 === 1) { prev = y; continue; }
      if (prev !== null) line(px - 1, prev, px, y, r, g, b, dash ? 1 : 2);
      else put(px, y, r, g, b);
      prev = y;
    }
  };
  curve(0.955, 0.06, 0x9a, 0xa0, 0xa8, true);   // 干燥对照：细虚线、灰
  curve(1.0, 0, 0x23, 0x26, 0x2b, false);        // 60% RH：粗实线、深

  // 参考竖线（对话里提到「图上的竖线是我加的」）
  const refX = Math.round(toX(14.1));
  for (let y = T; y <= B; y += 1) if (y % 6 < 3) put(refX, y, 0xb9, 0xc2, 0xcf);

  // 坐标轴
  line(L, T, L, B, 0x2f, 0x33, 0x38, 2);
  line(L, B, R, B, 0x2f, 0x33, 0x38, 2);
  for (let d = 5; d <= 60; d += 5) {
    const x = Math.round(toX(d));
    line(x, B, x, B + 6, 0x2f, 0x33, 0x38, 1);
  }
  for (let i = 0; i <= 4; i += 1) {
    const y = Math.round(B - ((B - T) * i) / 4);
    line(L - 6, y, L, y, 0x2f, 0x33, 0x38, 1);
  }
  return encodePng(W, H, rgb);
}

/* ----------------------------------------------------------- 预览页 HTML */

function buildHtml(imgBase64) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>dsh-sciwork · 面板预览</title>
<style>
  /* 宿主壳：只负责给面板一个 100% 高的容器和浅色 color-scheme。
     面板自己的 --rl-* token 都在 .rl-root 里，这里不重复定义。 */
  :root { color-scheme: light; }
  html, body { margin: 0; height: 100%; background: #f9fafb; }
  body { color-scheme: light; }
  #panel-root { height: 100%; }
  #boot-err { padding: 16px; font: 14px/1.6 "Microsoft YaHei", system-ui, sans-serif; color: #b3362f; white-space: pre-wrap; }
</style>
<script>window.__FIXTURE_IMG_BASE64 = ${JSON.stringify(imgBase64)};</script>
<script>
  /* 面板真正的入口是 AMD bundle 的加载回调：捕获它，不加载真宿主。 */
  window.__ModuleLoader__ = { load: function (spec) { window.__captured = spec; } };
</script>
<script src="../../../lib/client.js"></script>
<script src="../preview-runtime.js"></script>
</head>
<body>
<div id="panel-root"></div>
<div id="boot-err" hidden></div>
</body>
</html>
`;
}

/* ------------------------------------------------------------- 场景表 */

const SCENARIOS = [
  { id: 'workbench', file: '01-workbench.png', note: '首页（工作台）：页头四个动作、跨课题待办、左列课题、右列详情空态' },
  { id: 'project', file: '02-project.png', note: '课题页：工作台选中一个课题后的右栏详情（阶段条、待办、溯源、体检、回执）' },
  { id: 'figures', file: '03-figures.png', note: '图页：展开的图卡，左图右对话区，缩略图是真谱图' },
  { id: 'drafts', file: '04-drafts.png', note: '草稿页：展开预览一张 results.md' },
  { id: 'notes', file: '05-notes.png', note: '笔记页：左列表 + 右笔记正文' },
  { id: 'settings', file: '06-settings.png', note: '设置弹层：左侧分节、右侧模型/本地数据' },
  { id: 'chat', file: '07-chat-6-turns.png', note: '图卡对话展开全部 6 条历史（重点：长对话把卡片撑成什么样）' },
  { id: 'chat-confirm', file: '08-chat-save-confirm.png', note: '6 条对话 + 点「存进笔记」后的确认弹层（重点：弹层有没有被挤/被裁）' },
];

/* ------------------------------------------------------------- CDP 客户端 */

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
      if (!msg || typeof msg.id !== 'number') return;
      const slot = this.pending.get(msg.id);
      if (!slot) return;
      this.pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(`${msg.error.message}（code ${msg.error.code}）`));
      else slot.resolve(msg.result);
    });
    ws.addEventListener('close', () => {
      for (const slot of this.pending.values()) slot.reject(new Error('CDP 连接被关闭'));
      this.pending.clear();
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`CDP 连接超时：${url}`)), 8000);
      ws.addEventListener('open', () => { clearTimeout(t); res(); });
      ws.addEventListener('error', () => { clearTimeout(t); rej(new Error(`CDP 连接失败：${url}`)); });
    });
    return new CDP(ws);
  }

  send(method, params = {}) {
    const id = (this.seq += 1);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { try { this.ws.close(); } catch { /* 已经关了 */ } }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolvePort(p));
    });
  });
}

async function waitForDevtools(port, timeoutMs = 20000) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return await res.json();
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = String((e && e.message) || e);
    }
    await sleep(150);
  }
  throw new Error(`chromium 的 devtools 端口没起来（${last}）`);
}

async function pageSocket(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  const list = await res.json();
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) throw new Error('chromium 里没有可用的 page target');
  return page.webSocketDebuggerUrl;
}

/* ---------------------------------------------------------- 场景跑一遍 */

async function evaluate(cdp, expression, { awaitPromise = false } = {}) {
  const out = await cdp.send('Runtime.evaluate', {
    expression, awaitPromise, returnByValue: true, timeout: 30000,
  });
  if (out.exceptionDetails) {
    const d = out.exceptionDetails;
    throw new Error(`页面里求值抛错：${(d.exception && d.exception.description) || d.text}`);
  }
  return out.result && out.result.value;
}

async function runScenario(cdp, scenario, { url, width, height, outDir }) {
  const pageUrl = `${url}?scenario=${encodeURIComponent(scenario.id)}`;
  await cdp.send('Page.navigate', { url: pageUrl });

  // 等面板自己说 ready（异步 rpc + 多轮重渲染都在里面等掉了）
  const t0 = Date.now();
  let ready = false;
  let lastErr = '';
  while (Date.now() - t0 < 25000) {
    try {
      ready = await evaluate(cdp, 'Boolean(window.__preview && window.__preview.ready)');
      if (ready) break;
    } catch (e) {
      lastErr = String(e.message || e);
    }
    await sleep(120);
  }
  if (!ready) throw new Error(`场景 ${scenario.id} 没在 25s 内就绪${lastErr ? `（最后一次求值错误：${lastErr}）` : ''}`);

  await sleep(450); // 让 200ms 的入场动画与图片解码都过去，再量几何

  const probeRaw = await evaluate(cdp, 'JSON.stringify(window.__preview.refresh())');
  const probe = JSON.parse(probeRaw || '{}');
  const errRaw = await evaluate(cdp, 'JSON.stringify(window.__preview.errors)');
  const errors = JSON.parse(errRaw || '[]');
  const traceRaw = await evaluate(cdp, 'JSON.stringify(window.__preview.trace)');
  const trace = JSON.parse(traceRaw || '[]');
  const fatal = await evaluate(cdp, 'window.__preview.fatal || null');

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = join(outDir, scenario.file);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));

  return { id: scenario.id, file, note: scenario.note, probe, errors, trace, fatal, size: `${width}×${height}` };
}

/* ------------------------------------------------------------------ 主流程 */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [width, height] = opts.size;
  const outDir = resolve(opts.out);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  // 版本指纹：lib/client.js 可能正被别的会话改，报告里要能对上号
  const clientBytes = readFileSync(CLIENT);
  const clientSha = createHash('sha256').update(clientBytes).digest('hex');
  const clientLines = clientBytes.toString('utf8').split('\n').length;
  const gitInfo = (() => {
    try {
      const run = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
      return {
        head: run(['rev-parse', '--short', 'HEAD']),
        dirty: run(['status', '--porcelain', '--', 'lib/client.js']).length > 0,
        tag: (() => { try { return run(['describe', '--tags', '--always']); } catch { return ''; } })(),
      };
    } catch (e) {
      return { head: '', dirty: false, tag: '', error: String(e.message || e) };
    }
  })();

  const png = makeXrdPng();
  writeFileSync(join(OUT, 'fig1-xrd.png'), png);
  const htmlPath = join(OUT, 'preview.html');
  writeFileSync(htmlPath, buildHtml(png.toString('base64')));

  const plan = SCENARIOS.filter((s) => !opts.only || opts.only.includes(s.id));
  if (!plan.length) throw new Error(`--only 里没有认得的场景：${opts.only.join(', ')}`);

  console.log(`仓库      ${REPO}`);
  console.log(`面板      lib/client.js  ${clientLines} 行  sha256 ${clientSha.slice(0, 12)}…  HEAD ${gitInfo.head}${gitInfo.dirty ? '（有未提交改动）' : ''}`);
  console.log(`预览页    ${htmlPath}`);
  console.log(`夹具图    ${join(OUT, 'fig1-xrd.png')}`);
  console.log(`截图目录  ${outDir}`);
  console.log(`场景      ${plan.map((s) => s.id).join(', ')}`);

  if (!opts.shot) {
    console.log('\n--no-shot：只生成页面，没截图。打开上面的预览页即可。');
    return 0;
  }

  const chrome = findChrome(opts.chrome);
  console.log(`浏览器    ${chrome}`);
  const port = await freePort();
  // 每跑一次用一个新 profile：上一次的 chrome 若还没退干净，会锁着目录，
  // 复用固定名字只会得到 EPERM（本机实测），换名字则谁也挡不住谁。
  const stamp = `${process.pid}-${Date.now().toString(36)}`;
  const profile = join(OUT, `.chrome-profile-${stamp}`);
  mkdirSync(profile, { recursive: true });

  const child = spawn(chrome, [
    '--headless=new',
    // 本机（DSH 沙箱里）chromium 自己的沙箱起不来，裸跑会 exit 3 且没有输出
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--font-render-hinting=none',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-extensions',
    '--disable-component-update',
    '--disable-background-networking',
    '--allow-file-access-from-files',
    '--mute-audio',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let cdp = null;
  const results = [];
  let failed = 0;
  try {
    await waitForDevtools(port);
    cdp = await CDP.connect(await pageSocket(port));
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    });
    const url = pathToFileURL(htmlPath).href;

    for (const scenario of plan) {
      process.stdout.write(`  · ${scenario.id.padEnd(14)} … `);
      try {
        const r = await runScenario(cdp, scenario, { url, width, height, outDir });
        results.push(r);
        const p = r.probe || {};
        const bits = [];
        if (p.mask) bits.push(`弹层${p.maskCoversViewport ? '盖满视口' : '没盖满视口⚠'} 卡${p.card ? `${p.card.w}×${p.card.h}` : '—'}`);
        if (p.chat) bits.push(`对话 ${p.chat.turns} 条 区高 ${p.chat.clientH}/${p.chat.scrollH}`);
        if (r.errors && r.errors.length) bits.push(`${r.errors.length} 条运行时错误⚠`);
        if (r.fatal) bits.push(`致命：${r.fatal}`);
        console.log(`ok  ${scenario.file}  ${bits.join(' · ') || p.activeTab || ''}`);
      } catch (e) {
        failed += 1;
        results.push({ id: scenario.id, file: join(outDir, scenario.file), error: String(e.message || e) });
        console.log(`失败  ${String(e.message || e)}`);
      }
    }
  } finally {
    if (cdp) cdp.close();
    try { child.kill(); } catch { /* 已经退了 */ }
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch { /* 进程可能已经没了 */ }
    if (!opts.keepProfile) {
      await sleep(200);
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* chrome 还占着，留到下次 */ }
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    repo: REPO,
    client: { path: CLIENT, lines: clientLines, sha256: clientSha },
    git: gitInfo,
    viewport: `${width}×${height}`,
    previewPage: htmlPath,
    screenshotDir: outDir,
    scenarios: results,
  };
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log(`\n汇总      ${join(OUT, 'summary.json')}`);
  if (opts.only) {
    console.log('注意：这次只跑了 ' + plan.length + ' 个场景，汇总里也只有它们；要全套报告，去掉 --only 再跑一次。');
  }
  for (const r of results) {
    if (r.error) console.log(`  ${r.id.padEnd(14)} 失败：${r.error}`);
    else console.log(`  ${r.id.padEnd(14)} ${r.file}`);
  }
  const allErrors = results.flatMap((r) => (r.errors || []).map((e) => `[${r.id}] ${e}`));
  if (allErrors.length) {
    console.log(`\n运行时错误 ${allErrors.length} 条：`);
    for (const e of allErrors.slice(0, 40)) console.log(`  ${e}`);
  }
  return failed ? 1 : 0;
}

main()
  .then((code) => process.exit(code || 0))
  .catch((e) => {
    console.error(`\n失败：${e.message || e}`);
    if (e && e.stack) console.error(String(e.stack).split('\n').slice(1, 5).join('\n'));
    process.exit(1);
  });

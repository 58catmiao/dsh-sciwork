// _cdp-text.mjs —— 用无头 Edge + CDP 打开一个真实浏览器页面，导出渲染后的 innerText 与 outerHTML
// 用法： node _cdp-text.mjs <url> <out.txt> [--wait=9000] [--port=9444] [--scroll=1]
// 为什么需要它：本机 PowerShell 直连被 Cloudflare / Incapsula 挡（403）或拿到 JS 空壳；
// 真实浏览器能过 WAF 并把 SPA 渲染出来。每次都换新的 user-data-dir（复用会接管旧实例）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const url = argv[0];
const out = argv[1];
if (!url || !out) {
  console.error('usage: node _cdp-text.mjs <url> <out.txt> [--wait=9000] [--port=9444] [--scroll=1]');
  process.exit(1);
}
const opt = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};
const waitMs = Number(opt('wait', 9000));
const port = Number(opt('port', 9444));
const doScroll = opt('scroll', '1') === '1';
const headful = opt('headful', '0') === '1';
const stealth = opt('stealth', '1') === '1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
// 浏览器可执行文件：SCIWORK_BROWSER 覆盖 → 常见 Edge/Chrome 安装位 → PATH 上的命令。
function findBrowser() {
  const cands = [
    process.env.SCIWORK_BROWSER,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    'msedge',
    'google-chrome',
  ].filter(Boolean);
  for (const c of cands) {
    if (path.isAbsolute(c) ? fs.existsSync(c) : true) return c;
  }
  return 'msedge';
}
const edge = findBrowser();
const ud = path.join(process.env.SCIWORK_SCRATCH || os.tmpdir(), `sciwork-edge-cdp-${Date.now()}`);
fs.mkdirSync(ud, { recursive: true });

const child = spawn(
  edge,
  [
    ...(headful ? [] : ['--headless=new']),
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    ...(stealth ? [
      '--disable-blink-features=AutomationControlled',
      '--lang=en-US,en',
      `--user-agent=${UA}`,
      '--window-size=1920,1080',
    ] : ['--window-size=1400,1000']),
    `--user-data-dir=${ud}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target = null;
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`);
    const list = await r.json();
    target = list.find((t) => t.type === 'page' && String(t.url).startsWith('http')) || list.find((t) => t.type === 'page');
    if (target?.webSocketDebuggerUrl) break;
  } catch {}
  await sleep(500);
}
if (!target?.webSocketDebuggerUrl) {
  console.error('CDP: no debuggable page target');
  child.kill();
  process.exit(2);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  let m;
  try { m = JSON.parse(ev.data); } catch { return; }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res) => pending.set(id, res));
};
const evaluate = async (expr) => {
  const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (m?.result?.exceptionDetails) return { error: m.result.exceptionDetails.text };
  return { value: m?.result?.result?.value };
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await sleep(waitMs);
// 若疑似被 WAF 挑战页挡住（正文极短），重载再等：挑战通过后会自行跳转
const reloadIfChallenged = opt('reload', '1') === '1';
if (reloadIfChallenged) {
  for (let i = 0; i < 2; i++) {
    const probe = await evaluate('document.body ? document.body.innerText.length : 0');
    if ((probe.value ?? 0) >= 400) break;
    console.error(`CDP: body too small (${probe.value ?? 0} chars) → reload #${i + 1}`);
    await evaluate('location.reload(); 1');
    await sleep(Math.max(waitMs, 15000));
  }
}
if (doScroll) {
  // 懒加载内容：滚到底再回顶
  for (let i = 0; i < 8; i++) {
    await evaluate('window.scrollBy(0, Math.round(window.innerHeight*0.9)); 1');
    await sleep(600);
  }
  await evaluate('window.scrollTo(0,0); 1');
  await sleep(800);
}

const title = await evaluate('document.title');
const text = await evaluate('document.body ? document.body.innerText : ""');
const html = await evaluate('document.documentElement ? document.documentElement.outerHTML : ""');
const links = await evaluate(
  'Array.from(document.querySelectorAll("a[href]")).map(a=>a.href+"\\t"+(a.textContent||"").trim().replace(/\\s+/g," ")).filter((v,i,s)=>s.indexOf(v)===i).join("\\n")',
);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, (text.value ?? '') + '\n', 'utf8');
fs.writeFileSync(out.replace(/\.txt$/i, '.html'), html.value ?? '', 'utf8');
fs.writeFileSync(out.replace(/\.txt$/i, '.links.txt'), links.value ?? '', 'utf8');

console.log(JSON.stringify({
  url,
  title: title.value ?? '',
  textChars: (text.value ?? '').length,
  htmlChars: (html.value ?? '').length,
  links: (links.value ?? '').split('\n').filter(Boolean).length,
  wrote: [out, out.replace(/\.txt$/i, '.html'), out.replace(/\.txt$/i, '.links.txt')],
}, null, 2));

try { await send('Browser.close'); } catch {}
await sleep(500);
child.kill();
process.exit(0);

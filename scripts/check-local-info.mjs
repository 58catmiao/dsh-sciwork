#!/usr/bin/env node
/**
 * check-local-info.mjs —— 推送前扫一遍：仓库里有没有本机信息。
 *
 * 背景：这个仓库公开同步到 GitHub。工作区路径、用户名、主机名、真库位置、
 * 临时目录、本机软件安装目录，都可能被顺手写进文档、测试夹具或提交信息；
 * 一旦推上去，再删也只能删掉最新版本，历史里还留着（公开仓库可能已被 fork）。
 * 所以把「推送前扫一遍」做成门禁，而不是靠记性。
 *
 * 扫什么（默认）：
 *   1) git 跟踪的全部文本文件（`git ls-files`；含 NUL 的二进制跳过）
 *   2) 全部提交信息（`git log`，提交信息同样公开）
 *   加 `--history` 再扫历史 diff（能看出「曾经泄漏、后来删掉」的痕迹）。
 *
 * 什么算「本机信息」——运行时从环境读，不写死：
 *   家目录 / 用户名 / 主机名 / 临时目录 / 仓库路径 / 工作区（父目录）名 /
 *   `library/config.json` 与 `.research/config.json` 里的库根·解释器·启动器·
 *   Origin 插件目录 / `SCIWORK_LIBRARY`、`RESEARCH_LIBRARY`。
 *   每个标记再派生「正斜杠 / 反斜杠 / 源码里的双反斜杠」几种写法，大小写不敏感。
 *   不含路径分隔符的标记（用户名 / 主机名 / 工作区名）按**词边界**匹配，否则 `Temp`
 *   会把 `template` 全报成泄漏；工作区名是 `Temp`/`tmp`/`Users` 这类通用目录名时跳过。
 *   每次运行先跑一遍内置自检（几毫秒），挡住这类回归。
 *
 * 用法：
 *   node scripts/check-local-info.mjs              # 干净 0 / 有命中 1 / 跑不起来 2
 *   node scripts/check-local-info.mjs --history    # 连历史 diff 一起扫
 *   node scripts/check-local-info.mjs --quiet      # 只打命中
 *
 * 修法：把命中处换成占位符——`<仓库根>`、`<库根>`、`<系统临时目录>`、`<用户目录>`；
 * 需要举例就用跨平台写法（`~/...`、`%USERPROFILE%\...`）或相对路径。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGV = process.argv.slice(2);
const HISTORY = ARGV.includes('--history');
const QUIET = ARGV.includes('--quiet');

const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { dim: '', red: '', green: '', bold: '', off: '' };

function git(args, opts = {}) {
  const r = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 512,
    ...opts,
  });
  if (r.error) return { ok: false, out: '', err: r.error.message };
  if (r.status !== 0) {
    return { ok: false, out: r.stdout || '', err: (r.stderr || '').trim() || `git ${args[0] || ''} 退出 ${r.status}` };
  }
  return { ok: true, out: r.stdout || '', err: '' };
}

/* ---------------------------------------------------------------- 本机标记 */

const sources = [];
const addSource = (label, value) => {
  if (value === null || value === undefined) return;
  const v = String(value).trim();
  if (v.length >= 3) sources.push({ label, value: v });
};

addSource('家目录', os.homedir());
for (const k of ['USERPROFILE', 'HOME']) addSource('家目录', process.env[k]);
for (const k of ['USERNAME', 'USER', 'LOGNAME']) addSource('用户名', process.env[k]);
addSource('主机名', os.hostname());
for (const k of ['TEMP', 'TMP', 'TMPDIR']) addSource('临时目录', process.env[k]);
addSource('仓库路径', ROOT);
// 工作区名只在「像个工作区」时才当标记：克隆到系统临时目录里时，父目录名往往就是
// `Temp` / `tmp` / `Users`，拿它当针会把所有 `template` 都误报成泄漏。
const workspaceName = path.basename(path.dirname(ROOT));
if (!/^(temp|tmp|home|users|desktop|downloads|documents|projects|work|src|code|dev)$/i.test(workspaceName)) {
  addSource('工作区名', workspaceName);
}
for (const k of ['SCIWORK_LIBRARY', 'RESEARCH_LIBRARY']) addSource('库根', process.env[k]);

for (const rel of ['library/config.json', '.research/config.json']) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    continue;
  }
  addSource(`库根（${rel}）`, cfg.libraryRoot);
  addSource(`解释器（${rel}）`, cfg.interpreter);
  addSource(`启动器（${rel}）`, cfg.launcher);
  if (cfg.origin && typeof cfg.origin === 'object') {
    addSource(`Origin 插件目录（${rel}）`, cfg.origin.pluginDir);
    addSource(`Origin 服务（${rel}）`, cfg.origin.server);
  }
}

/** 同一个路径的几种写法：原样、正斜杠、反斜杠、源码字符串里的双反斜杠 */
function variants(value) {
  const out = new Set();
  const push = (s) => {
    if (s && s.length >= 3) out.add(s);
  };
  push(value);
  push(value.replace(/\\/g, '/'));
  push(value.replace(/\//g, '\\'));
  push(value.replace(/\\/g, '\\\\'));
  return [...out];
}

/** 小写针 → 标签；同一根针只留第一次出现的标签 */
const needles = new Map();
for (const { label, value } of sources) {
  for (const v of variants(value)) {
    const key = v.toLowerCase();
    if (!needles.has(key)) needles.set(key, label);
  }
}

/* ---------------------------------------------------------------- 扫描 */

const hits = [];
const seen = new Set();

/** 不含路径分隔符的针（用户名 / 主机名 / 工作区名）按词边界匹配。
 *  否则 `Temp` 会命中 `template`、短用户名会命中普通单词。 */
const isBare = (needle) => !/[\\/]/.test(needle);
const isWordChar = (ch) => !!ch && /[a-z0-9_]/.test(ch);

function matches(hay, needle) {
  if (!isBare(needle)) return hay.includes(needle);
  let i = hay.indexOf(needle);
  while (i !== -1) {
    if (!isWordChar(hay[i - 1]) && !isWordChar(hay[i + needle.length])) return true;
    i = hay.indexOf(needle, i + 1);
  }
  return false;
}

// 门禁自检：几毫秒，换掉「短标记误报」这类回归。
{
  const cases = [
    ['template', 'temp', false],
    ['E:/yourname/file', 'yourname', true],
    ['user yourname here', 'yourname', true],
    ['polyyournamex', 'yourname', false],
    ['/opt/library/data', '/opt/library', true],
  ];
  const bad = cases.filter(([hay, needle, want]) => matches(hay.toLowerCase(), needle) !== want);
  if (bad.length) {
    console.error(`${C.red}门禁自检失败：${bad.map(([h, n]) => `${n} vs ${h}`).join(' / ')}${C.off}`);
    process.exit(2);
  }
}

function scanLines(lines, wherePrefix) {
  for (let i = 0; i < lines.length; i += 1) {
    const lower = lines[i].toLowerCase();
    if (!lower) continue;
    for (const [needle, label] of needles) {
      if (!matches(lower, needle)) continue;
      const key = `${wherePrefix}:${i + 1}|${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ where: `${wherePrefix}:${i + 1}`, label, text: lines[i].trim().slice(0, 180) });
    }
  }
}

const listed = git(['ls-files', '-z']);
if (!listed.ok) {
  console.error(`${C.red}跑不起来：${listed.err || 'git ls-files 失败'}${C.off}`);
  process.exit(2);
}
const files = listed.out.split('\0').filter(Boolean);
let scannedFiles = 0;
for (const f of files) {
  let buf;
  try {
    buf = fs.readFileSync(path.join(ROOT, f));
  } catch {
    continue;
  }
  if (buf.includes(0)) continue; // 二进制
  scannedFiles += 1;
  scanLines(buf.toString('utf8').split('\n'), f);
}

const log = git(['log', '--all', '--format=%H%x00%B%x00']);
let commits = 0;
if (log.ok) {
  const parts = log.out.split('\0');
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const sha = (parts[i] || '').trim().split('\n').pop().trim();
    const body = parts[i + 1] || '';
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) continue;
    commits += 1;
    scanLines(body.split('\n'), `commit ${sha.slice(0, 7)}`);
  }
}

if (HISTORY) {
  const patch = git(['log', '--all', '-p', '--format=@@%h']);
  if (patch.ok) {
    scanLines(patch.out.split('\n'), 'history');
  }
}

/* ---------------------------------------------------------------- 输出 */

if (!QUIET) {
  console.log(`${C.bold}dsh-sciwork 本机信息扫描${C.off}  ${C.dim}（推送前门禁）${C.off}`);
  console.log(`  跟踪文件 ${scannedFiles} 个 · 提交信息 ${commits} 条${HISTORY ? ' · 含历史 diff' : ''} · 本机标记 ${needles.size} 个`);
  console.log(`  ${C.dim}标记来源：家目录 / 用户名 / 主机名 / 临时目录 / 仓库与工作区名 / 库根 / 解释器 / 启动器 / Origin 路径${C.off}\n`);
}

if (hits.length === 0) {
  if (!QUIET) console.log(`${C.green}干净：0 命中，可以推送。${C.off}`);
  process.exit(0);
}

console.log(`${C.red}✗ 命中 ${hits.length} 处本机信息${C.off}`);
for (const h of hits) {
  console.log(`  ${C.bold}${h.where}${C.off}  ${C.dim}[${h.label}]${C.off}  ${h.text}`);
}
if (!QUIET) {
  console.log(`\n${C.dim}修法：换成占位符——<仓库根> / <库根> / <系统临时目录> / <用户目录>；`);
  console.log(`提交信息里也别写本机路径（提交信息同样公开）。${C.off}`);
}
process.exit(1);

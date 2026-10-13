#!/usr/bin/env node
/**
 * pdf-text.mjs —— 从官方期刊 PDF 里抽文字（只读，不改 PDF）。
 *
 * 为什么存在：8 份 confidence=low 的期刊档案缺 dpi / 栏宽 mm / 最小字号 / 字数上限这类数值，
 * 本机所有联网通道都被 Cloudflare 403 或桥不可用挡住（见 journals/RETRIEVAL.md）。
 * 用户把官方 PDF 放进 journals/_sources/ 后，用这个脚本把文字抽出来，再由智能体
 * **只回填原文写了的数值**（宁缺勿猜），并标注来源 PDF 与抽取时间。
 *
 * 用法：
 *   node pdf-text.mjs <file.pdf> [--out <text.txt>] [--grep <正则>] [--pages 1-5] [--max 4000]
 *   node pdf-text.mjs --doctor            # 报 pdfjs-dist 是否可用
 *
 * 退出码：0 = 抽到文字；1 = 打不开 / 抽不到文字（扫描件没有文字层就走不通，需要 OCR）。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

// pdfjs-dist 不在本仓库里，按下面的顺序找（谁先存在用谁）；可用 PDFJS_PATH 覆盖。
// 除了当前目录，还看 DSH 的 profile 目录（~/.dsh/profiles/<name>/node_modules），
// 因为 DSH 插件通常把依赖装在那儿。
function pdfjsCandidates() {
  const out = [];
  if (process.env.PDFJS_PATH) out.push(process.env.PDFJS_PATH);
  const rel = [
    'node_modules/pdfjs-dist/legacy/build/pdf.mjs',
    'node_modules/pdfjs-dist/build/pdf.mjs',
  ];
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bases = [process.cwd(), path.resolve(here, '..', '..'), path.resolve(here, '..')];
  const profiles = path.join(os.homedir(), '.dsh', 'profiles');
  bases.push(profiles);
  try {
    for (const d of readdirSync(profiles, { withFileTypes: true })) {
      if (d.isDirectory()) bases.push(path.join(profiles, d.name));
    }
  } catch { /* 没有这个目录很正常 */ }
  for (const b of bases) for (const r of rel) out.push(path.join(b, r));
  return out;
}

function findPdfjs() {
  for (const p of pdfjsCandidates()) {
    if (existsSync(p)) return p;
  }
  return null;
}

function parseArgs(argv) {
  const out = { file: null, out: null, grep: null, pages: null, max: 4000, doctor: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--doctor') out.doctor = true;
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--grep') out.grep = argv[++i];
    else if (a === '--pages') out.pages = argv[++i];
    else if (a === '--max') out.max = Number(argv[++i]);
    else if (!out.file) out.file = a;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const pdfjsPath = findPdfjs();

if (args.doctor || !args.file) {
  console.log('pdfjs-dist :', pdfjsPath || '(未找到 —— 设 PDFJS_PATH 指向 legacy/build/pdf.mjs)');
  console.log('node       :', process.version);
  if (!args.file) {
    console.log('用法：node pdf-text.mjs <file.pdf> [--out <text.txt>] [--grep <正则>] [--pages 1-5]');
    process.exit(args.doctor ? 0 : 1);
  }
}
if (!pdfjsPath) {
  console.error('找不到 pdfjs-dist。装一个，或用 PDFJS_PATH 指向它的 legacy/build/pdf.mjs：');
  console.error('  npm i pdfjs-dist            # 在任意目录，然后把路径写进 PDFJS_PATH');
  process.exit(1);
}
if (!existsSync(args.file)) {
  console.error('PDF 不存在：' + args.file);
  process.exit(1);
}

const pdfjs = await import(pathToFileURL(pdfjsPath).href);
const bytes = new Uint8Array(readFileSync(args.file));
const doc = await pdfjs.getDocument({
  data: bytes,
  isEvalSupported: false,
  disableFontFace: true,
  useSystemFonts: false,
  verbosity: 0,
}).promise;

let lo = 1;
let hi = doc.numPages;
if (args.pages) {
  const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(args.pages.trim());
  if (m) {
    lo = Number(m[1]);
    hi = m[2] ? Number(m[2]) : lo;
  }
}
hi = Math.min(hi, doc.numPages);

const perPage = [];
for (let n = lo; n <= hi; n += 1) {
  const page = await doc.getPage(n);
  const tc = await page.getTextContent();
  let text = '';
  for (const item of tc.items) {
    if (typeof item.str !== 'string') continue;
    text += item.str;
    if (item.hasEOL) text += '\n';
    else if (!/\s$/.test(item.str)) text += ' ';   // 相邻 item 之间补空格，避免数字与单位黏成 "300dpi"
  }
  perPage.push({ page: n, text: text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() });
}

const whole = perPage.map((p) => `--- page ${p.page} ---\n${p.text}`).join('\n\n');
const letters = (whole.match(/[\p{L}\p{N}]/gu) || []).length;

console.log(`文件        : ${args.file}  (${statSync(args.file).size} B)`);
console.log(`pdfjs       : ${path.basename(pdfjsPath)}  ·  版本 ${pdfjs.version || '?'}`);
console.log(`页数        : ${doc.numPages}（本次抽 ${lo}-${hi}）`);
console.log(`抽取字符    : ${whole.length}  ·  字母数字 ${letters}`);

const info = doc.getMetadata ? await doc.getMetadata().catch(() => null) : null;
if (info && info.info) {
  console.log(`标题/作者   : ${info.info.Title || '-'} / ${info.info.Author || '-'}`);
  console.log(`生成器      : ${info.info.Producer || '-'}`);
}

if (args.grep) {
  const re = new RegExp(args.grep, 'iu');
  console.log(`\n=== --grep ${args.grep} 命中 ===`);
  let hits = 0;
  for (const p of perPage) {
    const lines = p.text.split(/\n|(?<=[.;])\s{2,}/);
    for (const line of lines) {
      if (re.test(line)) {
        hits += 1;
        console.log(`p${p.page}: ${line.trim().slice(0, 220)}`);
      }
    }
  }
  console.log(`命中 ${hits} 行`);
}

if (args.out) {
  writeFileSync(args.out, whole, 'utf8');
  console.log(`\n已写出      : ${args.out}`);
} else {
  console.log('\n=== 正文前 ' + args.max + ' 字 ===');
  console.log(whole.slice(0, args.max));
}

if (letters < 50) {
  console.error('\n⚠ 几乎抽不到文字（字母数字 < 50）。两种常见原因：');
  console.error('   a) 扫描件：整页是图片、没有文字层 —— 需要 OCR，本机没有 OCR，给不了数值；');
  console.error('   b) 导出时字体没带 Unicode 映射（Origin/Grapher 这类矢量导出常见）—— 字在人眼里有，机器读不出来。');
  console.error('   期刊官方的 Guide for Authors PDF 通常两种情况都不是；真遇到就换文本版 PDF，或走人工回填（见 journals/RETRIEVAL.md）。');
  process.exit(1);
}
process.exit(0);

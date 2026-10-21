#!/usr/bin/env node
/**
 * cycle.mjs —— 一个命令跑完「科研模式」14 天周期自检的全部门禁。
 *
 * 跑的就是 .github/workflows/ci.yml 那套东西，不另立标准：
 *   1) node --check  lib/*.js + scripts/*.mjs   （语法，零依赖）
 *   2) selftest-host / selftest-actions / selftest-client
 *   3) python scripts/validate-patch.py          （patch 预检，需 PyYAML）
 *   4) scripts/check-local-info.mjs              （本机信息，推送前必须零命中）
 * 另外附一段只读的 git 状态，方便同步 GitHub 那一步心里有数。
 *
 * 用法：
 *   node scripts/cycle.mjs                # 全部跑，报告落 out/cycle/<YYYY-MM-DD>/
 *   node scripts/cycle.mjs --no-report    # 只在终端输出，不写文件
 *   node scripts/cycle.mjs --skip-host    # 跳过需要真库的那节（CI 上也用得上）
 *   node scripts/cycle.mjs --quiet        # 只打汇总表，子进程输出丢进日志
 *
 * 环境变量：
 *   SCIWORK_LIBRARY  指向真库就能把「写动作」整节测起来（默认读随包 library/config.json）
 *   SCIWORK_PYTHON   指定解释器（默认依次试 python / python3 / py -3）
 *
 * 退出码：0 = 全绿；1 = 有门禁红了；2 = 连门禁都没跑起来（缺 node/python/文件）
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGV = new Set(process.argv.slice(2));
const SKIP_HOST = ARGV.has('--skip-host');
const NO_REPORT = ARGV.has('--no-report');
const QUIET = ARGV.has('--quiet');

/* ---------------------------------------------------------------- 小工具 */

const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { dim: '', red: '', green: '', yellow: '', bold: '', off: '' };

const t0 = Date.now();
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
const results = [];   // { name, ok, ms, note, output }
const logs = [];      // { name, text }

function record(name, ok, started, note, output = '') {
  const ms = Date.now() - started;
  results.push({ name, ok, ms, note: note || '', output });
  if (output) logs.push({ name, text: output });
  const mark = ok === null ? `${C.yellow}SKIP${C.off}` : ok ? `${C.green}PASS${C.off}` : `${C.red}FAIL${C.off}`;
  const tail = note ? `  ${C.dim}${note}${C.off}` : '';
  console.log(`  ${mark}  ${name}${tail}  ${C.dim}(${ms}ms)${C.off}`);
  return ok;
}

function run(name, cmd, args, opts = {}) {
  const started = Date.now();
  if (!QUIET) console.log(`\n${C.dim}── ${name}: ${cmd} ${args.join(' ')}${C.off}`);
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT,
    encoding: 'utf8',
    timeout: opts.timeout || 300000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...(opts.env || {}) },
    shell: process.platform === 'win32' && opts.shell === true,
  });
  const out = [r.stdout, r.stderr].filter(Boolean).join('\n').trim();
  if (!QUIET && out) console.log(out);
  const failedToStart = !!r.error;
  const ok = !failedToStart && r.status === 0;
  const note = failedToStart
    ? `起不来：${r.error.message}`
    : r.signal
      ? `被杀：${r.signal}`
      : r.status === 0 ? '' : `exit=${r.status}`;
  return { name, ok, ms: Date.now() - started, note, out, status: r.status, error: r.error };
}

/** 从自检输出尾巴里抠「N 通过 · M 失败 · K 跳过」 */
function countsFrom(out) {
  const tail = (out || '').slice(-4000);
  const m = tail.match(/(\d+)\s*通过\s*[·・]\s*(\d+)\s*失败(?:\s*[·・]\s*(\d+)\s*跳过)?/);
  if (!m) return null;
  return { pass: Number(m[1]), fail: Number(m[2]), skip: m[3] ? Number(m[3]) : 0 };
}

function pickPython() {
  if (process.env.SCIWORK_PYTHON) return [process.env.SCIWORK_PYTHON, []];
  const cands = process.platform === 'win32'
    ? [['python', []], ['py', ['-3']], ['python3', []]]
    : [['python3', []], ['python', []]];
  for (const [cmd, prefix] of cands) {
    const r = spawnSync(cmd, [...prefix, '--version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return [cmd, prefix];
  }
  return null;
}

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return r.error ? '' : (r.stdout || '').trim();
}

/* ---------------------------------------------------------------- 1. 语法 */

console.log(`${C.bold}dsh-sciwork 周期自检${C.off}  ${C.dim}${ROOT}${C.off}  ${C.dim}${stamp()}${C.off}\n`);
console.log(`${C.bold}[0] 环境${C.off}`);
console.log(`  node   ${process.version}`);
const PY = pickPython();
console.log(`  python ${PY ? `${PY[0]} ${PY[1].join(' ')}`.trim() : `${C.red}没找到${C.off}`}`);
const libRoot = process.env.SCIWORK_LIBRARY || process.env.RESEARCH_LIBRARY || '';
console.log(`  库根   ${libRoot ? libRoot : `${C.dim}（没设 SCIWORK_LIBRARY，随包 library/config.json 说了算）${C.off}`}`);
record('node 可用', true, Date.now(), process.version);
record('python 可用', PY ? true : false, Date.now(), PY ? PY[0] : '缺 python，patch 预检跑不了');

/* git 只读状态：给同步那一步用，不算门禁 */
console.log(`\n${C.bold}[git] 状态（只读，不参与判定）${C.off}`);
{
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = git(['log', '-1', '--format=%h %s']);
  const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean).length;
  const ahead = git(['rev-list', '--count', '@{u}..HEAD']);
  const behind = git(['rev-list', '--count', 'HEAD..@{u}']);
  const tag = git(['describe', '--tags', '--abbrev=0']);
  console.log(`  ${C.dim}分支${C.off} ${branch || '?'}   ${C.dim}HEAD${C.off} ${head || '?'}   ${C.dim}tag${C.off} ${tag || '（无）'}`);
  console.log(`  ${C.dim}未提交${C.off} ${dirty} 个   ${C.dim}领先远端${C.off} ${ahead || '0'}   ${C.dim}落后远端${C.off} ${behind || '0'}`);
  record('git 可读', !!branch, Date.now(), `${branch} · 未提交 ${dirty} · 领先 ${ahead || 0} / 落后 ${behind || 0}`);
}

/* ---------------------------------------------------------------- 2. 门禁 */

console.log(`\n${C.bold}[1] 语法检查（node --check）${C.off}`);
{
  const files = [
    ...fs.readdirSync(path.join(ROOT, 'lib')).filter((f) => f.endsWith('.js')).map((f) => `lib/${f}`),
    ...fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => f.endsWith('.mjs')).map((f) => `scripts/${f}`),
  ].sort();
  // 本文件自己也在 scripts/ 里：单独 check 一次没意义但无害，保持「全量」更省心
  let bad = 0;
  const started = Date.now();
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) {
      bad += 1;
      console.log(`  ${C.red}FAIL${C.off}  ${f}\n${(r.stderr || '').trim()}`);
      logs.push({ name: `node --check ${f}`, text: (r.stderr || '').trim() });
    }
  }
  record(`node --check × ${files.length}`, bad === 0, started, bad ? `${bad} 个文件语法错` : files.join(' '));
}

console.log(`\n${C.bold}[2] 自检${C.off}`);
for (const [label, script, skip] of [
  ['host 自检（库快照/配置）', 'scripts/selftest-host.mjs', SKIP_HOST],
  ['action 自检（动作契约）', 'scripts/selftest-actions.mjs', false],
  ['registry 自检（登记表形状/参数）', 'scripts/test-registry.mjs', false],
  ['dispatch 自检（令牌/回执/幂等）', 'scripts/test-dispatch.mjs', false],
  ['projects 自检（课题/迁移/备份）', 'scripts/test-projects.mjs', false],
  ['client 自检（面板渲染）', 'scripts/selftest-client.mjs', false],
]) {
  if (skip) {
    record(label, null, Date.now(), '--skip-host');
    continue;
  }
  const r = run(label, process.execPath, [script], { timeout: 600000 });
  const c = countsFrom(r.out);
  const note = c
    ? `${c.pass} 通过 · ${c.fail} 失败${c.skip ? ` · ${c.skip} 跳过` : ''}`
    : r.ok ? '退出 0' : r.note;
  record(label, r.ok, Date.now(), note, r.out);
  if (c && c.fail > 0) {
    // 失败用例点名：让下一次（或自动化）能直接看出是哪一条
    const lines = r.out.split('\n').filter((l) => /^\s*FAIL /.test(l));
    if (lines.length) console.log(lines.map((l) => `      ${C.red}${l.trim()}${C.off}`).join('\n'));
  }
  if (c && c.skip > 0) {
    // 跳过项也点名：「跳过」比「失败」更危险，它安静地什么都不验
    const lines = r.out.split('\n').filter((l) => /^\s*(?:SKIP|跳过)\b/.test(l)).slice(0, 12);
    if (lines.length) console.log(lines.map((l) => `      ${C.yellow}${l.trim()}${C.off}`).join('\n'));
  }
}

console.log(`\n${C.bold}[3] patch 预检${C.off}`);
if (!PY) {
  record('validate-patch.py', false, Date.now(), '没有 python');
} else {
  const r = run('validate-patch.py', PY[0], [...PY[1], 'scripts/validate-patch.py']);
  record('validate-patch.py', r.ok, Date.now(), r.ok ? 'patch 是合成树的子集' : r.note, r.out);
}

console.log(`\n${C.bold}[4] 本机信息（推送前零命中）${C.off}`);
{
  const r = run('check-local-info', process.execPath, ['scripts/check-local-info.mjs']);
  record('本机信息扫描', r.ok, Date.now(), r.ok ? '0 命中' : '有本机路径/用户名/主机名，见上', r.out);
}

/* ---------------------------------------------------------------- 3. 汇总 */

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const failed = results.filter((r) => r.ok === false);
const skipped = results.filter((r) => r.ok === null);
const verdict = failed.length === 0;

console.log(`\n${'='.repeat(72)}`);
console.log(`${C.bold}汇总${C.off}  ${results.length - skipped.length} 项执行 · ${C.green}${results.length - skipped.length - failed.length} 通过${C.off} · `
  + `${failed.length ? C.red : C.dim}${failed.length} 失败${C.off} · ${skipped.length} 跳过 · ${elapsed}s`);
for (const r of results) {
  if (r.ok === false) console.log(`  ${C.red}✗${C.off} ${r.name}${r.note ? `  ${C.dim}${r.note}${C.off}` : ''}`);
}
console.log(verdict
  ? `${C.green}全绿。可以进下一步：版本号 / CHANGELOG / 提交 / 推送。${C.off}`
  : `${C.red}有红项，先修再同步（别把红的推上去）。${C.off}`);

/* ---------------------------------------------------------------- 4. 报告 */

if (!NO_REPORT) {
  const day = new Date();
  const dir = path.join(ROOT, 'out', 'cycle', day.toISOString().slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  const iso = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const md = [
    `# dsh-sciwork 周期自检报告`,
    ``,
    `- 时间：${day.toLocaleString('zh-CN', { hour12: false })}（${iso}）`,
    `- 目录：\`${ROOT}\``,
    `- node：${process.version} · python：${PY ? PY[0] + ' ' + PY[1].join(' ') : '缺'}`,
    `- 库根：${libRoot || '（随包 library/config.json）'}`,
    `- 结论：**${verdict ? '全绿' : '有失败项'}**`,
    ``,
    `## 结果`,
    ``,
    `| 门禁 | 结果 | 耗时 | 备注 |`,
    `| --- | --- | --- | --- |`,
    ...results.map((r) => `| ${r.name} | ${r.ok === null ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'} | ${r.ms}ms | ${String(r.note).replace(/\|/g, '\\|')} |`),
    ``,
    `## 子进程输出`,
    ``,
    ...logs.map((l) => `### ${l.name}\n\n\`\`\`\n${l.text}\n\`\`\`\n`),
  ].join('\n');
  const file = path.join(dir, 'cycle-report.md');
  fs.writeFileSync(file, md, 'utf8');
  for (const l of logs) {
    const safe = l.name.replace(/[^\w.-]+/g, '-');
    fs.writeFileSync(path.join(dir, `${safe}.log`), l.text, 'utf8');
  }
  console.log(`\n${C.dim}报告：${file}${C.off}`);
}

process.exit(verdict ? 0 : 1);

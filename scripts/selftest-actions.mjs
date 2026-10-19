/**
 * 科研模式 · 面板动作自检（裸 node 运行，不需要 cordis / Harness / Web 载体）
 * ===========================================================================
 * 用法：
 *   node scripts/selftest-actions.mjs
 *   加 --replot 才会真的跑一次 Origin 重画（默认不跑：绝不为了自检去冷启动 Origin）。
 *
 * 它证明的是「面板那一半的宿主逻辑在**没有 Harness** 的情况下也是对的」：
 *   1. 24 个动作名与文档一致；
 *   2. 只读动作在真实库上返回真数据（自适应挑样本，库为空就 SKIP 而不是假装通过）；
 *   3. 错误码正确（bad-request / not-found / denied）；
 *   4. 路径护栏真的拦住 `..`、绝对路径、Unix 绝对路径；
 *   5. cliHint 七段模板都在；
 *   6. 宿主半边 lib/index.js 的 bootstrap：apply(ctx) 会以正确参数注册 /api 精确路由，
 *      且「没有 connection 服务 / rpc 没有 fetch.register」时只告警不抛（否则整个 profile 起不来）。
 */

import fs from 'node:fs';

import { ACTIONS, CLI_COMMANDS, CLI_HINTS, buildCliArgs, handleResearchCall, parseRawArgs, probePathGuard } from '../lib/actions.js';

const argv = process.argv.slice(2);
const RUN_REPLOT = argv.includes('--replot');

let pass = 0;
let fail = 0;
let skip = 0;
const failures = [];

function ok(name, detail) {
  pass += 1;
  console.log(`  PASS  ${name}${detail ? '  —— ' + detail : ''}`);
}
function bad(name, detail) {
  fail += 1;
  failures.push(`${name}: ${detail}`);
  console.log(`  FAIL  ${name}  —— ${detail}`);
}
function skipped(name, why) {
  skip += 1;
  console.log(`  SKIP  ${name}  —— ${why}`);
}
function check(name, cond, detail) {
  if (cond) ok(name, detail);
  else bad(name, detail || '断言失败');
}

const rel = (p) => String(p).replace(/\\/g, '/');

console.log('科研模式 · 面板动作自检（lib/actions.js）');
console.log('='.repeat(72));

/* 1. 动作名与 CLI 模板 ------------------------------------------------- */
console.log('\n[1] 契约面');
const EXPECTED_ACTIONS = ['snapshot', 'readText', 'readBinary', 'tableColumns', 'checkCitations', 'replot', 'cliHint', 'import', 'importInfo', 'archive', 'remove', 'restore', 'archiveInfo', 'fetchRefMeta', 'writeText', 'newDraft', 'removeRef', 'cliCommands', 'runCli', 'transformOps', 'tablePreview', 'tableTransform', 'checkJournal', 'exportPackage'];
check('ACTIONS 与面板一致', JSON.stringify(ACTIONS) === JSON.stringify(EXPECTED_ACTIONS), ACTIONS.join(', '));

/* 1b. 命令台：spec → argv -------------------------------------------------- */
const ids = CLI_COMMANDS.map((c) => c.id);
check('命令台白名单覆盖 research.py 主要子命令',
  ['status', 'search', 'check-citations', 'list-figures', 'list-refs', 'register-figure', 'add-ref', 'add-submission', 'new-project', 'update-submission', 'reindex', 'export-bib', 'init', 'remove-ref'].every((i) => ids.includes(i)),
  ids.join(', '));
check('命令 id 与 research.py 子命令同名（无空格/大写）',
  CLI_COMMANDS.every((c) => /^[a-z][a-z-]*$/.test(c.id)), ids.filter((i) => !/^[a-z][a-z-]*$/.test(i)).join(',') || '全部合法');
check('每条命令都有 kind 与 desc', CLI_COMMANDS.every((c) => ['read', 'write', 'danger'].includes(c.kind) && c.desc),
  CLI_COMMANDS.filter((c) => !c.kind || !c.desc).map((c) => c.id).join(',') || '全部有');
check('remove-ref 被标为危险', (CLI_COMMANDS.find((c) => c.id === 'remove-ref') || {}).kind === 'danger');
check('每个 select 参数都给了 options',
  CLI_COMMANDS.every((c) => (c.args || []).every((a) => a.type !== 'select' || (Array.isArray(a.options) && a.options.length))),
  CLI_COMMANDS.flatMap((c) => (c.args || []).filter((a) => a.type === 'select' && !(a.options || []).length).map((a) => c.id + ':' + a.name)).join(',') || '全部有');

const byId = (id) => CLI_COMMANDS.find((c) => c.id === id);
check('buildCliArgs：按顺序拼 argv', JSON.stringify(buildCliArgs(byId('check-citations'), { '--draft': 'projects/p/drafts/a.md', '--require-doi': true }))
  === JSON.stringify(['check-citations', '--draft', 'projects/p/drafts/a.md', '--require-doi']),
  JSON.stringify(buildCliArgs(byId('check-citations'), { '--draft': 'projects/p/drafts/a.md', '--require-doi': true })));
check('buildCliArgs：空值不传参数', JSON.stringify(buildCliArgs(byId('list-refs'), { '--project': '  ', '--query': '' })) === JSON.stringify(['list-refs']),
  JSON.stringify(buildCliArgs(byId('list-refs'), { '--project': '  ', '--query': '' })));
check('buildCliArgs：bool 为假不加开关', JSON.stringify(buildCliArgs(byId('list-submissions'), { '--active': false })) === JSON.stringify(['list-submissions']));
check('buildCliArgs：list 参数每个值一个 flag',
  JSON.stringify(buildCliArgs(byId('register-figure'), { '--project': 'p', '--file': 'f.png', '--data': 'a.csv;b.csv' }))
  === JSON.stringify(['register-figure', '--project', 'p', '--file', 'f.png', '--data', 'a.csv', '--data', 'b.csv']),
  JSON.stringify(buildCliArgs(byId('register-figure'), { '--project': 'p', '--file': 'f.png', '--data': 'a.csv;b.csv' })));
check('buildCliArgs：位置参数在 flags 之前', buildCliArgs(byId('new-project'), { slug: 'zt', '--title': 'T' })[1] === 'zt',
  buildCliArgs(byId('new-project'), { slug: 'zt', '--title': 'T' }).join(' '));

check('parseRawArgs：正常切分', JSON.stringify(parseRawArgs('--project p --file f.png')) === JSON.stringify(['--project', 'p', '--file', 'f.png']));
check('parseRawArgs：空串给空数组', JSON.stringify(parseRawArgs('   ')) === JSON.stringify([]));
let rawErr = '';
try { parseRawArgs('--a b; rm -rf'); } catch (e) { rawErr = e.message; }
check('parseRawArgs：分号被拒（防注入）', /分号/.test(rawErr), rawErr);
let rawErr2 = '';
try { parseRawArgs('--a b\nc'); } catch (e) { rawErr2 = e.message; }
check('parseRawArgs：换行被拒', /换行/.test(rawErr2), rawErr2);

check('CLI_HINTS 七段齐全', Object.keys(CLI_HINTS).length === 7, Object.keys(CLI_HINTS).join(', '));


/* 2b. 数据变换内核：回归锁 -------------------------------------------------- */
import { normalize, baseline, smooth, integrate, peaks, linear, tableToCsv, runTransform } from '../lib/transform.js';
{
  // 基线 ends 模式必须用用户选的 X 列，不能写死第 0 列
  // 首段 3 点严格共线（Y=2X），拟合后首点校正应为 0
  const tab = { header: ['a','b','x','y'], delimiter: ',', rows: [
    [9,9,1,2],[9,9,2,4],[9,9,3,6],[9,9,4,3],[9,9,5,5],[9,9,6,7],[9,9,7,4],[9,9,8,6],[9,9,9,8],[9,9,10,10],
  ] };
  const out = baseline(tab, 3, 2, 'ends', 3).table.rows.map((r) => r[3]);
  check('baseline ends 用选中的 X 列拟合（首段共线 → 首点校正为 0）', Math.abs(out[0]) < 1e-9, 'out[0]=' + out[0]);
  check('baseline ends 真的减了基线（末行≠原始值）', Math.abs(out[9] - 10) > 1e-6, 'out[9]=' + out[9]);
  // 用错列（第0列全是9）时拟不出基线，应原样返回并给出提示，绝不假装成功
  const buggy = baseline(tab, 3, 0, 'ends', 3);
  check('基线选错列（全9列）时不假装成功：原样返回', buggy.table.rows[9][3] === 10 && /X 变化太小/.test(buggy.notes[0] || ''), JSON.stringify(buggy.notes));
}
{
  // CSV 引号转义：含分隔符 / 引号 / 换行的字段必须被包裹并转义
  const tab = { header: ['name','val'], delimiter: ',', rows: [['张三, 博士','1.2'],['a"b','3'],['line1\nline2','9']] };
  const csv = tableToCsv(tab);
  check('CSV 逗号被包裹', csv.includes('"张三, 博士"'));
  check('CSV 引号被转义为双引号', csv.includes('"a""b"'));
  check('CSV 换行被包裹', csv.includes('"line1\nline2"'));
}
{
  // runTransform 缺 Y 列必须抛错（被 tableTransform 兜底成 bad-request），不能静默产出
  let threw = false;
  try { runTransform({ header: ['x','y'], delimiter: ',', rows: [[1,2]] }, 'normalize', {}); } catch { threw = true; }
  check('runTransform 没选 Y 列会抛错', threw);
}
console.log('[2b] 变换内核回归');
/* 2. 真实库快照 -------------------------------------------------------- */
console.log('\n[2] snapshot（真实库）');
const snapRes = await handleResearchCall({ action: 'snapshot' });
const snapUsable = !!(snapRes && snapRes.ok && snapRes.value && snapRes.value.ok === true);
if (!snapUsable) {
  const why = snapRes.ok
    ? `库根 ${rel(snapRes.value && snapRes.value.root)} 还不是一个可用的科研库`
    : JSON.stringify(snapRes.error || {});
  skipped('真实库快照（本机没有可用的科研库）', why + '；设 SCIWORK_LIBRARY 指向一个库根再跑，其余纯函数检查照常');
  console.log('\n读不到可用的库，后续数据类检查全部跳过。');
} else {
  const snap = snapRes.value;
  check('snapshot.ok', snap.ok === true);
  check('库根存在', typeof snap.root === 'string' && snap.root.length > 0, snap.root);
  const c = snap.counts || {};
  ok('计数', `课题 ${c.project} · 图 ${c.figure} · 草稿 ${c.draft} · 数据 ${c.dataset} · 文献 ${c.ref} · 期刊 ${c.journal} · 投稿 ${c.submission}`);
  check('warnings 是数组', Array.isArray(snap.warnings), `${(snap.warnings || []).length} 条警告`);
  const subs = (snap.submissions || []).filter((s) => s.kind === 'submission');
  if (subs.length === 0) {
    check('空投稿台账被如实报告', (snap.warnings || []).some((w) => /投稿/.test(w)), '缺了这条警告说明在粉饰');
  } else {
    check('投稿记录已结构化', subs.every((s) => s.submissionId && s.status && s.path && typeof s.eventCount === 'number'), '每条投稿必须有 submissionId/status/path/eventCount');
    check('投稿计数与记录数一致', c.submission === subs.length, `counts.submission=${c.submission} 记录=${subs.length}`);
    ok('投稿记录', subs.map((s) => `${s.submissionId}(${s.status})`).join(' · '));
  }
  check('期刊档案 >0', (snap.journals || []).length > 0, `${(snap.journals || []).length} 份`);

  /* 3. 只读动作（自适应样本） ----------------------------------------- */
  console.log('\n[3] 只读动作（自适应挑样本）');
  const projects = snap.projects || [];
  const firstDraft = projects.flatMap((p) => (p.drafts || []).map((d) => ({ p, d })))[0];
  const firstAsset = projects.flatMap((p) => [...(p.datasets || []), ...(p.tables || [])].map((a) => ({ p, a })))[0];
  const firstFig = projects.flatMap((p) => (p.figures || []).map((f) => ({ p, f }))).find((x) => x.f.fileExists);

  if (firstDraft) {
    const path = firstDraft.d.path;
    const t = await handleResearchCall({ action: 'readText', args: { path } });
    check('readText 成功', t.ok && typeof t.value.text === 'string', rel(path) + ` (${t.ok ? t.value.bytes + ' B' : JSON.stringify(t.error)})`);

    const cites = await handleResearchCall({ action: 'checkCitations', args: { path } });
    if (!cites.ok) {
      bad('checkCitations 成功', JSON.stringify(cites.error));
    } else {
      const v = cites.value;
      check('checkCitations 字段齐', Array.isArray(v.cited) && Array.isArray(v.missing) && typeof v.known === 'number',
        `cited=${v.cited.length} missing=${v.missing.length} known=${v.known}`);
      check('checkCitations 带 caveat', typeof v.caveat === 'string' && v.caveat.length > 20);
      check('okFlag 与 missing 一致', v.okFlag === (v.missing.length === 0 && v.cited.length > 0), String(v.okFlag));
      if (/bad\.md$/.test(rel(path))) {
        check('bad.md 已知口径（cited=3 / missing=2 / 库里 1 条）',
          v.cited.length === 3 && v.missing.length === 2 && v.known === 1,
          `实际 cited=${v.cited.length} missing=${v.missing.length} known=${v.known}`);
      }
    }
  } else {
    skipped('readText / checkCitations', '库里没有草稿样本');
  }

  if (firstAsset) {
    const path = firstAsset.a.path;
    const cols = await handleResearchCall({ action: 'tableColumns', args: { path } });
    if (cols.ok && (cols.value.columns || []).length) {
      ok('tableColumns 成功', `${rel(path)} → [${cols.value.columns.join(', ')}] (${cols.value.delimiter})`);
      if (/jv-curve\.csv$/.test(rel(path))) {
        check('jv-curve.csv 表头口径', JSON.stringify(cols.value.columns) === JSON.stringify(['V', 'Jsc_mA_cm2', 'PCE_percent']),
          JSON.stringify(cols.value.columns));
      }
    } else if (cols.ok) {
      skipped('tableColumns 列名', `${path} 不是可识别表头的文本表`);
    } else {
      bad('tableColumns 成功', JSON.stringify(cols.error));
    }
  } else {
    skipped('tableColumns', '库里没有数据/表格样本');
  }

  if (firstFig) {
    const path = firstFig.f.file;
    const bin = await handleResearchCall({ action: 'readBinary', args: { path } });
    if (bin.ok) {
      check('readBinary 成功', typeof bin.value.base64 === 'string' && bin.value.base64.length > 0,
        `${rel(path)} → ${bin.value.mime} / ${bin.value.bytes} B / base64 ${bin.value.base64.length} 字符`);
      check('mime 是图片', /^image\//.test(bin.value.mime), bin.value.mime);
    } else {
      bad('readBinary 成功', JSON.stringify(bin.error));
    }
  } else {
    skipped('readBinary', '库里没有存在的图文件样本');
  }

  /* 4. 可选：真跑一次 Origin 重画 ------------------------------------- */
  console.log(`\n[4] replot（${RUN_REPLOT ? '已开启 --replot：会真跑 Origin' : '默认跳过'}）`);
  if (!RUN_REPLOT) {
    const noSidecar = await handleResearchCall({ action: 'replot', args: {} });
    check('replot 缺 sidecar → bad-request', noSidecar.ok === false && noSidecar.error.code === 'bad-request', JSON.stringify(noSidecar.error || {}));
    skipped('replot 端到端', '未传 --replot（不为自检冷启动 Origin）');
  } else if (firstFig) {
    const r = await handleResearchCall({ action: 'replot', args: { sidecar: firstFig.f.sidecar } });
    if (r.ok) {
      check('replot 成功且有新文件', !!r.value.file && r.value.verifyPassed === true,
        `${r.value.file} · verify=${r.value.verifyPassed} · trace=${r.value.traceId} · ${r.value.elapsedMs} ms`);
    } else {
      bad('replot 成功', JSON.stringify(r.error));
    }
  } else {
    skipped('replot 端到端', '没有带源数据的图样本');
  }
}

/* 5. 错误码 ------------------------------------------------------------ */
console.log('\n[5] 错误码');
const cases = [
  { name: 'payload=null → bad-request', payload: null, code: 'bad-request' },
  { name: 'payload={} → bad-request', payload: {}, code: 'bad-request' },
  { name: '未知动作 → bad-request', payload: { action: 'drop-database' }, code: 'bad-request' },
  { name: 'readText 无 path → bad-request', payload: { action: 'readText', args: {} }, code: 'bad-request' },
  { name: 'readText 不存在 → not-found', payload: { action: 'readText', args: { path: 'projects/__nope__/x.md' } }, code: 'not-found' },
  { name: 'readText .. 逃逸 → denied', payload: { action: 'readText', args: { path: '../../windows/win.ini' } }, code: 'denied' },
  { name: 'readText 绝对路径 → denied', payload: { action: 'readText', args: { path: 'C:\\Windows\\win.ini' } }, code: 'denied' },
  { name: 'readBinary 目录穿越 → denied', payload: { action: 'readBinary', args: { path: 'projects/../../../etc/passwd' } }, code: 'denied' },
];
for (const c of cases) {
  const r = await handleResearchCall(c.payload);
  const got = r.ok ? 'ok' : r.error.code;
  check(c.name, got === c.code, got === c.code ? '' : `实际 ${got}（${r.ok ? '' : r.error.message}）`);
}
const weird = await handleResearchCall({ action: 'snapshot', args: 'not-an-object' });
check('args 类型错也不崩（按空对象处理）', weird.ok === true, weird.ok ? '' : JSON.stringify(weird.error));

/* 6. cliHint ----------------------------------------------------------- */
console.log('\n[6] cliHint（写库只回命令行提示）');
const hints = await handleResearchCall({ action: 'cliHint', args: {} });
check('不带 key → 全部提示', hints.ok && hints.value.hints && Object.keys(hints.value.hints).length === 7);
const one = await handleResearchCall({ action: 'cliHint', args: { key: 'addRef' } });
check('带 key → 单段文本', one.ok && typeof one.value.text === 'string' && /add-ref/.test(one.value.text));
const none = await handleResearchCall({ action: 'cliHint', args: { key: '__nope__' } });
check('未知 key → 回退全部提示', none.ok && !!none.value.hints);

/* 6b. 投稿闸门（体检 / 打包）------------------------------------------- */
console.log('\n[6b] 投稿闸门（体检 / 打包）');
{
  // snap 只在 [2] 的 else 块里；这里用 snapRes.value，并只在**测试夹具库**里做写盘检查
  // （真实科研库不该因为跑一次自检就多出一个投稿包）。
  const snapValue = snapRes.ok ? snapRes.value : null;
  const gateProject = snapValue && (snapValue.projects || [])[0];
  if (!gateProject) {
    skipped('checkJournal / exportPackage', '库里没有课题样本');
  } else {
    const cj = await handleResearchCall({ action: 'checkJournal', args: { project: gateProject.slug, journal: 'nature' } });
    check('checkJournal 返回逐条结论',
      cj.ok && Array.isArray(cj.value.checks) && cj.value.checks.length > 0,
      cj.ok ? `${cj.value.checks.length} 条 / ${cj.value.counts.fail} 不合格` : JSON.stringify(cj.error));
    check('checkJournal 带免责声明', cj.ok && /以刊方/.test(cj.value.disclaimer || ''));
    check('checkJournal 指明稿件', cj.ok && !!cj.value.manuscript, cj.ok ? String(cj.value.manuscript) : '');
    check('checkJournal 有 fail 时退出码非 0',
      !cj.ok || !(cj.value.checks || []).some((c) => c.status === 'fail') || cj.value.exitCode !== 0,
      cj.ok ? `exit=${cj.value.exitCode} fail=${cj.value.counts.fail}` : '');
    const noProject = await handleResearchCall({ action: 'checkJournal', args: {} });
    check('checkJournal 缺 project → bad-request',
      !noProject.ok && noProject.error.code === 'bad-request', JSON.stringify(noProject.error));

    if (!/sciwork-test/.test(String(snapValue.root))) {
      skipped('exportPackage 写盘检查', '真实库不写测试包（把 SCIWORK_LIBRARY 指到 out/sciwork-test-lib 再跑）');
    } else {
      const ep = await handleResearchCall({ action: 'exportPackage', args: { project: gateProject.slug, journal: 'nature' } });
      check('exportPackage 打出 zip', ep.ok && /\.zip$/.test(ep.value.package || ''),
        ep.ok ? ep.value.package : JSON.stringify(ep.error));
      check('exportPackage 记录文件数', ep.ok && ep.value.files > 0, ep.ok ? String(ep.value.files) : '');
      if (ep.ok) {
        const zipAbs = snapValue.root + '/' + String(ep.value.package);
        check('exportPackage 的 zip 真的在盘上', fs.existsSync(zipAbs), zipAbs);
      }
      const noProjExport = await handleResearchCall({ action: 'exportPackage', args: {} });
      check('exportPackage 缺 project → bad-request',
        !noProjExport.ok && noProjExport.error.code === 'bad-request', JSON.stringify(noProjExport.error));
    }
  }
}

/* 7. 路径护栏 ---------------------------------------------------------- */
console.log('\n[7] 路径护栏（probePathGuard）');
try {
  const probes = await probePathGuard();
  for (const p of probes) check(`拒绝 ${p.path}`, p.rejected === true, p.note);
} catch (error) {
  bad('probePathGuard 可运行', String(error.message || error));
}

/* 8. 宿主半边 bootstrap（lib/index.js） ---------------------------------- */
// 用一个假 ctx 走完 inject → connection.fetch.register 的路径，并断言精确路由的参数。
// 关键回归点：**必须是精确 Fetch 路由，不许再回到 rpc.intercept**——
// `/api` 通道只允许一个拦截器，而 api-gateway 已经占了它；抢占会让官方
// `settings/describe` 等端点全部 404，桌面欢迎流程失败 → 原生恢复对话框 → 清空 profile。（见 HANDOFF §5.5）
console.log('\n[8] 宿主半边 bootstrap（lib/index.js）fetch 精确路由');
try {
  const host = await import('../lib/index.js');
  check('宿主导出 name', host.name === 'research-library', String(host.name));
  check('宿主导出 apply(ctx)', typeof host.apply === 'function');
  check('端点常量是 research/call', host.ENDPOINT === 'research/call', String(host.ENDPOINT));
  check('路由路径是 /api/research/call', host.ROUTE_PATH === '/api/research/call', String(host.ROUTE_PATH));

  const registered = [];
  const warnings = [];
  const errors = [];
  const makeCtx = (connection) => ({
    logger: {
      warn: (m) => warnings.push(String(m)),
      info: () => {},
      error: (m) => errors.push(String(m)),
    },
    inject(deps, cb) { this._deps = deps; cb({ connection, get: (n) => (n === 'connection' ? connection : undefined) }); },
    effect(fn, label) { const d = fn(); registered.push({ label, dispose: d }); return d; },
  });

  // trace 记录「谁调用了什么」：intercept 一旦出现就是回归（它会抢 api-gateway 的通道）。
  const trace = [];
  const routes = {
    register(route) { trace.push('register'); registered.push({ route }); return () => {}; },
    intercept() { trace.push('intercept'); throw new Error('回归：又走了 rpc.intercept'); },
  };
  const ctx = makeCtx({ fetch: routes });
  host.apply(ctx);

  check('声明了 inject(["connection"])', Array.isArray(ctx._deps) && ctx._deps[0] === 'connection', JSON.stringify(ctx._deps));
  check('调用了 connection.fetch.register（精确路由）', trace.includes('register') && !trace.includes('intercept'), trace.join(','));
  const reg = registered.find((r) => r.route);
  check('注册了精确路由对象', !!reg);
  check('路径 = /api/research/call', !!reg && reg.route.path === '/api/research/call', reg ? reg.route.path : '没有');
  check('方法 = POST', !!reg && Array.isArray(reg.route.methods) && reg.route.methods.length === 1 && reg.route.methods[0] === 'POST', reg ? JSON.stringify(reg.route.methods) : '');
  check('请求体 = buffered（字段名对齐官方宿主路由 requestBody）', !!reg && reg.route.requestBody === 'buffered', reg ? String(reg.route.requestBody) : '');
  check('ctx.effect 有清理标签', registered.some((r) => typeof r.label === 'string' && r.label.includes('research/call')));

  const invoke = async (body) => {
    const request = new Request('http://127.0.0.1/api/research/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const res = await reg.route.fetch(request);
    return { status: res.status, json: await res.json() };
  };

  if (reg) {
    const ok = await invoke({ type: 'client-request', rpcId: 'r1', method: 'research/call', payload: { action: 'snapshot', args: {} } });
    check('信封请求 → 200 + server-response', ok.status === 200 && ok.json && ok.json.type === 'server-response' && ok.json.rpcId === 'r1', JSON.stringify(ok.json).slice(0, 200));
    check('result.ok === true 且带 counts', !!(ok.json && ok.json.result && ok.json.result.ok === true && ok.json.result.value && typeof ok.json.result.value.counts === 'object'));

    const bad = await invoke({ type: 'client-request', rpcId: 'r2', method: 'research/call', payload: { action: 'nope', args: {} } });
    check('坏动作 → result.ok=false / code=bad-request', !!(bad.json && bad.json.result && bad.json.result.ok === false && bad.json.result.error && bad.json.result.error.code === 'bad-request'), JSON.stringify(bad.json).slice(0, 200));

    const mismatch = await invoke({ type: 'client-request', rpcId: 'r3', method: 'other/thing', payload: {} });
    check('method 不匹配 → gateway/bad-request', !!(mismatch.json && mismatch.json.result && mismatch.json.result.ok === false && mismatch.json.result.error && mismatch.json.result.error.code === 'gateway/bad-request'), JSON.stringify(mismatch.json).slice(0, 200));

    const broken = await reg.route.fetch(new Request('http://127.0.0.1/api/research/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }));
    check('非法 JSON → 仍回 JSON 信封（不 500）', broken.status === 200, String(broken.status));
  }

  // 没有 connection 服务时：只告警，不抛（否则整个 profile 起不来）
  const ctx2 = makeCtx(undefined);
  let threw = null;
  try { host.apply(ctx2); } catch (e) { threw = e; }
  check('没有 connection 时不抛异常', threw === null, threw ? String(threw.message || threw) : '');
  check('没有 connection 时留下告警', warnings.length > 0, warnings.join(' | '));

  // connection 存在但没有 fetch.register（旧宿主）：也只告警
  const ctx3 = makeCtx({ rpc: {} });
  let threw3 = null;
  try { host.apply(ctx3); } catch (e) { threw3 = e; }
  check('connection 没有 fetch.register 时不抛异常', threw3 === null, threw3 ? String(threw3.message || threw3) : '');

  // 与别的插件抢同一路径（`connection: exact Fetch route … is already registered`）：
  // 必须只记日志，不许把整个 bundle（连带 preset）拖成激活失败。
  let threw4 = null;
  const ctx4 = makeCtx({ fetch: { register() { throw new Error('connection: exact Fetch route "/api/research/call" is already registered'); } } });
  try { host.apply(ctx4); } catch (e) { threw4 = e; }
  check('路由冲突时不抛异常（面板是辅助，不许拖垮 preset）', threw4 === null, threw4 ? String(threw4.message || threw4) : '');
  check('路由冲突时留下 error 日志', errors.length > 0 && /already registered/.test(errors.join(' ')), errors[0] || '没有日志');
} catch (error) {
  bad('宿主半边 bootstrap 可运行', String(error && error.message ? error.message : error));
}

/* 9. 写动作（隔离副本 + 硬闸门；绝不打在真库上） ----------------------------------
 * 教训（2026-10-11）：写动作的正例曾经直接打在真库上，把 refs/refs.json
 * 写坏、真删过一个草稿。根因是 loadSettings() 最后会用「库里 .research/config.json
 * 的 libraryRoot」覆盖环境变量 —— 所以只设 RESEARCH_LIBRARY 指向副本是不够的，
 * 必须把副本自己的 config.json 也改成副本。这一节就是那次事故的回归测试。 */
console.log('\n[9] 写动作（隔离副本 + 硬闸门）');
let copiedRoot = null;
if (!snapUsable) {
  skipped('写动作隔离自检', '本机没有可用的科研库可复制（设 SCIWORK_LIBRARY 指向一个库根再跑）');
} else {
try {
  const { mkdtemp, cp, readFile, writeFile, rm, readdir, stat } = await import('node:fs/promises');
  const os = await import('node:os');
  const pathMod = await import('node:path');
  const LIB_REAL = rel(snapRes && snapRes.value && snapRes.value.root);
  const tmpBase = pathMod.join(os.tmpdir(), 'research-selftest');
  await rm(tmpBase, { recursive: true, force: true }).catch(() => {});
  await (await import('node:fs/promises')).mkdir(tmpBase, { recursive: true });
  copiedRoot = await mkdtemp(pathMod.join(tmpBase, pathMod.sep));
  copiedRoot = pathMod.join(copiedRoot, 'lib');
  await cp(LIB_REAL, copiedRoot, { recursive: true });
  // 副本的 config.json 必须指向副本自己（三处路径全换）
  const cfgPath = pathMod.join(copiedRoot, '.research', 'config.json');
  const cfgRaw = await readFile(cfgPath, 'utf8');
  const cfg = JSON.parse(cfgRaw);
  for (const key of Object.keys(cfg)) {
    if (typeof cfg[key] === 'string' && cfg[key] && LIB_REAL && cfg[key].startsWith(LIB_REAL)) {
      cfg[key] = copiedRoot + cfg[key].slice(LIB_REAL.length);
    }
  }
  if (cfg.libraryRoot && !cfg.libraryRoot.startsWith(copiedRoot)) cfg.libraryRoot = copiedRoot;
  await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  // 两个环境变量名都要改：新名 SCIWORK_LIBRARY 优先，只改旧名的话壳里设过的新名会赢，
  // 闸门就会看到真库（2026-10-13 引入 config.js 时踩到的坑）。
  process.env.SCIWORK_LIBRARY = copiedRoot;
  process.env.RESEARCH_LIBRARY = copiedRoot;

  const gated = await handleResearchCall({ action: 'snapshot' });
  const gateRoot = rel(gated && gated.value && gated.value.root);
  check('隔离闸门：snapshot 指向副本', gateRoot === rel(copiedRoot), 'root=' + gateRoot);
  if (gateRoot !== rel(copiedRoot)) {
    console.log('\n!! 闸门没通过：这次一个字节都不写，直接退出（副本：' + copiedRoot + '）');
    process.exit(2);
  }

  // 真库可能被用户清空（面板现在真能删东西）：自检需要的样本先补进**副本**（绝不碰真库）
  const seedText = async (relPath, text) => {
    const abs = pathMod.join(copiedRoot, ...relPath.split('/'));
    await (await import('node:fs/promises')).mkdir(pathMod.dirname(abs), { recursive: true });
    await writeFile(abs, text, 'utf8');
  };
  await seedText('projects/demo-perovskite/drafts/bad.md', '# 自检样本 bad\n\n这里引用了 @zhang2024missing 和 @zhang2024very。\n');
  await seedText('projects/demo-perovskite/drafts/good.md', '# 自检样本 good\n\n只引用 @zhang2024very。\n');
  await seedText('projects/demo-perovskite/data/jv-curve.csv', 'V,Jsc_mA_cm2,PCE_percent\n0.0,0.00,0.0\n0.2,12.5,2.4\n');
  const figDir = pathMod.join(copiedRoot, 'projects', 'demo-perovskite', 'figures');
  await (await import('node:fs/promises')).mkdir(figDir, { recursive: true });
  await writeFile(pathMod.join(figDir, 'selftest-graph.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  await seedText('projects/demo-perovskite/figures/selftest-graph.json', JSON.stringify({
    schema: 1, figureId: 'selftest-graph', project: 'demo-perovskite',
    file: 'projects/demo-perovskite/figures/selftest-graph.png', files: [], graph: 'SelftestGraph',
    sourceData: ['projects/demo-perovskite/data/jv-curve.csv'], journal: null, params: {}, spec: null,
    caption: '自检样本（不是实验数据）', createdAt: '2026-10-11T00:00:00+08:00',
  }, null, 1));
  const copySnap = await handleResearchCall({ action: 'snapshot' });

  const draftRel = 'projects/demo-perovskite/drafts/bad.md';
  const draftAbs = pathMod.join(copiedRoot, ...draftRel.split('/'));
  const beforeText = await readFile(draftAbs, 'utf8');

  // 9a. writeText：草稿可写、先备份；登记索引一律拒
  const w1 = await handleResearchCall({ action: 'writeText', args: { path: draftRel, text: beforeText + '\n（自检追加）\n' } });
  check('writeText 写草稿成功', w1.ok === true && w1.value && w1.value.backup, JSON.stringify(w1).slice(0, 160));
  const bakText = await readFile(draftAbs + '.bak', 'utf8').catch(() => null);
  check('.bak 里是改动前的内容', bakText === beforeText, bakText ? `${bakText.length} B` : '没有 .bak');
  const w2 = await handleResearchCall({ action: 'writeText', args: { path: 'refs/refs.json', text: 'x' } });
  check('writeText 拒改登记索引 refs/refs.json', w2.ok === false && w2.error.code === 'denied', JSON.stringify(w2).slice(0, 160));
  const w3 = await handleResearchCall({ action: 'writeText', args: { path: 'projects/demo-perovskite/drafts/nope.md', text: 'x' } });
  check('writeText 不存在的草稿 → not-found', w3.ok === false && w3.error.code === 'not-found', JSON.stringify(w3).slice(0, 160));
  const w4 = await handleResearchCall({ action: 'writeText', args: { path: '../outside.md', text: 'x' } });
  check('writeText 路径逃逸 → denied', w4.ok === false && w4.error.code === 'denied', JSON.stringify(w4).slice(0, 160));

  // 9b. archive → archiveInfo → restore：一条完整回路（样本从快照里自适应挑，别写死）
  const sampleFigs = (copySnap.value.projects || []).reduce((acc, p) => acc.concat((p.figures || []).map((f) => ({ slug: p.slug, f }))), []);
  const pickFig = sampleFigs.filter((x) => x.f.fileExists)[0] || sampleFigs[0];
  const arcTarget = pickFig ? (pickFig.f.fileExists ? pickFig.f.file : pickFig.f.sidecar) : null;
  if (!arcTarget) {
    skipped('archive 端到端', '副本里没有可归档的图文件');
  } else {
    const arcAbs = pathMod.join(copiedRoot, ...arcTarget.split('/'));
    const a1 = await handleResearchCall({ action: 'archive', args: { entries: [{ path: arcTarget, kind: 'figure', label: 'fig1' }], reason: '自检' } });
    check('archive 成功且附 reindex', a1.ok === true && a1.value && a1.value.id && a1.value.reindex && typeof a1.value.reindex.ok === 'boolean', JSON.stringify(a1.value || a1).slice(0, 200));
    check('archive 后原文件不在原位', !(await stat(arcAbs).then(() => true, () => false)));
    const manifest = pathMod.join(copiedRoot, '.research', 'archive', a1.value.id, 'manifest.json');
    const mani = await readFile(manifest, 'utf8').then(JSON.parse).catch(() => null);
    check('归档批带 manifest.json（谁/何时/原路径）', !!mani && mani.id === a1.value.id && Array.isArray(mani.items) && mani.items.length === 1, mani ? JSON.stringify(mani.items[0]).slice(0, 160) : '没有 manifest');
    const info = await handleResearchCall({ action: 'archiveInfo' });
    check('archiveInfo 列出这一批', info.ok === true && info.value.archives.some((x) => x.id === a1.value.id), (info.value && info.value.archives.length) + ' 批');
    const r1 = await handleResearchCall({ action: 'restore', args: { id: a1.value.id } });
    check('restore 搬回原位', r1.ok === true && (await stat(arcAbs).then(() => true, () => false)), JSON.stringify(r1.value || r1).slice(0, 160));
  }

  // 9c. remove：确认名必须逐字一致；两条目直接拒
  const delTarget = 'projects/demo-perovskite/drafts/good.md';
  const delAbs = pathMod.join(copiedRoot, ...delTarget.split('/'));
  const d0 = await handleResearchCall({ action: 'remove', args: { entries: [{ path: delTarget, kind: 'draft' }], confirm: 'wrong-name.md' } });
  check('remove 确认名不对 → denied', d0.ok === false && d0.error.code === 'denied', JSON.stringify(d0).slice(0, 160));
  check('确认名不对时文件还在', await stat(delAbs).then(() => true, () => false));
  const d1 = await handleResearchCall({ action: 'remove', args: { entries: [{ path: delTarget, kind: 'draft' }], confirm: 'good.md' } });
  check('remove 确认名逐字一致 → 成功', d1.ok === true, JSON.stringify(d1.value || d1).slice(0, 160));
  check('remove 后文件消失', !(await stat(delAbs).then(() => true, () => false)));
  const removedDir = pathMod.join(copiedRoot, '.research', 'archive', '_removed');
  const removedFiles = await readdir(removedDir).catch(() => []);
  check('真删留一条 _removed 记录（内容找不回，只留名字）', removedFiles.length >= 1, removedFiles.join(', '));
  const d2 = await handleResearchCall({ action: 'remove', args: { entries: [{ path: 'projects/demo-perovskite/drafts/bad.md' }, { path: 'projects/demo-perovskite/drafts/good.md' }], confirm: 'bad.md' } });
  check('remove 一次两条目 → bad-request（真删只能一条）', d2.ok === false && d2.error.code === 'bad-request', JSON.stringify(d2).slice(0, 160));
  const d3 = await handleResearchCall({ action: 'remove', args: { entries: [{ path: 'refs/refs.json' }], confirm: 'refs.json' } });
  check('remove 拒动登记索引', d3.ok === false && d3.error.code === 'denied', JSON.stringify(d3).slice(0, 160));

  // 9c2. 图条目：主文件与登记侧车主名不同（实测 Graph3.png + fig2.json）也要能成对删掉 ——
  // 否则「删掉这张图」只删掉 PNG、登记留在库里，卡片会一直显示（2026-10-11 用户报「删了还显示」）。
  // 样本自己造，不依赖真库里恰好有「主名不同」的图。
  const pairPng = 'projects/demo-perovskite/figures/selftest-pair.png';
  const pairJson = 'projects/demo-perovskite/figures/selftest-pair-fig.json'; // 故意与图片不同主名
  await writeFile(pathMod.join(copiedRoot, ...pairPng.split('/')), Buffer.from('89504e470d0a1a0a', 'hex'));
  await writeFile(pathMod.join(copiedRoot, ...pairJson.split('/')),
    JSON.stringify({ schema: 1, figureId: 'selftest-pair', file: pairPng, files: [], graph: 'G', sourceData: [], caption: '', createdAt: '2026-10-11T00:00:00+08:00' }, null, 1));
  const rmPair = await handleResearchCall({
    action: 'remove',
    args: { entries: [{ path: pairPng, sidecar: pairJson, kind: 'figure' }], confirm: 'selftest-pair.png', reason: '自检' },
  });
  check('主名不同的图 + 登记侧车一次删掉（removed=2）', rmPair.ok === true && rmPair.value.removed.length === 2, JSON.stringify(rmPair.value || rmPair).slice(0, 240));
  check('两张都真的不在磁盘上了',
    !(await stat(pathMod.join(copiedRoot, ...pairPng.split('/'))).then(() => true, () => false))
    && !(await stat(pathMod.join(copiedRoot, ...pairJson.split('/'))).then(() => true, () => false)));
  const afterPair = await handleResearchCall({ action: 'snapshot' });
  const pairStill = (afterPair.value.projects || []).reduce((acc, p) => acc.concat(p.figures || []), []).some((x) => x.sidecar === pairJson);
  check('reindex 之后图表页不再有这张图', pairStill === false, 'still=' + pairStill);

  // 9c3. removeRef：删文献条目走库脚本 research.py remove-ref（先备份 refs.json，再同步 refs.bib）
  const refsStore = JSON.parse(await readFile(pathMod.join(copiedRoot, 'refs', 'refs.json'), 'utf8'));
  const firstRefKey = Object.keys(refsStore.refs || {})[0];
  if (!firstRefKey) {
    skipped('removeRef 端到端', '副本里没有文献条目');
  } else {
    const rr1 = await handleResearchCall({ action: 'removeRef', args: { key: firstRefKey } });
    check('removeRef 删掉一条文献', rr1.ok === true && rr1.value.key === firstRefKey, JSON.stringify(rr1.value || rr1).slice(0, 200));
    check('removeRef 附带 reindex 回执', !!(rr1.value && rr1.value.reindex), JSON.stringify((rr1.value || {}).reindex));
    const store = JSON.parse(await readFile(pathMod.join(copiedRoot, 'refs', 'refs.json'), 'utf8'));
    check('refs.json 里已经没有这条', !(firstRefKey in (store.refs || {})), Object.keys(store.refs || {}).join(',') || '空');
    check('删前备份了 refs.json.bak', await stat(pathMod.join(copiedRoot, 'refs', 'refs.json.bak')).then(() => true, () => false));
    const bib = await readFile(pathMod.join(copiedRoot, 'refs', 'refs.bib'), 'utf8');
    check('refs.bib 同步移除该键', !bib.includes(firstRefKey), bib.slice(0, 120));
    const rr2 = await handleResearchCall({ action: 'removeRef', args: { key: firstRefKey } });
    check('再删一次 → not-found', rr2.ok === false && rr2.error.code === 'not-found', JSON.stringify(rr2.error || {}));
    const rr3 = await handleResearchCall({ action: 'removeRef', args: {} });
    check('removeRef 缺参数 → bad-request', rr3.ok === false && rr3.error.code === 'bad-request', JSON.stringify(rr3.error || {}));
  }

  // 9e. fetchRefMeta：只在点「抓取」时才联网；坏 DOI 立刻拒
  const f1 = await handleResearchCall({ action: 'fetchRefMeta', args: { doi: 'not-a-doi' } });
  check('fetchRefMeta 坏 DOI → bad-request（不发网络）', f1.ok === false && f1.error.code === 'bad-request', JSON.stringify(f1).slice(0, 160));
  const f2 = await handleResearchCall({ action: 'fetchRefMeta', args: {} });
  check('fetchRefMeta 没 DOI → bad-request', f2.ok === false && f2.error.code === 'bad-request');

  // 9f. import 的纯规划部分（不落文件、不起 python）
  const { sanitizeName, uniqueName, planResearchCalls, ACCEPT, LIMITS } = await import('../lib/import.js');
  check('import: 文件名消毒（去路径分隔符）', sanitizeName('../../etc/passwd') === 'passwd' || !/[/\\]/.test(sanitizeName('../../etc/passwd')), sanitizeName('../../etc/passwd'));
  check('import: 中文/空格文件名保留但安全', /[\u4e00-\u9fa5]/.test(sanitizeName('紫外 可见.csv')) && !/[/\\]/.test(sanitizeName('紫外 可见.csv')), sanitizeName('紫外 可见.csv'));
  const uniq = await uniqueName(pathMod.join(copiedRoot, 'projects', 'demo-perovskite', 'data'), 'jv-curve.csv');
  check('import: 同名不覆盖（自动 -1/-2）', uniq !== 'jv-curve.csv' && /jv-curve(-\d+)?\.csv$/.test(uniq), uniq);
  check('import: .txt 归到数据（用户口径）', ACCEPT.data.includes('.txt'), ACCEPT.data.join(' '));
  check('import: 单文件/整批都有上限', LIMITS.fileBytes === 32 * 1024 * 1024 && LIMITS.totalBytes === 64 * 1024 * 1024, JSON.stringify(LIMITS));
  const plan = planResearchCalls({ target: 'refs', project: '', placed: [{ name: 'zhang2024.pdf', path: copiedRoot + '/refs/pdf/zhang2024.pdf' }], meta: { title: '手头这篇', doi: '10.1038/x' }, root: copiedRoot });
  const refCall = (plan.calls || plan)[0] || {};
  const refArgs = refCall.args || [];
  check('import: 文献走 add-ref，且带 --verified-by user-supplied', refArgs[0] === 'add-ref' && refArgs.includes('--verified-by') && refArgs[refArgs.indexOf('--verified-by') + 1] === 'user-supplied', refArgs.join(' ').slice(0, 200));
  check('import: 文献带 --source 指向落位后的绝对路径', refArgs.includes('--source') && pathMod.isAbsolute(refArgs[refArgs.indexOf('--source') + 1]), refArgs.join(' ').slice(0, 200));

  // 9g. newDraft：新建空白草稿（只创建不存在的文件名，绝不覆盖）
  const nd1 = await handleResearchCall({ action: 'newDraft', args: { project: 'demo-perovskite', name: 'selftest-note', title: '自检新建的稿子' } });
  check('newDraft 新建空白草稿成功', nd1.ok === true && nd1.value.path === 'projects/demo-perovskite/drafts/selftest-note.md' && nd1.value.created === true, JSON.stringify(nd1).slice(0, 200));
  const ndBody = await readFile(pathMod.join(copiedRoot, 'projects', 'demo-perovskite', 'drafts', 'selftest-note.md'), 'utf8');
  check('newDraft 落盘内容是标题行', ndBody.startsWith('# 自检新建的稿子'), JSON.stringify(ndBody.slice(0, 60)));
  check('newDraft 成功时附了 reindex 回执', !!nd1.value.reindex, JSON.stringify(nd1.value.reindex || null).slice(0, 160));
  const nd2 = await handleResearchCall({ action: 'newDraft', args: { project: 'demo-perovskite', name: 'selftest-note.md' } });
  check('newDraft 同名 → bad-request（不覆盖）', nd2.ok === false && nd2.error.code === 'bad-request' && /已经有/.test(nd2.error.message), JSON.stringify(nd2).slice(0, 200));
  const nd3 = await handleResearchCall({ action: 'newDraft', args: { project: 'demo-perovskite', name: '../../evil' } });
  check('newDraft 名字带路径 → 拒', nd3.ok === false && (nd3.error.code === 'bad-request' || nd3.error.code === 'denied'), JSON.stringify(nd3).slice(0, 160));
  const nd4 = await handleResearchCall({ action: 'newDraft', args: { project: '../outside', name: 'x' } });
  check('newDraft 课题名不合法 → 拒', nd4.ok === false && nd4.error.code === 'bad-request', JSON.stringify(nd4).slice(0, 160));
  const nd5 = await handleResearchCall({ action: 'newDraft', args: { project: 'demo-perovskite' } });
  check('newDraft 缺 name → bad-request', nd5.ok === false && nd5.error.code === 'bad-request', JSON.stringify(nd5).slice(0, 160));
  check('newDraft 在 EXPECTED_ACTIONS 里', EXPECTED_ACTIONS.includes('newDraft'), EXPECTED_ACTIONS.join(' '));

  /* 9k. 子目录导入 + 分文件夹浏览（用户要求：数据按文件夹归类，面板要跟上） ---------- */
  const subImports = await handleResearchCall({
    action: 'import',
    args: {
      target: 'data', project: 'demo-perovskite', subdir: 'ZT-1500-2h',
      files: [{ name: 'sub-sample.csv', base64: Buffer.from('x,y\n1,2\n').toString('base64') }],
    },
  });
  const subPlaced = ((subImports.value && subImports.value.placed) || [])[0] || {};
  check('导入可以落到子目录（data/ZT-1500-2h/）',
    subImports.ok === true && /projects\/demo-perovskite\/data\/ZT-1500-2h\/sub-sample\.csv$/.test(rel(subPlaced.path)),
    JSON.stringify(subImports).slice(0, 200));

  const deepSub = await handleResearchCall({
    action: 'import',
    args: {
      target: 'drafts', project: 'demo-perovskite', subdir: '2026/10/XRD/deep',
      files: [{ name: 'deep.md', base64: Buffer.from('# 深层\n').toString('base64') }],
    },
  });
  check('子目录最多 3 层（第 4 层 → bad-request）',
    deepSub.ok === false && deepSub.error.code === 'bad-request' && /3 层/.test(deepSub.error.message),
    JSON.stringify(deepSub).slice(0, 200));

  const esc1 = await handleResearchCall({
    action: 'import',
    args: { target: 'data', project: 'demo-perovskite', subdir: '../..', files: [{ name: 'e.csv', base64: Buffer.from('a\n1\n').toString('base64') }] },
  });
  check('子目录写 .. → 拒（不许越出这一类目录）',
    esc1.ok === false && esc1.error.code === 'bad-request' && /\.\./.test(esc1.error.message),
    JSON.stringify(esc1).slice(0, 200));

  const esc2 = await handleResearchCall({
    action: 'import',
    args: { target: 'data', project: 'demo-perovskite', subdir: 'refs/pdf', files: [{ name: 'e2.csv', base64: Buffer.from('a\n1\n').toString('base64') }] },
  });
  const esc2Path = rel(((((esc2.value || {}).placed) || [])[0] || {}).path);
  check('子目录给了别的类的名字也只在 data/ 下（不越界）',
    esc2.ok === true && /^projects\/demo-perovskite\/data\/refs\/pdf\/e2\.csv$/.test(esc2Path),
    'placed=' + esc2Path);

  const subRefs = await handleResearchCall({
    action: 'import',
    args: { target: 'refs', project: 'demo-perovskite', subdir: 'x', meta: { title: 't', doi: '10.1/x' } },
  });
  check('「文献」不支持子目录 → 明确报错（不静默忽略）',
    subRefs.ok === false && subRefs.error.code === 'bad-request' && /不支持子目录/.test(subRefs.error.message),
    JSON.stringify(subRefs).slice(0, 200));

  const infoSub = await handleResearchCall({ action: 'importInfo' });
  check('importInfo 把「哪些目标支持子目录」告诉面板',
    JSON.stringify((infoSub.value || {}).subdirTargets) === JSON.stringify(['data', 'figures', 'drafts']),
    JSON.stringify(infoSub.value && infoSub.value.subdirTargets));

  const subSnap = await handleResearchCall({ action: 'snapshot' });
  const subProj = ((subSnap.value || {}).projects || []).find((p) => p.slug === 'demo-perovskite') || {};
  const subsSeen = (subProj.datasets || []).filter((d) => /sub-sample/.test(d.path)).map((d) => d.sub);
  check('snapshot 里的数据带上了它所在的子目录',
    JSON.stringify(subsSeen) === JSON.stringify(['ZT-1500-2h']),
    JSON.stringify(subsSeen));
  check('snapshot 报出这一类目录下有哪些文件夹（面板用它显示空组）',
    JSON.stringify(((subProj.folders || {}).data || []).filter((f) => f === 'ZT-1500-2h')) === JSON.stringify(['ZT-1500-2h']),
    JSON.stringify((subProj.folders || {}).data));
  const subDirOnDisk = await stat(pathMod.join(copiedRoot, 'projects', 'demo-perovskite', 'data', 'ZT-1500-2h', 'sub-sample.csv')).then(() => true).catch(() => false);
  check('子目录确实落在磁盘上（不是只改了返回文案）', subDirOnDisk === true, 'projects/demo-perovskite/data/ZT-1500-2h/sub-sample.csv');
} catch (error) {
  bad('写动作隔离自检可运行', String(error && error.message ? error.message : error));
} finally {
  if (copiedRoot && !process.argv.includes('--keep-copy')) {
    const { rm } = await import('node:fs/promises');
    await rm(copiedRoot, { recursive: true, force: true }).catch(() => {});
  } else if (copiedRoot) {
    console.log('  （副本保留：' + copiedRoot + '）');
  }
}
}

/* 11. 读表：用户真实的 XRD 导出**没有表头**（面板列下拉和出图必须同一套规则） ---------- */
console.log('\n[11] parseTable（没有表头的 XRD 文件也要认）');
const { parseTable } = await import('../lib/table.js');
const pureData = parseTable('27.967\t100.0\n35.699\t45.8\n39.966\t6.5\n');
check('纯两列数据（无表头）→ 列名按列序 #1 #2，第一行算数据',
  pureData.headerless === true && pureData.header.join(',') === '#1,#2' && pureData.rows.length === 3 && pureData.rows[0][1] === 100,
  JSON.stringify({ h: pureData.header, n: pureData.rows.length, r0: pureData.rows[0] }));
const instr = parseTable('16:51 09-10-2026  DIF TDXRD CSC 40kV/30mA slit:1deg\n20.      45\n20.01    40\n');
check('仪器信息行 + 两列数据 → 丢掉信息行，列名 #1 #2，只剩 2 行数据',
  instr.headerless === true && instr.header.join(',') === '#1,#2' && instr.rows.length === 2 && instr.rows[0][0] === 20,
  JSON.stringify({ h: instr.header, n: instr.rows.length, r0: instr.rows[0] }));
const csvHead = parseTable('two_theta,intensity\n10.1,200\n10.2,210\n');
check('正常的 CSV 表头照旧当表头', csvHead.headerless === false && csvHead.header.join(',') === 'two_theta,intensity' && csvHead.rows.length === 2,
  JSON.stringify({ h: csvHead.header, n: csvHead.rows.length }));
const blank = parseTable('x,y\n1,\n2,NA\n');
check('空单元格 / NA 当缺失（null），不填充', blank.rows[0][1] === null && blank.rows[1][1] === null, JSON.stringify(blank.rows));

/* 汇总 ---------------------------------------------------------------- */
console.log('\n' + '='.repeat(72));
console.log(`${pass} 通过 · ${fail} 失败 · ${skip} 跳过`);
if (fail) {
  console.log('\n失败项：');
  for (const f of failures) console.log('  - ' + f);
}
process.exit(fail ? 1 : 0);

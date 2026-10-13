/**
 * 科研模式 · 面板「重画」后端（宿主侧）
 * ---------------------------------------------------------------------------
 * 面板上点「重画」时，宿主临时起一个 **短命的 Origin MCP server 进程**，用原始
 * JSON-RPC（stdio）直接调 `origin_status` + `origin_figure`，把图重新画出来。
 *
 * 与智能体侧的关系（硬约束，别改）：
 *   - **绝不启动第二个 Origin 实例**：`origin_figure` 走 COM 连的是用户当前那个
 *     Origin（实测进程 PID 前后一致）。本模块只 spawn/close MCP server **进程**。
 *   - **串行化**：重画前拿一个锁文件（`.research/locks/origin.lock`），同一时刻
 *     只允许一次重画；锁过期 15 分钟自动作废。智能体侧调 origin_* 之前也应看这个
 *     锁（已写进 origin-plot 技能）。
 *   - 输出**只新增、不覆盖**：写成 `figures/<figureId>-replot-<时间戳>.png`。
 *     不偷偷改侧车、不偷偷改索引——登记溯源仍然由智能体跑 `research.py` 完成。
 *
 * 本模块只有一条路径：「重画已登记的图」（`replotFigure()`）。数据出图由智能体走
 * Origin MCP 完成，面板自己不出图（面板只读为主，写入只做导入/归档/删除/草稿/变换）。
 *
 * 协议细节来自实测（上游 dsh-origin-plugin 仓库里的 `e2e_research_plot.py`）：
 *   initialize(protocolVersion 2024-11-05) → notifications/initialized →
 *   tools/call {name, arguments} → result.content[].text 里是一段 JSON，
 *   真正的成功标志是这段 JSON 自己的 `ok`。
 */

import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { loadSettings, resolveInside, tableColumns, toRel } from './library.js';
import { runResearch } from './import.js';
import { pickPython, pythonCandidates } from './config.js';

const PROTOCOL_VERSION = '2024-11-05';
const STATUS_TIMEOUT_MS = 240_000;
const FIGURE_TIMEOUT_MS = 240_000;
const LOCK_STALE_MS = 15 * 60 * 1000;

/* ------------------------------------------------------------ MCP stdio 客户端 */

class McpClient {
  constructor(child, handlers = {}) {
    this.child = child;
    this.buf = '';
    this.nextId = 0;
    this.pending = new Map();
    this.stderr = [];
    this.closed = false;
    this.spawnError = null;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.#onData(chunk));
    child.stderr.setEncoding('utf8');
    // 必须有 error 监听：解释器/脚本路径失效时 Node 会抛 ENOENT 事件，
    // 没有监听就是未捕获异常，会把宿主进程带崩（import.js 那边同理已有）。
    child.on('error', (err) => {
      const e = new Error(`Origin MCP 进程起不来：${err?.message || err}`);
      this.spawnError = e;
      for (const [, p] of this.pending) p.reject(e);
      this.pending.clear();
      if (handlers.onSpawnError) handlers.onSpawnError(e);
    });
    child.stderr.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) this.stderr.push(line.trim());
      if (this.stderr.length > 40) this.stderr.splice(0, this.stderr.length - 40);
    });
    child.on('exit', (code, signal) => {
      const err = new Error(`Origin MCP 进程退出（code=${code}${signal ? `, signal=${signal}` : ''}）${this.stderr.length ? `：${this.stderr.slice(-3).join(' | ')}` : ''}`);
      for (const [, p] of this.pending) p.reject(err);
      this.pending.clear();
    });
  }

  #onData(chunk) {
    this.buf += chunk;
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg && msg.id != null && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`JSON-RPC ${msg.error.code}: ${msg.error.message}`));
        else p.resolve(msg.result);
      }
    }
  }

  #write(obj) {
    if (this.closed) throw new Error('MCP 连接已关闭');
    this.child.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  /** 发一条请求等响应（超时抛错）。 */
  request(method, params, timeoutMs) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} 超时（${timeoutMs} ms）`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      try { this.#write({ jsonrpc: '2.0', id, method, params: params || {} }); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }

  notify(method, params) { this.#write({ jsonrpc: '2.0', method, params: params || {} }); }

  /** tools/call → 解出 content[].text 里的 JSON。 */
  async tool(name, args, timeoutMs) {
    const started = Date.now();
    const res = await this.request('tools/call', { name, arguments: args || {} }, timeoutMs);
    const texts = Array.isArray(res?.content) ? res.content.filter((c) => c?.type === 'text').map((c) => c.text || '') : [];
    const joined = texts.join('\n');
    let payload = null;
    try { payload = JSON.parse(joined); } catch { payload = joined; }
    if (res?.isError === true) {
      const detail = typeof payload === 'string' ? payload : JSON.stringify(payload);
      throw new Error(`Origin 工具 ${name} 报错：${String(detail).slice(0, 800)}`);
    }
    return { payload, elapsedMs: Date.now() - started };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try { this.child.stdin.end(); } catch { /* ignore */ }
    await new Promise((resolve) => {
      const done = () => resolve();
      const timer = setTimeout(() => {
        try { this.child.kill(); } catch { /* ignore */ }
        resolve();
      }, 4000);
      this.child.once('exit', () => { clearTimeout(timer); done(); });
      try { this.child.kill(); } catch { /* ignore */ }
    });
  }
}

/**
 * 候选解释器：配置里的优先，其次通用候选（与库内 py.cmd 同一套，见 `lib/config.js`）。
 * 上游 Origin 插件的 Python 依赖装在哪台机器上只有用户知道，所以这里绝不留死路径。
 */
function resolveInterpreter(settings) {
  return pickPython({
    root: settings?.root,
    interpreter: settings?.interpreter,
    originPluginDir: (settings?.origin && settings.origin.pluginDir) || null,
  });
}

async function startClient({ python, server, cwd }) {
  const interpreter = existsSync(python) ? python : resolveInterpreter({ interpreter: python });
  if (!interpreter) {
    throw new Error(
      `找不到可用的 Python 解释器（配过的是 ${python || '（没有）'}，候选 ${pythonCandidates().join(' / ')} 也都不存在）。`
      + '请建一个 venv 装好 Origin 插件的 Python 依赖，把解释器写进 .research/config.json → interpreter，'
      + '或设置环境变量 SCIWORK_PYTHON。');
  }
  if (!existsSync(server)) {
    throw new Error(`Origin MCP server 脚本不存在：${server}（.research/config.json → origin.server 指错了）`);
  }
  const child = spawn(interpreter, ['-u', '-X', 'utf8', server], {
    cwd: existsSync(cwd) ? cwd : path.dirname(server),
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const client = new McpClient(child);
  await client.request('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'dsh-research-panel', version: '0.1.0' },
  }, 60_000);
  client.notify('notifications/initialized', {});
  return client;
}

/* ------------------------------------------------------------------- 锁文件 */

async function acquireLock(root, reason) {
  const dir = path.join(root, '.research', 'locks');
  const file = path.join(dir, 'origin.lock');
  await mkdir(dir, { recursive: true });
  // 锁里带一个 token：release() 只删「还是自己那把」的锁，避免接管过期锁的瞬间
  // 把别人刚拿到的锁删掉。
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = (forRead) => JSON.stringify(
    { at: new Date().toISOString(), by: 'research-panel', pid: process.pid, token, reason },
    null, forRead ? 1 : 0,
  );
  try {
    await writeFile(file, payload(false), { encoding: 'utf8', flag: 'wx' });
  } catch (e) {
    if (e?.code !== 'EEXIST') throw e;
    let age = Infinity;
    try { age = Date.now() - (await stat(file)).mtimeMs; } catch { /* ignore */ }
    if (age < LOCK_STALE_MS) {
      let holder = '';
      try { holder = (await readFile(file, 'utf8')).slice(0, 200); } catch { /* ignore */ }
      throw new Error(`Origin 忙：${path.join(root, '.research', 'locks', 'origin.lock')} 存在（${Math.round(age / 1000)} s 前），说明有另一次重画或智能体正在用 Origin。锁对象：${holder}`);
    }
    await writeFile(file, payload(false), { encoding: 'utf8' }); // 过期锁：接管
  }
  return async () => {
    try {
      const cur = await readFile(file, 'utf8');
      if (!cur.includes(token)) return; // 锁已经换主人了，别删别人的
    } catch {
      return; // 锁已经没了
    }
    try { await unlink(file); } catch { /* ignore */ }
  };
}

/* ------------------------------------------------------------------- 主流程 */

const stamp = () => {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/**
 * 跑一次 Origin 出图（拿锁 → 短命 MCP server → origin_status → origin_figure → 核验）。
 * 只负责「画出来 + 如实汇报」：不读侧车、不登记 —— 那是调用方的事。
 */
async function runFigure(opts) {
  const {
    settings, root, projectSlug, sourceRel, sourceAbs, figureId, outAbs, graphName,
    xColumn, yColumns, title, styleMode, plotType, warnings,
  } = opts;
  const originCfg = settings.origin || {};
  if (!originCfg.server) throw new Error('库里没有记录 Origin MCP server 路径（.research/config.json → origin.server）');
  const python = settings.interpreter || resolveInterpreter(settings) || '';
  if (!python) throw new Error('库里没有可用的 Python 解释器（.research/config.json → interpreter 为空，候选 venv 也都不存在）');

  const release = await acquireLock(root, `${figureId} @ ${projectSlug}`);
  let client = null;
  const t0 = Date.now();
  try {
    client = await startClient({ python, server: originCfg.server, cwd: originCfg.pluginDir || path.dirname(originCfg.server) });
    const status = await client.tool('origin_status', {}, STATUS_TIMEOUT_MS);
    const statusPayload = status.payload && typeof status.payload === 'object' ? status.payload : {};
    const owner = statusPayload.origin_running_before;
    if (statusPayload.connected !== true) {
      throw new Error(`Origin 未连上：${statusPayload.detail || JSON.stringify(statusPayload).slice(0, 400)}`);
    }

    const args = {
      data_source: sourceAbs,
      x_column: xColumn,
      y_columns: yColumns.length ? yColumns : null,
      intent: 'journal',
      plot_type: plotType || null,
      style_mode: styleMode || 'journal',
      fmt: 'png',
      file_path: outAbs,
      graph_name: graphName,
      title: title || figureId,
      verify: true,
      deliver: false,
    };
    const figure = await client.tool('origin_figure', args, FIGURE_TIMEOUT_MS);
    const p = figure.payload && typeof figure.payload === 'object' ? figure.payload : {};
    const verify = p.verify || null;
    const fileAbs = typeof p.file === 'string' && p.file ? p.file : outAbs;
    let bytes = null;
    let fileRel = null;
    try {
      const st = await stat(fileAbs);
      bytes = st.size;
      fileRel = toRel(root, fileAbs);
    } catch {
      warnings.push(`Origin 返回的路径不存在：${fileAbs}`);
      fileRel = toRel(root, fileAbs);
    }
    const verifyPassed = verify?.passed === true || p.ok === true;
    if (verify && verify.passed !== true) warnings.push(`图核验未通过（n_fail=${verify.n_fail ?? '?'}），请人工看图`);
    if (p.proof_level === 'unverified') warnings.push('上游 proof_level 字段不可信（实测与 verify 自相矛盾），以 verify.checks 为准');

    // 交还 Origin：纪律要求图一画完就把 Origin 还给手动编辑，面板这条路径也不例外
    // （原实现走完只 close 了 MCP 进程，Origin 仍挂在自动化连接上）。
    // 失败只报 warning —— 不能因为「没能交还」就把已经画好的图判失败。
    let released = null;
    try {
      const rel = await client.tool('origin_release', {}, 30_000);
      released = rel?.payload?.ok !== false;
      if (!released) warnings.push(`出图后 origin_release 未成功：${String(rel?.payload?.detail || '').slice(0, 200)}`);
    } catch (e) {
      released = false;
      warnings.push(`出图后 origin_release 调用失败（Origin 可能还挂在自动化连接上，手动改图前请注意）：${String(e?.message || e).slice(0, 200)}`);
    }

    return {
      ok: p.ok !== false && verifyPassed !== false,
      figureId,
      project: projectSlug,
      file: fileRel,
      absFile: fileAbs,
      bytes,
      graph: p.graph || graphName,
      sourceData: sourceRel,
      columns: { x: xColumn, y: yColumns },
      verifyPassed: verify ? verify.passed === true : null,
      verifyChecks: verify?.checks ?? null,
      traceId: p.trace_id || null,
      originVersion: statusPayload.capabilities?.origin_version_label || statusPayload.origin_version_label || null,
      originRunningBefore: owner === true,
      originReleased: released,
      elapsedMs: Date.now() - t0,
      stepsMs: p.timings?.steps_ms || null,
      warnings,
      detail: p.detail || null,
      proofNote: '图已经写进库里（只新增、不覆盖）。',
      raw: { verify, style_mode: p.style_mode, channel: p.channel, size: p.size },
    };
  } finally {
    if (client) await client.close();
    await release();
  }
}

/**
 * 把刚出的图登记进库（spawn `research.py register-figure`，它会自己 reindex）。
 * 登记失败**不算出图失败**：图已经在盘上，只如实写进 warnings 让面板显示。
 */
async function registerNewFigure(cfg) {
  const { settings, root, projectSlug, figureId, fileRel, dataRels, extraRels, graph, title, journal, params, warnings } = cfg;
  if (!fileRel) {
    warnings.push('出图结果里没有文件路径，跳过自动登记');
    return { ok: false, skipped: true, reason: 'no-file' };
  }
  const args = ['register-figure', '--project', projectSlug, '--figure-id', figureId, '--file', resolveInside(root, fileRel)];
  if (graph) args.push('--graph', String(graph));
  if (title) args.push('--caption', String(title));
  if (journal) args.push('--journal', String(journal));
  for (const d of dataRels || []) {
    try { args.push('--data', resolveInside(root, d)); } catch (e) { warnings.push(`跳过源数据 ${d}：${e.message}`); }
  }
  for (const f of extraRels || []) {
    if (!f || f === fileRel) continue;
    try { args.push('--extra-file', resolveInside(root, f)); } catch (e) { warnings.push(`跳过附文件 ${f}：${e.message}`); }
  }
  const clean = {};
  for (const [k, v] of Object.entries(params && typeof params === 'object' ? params : {})) {
    if (v !== undefined && v !== null && v !== '') clean[k] = v;
  }
  if (Object.keys(clean).length) args.push('--params', JSON.stringify(clean));

  const run = await runResearch(settings, args, { label: `register-figure ${figureId}` });
  if (!run.ok) warnings.push(`自动登记失败（research.py exit ${run.code}）：${String(run.stderr || run.summary || '').slice(0, 300)}`);
  for (const w of run.warnings || []) warnings.push(`登记提示：${w}`);
  return {
    ok: run.ok,
    figureId,
    sidecar: `projects/${projectSlug}/figures/${figureId}.json`,
    code: run.code,
    summary: run.summary || '',
    warnings: run.warnings || [],
    stderr: run.ok ? '' : String(run.stderr || '').slice(0, 400),
    args: run.args,
  };
}

/**
 * 重画一张已登记的图。
 * @param {object} opts
 * @param {string} opts.sidecarRel 图侧车相对路径（projects/<slug>/figures/<id>.json）
 * @param {string} [opts.xColumn]  X 列（缺省用源表第一列）
 * @param {string[]} [opts.yColumns] Y 列（缺省用源表其余列）
 * @param {string} [opts.title] 图标题
 * @param {string} [opts.styleMode] journal | default | presentation 等（默认沿用侧车记录）
 * @param {string} [opts.plotType] 覆盖绘图类型
 */
export async function replotFigure(opts = {}) {
  const settings = await loadSettings();
  const root = settings.root;
  const sidecarAbs = resolveInside(root, opts.sidecarRel);
  const sidecar = JSON.parse(await readFile(sidecarAbs, 'utf8'));
  const figureId = sidecar.figureId || path.basename(sidecarAbs, '.json');
  const projectSlug = sidecar.project || (/^projects\/([^/]+)\//.exec(toRel(root, sidecarAbs)) || [])[1];
  const sources = Array.isArray(sidecar.sourceData) ? sidecar.sourceData.filter(Boolean) : [];
  const warnings = [];

  if (!projectSlug) throw new Error(`无法从侧车判定所属课题：${opts.sidecarRel}`);
  if (sources.length === 0) {
    throw new Error(`这张图没有记录源数据（sourceData 为空），面板无法重画。请让智能体用原始数据重新出图，并用 research.py register-figure 补上 --data。`);
  }
  const sourceRel = sources[0];
  const sourceAbs = resolveInside(root, sourceRel);
  await stat(sourceAbs);
  if (sources.length > 1) warnings.push(`侧车记录了 ${sources.length} 份源数据，本次只用第一份：${sourceRel}`);

  // 列选择
  let columns = null;
  try { columns = await tableColumns(root, sourceRel); } catch (e) { warnings.push(`读表头失败（${e.message}），改用智能体/Origin 的自动推断`); }
  const xColumn = (opts.xColumn && String(opts.xColumn).trim()) || (columns?.columns?.[0] ?? null);
  const yColumns = (Array.isArray(opts.yColumns) && opts.yColumns.length)
    ? opts.yColumns.map((s) => String(s).trim()).filter(Boolean)
    : (columns?.columns?.slice(1) ?? []);
  if (yColumns.length === 0) warnings.push('没有识别到 Y 列，交给 Origin 自动推断');

  const figuresDir = path.join(root, 'projects', projectSlug, 'figures');
  await mkdir(figuresDir, { recursive: true });
  const outAbs = path.join(figuresDir, `${figureId}-replot-${stamp()}.png`);
  const graphName = `${figureId}_replot_${stamp()}`;

  const result = await runFigure({
    settings, root, projectSlug, sourceRel, sourceAbs, figureId, outAbs, graphName,
    xColumn, yColumns,
    title: opts.title || sidecar.caption || figureId,
    styleMode: opts.styleMode || sidecar?.params?.style_mode || 'journal',
    plotType: opts.plotType || sidecar?.params?.plot_type || null,
    warnings,
  });

  // 重画后自动登记（面板上的勾选框，默认开）：新图成为这张图的 file，旧图留在 files 里。
  if (opts.register !== false) {
    const extras = [sidecar.file, ...(Array.isArray(sidecar.files) ? sidecar.files : [])]
      .filter((v) => typeof v === 'string' && v && v !== result.file);
    result.registered = await registerNewFigure({
      settings, root, projectSlug, figureId,
      fileRel: result.file,
      dataRels: sources,
      extraRels: Array.from(new Set(extras)),
      graph: result.graph,
      title: opts.title || sidecar.caption || figureId,
      journal: sidecar.journal || null,
      params: {
        ...(sidecar.params && typeof sidecar.params === 'object' ? sidecar.params : {}),
        plot_type: opts.plotType || sidecar?.params?.plot_type || null,
        style_mode: opts.styleMode || sidecar?.params?.style_mode || 'journal',
        x: xColumn,
        y: yColumns,
        replot_of: sidecar.file || null,
        verify_passed: result.verifyPassed,
        trace_id: result.traceId,
      },
      warnings: result.warnings,
    });
    result.proofNote = result.registered.ok
      ? `已自动登记：projects/${projectSlug}/figures/${figureId}.json（file → ${result.file}，旧图留在 files 里）。`
      : `自动登记没成功（research.py exit ${result.registered.code}）：图已经在库里，请让智能体跑 research.py register-figure 补登记。`;
  } else {
    result.proofNote = '图已经写进库里（只新增、不覆盖）；本次没有自动登记，图溯源请让智能体跑 research.py register-figure。';
  }
  return result;
}

/* ------------------------------------------------------------------ CLI 自测 */

const invokedDirectly = (() => {
  try {
    const arg = process.argv[1] ? path.resolve(process.argv[1]) : '';
    return arg !== '' && arg === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  } catch { return false; }
})();

if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };
  const sidecar = get('--sidecar') || (argv[0] && !argv[0].startsWith('--') ? argv[0] : null);
  if (!sidecar) {
    console.error('用法：node lib/replot.js --sidecar projects/<slug>/figures/<id>.json [--x 列名] [--y 列A,列B] [--title 标题]');
    process.exit(2);
  }
  const y = get('--y');
  replotFigure({
    sidecarRel: sidecar,
    xColumn: get('--x'),
    yColumns: y ? y.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    title: get('--title'),
    styleMode: get('--style'),
    plotType: get('--plot-type'),
  }).then((r) => {
    console.log(JSON.stringify(r, null, 1));
    process.exit(r.ok ? 0 : 1);
  }).catch((e) => {
    console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 1));
    process.exit(1);
  });
}

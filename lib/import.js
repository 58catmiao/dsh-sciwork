/**
 * 科研模式 · 面板导入（宿主侧，纯 Node，无第三方依赖）
 * ---------------------------------------------------------------------------
 * 面板上的「导入」按钮走这一层。写库被切成两段，各归其位：
 *
 *   1. **文件落位**（本模块）：把用户选的文件放进库里它该在的目录 ——
 *      `projects/<课题>/data|figures|drafts`、`refs/pdf`（新建）。只做「目录 + 文件」，
 *      绝不碰 `project.json` / `refs.json` / 图的侧车 JSON，**同名一律不覆盖**（自动改名）。
 *   2. **库登记**（`research.py`）：凡是写元数据的动作（add-ref / register-figure /
 *      new-project / add-submission / reindex）都由这里 spawn CLI 完成，
 *      沿用智能体那条路径的校验与幂等逻辑 —— 面板**不另开一份写入实现**。
 *
 * 为什么文件落位不塞进 research.py：CLI 没有「导入文件」子命令，而目录布局本身
 * 没有任何校验逻辑（真源是文件系统）。元数据一律仍是 CLI 的活，边界很清楚。
 *
 * 安全约束（面板是**本机会话认证过**的浏览器，但仍按不受信任输入处理）：
 *   - 目标目录只可能是四个白名单位置；每个落点都再验一次「在库根之内」。
 *   - 文件名取 basename、剥控制字符、替换 Windows 非法字符、限长 120。
 *   - 扩展名按目标白名单；单文件 ≤ 32 MiB、单次 ≤ 64 MiB。
 *   - 本机路径导入只**复制**（绝不移动/删除用户原文件）。
 *   - 所有外部命令走 `<库根>/.research/scripts/research.py`（或 bundle 内模板），
 *     且显式带 `RESEARCH_LIBRARY=<库根>`，保证两边看到同一个库。
 */

import path from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';

import { loadSettings, toRel } from './library.js';
import { pickPython } from './config.js';

/** 导入目标（面板上的六种）。 */
export const TARGETS = ['refs', 'data', 'figures', 'drafts', 'project', 'submission'];

/** 单文件 / 单次总量上限（base64 走 JSON-RPC，别把宿主撑爆）。 */
export const LIMITS = { fileBytes: 32 * 1024 * 1024, totalBytes: 64 * 1024 * 1024 };

/** 每个目标允许的扩展名。 */
export const ACCEPT = {
  data: ['.csv', '.tsv', '.txt', '.xlsx', '.xls', '.dat', '.json', '.jdx', '.dx'],
  figures: ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.tif', '.tiff', '.pdf', '.eps'],
  drafts: ['.md', '.markdown', '.txt'],
  refs: ['.pdf', '.docx', '.doc', '.txt', '.md', '.ris', '.bib', '.enw'],
  project: [],
  submission: [],
};

/** 目标 → 库内相对目录（`{}` 表示课题 slug 占位）。 */
const TARGET_DIR = {
  data: 'projects/{project}/data',
  figures: 'projects/{project}/figures',
  drafts: 'projects/{project}/drafts',
  refs: 'refs/pdf',
};

/** 必须指定课题的目标。 */
const NEEDS_PROJECT = new Set(['data', 'figures', 'drafts']);

/** 允许指定子目录的目标（数据/图表/草稿 可以按文件夹归类存放）。 */
export const SUBDIR_TARGETS = ['data', 'figures', 'drafts'];

/** 子目录最深层数。 */
const MAX_SUBDIR_DEPTH = 3;

/** 需要 Python 才能完成登记的目标（其余目标没有 Python 也能落文件）。 */
const NEEDS_PYTHON = new Set(['refs', 'figures', 'project', 'submission']);

const fail = (code, message, details = {}) => ({ ok: false, error: { code, message, details } });
const done = (value) => ({ ok: true, value });

const asString = (v) => (typeof v === 'string' ? v.trim() : '');
const asArray = (v) => (Array.isArray(v) ? v.map((s) => asString(s)).filter(Boolean) : []);

/** 课题目录名：与 research.py 一样只允许 ASCII 安全字符。 */
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/* --------------------------------------------------------------- 文件名处理 */

/**
 * 把用户给的文件名收敛成安全的 basename。
 * 取最后一段、剥路径分隔符与控制字符、替换 Windows 非法字符、保留最后一个扩展名。
 * @param {unknown} name
 * @returns {string}
 */
export function sanitizeName(name) {
  let base = String(name ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  if (base === '' || base === '.' || base === '..') base = 'unnamed';
  if (base.length > 120) {
    const ext = path.extname(base).slice(0, 16);
    base = base.slice(0, 120 - ext.length) + ext;
  }
  return base;
}

/**
 * 目标目录里不重名的新名字（`a.csv` → `a-1.csv` → `a-2.csv` …）。
 * 面板**绝不覆盖**已有文件：宁可改名，也不动用户库里的东西。
 */
export async function uniqueName(dirAbs, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 0; i < 60; i += 1) {
    const candidate = i === 0 ? name : `${stem}-${i}${ext}`;
    try {
      await stat(path.join(dirAbs, candidate));
    } catch {
      return candidate;
    }
  }
  return `${stem}-${Date.now()}${ext}`;
}

/**
 * 把用户填的「子目录」收敛成安全的分段数组。
 * 允许 `ZT-1500-2h`、`2026/XRD`（最多 3 层）；拒绝绝对路径、盘符、`..`。
 * @param {unknown} input
 * @returns {{ ok: true, segments: string[], sub: string } | { ok: false, message: string }}
 */
export function sanitizeSubdir(input) {
  const raw = String(input ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!raw) return { ok: true, segments: [], sub: '' };
  if (/^[A-Za-z]:/.test(raw)) return { ok: false, message: '子目录只能是课题内的相对路径，别写盘符' };
  const parts = raw.split('/').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { ok: true, segments: [], sub: '' };
  if (parts.length > MAX_SUBDIR_DEPTH) return { ok: false, message: `子目录最多 ${MAX_SUBDIR_DEPTH} 层` };
  for (const part of parts) {
    if (part === '.' || part === '..') return { ok: false, message: '子目录里不能有 . 或 ..' };
    if (!/^[^<>:"|?*\u0000-\u001f]+$/.test(part)) return { ok: false, message: `子目录名里有非法字符：${part}` };
    if (part.length > 60) return { ok: false, message: `子目录名太长（>60）：${part}` };
  }
  return { ok: true, segments: parts, sub: parts.join('/') };
}

/* ------------------------------------------------------------ 解释器与脚本 */

/**
 * 能用的 Python 解释器。没有就返回 null，由调用方决定怎么退化。
 * 候选顺序见 `lib/config.js` → `pythonCandidates()`：
 * 显式配置 → `SCIWORK_PYTHON` → 库自己的 venv → Origin 插件 venv → PATH 上的 python3/python。
 */
export function pickInterpreter(settings) {
  return pickPython({
    root: settings?.root,
    interpreter: settings?.interpreter,
    originPluginDir: (settings?.origin && settings.origin.pluginDir) || null,
  });
}

/** 用哪份 research.py：库里装的那份优先，退回 bundle 里的模板。 */
export function pickScript(settings) {
  const inLib = path.join(settings.root, '.research', 'scripts', 'research.py');
  if (existsSync(inLib)) return inLib;
  const inBundle = path.join(settings.bundleDir || '', 'library', 'scripts', 'research.py');
  return existsSync(inBundle) ? inBundle : null;
}

/* --------------------------------------------------------------- 跑 research.py */

/**
 * 跑一次 research.py 子命令，收 JSON 结果。
 * 永远 resolve（不抛）：CLI 退出码非 0 也是一种**结果**，面板要照实显示。
 * @returns {Promise<{label:string, args:string[], code:number, ok:boolean, summary:string, warnings:string[], raw:object|null, stderr:string}>}
 */
export function runResearch(settings, args, { label, timeoutMs = 90_000 } = {}) {
  const out = { label: label || ['research.py', ...args].join(' '), args, code: -1, ok: false, summary: '', warnings: [], raw: null, stderr: '' };
  const interpreter = pickInterpreter(settings);
  const script = pickScript(settings);
  if (!interpreter) {
    out.stderr = '本机找不到可用的 Python 解释器（settings.interpreter 不存在）';
    return Promise.resolve(out);
  }
  if (!script) {
    out.stderr = `找不到 research.py（${settings.root}\\.research\\scripts\\ 与 bundle 模板都不存在）`;
    return Promise.resolve(out);
  }

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(interpreter, [script, ...args], {
        cwd: settings.root,
        windowsHide: true,
        env: {
          ...process.env,
          RESEARCH_LIBRARY: settings.root,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
        },
      });
    } catch (error) {
      out.stderr = `无法启动 ${interpreter}：${String((error && error.message) || error)}`;
      resolve(out);
      return;
    }

    let stdout = '';
    let stderr = '';
    let finished = false;
    const settle = () => {
      if (finished) return;
      finished = true;
      out.stderr = stderr.slice(-4000);
      const parsed = parseLastJson(stdout);
      if (parsed) {
        out.raw = parsed;
        out.ok = parsed.ok === true;
        out.summary = asString(parsed.summary) || (out.ok ? '已完成' : asString(parsed.error));
        out.warnings = asArray(parsed.warnings);
        if (!out.ok && !out.summary) out.summary = asString(parsed.error) || '命令返回失败';
      } else {
        out.summary = stderr.trim().split(/\r?\n/).slice(-3).join(' ') || `退出码 ${out.code}`;
      }
      resolve(out);
    };

    const timer = setTimeout(() => {
      out.stderr = `超时 ${timeoutMs} ms，已结束等待（子进程可能还在跑）`;
      try { child.kill(); } catch { /* 忽略 */ }
      settle();
    }, timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => { stdout = (stdout + chunk).slice(-200_000); });
    child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk).slice(-50_000); });
    child.on('error', (error) => {
      out.stderr = `子进程错误：${String((error && error.message) || error)}`;
      clearTimeout(timer);
      settle();
    });
    child.on('close', (code) => {
      out.code = typeof code === 'number' ? code : -1;
      clearTimeout(timer);
      settle();
    });
  });
}

/** research.py 用 emit() 在 stdout 末尾写一段 JSON；取最后一个能解析的对象。 */
export function parseLastJson(text) {
  const src = String(text || '');
  for (let end = src.lastIndexOf('}'); end !== -1; end = src.lastIndexOf('}', end - 1)) {
    for (let start = src.lastIndexOf('{', end); start !== -1; start = src.lastIndexOf('{', start - 1)) {
      try {
        const obj = JSON.parse(src.slice(start, end + 1));
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
      } catch { /* 继续往前找 */ }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ 落位 */

const decodeBase64 = (b64) => {
  const clean = String(b64 || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!clean) throw new Error('文件内容为空（base64 为空）');
  if (clean.length > Math.ceil((LIMITS.fileBytes * 4) / 3) + 1024) {
    throw new Error(`文件过大（base64 ${clean.length} 字符 > 上限 ${LIMITS.fileBytes} B）`);
  }
  const buf = Buffer.from(clean, 'base64');
  if (buf.length === 0) throw new Error('文件内容解码后为空');
  if (buf.length > LIMITS.fileBytes) throw new Error(`文件过大（${buf.length} B > ${LIMITS.fileBytes} B）`);
  return buf;
};

/**
 * 把一个文件写进库内目录。
 * `accept` 由调用方（importBatch）按**导入目标**传入；不要从目录名倒推目标 ——
 * 子目录可以叫 `refs/pdf`（用户完全可能这么命名），按后缀猜会把 .csv 误判成文献附件。
 * @returns {Promise<{name:string, path:string, abs:string, bytes:number, from:string}>}
 */
async function placeBuffer(root, dirAbs, name, buf, from, accept = null) {
  const safe = sanitizeName(name);
  const ext = path.extname(safe).toLowerCase();
  const allow = Array.isArray(accept) ? accept : null;
  if (allow && allow.length && !allow.includes(ext)) {
    throw new Error(`不接受 ${ext || '(无扩展名)'} 文件（可用：${allow.join(' ')}）`);
  }
  await mkdir(dirAbs, { recursive: true });
  const final = await uniqueName(dirAbs, safe);
  const dest = path.join(dirAbs, final);
  const relBack = path.relative(root, dest);
  if (relBack.startsWith('..') || path.isAbsolute(relBack)) throw new Error('落点越出科研库范围');
  await writeFile(dest, buf);
  return { name: final, path: toRel(root, dest), abs: dest, bytes: buf.length, from };
}

/* ------------------------------------------------------------------ 计划 */

/**
 * 按目标算出要跑哪些 research.py（纯函数，便于自测）。
 * @param {{target:string, project?:string, placed?:object[], meta?:object}} spec
 * @returns {{label:string, args:string[]}[]}
 */
export function planResearchCalls(spec) {
  const target = asString(spec.target);
  const project = asString(spec.project);
  const placed = Array.isArray(spec.placed) ? spec.placed : [];
  const meta = (spec.meta && typeof spec.meta === 'object') ? spec.meta : {};
  const calls = [];

  if (target === 'refs') {
    const file = placed[0];
    const args = ['add-ref', '--title', asString(meta.title)];
    const authors = asString(meta.authors);
    if (authors) args.push('--authors', authors);
    if (meta.year) args.push('--year', String(meta.year).replace(/[^0-9]/g, '').slice(0, 4));
    if (asString(meta.container)) args.push('--container', asString(meta.container));
    if (asString(meta.doi)) args.push('--doi', asString(meta.doi));
    if (asString(meta.url)) args.push('--url', asString(meta.url));
    if (asString(meta.type)) args.push('--type', asString(meta.type));
    if (asString(meta.notes)) args.push('--notes', asString(meta.notes));
    if (asString(meta.key)) args.push('--key', asString(meta.key));
    if (project) args.push('--project', project);
    // 面板填的元数据一律记 user-supplied —— 没有解析过 DOI，不冒充 doi-resolved。
    args.push('--verified-by', 'user-supplied');
    args.push('--source', file ? file.path : (asString(meta.source) || 'panel-import'));
    calls.push({ label: 'add-ref', args });
    return calls;
  }

  if (target === 'figures') {
    const datas = asArray(meta.data).map((d) => (path.isAbsolute(d) ? d : path.join(spec.root || '', d)));
    for (const f of placed) {
      const args = ['register-figure', '--project', project, '--file', f.abs];
      if (asString(meta.caption)) args.push('--caption', asString(meta.caption));
      if (asString(meta.graph)) args.push('--graph', asString(meta.graph));
      if (asString(meta.journal)) args.push('--journal', asString(meta.journal));
      for (const d of datas) args.push('--data', d);
      calls.push({ label: `register-figure ${f.name}`, args });
    }
    return calls;
  }

  if (target === 'project') {
    const args = ['new-project', asString(meta.slug)];
    if (asString(meta.title)) args.push('--title', asString(meta.title));
    if (asString(meta.journal)) args.push('--journal', asString(meta.journal));
    calls.push({ label: 'new-project', args });
    return calls;
  }

  if (target === 'submission') {
    const args = ['add-submission', '--journal', asString(meta.journal)];
    if (asString(meta.title)) args.push('--title', asString(meta.title));
    if (project) args.push('--project', project);
    if (asString(meta.type)) args.push('--type', asString(meta.type));
    if (asString(meta.status)) args.push('--status', asString(meta.status));
    if (asString(meta.nextAction)) args.push('--next-action', asString(meta.nextAction));
    if (asString(meta.nextActionDue)) args.push('--next-action-due', asString(meta.nextActionDue));
    if (asString(meta.manuscriptId)) args.push('--manuscript-id', asString(meta.manuscriptId));
    if (asString(meta.note)) args.push('--note', asString(meta.note));
    calls.push({ label: 'add-submission', args });
    return calls;
  }

  // 数据 / 草稿没有元数据可写，只重建索引让面板的「索引时间」跟上。
  calls.push({ label: 'reindex', args: ['reindex'] });
  return calls;
}

/* ------------------------------------------------------------------ 入口 */

/**
 * 一次导入。
 * @param {object} spec - `{ target, project, files:[{name,base64}], paths:[绝对路径], meta }`
 * @returns {Promise<{ok:true,value:object}|{ok:false,error:{code:string,message:string,details:object}}>}
 */
export async function importBatch(spec = {}) {
  const settings = await loadSettings();
  const root = settings.root;
  const target = asString(spec.target);
  const project = asString(spec.project);
  const meta = (spec.meta && typeof spec.meta === 'object' && !Array.isArray(spec.meta)) ? spec.meta : {};
  const files = Array.isArray(spec.files) ? spec.files.filter((f) => f && typeof f === 'object') : [];
  const rawPaths = asArray(spec.paths);

  if (!TARGETS.includes(target)) {
    return fail('bad-request', `未知导入目标：${target || '(空)'}。可用：${TARGETS.join(', ')}`);
  }
  if (!existsSync(root)) return fail('not-found', `科研库根目录不存在：${root}`);

  if (NEEDS_PROJECT.has(target)) {
    if (!SLUG_RE.test(project)) return fail('bad-request', `课题 slug 不合法：${project || '(空)'}`);
    if (!existsSync(path.join(root, 'projects', project))) {
      return fail('not-found', `课题不存在：${project}。先用「新课题」建，或换一个已有课题。`);
    }
  }

  // 子目录：只有数据/图表/草稿能按文件夹归类（别的地方给了就明确报错，不静默忽略）
  const subdirWanted = asString(spec.subdir);
  let sub = '';
  if (subdirWanted) {
    if (!SUBDIR_TARGETS.includes(target)) {
      return fail('bad-request', `「${target}」不支持子目录（可用：「${SUBDIR_TARGETS.join('」「')}」）`);
    }
    const checked = sanitizeSubdir(subdirWanted);
    if (!checked.ok) return fail('bad-request', checked.message);
    sub = checked.sub;
  }

  // —— 纯元数据目标的早校验：先拒掉，别让用户白填一遍之后才报错 ——
  if (target === 'refs') {
    if (!asString(meta.title)) return fail('bad-request', '文献至少要一个标题');
    if (!asString(meta.doi) && !asString(meta.url)) {
      return fail('bad-request', '没有 DOI 也没有 URL 的记录不入库（引用零编造）——请补一个再来。');
    }
    if (project && !SLUG_RE.test(project)) return fail('bad-request', `课题 slug 不合法：${project}`);
  }
  if (target === 'project' && !SLUG_RE.test(asString(meta.slug) || project)) {
    return fail('bad-request', '新课题需要一个 slug（字母数字、- _ . ，60 字符内）');
  }
  if (target === 'submission') {
    const journal = asString(meta.journal);
    if (!journal) return fail('bad-request', '投稿记录必须指定期刊档案键');
    const journals = await journalIds(root);
    const hit = journals.find((j) => j.id === journal || j.name === journal || j.nameZh === journal);
    if (!hit) {
      return fail('bad-request', `找不到期刊档案：${journal}（已有：${journals.map((j) => j.id).join(', ')}）`);
    }
  }

  const interpreter = pickInterpreter(settings);
  const pythonReady = Boolean(interpreter && pickScript(settings));
  if (NEEDS_PYTHON.has(target) && !pythonReady) {
    return fail(
      'no-interpreter',
      '本机没有可用的 Python 解释器 / research.py，这一项导入无法登记（data 与 drafts 仍可直接落文件）。',
      { interpreter: interpreter || null, script: pickScript(settings) },
    );
  }

  const notes = [];
  if (!pythonReady && !NEEDS_PYTHON.has(target)) {
    notes.push('本机没有可用的 Python 解释器：文件已落位，但没有重建索引（research.py reindex 未跑）。');
  }

  const placed = [];
  try {
    const dirRel = TARGET_DIR[target];
    if (dirRel) {
      const baseAbs = path.join(root, dirRel.replace('{project}', project));
      const dirAbs = sub ? path.join(baseAbs, ...sanitizeSubdir(sub).segments) : baseAbs;
      // 双保险：子目录怎么填都不能越出这一类目录（baseAbs）
      const back = path.relative(baseAbs, dirAbs);
      if (back.startsWith('..') || path.isAbsolute(back)) throw new Error('子目录越出这一类目录范围');
      let total = 0;

      for (const f of files) {
        const buf = decodeBase64(f.base64);
        total += buf.length;
        if (total > LIMITS.totalBytes) throw new Error(`一次导入总量过大（> ${LIMITS.totalBytes} B）`);
        placed.push(await placeBuffer(root, dirAbs, f.name, buf, 'upload', ACCEPT[target] || null));
      }

      for (const p of rawPaths) {
        const abs = path.resolve(p);
        const info = await stat(abs).catch(() => null);
        if (!info || !info.isFile()) throw new Error(`不是文件（或不存在）：${p}`);
        if (info.size > LIMITS.fileBytes) throw new Error(`文件过大：${p}（${info.size} B）`);
        total += info.size;
        if (total > LIMITS.totalBytes) throw new Error(`一次导入总量过大（> ${LIMITS.totalBytes} B）`);
        await mkdir(dirAbs, { recursive: true });
        const safe = sanitizeName(path.basename(abs));
        const ext = path.extname(safe).toLowerCase();
        const allow = ACCEPT[target] || [];
        if (allow.length && !allow.includes(ext)) {
          throw new Error(`「${target}」不接受 ${ext || '(无扩展名)'} 文件（可用：${allow.join(' ')}）`);
        }
        const final = await uniqueName(dirAbs, safe);
        const dest = path.join(dirAbs, final);
        const relBack = path.relative(root, dest);
        if (relBack.startsWith('..') || path.isAbsolute(relBack)) throw new Error('落点越出科研库范围');
        await copyFile(abs, dest);
        placed.push({ name: final, path: toRel(root, dest), abs: dest, bytes: info.size, from: 'path' });
      }
    }
  } catch (error) {
    const msg = String((error && error.message) || error);
    const code = /过大|不接受|不是文件|为空/.test(msg)
      ? 'bad-request'
      : (/越出科研库范围|只接受库根相对路径/.test(msg) ? 'denied' : 'internal');
    return fail(code, msg, { target, placed });
  }

  const calls = planResearchCalls({ target, project, placed, meta: { ...meta, slug: asString(meta.slug) || project }, root });
  const ran = [];
  for (const call of calls) {
    // eslint-disable-next-line no-await-in-loop -- 顺序执行：后一步可能依赖前一步写下的文件
    ran.push(await runResearch(settings, call.args, { label: call.label }));
  }

  const failedCall = ran.find((r) => !r.ok);
  const summaryBits = [
    placed.length ? `落下 ${placed.length} 个文件` : '',
    ran.filter((r) => r.ok).map((r) => r.summary).filter(Boolean).join('；'),
  ].filter(Boolean);

  if (failedCall) {
    return fail('cli-failed', `登记失败（${failedCall.label}）：${failedCall.summary}`, {
      target,
      placed: placed.map(stripAbs),
      ran: ran.map(stripAbsRun),
      stderr: failedCall.stderr,
    });
  }

  return done({
    target,
    root,
    project: project || null,
    subdir: sub || null,
    placed: placed.map(stripAbs),
    ran: ran.map(stripAbsRun),
    notes,
    summary: summaryBits.join('；') || '没有变化',
  });
}

/** 面板只需要相对路径，绝对路径留在宿主内部。 */
const stripAbs = (f) => ({ name: f.name, path: f.path, bytes: f.bytes, from: f.from });
const stripAbsRun = (r) => ({ label: r.label, ok: r.ok, code: r.code, summary: r.summary, warnings: r.warnings, args: r.args });

/** journals\*.json 的 id/name（投稿时给面板校验用）。 */
async function journalIds(root) {
  const dir = path.join(root, 'journals');
  const out = [];
  const { readdir, readFile } = await import('node:fs/promises');
  let names = [];
  try { names = await readdir(dir); } catch { return out; }
  for (const n of names) {
    if (!n.toLowerCase().endsWith('.json') || n.startsWith('_')) continue;
    let j = {};
    try { j = JSON.parse(await readFile(path.join(dir, n), 'utf8')); } catch { j = {}; }
    out.push({ id: j.id || path.basename(n, '.json'), name: j.name || '', nameZh: j.nameZh || '' });
  }
  return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/** 面板打开导入弹层时问一次：白名单、上限、Python 是否可用。 */
export async function importInfo() {
  const settings = await loadSettings();
  const interpreter = pickInterpreter(settings);
  const script = pickScript(settings);
  return done({
    root: settings.root,
    targets: TARGETS,
    subdirTargets: SUBDIR_TARGETS,
    subdirMaxDepth: MAX_SUBDIR_DEPTH,
    accept: ACCEPT,
    limits: LIMITS,
    python: { available: Boolean(interpreter && script), interpreter: interpreter || null, script: script || null },
  });
}

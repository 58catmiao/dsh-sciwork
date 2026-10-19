/**
 * 科研模式 · 面板动作分发（宿主侧）
 * ---------------------------------------------------------------------------
 * 面板（浏览器半边）只会发**一个** RPC：
 *     channel = '/api'， endpoint = 'research/call'，
 *     payload = { action: string, args: object }
 * 本文件把 action 翻译成一次库操作，并统一成 Connection 的返回信封：
 *     { ok: true, value }  |  { ok: false, error: { code, message, details } }
 *
 * 设计口径（别越界）：
 *   - **读 + 导入 + 重画**。元数据写入一律 spawn `research.py`（new-project /
 *     add-ref / register-figure / add-submission / reindex），面板不另写一份实现；
 *     文件落位由 `lib/import.js` 负责（只复制、不移动、同名不覆盖）。
 *   - 面板**不改**登记记录本身（refs.json / 侧车 / submissions 的编辑仍由智能体跑 CLI）。
 *     归档 / 删除只动磁盘文件，并记 `.research/archive/<时间戳>/manifest.json`。
 *   - 所有路径参数都经 `library.resolveInside` 收敛在库根之内（拒绝绝对路径与 `..`）。
 *   - 本文件不 import cordis/Cordis 任何东西，因此可以用普通 node 直接自测
 *     （见 scripts/selftest-actions.mjs）。
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  checkCitations,
  createDraft,
  loadSettings,
  readBinary,
  readText,
  resolveInside,
  snapshot,
  toRel,
  tableColumns,
  writeTextBackup,
} from './library.js';
import { replotFigure } from './replot.js';
import { importBatch, importInfo, runResearch } from './import.js';
import { archiveEntries, archiveInfo, removeEntries, restoreEntries } from './archive.js';
import { fetchRefMeta } from './refmeta.js';
import { TRANSFORM_OPS, runTransform, tableToCsv } from './transform.js';
import { parseTable } from './table.js';
import { launcherPath } from './config.js';

/** 面板能看懂的动作名（错误信息里会列出）。 */
export const ACTIONS = [
  'snapshot', 'readText', 'readBinary', 'tableColumns', 'checkCitations', 'replot', 'cliHint',
  'import', 'importInfo', 'archive', 'remove', 'restore', 'archiveInfo', 'fetchRefMeta', 'writeText', 'newDraft', 'removeRef',
  'cliCommands', 'runCli',
  'transformOps', 'tablePreview', 'tableTransform',
  'checkJournal', 'exportPackage',
];

/* ---------------------------------------------------------------- 命令台 */

/**
 * `research.py` 子命令的元数据（参数名/类型直接从 argparse 定义抄，别让面板硬编码）。
 * kind: read=只读 · write=写库 · danger=不可逆（需要面板显式确认）。
 * args.type: string | int | bool | select | path | list（list = 可重复 append）
 */
export const CLI_COMMANDS = [
  { id: 'status', kind: 'read', desc: '库概况：课题数、文献数、已登记图数、期刊档案', args: [] },
  {
    id: 'search', kind: 'read', desc: '跨课题检索（课题/图/稿/数据/文献/期刊/投稿）',
    args: [
      { name: 'query', required: true, placeholder: '关键词' },
      { name: '--kind', type: 'select', options: ['ref', 'figure', 'draft', 'dataset', 'table', 'journal', 'project', 'submission'] },
      { name: '--project' },
      { name: '--limit', type: 'int', placeholder: '20' },
    ],
  },
  {
    id: 'check-citations', kind: 'read', desc: '引用核查闸门：非零退出 = 有缺失/未核实的引用',
    args: [
      { name: '--draft', type: 'path', required: true, placeholder: 'projects/<课题>/drafts/xx.md' },
      { name: '--require-doi', type: 'bool' },
    ],
  },
  {
    id: 'list-figures', kind: 'read', desc: '列已登记图', args: [{ name: '--project' }],
  },
  {
    id: 'list-refs', kind: 'read', desc: '列/搜文献',
    args: [{ name: '--project' }, { name: '--query' }],
  },
  {
    id: 'list-projects', kind: 'read', desc: '列课题', args: [],
  },
  {
    id: 'list-submissions', kind: 'read', desc: '列/筛投稿记录',
    args: [
      { name: '--project' }, { name: '--journal' },
      { name: '--status', type: 'select', options: ['drafting', 'submitted', 'under-review', 'revision', 'accepted', 'rejected', 'withdrawn', 'published'] },
      { name: '--active', type: 'bool' }, { name: '--due', type: 'bool' },
    ],
  },
  {
    id: 'register-figure', kind: 'write', desc: '登记一张图的溯源侧车',
    args: [
      { name: '--project', required: true }, { name: '--file', type: 'path', required: true },
      { name: '--data', type: 'list', help: '源数据，可多次' }, { name: '--graph' },
      { name: '--journal' }, { name: '--caption' }, { name: '--opju', type: 'path' },
      { name: '--spec', type: 'path' }, { name: '--figure-id' },
    ],
  },
  {
    id: 'add-ref', kind: 'write', desc: '文献入库（必须带 DOI 或 URL，引用零编造）',
    args: [
      { name: '--title', required: true }, { name: '--authors' }, { name: '--year', type: 'int' },
      { name: '--container' }, { name: '--volume' }, { name: '--issue' }, { name: '--pages' },
      { name: '--doi' }, { name: '--url' },
      { name: '--type', type: 'select', options: ['article', 'book', 'inproceedings', 'thesis', 'report', 'preprint', 'misc'] },
      { name: '--project', type: 'list' }, { name: '--key' }, { name: '--notes' },
      { name: '--verified-by', type: 'select', options: ['doi-resolved', 'url-fetched', 'user-supplied', 'unverified'] },
      { name: '--force', type: 'bool' },
    ],
  },
  {
    id: 'add-submission', kind: 'write', desc: '登记一次投稿',
    args: [
      { name: '--journal', required: true }, { name: '--project' }, { name: '--title' },
      { name: '--type', type: 'select', options: ['research-article', 'review', 'letter', 'communication', 'conference-paper', 'thesis', 'preprint', 'other'] },
      { name: '--status', type: 'select', options: ['drafting', 'submitted', 'under-review', 'revision', 'accepted', 'rejected', 'withdrawn', 'published'] },
      { name: '--manuscript', type: 'path' }, { name: '--manuscript-id' }, { name: '--doi' },
      { name: '--next-action' }, { name: '--next-action-due' }, { name: '--note' },
    ],
  },
  {
    id: 'new-project', kind: 'write', desc: '新建课题（slug 是位置参数，必填）',
    args: [
      { name: 'slug', required: true, placeholder: 'zt-ceremic' },
      { name: '--title' }, { name: '--journal' },
    ],
  },
  {
    id: 'update-submission', kind: 'write', desc: '推进投稿状态 / 记事件 / 改下一步',
    args: [
      { name: 'id', required: true },
      { name: '--status', type: 'select', options: ['drafting', 'submitted', 'under-review', 'revision', 'accepted', 'rejected', 'withdrawn', 'published'] },
      { name: '--note' }, { name: '--next-action' }, { name: '--next-action-due' },
    ],
  },
  {
    id: 'check-journal', kind: 'read', desc: '投稿合规体检：图尺寸/DPI/栏宽、摘要字数、引用键与 DOI',
    args: [
      { name: '--project', required: true },
      { name: '--journal', placeholder: '期刊档案键（缺省取 project.json）' },
      { name: '--draft', type: 'path', placeholder: 'projects/<课题>/drafts/xx.md' },
      { name: '--submission', placeholder: '投稿记录 id' },
    ],
  },
  {
    id: 'export-package', kind: 'write', desc: '导出投稿包 zip（稿件 + 图 + 数据 + refs.bib + manifest）',
    args: [
      { name: '--project', required: true },
      { name: '--journal' },
      { name: '--submission' },
      { name: '--draft', type: 'path' },
    ],
  },
  { id: 'reindex', kind: 'write', desc: '重建库索引', args: [] },
  { id: 'export-bib', kind: 'write', desc: '重建 refs.bib', args: [] },
  { id: 'init', kind: 'write', desc: '建/修复库骨架（幂等）', args: [] },
  {
    id: 'remove-ref', kind: 'danger', desc: '删掉一条文献登记（先备份 refs.json）',
    args: [{ name: '--key' }, { name: '--doi' }],
  },
];

/** 命令台：把 spec 变成真实 argv。空值一律不传；bool 为真才加开关；list 每个值一个参数。 */
export function buildCliArgs(command, values = {}) {
  const args = [command.id];
  for (const a of command.args || []) {
    const v = values[a.name];
    if (v === undefined || v === null) continue;
    if (a.type === 'bool') { if (v === true || v === 'true' || v === '1') args.push(a.name); continue; }
    const s = String(v).trim();
    if (!s) continue;
    if (a.type === 'list') { for (const one of s.split(/[;\n]/).map((x) => x.trim()).filter(Boolean)) args.push(a.name, one); continue; }
    // 位置参数（名字不带 --）只推值，不推参数名
    if (a.name.startsWith('--')) args.push(a.name);
    args.push(s);
  }
  return args;
}

/** 原始参数模式：只放行 --k v / --flag / 位置参数，禁换行与分号（防拼接注入）。 */
export function parseRawArgs(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  if (/[\r\n;]/.test(s)) throw new Error('原始参数里不能有换行或分号');
  if (s.length > 2000) throw new Error('原始参数太长了');
  return s.split(/\s+/).filter(Boolean);
}

/** 写库动作 → 交给智能体的 CLI 模板（面板只展示，不执行）。 */
export const CLI_HINTS = {
  newProject: '研究库 · 新建课题\n\n请用 research.py 建课题：\n  <库>\\.research\\bin\\py.cmd .research\\scripts\\research.py new-project <slug> --title "<标题>" [--journal <期刊id>]',
  addRef: '研究库 · 加文献\n\n请用 research.py 登记文献（必须带 DOI 或 URL，引用零编造）：\n  <库>\\.research\\bin\\py.cmd .research\\scripts\\research.py add-ref --title "<标题>" --authors "<作者>" --year <年> --container "<期刊>" --doi <DOI> --project <slug>',
  registerFigure: '研究库 · 登记出图溯源\n\n请用 research.py 把图登记进库：\n  <库>\\.research\\bin\\py.cmd .research\\scripts\\research.py register-figure --project <slug> --file <图文件> --data <源数据> --graph <Origin图页> --journal <期刊id> --caption "<图注>"',
  reindex: '研究库 · 重建索引\n\n  <库>\\.research\\bin\\py.cmd .research\\scripts\\research.py reindex',
  checkCitations: '研究库 · 引用核查（命令行口径）\n\n  <库>\\.research\\bin\\py.cmd .research\\scripts\\research.py check-citations --draft <草稿路径>',
  checkJournal: '研究库 · 投稿体检\n\n请用 research.py 对照期刊档案体检：\n  <库>\\.research\\bin\\py.cmd .research\\scripts\\research.py check-journal --project <slug> [--journal <期刊id>] [--draft <稿>] [--submission <投稿id>]',
  exportPackage: '研究库 · 导出投稿包\n\n请用 research.py 打包（写到 submissions/packages/）：\n  <库>\\.research\\bin\\py.cmd .research\\scripts\\research.py export-package --project <slug> [--journal <期刊id>] [--submission <投稿id>]',
};

/* ------------------------------------------------- 数据变换（面板内，不必经 agent） */

const TABLE_OUT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** 读一张数据表（自己读盘：readText 是"预览"通道，有 512 KB 上限且返回对象，数据表动辄几 MB）。 */
async function readTableAbs(root, rel) {
  const abs = resolveInside(root, rel);
  const info = fs.statSync(abs);
  if (!info.isFile()) throw new Error('不是一个文件');
  if (info.size > 64 * 1024 * 1024) throw new Error(`数据文件 ${Math.round(info.size / 1048576)} MB 太大，面板不处理（请让智能体走 Origin 或分块）`);
  const table = parseTable(fs.readFileSync(abs, 'utf8'));
  return { abs, bytes: info.size, table };
}

const fail = (code, message, details = {}) => ({ ok: false, error: { code, message, details } });
const done = (value) => ({ ok: true, value });

const asString = (v) => (typeof v === 'string' ? v.trim() : '');
const asArray = (v) => (Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : []);

/** 必须带 path 参数的只读动作。空 path 属于**客户端错误**，不要混进 denied（那是安全拒绝）。 */
const PATH_ACTIONS = new Set(['readText', 'readBinary', 'tableColumns', 'checkCitations']);

/** 把任何异常收敛成面板能显示的 message。 */
const KNOWN_CODES = new Set(['bad-request', 'not-found', 'denied', 'busy', 'timeout', 'network', 'internal', 'cli-failed']);
const describe = (error) => {
  const explicit = error && typeof error.code === 'string' ? error.code : '';
  const msg = String((error && error.message) || error || '未知错误');
  if (explicit && KNOWN_CODES.has(explicit)) return { code: explicit, message: msg };
  if (/ENOENT|no such file|文件不存在|课题不存在/.test(msg)) return { code: 'not-found', message: msg };
  if (/只接受库根相对路径|路径越出科研库范围|空路径|只允许动|只允许编辑|不能从面板改|不能归档|不能删|必须在本课题目录里|必须都在本课题里/.test(msg)) {
    return { code: 'denied', message: msg };
  }
  if (/过大|不是可预览|不支持的二进制|不合法|已经有|单调|方向不一致|重复值|没有可用的数值/.test(msg)) return { code: 'bad-request', message: msg };
  if (/锁|lock|正在重画/i.test(msg)) return { code: 'busy', message: msg };
  return { code: 'internal', message: msg };
};

/** 归档/删除/恢复之后重建索引（索引失败不算动作失败，如实附在结果里）。 */
async function reindexAfter(settings, value) {
  const run = await runResearch(settings, ['reindex'], { label: 'reindex' });
  return {
    ...value,
    reindex: {
      ok: run.ok,
      code: run.code,
      summary: run.summary,
      warnings: run.warnings,
      stderr: run.ok ? '' : String(run.stderr || '').slice(0, 300),
    },
  };
}

/**
 * 处理一次面板调用。
 * @param {unknown} payload - 线上下来的 `{ action, args }`（可能是任何东西，需自证）。
 * @returns {Promise<{ok:true,value:unknown}|{ok:false,error:{code:string,message:string,details:object}}>}
 */
export async function handleResearchCall(payload) {
  const body = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  const action = asString(body.action);
  const args = (body.args && typeof body.args === 'object' && !Array.isArray(body.args)) ? body.args : {};

  if (!action) return fail('bad-request', `缺少 action。可用动作：${ACTIONS.join(', ')}`);
  if (PATH_ACTIONS.has(action) && !asString(args.path)) {
    return fail('bad-request', `${action} 需要 path（库根相对路径）`);
  }

  try {
    switch (action) {
      case 'snapshot':
        return done(await snapshot());

      case 'readText': {
        const settings = await loadSettings();
        return done(await readText(settings.root, asString(args.path)));
      }

      case 'readBinary': {
        const settings = await loadSettings();
        return done(await readBinary(settings.root, asString(args.path)));
      }

      case 'tableColumns': {
        const settings = await loadSettings();
        return done(await tableColumns(settings.root, asString(args.path)));
      }

      case 'checkCitations': {
        const settings = await loadSettings();
        const result = await checkCitations(settings.root, asString(args.path));
        return done({
          ...result,
          okFlag: result.missing.length === 0 && result.cited.length > 0,
          caveat: '本核查只能证明「每个引用键都能在库里找到、且该条带有 DOI 或 URL」；它不能证明被引文献的内容真的支持这句话。',
        });
      }

      /* 体检 / 打包：真正的判断与写盘都在 research.py 里（面板不另写一份规则）。
         体检有不合格项时脚本退出码是 1，但 JSON 里 ok 仍是 true——数字是给人看的，
         不是请求失败；只有在拿不到 JSON 或脚本明确报错时才回错误信封。 */
      case 'checkJournal': {
        const project = asString(args.project);
        if (!project) return fail('bad-request', 'checkJournal 需要 project（课题 slug）');
        const settings = await loadSettings();
        const argv = ['check-journal', '--project', project];
        if (asString(args.journal)) argv.push('--journal', asString(args.journal));
        if (asString(args.draft)) argv.push('--draft', asString(args.draft));
        if (asString(args.submission)) argv.push('--submission', asString(args.submission));
        const run = await runResearch(settings, argv, { label: 'check-journal', timeoutMs: 120_000 });
        if (!run.raw) {
          return fail('cli-failed', run.summary || '体检没有返回 JSON', { stderr: String(run.stderr || '').slice(0, 300) });
        }
        if (run.raw.ok !== true) {
          return fail('bad-request', String(run.raw.error || run.summary || '体检失败'));
        }
        return done({ ...run.raw, exitCode: run.code });
      }

      case 'exportPackage': {
        const project = asString(args.project);
        if (!project) return fail('bad-request', 'exportPackage 需要 project（课题 slug）');
        const settings = await loadSettings();
        const argv = ['export-package', '--project', project];
        if (asString(args.journal)) argv.push('--journal', asString(args.journal));
        if (asString(args.submission)) argv.push('--submission', asString(args.submission));
        if (asString(args.draft)) argv.push('--draft', asString(args.draft));
        const run = await runResearch(settings, argv, { label: 'export-package', timeoutMs: 180_000 });
        if (!run.raw) {
          return fail('cli-failed', run.summary || '打包没有返回 JSON', { stderr: String(run.stderr || '').slice(0, 300) });
        }
        if (run.raw.ok !== true) {
          return fail('bad-request', String(run.raw.error || run.summary || '打包失败'));
        }
        return done({ ...run.raw, warnings: run.warnings });
      }

      case 'cliHint': {
        const key = asString(args.key);
        if (key && CLI_HINTS[key]) return done({ key, text: CLI_HINTS[key] });
        return done({ hints: CLI_HINTS });
      }

      case 'replot': {
        const sidecar = asString(args.sidecar);
        if (!sidecar) return fail('bad-request', 'replot 需要 sidecar（库根相对路径的图侧车 JSON）');
        const result = await replotFigure({
          sidecarRel: sidecar,
          xColumn: asString(args.x) || undefined,
          yColumns: asArray(args.y).length ? asArray(args.y) : undefined,
          title: asString(args.title) || undefined,
          styleMode: asString(args.styleMode) || undefined,
          plotType: asString(args.plotType) || undefined,
          register: args.register !== false,
        });
        return done(result);
      }

      case 'import':
        return await importBatch(args);

      case 'importInfo':
        return await importInfo();

      case 'archive': {
        const res = await archiveEntries({ entries: args.entries, reason: asString(args.reason) });
        if (res.ok === false) return res;
        return done(await reindexAfter(await loadSettings(), res.value));
      }

      case 'remove': {
        const res = await removeEntries({ entries: args.entries, confirm: args.confirm, reason: asString(args.reason) });
        if (res.ok === false) return res;
        return done(await reindexAfter(await loadSettings(), res.value));
      }

      case 'restore': {
        const res = await restoreEntries({ id: asString(args.id), paths: asArray(args.paths) });
        if (res.ok === false) return res;
        return done(await reindexAfter(await loadSettings(), res.value));
      }

      case 'archiveInfo':
        return await archiveInfo();

      case 'fetchRefMeta':
        return await fetchRefMeta({ doi: args.doi });

      case 'writeText': {
        const path = asString(args.path);
        if (!path) return fail('bad-request', 'writeText 需要 path（库根相对路径）');
        if (typeof args.text !== 'string') return fail('bad-request', 'writeText 需要 text（字符串）');
        const settings = await loadSettings();
        return done(await writeTextBackup(settings.root, path, args.text));
      }

      case 'newDraft': {
        const project = asString(args.project);
        const name = asString(args.name);
        if (!project) return fail('bad-request', 'newDraft 需要 project（课題 slug）');
        if (!name) return fail('bad-request', 'newDraft 需要 name（草稿文件名，可省略 .md）');
        const settings = await loadSettings();
        const value = await createDraft(settings.root, { project, name, title: asString(args.title) });
        return done(await reindexAfter(settings, value));
      }

      /* 删文献条目：面板不许直接改 refs.json（登记索引），所以走库脚本 remove-ref ——
         它会先备份 refs.json，再同步 refs.bib，并报出还有哪些草稿在引用这个键。 */
      case 'removeRef': {
        const key = asString(args.key);
        const doi = asString(args.doi);
        if (!key && !doi) return fail('bad-request', 'removeRef 需要 key（引用键）或 doi');
        const settings = await loadSettings();
        const run = await runResearch(settings, ['remove-ref', key ? '--key' : '--doi', key || doi], { label: 'remove-ref' });
        if (!run.ok) {
          const message = run.summary || '删除文献失败';
          const code = /没有这条文献/.test(message) ? 'not-found' : 'bad-request';
          return fail(code, message, { stderr: String(run.stderr || '').slice(0, 300) });
        }
        const value = { ...(run.raw || {}) };
        delete value.ok;
        value.warnings = run.warnings;
        return done(await reindexAfter(settings, value));
      }

      case 'cliCommands': {
        const settings = await loadSettings();
        return done({ commands: CLI_COMMANDS, launcher: launcherPath(settings.root) });
      }

      case 'runCli': {
        const id = asString(args.id);
        const command = CLI_COMMANDS.find((c) => c.id === id);
        if (!command) {
          return fail('bad-request', `命令台只放行白名单子命令：${CLI_COMMANDS.map((c) => c.id).join(', ')}`);
        }
        if (command.kind === 'danger' && args.confirm !== true) {
          return fail('bad-request', `「${command.id}」是不可逆操作，需要显式确认（confirm=true）`);
        }
        let argv;
        try {
          argv = args.raw ? [command.id, ...parseRawArgs(args.raw)] : buildCliArgs(command, args.values || {});
        } catch (error) {
          return fail('bad-request', String(error.message || error));
        }
        if (!args.raw) {
          const values = args.values || {};
          const missing = (command.args || []).filter((a) => a.required && !asString(values[a.name]));
          if (missing.length) {
            return fail('bad-request', `缺少必填参数：${missing.map((a) => a.name).join('、')}`);
          }
        }
        const settings = await loadSettings();
        const t0 = Date.now();
        const run = await runResearch(settings, argv, { label: `命令台 ${command.id}`, timeoutMs: 180_000 });
        const value = {
          command: command.id, kind: command.kind, args: run.args,
          ok: run.ok, code: run.code, summary: run.summary, warnings: run.warnings,
          raw: run.raw, stderr: run.ok ? '' : String(run.stderr || '').slice(0, 1200),
          elapsedMs: Date.now() - t0,
        };
        return done(command.kind === 'read' ? value : await reindexAfter(settings, value));
      }


      case 'transformOps':
        return done({ ops: TRANSFORM_OPS });

      case 'tablePreview': {
        const rel = asString(args.data);
        if (!rel) return fail('bad-request', 'tablePreview 需要 data（库根相对路径的数据文件）');
        const limit = Math.min(50, Math.max(1, Number(args.limit) || 8));
        const settings = await loadSettings();
        const { table } = await readTableAbs(settings.root, rel);
        const columns = table.header.map((name, i) => {
          const vals = table.rows.map((r) => r[i]).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
          return {
            name, index: i,
            count: vals.length,
            min: vals.length ? vals[0] : null,
            max: vals.length ? vals[vals.length - 1] : null,
            median: vals.length ? vals[Math.floor(vals.length / 2)] : null,
          };
        });
        return done({ path: rel, header: table.header, rows: table.rows.length, columns, head: table.rows.slice(0, limit) });
      }

      case 'tableTransform': {
        const settings = await loadSettings();
        const root = settings.root;
        const project = asString(args.project);
        const rel = asString(args.data);
        if (!project) return fail('bad-request', 'tableTransform 需要 project（课题 slug）');
        if (!rel) return fail('bad-request', 'tableTransform 需要 data（源数据，库根相对路径）');
        const op = asString(args.op);
        if (!TRANSFORM_OPS.some((o) => o.id === op)) {
          return fail('bad-request', `没有这个变换：${op}（可用：${TRANSFORM_OPS.map((o) => o.id).join(', ')}）`);
        }
        const stem = path.basename(rel).replace(/\.[^.]+$/, '');
        const outName = String(asString(args.outName) || `${stem}-${op}`).replace(/\.[^.]+$/, '');
        if (!TABLE_OUT_NAME.test(outName)) {
          return fail('bad-request', '输出名只能含字母数字与 - _ .（60 字符内，字母数字开头）');
        }
        const { table } = await readTableAbs(root, rel);
        let res;
        try {
          res = runTransform(table, op, { ...(args.params || {}), x: args.x, y: args.y });
        } catch (error) {
          return fail('bad-request', `变换失败：${String(error.message || error)}`);
        }
        const outDir = path.join(root, 'projects', project, 'tables');
        const outAbs = path.join(outDir, `${outName}.csv`);
        if (fs.existsSync(outAbs) && args.overwrite !== true) {
          return fail('conflict', `同名产物已存在：projects/${project}/tables/${outName}.csv（要覆盖请勾「覆盖同名」，**原始数据永远不动**）`);
        }
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(outAbs, tableToCsv(res.table), 'utf8');
        // 溯源放 .research/transforms/（不放 tables/，免得被当成"表格"列出来）
        const traceDir = path.join(root, '.research', 'transforms', project);
        fs.mkdirSync(traceDir, { recursive: true });
        const trace = {
          schema: 1,
          source: rel,
          op,
          params: { x: args.x === undefined ? 0 : args.x, y: args.y === undefined ? null : args.y, ...(args.params || {}) },
          output: toRel(root, outAbs),
          rows: res.table.rows.length,
          columns: res.table.header.length,
          notes: res.notes || [],
          meta: res.meta || null,
          createdAt: new Date().toISOString(),
        };
        fs.writeFileSync(path.join(traceDir, `${outName}.json`), JSON.stringify(trace, null, 1), 'utf8');
        return done(await reindexAfter(settings, {
          ok: true, op, output: trace.output, rows: trace.rows, columns: trace.columns,
          notes: trace.notes, header: res.table.header, head: res.table.rows.slice(0, 5),
          trace: `.research/transforms/${project}/${outName}.json`,
        }));
      }

      default:
        return fail('bad-request', `未知动作：${action}。可用动作：${ACTIONS.join(', ')}`);
    }
  } catch (error) {
    const { code, message } = describe(error);
    return fail(code, message, { action });
  }
}

/** 给宿主半边自检用：确认路径约束在真实库上生效。 */
export async function probePathGuard() {
  const settings = await loadSettings();
  const probes = ['..\\..\\windows\\win.ini', 'C:\\Windows\\win.ini', '/etc/passwd'];
  const results = [];
  for (const p of probes) {
    try {
      resolveInside(settings.root, p);
      results.push({ path: p, rejected: false, note: '未被拒绝（这是缺陷！）' });
    } catch (error) {
      results.push({ path: p, rejected: true, note: String(error.message) });
    }
  }
  return results;
}

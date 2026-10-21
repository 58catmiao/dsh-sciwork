/**
 * 科研模式 0.3 · 命令台表（research.py 子命令的唯一映射）
 * ---------------------------------------------------------------------------
 * 0.3 之前这张表住 `lib/actions.js`，`checkJournal` / `exportPackage` / `removeRef`
 * 等动作各自手拼 argv，等于第二套命令拼装。现在：
 *   - 表与 argv 构造只在这里；
 *   - 所有 research.py 调用统一走 `lib/adapters/python.js`；
 *   - `lib/actions.js` 继续 re-export 本文件的四个符号，旧面板/旧自检零改动。
 *
 * kind: read=只读 · write=写库 · danger=不可逆（需要显式确认）。
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

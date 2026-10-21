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
 * title/label/optionsCn 只用于面板展示，不参与 argv 构造。
 */

export const CLI_COMMANDS = [
  { id: 'status', kind: 'read', title: '库概况', desc: '库概况：课题数、文献数、已登记图数、期刊档案', args: [] },
  {
    id: 'search', kind: 'read', title: '检索', desc: '跨课题检索（课题/图/稿/数据/文献/期刊/投稿）',
    args: [
      { name: 'query', label: '关键词', required: true, placeholder: '关键词' },
      {
        name: '--kind', label: '检索范围', type: 'select',
        options: ['ref', 'figure', 'draft', 'dataset', 'table', 'journal', 'project', 'submission'],
        optionsCn: {
          ref: '文献', figure: '图', draft: '草稿', dataset: '数据集',
          table: '数据表', journal: '期刊档案', project: '课题', submission: '投稿',
        },
      },
      { name: '--project', label: '课题' },
      { name: '--limit', label: '条数上限', type: 'int', placeholder: '20' },
    ],
  },
  {
    id: 'check-citations', kind: 'read', title: '引用核查', desc: '引用核查闸门：非零退出 = 有缺失/未核实的引用',
    args: [
      { name: '--draft', label: '草稿', type: 'path', required: true, placeholder: 'projects/<课题>/drafts/xx.md' },
      { name: '--require-doi', label: '必须带 DOI', type: 'bool' },
    ],
  },
  {
    id: 'list-figures', kind: 'read', title: '列图', desc: '列已登记图', args: [{ name: '--project', label: '课题' }],
  },
  {
    id: 'list-refs', kind: 'read', title: '列文献', desc: '列/搜文献',
    args: [{ name: '--project', label: '课题' }, { name: '--query', label: '关键词' }],
  },
  {
    id: 'list-projects', kind: 'read', title: '列课题', desc: '列课题', args: [],
  },
  {
    id: 'list-submissions', kind: 'read', title: '列投稿', desc: '列/筛投稿记录',
    args: [
      { name: '--project', label: '课题' }, { name: '--journal', label: '期刊档案' },
      {
        name: '--status', label: '状态', type: 'select',
        options: ['drafting', 'submitted', 'under-review', 'revision', 'accepted', 'rejected', 'withdrawn', 'published'],
        optionsCn: {
          drafting: '撰写中', submitted: '已投稿', 'under-review': '审稿中', revision: '返修中',
          accepted: '已接收', rejected: '已拒稿', withdrawn: '已撤稿', published: '已发表',
        },
      },
      { name: '--active', label: '只看进行中', type: 'bool' }, { name: '--due', label: '有截止日期', type: 'bool' },
    ],
  },
  {
    id: 'register-figure', kind: 'write', title: '登记图溯源', desc: '登记一张图的溯源侧车',
    args: [
      { name: '--project', label: '课题', required: true }, { name: '--file', label: '图文件', type: 'path', required: true },
      { name: '--data', label: '源数据', type: 'list', help: '源数据，可多次' }, { name: '--graph', label: 'Origin 图页' },
      { name: '--journal', label: '期刊档案' }, { name: '--caption', label: '图注' }, { name: '--opju', label: 'Origin 工程', type: 'path' },
      { name: '--spec', label: '出图规格', type: 'path' }, { name: '--figure-id', label: '图号' },
    ],
  },
  {
    id: 'add-ref', kind: 'write', title: '文献入库', desc: '文献入库（必须带 DOI 或 URL，引用零编造）',
    args: [
      { name: '--title', label: '标题', required: true }, { name: '--authors', label: '作者' }, { name: '--year', label: '年份', type: 'int' },
      { name: '--container', label: '出处（期刊/会议）' }, { name: '--volume', label: '卷' }, { name: '--issue', label: '期' }, { name: '--pages', label: '页码' },
      { name: '--doi', label: 'DOI' }, { name: '--url', label: '链接' },
      {
        name: '--type', label: '类型', type: 'select',
        options: ['article', 'book', 'inproceedings', 'thesis', 'report', 'preprint', 'misc'],
        optionsCn: {
          article: '期刊论文', book: '专著', inproceedings: '会议论文', thesis: '学位论文',
          report: '报告', preprint: '预印本', misc: '其他',
        },
      },
      { name: '--project', label: '课题', type: 'list' }, { name: '--key', label: '文献键' }, { name: '--notes', label: '备注' },
      {
        name: '--verified-by', label: '核验方式', type: 'select',
        options: ['doi-resolved', 'url-fetched', 'user-supplied', 'unverified'],
        optionsCn: {
          'doi-resolved': '已解析 DOI', 'url-fetched': '已抓取链接',
          'user-supplied': '用户提供', unverified: '未核验',
        },
      },
      { name: '--force', label: '强制覆盖', type: 'bool' },
    ],
  },
  {
    id: 'add-submission', kind: 'write', title: '登记投稿', desc: '登记一次投稿',
    args: [
      { name: '--journal', label: '期刊档案', required: true }, { name: '--project', label: '课题' }, { name: '--title', label: '标题' },
      {
        name: '--type', label: '类型', type: 'select',
        options: ['research-article', 'review', 'letter', 'communication', 'conference-paper', 'thesis', 'preprint', 'other'],
        optionsCn: {
          'research-article': '研究论文', review: '综述', letter: '通讯', communication: '简报',
          'conference-paper': '会议论文', thesis: '学位论文', preprint: '预印本', other: '其他',
        },
      },
      {
        name: '--status', label: '状态', type: 'select',
        options: ['drafting', 'submitted', 'under-review', 'revision', 'accepted', 'rejected', 'withdrawn', 'published'],
        optionsCn: {
          drafting: '撰写中', submitted: '已投稿', 'under-review': '审稿中', revision: '返修中',
          accepted: '已接收', rejected: '已拒稿', withdrawn: '已撤稿', published: '已发表',
        },
      },
      { name: '--manuscript', label: '稿件', type: 'path' }, { name: '--manuscript-id', label: '稿件编号' }, { name: '--doi', label: 'DOI' },
      { name: '--next-action', label: '下一步' }, { name: '--next-action-due', label: '下一步截止' }, { name: '--note', label: '备注' },
    ],
  },
  {
    id: 'new-project', kind: 'write', title: '新建课题', desc: '新建课题（slug 是位置参数，必填）',
    args: [
      { name: 'slug', label: '课题标识（slug）', required: true, placeholder: 'zt-ceremic' },
      { name: '--title', label: '标题' }, { name: '--journal', label: '期刊档案' },
    ],
  },
  {
    id: 'update-submission', kind: 'write', title: '推进投稿', desc: '推进投稿状态 / 记事件 / 改下一步',
    args: [
      { name: 'id', label: '投稿记录 id', required: true },
      {
        name: '--status', label: '状态', type: 'select',
        options: ['drafting', 'submitted', 'under-review', 'revision', 'accepted', 'rejected', 'withdrawn', 'published'],
        optionsCn: {
          drafting: '撰写中', submitted: '已投稿', 'under-review': '审稿中', revision: '返修中',
          accepted: '已接收', rejected: '已拒稿', withdrawn: '已撤稿', published: '已发表',
        },
      },
      { name: '--note', label: '备注' }, { name: '--next-action', label: '下一步' }, { name: '--next-action-due', label: '下一步截止' },
    ],
  },
  {
    id: 'check-journal', kind: 'read', title: '投稿体检', desc: '投稿合规体检：图尺寸/DPI/栏宽、摘要字数、引用键与 DOI',
    args: [
      { name: '--project', label: '课题', required: true },
      { name: '--journal', label: '期刊档案', placeholder: '期刊档案键（缺省取 project.json）' },
      { name: '--draft', label: '草稿', type: 'path', placeholder: 'projects/<课题>/drafts/xx.md' },
      { name: '--submission', label: '投稿记录', placeholder: '投稿记录 id' },
    ],
  },
  {
    id: 'export-package', kind: 'write', title: '导出投稿包', desc: '导出投稿包 zip（稿件 + 图 + 数据 + refs.bib + manifest）',
    args: [
      { name: '--project', label: '课题', required: true },
      { name: '--journal', label: '期刊档案' },
      { name: '--submission', label: '投稿记录' },
      { name: '--draft', label: '草稿', type: 'path' },
    ],
  },
  { id: 'reindex', kind: 'write', title: '重建索引', desc: '重建库索引', args: [] },
  { id: 'export-bib', kind: 'write', title: '重建 refs.bib', desc: '重建 refs.bib', args: [] },
  { id: 'init', kind: 'write', title: '初始化库', desc: '建/修复库骨架（幂等）', args: [] },
  {
    id: 'remove-ref', kind: 'danger', title: '删除文献', desc: '删掉一条文献登记（先备份 refs.json）',
    args: [{ name: '--key', label: '文献键' }, { name: '--doi', label: 'DOI' }],
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

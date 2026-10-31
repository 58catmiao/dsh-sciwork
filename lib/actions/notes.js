/**
 * 科研模式 0.3 · 动作域：笔记 / 实验日志
 * ---------------------------------------------------------------------------
 * 笔记是 `projects/<课题>/notes/*.md`（纯 Markdown，不参与 `refs.json` / 侧车 /
 * `submissions` 那些登记资产，所以这三个动作**不触发 reindex**，也不动索引）。
 *
 * 三个动作：
 *   - `notes.list`（读）列出笔记；
 *   - `notes.read`（读，工具 `sciwork_notes_read`）读正文；
 *   - `notes.save`（写，`confirm:'write'`，工具 `sciwork_notes_save`）新建/覆盖，
 *     覆盖前由 `lib/notes.js` 先落同名 `.bak`。
 * 路径约束全部收在 `lib/notes.js`，这里只做参数清洗与错误码。
 */

import { listNotes, readNote, saveNote } from '../notes.js';
import { badRequest } from '../host/errors.js';
import { asString, settingsNow } from '../host/engine.js';

/** 库根：优先执行器给的（测试可传临时库），否则按当前设置解析。 */
async function rootOf(ctx) {
  const given = (ctx && (ctx.root || (ctx.settings && ctx.settings.root))) || '';
  return given || (await settingsNow()).root;
}

export const notesList = {
  id: 'notes.list',
  title: '笔记列表',
  domain: 'notes',
  description: '列出课题 notes/ 下的笔记（文件名、标题、修改时间、字节数、前 80 字摘要）',
  params: {
    type: 'object', required: ['project'], additionalProperties: false,
    properties: {
      project: { type: 'string', maxLength: 120 },
    },
  },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  stage: ['analysis', 'draft'],
  ui: { view: 'project' },
  run: async (ctx, params) => {
    const project = asString(params.project);
    if (!project) throw badRequest('notes.list 需要 project（课题 slug）');
    return listNotes(await rootOf(ctx), project);
  },
};

export const notesRead = {
  id: 'notes.read',
  title: '读笔记',
  domain: 'notes',
  description: '读一份笔记的正文（projects/<课题>/notes/<名字>.md）',
  params: {
    type: 'object', required: ['project', 'name'], additionalProperties: false,
    properties: {
      project: { type: 'string', maxLength: 120 },
      name: { type: 'string', maxLength: 120 },
    },
  },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  stage: ['analysis', 'draft'],
  ui: { view: 'project' },
  tool: { expose: true, name: 'sciwork_notes_read' },
  run: async (ctx, params) => {
    const project = asString(params.project);
    const name = asString(params.name);
    if (!project) throw badRequest('notes.read 需要 project（课题 slug）');
    if (!name) throw badRequest('notes.read 需要 name（笔记文件名）');
    return readNote(await rootOf(ctx), { project, name });
  },
};

export const notesSave = {
  id: 'notes.save',
  title: '写笔记',
  domain: 'notes',
  description: '新建/覆盖一份笔记（projects/<课题>/notes/*.md；覆盖前先把原文件存成同名 .bak；不给名字时用 YYYY-MM-DD-HHmm-<slug> 自动命名）',
  params: {
    type: 'object', required: ['project', 'text'], additionalProperties: false,
    properties: {
      project: { type: 'string', maxLength: 120 },
      name: { type: 'string', maxLength: 120 },
      text: { type: 'string', maxLength: 2_000_000 },
    },
  },
  effects: 'write',
  engine: 'node',
  confirm: 'write',
  stage: ['analysis', 'draft'],
  ui: { view: 'project', primary: true },
  tool: { expose: true, name: 'sciwork_notes_save' },
  run: async (ctx, params) => {
    const project = asString(params.project);
    if (!project) throw badRequest('notes.save 需要 project（课题 slug）');
    return saveNote(await rootOf(ctx), {
      project,
      name: asString(params.name),
      text: params.text,
    });
  },
};

export const NOTES_ACTIONS = [notesList, notesRead, notesSave];

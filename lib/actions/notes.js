/**
 * 科研模式 0.3 · 动作域：笔记 / 实验日志
 * ---------------------------------------------------------------------------
 * 笔记是 `projects/<课题>/notes/*.md`（纯 Markdown，不参与 `refs.json` / 侧车 /
 * `submissions` 那些登记资产，所以这三个动作**不触发 reindex**，也不动索引）。
 *
 * 四个动作：
 *   - `notes.list`（读）列出笔记；
 *   - `notes.read`（读，工具 `sciwork_notes_read`）读正文；
 *   - `notes.save`（写，`confirm:'write'`，工具 `sciwork_notes_save`）新建/覆盖，
 *     覆盖前由 `lib/notes.js` 先落同名 `.bak`；
 *   - `notes.delete`（写，`confirm:'write'`，工具 `sciwork_notes_delete`）把一份笔记
 *     移进 `notes/.trash/`——**不做物理删除**，放错了还能从回收站拿回来。
 * 路径约束全部收在 `lib/notes.js`，这里只做参数清洗与错误码。
 */

import { deleteNote, listNotes, readNote, saveNote } from '../notes.js';
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
  preview: (ctx, params) => {
    const project = asString(params.project);
    const name = asString(params.name);
    const where = `projects/${project}/notes/${name || '<按时间自动命名>.md'}`;
    const bytes = Buffer.byteLength(String(params.text || ''), 'utf8');
    return {
      // 路径只放在 writes 里说一次：summary 再念一遍，弹层就要重复两行同一件事。
      summary: `写「${name || '新笔记'}」，正文 ${bytes} 字节。`,
      writes: [where],
      warnings: name ? ['同名笔记会被覆盖：原文件先存成同名 .bak'] : [],
    };
  },
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

export const notesDelete = {
  id: 'notes.delete',
  title: '删除笔记',
  domain: 'notes',
  description: '把一份笔记移进回收站（projects/<课题>/notes/.trash/）：不做物理删除，需要时能拿回来',
  params: {
    type: 'object', required: ['project', 'name'], additionalProperties: false,
    properties: {
      project: { type: 'string', maxLength: 120 },
      name: { type: 'string', maxLength: 120 },
    },
  },
  effects: 'write',
  engine: 'node',
  confirm: 'write',
  stage: ['analysis', 'draft'],
  ui: { view: 'project' },
  tool: { expose: true, name: 'sciwork_notes_delete' },
  preview: (ctx, params) => {
    const project = asString(params.project);
    const name = asString(params.name) || '(未命名)';
    return {
      summary: `把「${name}」移进回收站：笔记列表里不再出现，文件仍在 notes/.trash/ 下。`,
      writes: [`projects/${project}/notes/.trash/<时间戳>-${name}`],
      warnings: [],
    };
  },
  run: async (ctx, params) => {
    const project = asString(params.project);
    const name = asString(params.name);
    if (!project) throw badRequest('notes.delete 需要 project（课题 slug）');
    if (!name) throw badRequest('notes.delete 需要 name（笔记文件名）');
    return deleteNote(await rootOf(ctx), { project, name });
  },
};

export const NOTES_ACTIONS = [notesList, notesRead, notesSave, notesDelete];

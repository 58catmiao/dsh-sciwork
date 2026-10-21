/**
 * 科研模式 0.3 · 动作域：库（快照 / 读文件 / 归档 / 删除 / 恢复 / 命令台信息）
 * ---------------------------------------------------------------------------
 * 这 13 个动作是 0.2 面板最常用的读+文件动作，迁到登记表后：
 *   - 面板仍用旧名调用（`legacy` 别名表，零改动）；
 *   - 新动作面用 `library.*`；
 *   - 命令台元数据只在这里出现一次（`CLI_COMMANDS` 来自 host/cli.js）。
 */

import {
  readBinary,
  readText,
  snapshot,
  tableColumns,
} from '../library.js';
import { importInfo } from '../import.js';
import { archiveEntries, archiveInfo, removeEntries, restoreEntries } from '../archive.js';
import { TRANSFORM_OPS } from '../transform.js';
import { launcherPath } from '../config.js';
import { CLI_COMMANDS, CLI_HINTS } from '../host/cli.js';
import { badRequest } from '../host/errors.js';
import { asArray, asString, reindexAfter, settingsNow, readTableAbs, unwrap } from '../host/engine.js';

export const librarySnapshot = {
  id: 'library.snapshot',
  title: '库快照',
  domain: 'library',
  description: '课题/文献/图/草稿/期刊的概览（面板首页数据）',
  params: { type: 'object', properties: {}, additionalProperties: false },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  idempotent: true,
  ui: { view: 'library', primary: true },
  tool: { expose: true, name: 'sciwork_library_snapshot' },
  legacy: ['snapshot'],
  run: async () => snapshot(),
};

export const libraryReadText = {
  id: 'library.read_text',
  title: '读文本预览',
  domain: 'library',
  description: '读库内文本文件的前 512 KB（预览通道，不是全量读盘）',
  params: {
    type: 'object', required: ['path'], additionalProperties: false,
    properties: { path: { type: 'string', maxLength: 400 } },
  },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  ui: { view: 'library' },
  tool: { expose: true, name: 'sciwork_library_read_text' },
  legacy: ['readText'],
  run: async (ctx, params) => {
    const settings = await settingsNow();
    return readText(settings.root, asString(params.path));
  },
};

export const libraryReadBinary = {
  id: 'library.read_binary',
  title: '读二进制（限图片/PDF 预览）',
  domain: 'library',
  description: '返回 base64 与 mime，供面板内联预览',
  params: {
    type: 'object', required: ['path'], additionalProperties: false,
    properties: { path: { type: 'string', maxLength: 400 } },
  },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  ui: { view: 'library' },
  tool: { expose: true, name: 'sciwork_library_read_binary' },
  legacy: ['readBinary'],
  run: async (ctx, params) => {
    const settings = await settingsNow();
    return readBinary(settings.root, asString(params.path));
  },
};

export const libraryTableColumns = {
  id: 'library.table_columns',
  title: '数据表列概要',
  domain: 'library',
  description: '读一张数据表的列名/类型/范围',
  params: {
    type: 'object', required: ['path'], additionalProperties: false,
    properties: { path: { type: 'string', maxLength: 400 } },
  },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  ui: { view: 'library' },
  tool: { expose: true, name: 'sciwork_library_table_columns' },
  legacy: ['tableColumns'],
  run: async (ctx, params) => {
    const settings = await settingsNow();
    return tableColumns(settings.root, asString(params.path));
  },
};

export const libraryTablePreview = {
  id: 'library.table_preview',
  title: '数据表预览',
  domain: 'library',
  description: '列统计 + 前 N 行（默认 8，最多 50）',
  params: {
    type: 'object', required: ['data'], additionalProperties: false,
    properties: {
      data: { type: 'string', maxLength: 400 },
      limit: { type: 'integer', min: 1, max: 50, default: 8 },
    },
  },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  ui: { view: 'data' },
  tool: { expose: true, name: 'sciwork_library_table_preview' },
  legacy: ['tablePreview'],
  run: async (ctx, params) => {
    const rel = asString(params.data);
    if (!rel) throw badRequest('tablePreview 需要 data（库根相对路径的数据文件）');
    const limit = Math.min(50, Math.max(1, Number(params.limit) || 8));
    const settings = await settingsNow();
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
    return { path: rel, header: table.header, rows: table.rows.length, columns, head: table.rows.slice(0, limit) };
  },
};

export const libraryImportInfo = {
  id: 'library.import_info',
  title: '导入体检信息',
  domain: 'library',
  description: '当前导入能力的可用性与限制（面板「导入」页头部）',
  params: { type: 'object', properties: {}, additionalProperties: false },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  idempotent: true,
  ui: { view: 'library' },
  tool: { expose: true, name: 'sciwork_library_import_info' },
  legacy: ['importInfo'],
  run: async () => unwrap(await importInfo()),
};

export const libraryArchiveInfo = {
  id: 'library.archive_info',
  title: '归档清单',
  domain: 'library',
  description: '列已归档的批次与可恢复项',
  params: { type: 'object', properties: {}, additionalProperties: false },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  idempotent: true,
  ui: { view: 'library' },
  tool: { expose: true, name: 'sciwork_library_archive_info' },
  legacy: ['archiveInfo'],
  run: async () => unwrap(await archiveInfo()),
};

export const libraryArchive = {
  id: 'library.archive',
  title: '归档文件',
  domain: 'library',
  description: '把库内文件移入 .research/archive/<时间戳>/，记 manifest，可恢复',
  params: {
    type: 'object', required: ['entries'], additionalProperties: false,
    properties: {
      // 旧面板传对象条目（{path,kind,label}），CLI 口径传字符串；两种都收。
      entries: { type: 'array', items: {}, minLength: 1 },
      reason: { type: 'string', maxLength: 200 },
    },
  },
  effects: 'write',
  engine: 'node',
  confirm: 'legacy',
  ui: { view: 'library' },
  tool: { expose: true, name: 'sciwork_library_archive' },
  legacy: ['archive'],
  run: async (ctx, params) => {
    const value = unwrap(await archiveEntries({ entries: params.entries, reason: asString(params.reason) }));
    return reindexAfter(await settingsNow(), value);
  },
};

export const libraryRemove = {
  id: 'library.remove',
  title: '删除文件（不可逆）',
  domain: 'library',
  description: '真删库内文件；必须 confirm=true。先归档再删除也走这里',
  params: {
    type: 'object', required: ['entries'], additionalProperties: false,
    properties: {
      entries: { type: 'array', items: {} },
      // 旧面板的 remove 把「文件名」当确认词传（confirm:'good.md'）；新面用布尔。
      confirm: { type: ['boolean', 'string'], default: false },
      reason: { type: 'string', maxLength: 200 },
    },
  },
  effects: 'write',
  engine: 'node',
  confirm: 'always',
  ui: { view: 'library' },
  tool: { expose: true, name: 'sciwork_library_remove' },
  legacy: ['remove'],
  run: async (ctx, params) => {
    const value = unwrap(await removeEntries({ entries: params.entries, confirm: params.confirm, reason: asString(params.reason) }));
    return reindexAfter(await settingsNow(), value);
  },
};

export const libraryRestore = {
  id: 'library.restore',
  title: '从归档恢复',
  domain: 'library',
  description: '按归档批次 id 与路径恢复文件',
  params: {
    type: 'object', required: ['id'], additionalProperties: false,
    properties: {
      id: { type: 'string', maxLength: 120 },
      paths: { type: 'array', items: { type: 'string' } },
    },
  },
  effects: 'write',
  engine: 'node',
  confirm: 'legacy',
  ui: { view: 'library' },
  tool: { expose: true, name: 'sciwork_library_restore' },
  legacy: ['restore'],
  run: async (ctx, params) => {
    const value = unwrap(await restoreEntries({ id: asString(params.id), paths: asArray(params.paths) }));
    return reindexAfter(await settingsNow(), value);
  },
};

export const libraryCliCommands = {
  id: 'library.cli_commands',
  title: '命令台清单',
  domain: 'library',
  description: 'research.py 子命令表 + 启动器位置（面板「命令台」页）',
  params: { type: 'object', properties: {}, additionalProperties: false },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  idempotent: true,
  ui: { view: 'library' },
  tool: { expose: true, name: 'sciwork_library_cli_commands' },
  legacy: ['cliCommands'],
  run: async () => {
    const settings = await settingsNow();
    return { commands: CLI_COMMANDS, launcher: launcherPath(settings.root) };
  },
};

export const libraryCliHint = {
  id: 'library.cli_hint',
  title: '写动作的 CLI 模板',
  domain: 'library',
  description: '给智能体的命令行模板（面板只展示、不执行）',
  params: {
    type: 'object', additionalProperties: false,
    properties: { key: { type: 'string', maxLength: 60 } },
  },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  idempotent: true,
  ui: { view: 'library' },
  tool: { expose: true, name: 'sciwork_library_cli_hint' },
  legacy: ['cliHint'],
  run: async (ctx, params) => {
    const key = asString(params.key);
    if (key && CLI_HINTS[key]) return { key, text: CLI_HINTS[key] };
    return { hints: CLI_HINTS };
  },
};

export const libraryTransformOps = {
  id: 'library.transform_ops',
  title: '数据变换清单',
  domain: 'library',
  description: '可用的表格变换算子（面板下拉框）',
  params: { type: 'object', properties: {}, additionalProperties: false },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  idempotent: true,
  ui: { view: 'data' },
  tool: { expose: true, name: 'sciwork_library_transform_ops' },
  legacy: ['transformOps'],
  run: async () => ({ ops: TRANSFORM_OPS }),
};

export const LIBRARY_ACTIONS = [
  librarySnapshot,
  libraryReadText,
  libraryReadBinary,
  libraryTableColumns,
  libraryTablePreview,
  libraryImportInfo,
  libraryArchiveInfo,
  libraryArchive,
  libraryRemove,
  libraryRestore,
  libraryCliCommands,
  libraryCliHint,
  libraryTransformOps,
];

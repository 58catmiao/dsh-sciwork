/**
 * 科研模式 0.3 · 动作域：数据（导入 / 表格变换）
 * ---------------------------------------------------------------------------
 * 变换产物写 `projects/<课题>/tables/`，溯源写 `.research/transforms/<课题>/<名>.json`；
 * **原始数据永远不动**（同名产物默认不覆盖，要覆盖必须显式 overwrite）。
 */

import fs from 'node:fs';
import path from 'node:path';

import { importBatch } from '../import.js';
import { TRANSFORM_OPS, runTransform, tableToCsv } from '../transform.js';
import { toRel } from '../library.js';
import { badRequest, conflict } from '../host/errors.js';
import { asString, readTableAbs, reindexAfter, settingsNow, unwrap } from '../host/engine.js';

const TABLE_OUT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const dataImport = {
  id: 'data.import',
  title: '导入数据/文献/图',
  domain: 'data',
  description: '把外部文件复制进库（只复制、不移动、同名不覆盖）；参数原样交给导入器',
  params: {
    type: 'object',
    properties: {
      // 旧面板传 {name, base64} 对象；CLI 口径传路径字符串。两种都收。
      files: { type: 'array', items: {} },
      project: { type: 'string' },
      kind: { type: 'string' },
      dryRun: { type: 'boolean', default: false },
    },
  },
  effects: 'write',
  engine: 'node',
  confirm: 'legacy',
  ui: { view: 'data', primary: true },
  tool: { expose: true, name: 'sciwork_data_import' },
  legacy: ['import'],
  run: async (ctx, params) => unwrap(await importBatch(params)),
};

export const dataTransform = {
  id: 'data.transform',
  title: '表格变换',
  domain: 'data',
  description: '对数据表做一次变换，产物写 projects/<课题>/tables/，并留溯源侧车',
  params: {
    type: 'object', required: ['project', 'data', 'op'], additionalProperties: false,
    properties: {
      project: { type: 'string', maxLength: 120 },
      data: { type: 'string', maxLength: 400 },
      op: { type: 'string', maxLength: 60 },
      outName: { type: 'string', maxLength: 64 },
      x: { type: 'string', maxLength: 120 },
      y: { type: 'string', maxLength: 120 },
      overwrite: { type: 'boolean', default: false },
      params: { type: 'object' },
    },
  },
  effects: 'write',
  engine: 'node',
  confirm: 'legacy',
  stage: ['data', 'analysis'],
  ui: { view: 'data' },
  tool: { expose: true, name: 'sciwork_data_transform' },
  legacy: ['tableTransform'],
  run: async (ctx, params) => {
    const settings = await settingsNow();
    const root = settings.root;
    const project = asString(params.project);
    const rel = asString(params.data);
    if (!project) throw badRequest('tableTransform 需要 project（课题 slug）');
    if (!rel) throw badRequest('tableTransform 需要 data（源数据，库根相对路径）');
    const op = asString(params.op);
    if (!TRANSFORM_OPS.some((o) => o.id === op)) {
      throw badRequest(`没有这个变换：${op}（可用：${TRANSFORM_OPS.map((o) => o.id).join(', ')}）`);
    }
    const stem = path.basename(rel).replace(/\.[^.]+$/, '');
    const outName = String(asString(params.outName) || `${stem}-${op}`).replace(/\.[^.]+$/, '');
    if (!TABLE_OUT_NAME.test(outName)) {
      throw badRequest('输出名只能含字母数字与 - _ .（60 字符内，字母数字开头）');
    }
    const { table } = await readTableAbs(root, rel);
    let res;
    try {
      res = runTransform(table, op, { ...(params.params || {}), x: params.x, y: params.y });
    } catch (error) {
      throw badRequest(`变换失败：${String(error.message || error)}`);
    }
    const outDir = path.join(root, 'projects', project, 'tables');
    const outAbs = path.join(outDir, `${outName}.csv`);
    if (fs.existsSync(outAbs) && params.overwrite !== true) {
      throw conflict(`同名产物已存在：projects/${project}/tables/${outName}.csv（要覆盖请勾「覆盖同名」，**原始数据永远不动**）`);
    }
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outAbs, tableToCsv(res.table), 'utf8');
    const traceDir = path.join(root, '.research', 'transforms', project);
    fs.mkdirSync(traceDir, { recursive: true });
    const trace = {
      schema: 1,
      source: rel,
      op,
      params: { x: params.x === undefined ? 0 : params.x, y: params.y === undefined ? null : params.y, ...(params.params || {}) },
      output: toRel(root, outAbs),
      rows: res.table.rows.length,
      columns: res.table.header.length,
      notes: res.notes || [],
      meta: res.meta || null,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(traceDir, `${outName}.json`), JSON.stringify(trace, null, 1), 'utf8');
    return reindexAfter(settings, {
      ok: true, op, output: trace.output, rows: trace.rows, columns: trace.columns,
      notes: trace.notes, header: res.table.header, head: res.table.rows.slice(0, 5),
      trace: `.research/transforms/${project}/${outName}.json`,
    });
  },
};

export const DATA_ACTIONS = [dataImport, dataTransform];

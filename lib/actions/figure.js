/**
 * 科研模式 0.3 · 动作域：图（重画）
 * ---------------------------------------------------------------------------
 * 0.2 里 `replot` 已经会读图侧车、按 Origin 模板重画并登记溯源；0.3 不重写绘图逻辑，
 * 只把它登记成 `figure.replot`，并把耗时归到动作自己的 timeoutMs（300s）。
 */

import { replotFigure } from '../replot.js';
import { badRequest } from '../host/errors.js';
import { asArray, asString } from '../host/engine.js';

export const figureReplot = {
  id: 'figure.replot',
  title: '重画图',
  domain: 'figure',
  description: '按图侧车（溯源 JSON）重画：可换 X/Y 列、标题、版式，重画后自动更新登记',
  params: {
    type: 'object', required: ['sidecar'], additionalProperties: false,
    properties: {
      sidecar: { type: 'string', maxLength: 400 },
      x: { type: 'string', maxLength: 120 },
      y: { type: 'array', items: { type: 'string' } },
      title: { type: 'string', maxLength: 300 },
      styleMode: { type: 'string', maxLength: 40 },
      plotType: { type: 'string', maxLength: 40 },
      register: { type: 'boolean', default: true },
    },
  },
  effects: 'write',
  engine: 'node',
  confirm: 'legacy',
  timeoutMs: 300_000,
  stage: ['figure'],
  ui: { view: 'project', primary: true },
  tool: { expose: true, name: 'sciwork_figure_replot' },
  legacy: ['replot'],
  run: async (ctx, params) => {
    const sidecar = asString(params.sidecar);
    if (!sidecar) throw badRequest('replot 需要 sidecar（库根相对路径的图侧车 JSON）');
    return replotFigure({
      sidecarRel: sidecar,
      xColumn: asString(params.x) || undefined,
      yColumns: asArray(params.y).length ? asArray(params.y) : undefined,
      title: asString(params.title) || undefined,
      styleMode: asString(params.styleMode) || undefined,
      plotType: asString(params.plotType) || undefined,
      register: params.register !== false,
    });
  },
};

export const FIGURE_ACTIONS = [figureReplot];

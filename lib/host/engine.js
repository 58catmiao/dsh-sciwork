/**
 * 科研模式 0.3 · 动作层公用工具
 * ---------------------------------------------------------------------------
 * 只放「多个动作都要用、且与业务无关」的小东西：
 *   - 参数清洗（字符串/数组/布尔）
 *   - 归档/删除后重建索引（索引失败不算动作失败，如实附在结果里）
 *   - 读一张数据表（readText 是预览通道，有 512 KB 上限，数据表动辄几 MB）
 * 引擎调用统一走 `lib/adapters/python.js`，这里不出现第二个 runResearch。
 */

import fs from 'node:fs';
import path from 'node:path';

import { loadSettings, resolveInside } from '../library.js';
import { parseTable } from '../table.js';
import { runResearch } from '../import.js';
import { callResearch } from '../adapters/python.js';
import { ResearchError } from './errors.js';

/**
 * 旧实现（archive/remove/restore/import）返回的是线信封 `{ok,value|error}`。
 * 动作层要的是「值就返回值、失败就抛」——统一在这里拆信封。
 */
export function unwrap(res) {
  if (res && typeof res === 'object' && res.ok === false && res.error) {
    throw new ResearchError(res.error.code, res.error.message, res.error.details);
  }
  if (res && typeof res === 'object' && res.ok === true && 'value' in res) return res.value;
  return res;
}


export const asString = (v) => (typeof v === 'string' ? v.trim() : '');
export const asArray = (v) => (Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : []);
export const asBool = (v) => v === true || v === 'true' || v === '1';

/** 取当前库设置（每次动作重新解析，改了配置不用重启）。 */
export const settingsNow = () => loadSettings();

/** research.py 调用（适配层唯一入口）。 */
export const callCli = (settings, argv, opts) => callResearch(settings, argv, opts);

/** 归档/删除/新建之后重建索引（索引失败不算动作失败，如实附在结果里）。 */
export async function reindexAfter(settings, value) {
  const run = await callResearch(settings, ['reindex'], { label: 'reindex' });
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

/** 读数据表（自己读盘；上限 64 MB，超过就明确拒绝，别把内存打爆）。 */
export async function readTableAbs(root, rel) {
  const abs = resolveInside(root, rel);
  const info = fs.statSync(abs);
  if (!info.isFile()) throw new Error('不是一个文件');
  if (info.size > 64 * 1024 * 1024) {
    throw new Error(`数据文件 ${Math.round(info.size / 1048576)} MB 太大，面板不处理（请让智能体走 Origin 或分块）`);
  }
  const table = parseTable(fs.readFileSync(abs, 'utf8'));
  return { abs, bytes: info.size, table };
}

/** 产物写盘（表格变换用）：返回库根相对路径。 */
export function writeInside(root, absPath, text) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, text, 'utf8');
  return path.relative(root, absPath).split(path.sep).join('/');
}

/** 只给诊断用：不要拿它跑动作（runResearch 是旧直连口，拿来做兜底检查）。 */
export const legacyRunResearch = runResearch;

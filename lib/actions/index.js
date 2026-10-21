/**
 * 科研模式 0.3 · 动作登记（唯一出口）
 * ---------------------------------------------------------------------------
 * 所有动作在这里一次性登记；`lib/actions.js` 只是它的薄适配层。
 * 顺序即旧名顺序（`ACTIONS` 兼容数组）；新动作追加在后面，不改旧顺序。
 */

import { registerAll, resetRegistry, resolveAction, legacyNames } from '../host/registry.js';
import { dispatchLegacy } from '../host/dispatch.js';
import { LIBRARY_ACTIONS } from './library.js';
import { DRAFT_ACTIONS } from './draft.js';
import { DATA_ACTIONS } from './data.js';
import { FIGURE_ACTIONS } from './figure.js';
import { REFS_ACTIONS } from './refs.js';
import { JOURNAL_ACTIONS } from './journal.js';
import { SYSTEM_ACTIONS } from './system.js';
import { ACTION_ACTIONS } from './action.js';

/**
 * 0.2 面板认的 24 个动作名，顺序是协议的一部分（`scripts/selftest-actions.mjs` 深比较）。
 * 0.3 期间一个新名都不许加进来、一个旧名都不许删（PLAN §5.4）。
 */
export const LEGACY_ORDER = Object.freeze([
  'snapshot', 'readText', 'readBinary', 'tableColumns', 'checkCitations', 'replot', 'cliHint',
  'import', 'importInfo', 'archive', 'remove', 'restore', 'archiveInfo', 'fetchRefMeta', 'writeText', 'newDraft', 'removeRef',
  'cliCommands', 'runCli',
  'transformOps', 'tablePreview', 'tableTransform',
  'checkJournal', 'exportPackage',
]);

/** 全部动作（登记顺序 = 旧名顺序 + 新面动作）。 */
export const ALL_ACTIONS = Object.freeze([
  ...LIBRARY_ACTIONS,
  ...DRAFT_ACTIONS,
  ...DATA_ACTIONS,
  ...FIGURE_ACTIONS,
  ...REFS_ACTIONS,
  ...JOURNAL_ACTIONS,
  ...SYSTEM_ACTIONS,
  ...ACTION_ACTIONS,
]);

let registered = false;

/** 幂等登记；测试里先 `resetActions()` 再登记。 */
export function ensureRegistered() {
  if (registered) return;
  registerAll(ALL_ACTIONS);
  registered = true;
}

/** 测试用：清空登记，下次 `ensureRegistered()` 重建。 */
export function resetActions() {
  resetRegistry();
  registered = false;
}

/** 兼容口：旧名调用 → 旧信封（只 `{ok,value|error}`）。 */
export async function callLegacy(actionName, args, ctx = {}) {
  ensureRegistered();
  return dispatchLegacy(actionName, args, ctx);
}

export { resolveAction, legacyNames };

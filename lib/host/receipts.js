/**
 * 科研模式 0.3 · 回执（`.research/receipts/<YYYY-MM>.jsonl`）
 * ---------------------------------------------------------------------------
 * 回执是「我刚做了什么」的唯一事实源：面板的「最近操作」、agent 的上下文注入、
 * 课题 `project.json.history` 的尾巴，都从这里读或写到这里。
 *
 * 纪律：
 *   - 只追加（append-one-line），不原地改写；坏行只是跳过，不阻断读取。
 *   - 落盘在**库根**里，因此写失败不能把动作判成失败：转成一条 warning（`receipt-not-written`）。
 *   - 回执里不写绝对路径：`wrote` 一律库根相对路径。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RECEIPTS_DIR = '.research/receipts';

/** 回执 id：`r_<YYYYMMDD>_<hex6>`（PLAN §5.4 的示例形状）。 */
export function newReceiptId(now = Date.now()) {
  const d = new Date(now);
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `r_${ymd}_${crypto.randomBytes(3).toString('hex')}`;
}

const monthKey = (now) => {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** 回执文件：`.research/receipts/2026-10.jsonl`（库根相对路径）。 */
export function receiptsRel(now = Date.now()) {
  return `${RECEIPTS_DIR}/${monthKey(now)}.jsonl`;
}

/**
 * 追加一条回执。
 * @returns {{ok:boolean, rel:string, error?:string}}
 */
export function appendReceipt(root, receipt) {
  const rel = receiptsRel(receipt && receipt.startedAtMs ? receipt.startedAtMs : Date.now());
  try {
    const abs = path.join(root, rel.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.appendFileSync(abs, `${JSON.stringify(receipt)}\n`, 'utf8');
    return { ok: true, rel };
  } catch (error) {
    return { ok: false, rel, error: String((error && error.message) || error) };
  }
}

/** 读最近 N 条回执（新的在后）。文件不存在/坏行都不抛。 */
export function readReceipts(root, { limit = 20, now = Date.now(), month } = {}) {
  const rel = month ? `${RECEIPTS_DIR}/${month}.jsonl` : receiptsRel(now);
  const abs = path.join(root, rel.split('/').join(path.sep));
  let text = '';
  try { text = fs.readFileSync(abs, 'utf8'); } catch { return []; }
  const all = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try { all.push(JSON.parse(s)); } catch { /* 坏行跳过 */ }
  }
  return all.slice(-Math.max(1, limit));
}

/** 面板/agent 用的紧凑视图：去掉大字段（raw/stderr），只留结论。 */
export function summarizeReceipt(r) {
  if (!r || typeof r !== 'object') return null;
  return {
    receiptId: r.receiptId,
    action: r.action,
    legacyName: r.legacyName || null,
    source: r.source,
    ok: r.ok !== false,
    durationMs: r.durationMs,
    startedAt: r.startedAt,
    wrote: Array.isArray(r.wrote) ? r.wrote.slice(0, 12) : [],
    warnings: Array.isArray(r.warnings) ? r.warnings.slice(0, 6) : [],
    summary: String(r.summary || '').slice(0, 240),
    confirmation: r.confirmation || null,
  };
}

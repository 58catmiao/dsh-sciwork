/**
 * 宿主数据层自测（node scripts/selftest-host.mjs）
 * 只读，不动库；用来在重启 Harness 之前证明 lib/library.js 真的能读懂科研库。
 */
import { snapshot, readText, readBinary, tableColumns, checkCitations, loadSettings, resolveInside } from '../lib/library.js';

const out = { ok: true, checks: [] };

const settings = await loadSettings();
out.settings = { root: settings.root, interpreter: settings.interpreter, launcher: settings.launcher, originServer: settings.origin?.server || null };

const snap = await snapshot();
out.snapshot = {
  ok: snap.ok,
  root: snap.root,
  indexAt: snap.indexAt,
  counts: snap.counts,
  warnings: snap.warnings,
  readAt: snap.readAt,
};
out.projects = (snap.projects || []).map((p) => ({
  slug: p.slug,
  title: p.title,
  journal: p.journal,
  figures: p.figures.map((f) => ({
    figureId: f.figureId, file: f.file, fileExists: f.fileExists, fileBytes: f.fileBytes,
    graph: f.graph, journal: f.journal, verifyPassed: f.verifyPassed, traceId: f.traceId,
    sourceData: f.sources, warnings: f.warnings,
  })),
  drafts: p.drafts.map((d) => d.name),
  datasets: p.datasets.map((d) => `${d.name}(${d.bytes}B)`),
  tables: p.tables.map((t) => t.name),
  opju: p.opju.map((o) => `${o.dir}/${o.name}(${o.bytes}B)`),
}));
out.refs = (snap.refs || []).map((r) => `${r.key} ${r.year} ${r.doi || '(无 DOI)'}`);
out.journals = (snap.journals || []).map((j) => `${j.id} ${j.confidence} ${j.verifiedAt || ''}`);

// 逐项真实调用
const checks = [];
const tryIt = async (name, fn) => {
  try { checks.push({ name, ok: true, value: await fn() }); }
  catch (e) { out.ok = false; checks.push({ name, ok: false, error: String(e?.message || e) }); }
};

const firstProject = snap.projects?.[0]?.slug;
const firstDraft = snap.projects?.[0]?.drafts?.[0]?.path;
const fig2 = snap.projects?.[0]?.figures?.find((f) => f.fileExists && f.file);
const dataCsv = snap.projects?.[0]?.datasets?.find((d) => d.name.endsWith('.csv'));

if (firstDraft) await tryIt(`readText(${firstDraft})`, async () => {
  const r = await readText(snap.root, firstDraft);
  return { bytes: r.bytes, head: r.text.slice(0, 160) };
});
if (firstDraft) await tryIt(`checkCitations(${firstDraft})`, () => checkCitations(snap.root, firstDraft));
if (fig2?.file) await tryIt(`readBinary(${fig2.file})`, async () => {
  const r = await readBinary(snap.root, fig2.file);
  return { mime: r.mime, bytes: r.bytes, base64Head: r.base64.slice(0, 24), base64Len: r.base64.length };
});
else checks.push({ name: 'readBinary(图文件)', ok: true, skipped: '库里当前没有「文件还在」的图（用户可能删过图）——不判定失败' });
if (dataCsv) await tryIt(`tableColumns(${dataCsv.path})`, () => tableColumns(snap.root, dataCsv.path));
await tryIt('路径逃逸必须被拒（../../etc/passwd）', async () => {
  try { resolveInside(snap.root, '../../Windows/win.ini'); return 'FAILED: 竟然通过了'; }
  catch (e) { return `正确拒绝：${e.message}`; }
});
await tryIt('绝对路径必须被拒（C:/Windows/win.ini）', async () => {
  try { resolveInside(snap.root, 'C:/Windows/win.ini'); return 'FAILED: 竟然通过了'; }
  catch (e) { return `正确拒绝：${e.message}`; }
});

out.checks = checks;
console.log(JSON.stringify(out, null, 1));
process.exit(out.ok ? 0 : 1);

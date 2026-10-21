/**
 * 0.3 · 课题模型 / 迁移 / 备份 自检（无第三方依赖，直接 node 跑）
 * ---------------------------------------------------------------------------
 * 覆盖 PLAN §14：阶段机推进/退回、产物哈希、双读合成、迁移幂等、备份核对与恢复。
 * 全部在临时目录里跑，不碰真库。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createBackup, restoreBackup, manifestOf } from '../lib/backup.js';
import { applyMigration, planMigration } from '../lib/migrate.js';
import {
  blocksWrite, computeChecks, deriveArtifacts, listProjects, nextStep, readProject,
  setStage, sha256Of, writeProject,
} from '../lib/projects.js';

let pass = 0;
let fail = 0;
function check(label, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  PASS  ${label}${detail ? `  —— ${detail}` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? `  —— ${detail}` : ''}`); }
}
const write = (abs, body) => { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, body); };

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sciwork-proj-'));
  write(path.join(root, '.research', 'config.json'), '{"libraryRoot":"."}\n');
  // alpha：旧形状 project.json + 数据 + 草稿
  write(path.join(root, 'projects', 'alpha', 'project.json'), JSON.stringify({
    schema: 1, slug: 'alpha', title: '甲课题', createdAt: '2026-10-01T00:00:00+08:00',
    journal: null, keywords: ['k'], notes: '', updatedAt: '2026-10-01T00:00:00+08:00',
  }));
  write(path.join(root, 'projects', 'alpha', 'data', 'raw.csv'), 'x,y\n1,2\n');
  write(path.join(root, 'projects', 'alpha', 'drafts', 'main.md'), '# 草稿\n');
  // beta：没有 project.json，只有图 + 侧车 + 派生表
  write(path.join(root, 'projects', 'beta', 'figures', 'fig1.png'), 'png');
  write(path.join(root, 'projects', 'beta', 'figures', 'fig1.json'), '{"data":["data/raw.csv"]}');
  write(path.join(root, 'projects', 'beta', 'tables', 't1.csv'), 'a,b\n');
  return root;
}

const root = makeFixture();
const ckptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sciwork-bak-'));

console.log('\n[1] 双读');
{
  const alpha = readProject(root, 'alpha');
  check('旧形状 project.json 被识别为 legacy 形状', alpha.needsSchemaUpgrade === true && blocksWrite(alpha.project));
  check('旧形状保留标题/关键词', alpha.project.title === '甲课题' && alpha.project.keywords.includes('k'));
  check('阶段按目录估算：有草稿 = draft', alpha.project.stage === 'draft');
  check('产物从目录合成（data+draft）', alpha.project.artifacts.some((a) => a.kind === 'data') && alpha.project.artifacts.some((a) => a.kind === 'draft'));

  const beta = readProject(root, 'beta');
  check('没有 project.json → legacy 双读', beta.legacy === true && beta.project.legacyShape === true);
  check('阶段按目录估算：有图 = figure', beta.project.stage === 'figure');
  check('有图有表 → 都算产物', deriveArtifacts(root, 'beta').length === 3);

  const list = listProjects(root);
  check('listProjects 两个课题都在', list.length === 2 && list.map((p) => p.slug).sort().join(',') === 'alpha,beta');
}

console.log('\n[2] 阶段机');
{
  const beta = readProject(root, 'beta').project;
  const forward = setStage(beta, 'draft');
  check('前进一步', forward.to === 'draft' && forward.project.stages.figure.status === 'done');
  check('同一时刻只有一个 active', Object.values(forward.project.stages).filter((s) => s.status === 'active').length === 1);
  const back = setStage(forward.project, 'figure');
  check('退回一步', back.to === 'figure' && back.project.stages.draft.status === 'pending');
  let err = null;
  try { setStage(beta, 'submission'); } catch (e) { err = e; }
  check('跳阶段不带 force → 拒绝', err && err.code === 'bad-request');
  const jumped = setStage(beta, 'submission', { force: true });
  check('跳阶段带 force → 通过且带 warning', jumped.warnings.length === 1 && jumped.project.stage === 'submission');
}

console.log('\n[3] 检查项 / 下一步');
{
  const beta = readProject(root, 'beta').project;
  const checks = computeChecks(beta, root);
  check('figure 阶段有图 + 有侧车 → 全过', checks.figure.every((c) => c.status === 'pass'));
  const alpha = readProject(root, 'alpha').project;
  const next = nextStep(alpha, root);
  check('旧形状的 next 先提示迁移', next.todo.some((t) => t.action === 'system.migrate'));
  check('ready 由阻塞项决定', typeof next.ready === 'boolean');
  check('sha256 有值且稳定', sha256Of(root, 'projects/alpha/data/raw.csv') === sha256Of(root, 'projects/alpha/data/raw.csv'));
  check('sha256 对不存在文件返回 null', sha256Of(root, 'projects/alpha/data/nope.csv') === null);
}

console.log('\n[4] 写入（0.3 形状）');
{
  const beta = readProject(root, 'beta');
  const next = { ...beta.project, legacyShape: false, history: [] };
  writeProject(root, 'beta', next);
  const again = readProject(root, 'beta');
  check('写回后是 0.3 形状', again.source === 'project.json' && again.needsSchemaUpgrade === false);
  check('写回后可写', blocksWrite(again.project) === false);
  check('project.json 落在课题目录里', fs.existsSync(path.join(root, 'projects', 'beta', 'project.json')));
}

console.log('\n[5] 迁移');
{
  const alphaFile = path.join(root, 'projects', 'alpha', 'project.json');
  const beforeText = fs.readFileSync(alphaFile, 'utf8');
  const plan = planMigration(root);
  check('alpha 升级 / beta 跳过', plan.projects.find((p) => p.slug === 'alpha').action === 'upgrade' && plan.projects.find((p) => p.slug === 'beta').action === 'skip');
  check('plan 只读：原文件一字未动', fs.readFileSync(alphaFile, 'utf8') === beforeText);
  const first = await applyMigration(root, { backupPath: 'test-backup.zip', at: '2026-10-21T12:00:00Z' });
  check('首轮迁移：1 写入 1 跳过', first.counts.applied === 1 && first.counts.skipped === 1);
  const alpha = readProject(root, 'alpha');
  check('迁移后 alpha 是 0.3 形状', alpha.needsSchemaUpgrade === false && blocksWrite(alpha.project) === false);
  check('迁移记录写进 .research/migration.json', fs.existsSync(path.join(root, '.research', 'migration.json')));
  const second = await applyMigration(root, { backupPath: 'test-backup.zip', at: '2026-10-21T12:05:00Z' });
  check('再跑一遍幂等：全跳过、零写入', second.counts.applied === 0 && second.counts.skipped === 2);
  const log = JSON.parse(fs.readFileSync(path.join(root, '.research', 'migration.json'), 'utf8'));
  check('migration.json 追加两条运行记录', log.runs.length === 2);
}

console.log('\n[6] 备份 / 恢复');
{
  const before = manifestOf(root);
  const backup = createBackup(root, { dir: ckptDir });
  check('备份核验通过', backup.verified === true && backup.files === before.files, `${backup.files} 文件`);
  check('manifest 与备份同目录', fs.existsSync(backup.manifest));
  const target = path.join(ckptDir, 'restored');
  const restored = restoreBackup(backup.file, target);
  check('恢复后文件数一致', restored.files === before.files && restored.verified === true);
  const after = manifestOf(target);
  check('恢复内容逐文件一致', JSON.stringify(after.sha256) === JSON.stringify(before.sha256));
  let refused = null;
  try { restoreBackup(backup.file, target); } catch (e) { refused = e; }
  check('非空目录不覆盖（需 force）', refused && refused.code === 'conflict');
}

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(ckptDir, { recursive: true, force: true });

console.log(`\n${'='.repeat(72)}`);
console.log(`${pass} 通过 · ${fail} 失败`);
process.exit(fail ? 1 : 0);

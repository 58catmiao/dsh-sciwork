/**
 * 科研模式 0.3 · 迁移（PLAN §11.2）
 * ---------------------------------------------------------------------------
 * `planMigration()` 只读扫描：按课题目录算出「会写哪些 project.json、缺哪些文件」。
 * `applyMigration()` 先保证有当日备份，再逐课题写 0.3 形状的 project.json，
 * 最后追加 `.research/migration.json` 记录。整套操作**幂等**：
 *   - 已是 0.3 形状 → skip；
 *   - 旧形状/没有 → create / upgrade（字段保留：title/journal/keywords/notes/createdAt）。
 *
 * 纪律：本模块只被动作层调用；迁移演练一律在库副本上跑（PLAN §11.4），真库不动。
 */

import fs from 'node:fs';
import path from 'node:path';

import { badRequest } from './host/errors.js';
import {
  MIGRATION_FILE, SCHEMA_VERSION, deriveArtifacts, isV1Project, projectDirRel,
  projectFileRel, readProject, readProjectFile, writeProject,
} from './projects.js';

const nowIso = () => new Date().toISOString();

function listProjectSlugs(root) {
  const dir = path.join(root, 'projects');
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

function readMigrationLog(root) {
  const abs = path.join(root, MIGRATION_FILE);
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

/** 只读扫描：不写盘，不碰真库。 */
export function planMigration(root) {
  const projects = [];
  for (const slug of listProjectSlugs(root)) {
    const info = readProjectFile(root, slug);
    const artifacts = deriveArtifacts(root, slug);
    const action = !info ? 'create' : isV1Project(info.raw) ? 'skip' : 'upgrade';
    const missing = artifacts.filter((a) => !fs.existsSync(path.join(root, a.path))).map((a) => a.path);
    projects.push({
      slug,
      action,
      projectFile: projectFileRel(slug),
      currentHash: info ? info.hash : null,
      artifacts: artifacts.length,
      missing,
      writes: action === 'skip' ? [] : [projectFileRel(slug)],
    });
  }
  const writes = projects.flatMap((p) => p.writes);
  const summary = {
    projects: projects.length,
    create: projects.filter((p) => p.action === 'create').length,
    upgrade: projects.filter((p) => p.action === 'upgrade').length,
    skip: projects.filter((p) => p.action === 'skip').length,
    writes: writes.length,
  };
  return { projects, writes, summary, migrationFile: MIGRATION_FILE };
}

/**
 * 执行迁移。
 * @param {string} root 库根（演练时指向副本）
 * @param {{backupPath?:string, ensureBackup?:Function, at?:string}} options
 *        ensureBackup: 没有 backupPath 时由调用方（动作层）注入的备份函数，返回 {file, verified}
 */
export async function applyMigration(root, options = {}) {
  const plan = planMigration(root);
  const appliable = plan.projects.filter((p) => p.action !== 'skip');
  let backupPath = options.backupPath || null;
  let backupVerified = null;
  if (appliable.length && !backupPath) {
    if (typeof options.ensureBackup !== 'function') {
      throw badRequest('迁移前必须先备份：没有 backupPath，且调用方没提供备份函数（先跑 system.backup）');
    }
    const backup = await options.ensureBackup();
    backupPath = backup.file;
    backupVerified = backup.verified === true;
  }

  const at = options.at || nowIso();
  const applied = [];
  const skipped = [];
  const failed = [];
  for (const item of plan.projects) {
    if (item.action === 'skip') {
      skipped.push(item.slug);
      continue;
    }
    const before = readProjectFile(root, item.slug);
    const original = before ? fs.readFileSync(before.abs) : null;
    try {
      const read = readProject(root, item.slug);
      const project = {
        ...read.project,
        createdAt: read.project.createdAt || at,
        updatedAt: at,
        migration: { from: item.action, at, backupPath: backupPath || null },
      };
      const written = writeProject(root, item.slug, project);
      applied.push({ slug: item.slug, action: item.action, hash: written.hash, bytes: written.bytes });
    } catch (error) {
      // 单课题失败：把 project.json 恢复原样，其余课题继续（失败项写进回执）
      try {
        if (original === null) fs.rmSync(path.join(root, projectFileRel(item.slug)), { force: true });
        else fs.writeFileSync(before.abs, original);
      } catch { /* 恢复失败不掩盖原始错误 */ }
      failed.push({ slug: item.slug, error: String((error && error.message) || error) });
    }
  }

  const log = readMigrationLog(root) || { schemaVersion: SCHEMA_VERSION, runs: [] };
  const run = {
    appliedAt: at,
    backupPath: backupPath || null,
    backupVerified,
    applied,
    skipped,
    failed,
    counts: { applied: applied.length, skipped: skipped.length, failed: failed.length },
  };
  log.schemaVersion = SCHEMA_VERSION;
  log.runs = Array.isArray(log.runs) ? log.runs.concat([run]) : [run];
  const abs = path.join(root, MIGRATION_FILE);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(log, null, 1)}\n`, 'utf8');

  return {
    applied, skipped, failed,
    backupPath: backupPath || null,
    backupVerified,
    migrationFile: MIGRATION_FILE,
    counts: run.counts,
  };
}

export { MIGRATION_FILE, projectDirRel };

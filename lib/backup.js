/**
 * 科研模式 0.3 · 库备份 / 恢复（PLAN §11.1）
 * ---------------------------------------------------------------------------
 * 备份 = 一个 zip + 一份 manifest（文件数 / 总字节 / 逐文件 sha256）。
 * 判断「备份可用」的唯一标准：**解压到临时目录后逐文件复算一致**；
 * 没通过核对的备份不许进入迁移（`verified:false` 会被迁移动作拒绝）。
 *
 * 用系统 `tar`（Windows 10+ 自带 bsdtar，`-a` 按扩展名选格式），
 * 不引入第三方依赖，也不把绝对路径写进清单。
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { badRequest, conflict } from './host/errors.js';

export const BACKUP_PREFIX = 'sciwork-lib-';
const MAX_FILES = 200_000;

/** 默认备份位置：库根的兄弟目录（备份在库外，避免把备份自己打进 zip）。 */
export function defaultBackupDir(root) {
  return path.resolve(root, '..', 'sciwork-backups');
}

export function backupStamp(date = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
}

function sha256File(abs) {
  const h = crypto.createHash('sha256');
  const buf = fs.readFileSync(abs);
  h.update(buf);
  return h.digest('hex');
}

/** 遍历根下全部常规文件（不跟随符号链接），返回相对路径清单。 */
export function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out.push(abs);
      if (out.length > MAX_FILES) throw badRequest(`库文件超过 ${MAX_FILES} 个，拒绝一次性备份（先分批/清理）`);
    }
  };
  walk(root);
  return out.map((abs) => path.relative(root, abs).split(path.sep).join('/')).sort();
}

/** 清单：文件数、总字节、逐文件 sha256（相对路径 → hash）。 */
export function manifestOf(root) {
  const files = listFiles(root);
  const sha256 = {};
  let bytes = 0;
  for (const rel of files) {
    const abs = path.join(root, ...rel.split('/'));
    bytes += fs.statSync(abs).size;
    sha256[rel] = sha256File(abs);
  }
  return { files: files.length, bytes, sha256 };
}

// Git Bash 的 GNU tar 会把「E:/x」当成「主机:路径」去连 E:，-C 传盘符路径也不稳。
// 统一做法：切到工作目录，zip 只传相对路径（不含冒号），正斜杠分隔。
const relSlash = (from, to) => path.relative(from, to).split(path.sep).join('/');
function tar(args, cwd) {
  const r = spawnSync('tar', args, { encoding: 'utf8', cwd });
  if (r.error) throw badRequest(`系统 tar 不可用：${String(r.error.message || r.error)}`);
  if (r.status !== 0) {
    throw badRequest(`tar 失败（退出 ${r.status}）：${String(r.stderr || '').trim().slice(0, 400)}`);
  }
  return r;
}

/**
 * 建备份并立刻核对。
 * @returns {{file:string, bytes:number, files:number, verified:boolean, problems:string[], manifest:string}}
 */
export function createBackup(root, { dir } = {}) {
  const targetDir = dir ? path.resolve(dir) : defaultBackupDir(root);
  fs.mkdirSync(targetDir, { recursive: true });
  const file = path.join(targetDir, `${BACKUP_PREFIX}${backupStamp()}.zip`);
  tar(['-a', '-c', '-f', relSlash(root, file), '.'], root);
  const source = manifestOf(root);
  const verified = verifyArchive(file, source);
  const manifestPath = `${file}.manifest.json`;
  fs.writeFileSync(manifestPath, `${JSON.stringify({ ...source, file: path.basename(file), createdAt: new Date().toISOString(), verified: verified.ok }, null, 1)}\n`, 'utf8');
  if (!verified.ok) {
    throw badRequest(`备份核对失败（${verified.problems.length} 处不一致），这份备份不可用于迁移：${file}`, { problems: verified.problems.slice(0, 10) });
  }
  return {
    file,
    bytes: fs.statSync(file).size,
    files: source.files,
    verified: true,
    problems: verified.problems,
    manifest: manifestPath,
  };
}

/** 解压到临时目录，与给定清单逐文件比对。 */
export function verifyArchive(file, sourceManifest) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sciwork-verify-'));
  try {
    tar(['-x', '-f', relSlash(tmp, file)], tmp);
    const got = manifestOf(tmp);
    const problems = [];
    if (got.files !== sourceManifest.files) problems.push(`文件数不一致：清单 ${sourceManifest.files} / 解压 ${got.files}`);
    for (const [rel, hash] of Object.entries(sourceManifest.sha256)) {
      if (!(rel in got.sha256)) problems.push(`缺文件：${rel}`);
      else if (got.sha256[rel] !== hash) problems.push(`内容不一致：${rel}`);
    }
    for (const rel of Object.keys(got.sha256)) {
      if (!(rel in sourceManifest.sha256)) problems.push(`多出文件：${rel}`);
    }
    return { ok: problems.length === 0, problems, files: got.files, bytes: got.bytes };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** 读同目录 manifest（恢复时优先用它做核对）。 */
export function readManifest(file) {
  const p = `${file}.manifest.json`;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 恢复到一个**空目录**（先核对再落盘；不替换正在用的库）。
 * @returns {{targetDir:string, files:number, verified:boolean}}
 */
export function restoreBackup(file, targetDir, { force = false } = {}) {
  if (!fs.existsSync(file)) throw badRequest(`备份不存在：${path.basename(file)}`);
  const target = path.resolve(targetDir);
  if (fs.existsSync(target)) {
    const entries = fs.readdirSync(target);
    if (entries.length && !force) {
      throw conflict(`目标目录不是空的：${target}（先恢复到空目录核对，再替换；确需覆盖用 force）`);
    }
  }
  const manifest = readManifest(file);
  if (!manifest) throw badRequest('这份备份没有 manifest，无法核对，拒绝恢复');
  const check = verifyArchive(file, manifest);
  if (!check.ok) throw badRequest('备份核对失败，拒绝恢复', { problems: check.problems.slice(0, 10) });
  fs.mkdirSync(target, { recursive: true });
  tar(['-x', '-f', relSlash(target, file)], target);
  return { targetDir: target, files: check.files, verified: true };
}

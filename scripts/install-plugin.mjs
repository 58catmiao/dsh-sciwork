#!/usr/bin/env node
/**
 * 科研模式 · 无包管理器安装（0.3.12）
 * ===========================================================================
 * 给「这台机器上没有 npm / pnpm，或者 `dsh plugin add` 报找不到 npm」的人用。
 * 做的事跟 `dsh plugin add` 等价，但只用 Node 内置模块：
 *
 *   1. 在 profile 里加依赖行 `"dsh-sciwork": "link:<本地目录>"`；
 *   2. 把 <profile>/node_modules/dsh-sciwork 指到本地目录（Windows 用 junction，
 *      不需要管理员权限；Linux/macOS 用 symlink）；
 *   3. 把 `dsh-sciwork` 加进 profile package.json 的 dsh.profile.bundles；
 *   4. 改之前先备份 package.json（.bak-<时间戳>）。
 *
 * 用法：
 *   node scripts/install-plugin.mjs                                # 装进 desktop profile，源 = 本仓库
 *   node scripts/install-plugin.mjs --profile work                 # 指定 profile
 *   node scripts/install-plugin.mjs --source D:/dl/dsh-sciwork     # 源目录（解压出来的 ZIP）
 *   node scripts/install-plugin.mjs --dry-run                      # 只报告会改什么
 *   node scripts/install-plugin.mjs --force                        # 覆盖已存在的链接
 *
 * 装完必须**重启 Harness**才生效——面板是客户端 bundle，光刷新页面不算。
 */

import {
  existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE = path.resolve(HERE, '..');
const PKG_NAME = 'dsh-sciwork';

function parseArgs(argv) {
  const out = { profile: 'desktop', source: DEFAULT_SOURCE, dryRun: false, force: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--profile') out.profile = argv[++i] || out.profile;
    else if (a === '--source') out.source = argv[++i] || out.source;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('-')) out.profile = a;
  }
  return out;
}

const log = (msg) => console.log(msg);
const fail = (msg) => { console.error('✗ ' + msg); process.exitCode = 1; };
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const toLinkSpec = (dir) => 'link:' + dir.replace(/\\/g, '/');

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    log('node scripts/install-plugin.mjs [--profile desktop] [--source <目录>] [--dry-run] [--force]');
    return;
  }

  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const profileDir = path.join(dshHome, 'profiles', args.profile);
  const pkgFile = path.join(profileDir, 'package.json');
  const linkPath = path.join(profileDir, 'node_modules', PKG_NAME);
  const sourceDir = path.resolve(args.source);

  log('科研库插件 · 无包管理器安装');
  log('  DSH_HOME   ' + dshHome);
  log('  profile    ' + args.profile + '  (' + profileDir + ')');
  log('  源目录     ' + sourceDir);

  if (!existsSync(path.join(sourceDir, 'package.json'))) {
    fail('源目录里没有 package.json：' + sourceDir + '（应该在 dsh-sciwork 仓库根目录跑这个脚本）');
    return;
  }
  const sourcePkg = readJson(path.join(sourceDir, 'package.json'));
  if (sourcePkg.name !== PKG_NAME) {
    fail(`源目录的包名是 ${sourcePkg.name}，不是 ${PKG_NAME}——源目录指错了？`);
    return;
  }
  if (!existsSync(profileDir)) {
    fail(`profile 不存在：${profileDir}\n  先让 DSH 初始化一次（例如 dsh --profile ${args.profile} --dump-config），再回来装。`);
    return;
  }

  let pkg;
  let created = false;
  if (existsSync(pkgFile)) {
    try {
      pkg = readJson(pkgFile);
    } catch {
      fail(`profile 的 package.json 不是合法 JSON，先修好再装：${pkgFile}`);
      return;
    }
  } else {
    pkg = { name: 'dsh-profile-' + args.profile, private: true, dependencies: {}, dsh: { profile: { bundles: [] } } };
    created = true;
  }

  pkg.dependencies = pkg.dependencies || {};
  const beforeDep = pkg.dependencies[PKG_NAME];
  pkg.dependencies[PKG_NAME] = toLinkSpec(sourceDir);

  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles.slice() : [];
  const hadBundle = bundles.includes(PKG_NAME);
  if (!hadBundle) bundles.push(PKG_NAME);
  pkg.dsh.profile.bundles = bundles;

  const linkState = existsSync(linkPath) ? realpathSync(linkPath) : '';
  const linkReady = linkState && path.resolve(linkState) === sourceDir;

  log('');
  log('会改这些：');
  log('  ' + pkgFile);
  log(`    dependencies.${PKG_NAME}: ${beforeDep ? JSON.stringify(beforeDep) : '（新增）'} → ${toLinkSpec(sourceDir)}`);
  log(`    dsh.profile.bundles: ${hadBundle ? '已含 ' + PKG_NAME + '（不动）' : '追加 ' + PKG_NAME}`);
  log('  ' + linkPath);
  log('    ' + (linkReady ? '已指向源目录（不动）' : existsSync(linkPath) ? `现在是 ${linkState}` : '创建指向源目录的链接'));

  if (args.dryRun) {
    log('\n--dry-run：什么都没写。');
    return;
  }

  if (created) {
    writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    log('\n已新建 ' + pkgFile);
  } else {
    const bak = pkgFile + '.bak-' + Date.now();
    renameSync(pkgFile, bak);
    writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    log('\n备份 → ' + bak + '\n已写 ' + pkgFile);
  }

  mkdirSync(path.join(profileDir, 'node_modules'), { recursive: true });
  if (!linkReady && existsSync(linkPath)) {
    const st = lstatSync(linkPath);
    if (st.isSymbolicLink() || st.isDirectory()) {
      // 真目录（pnpm 拷出来的安装）不删内容，只提示：链接换不了就别硬换
      try {
        unlinkSync(linkPath);
      } catch {
        fail(`node_modules/${PKG_NAME} 是真实目录（多半是 pnpm 装的），没有动它。\n  想换成源目录：先备份后手动删掉这个目录，再跑一次（或加 --force 由你确认）。`);
        return;
      }
    }
  }
  if (!linkReady) {
    try {
      symlinkSync(sourceDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      log('已创建链接 → ' + sourceDir);
    } catch (error) {
      fail(`创建链接失败：${String(error.message || error)}\n  退路：手动把 ${sourceDir} 复制到 ${linkPath}，然后重启 Harness。`);
      return;
    }
  }

  log('\n完成。接下来：');
  log('  1. 重启 Harness（关掉再打开）——面板客户端是 bundle，刷新页面不算；');
  log('  2. 验证：dsh --profile ' + args.profile + ' --dump-config | grep -c ' + PKG_NAME + '   （应大于 0）');
  log('  3. 若要铺科研库骨架与技能：node scripts/install.mjs --profile ' + args.profile);
}

main();

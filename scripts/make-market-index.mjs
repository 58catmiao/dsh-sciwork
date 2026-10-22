#!/usr/bin/env node
/**
 * make-market-index.mjs —— 生成本插件的「插件市场索引」（format 1）。
 * ---------------------------------------------------------------------------
 * DSH 的插件市场（`@deepseek-ai/dsh-plugin-market`）不抓 GitHub、也不猜仓库：
 * 它只读用户手动填进去的 **index URL**。所以想让人在「插件 → 发现」里一键装、
 * 之后还能看到新版本，就得自己提供一份索引，这就是本脚本的产出。
 *
 * 产物：`market/plugins.json`，git 源 + **钉死 commit**（市场的安装参数是
 * `git+<url>.git#<40 位 commit>`，钉不住 commit 的索引会被校验拒绝）。
 *
 * 为什么不用 npm 源：本包没有发布到 npm（`npm view dsh-sciwork` → 404）。
 * 将来若发了 npm，再给版本加一条 `{type:'npm'}` 即可，格式允许混用。
 *
 * 用法：
 *   node scripts/make-market-index.mjs                 # 按 package.json 版本 + v<版本> tag（没有就 HEAD）生成
 *   node scripts/make-market-index.mjs --commit <sha>  # 指定 commit
 *   node scripts/make-market-index.mjs --check         # 只核对：已提交的索引是否指向当前发布
 *   node scripts/make-market-index.mjs --validate      # 只校验：已提交的索引是否符合 format 1
 *   node scripts/make-market-index.mjs --stdout        # 打到 stdout，不写盘
 *
 * 退出码：0 正常；1 校验/陈旧；2 用法或环境不对。
 *
 * 发布节奏（重要）：索引要指向**已经打上 tag 的那个 commit**，所以顺序是
 *   1) 提交 + 打 tag v0.3.x   2) node scripts/make-market-index.mjs --commit v0.3.x
 *   3) 提交 market/plugins.json（这条提交本身不进索引，也不该进）
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGV = process.argv.slice(2);

/** 仓库（索引里的 homepage / repository 也从这里来）。 */
const REPO_SLUG = '58catmiao/dsh-sciwork';
const REPO_URL = `https://github.com/${REPO_SLUG}`;
/** 索引文件位置（相对仓库根）。 */
const OUT_FILE = 'market/plugins.json';
/** 插件包名（必须与 package.json 的 name 一致，市场按包名去重）。 */
const PKG_NAME = 'dsh-sciwork';

function usage(message) {
  if (message) console.error(`× ${message}`);
  console.error('用法：node scripts/make-market-index.mjs [--commit <sha|ref>] [--version <x.y.z>] [--out <path>] [--check|--validate|--stdout]');
  process.exit(2);
}

function argValue(flag, fallback) {
  const i = ARGV.indexOf(flag);
  if (i === -1) return fallback;
  const value = ARGV[i + 1];
  if (!value || value.startsWith('--')) usage(`${flag} 后面要跟一个值`);
  return value;
}

const MODE = ARGV.includes('--check') ? 'check' : ARGV.includes('--validate') ? 'validate' : ARGV.includes('--stdout') ? 'stdout' : 'write';
const OUT_PATH = path.resolve(ROOT, argValue('--out', OUT_FILE));

function git(args) {
  const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });
  if (r.status !== 0) return '';
  return (r.stdout || '').trim();
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
if (pkg.name !== PKG_NAME) usage(`package.json 的 name 是 ${JSON.stringify(pkg.name)}，本脚本只认 ${JSON.stringify(PKG_NAME)}`);
const version = argValue('--version', pkg.version);

/* ------------------------------------------------------------ 取 commit 与时间 */

/** 把 ref 解析成 40 位 commit（解析不出来就退出，绝不猜）。 */
function resolveCommit(ref) {
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`]);
  if (!/^[0-9a-f]{40}$/.test(sha)) usage(`解析不出 commit：${ref}`);
  return sha;
}

const requestedRef = argValue('--commit', '');
const ref = requestedRef || (git(['rev-parse', '--verify', `v${version}^{commit}`]) ? `v${version}` : 'HEAD');
const commit = resolveCommit(ref);
const epoch = Number(git(['show', '-s', '--format=%ct', commit]));
if (!Number.isInteger(epoch) || epoch <= 0) usage(`读不到 ${commit} 的提交时间`);
const taggedVersion = git(['describe', '--tags', '--exact-match', commit]).replace(/^v/, '');
if (requestedRef && taggedVersion && taggedVersion !== version) {
  console.error(`! 注意：${ref} 上的 tag 是 v${taggedVersion}，而 --version 写的是 ${version}`);
}

/* ------------------------------------------------------------ 组索引 */

/** 一条版本记录：git 源 + 钉死 commit。 */
function versionEntry(v, sha, at) {
  return {
    version: v,
    publishTimestamp: at,
    source: { type: 'git', url: REPO_URL, commit: sha },
  };
}

/**
 * 生成索引。历史版本从已提交的索引里继承（同仓库、同包名、commit 仍然有效），
 * 这样老用户可以装回旧版；当前版本永远排在第一位（format 1 要求 SemVer 降序，
 * 但解析器自己会重排，这里保证「新版本一定在」）。
 */
function buildIndex() {
  /** @type {any[]} */
  let versions = [];
  try {
    const previous = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
    const entry = (previous.plugins || []).find((p) => p && p.name === PKG_NAME);
    if (entry && Array.isArray(entry.versions)) {
      versions = entry.versions.filter(
        (v) => v && typeof v.version === 'string' && v.source && v.source.type === 'git' && /^[0-9a-f]{40}$/.test(v.source.commit),
      );
    }
  } catch {
    /* 没有旧索引 / 旧索引坏了：从空开始，不算错 */
  }
  versions = versions.filter((v) => v.version !== version);
  versions.push(versionEntry(version, commit, epoch));

  return {
    format: 1,
    title: { en: 'dsh-sciwork plugins', zh: '科研模式 · dsh-sciwork' },
    description: {
      en: 'Research mode for DeepSeek Harness: project stages, figures, references, drafting, submission prep.',
      zh: 'DeepSeek Harness 的科研模式：课题阶段、出图、文献、写作、投稿准备，带一块科研库面板。',
    },
    metadata: {
      categories: {
        research: { title: { en: 'Research', zh: '科研' } },
      },
      labels: {
        plugin: { title: { en: 'Plugin', zh: '插件' } },
      },
    },
    plugins: [
      {
        name: PKG_NAME,
        title: { en: 'Research mode (dsh-sciwork)', zh: '科研模式' },
        description: {
          en: 'Seven-stage research workflow with a library panel: projects, figures, references, drafts, journals, submissions.',
          zh: '课题七阶段 + 科研库面板：课题、图、文献、草稿、期刊档案、投稿',
        },
        author: '58catmiao',
        homepage: REPO_URL,
        repository: { url: REPO_URL },
        metadata: { category: 'research', labels: ['plugin'], keywords: ['research', 'origin', 'paper', 'reference', 'submission'] },
        versions,
      },
    ],
  };
}

/* ------------------------------------------------------------ 校验（对齐 format 1） */

const LANGUAGE_ID = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
const COMMIT = /^[0-9a-f]{40}$/;

/**
 * 按 `@deepseek-ai/dsh-plugin-market-index` 的规则校验（只覆盖本脚本会产出的字段；
 * 市场那边还会再校验一次，这里提前把能拦的拦住）。
 * @param {any} index - 已解析的索引。
 * @returns {string[]} 问题列表，空表示通过。
 */
function validateIndex(index) {
  const problems = [];
  const push = (at, why) => problems.push(`${at} ${why}`);
  const localized = (value, at) => {
    if (typeof value === 'string') {
      if (value.trim() === '') push(at, '不能是空白');
      return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return push(at, '必须是字符串或语言对象');
    for (const [lang, text] of Object.entries(value)) {
      if (!LANGUAGE_ID.test(lang)) push(`${at}.${lang}`, '语言 id 不合法');
      if (typeof text !== 'string' || text.trim() === '') push(`${at}.${lang}`, '必须是非空字符串');
    }
    if (!Object.hasOwn(value, 'en')) push(at, '必须含 en');
  };

  if (!index || typeof index !== 'object' || Array.isArray(index)) return ['$ 必须是对象'];
  if (index.format !== 1) push('$.format', '必须是 1');
  localized(index.title, '$.title');
  if (index.description !== undefined) localized(index.description, '$.description');
  if (!Array.isArray(index.plugins) || index.plugins.length === 0) push('$.plugins', '必须是非空数组');
  const declaredCategories = Object.keys((index.metadata && index.metadata.categories) || {});
  const declaredLabels = Object.keys((index.metadata && index.metadata.labels) || {});
  const names = new Set();
  (Array.isArray(index.plugins) ? index.plugins : []).forEach((plugin, i) => {
    const at = `$.plugins[${i}]`;
    if (!plugin || typeof plugin !== 'object') return push(at, '必须是对象');
    if (typeof plugin.name !== 'string' || !PACKAGE_NAME.test(plugin.name) || plugin.name.length > 214) push(`${at}.name`, '不是合法 npm 包名');
    if (names.has(plugin.name)) push(`${at}.name`, `重复 ${plugin.name}`);
    names.add(plugin.name);
    if (plugin.title !== undefined) localized(plugin.title, `${at}.title`);
    if (plugin.description !== undefined) localized(plugin.description, `${at}.description`);
    if (plugin.repository !== undefined) {
      if (!plugin.repository || typeof plugin.repository.url !== 'string' || !/^https?:\/\//.test(plugin.repository.url)) {
        push(`${at}.repository.url`, '必须是 http(s) 绝对地址');
      }
    }
    const meta = plugin.metadata || {};
    if (meta.category !== undefined && !declaredCategories.includes(meta.category)) push(`${at}.metadata.category`, '没有在 $.metadata.categories 里声明');
    for (const label of meta.labels || []) {
      if (!declaredLabels.includes(label)) push(`${at}.metadata.labels`, `没有声明的 label ${label}`);
    }
    if (!Array.isArray(plugin.versions) || plugin.versions.length === 0) push(`${at}.versions`, '必须是非空数组');
    const seen = new Set();
    for (const [j, v] of (Array.isArray(plugin.versions) ? plugin.versions : []).entries()) {
      const vat = `${at}.versions[${j}]`;
      if (!v || typeof v !== 'object') { push(vat, '必须是对象'); continue; }
      if (typeof v.version !== 'string' || !SEMVER.test(v.version)) push(`${vat}.version`, '必须是精确 SemVer');
      if (seen.has(v.version)) push(`${vat}.version`, `重复 ${v.version}`);
      seen.add(v.version);
      if (!Number.isInteger(v.publishTimestamp) || v.publishTimestamp < 0 || v.publishTimestamp >= 1e11) push(`${vat}.publishTimestamp`, '必须是 [0, 1e11) 的整数秒');
      const src = v.source || {};
      if (src.type === 'git') {
        if (!COMMIT.test(String(src.commit))) push(`${vat}.source.commit`, '必须是 40 位小写 hex');
        if (typeof src.url !== 'string' || !/^https?:\/\//.test(src.url)) push(`${vat}.source.url`, '必须是 http(s) 绝对地址');
      } else if (src.type === 'npm') {
        /* npm 源没有必需字段 */
      } else {
        push(`${vat}.source.type`, '必须是 "git" 或 "npm"');
      }
    }
  });
  return problems;
}

/* ------------------------------------------------------------ 执行 */

const index = buildIndex();
const problems = validateIndex(index);
if (problems.length) {
  console.error('× 生成的索引不合 format 1：');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
const json = `${JSON.stringify(index, null, 2)}\n`;

if (MODE === 'stdout') {
  process.stdout.write(json);
  process.exit(0);
}

if (MODE === 'check' || MODE === 'validate') {
  let existing;
  try {
    existing = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
  } catch (error) {
    console.error(`× 读不到 ${path.relative(ROOT, OUT_PATH)}：${String((error && error.message) || error)}`);
    process.exit(1);
  }
  if (MODE === 'validate') {
    const bad = validateIndex(existing);
    if (bad.length) {
      console.error(`× ${path.relative(ROOT, OUT_PATH)} 不合 format 1：`);
      for (const p of bad) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log(`✓ ${path.relative(ROOT, OUT_PATH)} 符合 format 1（${existing.plugins.length} 个插件）`);
    process.exit(0);
  }
  const entry = (existing.plugins || []).find((p) => p && p.name === PKG_NAME);
  const hit = entry && (entry.versions || []).find((v) => v && v.version === version);
  if (!hit) {
    console.error(`× 索引里没有 ${PKG_NAME}@${version}：重跑 node scripts/make-market-index.mjs --commit v${version}`);
    process.exit(1);
  }
  if (hit.source.commit !== commit) {
    console.error(`× 索引里 ${version} 指向 ${hit.source.commit}，但 v${version} 是 ${commit}：重跑 node scripts/make-market-index.mjs --commit v${version}`);
    process.exit(1);
  }
  console.log(`✓ 索引里 ${PKG_NAME}@${version} 指向 ${commit}`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, json, 'utf8');
const count = index.plugins[0].versions.length;
console.log(`✓ 写入 ${path.relative(ROOT, OUT_PATH)}：${PKG_NAME}@${version} → ${commit}（共 ${count} 个版本）`);
console.log('  下一步：在 DSH「插件 → 发现」里添加索引 URL');
console.log(`  https://raw.githubusercontent.com/${REPO_SLUG}/main/${OUT_FILE.replace(/\\/g, '/')}`);
if (index.plugins[0].versions.length > 1) {
  console.log(`  历史版本：${index.plugins[0].versions.map((v) => v.version).join(', ')}`);
}

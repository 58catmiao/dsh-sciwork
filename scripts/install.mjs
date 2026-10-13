#!/usr/bin/env node
// ---------------------------------------------------------------------------
// 科研模式 · 安装器
//
// 做两件事，都是幂等的：
//   1) 把本包 skills/ 下的技能装到用户级技能根（默认 ~/.dsh/skills）
//   2) 把科研库骨架铺到库根（默认取本包 library/config.json，没有则 config.example.json 的 libraryRoot）
//
// 用法：
//   node scripts/install.mjs [--skills-root <dir>] [--library-root <dir>]
//                            [--verify-only] [--skip-library] [--force-skills]
//
// 为什么是 .mjs 而不是 .ps1：本机 PowerShell 执行策略禁止未签名脚本。
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');

// ---- 参数 -----------------------------------------------------------------
const argv = process.argv.slice(2);
function argValue(name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) return fallback;
  return v;
}
const flag = (name) => argv.includes(name);

if (flag('--help') || flag('-h')) {
  console.log(`科研模式安装器

  --skills-root <dir>    技能安装根（默认 ${path.join(os.homedir(), '.dsh', 'skills')}）
  --library-root <dir>   科研库根（默认取 library/config.json，没有则 library/config.example.json 里的 libraryRoot，再没有就 ~/Research）
  --verify-only          只检查，不写任何文件
  --skip-library         不铺科研库骨架
  --force-skills         允许覆盖"看起来不是技能目录"的目标目录
  --force-scripts        强制覆盖库里的工具脚本（py.cmd / research.py / …），
                         默认只在 bundle 里的这份更新时才写
`);
  process.exit(0);
}

const verifyOnly = flag('--verify-only');
const skipLibrary = flag('--skip-library');
const forceSkills = flag('--force-skills');
// 工具脚本（py.cmd / research.py / …）的覆盖口径：默认只在 bundle 里的这份更新时才写，
// 以免把库里手工改过或现场更新过的版本回退掉。要强推用 --force-scripts。
const forceScripts = flag('--force-scripts');
const skillsRoot = path.resolve(argValue('--skills-root', path.join(os.homedir(), '.dsh', 'skills')));

const libraryTemplate = path.join(pkgRoot, 'library');
// 模板优先用 library/config.json（本机自用覆盖），否则用随仓库分发的 config.example.json
const configTemplate = ['config.json', 'config.example.json']
  .map((n) => path.join(libraryTemplate, n))
  .find((p) => fs.existsSync(p)) || null;
let libraryRoot = null;
if (configTemplate) {
  try {
    const cfg = JSON.parse(fs.readFileSync(configTemplate, 'utf8'));
    if (cfg.libraryRoot && !String(cfg.libraryRoot).startsWith('~')) libraryRoot = String(cfg.libraryRoot);
  } catch (err) {
    console.error(`! ${path.basename(configTemplate)} 解析失败：${err.message}`);
  }
}
libraryRoot = path.resolve(argValue('--library-root', libraryRoot || path.join(os.homedir(), 'Research')));

const report = { ok: [], warn: [], fail: [] };

// ---- 技能检查 -------------------------------------------------------------
function parseFrontmatter(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = text.slice(3, end);
  const out = {};
  let key = null;
  for (const raw of block.split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(raw);
    if (m) {
      key = m[1];
      out[key] = m[2].trim();
    } else if (key && raw.trim()) {
      out[key] = `${out[key]} ${raw.trim()}`.trim();
    }
  }
  return out;
}

const skillsDir = path.join(pkgRoot, 'skills');
if (!fs.existsSync(skillsDir)) {
  console.error(`× 找不到 skills/ 目录：${skillsDir}`);
  process.exit(1);
}
const skillNames = fs
  .readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

if (skillNames.length === 0) {
  console.error('× skills/ 下没有技能目录');
  process.exit(1);
}

const skills = [];
for (const name of skillNames) {
  const dir = path.join(skillsDir, name);
  const skillFile = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    report.fail.push(`技能 ${name}：缺 SKILL.md`);
    continue;
  }
  const fm = parseFrontmatter(fs.readFileSync(skillFile, 'utf8'));
  if (!fm) {
    report.fail.push(`技能 ${name}：SKILL.md 没有 frontmatter`);
    continue;
  }
  if (fm.name !== name) {
    report.fail.push(`技能 ${name}：frontmatter name="${fm.name}" 与目录名不一致`);
    continue;
  }
  if (!fm.description || fm.description.length < 20) {
    report.fail.push(`技能 ${name}：description 缺失或过短`);
    continue;
  }
  const size = fs.statSync(skillFile).size;
  report.ok.push(`技能 ${name}：frontmatter 合法（SKILL.md ${size} B, description ${fm.description.length} 字符）`);
  skills.push({ name, src: dir, dest: path.join(skillsRoot, name) });
}

if (report.fail.length) {
  console.error('× 技能预检未通过，未做任何改动：');
  for (const f of report.fail) console.error(`  - ${f}`);
  process.exit(1);
}

// ---- 安装技能 -------------------------------------------------------------
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function removePycache(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    if (e.name === '__pycache__') {
      fs.rmSync(p, { recursive: true, force: true });
      n++;
    } else n += removePycache(p);
  }
  return n;
}

for (const s of skills) {
  const existed = fs.existsSync(s.dest);
  if (existed && !forceSkills) {
    const looksOurs = fs.existsSync(path.join(s.dest, 'SKILL.md'));
    const empty = fs.readdirSync(s.dest).length === 0;
    if (!looksOurs && !empty) {
      report.warn.push(`技能 ${s.name}：目标已存在且没有 SKILL.md（${s.dest}），已跳过以免覆盖别人的目录；确认无误后加 --force-skills`);
      continue;
    }
  }
  if (verifyOnly) {
    report.ok.push(`技能 ${s.name}：将安装到 ${s.dest}（${existed ? '已存在，会被更新' : '新建'}）`);
    continue;
  }
  fs.mkdirSync(skillsRoot, { recursive: true });
  if (existed) fs.rmSync(s.dest, { recursive: true, force: true });
  fs.cpSync(s.src, s.dest, { recursive: true });
  const cleaned = removePycache(s.dest);
  report.ok.push(`技能 ${s.name} → ${s.dest}${cleaned ? `（清掉 ${cleaned} 个 __pycache__）` : ''}`);
}

// ---- 铺科研库骨架 ---------------------------------------------------------
const libReport = [];
if (skipLibrary) {
  libReport.push('已跳过（--skip-library）');
} else {
  const research = path.join(libraryRoot, '.research');
  const dirs = [
    '.research/bin',
    '.research/index',
    '.research/templates',
    '.research/scripts',
    'journals',
    'journals/_sources',
    'refs',
    'projects',
    'submissions',
  ];
  for (const d of dirs) {
    const p = path.join(libraryRoot, d);
    if (verifyOnly) {
      libReport.push(`${fs.existsSync(p) ? '存在' : '缺失'}  ${p}`);
      continue;
    }
    fs.mkdirSync(p, { recursive: true });
  }

  // 只补"没有的"，绝不覆盖库里的数据与用户的文献
  const seeds = [
    { src: configTemplate, dest: path.join(research, 'config.json'), data: true },
    { src: path.join(libraryTemplate, 'bin', 'py.cmd'), dest: path.join(research, 'bin', 'py.cmd'), data: false },
    { src: path.join(libraryTemplate, 'scripts', 'research.py'), dest: path.join(research, 'scripts', 'research.py'), data: false },
    { src: path.join(libraryTemplate, 'scripts', 'journal-index.py'), dest: path.join(research, 'scripts', 'journal-index.py'), data: false },
    { src: path.join(libraryTemplate, 'scripts', 'pdf-text.mjs'), dest: path.join(research, 'scripts', 'pdf-text.mjs'), data: false },
    { src: path.join(libraryTemplate, 'scripts', 'cdp-text.mjs'), dest: path.join(research, 'scripts', 'cdp-text.mjs'), data: false },
  ];
  for (const s of seeds) {
    if (!fs.existsSync(s.src)) {
      libReport.push(`! 模板缺失，跳过：${s.src}`);
      continue;
    }
    const exists = fs.existsSync(s.dest);
    if (verifyOnly) {
      libReport.push(`${exists ? '存在' : '缺失'}  ${s.dest}`);
      continue;
    }
    if (exists && s.data) {
      libReport.push(`保留既有  ${s.dest}`);
      continue;
    }
    if (exists && !s.data && !forceScripts) {
      // 注释与旧 README 都写「只补没有的、绝不覆盖」，但 data:false 分支原本是
      // 每次无条件覆盖——库里那份要是有过现场修复（比 bundle 新）就会被回退。
      // 改成：bundle 里的这份确实更新才写，并且同内容就不动。
      const srcM = fs.statSync(s.src).mtimeMs;
      const dstM = fs.statSync(s.dest).mtimeMs;
      const same = fs.readFileSync(s.src).equals(fs.readFileSync(s.dest));
      if (same) {
        libReport.push(`内容一致，未动  ${s.dest}`);
        continue;
      }
      if (srcM <= dstM) {
        libReport.push(`保留库里的版本（比 bundle 新，想强推加 --force-scripts）  ${s.dest}`);
        continue;
      }
      libReport.push(`覆盖为 bundle 里的新版本（bundle 较新 ${Math.round((srcM - dstM) / 1000)}s）  ${s.dest}`);
    }
    fs.mkdirSync(path.dirname(s.dest), { recursive: true });
    fs.copyFileSync(s.src, s.dest);
    libReport.push(`${exists ? '更新' : '写入'}  ${s.dest}`);
  }

  // 期刊档案：模板里有几份就补几份，已有的**不覆盖**（档案带 verifiedAt / confidence，
  // 用户可能自己校过字段；安装器不许把用户的修改回退掉）
  const jTemplateDir = path.join(libraryTemplate, 'journals');
  if (fs.existsSync(jTemplateDir)) {
    const jfiles = fs.readdirSync(jTemplateDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
    const jProfiles = jfiles.filter((n) => n.endsWith('.json') && n !== '_index.json');
    const jExtras = jfiles.filter((n) => !jProfiles.includes(n));
    const jDestDir = path.join(libraryRoot, 'journals');
    let added = 0;
    let addedExtra = 0;
    const missing = [];
    for (const name of jfiles) {
      const dest = path.join(jDestDir, name);
      const exists = fs.existsSync(dest);
      const isProfile = jProfiles.includes(name);
      if (verifyOnly) {
        if (!exists && isProfile) missing.push(name);
        continue;
      }
      if (exists) continue;
      fs.mkdirSync(jDestDir, { recursive: true });
      fs.copyFileSync(path.join(jTemplateDir, name), dest);
      if (isProfile) added++;
      else addedExtra++;
    }
    libReport.push(
      verifyOnly
        ? `期刊档案模板 ${jProfiles.length} 份（预检：缺失 ${missing.length} 份${missing.length ? '：' + missing.join(' ') : ''}）`
        : `期刊档案模板 ${jProfiles.length} 份：补入 ${added} 份，保留既有 ${jProfiles.length - added} 份`
          + (jExtras.length ? `；另附 ${jExtras.join('、')}（补入 ${addedExtra}）` : ''),
    );

    // 官方 PDF 投放区（journals/_sources）：只保证目录与说明在，**PDF 本体是用户的数据，安装器永不碰**
    const jSrcSources = path.join(jTemplateDir, '_sources');
    if (fs.existsSync(jSrcSources)) {
      const srcReadme = path.join(jSrcSources, 'README.md');
      const destReadme = path.join(jDestDir, '_sources', 'README.md');
      const hasReadme = fs.existsSync(destReadme);
      if (verifyOnly) {
        libReport.push(`${hasReadme ? '存在' : '缺失'}  ${destReadme}`);
      } else {
        fs.mkdirSync(path.dirname(destReadme), { recursive: true });
        if (!hasReadme && fs.existsSync(srcReadme)) {
          fs.copyFileSync(srcReadme, destReadme);
          libReport.push(`写入  ${destReadme}`);
        } else {
          libReport.push(`保留既有  ${destReadme}`);
        }
      }
    }
  }

  // config.json 里的 libraryRoot 若与本次库根不同，就地纠正（它只是配置，不是数据）
  const cfgPath = path.join(research, 'config.json');
  if (!verifyOnly && fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.libraryRoot !== libraryRoot) {
        cfg.libraryRoot = libraryRoot;
        fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
        libReport.push(`config.json libraryRoot 已校正为 ${libraryRoot}`);
      }
    } catch (err) {
      libReport.push(`! config.json 无法纠正：${err.message}`);
    }
  }

  // 用库脚本自己建/修骨架，避免安装器和脚本两套逻辑漂移
  const pyCmd = path.join(research, 'bin', 'py.cmd');
  const researchPy = path.join(research, 'scripts', 'research.py');
  if (!verifyOnly && fs.existsSync(researchPy)) {
    // Windows 上直接 spawn 一个 .cmd 会失败（Node 不会替你走 cmd.exe），
    // 所以优先用 config.json 里记的解释器绝对路径直接起，退路才是 shell:true 走 py.cmd。
    let interpreter = null;
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg.interpreter && fs.existsSync(cfg.interpreter)) interpreter = cfg.interpreter;
    } catch {
      /* 读不到就退回 py.cmd */
    }
    const r = interpreter
      ? spawnSync(interpreter, [researchPy, 'init'], { encoding: 'utf8' })
      : fs.existsSync(pyCmd)
        ? spawnSync(pyCmd, [researchPy, 'init'], { encoding: 'utf8', shell: true })
        : null;
    if (!r) {
      libReport.push('! 找不到可用的 Python 解释器，跳过 research.py init（目录骨架已建好，可稍后手工跑 init）');
    } else if (r.error) {
      libReport.push(`! research.py init 无法启动：${r.error.message}`);
    } else if (r.status === 0) {
      let summary = '';
      try {
        const parsed = JSON.parse(String(r.stdout));
        summary = parsed.summary || `新建 ${(parsed.created || []).length} 项`;
      } catch {
        summary = String(r.stdout).trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || 'ok';
      }
      libReport.push(`research.py init 通过：${summary}`);
    } else {
      libReport.push(`! research.py init 退出码 ${r.status}：${String(r.stderr || r.stdout).trim().slice(0, 400)}`);
    }
  }
}

// ---- 报告 -----------------------------------------------------------------
const line = '─'.repeat(64);
console.log(line);
console.log(verifyOnly ? '科研模式 · 预检报告（未写入任何文件）' : '科研模式 · 安装报告');
console.log(line);
console.log(`包根      ${pkgRoot}`);
console.log(`技能根    ${skillsRoot}`);
console.log(`科研库根  ${libraryRoot}`);
console.log(line);
for (const s of report.ok) console.log(`✓ ${s}`);
for (const s of report.warn) console.log(`! ${s}`);
for (const s of report.fail) console.log(`× ${s}`);
if (libReport.length) {
  console.log(line);
  console.log('科研库骨架：');
  for (const s of libReport) console.log(`  ${s}`);
}
console.log(line);

if (verifyOnly) {
  console.log('这是预检，什么都没改。去掉 --verify-only 才会真正安装。');
  process.exit(report.fail.length ? 1 : 0);
}

console.log('接下来要做的（安装器不会替你做）：');
console.log('  1) 把本包作为 bundle 装进 profile，然后重启 Harness，preset「科研模式 · Research」才会出现。');
console.log('  2) 重启后回读一次 preset 是否注册成功；重启前不要报告"已生效"。');
console.log('  3) Origin 组件（mcp-origin）的接线在 profile 的 cordis.patch.yml 里，若尚未配置，另行处理。');
process.exit(report.fail.length ? 1 : 0);

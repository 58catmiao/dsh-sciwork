/**
 * 安装面自检（node scripts/test-install.mjs）
 * ---------------------------------------------------------------------------
 * 别人把这个包装进他的 Harness 时，真正容易坏的是三处，这里逐个钉住：
 *
 *  1) **随包技能**：`skills/*\/SKILL.md` 能被读成 runtime 技能（名字/描述/正文齐），
 *     用户自己装了同名技能时必须跳过（绝不盖掉他手改的那份）。
 *  2) **市场索引**：`market/plugins.json` 符合 format 1，且钉住的 commit 就是那个版本
 *     的 commit（市场和安装器都会照 commit 去 checkout，指错就装到别的东西）。
 *  3) **包清单**：`files` 里带上 skills / market / scripts，`dsh.bundle` / `dsh.client`
 *     两个出口都在——少了任何一个，装完是「装了但没生效」。
 *
 * 不联网、不碰真库、不写盘（除临时目录）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { loadBundledSkills, parseSkillFile, registerBundledSkills, userSkillsRoot, SKILLS_DIR } from '../lib/host/skills.js';
import { compareVersions } from '../lib/host/version.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
let fail = 0;
function check(label, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  PASS  ${label}${detail ? `  —— ${detail}` : ''}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? `  —— ${detail}` : ''}`); }
}

/* ------------------------------------------------------------ 1. 随包技能 */

console.log('[1] 随包技能');
const loaded = loadBundledSkills();
check('skills/ 下 6 个技能都读得出来', loaded.skills.length === 6, loaded.skills.map((s) => s.name).join(', '));
check('没有读取问题', loaded.problems.length === 0, loaded.problems.join('; '));
check('技能名合规范', loaded.skills.every((s) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.name)));
check('每个技能都有描述', loaded.skills.every((s) => s.description.length > 20));
check('每个技能都有正文（含标题）', loaded.skills.every((s) => s.content.length > 200 && s.content.includes('#')));
check('source 指向包内 SKILL.md', loaded.skills.every((s) => s.source.startsWith('dsh-sciwork/skills/') && s.source.endsWith('/SKILL.md')));

const sample = parseSkillFile('---\nname: demo-skill\ndescription: 一句话\n---\n\n# 正文\n');
check('frontmatter 解析：name/description', sample.front.name === 'demo-skill' && sample.front.description === '一句话');
check('frontmatter 解析：正文不含分隔线', sample.body.trim() === '# 正文');
const noFront = parseSkillFile('# 没有 frontmatter\n');
check('没有 frontmatter 时正文原样返回', noFront.body === '# 没有 frontmatter\n' && Object.keys(noFront.front).length === 0);

check('用户技能根默认 ~/.dsh/skills', userSkillsRoot({}, 'C:/Users/x') === path.join('C:/Users/x', '.dsh', 'skills'));
check('DSH_HOME 覆盖用户技能根', userSkillsRoot({ DSH_HOME: 'D:/ds' }, 'C:/Users/x') === path.join('D:/ds', 'skills'));

{
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sciwork-skills-'));
  try {
    // 用户自己装了 research-stages 的那份：必须跳过，不许注册。
    fs.mkdirSync(path.join(temp, 'skills', 'research-stages'), { recursive: true });
    fs.writeFileSync(path.join(temp, 'skills', 'research-stages', 'SKILL.md'), '---\nname: research-stages\ndescription: 我自己改过的\n---\n');
    const registered = [];
    const fakeSkills = { register: (s) => { registered.push(s); return () => {}; } };
    const result = registerBundledSkills({ skills: fakeSkills }, { dir: SKILLS_DIR, env: { DSH_HOME: temp }, home: temp });
    check('有 skills 服务时会注册', result.available === true);
    check('用户已装的同名技能被跳过', result.skipped.includes('research-stages') && !registered.some((s) => s.name === 'research-stages'));
    check('其余 5 个技能被注册', registered.length === 5, registered.map((s) => s.name).join(', '));
    check('注册形状带 content/source/invocation', registered.every((s) => typeof s.content === 'string' && s.content.length > 0
      && typeof s.source === 'string' && s.invocation.modelInvocable === true && s.invocation.userInvocable === true));
    const none = registerBundledSkills({}, { dir: SKILLS_DIR });
    check('没有 skills 服务时不炸、只记原因', none.available === false && none.problems.length > 0 && none.registered.length === 0);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------ 2. 市场索引 */

console.log('\n[2] 市场索引');
const indexFile = path.join(ROOT, 'market', 'plugins.json');
check('market/plugins.json 在位', fs.existsSync(indexFile));
if (fs.existsSync(indexFile)) {
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  check('format 是 1', index.format === 1);
  check('标题含 en', typeof index.title === 'string' || (index.title && typeof index.title.en === 'string'));
  const entry = (index.plugins || []).find((p) => p.name === 'dsh-sciwork');
  check('索引里有 dsh-sciwork', !!entry);
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  let tagCommit = '';
  try {
    tagCommit = execFileSync('git', ['-C', ROOT, 'rev-parse', '--verify', `v${version}^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    tagCommit = '';
  }
  const hit = entry && (entry.versions || []).find((v) => v.version === version);
  if (tagCommit) {
    // 已发布：索引必须含当前版本，且钉住的 commit 就是 tag 的 commit（市场和安装器照 commit checkout）。
    check(`索引含当前版本 ${version}`, !!hit, (entry && (entry.versions || []).map((v) => v.version).join(', ')) || '');
    check('版本源是 git（本包没发 npm）', !!hit && hit.source && hit.source.type === 'git');
    check('commit 是 40 位小写 hex', !!hit && /^[0-9a-f]{40}$/.test(String(hit.source.commit)));
    check('publishTimestamp 是整数秒', !!hit && Number.isInteger(hit.publishTimestamp) && hit.publishTimestamp > 0);
    check(`索引 commit 与 tag v${version} 一致`, !!hit && hit.source.commit === tagCommit, `tag ${tagCommit.slice(0, 7)} / 索引 ${(hit && hit.source.commit || '').slice(0, 7)}`);
  } else {
    // 还没打 tag：索引停留在上一个已发布版本是正常的，发布后再跑 scripts/make-market-index.mjs。
    console.log(`  SKIP  索引含当前版本 ${version}（还没有 tag v${version}：打 tag 后跑 node scripts/make-market-index.mjs --commit v${version}）`);
    const latest = entry && (entry.versions || [])[0];
    check('索引里已有上一个发布版本且钉了 git commit', !!latest && latest.source.type === 'git' && /^[0-9a-f]{40}$/.test(String(latest.source.commit)), latest ? `${latest.version} → ${String(latest.source.commit).slice(0, 7)}` : '索引是空的');
  }
  check('repository.url 指向本仓库', entry && entry.repository && /58catmiao\/dsh-sciwork/.test(entry.repository.url));
  // market 展示的是 versions[0]，顺序错了会把旧版当最新版；format 1 要求 SemVer 降序。
  const order = (entry && entry.versions || []).map((v) => v.version);
  check(
    '版本按 SemVer 降序（最新版在第一位）',
    order.every((v, i) => i === 0 || compareVersions(order[i - 1], v) >= 0),
    order.join(' > ')
  );
}

/* ------------------------------------------------------------ 3. 包清单 */

console.log('\n[3] 包清单');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
for (const dir of ['lib', 'library', 'skills', 'scripts', 'docs', 'market']) {
  check(`files 里含 ${dir}`, (pkg.files || []).some((f) => f === dir || f === `${dir}/`), (pkg.files || []).join(' '));
}
check('dsh.bundle.patch 指向 cordis.patch.yml', pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch === './cordis.patch.yml');
check('dsh.client.platform 是 web', pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === 'web');
check('package.json name 是 dsh-sciwork', pkg.name === 'dsh-sciwork');
check('engines.node 声明了', !!(pkg.engines && pkg.engines.node));
check('零运行期依赖（git 源安装不需要 npm 依赖树）', !pkg.dependencies || Object.keys(pkg.dependencies).length === 0);
check('scripts.install-plugin 有登记', !!(pkg.scripts && pkg.scripts['install-plugin']));
check('scripts.market-index 有登记', !!(pkg.scripts && pkg.scripts['market-index']));
// 本机路径绝不能随包发布：library/config.json 是 .gitignore 过的本机覆盖，
// 不带 ! 排除时 npm 会顺着 files 里的 library 目录把它打进 tarball，
// 新用户装到的库根就成了维护者机器上的那个（不存在），install.mjs 也会拿它当模板。
check(
  'files 里排除本机库配置（!library/config.json）',
  (pkg.files || []).some((f) => /^!.*library\/config\.json$/.test(f)),
  (pkg.files || []).join(' ')
);
check(
  'files 里排除 Python 字节码（!**/__pycache__ / !**/*.pyc）',
  (pkg.files || []).some((f) => /!.*__pycache__/.test(f)) && (pkg.files || []).some((f) => /!\*\*\/\*\.pyc$/.test(f)),
  (pkg.files || []).join(' ')
);
check('随包模板 library/config.example.json 在位', fs.existsSync(path.join(ROOT, 'library', 'config.example.json')));

console.log('\n[4] 宿主接线（apply 不炸、技能真的挂上去）');
{
  const { apply } = await import('../lib/index.js');
  const logs = [];
  const logger = { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) };
  const registered = [];
  const services = { skills: { register: (s) => { registered.push(s.name); return () => {}; } } };
  const ctx = {
    logger,
    reflect: { get: (name) => services[name] },
    get: (name) => services[name],
    inject: (names, cb) => cb({}),
    effect: () => () => {},
  };
  let threw = null;
  try {
    apply(ctx);
  } catch (error) {
    threw = error;
  }
  check('无 connection 服务时 apply 不抛', threw === null, threw ? String(threw.message || threw) : '');
  // 注册数与跳过数之和应当等于包内技能数（本机可能已有用户副本，所以两种结果都算对）。
  const summary = logs.find((l) => l.includes('随包技能：')) || '';
  const nums = /随包技能：(\d+) 个注册，(\d+) 个/.exec(summary);
  check('技能注册数 + 跳过数 = 6', !!nums && Number(nums[1]) + Number(nums[2]) === 6, summary || '没有汇总日志');
  check('注册数量与日志一致', !!nums && Number(nums[1]) === registered.length, `实际注册 ${registered.length} / 日志 ${nums ? nums[1] : '?'}`);
  check('日志里能看到随包技能的结果', logs.some((l) => l.includes('随包技能')), logs.filter((l) => l.includes('随包技能')).join(' | '));
  const bare = { logger, reflect: { get: () => undefined }, get: () => undefined, inject: () => {}, effect: () => () => {} };
  let bareThrew = null;
  try {
    apply(bare);
  } catch (error) {
    bareThrew = error;
  }
  check('完全没有服务时 apply 也不抛', bareThrew === null, bareThrew ? String(bareThrew.message || bareThrew) : '');
}

console.log(`\n${pass} 通过 · ${fail} 失败`);
process.exit(fail ? 1 : 0);

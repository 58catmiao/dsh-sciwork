/**
 * 科研模式 · 随包技能（0.3.13）
 * ---------------------------------------------------------------------------
 * 这个包自带 6 个技能（`skills/*\/SKILL.md`）。以前只有 `scripts/install.mjs`
 * 把它们拷进 `~/.dsh/skills` 才算装上——从插件页 / 市场 / 终端 `dsh plugin add`
 * 装进来的人不会跑那个脚本，于是「科研模式」的面板在，技能却一条都没有。
 *
 * 这里的做法：插件激活时，如果宿主提供了 `skills` 服务，就把包内技能**注册为
 * runtime 技能**（`ctx.skills.register`），不需要拷贝任何文件。
 *
 * 两条自我约束：
 *  1. **用户自己的同名技能优先**。`~/.dsh/skills/<name>/SKILL.md` 已存在就跳过，
 *     不然 runtime 层会盖掉用户手改/手装的那份（runtime 比 user 层先赢）。
 *  2. **注册失败只告警**。技能是辅助，缺了不该把同一 bundle 里的预设与工具拖下水。
 *
 * 注册形状对齐 `@deepseek-ai/dsh-skill`：
 *   - `validateRuntimeSkill` 只查 `name`（`^[a-z0-9]+(-[a-z0-9]+)*$`）与非空 `description`；
 *   - 真正被 `skill` 工具载入时，`validateDefinition` 还要 `source` / `content` 是字符串，
 *     所以这里把 SKILL.md 正文一起给出去（不给的话列表里看得见、加载时才报错）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 包根（`lib/host/skills.js` 上两级）。 */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 包内技能目录。 */
export const SKILLS_DIR = path.join(PACKAGE_ROOT, 'skills');

/** 技能名规范（与 `@deepseek-ai/dsh-skill` 的 `SKILL_NAME` 一致）。 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * 解析 SKILL.md 的 YAML frontmatter。
 * 只认 `key: value` 的单行写法（本包 6 个技能都这样写）；多行折叠不猜，取不到就当没有。
 * @param {string} text - SKILL.md 全文。
 * @returns {{ front: Record<string,string>, body: string }} frontmatter 键值与正文。
 */
export function parseSkillFile(text) {
  const source = String(text ?? '');
  const front = {};
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { front, body: source };
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    const value = pair[2].trim().replace(/^['"]|['"]$/g, '');
    if (value.length > 0) front[pair[1]] = value;
  }
  return { front, body: source.slice(match[0].length) };
}

/**
 * 读出包内全部技能（不注册，纯函数式读取，便于自检）。
 * @param {string} [dir] - 技能根目录，默认包内 `skills/`。
 * @returns {{ skills: Array<{name:string,description:string,content:string,source:string,whenToUse?:string}>, problems: string[] }}
 *   `skills` 已按名字排序；`problems` 记录读不动的技能（缺 SKILL.md / 名字不合法 / 没描述）。
 */
export function loadBundledSkills(dir = SKILLS_DIR) {
  const skills = [];
  const problems = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    return { skills, problems: [`读不到技能目录 ${dir}：${String((error && error.message) || error)}`] };
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, 'SKILL.md');
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      problems.push(`${entry.name}：没有 SKILL.md，跳过`);
      continue;
    }
    const { front, body } = parseSkillFile(text);
    const name = front.name || entry.name;
    if (!SKILL_NAME.test(name)) {
      problems.push(`${entry.name}：技能名 ${JSON.stringify(name)} 不合规范，跳过`);
      continue;
    }
    const description = (front.description || '').trim();
    if (description.length === 0) {
      problems.push(`${name}：frontmatter 里没有 description，跳过`);
      continue;
    }
    skills.push({
      name,
      description,
      content: body.trim(),
      source: `dsh-sciwork/skills/${entry.name}/SKILL.md`,
      ...(front.whenToUse ? { whenToUse: front.whenToUse } : {}),
    });
  }
  return { skills, problems };
}

/**
 * 用户级技能根（与 `@deepseek-ai/dsh-skill-filesystem` 的默认根一致）。
 * @param {Record<string,string|undefined>} [env] - 环境变量（自检可注入）。
 * @param {string} [home] - 用户主目录（自检可注入）。
 * @returns {string} `<DSH_HOME>/skills`，`DSH_HOME` 缺省 `~/.dsh`。
 */
export function userSkillsRoot(env = process.env, home = os.homedir()) {
  const dshHome = (env && env.DSH_HOME) || path.join(home, '.dsh');
  return path.join(dshHome, 'skills');
}

/**
 * 用户是否已经自己装了同名技能（有目录且有 SKILL.md 就算）。
 * @param {string} root - 用户级技能根。
 * @param {string} name - 技能名。
 * @returns {boolean} 存在则 `true`——调用方据此跳过注册。
 */
export function hasUserSkill(root, name) {
  try {
    return fs.existsSync(path.join(root, name, 'SKILL.md'));
  } catch {
    return false;
  }
}

/**
 * 把包内技能注册成 runtime 技能。
 * @param {object} ctx - 宿主插件上下文（需要 `skills` 服务，壳里取不到就什么也不做）。
 * @param {{ dir?: string, env?: Record<string,string|undefined>, home?: string, logger?: object }} [options]
 * @returns {{ registered: string[], skipped: string[], failed: string[], problems: string[], available: boolean }}
 *   逐项回执，不进面板、只进日志与自检。
 */
export function registerBundledSkills(ctx, options = {}) {
  const result = { registered: [], skipped: [], failed: [], problems: [], available: false };
  const skills = pickService(ctx, 'skills');
  if (!skills || typeof skills.register !== 'function') {
    result.problems.push('宿主没有 skills 服务，技能未随包注册（不影响面板与工具）');
    return result;
  }
  result.available = true;
  const root = userSkillsRoot(options.env, options.home);
  const loaded = loadBundledSkills(options.dir);
  result.problems.push(...loaded.problems);
  for (const skill of loaded.skills) {
    if (hasUserSkill(root, skill.name)) {
      result.skipped.push(skill.name);
      continue;
    }
    try {
      skills.register({
        name: skill.name,
        description: skill.description,
        ...(skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
        content: skill.content,
        source: skill.source,
        invocation: { modelInvocable: true, userInvocable: true },
      });
      result.registered.push(skill.name);
    } catch (error) {
      result.failed.push(`${skill.name}（${String((error && error.message) || error)}）`);
    }
  }
  const logger = options.logger;
  const line = `技能注册：${result.registered.length} 个成功，${result.skipped.length} 个因用户已装而跳过${
    result.failed.length ? `，${result.failed.length} 个失败` : ''
  }`;
  if (logger && typeof logger[result.failed.length ? 'warn' : 'info'] === 'function') {
    logger[result.failed.length ? 'warn' : 'info'](`research-library: ${line}`);
  }
  return result;
}

/**
 * 从插件上下文里取服务（与 `lib/index.js` 的 `pick` 同口径）。
 * @param {object} ctx - 插件上下文。
 * @param {string} name - 服务名。
 * @returns {any} 服务对象或 `undefined`。
 */
function pickService(ctx, name) {
  try {
    if (ctx && ctx.skills && name === 'skills') return ctx.skills;
    if (ctx && ctx.reflect && typeof ctx.reflect.get === 'function') {
      return ctx.reflect.get(name) || undefined;
    }
    if (ctx && typeof ctx.get === 'function') return ctx.get(name);
  } catch {
    /* 服务没就绪：返回 undefined，调用方走告警分支 */
  }
  return undefined;
}

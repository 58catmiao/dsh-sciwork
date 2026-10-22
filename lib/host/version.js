/**
 * 科研模式 0.3 · 版本号比较（纯函数，不读盘、不联网）
 * ---------------------------------------------------------------------------
 * 只处理本项目会用到的形状：`0.3.11` / `v0.3.11` / `0.3.11-beta.1`。
 * 逐段比较：主版本 → 次版本 → 修订号 → 预发布标签（有标签的比没有的旧）。
 * 解析不出来的段按 0 算，绝不抛错——「检查更新」是只读便利，不该因为
 * 远端 package.json 写了个奇怪版本号就把面板打断。
 */

/** 拆成 `{ nums:[0,3,11], pre:'beta.1' }`。 */
export function parseVersion(value) {
  const text = String(value == null ? '' : value).trim().replace(/^v/i, '');
  if (!text) return { nums: [0, 0, 0], pre: '' };
  const dash = text.indexOf('-');
  const core = dash >= 0 ? text.slice(0, dash) : text;
  const pre = dash >= 0 ? text.slice(dash + 1) : '';
  const nums = core.split('.').slice(0, 3).map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  while (nums.length < 3) nums.push(0);
  return { nums, pre };
}

/**
 * 比较两个版本：`a` 比 `b` 新返回 1，旧返回 -1，相同返回 0。
 * 预发布规则简化：`0.4.0-beta` < `0.4.0`，两个都带标签时按字符串比。
 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (left.nums[i] !== right.nums[i]) return left.nums[i] > right.nums[i] ? 1 : -1;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;      // 正式版 > 预发布
  if (!right.pre) return -1;
  return left.pre > right.pre ? 1 : -1;
}

/** 远端版本是否比本地新（面板「检查更新」的判定）。 */
export function isNewer(remote, local) {
  return compareVersions(remote, local) > 0;
}

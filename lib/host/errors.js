/**
 * 科研模式 0.3 · 错误码与信封
 * ---------------------------------------------------------------------------
 * 一条规矩：**任何失败都必须变成 `{ok:false, error}`，绝不把异常抛到信封层。**
 * 线上信封（Connection 的 `result`）只有两种形状：
 *   { ok: true,  value, receipt? }
 *   { ok: false, error: { code, message, details } }
 *
 * 错误码两套：
 *   旧 8 个（端点契约，不能改名/删）：bad-request not-found denied busy timeout
 *                                    network internal cli-failed
 *   0.3 新增（动作层）：schema needs-confirmation unsupported
 *   另有两个动作层专用的语义码：needs-migration（旧库写动作）与 conflict（同名产物）。
 *   它们只出现在 error.code 里，不改变旧 8 码的含义。
 */

/** 旧契约 8 码。`actions.js` 与面板都按这一组判断，别把新码混进来。 */
export const LEGACY_CODES = Object.freeze([
  'bad-request',
  'not-found',
  'denied',
  'busy',
  'timeout',
  'network',
  'internal',
  'cli-failed',
]);

/** 0.3 新增码（PLAN §5.5）。 */
export const NEW_CODES = Object.freeze(['schema', 'needs-confirmation', 'unsupported']);

/** 动作层语义码（不是新的线上契约，只是更准确的分类）。 */
export const ACTION_CODES = Object.freeze(['needs-migration', 'conflict']);

export const ALL_CODES = Object.freeze([...LEGACY_CODES, ...NEW_CODES, ...ACTION_CODES]);

const CODE_SET = new Set(ALL_CODES);

export const isKnownCode = (code) => typeof code === 'string' && CODE_SET.has(code);

/** 带错误码的异常；dispatch 只认这个类型做精确映射，其余按 message 猜（旧行为）。 */
export class ResearchError extends Error {
  constructor(code, message, details = {}) {
    super(String(message || code));
    this.name = 'ResearchError';
    this.code = isKnownCode(code) ? code : 'internal';
    this.details = details && typeof details === 'object' ? details : {};
  }
}

export const badRequest = (message, details) => new ResearchError('bad-request', message, details);
export const notFound = (message, details) => new ResearchError('not-found', message, details);
export const denied = (message, details) => new ResearchError('denied', message, details);
export const schemaError = (message, details) => new ResearchError('schema', message, details);
export const unsupported = (message, details) => new ResearchError('unsupported', message, details);
export const needsMigration = (message, details) => new ResearchError('needs-migration', message, details);
export const conflict = (message, details) => new ResearchError('conflict', message, details);
export const cliFailed = (message, details) => new ResearchError('cli-failed', message, details);

/** 成功信封（`value` 直接进面板）。 */
export const ok = (value) => ({ ok: true, value });

/** 失败信封。 */
export const fail = (code, message, details = {}) => ({
  ok: false,
  error: { code: isKnownCode(code) ? code : 'internal', message: String(message || code), details: details || {} },
});

/**
 * 把任意异常收敛成错误码 + message。
 * 优先认 `ResearchError.code`；否则沿用 0.2 的 message 正则（旧引擎抛的是普通 Error），
 * 保证旧动作的码不变。
 */
export function describeError(error) {
  if (error instanceof ResearchError) {
    return { code: error.code, message: error.message, details: error.details || {} };
  }
  const explicit = error && typeof error.code === 'string' ? error.code : '';
  const msg = String((error && error.message) || error || '未知错误');
  const details = (error && error.details && typeof error.details === 'object') ? error.details : {};
  if (isKnownCode(explicit)) return { code: explicit, message: msg, details };
  if (/ENOENT|no such file|文件不存在|课题不存在|没有这条/.test(msg)) return { code: 'not-found', message: msg, details };
  if (/只接受库根相对路径|路径越出科研库范围|空路径|只允许动|只允许编辑|只允许在|不能从面板改|不能归档|不能删|必须在本课题目录里|必须都在本课题里/.test(msg)) {
    return { code: 'denied', message: msg, details };
  }
  if (/过大|不是可预览|不支持的二进制|不合法|已经有|单调|方向不一致|重复值|没有可用的数值|缺少|需要 /.test(msg)) {
    return { code: 'bad-request', message: msg, details };
  }
  if (/锁|lock|正在重画/i.test(msg)) return { code: 'busy', message: msg, details };
  return { code: 'internal', message: msg, details };
}

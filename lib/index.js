/**
 * 科研模式 · 宿主半边（Cordis 插件）
 * ---------------------------------------------------------------------------
 * 这一半只做一件事：在共享的 `/api` 通道上提供**一个端点** `research/call`，
 * 交给 `lib/actions.js` 执行，按 Connection 标准信封应答。
 *
 * 为什么用「精确 Fetch 路由」而不是 `intercept('/api', …)`（2026-10-11 定案）：
 *   - `@deepseek-ai/dsh-api-gateway` 已经占用了 `/api` **唯一**的那个拦截器
 *     （`connection.rpc.intercept('/api', …)`，见该包 `lib/types/index.js`）；
 *     `HostConnectionRpc.intercept` 的契约是「一个通道只允许一个拦截器」，
 *     谁先注册谁赢，另一个直接 throw。
 *   - 我们若抢先注册成功，官方端点（`settings/describe`、`credentials/describe`、
 *     `agentPresets/list` …）全部落进 `createSharedFetchHandler` 的
 *     `!interceptor.matches(endpoint)` 分支 → `new Response('not found', { status: 404 })`，
 *     桌面主进程的欢迎流程（`main.js` → `POST /api/settings/describe`）随即抛
 *     `desktop welcome: Web request failed` → `reportFatal(error, 'main')` →
 *     原生恢复对话框 → `sanitizeProfile()` 把 profile 补丁改名、bundles 摘掉。
 *     这就是两次「重启即崩」的真凶（证据见 HANDOFF.md §5.5）。
 *   - `connection.rpc.fetch.register()` 注册的是 `/api/<endpoint>` **精确路由**，
 *     `createSharedFetchHandler` 里精确路由**优先于**拦截器匹配，因此与
 *     api-gateway 完全共存；同时它挂在 `/api` 前缀路由之下，自动继承
 *     **Host/Origin 信任栅栏 + 浏览器会话认证 + 请求体上限**，不用自己实现鉴权。
 *   - 客户端只需 `ctx.get('connection').rpc.call('/api', 'research/call', payload)`。
 *
 * 信封协议：与 Connection 的 `rpcFetchHandler` 对齐（同一个包内非导出函数，故此处等价复刻）：
 *   请求  { type: 'client-request', rpcId, method, payload: { args } }
 *   成功  { type: 'server-response', rpcId, result }
 *   失败  { type: 'server-response', rpcId, result: { ok: false, error } }
 *
 * 生命周期：注册用 `ctx.effect` 挂在插件 fiber 上，Harness 卸载/热更时自动撤销。
 */

import { handleResearchCall, ACTIONS } from './actions.js';
import { registerSciworkTools } from './tools.js';
import { registerBundledSkills } from './host/skills.js';

/** Cordis 插件名（patch 行里的 `id` 是 `research-library`，这里是模块名）。 */
export const name = 'research-library';

/** 端点名；客户端必须用同一个字符串。 */
export const ENDPOINT = 'research/call';

/** 精确路由路径；`endpointFromPath('/api', …)` 要求它必须是 `/api/<单段>`。 */
export const ROUTE_PATH = `/api/${ENDPOINT}`;

/** 信封里 method 与 URL 末段不一致时的错误码（对齐 Connection 的 gateway/bad-request）。 */
const BAD_REQUEST = 'gateway/bad-request';
/** 兜底：handler 自身抛错时给的错误码（对齐 actions.js 的内部错误）。 */
const INTERNAL = 'internal';

/** 统一构造 Connection 服务端信封。 */
function carry(rpcId, result) {
  return { type: 'server-response', rpcId, result };
}

/** 错误信封。 */
function fail(rpcId, code, message, details) {
  return carry(rpcId, { ok: false, error: { code, message, details: details ?? {} } });
}

/** 从 body 里尽力取出 rpcId 用于回信（取不到就按 Connection 的做法用占位 id）。 */
function rpcIdOf(body) {
  return body && typeof body.rpcId === 'string' && body.rpcId.length > 0 ? body.rpcId : 'invalid-request';
}

/**
 * 把一次面向前端正的 JSON 请求翻译成面板调用。
 * @param {unknown} body - 请求体（应为 client-request 信封）。
 * @returns {Promise<object>} 服务端信封。
 */
async function envelopeResult(body) {
  if (!body || typeof body !== 'object' || body.type !== 'client-request') {
    return fail(rpcIdOf(body), BAD_REQUEST, 'invalid client-request message');
  }
  if (body.method !== ENDPOINT) {
    return fail(
      body.rpcId,
      BAD_REQUEST,
      `method ${JSON.stringify(body.method)} does not match endpoint ${JSON.stringify(ENDPOINT)}`,
    );
  }
  try {
    return carry(body.rpcId, await handleResearchCall(body.payload));
  } catch (error) {
    // 兜底：handleResearchCall 自己绝不该抛，抛了就是缺陷，也要让面板看见而不是 500。
    return fail(body.rpcId, INTERNAL, String((error && error.message) || error));
  }
}

/**
 * 写一条日志：优先用 Cordis 的 `ctx.logger`，没有就退回 `console`。
 * 面板是辅助视图，激活期的任何异常都必须留下痕迹（HANDOFF §1 禁令 3）。
 * @param {'info'|'warn'|'error'} level
 * @param {string} message
 */
function note(ctx, level, message) {
  const text = `research-library: ${message}`;
  const logger = ctx?.logger;
  if (logger && typeof logger[level] === 'function') {
    logger[level](text);
    return;
  }
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}

/**
 * 从插件上下文里取服务：先看同名属性（`ctx.skills`），再走 `reflect.get`，最后 `ctx.get`。
 * `reflect.get(name, false)` 表示「拿不到就返回 undefined，别抛」。
 * @param {object} ctx - 宿主插件上下文。
 * @param {string} name - 服务名。
 * @returns {any} 服务对象或 `undefined`。
 */
function pick(ctx, name) {
  try {
    if (ctx && ctx[name]) return ctx[name];
    if (ctx && ctx.reflect && typeof ctx.reflect.get === 'function') {
      const a = ctx.reflect.get(name, false);
      if (a) return a;
      const b = ctx.reflect.get(name);
      if (b) return b;
    }
    if (ctx && typeof ctx.get === 'function') return ctx.get(name);
  } catch { /* 服务没就绪：调用方统一告警 */ }
  return undefined;
}

/**
 * 注册面板的宿主端点。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主插件上下文。
 */
export function apply(ctx) {
  note(ctx, 'info', '宿主半边 apply() 已运行，等待 connection / tools 服务');
  mountTools(ctx);
  mountSkills(ctx);

/**
 * 把包内 6 个技能注册成 runtime 技能（0.3.13）。
 * 从插件页 / 市场 / 终端装进来的人不会跑 `scripts/install.mjs`，不注册的话
 * 「科研模式」有面板没技能；用户自己装了同名技能时跳过，绝不盖掉他的版本。
 */
function mountSkills(ctx) {
  const skills = pick(ctx, 'skills');
  if (!skills || typeof skills.register !== 'function') {
    note(ctx, 'warn', '宿主没有 skills 服务，随包技能未注册（面板与工具不受影响）');
    return;
  }
  const result = registerBundledSkills(ctx, { logger: ctx.logger });
  for (const problem of result.problems) note(ctx, 'warn', problem);
  note(
    ctx,
    result.failed.length ? 'warn' : 'info',
    `随包技能：${result.registered.length} 个注册，${result.skipped.length} 个因用户已装而跳过${
      result.failed.length ? `，失败 ${result.failed.join('、')}` : ''
    }`,
  );
}

/**
 * 把 `tool.expose` 的动作注册成宿主工具（PLAN §10.2）。
 * 拿不到 tools 服务时只告警——面板与预设不因工具注册失败而失效。
 */
function mountTools(ctx) {
  const direct = pick(ctx, 'tools');
  if (direct && typeof direct.register === 'function') {
    const { registered, failed } = registerSciworkTools(direct, { logger: ctx.logger });
    note(ctx, failed.length ? 'warn' : 'info', `工具注册：${registered.length} 个成功${failed.length ? `，${failed.length} 个失败` : ''}`);
    return;
  }
  if (typeof ctx.inject !== 'function') {
    note(ctx, 'warn', '当前载体既没有 tools 服务也不支持注入，工具未注册（面板仍可用）');
    return;
  }
  ctx.inject(['tools'], (c) => {
    const tools = (c && c.tools) || (c && typeof c.get === 'function' ? c.get('tools') : undefined);
    if (!tools || typeof tools.register !== 'function') {
      note(ctx, 'warn', 'tools 服务不可用，sciwork_* 工具未注册（面板仍可用）');
      return;
    }
    const { registered, failed } = registerSciworkTools(tools, { logger: ctx.logger });
    note(ctx, failed.length ? 'warn' : 'info', `工具注册：${registered.length} 个成功${failed.length ? `，${failed.length} 个失败` : ''}`);
  });
}

  ctx.inject(['connection'], (c) => {
    // 与 `@deepseek-ai/dsh-api-gateway` 同一取法：注入回调的 context 上直接挂服务
    // （`connectionCtx.connection`），`ctx.get('connection')` 只是兜底。
    const connection =
      (c && c.connection) ?? (c && typeof c.get === 'function' ? c.get('connection') : undefined);
    // 注意：精确路由注册表是**服务本身**的 `connection.fetch`（`HostConnectionService.get fetch()`），
    // 不是 `connection.rpc.fetch`——`get rpc()` 只给 `handle` 与 `intercept` 两个方法（2026-10-11 探针实证）。
    const registry = connection && connection.fetch;

    // 载体自检：没有 connection 服务、或它没有精确路由注册表（`rpc.fetch.register`）时，
    // 只告警不抛——面板是辅助视图，任何注册失败都不许把同一个 bundle 里的预设拖下水。
    if (!registry || typeof registry.register !== 'function') {
      note(
        ctx,
        'warn',
        `当前载体没有 connection.fetch.register（无 Web 载体？），端点 ${ROUTE_PATH} 未注册`,
      );
      return;
    }

    const route = {
      path: ROUTE_PATH,
      methods: ['POST'],
      // 字段名与官方宿主路由一致（`dsh-api-session-controller` 的 `/api/file`、
      // `dsh-client-file-upload` 的流式上传都用 `requestBody`；不是 `requestBodyMode`）。
      requestBody: 'buffered',
      fetch: async (request) => {
        let body;
        try {
          body = await request.json();
        } catch {
          return Response.json(fail('invalid-request', BAD_REQUEST, 'body is not JSON'));
        }
        return Response.json(await envelopeResult(body));
      },
    };

    try {
      // 精确路由：只吃 `/api/research/call` 的 POST，官方 `/api/*` 端点原样留给 api-gateway。
      ctx.effect(
        () => registry.register(route),
        `research-library — ${ROUTE_PATH}（${ACTIONS.length} 个动作）`,
      );
      note(ctx, 'info', `已注册精确路由 ${ROUTE_PATH}（${ACTIONS.length} 个动作）`);
    } catch (error) {
      // 例如与别的插件抢同一路径（`connection: exact Fetch route … is already registered`）。
      // 这里**故意吞掉**不往上抛，只留响亮的 error 日志（HANDOFF §1 禁令 3）。
      note(
        ctx,
        'error',
        `精确路由 ${ROUTE_PATH} 注册失败，面板端点不可用：${String((error && error.message) || error)}`,
      );
    }
  });
}

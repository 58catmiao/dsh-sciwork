/**
 * 科研模式 0.4.5 · 动作域：模型（只认宿主里已配置的提供方）
 * ---------------------------------------------------------------------------
 * 面板跑在渲染进程里，`ctx.get('llm')` 未必拿得到东西（0.4.0/0.4.1 的「问模型 →
 * 宿主里没有已配置的模型」就栽在这里）。所以把「宿主里有哪些模型」这件事交给
 * 插件宿主侧：`ctx.llm` 的 `listConfigurableProviders()` / `listModels()` 是权威。
 *
 * 两个动作：
 *   - `llm.info`（只读）：列出提供方与模型，附带「为什么空」的诊断句；
 *   - `llm.chat`（external）：面板问模型走这条路（宿主负责登记图片附件、发请求、
 *     把结束原因翻成人话）。
 * 两个都**不改库**，也不写盘。
 *
 * 0.4.5 修的两处（2026-11-01 用户报「问完模型后没反应」）：
 *   ① `StreamChunk` 里**没有** `{ type:'error' }` 这一种。DSH 的契约是：
 *      「适配器选择、派发、迭代失败都变成终态 `error` 或 `aborted` 的 `finish` 块，
 *      中间件 / 嵌套调用 / 清理 / 消费者自身失败才往外抛」。
 *      老代码只认 `text-delta`，于是失败时一条 delta 都没有、循环正常结束、
 *      返回 `text: ''`——面板只能显示「模型这次没有返回任何文字」，真实原因（401、
 *      模型不支持图片、被限流）全被吞掉。现在逐个看 `finish.reason`。
 *   ② 图片内容块必须是 `{ type:'image', attachment: ImageAttachmentRef }`，
 *      引用由 `ctx.attachments.saveImage({ data, mediaType, name })` 生成。
 *      老代码拍的 `{ type:'image', source:{ type:'base64', … } }` 是别的 SDK 的形状，
 *      DSH 不认——图一进适配器就整次失败，而且因为 ① 连原因都看不见。
 */

import { badRequest } from '../host/errors.js';
import { asString } from '../host/engine.js';
import { getLlm, getAttachments } from '../host/host-services.js';

/** 异常压成一句人话（宿主抛的东西形状不固定）。 */
const msgOf = (error) => String((error && error.message) || error || '未知错误');

/** 宿主认识的图片类型（`ImageMediaType`）。 */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** 图片块的备注名：只用于附件登记，不参与请求。 */
const IMAGE_NAME = 'sciwork-figure';

/** 拿到宿主的 llm 服务：插件 apply() 挂进桥的那份优先（动作层没有插件上下文）。 */
function pickLlm(ctx) {
  const bridged = getLlm();
  if (bridged) return bridged;
  if (ctx && ctx.llm) return ctx.llm;
  if (ctx && typeof ctx.get === 'function') {
    try { return ctx.get('llm') || null; } catch (error) { return null; }
  }
  return null;
}

/** 拿宿主的附件服务（同上，走桥）。 */
function pickAttachments(ctx) {
  const bridged = getAttachments();
  if (bridged) return bridged;
  if (ctx && ctx.attachments) return ctx.attachments;
  if (ctx && typeof ctx.get === 'function') {
    try { return ctx.get('attachments') || null; } catch (error) { return null; }
  }
  return null;
}

/** 提供方可能是 `{ provider, displayName }`（可配置）或 `{ id, name }`（运行期）。 */
function readProvider(row) {
  const id = asString(row && (row.provider || row.id));
  if (!id) return null;
  return {
    id,
    name: asString(row.displayName || row.name) || id,
    error: row && row.error ? String(row.error) : null,
  };
}

/** 模型信息：`{ provider, id, name, inputModalities }`，能看图的单独标出来。 */
function readModel(row, fallbackProvider) {
  const id = asString(row && row.id);
  if (!id) return null;
  const mods = Array.isArray(row && row.inputModalities) ? row.inputModalities : [];
  return {
    provider: asString(row && row.provider) || fallbackProvider,
    id,
    name: asString(row && row.name) || id,
    vision: mods.indexOf('image') >= 0,
  };
}

/**
 * 把面板给的图片拆成 `{ base64, mediaType }`。
 * 面板传的是裸 base64（`sel.data` / 去掉 `data:` 前缀的整图），但工具调用方可能直接
 * 甩一个 data URL 过来，所以两种都认。
 */
function splitImage(data, mime) {
  const raw = asString(data);
  if (!raw) return null;
  const m = /^data:([^;,]+)?(?:;base64)?,([\s\S]*)$/.exec(raw);
  const base64 = m ? m[2] : raw;
  if (!base64) return null;
  return { base64, mediaType: asString(mime) || asString(m && m[1]) || 'image/png' };
}

/** 收集本次要发的图片：`images[]` 优先（面板按「圈选块、整图」顺序给），旧的单图字段兜底。 */
function collectImages(params) {
  const out = [];
  const rows = Array.isArray(params && params.images) ? params.images : [];
  for (const row of rows) {
    const one = splitImage(row && (row.data || row.base64), row && (row.mime || row.mediaType));
    if (one) out.push(one);
  }
  const single = splitImage(params && params.imageBase64, params && params.imageMime);
  if (single) out.push(single);
  return out;
}

/** base64 → Uint8Array；解不开就报人话（宿主那边会抛晦涩的编码错误）。 */
function decodeBase64(base64, index) {
  try {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  } catch (error) {
    throw badRequest('第 ' + (index + 1) + ' 张图不是合法的 base64：' + msgOf(error));
  }
}

/** 把字节量写成 MB，报错时用。 */
const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(2) + ' MB';

/** 结束原因翻译成一句人话（`finish.reason`，没有就返回空串）。 */
function describeFailure(reason) {
  if (!reason || (reason.kind !== 'error' && reason.kind !== 'aborted')) return '';
  const failure = reason.failure || {};
  const parts = [];
  const message = asString(failure.message);
  parts.push(message || '宿主没给原因');
  const code = asString(failure.code);
  if (code) parts.push(failure.status ? code + ' / ' + failure.status : code);
  const who = reason.kind === 'aborted' ? '模型调用被中止了' : '模型出错';
  return who + '：' + parts.join('（') + (parts.length > 1 ? '）' : '');
}

export const llmInfo = {
  id: 'llm.info',
  title: '可用模型',
  domain: 'llm',
  description: '列出宿主里已配置的提供方与模型（只读）',
  params: { type: 'object', required: [], additionalProperties: false, properties: {} },
  effects: 'read',
  engine: 'node',
  confirm: 'never',
  stage: ['topic', 'design', 'data', 'analysis', 'figure', 'draft', 'submission'],
  ui: { view: 'settings' },
  tool: { expose: true, name: 'sciwork_llm_info' },
  run: async (ctx) => {
    const llm = pickLlm(ctx);
    if (!llm) {
      return {
        available: false,
        providers: [],
        models: [],
        reason: '插件没拿到宿主的 llm 服务（刚更新过插件的话，重启 DSH 再试一次）；还空就到 DSH 的「设置 → 模型」确认已配好提供方与 API Key。',
      };
    }

    const problems = [];
    let providers = [];
    if (typeof llm.listConfigurableProviders === 'function') {
      try {
        const rows = await llm.listConfigurableProviders();
        providers = (rows || []).map(readProvider).filter(Boolean);
      } catch (error) {
        problems.push('listConfigurableProviders 失败：' + msgOf(error));
      }
    }
    if (!providers.length && typeof llm.listProviders === 'function') {
      try {
        const rows = await llm.listProviders();
        providers = (rows || []).map(readProvider).filter(Boolean);
      } catch (error) {
        problems.push('listProviders 失败：' + msgOf(error));
      }
    }

    const models = [];
    if (typeof llm.listModels === 'function') {
      for (const p of providers) {
        try {
          const rows = await llm.listModels(p.id);
          for (const row of rows || []) {
            const m = readModel(row, p.id);
            if (m) models.push(m);
          }
        } catch (error) {
          p.error = p.error || msgOf(error);
        }
      }
    } else {
      problems.push('宿主的模型服务没有 listModels。');
    }

    let reason = '';
    if (!providers.length) reason = '宿主里一个提供方都没有：到「设置 → 模型」里加一个提供方和 API Key。';
    else if (!models.length) reason = '提供方在，但没有可用模型；到「设置 → 模型」里给它填上模型 id 或点「拉取可用模型」。';
    else if (problems.length) reason = problems.join('；');

    return { available: models.length > 0, providers, models, reason, problems };
  },
};

export const llmChat = {
  id: 'llm.chat',
  title: '问模型',
  domain: 'llm',
  description: '把一段文字（可带图）发给宿主里已配置的模型，返回整段回答',
  params: {
    type: 'object',
    required: ['prompt'],
    additionalProperties: false,
    properties: {
      provider: { type: 'string', maxLength: 80 },
      model: { type: 'string', maxLength: 120 },
      prompt: { type: 'string', maxLength: 12000 },
      // 面板按「圈选块、整图」的顺序给图；一张 2 MB 的 PNG 编码后约 2.7 MB，留足余量。
      images: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            data: { type: 'string', maxLength: 8000000 },
            mime: { type: 'string', maxLength: 60 },
          },
        },
      },
      imageBase64: { type: 'string', maxLength: 8000000 },
      imageMime: { type: 'string', maxLength: 60 },
    },
  },
  effects: 'external',
  engine: 'node',
  confirm: 'never',
  idempotent: true,
  stage: ['topic', 'design', 'data', 'analysis', 'figure', 'draft', 'submission'],
  ui: { view: 'figures' },
  tool: { expose: true, name: 'sciwork_llm_chat' },
  run: async (ctx, params) => {
    const llm = pickLlm(ctx);
    if (!llm || typeof llm.stream !== 'function') throw badRequest('宿主没有可用的模型服务，面板里问不了模型。');
    const provider = asString(params.provider);
    const model = asString(params.model);
    if (!provider || !model) throw badRequest('要选一个提供方和一个模型。');

    const prompt = asString(params.prompt);
    if (!prompt) throw badRequest('问题还是空的：写一句再问。');

    // ---- 图片：先登记成宿主附件，再放进内容块。登记不了就明说，不发半截请求。
    const images = collectImages(params);
    const content = [{ type: 'text', text: prompt }];
    if (images.length) {
      const attachments = pickAttachments(ctx);
      if (!attachments || typeof attachments.saveImage !== 'function') {
        throw badRequest('这次带着图，但宿主没给图片服务（attachments）：重启 DSH 再试一次，或者先把问题写成文字问。');
      }
      for (let i = 0; i < images.length; i += 1) {
        const one = images[i];
        if (IMAGE_TYPES.indexOf(one.mediaType) < 0) {
          throw badRequest('第 ' + (i + 1) + ' 张图的类型（' + one.mediaType + '）宿主不认识：支持 png / jpeg / webp / gif。');
        }
        const data = decodeBase64(one.base64, i);
        const limits = attachments.imageLimits || null;
        if (limits && limits.maxImageBytes && data.length > limits.maxImageBytes) {
          throw badRequest(
            '第 ' + (i + 1) + ' 张图 ' + mb(data.length) + '，超过宿主允许的 ' + mb(limits.maxImageBytes) + '：先裁小一点再问。',
          );
        }
        try {
          const ref = await attachments.saveImage({ data, mediaType: one.mediaType, name: IMAGE_NAME });
          content.push({ type: 'image', attachment: ref });
        } catch (error) {
          throw badRequest('把第 ' + (i + 1) + ' 张图交给宿主时失败：' + msgOf(error));
        }
      }
    }

    // ---- 流：只认 text-delta 累积，但结束原因必须看，否则失败会变成「一个字都没返回」。
    let text = '';
    let blockText = '';
    let reason = null;
    const stream = llm.stream({ provider, model, messages: [{ role: 'user', content }] });
    for await (const chunk of stream) {
      if (!chunk) continue;
      if (chunk.type === 'text-delta') {
        if (typeof chunk.text === 'string') text += chunk.text;
      } else if (chunk.type === 'block-end') {
        // 兜底：万一适配器只给整块、不给增量，从 block-end 里捞文本。
        const block = chunk.block;
        if (block && block.type === 'text' && typeof block.text === 'string') blockText += block.text;
      } else if (chunk.type === 'reasoning-delta') {
        if (!text) text = '';
      } else if (chunk.type === 'finish') {
        reason = chunk.reason || null;
      }
    }
    if (!text && blockText) text = blockText;

    const failure = describeFailure(reason);
    if (failure) throw badRequest(failure);
    if (!text) {
      throw badRequest(
        '模型这次一个字都没返回（流正常结束了）：可能是这个模型不支持图片输入，或提供方把回答掐掉了。换一个模型再试一次。',
      );
    }
    if (reason && reason.kind === 'max-tokens') {
      text += '\n\n（回答到长度上限被截断了：可以要求它写短一点，或分几次问。）';
    }

    return {
      provider,
      model,
      text,
      images: images.length,
      finish: (reason && reason.kind) || 'stop',
    };
  },
};

export const LLM_ACTIONS = Object.freeze([llmInfo, llmChat]);

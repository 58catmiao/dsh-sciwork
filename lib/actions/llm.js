/**
 * 科研模式 0.4.2 · 动作域：模型（只认宿主里已配置的提供方）
 * ---------------------------------------------------------------------------
 * 面板跑在渲染进程里，`ctx.get('llm')` 未必拿得到东西（0.4.0/0.4.1 的「问模型 →
 * 宿主里没有已配置的模型」就栽在这里）。所以把「宿主里有哪些模型」这件事交给
 * 插件宿主侧：`ctx.llm` 的 `listConfigurableProviders()` / `listModels()` 是权威。
 *
 * 两个动作：
 *   - `llm.info`（只读）：列出提供方与模型，附带「为什么空」的诊断句；
 *   - `llm.chat`（external）：面板拿不到宿主 stream 时的兜底，一次问答返回整段文字。
 * 两个都**不改库**，也不写盘。
 */

import { badRequest } from '../host/errors.js';
import { asString } from '../host/engine.js';
import { getLlm } from '../host/host-services.js';

/** 异常压成一句人话（宿主抛的东西形状不固定）。 */
const msgOf = (error) => String((error && error.message) || error || '未知错误');

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
  description: '把一段文字（可带一张图）发给宿主里已配置的模型，返回整段回答（面板拿不到 stream 时的兜底）',
  params: {
    type: 'object',
    required: ['prompt'],
    additionalProperties: false,
    properties: {
      provider: { type: 'string', maxLength: 80 },
      model: { type: 'string', maxLength: 120 },
      prompt: { type: 'string', maxLength: 12000 },
      imageBase64: { type: 'string', maxLength: 6000000 },
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

    const content = [{ type: 'text', text: asString(params.prompt) }];
    if (params.imageBase64) {
      content.push({ type: 'image', source: { type: 'base64', data: String(params.imageBase64), media_type: asString(params.imageMime) || 'image/png' } });
    }

    const chunks = [];
    const stream = llm.stream({ provider, model, messages: [{ role: 'user', content }] });
    for await (const chunk of stream) {
      if (chunk && chunk.type === 'text-delta' && chunk.text) chunks.push(chunk.text);
      else if (chunk && chunk.type === 'error') throw badRequest('模型出错：' + msgOf(chunk.error || chunk));
    }
    return { provider, model, text: chunks.join('') };
  },
};

export const LLM_ACTIONS = Object.freeze([llmInfo, llmChat]);

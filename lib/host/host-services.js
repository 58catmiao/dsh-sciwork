/**
 * 科研模式 0.4.5 · 宿主服务的桥
 * ---------------------------------------------------------------------------
 * 动作执行器（`lib/host/dispatch.js`）交给 `action.run` 的只有一个「执行上下文」
 * （settings / root / source / params / receiptId …），**没有 Cordis 插件上下文**。
 * 所以 `llm.info` 这类需要宿主能力的动作，拿不到 `ctx.llm`——0.4.2 第一版就栽在这，
 * 面板显示「这个面板里拿不到宿主的模型服务（ctx.llm）」。
 *
 * 桥的做法：插件 `apply()` 里把宿主服务挂到这里，动作从 `getLlm()` / `getAttachments()` 取。
 * 只存服务引用，不做任何读写；宿主卸载时置回 null。
 *
 * 为什么 0.4.5 又加了 `attachments`：图片内容块的契约是
 * `{ type: 'image', attachment: ImageAttachmentRef }`，而 `ImageAttachmentRef` 只能由
 * `ctx.attachments.saveImage({ data: Uint8Array, mediaType, name })` 生成。
 * 0.4.4 的 `llm.chat` 拍的是 `{ type: 'image', source: { type: 'base64', … } }`——
 * 那是别的 SDK 的形状，DSH 不认，图一进适配器整次调用就断，最后只剩一个
 * `finish`（`reason.kind === 'error'`），一条 text-delta 都没有，面板就成了
 * 「问完模型没反应」。
 */

let llm = null;
let attachments = null;

/** 宿主 llm 服务（`ctx.llm`，Cordis 服务名 `llm`）。 */
export function setLlm(service) {
  llm = service || null;
}

/** 取宿主 llm 服务；没有就 null（动作据此给出人话诊断）。 */
export function getLlm() {
  return llm;
}

/** 给自检用：判断桥是否接上（不暴露服务本体）。 */
export function hasLlm() {
  return Boolean(llm && typeof llm.listModels === 'function');
}

/** 宿主附件服务（`ctx.attachments`）：只用来把图片登记成可引用的附件。 */
export function setAttachments(service) {
  attachments = service || null;
}

/** 取宿主附件服务；没有就 null。 */
export function getAttachments() {
  return attachments;
}

/** 给自检用：判断附件桥是否接上。 */
export function hasAttachments() {
  return Boolean(attachments && typeof attachments.saveImage === 'function');
}

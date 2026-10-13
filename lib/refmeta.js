/**
 * 科研模式 · 按需抓取文献元数据（CrossRef）
 * ---------------------------------------------------------------------------
 * **只在用户点「抓取」时联网**：面板不预取、不轮询、不后台抓。
 * 抓回来的字段只用来**填表单**，最终落库仍然由 `research.py add-ref` 决定；
 * 用户在表单里改过的值优先。
 *
 * 口径：
 *   - 只认 DOI。没有 DOI 的文献照样能靠手填 URL 入库（CrossRef 查不到）。
 *   - 网络错误/超时/404 分别给不同 code，面板照实显示，不做「猜一个」。
 *   - 不写任何文件、不改任何库状态（纯读网络 + 返回对象）。
 */

const ENDPOINT = 'https://api.crossref.org/works/';
const TIMEOUT_MS = 12_000;
const MAX_AUTHORS = 30;
const DOI_RE = /^10\.\d{4,9}\/\S+$/;

/** CrossRef 的类型 → 本库 `add-ref --type` 的取值。 */
const TYPE_MAP = {
  'journal-article': 'article',
  'journal-issue': 'article',
  'journal-volume': 'article',
  'journal': 'article',
  'book': 'book',
  'monograph': 'book',
  'edited-book': 'book',
  'reference-book': 'book',
  'book-chapter': 'book',
  'book-part': 'book',
  'book-section': 'book',
  'book-series': 'book',
  'proceedings-article': 'inproceedings',
  'proceedings': 'inproceedings',
  'dissertation': 'thesis',
  'report': 'report',
  'report-series': 'report',
  'posted-content': 'preprint',
  'dataset': 'misc',
  'standard': 'misc',
  'component': 'misc',
  'peer-review': 'misc',
  'other': 'misc',
};

const asString = (v) => (typeof v === 'string' ? v.trim() : '');
const fail = (code, message, details = {}) => ({ ok: false, error: { code, message, details } });

/** 把各种写法收敛成一个裸 DOI；不合法返回 ''。 */
export function normalizeDoi(input) {
  let s = asString(input);
  if (!s) return '';
  s = s.replace(/^\s*doi\s*:\s*/i, '');
  s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  s = s.replace(/^https?:\/\/(www\.)?doi\.org\//i, '');
  s = s.replace(/\s+/g, '');
  s = s.replace(/[.,;]+$/, '');
  return DOI_RE.test(s) ? s : '';
}

const pick = (...vals) => {
  for (const v of vals) {
    const s = asString(v);
    if (s) return s;
  }
  return null;
};

const firstYear = (msg) => {
  for (const key of ['issued', 'published-print', 'published-online', 'published', 'created']) {
    const parts = msg?.[key]?.['date-parts'];
    const y = Array.isArray(parts) && Array.isArray(parts[0]) ? parts[0][0] : null;
    if (Number.isFinite(y)) return y;
  }
  return null;
};

const authorList = (msg) => {
  const raw = Array.isArray(msg?.author) ? msg.author : [];
  const names = [];
  for (const a of raw.slice(0, MAX_AUTHORS)) {
    const name = pick([a?.given, a?.family].map((s) => asString(s)).filter(Boolean).join(' '), a?.name, a?.literal);
    if (name) names.push(name);
  }
  return names;
};

/**
 * 按 DOI 抓一条元数据。
 * @param {{doi?:string}} input
 * @returns {Promise<{ok:true,value:object}|{ok:false,error:{code:string,message:string,details:object}}>}
 */
export async function fetchRefMeta(input = {}) {
  const rawInput = asString(input.doi);
  if (!rawInput) return fail('bad-request', '请先填 DOI（抓取只认 DOI）');
  const doi = normalizeDoi(rawInput);
  if (!doi) return fail('bad-request', `看不出这是 DOI：${rawInput}。正确形状像 10.1021/acs.jpcc.0c01234`);

  if (typeof fetch !== 'function') {
    return fail('internal', '当前 Node 没有全局 fetch（需要 Node 18+），无法联网抓取');
  }

  const url = `${ENDPOINT}${encodeURIComponent(doi)}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      signal: ctl.signal,
      headers: { accept: 'application/json', 'user-agent': 'dsh-sciwork/0.1 (panel on-demand lookup)' },
    });
  } catch (error) {
    clearTimeout(timer);
    const aborted = error?.name === 'AbortError';
    return fail(
      aborted ? 'timeout' : 'network',
      aborted ? `CrossRef 超时（${TIMEOUT_MS / 1000} s）：${doi}` : `连不上 CrossRef：${String(error?.message || error)}`,
      { doi, url },
    );
  }
  clearTimeout(timer);

  if (res.status === 404) {
    return fail('not-found', `CrossRef 里查不到这个 DOI：${doi}（可能写错了，或它还没被收录）`, { doi, url });
  }
  if (!res.ok) {
    return fail('network', `CrossRef 返回 ${res.status}：${doi}`, { doi, url, status: res.status });
  }

  let body;
  try {
    body = await res.json();
  } catch (error) {
    return fail('network', `CrossRef 的响应不是 JSON：${String(error?.message || error)}`, { doi, url });
  }
  const msg = body?.message;
  if (!msg || typeof msg !== 'object') {
    return fail('network', `CrossRef 响应缺少 message 字段：${doi}`, { doi, url });
  }

  const authors = authorList(msg);
  const year = firstYear(msg);
  const container = pick(
    Array.isArray(msg['container-title']) ? msg['container-title'][0] : null,
    Array.isArray(msg['short-container-title']) ? msg['short-container-title'][0] : null,
    msg.publisher,
    Array.isArray(msg.institution) ? msg.institution[0]?.name : null,
  );
  const title = pick(Array.isArray(msg.title) ? msg.title[0] : null, Array.isArray(msg.subtitle) ? msg.subtitle[0] : null);
  const ctype = asString(msg.type).toLowerCase();

  return {
    ok: true,
    value: {
      source: 'crossref',
      doi,
      title: title ? String(title).replace(/\s+/g, ' ').trim() : null,
      authors,
      authorText: authors.join(', '),
      year,
      container: container || null,
      volume: pick(msg.volume),
      issue: pick(msg.issue),
      pages: pick(msg.page, msg['article-number']),
      url: pick(msg.URL, `https://doi.org/${doi}`),
      type: TYPE_MAP[ctype] || 'misc',
      crossrefType: ctype || null,
      publisher: pick(msg.publisher),
      language: pick(msg.language),
      warnings: [
        ...(title ? [] : ['CrossRef 没给标题，请自己补']),
        ...(authors.length ? [] : ['CrossRef 没给作者，请自己补']),
        // 注意判的是「原始作者数组」而不是 authorList() 的结果：
        // authorList 已经 slice(MAX_AUTHORS) 截断，拿它再比较恒为 false（旧实现是死警告）。
        ...((Array.isArray(msg?.author) ? msg.author.length : 0) > MAX_AUTHORS
          ? [`作者超过 ${MAX_AUTHORS} 位，只带回前 ${MAX_AUTHORS} 位`] : []),
      ],
      note: '只带回候选字段，落库前请自己核对；面板不会替你判断这条文献是否可信。',
    },
  };
}

/**
 * 科研模式 · 分隔符文本表的**唯一**读表实现（宿主侧）
 * ---------------------------------------------------------------------------
 * 面板的「列表头」与数据变换、预览必须用同一套规则，否则下拉里列出来的列名和真正
 * 处理时找不到的列名会对不上。所以这里只留一份实现，library.js 与数据变换都用它。
 *
 * 表头判定（2026-10-11 修：用户真实的 XRD 导出文件根本没有表头）：
 *   - 第一行整行都是数字 ⇒ **没有表头**（XRD/仪器导出的两列数据就是这样）；
 *   - 第一行的列数和第二行对不上 ⇒ **没有表头**（第一行往往是仪器信息，比如
 *     `16:51 09-10-2026 DIF TDXRD CSC 40kV/30mA …`，按空白切会切出一堆假列名）；
 *   - 其余情况第一行当表头。
 * 没有表头时，列名按列序叫 `#1` `#2` …（面板上显示成「第 1 列」），第一行照样是数据。
 *
 * 缺失值一律解析成 `null`：空单元格、NaN/NA/null/none/- 都算缺失，**不填充、不插值**。
 */

/** 认分隔符：逗号 / 制表符 / 分号 / 空白，谁在第一行切出来的列多算谁。 */
function pickDelimiter(firstLine) {
  const cands = [
    { d: ',', n: firstLine.split(',').length },
    { d: '\t', n: firstLine.split('\t').length },
    { d: ';', n: firstLine.split(';').length },
    { d: /\s+/, n: firstLine.trim().split(/\s+/).length },
  ].sort((a, b) => b.n - a.n);
  return cands[0].d;
}

function isNumericCell(v) {
  if (v === '' || v === null || v === undefined) return false;
  return Number.isFinite(Number(String(v).trim()));
}

/**
 * 读一张分隔符文本表。
 * @param {string} text 文件内容
 * @returns {{header: string[], rows: Array<Array<number|string|null>>, headerless: boolean, delimiter: string}}
 */
export function parseTable(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/)
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
  if (lines.length < 2) throw new Error('表里只有一行（至少要有表头 + 一行数据）');
  const delim = pickDelimiter(lines[0]);
  const split = (line) => (delim instanceof RegExp ? line.trim().split(delim) : line.split(delim))
    .map((s) => s.trim());
  const unquote = (s) => s.replace(/^["']|["']$/g, '');
  const asCells = (line) => split(line).map(unquote);

  const first = asCells(lines[0]);
  const second = lines.length > 1 ? asCells(lines[1]) : [];
  const allNumeric = first.length > 0 && first.every(isNumericCell);
  const widthMismatch = second.length > 0 && second.length !== first.length;
  const headerless = allNumeric || widthMismatch;
  // 列数对不上的第一行（XRD 导出常见的仪器信息行，比如
  // `16:51 09-10-2026 DIF TDXRD CSC 40kV/30mA …`）既不是表头也不是数据行 → 直接丢掉，
  // 列名按**真正的数据行**宽度取 #1 #2 …；整行都是数字时第一行本身就是数据，保留。
  const width = headerless ? (second.length || first.length) : first.length;
  const header = headerless
    ? Array.from({ length: width }, (_, i) => '#' + (i + 1))
    : first;
  const body = (headerless && allNumeric) ? lines : lines.slice(1);

  const rows = [];
  for (const line of body) {
    const cells = split(line);
    if (!cells.length || (cells.length === 1 && cells[0] === '')) continue;
    rows.push(cells.map((c) => {
      const v = unquote(c);
      if (v === '' || /^(nan|na|null|none|-)$/i.test(v)) return null;
      const num = Number(v);
      return Number.isFinite(num) ? num : v;
    }));
  }
  return { header, rows, headerless, delimiter: delim instanceof RegExp ? 'space' : (delim === '\t' ? 'tab' : 'comma') };
}

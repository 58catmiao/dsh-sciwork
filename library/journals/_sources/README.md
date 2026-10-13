# `_sources/` —— 用户投放区（现在**基本不需要再放东西**）

把期刊官方的 **Guide for Authors / Artwork & Media Instructions / 投稿模板 / 国家标准全文** 丢进这个目录，我来本地解析并把数值字段回填到 `library/journals/<档案 key>.json`。

> **2026-10-11 收尾状态：12 份档案全部取证完毕，除 1 件外都不需要你动手。**
> 唯一还需要人工的：`gbt-7714` 若要**现行 2025 版条款正文**，只能在浏览器里过图形验证码（能下的是 `GB/T 7713.2-2022`）或走单位图书馆的标准数据库；`GB/T 7714-2025` 是**采标件**（采用 ISO 690），国家标准全文公开系统明示因版权不提供在线阅读，所以**它没有「下载按钮」不是你看漏了**。

## 一、现在的状态（谁放了什么、还缺什么）

| 档案 | confidence | 数值来源 | 还需要你投放吗 |
| --- | --- | --- | --- |
| `nature` / `mdpi` / `plos-one` | high | 官方 artwork / instructions 页 | 不需要 |
| `ieee-trans` | medium | 官方页 | 不需要 |
| `elsevier-generic` | medium | Elsevier 官方 artwork 五页（路径 0） | 不需要 |
| `science` | medium | 官方两份子页的 Wayback 快照（路径 0b） | 不需要 |
| `acs` | medium | 官方页（真浏览器）+ **官方 PDF 端点直连** | 不需要 |
| `cell` | medium | 官方四页（stealth 真浏览器穿透 Cloudflare） | 不需要 |
| `chinese-core-journal` | medium | 中国物理学会《物理》2026 年现行投稿须知（路径 0c） | 不需要 |
| `thesis-generic` | medium | 哈工大研究生院《研究生学位论文写作指南（理工类）》官方 .doc ＋ MIT 规格官方 PDF | 不需要 |
| `gbt-7714` | low | 官方题录页打印件（条款正文为采标件、官方不公开；打印件由用户本机留存，未随仓库分发） | **只有必须拿 2025 版正文时才需要**（见下） |
| `cnki-thesis` | low | **故意全 null**：CNKI 是收录平台、不制定排版格式 | 不需要（具体数值看 `thesis-generic.json`） |

**已经不用放的 8 份**（都由我自行取证，见 `../RETRIEVAL.md` 的路径 0 / 0b / 0c / 0d）：`elsevier-generic`、`science`、`acs`、`cell`、`chinese-core-journal`、`thesis-generic` ＋ 原本就是 high 的 `mdpi`、`nature`、`plos-one`、`ieee-trans`。

> ⚠️ 反例（为什么「打印一份网页」常常不管用）：
> - 用户此前投放的 `Cell.pdf`（本机留存，未随仓库分发）是 Cell 官网「Information for authors」**导航页**打印稿 —— 全页只有栏目清单与政策链接，`dpi` / `resolution` / `mm` / `column` / `font` 命中**全为 0**。
> - 后来投放的 `国家标准_GB_T 7714-2025.pdf`（同上，本机留存）是 openstd 的**题录页**打印稿（2 页 / 831 字符），只有标准号、状态、发布/实施日期与那句「暂不提供在线阅读服务」，**没有条款正文**。
> - 判据：抽文后 grep `dpi|mm|resolution|column|font`，命中 0 就说明这份文件里没有规范数值。**要投放时，请确认页面正文里出现了具体数字。**

## 二、若确实要放：命名与硬要求

命名用档案 key 当文件名（`gbt-7714.pdf`、`thesis-generic.pdf`……），带后缀也认（`gbt-7714-2025.pdf`）；一份文件覆盖多个档案时随便挑一个 key，我会在 `sources`/`notes` 里写明实际来源。PDF 留在这里当证据，**回填后不要删**（`sources` 会指向它，面板「期刊档案」页也按这个路径显示）。

**硬要求：PDF 必须有文字层。** 本机**没有 OCR**（没有 tesseract / poppler / pdftoppm，也没有任何 Python PDF 库）：

- ✅ **可用**：出版社官网下载的文本版 PDF —— 用阅读器打开能**选中文字**。
- ❌ **不可用**：扫描件、拍照转的 PDF、Origin/Grapher 那种「导出时字体没带 Unicode 映射」的矢量 PDF。
- ⚠️ **中文标准特别注意**：openstd 的「在线预览」是**图片版**，另存成 PDF 也不会有文字层 —— 这种情况**不要投 PDF，直接把关键条文文字贴给我**（例如「图题用几号字」「参考文献著录格式示例」那几条），我更愿意按你贴的原文回填。

不确定就放进来，我跑抽取时会如实告诉你「这份读不出」，你再换一份。

## 三、放进来之后会发生什么

1. 你说一声「PDF 放好了」（或直接说期刊名/标准号）。
2. 我跑 `library/scripts/pdf-text.mjs` 抽正文（Word 附件用同一目录下的抽文脚本），再按关键词找规格句，逐条核对（若是你贴的文字，我直接核对）。
3. **只回填原文明确写了的数值**；每份档案：
   - `sources` 追加 `journals/_sources/<实际文件名>`（或注明「用户粘贴的条文原文」）；
   - `verifiedAt` 改成回填当天日期；
   - `confidence`：官方原文直读 → `medium`（原文最权威，但终究是转录，不冒充 `high`）；**二手转载**的标准文本 → 保持 `low` 并在 `sources`/`notes` 写清来源性质；
   - 原文没写的字段**继续留 `null`**，并在 `notes` 里写明「官方原文未给出」（宁缺勿猜）。
4. 跑 `journal-index.py check` 确认 `12 份通过，0 份有问题`，再把结果报给你。

## 四、我会尝试回填的字段（每份档案最多 25 项）

- **figure**（对画图最有用）：`singleColumnMm` / `doubleColumnMm` / `maxHeightMm` / `minFontPt` / `maxFontPt` / `fontFamily` / `lineWidthPt` / `rasterDpi.{photo,line,combination}` / `vectorPreferred` / `colorMode` / `panelLabels`
- **text**：`abstractMaxWords` / `abstractStyle` / `titleMaxChars` / `sections` / `wordLimitNote`
- **references**：`style` / `inTextExample` / `entryExample` / `maxAuthorsListed` / `doiRequired`
- **submission**：`coverLetterRequired` / `commonRejectionReasons`

★ 结构限制：JSON 的每个分区**只能放上表认得的键**（额外的说明一律写进该分区的 `notes`）；自造键会让体检失败、并让 `journal-index.py build` 少算一份档案。

## 五、`gbt-7714` 的三条出路（按省事排序）

1. **不管它**：写中文稿时按目标刊投稿须知里的著录示例执行（大多数中文刊官网都公开示例），本库 `chinese-core-journal.json` 里已有《物理》的三条官方示例可直接照抄格式。
2. **人工过验证码**：openstd `GB/T 7713.2-2022`（学术论文编写规则）详情页有「在线预览 / 下载标准」，进去过一次图形验证码即可下载（这是本组标准里唯一能免费拿全文的）。注意它**不是**参考文献著录规则，只能当「学术论文编写」的骨架。
3. **正版渠道**：单位图书馆的标准数据库 / 标准出版社购买 GB/T 7714-2025 正文。

无论哪条，`gbt-7714.json` 的 `confidence` 在拿到现行 2025 版正文之前**保持 `low`** —— 不会拿已废止的 2015 版或其他刊的规则充当现行规则。

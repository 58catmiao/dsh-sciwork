# 期刊档案目录（journals/）

这个目录是**科研模式**的"投稿规格速查库"。写论文时，agent 会先查这里，再按查到的规格排版、写图注、整理参考文献。

## 1. 目录里有什么

| 文件 | 作用 |
|---|---|
| `<id>.json` | 一份**期刊/标准档案**（12 个：nature / science / cell / plos-one / mdpi / acs / elsevier-generic / ieee-trans / gbt-7714 / chinese-core-journal / cnki-thesis / thesis-generic） |
| `_index.json` | **自动生成**的汇总索引（`journal-index.py build`），给 agent 快速挑档用，不要手改 |
| `README.md` | 本文件 |

档案的字段结构：顶层 13 键（`id/name/nameZh/publisher/language/homepage/figure/text/references/submission/sources/verifiedAt/confidence`）；
`figure` 12 键；`text` 5 键；`references` 5 键；`submission` 3 键。`text`/`references`/`submission` 里可另加可选的 `notes`。

## 2. 用法与优先级（重要）

> **用户现场要求 ＞ 期刊档案 ＞ 通用默认。**

- 档案是**默认值**，不是权威规定。真正具有约束力的是**目标刊最新的 Guide for Authors** 和**你所在学校研究生院的最新模板**。
- 用户当场说的要求（导师/编辑/学院的临时规定）永远压过档案。
- 档案里没写的，不要现编；要么去查，要么问用户。

## 3. `confidence` 怎么读

| 值 | 含义 | 当前有哪几份 |
|---|---|---|
| `high` | 官方页面直接读到并逐条抄录 | nature、mdpi、plos-one |
| `medium` | 官方原文读到并逐条抄录（转录入库，故不标 high）；或某分区来自期刊级页面 | ieee-trans、elsevier-generic、science、acs、cell、chinese-core-journal、thesis-generic |
| `low` | **数值字段未核实/无意义**，原因已写进 notes | gbt-7714（2025 版为采标件，官方不公开条款正文，本机只有题录页）、cnki-thesis（CNKI 不制定排版格式，数值字段故意留 `null`） |

（2026-10-11 收尾：12 份全部走完取证流程，只剩 2 份 `low`，且这两份的 `low` 都是**已探明的边界**而非「还没做」。逐份状态与取证路径见 `RETRIEVAL.md` 第一、二、六节。）

**`low` 不等于没用**——它至少告诉你"官方源长什么样、为什么抓不到、下次该去查哪一页"。但**用它的数值字段之前必须自己复核**（它的数值字段本来就都是 `null`）。

## 4. 已核实的事实：两个国标版本陷阱（2026-10-11 查自国家标准全文公开系统）

- **GB/T 7714-2025《信息与文献 参考文献著录规则》**：2025-12-02 发布、**2026-07-01 实施**，状态=现行。
  **GB/T 7714-2015 已废止**（2005、1987 版亦废止）。
  ⇒ **今天（2026-10-11）起，中文论文的参考文献应按 2025 版著录**，不要再用 2015 版的说法。
- **GB/T 7713.1-2025《信息与文献 编写规则 第 1 部分：学位论文》**：2025-08-01 发布、**2026-02-01 实施**，状态=现行。
  **GB/T 7713.1-2006《学位论文编写规则》已废止**。
- 另两个仍在用的：GB/T 7713.2-2022《学术论文编写规则》（2023-07-01 实施）、GB/T 7713.3-2014《科技报告编写规则》。
- 注意：**7714-2025 与 7713.1-2025 是采标件**（分别采用 ISO 690 等），公开系统只给题录、**不给条款正文** ⇒ `gbt-7714.json` 的示例类字段保持 `null`（不凭记忆填）。**7713.2-2022 例外**：它有「在线预览 / 下载标准」，但要人工过一次图形验证码。
- 学位论文的**实际数值**不在这两个国标里，而在**培养单位的当年文件**里（本库已取证样本 = **五份校级官方文件**：哈工大研究生院 2025-03-31《研究生学位论文写作指南》理工类 + 人文社科类、中国科学技术大学《研究生学位论文撰写模板》、同济大学《研究生学位论文写作参考指南（2025-10）》、内蒙古大学《研究生学位论文格式要求（2025 年修订）》，原件（五份抽取正文）由档案作者本机留存、未随仓库分发，逐条数值见 `thesis-generic.json`）；中文期刊的数值在**目标刊当年投稿须知**里（已取证样本 = **中文六刊**：中国物理学会《物理》《物理学报》、中国金属学会《金属学报》、中国机械工程学会《机械工程学报》、中国化学会《化学学报》、中国计算机学会《计算机学报》，逐条数值与出处见 `chinese-core-journal.json`，原件（23 件官网页面/附件/抽文）由档案作者本机留存、未随仓库分发）。**单位文件常滞后于国标版本**（哈工大 2025 指南仍写 GB/T 7714—2015；机械工程学报官网现行须知仍写 GB/T 7714-**2005**；反面样本 = 中科大模板已写 **2025 版**），送审前两边都要核对。

## 5. 通道实测：哪些真的取不到、哪些只是入口/客户端不对（2026-10-11 修正版）

**确实取不到的（别再白跑）**：

- `pubs.acs.org` / `researcher-resources.acs.org` 的**网页版**作者指南：`403`（Incapsula/Cloudflare）——★ 但**同一站的 PDF 端点不挡机器**：`…/author_guidelines/pdf?coden=<coden>` 可脚本直连（`acs` 档案就是这条路拿下的）。
- `science.org` 直连：`403`（连 sitemap 都 403）——★ 但**Wayback 里的官方子页是完整服务端渲染**，`science` 档案走的是快照（路径 0b）。
- `elsevier.com/journals/<刊>/guide-for-authors`（期刊级指南）：WAF 直接关连接。
- Elsevier artwork 的**旧入口** `researcher/author/...`：JS 空壳（`dpi` 命中 0）——★ 正确入口是 `/about/policies-and-standards/author/artwork-and-media-instructions/…`，服务端渲染可直读。
- 本环境 `web_search` **整体不可用**（`firecrawl rejected the keyless request (403)`）⇒ 取证只能靠直接 URL + 真浏览器，不能指望搜索。`cn.bing.com` 也不要做中文检索（结果被过滤，搜 "GB/T 7714-2015" 只返回"GB=吉字节"）。
- 中国行业标准平台 `hbba.sacinfo.org.cn`：查询参数会被丢弃、退回默认列表。
- `hxqk.lib.pku.edu.cn`（北大核心期刊要目总览）：连接失败。
- openstd 的「在线预览」是**图片版**且带**图形验证码** ⇒ 脚本永远过不去；`GB/T 7714-2025` 与 `GB/T 7713.1-2025` 更是采标件，**永久不提供在线阅读**（页面上没有下载按钮，不是浏览器问题）。

**「挡机器」但换客户端就能读的（路径 0c）**：`cell.com`（Cloudflare 挑战页）、`wuli.iphy.ac.cn/tougaoxuzhi`（《物理》投稿须知，JS 渲染）。工具 = 本库随包分发的 `library/scripts/cdp-text.mjs`（无头 Edge + CDP，默认 stealth + 挑战页自动 reload）。注意 `--dump-dom --virtual-time-budget` 这类**一次性渲染对 SPA 无效**（只能拿到 233 字符的空壳）。

**中文高校/学会的官方规范大多在附件里（路径 0d/0e）**：研究生院与期刊的**正文页往往只是通知**，真正的格式要求在 `_upload/…`、`/attached/…`、`download.jsp?…wbfileid=…` 直链的 `.doc`/`.docx`/`.zip` 里。抓取顺序 = 正文页 HTML → 页面内附件直链 → 用 `library/scripts/` 下的抽文脚本（OLE2 `.doc` 按 UTF-16LE、`.docx`/`.zip` 解包）抽文 → 逐词 `grep` 数值关键词。**附件直链常需带 Referer**（同济、内大的 `download.jsp` 就是），否则返回错误页。另外：`清华/北大/浙大/上交/西交/华科/南大/天大/北航` 的研究生院官网经逐栏爬取**都没有公开的学位论文格式规范**（只有盲审办法、封面、评阅书、表格）——这不是没找到入口，而是确实没公开。

**注意刊名易混**：`wuli.iphy.ac.cn` 是**《物理》**（中国物理学会，综述性月刊）；`wulixb.iphy.ac.cn` 是**《物理学报》**（Acta Physica Sinica，研究论文刊）——**两份现在都已取证**（《物理学报》的须知 + 下载中心两个 `.doc` 附件，其中「对图的要求」给的 半栏 6-7 cm / 通栏 13-14 cm / 位图 600 dpi / `.eps .pdf .ai .cdr` / CMYK 或 RGB / 分图 (a)(b)(c) 已并入 `chinese-core-journal.json`）。

**中文学会的刊也能直连**：`wulixb.iphy.ac.cn`、`www.ams.org.cn`、`www.cjmenet.com.cn`、`sioc-journal.cn`、`cjc.ict.ac.cn` 的**须知页是静态 HTML**（`Invoke-WebRequest -UseBasicParsing` 即可），但**真正带数字的规范常在附件里**——必须顺着页面里的 `_upload/…`、`/attached/…` 直链把 `.doc` / `.zip` 下下来，再用 `library/scripts/` 下的抽文脚本抽文（本机无 OCR，`.doc` 用 UTF-16LE 抽）。`opticsjournal.net` 例外：阿里云 WAF `acw_sc__v2` 挑战，CDP stealth 也拿不到。

## 6. 加 / 改一份档案

1. 复制一份最接近的档案改名（文件名 = `id`，脚本会校验一致性）。
2. 只填你在**官方页面亲眼读到**的数字；读不到就留 `null`，并把"读了哪个 URL、返回什么、为什么拿不到"写进 `figure.notes`。
3. `verifiedAt` 写查询日期，`confidence` 按第 3 节自评，`sources` 列出所有试过的 URL。
4. 跑一遍体检和索引：

```powershell
python library/scripts/journal-index.py check
python library/scripts/journal-index.py build
```

`check` 有问题会以退出码 1 结束，并把问题列在 `problems` 里。

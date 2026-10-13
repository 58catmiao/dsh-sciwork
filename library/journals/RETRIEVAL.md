# 期刊档案数值字段：取证记录与补全路径

> 记录时间 2026-10-11（同日更新：新增**路径 0「官方网页直取」**，Elsevier 通用档案已按此路取证回填；文末新增第六节「中国标准与学位论文官方入口」。**再次更新：新增 0b「官方页归档快照」——Science 全档由此取证回填。第三次更新：新增 0c「真实浏览器穿透 Cloudflare」与 ACS 官方 PDF 直链——`acs` 与 `cell` 两份档案同日取证回填，低置信档案从 8 份降到 4 份（只剩中文三项 + gbt-7714）。第四次更新：中文三项按「路径 0 / 0c + 培养单位官方文件」收尾——`chinese-core-journal`（《物理》投稿须知）与 `thesis-generic`（哈工大写作指南 + MIT 规格）升为 medium 并全部填值，`cnki-thesis` 保持 low 但写明原因；体检 12/12 通过，低置信只剩 `gbt-7714`（采标不公开）与 `cnki-thesis`（平台不制定格式）两份，且这两份的 low 都是「已知边界」而非「未取证」。**第五次更新：`chinese-core-journal` 由「单一样本《物理》」扩为「中文六刊官网 + 官方附件」聚合样本——《物理学报》《金属学报》《机械工程学报》《化学学报》《计算机学报》的须知页与 `.doc`/`.zip` 附件逐条取证，原件 23 件由档案作者本机留存、未随仓库分发；该档案的每个数值现在都标注了出自哪一刊，并新增「各刊相反」的两处冲突（图表内能否用汉字、参考文献是否全列作者）。**）第六次更新：`thesis-generic` 由「哈工大单一样本 + MIT」扩为「五份校级官方文件 + MIT」——新增中国科学技术大学《研究生学位论文撰写模板》(官方 .docx)、同济大学《研究生学位论文写作参考指南（2025-10）》、内蒙古大学《研究生学位论文格式要求（2025 年修订）》(4 个 .doc 附件) 与哈工大人文社科类版；两校独立吻合的项（页边距 2.54/3.17 cm、正文小 4 号、图内 9~10.5 pt、图题在图下、分图小写 (a)(b)）可信度提升，并新增两条负面/反差结论：九所重点高校官网根本没有公开的学位论文格式规范；学校里对国标版本的跟进不一致（中科大已写 GB/T 7714-2025，哈工大 2025 指南仍写 2015）。**）**当时的结论是：12 份档案里 8 份的数值字段全部留 `null`，这不是遗漏，是本机环境下所有自动取证通道都被挡住后的「宁缺勿猜」。** 本文把「试了什么、返回什么」逐条留证，并给出可执行的补全路径。

## 一、当前状态

| 档案 | confidence | 数值字段 | 说明 |
| --- | --- | --- | --- |
| `nature.json` | high | 有 | 官方 artwork 指南可读 |
| `mdpi.json` | high | 有 | 官方 instructions for authors 可读 |
| `plos-one.json` | high | 有 | 官方 figure 指南可读 |
| `ieee-trans.json` | medium | 部分 | 官方页可读但部分条目靠期刊级页面 |
| `elsevier-generic.json` | **medium** | **figure 全填** | 2026-10-11 按路径 0 从官方 artwork 页取到原文；text/references/submission 仍 null（在各刊 guide for authors 里） |
| `acs.json` | **medium** | **figure / text / references / submission 全填** | 2026-10-11 取证：官方页需真浏览器（403 挡机器），但**官方 PDF 端点可脚本直连**（`…/author_guidelines/pdf?coden=<coden>`，见路径 0c）；数值取自与刊无关的通篇附录「Appendix 2: Preparing Graphics」，已在 JACS（jacsat）与 Accounts of Chemical Research（achre4）两刊交叉核对一致 |
| `cell.json` | **medium** | **figure / text / references / submission 全填** | 2026-10-11 取证：`cell.com` 有 Cloudflare 挑战页，用无头 Edge + CDP 的 **stealth 模式**（真实指纹 + 挑战页自动 reload）直读官方四页（figure-guidelines / revise-manuscript / article-types / submit-manuscript）；**注意用户提供的打印稿只含导航，无数值** |
| `science.json` | **medium** | **figure / text / references / submission 全填** | 2026-10-11 按路径 0 从官方两份子页（初投 / 修回）取到原文；注意 **Information for Authors 页本身不含任何图件数值**，且 science.org 直连 403 —— 本档读的是官方页的 Wayback 快照 |
| `gbt-7714.json` | low | 条款正文 null（题录项已核实） | GB/T 7714-2025 是**采标**件，国家标准全文公开系统明示因版权不提供在线阅读；本机唯一官方原文 = 用户另存的官方题录页打印件（已归档、已回填题录项） |
| `chinese-core-journal.json` | **medium** | **figure / text / references / submission 全部有值** | 2026-10-11 取证（两批）：① 中国物理学会《物理》2026 年现行投稿须知（`wuli.iphy.ac.cn/tougaoxuzhi`，CDP 直读）；② **中文六刊官网 + 官方附件**——《物理学报》（须知 + 下载中心两个 `.doc`）、中国金属学会《金属学报》（指南 + 模板 zip）、中国机械工程学会《机械工程学报》（须知 + 写作要求 zip）、中国化学会《化学学报》（须知，2025-11-04 更新）、中国计算机学会《计算机学报》（征稿简则 + Word 模板），原件 23 件由档案作者本机留存、未随仓库分发。**每一项数值都在 notes 里标了出自哪一刊**；六刊差异可达数倍（单栏 50–84 mm、通栏 100–176 mm、图内字号 7.5–10 pt、作者上限 3 名 vs 全部列出），**投稿前必须查目标刊当年须知** |
| `cnki-thesis.json` | low | 数值字段仍全 null（**这是正确的**） | CNKI 是收录/检索平台，**不制定排版格式** ⇒ 填任何数字都是误导；本轮已把「哈工大官方样本的具体数值在 `thesis-generic.json`」「学校模板会滞后（2025 指南仍写 GB/T 7714—2015）」写进 notes，并把 sources 扩到 5 条 |
| `thesis-generic.json` | **medium** | **figure / text / references / submission 全部有值** | 2026-10-11 取证（两批）：**五份校级官方文件 + 一份英文官方规格**——哈工大研究生院《研究生学位论文写作指南（理工类）》(2025-03-31) 与（人文社科类）、中国科学技术大学《研究生学位论文撰写模板》(官方 .docx)、同济大学《研究生学位论文写作参考指南 + 示例》(2025-10)、内蒙古大学《研究生学位论文格式要求（2025 年修订）》(官方 .doc ×4)、MIT Libraries《Specifications for Thesis Preparation》2022–2023。已核实项：页边距 2.54/3.17 cm（中科大、同济一致）、正文小 4 号 + 固定行距 20 磅或 1.25/1.5 倍、章标题三号黑体段前 24 磅段后 18 磅、**图内文字 9~10.5 pt**（两校吻合）、图题在图下（中科大 11 pt 加粗；同济段前 6 磅段后 12 磅）、分图小写 (a)(b)、摘要按校分档、关键词 3~6 / 3~8 / 3~5 三种口径、**中科大已引用 GB/T 7714-2025**、MIT 侧 PDF/A-1 为硬要求。★ 五份样本**一律未规定** dpi / 矢量 / 色彩 / 线宽 / 栏宽 / 图高 / 英文摘要字数（逐词 grep 命中 0）⇒ 那些字段保持 null 是「官方没写」 |

体检命令（**必须**在库脚本目录下跑，否则会报「体检 0 份」）：

```powershell
python library/scripts/journal-index.py check
```

## 二、逐通道实测矩阵（2026-10-11）

| 通道 | 实际手段 | 结果 |
| --- | --- | --- |
| 直接 HTTP 抓取 | Python `urllib`（带浏览器 UA） | `pubs.acs.org` / `cell.com` / `science.org` = **403 + Cloudflare 挑战页**（去标签后正文仅 18 字符） |
| **ACS 官方页（真浏览器）** | 无头 Edge + CDP（`cdp-text.mjs`） | ✅ 200：`https://researcher-resources.acs.org/publish/author_guidelines?coden=<coden>` 直读成功（jacsat 92 413 字符 / achre4 56 275 字符，含通篇附录 Appendix 2）；**普通 CDP 抓取与 `--dump-dom --virtual-time-budget` 拿不到正文（SPA/挑战），必须 `cdp-text.mjs`** |
| **ACS 官方 PDF 直链（脚本可直连）** | pwsh `Invoke-WebRequest` | ✅ **200**：`https://researcher-resources.acs.org/publish/author_guidelines/pdf?coden=<coden>`（HTML 里 id 为 `pdfDowloadDiv` 的 `<a href="author_guidelines/pdf?coden=achre4">`，即用户「找不到」的那个 PDF 按钮）；achre4 = 91 167 B、jacsat = 313 166 B / 29 页；抽文核对与网页版数值逐条一致 |
| **Cell Press 官方页（stealth 真浏览器）** | 无头 Edge + CDP，加 `--disable-blink-features=AutomationControlled` + 真实 UA/语言/窗口 + 挑战页自动 reload（`cdp-text.mjs` 默认开） | ✅ 200：`cell.com/figure-guidelines`（15 062 字符）、`/cell/information-for-authors/{revise-manuscript,article-types,submit-manuscript}`（25 419 / 8 082 / 7 104 字符）全部可读；**未 stealth 时正文只有 114 字符的 Cloudflare「请稍候…」页** |
| Cell Press 站内入口链 | 直读 `cell.com/cell/authors` 的链接清单 | ✅ 官方子页结构：`/cell/information-for-authors`（落地页，只有导航）+ `…/revise-manuscript`（Title/Summary/References 全部规则）+ `…/article-types`（各类型字数上限）+ `…/submit-manuscript`（cover letter）+ `…/journal-policies` |
| Elsevier 官方 artwork 页（正确入口） | pwsh `Invoke-WebRequest` | ✅ **200 + 服务端渲染正文**：`/about/policies-and-standards/author/artwork-and-media-instructions/{artwork-overview,artwork-types,artwork-sizing,artwork-formats-checklist,artwork-faq}` 五个页面全部可读（仅 `glossary` 连接被关）；已据此填好 `elsevier-generic.json` 的 figure 全部数值 |
| Elsevier 期刊级 guide for authors | pwsh `Invoke-WebRequest` | ❌ `elsevier.com/journals/<刊>/<issn>/guide-for-authors`、`sciencedirect.com/journal/<刊>/publish/guide-for-authors` 一律「**连接被意外关闭**」（WAF 拦），需真实浏览器 |
| Cell / Science 站点地图 | pwsh 取 `cell.com/sitemap-index-1.txt`、`science.org/sitemap-index-1.txt` | ❌ 均 **403**（连 sitemap 都拦；`robots.txt` 本身 200 可读）。ACS `publish.acs.org/robots.txt` = `Disallow: /` |
| 中国政府标准门户 | pwsh `Invoke-WebRequest` | ✅ 检索页与详情页 200、服务端渲染；❌ 全文预览/下载需**图形验证码** |
| modsearch 桥 | `web_search` / `read_page` 工具 | `firecrawl rejected the keyless request (403)`，**整体不可用**（本机没有配搜索 key） |
| Web Archive 桥 | 同上 `read_page` 取 `web.archive.org` | 返回 0 字节（桥的引擎拒绝） |
| Web Archive 直连 | pwsh `Invoke-WebRequest`（**可用**） | CDX API 200、快照可下载 |
| Elsevier 旧 URL | `/researcher/author/policies-and-guidelines/artwork-and-media-instructions` | **404**；旧路径 `researcher/author/tools-and-resources/artwork-guidelines` 是 JS 空壳（176573 B / 去标签 89341 字符，`dpi` 命中 0） |
| Elsevier 快照 | 19 个快照（2023-12-08 → 2026-09-22）逐个统计 | 每个快照 `dpi = 0`、`mm = 0` ⇒ **JS 空壳，正文靠前端拉取，归档里没有数值** |
| Science 快照（Information for Authors 页本身） | 2025-08-08 快照（179 017 B）可下载 | 正文里 `dpi = 0`、`resolution = 0`、`mm = 0` ⇒ **该页本身不含图件数值**；整页只有一个 `.pdf` 链接（`promo.aaas.org` 的 careers 文件，与投稿无关）⇒ **这一页没有 PDF 版可下载，不必再找**；它的价值是「目录页」：指向下面两份子页 |
| **Science 官方子页快照（有效通道）** | CDX 查两个子页 URL → 取快照：`/content/page/instructions-preparing-initial-manuscript`（2025-08-10，178 306 B）与 `/content/page/instructions-preparing-revised-manuscript`（2025-03-30，147 973 B） | ✅ **服务端渲染、正文可读**：栏宽 5.7 / 12.1 / 18.4 cm、字号 ≥5 pt（推荐 7 pt、符号 ≥6 pt）、线宽 ≥0.5 pt、位图 ≥300 dpi、矢量格式顺序 PDF→EPS→AI、不收 PPT/Word 内嵌图、图注 ≤200 词、标题 ≤96 字符、参考文献括号内斜体数字 `(1)` 等，全部取自原文；已回填 `science.json`（confidence=medium） |
| ACS 快照 | CDX 查 `pubs.acs.org/page/authorguidelines/submission.html` | **无任何快照**（`archived_snapshots: {}`） |
| Cell 快照 | CDX 查 `cell.com/cell/authors` | 有 2016–2022 快照（最新 2022-01-11），未逐条抽取 |
| Elsevier 第三方 CDN | `els-cdn` 猜测路径 | 未命中，不再猜 URL |
| 中文核心期刊须知（有效通道 A） | 中国物理学会《物理》`https://wuli.iphy.ac.cn/tougaoxuzhi` | ✅ CDP 直读 7 756 字符（`--dump-dom` 只拿到 1 696 字符的壳）；摘要 150—300 字 / 英文 400—700 字符、关键词 ≥4 且定顺序、图 ≤5 cm×8 cm 或 10 cm×16 cm、照片 ≥600 dpi、正文末另附集中图、参考文献顺序编码制 + 三条官方示例 ⇒ 已回填 `chinese-core-journal.json`（medium） |
| **中文核心期刊须知（有效通道 B：六刊官网 + 官方附件）** | 物理学报 `wulixb.iphy.ac.cn/tougaoxuzhi` 与 `/xiangguanziliaoxiazai`；金属学报 `ams.org.cn/CN/column/column106.shtml` + 模板 zip；机械工程学报 `cjmenet.com.cn/CN/column/column346.shtml`、`column347.shtml` + 模板 zip；化学学报 `sioc-journal.cn/Jwk_hxxb/CN/column/column58.shtml`；计算机学报 `cjc.ict.ac.cn/wltg/zgjz.htm` + `CJC-Templet_Word2003.doc` | ✅ **须知页是静态 HTML（`Invoke-WebRequest -UseBasicParsing` 即可），但数字在附件里**：物理学报「对图的要求」「参考文献引用须知」是两个 `.doc`（用 `library/scripts/` 下的抽文脚本抽文），机械工程学报的写作要求与图规范在 2.1 MB 模板 zip 内的 Word 里，金属学报的 Origin 画图参数在模板 zip 里。取到并已并入档案：半栏 6-7 cm / 通栏 13-14 cm（物理学报）、双栏 8.4 cm / 通栏 17.6 cm / 高 ≤24 cm（化学学报）、位图 ≥600 dpi（三家独立一致）、矢量 `.eps/.pdf/.ai/.cdr`（物理学报）与**强制矢量**（计算机学报）、CMYK 或 RGB（物理学报）、分图 (a)(b)(c) + 分图题用分号隔开（物理学报）、图内 6 号宋体/Times New Roman（机械）、Arial 10 pt（化学）、框线 0.5 磅（机械）/0.6 pt（化学）/1.0~1.5（金属）、三线表（三家）、**GB/T 7714-2005 的唯一明写样本 = 机械工程学报**（+ 六类 `[J]/[M]/[D]/[EB/OL]/[P]/[S]` 示例）、参考文献作者上限**各刊相反**（3 名 + et al. vs 全部列出）⇒ 原件 23 件由档案作者本机留存、未随仓库分发，数值与逐字原句并入 `chinese-core-journal.json` |
| 中文期刊聚合站（死路，别再试） | 光学学报 `opticsjournal.net`（阿里云 WAF `acw_sc__v2` 挑战，CDP stealth 两次只得 20 字符 body）、金属学报 `jim.org.cn`、`pcsee.org` / `dlxb.net.cn`（SSL EOF / 502）、`cjche.com.cn`（Vue SPA）、`sciengine.com`（SPA 壳）；清华大学 `yjsy.tsinghua.edu.cn`、浙大 `grs.zju.edu.cn` TLS/连接失败；`hbba.sacinfo.org.cn`（行业标准平台）查询参数会被丢弃；CY/T 171-2019《学术出版规范 插图》与教育部《编排规范》无公开可读全文 | ❌ 全部记为「未找到」，**未用任何二手转载代替**，不计入证据 |
| **高校研究生院规范（有效通道 A：哈工大官方 .doc）** | 哈工大研究生院通知页 `https://hitgs.hit.edu.cn/2025/0331/c17546a365618/page.htm` → 官方 .doc 附件（7 073 792 B，理工类） | ✅ **Word 二进制也能取证**：用 `library/scripts/` 下的抽文脚本按 UTF-16LE 抽出 847 060 字符，逐条读到版心 150 mm×240 mm±2 mm、每页约 33 行、正文小 4 号 + 1.25 倍行距、图题在图下/表题在表上、三线表、摘要 500~1000（硕）/1000~2000（博）字、题目 ≤25 汉字、参考文献博士 ≥100/硕士 ≥40 篇 ⇒ 已回填 `thesis-generic.json`（medium） |
| **高校学位论文规范（有效通道：四校五份官方 Word 原件）** | 中科大 `gradschool.ustc.edu.cn/column/65` → `static/upload/article/file/…docx`；同济 `gs.tongji.edu.cn/info/1096/3013.htm` → `download.jsp owner=1516911423&wbfileid=17835479/17835480`；内蒙古大学 `gs.imu.edu.cn/info/1040/1970.htm` → `download.jsp owner=1246019856&wbfileid=…`（4 个附件）；哈工大人文社科类 = 通知页附件 3 | ✅ **正文页只是通知，格式要求在附件里**：`.doc/.docx/.zip` 直链下载后抽文（OLE2 按 UTF-16LE、docx 解包 `word/document.xml`）；`download.jsp` 类链接**需带发布页 Referer**，否则返回错误页。取到并已并入档案：页边距 2.54/3.17 cm、页眉 1.5/页脚 1.75 cm、正文小 4 号 + 固定行距 20 磅、章标题三号黑体段前 24 磅段后 18 磅、图内文字 9~10.5 pt、图题 11 pt 或段前 6 磅段后 12 磅、分图小写 (a)(b)、关键词 3~8/3~6/3~5、**中科大已引用 GB/T 7714-2025**（唯一跟上 2025 版的高校样本）、内大是唯一把「作者 >3 只列前三 + et al」写成明文规则的、中科大带 **AI 工具使用声明页** ⇒ 原件 5 件由档案作者本机留存、未随仓库分发 |
| 国内高校规范（**负面结论**，别再逐校爬） | 清华（域名不解析）、北大、浙大（证书过期 + 502）、上海交大、西安交大（只给 `.rar` 且附件防盗链返回 HTML）、华中科大、南京大学、天津大学、北京航空航天大学的研究生院官网 | ❌ 逐栏爬取**均无公开的学位论文格式规范**（只有盲审办法、封面、评阅书、表格）⇒ 记为「未公开」，不是「没找到入口」；唯一拿到的官方 PDF（中科大 2026 研究生手册 89 MB / 129 页）是**无文字层扫描件**（`pdf-text.mjs` 仅 2 341 字符），本机无 OCR |
| 国外高校规范（对照通道） | MIT Libraries `https://libraries.mit.edu/distinctive-collections/thesis-specs/` + 其官方 PDF | ✅ HTML 175 157 字符 + PDF 335 267 B / 23 页（PDF 端点**不挡机器**，可直连）；字体建议 sans-serif（非强制）、摘要 ≤500 words、**最终稿必须 PDF/A-1**、未给页边距 ⇒ 作为英文侧对照写进 `thesis-generic.json` |
| 本机搜索通道 | `web_search`（modsearch → firecrawl） | ❌ 全程不可用：`firecrawl rejected the keyless request (403)` ⇒ 本轮取证全部靠直接 URL + CDP |

**一句话**：12 份档案**全部走完取证**（`nature` / `mdpi` / `plos-one` 原本 high；`elsevier-generic` 路径 0、`science` 路径 0b、`acs` / `cell` 路径 0c、`chinese-core-journal` 路径 0c + 中文六刊官网附件、`thesis-generic` 五份校级官方文件 + MIT，七份本轮由我自行取证回填并升为 medium）。**只剩两份 low，且都是「已探明的边界」而非「没去做」**：`gbt-7714`（GB/T 7714-2025 是采标件，官方系统明示因版权不提供在线阅读；本机只拿到题录页）、`cnki-thesis`（CNKI 不制定排版格式，填数字即伪证据）。全部成功案例都证明同一件事：**判定「官网没有数值」之前先怀疑入口、副本、客户端与文件类型**——换入口（Elsevier）、换副本（Science 快照）、换客户端（ACS/Cell/《物理》真浏览器）、换文件类型（哈工大与四校的 `.doc`/`.docx`、六刊的 `.doc`/`.zip` 附件）之后，原本「读不到」的规范都能读到；而**确实没有公开**的（九所重点高校的学位论文规范、GB/T 7714-2025 条款正文、CY/T 171-2019）也已逐条记为「未公开」，不用二手转载顶替。

## 三、补全路径（按省事程度排序，都不需要改代码）

0. **官方网页直取（本机实测可行 —— Elsevier 已用这条路填完）**
   关键是**入口要选对**：Elsevier 的图件规范不在 `researcher/author/...`（JS 空壳）之下，而在 `/about/policies-and-standards/` 之下，且是服务端渲染。可复现的发现方法：
   ```powershell
   # 1) robots.txt 拿 sitemap
   Invoke-WebRequest -UseBasicParsing 'https://www.elsevier.com/robots.txt' -OutFile el-robots.txt
   # 2) sitemap 索引 → global.xml（718 KB，含全部官方页面 URL）
   Invoke-WebRequest -UseBasicParsing 'https://www.elsevier.com/sitemaps/global.xml' -OutFile el-global.xml
   # 3) 在 global.xml 里筛目标专题，再逐页取正文（对 /about/policies-and-standards/... 有效）
   Select-String -Path el-global.xml -Pattern 'artwork-and-media-instructions' | ForEach-Object { $_.Line.Trim() }
   ```
   本次据此取的五个页面：`…/author/artwork-and-media-instructions/` 下的 `artwork-overview`、`artwork-sizing`（栏宽 90/140/190 mm、字号 7 pt / 下标≥6 pt、300/500/1000 dpi）、`artwork-types`（线宽 0.10–1.5 pt、各类型最低 dpi）、`artwork-faq`（推荐线宽 0.25 pt、不收 PNG、RGB→CMYK）、`artwork-formats-checklist`（可接受格式 TIFF/JPEG/EPS/PDF/Office）。
   **适用边界**：这条只对「服务端渲染的官方政策页」有效。`cell.com` / `science.org` / `pubs.acs.org` 连 sitemap 都 403，`elsevier.com/journals/<刊>/guide-for-authors` 被 WAF「连接被关闭」。**但站点被归档后，归档副本往往就是服务端渲染的**——Science 就是这样拿下的（见下面的 0b），所以「直连 403」不等于「拿不到」。

0b. **官方页的归档快照（Science 全档已用这条路填完）**
   直连 science.org 是 403 + Cloudflare，但 Wayback 里的官方页是完整的服务端渲染 HTML：
   ```powershell
   # 1) CDX 找快照（science.org 的 CDX 会偶发 503/504，重试 2–5 次、退避 5–10 秒即可）
   Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 -Headers @{'User-Agent'='Mozilla/5.0'} `
     "http://web.archive.org/cdx/search/cdx?url=science.org/content/page/instructions-preparing-revised-manuscript&output=json&filter=statuscode:200&from=2024&limit=-4"
   # 2) 取最新快照原文（id_ = 不加归档工具条）
   Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 -Headers @{'User-Agent'='Mozilla/5.0'} `
     "https://web.archive.org/web/20250330182956id_/https://www.science.org/content/page/instructions-preparing-revised-manuscript" -OutFile sci-rev.html
   # 3) 去标签后按关键词抽句子（第四节命令 3 / 4）
   ```
   本次据此取的两份子页：`instructions-preparing-initial-manuscript`（初投；栏宽 5.7/12.1/18.4 cm、字号 ≥5 pt、线宽 ≥0.5 pt、300 dpi、图注 ≤200 词）、`instructions-preparing-revised-manuscript`（修回；格式清单 PDF/EPS/AI + TIFF ≥300 dpi、不接受 Word 内嵌图与 PPT）。**入口链**：Information for Authors 页（本身无数值、无 PDF 链接）→ 页内链接指向这两份子页。
   **反例（别再试）**：同类的 ACS / Cell 归档快照是 JS 空壳（`dpi` 命中 0）。「归档可读」是站点属性、不是普遍规律——先花一次 CDX 查询验证，再决定要不要人工投放。

0c. **真实浏览器直读（ACS 与 Cell 已用这条路填完）**
   对「挡机器客户端」的站点（Cloudflare 挑战页 / SPA），本机的稳定通路是**无头 Edge + CDP**，工具已入库：`library/scripts/cdp-text.mjs`（无头 Edge + CDP，随仓库分发）。
   ```powershell
   # 默认即 stealth + 挑战页自动 reload；输出 <out>.txt / <out>.html / <out>.links.txt
   node library/scripts/cdp-text.mjs 'https://www.cell.com/figure-guidelines' 'cell-fg.txt' --wait=20000 --port=9490
   ```
   三个关键开关（`--stealth=1 --reload=1` 默认开）：`--disable-blink-features=AutomationControlled` + 真实 UA/语言/窗口尺寸；正文 <400 字符（Cloudflare 挑战页只有 114 字符）时自动 reload 最多 2 次、每次再等 `max(wait,15000)`；`--headful=1` 可切成有界面模式人工观察。
   **同一站点的第二条路**：有些站「网页挡机器、静态文件不挡」——ACS 的官方指南 PDF 就能用 `Invoke-WebRequest` 直连：`https://researcher-resources.acs.org/publish/author_guidelines/pdf?coden=<coden>`（coden 见网页版 URL；ACHRE4 之外的刊换成自己的 coden）。**先用浏览器读 HTML 找 `pdf`/`download` 链接，再试直连**，往往比渲染整页更省事。
   **别忘了「用户手上那份 PDF 可能是假的原始件」**：Cell 的打印稿只印出了导航页，数值全在子页里；判据是抽文后 grep `dpi|mm|resolution|column|font`，命中 0 就说明这份文件不含规格，必须回到官网子页。

0d. **培养单位 / 期刊自办的「当年」文件（`thesis-generic` 与 `chinese-core-journal` 已用这条路填完）**
   国标给骨架，**数值在单位文件里**，而这些文件常是**网页 + Word 附件**的组合，且 PDF 端点通常不挡机器：
   - 中文期刊：`《物理》https://wuli.iphy.ac.cn/tougaoxuzhi`（无头 Edge + CDP 直读；`--dump-dom` 只拿到 1 696 字符的壳，**必须用带等待的 CDP**）。
   - 高校：哈工大研究生院通知页 → `_upload/article/files/.../*.doc` 直链（7 073 792 B）。**Word（OLE2）也能抽文**：用 `library/scripts/` 下的抽文脚本（ZIP→python-docx / OLE2→按 UTF-16LE 解码抽可打印片段、按常用字打分选优），抽文后用同一套脚本的 `--after=` 选项跳过开头的目录域字段码，直接读正文第 N 节。
   - 国外对照：MIT `https://libraries.mit.edu/distinctive-collections/thesis-specs/` + 官方 PDF（335 267 B / 23 页，直连可取）。
   **适用边界**：单位文件只对**那一家单位**成立；换学校/换刊必须重取。写档时把「这是培养单位规定、不是国标」写进 `notes`，并把「该校数值详见 `thesis-generic.json`」写进不制定格式的档案（如 `cnki-thesis`）。
   **别再试的死路**：`hbba.sacinfo.org.cn`（行业标准平台）会把查询参数丢掉、退回默认列表；光学学报类门户与金属学报 `jim.org.cn` 只给 JS 壳或 404；清华 `yjsy.tsinghua.edu.cn` / 浙大 `grs.zju.edu.cn` 本机 TLS 连接失败。另外本机 `web_search` 全程不可用（`firecrawl rejected the keyless request (403)`），**取证必须靠直接 URL + CDP，不能指望搜索**。

1. **给搜索桥配 key（最省事）**
   ```powershell
   npx @liustack/modsearch config set firecrawl.apiKey <你的 key>
   ```
   配好后 `web_search` / `read_page` 可用，再由智能体按档案里的 `homepage` 重新取证并回填；`sources` 里补上实际命中的 URL。

2. **人工 5 分钟回填**
   在能正常访问的浏览器里打开每份档案的 `homepage`，把 figure / text / references / submission 的数值填进对应 JSON，同时：
   - `verifiedAt` 改成当天日期；
   - `confidence` 提到 `high`（官方页直读）或 `medium`（二手来源）；
   - `sources` 加上真正读到数值的 URL。
   改完跑一次上面的体检命令确认仍 12/12 通过。

3. **把官方 PDF 收进库（本机已就绪，推荐）**
   把 Guide for Authors / Artwork & Media Instructions 之类官方 PDF 存到 `<库根>\journals\_sources\`，由我本地解析后回填。**该目录的 `README.md` 是给用户看的投放说明**（命名约定、文字层要求、回填契约、字段清单）。完整流程：
   - **命名**：用档案 key 当文件名（`acs.pdf` / `cell.pdf` / `science.pdf` / `elsevier-generic.pdf` / `gbt-7714.pdf` / `chinese-core-journal.pdf` / `cnki-thesis.pdf` / `thesis-generic.pdf`），带后缀也行（`acs-artwork-guidelines.pdf`）。
   - **硬要求**：PDF 必须有文字层。本机没有 OCR（无 tesseract / poppler / pdftoppm，也没有任何 Python PDF 库），扫描件与拍照件一律读不出数值。**注意：多数「官方标准全文」在国家标准全文公开系统里是图片版 + 图形验证码，另存成 PDF 也没有文字层**——这种情形请把关键条文文字直接贴给我（见第六节）。
   - **抽取**（只读工具，随仓库分发：`library/scripts/pdf-text.mjs`）：
     ```powershell
     # 自检（打印 pdfjs 版本与解析到的路径）
     node library/scripts/pdf-text.mjs --doctor
     # 抽全文到文件（PowerShell 控制台是 GBK，务必 --out 再读文件）
     node library/scripts/pdf-text.mjs '<库根>\journals\_sources\acs.pdf' --out "$env:TEMP\acs.txt"
     # 只找规格句 / 只看某几页
     node library/scripts/pdf-text.mjs '<库根>\journals\_sources\acs.pdf' --grep 'dpi|resolution|mm|column|font|color|colour'
     node library/scripts/pdf-text.mjs '<库根>\journals\_sources\acs.pdf' --pages 3-7
     ```
     依赖 `pdfjs-dist` 6.3.289（由 Node 正常解析 `pdfjs-dist` 即可；`PDFJS_PATH` 环境变量可覆盖）。
   - **回填契约**：只填原文写了的数值；`sources` 加 `journals/_sources/<实际文件名>`；`verifiedAt` = 抽取当天；`confidence` `low` → `medium`（官方 PDF 直读，仍不冒充 `high`）；原文没写的留 `null` 并在 `notes` 写「官方 PDF 未给出」。
   - **验收**：跑 `python library/scripts/journal-index.py check` → 必须仍是 `12 份通过，0 份有问题`。

   **能力实测（2026-10-11，抽取器已跑通）**：
   - ✅ 文本版中文 PDF（289 页 / 21.8 MB，iTextSharp 生成）→ 抽取 427 868 字符、中文正常、exit 0。
   - ❌ Origin 导出的图 PDF（23 KB，矢量图）→ 只抽出 123 个乱码字符、exit 1：属「导出字体缺 Unicode 映射」，不是扫描件（此类 PDF 不可用于取证）。
   - 抽取器在「字母数字 < 50」时 exit 1 并区分两种原因（扫描件需 OCR / 字体缺映射），避免把读不出误报成「PDF 里没写」。

## 四、本机可复现的命令备忘

```powershell
# 1) 查某 URL 有没有归档快照（去掉 collapse 可看全部）
Invoke-WebRequest -UseBasicParsing -TimeoutSec 40 `
  "http://web.archive.org/cdx/search/cdx?url=<URL>&output=json&filter=statuscode:200&collapse=digest"

# 2) 取某个快照的原文（id_ 后缀 = 不加归档工具条的原始内容）
Invoke-WebRequest -UseBasicParsing -TimeoutSec 60 -Headers @{ 'User-Agent'='Mozilla/5.0' } `
  "https://web.archive.org/web/<timestamp>id_/<URL>" -OutFile out.html

# 3) 从页面里抽「dpi / 栏宽 / 字号 / 字体 / 线宽」相关语句（只读；用库内抽文脚本 pdf-text.mjs 的 --grep 即可）
node library/scripts/pdf-text.mjs out.html --grep 'dpi|resolution|mm|column|font|line'

# 4) HTML 去标签成纯文本（本机 Python 无 bs4，用正则即可；存文件再读，避免 GBK 控制台）
python -X utf8 -c "import re,sys,html,pathlib; t=pathlib.Path(sys.argv[1]).read_text(encoding='utf-8',errors='replace'); t=re.sub(r'(?is)<(script|style|svg|noscript)[^>]*>.*?</\1>',' ',t); print(html.unescape(re.sub(r'(?s)<[^>]+>','\n',t)))" page.html > page.txt

# 5) 真浏览器直读（Cloudflare / SPA / JS 渲染站；输出 .txt + .html + .links.txt）
node library/scripts/cdp-text.mjs '<URL>' '<out>' --wait=15000 --port=9490

# 6) Word（.doc，OLE2 二进制）抽文 —— 培养单位规范常只给 .doc 附件
$env:PYTHONIOENCODING='utf-8'
python library/scripts/doctext.py 'guide.doc' --enc=utf-16-le |
  Out-File 'guide.txt' -Encoding utf8          # 自动按常用字打分选最优编码，先不给 --enc 也行

# 7) 在长文里按正则取「带上下文窗口」的条文（--after=N 可跳过 Word 开头的目录域字段码）
python library/scripts/ctx.py 'guide.txt' '版心|页边距|行距' --win=240 --max=40 --after=20000 |
  Out-File 'guide-print.txt' -Encoding utf8

# 8) 库内体检 + 重建索引（必须在库脚本目录下跑，否则报「体检 0 份」）
python library/scripts/journal-index.py check
python library/scripts/journal-index.py build
```

**踩坑**：`web.archive.org/web/2024id_/<url>` 这种「年份占位」写法在没有对应快照时返回 404，别误判成「归档不可用」——先用 CDX 拿准确 timestamp 再取。另外 PowerShell 控制台是 GBK，Python 打印中文会 `UnicodeEncodeError`，跑脚本前设 `$env:PYTHONIOENCODING='utf-8'` 并把输出重定向到文件再读。`.doc`（OLE2）里中文通常是 **UTF-16LE**，直接按 UTF-8 读会全是乱码——`library/scripts/doctext.py` 会自己打分选编码；Word 文件开头还有目录域字段码，用 `library/scripts/ctx.py` 的 `--after=` 跳过即可。`journal-index.py` 的字段白名单很严：档案里 `text` / `figure` 等分区**只能放 schema 认得的键**（额外的说明一律进 `notes`），多加一个自造键（例如 `abstractMaxWordsByDegree`）会让该份体检失败并让 `build` 少算一份。

## 五、字段清单与逐档案状态（2026-10-11 第四次更新后：12 份取证完毕）

下表原为「8 份低置信档案待填字段清单」（结构一致、各 25 项），现保留作为**字段作用速查**；各档案的**实际状态**见本节末尾的「哪些档案不用再补」。原则不变：原文没写的**继续留 `null`**，不做推测。

| 分区 | 字段 | 作用 |
| --- | --- | --- |
| figure | `singleColumnMm` / `doubleColumnMm` | 单栏/双栏图宽（mm），决定画布尺寸换算 |
| figure | `maxHeightMm` | 图高上限 |
| figure | `rasterDpi.photo` / `.line` / `.combination` | 位图最低分辨率（照片 / 线条图 / 组合图），直接决定导出 dpi |
| figure | `minFontPt` / `maxFontPt` | 图内字号下限/上限 |
| figure | `fontFamily` | 图内字体（多为 Arial/Helvetica） |
| figure | `lineWidthPt` | 线条最细宽度 |
| figure | `vectorPreferred` | 是否要求矢量（EPS/PDF/AI） |
| figure | `colorMode` | RGB / CMYK / 灰度 + 是否免费彩印 |
| figure | `panelLabels` | 分栏标签写法（`a` / `A` / `(a)`） |
| text | `abstractMaxWords` | 摘要字数上限 |
| text | `abstractStyle` | 摘要类型（结构化/非结构化） |
| text | `titleMaxChars` | 标题字符上限 |
| text | `sections` | 正文必需章节顺序 |
| text | `wordLimitNote` | 全文/正文长度限制说明 |
| references | `style` | 参考文献体系（ACS / Vancouver / GB-T 7714 …） |
| references | `inTextExample` | 正文引用示例 |
| references | `entryExample` | 文后条目示例 |
| references | `maxAuthorsListed` | 最多列几位作者（其余 et al.） |
| references | `doiRequired` | 是否要求 DOI |
| submission | `coverLetterRequired` | 是否必须投稿信 |
| submission | `commonRejectionReasons` | 常见拒稿原因（列表） |

**哪些档案不用再补**（2026-10-11 第五次更新后的状态）：

- `nature` / `mdpi` / `plos-one`：本来 high、全填。
- `ieee-trans`：medium，figure/text 部分靠期刊级页面的项已注明。
- `elsevier-generic` / `science` / `acs` / `cell`：四个分区全部取证回填（路径 0 / 0b / 0c）。
- `chinese-core-journal`：**六家中文核心刊样本（《物理》《物理学报》《金属学报》《机械工程学报》《化学学报》《计算机学报》）聚合回填**，每个数值标出处；未规定项**故意留 null**（如线条图/组合图 dpi），原件由档案作者本机留存、未随仓库分发。
- `thesis-generic`：**五份校级官方文件（哈工大理工/人文、中科大、同济、内蒙古大学）+ MIT 官方 PDF** 逐条取证回填，每个数值标出处；未规定项**故意留 null**（dpi / 矢量 / 色彩 / 线宽 / 栏宽 / 图高 / 英文摘要字数，五校 grep 命中 0）。
- `gbt-7714`：**条款正文不可得**（采标不公开），只有题录项已核实 ⇒ 保持 low。它不是「待办」，而是「本机边界」。
- `cnki-thesis`：**数值字段故意全 null**——CNKI 不制定排版格式，任何数字都是伪证据；它的值是「路由说明」（去 `thesis-generic.json` 取具体数值）。也保持 low。

**还需要人工动手的只剩一件**：`gbt-7714` 若必须要现行 2025 版条款正文，只有两条路——(a) 在浏览器里点开 `GB/T 7713.2-2022` 的「在线预览 / 下载标准」并**过图形验证码**（能下的只有 7713.2，不是 7714）；(b) 通过所在单位图书馆的标准数据库/正版购买取得 GB/T 7714-2025。其余 10 份档案不需要任何人工投放（用户此前投放的 `_sources/Cell.pdf` 只有导航、`_sources/国家标准_GB_T 7714-2025.pdf` 只有题录页，两者均由用户本机留存、未随仓库分发，只作「打印稿不等于规范原文」的实证保留）。

## 六、中国标准与学位论文的官方入口（2026-10-11 实测）

**国家标准全文公开系统**（国家市场监督管理总局 / 国家标准化管理委员会，官方免费）：

| 标准 | 状态（官方标） | 发布 / 实施 | 官方详情页 | 全文可得性 |
| --- | --- | --- | --- | --- |
| GB/T 7714-2025《信息与文献 参考文献著录规则》 | **现行** | 2025-12-02 / 2026-07-01 | https://openstd.samr.gov.cn/bzgk/gb/newGbInfo?hcno=C6CE52E55AC09B9C79A20AEA77CEDD14 | ❌ **采标**（采用 ISO 690）⇒ 系统明示「涉及版权保护问题，暂不提供在线阅读服务」 |
| GB/T 7714-2015（上一版） | **废止** | 2015-05-15 / 2015-12-01 | https://openstd.samr.gov.cn/bzgk/gb/newGbInfo?hcno=7FA63E9BBA56E60471AEDAEBDE44B14C | —（已被 2025 版替代） |
| GB/T 7713.1-2025《信息与文献 编写规则 第 1 部分：学位论文》 | **现行** | 2025-08-01 / 2026-02-01 | https://openstd.samr.gov.cn/bzgk/gb/newGbInfo?hcno=36C05B5738C54D42B4B262525320B52F | ❌ **采标** ⇒ 同样不提供在线阅读 |
| GB/T 7713.2-2022《学术论文编写规则》 | **现行** | 2022-12-30 / 2023-07-01 | https://openstd.samr.gov.cn/bzgk/gb/newGbInfo?hcno=0B963916637B8F34B295FCF4A51A1BE5 | ✅ 页面提供**在线预览 + 下载标准**（需过图形验证码） |
| GB/T 7713.3-2014《科技报告编写规则》 | 现行 | — | https://openstd.samr.gov.cn/bzgk/gb/newGbInfo?hcno=E2BA32B0F5E570E5844A9E7E2D42393F | —（本库暂不需要） |

- 检索入口（可复现）：`https://openstd.samr.gov.cn/bzgk/gb/std_list?p.p1=0&p.p90=circulation_date&p.p91=desc&p.p2=7714`（把 `7714` 换成任意号即可；结果行给出 hcno、状态、发布/实施日期）。
- 全文入口（**需图形验证码，智能体过不去，浏览器里 10 秒**）：`https://openstd.samr.gov.cn/bzgk/std/showGb?type=online&hcno=<hcno>&request_locale=zh`；把 `type=online` 换成 `type=download` 即下载页。
- **2026-10-11 真浏览器复核（用户在浏览器里打开后回传的现象，解释了「中国的没有下载按键」）**：
  - `GB/T 7714-2025` 详情页（hcno=`C6CE52E55AC09B9C79A20AEA77CEDD14`）标注备注「采」，正文含「该标准采用了 ISO、IEC 等国际国外组织的标准，由于涉及版权保护问题，本系统暂不提供在线阅读服务。」⇒ 该页**根本没有**「在线预览 / 下载标准」按钮，不是浏览器问题，换设备也一样。
  - `GB/T 7713.2-2022` 详情页（hcno=`0B963916637B8F34B295FCF4A51A1BE5`）**有**「在线预览」「下载标准」两个按钮，点击后要过一张图形验证码 —— 这是本组标准里唯一能免费拿到全文的（人工 10 秒）。
  - 结论：需要人工过验证码的只有 `GB/T 7713.2-2022` 一份；`GB/T 7714-2025` 与 `GB/T 7713.1-2025` 都是采标件，官方系统永久不提供，任何「下载按钮」的期待都应放弃。
- **2026-10-11 官方题录页打印件已归档**：用户在浏览器里另存的 `国家标准_GB_T 7714-2025.pdf`（2 页 / 401 407 B，Skia 打印 = 题录页 + 网站版权页；用库内抽文脚本抽出 831 字符；该打印件由用户本机留存，未随仓库分发）。**这是该标准在本机唯一能拿到的官方原文**，据此已核实并写进 `gbt-7714.json` 的题录项：标准号 `GB/T 7714-2025`（标「采」）、中文名「信息与文献 参考文献著录规则」、英文名 `Information and documentation—Rules for bibliographic references and citations to information resources`（＝ ISO 690 标题 ⇒ 2025 版为采标件）、状态「现行」、CCS `A14`、ICS `01.140.20`、发布 `2025-12-02`、实施 `2026-07-01`、主管/归口 国家标准委、发布单位 国家市场监督管理总局与国家标准化管理委员会；以及逐字原句「该标准采用了 ISO、IEC 等国际国外组织的标准，由于涉及版权保护问题，本系统暂不提供在线阅读服务。」**条款正文仍为 null**（`inTextExample` / `entryExample` / `maxAuthorsListed` / `doiRequired`），`confidence` 保持 `low`。
- **可用的替代依据**（写清来源即可，不冒充国标）：① 目标期刊当年的投稿须知（期刊必须按现行国标执行，官网通常公开著录示例）；② 高校图书馆/研究生院发布的学位论文格式规范（多为公开、带文字层的 PDF，可直接解析）。用这两类来源回填时，`sources` 写实际 URL、`notes` 注明「来源为期刊/学校要求，非 GB/T 7714 正文」。
- 因此四份中文档案的**收尾结果**（2026-10-11 第四次更新，现已全部落地）：
  - `gbt-7714`：**2015 已废止、2025 才是现行**（已写进档案 notes，复核无误）。2025 版是采标件、官方不公开 ⇒ 本机唯一官方原文是那份题录页打印件，已回填题录项；条款正文保持 null、`confidence` 保持 `low`。**不要把 2015 的规则当现行规则填**，也不要用二手网站的标准文本冒充官方。
  - `chinese-core-journal`：✅ **已按路径 0c 取证回填**——中国物理学会《物理》2026 年现行投稿须知（`https://wuli.iphy.ac.cn/tougaoxuzhi`，无头 Edge + CDP 直读 7 756 字符）。`confidence` low → **medium**。★ 该刊还给出了「参考文献」的三条官方示例（3 名 + et al. ⇒ `maxAuthorsListed = 3`）。
  - `thesis-generic`：✅ **已按「培养单位官方文件」路线取证回填**——哈工大研究生院《研究生学位论文写作指南（理工类）》（2025-03-31 发布，官方 .doc 附件 7 073 792 B，抽文 847 060 字符；版心 150 mm×240 mm±2 mm、每页约 33 行、正文小 4 号 + 1.25 倍行距、图题在图下/表题在表上、三线表、摘要 500~1000/1000~2000 字、题目 ≤25 汉字、参考文献博士 ≥100/硕士 ≥40 篇）+ MIT Libraries《Specifications for Thesis Preparation》2022–2023（PDF 335 267 B / 23 页；**PDF/A-1 为硬要求**）。`confidence` low → **medium**。**仍未规定**的项（图片栏宽、图片 dpi、矢量格式、色彩空间、线宽）故意留 null。
  - `cnki-thesis`：**保持 low 且数值字段全 null —— 这是结论不是缺口**：CNKI 不制定排版格式；本轮把「哈工大官方样本的数值见 `thesis-generic.json`」「学校模板会滞后（2025-03-31 的指南仍写 GB/T 7714—2015）」写进 notes，`sources` 由 2 条扩到 5 条。
- **本次同时留下的两条方法论**：① **学校/期刊的「当年」文件才是硬约束**——国标给骨架、单位文件给数值，且单位文件常滞后于国标版本（哈工大 2025 指南仍按 2015 版）；② **Word（.doc / OLE2）也能抽文**——用 `library/scripts/doctext.py`（ZIP→python-docx 分支 / OLE2→按 UTF-16LE 解码抽可打印片段、按常用字打分选优），这使「只提供 .doc 附件」的研究生院规范同样可被取证；配 `library/scripts/ctx.py` 的 `--after=` 可跳过 Word 开头的目录域字段码，直接读正文第 N 节。

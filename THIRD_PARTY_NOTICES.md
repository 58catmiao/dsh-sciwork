# 第三方声明（Third-Party Notices）

`dsh-sciwork` 本仓库自己的代码以 **MIT** 许可证发布（见 `LICENSE`）。
本文件列出仓库涉及的全部第三方关系，以及本仓库**不包含**的内容。

本仓库**没有 npm 依赖**：宿主半边 `lib/*.js` 只用 Node.js 内置模块，`lib/client.js` 是手写 Web 客户端。

---

## 1. dsh-origin-plugin

- 项目：`dsh-origin-plugin`
- 作者：Fantasality
- 许可证：MIT
- 仓库：<https://github.com/Fantasality/dsh-origin-plugin>

本仓库的 `skills/origin-plot/` 是它的**适配与纪律层**（不是它的副本）；其中
`skills/origin-plot/references/origin-tools.json` 派生自它的工具清单
（`origin_*` MCP 工具的实测导出）。

**本仓库不再分发该插件的代码**，用户需自行安装该插件后才能使用 `origin_*` 工具。
该插件保留其原有 MIT 许可；其版权归原作者所有。

---

## 2. 期刊投稿档案（`library/journals/*.json`）

`library/journals/*.json` 是作者依据**公开发布的期刊官方投稿须知 / 作者指南**
整理的**数值与条款摘要**，每份档案的 `sources` 字段都记录了实际查阅的出处 URL。

这些官方入口（各档案自身的 `homepage`，逐个核对可达）包括：

| 档案 | 官方入口 |
| --- | --- |
| `acs` | <https://researcher-resources.acs.org/publish/author_guidelines?coden=jacsat> |
| `chinese-core-journal` | <https://wuli.iphy.ac.cn/tougaoxuzhi> |
| `elsevier-generic` | <https://www.elsevier.com/about/policies-and-standards/author/artwork-and-media-instructions/artwork-overview> |
| `gbt-7714` | <https://openstd.samr.gov.cn/bzgk/gb/newGbInfo?hcno=C6CE52E55AC09B9C79A20AEA77CEDD14> |
| `ieee-trans` | <https://journals.ieeeauthorcenter.ieee.org/create-your-ieee-journal-article/> |
| `nature` | <https://www.nature.com/nature/for-authors/formatting-guide> |
| `plos-one` | <https://journals.plos.org/plosone/s/figures> |

`cell`、`mdpi`、`science`、`thesis-generic`（哈工大研究生院）等站点的官方页面会对
自动化请求返回 403，未在此列出直达链接；实际取证的 URL 记在各自档案的 `sources` 里。

- 本仓库**不包含**任何期刊的 PDF 原文、受版权保护的正文或图片。
  （取证过程中在作者本机留存的打印件 / 抽文，如 `library/journals/_sources/` 里提到的那些，
  均**未随仓库分发**。）
- 摘要中的数值与条款引用仅作出处标注与核对之用；正式投稿请以目标期刊当期的官方页面为准。
- 上游各期刊、出版商与机构的名称与商标归其各自所有者。

---

## 3. pdfjs-dist

- 许可证：Apache-2.0
- 许可证原文：<https://www.apache.org/licenses/LICENSE-2.0>
- 项目：<https://github.com/mozilla/pdf.js>

**可选**运行时依赖：仅当用户使用 `library/scripts/pdf-text.mjs` 抽取 PDF 文本时才会用到。

它**不在本仓库的依赖里**（本仓库没有 npm 依赖），需要用户自备；
`library/scripts/pdf-text.mjs` 按本机路径查找它，也可用 `PDFJS_PATH` 环境变量指定。

---

## 说明口径

- 本仓库自己的代码：**MIT**。
- 上述第三方各自保留其原有许可。
- 本仓库**不含**任何受版权保护的论文 / 期刊原文、PDF 正文或图片。

---

## 附：链接可用性核对

本文件中的链接于 **2026-10-13** 核对过一次。部分出版商站点（如 Cell Press、MDPI、
Science、部分高校研究生院）会对自动化请求返回 403，但浏览器可正常访问；这不代表链接失效。
另：本仓库自身在 GitHub 上的公开地址按发布计划为
<https://github.com/58catmiao/dsh-sciwork>（核对时尚未上线）。

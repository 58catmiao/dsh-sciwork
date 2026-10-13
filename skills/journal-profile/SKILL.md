---
name: journal-profile
description: 期刊档案：投稿目标期刊的图规范、正文格式与参考文献体例。当用户说：投哪本刊、这本刊的图要求、单栏多宽、字号多少、要多少 dpi、参考文献格式、建一个期刊档案、更新期刊要求、期刊模板时使用。
---

# 期刊档案

档案是**期刊要求的本地缓存**，存在 `<库根>\journals\<id>.json`，索引在 `journals\_index.json`。
已有 12 份（`nature` / `science` / `cell` / `ieee-trans` / `elsevier-generic` / `acs` / `plos-one` / `mdpi` / `gbt-7714` / `chinese-core-journal` / `cnki-thesis` / `thesis-generic`）。

## 0. 定位与免责（必须先讲清）

档案是**默认值**，不是刊方现行要求的权威副本。每份档案都带：

- `sources` — 依据的 URL 列表
- `verifiedAt` — 抓取/核对日期
- `confidence` — `high`（官网 author guidelines 逐条抄录）/ `medium`（二手汇总或部分字段推断）/ `low`（经验值）

用法：**用户现场给的要求 > 期刊档案 > 通用默认**。三者冲突时当场告诉用户，并说明你按哪个做的。**不要把档案说成"期刊官方规定"**。

## 1. 档案字段

```jsonc
{
  "id": "nature",
  "name": "Nature",
  "publisher": "...",
  "scope": "...",
  "sources": ["https://..."],
  "verifiedAt": "2026-10-11",
  "confidence": "high",
  "figures": {
    "singleColumnMm": 89, "doubleColumnMm": 183,
    "maxHeightMm": 247,
    "fontFamily": "Arial/Helvetica", "fontSizePt": {"min": 5, "max": 7},
    "lineWidthPt": {"axis": 0.25, "data": 0.5},
    "dpi": {"line": 600, "halftone": 300, "combination": 600},
    "formats": ["pdf", "eps", "png"],
    "colorMode": "RGB",
    "panelLabels": "a, b, c (lowercase bold)",
    "errorBars": "required to state s.d./s.e.m. and n",
    "notes": "..."
  },
  "text": { "language": "en", "abstractWords": 150, "titleWords": 20, "highlights": false },
  "references": {
    "style": "author-year | numeric | gbt7714",
    "authorLimit": 5, "etAlRule": ">5 → first author et al.",
    "journalAbbrev": true, "doiRequired": true, "sample": "..."
  },
  "submission": { "portal": "...", "coverLetter": true, "suggestedReviewers": 3, "notes": "..." }
}
```

字段缺失比编造好：不确定就省略该字段，并在 `notes` 里写"未核实"。

## 2. 用法：给绘图/写作供参数

- 绘图：`origin-plot` 用 `figures.singleColumnMm / doubleColumnMm` 换算成 `page_size_cm`（mm ÷ 10）；字号、线宽、dpi、配色、panel 标注格式都照抄档案。
- 写作：图注体例、摘要字数、标题字数、参考文体例照抄档案。

## 3. 选刊（用户问"投哪本"）

**不许编造影响因子、审稿周期、录用率。** 这些必须现查：

1. `web_search` 查期刊官网 / 数据库（JCR、Scopus、中科院分区等来源需注明）。
2. `read_page` 读官网的 Aims & Scope 与 Author Guidelines。
3. 给出 2~4 个候选，逐个写：**范围匹配度（对着稿子的核心发现讲）/ 偏好的文章类型 / 图与参考文献要求 / 检索到的量化指标 + 来源 URL + 查询日期**。
4. 明确说"这些指标是查询当日的公开信息，可能变化"。
5. 用户定了之后，把该刊档案 `id` 写进课题 `project.json` 的 `journal` 字段，并告知后续绘图/写作都按它走。

## 4. 新建或更新档案

1. 先 `read_page` 抓官网 author guidelines（一次抓全：图、正文、参考文献、投稿流程）。
2. 抓不到的字段标 `confidence: "low"` 并在 `notes` 写明依据（例如"参照同类刊"）。
3. 写入 `<库根>\journals\<id>.json`，同步更新 `_index.json`（实际有的键：`id / file / name / nameZh / publisher / language / homepage / confidence / verifiedAt / sourceCount / singleColumnMm / doubleColumnMm / referenceStyle`）。注意：`columns`、`refStyle` 这两个字段名**在索引里不存在**，写进去只会留垃圾字段；不确定的键先看一眼 `journals/_index.json`。
4. 更新已有档案时保留旧的 `sources` 并追加新来源、把 `verifiedAt` 改成当天，**不要悄悄覆盖旧值**——有变化就在 `notes` 里写清"从 X 改成 Y，依据 …"。
5. 改完用 `py.cmd` 自测 JSON 可解析，再汇报改了什么。

## 5. 与科研库脚本配合

```powershell
& '<库根>\.research\bin\py.cmd' '<库根>\.research\scripts\research.py' status
... research.py search <关键词> --kind journal
```

- `register-figure --journal <id>` 会把期刊 id 记进图的溯源侧车，这是"图符合哪本刊要求"的证据锚点。
- 建课题时 `new-project --journal <id>` 把该刊设为课题默认。

## 6. 冲突与变更

- 用户说"期刊今年改了" → 重新抓官网，比对差异，逐字段报告 `旧值 → 新值`，由用户确认后再写。
- 用户给的是投稿系统里的具体要求（而不是网页）→ 以用户为准，写进档案并在 `sources` 标 `user-provided`。
- 同一本刊的"通用刊"与"特刊"要求不同 → 建两个档案（如 `elsevier-generic` 与 `elsevier-special-xxx`），不要混。

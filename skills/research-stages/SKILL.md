---
name: research-stages
description: 科研模式七阶段路线（topic → design → data → analysis → figure → draft → submission）：当前阶段该做什么、用哪些 sciwork_* 工具、退出检查项、怎么推进或回退。当用户问「现在到哪一步」「下一步做什么」「这个阶段要交什么」，或要切换阶段、看待办与阻塞时使用。
---

# 科研模式 · 七阶段路线

**科研模式只有一个**（preset `research`）。阶段不是另一个模式，而是课题 `project.json` 里的 `stage` 字段；换阶段 = 改字段，人格与工具集不变。阶段细节按需再加载 `research-studio` / `origin-plot` / `paper-writing` / `literature-refs` / `journal-profile`。

## 0. 先读现状，不要猜

```
sciwork_workflow_context            # ≤4 KB，会话开场取一次
sciwork_project_get  {project}      # stage / stages / checks / next / artifacts
sciwork_workflow_next {project}     # {stage, todo, blockers, ready}
```

- `stage` 只有七个取值：`topic design data analysis figure draft submission`
- `blockers` = 当前阶段未通过的检查项（每个带 `check` / `why` / `hint`）
- `todo` 给出建议动作（`data.import` / `figure.replot` / `submission.add` 等），按它走
- `ready: true` 才代表当前阶段做完；"我觉得做完了"不算

## 1. 七阶段：目标 / 动作 / 退出条件

| 阶段 | 目标 | 主要动作 | 退出条件（检查项） |
|---|---|---|---|
| topic | 把想法收敛成能执行的课题 | `project.create`（建目录 + project.json，stage=topic） | 标题能看懂；要回答的问题、可交付物、数据来源写清 |
| design | 变量与对照、样品与批次、统计口径、图表清单、期刊候选 | `project.update`（把研究设计写进 notes） | `design.plan`：notes 里有研究设计 |
| data | 原始数据入库，留来源与哈希 | `data.import` | 至少一条数据产物登记 |
| analysis | 派生表与统计量可复核 | `data.transform` | 至少一条派生产物 |
| figure | 按期刊档案出图 + 侧车溯源 + 登记进课题 | `figure.replot`、`journal.check` 看版式 | 图文件存在且同名 `.json` 侧车在 |
| draft | 只写库里能追溯的内容，引用逐条对应 refs | `draft.new` / `draft.write` / `draft.check_citations` | 草稿存在且引用核查通过 |
| submission | 核对期刊要求与材料清单、打包、登记投稿 | `journal.check` / `draft.package` / `submission.add` | `submission.record`：`<库根>\submissions\` 有本课题记录 |

工具名 = `sciwork_` + 动作名（`project.create` → `sciwork_project_create`）；不确定当前有哪些动作时调 `sciwork_action_catalog`。

## 2. 推进与回退

```
sciwork_action_plan    { action: 'project.stage.set', params: { project, stage: 'design' } }
sciwork_action_confirm { planId, token }
```

- **一次推进一格**，不越级；只有在用户明确要求跨阶段时才带 `force`
- 回退会把后面各阶段状态重置为 `pending`（`setStage` 的既定行为），**回退前先问用户**
- 旧库课题（没有 0.3 `project.json`）只能读；写之前先 `system.migrate --plan` → 看清清单 → `--apply`

## 3. 纪律（与 persona 一致，冲突时以 persona §0 为准）

1. **库优先**：课题 / 数据 / 稿 / 文献都在 `<库根>`，会话工作目录不是库
2. **写动作两步**：`action.plan` 拿 planId + token（5 分钟）→ `action.confirm`；读动作不落回执
3. **不编造**：数字、图、引用都要能指回库里文件；查不到就说查不到
4. **上下文用 `sciwork_workflow_context`**，不要整库读入
5. **跨阶段求助**：其它阶段的写动作先问用户，不擅自替用户推进
6. **面板优先**：用户在面板上点过的动作已经带确认与回执，不要替他重复执行

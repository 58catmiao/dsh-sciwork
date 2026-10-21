# 科研模式 0.3 架构方案：「一条能力清单 + 两块屏幕」

> **历史文档**：0.3.2 起 `figure.replot` / `replot` 动作与 `lib/replot.js` 已整体移除（面板不再重画图），
> 文中涉及它们的设计保留为当时的施工记录。
>
> 决策记录见 [decisions-architecture.md](./decisions-architecture.md)。本文件是给实施者的施工图：
> 读完应能直接开工，不需要再问「为什么这样拆」。

## 0. 这份文档怎么用

- 实施前先读 §1–§4，理解分层与目录。
- 写代码时以 §5–§10 为契约；§11–§12 是迁移与兼容，不能省。
- §15 是分阶段验收，每一阶段结束必须门禁全绿。
- §17 是可以直接粘进新对话的起手提示。

## 1. 目标

0.3 只做一件事：**把「动作」抽成唯一事实源，让面板与 agent 共用同一套动作、同一份课题状态。**
在此之上补齐全流程的骨架（阶段机 + 预设 agent），并把界面重做成以课题为中心的工作台。

判断是否成功的三个硬指标：

1. 任意一个新功能，只在一处登记，面板、agent、CLI 三处同时可用。
2. 面板里看到的「当前课题 / 阶段 / 待办」与 agent 读到的是同一份数据。
3. 全新安装者能在 DSH 里一键装好并跑通一次「建课题 → 导数据 → 出图 → 检查草稿」。

## 2. 约束与非目标

**硬约束**

- 宿主半边保持**零第三方依赖**（只用 `node:*`），客户端保持**零构建、零框架**。
- 端点、信封、错误码保持兼容：`POST /api/research/call`，`research/call`，`KNOWN_CODES`。
- Python 引擎（`library/scripts/research.py`）与 Origin MCP 原样保留，只加适配层。
- 一切写入仍走库内路径闸门；课题元数据（`project.json`）不许面板手改。
- 推送前 `node scripts/check-local-info.mjs` 必须 0 命中；文档里只写占位符。

**非目标（0.3 不做）**

- 多用户、云端同步、手机版。
- 替换 Python / Origin。
- 引入 React/Vue 等前端框架或构建链。
- 重写技能正文（只做路由与工具接线）。

## 3. 架构总览

```
┌──────────────────────────── 表现层 ────────────────────────────┐
│  面板工作台（Web）        预设 agent（聊天）        CLI / 脚本   │
│  lib/client/              DSH tool provider        sciwork call │
└───────────────┬──────────────────┬──────────────────┬──────────┘
                │                  │                  │
        ┌───────▼──────────────────▼──────────────────▼───────┐
        │              能力层：动作登记表 + 执行器              │
        │  lib/host/registry.js   lib/host/dispatch.js         │
        │  参数校验 · 守卫 · 确认令牌 · 回执 · 错误码归一        │
        └───────────────┬──────────────────┬──────────────────┘
                        │                  │
        ┌───────────────▼──────┐  ┌────────▼─────────────────┐
        │ 课题/工作流          │  │ 引擎适配层                 │
        │ projects.js          │  │ adapters/python.js        │
        │ workflows.js         │  │ adapters/origin.js        │
        └──────────┬───────────┘  └────────┬─────────────────┘
                   │                       │
        ┌──────────▼───────────────────────▼─────────────────┐
        │ 存储层：库根（projects/ refs/ journals/ submissions/ │
        │ .research/：索引、回执、迁移标记、备份清单）          │
        └─────────────────────────────────────────────────────┘
```

三条入口都只调 `dispatch(actionId, params, ctx)`，不各自拼命令、不各自读库。

## 4. 目录与文件映射

```
lib/
├─ index.js                 # 仍是插件入口（导出签名不变）：路由 + 服务装配
├─ client.js                # 仍是客户端入口（导出签名不变），改为薄转发 → lib/client/index.js
├─ host/
│  ├─ registry.js           # 动作表的加载、校验、查询、工具名映射
│  ├─ dispatch.js           # 执行：校验 → 守卫 → 适配器 → 回执
│  ├─ guards.js             # 路径闸门、effects 分级、确认令牌、幂等检查
│  ├─ errors.js             # 错误码（沿用 KNOWN_CODES，新增 3 个）
│  ├─ receipts.js           # 回执落盘与查询
│  ├─ projects.js           # 课题模型、阶段机、产物登记、双读
│  ├─ workflows.js          # workflow.next / plan / run
│  └─ migrate.js            # 旧库检测、备份、迁移、回滚
├─ adapters/
│  ├─ python.js             # research.py 契约 v1（参数构造 + JSON 解析 + 超时）
│  ├─ origin.js             # Origin MCP 适配（状态、绘图、导出、保存）
│  └─ jobs.js               # 长任务登记与轮询
├─ actions/
│  ├─ index.js              # 汇总导出 ACTION_LIST
│  ├─ project.js data.js figure.js refs.js draft.js journal.js
│  ├─ library.js workflow.js origin.js system.js
│  └─ legacy.js             # 旧 24 个动作名 → 新动作的别名表
└─ client/
   ├─ index.js              # 装配：路由、状态存储、挂载
   ├─ store.js              # 单一状态源（快照 + 路由 + 待确认计划）
   ├─ router.js
   ├─ tokens.js             # 设计令牌（颜色/间距/字号/圆角/动效），注入 style
   ├─ components/           # 按钮、卡片、表单、对话框、空状态、Toast、键位提示
   └─ views/                # today / project / library / refs / journals / settings
```

**保留不动的兼容点**：`lib/index.js` 与 `lib/client.js` 的导出名与签名；`package.json` 的
`main` / `exports`；`cordis.patch.yml` 里 `research-library` 与 preset 的 id。

## 5. 动作契约（核心对接方案）

### 5.1 描述符

```js
// lib/actions/project.js
export const createProject = {
  id: 'project.create',
  title: '新建课题',
  domain: 'project',
  description: '在库根创建 projects/<slug>，并写 project.json（schemaVersion=1）',
  params: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 120 },
      slug:  { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$' },
      course:{ type: 'string' },
    },
    additionalProperties: false,
  },
  result: { type: 'object' },
  effects: 'write',            // read | write | external
  engine: 'node',              // node | python | origin
  confirm: 'write',            // never | write | always
  idempotent: false,
  stage: ['topic'],            // 允许出现的阶段；省略=全阶段
  ui: { view: 'project', primary: true },
  tool: { expose: true, name: 'sciwork_project_create' },
  run: async (ctx, params) => ({ /* 返回值直接进回执 */ }),
};
```

参数校验只支持一个小子集：`type / required / properties / enum / default / min / max / minLength /
maxLength / pattern / items / additionalProperties`。**自己写 100 行校验器，不引入依赖**；
校验失败回 `schema` 错误，并带第一个出错字段的路径。

### 5.2 执行器

```js
dispatch(actionId, params, {
  source: 'panel' | 'agent' | 'cli' | 'cycle',
  planId,        // 写动作需要：先 action.plan 拿计划
  confirmToken,  // 写动作需要：确认令牌
  actor,         // 来源标识，写进回执
}) -> { ok: true, value, receipt } | { ok: false, error }
```

流程固定：**查表 → 校验参数 → 守卫 → （写动作）验令牌 → 执行 → 写回执 → 返回**。
任何一步失败都必须是 `{ok:false,error}`，不抛到信封层。

### 5.3 确认令牌（面板与 agent 共用的护栏）

写动作（`effects !== 'read'` 且 `confirm !== 'never'`）分两步：

1. `action.plan`：返回将要做的改动摘要 + `planId` + 一次性 `token`（默认 5 分钟过期，
   绑定 `actionId + 参数哈希 + 库根`）。
2. `dispatch` 带 `planId`/`confirmToken` 执行；令牌只能用一次，参数变了就失效。

- 面板：确认对话框展示 `plan.diff`，用户点「执行」才发第二步。
- agent：工具第一次调用只拿到计划；模型必须再调 `sciwork_action_confirm` 才能落盘。
- `confirm: 'always'` 的动作（真删、覆盖保存 Origin 工程）即使面板也要显式确认。
- 读动作、以及 `confirm:'never'` 的幂等写动作（如 `project.stage.set`）可以一步完成。

### 5.4 回执

```json
{ "receiptId": "r_20261021_1a2b3c", "action": "project.create", "source": "agent",
  "paramsHash": "sha256:…", "durationMs": 14,
  "wrote": ["projects/x/project.json"],
  "warnings": [], "startedAt": "2026-10-21T07:20:00Z" }
```

落盘：`.research/receipts/<YYYY-MM>.jsonl`；课题相关动作同时追加到 `project.json.history`
（只追加最近 200 条，超出裁剪）。面板的「最近操作」与 agent 的「我刚做了什么」读同一份。

### 5.5 错误码

沿用：`bad-request` · `not-found` · `denied` · `busy` · `timeout` · `network` · `internal` · `cli-failed`。
新增：

- `schema`：参数不合 schema（附 `details.field`）。
- `needs-confirmation`：写动作缺计划/令牌（附 `details.planRequired`）。
- `unsupported`：当前引擎/平台不支持该动作（如无 Origin）。

### 5.6 动作清单（0.3 首版）

| 域 | 动作 | 引擎 | effects |
|---|---|---|---|
| system | `system.info` `system.doctor` `system.backup` `system.restore` `system.migrate` `system.jobs` | node/python | read/write |
| project | `project.list` `project.get` `project.create` `project.update` `project.stage.set` `project.artifact.register` | node | read/write |
| workflow | `workflow.next` `workflow.plan` `workflow.run` | node | read/write |
| action | `action.plan` `action.confirm` `action.catalog` | node | read |
| data | `data.import` `data.inspect` `data.transform` `data.export` | node/python | write |
| figure | `figure.list` `figure.replot` `figure.export` `figure.attach` | node/origin | write |
| refs | `refs.import` `refs.search` `refs.check` `refs.remove` | python | read/write |
| draft | `draft.read` `draft.write` `draft.new` `draft.checks` `draft.package` | node/python | read/write |
| journal | `journal.list` `journal.get` `journal.check` | python | read |
| origin | `origin.status` `origin.plot` `origin.export` `origin.save` | origin | external |

旧 24 个动作名（`snapshot`、`readText`、`import`、`writeText`、`newDraft`、`archive`、`restore`、
`remove`、`removeRef`、`fetchRefMeta`、`runCli`、`tableTransform`、`replot`、`archiveInfo`、
`exportPackage`、`checkJournal`、`checkCitations`、`cliHint`、`cliCommands`、`transformOps`、
`tablePreview`、`importInfo`、`tableColumns`、`readBinary`）在 `lib/actions/legacy.js` 里做别名映射，
0.3 期间全部可用，标记 deprecated；0.4 再评估移除。

## 6. 课题模型与阶段机

### 6.1 `project.json`（schemaVersion = 1）

```jsonc
{
  "schemaVersion": 1,
  "id": "zt-ceremic",
  "title": "ZT 陶瓷样品",
  "course": "材料物理",
  "createdAt": "2026-10-21T07:00:00Z",
  "stage": "data",
  "stages": {
    "topic":      { "status": "done",    "updatedAt": "…", "checks": [] },
    "design":     { "status": "done",    "updatedAt": "…", "checks": [] },
    "data":       { "status": "active",  "updatedAt": "…", "checks": [] },
    "analysis":   { "status": "pending", "checks": [] },
    "figure":     { "status": "pending", "checks": [] },
    "draft":      { "status": "pending", "checks": [] },
    "submission": { "status": "pending", "checks": [] }
  },
  "artifacts": [
    { "id": "a_001", "kind": "data", "path": "data/raw.csv",
      "sha256": "…", "producedBy": "data.import", "createdAt": "…" }
  ],
  "history": [ { "at": "…", "action": "data.import", "receiptId": "…", "summary": "导入 raw.csv" } ]
}
```

- 阶段枚举固定为 `topic / design / data / analysis / figure / draft / submission`。
- `status` 取 `pending / active / done / skipped`；同一时刻只有一个 `active`。
- 产物 `path` 一律库根相对路径；登记时记录 `sha256`，文件变了能被检查出来。
- `project.json` 属于 `NEVER_EDIT`：只由动作写入。
- 旧库没有 `project.json` 时走**双读**（见 §11），不立刻写盘。

### 6.2 阶段机

```
topic → design → data → analysis → figure → draft → submission
```

- `project.stage.set` 只允许前进一步或退回一步；跳阶段要 `force:true` 且写 warning 进回执。
- 每个阶段有检查项（`checks`），由对应动作产出：如 `data` 阶段要求至少一个数据产物，
  `figure` 阶段要求图带尺寸/DPI 元数据，`draft` 阶段复用 `checkJournal` 的结论。
- `workflow.next` 返回：

```json
{ "stage": "data", "todo": [ { "action": "data.import", "why": "还没有数据产物" } ],
  "blockers": [], "ready": false }
```

面板首页与 agent 上下文都用这一个返回值，不再各自推断。

## 7. 引擎对接：Python 契约 v1

### 7.1 原则

`library/scripts/research.py` 仍是唯一实现。适配层只做三件事：**构造 argv、解析 stdout JSON、超时与错误归一**。
新能力先加 `research.py` 子命令，再到登记表里登记，不在 Node 里重写科研逻辑。

### 7.2 约定

- 调用：`<python> library/scripts/research.py <subcommand> [--root <库根>] [--json] …`
  （实际参数以脚本现状为准；适配层集中维护一张 `SUBCOMMAND` 映射表）。
- 解释器优先级：`SCIWORK_PYTHON` → 库内 `.research/config.json.interpreter` → `python3`/`python`。
- 库根优先级：环境变量 `SCIWORK_LIBRARY`（已有修复）→ 库内配置 → 随包 `library/config.json` → 默认。
- 输出：末尾 JSON 对象为结果；解析失败 → `cli-failed`，把 stderr 尾部 2KB 放进 `details.stderr`。
- 超时默认 60s；`figure.replot` / `origin.*` 给 300s，超时回 `timeout`，不杀 Origin 进程。
- 长任务：适配器立即返回 `{jobId}`，`system.jobs` 查询；登记在 `.research/jobs/<id>.json`。
- 版本握手：`system.doctor` 写 `.research/engine.json`（`{protocol:1, python, researchPyMtime}`），
  协议不匹配直接 `unsupported`，不尝试兼容。

### 7.3 兼容

现有 24 个动作里凡是走 `research.py` 的，一律改由 `adapters/python.js` 统一调用；
`lib/actions.js` 里零散的 `runCli` 拼装全部收进映射表，消灭第二套命令拼装。

## 8. 引擎对接：Origin MCP

- `adapters/origin.js` 把 `origin.*` 动作映射到现有 MCP 工具（状态、绘图、导出、保存）。
- **保存前必须先 `origin.list_pages` 核对工程名**；对不上就 `denied`，绝不覆盖。
- `origin.save` 属于 `confirm:'always'`；面板与 agent 都必须走 §5.3 的两步确认。
- 不劫持用户正在用的实例：沿用 `neverHijackRunningInstance` 配置。
- 无 Origin / MCP 不可用时，`origin.*` 回 `unsupported`，其余动作不受影响。

## 9. 表现层一：面板工作台

### 9.1 信息架构

| 路由 | 视图 | 内容 |
|---|---|---|
| `#/` | 今日 | 最近课题、待办（`workflow.next`）、最近回执 |
| `#/project/:id` | 课题工作台 | 阶段条 + 当前阶段产物 + 检查项 + 下一步动作 |
| `#/library` | 库 | 课题/数据/图/草稿树，支持搜索与导入 |
| `#/refs` | 文献 | 文献表、引用核查、元数据抓取 |
| `#/journals` | 期刊 | 12 份档案、单库体检入口 |
| `#/settings` | 设置 | 库根、Python、Origin、UI 版本开关 |

### 9.2 布局

- 三栏：左「课题与阶段」、中「当前工作区」、右「检查项 / 证据 / 可折叠对话」。
- 每屏一个主行动；次级操作收进 `⋯` 菜单。
- `Ctrl+K` 命令面板：搜动作（来自登记表的 title/domain/关键词）、跳转、执行读动作。
- 空状态给出「下一条可做的事」，不出现死胡同。
- 不显示绝对路径；只显示库内相对路径与课题名。

### 9.3 设计令牌（`lib/client/tokens.js`）

颜色（背景/表面/文字三级/主色/语义色）、间距（4/8/12/16/24/32）、字号（12–28 六档）、
圆角（6/10/16）、阴影（两级）、动效（≤120ms，`prefers-reduced-motion` 关闭）。
亮/暗两套，用 CSS 变量注入，组件只引用变量。

### 9.4 兼容

- 新 UI 通过设置项 `ui.version = 'v1' | 'v2'` 切换，默认 v1，v2 完成验收后翻转默认。
- `lib/client.js` 保留旧实现直到 v2 验收；v2 以 `lib/client/index.js` 挂载同一侧栏入口。
- 旧面板发出的旧动作名继续可用（别名表）。

## 10. 表现层二：Agent 预设与工具

### 10.1 预设

> **2026-10-21 定案调整（已实施，取代下面的原方案）**：不再拆阶段预设。只保留 `research` 一个模式；七阶段的纪律、
> 推荐工具与退出检查项收进技能 `skills/research-stages/SKILL.md`，开工或换阶段时按需加载。阶段由课题
> `project.json` 的 `stage` 字段 + `project.stage.set` 推进。
>
> 理由：① 换预设等于换执行环境，会话上下文与会话内技能加载都会重置，阶段切换成本高于收益；② 阶段本就是课题状态，
> 不是另一种执行环境；③ `agent-preset` 没有工具白名单字段，下表里的「工具权限」只能靠人格约束，拆预设换不来硬隔离。

<details>
<summary>原方案（已被上面的定案取代，保留作历史）</summary>

保留总控预设 `research`，新增 6 个阶段预设（同一个 `cordis.patch.yml`，id 前缀 `sci-`）：

| id | 用途 | 工具权限 |
|---|---|---|
| `sci-topic` | 选题与可行性 | 只读 + `project.create` |
| `sci-design` | 实验设计与变量 | 只读 + `project.update` |
| `sci-analysis` | 数据分析与解释 | 只读 + `data.*`、`project.artifact.register` |
| `sci-figure` | 绘图与版式 | 只读 + `figure.*`、`origin.*` |
| `sci-writing` | 写作与改稿 | 只读 + `draft.*` |
| `sci-submission` | 投稿检查与打包 | 只读 + `journal.check`、`draft.package` |

每个预设 = 系统提示（技能正文）+ 工具白名单 + 默认阶段；总控预设按 `project.stage` 路由到对应技能。

</details>

### 10.2 工具暴露

- `lib/index.js` 注册一个工具提供者，把 `tool.expose=true` 的动作映射为工具
  `sciwork_<domain>_<verb>`（名称在登记表里显式给出，不从 id 猜）。
- 读动作直接可调；写动作第一次只回计划，必须再调 `sciwork_action_confirm`。
- 工具结果统一为 `{ok, value|error, receipt}`，与面板完全一致。
- 具体注册 API 以当前宿主版本为准，实施时对照现有插件与 DSH 文档，**不凭记忆猜接口名**。

### 10.3 上下文注入

预设激活时注入一段有界的课题摘要（≤4 KB）：课题、阶段、最近 5 条回执、`workflow.next` 的 todo。
**不注入整库快照**；需要细节时由 agent 主动调读动作。

### 10.4 技能

现有 5 个技能保留。只改两处：
`research-studio` 增加「当前阶段 → 该用哪个预设/技能」的路由表；
`origin-plot` 的「保存前核对工程」写成硬步骤。技能正文不动其余部分。

## 11. 迁移、备份、回滚

### 11.1 备份（先做，任何迁移之前）

`system.backup`：

1. 目标 `<备份目录>/sciwork-lib-<YYYYMMDD-HHMM>.zip`；
2. 同时写 `manifest.json`：文件数、总字节、逐文件 `sha256`（大文件可只记前 1MB 哈希 + 大小）；
3. 备份完成后**在临时目录解压并核对**，核对通过才把清单标记为可用。

没有通过核对的备份，不允许进入迁移。

### 11.2 迁移

`system.migrate`：

- `--plan`（默认）：只读扫描，按课题输出「将生成哪些产物条目、缺哪些文件、预计写哪些文件」，不写盘。
- `--apply`：先备份（若尚无当日备份），再逐课题写 `project.json`；写 `.research/migration.json`
  记录 `{schemaVersion, appliedAt, backupPath, projects}`。
- 幂等：已有 `project.json` 且哈希未变 → 跳过；变了 → 报告冲突，不覆盖。
- 失败：单课题回滚该课题目录（用备份里的对应路径），整体状态写进回执。

### 11.3 双读

`projects.js` 的读取顺序：

1. 有 `project.json` → 直接用；
2. 没有 → 从目录结构**合成**一个只读视图（`legacy: true`），阶段按「有数据=analysis、有图=figure、
   有稿=draft」估算，并标记 `needsMigration`；
3. 旧视图允许读动作与 `figure.replot`，写动作回 `needs-migration`（引导先迁移）。

### 11.4 切换与回滚

- 迁移在**副本**上先跑一遍：复制库到临时目录 → `--apply` → 跑全部门禁与抽查 → 再把副本换回。
- 回滚：`system.restore` 支持从 zip 恢复到指定目录；先恢复到空目录核对，再替换。
- 迁移后保留旧 `backupPath` 至少一个周期；`migration.json` 不删。

## 12. 兼容策略

| 对象 | 0.3 行为 |
|---|---|
| 端点/信封 | 不变 |
| 旧动作名 | 别名表，全部可用，标记 deprecated |
| 旧面板 | 保留，默认启用；v2 验收后翻默认 |
| 旧库 | 双读，不迁移也能用（只读） |
| `project.json` | 新增；旧库没有则合成视图 |
| 错误码 | 8 个旧码不变，新增 3 个 |
| Python | 不要求升级；协议不匹配时才要求 |

## 13. 安全与写边界

继承现有规则（`resolveInside` / `ALLOW_PREFIX` / `EDITABLE_RE` / `NEVER_EDIT`），新增三条：

1. 写动作必须带计划与确认令牌（§5.3）。
2. `project.json`、`migration.json`、`engine.json` 加入 `NEVER_EDIT`。
3. 回执与迁移标记只追加，不原地改写；确需清理走 `system.*` 动作并留回执。

## 14. 测试与门禁

新增四个测试文件，全部无第三方依赖、可直接 `node` 跑：

| 文件 | 覆盖 |
|---|---|
| `scripts/test-registry.mjs` | 描述符合法、id 唯一、旧别名可解析、工具名唯一 |
| `scripts/test-dispatch.mjs` | 校验、守卫、令牌过期/复用、错误码、回执落盘 |
| `scripts/test-projects.mjs` | 阶段机推进/退回、产物哈希、双读合成、迁移幂等 |
| `scripts/test-contract.mjs` | Python 适配器映射表逐项 dry-run（有引擎就跑，没有就 skip） |

`scripts/cycle.mjs` 增加第 5 段「契约测试」；`scripts/selftest-client.mjs` 增加**一致性断言**：
登记表里每个带 `ui` 的动作，命令面板必须能搜到；每个 `view` 必须能渲染空状态。

## 15. 实施阶段与验收

### Phase 0：备份与基线（0.5 天）

- 备份现有库并验证可恢复；记录门禁基线（当前 9/9）。
- 建分支 `feat/v0.3-registry`。
- 验收：备份解压核对通过；`node scripts/cycle.mjs` 仍全绿。

### Phase 1：能力层骨架（3–4 天）

- `registry.js` / `dispatch.js` / `guards.js` / `errors.js` / `receipts.js`。
- 把现有 24 个动作登记进 `actions/*.js`，`legacy.js` 提供别名；旧面板不改一行也能跑。
- `test-registry` / `test-dispatch` 落地。
- 验收：旧面板全部动作回归通过；门禁全绿；无本机信息。

### Phase 2：课题模型与迁移（3–4 天）

- `projects.js`、`migrate.js`、`system.backup/restore/migrate`、双读。
- 在库副本上跑迁移 → 抽查 → 回滚演练。
- 验收：迁移幂等；副本迁移后门禁全绿；真库未动。

### Phase 3：工作台 UI（5–7 天）

- `lib/client/` 拆分、令牌、组件、六个视图、命令面板、对话侧栏。
- 特性开关默认关；新旧 UI 并排验证。
- 验收：v2 能完成「建课题 → 导数据 → 看产物 → 跑检查」；旧 UI 不回归。

### Phase 4：预设 agent 与工作流（3–4 天）

- 6 个预设 + 总控路由；工具暴露与两步确认；`workflow.next` 接进面板首页。
- 验收：一个阶段预设能独立完成一次写动作（含确认）；回执在面板可见。

### Phase 5：发布 0.3.0（2 天）

- 文档：`ARCHITECTURE.md` 重写「动作表」与「分层」两节；`INSTALL.md` 加首启向导；`RELEASE.md` 加迁移步骤；
  `README`/`README.en` 更新版本行（四处版本号必须一致）。
- `CHANGELOG.md` 写 `[0.3.0]`（Breaking：动作表与 `project.json`；Added；Changed；Migration）。
- 门禁：`node scripts/cycle.mjs` 全绿、`node scripts/check-local-info.mjs` 0 命中。
- 提交、tag `v0.3.0`、推送；CI 绿。

**每阶段结束的固定动作**：跑全部门禁 → 只在绿的情况下提交 → 推之前跑本机信息扫描。

## 16. 风险与对策

| 风险 | 对策 |
|---|---|
| Python 契约漂移 | 映射表 + 契约测试；协议握手失败就明确报错 |
| 迁移损坏库 | 先备份并解压核对；副本先迁移；单课题回滚 |
| 新旧 UI 双维护失血 | 特性开关 + 一致性测试；v2 验收后立即翻默认 |
| 动作表膨胀 | 每个动作必须有 `title/params/result`；没有 UI/agent 消费者的不进表 |
| 零构建 UI 写不动 | 先做令牌与 3 个核心组件；若两周仍失控，再单独评估构建链（不在 0.3 内） |
| 重构期功能冻结影响使用 | 旧面板全程可用；0.3 期间只修 bug 不加新功能 |

## 17. 新对话起手提示（可直接粘贴）

> 读 `docs/decisions-architecture.md` 与 `docs/PLAN-0.3.md`，按方案 A 实施科研模式 0.3 重构。
> 从 Phase 0 开始：先备份现有库并验证可恢复，记录门禁基线，建分支 `feat/v0.3-registry`。
> 规则：先备份后迁移；旧面板与旧动作名在 0.3 期间必须继续可用；任何写动作都要确认令牌；
> 每阶段结束跑 `node scripts/cycle.mjs` 与 `node scripts/check-local-info.mjs`，全绿再提交；
> 不改变科研库里的任何数据文件；不推送任何本机路径。
> 完成后按 §15 的验收逐条报告。

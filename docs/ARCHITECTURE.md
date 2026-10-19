# dsh-sciwork 架构

面向想给这个插件**写代码**或**改它**的人。读完你应该能回答：它由哪几块组成、数据往哪儿落、
哪些写动作被允许、为什么某些细节必须那样写。

- 包名 `dsh-sciwork`，版本 0.1.0，MIT，仓库 <https://github.com/58catmiao/dsh-sciwork>，作者 58catmiao。
- 安装：`dsh plugin --profile <profile> add dsh-sciwork`
- 安装与配置的动手步骤见 [INSTALL.md](./INSTALL.md)；本文件只讲结构、契约与取舍。

## 1. 它是什么

给 DSH 加一个**科研模式**：在 Origin 里把数据变成能投出去的图，以及一整套论文写作流程
（中译英、润色、看图写图注与 Results、结构与 Discussion、文献检索引用、回复审稿意见）。
两件事都围绕一个**实体科研库**工作，图和文献的可核查性都落在库里。

交付形态由三部分组成：

| 组成 | 内容 |
|---|---|
| agent preset | 「科研模式 · Research」，由 `cordis.patch.yml` 插入 profile 的 loader roster |
| 技能 | `skills/` 下 5 个：`research-studio`（总控与路由）、`origin-plot`、`paper-writing`、`literature-refs`、`journal-profile` |
| 「科研库」面板 | 宿主半边 `lib/*.js` + 客户端半边 `lib/client.js`，读写科研库 |

面板是**辅助视图**：它让用户自己看库、整理库、重画已有图；**新图一律由智能体走 Origin**（`origin-plot` 技能 + Origin MCP）。
面板自 2026-10-13 起不再自己出图，见 §11。

## 2. 仓库结构

```
dsh-sciwork/
├─ package.json           # dsh.bundle.patch → cordis.patch.yml；dsh.client.platform = "web"
├─ cordis.patch.yml       # 插入 preset「科研模式 · Research」+ 面板宿主插件行 research-library
├─ lib/                   # 宿主半边（纯 Node ESM，零第三方依赖） + 客户端半边
│  ├─ index.js            #   connection.fetch 精确路由：POST /api/research/call
│  ├─ actions.js          #   24 个动作的分发 + 命令台命令表 + 错误码归一
│  ├─ config.js           #   运行时路径解析（库根 / Python / Origin 插件目录），不写死本机路径
│  ├─ library.js          #   读库底座：路径闸门、快照、引用核查、草稿保存/新建
│  ├─ import.js           #   导入：落位（同名自动 -1）→ 需要时再跑 research.py 登记
│  ├─ archive.js          #   归档 / 恢复 / 真删
│  ├─ refmeta.js          #   CrossRef 抓元数据（只在用户点「抓取」时联网，不写文件）
│  ├─ replot.js           #   重画：起 Origin MCP server（stdio JSON-RPC）、锁、重画 + 自动登记
│  ├─ table.js            #   读表 parseTable(text)
│  ├─ transform.js        #   数据变换算子（面板内计算，不经 Origin）
│  └─ client.js           #   浏览器半边：侧栏图标 + 中央页面（含新手引导），手写、无构建
├─ skills/                # 5 个技能，install.mjs 装到技能根
├─ library/               # 科研库骨架模板 + config.json + py.cmd + research.py + 12 份期刊档案
├─ scripts/               # 安装器、补丁预检、桌面体检、三个自检
├─ docs/                  # 本文件与安装文档
└─ README.md
```

宿主半边 `lib/*.js` 是**零第三方依赖**的纯 Node ESM：只 import `node:fs` / `node:path` / `node:os` /
`node:child_process` / `node:url`，没有 `dependencies`。客户端 `lib/client.js` **手写**（等价于已构建产物），
**没有构建步骤**——改完刷新页面即可，不需要跑打包器。

## 3. 半边划分与生效时机

| 半边 | 文件 | 改完怎么生效 |
|---|---|---|
| 宿主 | `lib/*.js`、`package.json`、`cordis.patch.yml` | **必须重启 Harness** |
| 客户端 | `lib/client.js` | 刷新页面即可 |

宿主半边在 **Harness 启动时读进内存**，所以只刷新页面会变成「新按钮 + 旧宿主」：面板发了新动作名，
宿主只回一句 `未知动作：archive`。客户端的 `withHostHint()` 会把这句话补成「要重启 Harness」，别当没反应。

补丁同理：`cordis.patch.yml` 只在启动时被读，`broken` 状态也是激活那一刻写进记录的。
**重启并回读之前，只能报告「已写入」，不能说「已生效」。**

## 4. 面板接口契约

### 4.1 唯一端点

```
POST /api/research/call
```

端点在 `lib/index.js` 里由两个导出定义：`ENDPOINT = 'research/call'`、`ROUTE_PATH = '/api/' + ENDPOINT`。
客户端必须用同一个字符串。

### 4.2 Connection 信封

与 Connection 的 `rpcFetchHandler` 对齐（同一个包内的非导出函数，因此这里等价复刻）：

```jsonc
// 请求
{ "type": "client-request", "rpcId": "<id>", "method": "research/call", "payload": { "action": "...", "args": { } } }

// 成功
{ "type": "server-response", "rpcId": "<id>", "result": { "ok": true, "value": { } } }

// 失败
{ "type": "server-response", "rpcId": "<id>", "result": { "ok": false, "error": { "code": "...", "message": "...", "details": { } } } }
```

宿主的处理规则（`lib/index.js` 的 `envelopeResult()`）：

- body 不是 `client-request` → `gateway/bad-request`，消息 `invalid client-request message`；
- `body.method` 与端点不一致 → `gateway/bad-request`，消息 `method "<x>" does not match endpoint "research/call"`；
- `handleResearchCall` 自身抛错 → 包成 `internal` 错误信封，**不返回 500**（面板要看得见缺陷，而不是拿到一个 HTML 错误页）。

### 4.3 客户端怎么发

```js
ctx.get('connection').rpc.call('/api', 'research/call', { action, args })
```

`ClientConnectionRpc.call(channel, endpoint, payload, signal?)` 返回信封里的 `result` 原样，即
`{ok:true,value}` 或 `{ok:false,error}`。

### 4.4 错误码

面板认识并可分支处理的码（`lib/actions.js` 的 `KNOWN_CODES`）：

`bad-request` · `not-found` · `denied` · `busy` · `timeout` · `network` · `internal` · `cli-failed`

`describe(error)` 会把底层异常归一到这些码上（例如含 `ENOENT` 或「课题不存在」→ `not-found`；
含「锁 / lock / 正在重画」→ `busy`）。未知码不会让面板崩，只会显示原文。

## 5. 路径安全与写入边界

### 5.1 一切 path 都是库根相对路径

面板传的每一个 path 都按**库根相对路径**解释。`library.js:resolveInside()` 是最后一道闸门：
拒绝对路径、盘符、`..` 逃逸。任何绕不过它的路径都不可能被读到或写到库外。

### 5.2 可写目录与不可写文件

| 边界 | 取值 | 位置 |
|---|---|---|
| 面板可写目录白名单 | `projects/` · `refs/pdf/` · `submissions/` | `lib/archive.js:ALLOW_PREFIX` |
| 可就地编辑的正文 | `projects/<课题>/drafts/*.md\|.markdown\|.txt`（且必须已存在） | `lib/library.js:EDITABLE_RE` |
| 永远不可写 | `refs.json` · `project.json` · `config.json` · `_index.json` · `refs.bib` · `library.json` | `lib/library.js:NEVER_EDIT` |

**登记元数据永远不从面板改。** 要动文献登记只有一条合法路径：库脚本 `research.py remove-ref`
（脚本自己先备份 `refs.json`，再同步 `refs.bib`）；面板只负责把 key 传过去。
`refs.bib` 是派生物，手改没有意义。

### 5.3 导入

- **只复制，不移动**；同名**绝不覆盖**，自动 `a.csv` → `a-1.csv` → `a-2.csv`。
- 扩展名按目标白名单（`lib/import.js:ACCEPT`）：

  | 目标 | 允许的扩展名 |
  |---|---|
  | `data` | `.csv` `.tsv` `.txt` `.xlsx` `.xls` `.dat` `.json` `.jdx` `.dx` |
  | `figures` | `.png` `.jpg` `.jpeg` `.webp` `.svg` `.tif` `.tiff` `.pdf` `.eps` |
  | `drafts` | `.md` `.markdown` `.txt` |
  | `refs` | `.pdf` `.docx` `.doc` `.txt` `.md` `.ris` `.bib` `.enw` |
  | `project` / `submission` | 不接文件 |

- 大小上限：单文件 **32 MiB**，单批 **64 MiB**（`lib/import.js:LIMITS`）。
  更大的文件不走浏览器：弹层里填**本机绝对路径**，由宿主直接读盘（仍然只复制）。
- 文件名先过 `sanitizeName()`：取 basename、剥控制字符、替换 Windows 非法字符、去前导点、截到 120 字符。

### 5.4 子目录（可选）

只有 `data` / `figures` / `drafts` 三个目标支持（`lib/import.js:SUBDIR_TARGETS`）；
`refs` / `project` / `submission` 填了会**明确拒绝**并回 `bad-request`，**不静默忽略**。

规则：相对路径、最多 **3 层**（`MAX_SUBDIR_DEPTH = 3`）、不能写盘符、不能有 `.` / `..`、
每段 ≤60 字符、非法字符拒绝（`sanitizeSubdir()`）。落点再做一次 `path.relative(baseAbs, dirAbs)` 检查，
保证子目录怎么填都不越出这一类目录。

`importInfo` 会把 `subdirTargets` 与 `subdirMaxDepth` 一并返回，面板据此只在这三个目标上显示输入框。

> **一条设计教训（留作护栏）**：子目录归属**不能从路径倒推**。早期实现按目录名后缀判断导入目标，
> 于是子目录恰好叫 `refs/pdf` 时 `.csv` 会被误判成文献而拒收。现在由调用方按**导入目标**显式传
> `ACCEPT[target]`，不再猜。

### 5.5 读库是递归的

`lib/library.js` 的 `walkFiles()` 返回 `{abs, sub}`、`listSubdirs()` 列子目录，`MAX_SCAN_DEPTH = 4`；
`data/` `figures/` `drafts/` `tables/` 递归扫描，`opju/` 与 `origin/` 深 2 层；跳过以 `.` 开头的目录与文件。
`snapshot.projects[].folders` 给出每一类目录下的子文件夹（**含空文件夹**，面板显示成「（空）」而不是隐藏），
每个数据/图/草稿/表格条目带 `sub`（相对起点目录的 POSIX 子路径，根下直接放的是 `''`）。

### 5.6 改稿、归档、真删

- **改稿先备份**：`writeTextBackup()` 先 `copyFile` 出 `<文件名>.bak` 再写，回执里带 `beforeBytes`。
- **归档优先**：移到 `<库根>/.research/archive/<时间戳>/`，附 `manifest.json`；可整批或逐条 `restore`。
- **真删要输文件名**：一次一条，`confirm` 必须**逐字等于** `basename`；删前留 `<库根>/.research/_removed/<stamp>.json` 记录；
  **不进系统回收站**。
- 两者随后各跑一次 `reindex`；**索引重建失败不算动作失败**，回执里如实写进 `warnings`。
- **归档/真删只动磁盘文件，不动登记元数据**：删掉 PDF 后文献条目仍在 `refs.json` 里。面板在归档页把这件事写明，不假装删干净了。

### 5.7 快照与预览的上限

- `readText` 是**预览**通道：512 KB 上限并返回对象，数据表请走数据变换那条路（宿主自己读盘）。
- `readBinary` 上限 12 MiB（base64 走 JSON-RPC，别把宿主撑爆）；表预览上限 64 MiB。
- 数据 > 64 MiB 时明确报错，提示让智能体走 Origin 或分块，而不是静默截断。

## 6. 24 个宿主动作

`lib/actions.js` 的 `ACTIONS` 是权威清单，客户端与服务端必须逐项一致（自检会比对）。

**读**（不改库）

| 动作 | 作用 |
|---|---|
| `snapshot` | 库快照：课题、图、草稿、文献、数据、表格、投稿、期刊档案、归档批次 + `folders` / `sub` |
| `readText` | 文本预览（512 KB 上限） |
| `readBinary` | 二进制读盘（图片/PDF → base64，12 MiB 上限） |
| `tableColumns` | 一张数据表的列名 |
| `checkCitations` | 引用核查：缺失键 + 库里已知文献数（带「不证明内容支持」的说明） |
| `checkJournal` | 期刊合规体检：按档案逐条比对图件/字数/参考文献（见 §6.3） |
| `cliHint` | 一条给智能体的 `research.py` 命令模板（面板只展示，不执行） |
| `cliCommands` | 命令台的命令与参数元数据 |
| `transformOps` | 可用的数据变换算子与参数 |
| `tablePreview` | 表格预览（与 `parseTable` 同一套规则） |
| `importInfo` | 导入目标的扩展名白名单 + `subdirTargets` / `subdirMaxDepth` |

**写**（全部复用 `research.py` 或库内校验，面板不自己拼命令、不开第二条写入路径）

| 动作 | 作用 |
|---|---|
| `import` | 落位（同名 `-1`）→ 需要时跑 `add-ref` / `register-figure` / `new-project` / `add-submission` 登记 |
| `writeText` | 改草稿正文（写前 `.bak`） |
| `newDraft` | 新建草稿（只允许 `projects/<课题>/drafts/`） |
| `archive` | 归档到 `.research/archive/<时间戳>/` |
| `restore` | 整批或逐条恢复归档 |
| `remove` | 真删（`confirm` 逐字等于文件名，一次一条） |
| `removeRef` | 删文献登记 → `research.py remove-ref`（脚本自己备份 `refs.json` 并同步 `refs.bib`） |
| `fetchRefMeta` | 抓 CrossRef 元数据（**只在用户点「抓取」时才联网**，不写文件） |
| `runCli` | 命令台跑一条 `research.py` 子命令（危险命令需显式确认） |
| `tableTransform` | 数据变换（见 §6.1），产物落 `projects/<课题>/tables/` |
| `replot` | 重画一张已登记的图（见 §7） |
| `archiveInfo` | 归档批次与真删记录 |
| `exportPackage` | 打投稿包到 `submissions/packages/`（稿件 + 图 + 数据 + refs.bib + manifest，见 §6.3） |

### 6.1 数据变换

`lib/transform.js` 的 `TRANSFORM_OPS`，6 个算子：`normalize`（min–max / z-score / ÷最大值）、
`baseline`（减全局最小 / 两端线性基线）、`smooth`（滑动平均 / 滑动中值）、`peaks`（最小间距 + 最小相对峰高）、
`integrate`（梯形法，按连续段分开积，缺口不估算）、`linear`（`a*x+b`）。
**原始数据只读**：产物是新表，落在 `projects/<课题>/tables/`，参数与溯源记进
`<库根>/.research/transforms/<课题>/<名字>.json`。纯宿主计算，**不需要开 Origin**。

### 6.2 读表规则

`lib/table.js` 的 `parseTable(text)`：

- 首行含非数字单元格 → 当真表头；
- **没有表头**（真实仪器导出常这样，第一行就是数字）→ 按列序给通用列名 `#1` `#2` …，**首行算数据**；
- `NaN` / `NA` / `null` / `-` 与空单元格读成缺失（`null`），**不填充**。

面板的列下拉、`tablePreview`、`tableTransform` 与重画共用这一套规则。

### 6.3 投稿闸门（0.2）

`checkJournal` 与 `exportPackage` 都只是 `research.py` 对应子命令的薄包装；判定逻辑、媒体元数据解析、zip 组装全在 `library/scripts/research.py`（`check_journal()` / `cmd_export_package()`）。

**`checkJournal` 回执**

```json
{ "ok": true, "project": "zt-ceremic", "journal": "nature", "journalName": "Nature",
  "manuscript": "projects/zt-ceremic/drafts/main.md",
  "checks": [{ "id": "figure.fig1.width", "group": "图件", "status": "pass",
               "detail": "图宽 89.0 mm（单栏 89 mm）", "source": "https://...", "confidence": "high" }],
  "counts": { "pass": 8, "warn": 4, "fail": 0, "na": 3 },
  "summary": "15 项：8 通过 / 4 提醒 / 0 不合格 / 3 不适用",
  "disclaimer": "期刊档案是默认值…以刊方现行要求为准" }
```

- 每个条目必带 `id` / `group` / `status` / `detail`；`status ∈ pass|warn|fail|na`。
- **档案里没有的数值一律 `na`**（例如未给字号上下限时字号项记 `na`），绝不拿通用默认值冒充期刊要求；结论会带上 `source` / `confidence` 与一句「以刊方现行要求为准」。
- 有 `fail` 时 `research.py` 退出码 1；面板仍显示完整表格，不中断。
- 图件尺寸/像素密度直接读文件头（PNG `pHYs`、JPEG JFIF、TIFF 标签、SVG 宽高/单位），不靠扩展名猜；数据变换或 Origin 导出留下的图注、journal 字段取自侧车 JSON。

**`exportPackage` 回执与产物**

```json
{ "ok": true, "package": "submissions/packages/zt-ceremic-20261019-140436.zip",
  "files": 7, "bytes": 3513, "missing": [], "counts": { "pass": 8, "warn": 4, "fail": 0, "na": 3 } }
```

- zip 内固定四个目录：`manuscript/`、`figures/`、`data/`、`refs.bib`，另有根级 `manifest.json`（逐文件 `sha256` / `bytes`）与 `checklist.md`（期刊 checklist + 本次体检结论）。
- 稿件按 `.md` → `.docx` → `.tex` 优先级挑一份；图件从图的侧车与磁盘收集；数据只收 `data/` 下文件；**缺什么写进 `missing`，不伪造空文件**。
- 打包纯标准库（`zipfile`），输出目录固定在 `submissions/packages/`，同名追加时间戳，绝不覆盖已有包。

## 7. 锁文件与 Origin 串行化

- 重画前拿 `<库根>/.research/locks/origin.lock`（`wx` 创建）。同一时刻只允许一次重画；持锁信息写进锁文件。
- 锁**过期 15 分钟**后可接管（`LOCK_STALE_MS = 15 * 60 * 1000`）。锁在时重画返回 `busy` 并说明是谁在持锁。
- 重画走 venv 解释器 + `origin_mcp_server.py`（与 MCP 工具同一条链路，stdio JSON-RPC）。
- **绝不抢占、绝不重启用户已开着的 Origin 实例**：不 `taskkill`、不 `Stop-Process`；
  Origin 没开就由插件冷启动，用完交还控制权。
- 重画**只新增不覆盖**（`freeFigureId()` 查重），产物为 `figures/<图号>-replot-<时间戳>.png`；
  成功后自动 `register-figure`（`file` = 新图，旧图进 `files[]`）。**登记失败只进 `warnings`，不假装成功。**

## 8. 科研库工具链

`research.py`（随包模板在 `library/scripts/research.py`，安装后落在 `<库根>/.research/scripts/`）是**唯一的库写入口**：
纯标准库，16 个子命令。

| 子命令 | 作用 |
|---|---|
| `init` | 建/修复库骨架（幂等） |
| `status` | 库概况：课题数、文献数、已登记图数、期刊档案 |
| `new-project <slug> --title T --journal J` | 新建课题（建齐 data/figures/origin/drafts/notes/tables） |
| `list-projects` | 列课题（含每课题的图与稿） |
| `add-ref ...` | 文献入库（分配引用键 + 更新 `refs.bib`）；**无 DOI 且无 URL 会被拒，`exit 2`** |
| `list-refs [--project P] [--query Q]` | 列/搜文献 |
| `remove-ref (--key K \| --doi D)` | 删一条文献（删前备份 `refs.json`，并报出还在引用它的草稿） |
| `export-bib` | 重建 `refs.bib` |
| `add-submission ...` | 登记一次投稿（`--type` 是固定枚举） |
| `list-submissions` | 列/筛投稿记录 |
| `update-submission ...` | 更新投稿状态 / 记事件 / 改下一步 |
| `register-figure ...` | 登记一张图的溯源侧车 |
| `list-figures [--project P]` | 列已登记图 |
| `search <关键词> [--kind K]` | 跨课题检索（课题/图/稿/数据/文献/期刊/投稿） |
| `reindex` | 重建索引 |
| `check-citations --draft <路径> [--require-doi]` | **引用核查闸门** |

`research.py --help` 才是权威清单；参数名以它为准。

**引用闸门（硬约束）**：交稿前 `check-citations` 必须 `exit 0`。正文里出现未登记的引用键 → `exit 1` 并列出 `unknown`；
代码块与行内反引号里的 `[@key]` 被正确排除。脚本输出自带 `caveat` 字段——
**它只证明「引用键在库里、且该条带 DOI 或 URL」，不证明被引文献的内容真的支持那句话。**
转述时照实说。

**真源与所有权**：

- 文献真源是 `refs/refs.json`；`refs.bib` 是派生物，**不要手改**。
- 索引 `<库根>/.research/index/library.json` 由 `reindex` 重建；索引不是真源，真源是各条目自己的文件。
- 库文件由本插件接管：写入走 `research.py`，不手写库里的 JSON。

## 9. 自检与验证

三条自检都能**裸 node 复跑**，不需要装依赖：

```bash
node scripts/selftest-host.mjs      # 宿主数据层：路径闸门、快照、读文件
node scripts/selftest-actions.mjs   # 24 个动作 + 命令台 + 读表 + 写动作真跑（在临时库副本上）
node scripts/selftest-client.mjs    # 把 lib/client.js 当浏览器加载：真渲染 + 真点击
node scripts/selftest-actions.mjs --replot   # 可选：会真跑 Origin（默认跳过）
```

当前基线（2026-10-13 实测复跑）：

| 脚本 | 基线 |
|---|---|
| `scripts/selftest-host.mjs` | `exit 0` |
| `scripts/selftest-actions.mjs` | **141 通过 · 0 失败 · 1 跳过（夹具库；通过数随库内容浮动） · exit 0** |
| `scripts/selftest-client.mjs` | **172 通过 · 0 失败 · exit 0** |

要点：

- **两条基线都会随真库内容浮动。** 真库里没有对应样本时，相关断言打 `SKIP` 而不是假失败
  （3 条 `SKIP` = 没有草稿样本 / 没有存在的图文件样本 / 未传 `--replot`）。
  数字变了先看 `SKIP` 条数与原因，别当成回归。
- 写动作**真跑**，但只跑在 `os.tmpdir()` 的**库副本**上；硬闸门 `snapshot.root === 副本` 不过就 `exit 2`，
  一个字节都不写。样本先种进副本，所以真库被清空也能跑。
- 客户端自检**绝不点「重画」**（会真启动 Origin），写动作全部用假信封挡住；并含**反向断言**
  （数据页没有「出图」按钮、没有成组选择、头部没有「目标图对齐」；CSS 只出现官方 token）。
- 要验重画链路，用 `node lib/replot.js` 或 `selftest-actions.mjs --replot`，
  并如实报告「这次把用户的 Origin 冷启动起来了」。

> **为什么必须有渲染自检**：这套自检抓到过三个只看代码看不出来的真 bug——
> 组件漏了第二个形参导致所有按钮标签被静默丢掉；把带 hook 的组件当普通函数直接调用导致 hook 顺序违规；
> 核查结果块在折叠分支里而按钮在卡头，折叠时点了什么都看不见。
> 写 Web 面板必须有一个「真渲染 + 真点击」的自检。

## 10. 已知限制与上游瑕疵

- **heatmap 不支持**（Origin 插件 `plotm` 不可用），改用 `contour_fill`。
- **`.otpu` 样式保存通道不可用**（`save -i/-t/-it` 静默不落盘），课题组样式以 **JSON 样式快照**侧车代替。
- `origin_plot_plan` 的 `plan_id` 存在服务端内存里，**重启即失效**。
- 首次 `origin_status` 会自动启动 Origin，需要 **5~45 秒**；页面很多时 `list_pages` 约 31 秒、
  单次 `close` 可达 59 秒，逼近 90 秒看门狗 —— 页多时先 `origin_pages_gc` 的 `dry_run` 报告，不要擅自清理。
- Origin 插件自述 28 或 62 个工具，**实测 74** 个；以实测工具表（`skills/origin-plot/references/origin-tools.json`）为准。
- `origin_figure` 的 `detail` 文案可能写 `proof_level=verified`，而同一次返回的字段是 `"unverified"`
  （此时 `verify.passed=true`、`n_fail=0`）。口径：**以 `verify.passed` + `verify.checks` 为准**，
  `proof_level` 当「样式读回等级」看。
- 传 `data_source`（文件路径分支）时 `graph_name` 参数**未被采用**；一律用**返回的 `graph` 字段**。
- `origin_simulate` 的结果强制带 `simulated: true`，写进稿子时必须标注为模拟，不得当实验数据。
- 期刊档案是**默认值**，不是刊方现行要求的权威副本：用户现场要求 > 期刊档案 > 通用默认。
  每份档案带 `sources` / `verifiedAt` / `confidence`，`confidence` 为 low 的字段留 `null`，**不猜数字**。

## 11. 主要设计决策

| 决策 | 为什么 |
|---|---|
| 用**精确 Fetch 路由** `connection.fetch.register({ path:'/api/research/call', methods:['POST'], requestBody:'buffered', fetch })`，而不是 `intercept('/api', …)` | 共享 RPC 通道**只允许一个拦截器**，官方 `api-gateway` 已占用。抢注成功后官方端点（`settings/describe`、`credentials/describe`、`agentPresets/list` …）全部落进 `!interceptor.matches(endpoint)` 的 404 分支，桌面欢迎流程失败会触发原生恢复对话框并改写 profile。精确路由在 `createSharedFetchHandler` 里**优先于**拦截器匹配，因此在 `/api` 前缀之下与 api-gateway 完全共存，还自动继承 Host/Origin 信任栅栏、浏览器会话认证与请求体上限。 |
| 宿主半边注册失败时**吞掉异常只记 error 日志** | 面板是辅助视图，不许因为一个注册冲突把**同一份补丁里的 preset** 也拖成激活失败。 |
| 面板**不自己做鉴权** | 它走 Harness 自己的 `/api` 通道，继承宿主侧 Host/Origin 栅栏 + 浏览器会话 cookie；不自己注册 HTTP 路由。 |
| 客户端**手写、无构建步骤** | 免掉打包器与产物同步问题；`lib/client.js` 就是一段 `window.__ModuleLoader__.load({id, factory})`，与在用 bundle 同构。客户端模块 `id` 用**包名**。 |
| `factory` 只收 `require` | 平台 seed 表里才有 React，只能 `require('react')` / `require('react-dom')`；其他服务一律 `ctx.get(name)` 惰性取。 |
| 两个挂点**同名** | `sidebar.panellist` 注册 `{id, order, label}`，`main` 注册 `{name, key}` —— **侧栏 id 必须与 main key 同名**，否则点了图标出不来页面。 |
| 只用官方设计 token | 渲染只许用 `Theme.listTokens` 那 14 个 `--dsw-*` token；不写自定义色值。 |
| 面板**不出图**（2026-10-13 起） | 原「直接出图 / 成组出图 / 目标图对齐」三个入口整体移除，`ACTIONS` 从 25 减到 22，`lib/stylefig.js` 删除，`lib/replot.js` 只保留 `replotFigure()`。面板只负责看、整理与**重画已有图**；新图一律让智能体走 Origin（真 Origin、带 `verify` 与 `.json` 溯源）。读表规则与「变换」保留，图卡上的「重画」保留。 |
| 大文件走**本机绝对路径** | base64 走 JSON-RPC 有体积上限；让宿主直接读盘（只复制、不移动）比把几百 MB 塞进信封可靠。 |
| 登记索引**面板只读** | 索引与登记记录一旦能被就地编辑，引用可核查性就没了；所有元数据变更收敛到 `research.py` 一条路径。 |
| 三条硬约束 | 引用零编造可溯源（无 DOI/URL 不入库 + `check-citations` 闸门）、绝不抢占或强杀用户正在使用的 Origin、图 + 数据 + 参数可回溯（每张交付图有 `figures/<figN>.json` 侧车）。 |

## 12. 改这个仓库的注意事项

- **补丁条目只写 config**，不要再加 `name` / `insert`（会 duplicate loader entry id 导致启动失败）。
- **预设里每一行都要按「宿主会做 schema 校验」对待**：`cordis:group` 的子行不是黑盒，缺一个必填字段
  整条 preset 就变「（加载失败）」，而**顶层行校验查不出来**。改完必须跑补丁预检脚本。
- 新增插件行前，先拿 DSH 自带的**同构** profile / preset 逐字对照 config，再照抄，别凭印象写 config 键。
- 装技能时只动本包的 5 个技能目录，**不覆盖别人的技能目录**。
- 期刊档案与库数据**只追加与修正，不静默覆盖**；改动要写清「旧值 → 新值 + 依据」。
- 改 `lib/*.js`（宿主半边）**必须重启 Harness**；`lib/library.js`（递归扫描 / `folders` / `sub`）与
  `lib/import.js`（`args.subdir`）同样。改读库路径的代码时**先想清楚它在哪半边**。

## 附录 A · 库根与路径解析

`lib/config.js` 是唯一的路径解析层，**任何模块都不许再写死本机路径**。
解析优先级（越靠前越优先，全部可缺省）：

1. 显式传入的配置（库内 `<库根>/.research/config.json` / 随包的 `library/config.json`）
2. 环境变量：`SCIWORK_LIBRARY`（旧名 `RESEARCH_LIBRARY` 仍兼容）、`SCIWORK_PYTHON`、`SCIWORK_ORIGIN_PLUGIN`
3. 按 DSH 既有约定推断（`DSH_HOME`、`DSH_PROFILE`、`DSH_PROFILE_DIR`、`node_modules` 布局）
4. 兜底默认：`<用户目录>/Research`

所有 `resolve*` 函数**都不抛异常**，找不到返回 `null`，由调用方决定怎么退化
（面板是辅助视图，路径缺失必须变成一句人话，而不是一次崩溃）。

Python 解释器候选顺序（`pythonCandidates()`，与库内启动器 `py.cmd` 一致）：
显式 `interpreter` → `SCIWORK_PYTHON` → `<库根>/.venv` → `<库根>/.research/.venv` → Origin 插件目录的 `.venv` → `PATH`。

## 附录 B · 权威配置

`<库根>/.research/config.json` 是权威配置（`library/config.json` 只是安装模板）。字段：

| 字段 | 含义 |
|---|---|
| `schema` | 配置版本 |
| `libraryRoot` | 库根（安装器会在与本次库根不一致时就地校正） |
| `interpreter` | Python 解释器绝对路径 |
| `launcher` | 启动器路径（Windows 上是 `.research/bin/py.cmd`） |
| `origin.pluginDir` / `origin.server` | 上游 Origin 插件目录与 MCP server 脚本 |
| `origin.mcpServerName` / `origin.toolPrefix` | MCP 服务名与工具前缀（`mcp__origin__`） |
| `origin.neverHijackRunningInstance` | 恒为 `true`：绝不抢占用户正在用的 Origin |
| `defaults` | 默认期刊 / 图格式 / dpi / 语言 |
| `index` | 索引文件路径 |

## 附录 C · 面板挂点与新手引导

- 挂点：`slots.inject('sidebar.panellist', …)` 注册 `{name:'sidebar.panellist', id:'research-library', order:42, label:'科研库'}`；
  `slots.inject('main', …)` 注册 `{name:'main', key:'research-library'}`。
- 客户端模块：`exports.inject = ['slots']`，`exports.apply = apply`。
- 引导状态存 `localStorage`，键前缀 `research-panel-setup:`（`welcome` / `tour` / `step`），
  所以「看过一次就不再自动弹」；想重看随时点标题右边的**「引导」**。

## 附录 D · 期刊档案

随包 12 份（`nature` / `science` / `cell` / `ieee-trans` / `elsevier-generic` / `acs` / `plos-one` /
`mdpi` / `gbt-7714` / `chinese-core-journal` / `cnki-thesis` / `thesis-generic`）+ `_index.json` + `README.md`，
每份带 `sources` / `verifiedAt` / `confidence`。安装器**只补缺失的、绝不覆盖已有的**
（档案里可能有人工校对过的字段）。抓取当日的 confidence 分布以 `<库根>/journals/_index.json` 为准。

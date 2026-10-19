# dsh-sciwork · DSH 科研模式

> 给 [DSH](https://github.com/deepseek-ai)（DeepSeek Harness）装上一整套「做科研」的工作台：一个叫**科研模式**的 agent 预设，加上一个本机的实体科研库。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4B6BFB.svg)](https://github.com/58catmiao/dsh-sciwork)
[![zero dependency](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](https://github.com/58catmiao/dsh-sciwork)

版本 0.1.0 · MIT · 作者 [58catmiao](https://github.com/58catmiao) · 仓库 <https://github.com/58catmiao/dsh-sciwork>

**English:** [README.en.md](README.en.md)

---

## 这是什么

`dsh-sciwork` 不是一个"帮你查文献"的对话框，而是一套**落在你硬盘上、可被别的工具打开**的科研工作台。装上它，你会同时得到四样东西：

1. **一个 agent 预设「科研模式」**——它把绘图、写作、文献、期刊规范四条线收进同一个工作流：先找证据，再动手；出图走 Origin 真机，稿子里引用的每一条文献都必须带 DOI 或 URL。
2. **一个本机实体科研库**——一棵普通目录（课题 / 图表 / 数据 / 草稿 / 文献 / 期刊档案 / 投稿），配套一个 Python 引擎 `research.py` 和一个登记索引。
3. **12 份期刊投稿档案**——Nature、Science、Cell、IEEE Trans、ACS、Elsevier 通用、MDPI、PLOS ONE、中文核心、CNKI 学位论文、GB/T 7714、通用学位论文，各自的数值要求、条款与出处摘要。
4. **一个「科研库」可视面板 + 一组技能**——面板七个页签，只读为主、能筛能导入能归档；技能负责把"该怎么画、该怎么写、该怎么引"固化成纪律。

**权威来源永远是文件系统。** 索引只是缓存，面板的写入永远走库脚本，不直接改索引。所以科研库随时可以整目录打包带迁移，也可以直接用资源管理器、Git、别的编辑器去碰。

- 宿主半边是纯 Node ESM，**零 npm 依赖**。
- 客户端是手写的单文件 Web 客户端，**没有构建步骤**。
- 出图能力依赖上游开源插件 [dsh-origin-plugin](https://github.com/Fantasality/dsh-origin-plugin)（MIT，作者 Fantasality）。**本仓库不包含它**，只带适配技能。详见〈与 dsh-origin-plugin 的关系〉。

## 安装

```bash
dsh plugin --profile <profile> add dsh-sciwork
```

插件市场里点安装，走的也是同一条路径。装完**重启 Harness**。

装完后你会多出：

- 一个 ID 为 `research` 的 agent 预设「科研模式」（可直接在会话里选）；
- 侧栏多一个面板入口「科研库」；
- 一条精确注册的只读路由 `/api/research/call`（面板靠它取快照与执行动作）；
- 五个技能进入技能目录。

> 前置：本机有 Node（宿主半边与自检脚本用它）与一个可用的 Python 3 解释器（科研库引擎 `research.py` 用它）。**不要求 `python` 出现在 PATH 上**——启动器会按「显式配置 → `SCIWORK_PYTHON` → 库自己的 venv → Origin 插件目录的 venv → PATH」逐个探测。出图另需 Origin，见下文。

## 快速开始

### 1. 建库

```bash
# 先预检：不写任何文件，只报告缺什么
node scripts/install.mjs --verify-only

# 预检通过后建库
node scripts/install.mjs
```

安装脚本会建出库根目录、`.research/` 引擎与索引、`journals/` 期刊档案、`refs/` 文献库。库根默认是 `<用户目录>/Research`（Windows 即 `%USERPROFILE%\Research`），可用环境变量 `SCIWORK_LIBRARY` 改。

安装脚本的可用开关：

| 开关 | 说明 |
| --- | --- |
| `--verify-only` | 只检查，不写任何文件。 |
| `--library-root <dir>` | 指定库根，覆盖配置里的 `libraryRoot`。 |
| `--skip-library` | 不铺科研库骨架（只装插件半边）。 |
| `--force-skills` | 目标已存在且没有 `SKILL.md` 时也覆盖安装技能目录。 |

> 库根解析顺序：`--library-root` / 环境变量 `SCIWORK_LIBRARY`（旧名 `RESEARCH_LIBRARY` 兼容）→ 内核 `library/config.json` 的 `libraryRoot` → `<用户目录>/Research`。注意库内已有的 `.research/config.json` 里的 `libraryRoot` 也会覆盖环境变量——面板与引擎优先听库自己的配置。

### 2. 打开面板

在 DSH 侧栏点「科研库」。面板顶部一行写着当前库根路径与实时计数（课题 / 图 / 草稿 / 数据 / 文献 / 期刊档案 / 投稿 / 索引时间），下面是七个页签。

### 3. 让 agent 建课题

在会话里选「科研模式」预设，然后直接说：

> 建一个课题，叫 `zt-ceremic`，研究 ZrB₂-SiC 陶瓷的氧化行为。

agent 会走 `research.py new-project` 落目录，之后它画的每一张图、写的每一段结果，都会各自归位到该课题的 `figures/`、`origin/`、`data/`、`drafts/` 下。你也可以在面板里点「新建课题」自己建。

### 4. 出图

**面板自己不出图**（2026-10-13 起移除）。要出图，直接跟 agent 说：

> 把 `projects/zt-ceremic/data/` 里那组 XRD 数据画成对比图，按 MDPI 的排版要求。

agent 会走 Origin 真机绘图、核验、导出，并把图的溯源信息登记回库。

## 面板：七个页签各能做什么

侧栏「科研库」。页签七个（图表 / 草稿 / 文献 / 数据 / 期刊档案 / 投稿 / 归档），另有顶部的**计数行**与「命令台」弹层（两者都不是页签）：

| 页签 | 看什么 | 能做什么 |
| --- | --- | --- |
| **计数行**（面板顶部，不是页签） | 库根路径、课题/图/草稿/数据/文献/期刊档案/投稿七项实时计数、索引时间、采集警告 | 点「刷新」重取快照；点「引导」走一遍带高亮的界面导览 |
| **图表** | 已登记的图，含每条图的登记溯源（数据源、脚本、生成时间）；按课题分组 | 看图、看 PDF 附带件、复制路径、重画、归档、删除 |
| **草稿** | `drafts/` 下的 Markdown 手稿 | 就地读；新建草稿；编辑保存；归档；删除 |
| **文献** | `refs/refs.json` 里的条目与 `refs/pdf/` 下的本地 PDF 附件 | 导入（必须带 DOI 或 URL 才登记，PDF 可选）、看 PDF、归档、删除 |
| **数据** | `data/` 下的数据文件（`.txt/.csv/.dat` 等）与按课题分组的分组头 | 预览行列、**数据变换**（6 个算子）、归档、删除 |
| **期刊档案** | 12 份档案的 id、严格度（high / medium / low）与更新日期 | 读条款与数值要求；筛选；归档 |
| **投稿** | `submissions/` 下的投稿记录（目标刊、状态、时间线） | 读记录；筛选；归档；**投稿闸门**：选期刊 → 合规体检 → 导出投稿包 |
| **归档** | `.research/archive/<时间戳>/` 里的批次清单 + 真删记录 | 整批 / 单文件「恢复」搬回原位；真删记录只留名字 |
| **命令台**（弹层，不是页签） | `research.py` 的子命令清单与参数表单 | 选命令 → 填参 → 执行 → 看 stdout / stderr / JSON 结果 |

**数据变换的 6 个算子**：`normalize`（归一化）、`baseline`（扣基线）、`smooth`（平滑）、`peaks`（找峰）、`integrate`（积分）、`linear`（线性变换）。每次变换都会在新表旁落一份溯源记录（`.research/transforms/<课题>/<表名>.json`），并把产物写进课题的 `tables/`。

**投稿闸门（0.2 新增）**：在「投稿」页签选一个课题与期刊档案，点「体检」得到逐条结论——图宽是否够单/双栏、分辨率够不够、格式该不该矢量、图注有没有、标题与摘要字数、参考文献与 DOI 覆盖、草稿里的引用键是否都在库里。每条标 `pass` / `warn` / `fail` / `na`，并写明依据（`source`）与置信度；**档案没写的项一律 `na`，不拿默认值冒充期刊要求**。点「导出投稿包」把稿件、图、数据、`refs.bib` 收进一个 zip（含逐文件 sha256 的 manifest 与 checklist），路径落在 `submissions/packages/`。体检结果与期刊档案一样，最终以刊方现行要求为准。

**面板的边界，一句话说清**：能看、能筛、能导入、能归档、能删、能对表格做数据变换、能做投稿前体检和打包；**不出图**。所有写入都经库脚本落文件并登记，**面板自身不碰登记索引**。

## 配置

配置有两层，**库内 `<库根>/.research/config.json` 是权威**；环境变量用来告诉 DSH 去哪找库、用哪个 Python。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SCIWORK_LIBRARY` | `<用户目录>/Research` | 科研库根目录。改这里等于换库。 |
| `RESEARCH_LIBRARY` | 未设置 | 旧名，兼容保留；`SCIWORK_LIBRARY` 优先。 |
| `SCIWORK_PYTHON` | 依平台探测 | 跑 `research.py` 用的 Python 解释器。推荐显式指向 venv 里的 python。 |
| `SCIWORK_ORIGIN_PLUGIN` | 未设置 | `dsh-origin-plugin` 所在目录，供适配技能定位它。 |

库内权威配置：

| 路径 | 说明 |
| --- | --- |
| `<库根>/.research/config.json` | 权威配置：库根、语言、期刊档案严格度偏好、索引设置等。 |
| `<库根>/.research/index.json` | 登记索引（**只是缓存**，可由 `research.py reindex` 从文件系统重建）。 |
| `<库根>/.research/archive/` | 归档区。面板上的「归档」是移动到此处，可恢复。 |
| `<库根>/.research/lock` | 库写锁，防止并发写入互相踩。 |

## 目录结构

```text
<库根>/                          # 默认 <用户目录>/Research，可用 SCIWORK_LIBRARY 改
├── projects/
│   └── <课题>/
│       ├── figures/             # 成图（导出的 png / svg / pdf / tif）
│       ├── origin/              # Origin 工程文件（.opju），可在 Origin 里继续编辑
│       ├── data/                # 原始数据
│       ├── tables/              # 由数据变换派生的表
│       └── drafts/              # 该课题的手稿片段
├── refs/
│   ├── refs.json                # 文献条目（必须带 DOI 或 URL）
│   └── pdf/                     # 本地 PDF 附件（可选）
├── journals/                    # 期刊投稿档案
├── submissions/                  # 投稿记录与时间线
└── .research/                   # 引擎与元数据
    ├── research.py              # 库操作的唯一权威入口
    ├── config.json              # 权威配置
    ├── index.json               # 登记索引（缓存，可重建）
    ├── archive/                 # 归档区（可恢复）
    ├── transforms/<课题>/       # 数据变换的溯源记录
    └── lock                     # 写锁
```

**登记（加文献、登记出图溯源、重建索引）永远由 `research.py` 做**，面板不代劳。常用子命令：`new-project`、`add-ref`、`register-figure`、`add-submission`、`reindex`。

## 科研库的权威入口：`research.py`

库的一切结构化写入都由它完成（面板的「命令台」弹层就是它的可视化前端）。

**读**：

| 子命令 | 说明 |
| --- | --- |
| `status` | 库概况：课题数、文献数、已登记图数、期刊档案数。 |
| `search <关键词>` | 跨课题检索（课题 / 图 / 稿 / 数据 / 文献 / 期刊 / 投稿），可加 `--kind`、`--project`、`--limit`。 |
| `list-projects` / `list-figures` / `list-refs` / `list-submissions` | 分别列课题、已登记图、文献、投稿记录，各自支持筛选参数。 |
| `check-citations --draft <路径>` | **引用核查闸门**：非零退出即代表稿子里有缺失或未核实的引用。加 `--require-doi` 要求每条都必须有 DOI。 |
| `check-journal --project <slug> [--journal <id>]` | **期刊合规体检**：按期刊档案逐条比对图件尺寸/分辨率/格式、图注、标题与摘要字数、参考文献与 DOI、引用键；每条 `pass`/`warn`/`fail`/`na`，有 `fail` 时退出码 1。 |

**写**：

| 子命令 | 说明 |
| --- | --- |
| `init` | 建 / 修复库骨架（幂等）。 |
| `new-project <slug>` | 新建课题，可带 `--title`、`--journal`。 |
| `add-ref` | 文献入库。**必须带 DOI 或 URL**（引用零编造）；`--verified-by` 记录核实方式。 |
| `register-figure` | 登记一张图的溯源侧车：源数据、Origin 图页、所用期刊档案、图注。 |
| `add-submission` / `update-submission` | 登记一次投稿 / 推进投稿状态与事件时间线。 |
| `export-package --project <slug> [--journal <id>]` | **投稿包**：稿件 + 图 + 数据 + `refs.bib` 打 zip 到 `submissions/packages/`，附逐文件 sha256 的 `manifest.json` 与 `checklist.md`。 |
| `reindex` / `export-bib` | 重建库索引（递归子目录、收录正文）/ 重建 `refs.bib`。 |

**不可逆**：`remove-ref` 删掉一条文献登记（会先备份 `refs.json`）。

> Windows 上库内附了一个 Python 包装器 `.research/bin/py.cmd`，它会按库配置挑解释器；agent 文档里给的调用示例走的就是它。想自己指定解释器，用环境变量 `SCIWORK_PYTHON`。

### 期刊档案一览

| 档案 id | 是什么 | 严格度 |
| --- | --- | --- |
| `nature` | Nature 系列 | high |
| `science` | Science 系列 | medium |
| `cell` | Cell 系列 | medium |
| `ieee-trans` | IEEE Transactions | medium |
| `acs` | ACS 系列 | medium |
| `elsevier-generic` | Elsevier 通用 | medium |
| `mdpi` | MDPI 系列 | high |
| `plos-one` | PLOS ONE | high |
| `chinese-core-journal` | 中文核心期刊 | medium |
| `cnki-thesis` | CNKI 学位论文 | low |
| `gbt-7714` | GB/T 7714 参考文献格式规范 | low |
| `thesis-generic` | 通用学位论文 | medium |

严格度影响默认排版与校验口径；每份档案里还有具体数值与出处摘要。回看哪份档案、怎么用，见技能 `journal-profile`。

## 技能

| 技能 | 管什么 |
| --- | --- |
| `research-studio` | 总入口。路由表 + 三条硬纪律 + 开工前 30 秒例行检查 + 交付前自检清单 + 如实报告（能证明什么、不能证明什么）。 |
| `origin-plot` | Origin 绘图纪律。数据进 Origin、四条画图路径、改图前先看现状、**两个核验步骤都要做**、导出交付与登记、绝不抢占用户正在使用的 Origin 会话，以及一份实测坑清单。内含 74 个 `origin_*` MCP 工具的用法。 |
| `paper-writing` | 动笔前的证据纪律、图注、Results、Discussion 结构与框架、中→英与润色、回复审稿意见（Response Letter）、交稿前自检。 |
| `literature-refs` | 四条硬规则、入库、检索（先有证据再入库）、稿子里怎么引用、列出与导出、与写作技能配合、常见坑。 |
| `journal-profile` | 期刊档案怎么读、怎么用。档案字段、给绘图/写作供参数、选刊（用户问"投哪本"）、新建或更新档案、与库脚本配合、冲突与变更。 |

技能是纪律文本，不是代码：它们约束 agent 的行为，不额外引入依赖。

## 与 dsh-origin-plugin 的关系

- **出图能力来自 [dsh-origin-plugin](https://github.com/Fantasality/dsh-origin-plugin)**（MIT，作者 [Fantasality](https://github.com/Fantasality)），它提供 74 个 `origin_*` MCP 工具，负责与本机 Origin 通信。
- **本仓库不包含 dsh-origin-plugin**，也不复制它的代码；`dsh-sciwork` 只带一份**适配技能** `skills/origin-plot`，教 agent 按科研交付的要求去用那 74 个工具。
- `skills/origin-plot/references/origin-tools.json` 是**派生文件**：由 dsh-origin-plugin 的工具清单生成，用于离线查表（工具名 / 参数 / 用途）。
- 两者可以独立安装。不装 Origin 与 dsh-origin-plugin，`dsh-sciwork` 的建库、面板、写作、文献、期刊档案部分照常可用，只是「出图」这一步走不通。
- 环境变量 `SCIWORK_ORIGIN_PLUGIN` 用来告诉适配技能：dsh-origin-plugin 装在哪。

## 自检

仓库自带三个自检脚本与一个补丁预检，都不写你的正式库（写动作在隔离副本里跑，并有一道硬闸门）。前三个只要 Node；补丁预检是 Python 写的，需要一个非标准库的依赖 PyYAML：

```bash
node scripts/selftest-host.mjs      # 宿主半边：路由注册、路径守卫、快照形状
node scripts/selftest-actions.mjs   # 24 个动作：读/守卫检查 + 隔离副本里的写动作
node scripts/selftest-client.mjs    # 客户端：七个页签的渲染、弹层、按钮与请求形状
python -m pip install pyyaml        # 只给下一步用（CI 里有独立的 Install PyYAML 步骤）
python scripts/validate-patch.py    # cordis.patch.yml 预检：预设行数、persona、插入行
```

想一条命令跑完全部（14 天一轮的周期自检就是这么跑的），用 `node scripts/cycle.mjs`：它把上面五项按 CI 的顺序跑一遍，附一段只读的 git 状态，输出汇总表与退出码，并把完整报告落到 `out/cycle/<日期>/`（`out/` 已 gitignore）。

自检分两种跑法，**新克隆的仓库不配库也能跑**：

**A. 不指向任何科研库（CI / 刚克隆的机器）**

```bash
node scripts/selftest-host.mjs      # 全部通过，退出码 0
node scripts/selftest-actions.mjs   # 63 通过 · 0 失败 · 3 跳过
node scripts/selftest-client.mjs    # 21 通过 · 0 失败 · 其余内容类检查未运行
python scripts/validate-patch.py    # ✓ 补丁预检通过
```

此时所有**内容类**检查（依赖库里真有草稿 / 图 / 数据表的部分）自动记为 `SKIP` 或「未运行」，脚本会打印一行说明（`未运行：内容类检查需要一个可用的科研库（当前库根 …）`）并**以退出码 0 结束**——不配库不算失败。

**B. 指向一个真库（数字随库内容浮动，下面是夹具库实测）**

```bash
SCIWORK_LIBRARY=/path/to/Research node scripts/selftest-actions.mjs   # 141 通过 · 0 失败 · 1 跳过
SCIWORK_LIBRARY=/path/to/Research node scripts/selftest-client.mjs    # 172 通过 · 0 失败
```

- `selftest-host.mjs` —— 只统计通过/失败，退出码 0。唯一可能被记为「跳过」的是「图文件还在」这类依赖真实库里确实有图的检查（没有图时不判失败）。
- `selftest-client.mjs` —— 汇总行只有通过/失败两项；B 模式下实测 `172 通过 · 0 失败`，退出码 0。
- `validate-patch.py` —— 输出 `✓ 补丁预检通过`，退出码 0。它会报预设 `preset-research` 的顶层行数（19 条，递归后叶子 29 条，其中 2 条按 `!!js` 条件禁用）、嵌套组（planning / compaction / delegation）、persona 长度，以及确认插入的 `research-library` 行属于宿主插件而非 agent 预设。
- `selftest-actions.mjs` —— 写动作段要求**库根指向脚本自己新建的隔离副本**（用 `SCIWORK_LIBRARY` 指过去即可）。若它发现 snapshot 指向的不是那个副本，会打印 `FAIL 隔离闸门：snapshot 指向副本` 并以退出码 2 结束，同时**一个字节都不写**。这是设计行为，不是插件缺陷：写动作永远在副本里跑，绝不碰你的正式库。⚠️ 0.2.1 起 `SCIWORK_LIBRARY` **优先于**随包的 `library/config.json`（此前次序反了，导致本机把库指向真库时这道闸门永远拿真库当副本、写动作整节被跳过）。

## 文档地图

| 文件 | 内容 |
| --- | --- |
| [README.md](./README.md) / [README.en.md](./README.en.md) | 这是什么、装什么、怎么用 |
| [docs/INSTALL.md](./docs/INSTALL.md) | 安装与首次建库（含排错） |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 工程结构与契约：宿主动作、HTTP 端点、面板边界、路径解析、自检口径 |
| [docs/RELEASE.md](./docs/RELEASE.md) | 维护者手册：发版、上架插件市场、截图、干净机器验证 |
| [docs/CYCLE-14D.md](./docs/CYCLE-14D.md) | 维护者手册：14 天周期的 debug / 功能更新 / 同步 GitHub（`cycle.mjs`、护栏、候选功能池） |
| [CHANGELOG.md](./CHANGELOG.md) | 版本变更 |
| [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) | 第三方组件与致谢 |

## 许可证与致谢

**License: MIT**，版权归 58catmiao。许可证原文见 [LICENSE](./LICENSE)。

### Credits / 致谢

- **Origin 绘图能力**来自 [**dsh-origin-plugin**](https://github.com/Fantasality/dsh-origin-plugin)（MIT，作者 **Fantasality**）。本仓库不包含它；`skills/origin-plot/references/origin-tools.json` 派生自它的工具清单，用于离线查表。感谢作者把这套本机 Origin 自动化开源出来。
- **DSH（DeepSeek Harness）** 提供了插件机制、agent 预设与工具路由，本插件是其上的扩展。
- **期刊档案**是本项目自己整理的**数值、条款与出处摘要**，不是期刊官方文件。

### 关于内容版权

本仓库**不包含任何受版权保护的论文原文或期刊 PDF**。

- `journals/` 下的 12 份期刊档案，内容是投稿要求的**数值、条款与出处摘要**（例如字数上限、图表要求、参考文献格式），每条尽量标注出处；遇到具体条款请以期刊官网的最新作者指南为准。
- `refs/` 里登记的是**你自己的**文献元数据（标题、DOI、URL 等）与你自己放进 `refs/pdf/` 的附件，仓库不预置任何文献全文。
- 期刊档案是**辅助**，不构成法律或投稿建议；因以档案替代官方指南而产生的后果，由使用者自负。

---

<div align="center">

**dsh-sciwork** · 让科研的每一步都落在你自己的硬盘上

</div>

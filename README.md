# dsh-sciwork

> DSH（DeepSeek Harness）的科研模式：一个 agent 预设，一个放在硬盘上的科研库，一块面板，几份技能。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4B6BFB.svg)](https://github.com/58catmiao/dsh-sciwork)
[![zero dependency](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](https://github.com/58catmiao/dsh-sciwork)

版本 0.4.9 · MIT · 作者 [58catmiao](https://github.com/58catmiao) · 仓库 <https://github.com/58catmiao/dsh-sciwork>

**English:** [README.en.md](README.en.md)

---

## 它是什么

装好之后你会多出一个叫「科研模式」的 agent 预设。它把绘图、写作、文献、期刊规范放在同一条工作流里：先找证据再动手，出图走 Origin 真机，稿子里引用的每条文献都要有 DOI 或 URL。

预设底下是一个真实的科研库，就是一棵普通目录：课题、图表、数据、草稿、文献、期刊档案、投稿。配套一个 Python 引擎 `research.py` 和一份登记索引。文件系统是权威，索引只是缓存；索引坏了可以重建，库也可以整目录打包带走，或者直接用资源管理器、Git、别的编辑器打开。

另外还有 12 份期刊投稿档案（Nature、Science、Cell、IEEE Trans、ACS、Elsevier、MDPI、PLOS ONE、中文核心、CNKI 学位论文、GB/T 7714、通用学位论文），每个都记了数值要求和条款出处；一块「科研库」面板；以及六份技能，把画图、写作、引用这些事写成纪律。

宿主半边是纯 Node ESM，零 npm 依赖。客户端是单文件 Web 客户端，没有构建步骤。出图依赖上游的 [dsh-origin-plugin](https://github.com/Fantasality/dsh-origin-plugin)（MIT，作者 Fantasality），本仓库不包含它，只带适配技能。

## 安装

三条通道装的是同一个东西，按你手边的界面选一条。

| 通道 | 怎么装 | 说明 |
| --- | --- | --- |
| 官方插件页（侧栏「插件」→ 添加插件） | 填 `@58catmiao/dsh-sciwork` | 从 npm 装；也可以填 ZIP 解压后的绝对路径；装完点「立即启用」 |
| 终端 | `dsh plugin --profile <profile> add @58catmiao/dsh-sciwork` | 参数会转给 profile 里的 pnpm |
| 插件市场（「插件 → 发现」） | 先加索引 URL，再从「发现」页装 | 市场只读你给的索引，索引钉在 GitHub commit 上 |

### 官方插件页

侧栏「插件」→ 添加插件，输入框填：

```
@58catmiao/dsh-sciwork
```

装完点「立即启用」，然后重启 Harness，面板才会出现。

### 终端

```bash
dsh plugin --profile <profile> add @58catmiao/dsh-sciwork
```

包已发布到 npm。想直接跟仓库最新 `main`，把上面两处的包名换成 `github:58catmiao/dsh-sciwork`。装完同样要重启 Harness。

### 插件市场

「插件 → 发现」不抓 GitHub，只读你手动填进去的索引 URL。本仓库自带一份索引，钉在发布 commit 上：

```
https://raw.githubusercontent.com/58catmiao/dsh-sciwork/main/market/plugins.json
```

这个市场由可选组合包 `@deepseek-ai/dsh-experimental-plugin-market-bundle` 提供。本机没装的话「发现」页不会出现，走插件页或终端也一样。

第三方市场 `dshmarket` 用的是它自己的目录，读不到这份索引。想在里面装，得等它收录。

索引在每次发版后由 `node scripts/make-market-index.mjs --commit v<版本>` 重写，所以从市场装到的版本是确定的。`node scripts/test-install.mjs` 会核对索引的 format 和 commit。

### 没有 pnpm，或者命令报找不到包

`dsh plugin` 最终还是让 pnpm 干活。机器上没带 pnpm 的话，可以不依赖任何包管理器，走这两条退路。

**退路 A：解压 ZIP 再接线**

1. 在 GitHub 上点 `Code → Download ZIP`，解压到一个固定目录，比如 `D:/apps/dsh-sciwork`。
2. 在该目录里跑：

```bash
node scripts/install-plugin.mjs --profile <profile> --source .
```

它会往 profile 的 `package.json` 里加一条 `link:` 依赖，把 `<profile>/node_modules/@58catmiao/dsh-sciwork` 链接过去，再把 `@58catmiao/dsh-sciwork` 加进 `dsh.profile.bundles`。改之前会备份一份 `package.json.bak-<时间戳>`。加 `--dry-run` 可以先看它会改什么。

插件页的「添加插件」也可以直接填这个解压目录的绝对路径，效果一样。

**退路 B：有 git，有 Node，没有包管理器**

```bash
git clone https://github.com/58catmiao/dsh-sciwork.git
cd dsh-sciwork
node scripts/install-plugin.mjs --profile <profile> --source .
```

装完重启 Harness，用 `dsh --profile <profile> --dump-config | grep -c dsh-sciwork` 确认（结果应大于 0）。

### 装完没反应

| 现象 | 先查什么 |
| --- | --- |
| 命令回 404 或找不到包 | 安装源写了吗，现在写 `@58catmiao/dsh-sciwork`；0.4.8 之前只有 git 源，要写 `github:58catmiao/dsh-sciwork` |
| 报 npm / pnpm 找不到 | 走退路 A，不需要包管理器 |
| 重启后面板还是旧的 | 面板是客户端 bundle，要关掉 Harness 再打开，刷新页面不算 |
| 点「检查更新」说不是 git 工作树 | 这份安装是拷贝或链接到 ZIP 目录的，不是 git 仓库；更新要重新解压再跑一遍 `install-plugin.mjs` |
| 侧栏没有「科研库」 | `dsh --profile <profile> --dump-config` 里找 `name: '@58catmiao/dsh-sciwork'`，没有就是 bundle 没进 `dsh.profile.bundles` |
| 市场「发现」页搜不到 | 索引 URL 加了吗，市场组合包装了吗 |
| 技能没出现 | 0.3.13 起技能随包注册；`~/.dsh/skills/<名字>/SKILL.md` 已存在时插件会跳过，删掉旧目录重启即可 |

装好之后会有这些东西：

- 一个 ID 为 `research` 的 agent 预设「科研模式」。课题的七个阶段（选题 → 设计 → 数据 → 分析 → 成图 → 写作 → 投稿）都在这一个模式里推进，阶段只是 `project.json` 里的字段。
- 侧栏面板「科研库」，默认进工作台，页头显示插件版本，可以点「检查更新」。
- 一条只读路由 `/api/research/call`，面板靠它取快照、执行动作。
- 六个技能：`research-studio`、`research-stages`、`origin-plot`、`paper-writing`、`literature-refs`、`journal-profile`。插件激活时注册，不用再手动跑 `scripts/install.mjs`；`~/.dsh/skills` 里已有的同名技能会跳过，不覆盖。

前置条件：本机要有 Node，以及一个能用的 Python 3（`research.py` 用它）。不要求 `python` 在 PATH 上，启动器会按「显式配置 → `SCIWORK_PYTHON` → 库自己的 venv → Origin 插件目录的 venv → PATH」的顺序找。出图另需 Origin。

## 快速开始

### 建库

```bash
# 先预检，不写任何文件
node scripts/install.mjs --verify-only

# 预检通过后再建
node scripts/install.mjs
```

安装脚本会建出库根、`.research/` 引擎与索引、`journals/` 期刊档案、`refs/` 文献库。库根默认是 `<用户目录>/Research`（Windows 上是 `%USERPROFILE%\Research`），用环境变量 `SCIWORK_LIBRARY` 可以改。

可用开关：

| 开关 | 说明 |
| --- | --- |
| `--verify-only` | 只检查，不写文件 |
| `--library-root <dir>` | 指定库根，覆盖配置里的 `libraryRoot` |
| `--skip-library` | 不铺科研库骨架，只装插件半边 |
| `--force-skills` | 目标已存在且没有 `SKILL.md` 时也覆盖技能目录 |

库根解析顺序：`--library-root` 或 `SCIWORK_LIBRARY`（旧名 `RESEARCH_LIBRARY` 兼容）→ `library/config.json` 的 `libraryRoot` → `<用户目录>/Research`。库内 `.research/config.json` 里的 `libraryRoot` 会覆盖环境变量，面板和引擎优先听库自己的配置。

### 打开面板

在 DSH 侧栏点「科研库」。默认进工作台，页头右上角显示当前库根和实时计数，下面是待办和概览。点右上角按钮可以切到列表面板的七个页签。

### 让 agent 建课题

在会话里选「科研模式」，然后直接说：

> 建一个课题，叫 `zt-ceremic`，研究 ZrB₂-SiC 陶瓷的氧化行为。

agent 会走 `research.py new-project` 落目录。之后画的图、写的结果分别进这个课题的 `figures/`、`origin/`、`data/`、`drafts/`。也可以在面板里点「新建课题」自己建。

### 出图

面板不出图。要出图就直接跟 agent 说：

> 把 `projects/zt-ceremic/data/` 里那组 XRD 数据画成对比图，按 MDPI 的排版要求。

agent 会走 Origin 真机绘图、核验、导出，再把溯源信息登记回库。

## 面板

侧栏「科研库」。默认是工作台，页头右上角可以切到列表面板。列表面板有八个页签：图表、草稿、笔记、文献、数据、期刊档案、投稿、归档。顶部还有一行计数，和一个「命令台」弹层。

工作台一屏看全库：页头一行计数（课题 / 图 / 文献 / 在投 / 就绪），一张跨课题待办表（投稿截止日也排在里面，按到期日靠前），下面分两栏，左边课题列表、右边课题详情。详情里有阶段条、本课题产物速览、待办与阻塞、近期变动。页脚是最近回执、上次备份和插件版本。首屏只读本地 `package.json`，点「检查更新」才去 GitHub 比对，有新版本时给「更新到 vX.Y.Z」，更新走 `git pull --ff-only`，只对干净的 git 工作树生效。

| 页签 | 看什么 | 能做什么 |
| --- | --- | --- |
| 计数行（不是页签） | 库根路径、课题/图/草稿/数据/文献/期刊档案/投稿计数、索引时间、采集警告 | 点「刷新」重取快照，点「引导」走一遍界面导览 |
| 图表 | 已登记的图，含数据源、脚本、生成时间，按课题分组 | 看图、看 PDF 附带件、复制路径、归档、删除 |
| 草稿 | `drafts/` 下的 Markdown | 读、新建、编辑保存、归档、删除 |
| 文献 | `refs/refs.json` 的条目和 `refs/pdf/` 下的本地 PDF | 导入（必须带 DOI 或 URL）、看 PDF、归档、删除 |
| 数据 | `data/` 下的数据文件，按课题分组 | 预览行列、数据变换、重命名、归档、删除 |
| 笔记 | `projects/<课题>/notes/*.md` 实验日志 | 读全文、新建、保存（覆盖前留 `.bak`）、删除（移进 `notes/.trash/`） |
| 期刊档案 | 12 份档案的 id、严格度和更新日期 | 读条款与数值要求、筛选、归档 |
| 投稿 | `submissions/` 下的投稿记录（目标刊、状态、时间线） | 读记录、筛选、归档、投稿闸门 |
| 归档 | `.research/archive/<时间戳>/` 里的批次和真删记录 | 恢复搬回原位；真删记录只留名字 |
| 命令台（弹层） | `research.py` 的子命令和参数表单 | 选命令、填参、执行、看 stdout / stderr / JSON |

数据变换有 6 个算子：`normalize`、`baseline`、`smooth`、`peaks`、`integrate`、`linear`。每次变换会在新表旁边落一份溯源记录（`.research/transforms/<课题>/<表名>.json`），产物写进课题的 `tables/`。

投稿闸门在「投稿」页签里。选一个课题和期刊档案，点「体检」，会逐条检查图宽够不够单栏或双栏、分辨率、格式是否该用矢量、图注、标题和摘要字数、参考文献与 DOI 覆盖、草稿里的引用键是否都在库里。每条标 `pass` / `warn` / `fail` / `na`，并写明依据。档案里没写的项一律 `na`，不拿默认值冒充期刊要求。点「导出投稿包」可以把稿件、图、数据、`refs.bib` 收进一个 zip，里面带逐文件 sha256 的 manifest 和 checklist，落在 `submissions/packages/`。体检结果最终还是要以刊方现行要求为准。

面板能看、能筛、能导入、能归档、能删、能对表格做变换、能做投稿前体检和打包。它不出图。所有写入都经库脚本落文件并登记，面板不直接改索引。

## 配置

配置分两层。库内 `<库根>/.research/config.json` 是权威，环境变量负责告诉 DSH 去哪找库、用哪个 Python。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SCIWORK_LIBRARY` | `<用户目录>/Research` | 科研库根目录，改这里等于换库 |
| `RESEARCH_LIBRARY` | 未设置 | 旧名，兼容保留，`SCIWORK_LIBRARY` 优先 |
| `SCIWORK_PYTHON` | 依平台探测 | 跑 `research.py` 的 Python 解释器，推荐显式指向 venv |
| `SCIWORK_ORIGIN_PLUGIN` | 未设置 | `dsh-origin-plugin` 所在目录，给适配技能用 |

库内文件：

| 路径 | 说明 |
| --- | --- |
| `<库根>/.research/config.json` | 权威配置：库根、语言、期刊档案严格度偏好、索引设置 |
| `<库根>/.research/index.json` | 登记索引，只是缓存，可以用 `reindex` 重建 |
| `<库根>/.research/archive/` | 归档区，面板上的「归档」就是移到这里，可恢复 |
| `<库根>/.research/lock` | 写锁，防止并发写入互相踩 |

## 目录结构

```text
<库根>/                          # 默认 <用户目录>/Research
├── projects/
│   └── <课题>/
│       ├── figures/             # 成图（png / svg / pdf / tif）
│       ├── origin/              # Origin 工程（.opju）
│       ├── data/                # 原始数据
│       ├── tables/              # 数据变换派生的表
│       └── drafts/              # 该课题的手稿片段
├── refs/
│   ├── refs.json                # 文献条目（必须带 DOI 或 URL）
│   └── pdf/                     # 本地 PDF 附件
├── journals/                    # 期刊投稿档案
├── submissions/                 # 投稿记录与时间线
└── .research/                   # 引擎与元数据
    ├── research.py              # 库操作的唯一入口
    ├── config.json              # 权威配置
    ├── index.json               # 登记索引（缓存，可重建）
    ├── archive/                 # 归档区
    ├── transforms/<课题>/       # 数据变换溯源
    └── lock                     # 写锁
```

加文献、登记出图溯源、重建索引这些事，都交给 `research.py` 做，面板不代劳。常用子命令：`new-project`、`add-ref`、`register-figure`、`add-submission`、`reindex`。

## research.py

库的结构化写入都由它完成，面板里的「命令台」就是它的可视化前端。

读：

| 子命令 | 说明 |
| --- | --- |
| `status` | 库概况：课题数、文献数、已登记图数、期刊档案数 |
| `search <关键词>` | 跨课题检索，可加 `--kind`、`--project`、`--limit` |
| `list-projects` / `list-figures` / `list-refs` / `list-submissions` | 分别列课题、图、文献、投稿 |
| `check-citations --draft <路径>` | 引用核查闸门，非零退出即代表稿子里有缺失或未核实的引用；加 `--require-doi` 要求每条都有 DOI |
| `check-journal --project <slug> [--journal <id>]` | 期刊合规体检，按档案逐条比对，有 `fail` 时退出码 1 |

写：

| 子命令 | 说明 |
| --- | --- |
| `init` | 建或修复库骨架（幂等） |
| `new-project <slug>` | 新建课题，可带 `--title`、`--journal` |
| `add-ref` | 文献入库，必须带 DOI 或 URL；`--verified-by` 记录核实方式 |
| `register-figure` | 登记图的溯源侧车：源数据、Origin 图页、所用期刊档案、图注 |
| `add-submission` / `update-submission` | 登记投稿、推进状态与事件时间线 |
| `export-package --project <slug> [--journal <id>]` | 投稿包：稿件 + 图 + 数据 + `refs.bib` 打 zip，附 manifest 与 checklist |
| `reindex` / `export-bib` | 重建库索引 / 重建 `refs.bib` |

`remove-ref` 会删掉一条文献登记，删之前先备份 `refs.json`。

Windows 上库内附了 Python 包装器 `.research/bin/py.cmd`，会按库配置挑解释器。想自己指定，用 `SCIWORK_PYTHON`。

### 期刊档案

| id | 是什么 | 严格度 |
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

严格度影响默认排版和校验口径，每份档案里还有具体数值与出处摘要。怎么读、怎么用，见技能 `journal-profile`。

## 技能

| 技能 | 管什么 |
| --- | --- |
| `research-studio` | 总入口：路由表、三条硬纪律、开工前 30 秒例行检查、交付前自检清单 |
| `research-stages` | 七个阶段各自该做什么、交付什么、什么时候可以进下一阶段 |
| `origin-plot` | Origin 绘图纪律：数据进 Origin、四条画图路径、改图前先看现状、两个核验步骤、导出与登记、不抢占用户的 Origin 会话，附 74 个 `origin_*` 工具的用法 |
| `paper-writing` | 动笔前的证据纪律、图注、Results、Discussion、中译英与润色、回复审稿意见、交稿前自检 |
| `literature-refs` | 四条硬规则、入库、检索、引用、列出与导出 |
| `journal-profile` | 期刊档案的字段、怎么给绘图和写作供参数、怎么选刊、怎么新建或更新档案 |

技能是纪律文本，不是代码。它们约束 agent 的行为，不引入依赖。

## 与 dsh-origin-plugin 的关系

出图能力来自 [dsh-origin-plugin](https://github.com/Fantasality/dsh-origin-plugin)（MIT，作者 Fantasality），它提供 74 个 `origin_*` MCP 工具，负责和本机 Origin 通信。

本仓库不包含 dsh-origin-plugin，也不复制它的代码。`dsh-sciwork` 只带一份适配技能 `skills/origin-plot`，教 agent 按科研交付的要求用那 74 个工具。`skills/origin-plot/references/origin-tools.json` 是从它的工具清单生成的派生文件，用于离线查表。

两者可以独立安装。不装 Origin 和 dsh-origin-plugin，建库、面板、写作、文献、期刊档案照常可用，只是出图走不通。环境变量 `SCIWORK_ORIGIN_PLUGIN` 用来告诉适配技能它装在哪。

## 自检

仓库里有五个自检脚本和一个补丁预检。它们都不写你的正式库，写动作在隔离副本里跑。前五个只要 Node，补丁预检需要 PyYAML。

```bash
node scripts/selftest-host.mjs      # 宿主半边：路由注册、路径守卫、快照形状
node scripts/selftest-actions.mjs   # 47 个动作：读/守卫检查 + 隔离副本里的写动作
node scripts/selftest-client.mjs    # 客户端：八个页签的渲染、弹层、按钮、请求形状
node scripts/selftest-live.mjs      # 真联调：真面板 × 真端点 × 真动作层 × 真写盘（临时库）
node scripts/test-install.mjs       # 安装面：随包技能、库脚本种子、包清单、apply 接线
python -m pip install pyyaml
python scripts/validate-patch.py    # cordis.patch.yml 预检
```

想一条命令跑完全部，用 `node scripts/cycle.mjs`。0.4.5 起一共 22 项，按 CI 的顺序跑，附一段只读的 git 状态，输出汇总表和退出码，完整报告落在 `out/cycle/<日期>/`（`out/` 已 gitignore）。

推送到公开仓库前还有一条门禁：`node scripts/check-local-info.mjs`（`cycle.mjs` 也会跑）。它拿本机的家目录、用户名、主机名、临时目录、库根等标记，去扫所有跟踪文件和还没推出去的提交信息。命中就说明仓库里带了本机信息，换成 `<仓库根>`、`<库根>`、`<系统临时目录>` 之类的占位符再提交。

不指向科研库也能跑（CI 或刚克隆的机器）：

```bash
node scripts/selftest-host.mjs      # 全部通过，退出码 0
node scripts/selftest-actions.mjs   # 全部通过，内容类检查自动跳过
node scripts/selftest-client.mjs    # 全部通过，内容类检查自动跳过
python scripts/validate-patch.py    # 补丁预检通过
```

依赖真库的内容类检查会记为跳过，并以退出码 0 结束，不配库不算失败。

指向真库时（数字随库内容浮动，下面是夹具库实测）：

```bash
SCIWORK_LIBRARY=/path/to/Research node scripts/selftest-actions.mjs   # 202 通过 · 0 失败 · 3 跳过
SCIWORK_LIBRARY=/path/to/Research node scripts/e2e-panel.mjs          # 93 个元素 · 0 失败
SCIWORK_LIBRARY=/path/to/Research node scripts/selftest-client.mjs    # 252 通过 · 0 失败
node scripts/selftest-live.mjs --real /path/to/Research             # 6 通过 · 0 失败
```

`selftest-live.mjs` 是唯一一条真联调：微缩 React 渲染真的 `lib/client.js`，面板的 `rpc.call` 打到真的 `lib/index.js` 路由，再经真的动作层、dispatch、令牌、回执写进临时库，只有 DSH 宿主的模型服务是假的。默认 `51 通过 · 0 失败 · 6 跳过`，跑完自动清掉临时库。

`selftest-actions.mjs` 的写动作段要求库根指向脚本自己新建的隔离副本。如果它发现 snapshot 指的不是那个副本，会打印 `FAIL 隔离闸门：snapshot 指向副本`，以退出码 2 结束，一个字节都不写。这是设计行为。

## 文档

| 文件 | 内容 |
| --- | --- |
| [docs/INSTALL.md](https://github.com/58catmiao/dsh-sciwork/blob/main/docs/INSTALL.md) | 安装与首次建库，含排错 |
| [docs/ARCHITECTURE.md](https://github.com/58catmiao/dsh-sciwork/blob/main/docs/ARCHITECTURE.md) | 工程结构与契约：宿主动作、HTTP 端点、面板边界、路径解析、自检口径 |
| [docs/RELEASE.md](https://github.com/58catmiao/dsh-sciwork/blob/main/docs/RELEASE.md) | 维护者手册：发版、上架市场、截图、干净机器验证 |
| [docs/CYCLE-14D.md](https://github.com/58catmiao/dsh-sciwork/blob/main/docs/CYCLE-14D.md) | 维护者手册：14 天周期的 debug、功能更新、同步 GitHub |
| [CHANGELOG.md](./CHANGELOG.md) | 版本变更 |
| [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) | 第三方组件与致谢 |

## License 与致谢

MIT，版权归 58catmiao。许可证原文见 [LICENSE](./LICENSE)。

Origin 绘图能力来自 [dsh-origin-plugin](https://github.com/Fantasality/dsh-origin-plugin)（MIT，作者 Fantasality）。本仓库不包含它，`skills/origin-plot/references/origin-tools.json` 派生自它的工具清单，用于离线查表。

DSH 提供了插件机制、agent 预设和工具路由，这个插件是它的扩展。

期刊档案是本项目自己整理的数值、条款与出处摘要，不是期刊官方文件。本仓库不包含任何论文原文或期刊 PDF。档案是辅助，不构成法律或投稿建议，具体条款以期刊官网的最新作者指南为准。

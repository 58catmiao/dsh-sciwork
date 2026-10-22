# Changelog

本文件记录 `dsh-sciwork` 的公开变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.13] - 2026-10-22

### Added

- **三条安装通道都写清楚并各自可走**：README / README.en 的「安装」与 `docs/INSTALL.md` §2 改成一张三通道表——①官方插件页（侧栏「插件」→ 添加插件）填 `github:58catmiao/dsh-sciwork`，也可以填解压目录的绝对路径；②终端 `dsh plugin --profile <profile> add github:58catmiao/dsh-sciwork`；③插件市场加索引 URL 后从「发现」页装。每条通道单独一节，写清它实际做了什么、失败会怎样、装完要重启。
- **市场索引生成器** `scripts/make-market-index.mjs` 与随包索引 `market/plugins.json`：产出 format 1 的插件索引（`title` / `description` 中英双语、`metadata.categories` 与 `labels`、git 源钉到发布 tag 的 40 位 commit、`publishTimestamp` 取 commit 时间），支持 `--stdout` / `--check` / `--validate` / `--commit <sha|ref>` / `--version` / `--out`；历史版本从旧索引继承。索引由 `validateIndex()` 按 `@deepseek-ai/dsh-plugin-market-index` 的规则自校，另外用 DSH 运行时里真实的 `parseMarketIndex` 交叉验证过：`marketInstallTarget` 能翻成 `git+https://github.com/58catmiao/dsh-sciwork.git#<sha>`。`package.json` 增加 `market-index` 脚本，`files` 补上 `market`。
- **技能随包注册** `lib/host/skills.js` + `lib/index.js` 接线：插件激活时把包内 6 个技能读出来（`parseSkillFile` 解 frontmatter，`loadBundledSkills` 容忍坏文件并记录问题），经 `ctx.skills.register()` 注册成 runtime 技能——装完即用，不用再手动跑 `scripts/install.mjs`。`~/.dsh/skills/<名字>/SKILL.md` 已存在时**跳过**，用户自己那份永远优先，不覆盖、不改写。
- **安装面自检** `scripts/test-install.mjs`（39 条断言）：随包技能可读/命名/正文与跳过用户副本、市场索引在位且与 tag 对得上（没有 tag 时只校验已存在的版本，避免发版前假红）、`package.json` 的 `files` / `dsh.bundle` / `dsh.client` / 零依赖 / 脚本键、以及 `apply()` 在只有最少服务时的接线（技能注册数 + 跳过数 = 6，没有 connection / skills 服务也不抛）。`cycle.mjs` 把它排进门禁，门禁从 14 项变 15 项；`package.json` 增加 `test:install` 脚本。

### Fixed

- **装完没有技能**：0.3.12 及以前技能只能靠 `scripts/install.mjs` 拷到 `~/.dsh/skills`，漏跑就一条都看不到，而 README 没把这一步写成必须。现在技能跟着插件走，`install.mjs` 只在「希望技能落盘可编辑」时才需要。
- **文档只认终端一条路**：官方插件页、插件市场、无包管理器三种情况此前分散在故障排查里，且没说明「市场只读用户给的索引、不会爬 GitHub」「第三方 `dshmarket` 读自己的精选目录、读不到本索引」。现在三通道各自成节，故障排查表补「市场 Discover 搜不到」「技能没出现」两行。

## [0.3.12] - 2026-10-22

### Added

- **面板里检查更新并更新**：工作台页头新增「检查更新」，拿本机 `package.json` 的版本与 GitHub `main` 上那份比对：首屏只读本地版本（不联网），点按钮才去 GitHub 看一眼；有新版本时旁边出现「更新到 vX.Y.Z」，走 `system.update_apply` 的计划 → 确认 → 回执后执行 `git pull --ff-only`。宿主新动作两个：`system.update_check`（只读，`sciwork_system_update_check`）与 `system.update_apply`（写，`sciwork_system_update_apply`）。更新成功会报「X → Y」并提示重启 Harness（客户端 bundle 不热替换）。面板会如实说明三种情况：不是 git 工作树（ZIP / 链接安装）、工作区有未提交改动（列出文件后拒绝）、`git pull` 失败（原样转述 git 的话，常见是分叉）。
- **无包管理器安装器**：新增 `scripts/install-plugin.mjs`（`node scripts/install-plugin.mjs --profile <profile> [--source <目录>] [--dry-run] [--force]`）。只用 Node 内置模块，做三件事：给 profile 的 `package.json` 加 `"dsh-sciwork": "link:<目录>"`、把 `<profile>/node_modules/dsh-sciwork` 链接到该目录（Windows 用 junction，不需要管理员权限）、把 `dsh-sciwork` 追加进 `dsh.profile.bundles`；改前自动备份 `package.json.bak-<时间戳>`，真实目录（pnpm 拷贝）不擅自删除。`package.json` 增加 `install-plugin` 脚本。
- **版本比对模块** `lib/host/version.js`：`parseVersion` / `compareVersions` / `isNewer`，解析失败不抛错。

### Fixed

- **安装文档把 npm 当成了包源**：README / README.en / `docs/INSTALL.md` 原来写 `dsh plugin --profile <profile> add dsh-sciwork`，但这个包从未发布到 npm，这条命令在别人的机器上只会得到 404（或被报「npm 找不到这个包」）。现在统一写成 `add github:58catmiao/dsh-sciwork`，并写清「为什么必须带 `github:` 前缀」；同时给出「没有 npm / pnpm」的两套退路（GitHub ZIP 解压 + `install-plugin.mjs`；`git clone` + 同一条命令）与新故障排查表（404 / npm 找不到 / 重启后才生效 / 不是 git 工作树 / 侧栏没面板看 `--dump-config`）。

### Changed

- 客户端自检从 218 条涨到 222 条（新增：首屏报本地版本、检查更新按钮、检查后报新版本与更新入口、点更新走 `system.update_apply` 的计划）；`settle()` 的可等待时间改成可传参，真库那几处等 400 ms——`project.list` 实测 159–190 ms，原来固定 160 ms 会让真库检查偶发先读空。

## [0.3.11] - 2026-10-22

### Added

- **本课题产物速览**：课题详情里多一条 `图 / 草稿 / 数据 / 表 / 工程 / 文献 / 在投` 的计数条，数字来自已登记的产物与该课题的文献、在投记录；点数字直接切到列表页签并带上「项目 slug」当筛选词，只看这个课题的条目。数量为 0 的按钮置灰，不会点出空页。这是一次下钻，不改用户默认视图。
- **指标数字用琥珀色强调**：工作台四个指标（课题 / 图 / 文献 / 在投）的数字改成 `--rl-warn` 琥珀色，看着就知道那是数字，不用和标题抢注意力。

### Fixed

- **工作台里敲筛选没反应**：v2 工作台的搜索框此前只对 v1 页签生效，敲字什么都不筛。现在筛选词进工作台：课题列表、跨课题待办、今日该做、库体检、最近动态一起过滤，顶部给一行「筛选「X」：命中 N 个课题 / N 条待办 / N 条今日 / N 项体检（KPI 仍按全库算）」与「清空筛选」，空结果按种类给明确空状态；搜索框 placeholder 按 v1 / v2 给准确说法。
- **投稿按课题筛不到**：`filterSnap` 的投稿命中字段补上 `x.project`（投稿目录叫 `SUB-xxxx`，路径里没有课题 slug，只能靠这个字段）。
- **点阶段报「缺少必填参数：project」**：`project.list` 的行叫 `slug`，但 `project.get` 读出来的 `project.json` 只有 `id`。面板只用 `current.slug`，详情一来自 `project.get` 就变成 `undefined`，阶段动作与产物速览都带着空项目发给宿主。现在统一走 `curId = current.slug || current.id`；自检夹具也改成「详情只有 id」的真形状，把这个回归钉住。
- **首屏空白写着「库里还没有课题」**：数据还没回来时列表是空的，原本文案会让人以为库丢了。现在首屏给「正在载入库索引…」，数据回来才说「库里还没有课题」。

## [0.3.10] - 2026-10-22

### Added

- **阶段可在面板切换**：课题详情里的七阶段条改成可点选按钮，点任一阶段即走 `project.stage.set` 的计划 → 确认；跳阶段自动带 `force`，退回会把后续阶段重置为待办。

### Fixed

- **「图表」页整页空白**：`_` 前缀的出图文件夹（真实库里的 `figures/_ZT-1100-2h_v4/` 这类）被当成内部目录过滤，图与基金扫不到；内部目录改为按名字判定（`_history` / `_archive` / `_templates` / `_fetched` 等），其余 `_` 文件夹照常呈现。`test-projects` 补了对应回归。

## [0.3.9] - 2026-10-22

### Changed

- **字体与字号再调**：面板改用 Noto Sans SC（回退微软雅黑 / system-ui），数字启用 `tabular-nums` 等宽对齐；字号整体上调一档（正文 14px、次级 13px、微标 12px、小节标题 15px、页标题 18px、指标数字 20px）。
- **表格关键字着色**：待办表的阶段标签按「可推进 / 待处理」分绿、琥珀两色，动作名（如 `project.stage.set`）改用等宽代码片段；阶段标签新增 `ok` / `ac` 色调。

## [Unreleased]

## [0.3.8] - 2026-10-22

### Changed

- **字号与字重收敛**：正文 13px、次级 12px、微标 11px、小节标题 14px / 600、页标题 17px / 600、指标数字 18px / 600；去掉 10.5 / 11.5 / 12.5 三个半档字号，表头与关键列（课题名、指标值、页标题）加粗。
- **黄色警示可见**：库体检与待办里的警示改成琥珀色文字 + 18% 底纹（`color-mix`），倒计时标签同色描边并带底纹；「没有图注」「缺源数据」这类关键字不再只是浅色文字。

## [0.3.7] - 2026-10-22

### Changed

- **面板自带「石墨蓝」module 色板**：`.rl-root` 定义 12 个 `--rl-*` 变量（`bg / surf / surf2 / bd / bd2 / tx / mu / ac / ink / ok / warn / err`），明暗两套（`light-dark()`）；不再引用宿主 `--dsw-alias-*` 颜色 token。正文 / 次级 / 主色对比度均 ≥ 4.5:1（门禁实测：深色 6.6–14.9:1，浅色 4.7–15.3:1）。
- **文案改为书面说明体**：导览、欢迎卡、导入与命令台提示去掉口语（「别走浏览器」「你自己核对」「再往下点」等），统一为简洁精确的说明句；「让 AI 做」按钮统一改称「生成指令」，复制框标注「待发送指令」。

## [0.3.6] - 2026-10-21

### Changed

- **工作台成为默认界面**：`ui.version` 没有值时直接进 v2；页签行右侧「面板 | 工作台」切回旧面板会记住选择。
- **排版重排（对齐 StudyHub 的秩序感）**：页头（标题 + 统计 + 中文主入口「快速登记 / 新建课题 / 导入数据 / 刷新」）→ 指标条（课题 / 图 / 文献 / 在投）→ 「跨课题待办」表格（表头 + 行内操作）→ 「概览」仪表分区 → 课题两栏 → 最近回执；统一 `rl-page / rl-kpi / rl-section / rl-table` 一套间距与字号，概览卡片不再平铺。
- 修掉待办表格「看课题」按钮引用未定义 `setSelected` 的问题（点击会抛错，现在正确选中课题）。

### Added

- **快速登记**：页头入口，打开时只读一次命令清单，按 `title / label / type / optionsCn` 生成中文表单（文献入库 / 登记图溯源 / 记一条投稿），必填在上、其余折进「更多选项」；提交打包成 `system.cli_run`，仍走计划 → 确认 → 回执。

## [0.3.5] - 2026-10-21

### Added

- **跨课题待办总表**：把各课题 `next.todo` 与「检查项已就绪、可推进」合成一张表，每行显示 课题 · 阶段 · 原因（动作名），带「看课题」与「生成指令」两个入口；这是用户点名的「只能再加一个就加它」。

## [0.3.4] - 2026-10-21

### Added

- **工作台仪表**（打开就说一件你还不知道的事）：「今日该做」（逾期/临近的投稿 + 各课题卡住的检查项，最多 3 条）、「投稿倒计时」（未结稿件的下一步/预计决定日，标出逾期与 3 天内）、「库体检」（缺图注、缺源数据、缺 DOI、空课题，只报数不擅自改）、「最近动态」（新图/新草稿/新数据/新文献）、「备份」（上次备份时间 + 一键备份）。
- **「生成指令」**：今日条目与待办旁各一个按钮，把已经写好的指令（含课题、阶段、动作名、plan→confirm 提醒）复制到剪贴板，并显示一个只读框供手动复制；面板没有对话通道，所以不假装一键执行。

### Changed

- **导入简化**：有课题时自动选中上次导入的课题（没有就选唯一那个），选文件后自动推断去处（.bib/.ris → 引用，图/PDF → 图，.docx/.md/.tex → 草稿），去处行只显示一行「去处：X ｜ 换去处」；子目录、别名/图注/标签、DOI/arxiv 等全部收进「更多选项」，默认不展开。
- **导览不再暴露本机信息**：欢迎卡不打印库根路径；示例子目录换成「样品-批号」「年份子批」这类通用名；页头导入在 v2 工作台下隐藏（v1 面板保留，导入按钮在工作台里）。

## [0.3.3] - 2026-10-21

### Added

- **弹层统一行为**：所有弹层（导入 / 命令台 / 数据变换 / 计划确认 / 新建课题 / 看图 / 看 PDF）都能按 Esc 关掉最上面那一层，点遮罩空白处同样关闭；导览层会让位给上面的弹层，不会一起关。
- **空状态给入口**：库里没有课题、课题没有图、文献库空、期刊档案空、投稿记录空时，空状态下方直接给出「新建课题 / 导入图片 / 导入文献 / 记一条投稿」按钮或可复制的命令，不必再回顶部找入口。
- **图卡参数默认折叠**：参数从一整块 JSON 收成一行「参数（N 项）」，点开才展开，方便连续看图。

### Changed

- **v1 / v2 切换改成页签行里的一组分段按钮**（「面板 | 工作台」）：原来的页脚小按钮去掉，切换后记住你上次停留的页签；v2 仍默认关、默认进 v1。

## [0.3.2] - 2026-10-21

### Removed

- **面板不再重画图**（按用户要求整体移除）：删掉 `lib/replot.js`、`replot` 动作与其登记入口、
  `lib/actions/figure.js`、图卡上的「重画这张图」表单、`.research/locks/origin.lock` 串行化与相关自检分支。
  出图与改图一律由智能体走 `origin-plot` 技能 + Origin MCP；面板只负责看、整理、归档/删除。

### Changed

- **命令台全中文化**：18 条命令补 `title`，每个参数补 `label`，7 处 `select` 补 `optionsCn`；
  面板左侧列表、表单标题、参数名与下拉选项都显示中文（原值仍原样提交给 CLI，argv 构造零变化）。
- 技能里的阶段说明跟着改口：`research-stages` 不再提 `figure.replot`，`research-studio` 说明面板已不重画。
- 文档同步：`ARCHITECTURE` §7 改写为「面板与 Origin 的边界」、`INSTALL` 删掉 `--replot` 说明、中英文 README 的图表能力去掉「重画」。

## [0.3.1] - 2026-10-21

### Changed

- **阶段不再单设预设**：删掉 `sci-topic` / `sci-design` / `sci-analysis` / `sci-figure` / `sci-writing` /
  `sci-submission` 六个预设，只保留 `research` 一个模式。七阶段的纪律、推荐工具与退出检查项收进新技能
  `research-stages`（`skills/research-stages/SKILL.md`，由 `scripts/install.mjs` 一起装到 `~/.dsh/skills`）。
  阶段仍是课题 `project.json` 的 `stage` 字段，推进走 `project.stage.set`（计划 → 确认）。

## [0.3.0] - 2026-10-21

「一条能力清单 + 两块屏幕」：动作从 `switch` 长表变成登记表，写动作过确认令牌，每次执行留回执，
课题成为一等公民。旧面板与 24 个旧动作名继续可用。

### Added

- **能力层**：动作登记表（`lib/host/registry.js`）、执行器（`dispatch.js`）、确认令牌（`guards.js`）、
  回执（`receipts.js`，只记写/外部动作，读动作不落盘）；错误码新增 `needs-confirmation` / `schema` / `unsupported` / `needs-migration` / `conflict`。
- **两步确认**：写动作先 `action.plan` 拿一次性令牌（5 分钟），再 `action.confirm`；令牌绑定动作、参数哈希与库根。
  旧动作名同请求内代签，回执记 `legacy-implicit` 并给出 warning。
- **课题模型**：`project.json`（schemaVersion 1）+ 七阶段机 + 产物 sha256 登记 + 双读（旧形状合成只读视图，
  写动作回 `needs-migration`）。
- **迁移与备份**：`system.migrate`（plan / apply，幂等、单课题回滚）、`system.backup` / `system.restore`
  （zip + manifest 逐文件 sha256，恢复只落空目录）。
- **宿主工具**：`sciwork_*`（37 个）+ `sciwork_action_plan/confirm/catalog` + `sciwork_workflow_context`（≤4 KB）。
- **阶段预设**：`sci-topic` / `sci-design` / `sci-analysis` / `sci-figure` / `sci-writing` / `sci-submission`。
- **v2 工作台**：今日 / 课题 / 库 / 数据 / 文献 / 设置；写按钮走「计划 → 弹框 → 确认 → 回执 id」；
  `ui.version` 开关，默认仍是 v1。
- **Python 契约 v1**：`lib/adapters/python.js` 统一子命令映射、参数拼装与超时覆盖。
- **测试**：`test-registry` / `test-dispatch` / `test-projects` / `test-tools` / `test-contract`，
  `cycle.mjs` 门禁扩到 14 项。

### Changed

- `lib/actions.js` 变成薄适配层：只保留旧导出（`ACTIONS` / `handleResearchCall` / `probePathGuard` /
  命令台元数据），实现搬到 `lib/actions/*`。
- `check-local-info` 枚举提交时排除 `refs/dsh-ckpt/*`（本地检查点，永不 push）。

### Fixed

- `project.get` 会合并磁盘上未登记的产物（导入后忘登记也能看见）。
- 面板/脚本两条路都接受 `confirmToken` 与 `token` 两个字段名，指向同一把一次性令牌。

## [0.2.2] - 2026-10-19

「推送前脱敏」：把「不把本机信息带进公开仓库」做成门禁，并清掉文档与测试夹具里已有的本机路径。

### Added

- **`node scripts/check-local-info.mjs`（`npm run check:local`）—— 推送前本机信息扫描**：扫 `git ls-files` 的全部文本文件与全部提交信息，标记在运行时从环境读（家目录 / 用户名 / 主机名 / 临时目录 / 仓库与工作区名 / `library/config.json` 与 `.research/config.json` 里的库根·解释器·启动器·Origin 路径 / `SCIWORK_LIBRARY`），并派生正斜杠·反斜杠·源码双反斜杠三种写法，大小写不敏感；`--history` 另扫历史 diff。干净退出 0 / 有命中 1 / 跑不起来 2。
- `cycle.mjs` 新增第 4 段门禁「本机信息扫描」，与语法、三个自检、patch 预检一起决定退出码。

### Fixed

- 清掉公开内容里残留的本机路径：`docs/CYCLE-14D.md`（仓库路径、真库路径、临时目录）、`.gitignore` 注释、`scripts/selftest-client.mjs` 写动作夹具里的绝对路径，统一改为 `<仓库根>` / `<库根>` / `<系统临时目录>` 与虚构盘符 `X:`。
- 扫描器不再把短标记当子串：用户名 / 主机名 / 工作区名按词边界匹配，仓库克隆在系统临时目录（`<系统临时目录>/…`）下时，目录名里的 `temp` 不会再把 `template` 全报成泄漏；工作区名是 `Temp`/`tmp`/`Users` 这类通用目录名时直接跳过。每次运行先跑内置自检。

### Changed

- `cycle.mjs` 的报告更完整：每个子进程的完整输出都落成 `out/cycle/<日期>/*.log`（此前只有红项才留），终端汇总会点名「跳过」的用例——跳过项比失败项更危险，它安静地什么都不验。
- 周期节拍改为**隔周周六**：调度用 `weekly`（周六 14:00 Asia/Shanghai），「隔一周」由一个间隔周闸门实现（距上一轮 < 10 天就跳过，不动仓库）。`docs/CYCLE-14D.md` 第 3 节记下为什么不用 `every_seconds`/`cron`：前者从创建时刻起算会越走越离开周末，后者「日 + 周」同时受限是**或**关系，表达不了「每两周的周六」。
- `docs/CYCLE-14D.md` 第 ⑥ 步与第 2 节护栏加入「推送前零命中才推」，第 5 节记录这条教训。

## [0.2.1] - 2026-10-19

「周期自检」：一条命令跑完全部门禁，并且修掉一处让隔离闸门长期失效的库根优先级缺陷。

### Added

- **`node scripts/cycle.mjs`（`npm run cycle`）—— 一条命令跑完 CI 那套门禁**：自动发现 `lib/*.js` 与 `scripts/*.mjs` 做 `node --check`，依次跑三个自检与 `validate-patch.py`，附一段只读的 git 状态（分支 / HEAD / tag / 未提交 / 领先落后远端）；输出汇总表与退出码（`0` 全绿 / `1` 有红项 / `2` 门禁没跑起来），完整报告与逐子进程日志落 `out/cycle/<日期>/`（`out/` 已 gitignore）。开关：`--no-report` / `--skip-host` / `--quiet`；环境变量 `SCIWORK_LIBRARY` 指真库、`SCIWORK_PYTHON` 指定解释器。
- **`docs/CYCLE-14D.md` —— 14 天周期运行手册**：周期七步（摸底 → 真库基线 → 修问题 → 上一个功能 → 文档版本 → 同步 GitHub → 复核）、七条护栏、候选功能池与技术债清单、本轮踩过的坑。
- 自检回归用例「库根：环境变量压过随包 `library/config.json`」。

### Fixed

- **库根优先级次序反了，隔离闸门形同虚设** —— `loadSettings()` 把随包 `library/config.json` 当作 `resolveLibraryRoot()` 的配置值，而该函数是 `configured || env(...)`，于是本机那份指向真库的配置**压过了** `SCIWORK_LIBRARY`/`RESEARCH_LIBRARY`：自检想把库指到隔离副本永远指不过去，「隔离闸门」每次拿真库当副本，写动作整节（约 60 条）永久跳过——0.2.0 就是这样发出去的。现在次序是「库内 `.research/config.json` ＞ 环境变量 ＞ 随包 `library/config.json` ＞ DSH 目录约定 ＞ `<家目录>/Research`」，新增 `envLibraryRoot()` 供 `loadSettings()` 优先读取，并补了会红过的回归用例。
- **`checkJournal 指明稿件` 断言过度** —— 库里没有稿件时 `manuscript` 返回 `null` 是正确行为（体检里同时报 `manuscript.exists=fail`），旧断言却要求一定非空，于是真库清空草稿后自检就红。改成「字段存在，且要么指明稿件、要么明确报缺」。

### Changed

- 隔离闸门真正跑起来之后，写动作那节覆盖到的检查从「跳过」变成「执行」：本机真库基线 `126 通过 · 0 失败 · 4 跳过`；`cycle.mjs` 全绿 8 项 / 约 24 s。
- README 增补 `cycle.mjs` 用法、文档地图收录 `docs/CYCLE-14D.md`，并说明 `SCIWORK_LIBRARY` 优先于随包配置。

## [0.2.0] - 2026-10-19

「投稿闸门」：查得到 → 合规格 → 打得包。

### Added

- **期刊合规体检 `research.py check-journal`** —— 按期刊档案逐条比对：图件宽度与单/双栏、宽高比、像素密度（读 PNG pHYs / JPEG JFIF / TIFF 标签 / SVG 数值，不看扩展名猜）、图件矢量偏好、图注是否存在、正文标题与摘要字数、参考文献条数与 DOI 覆盖、引用键是否都在库里。每条给 `pass` / `warn` / `fail` / `na`（档案里没说的一律 `na`，不猜），带 `source` 与 `confidence`；有 `fail` 时退出码 1。
- **投稿包导出 `research.py export-package`** —— 把稿件（`.md`/`.docx`/`.tex`）、图件、数据与 `refs.bib` 收进 `submissions/packages/<slug>-<时间戳>.zip`，并附 `manifest.json`（逐文件 sha256）与 `checklist.md`（把期刊 checklist 与体检结论勾成一张交稿清单）。
- **面板「投稿」页签的投稿闸门卡** —— 选期刊 → 「体检」逐条看结果 → 「导出投稿包」；结果就地展示、可复制。宿主动作新增 `checkJournal` / `exportPackage`（22 → 24 个）。
- **检索能进子目录、能搜正文** —— `reindex` 递归 `figures/`、`drafts/`、`data/`、`tables/`、`notes/` 子目录（与 `import` 允许的三层一致），草稿与笔记写入正文摘录，`search` 命中正文。

### Fixed

- **「导入」等主按钮在主题下变成一片纯色、文字消失** —— 客户端把 `--dsw-alias-bg-base`（表面背景）当成品牌色块上的文字色；用户主题把 `bg-base` 设为透明时就只剩粉色块。改用 `--dsw-alias-label-primary-foreground`（浅色主题下是白字，深色主题下是深色字），共 4 处；客户端自检新增两条护栏断言。
- 草稿 / 图 / 数据放在子目录时搜不到、索引只记文件名。

### Changed

- 自检覆盖 24 个动作；新增投稿闸门端到端用例（体检 → 打包 → 校验 zip 与 sha 清单）；客户端新增按钮前景色护栏。

## [0.1.0] - 2026-10-13

首个公开发布版本。

### Added

- **科研模式 agent 预设** —— `cordis.patch.yml`：科研绘图与论文写作的工作流纪律，含 Origin MCP 接线（`mcp-origin`）与「绝不抢占用户正在使用的 Origin 实例」等硬性约束。
- **实体科研库 Python 引擎与索引** —— `library/scripts/research.py`：对仓库之外的实体库（课题 / 文献 / 图 / 稿 / 数据 / 投稿）做检索、登记与索引重建；同目录另有 `journal-index.py`。
- **12 份期刊投稿档案** —— `library/journals/*.json`：`acs`、`cell`、`chinese-core-journal`、`cnki-thesis`、`elsevier-generic`、`gbt-7714`、`ieee-trans`、`mdpi`、`nature`、`plos-one`、`science`、`thesis-generic`；每份给出图件尺寸 / 字号 / 分辨率 / 参考文献样式等数值，并带 `sources` 出处与 `confidence` 置信度。
- **五个技能** —— `skills/research-studio/`、`skills/origin-plot/`、`skills/paper-writing/`、`skills/literature-refs/`、`skills/journal-profile/`。
- **手写 Web 客户端「科研库」面板** —— `lib/client.js`：七页签，零构建（无打包器、无前端框架）；宿主半边 `lib/index.js` 只用 Node 内置模块。
- **宿主端点 `POST /api/research/call`** —— `lib/actions.js`：面板与宿主之间的 22 个动作（`snapshot` / `readText` / `tableTransform` / `replot` / `import` / `archive` …）。
- **自检脚本与补丁预检** —— `scripts/selftest-host.mjs`、`scripts/selftest-actions.mjs`、`scripts/selftest-client.mjs`、`scripts/validate-patch.py`。

[Unreleased]: https://github.com/58catmiao/dsh-sciwork/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/58catmiao/dsh-sciwork/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/58catmiao/dsh-sciwork/releases/tag/v0.1.0

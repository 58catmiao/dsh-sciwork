# Changelog

本文件记录 `dsh-sciwork` 的公开变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Changed

- `cycle.mjs` 的报告更完整：每个子进程的完整输出都落成 `out/cycle/<日期>/*.log`（此前只有红项才留），终端汇总会点名「跳过」的用例——跳过项比失败项更危险，它安静地什么都不验。
- 周期节拍改为**隔周周六**：调度用 `weekly`（周六 14:00 Asia/Shanghai），「隔一周」由一个间隔周闸门实现（距上一轮 < 10 天就跳过，不动仓库）。`docs/CYCLE-14D.md` 第 3 节记下为什么不用 `every_seconds`/`cron`：前者从创建时刻起算会越走越离开周末，后者「日 + 周」同时受限是**或**关系，表达不了「每两周的周六」。

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

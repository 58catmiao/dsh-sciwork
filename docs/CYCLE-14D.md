# 14 天周期：debug + 功能更新 + 同步 GitHub（运行手册）

面向维护者。目标：**每 14 天**给科研模式做一轮体检——修掉发现的问题、上一个功能、跑绿门禁、同步到 GitHub。
不是「有空再看」，是有节拍、可复跑、失败能自证的那种。

- 周期起点：**2026-10-19**（第一轮：库根优先级修复 + `cycle.mjs` 周期自检）
- 节拍：**隔周周六 14:00（Asia/Shanghai）**，即两周一轮、固定在周六做
- 下一轮：**2026-10-31**，之后 11-14、11-28、12-12……
- 一次周期预算：**半天**（门禁 ~25 s，主要时间花在「找问题 + 写一个功能 + 写变更说明」）

---

## 0. 一条命令

```bash
cd <仓库根>
node scripts/cycle.mjs
```

它跑的就是 `.github/workflows/ci.yml` 那一套（不另立标准），另外只读地报一下 git 状态：

| 门禁 | 内容 | 真库缺失时 |
| --- | --- | --- |
| `node --check` | `lib/*.js` + `scripts/*.mjs` 全量语法（自动发现，新文件不用改清单） | 照跑 |
| host 自检 | `scripts/selftest-host.mjs`：库快照 / 配置优先级 | 照跑（报告式输出） |
| action 自检 | `scripts/selftest-actions.mjs`：动作契约 + 写动作端到端（隔离副本里） | 内容类记 SKIP，退出码仍 0 |
| client 自检 | `scripts/selftest-client.mjs`：面板渲染与请求形状（假信封，不发真请求） | 照跑 |
| patch 预检 | `python scripts/validate-patch.py`：补丁必须是合成树的子集 | 需要 python + PyYAML |
| 本机信息 | `scripts/check-local-info.mjs`：跟踪文件与提交信息里不许有本机路径 / 用户名 / 主机名 | 照跑（标记运行时从环境读，没真库也能跑） |

- **退出码**：`0` 全绿 / `1` 有红项 / `2` 连门禁都没跑起来（缺 node、缺 python、文件不在）。
- **报告**：`out/cycle/<YYYY-MM-DD>/cycle-report.md` + 每个子进程一份 `.log`（`out/` 已 gitignore，不会进仓库）。
- **开关**：`--no-report`（只在终端看）、`--skip-host`（跳过需要真库的那节）、`--quiet`（子进程输出只进日志）。
- **指纹**：想看真实基线而不是 CI 基线，设 `SCIWORK_LIBRARY=<库根>`；仓库外的 `library/config.json` 若已写了库根，不设也一样（那份文件是机器本地的，已被 gitignore）。
- **解释器**：默认依次试 `python` / `py -3` / `python3`，可用 `SCIWORK_PYTHON` 指定。

> 红项一律先修再谈同步。**不许带着红的门禁推送**——CI 会在两个 OS × 两个 node 版本上再红一次，只是把问题推迟两天。

---

## 1. 周期七步

### ① 摸底（10 分钟）

```bash
node scripts/cycle.mjs          # 绿不绿、哪节跳过、耗时异常
git status -sb                  # 有没有上次没提交干净的
git log --oneline -10           # 上一轮做了什么
```

顺手看一眼 `out/cycle/` 最近两份报告：跳过项连续两轮没变，说明那个环境一直没备齐（常见：没配 python、没有真库）。

### ② 真库基线（5 分钟）

`--skip-host` 之外的写动作那节依赖真库。真库当前状态：

```bash
ls <库根>/projects
python <库根>/.research/bin/py.cmd --help   # 或 library/scripts/research.py
```

护栏：**自检只允许在隔离副本里写**（`scripts/selftest-actions.mjs` 会把真库 `cp` 到系统临时目录下本次运行专属的 `sciwork-actions-<随机>/lib` 再改写副本配置，跑完只删自己这一份）。`<库根>` 里的数据、图、稿**一个字节都不许动**。

> 2026-10-24 修：临时根以前是所有运行共用的 `<tmp>/research-selftest`，每次开跑先删整个根；两处门禁并行跑时后启动的那次会把前一次的副本删掉（读 `.research/config.json` 时 ENOENT，写动作整节红掉）。现在每次运行 `mkdtemp` 一个专属根，并发跑不会互删。

### ③ 找问题 + 修（≈2 小时）

优先顺序（从「会静默骗人」到「不好看」）：

1. **闸门形同虚设** —— 自检里「跳过」的项，是不是本该跑起来？（本轮就是这样发现库根优先级的：隔离闸门永远拿真库当副本，写动作整节永久跳过。）
2. **断言恒真/恒假** —— 看着绿但什么都没验的检查。例：`exitCode !== 0` 在字段不存在时恒真。
3. **错误路径** —— 拒绝、越界、重名、空目录、坏编码，返回的是 `bad-request` 还是静默吞掉。
4. **文案与实现不一致** —— 面板说的和脚本做的不是一回事（最容易被用户先发现）。
5. **不好看/不顺手** —— 放最后，且只改一处。

修完**必须**补一条能红过的回归用例，否则下一轮还会原地复发。

### ④ 上一个功能（≈2 小时）

候选池见第 4 节。取舍规则：

- 一个周期**只上一个功能**，且必须能被现有门禁覆盖（新增动作 → action 自检；新增面板 → client 自检）。
- 宁可小：能独立回滚、能单独写进 CHANGELOG 的一节。
- 不引入 npm 运行时依赖（本仓库零依赖是刻意的，CI 才不用 `install`）。

### ⑤ 文档与版本（30 分钟）

1. `CHANGELOG.md`：把 `## [Unreleased]` 的内容落成一个版本节，标题写「主题」（例：0.2.0 =「投稿闸门」），分 `Added / Fixed / Changed`。
2. `package.json` 的 `version`：修 bug 且不新增动作 → `patch`；新增动作/面板页签 → `minor`；改配置契约、破坏已有库 → `major`。
3. 涉及契约的改动同步 `docs/ARCHITECTURE.md`；涉及用法同步 `README.md`（英文版 `README.en.md` 别忘）。
4. 本轮经验写进本文件第 5 节「踩过的坑」，别只留在会话里。

### ⑥ 同步 GitHub（10 分钟）

```bash
node scripts/cycle.mjs                       # 再跑一遍，确认全绿
node scripts/check-local-info.mjs            # 本机信息零命中（跟踪文件 + 提交信息）
git add -A
git commit -m "release: vX.Y.Z —— <一句话主题>"
git tag vX.Y.Z
git push origin main --tags
```

- **推送前必须零命中**：`check-local-info.mjs` 会拿这台机器的家目录、用户名、主机名、临时目录、仓库与工作区名、`library/config.json` 里的库根与解释器，去扫全部跟踪文件和全部提交信息（`--history` 还能查历史 diff）。命中就换成占位符：`<仓库根>` / `<库根>` / `<系统临时目录>` / `<用户目录>`，别写具体的盘符路径。
- 提交信息同样是公开内容：`git commit -m` 里别带本机路径。

- 推之前先 `git status -sb`：`ahead N` 里除了本轮提交，**不该有别的东西**（上一轮漏推的，这次一并推，但要在提交说明里写清）。
- 打 tag 只在这一步、只打一次。忘了打 → 补 `git tag vX.Y.Z <sha>` 再 `git push origin vX.Y.Z`，**不要** amend 已推送的提交。
- 本机访问 GitHub 需要代理时，先设 `HTTPS_PROXY` / `HTTP_PROXY` 再 push。
- **禁止** `git push --force`、`git rebase` 已推送的历史。

### ⑦ 复核（5 分钟）

```bash
git ls-remote --tags origin | tail -3        # tag 到没到
git status -sb                               # 干净、不领先
```

GitHub Actions 会自动跑 CI（ubuntu/windows × node 20/22）。红了就当本周期没结束——对照 `out/cycle/` 里的本地报告定位差异（最常见：Windows 上路径分隔符、CI 没装 PyYAML 的那一步）。

---

## 2. 护栏（每轮都要确认）

| # | 护栏 | 为什么 |
| --- | --- | --- |
| 1 | 不改科研数据 | 图/数据/稿只读；写动作只在隔离副本里测 |
| 2 | 不带红门禁推送 | 把红推到远端只是延迟两天发现 |
| 3 | 不 force push / 不改已推送历史 | 别人（含 CI）可能已经引用 |
| 4 | 零运行时依赖 | 装了 CI 就得 `install`，本地与远端会分叉 |
| 5 | 版本号只升不降，tag 与 `package.json` 一致 | 市场与 `dsh plugin` 都按版本判断升级 |
| 6 | 本机 `library/config.json` 不进仓库 | 它是库根覆盖，进了仓库会压过别人的环境变量（本轮修的正是这类灾难） |
| 7 | 一次周期只上一个功能 | 出问题时能分清是哪一处 |
| 8 | 不带本机信息推送 | 仓库是公开的；路径、用户名、主机名一旦推上去，历史里就抹不掉 |

---

## 3. 自动化

周期任务挂在 DSH 会话里，**每周六 14:00（Asia/Shanghai）唤醒一次**，靠「间隔周闸门」做成两周一轮。

为什么不是直接配「每 14 天」：提醒调度只有 `every_seconds` / `daily` / `weekly` / `cron` 几种形状，`cron` 的「日 + 周」同时受限时是 **或** 关系，表达不了「每两周的周六」；`every_seconds = 1209600` 又只能从创建时刻起算，会越走越离开周末。所以拆成两件互不干扰的事：

- **调度**：`weekly`，`weekdays = [6]`（周六）、`time = 14:00`、`time_zone = Asia/Shanghai` —— 每周六准时醒。
- **闸门**：醒来第一件事看上一轮是什么时候（`ls out/cycle/ | tail -1`，报告目录名就是日期；或 `git log -1 --format=%cs`）。
  - 距今天 **< 10 天** → 本周是间隔周，回一句「本周为间隔周，跳过（上次 <日期>）」就结束，**不动仓库、不跑门禁**。
  - **≥ 10 天** → 按本文件 ① 到 ⑦ 走一轮。

这样 10 天阈值遇到「每周六」自然落成隔周：10-24（距 5 天，跳过）→ 10-31（距 12 天，跑）→ 11-07（距 7 天，跳过）→ 11-14（距 14 天，跑）……也容忍一两天的漂移，不会因为某次晚跑一天就把节拍整体错位。跳过的那次只花一次读目录的时间。

其余纪律：

- 触发后按本文件从 ① 走到 ⑦；被唤醒时**先看 `git status -sb` 与上一份 `out/cycle/` 报告**再动手，别假设状态。
- 推送前**必须**跑 `node scripts/check-local-info.mjs`（`cycle.mjs` 里也有这一段），零命中才 push。
- 调度规则（周六 / 14:00 / 阈值）只写在本节与 prompt；改节拍就改这两处，别散在别处。
- 中断不要紧：每一步都能单独重来；没推送就不算完成，下一轮会看到 `ahead N` 并接着推。
- DSH 重启后 `schedule_list` 复核一次任务是否还在；不在就重建（current id 见下表）。

| 项 | 值 |
| --- | --- |
| schedule id | `schedule-17a47bee-d217-4c27-9001-a76514d45111` |
| 形状 | `weekly` · 周六 · 14:00:00 · Asia/Shanghai |
| 间隔周阈值 | 距上轮 < 10 天即跳过 |
| 首次触发 | 2026-10-24 14:00（间隔周，跳过） |
| 首次执行 | 2026-10-31 14:00 |

**人工兜底**：以 `schedule_list` 返回的 `scheduledAt` / `state` 为准，别凭印象算日子。错过一轮不算事故，补一轮即可（不要一次补两轮）。

---

## 4. 候选功能池（下一轮从这儿挑，一轮只取一条）

按「用户能直接感知」排序，括号里是成本估计：

1. **体检结果一键回填 checklist** —— `check-journal` 的 `checklist` 目前恒为 `auto:false`；把能自动判的勾上，交稿时少点一遍（中）。
2. **`exitCode` 落到返回值里** —— 现在客户端与自检都拿不到真实退出码，只能靠 `counts.fail` 推断（小）。
3. **无 python 环境下的降级** —— 没装 python 时 `checkJournal` / `runCli` 应当给出明确 `unavailable`，而不是让 actions 自检整节红（小，需先验证当前行为）。
4. **投稿包可重入** —— 同名稿再导一次是覆盖还是新包？现在靠时间戳分目录，缺「这一版对应哪次体检」的关联（中）。
5. **图件像素密度读 SVG 的 viewBox 单位** —— 只认数值 pt/mm 时 `w="100%"` 会漏检（小）。
6. **面板「投稿」页签的失败项可筛选** —— 体检几十条时只想看 `fail`（小）。
7. **索引增量化** —— 每次 `reindex` 全量递归，库大起来会慢（大，慎入）。

技术债（发现问题就记这儿，别硬塞进周期）：

- `scripts/selftest-actions.mjs` 的 `[6b]` 断言 `cj.value.exitCode` 当前恒真（字段不存在）——要么 Python 侧带回，要么改断言。
- `library/scripts/research.py` 的 `--draft` 相对路径以库根解析，与 `import` 的三层子目录规则不是同一套说明。

---

## 5. 踩过的坑（本轮实测，别再踩）

- **库根优先级反了会静默毁掉隔离自检**：`loadSettings()` 原来让随包 `library/config.json` 压过 `SCIWORK_LIBRARY`，于是「把库指到别处」永远无效，自检里「隔离闸门」把真库当副本，写动作整节永久跳过——`0.2.0` 就是这么发出去的。现在次序是：库内 `.research/config.json` ＞ 环境变量 ＞ 随包 `library/config.json` ＞ DSH 目录约定 ＞ `<家目录>/Research`。
- **自检里的「跳过」比「失败」危险**：失败会响，跳过只是安静地什么都不验。看报告先看跳过数。
- **`journal_check` 没有稿件时 `manuscript` 就是 `null`**（同时 checks 里有 `manuscript.exists=fail`）。断言要认这个合法空值，否则真库一清空草稿，自检就红给你看。
- **`node --check` 必须用清单外的自动发现**：手写清单漏一个文件，语法错就一路带到 CI。
- **Windows 上跑 python 的编码**：子进程统一带 `PYTHONIOENCODING=utf-8`，否则 GBK 码页下中文日志会乱码甚至抛错。
- **文档和测试夹具最容易把本机路径带进公开仓库**：写运行手册时顺手敲了本机仓库路径、真库路径、临时目录；`git push` 前没人再读一遍。现在推送步骤与会话里的周期任务都先跑 `scripts/check-local-info.mjs`（跟踪文件 + 提交信息，`--history` 还能查已删的历史 diff），命中就换占位符。这条是 2026-10-19 用户明确要求的。

# 安装与配置

只写仓库里真实存在的东西：每一步的命令与选项都来自 `scripts/install.mjs`、
`scripts/selftest-*.mjs`、`library/bin/py.cmd` 与各技能的 `SKILL.md`。

- 包名 `dsh-sciwork`，版本 0.3.0，MIT，仓库 <https://github.com/58catmiao/dsh-sciwork>，作者 58catmiao。
- 架构、接口契约与设计取舍见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 1. 前置条件

| 需要 | 说明 |
|---|---|
| Node.js ≥ 18 | 安装器与自检脚本用 |
| DSH | 面板与 preset 都跑在 DSH 里 |
| 一个 Python 解释器 | 科研库工具链 `research.py` 用。**不要求 `python` 在 PATH 上**——找不到时可以用 `SCIWORK_PYTHON` 指路，仓内启动器会逐个候选探测 |
| Origin 2024 + 上游 Origin 插件 | **可选**，只有绘图需要。见 §6 |

`research.py` 是纯标准库；面板的数据变换也是纯 Node 计算，都不需要额外 Python 包。
只有走 Origin 的那条链路需要 `numpy` / `openpyxl` / `pyyaml` / `originpro` / `mcp` / `pywin32` 之类。

## 2. 安装

三条通道装的是同一个包，按手边界面选一条：

| 通道 | 命令 / 操作 | 说明 |
|---|---|---|
| 官方插件页（侧栏「插件」→ 添加插件） | 填 `github:58catmiao/dsh-sciwork` | 也可填解压目录的**绝对路径**；装完点「立即启用」 |
| 终端 | `dsh plugin --profile <profile> add github:58catmiao/dsh-sciwork` | 参数转发给 profile 里的 pnpm |
| 插件市场（「插件 → 发现」） | 先加索引 URL，再从发现页装（见 §2.1c） | 市场只读用户给的索引 |

### 2.1 作为插件装进 profile（终端）

```bash
dsh plugin --profile <profile> add github:58catmiao/dsh-sciwork
```

**必须带 `github:` 前缀。** 这个包没有发布到 npm，写 `add dsh-sciwork` 会让包管理器去 npm 解析，结果是 404（或「找不到这个包」）。

`dsh plugin` 本身不实现安装，它把参数转发给 profile 里的包管理器（pnpm）执行，所以要求本机能跑 pnpm。

装完**必须重启 Harness**：`cordis.patch.yml` 与宿主半边 `lib/*.js` 都只在启动时读取。
重启前只能说「已写入」，不能说「已生效」。

### 2.1a 官方插件页

侧栏「插件」→ 添加插件 → 输入框填 `github:58catmiao/dsh-sciwork`（或解压目录的绝对路径）→ 安装 →「立即启用」→ 重启 Harness。

插件页内部先 `inspect` 再走与终端同一套安装流程（GitHub 源会先 `git ls-remote` 探活，默认 5 秒超时）；失败会回滚 profile 的 `package.json` 与 `pnpm-lock.yaml`。

### 2.1b 本机没有 npm / pnpm（报「npm 找不到」）

不用包管理器也能装。`scripts/install-plugin.mjs` 只用 Node 内置模块，做三件事：给 profile 的 `package.json` 加 `"dsh-sciwork": "link:<目录>"`、把 `<profile>/node_modules/dsh-sciwork` 链接到该目录、把 `dsh-sciwork` 追加进 `dsh.profile.bundles`（改前备份 `package.json.bak-<时间戳>`）。

```bash
# 方式 A：GitHub 页面 Code → Download ZIP，解压后用解压目录做源
node scripts/install-plugin.mjs --profile <profile> --source <解压目录>

# 方式 B：git clone 后在本仓库根目录
node scripts/install-plugin.mjs --profile <profile> --source .

# 只看会改什么，不写盘
node scripts/install-plugin.mjs --profile <profile> --dry-run
```

验证接线：`dsh --profile <profile> --dump-config | grep -c dsh-sciwork`（应大于 0）。注意用这条路装进来的目录**不是 git 仓库**，面板里点「检查更新」会如实提示「不是 git 工作树」，更新方式是重新解压新版再跑一遍脚本。

### 2.1c 插件市场（加索引 URL）

市场的「发现」页由可选组合包 `@deepseek-ai/dsh-experimental-plugin-market-bundle` 提供，**不自动抓 GitHub**：它只读用户添加的索引 URL。本仓库自带 format 1 索引 `market/plugins.json`（git 源、钉到发布 commit），在市场的索引设置里加：

```
https://raw.githubusercontent.com/58catmiao/dsh-sciwork/main/market/plugins.json
```

索引里的版本记录形如 `{ version: "0.3.13", source: { type: "git", url: "https://github.com/58catmiao/dsh-sciwork", commit: "<40 位 sha>" } }`，市场把它翻成 `git+https://github.com/58catmiao/dsh-sciwork.git#<sha>` 交给 pnpm —— 所以装到的版本可复现。

发版后刷新索引：

```bash
node scripts/make-market-index.mjs --commit v0.3.13   # 重写 market/plugins.json
node scripts/test-install.mjs                          # 核对 format 与 commit 是否对得上 tag
```

> 第三方市场 `dshmarket` 读自己的精选目录，读不到这份索引；要出现在里面得它先收录。

### 2.2 铺技能与科研库骨架

`scripts/install.mjs` 做两件幂等的事：把 `skills/` 下的技能装到技能根，把 `library/` 骨架铺到库根。

**0.3.13 起技能不需要这一步**：插件激活时把包内 6 个技能注册成 runtime 技能（`ctx.skills.register`），装完即用；`~/.dsh/skills` 下已有同名技能时跳过、不覆盖用户版本。`install.mjs` 仍保留，用于「希望技能以文件形式落在磁盘上、可自行编辑」的场景。


```bash
# 预检：只检查，不写任何文件
node scripts/install.mjs --verify-only

# 真正安装
node scripts/install.mjs
```

选项（`node scripts/install.mjs --help` 是权威清单）：

| 选项 | 作用 |
|---|---|
| `--skills-root <dir>` | 技能安装根，默认 `<用户目录>/.dsh/skills` |
| `--library-root <dir>` | 科研库根，默认取 `library/config.json` 的 `libraryRoot` |
| `--verify-only` | 只检查，不写任何文件 |
| `--skip-library` | 不铺科研库骨架 |
| `--force-skills` | 允许覆盖「看起来不是技能目录」的目标目录 |
| `--force-scripts` | 强制覆盖库里的工具脚本（`py.cmd` / `research.py` / …） |

安装器的行为约定：

- 技能先做 frontmatter 预检（`name` 必须与目录名一致、`description` 不能缺失或过短），**预检不过就不做任何改动**。
- 技能安装时**先删同名目录再拷**；目标已存在且没有 `SKILL.md` 时跳过并提示（不覆盖别人的技能目录）。
- 库骨架**只补缺失的文件，绝不覆盖**用户的 `refs.json` 与 `projects/` 里的数据。
- 工具脚本的覆盖口径：bundle 里那份**确实更新**才写，同内容不动；库里的版本更新时保留库里的版本
  （想强推用 `--force-scripts`）。
- 期刊档案只补模板里有、库里没有的份数；已有的一律保留。
- `journals/_sources/` 只保证目录与说明在，**PDF 本体是用户的数据，安装器永不碰**。
- 最后会用库里的解释器跑一次 `research.py init` 建/修骨架（跑不了只提示，不算失败）。

安装器**不会**替你做：把包装进 profile、重启 Harness、配置 Origin 组件。

### 2.3 库目录长什么样

```
<库根>/
  projects/<课题>/data/      原始数据（只读）
  projects/<课题>/figures/   导出的图 + 同名 .json 溯源侧车
  projects/<课题>/origin/    可编辑的 .opju 工程
  projects/<课题>/drafts/    Markdown 稿
  projects/<课题>/notes/     笔记、审稿意见、投稿记录
  projects/<课题>/tables/    从数据算出来的表
  refs/refs.json             跨课题文献库（唯一真源）
  refs/refs.bib              由 refs.json 生成的 BibTeX（派生物，别手改）
  journals/<id>.json         期刊档案
  submissions/               投稿待办
  .research/                 配置、启动器、脚本、索引、归档、锁
```

## 3. 配置

### 3.1 环境变量

| 变量 | 含义 |
|---|---|
| `SCIWORK_LIBRARY` | 科研库根目录。默认 `<用户目录>/Research` |
| `RESEARCH_LIBRARY` | 库根的旧名，仍兼容 |
| `SCIWORK_PYTHON` | Python 解释器绝对路径 |
| `SCIWORK_ORIGIN_PLUGIN` | 上游 Origin 插件目录 |

另有 DSH 自身的 `DSH_HOME` / `DSH_PROFILE` / `DSH_PROFILE_DIR` 参与路径推断。

### 3.2 权威配置是库内那一份

`<库根>/.research/config.json` 是权威配置（随包的 `library/config.json` 只是安装模板）。
字段说明见 [ARCHITECTURE.md 附录 B](./ARCHITECTURE.md#附录-b--权威配置)。安装器只有在
`libraryRoot` 与本次库根不一致时才会就地校正它，其余字段不动。

解析优先级（越高越优先）：显式配置 → 环境变量 → 按 DSH 目录约定推断 → 兜底 `<用户目录>/Research`。
所有解析函数都不抛异常，找不到就返回 `null`，由调用方给出一句人话。

### 3.3 Python 解释器

解析顺序（与库内启动器 `<库根>/.research/bin/py.cmd` 一致）：

1. 配置里的 `interpreter`
2. `SCIWORK_PYTHON`
3. `<库根>/.venv`
4. `<库根>/.research/.venv`
5. Origin 插件目录下的 `.venv`
6. `PATH` 上的 `python` / `python3` / `py`

一个都找不到时，`py.cmd` 会直接打印该建哪个 venv、装哪些包并返回 `127`，照它说的做即可。

## 4. 验证安装

三条自检都能裸 node 复跑，不需要装依赖。它们**只读仓库与库**（写动作跑在临时库副本上），
不会碰你的 Origin：

```bash
node scripts/selftest-host.mjs      # 宿主数据层：路径闸门、快照、读文件 → exit 0
node scripts/selftest-actions.mjs   # 23 个动作 + 命令台 + 读表 + 写动作走临时库副本 → 141 通过 · 0 失败 · 1 跳过（夹具库；通过数随库内容浮动）
node scripts/selftest-client.mjs    # 把 lib/client.js 当浏览器加载：真渲染 + 真点击 → 172 通过 · 0 失败
```

说明：

- 基线数字会随**真库内容**浮动：真库里没有对应样本时相关断言打 `SKIP`，不是失败。
  数字变了先看 `SKIP` 条数与原因。
- 改完补丁文件（`cordis.patch.yml`）先跑 `py.cmd scripts/validate-patch.py` 之类的语法预检，再重启 Harness。

## 5. 装了之后有什么

- **agent preset**：「科研模式 · Research」，保留跑命令 / 读写文件 / jobs / present 等能力。
- **5 个技能**：`research-studio`（总控与路由）、`origin-plot`、`paper-writing`、`literature-refs`、`journal-profile`。
  在科研模式下直接用自然语言，技能会按路由表加载。
- **「科研库」面板**：侧栏图标 + 中央页面。它是辅助视图——看库、整理库、导入/归档/删除、就地改草稿、
  数据变换、归档/删除。**面板不出图、也不重画**，出图/改图让智能体走 Origin。

面板出现在界面上需要**重启 Harness + 刷新页面**：只重启不刷新、或只刷新不重启，都可能看不到。

## 6. 依赖 Origin 组件（可选）

绘图能力由上游 `dsh-origin-plugin`（作者 Fantasality，MIT）提供，本仓库只带适配技能 `skills/origin-plot/`。
它需要本机的 Origin 2024 与一个装了 `originpro` / `OriginExt` 的 Python 环境。

装好上游插件后，本插件通过这几种方式找到它（越靠前越优先）：

1. 库内配置的 `origin.pluginDir` / `origin.server`
2. `SCIWORK_ORIGIN_PLUGIN` 环境变量
3. DSH profile 的 `node_modules/dsh-origin-plugin`（含默认 `desktop` profile）

Origin MCP server 脚本会依次找 `origin_mcp_server.py` / `origin_mcp_stdio.py`。
它由 profile 层的 MCP 加载器条目注册，**改了要重启 Harness 才生效**。

面板**不再重画图**（0.3.2 起 `lib/replot.js` 与 `replot` 动作已删除）：出图与改图一律让智能体走科研模式的 `origin-plot` 技能，它连的是同一个 Origin MCP（venv 解释器 + `origin_mcp_server.py`），**绝不抢占或重启你正在用的那个实例**。

## 7. 升级与卸载

- **面板里直接查更新**（0.3.12 起）：工作台页头的「检查更新」会读本机 `package.json` 与 GitHub 上的版本比对，有新版本时旁边出现「更新到 vX.Y.Z」。
  - 该功能只对**干净的 git 工作树**生效：`system.update_apply` 先检查 `git status`，仓库有未提交改动会拒绝并列出文件；`git pull --ff-only` 分叉时如实返回 git 的原话，不吞错。
  - 更新后**宿主半边当场生效，面板要重启 Harness**（客户端 bundle 不热替换）。
  - 从 ZIP 解压 / `install-plugin.mjs` 链接进来的目录不是 git 仓库，面板会提示「不是 git 工作树」，此时按 ZIP 方式重装。
  - 等价命令：`system.update_check`（只读）/ `system.update_apply`（写，走计划 → 确认 → 回执）。
- **升级（手动）**：重新 `dsh plugin … add github:58catmiao/dsh-sciwork`，或在源目录 `git pull` 后重启 Harness。
  技能与库骨架重跑 `node scripts/install.mjs` 即可（幂等）；库数据不会被覆盖。
  改过库里工具脚本的现场修复不会被静默回退，除非显式 `--force-scripts`。
- **卸载插件**：用 DSH 的插件管理移除该 bundle，然后重启。技能与库数据不会跟着消失。
- 技能目录需要手工清理时，只删本包那 5 个技能目录。

## 8. 常见问题

**装的时候报 404 / 「找不到 dsh-sciwork」**
这个包没发布到 npm，安装源要写成 `github:58catmiao/dsh-sciwork`。

**装的时候报「npm 找不到」/ 本机没有 pnpm**
`dsh plugin` 把参数转给 pnpm 执行。没有包管理器就走 `scripts/install-plugin.mjs`（见 §2.1b），它只用 Node 内置模块。

**面板里点了按钮只回一句「未知动作：xxx」**
宿主半边是启动时读进内存的。改了 `lib/*.js`（含 `library.js` / `import.js`）或 `cordis.patch.yml`
之后必须**重启 Harness**，只刷新页面会变成「新按钮 + 旧宿主」。

**点了「检查更新」说不是 git 工作树**
这份安装是 ZIP 解压目录或 `install-plugin.mjs` 链接进来的，没有 `.git`。面板不能替它 `git pull`，
重新解压新版再跑一遍 `install-plugin.mjs` 即可（库数据不受影响）。

**「科研模式 · Research（加载失败）」**
preset 里某一行缺了必填字段，导致该行 schema 校验失败、整个 preset 被标成 broken。
`cordis:group` 的**子行不是黑盒**，顶层行校验查不出来。改完必须跑补丁预检脚本，
并对照 DSH 自带的同构 preset 逐字核对 config 键。

**面板找不到库**
确认 `SCIWORK_LIBRARY`（或旧名 `RESEARCH_LIBRARY`）指向的目录存在，或检查
`<库根>/.research/config.json` 里的 `libraryRoot`。

**Origin 相关操作超时**
首次连接会自动启动 Origin，需要 5~45 秒，这是正常的。页面很多时单次操作可能几十秒——
先 `origin_pages_gc` 的 `dry_run` 向用户报告页数，不要擅自清理。

**`check-citations` 非零退出**
正文里有未登记的引用键（会列出 `unknown`）。它的 `caveat` 必须照实转述：
**它只证明引用键存在且带 DOI/URL，不证明被引文献的内容支持那句话。**


## 从 0.2.x 升级到 0.3（迁移步骤）

0.3 不改变库里的数据文件格式，但会给每个课题补一份 `project.json`（阶段/产物/历史）。
**先备份，再迁移，最后核对**；迁移只读计划先看一遍。

1. **打备份**：面板「工作台 → 备份」或 `system.backup`（无需参数）。产物是
   `<库根>/.research/backups/` 下的 zip + 同名 `.manifest.json`（逐文件 sha256）。
2. **验备份**：`system.backup` 的返回值里 `verified: true` 且 `manifestFiles` 与 `files` 相等；
   不相等就别往下走。
3. **看计划**：`system.migrate` 带 `plan: true`（或面板「生成迁移计划」）。它只读，返回
   `{projects, upgrade, writes}`——确认 `writes` 里有你预期的课题，没有意料之外的文件。
4. **执行**：再走一次两步确认（`action.plan` → `action.confirm`）。执行时如果备份还没做，
   会**先建备份再迁移**；单课题失败只回滚该课题，其它课题继续，结果写进 `.research/migration.json`。
5. **核对**：`project.list` 里所有课题 `needsSchemaUpgrade: false`；抽一个课题 `project.get`
   看 `stage` 与 `artifacts`；再跑一次 `system.migrate`（plan）应显示 `upgrade: 0`（幂等）。
6. **回滚**：真出问题用 `system.restore` 指向第 1 步的 zip，**只能恢复到空目录**——先确认目标目录
   为空，核对完再切回去。这是故意的：恢复不允许覆盖现有库。

> 复制/搬移库的注意：库内 `.research/config.json` 的 `libraryRoot` 优先级最高，**副本要改这一项**，
> 否则副本上的操作会写回原库。迁移演练建议在副本上做，核对通过再动真库。


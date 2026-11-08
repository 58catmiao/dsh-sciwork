# Changelog

本文件记录 `dsh-sciwork` 的公开变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.4.10] - 2026-11-08

科研库根目录终于能在面板里改，而且改完不会再被插件升级冲掉。

### Added

- **面板「设置 → 科研库」**：显示当前库根、它由哪一层配置说了算（库内 `.research/config.json` / 环境变量 / 面板设置 / 随包快照 / 默认位置），可直接改库根并落盘到用户级 `<DSH_HOME>/sciwork/config.json`。保存走「计划 → 确认」两步（先摆 diff 与提醒，再带一次性令牌写入），写完立刻读回复核。目录不存在时默认拒绝，勾「目录不存在则新建」才建（只建目录、不铺骨架），并提示用 `scripts/install.mjs --library-root <路径>` 初始化。
- **动作 `settings.library` / `settings.library_root_set` / `settings.library_root_clear`**（工具 `sciwork_settings_library`、`sciwork_settings_library_root_set`、`sciwork_settings_library_root_clear`）：面板、agent、CLI 三处共用同一套。只读视图会把「环境变量正压过面板设置」「这个目录还不是科研库」「库内启动器不存在」直接说成人话，并列出完整优先级。

### Changed

- **库根优先级新增用户级一层**：库内 `.research/config.json` ＞ 环境变量 ＞ **用户级 `<DSH_HOME>/sciwork/config.json`** ＞ 随包 `library/config.json` ＞ 默认 `<用户目录>/Research`。以前库根只存在包内的安装期快照里，`pnpm install` / 升级插件会整个换掉包目录，用户配好的库位置随之丢失——面板报「科研库根目录不存在：…/Research」正是这么来的。用户级配置在包外，插件升级、重装都活得过。
- `loadSettings()` 返回值新增 `rootSource` / `envRoot` / `userRoot` / `bundledRoot` / `userConfig` 五个字段（面板据此解释「改了为什么不生效」），原有字段与语义不变。

### Tests

- 新增 `scripts/test-settings.mjs`（29 通过 · 0 失败）：全程隔离在临时 `DSH_HOME` 里跑，不碰真实 `~/.dsh`；覆盖五层优先级、令牌缺失/重放、绝对路径与目录存在性校验、新建目录、清除回退与幂等空操作。门禁 22 → 23 项。
- `scripts/selftest-client.mjs` 新增 14 项断言（现 266 项）：设置 → 科研库栏能读现状、列出五层优先级、保存先发计划、确认时原样回传 `actionId/planId/token/params`、环境变量压过面板时给出警告、没有用户级配置时「恢复默认」不可点。

## [0.4.9] - 2026-11-08

修掉切到 npm 包名后桌面重启崩溃的问题。

### Fixed

- **桌面重启崩溃（`web boot: 1 entry did not activate`）**：客户端 bundle 的注册 id 还停在旧包名 `dsh-sciwork`，与包名 `@58catmiao/dsh-sciwork` 不一致，DSH 的 client-modules 把同一模块注册两次并抛 `duplicate factory registration for "dsh-sciwork"`。现在 `lib/client.js` 的注册 id 与包名一致，`cordis.patch.yml` 的插件行名也恢复为 scope 包名。

### Tests

- cycle 22 项全绿；本机 desktop 以 npm 包安装后重启验证。

## [0.4.8] - 2026-11-08

发布到 npm，包名改为 `@58catmiao/dsh-sciwork`。

### Changed

- **npm 可安装**：包名从 `dsh-sciwork` 改为 `@58catmiao/dsh-sciwork`。插件页或终端写包名即可，不必再带 `github:` 前缀；想跟最新 `main` 仍可用 `github:58catmiao/dsh-sciwork`。
- **npm 包只带两份公开文档**：`docs/INSTALL.md`、`docs/ARCHITECTURE.md`。RELEASE、CYCLE-14D 等内部规划只留在仓库，不进 tarball。
- 市场索引、安装脚本与门禁断言同步到新包名；`scripts/install-plugin.mjs` 会创建 `node_modules/@58catmiao/dsh-sciwork` 的链接。
- `cordis.patch.yml` 里的插件行名与 `market/plugins.json` 的插件名同步为新包名。

### Tests

- `test-install` 新增包名与 docs 排除断言；cycle 22 项全绿。

## [0.4.7] - 2026-11-07

三条「装了却用不了」的安装面缺陷。备份/恢复在当前这台机器上是整条断的，另外两条让库里的 `analyze` / `annot` 静默失效——都是门禁照绿、用户那边直接不可用的那类。

### Fixed

- **备份/恢复整条不可用（`tar` 从 stdin 读 zip 解出空目录）**：`extractInto` 以前把 zip 从 stdin 喂给 `tar -x -f -`，本机 `C:\Windows\system32\tar.exe`（bsdtar 3.8.9）回 `tar: (null)` + `Error exit delayed from previous errors`、退出码 1，解出来是个空目录；于是每次备份都停在 `createBackup → verifyArchive → extractInto`，报 `bad-request`。现在改成把归档路径交给 `tar`、`cwd` 设为目标目录；跨盘（相对路径带盘符）时先 `copyFile` 到目标目录的 `.sciwork-extract-<pid>-<ts>.zip` 再解、`finally` 删副本——不再依赖 stdin，也不再依赖临时目录可写。
- **库里脚本停在旧版时 `analyze` / `annot` 直接不可用**：`pickScript` 以前无条件优先库内 `.research/scripts/research.py`，而新版脚本是按**自己所在目录**懒加载 `analysis.py` / `annot.py` 的；库里那份只要停在旧版，两个子命令就根本不存在。现在三条都满足才用库内那份：文件存在、不比 bundle 旧（先比内容，字节一致即同版；不同再比 mtime）、引擎也在位（`missingEngines()`）。任一不满足回退 bundle 的整套；bundle 自己缺引擎（拷一半的安装）时保留库内那份，别把仅有的能跑组合换掉。
- **安装漏 seed `annot.py`**：0.4.0 发版时 `scripts/install.mjs` 的 seeds 里少了 `annot.py`，装完面板的 `annot` 永久「找不到标注引擎」，而门禁只跑 bundle 里的脚本、安装面没人测，所以一直绿。现在 7 条 seed 与 `library/scripts/` 的 7 个脚本一一对应。

### Tests

- `test-install` 44 → **61 通过 · 0 失败**：新增 `[5] 库脚本种子（临时库真装一次）`（真装一次、断言 6 个脚本都在位、装进去的 `research.py` 与随包模板字节一致、`config.json` 的 `libraryRoot` 校正到临时库）与 `[6] 脚本选用（库内 vs bundle）`（一致时用库内 / 落后回退 bundle / 同版但缺引擎回退 bundle / bundle 也缺引擎时保留库内）。
- **回归证明**：把 HEAD 版 `lib/backup.js` 换回去跑 `test-projects`，`[6] 备份/恢复` 整节崩在 `at tar (lib/backup.js:75)`；换回修复版 `36 通过 · 0 失败`。
- 门禁仍是 22 项（没有新增项，`test-install` 那条本来就在）。

## [0.4.6] - 2026-11-01

三条用户实测反馈（SVG 图问不了、笔记删不掉、对话多了存笔记的确认层被挤乱）+ 一轮照 `DESIGN.md` 做的界面收拾。

### Fixed

- **整图是 SVG 时整次提问失败**：宿主 `attachments.saveImage` 只收 `image/png|jpeg|webp|gif`，而科研库里的图件常用 SVG。以前把 `data:image/svg+xml` 原样递上去，宿主报「第 2 张图的类型（image/svg+xml）宿主不认识」，整次提问作废。现在面板先用 canvas 把整图栅格化成 PNG（长边 1600、先铺白底，免得透明底变黑块），转不了就明说「整图转位图失败，这次只带上了圈选的那一块」，不再整次失败。
- **笔记不能删**：新增 `notes.delete`（写动作、要确认、工具名 `sciwork_notes_delete`）。**不做物理删除**：移进 `projects/<课题>/notes/.trash/<时间戳>-<原名>`，同一分钟重名补 `-2`、`-3`，返回 `trash` 路径随时能捞回来——与 `library.archive` 的可恢复口径一致。笔记面板每行多了「删除」，走同一条「计划 → 确认」两步。
- **确认弹层的说明文字永远是那句令牌提示**：`issuePlan` 只带了 diff / writes / warnings，`preview.summary` 在半路被丢掉。现在 `issuePlan({ …, summary })` 原样带上，弹层能说清「这次到底要写什么/挪什么」——这也是「存笔记的确认界面看着不对」的一半原因。

### Changed（界面，照 `DESIGN.md`）

- 图卡正文改成两列：左边信息、右边图与对话。以前元信息独占整行、下面留半屏空白，看着像没渲染完。
- 元信息只显示文件名，整条路径收进悬浮提示；`源数据存在性` 在没有源数据时不再占一行空字段。
- 对话默认只摊开最近两条，其余收进「查看全部 N 条」，展开后限高 `min(60vh, 640px)`，不再被 320px 切掉半张卡、也不会把整页顶走。
- 跨课题待办的「要做什么」不再把动作 id 摆在界面上（那是给 agent 的指令），改成悬浮提示；`generated` 指令文本里照旧带 id。
- 21 个文字按钮不再落成浏览器默认的 13.3px：`Btn()` 以前被调用方的 `className` 覆盖掉 `rl-btn` 基础类，现在拼在一起。
- 设置弹层终于有 720 宽（`.rl-wbcard.rl-settings`），左边导航 150px、右栏不再挤成两个字一行。
- 确认弹层：标题从「确认写动作：…」改成「确认执行：…」，底部按钮 `position:sticky` 贴住卡片底边，清单再长也不用滚到底才点得到；`notes.save` 的摘要不再重复念同一份路径。
- 笔记页正文用回 `.rl-pre`（以前那个 `.rl-draft__body` 从来没有对应规则，正文一直吃浏览器默认样式）；预览标题只显示文件名、整条路径进悬浮提示；页头不再写 glob；切课题的选中项只换文字与描边色，不再吃默认按钮样式。
- 选中课题不再打 3px 光晕闪 900ms（`DESIGN.md` 明令禁发光），只换描边色。


### Tests

- `selftest-live` 35 → **51 通过 · 0 失败 · 6 跳过**：新增「整图 SVG → 先栅格化成 PNG 再问（假 attachments 记录 `saveImage`，断言 mime 与像素是转换结果，界面不许出现 svg 类型报错）」「对话 5 条只摊开 2 条、能展开能收起」「笔记行有删除、确认层写明进回收站、盘上少一条、`.trash` 里躺着一份」。
- `selftest-actions` 200 → **202 通过**：notes 第 12 节补 `notes.delete` 一组（描述符、计划摘要含「回收站」、真删后目录与 `.trash` 内容逐字一致、列表不再列出、同分钟撞名不覆盖、删不存在的 → not-found、`../escape.md` 被拒）。撞名那条走文件层（`notesLib.deleteNote`），因为走 dispatch 会命中 10 分钟幂等窗、第二次同参数直接返回上次回执。
- `selftest-client` **252 通过**：待办表那条断言改成「动作 id 在悬浮提示里」，界面上不再有 id。
- 门禁仍是 22 项。

### Notes

- 新增 `tools/preview/build-preview.mjs`：把真 `lib/client.js` 装进一个可截图的预览页（假宿主），一次出 8 张场景图（首页 / 课题 / 图 / 草稿 / 笔记 / 设置 / 6 条对话 / 存进笔记确认层）。改界面前先看图，比凭感觉改稳。`node tools/preview/build-preview.mjs`，9 秒出全套，支持 `--only` / `--size` / `--no-shot`。
- 预览页在真 DOM + 真 CSS 下跑：`--rl-*` 变量、`light-dark()`、SVG 这些 Node 假节点树覆盖不到的东西，这次一并验过，8/8 场景零运行时错误。
- 已知未做（下一轮再看）：草稿页与笔记页仍直接显示裸 Markdown（`#`、`![](…)` 原样）；首页「最近回执」还是英文 action id；chips 里一半是 0 也照排。

## [0.4.5] - 2026-11-01

0.4.4 让「没反应」变成「吭一声」。这一版顺着那声吭继续往下查：真宿主里到底为什么一个字都没回来。

### Fixed

- **问模型只剩「模型这次没有返回任何文字」**：0.4.4 只认 `chunk.type === 'text-delta'`，可 DSH 的 `StreamChunk` 里**根本没有** `{ type: 'error' }` 这一种——按宿主契约，适配器选择、派发、迭代失败都会变成终态 `finish{ reason: { kind: 'error' | 'aborted', failure } }`，一条 text-delta 都不给。于是 401、限流、模型不支持图片全被当成「空回答」，真实原因（`invalid api key` / `401`）被吞掉。现在逐个读 `finish.reason`：`error` / `aborted` 一律翻成人话抛出（`模型出错：invalid api key（auth / 401）`），`max-tokens` 追加「回答到长度上限被截断」，真的空流才说「一个字都没返回」；`block-end` 里的整块文本也当兜底收下。
- **带图提问必然失败（图片内容块的形状是错的）**：DSH 的图片块是 `{ type: 'image', attachment: ImageAttachmentRef }`，引用只能由 `ctx.attachments.saveImage({ data: Uint8Array, mediaType, name })` 生成。0.4.4 在渲染进程里直接拼 `{ type: 'image', source: { type: 'base64', … } }`——那是别的 SDK 的形状。图一进适配器整次调用就断，再被上一条吞掉原因，于是「问完模型没反应」。现在 `llm.chat` 自己登记附件（新增 `lib/host/host-services.js` 的 attachments 桥 + `lib/index.js` 的 `mountAttachments`），逐张校验类型与 `imageLimits.maxImageBytes`，拿不到附件服务就明说「这次带着图，但宿主没给图片服务：重启 DSH 再试，或者先把问题写成文字」。
- **面板不再去敲渲染进程的 `llm` 服务**：client 侧的 Service 目录里只有 layout / locale / sessions / slots / theme / timer / uiWorkspace / workspaces，**没有 llm**（`cordis_inspect_query` 实测「no catalogued Service named "llm"」）。0.4.2–0.4.4 里那条 `ctx.get('llm').stream()` 优先分支是死路，现在删掉：一律经宿主 `llm.chat`，图片交给宿主登记，失败原因由宿主翻译。
- **门禁自己会随机红（`重开后直接进库`）**：`selftest-client` 那条断言用固定 8 轮渲染等库索引，门禁并行时机器忙，偶尔还停在「正在载入库索引…」就判红。现在最多再等 6 轮，等得到才判——放宽的是等待，不是断言。
- **`check-local-info` 永久红**：它连**已经推上去**的提交信息一起扫，而推出去的提交信息改不动（只能强推重写历史）。0.4.4 发布的 `c7e9663` 提交信息里写了本机临时目录，于是之后每次门禁都红。现在提交信息只扫 `--not --remotes`（还没推出去的那些），文件内容照旧全扫；输出里把「已推送 N 条不再扫」写清楚。

### Tests

- `selftest-live` 的假 llm 换成**真契约**：`stream()` 同步返回 `AsyncIterable`，chunk 是 `block-start` / `text-delta` / `block-end` / `finish`，失败形态是「只有 `finish(reason.kind='error', failure)`」；另加假 `attachments` 服务（记录 `saveImage` 调用与 `imageLimits`）。用例 `35 通过 · 0 失败 · 6 跳过`（0.4.4 是 31 条）：新增「失败原因必须露在界面上（invalid api key / 401）」「带图提问 → `saveImage` 被调用、内容块是 `{type:'image',attachment}` 且没有 `source`」。
- **回归证明**：把 `lib/actions/llm.js` 换回 0.4.4 那一版再跑 → `7 失败`（`未知参数：images` 五条 + 回答没出现 + `saveImage` 没被调用）；随后还原，md5 一致。
- 门禁仍是 22 项（没有新增项，只是把真联调那项加厚）。

## [0.4.4] - 2026-11-01

一轮「用户报的两条没反应」+ 把它们钉进最缺的那层测试。

### Fixed

- **存笔记点了没反应（笔记页与图卡「存进笔记」两条路）**：计划弹层的「确认执行」按钮直接把 `onClick` 的鼠标事件当参数递给确认回调（`lib/client.js:2771` `onClick: props.onConfirm`），宿主按参数哈希校验，收到的是 `{type:'click',target:…}`，于是回一句 `未知参数：preventDefault`，笔记一个字节都没写进盘。现在按钮只传「点了」（`onClick: function () { props.onConfirm(); }`），图卡那条路同时把待存的 `{project, text}` 收进 ref，确认时按原样取用——参数哈希与计划一致，不再事后重拼。
- **问完模型后没反应**：圈选问模型/画图对话的 `send()` 只认 `chunk.type === 'text-delta'`，一旦宿主一条 `text-delta` 都没有（模型不支持图片输入、回答被截断、只出了 reasoning），`acc` 停在空串，界面就是一片空白——没有回答也没有报错。现在空结果一定给人话（有模型清单的说明就用它，否则提示「可能是这个模型不支持图片输入，或回答被截断」），并把这条提示写进对话气泡。
- **模型流不可迭代就整段失败**：DSH 客户端 `stream()` 的签名是 `Promise<AsyncIterable>`，以前不 await 直接 `for await` 会抛 `stream is not async iterable`，界面上表现为「点完没反应」。现在先 await，拿到的如果不是可迭代流但带 `text` 就整段当回答，两者都不是才如实报错；同步可迭代器（老夹具形状）照旧支持。
- **等模型永远等下去**：整段流加了超时兜底（默认 120 秒，`window.__sciworkChatTimeoutMs` 可覆盖，测试用它把等待压到 120 毫秒），超时后提示「等模型超过 N 秒还没回：检查网络，或到「设置 → 模型」确认这个提供方还能用」，按钮回到「问模型」。

### Tests

- 新增 `scripts/selftest-live.mjs`——**真联调**：微缩 React 渲染真 `lib/client.js`，面板的 `rpc.call` 打到真 `lib/index.js` 的同一条路由，再经真 `lib/actions.js` / 真 dispatch / 真计划令牌 / 真回执写进临时库（只有 DSH 宿主的模型服务是假件）。九个场景：动作层计划+确认、笔记面板整条链路、图卡问模型（宿主 `llm.chat` / 同步流 / `Promise<AsyncIterable>` 三种）、图卡存进笔记、空流必须吭声、卡住的流必须超时收场、46 个动作冒烟（读动作直调、写动作只出计划）。实测 `31 通过 · 0 失败 · 6 跳过`；`--real <库根>` 只读巡检 `6 通过 · 0 失败`。
- **回归证明**：把 `lib/client.js` 换回修复前那一版再跑同一脚本 → `24 通过 · 7 失败`，七条正好是这两个 bug 的面孔（`stream is not async iterable`、`未知参数：preventDefault` 两次、盘上没有新笔记、空流一片空白、超时后没提示、按钮一直「等模型…」）。
- 自检收尾不再往系统临时目录里留空壳：`selftest-actions` 里有个动作的收尾写入是异步的，会在 `finally` 删掉临时根之后才落盘、把目录又建出来（每跑一次门禁丢一个）。现在 `ownRoot` / `notesRoot` / `auditRoot` 都挂了 `process.on('exit')` 钩子，退出时同步再删一次（退出时不该还有写入在跑）；`selftest-live` 的 `rmSync` 也加了重试。
- 门禁 `scripts/cycle.mjs` 21 → **22 项**；CI（`selftest` 矩阵）也加了一步「Real wiring self-test」，干净机器上同样跑这条真联调（它自己建临时库，不碰任何真库）。已有 `scripts/e2e-panel.mjs` 只判定「点了有没有发 RPC / 界面指纹变没变」，不校验参数与返回值——0.4.0 的「confirm 漏 actionId」、这次的「事件对象当参数」都是它全绿、用户那边没反应；这一项专门补这个缺口。

## [0.4.3] - 2026-11-01

### Fixed

- **CI 上的空库断言**：0.4.2 的 `selftest-client` 有九条断言默认「库里一定有课题」，在干净机器（库根是空目录）上必然失败：页头计数、新建草稿三条、数据页「变换」入口、批量导入两条、数据卡「变换」按钮。现在按库里实际有课题才跑，空库改断言页头说的是「还没有课题」而不是「0 个课题」。
- **`selftest-actions` 同样 tolerant**：没有 `journals/` 时「期刊档案 >0」记跳过；随包 `library/` 缺 `config.json` 时「写动作隔离自检」记跳过，不再把环境缺内容当代码错。

### Tests

- 门禁 21 项在**空库**与**真库**两种库根下都全绿（空库：client 224 · action 124 · 端到端 93 元素；真库：client 252 · action 194 · 端到端 87 元素）。

## [0.4.2] - 2026-11-01

### Added

- 顶栏「设置」：左栏分栏（模型 / 习惯 / 本地数据 / 关于），加栏目只需往 `SETTINGS_SECTIONS` 里加一项。
- 宿主动作 `llm.info`：汇总 DSH 里已配置的提供方与模型（`inputModalities` 含 image 的标能看图），设置与圈选问模型共用。
- 宿主动作 `llm.chat`：面板拿不到宿主流式接口时，退到宿主侧一次性拿整段回答。

### Changed

- 「问模型」不再读渲染进程里的 `ctx.get('llm')`（那里在部分版本是空的，表现为「宿主里没有已配置的模型」），改走 `llm.info`。
- 设置项只留真的会生效的：默认页签、Alt+Q 开关、画图对话缓存清理、默认模型。

### Fixed

- 关于页的版本号读不到时显示「—」：改成弹层自己取一次 `system.update_check`（`remote:false`，不联网）。
- `llm.info` 拿不到宿主模型服务：动作执行上下文里没有 Cordis 插件上下文（`ctx.llm` 永远是空）。改成在插件 `apply()` 里把 `llm` 服务挂到 `lib/host/host-services.js` 的桥上，动作从桥上取；`inject(['llm'])` 兜住服务晚于插件出现的情况。
- 回归锁：`scripts/selftest-actions.mjs` 新增 [14] 节（6 条）——桥默认空、没接桥时说人话、接桥后能列出模型、能看图的标 `vision`、模型带 provider、卸载后桥回到空。

## [0.4.1] - 2026-11-01

### Changed

- **「检查更新」挪到版本号旁边**：它原来是页头按钮组里的第五个按钮，和「快速登记 / 新建课题 / 导入数据 / 刷新」挤在一起；现在跟着页脚那行「插件 vX.Y.Z · 提示」走，页头只留干活的动作。按钮仍然只在需要时出现新版入口（「更新到 vX.Y.Z」）。

### Fixed

- 版本行的两行页脚（最近回执 / 版本）都用 `rl-wb__recLine`，新版把「检查更新」放进版本行后，自检断言能区分这两行、不会认错。

### Tests

- `scripts/selftest-client.mjs` 241 → **243**：新增「检查更新在版本号那一行里」与「不再留在页头按钮组」两条回归锁，防止以后有人又把它挪回去。
## [0.4.0] - 2026-10-31

### Added

- **文件重命名（`library.rename`）**：图表 / 草稿 / 数据 / 文献行都能改名，走「计划 → 确认」两步。图件改名会把同目录同基名的 `.png/.pdf/.svg/.tif` 与侧车一起改、并重写侧车的 `file`/`files`；普通文件改名后会扫图侧车的 `sourceData` 跟着改，改前留同名 `.bak`；支持只改大小写；目标已存在直接报冲突，不覆盖。
- **「笔记」页签（`notes.list` / `notes.read` / `notes.save`）**：读写 `projects/<课题>/notes/*.md`，保存前自动留 `.bak`；不给文件名时按 `YYYY-MM-DD-HHmm-<标题>.md` 自动起名。覆盖写同样走「计划 → 确认」。
- **数据血缘**：工作台课题详情里列出「数据 → 图」（按侧车登记的源数据算）、没被任何图引用的数据、以及图指向的源数据是否还在。纯前端从快照算，不发请求。源数据比对三种口径（整串 / 去掉扩展名 / 目录前缀）——侧车普遍登记成不带扩展名的 `data/ZT-1100-2h`，只比整串会把整库数据误报成「没用上」。
- **可复现性审计（`library.audit`，只读）**：检查图侧车缺参数、侧车没登记源数据、源数据指向的文件不存在、图文件缺失、数据文件没人引用、期刊档案缺关键字段、草稿引用键在 `refs.json` 里找不到。工作台底部「检查一遍」出结果，按错误 / 提醒分色，最多列 8 条。
- **峰分析（`research.py analyze`，纯标准库）**：扣基线（min / ends 首末联合拟合）+ 找峰 + 每峰高斯与洛伦兹 LM 拟合，产物写 `tables/<名>_peaks.csv` 与 `.research/transforms/` 侧车。实测双峰峰位误差 0.0003°、半高宽相对误差 0.5%。重叠峰不做联合解卷积，会如实附警告。
- **矢量标注层（`research.py annot`，纯标准库）**：`add` 往 `.research/annot/<图号>.json` 加 rect / arrow / text / point 标注（坐标一律归一化 0..1，越界直接报错、不悄悄夹取；覆盖前留 `.bak`），`render` 把标注烧成 `<基名>.annot.svg`（原图 `<image>` + 标注层 + 自带一份标注 JSON 的 `metadata`，画布跟原图 viewBox，负 min-x 也对）。按用户要求**不给面板按钮**，由 AI 调 CLI 完成。
- **圈选问模型（悬浮窗）**：顶栏「圈选问模型」按钮或全局 `Alt+Q` 调出一层浮窗（Esc 或点背景关闭），窗里选课题、选图，直接在图上拖出一块，就着「选区 + 整图 + 该图侧车」问宿主已配置的模型，回答流式显示；模型只给判断和改动计划，不执行任何写动作；对话按图留在本机，可一键「存进笔记」。图卡展开后的圈选仍然在，两处是同一份实现。
- **页签收成主标 + 更多**：主标只留工作台 / 图表 / 数据 / 草稿 / 文献 / 笔记，期刊档案 / 投稿 / 归档与命令台、引导、版本开关收进「更多」；顶栏不再横向滚动，搜索框旁边那根没用的滚动条随之消失。
- **端到端巡检 `scripts/e2e-panel.mjs`**：遍历所有页签的可点元素逐个点击，判定口径是「发出 RPC 或界面确实变了」，全部用假宿主、不写盘；支持 `--only <页签>` 只测一页，已接进门禁（当前 85 个元素 · 0 失败）。

### Changed

- **工作台首页去掉「概览」五张卡片，改成一屏能读完的三段**：页头一行报计数（课题 / 图 / 文献 / 在投 / 就绪），中间是跨课题待办表，下面是课题两栏。原来「今日该做 / 投稿倒计时 / 库体检 / 最近动态 / 备份」五张等高卡片里三张常空着，靠按钮撑高度；现在今日该做并进待办行、投稿截止按到期日排进同一张表（过期标红、三天内标黄）、库体检与快照告警合成页脚上方一处提示（干净时一行都不占）、最近变动收进课题详情。指标条四格与「概览」标题一并删除，页头的刷新与待办区的刷新合成一个，页头版本行移到页脚。
- **配色改贴宿主 DSH**：去掉米白底与琥珀色大数字，换成中性灰阶 + 单一蓝（`--rl-ac` 明 `#3a68d4` / 暗 `#5b8cf0`），成功 / 警告 / 错误只表状态、不再当强调色；卡片不再有彩色左竖条，hover 不再位移与投影。全页字号收到三档（12 / 14 / 16），圆角 6 / 8 / 12。
- **欢迎卡与导览跟着新结构重写**：欢迎卡的三张 ①②③ 卡片改成三行说明（总览 / 读取与写入 / 写入边界），导览 15 步 → 17 步，新增「跨课题待办」「课题详情」两步，各步文案按现在的页头计数、待办表、详情栏重写。

### Fixed

- **写动作点下去必定失败（重命名 / 笔记保存 / 图卡「存进笔记」）**：三处调 `action.confirm` 时漏了 `actionId`，宿主直接判 bad-request。现在统一走一个 `confirmPlan()`，参数与 `{value, receipt}` 的拆包都在一处；客户端自检加了回归锁，端到端巡检的假夹具也改成校验 `actionId/planId/token`——原来它只回一句 `{summary}`，所以三处漏参照样「全绿」。
- **数据变换的产物 CSV 会写成坏表**：`parseTable` 给的分隔符是名字（`comma` / `tab` / `space`），写回时被当成真字符拼进文件，产物变成 `1comma2comma3`。现在写盘前先换成真分隔符（`lib/transform.js` 的 `delimChar`）。
- **变换参数空串会静默算错列**：表单里的空串被 `Number('')` 当成 0，「没选 Y 列」就变成了「拿第 0 列当 Y」——算错还不报错。现在空串一律当没填，Y / X 列越界也直接报错。
- **读不到变换算子清单时下拉框空白、点「生成新表」毫无反应**：`transformOps` 的失败被吞掉了。现在失败会写在弹层里说清楚。
- **`ends` 基线只拟合首段**：`lib/transform.js` 写成 `fit(head) || fit(tail)`，末段根本没参与；而 Python 侧已是首末联合拟合。现在两端口径一致：首段与末段按原索引顺序拼成一组点、一次最小二乘拟合一条线（一端 X 全缺才退回那一端），合成曲线首末段残差均值都回到 0，两端异斜率那组末段残差从 94.5 降到 2.376。
- **圈选时拖动图片会弹出导入弹层**：`<img>` 默认是可拖放源，在图上按住拖一段做选区、松手时面板收到一个「文件」，直接打开导入弹层——圈选变成了导入。图区的图片现在关掉了原生拖拽（`draggable: false` + `-webkit-user-drag: none`），松手只做选区。
- **窄屏（≤860px）下「跨课题待办」表塌成竖排单字**：`.rl-table__row` 的 grid 列宽不降级，390px 宽时一行标题被挤成一列字。现在窄屏下每行改成两列（标题 / 阶段标签 + 到期），「要做什么」与操作各占整行，表头行隐藏。
- **图表 / 数据页的分组卡片套在页面卡片里，两层边框**：分组改成靠间距分隔，不再自带边框与底色。
- **每行图表都挂一个「自检未知」徽章**：没跑过自检就什么都不显示，真跑过才有「自检通过 / 未通过」。
- **行内「删除」用红色描边排在最显眼的位置**：改成安静样式（灰色，悬停才转红），与「归档 / 展开」同一层级；真删仍要先输入文件名。
- **「还没有登记任何投稿记录」直接甩一条完整命令行**：改成一句人话（「快速登记」里选「登记投稿」），不再在面板里展示 `research.py` 的参数表。

## [0.3.16] - 2026-10-31

### Fixed

- **`origin/` 与 `opju/` 里的导出图、说明文件被当成 Origin 工程**：扫描这两处时 `walkFiles()` 没传扩展名白名单（同一个函数里数据表与表格都传了），于是 png / txt / 备份件全进了「工程」列表——概览的「N 个工程」虚高，资产页把导出的图当成工程件列出来。现在只认 `.opju` 与 `.opj`（Origin 2020 前后两种工程格式），新增 `ORIGIN_EXT` 常量。`test-projects.mjs` 加了临时库夹具（`origin/` 混着 `.opju` + png + txt，`opju/` 放一份旧版 `.opj`），断言「只数 2 个工程、非工程件不进列表」。
- **扫描窗口里被删掉的文件会把整份库快照带崩**：`origin/opju/` 与 `submissions/` 两处循环直接 `stat()` 每个条目，文件在这几毫秒里被挪走或删掉就抛 ENOENT，`snapshot()` 整份失败——面板显示「科研库不可读」，其实只是有一个文件在动。现在两处都走 `statSafe()`，返回 `null` 就跳过这一条、其余照常返回。顺带给 `snapshot()` 加了可选的 `rootOverride`（只给自测传临时库用，其余 settings 照读）。
- **只放表格或 Origin 工程的课题被库体检误报「还是空的」**：v2 工作台的「空课题」判定只看图 / 草稿 / 数据，`tables` / `opju` 已有产物的课题也报空。判定提成模块级纯函数 `isEmptyProject()`（并进 `__test` 导出），五个目录全空才算空课题。客户端自检 230 → 235 条。

## [0.3.15] - 2026-10-24

### Fixed

- **面板里点「编辑」草稿，随手保存就会把它清空**：草稿正文是展开后才异步读进来的（`readText` → `text`），但「编辑」按钮不管读到没有就直接进编辑态，而编辑框绑的是另一份 `body`（初始空串）。没点过「预览」就点「编辑」，框里是空的；再点一下「保存」，写请求就带着空正文把整份草稿写成 0 字节——原文只剩宿主保存前写的那份 `.bak`。现在「编辑」先确保正文到手才进编辑态（读失败就停在预览态、把错误显示出来），保存前再核一次正文是否到手，没到手不发写请求；正文到达前「保存」按钮也是禁用的。客户端自检 222 → 230 条，新增的回归直接挂草稿卡断言「不点预览直接编辑时框里已经是原文」「一个字没改保存，写回的是原文而不是空串」。
- **v2 工作台把「库根不可读」显示成「库里还没有课题」**：`snapshot` 在库根不存在/不可读时会自己带 `ok:false`（外层信封仍是成功），v2 载入时把它置空就没再管，页头于是写「库里还没有课题。」——等于把可诊断的故障说成空库，用户会跑去重装或重导数据。现在跟 v1 一样把原因报出来（页头「科研库不可读：…」+ 正文红条），并清掉上一轮留下的旧错；回归断言进了客户端自检（库根不可读时页面里不得出现「库里还没有课题」）。

## [0.3.14] - 2026-10-24

### Fixed

- **两处门禁并行跑会互相删掉隔离副本**：`scripts/selftest-actions.mjs` 把临时根写死在 `os.tmpdir()/research-selftest`，每次开跑先 `rm -rf` 这个固定目录再 `mkdtemp` 子目录。于是同时有两个门禁在跑时，后启动的那个会把前一个正在用的隔离副本删掉，前一个读副本的 `.research/config.json` 直接 `ENOENT`，整节「写动作隔离自检」假红（实测：一个 `79 通过 · 1 失败 · 2 跳过`，另一个 `126 通过 · 0 失败`；单独重跑又全绿，很容易被当成偶发抖动忽略过去）。现在每次运行用 `mkdtemp(os.tmpdir()/sciwork-actions-)` 建自己的临时根，跑完只删自己这份，两个门禁并发也各跑各的。新增一条断言盯着这件事（副本必须落在本次运行专属目录里），action 自检从 126 条变 127 条。

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

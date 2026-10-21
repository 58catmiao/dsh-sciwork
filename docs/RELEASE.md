# 发布与上架（维护者手册）

面向维护者，不是使用者。使用者请看 [README.md](../README.md) 与 [docs/INSTALL.md](./INSTALL.md)。

## 0. 上架前置条件（缺一不可）

| 条件 | 说明 |
| --- | --- |
| `package.json` 声明 `dsh.bundle` | 市场与 `dsh plugin add` 都靠它识别；**只声明 `dsh.client` 会被拒收** |
| 仓库里有真实可用代码 | 占位仓库、纯 README 会被拒 |
| 仓库创建满 24 小时 | 市场 CI 自动核对创建时间 |
| 仓库打了 GitHub topic `dsh-plugin` | 收录检索用 |
| 描述与代码一致 | 维护者会逐句核对，不得夸大 |

## 0.3.0 发布要点

- 版本号：`package.json` → `0.3.0`；`CHANGELOG.md` 顶部加 `[0.3.0]`。
- 门禁：`node scripts/cycle.mjs` 必须 14/14 全绿（语法、六段自检、patch 预检、本机信息零命中）。
- 兼容：24 个旧动作名与旧面板**不回归**；`selftest-client` 的 v1 用例全部保留。
- 迁移：旧库课题在第一次写动作前会提示迁移；迁移只走 `system.migrate` 的两步确认。
- 发布前自查：
  1. `git status` 干净，`node scripts/cycle.mjs` 全绿；
  2. `node scripts/check-local-info.mjs` 0 命中；
  3. `python scripts/validate-patch.py` 通过（含 6 个阶段预设）；
  4. 在库副本上跑一遍「建课题 → 导数据 → 看产物 → 跑检查」（Phase 5 验收脚本的口径）；
  5. 打 tag：`git tag -a v0.3.0 -m "0.3.0"`；不要带任何本机路径。
- 已知偏离：阶段预设的「工具范围」是人格约束，不是硬白名单（`agent-preset` 无此字段）。

## 1. 发布一个新版本

1. 改 `package.json` 的 `version`，在 `CHANGELOG.md` 顶部加一节。
2. 跑自检（**不配科研库也能跑**，内容类检查记为 `SKIP`/未运行，退出码 0）：

   ```bash
   node scripts/cycle.mjs        # 一条命令跑完下面四项 + 语法检查，并落报告到 out/cycle/<日期>/
   # 或者逐个跑：
   node scripts/selftest-host.mjs
   node scripts/selftest-actions.mjs
   node scripts/selftest-client.mjs
   python scripts/validate-patch.py
   ```

   想看内容类检查的真实基线，先把 `SCIWORK_LIBRARY` 指向一个真库再跑 actions/client。
   红项一律先修，别带着红的门禁打 tag（周期流程见 [CYCLE-14D.md](./CYCLE-14D.md)）。

3. 提交并打标签：

   ```bash
   git add -A && git commit -m "release: vX.Y.Z"
   git tag vX.Y.Z
   git push origin main --tags
   ```

   > 若本机访问 GitHub 需要代理，先设 `HTTPS_PROXY` / `HTTP_PROXY` 再 push。

4. （可选）发到 npm：`npm publish`。
   发布后市场会自动关联下载量，安装也可以直接写包名。
   **不要把 `@deepseek-ai/*` 写进 `dependencies`** —— 官方包属于宿主，必须走 `peerDependencies`；
   本插件零依赖，因此两个字段都不需要。

## 2. 上架到 DSH 插件市场

插件市场的目录数据来自精选仓库 **awesome-dsh-plugin/awesome-dsh-plugin**，线上清单是
`https://awesome-dsh-plugin.com/plugins.json`。

1. fork 该仓库；
2. 把本仓库的 `contrib/awesome-dsh-plugin/58catmiao__dsh-sciwork.yml` 复制成
   `data/plugins/58catmiao__dsh-sciwork.yml`（**一个 PR 最多 3 条**）；
3. 提 PR，等 CI 与维护者核对。

收录之后，用户就可以在设置 → 插件里看到它，或用命令行安装：

```bash
dsh plugin --profile <profile> add dsh-sciwork
```

## 3. 截图（可选，但强烈建议）

- 图片放仓库内（例如 `assets/`），仓库根写一份 `screenshots.json`（1–8 条，路径不得出仓库目录）；
- **拍照时机**：装好插件、重启 Harness 之后再截。面板 UI 改过，旧截图会拍到已经移除的按钮；
- 只拍真实功能，不要摆拍未实现的东西。

## 4. 装到一台干净机器上验证

```bash
# 1) 预检：只报告缺什么，不写任何东西
node scripts/install.mjs --verify-only

# 2) 建库 + 装技能
node scripts/install.mjs

# 3) 装插件（包名 / GitHub URL / 本地路径都行）
dsh plugin --profile <profile> add <本仓库路径 或 dsh-sciwork>

# 4) 起 Harness，侧栏应出现「科研库」
```

注意：`lib/*.js` 属于**宿主半边**，改动必须**重启 Harness** 才生效；只刷新页面会得到
「新客户端 + 旧宿主」的组合。

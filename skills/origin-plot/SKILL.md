---
name: origin-plot
description: 用 Origin 从数据出图、改图、批量出图、套期刊样式的完整流程与实测坑。当用户说：画图、出图、用 Origin 画、把这份数据画出来、重画这张图、改颜色/改线宽/改字号、加误差棒、加峰位标注、多面板、3D 图、等高线、导出 600dpi、存 opju、杂志要求单栏 89mm 时使用。
---

# Origin 科研绘图

工具全部是 MCP 工具，前缀 `mcp__origin__`（本技能里写简称 `origin_*`）。共 74 个，按下面的顺序用，不要跳步。

## 0. 前置：探活与查表（每次都做）

> **参数表在这儿**：本技能目录的 `references/origin-tools.json` 是 74 个 `mcp__origin__*` 工具的**实测导出**（`serverInfo` = name `origin`, version `2.0.0`）。要某个工具的精确参数名、必填项、返回结构时**读它**，不要凭记忆写参数。

1. `origin_status` — 连接状态 + 版本能力握手。**首次调用会自动启动 Origin，5~45 秒**，这是正常的，不是卡住。返回里有 `plot_types` / `templates` / `capabilities`。
2. 启动失败或导出失败 → `origin_diagnose`（系统级自检：安装路径 / COM 注册 / 残留进程 / 导出目录权限，**不启动 Origin、无副作用**），必要时带 `connect_probe=True`。
3. 报错要分支处理 → `origin_error_codes`（全部稳定错误码 + 恢复建议）。
4. **画图前先查表，别凭记忆编参数**：
   - `origin_help` — 工具清单 + 数据格式 + 典型调用模板（离线秒回）
   - `origin_cookbook` — 场景 → 工具组合（`quick_plot` / `from_file` / `journal` / `multi_compare` / `edit` / `fit` …）
   - `origin_catalog` — 按分类的全量工具目录（文档即实现）
5. 想省掉冷启动的等待，可在用户还在说话时先 `origin_warmup`。

页会堆积，做任何批量操作前先看一眼：`origin_list_pages`（图页/工作簿/矩阵 + 短名 + 活动窗口）、`origin_list_graphs`、`origin_list_sheets`。
页数很多时用 `origin_pages_gc`（`dry_run=true` 先报告，`false` 才清理）。**实测**：793 页时 `list_pages` 要 30.9 秒、单次 `close` 要 59.2 秒，会撞 90 秒看门狗——所以页多时**先 dry_run 向用户报告，不要擅自清理**（见 §6 纪律）。

## 1. 数据进 Origin

- 本地文件：`origin_load_file` — CSV/TXT/TSV/DAT/XLSX/XLSM/XLS。中文路径与中文列名安全，编码自动探测（utf-8-sig / gbk / utf-16），分隔符自动嗅探。
- 内存数据：`origin_write_data` — `{"列名": [值...]}`，第一列自动设为 X。
- 读回来：`origin_read_worksheet`（可 `max_rows` 限流）
- 清洗/派生：`origin_column_formula`（走 Origin 表格引擎，**优先用它而不是把数据导出到 numpy 再算**）、`origin_transform`（smooth / normalize / derivative / interpolate / ln / log10 / reciprocal / exp / sqrt / abs）、`origin_filter_data`、`origin_mask_points`（置 NaN，`backup=True` 可逆）、`origin_manage_data`（sort / transpose，转置写新表、原表不动）。
- 二维网格：`origin_matrix_write` / `origin_matrix_read`（surface / contour 的大数据持久化复用）。

## 2. 画图（四条路径，按场景选）

| 场景 | 路径 | 说明 |
| --- | --- | --- |
| 常规一张图，参数已经清楚 | `origin_figure` | **首选**。一次调用完成 导入/写数 → 画 →（可选）验证 → 导出 →（可选）交付。官方自述"把 6~10 次调用收敛为 1 次" |
| 数据在文件里、要快速出图 | `origin_plot_file` | 写数据 → 画 → 导出，最常用 |
| 数据含义不确定、要先把计划给用户看 | `origin_plot_plan` → `origin_execute_plan` | plan 返回逐列画像（dtype/缺失/范围/单调性）+ 角色建议（X/Y/误差棒/标签）+ 图形元素清单；plan_id 服务端缓存，**重启失效** |
| 要可重放、可 diff、可版本化的图 | `origin_spec_export` / `origin_spec_import` | FigureSpec YAML，含 data（内联完整数据）/ plot / style / export 四节；同 spec 重导入得到同一张图。**"图+数据+参数可回溯"的首选实现**——spec 存进 `figures\` 里 |

图型选择：
- 常规：`origin_plot`（line / scatter / line_symbol / column 等）
- 领域高频模板（真机验证过的原语组合）：`origin_plot_template`（如 `stacked_spectra` 多谱线纵向堆叠偏移，XPS/UV-Vis/PL/FTIR 多样品对比）
- 3D / 等高线：`origin_plot3d`、`origin_plot_contour`、`origin_matrix_plot`（surface / scatter / contour / contour_fill / 3d_wire）
  ⚠️ **heatmap 不支持**（plotm 实测不可用，COMPATIBILITY #14）——别承诺热图，改用 contour_fill。
- 统计图：`origin_histogram`
- 从 matplotlib 迁过来：`origin_import_matplotlib`（导入 Figure pickle，提取 Line2D 的数据/颜色/线宽/符号）

### 领域模板（`origin_plot_template` 的 `template_id`，实测可用 7 个）

`stacked_spectra`（多谱线纵向堆叠偏移：XPS/UV-Vis/PL/FTIR 多样品对比）、`xrd_pattern`（XRD 三件套：Observed 散点 + Calculated 线 + Difference 下移线，可加相刻线）、`dual_y`（双 Y 轴）、`forest`（森林图：效应量点 + 置信区间 + 零参考线）、`multi_panel`（多面板纵向堆叠、共享 X）、`cycle_overlay`（多曲线同图叠放 + 渐变色：CV 多圈 / 充放电多循环）、`eis_nyquist`（电化学阻抗 Nyquist，等轴比 + 近正方形图层）。

基础 `plot_type` 实测只有 4 个：`line` / `scatter` / `line_symbol` / `column`（box、bar、histogram 已内置改走 Origin 官方模板，**不要直接传 plotxy 数字码**：204/215 在 2026b 上有已知渲染风险）。

## 3. 改图：**先看现状，再决定改哪一项**

- `origin_inspect_graph` — 只读巡检：图层几何 / 每条曲线颜色与符号 / 轴范围与字号 / 图例 / 页面尺寸。所有通道都标了单位（页面给 cm + dots + dpi，图层给 %）。
- `origin_layout_info` — 几何一次返回：数据↔像素映射（反向轴自动翻转）、轴范围、页尺寸(cm)、现有文本对象清单、图例位置。**标注/图例落位前先调这个**，用精确坐标算，别走"渲染-看图-再调"的试错循环。

改动工具：

| 改什么 | 工具 |
| --- | --- |
| 曲线颜色/线宽/线型/符号/透明度/隐藏 | `origin_edit_plot` |
| 轴标题、范围、刻度类型、网格、刻度长度、标签字体字号加粗 | `origin_edit_axis` |
| 图例 显示/字号/边框/位置/自定义文本 | `origin_edit_legend` |
| 页面与图层几何（纸张 cm、背景、图层位置与大小 %） | `origin_edit_page` |
| 删曲线 / 换数据源 | `origin_manage_plots` |
| 关/激活/重命名/隐藏/显示/复制页 | `origin_manage_pages` |
| 文本标注（峰位、条件说明） | `origin_add_text` / `origin_annotate`（批量，统一样式，逐项返回落位） |
| 辅助线（垂直/水平/斜线，Tafel 外推、零参考线、阈值线） | `origin_add_line` |
| 找峰再标注 | `origin_find_peaks` → `origin_annotate`（建议把 y 抬升量程 5% 放峰顶上方） |
| 整图套样式（排版/调色板/多序列区分，`style_mode=journal`） | `origin_apply_style` |

**课题组统一风格**：`origin_template_save` 把成品图存为样式快照 → `origin_template_list` / `origin_template_apply`（逐项返回 applied / readback_only / unverified）。`origin_template_search` 可搜 OriginLab Graph Gallery 官方模板（可下载 .zip）。
⚠️ Origin 的 `.otpu` 保存通道实测不可用（`save -i/-t/-it` 静默不落盘），所以用的是 **JSON 样式快照**这个侧车方案——不要期待能产出 `.otpu` 文件。

## 4. 核验（硬步骤，两个都要做）

1. `origin_verify_graph` — **确定性反读**：程序把图页对象属性读回来逐项比对（图层/曲线数、轴标题文本可与期望值比对、轴标题字号是否满足期刊要求…）。
2. `origin_view_graph` — 把图渲染成内联图片给你**看**（`max_width` 控制图片 token 成本）。

只用其中一个都不算检查过：反读能证明属性对，看图能证明"看起来是对的"。**没看过渲染图不许说"图没问题"。**

**`proof_level` 不要误读（实测）**：一次确定成功的出图里，`origin_figure` 同时给出了 `proof_level: "unverified"`、`proof_note: "已应用但无读回通道，须 origin_view_graph 目视确认"`、`verify.passed: true`、`verify.n_fail: 0`（10 项 check 全 pass），而它自己的 `detail` 文案却写着 `proof_level=verified` —— **字段与文案会互相打架**。判断口径：

- 以 `verify.passed` + `verify.checks` 为准，这才是确定性反读的结果；
- `proof_level` 当"样式读回等级"看：`unverified` 通常只表示颜色/线宽这类没有读回通道的项没被程序确认，**不等于图没验过**；
- 无论哪一项怎么说，**渲染图必须自己看过**（`origin_view_graph`，或直接看导出的 PNG 文件）。

## 5. 导出、交付与登记

- 出文件：`origin_export`（fmt = `png` / `svg` / `pdf` / `tif` / `emf`）
- 可继续编辑的工程：`origin_save_project` → 存成 `projects\<课题>\origin\<课题>.opju`（省略扩展名自动补 `.opju`；保存的是当前项目全部页面）
- 规整交付：`origin_export_delivery` — 建规整目录收纳图片 + 可编辑 OPJU 并逐文件核验；传 `source_path` 时在源数据同级新建 `<数据名>_Origin_<时间戳>\` 目录，**不覆盖原始数据**
- 组图交稿：`origin_export_pptx` — 图导出高分辨率 PNG 并组装 PowerPoint 页（同目录保留 PNG）
- **登记溯源（每次都要）**：

```powershell
& '<库根>\.research\bin\py.cmd' '<库根>\.research\scripts\research.py' register-figure `
  --project <课题> --file '<导出文件绝对路径>' --data '<源数据绝对路径>' `
  --graph <图页短名> --journal <档案 id> --params '{"plot_type":"...","page_size_cm":{...},"dpi":600}' `
  --opju '<.opju 路径>' --spec '<FigureSpec yml 路径>' --caption '<一句话图注>'
```

脚本会在 `figures\<figN>.json` 写下侧车，并在文件不存在时**给出警告**（警告要如实转述给用户，别吞掉）。

- **图页短名以返回值为准（实测坑）**：给 `origin_figure` 传了 `graph_name: 'E2E_UVVis'` 同时传 `data_source`（文件路径分支）时，**`graph_name` 未被采用**，实际图页是 `Graph3`、导出文件也成了 `Graph3.png`。所以后续 `origin_verify_graph` / `origin_export` / `origin_save_project` / `register-figure --graph` 一律用**返回的 `graph` 字段**，不要用自己传进去的名字。
- **输出路径必须显式给**：`origin_status` 返回的 `default_output_dir` 是**上游 Origin 插件的默认输出目录**（由上游插件决定，不在科研库里）；不显式传 `output_dir` / `file_path`，图会落到那儿，用户在库里找不到；交付一律落 `projects\<课题>\figures\`。
- **一次调用跑完整条链**：`origin_figure` 传 `data_source` + `x_column` / `y_columns` + `intent: "journal"` + `verify: true` + `deliver: true` + `output_dir`，实测 3.2 s 全绿（data 750 ms / plot 931 ms / verify 182 ms / export 367 ms / deliver 947 ms）。
- 注意 `deliver: true` 且传了 `source_path` 时，插件会在**源数据同级**建 `<数据名>_Origin_<时间戳>\` 目录（内含 png/pdf/opju），这是它的默认交付布局；要收进科研库就再显式指定 `output_dir`，并把规范副本登记进 `figures\`。

### 期刊尺寸换算（mm → cm，Origin 的 `page_size_cm` 要 cm）

| 期刊常见要求 | mm | `page_size_cm` |
| --- | --- | --- |
| 单栏 | 89 | `{"width": 8.9, "height": ...}` |
| 1.5 栏 | 120 | 12.0 |
| 双栏 / 通栏 | 183 | 18.3 |
| 半栏（部分刊） | 85 | 8.5 |
| 中文核心常见单栏 | 70~80 | 7.0~8.0 |

高度一般由内容决定，但投稿系统常限制总高（如单栏图不宜超 240 mm）。**具体数值以 `journals\<id>.json` 为准**，没有档案就问用户投哪本刊并加载 `journal-profile` 技能。
字号通常 5~7 pt（图中文字），线宽轴 0.25 pt / 数据 0.5 pt，位图 dpi 照片 300 / 线条 600~1000。这些也都以档案为准。

## 6. Origin 纪律（**绝不抢占用户正在使用的会话**）

- **禁止** `taskkill` / `Stop-Process` / 任何结束 Origin 进程的操作。用户可能正在手动改图。
- 图做完、或用户说要自己微调时，主动调 `origin_release` — 释放自动化连接但**保持 Origin 打开**，用户操作不会被自动化干扰。下次任意 `origin_*` 调用会自动重连（或用 `origin_reconnect` 显式重连，已连接时幂等）。
- `origin_pages_gc` 一律先 `dry_run=true`，把报告给用户看，**得到明确同意**再清理。
- 用户手动改过图之后，先 `origin_list_pages` / `origin_inspect_graph` 重新看现状，**不要拿改之前的假设继续操作**。
- `origin_manage_pages` 的 close / 隐藏等操作动的是用户的页，做之前说清楚要动哪些页。

## 7. 实测坑清单（踩过一次就别再踩）

1. 首次 `origin_status` 要等 5~45 秒（启动 Origin），别当成超时。
2. 页堆积会拖慢一切（793 页 → `list_pages` 30.9 s、`close` 59.2 s，有 90 s 看门狗），批量作业前后留意页数。
3. heatmap 不可用；`.otpu` 模板保存不可用（用 JSON 样式快照）。
4. `origin_plot_plan` 的 `plan_id` 存在服务端内存里，**服务重启就失效**；要长期可重放请用 `origin_spec_export`。
5. LabTalk（`origin_labtalk`）是逃生舱：不传 `graph` 时裸表达式可能静默落到错误窗口。**先用 SKILL 覆盖到的工具**，不得不用时把命令写进回复里让用户知道。
6. 误差棒必须来自真实重复测量或明确写出的统计量，**不许为了好看编误差棒**。
7. `origin_simulate` 产出的是模拟数据（返回强制 `simulated=true`），图注与报告必须注明"模拟数据"。
8. Python 侧：`python3` 是 Store 占位程序，用 `<库根>\.research\bin\py.cmd`。

9. **多实例是 high 风险**：`origin_status` 的 `known_risks` 明确写了"多个 Origin64 进程会让 COM 连错实例（LT_execute 报异常）"。所以**绝不要为了"干净"去启动第二个实例，也绝不要杀掉用户的实例**；实测与用户正开着的实例共存完全正常（`origin_running_before: true`、`connect_ms: 3 ms`、调图前后 Origin 进程 PID 不变）。
10. `origin_status` 的 `user_files` 是用户自定义路径，不是科研库；别往那儿写交付物。
11. `origin_figure` 的 `deliver: true` 会额外产出一份时间戳交付目录 —— 那是插件的交付布局，**科研库的"真源"仍是 `projects\<课题>\figures\` + `fig2.json` 侧车**，两者都要如实说明。
12. 已知上游小瑕疵（本技能已绕过，别被它带偏）：`origin_figure` 返回的 `detail` 文案可能写 "proof_level=verified" 而字段是 `unverified`；同一路径下 `graph_name` 参数不生效。
13. ★ **文本上方的横线（上划线）已根治（2026-10-13）**：那不是插件/参数问题，是 **Origin 2024 的官方渲染 bug**（OriginLab FAQ-1203，2024b 修复；激活异常也会触发）。
    - 已升级到 **Origin 2024b（build 132）**，用户实测**横线消失**；旧的 2024（10.1）已删除。具体安装路径、注册表信息与用户文件目录，一律以本机 `origin_status` 的 `capabilities.origin_version_label` / `user_files` 返回值为准。
    - 能力探测也顺手修好：`origin_capabilities` 现在能从本机 `OriginC\System\oPlotIDs.h` 提取真实图型表（实测 111 条；之前一直报"未找到 oPlotIDs.h"）。
    - **交付链已简化**：不再需要 `clean_export.cmd` / `strip_text_overline.py` / `strip_pdf_overline.py`（那套只是绕过手段）。**只保留 `check_delivery.py` 作回归闸门** —— 将来若又报 `ornaments>0`，说明出现新原因（误开旧版？换机器装了 2024？），要**重新取证**，不要直接擦。
    - 仍适用的纪律：一次导出只配一份 SVG；PNG/PDF 若要核对几何，必须与**未清理的**同名 SVG 配对。
14. ★ **出图必须显式给 `output_dir`**：`origin_status` 返回的 `default_output_dir` 是**上游 Origin 插件的默认输出目录**（由上游插件决定，**不在科研库**）。不显式传 `output_dir` / `file_path`，图就落到那儿，用户在库里找不到。交付一律落 `projects\<课题>\figures\`。
15. ★ **多实例自己处理，不要替用户杀**：`origin_status` 若返回"检测到 N 个 Origin64 进程"（>1），**把这句话原样告诉用户、让他自己关掉多余窗口**。绝不 `taskkill` / `Stop-Process` Origin（插件 `known_risks` 里 `multi_origin_instances` = high：COM 会连错实例、`LT_execute` 报错）。也不要为了"干净"去启动第二个实例。
16. **每次开工先看版本行**：`origin_status` 的 `capabilities.origin_version_label` 应为 `Origin 2024b (@V=10.1501)`。不是 2024b 就先告诉用户（横线等老问题会回来），别默默继续。

## 8. 收尾

出图完成后按这个顺序汇报：**图（渲染或路径）→ 关键参数（图型/尺寸/期刊）→ 源数据与 OPJU 路径 → 溯源侧车路径 → 未确认或存疑的地方**。然后把 Origin 交还用户（`origin_release`）。

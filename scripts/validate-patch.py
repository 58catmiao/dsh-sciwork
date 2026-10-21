#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""预检 cordis.patch.yml：语法、结构（**含嵌套 cordis:group 子行**）、以及已知的必需配置字段。

用法：
    python scripts/validate-patch.py [patch 路径]

退出码 0 = 通过；1 = 有问题（打印具体原因）。

## 为什么要递归查嵌套行（2026-10-11 实测踩坑）

旧版只遍历 `config.plugins` 的**顶层**行，于是漏掉了这一条：

    - id: planning / name: cordis:group / group: true / config:
        - id: plan-mode / name: '@deepseek-ai/dsh-plan-mode'     # ← 没给 config.section

`dsh-plan-mode` 的官方 README 写明「唯一必需的配置是 agent 规划期间遵循的引导文本」，
字段名就是 `section`（且是封闭 schema）。缺它时宿主 `mountPreset` 在 schema 校验阶段抛错，
`activate()` 把 `error.message` 写进 `record.broken`（`app.asar:288509-288525`），客户端
`agentPresets/list` 拿到的该 preset 就带 `broken`，模式选择器直接渲染
`presetOptionBroken` = **「<名字>（加载失败）」**（`app.asar:483943`，zh 串 `484460`）。

结论：**补丁里的每一层子行都必须查**，`cordis:group` 不是黑盒。

## 为什么自定义 Loader

补丁里用了 `!!js`（Cordis 的表达式），它解析成**规范 tag** `tag:yaml.org,2002:js`，
`safe_load` 会报 `could not determine a constructor for the tag 'tag:yaml.org,2002:js'`。
注意 `add_multi_constructor("!", ...)` 只覆盖本地 `!foo` 标签，**必须**另外注册
`tag:yaml.org,2002:js` 的构造器（两个都要，缺一不可）。
"""
import io
import sys
from pathlib import Path

# Windows 控制台默认可能是 GBK，中文与 ✓ 会炸（实测：跑到最后一行 print 时
# UnicodeEncodeError，把"预检通过"变成 exit 1）。先钉死 UTF-8。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # pragma: no cover - 旧解释器没有 reconfigure
        pass

try:
    import yaml
except ImportError:
    # PyYAML 不是标准库。GitHub runner 与干净的 Python 都没有，缺了要给一句
    # 能照做的提示，而不是一串 ModuleNotFoundError 追溯。
    print(
        "× 预检需要 PyYAML（不是 Python 标准库）。装一下再跑：\n"
        "    python -m pip install pyyaml\n"
        '  CI 里由 .github/workflows/ci.yml 的 "Install PyYAML" 步骤安装。'
    )
    sys.exit(1)


class Loader(yaml.SafeLoader):
    pass


def _js_tagged(loader, node):
    """`!!js ...`（完整 tag: tag:yaml.org,2002:js）走这里。"""
    return {"__jsExpr": loader.construct_scalar(node)}


def _js_local(loader, suffix, node):
    """其它 `!foo ...` 本地标签（含 `!!js` 被解析成本地标签的情形）。"""
    return {"__jsExpr": loader.construct_scalar(node)}


Loader.add_constructor("tag:yaml.org,2002:js", _js_tagged)
Loader.add_multi_constructor("!", _js_local)

VALID_TOP_KEYS = {"insert", "disabled", "config", "name", "id", "isolate"}

# 已核实的「必需配置字段」。键 = 插件 moduleName。
# 来源：DSH 安装目录下 `resources/app.asar` 内各插件 README 的「最小配置」段，以及随附
# profile / preset 的实际用法。加新行时若不确定，先查 asar（`npx asar extract` 或直接搜字符串）。
REQUIRED_CONFIG = {
    "@deepseek-ai/dsh-plan-mode": {
        "required": ("section",),
        "why": "官方 README：唯一必需配置；缺失 → mountPreset 抛错 → preset 显示（加载失败）",
    },
    "@deepseek-ai/dsh-tool-fs-search": {
        "required": ("sampleOverCapGlobResults",),
        "why": "app.asar:1022466/1022689 必填、无回退默认",
    },
    "@deepseek-ai/dsh-tool-todo": {
        "required": ("allowParallelInProgress",),
        "why": "app.asar:1036080/1036256「省略它的组合会在加载时失败」",
    },
    "@deepseek-ai/dsh-tool-subagent": {
        "required": (),
        "why": "modelSelectionSettings 需要 Host 侧 model-selection-settings 行（基础树已有）",
        "optional": ("provider", "toolName", "backgroundMode", "modelSelectionSettings", "maxDepth"),
    },
    "@deepseek-ai/dsh-tool-web": {"required": (), "optional": ("fetch", "searchTimeoutMs")},
}

# group 行必须有 config（子行列表）的模块名。
GROUP_MODULES = {"cordis:group"}


def walk_rows(rows, at, problems, leaves, js_rows):
    """递归走 plugins 树。group 行只做结构检查并下钻，叶子行进 leaves。"""
    if not isinstance(rows, list):
        problems.append(f"{at or 'plugins'} 不是列表（group 必须持有插件行列表）")
        return
    ids = []
    for i, row in enumerate(rows):
        label = f"{at} row {i + 1}" if at else f"row {i + 1}"
        if not isinstance(row, dict):
            problems.append(f"{label}: is not a plugin row (expected a map with a name)")
            continue
        rid = row.get("id")
        if rid:
            ids.append(rid)

        if row.get("group") is True:
            inner = row.get("config")
            if not isinstance(inner, list):
                problems.append(f"{label} ({rid}): group 行必须带 config（子插件行列表）")
            else:
                walk_rows(inner, f"{label} ({rid})", problems, leaves, js_rows)
            continue

        name = row.get("name")
        if not isinstance(name, str) or not name:
            problems.append(f"{label}: names no plugin (a name string is required)")
            continue

        cfg = row.get("config") or {}
        if not isinstance(cfg, dict):
            problems.append(f"{label} ({rid}): config 不是映射")
            cfg = {}
        rule = REQUIRED_CONFIG.get(name)
        if rule:
            for key in rule["required"]:
                if key not in cfg:
                    problems.append(f"{label} ({rid} / {name}): 缺必需字段 config.{key} —— {rule['why']}")
        leaves.append({"id": rid, "name": name, "config": cfg, "disabled": row.get("disabled")})
        if isinstance(row.get("disabled"), dict):
            js_rows.append(rid)

    dup = sorted({x for x in ids if x and ids.count(x) > 1})
    if dup:
        problems.append(f"{at or '顶层 plugins'} 内有重复插件 id：{dup}")


def find_duplicate_keys(raw, loader=Loader):
    """扫描 YAML 里的重复映射键（同一个 map 内同名键出现两次）。

    PyYAML 的 `safe_load`/`Loader` 对重复键**静默取后者**，`dsh` 用的 js-yaml 却直接抛
    `duplicated mapping key` → 整个 bundle 补丁解析失败 → 预设与面板行一条都不挂载，
    而 `--dump-config` 与结构校验看上去都"没事"。2026-10-21 就是这么漏掉的两处
    （tool-fs-search / tool-todo 各多出一份 config 块）。

    用 `compose` 只搭节点树、不构造对象，所以 `!!js` 标签不会被实例化。
    """
    found = []

    def walk(node, trail):
        if isinstance(node, yaml.MappingNode):
            seen = {}
            for key_node, value_node in node.value:
                key = getattr(key_node, "value", None)
                line = key_node.start_mark.line + 1
                if key in seen:
                    found.append((line, key, "/".join(trail + [str(key)])))
                else:
                    seen[key] = line
                walk(value_node, trail + [str(key)])
        elif isinstance(node, yaml.SequenceNode):
            for i, item in enumerate(node.value):
                walk(item, trail + [f"[{i}]"])

    walk(yaml.compose(raw, Loader=loader), [])
    return found


def main(argv):
    default = Path(__file__).resolve().parent.parent / "cordis.patch.yml"
    path = Path(argv[1]).resolve() if len(argv) > 1 else default
    problems = []
    notes = []

    if not path.exists():
        print(f"× 找不到补丁文件：{path}")
        return 1

    raw = io.open(path, encoding="utf-8").read()
    try:
        doc = yaml.load(raw, Loader=Loader)
    except yaml.YAMLError as err:
        print(f"× YAML 解析失败：{err}")
        return 1

    if not isinstance(doc, list):
        print("× 顶层不是列表（Cordis 补丁必须是一个条目列表）")
        return 1
    notes.append(f"顶层条目 {len(doc)} 个，文件 {path.name}（{len(raw.encode('utf-8'))} B）")

    # 重复键必须在结构检查之前报——它是「整份补丁解析失败」级别的问题，
    # PyYAML 自己不会报（静默取后值），dsh 的 js-yaml 会抛错。
    for line, key, trail in find_duplicate_keys(raw):
        problems.append(f"重复的映射键 {key!r}（第 {line} 行，路径 /{trail}）——js-yaml 会整份解析失败")

    seen_preset_ids = []
    for i, item in enumerate(doc):
        if not isinstance(item, dict):
            problems.append(f"第 {i} 项不是映射")
            continue
        extra = set(item) - VALID_TOP_KEYS
        if extra:
            notes.append(f"第 {i} 项的额外键（会被忽略，确认是否有意）：{sorted(extra)}")
        insert = item.get("insert")
        if insert is None:
            notes.append(f"第 {i} 项没有 insert（只做 disabled/config 覆盖）")
            continue
        if not isinstance(insert, list):
            problems.append(f"第 {i} 项的 insert 不是列表")
            continue
        for row in insert:
            if not isinstance(row, dict):
                problems.append(f"第 {i} 项 insert 里有非映射行")
                continue
            if row.get("name") != "@deepseek-ai/dsh-agent-preset":
                notes.append(f"插入行 {row.get('id')!r} 的 name={row.get('name')!r}（不是 agent-preset）")
                continue
            cfg = row.get("config") or {}
            for key in ("id", "plugins"):
                if key not in cfg:
                    problems.append(f"预设 {row.get('id')!r} 缺必需字段 config.{key}")
            if not isinstance(cfg.get("plugins"), list):
                problems.append(f"预设 {row.get('id')!r} 的 config.plugins 不是列表")
                continue
            pid = cfg.get("id")
            if pid in seen_preset_ids:
                problems.append(f"预设 id {pid!r} 重复（重复的 preset ID 会导致声明加载失败）")
            seen_preset_ids.append(pid)

            leaves = []
            js_rows = []
            walk_rows(cfg["plugins"], "", problems, leaves, js_rows)
            notes.append(
                "预设 %r：id=%s order=%s 顶层行 %d 条 / 递归后叶子行 %d 条（!!js 条件禁用 %d 条：%s）"
                % (row.get("id"), pid, cfg.get("order"), len(cfg["plugins"]), len(leaves), len(js_rows), js_rows)
            )
            group_rows = [p for p in cfg["plugins"] if isinstance(p, dict) and p.get("group") is True]
            if group_rows:
                notes.append(
                    "  嵌套组：%s（子行 %s）"
                    % (
                        [g.get("id") for g in group_rows],
                        [[c.get("id") for c in (g.get("config") or []) if isinstance(c, dict)] for g in group_rows],
                    )
                )
            persona = leaves[0] if leaves and leaves[0]["id"] == "persona" else None
            if persona:
                prefix = persona["config"].get("prefix") or ""
                if len(prefix) < 200:
                    problems.append(f"预设 {row.get('id')!r} 的 persona.prefix 太短（{len(prefix)} 字符）")
                else:
                    notes.append(f"  persona.prefix {len(prefix)} 字符")

    for n in notes:
        print(f"· {n}")
    if problems:
        for p in problems:
            print(f"× {p}")
        print("× 预检未通过")
        return 1
    print("✓ 补丁预检通过")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""矢量标注层引擎（科研库「标注」能力）——归一化标注 → 叠加 SVG。

给已登记（register-figure）的图加标注，再把标注烧成一张叠加 SVG：
在原始 SVG 外套一层，用 `image` 元素引用原件（`href="<基名>.svg"`），标注画在上面。
坐标一律**归一化 0..1**（相对整图宽高），换分辨率不用重算；不裁剪、不猜，
页码/图版这些图外元素不参与——整张图就是坐标空间。

两个动作（由 `research.py annot` 原样转发参数，也可直接 python 本文件）：

  add     往 `.research/annot/<图号>.json` 追加一条标注；已有文件先留 `.json.bak`
  render  读标注，输出 `<同目录>/<基名>.annot.svg`（--out 改位置，--overwrite 才覆盖）

命令行示例（一条一行，Windows 上给 #rrggbb 加引号更稳）：

  python library/scripts/research.py annot add --project demo --figure fig1 --kind rect --x 0.12 --y 0.30 --w 0.22 --h 0.10 --color '#e6194b' --width 2
  python library/scripts/research.py annot add --project demo --figure fig1 --kind arrow --x 0.40 --y 0.55 --x2 0.62 --y2 0.48
  python library/scripts/research.py annot render --figure fig1
  python library/scripts/research.py annot render --figure fig1 --out out/fig1-annot.svg --overwrite

设计纪律（与本库其它脚本一致）：
  1. **零第三方依赖**：只用标准库，XML 只用 `xml.sax.saxutils` 转义，不引 XML 解析器。
  2. **不装作成功**：图号找不到、坐标越界、缺必填参数、输出已存在都非零退出并给中文错误；
     坐标越界**不静默 clamp**，缺原件也不偷偷降级成空图。
  3. **可回溯**：标注文件记 figureId / project / updatedAt / items；叠加 SVG 里带
     `metadata` 自描述（图号 + 整份标注），别人拿到这张 svg 也能看懂框是从哪来的。
  4. **写入原子**：临时文件 + os.replace；覆盖标注 JSON 前先留 `.bak`。
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import math
import os
import re
import sys
from pathlib import Path
from xml.sax.saxutils import escape as _xml_escape

# ─────────────────────────── 常量与口径 ───────────────────────────

# 四种标注：矩形、箭头、文字、点位。
KINDS = ("rect", "arrow", "text", "point")
ACTIONS = ("add", "render")
# 朱红：黑白线稿上也看得见；--color 可覆盖。
DEFAULT_COLOR = "#e6194b"
# 用户单位（= 画布像素），--width 可覆盖。
DEFAULT_WIDTH = 2.0
# text 没给 --width 时，字号 = 画布高 × 1.8%。
TEXT_FONT_FRAC = 0.018
FONT_FAMILY = "'Noto Sans CJK SC', 'Microsoft YaHei', 'PingFang SC', sans-serif"
# 原图读不出画布尺寸时的退路（会写进 warnings，不静默）。
FALLBACK_CANVAS = (0.0, 0.0, 1000.0, 1000.0)
COLOR_RE = re.compile(r"^#?([0-9A-Fa-f]{6})$")
# 图号要直接当文件名用：只允许文字/数字/下划线/点/连字符/空格。
ID_RE = re.compile(r"^[\w.\- ]{1,120}$")
# SVG 长度单位 → px（96 dpi 口径）。
LENGTH_UNITS = {"": 1.0, "px": 1.0, "pt": 4.0 / 3.0, "pc": 16.0,
                "mm": 96.0 / 25.4, "cm": 96.0 / 2.54, "in": 96.0}


class AnnotError(Exception):
    """可预期的用户错误（图号找不到 / 坐标越界 / 缺参数 / 冲突），由 research.py 转成 ok:false。"""


# ─────────────────────────── 基础工具 ───────────────────────────

def _now() -> str:
    return _dt.datetime.now().astimezone().replace(microsecond=0).isoformat()


def _default_library() -> str:
    """库根：环境变量优先，其次按脚本位置推断（<库根>/.research/scripts/research.py），
    最后落到用户目录下的 Research（与 research.py 同口径）。"""
    for name in ("SCIWORK_LIBRARY", "RESEARCH_LIBRARY"):
        value = os.environ.get(name)
        if value:
            return value
    here = os.path.dirname(os.path.abspath(__file__))
    candidate = os.path.dirname(os.path.dirname(here))
    if os.path.isdir(os.path.join(candidate, ".research")):
        return candidate
    return os.path.join(os.path.expanduser("~"), "Research")


def _rel(library: Path, path: Path) -> str:
    """库内相对路径（正斜杠）；不在库内则给绝对路径。"""
    try:
        return path.resolve().relative_to(library.resolve()).as_posix()
    except ValueError:
        return str(path)


def _inside(library: Path, path: Path) -> bool:
    try:
        path.resolve().relative_to(library.resolve())
        return True
    except ValueError:
        return False


def _write_text_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def _write_json_atomic(path: Path, data) -> None:
    _write_text_atomic(path, json.dumps(data, ensure_ascii=False, indent=1) + "\n")


def _read_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise AnnotError(f"JSON 解析失败：{path} —— {exc}") from None


# ─────────────────────────── 参数校验（中文错误，不 clamp） ───────────────────────────

def _num(raw, label: str):
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        raise AnnotError(f"{label} 是空的：要一个数字")
    try:
        value = float(text)
    except ValueError:
        raise AnnotError(f"{label} 不是数字：{raw!r}") from None
    if not math.isfinite(value):
        raise AnnotError(f"{label} 不是有限数：{raw!r}")
    return value


def _unit(raw, label: str):
    """归一化坐标：必须落在 0..1，越界直接报错（不静默夹取）。"""
    value = _num(raw, label)
    if value is None:
        return None
    if value < 0.0 or value > 1.0:
        raise AnnotError(f"{label}={value:g} 越界：归一化坐标必须在 0..1（相对整图宽高，不自动夹取）")
    return value


def _span(raw, label: str):
    """归一化尺寸：0 < 值 ≤ 1。"""
    value = _num(raw, label)
    if value is None:
        return None
    if not (0.0 < value <= 1.0):
        raise AnnotError(f"{label}={value:g} 越界：归一化尺寸必须大于 0 且不超过 1")
    return value


def _width(raw):
    value = _num(raw, "--width")
    if value is None:
        return None
    if value <= 0.0:
        raise AnnotError(f"--width={value:g} 不合法：线宽/字号要大于 0")
    return value


def _color(raw):
    if raw is None or not str(raw).strip():
        return None
    match = COLOR_RE.match(str(raw).strip())
    if not match:
        raise AnnotError(f"--color 要写成 #rrggbb（六位十六进制）：{raw!r}")
    return "#" + match.group(1).lower()


def _check_figure_id(figure_id) -> str:
    text = str(figure_id if figure_id is not None else "").strip()
    if not text:
        raise AnnotError("缺 --figure：要说清给哪张图标注（图号 = 侧车 figureId）")
    if (not ID_RE.match(text) or text.startswith(".") or text.endswith(".") or ".." in text):
        raise AnnotError(f"图号不能直接当文件名：{text!r}"
                         "（只用文字/数字/下划线/点/连字符/空格，不能以点开头或结尾）")
    return text


def _annot_path(library: Path, figure_id: str) -> Path:
    return library / ".research" / "annot" / f"{_check_figure_id(figure_id)}.json"


# ─────────────────────────── 图号 → 侧车 / 原件 ───────────────────────────

def _resolve_project(library: Path, raw) -> Path:
    projects = library / "projects"
    text = str(raw or "").strip()
    if not text:
        raise AnnotError("缺 --project：要给课题 slug（projects/ 下的目录名）")
    candidate = projects / text
    if candidate.is_dir():
        return candidate
    # 大小写退路（Windows 上目录名大小写不敏感，Linux 上也能兜住）
    for path in sorted(p for p in projects.glob("*") if p.is_dir()):
        if path.name.lower() == text.lower():
            return path
    raise AnnotError(f"课题不存在：{text}（先跑 new-project，或核对 --project 的 slug）")


def _figure_sidecars(roots) -> list:
    found = []
    for pdir in roots:
        figdir = pdir / "figures"
        if not figdir.is_dir():
            continue
        # 图可以放图组子目录：projects/<课题>/figures/<图组>/<基名>.json
        for path in sorted(figdir.rglob("*.json")):
            if path.name.startswith("_"):
                continue
            found.append((pdir, path))
    return found


def _resolve_figure(library: Path, figure, project):
    """图号 → 侧车记录。返回 (match, notes)；找不到就报 not-found，不做猜测。"""
    projects = library / "projects"
    wanted = str(figure if figure is not None else "").strip()
    if not wanted:
        raise AnnotError("缺 --figure：要说清给哪张图标注（图号 = 侧车 figureId）")
    if str(project or "").strip():
        roots = [_resolve_project(library, project)]
    else:
        roots = [p for p in sorted(projects.glob("*")) if p.is_dir()]
    matches = []
    for pdir, path in _figure_sidecars(roots):
        record = _read_json(path, {}) or {}
        figure_id = str(record.get("figureId") or path.stem)
        if figure_id == wanted or path.stem == wanted:
            matches.append({"project": pdir.name, "figureId": figure_id,
                            "sidecar": path, "record": record})
    if not matches:
        where = f"课题 {roots[0].name} " if len(roots) == 1 else "库"
        raise AnnotError(f"图号找不到：{wanted} 不在{where}里（先跑 register-figure，或核对 --figure）")
    # 去重：同一 (课题, 图号) 只留一份（同一侧车不会被扫两次）
    unique = {}
    for match in matches:
        unique.setdefault((match["project"], match["figureId"]), match)
    matches = list(unique.values())
    hit_projects = sorted({m["project"] for m in matches})
    if len(hit_projects) > 1:
        raise AnnotError(f"图号 {wanted} 在多个课题里重名（{'、'.join(hit_projects)}），"
                         "请加 --project 指定课题")
    notes = []
    if len(matches) > 1:
        matches.sort(key=lambda m: len(m["sidecar"].as_posix()))
        notes.append(f"同一课题里有 {len(matches)} 份侧车都叫 {wanted}（图组子目录），"
                     f"取路径最短的：{_rel(library, matches[0]['sidecar'])}")
    best = matches[0]
    _check_figure_id(best["figureId"])
    return best, notes


def _original_svg(library: Path, match) -> Path:
    """原始 SVG：先认同目录同基名的 .svg，再看侧车 file/files 里的 .svg。"""
    sidecar = match["sidecar"]
    candidate = sidecar.with_suffix(".svg")
    if candidate.is_file():
        return candidate
    record = match.get("record") or {}
    candidates = [record.get("file"), *(record.get("files") or [])]
    for raw in candidates:
        if not raw:
            continue
        path = Path(str(raw))
        if not path.is_absolute():
            path = library / path
        if path.suffix.lower() == ".svg" and path.is_file():
            return path
    raise AnnotError(f"找不到原始 SVG：{_rel(library, candidate)}"
                     "（标注层只套 SVG 原件；先把同名 .svg 导出来）")


# ─────────────────────────── 原图画布 ───────────────────────────

def _length(head: str, name: str):
    """从 <svg …> 头里取长度属性（px/pt/mm/cm/in → px）；取不到给 None。"""
    pattern = r"(?<![-\w])" + re.escape(name) + r"\s*=\s*[\"']\s*([0-9.+-]+)\s*([A-Za-z%]*)\s*[\"']"
    match = re.search(pattern, head, re.I)
    if not match:
        return None
    unit = match.group(2).lower()
    if unit not in LENGTH_UNITS:
        return None
    try:
        value = float(match.group(1)) * LENGTH_UNITS[unit]
    except ValueError:
        return None
    return value if value > 0 else None


def _svg_canvas(text: str, library: Path, svg_path: Path, warnings: list):
    """原图坐标系：优先 viewBox（可能带负 min-x/min-y），其次 width/height，最后退路。"""
    match = re.search(r"<svg\b[^>]*>", text, re.I | re.S)
    if not match:
        raise AnnotError(f"原始 SVG 里没有 <svg> 根元素：{_rel(library, svg_path)}")
    head = match.group(0)
    vb = re.search(r"viewBox\s*=\s*[\"']([^\"']+)[\"']", head, re.I)
    if vb:
        parts = [p for p in re.split(r"[,\s]+", vb.group(1).strip()) if p]
        if len(parts) == 4:
            try:
                min_x, min_y, width, height = (float(p) for p in parts)
            except ValueError:
                min_x = min_y = width = height = 0.0
            if width > 0 and height > 0:
                return min_x, min_y, width, height
        warnings.append(f"viewBox 读不懂（{vb.group(1)!r}），改看 width/height")
    width = _length(head, "width")
    height = _length(head, "height")
    if width and height:
        return 0.0, 0.0, width, height
    warnings.append("原始 SVG 没有可用的 width/height/viewBox，按 1000×1000 画布渲染")
    return FALLBACK_CANVAS


# ─────────────────────────── SVG 拼装 ───────────────────────────

def _fmt(value: float) -> str:
    if abs(value - round(value)) < 1e-9:
        return str(int(round(value)))
    return f"{value:.4f}".rstrip("0").rstrip(".")


def _attr(value) -> str:
    return _xml_escape(str(value), {'"': "&quot;"})


def _compose_svg(record: dict, items: list, min_x: float, min_y: float,
                 width: float, height: float, href: str, source: str) -> str:
    defs = []
    body = []
    for index, raw in enumerate(items, start=1):
        if not isinstance(raw, dict):
            raise AnnotError(f"标注文件第 {index} 条不是对象，没法渲染")
        kind = str(raw.get("kind") or "").strip().lower()
        if kind not in KINDS:
            raise AnnotError(f"标注文件第 {index} 条的 kind 不认识：{raw.get('kind')!r}")
        x = _num(raw.get("x"), f"第 {index} 条 x")
        y = _num(raw.get("y"), f"第 {index} 条 y")
        if x is None or y is None:
            raise AnnotError(f"标注文件第 {index} 条缺 x / y，没法渲染")
        if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
            raise AnnotError(f"标注文件第 {index} 条的坐标不在 0..1（可能被手改过）："
                             f"x={x:g} y={y:g}")
        color = _color(raw.get("color")) or DEFAULT_COLOR
        stroke = _width(raw.get("width")) or DEFAULT_WIDTH
        px, py = min_x + x * width, min_y + y * height
        common = (f'id="annot-{index}" data-kind="{kind}" stroke="{color}" '
                  f'stroke-width="{_fmt(stroke)}" fill="none"')
        if kind == "rect":
            w = _span(raw.get("w"), f"第 {index} 条 w")
            h = _span(raw.get("h"), f"第 {index} 条 h")
            if w is None or h is None:
                raise AnnotError(f"标注文件第 {index} 条 rect 缺 w / h，没法渲染")
            body.append(f'    <rect {common} x="{_fmt(px)}" y="{_fmt(py)}" '
                        f'width="{_fmt(w * width)}" height="{_fmt(h * height)}"/>')
        elif kind == "arrow":
            x2 = _unit(raw.get("x2"), f"第 {index} 条 x2")
            y2 = _unit(raw.get("y2"), f"第 {index} 条 y2")
            if x2 is None or y2 is None:
                raise AnnotError(f"标注文件第 {index} 条 arrow 缺 x2 / y2，没法渲染")
            qx, qy = min_x + x2 * width, min_y + y2 * height
            head_id = f"annot-head-{index}"
            defs.append(f'    <marker id="{head_id}" viewBox="0 0 10 10" refX="9" refY="5" '
                        f'markerWidth="6" markerHeight="6" orient="auto-start-reverse">'
                        f'<path d="M0,0 L10,5 L0,10 z" fill="{color}"/></marker>')
            body.append(f'    <line {common} x1="{_fmt(px)}" y1="{_fmt(py)}" '
                        f'x2="{_fmt(qx)}" y2="{_fmt(qy)}" marker-end="url(#{head_id})"/>')
        elif kind == "point":
            radius = max(stroke * 1.8, min(width, height) * 0.004)
            body.append(f'    <circle id="annot-{index}" data-kind="point" cx="{_fmt(px)}" '
                        f'cy="{_fmt(py)}" r="{_fmt(radius)}" fill="{color}" stroke="#ffffff" '
                        f'stroke-width="{_fmt(max(1.0, stroke * 0.5))}"/>')
        else:  # text
            text = str(raw.get("text") or "")
            if not text.strip():
                raise AnnotError(f"标注文件第 {index} 条 text 没有文字，没法渲染")
            font = _width(raw.get("width")) or max(8.0, height * TEXT_FONT_FRAC)
            body.append(f'    <text id="annot-{index}" data-kind="text" x="{_fmt(px)}" '
                        f'y="{_fmt(py)}" fill="{color}" font-family="{_attr(FONT_FAMILY)}" '
                        f'font-size="{_fmt(font)}" font-weight="600">'
                        f"{_xml_escape(text)}</text>")
    meta = {"figureId": record.get("figureId"), "project": record.get("project"),
            "updatedAt": record.get("updatedAt"), "source": source,
            "count": len(items), "items": items}
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'width="{_fmt(width)}" height="{_fmt(height)}" '
        f'viewBox="{_fmt(min_x)} {_fmt(min_y)} {_fmt(width)} {_fmt(height)}">',
        f'  <title>{_xml_escape(str(record.get("figureId") or "figure"))} 标注叠加图</title>',
        f'  <desc>在 {_xml_escape(href)} 上叠加 {len(items)} 条矢量标注；'
        "坐标归一化 0..1（相对整图宽高）。</desc>",
        f'  <metadata id="annot-record">{_xml_escape(json.dumps(meta, ensure_ascii=False))}</metadata>',
    ]
    if defs:
        lines.append("  <defs>")
        lines.extend(defs)
        lines.append("  </defs>")
    lines.append(f'  <image x="{_fmt(min_x)}" y="{_fmt(min_y)}" width="{_fmt(width)}" '
                 f'height="{_fmt(height)}" href="{_attr(href)}" xlink:href="{_attr(href)}" '
                 'preserveAspectRatio="none"/>')
    lines.append('  <g id="annot-layer">')
    lines.extend(body)
    lines.append("  </g>")
    lines.append("</svg>")
    return "\n".join(lines) + "\n"


def _output_path(library: Path, raw, svg_path: Path) -> Path:
    if raw:
        path = Path(str(raw))
        if not path.is_absolute():
            path = library / path
        if path.suffix.lower() != ".svg":
            raise AnnotError(f"--out 要给 .svg 路径：{raw!r}（叠加图只出 SVG）")
        return path
    return svg_path.with_name(svg_path.stem + ".annot.svg")


def _href_from(output: Path, svg_path: Path) -> str:
    try:
        return Path(os.path.relpath(svg_path, output.parent)).as_posix()
    except ValueError:  # 不同盘符：退回文件名，至少同目录的时候是对的
        return svg_path.name


# ─────────────────────────── add ───────────────────────────

def _add(library: Path, args) -> dict:
    kind = str(args.kind or "").strip().lower()
    if not kind:
        raise AnnotError("缺 --kind：rect / arrow / text / point")
    if kind not in KINDS:
        raise AnnotError(f"--kind 不认识：{args.kind!r}（只接受 {' / '.join(KINDS)}）")
    # add 必带课题：标注文件按图号存，但归属要记清（render 才允许省略 --project）
    if not str(args.project or "").strip():
        raise AnnotError("缺 --project：add 要给课题 slug（projects/ 下的目录名），"
                         "标注文件里要记归属")
    match, notes = _resolve_figure(library, args.figure, args.project)
    figure_id = match["figureId"]
    x = _unit(args.x, "--x")
    y = _unit(args.y, "--y")
    if x is None or y is None:
        raise AnnotError("缺 --x / --y：标注位置要给归一化坐标（0..1，相对整图宽高）")
    x2 = _unit(args.x2, "--x2")
    y2 = _unit(args.y2, "--y2")
    w = _span(args.w, "--w")
    h = _span(args.h, "--h")
    width = _width(args.width)
    color = _color(args.color)
    text = args.text
    if kind == "text" and (text is None or not str(text).strip()):
        raise AnnotError("kind=text 缺 --text：没有文字的 text 标注画不出来")
    if kind == "rect" and (w is None or h is None):
        raise AnnotError("kind=rect 缺 --w / --h：矩形要同时给宽高（归一化 0..1）")
    if kind == "arrow" and (x2 is None or y2 is None):
        raise AnnotError("kind=arrow 缺 --x2 / --y2：箭头要有终点")
    item = {"kind": kind, "x": x, "y": y, "x2": x2, "y2": y2, "w": w, "h": h,
            "text": str(text) if text is not None else None,
            "color": color, "width": width}
    path = _annot_path(library, figure_id)
    existing = _read_json(path, None) if path.exists() else None
    if existing is not None and not isinstance(existing, dict):
        raise AnnotError(f"已有标注文件不是对象：{_rel(library, path)}（先修好或删掉再 add）")
    warnings = list(notes)
    old_project = str((existing or {}).get("project") or "")
    if old_project and old_project != match["project"]:
        warnings.append(f"标注文件里原本记的是课题 {old_project}，会被改成 {match['project']}"
                        "（.bak 留底）")
    try:
        _original_svg(library, match)
    except AnnotError as exc:
        warnings.append(f"{exc}（render 会失败）")
    items = list((existing or {}).get("items") or [])
    record = dict(existing or {})
    record.update({"figureId": figure_id, "project": match["project"],
                   "updatedAt": _now(), "items": items + [item]})
    backup = None
    if path.exists():
        backup = path.with_name(path.name + ".bak")
        _write_text_atomic(backup, path.read_text(encoding="utf-8"))
    _write_json_atomic(path, record)
    return {
        "ok": True, "action": "add", "figureId": figure_id, "project": match["project"],
        "kind": kind, "items": len(record["items"]), "item": item,
        "annotFile": _rel(library, path),
        "backup": _rel(library, backup) if backup else None,
        "warnings": warnings,
        "summary": (f"已给 {figure_id} 加一条 {kind} 标注（共 {len(record['items'])} 条）；"
                    f"标注文件 {_rel(library, path)}。"),
    }


# ─────────────────────────── render ───────────────────────────

def _render(library: Path, args) -> dict:
    match, notes = _resolve_figure(library, args.figure, args.project)
    figure_id = match["figureId"]
    warnings = list(notes)
    annot = _annot_path(library, figure_id)
    if not annot.is_file():
        raise AnnotError(f"这张图还没有标注：{_rel(library, annot)}（先跑 annot add）")
    record = _read_json(annot, {})
    if not isinstance(record, dict):
        raise AnnotError(f"标注文件不是对象：{_rel(library, annot)}")
    items = record.get("items") or []
    if not isinstance(items, list) or not items:
        raise AnnotError(f"标注文件里一条标注都没有（{_rel(library, annot)}），没什么可渲染的")
    svg_path = _original_svg(library, match)
    try:
        source_text = svg_path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise AnnotError(f"读不到原始 SVG：{_rel(library, svg_path)} —— {exc}") from None
    min_x, min_y, width, height = _svg_canvas(source_text, library, svg_path, warnings)
    output = _output_path(library, args.out, svg_path)
    if output.exists() and not args.overwrite:
        raise AnnotError(f"输出已存在：{_rel(library, output)}（确认覆盖加 --overwrite）")
    if not _inside(library, output):
        warnings.append(f"输出不在科研库内：{output}")
    href = _href_from(output, svg_path)
    svg = _compose_svg(record, items, min_x, min_y, width, height, href,
                       _rel(library, svg_path))
    _write_text_atomic(output, svg)
    return {
        "ok": True, "action": "render", "figureId": figure_id, "project": match["project"],
        "source": _rel(library, svg_path), "output": _rel(library, output),
        "items": len(items), "href": href,
        "canvas": {"width": width, "height": height},
        "warnings": warnings,
        "summary": f"已把 {len(items)} 条标注烧成叠加图：{_rel(library, output)}"
                   f"（原图以 {href} 引用）。",
    }


# ─────────────────────────── 入口 ───────────────────────────

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="annot.py",
        description="矢量标注层：给已登记的图加归一化标注（add），再烧成叠加 SVG（render）",
        epilog="坐标一律归一化 0..1（相对整图宽高），换分辨率不用重算；越界直接报错、不自动夹取。",
    )
    parser.add_argument("action", help="add（加标注）｜render（烧成叠加 SVG）")
    parser.add_argument("--project", help="课题 slug；add 必填，render 可选（图号重名时用来消歧）")
    parser.add_argument("--figure", help="图号（侧车 figureId，也接受侧车文件名）")
    parser.add_argument("--kind", help="rect｜arrow｜text｜point（add 必填）")
    parser.add_argument("--x", help="锚点 X（归一化 0..1）；rect 是左上角，text 是文字起点")
    parser.add_argument("--y", help="锚点 Y（归一化 0..1）")
    parser.add_argument("--x2", help="箭头终点 X（归一化 0..1，kind=arrow 必填）")
    parser.add_argument("--y2", help="箭头终点 Y（归一化 0..1，kind=arrow 必填）")
    parser.add_argument("--w", help="矩形宽（归一化 0..1，kind=rect 必填）")
    parser.add_argument("--h", help="矩形高（归一化 0..1，kind=rect 必填）")
    parser.add_argument("--text", help="标注文字（kind=text 必填）")
    parser.add_argument("--color", help="颜色 #rrggbb（缺省朱红 #e6194b）")
    parser.add_argument("--width", help="线宽；kind=text 时当字号（用户单位，缺省 2 / 画布高×1.8%%）")
    parser.add_argument("--out", help="render 输出路径（缺省 <同目录>/<基名>.annot.svg）")
    parser.add_argument("--overwrite", action="store_true", help="render 时允许覆盖已有叠加图")
    return parser


def run(library, argv) -> dict:
    """执行一次 add / render，返回待 emit 的 payload；可预期的错误一律抛 AnnotError。"""
    argv = list(argv or [])
    if not argv:
        raise AnnotError("缺动作：annot 后面要跟 add 或 render（python library/scripts/annot.py --help）")
    args = build_parser().parse_args(argv)
    lib = Path(library).resolve()
    action = str(args.action or "").strip().lower()
    if action == "add":
        return _add(lib, args)
    if action == "render":
        return _render(lib, args)
    raise AnnotError(f"动作不认识：{args.action!r}（只接受 add / render）")


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    library = Path(_default_library())
    try:
        payload = run(library, argv)
    except AnnotError as exc:
        sys.stdout.write(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=1)
                         + "\n")
        return 2
    except OSError as exc:
        sys.stdout.write(json.dumps({"ok": False, "error": f"标注读写失败：{exc}"},
                                    ensure_ascii=False, indent=1) + "\n")
        return 2
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

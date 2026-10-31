#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""峰分析引擎（科研库「数据分析」能力）——一条谱线的扣基线 + 找峰 + 拟合。

一条两列（x y）谱线 → 扣基线 → 局部极大 + 显著度（prominence）找峰 →
每个峰做高斯 / 洛伦兹非线性最小二乘拟合（Levenberg–Marquardt + 数值雅可比）。

设计纪律（与库内其它脚本一致）：
  1. **零第三方依赖**：LM、数值雅可比、线性方程组求解全部标准库手写，
     不引入 numpy / scipy（本项目的卖点就是纯 Python 3.9+ 能跑）。
  2. **不装作成功**：拟合不收敛、窗内点太少、峰宽离谱都会写进 `converged` /
     `warnings` 并带出现实数值；不会静默丢峰或返回好看但假的数字。
  3. **基线口径复用 `lib/transform.js` 的 `baseline()`**：
     `min` = 减全局最小；`ends` = 用首/末各 n 个有效点拟合直线后相减
     （两端都拟不出时优先用首段，与 JS 一致）。
  4. **原始数据只读**：产物写 `projects/<课题>/tables/`，溯源写
     `.research/transforms/<课题>/`，同名默认不覆盖；写入是临时文件 + `os.replace`。
  5. **可复现**：溯源里记输入文件 sha256、方法、参数、引擎版本与脚本 sha256、
     引擎噪声估计与自动显著度阈值，换台机器也能复核。

由 `research.py analyze` 子命令调用（`library/scripts/analysis.py` 与 research.py
同目录）；不直接改库的登记索引，`research.py` 写完产物后会 `reindex`。
"""
from __future__ import annotations

import csv
import datetime as _dt
import hashlib
import json
import math
import os
import re
import sys
from pathlib import Path

# ─────────────────────────── 常量与口径 ───────────────────────────

# 高斯：FWHM = 2√(2ln2)·σ；面积 = A·σ·√(2π)。
GAUSS_FWHM = 2.0 * math.sqrt(2.0 * math.log(2.0))
SQRT_2PI = math.sqrt(2.0 * math.pi)
# 洛伦兹：半高半宽 γ，FWHM = 2γ，面积 = A·π·γ。
# 自动显著度阈值 = max(范围 × MIN_PROMINENCE_FRAC, NOISE_SIGMA_K × 噪声σ)。
# 6σ 是「1% 白噪声下假峰概率极低、真实峰又不至于被吞」的折中；可用 --min-prominence 覆盖。
NOISE_SIGMA_K = 6.0
MIN_PROMINENCE_FRAC = 0.02
# 单峰曲线（溯源里给画图用）最多存多少点 / 多少个峰。
CURVE_POINTS = 160
CURVE_PEAKS = 64

CSV_COLUMNS = [
    "peak", "lineshape", "center", "height", "fwhm", "area", "r2",
    "rms_residual", "max_abs_residual", "prominence", "snr", "points",
    "window_min", "window_max",
]


class AnalysisError(Exception):
    """可预期的用户错误（路径、数据、参数、冲突），由 research.py 转成 ok:false。"""


def _now() -> str:
    return _dt.datetime.now().astimezone().replace(microsecond=0).isoformat()


# ─────────────────────────── 基础工具 ───────────────────────────

def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        # 真实仪器导出偶尔是 GBK；只读，不写回原文件。
        return path.read_text(encoding="gbk", errors="replace")


def _write_text_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def _write_json_atomic(path: Path, data) -> None:
    _write_text_atomic(path, json.dumps(data, ensure_ascii=False, indent=1) + "\n")


def _resolve_inside(library: Path, raw: str) -> Path:
    """库根相对路径 → 绝对路径，且必须落在库根内（与 lib/library.js resolveInside 同口径）。"""
    text = str(raw or "").replace("\\", "/").strip()
    if not text:
        raise AnalysisError("空路径：--data 要给库根相对路径")
    if re.match(r"^[A-Za-z]:", text) or text.startswith("/"):
        raise AnalysisError("--data 只接受库根相对路径（不要写盘符或绝对路径）")
    root = library.resolve()
    target = (root / text).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        raise AnalysisError("路径越出科研库范围：--data 必须落在库根内") from None
    return target


def _engine_info(library: Path) -> dict:
    """引擎身份：包版本（能找到 package.json 时）+ analysis.py 自身 sha256 + Python 版本。

    库版本没法从库根可靠推断（安装后的库不挨着 package.json），所以两个都记：
    version 找不到就是 null（不编），scriptSha256 永远可核对。
    """
    script = Path(__file__).resolve()
    version = None
    seen = set()
    for base in (script.parent, library):
        for ancestor in (base, *base.parents):
            key = str(ancestor).lower()
            if key in seen:
                continue
            seen.add(key)
            pkg = ancestor / "package.json"
            if pkg.is_file():
                try:
                    data = json.loads(pkg.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                if data.get("name") == "dsh-sciwork" and data.get("version"):
                    version = str(data["version"])
                    break
        if version:
            break
    return {
        "name": "dsh-sciwork",
        "version": version,
        "script": "analysis.py",
        "scriptSha256": _sha256_file(script),
        "python": sys.version.split()[0],
        "dependencies": "stdlib-only",
    }


# ─────────────────────────── 读表（与 lib/table.js parseTable 同口径） ───────────────────────────

_NULL_CELL = re.compile(r"^(nan|na|null|none|-)$", re.I)


def _pick_delimiter(first_line: str):
    """认分隔符：逗号 / 制表符 / 分号 / 空白，谁在第一行切出来的列多算谁。"""
    candidates = [
        (",", len(first_line.split(","))),
        ("\t", len(first_line.split("\t"))),
        (";", len(first_line.split(";"))),
        (None, len(first_line.strip().split())),
    ]
    candidates.sort(key=lambda pair: pair[1], reverse=True)
    return candidates[0][0]


def _split_line(line: str, delimiter):
    if delimiter is None:
        return line.strip().split()
    return [cell.strip() for cell in line.split(delimiter)]


def _unquote(cell: str) -> str:
    return re.sub(r'^["\']|["\']$', "", cell)


def _is_number(text: str) -> bool:
    try:
        value = float(text)
    except (TypeError, ValueError):
        return False
    return math.isfinite(value)


def _cell_value(text: str):
    """与 JS 版一致：空 / NaN / NA / null / none / - → None；数字 → float；其余 → 原字符串。"""
    unquoted = _unquote(text)
    if unquoted == "" or _NULL_CELL.match(unquoted):
        return None
    if _is_number(unquoted):
        return float(unquoted)
    return unquoted


def _read_table(path: Path) -> dict:
    """读分隔符文本表；表头判定与 `lib/table.js` 的 `parseTable` 一致。"""
    text = _read_text(path).replace("\ufeff", "")
    lines = [line for line in text.splitlines() if line.strip() and not line.strip().startswith("#")]
    if len(lines) < 2:
        raise AnalysisError(f"数据文件至少要有两行（表头 + 数据）：{path.name}")
    delimiter = _pick_delimiter(lines[0])
    first = [_unquote(cell) for cell in _split_line(lines[0], delimiter)]
    second = [_unquote(cell) for cell in _split_line(lines[1], delimiter)] if len(lines) > 1 else []
    all_numeric = bool(first) and all(_is_number(cell) for cell in first)
    width_mismatch = bool(second) and len(second) != len(first)
    headerless = all_numeric or width_mismatch
    width = len(second) if headerless and second else len(first)
    header = [f"#{i + 1}" for i in range(width)] if headerless else first[:width]
    body = lines if (headerless and all_numeric) else lines[1:]
    rows = []
    for line in body:
        cells = _split_line(line, delimiter)
        if not cells or (len(cells) == 1 and cells[0] == ""):
            continue
        rows.append([_cell_value(cell) for cell in cells])
    return {
        "header": header,
        "rows": rows,
        "headerless": headerless,
        "delimiter": "space" if delimiter is None else ("tab" if delimiter == "\t" else "comma"),
    }


def _find_column(header: list[str], spec, default_index: int, label: str) -> int:
    """把 --x-col / --y-col 的「列名或 0 基序号」解成列下标。"""
    if spec is None or str(spec).strip() == "":
        return default_index
    raw = str(spec).strip()
    if re.fullmatch(r"\d+", raw):
        index = int(raw)
        if index >= len(header):
            raise AnalysisError(f"{label} 列序号 {index} 越界（只有 {len(header)} 列）")
        return index
    exact = [i for i, name in enumerate(header) if name.strip().lower() == raw.lower()]
    if len(exact) == 1:
        return exact[0]
    fuzzy = [i for i, name in enumerate(header) if raw.lower() in name.lower()]
    if len(fuzzy) == 1:
        return fuzzy[0]
    raise AnalysisError(f"找不到 {label} 列「{raw}」；现有列：{', '.join(header)}")


def _extract_xy(table: dict, x_col, y_col) -> tuple[list[float], list[float], list[str]]:
    header = table["header"]
    rows = table["rows"]
    if len(header) < 2:
        raise AnalysisError("峰分析需要两列数据（x y），这个文件只有一列")
    warnings: list[str] = []
    xi = _find_column(header, x_col, 0, "X")
    yi = _find_column(header, y_col, 1 if xi == 0 else 0, "Y")
    if xi == yi:
        raise AnalysisError("X 列与 Y 列不能是同一列")
    xs: list[float] = []
    ys: list[float] = []
    dropped = 0
    for row in rows:
        if xi >= len(row) or yi >= len(row):
            dropped += 1
            continue
        xv, yv = row[xi], row[yi]
        if isinstance(xv, (int, float)) and isinstance(yv, (int, float)):
            xs.append(float(xv))
            ys.append(float(yv))
        else:
            dropped += 1
    if dropped:
        warnings.append(f"跳过 {dropped} 行缺失/非数值数据（不插值、不填充）")
    if len(xs) < 5:
        raise AnalysisError(f"有效数据点只有 {len(xs)} 个，至少需要 5 个才能找峰拟合")
    if len(header) > 2 and x_col is None and y_col is None:
        warnings.append(f"文件有 {len(header)} 列，默认用第 1/2 列（{header[xi]} / {header[yi]}）；"
                        "可用 --x-col / --y-col 指定")
    return xs, ys, warnings


# ─────────────────────────── 基线（复用 lib/transform.js 口径） ───────────────────────────

def _subtract_baseline(xs: list[float], ys: list[float], mode: str, ends: int) -> tuple[list[float], dict]:
    """`min` / `ends` 两种口径，参数语义与 `lib/transform.js` 的 baseline() 一致。

    `ends`：取首/末各 n 个有效点（n = max(2, min(ends, ⌊N/2⌋))），用真正的 X 拟合**一条**
    直线（两端点集联合拟合；只有一端可用时退回那一端），再逐点减掉 k·x + c。
    联合拟合是「两端线性基线」的本来含义；JS 版当前只拿首段拟合、跨全谱外推，端点噪声会让
    斜率失控，这里按定义拟合两端，结果才可用。
    """
    info = {"mode": mode, "ends": None, "slope": None, "intercept": None,
            "offset": None, "notes": []}
    if mode == "none":
        info["notes"].append("未扣基线（--baseline none）")
        return list(ys), info
    if mode == "min":
        base = min(ys)
        info["offset"] = base
        info["notes"].append(f"减全局最小值 {base:.6g}")
        return [value - base for value in ys], info
    if mode != "ends":
        raise AnalysisError(f"未知的基线方式：{mode}（可用 none / min / ends）")

    count = len(ys)
    n = max(2, min(int(ends or 5), count // 2))

    def fit(ids: list[int]):
        pairs = [(xs[i], ys[i]) for i in ids if xs[i] is not None and ys[i] is not None]
        if len(pairs) < 2:
            return None
        mx = sum(p[0] for p in pairs) / len(pairs)
        my = sum(p[1] for p in pairs) / len(pairs)
        den = sum((p[0] - mx) ** 2 for p in pairs)
        if abs(den) < 1e-12:
            return None
        k = sum((p[0] - mx) * (p[1] - my) for p in pairs) / den
        return k, my - k * mx

    head_ids = list(range(n))
    tail_ids = list(range(count - n, count))
    fit_info = fit(head_ids + tail_ids) or fit(head_ids) or fit(tail_ids)
    if fit_info is None:
        info["notes"].append("X 变化太小，拟不出两端线性基线，未扣基线（与 JS 版口径一致）")
        return list(ys), info
    k, c = fit_info
    info["ends"] = n
    info["slope"] = k
    info["intercept"] = c
    info["notes"].append(f"用首/末各 {n} 个有效点联合拟合直线基线（k={k:.6g}, c={c:.6g}）后相减")
    adjusted = [value - (k * xs[i] + c) for i, value in enumerate(ys) if xs[i] is not None]
    return adjusted, info


# ─────────────────────────── 噪声估计与找峰 ───────────────────────────

def _median(values: list[float]) -> float:
    ordered = sorted(values)
    size = len(ordered)
    if size == 0:
        return 0.0
    mid = size // 2
    return ordered[mid] if size % 2 else (ordered[mid - 1] + ordered[mid]) / 2.0


def _estimate_noise(ys: list[float]) -> float:
    """用相邻差分的 MAD 估白噪声 σ（对谱峰本身的贡献不敏感）。

    白噪声 y_i：Var(y_{i+1}-y_i) = 2σ²，所以 σ = 1.4826·MAD(差分)/√2。
    峰很窄、采样很密时差分里峰斜率只占少数点，MAD 仍是稳健估计。
    """
    if len(ys) < 4:
        return 0.0
    diffs = [ys[i + 1] - ys[i] for i in range(len(ys) - 1)]
    center = _median(diffs)
    mad = _median([abs(value - center) for value in diffs])
    return 1.4826 * mad / math.sqrt(2.0)


def _sparse_min(values: list[float]) -> tuple[list[list[float]], list[int]]:
    """区间最小值稀疏表（O(n log n) 预处理，O(1) 查询），给 prominence 用。"""
    size = len(values)
    logs = [0] * (size + 1)
    for i in range(2, size + 1):
        logs[i] = logs[i // 2] + 1
    levels = logs[size] + 1
    table = [list(values)]
    for level in range(1, levels):
        prev = table[level - 1]
        half = 1 << (level - 1)
        span = size - (1 << level) + 1
        cur = [0.0] * size
        for i in range(max(0, span)):
            left = prev[i]
            right = prev[i + half]
            cur[i] = left if left < right else right
        table.append(cur)
    return table, logs


def _range_min(table: list[list[float]], logs: list[int], left: int, right: int) -> float:
    if left > right:
        return math.inf
    level = logs[right - left + 1]
    a = table[level][left]
    b = table[level][right - (1 << level) + 1]
    return a if a < b else b


def _nearest_greater(values: list[float]) -> tuple[list[int], list[int]]:
    """每个点左右两侧最近的严格更高点下标（没有就是 -1），单调栈 O(n)。"""
    size = len(values)
    left = [-1] * size
    stack: list[int] = []
    for i in range(size):
        while stack and values[stack[-1]] <= values[i]:
            stack.pop()
        left[i] = stack[-1] if stack else -1
        stack.append(i)
    right = [-1] * size
    stack = []
    for i in range(size - 1, -1, -1):
        while stack and values[stack[-1]] <= values[i]:
            stack.pop()
        right[i] = stack[-1] if stack else -1
        stack.append(i)
    return left, right


def _local_maxima(ys: list[float]) -> list[int]:
    """局部极大（含平台顶：平台取中点；首尾端点不算峰）。"""
    size = len(ys)
    found: list[int] = []
    i = 0
    while i < size:
        j = i
        while j + 1 < size and ys[j + 1] == ys[i]:
            j += 1
        if i > 0 and j + 1 < size and ys[i] > ys[i - 1] and ys[i] >= ys[j + 1]:
            found.append((i + j) // 2)
        i = j + 1
    return found


def _prominences(ys: list[float], peaks: list[int]) -> list[float]:
    """地形显著度（prominence）：峰高 − 两侧通往更高地形的最低鞍部中较高的那个。"""
    size = len(ys)
    table, logs = _sparse_min(ys)
    left_higher, right_higher = _nearest_greater(ys)
    out: list[float] = []
    for index in peaks:
        left = left_higher[index]
        right = right_higher[index]
        if left < 0:
            left_base = _range_min(table, logs, 0, index - 1)
        else:
            left_base = _range_min(table, logs, left + 1, index - 1)
        if right < 0:
            right_base = _range_min(table, logs, index + 1, size - 1)
        else:
            right_base = _range_min(table, logs, index + 1, right - 1)
        if not math.isfinite(left_base):
            left_base = ys[index]
        if not math.isfinite(right_base):
            right_base = ys[index]
        out.append(ys[index] - max(left_base, right_base))
    return out


def _detect_peaks(xs: list[float], ys: list[float], detect: list[float], min_prominence: float,
                  min_distance: float) -> list[dict]:
    """局部极大 + 显著度阈值 + 最小间距去重（同区间留显著度高的那个）。

    找峰在 5 点平滑曲线（`detect`）上做：单点噪声毛刺若直接按原始数据算显著度，
    会因为「通往更远谷底」被放大成假峰；峰高 `y` 仍取原始扣基线数据，给拟合真实初值。
    """
    candidates = _local_maxima(detect)
    prominences = _prominences(detect, candidates)
    rows = [(index, prom) for index, prom in zip(candidates, prominences)
            if prom > 0 and prom >= min_prominence]
    # 显著度从高到低处理：两峰挨得比 min_distance 更近时，保留更高的那个。
    rows.sort(key=lambda pair: pair[1], reverse=True)
    kept: list[tuple[int, float]] = []
    for index, prom in rows:
        if any(abs(xs[index] - xs[other]) < min_distance for other, _ in kept):
            continue
        kept.append((index, prom))
    kept.sort(key=lambda pair: xs[pair[0]])
    return [{"index": index, "x": xs[index], "y": ys[index], "detectY": detect[index],
             "prominence": prom} for index, prom in kept]


def _median_step(xs: list[float]) -> float:
    diffs = sorted(abs(xs[i + 1] - xs[i]) for i in range(len(xs) - 1) if xs[i + 1] != xs[i])
    if not diffs:
        raise AnalysisError("X 列没有变化（全是同一个值），没法找峰")
    return _median(diffs)


def _smooth(ys: list[float], window: int = 5) -> list[float]:
    """5 点滑动平均——只用来估峰宽/定拟合窗，绝不参与拟合（拟合永远用原始扣基线数据）。"""
    size = len(ys)
    if size < 3 or window < 3:
        return list(ys)
    half = window // 2
    out: list[float] = []
    for i in range(size):
        lo = max(0, i - half)
        hi = min(size, i + half + 1)
        segment = ys[lo:hi]
        out.append(sum(segment) / len(segment))
    return out


def _fwhm_estimate(xs: list[float], smooth: list[float], peak: dict, min_step: float) -> float:
    """用平滑曲线的半高全宽估峰宽（只定拟合窗，最终数字以拟合结果为准）。

    半高取在「峰顶」与「地形基线（峰值 − 显著度）」之间；噪声毛刺在这一步被 5 点平滑压掉，
    不会让窗口忽宽忽窄。
    """
    index = peak["index"]
    top = peak.get("detectY", peak["y"])
    base = top - peak["prominence"]
    half = (top + base) / 2.0
    left = index
    while left > 0 and smooth[left - 1] > half:
        left -= 1
    right = index
    while right < len(smooth) - 1 and smooth[right + 1] > half:
        right += 1
    width = xs[right] - xs[left]
    if not math.isfinite(width) or width <= 0:
        width = 4.0 * min_step
    return width


def _window_for(xs: list[float], peaks: list[dict], index: int, fwhm: float,
                min_step: float) -> tuple[float, float, str | None]:
    """单峰拟合窗：±2.5 个 FWHM（高斯≈±5.9σ），并让给相邻峰一半间距，至少 ±6 个采样步。

    返回 (low, high, 截断原因)；原因 None / "neighbor"（挨着邻峰）/ "edge"（贴着数据端点）。
    """
    peak = peaks[index]
    width = max(2.5 * fwhm, 6.0 * min_step)
    desired = width
    clamped: str | None = None
    if index > 0:
        gap = peak["x"] - peaks[index - 1]["x"]
        if gap > 0 and gap * 0.5 < width:
            width = gap * 0.5
            clamped = "neighbor"
    if index + 1 < len(peaks):
        gap = peaks[index + 1]["x"] - peak["x"]
        if gap > 0 and gap * 0.5 < width:
            width = gap * 0.5
            clamped = "neighbor"
    low = max(xs[0], peak["x"] - width)
    high = min(xs[-1], peak["x"] + width)
    if clamped is None and (peak["x"] - low < desired - 1e-12
                            or high - peak["x"] < desired - 1e-12):
        clamped = "edge"
    return low, high, clamped


# ─────────────────────────── 线型与 Levenberg–Marquardt ───────────────────────────

def _line_model(params: list[float], xs: list[float], reference: float, shape: str) -> list[float]:
    """模型 = 峰分量 + 局部线性背景 b0 + b1·(x − reference)。

    峰：高斯 A·exp(−(x−c)²/(2σ²))；洛伦兹 A·γ²/((x−c)²+γ²)（A 是峰顶高，γ 是半高半宽）。
    宽度参数用对数存储，保证 LM 里宽度恒正。
    """
    amplitude, center, log_width, intercept, slope = params
    width = math.exp(log_width)
    out = []
    for x in xs:
        offset = x - center
        if shape == "gauss":
            peak = amplitude * math.exp(-0.5 * (offset / width) ** 2)
        else:
            peak = amplitude / (1.0 + (offset / width) ** 2)
        out.append(peak + intercept + slope * (x - reference))
    return out


def _cost(params: list[float], xs: list[float], ys: list[float], reference: float,
          shape: str) -> float:
    model = _line_model(params, xs, reference, shape)
    return sum((y - m) ** 2 for y, m in zip(ys, model))


def _jacobian(params: list[float], xs: list[float], reference: float, shape: str) -> list[list[float]]:
    """数值雅可比（中心差分），列 = 参数，行 = 数据点。"""
    count = len(params)
    columns: list[list[float]] = []
    for j in range(count):
        step = 1e-6 * max(1.0, abs(params[j]))
        plus = list(params)
        minus = list(params)
        plus[j] += step
        minus[j] -= step
        f_plus = _line_model(plus, xs, reference, shape)
        f_minus = _line_model(minus, xs, reference, shape)
        columns.append([(a - b) / (2.0 * step) for a, b in zip(f_plus, f_minus)])
    return [[columns[j][i] for j in range(count)] for i in range(len(xs))]


def _solve_linear(matrix: list[list[float]], rhs: list[float]) -> list[float] | None:
    """高斯消元（列主元）。奇异就返回 None，由调用方把阻尼调大重试。"""
    size = len(rhs)
    work = [list(row) + [rhs[i]] for i, row in enumerate(matrix)]
    for col in range(size):
        pivot = max(range(col, size), key=lambda row: abs(work[row][col]))
        if abs(work[pivot][col]) < 1e-300:
            return None
        work[col], work[pivot] = work[pivot], work[col]
        divisor = work[col][col]
        for row in range(col + 1, size):
            factor = work[row][col] / divisor
            if factor:
                for k in range(col, size + 1):
                    work[row][k] -= factor * work[col][k]
    solution = [0.0] * size
    for row in range(size - 1, -1, -1):
        total = work[row][size] - sum(work[row][k] * solution[k] for k in range(row + 1, size))
        solution[row] = total / work[row][row]
    return solution


def _project(params: list[float], low: float, high: float) -> list[float]:
    """物理约束投影：振幅 ≥ 0、峰位留在窗内、宽度有限。"""
    amplitude, center, log_width, intercept, slope = params
    return [
        max(0.0, amplitude),
        min(max(center, low), high),
        min(max(log_width, math.log(1e-9)), math.log(max(1e-6, (high - low) * 10.0))),
        intercept,
        slope,
    ]


def _lm_fit(xs: list[float], ys: list[float], params: list[float], reference: float,
            shape: str, low: float, high: float, max_iter: int = 200) -> dict:
    """Levenberg–Marquardt 最小二乘（纯 Python，数值雅可比）。"""
    params = _project(list(params), low, high)
    cost = _cost(params, xs, ys, reference, shape)
    lam = 1e-3
    iterations = 0
    converged = False
    for iterations in range(1, max_iter + 1):
        jacobian = _jacobian(params, xs, reference, shape)
        model = _line_model(params, xs, reference, shape)
        residual = [y - m for y, m in zip(ys, model)]
        size = len(params)
        normal = [[sum(row[a] * row[b] for row in jacobian) for b in range(size)] for a in range(size)]
        gradient = [sum(jacobian[i][j] * residual[i] for i in range(len(xs))) for j in range(size)]
        accepted = False
        for _ in range(20):
            damped = [row[:] for row in normal]
            for j in range(size):
                damped[j][j] += lam * max(normal[j][j], 1e-12)
            step = _solve_linear(damped, gradient)
            if step is None:
                lam = min(lam * 10.0, 1e16)
                continue
            candidate = _project([params[j] + step[j] for j in range(size)], low, high)
            candidate_cost = _cost(candidate, xs, ys, reference, shape)
            if math.isfinite(candidate_cost) and candidate_cost < cost:
                reduction = cost - candidate_cost
                params = candidate
                cost = candidate_cost
                lam = max(lam / 3.0, 1e-12)
                accepted = True
                step_norm = math.sqrt(sum(value * value for value in step))
                if reduction <= 1e-12 * max(cost, 1e-12) and step_norm < 1e-10:
                    converged = True
                break
            lam = min(lam * 10.0, 1e16)
        if not accepted:
            # 阻尼加到上限还降不下成本：已经在局部最小（或数值上限），照实收工。
            converged = True
            break
        if converged:
            break
    model = _line_model(params, xs, reference, shape)
    residual = [y - m for y, m in zip(ys, model)]
    ss_res = sum(value * value for value in residual)
    mean = sum(ys) / len(ys)
    ss_tot = sum((y - mean) ** 2 for y in ys)
    return {
        "params": params,
        "cost": cost,
        "iterations": iterations,
        "converged": converged,
        "ssRes": ss_res,
        "ssTot": ss_tot,
        "rmsResidual": math.sqrt(ss_res / len(residual)),
        "maxAbsResidual": max((abs(value) for value in residual), default=0.0),
        "model": model,
        "residual": residual,
    }


def _derive(fit: dict, params: list[float], shape: str) -> dict:
    """把拟合参数换算成论文要报的量：center / height / fwhm / area / r2。"""
    amplitude, center, log_width, intercept, slope = params
    width = math.exp(log_width)
    if shape == "gauss":
        fwhm = GAUSS_FWHM * width
        area = amplitude * width * SQRT_2PI
    else:
        fwhm = 2.0 * width
        area = amplitude * math.pi * width
    if fit["ssTot"] <= 1e-30:
        r2 = 1.0 if fit["ssRes"] <= 1e-30 else 0.0
    else:
        r2 = 1.0 - fit["ssRes"] / fit["ssTot"]
    return {
        "lineShape": shape,
        "center": center,
        "height": amplitude,
        "fwhm": fwhm,
        "area": area,
        "r2": r2,
        "rmsResidual": fit["rmsResidual"],
        "maxAbsResidual": fit["maxAbsResidual"],
        "background": {"intercept": intercept, "slope": slope},
        "converged": fit["converged"],
        "iterations": fit["iterations"],
        "ssRes": fit["ssRes"],
    }


def _initial_params(xs: list[float], ys: list[float], peak: dict, fwhm: float,
                    shape: str) -> list[float]:
    """初值：峰位用三点抛物线细化；宽度按线型从估出的 FWHM 换成 σ / γ；振幅 = 窗内峰高 − 最小值。"""
    index = peak["index"]
    center = peak["x"]
    if 0 < index < len(xs) - 1:
        y0, y1, y2 = ys[index - 1], ys[index], ys[index + 1]
        denominator = y0 - 2.0 * y1 + y2
        if abs(denominator) > 1e-30:
            offset = 0.5 * (y0 - y2) / denominator
            if abs(offset) <= 1.0 and index + offset < len(xs) - 1:
                center = xs[index] + offset * (xs[index + 1] - xs[index])
    base = min(ys)
    amplitude = max((peak["y"] - base), peak["prominence"] * 0.5, 1e-12)
    width = fwhm / (GAUSS_FWHM if shape == "gauss" else 2.0)
    return [amplitude, center, math.log(max(width, 1e-9)), 0.0, 0.0]


def _curve_points(xs: list[float], ys: list[float], params: list[float], reference: float,
                  shape: str, low: float, high: float, count: int = CURVE_POINTS) -> list[list[float]]:
    """拟合峰分量（不含背景）在窗口内的采样点列，给溯源 JSON / 画图用。"""
    points: list[list[float]] = []
    if count < 2 or high <= low:
        return points
    step = (high - low) / (count - 1)
    for i in range(count):
        x = low + step * i
        offset = x - params[1]
        width = math.exp(params[2])
        if shape == "gauss":
            value = params[0] * math.exp(-0.5 * (offset / width) ** 2)
        else:
            value = params[0] / (1.0 + (offset / width) ** 2)
        points.append([round(x, 10), value])
    return points


def _fit_peak(xs: list[float], ys: list[float], peak: dict, fwhm: float,
              low: float, high: float, shape: str) -> dict:
    """在窗口里对单个峰做一次线型拟合，返回可序列化的完整结果。"""
    window_ids = [i for i, x in enumerate(xs) if low - 1e-12 <= x <= high + 1e-12]
    win_x = [xs[i] for i in window_ids]
    win_y = [ys[i] for i in window_ids]
    if len(win_x) < 7:
        raise AnalysisError(f"峰 {peak['x']:.6g} 的拟合窗只有 {len(win_x)} 个点（至少 7 个）")
    reference = 0.5 * (win_x[0] + win_x[-1])
    initial = _initial_params(win_x, win_y, peak, fwhm, shape)
    fit = _lm_fit(win_x, win_y, initial, reference, shape, low, high)
    result = _derive(fit, fit["params"], shape)
    result["window"] = [win_x[0], win_x[-1]]
    result["reference"] = reference
    result["points"] = len(win_x)
    result["initialFwhm"] = fwhm
    result["curve"] = _curve_points(win_x, win_y, fit["params"], reference, shape, low, high)
    return result


# ─────────────────────────── 主流程 ───────────────────────────

def analyze(*, library: Path, project_slug: str, data_rel: str, lineshape: str = "both",
            baseline: str = "ends", ends: int = 5, min_prominence: float | None = None,
            min_distance: float | None = None, x_col=None, y_col=None,
            out_name: str | None = None, overwrite: bool = False) -> dict:
    """分析一条谱线，写 CSV + 溯源 JSON，返回 JSON 可直接输出的结果。"""
    if lineshape not in ("gauss", "lorentz", "both"):
        raise AnalysisError(f"未知线型：{lineshape}（可用 gauss / lorentz / both）")
    if baseline not in ("none", "min", "ends"):
        raise AnalysisError(f"未知基线方式：{baseline}（可用 none / min / ends）")
    library = Path(library).resolve()
    project_dir = library / "projects" / project_slug
    if not project_dir.is_dir():
        raise AnalysisError(f"课题不存在：{project_slug}（先跑 research.py new-project）")
    source = _resolve_inside(library, data_rel)
    if not source.is_file():
        raise AnalysisError(f"数据文件不存在：{data_rel}")

    source_sha = _sha256_file(source)
    table = _read_table(source)
    xs, ys, warnings = _extract_xy(table, x_col, y_col)
    # 按 X 排序（仪器可能倒序导出）；基线仍按文件行序生效，值不受排序影响。
    pairs = sorted(zip(xs, ys), key=lambda pair: pair[0])
    xs = [pair[0] for pair in pairs]
    ys = [pair[1] for pair in pairs]

    ys, baseline_info = _subtract_baseline(xs, ys, baseline, ends)
    noise_sigma = _estimate_noise(ys)
    span = max(ys) - min(ys)
    if min_prominence is None:
        auto = max(MIN_PROMINENCE_FRAC * span, NOISE_SIGMA_K * noise_sigma)
        min_prominence_used = auto
        prominence_source = "auto"
    else:
        min_prominence_used = float(min_prominence)
        prominence_source = "explicit"
    step = _median_step(xs)
    if min_distance is None:
        min_distance_used = 5.0 * step
    else:
        min_distance_used = float(min_distance)
    if min_distance_used <= 0:
        raise AnalysisError("--min-distance 必须 > 0")

    # 找峰 / 估峰宽都在 5 点平滑曲线上做（压下单点噪声毛刺），拟合与报数一律用原始扣基线数据。
    detect_curve = _smooth(ys, 5)
    peaks = _detect_peaks(xs, ys, detect_curve, min_prominence_used, min_distance_used)
    if not peaks:
        warnings.append("没有找到显著峰（可以降低 --min-prominence 或换基线方式）")

    fwhm_estimates = []
    for peak in peaks:
        fwhm_estimates.append(_fwhm_estimate(xs, detect_curve, peak, step))

    fits_by_peak: list[dict] = []
    rows: list[dict] = []
    curves: list[dict] = []
    shapes = ["gauss", "lorentz"] if lineshape == "both" else [lineshape]
    for order, peak in enumerate(peaks, start=1):
        low, high, clamp = _window_for(xs, peaks, order - 1, fwhm_estimates[order - 1], step)
        if clamp == "neighbor":
            warnings.append(
                f"峰 {order}（x={peak['x']:.6g}）与相邻峰挨得太近，拟合窗被截到半间距；"
                "重叠峰没有联合解卷积，这里的 FWHM / area 需要人工复核")
        fits: dict[str, dict] = {}
        failures: list[str] = []
        for shape in shapes:
            try:
                fits[shape] = _fit_peak(xs, ys, peak, fwhm_estimates[order - 1], low, high, shape)
            except AnalysisError as exc:
                failures.append(f"{shape}: {exc}")
        if not fits:
            warnings.append(f"峰 {order}（x={peak['x']:.6g}）拟合失败：" + "；".join(failures))
            continue
        # 两种线型都拟合时，按 R² 选主结果；R² 相同（数值上限）时优先高斯。
        primary_shape = max(fits, key=lambda name: (fits[name]["r2"], name == "gauss"))
        primary = fits[primary_shape]
        height = primary["height"]
        if not primary["converged"]:
            warnings.append(f"峰 {order}（x={peak['x']:.6g}）{primary_shape} 拟合未完全收敛，数值仅作参考")
        snr = height / noise_sigma if noise_sigma > 0 else None
        row = {
            "peak": order,
            "lineshape": primary_shape,
            "center": primary["center"],
            "height": height,
            "fwhm": primary["fwhm"],
            "area": primary["area"],
            "r2": primary["r2"],
            "rms_residual": primary["rmsResidual"],
            "max_abs_residual": primary["maxAbsResidual"],
            "prominence": peak["prominence"],
            "snr": snr,
            "points": primary["points"],
            "window_min": primary["window"][0],
            "window_max": primary["window"][1],
        }
        rows.append(row)
        entry = {
            "peak": order,
            "center": primary["center"],
            "height": height,
            "fwhm": primary["fwhm"],
            "area": primary["area"],
            "r2": primary["r2"],
            "rmsResidual": primary["rmsResidual"],
            "prominence": peak["prominence"],
            "snr": snr,
            "lineshape": primary_shape,
            "fits": fits,
            "window": primary["window"],
            "windowClamped": clamp,
            "points": primary["points"],
            "converged": all(fit["converged"] for fit in fits.values()),
        }
        fits_by_peak.append(entry)
        if order <= CURVE_PEAKS:
            curves.append({
                "peak": order,
                "lineShape": primary_shape,
                "component": "peak",  # 只含峰分量；背景参数在 fits.<shape>.background
                "points": primary["curve"],
            })

    warnings_for_curves = []
    if len(peaks) > CURVE_PEAKS:
        warnings_for_curves.append(
            f"峰数 {len(peaks)} 超过 {CURVE_PEAKS}，溯源只存前 {CURVE_PEAKS} 个峰的曲线点列（CSV 不受影响）")
    warnings.extend(warnings_for_curves)

    stem = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", source.stem).strip(" .") or "data"
    name = (out_name or f"{stem}_peaks").strip()
    if not name:
        raise AnalysisError("--out-name 不能为空")
    if re.search(r'[<>:"/\\|?*\x00-\x1f]', name) or name in (".", ".."):
        raise AnalysisError("--out-name 只能是一个文件名（不能带路径或非法字符）")
    tables_dir = project_dir / "tables"
    csv_path = tables_dir / f"{name}.csv"
    trace_dir = library / ".research" / "transforms" / project_slug
    trace_path = trace_dir / f"{name}.json"
    if (csv_path.exists() or trace_path.exists()) and not overwrite:
        raise AnalysisError(
            f"同名产物已存在：{csv_path.relative_to(library).as_posix()}（要覆盖加 --overwrite；原始数据永远不动）")

    rows_for_csv = [[row[column] for column in CSV_COLUMNS] for row in rows]
    tables_dir.mkdir(parents=True, exist_ok=True)
    buffer: list[str] = []
    collector = _CsvCollector(buffer)
    writer = csv.writer(collector, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    for row in rows_for_csv:
        writer.writerow(["" if value is None else _format_cell(value) for value in row])
    _write_text_atomic(csv_path, "".join(buffer))

    payload = {
        "ok": True,
        "project": project_slug,
        "data": source.relative_to(library).as_posix(),
        "sha256": source_sha,
        "bytes": source.stat().st_size,
        "rows": len(table["rows"]),
        "pointsUsed": len(xs),
        "delimiter": table["delimiter"],
        "header": table["header"],
        "baseline": baseline_info,
        "noise": {"sigma": noise_sigma, "method": "MAD(相邻差分)/√2·1.4826"},
        "params": {
            "lineshape": lineshape,
            "baseline": baseline,
            "ends": ends,
            "minProminence": min_prominence_used,
            "minProminenceSource": prominence_source,
            "minDistance": min_distance_used,
            "xCol": x_col,
            "yCol": y_col,
            "curvePointsPerFit": CURVE_POINTS,
        },
        "method": {
            "baseline": {
                "reusedFrom": "lib/transform.js baseline()",
                "modes": {"min": "减全局最小值",
                          "ends": "首/末各 n 个有效点（n=max(2,min(ends,有效点/2))）联合线性拟合后相减"},
            },
            "peakDetection": {
                "smoothing": "找峰与估峰宽在 5 点滑动平均曲线上做（压单点噪声毛刺）；拟合与报数一律用原始扣基线数据",
                "localMaxima": "严格高于左邻且不低于右邻（平台取中点）",
                "prominence": "峰高 − 两侧通往更高地形的最低鞍部中较高者",
                "threshold": f"自动 = max(范围×{MIN_PROMINENCE_FRAC:g}, {NOISE_SIGMA_K:g}×噪声σ)",
                "minDistance": "同间距内只留显著度最高的峰",
                "window": "单峰拟合窗 ±2.5×估出的 FWHM，并让给相邻峰一半间距",
            },
            "fit": {
                "algorithm": "Levenberg-Marquardt（纯 Python，中心差分数值雅可比）",
                "model": "峰分量（高斯/洛伦兹，宽度取对数保证恒正）+ 局部线性背景 b0 + b1·(x−窗中心)",
                "fwhm": {"gauss": "2√(2ln2)·σ", "lorentz": "2γ"},
                "area": {"gauss": "A·σ·√(2π)", "lorentz": "A·π·γ"},
                "r2": "1 − SSres/SStot（窗内数据对窗内均值）",
            },
        },
        "engine": _engine_info(library),
        "columns": CSV_COLUMNS,
        "peaks": fits_by_peak,
        "curves": curves,
        "counts": {"peaks": len(rows), "fits": sum(len(entry["fits"]) for entry in fits_by_peak)},
        "warnings": warnings,
        "output": csv_path.relative_to(library).as_posix(),
        "outputSha256": _sha256_file(csv_path),
        "trace": trace_path.relative_to(library).as_posix(),
        "createdAt": _now(),
    }
    trace = {
        "schema": 1,
        "kind": "peak-analysis",
        "source": payload["data"],
        "sourceSha256": source_sha,
        "sourceBytes": payload["bytes"],
        "op": "analyze",
        "params": payload["params"],
        "method": payload["method"],
        "baseline": baseline_info,
        "noise": payload["noise"],
        "engine": payload["engine"],
        "output": payload["output"],
        "outputSha256": payload["outputSha256"],
        "rows": len(rows),
        "columns": len(CSV_COLUMNS),
        "csvColumns": CSV_COLUMNS,
        "peaks": fits_by_peak,
        "curves": curves,
        "notes": warnings,
        "meta": {"counts": payload["counts"], "pointsUsed": len(xs)},
        "createdAt": payload["createdAt"],
    }
    _write_json_atomic(trace_path, trace)

    if rows:
        centers = "、".join(f"{row['center']:.4f}" for row in rows[:8])
        if len(rows) > 8:
            centers += " …"
        summary = (f"峰分析完成：{len(rows)} 个峰（{centers}），基线 {baseline}，"
                   f"线型 {lineshape}；产物 {payload['output']}")
    else:
        summary = f"峰分析完成：没有显著峰，产物 {payload['output']}（表头已写，方便后续追加参数重跑）"
    payload["summary"] = summary
    return payload


class _CsvCollector:
    """csv.writer 需要 write()；先收进内存再原子落盘，避免半截 CSV。"""

    def __init__(self, buffer: list[str]) -> None:
        self.buffer = buffer

    def write(self, text: str) -> None:
        self.buffer.append(text)


def _format_cell(value) -> str:
    if isinstance(value, float):
        if not math.isfinite(value):
            return ""
        return f"{value:.10g}"
    return str(value)

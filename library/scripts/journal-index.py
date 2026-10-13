#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""期刊档案索引与体检（纯标准库）。

用法（走科研库统一入口；Windows 上把库根换成你的目录）：
    <库根>\\.research\\bin\\py.cmd <库根>\\.research\\scripts\\journal-index.py build
    <库根>\\.research\\bin\\py.cmd <库根>\\.research\\scripts\\journal-index.py check
    ... journal-index.py build --journals <库根>\\journals

- build：扫描 journals/*.json，写出 journals/_index.json（只索引，不改任何档案）。
- check：逐份校验字段结构是否与本模式约定一致，列出问题；有问题时退出码 1。

为什么要单独一个脚本：档案会越加越多，靠人眼保持 12 份、20 份的结构一致不现实。
本脚本只做两件事——**汇总**与**体检**，绝不替用户改档案内容。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone, timedelta

# Windows 控制台默认可能是 GBK，中文会炸；先钉死 UTF-8（与 research.py 同一处理）。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # pragma: no cover - 旧解释器没有 reconfigure
        pass

TOP_KEYS = [
    "id", "name", "nameZh", "publisher", "language", "homepage",
    "figure", "text", "references", "submission", "sources", "verifiedAt", "confidence",
]
FIGURE_KEYS = [
    "singleColumnMm", "doubleColumnMm", "maxHeightMm", "minFontPt", "maxFontPt",
    "fontFamily", "lineWidthPt", "rasterDpi", "vectorPreferred", "colorMode",
    "panelLabels", "notes",
]
TEXT_KEYS = ["abstractMaxWords", "abstractStyle", "titleMaxChars", "sections", "wordLimitNote"]
REF_KEYS = ["style", "inTextExample", "entryExample", "maxAuthorsListed", "doiRequired"]
SUB_KEYS = ["coverLetterRequired", "checklist", "commonRejectionReasons"]
# text / references / submission 里允许出现的**可选**键：notes 用来写"版本陷阱/口径差异"
# 这类必须留痕的东西。figure.notes 是必填（见 FIGURE_KEYS），其余三处 notes 可缺可多。
OPTIONAL_EXTRA = {"notes"}
CONFIDENCE = ("high", "medium", "low")

CAVEAT = (
    "档案是默认值，不是权威规定。本模式纪律：用户现场要求 > 期刊档案 > 通用默认。"
    "confidence=low 表示字段未逐条核实（多为官方站反爬、只能拿到题录），用前必须查目标刊/本校的最新要求。"
)


def now_local() -> str:
    tz = timezone(timedelta(hours=8))
    return datetime.now(tz).isoformat(timespec="seconds")


def load_journals(jdir: str):
    if not os.path.isdir(jdir):
        return [], [f"目录不存在：{jdir}"]
    out, problems = [], []
    for name in sorted(os.listdir(jdir)):
        if not name.endswith(".json") or name == "_index.json":
            continue
        path = os.path.join(jdir, name)
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"{name}: JSON 解析失败：{exc}")
            continue
        out.append((name, data))
    return out, problems


def check_one(name: str, j: dict) -> list[str]:
    issues: list[str] = []

    def keys(where: str, obj, expected) -> None:
        if not isinstance(obj, dict):
            issues.append(f"{where} 不是对象")
            return
        missing = [k for k in expected if k not in obj]
        extra = [k for k in obj if k not in expected and k not in OPTIONAL_EXTRA]
        if missing:
            issues.append(f"{where} 缺键 {missing}")
        if extra:
            issues.append(f"{where} 多余键 {extra}")

    keys("顶层", j, TOP_KEYS)
    keys("figure", j.get("figure") or {}, FIGURE_KEYS)
    keys("text", j.get("text") or {}, TEXT_KEYS)
    keys("references", j.get("references") or {}, REF_KEYS)
    keys("submission", j.get("submission") or {}, SUB_KEYS)

    stem = name[:-5]
    if j.get("id") != stem:
        issues.append(f"id（{j.get('id')!r}）与文件名（{stem!r}）不一致")

    if j.get("confidence") not in CONFIDENCE:
        issues.append(f"confidence 必须是 {CONFIDENCE} 之一，实际 {j.get('confidence')!r}")

    if not isinstance(j.get("sources"), list) or not j.get("sources"):
        issues.append("sources 必须是非空列表（否则无从复核）")

    figure = j.get("figure") or {}
    if not isinstance(figure.get("notes"), list) or not figure.get("notes"):
        issues.append("figure.notes 必须是非空列表（写清核实到什么、没核实到什么）")

    # 数值字段的类型约束：要么 null，要么数字——不许把数字写成字符串
    num_fields = ["singleColumnMm", "doubleColumnMm", "maxHeightMm", "minFontPt", "maxFontPt", "lineWidthPt"]
    for k in num_fields:
        v = figure.get(k)
        if v is not None and not isinstance(v, (int, float)):
            issues.append(f"figure.{k} 应为数字或 null，实际 {type(v).__name__}")
    rp = figure.get("rasterDpi")
    if isinstance(rp, dict):
        for k, v in rp.items():
            if v is not None and not isinstance(v, (int, float)):
                issues.append(f"figure.rasterDpi.{k} 应为数字或 null，实际 {type(v).__name__}")

    amw = (j.get("text") or {}).get("abstractMaxWords")
    if amw is not None and not isinstance(amw, int):
        issues.append(f"text.abstractMaxWords 应为整数或 null，实际 {type(amw).__name__}")

    return issues


def cmd_build(args) -> int:
    jdir = args.journals
    items, problems = load_journals(jdir)
    entries = []
    for name, j in items:
        figure = j.get("figure") or {}
        entries.append({
            "id": j.get("id", name[:-5]),
            "file": name,
            "name": j.get("name"),
            "nameZh": j.get("nameZh"),
            "publisher": j.get("publisher"),
            "language": j.get("language"),
            "homepage": j.get("homepage"),
            "confidence": j.get("confidence"),
            "verifiedAt": j.get("verifiedAt"),
            "sourceCount": len(j.get("sources") or []),
            "singleColumnMm": figure.get("singleColumnMm"),
            "doubleColumnMm": figure.get("doubleColumnMm"),
            "referenceStyle": (j.get("references") or {}).get("style"),
        })
    entries.sort(key=lambda e: str(e["id"]))
    by_conf: dict[str, list[str]] = {c: [] for c in CONFIDENCE}
    for e in entries:
        by_conf.setdefault(str(e["confidence"]), []).append(str(e["id"]))

    payload = {
        "schema": 1,
        "updatedAt": now_local(),
        "count": len(entries),
        "byConfidence": by_conf,
        "caveat": CAVEAT,
        "journals": entries,
    }
    out = os.path.join(jdir, "_index.json")
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    os.replace(tmp, out)

    print(json.dumps({
        "ok": not problems,
        "action": "build",
        "wrote": out,
        "count": len(entries),
        "byConfidence": {k: len(v) for k, v in by_conf.items()},
        "problems": problems,
        "summary": f"索引 {len(entries)} 份档案 → {out}",
    }, ensure_ascii=False, indent=2))
    return 0 if not problems else 1


def cmd_check(args) -> int:
    jdir = args.journals
    items, problems = load_journals(jdir)
    report = []
    for name, j in items:
        issues = check_one(name, j)
        problems.extend(f"{name}: {i}" for i in issues)
        report.append({
            "file": name,
            "id": j.get("id"),
            "confidence": j.get("confidence"),
            "sources": len(j.get("sources") or []),
            "ok": not issues,
            "issues": issues,
        })
    print(json.dumps({
        "ok": not problems,
        "action": "check",
        "count": len(report),
        "report": report,
        "problems": problems,
        "summary": f"体检 {len(report)} 份：{len(report) - len([r for r in report if not r['ok']])} 份通过，{len([r for r in report if not r['ok']])} 份有问题",
    }, ensure_ascii=False, indent=2))
    return 0 if not problems else 1


def default_journals() -> str:
    """档案目录：环境变量给的库根优先，其次按脚本位置推断（仓库里的 library/journals
    或装好之后的 <库根>/journals）。"""
    root = os.environ.get("SCIWORK_LIBRARY") or os.environ.get("RESEARCH_LIBRARY")
    if root:
        return os.path.join(root, "journals")
    here = os.path.dirname(os.path.abspath(__file__))
    for cand in (
        os.path.join(here, "..", "..", "library", "journals"),
        os.path.join(here, "..", "..", "journals"),
    ):
        if os.path.isdir(cand):
            return cand
    return os.path.join(here, "..", "..", "journals")


def main() -> int:
    ap = argparse.ArgumentParser(description="期刊档案索引与体检")
    ap.add_argument("action", nargs="?", default="build", choices=["build", "check"])
    ap.add_argument("--journals", default=default_journals())
    args = ap.parse_args()
    args.journals = os.path.abspath(args.journals)
    return cmd_build(args) if args.action == "build" else cmd_check(args)


if __name__ == "__main__":
    sys.exit(main())

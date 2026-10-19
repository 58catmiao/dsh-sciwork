#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""科研模式（Research Mode）科研库工具。

所有库操作都走这个脚本，不要手写库里的 JSON 格式。设计原则：
  1. 只用标准库，任何 Python 3.9+ 都能跑（Windows 上经库内 bin/py.cmd 调用）。
  2. 输出一律是 UTF-8 的 JSON 到 stdout，方便模型直接读；人类可读的摘要放在 "summary" 字段。
  3. 写文件一律原子替换（临时文件 + os.replace），避免半截文件。
  4. **不猜**：引用必须有 DOI 或 URL 才能进库；核查不过就非零退出。

子命令：
  init                        建/修复库骨架
  status                      库概况
  new-project                 新建课题
  list-projects               列课题
  add-ref                     加一条文献（自动分配引用键 + 更新 refs.bib）
  list-refs                   列/搜文献
  remove-ref                  删掉一条文献登记（先备份 refs.json，再同步 refs.bib）
  register-figure             登记一张图的溯源侧车
  list-figures                列图
  add-submission              登记一条投稿记录（期刊 / 稿件 / 状态 / 下一步）
  list-submissions            列/筛投稿记录（可按课题、期刊、状态、截止）
  update-submission           推进投稿状态、记事件、改下一步
  search                      跨课题检索（基于索引）
  reindex                     重建索引
  check-citations             引用核查闸门（交稿前必跑）
  check-journal               投稿合规体检（图 / 稿 / 引用对期刊档案）
  export-package              导出投稿包 zip（稿件 + 图 + 数据 + refs.bib + manifest）
"""
from __future__ import annotations

import argparse
import base64
import datetime as _dt
import hashlib
import json
import os
import re
import struct
import sys
import unicodedata
import zipfile
from pathlib import Path

# Windows 控制台默认可能是 GBK，中文会炸；先钉死 UTF-8。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # pragma: no cover - 旧解释器没有 reconfigure
        pass

def _default_library() -> str:
    """库根：环境变量优先，其次按脚本位置推断（<库根>/.research/scripts/research.py），
    最后落到用户目录下的 Research。"""
    for name in ("SCIWORK_LIBRARY", "RESEARCH_LIBRARY"):
        v = os.environ.get(name)
        if v:
            return v
    here = os.path.dirname(os.path.abspath(__file__))
    candidate = os.path.dirname(os.path.dirname(here))
    if os.path.isdir(os.path.join(candidate, ".research")):
        return candidate
    return os.path.join(os.path.expanduser("~"), "Research")


LIBRARY = Path(_default_library())
DOT = LIBRARY / ".research"
CONFIG = DOT / "config.json"
INDEX = DOT / "index" / "library.json"
REFS_JSON = LIBRARY / "refs" / "refs.json"
REFS_BIB = LIBRARY / "refs" / "refs.bib"
JOURNALS = LIBRARY / "journals"
PROJECTS = LIBRARY / "projects"
SUBMISSIONS = LIBRARY / "submissions"

# 投稿状态机：只用这几个词，别的都拒绝（宁缺勿猜）。
SUBMISSION_STATUSES = ("drafting", "submitted", "under-review", "revision",
                       "accepted", "rejected", "withdrawn", "published")
# 「进行中」= 还压在你手上的那些。
SUBMISSION_ACTIVE = ("submitted", "under-review", "revision")

PROJECT_SUBDIRS = ("data", "figures", "origin", "drafts", "notes", "tables")
DEPRECATED = object()


# ─────────────────────────── 基础 I/O ───────────────────────────

def now() -> str:
    return _dt.datetime.now().astimezone().replace(microsecond=0).isoformat()


def read_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"JSON 解析失败：{path} —— {exc}")


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def emit(payload: dict, code: int = 0) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, indent=1) + "\n")
    sys.exit(code)


def fail(message: str, code: int = 2) -> None:
    emit({"ok": False, "error": message}, code)


def slugify(text: str) -> str:
    """课题目录名：ASCII 安全，中文转拼音不可靠所以退回 translit 或哈希后缀。"""
    text = unicodedata.normalize("NFKD", text.strip())
    ascii_only = text.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^A-Za-z0-9]+", "-", ascii_only).strip("-").lower()
    if not slug:
        slug = "p" + str(abs(hash(text)) % 10_000_000)
    return slug[:60]


def rel(path: Path) -> str:
    """库内相对路径（正斜杠），用于登记；不在库内则用绝对路径。"""
    try:
        return path.resolve().relative_to(LIBRARY.resolve()).as_posix()
    except ValueError:
        return str(path)


def project_dir(slug: str) -> Path:
    path = PROJECTS / slugify(slug)
    if not path.exists():
        fail(f"课题不存在：{slug}（先跑 new-project）")
    return path


def load_config() -> dict:
    return read_json(CONFIG, {"schema": 1, "libraryRoot": str(LIBRARY).replace("\\", "/")})


# ─────────────────────────── 骨架 ───────────────────────────

def ensure_skeleton(quiet: bool = True) -> list[str]:
    created = []
    for path in (LIBRARY, DOT, DOT / "bin", DOT / "index", DOT / "templates",
                 DOT / "scripts", JOURNALS, LIBRARY / "refs", PROJECTS,
                 LIBRARY / "submissions"):
        if not path.exists():
            path.mkdir(parents=True, exist_ok=True)
            created.append(rel(path))
    if not CONFIG.exists():
        write_json(CONFIG, {
            "schema": 1,
            "libraryRoot": str(LIBRARY).replace("\\", "/"),
            "interpreter": sys.executable,
            "launcher": f"{rel(DOT)}/bin/py.cmd",
            "origin": {
                "mcpServerName": "origin",
                "toolPrefix": "mcp__origin__",
                "neverHijackRunningInstance": True,
            },
            "defaults": {"journal": None, "figureFormat": "png", "figureDpi": 600, "language": "zh"},
            "index": f"{rel(DOT)}/index/library.json",
        })
        created.append(rel(CONFIG))
    if not REFS_JSON.exists():
        write_json(REFS_JSON, {"schema": 1, "updatedAt": now(), "refs": {}})
        created.append(rel(REFS_JSON))
    return created


def cmd_init(_args) -> None:
    created = ensure_skeleton()
    emit({"ok": True, "library": str(LIBRARY), "created": created,
          "summary": f"库骨架就绪（新建 {len(created)} 项）。"})


def cmd_status(_args) -> None:
    ensure_skeleton()
    refs = read_json(REFS_JSON, {"refs": {}}).get("refs", {})
    projects = sorted(p.name for p in PROJECTS.glob("*") if p.is_dir())
    figures = sorted(str(p.relative_to(LIBRARY).as_posix())
                     for p in PROJECTS.glob("*/figures/*.json"))
    drafts = sorted(str(p.relative_to(LIBRARY).as_posix())
                    for p in PROJECTS.glob("*/drafts/*.md"))
    journals = sorted(p.stem for p in JOURNALS.glob("*.json") if not p.name.startswith("_"))
    subs = [load_submission(p) for p in submission_files()]
    active = sorted(s.get("submissionId") for s in subs if s.get("status") in SUBMISSION_ACTIVE)
    pending = sorted(({"submissionId": s.get("submissionId"), "journal": s.get("journal"),
                       "status": s.get("status"), "nextAction": s.get("nextAction"),
                       "due": s.get("nextActionDue")}
                      for s in subs if s.get("nextActionDue") or s.get("nextAction")),
                     key=lambda row: row["due"] or "~")
    emit({
        "ok": True,
        "library": str(LIBRARY),
        "projects": projects,
        "counts": {"projects": len(projects), "refs": len(refs), "figures": len(figures),
                   "drafts": len(drafts), "journals": len(journals), "submissions": len(subs)},
        "journals": journals,
        "submissions": {"total": len(subs), "active": active, "pending": pending},
        "recentDrafts": drafts[-5:],
        "interpreter": sys.executable,
        "summary": (f"{len(projects)} 个课题 / {len(refs)} 条文献 / {len(figures)} 张已登记图 / "
                    f"{len(journals)} 份期刊档案 / {len(subs)} 条投稿记录"
                    + (f"（进行中 {len(active)}）" if active else "") + "。"),
    })


def cmd_new_project(args) -> None:
    ensure_skeleton()
    slug = slugify(args.slug)
    path = PROJECTS / slug
    existed = path.exists()
    path.mkdir(parents=True, exist_ok=True)
    for sub in PROJECT_SUBDIRS:
        (path / sub).mkdir(exist_ok=True)
    meta = read_json(path / "project.json", {
        "schema": 1, "slug": slug, "title": args.title or slug, "createdAt": now(),
        "journal": args.journal, "keywords": [], "notes": "",
    }) if (path / "project.json").exists() else {
        "schema": 1, "slug": slug, "title": args.title or slug, "createdAt": now(),
        "journal": args.journal, "keywords": [], "notes": "",
    }
    if args.title:
        meta["title"] = args.title
    if args.journal:
        meta["journal"] = args.journal
    meta["updatedAt"] = now()
    write_json(path / "project.json", meta)
    reindex(quiet=True)
    emit({"ok": True, "slug": slug, "path": str(path), "existed": existed,
          "subdirs": list(PROJECT_SUBDIRS),
          "summary": f"课题 {slug} {'已存在（补齐骨架）' if existed else '已创建'}：{path}"})


def cmd_list_projects(_args) -> None:
    ensure_skeleton()
    rows = []
    for path in sorted(p for p in PROJECTS.glob("*") if p.is_dir()):
        meta = read_json(path / "project.json", {})
        rows.append({
            "slug": path.name,
            "title": meta.get("title", path.name),
            "journal": meta.get("journal"),
            "figures": len(list((path / "figures").glob("*.json"))),
            "drafts": [p.name for p in sorted((path / "drafts").glob("*.md"))],
            "datasets": [p.name for p in sorted((path / "data").iterdir())
                         if p.is_file()] if (path / "data").exists() else [],
        })
    emit({"ok": True, "projects": rows, "summary": f"{len(rows)} 个课题。"})


# ─────────────────────────── 文献 ───────────────────────────

def make_ref_key(authors, year, title, taken: set[str]) -> str:
    surname = "anon"
    if authors:
        first = authors[0]
        surname = first.split(",")[0].split()[-1] if first else "anon"
    surname = re.sub(r"[^A-Za-z]", "", surname).lower() or "anon"
    word = ""
    for token in re.findall(r"[A-Za-z]{4,}", title or ""):
        if token.lower() not in {"the", "and", "with", "from", "using", "study", "effect",
                                 "analysis", "based", "between", "their"}:
            word = token.lower()
            break
    key = f"{surname}{year or 'n'}{word}"[:40]
    if key in taken:
        i = 2
        while f"{key}{chr(96 + i)}" in taken and i < 27:
            i += 1
        key = f"{key}{chr(96 + i)}"
    return key


def refs_to_bibtex(refs: dict) -> str:
    out = ["% 由 科研模式 research.py 生成 —— 不要手改，改 refs.json 后重跑 export-bib。", ""]
    for key, r in sorted(refs.items()):
        kind = {"article": "article", "book": "book", "inproceedings": "inproceedings",
                "thesis": "phdthesis", "misc": "misc", "preprint": "misc",
                "report": "techreport"}.get(r.get("type", "article"), "article")
        out.append(f"@{kind}{{{key},")
        if r.get("title"):
            out.append(f"  title = {{{r['title']}}},")
        if r.get("authors"):
            out.append(f"  author = {{{' and '.join(r['authors'])}}},")
        if r.get("year"):
            out.append(f"  year = {{{r['year']}}},")
        if r.get("container"):
            field = "journal" if kind == "article" else "booktitle"
            out.append(f"  {field} = {{{r['container']}}},")
        for src, dst in (("volume", "volume"), ("issue", "number"), ("pages", "pages"),
                         ("publisher", "publisher"), ("doi", "doi"), ("url", "url")):
            if r.get(src):
                out.append(f"  {dst} = {{{r[src]}}},")
        out.append(f"  note = {{Added by 科研模式 {r.get('addedAt', '')[:10]}}},")
        out.append("}\n")
    return "\n".join(out)


def cmd_export_bib(_args) -> None:
    ensure_skeleton()
    refs = read_json(REFS_JSON, {"refs": {}}).get("refs", {})
    write_text(REFS_BIB, refs_to_bibtex(refs))
    emit({"ok": True, "file": str(REFS_BIB), "count": len(refs),
          "summary": f"refs.bib 已重生成（{len(refs)} 条）。"})


def cmd_add_ref(args) -> None:
    ensure_skeleton()
    store = read_json(REFS_JSON, {"schema": 1, "refs": {}})
    refs = store.setdefault("refs", {})
    if not args.doi and not args.url:
        fail("拒绝入库：没有 DOI 也没有 URL 的记录不可溯源（硬规则 §4.3）。请先抓到 DOI 或 URL。")
    authors = [a.strip() for a in re.split(r"[;；]", args.authors or "") if a.strip()]
    key = args.key or make_ref_key(authors, args.year, args.title, set(refs))
    if key in refs and not args.force:
        fail(f"引用键已存在：{key}（要覆盖加 --force）")
    projects = sorted(set((refs.get(key, {}).get("projects") or []) + list(args.project or [])))
    record = {
        "key": key,
        "type": args.type,
        "title": args.title,
        "authors": authors,
        "year": args.year,
        "container": args.container,
        "volume": args.volume,
        "issue": args.issue,
        "pages": args.pages,
        "doi": args.doi,
        "url": args.url,
        "accessedAt": args.accessed or _dt.date.today().isoformat(),
        "source": args.source,
        "verifiedBy": args.verified_by,
        "projects": projects,
        "addedAt": refs.get(key, {}).get("addedAt", now()),
        "updatedAt": now(),
        "notes": args.notes or refs.get(key, {}).get("notes", ""),
    }
    refs[key] = record
    store["updatedAt"] = now()
    write_json(REFS_JSON, store)
    write_text(REFS_BIB, refs_to_bibtex(refs))
    emit({"ok": True, "key": key, "record": record, "totalRefs": len(refs),
          "summary": f"已入库 [{key}]（verifiedBy={record['verifiedBy']}）。引用写 [@{key}]。"})


def cmd_list_refs(args) -> None:
    ensure_skeleton()
    refs = read_json(REFS_JSON, {"refs": {}}).get("refs", {})
    rows = []
    for key, r in sorted(refs.items()):
        if args.project and args.project not in (r.get("projects") or []):
            continue
        if args.query:
            blob = json.dumps(r, ensure_ascii=False).lower()
            if args.query.lower() not in blob:
                continue
        rows.append({"key": key, "title": r.get("title"), "year": r.get("year"),
                     "container": r.get("container"), "doi": r.get("doi"),
                     "verifiedBy": r.get("verifiedBy"), "projects": r.get("projects")})
    emit({"ok": True, "refs": rows, "summary": f"{len(rows)} 条匹配。"})


# ─────────────────────────── 图 ───────────────────────────

def cmd_remove_ref(args) -> None:
    """删掉一条文献登记（refs.json + refs.bib 同步，删前先备份）。

    面板要能删文献，但面板**不许直接改登记索引** ⇒ 删除也必须走这条库脚本。
    先把手上的 refs.json 原样备份成 refs.json.bak，再删条目、重生成 refs.bib，
    最后如实报出「还有哪些草稿在引用这个键」——删完 check-citations 会把这些标成缺失。
    """
    ensure_skeleton()
    store = read_json(REFS_JSON, {"schema": 1, "refs": {}})
    refs = store.setdefault("refs", {})
    target = None
    if args.key and args.key in refs:
        target = args.key
    elif args.key:
        fail(f"没有这条文献：{args.key}（当前 {len(refs)} 条：{'、'.join(sorted(refs)) or '空'}）")
    elif args.doi:
        want = args.doi.strip().lower()
        for k, r in refs.items():
            if (r.get("doi") or "").strip().lower() == want:
                target = k
                break
        if target is None:
            fail(f"没有 DOI 为 {args.doi} 的文献（当前 {len(refs)} 条）。")
    else:
        fail("remove-ref 需要 --key <引用键> 或 --doi <DOI>。")

    record = refs.pop(target)
    backup = REFS_JSON.parent / (REFS_JSON.name + ".bak")
    store["updatedAt"] = now()
    # 备份的是「删之前」的整份 refs.json（含被删条目），所以先写备份再落库。
    refs[target] = record
    write_text(backup, json.dumps(store, ensure_ascii=False, indent=1) + "\n")
    del refs[target]
    write_json(REFS_JSON, store)
    write_text(REFS_BIB, refs_to_bibtex(refs))

    cited = []
    for draft in sorted(PROJECTS.glob("*/drafts/*.md")):
        try:
            text = draft.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if target in extract_keys(text):
            cited.append(rel(draft))
    summary = f"已删除文献 [{target}]（剩 {len(refs)} 条）；删前的 refs.json 备份在 {backup.name}。"
    if cited:
        summary += f" 注意：{'、'.join(cited)} 还在引用它，引用核查会报缺失。"
    emit({"ok": True, "key": target, "removed": record, "totalRefs": len(refs),
          "backup": str(backup), "citedIn": cited, "summary": summary})


def _next_figure_id(existing) -> str:
    """下一个 fig 编号 = max(figN)+1。

    不能用 len(existing)+1：figures/ 里一旦有编号空洞（fig1/fig2/fig4），
    len+1 算出来的是 fig4，会静默覆盖已有的 fig4.json 侧车，丢掉溯源。
    """
    nums = []
    for p in existing:
        m = re.match(r"^fig(\d+)\.json$", p.name, re.I)
        if m:
            nums.append(int(m.group(1)))
    return f"fig{max(nums) + 1 if nums else 1}"


def cmd_register_figure(args) -> None:
    ensure_skeleton()
    pdir = project_dir(args.project)
    figdir = pdir / "figures"
    figdir.mkdir(exist_ok=True)
    existing = sorted(figdir.glob("fig*.json"))
    figure_id = args.figure_id or _next_figure_id(existing)
    overwrite = (figdir / f"{figure_id}.json").exists()
    params = {}
    _raw_params = args.params
    # 支持 params-b64：Windows shell（PowerShell/cmd）会吞掉 --params 里的双引号，
    # 用 base64 传 JSON 可以绕开引号转义问题。
    if not _raw_params and getattr(args, "params_b64", None):
        try:
            _raw_params = base64.b64decode(args.params_b64).decode("utf-8")
        except Exception as exc:
            fail(f"--params-b64 解码失败：{exc}")
    if _raw_params:
        try:
            params = json.loads(_raw_params)
        except json.JSONDecodeError as exc:
            fail(f"--params 不是合法 JSON：{exc}")
    record = {
        "schema": 1,
        "figureId": figure_id,
        "project": pdir.name,
        "file": rel(Path(args.file)) if args.file else None,
        "files": [rel(Path(f)) for f in (args.extra_file or [])],
        "graph": args.graph,
        "sourceData": [rel(Path(d)) for d in (args.data or [])],
        "journal": args.journal,
        "params": params,
        "originProject": rel(Path(args.opju)) if args.opju else None,
        "spec": rel(Path(args.spec)) if args.spec else None,
        "caption": args.caption,
        "createdAt": now(),
    }
    warnings = ([f"将覆盖已有侧车 figures/{figure_id}.json"
                 + ("（--figure-id 给了重复编号）" if args.figure_id else "")]
                if overwrite else [])
    for label, value in (("file", args.file), ("opju", args.opju), ("spec", args.spec)):
        if value and not Path(value).exists():
            warnings.append(f"{label} 指向的文件不存在：{value}")
    for data in (args.data or []):
        if not Path(data).exists():
            warnings.append(f"源数据不存在：{data}")
    write_json(figdir / f"{figure_id}.json", record)
    reindex(quiet=True)
    emit({"ok": True, "figureId": figure_id, "sidecar": str(figdir / f"{figure_id}.json"),
          "warnings": warnings, "record": record,
          "summary": (f"已登记 {figure_id} → figures/{figure_id}.json（图可回溯）。"
                      + (f" 警告 {len(warnings)} 条。" if warnings else ""))})


def cmd_list_figures(args) -> None:
    ensure_skeleton()
    rows = []
    pattern = f"{slugify(args.project)}/figures/*.json" if args.project else "*/figures/*.json"
    for path in sorted(PROJECTS.glob(pattern)):
        r = read_json(path, {})
        rows.append({"project": path.parent.parent.name, "figureId": r.get("figureId"),
                     "file": r.get("file"), "journal": r.get("journal"),
                     "sourceData": r.get("sourceData"), "graph": r.get("graph")})
    emit({"ok": True, "figures": rows, "summary": f"{len(rows)} 张已登记图。"})


# ─────────────────────────── 索引与检索 ───────────────────────────

def reindex(quiet: bool = False) -> dict:
    ensure_skeleton()
    entries = []
    refs = read_json(REFS_JSON, {"refs": {}}).get("refs", {})
    for key, r in refs.items():
        entries.append({"kind": "ref", "id": key, "project": None,
                        "title": r.get("title"), "path": rel(REFS_JSON),
                        "tags": [r.get("container") or "", str(r.get("year") or "")],
                        "text": " ".join(filter(None, [key, r.get("title"), r.get("container"),
                                                       " ".join(r.get("authors") or []), r.get("doi")]))})
    for pdir in sorted(p for p in PROJECTS.glob("*") if p.is_dir()):
        meta = read_json(pdir / "project.json", {})
        entries.append({"kind": "project", "id": pdir.name, "project": pdir.name,
                        "title": meta.get("title", pdir.name), "path": rel(pdir),
                        "tags": [meta.get("journal") or ""], "text": meta.get("title", "")})
        # 图 / 稿 / 数据 / 表 / 笔记都按**递归**扫：import 允许 figures/data/drafts
        # 下面再分子目录，只扫顶层会让这些文件在检索里凭空消失（2026-10-19 修）。
        for path in sorted((pdir / "figures").rglob("*.json")):
            if path.name.startswith("_"):
                continue
            r = read_json(path, {})
            figure_id = (r.get("figureId")
                         or path.relative_to(pdir / "figures").with_suffix("").as_posix())
            entries.append({"kind": "figure", "id": figure_id,
                            "project": pdir.name, "title": r.get("caption") or figure_id,
                            "path": rel(path), "tags": [r.get("journal") or "", r.get("graph") or ""],
                            "text": " ".join(filter(None, [figure_id, r.get("caption"),
                                                           r.get("graph"), r.get("journal")]))})
        for path in sorted((pdir / "drafts").rglob("*.md")):
            text = _read_head(path)
            heading = _first_heading(text)
            draft_id = path.relative_to(pdir / "drafts").as_posix()
            entries.append({"kind": "draft", "id": draft_id, "project": pdir.name,
                            "title": heading or Path(draft_id).stem, "path": rel(path), "tags": [],
                            "text": " ".join(filter(None, [draft_id, heading, text])),
                            "bytes": path.stat().st_size})
        for kind, sub in (("dataset", "data"), ("table", "tables"), ("note", "notes")):
            base = pdir / sub
            if not base.exists():
                continue
            for path in sorted(p for p in base.rglob("*") if p.is_file()):
                entry_id = path.relative_to(base).as_posix()
                suffix = path.suffix.lower()
                text = _read_head(path) if suffix in (".md", ".txt") else entry_id
                heading = _first_heading(text) if suffix == ".md" else ""
                entries.append({"kind": kind, "id": entry_id, "project": pdir.name,
                                "title": heading or entry_id, "path": rel(path),
                                "tags": [suffix.lstrip(".")],
                                "text": " ".join(filter(None, [entry_id, heading, text])),
                                "bytes": path.stat().st_size})
    for path in sorted(JOURNALS.glob("*.json")):
        if path.name.startswith("_"):
            continue
        j = read_json(path, {})
        entries.append({"kind": "journal", "id": path.stem, "project": None,
                        "title": f"{j.get('name', path.stem)} {j.get('nameZh', '')}".strip(),
                        "path": rel(path), "tags": [j.get("language") or ""],
                        "text": " ".join(filter(None, [path.stem, j.get("name"), j.get("nameZh"),
                                                       j.get("publisher")]))})
    for path in submission_files():
        r = load_submission(path)
        entries.append({"kind": "submission", "id": r.get("submissionId", path.stem),
                        "project": r.get("project"),
                        "title": r.get("title") or r.get("journalName") or path.stem,
                        "path": rel(path),
                        "tags": [r.get("status") or "", r.get("journal") or ""],
                        "text": " ".join(filter(None, [r.get("submissionId"), r.get("title"),
                                                       r.get("journal"), r.get("journalName"),
                                                       r.get("manuscriptId"), r.get("doi"),
                                                       r.get("nextAction")]))})
    counts: dict[str, int] = {}
    for entry in entries:
        counts[entry["kind"]] = counts.get(entry["kind"], 0) + 1
    payload = {"schema": 1, "generatedAt": now(), "library": str(LIBRARY),
               "counts": counts, "entries": entries}
    write_json(INDEX, payload)
    if not quiet:
        emit({"ok": True, "index": str(INDEX), "counts": counts,
              "summary": f"索引重建完成：{counts}"})
    return payload


def cmd_reindex(_args) -> None:
    reindex(quiet=False)


def cmd_search(args) -> None:
    if not INDEX.exists():
        reindex(quiet=True)
    data = read_json(INDEX, {"entries": []})
    needle = args.query.lower()
    hits = []
    for entry in data.get("entries", []):
        if args.kind and entry.get("kind") != args.kind:
            continue
        if args.project and entry.get("project") != slugify(args.project):
            continue
        blob = " ".join(filter(None, [entry.get("id"), entry.get("title"), entry.get("path"),
                                      " ".join(entry.get("tags") or []), entry.get("text")])).lower()
        if needle in blob:
            score = 2 if needle in (entry.get("title") or "").lower() else 1
            hits.append((score, {k: entry.get(k) for k in ("kind", "id", "project", "title", "path")}))
    hits.sort(key=lambda pair: (-pair[0], pair[1].get("kind") or ""))
    rows = [h[1] for h in hits[: args.limit]]
    emit({"ok": True, "query": args.query, "hits": rows, "total": len(hits),
          "summary": f"命中 {len(hits)} 条（显示前 {len(rows)} 条）。"})


# ─────────────────────────── 引用核查闸门 ───────────────────────────

FENCE = re.compile(r"```.*?```", re.S)
INLINE_CODE = re.compile(r"`[^`]*`")
BRACKET_CITE = re.compile(r"\[([^\]]*@[^\]]*)\]")
TEX_CITE = re.compile(r"\\cite[a-z]*\{([^}]*)\}")


def extract_keys(text: str) -> list[str]:
    stripped = INLINE_CODE.sub(" ", FENCE.sub(" ", text))
    keys: list[str] = []
    for chunk in BRACKET_CITE.findall(stripped):
        for part in chunk.split(";"):
            part = part.strip()
            if not part.startswith("@"):
                continue
            part = part[1:]
            part = re.split(r"[,\s]", part)[0].strip()
            if part:
                keys.append(part)
    for chunk in TEX_CITE.findall(stripped):
        keys.extend(k.strip() for k in chunk.split(",") if k.strip())
    return keys


def cmd_check_citations(args) -> None:
    ensure_skeleton()
    draft = Path(args.draft)
    if not draft.exists():
        fail(f"草稿不存在：{draft}")
    refs = read_json(REFS_JSON, {"refs": {}}).get("refs", {})
    found = extract_keys(draft.read_text(encoding="utf-8"))
    unknown = sorted({k for k in found if k not in refs})
    unverified = sorted({k for k in found if k in refs and refs[k].get("verifiedBy") == "unverified"})
    missing_trace = sorted({k for k in found
                            if k in refs and not refs[k].get("doi") and not refs[k].get("url")})
    problems = []
    if unknown:
        problems.append(f"引用了库里没有的键：{', '.join(unknown)}")
    if unverified:
        problems.append(f"引用的记录 verifiedBy=unverified：{', '.join(unverified)}")
    if missing_trace:
        problems.append(f"引用的记录既无 DOI 也无 URL：{', '.join(missing_trace)}")
    if args.require_doi:
        no_doi = sorted({k for k in found if k in refs and not refs[k].get("doi")})
        if no_doi:
            problems.append(f"--require-doi：以下记录缺 DOI：{', '.join(no_doi)}")
    unused = sorted(set(refs) - set(found)) if args.list_unused else []
    emit({
        "ok": not problems,
        "draft": str(draft),
        "citedKeys": sorted(set(found)),
        "citationCount": len(found),
        "unknown": unknown,
        "unverified": unverified,
        "missingTraceability": missing_trace,
        "unusedRefs": unused,
        "problems": problems,
        "caveat": ("本核查只能证明「每个引用键都能在库里找到、且该条带有 DOI 或 URL」；"
                   "它**不能**证明被引文献的内容真的支持这句话。内容层面必须由人或模型逐条读过。"),
        "summary": "引用核查通过。" if not problems else "引用核查未通过：" + "；".join(problems),
    }, 0 if not problems else 1)


# ─────────────────────────── 投稿 ───────────────────────────
#
# 一条投稿 = submissions/<submissionId>.json，存的是「这件事的事实」：
# 投给谁、稿子在哪、现在什么状态、下一步要做什么、什么时候该有回音。
# 状态只能取 SUBMISSION_STATUSES 里的词；每次改状态都会往 events 里追加一条，
# 所以这个文件既是台账也是时间线。

def submission_files() -> list[Path]:
    return sorted(p for p in SUBMISSIONS.glob("*.json") if not p.name.startswith("_"))


def load_submission(path: Path) -> dict:
    record = read_json(path, {})
    record.setdefault("submissionId", path.stem)
    return record


def journal_profiles() -> dict:
    """journals/*.json 的键表，用来把 --journal 归一化到档案键。"""
    out = {}
    for path in sorted(JOURNALS.glob("*.json")):
        if path.name.startswith("_"):
            continue
        j = read_json(path, {})
        out[path.stem] = {"key": path.stem, "name": j.get("name") or path.stem,
                          "nameZh": j.get("nameZh"), "confidence": j.get("confidence")}
    return out


def find_submission(token: str) -> Path:
    slug = slugify(token)
    for path in submission_files():
        if path.stem == token or slugify(path.stem) == slug:
            return path
    hits = [p for p in submission_files() if p.stem.startswith(token)]
    if len(hits) == 1:
        return hits[0]
    fail(f"投稿记录不存在：{token}（用 list-submissions 看全部 id）")


def check_status(status: str) -> str:
    if status not in SUBMISSION_STATUSES:
        fail(f"未知投稿状态：{status}（可选：{' / '.join(SUBMISSION_STATUSES)}）")
    return status


def submission_row(record: dict, path: Path) -> dict:
    events = record.get("events") or []
    last = events[-1] if events else {}
    return {
        "submissionId": record.get("submissionId", path.stem),
        "project": record.get("project"),
        "journal": record.get("journal"),
        "journalName": record.get("journalName"),
        "title": record.get("title"),
        "status": record.get("status"),
        "manuscript": record.get("manuscript"),
        "manuscriptId": record.get("manuscriptId"),
        "doi": record.get("doi"),
        "submittedAt": record.get("submittedAt"),
        "decisionExpectedAt": record.get("decisionExpectedAt"),
        "nextAction": record.get("nextAction"),
        "nextActionDue": record.get("nextActionDue"),
        "lastEvent": last,
        "events": len(events),
        "updatedAt": record.get("updatedAt"),
        "path": rel(path),
    }


def cmd_add_submission(args) -> None:
    ensure_skeleton()
    check_status(args.status)
    profiles = journal_profiles()
    warnings: list[str] = []
    key, journal_name = args.journal, args.journal
    if args.journal in profiles:
        journal_name = profiles[key]["name"]
    else:
        match = [k for k, v in profiles.items()
                 if (v["name"] or "").strip().lower() == (args.journal or "").strip().lower()
                 or (v["nameZh"] or "").strip() == (args.journal or "").strip()]
        if match:
            key = match[0]
            journal_name = profiles[key]["name"]
        else:
            warnings.append(f"期刊 {args.journal!r} 不在 journals/ 的 {len(profiles)} 份档案里"
                            "——先落期刊档案（journal-index.py），或核对拼写")
    pdir = project_dir(args.project) if args.project else None
    if not args.manuscript and not args.title:
        fail("至少给 --manuscript 或 --title：投稿记录必须有据可查，不许留空壳")
    if args.manuscript and not Path(args.manuscript).exists():
        warnings.append(f"稿件文件不存在：{args.manuscript}")
    for extra in (args.cover_letter, *(args.file or [])):
        if extra and not Path(extra).exists():
            warnings.append(f"附件不存在：{extra}")
    if pdir is not None and args.manuscript:
        manuscript_abs = Path(args.manuscript)
        if manuscript_abs.resolve() != manuscript_abs and not str(manuscript_abs).startswith(str(LIBRARY)):
            warnings.append("稿件路径按当前工作目录解析，不在库里——登记的是绝对路径，面板会照实显示")
    submission_id = args.id or "-".join(
        filter(None, [slugify(key or args.journal), slugify(pdir.name if pdir else (args.title or ""))]))[:60]
    target = SUBMISSIONS / f"{submission_id}.json"
    if target.exists() and not args.force:
        fail(f"投稿记录已存在：{submission_id}（改状态用 update-submission；要重建加 --force）")
    stamp = now()
    record = {
        "schema": 1,
        "submissionId": submission_id,
        "project": pdir.name if pdir else None,
        "journal": key,
        "journalName": journal_name,
        "title": args.title,
        "type": args.type,
        "status": args.status,
        "manuscript": rel(Path(args.manuscript)) if args.manuscript else None,
        "manuscriptId": args.manuscript_id,
        "doi": args.doi,
        "coverLetter": rel(Path(args.cover_letter)) if args.cover_letter else None,
        "files": [rel(Path(f)) for f in (args.file or [])],
        "submittedAt": args.submitted_at,
        "decisionExpectedAt": args.decision_expected_at,
        "nextAction": args.next_action,
        "nextActionDue": args.next_action_due,
        "events": [{"at": stamp, "status": args.status, "note": args.note or "建立投稿记录"}],
        "createdAt": stamp,
        "updatedAt": stamp,
    }
    write_json(target, record)
    reindex(quiet=True)
    emit({"ok": True, "submissionId": submission_id, "record": record, "warnings": warnings,
          "summary": (f"已登记投稿 {submission_id}（{journal_name} · {args.status}）"
                      + (f"；警告 {len(warnings)} 条" if warnings else "") + "。")})


def cmd_list_submissions(args) -> None:
    ensure_skeleton()
    rows = []
    for path in submission_files():
        record = load_submission(path)
        if args.project and (record.get("project") or "") != slugify(args.project):
            continue
        if args.status and record.get("status") != args.status:
            continue
        if args.journal and (record.get("journal") or "") != args.journal:
            continue
        if args.active and record.get("status") not in SUBMISSION_ACTIVE:
            continue
        rows.append(submission_row(record, path))
    if args.due:
        rows = [r for r in rows if r.get("nextActionDue")]
        rows.sort(key=lambda r: r["nextActionDue"] or "~")
    else:
        rows.sort(key=lambda r: (r.get("status") not in SUBMISSION_ACTIVE, r.get("updatedAt") or ""))
    emit({"ok": True, "submissions": rows, "count": len(rows),
          "summary": f"{len(rows)} 条投稿记录。" + ("" if rows else "（还没有登记过投稿）")})


def cmd_update_submission(args) -> None:
    ensure_skeleton()
    path = find_submission(args.id)
    record = load_submission(path)
    changes = {}
    events = record.setdefault("events", [])
    if args.status:
        check_status(args.status)
        record["status"] = args.status
        changes["status"] = args.status
        events.append({"at": now(), "status": args.status, "note": args.note or "状态更新"})
    elif args.note:
        events.append({"at": now(), "status": record.get("status"), "note": args.note})
        changes["note"] = args.note
    for field, arg in (("title", "title"), ("type", "type"), ("manuscriptId", "manuscript_id"),
                       ("doi", "doi"), ("submittedAt", "submitted_at"),
                       ("decisionExpectedAt", "decision_expected_at"),
                       ("nextAction", "next_action"), ("nextActionDue", "next_action_due")):
        value = getattr(args, arg)
        if value is not None:
            record[field] = value
            changes[field] = value
    if args.manuscript:
        if not Path(args.manuscript).exists():
            events.append({"at": now(), "status": record.get("status"),
                           "note": f"稿件文件不存在：{args.manuscript}"})
        record["manuscript"] = rel(Path(args.manuscript))
        changes["manuscript"] = record["manuscript"]
    for extra in (args.file or []):
        record.setdefault("files", []).append(rel(Path(extra)))
        changes.setdefault("files", []).append(rel(Path(extra)))
    if not changes:
        fail("什么都没改：给 --status / --note / --next-action / --decision-expected-at … 里至少一个")
    record["updatedAt"] = now()
    write_json(path, record)
    reindex(quiet=True)
    emit({"ok": True, "submissionId": record.get("submissionId"), "changed": changes,
          "status": record.get("status"), "events": len(events),
          "summary": f"{record.get('submissionId')} 已更新：{', '.join(changes)}（状态 {record.get('status')}）。"})


# ─────────────────────────── CLI ───────────────────────────

# ─────────────────────────── 投稿闸门：体检 / 打包 ───────────────────────────
# 「查得到 → 合规格 → 打得包」。体检只读、可以反复跑；打包只写
# submissions/packages/ 下的 zip，不动任何登记记录，也不替人下结论
# （档案里的数值是默认值，最终以刊方现行要求为准）。

CHECK_VERDICTS = ("fail", "warn", "na", "pass")
MAX_INDEX_TEXT = 4000


def load_journal(key: str) -> dict:
    """期刊档案键（或刊名）→ 完整档案。找不到就报错，不猜。"""
    path = JOURNALS / f"{key}.json"
    if not path.exists():
        profiles = journal_profiles()
        match = [k for k, v in profiles.items()
                 if (v.get("name") or "").strip().lower() == (key or "").strip().lower()
                 or (v.get("nameZh") or "").strip() == (key or "").strip()]
        if len(match) == 1:
            path = JOURNALS / f"{match[0]}.json"
        else:
            fail(f"期刊档案不存在：{key}（journals/ 下现有 {len(profiles)} 份："
                 f"{', '.join(sorted(profiles)) or '无'}）")
    journal = read_json(path, {})
    journal["key"] = path.stem
    return journal


def _read_head(path: Path, limit: int = MAX_INDEX_TEXT) -> str:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            return fh.read(limit)
    except OSError:
        return ""


def _head_bytes(path: Path, limit: int = 1 << 20) -> bytes:
    try:
        with path.open("rb") as fh:
            return fh.read(limit)
    except OSError:
        return b""


def _first_heading(text: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
    return ""


CJK_CHAR = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")
LATIN_WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9'’\-]*")


def count_words(text: str) -> int:
    """中英混排的「字数」：CJK 按字，拉丁按词。"""
    return len(LATIN_WORD.findall(CJK_CHAR.sub(" ", text))) + len(CJK_CHAR.findall(text))


def extract_abstract(text: str) -> str | None:
    lines = text.splitlines()
    start = None
    for index, line in enumerate(lines):
        if re.match(r"^#{1,6}\s*(abstract|摘要)\s*$", line.strip(), re.I):
            start = index + 1
            break
    if start is None:
        return None
    body = []
    for line in lines[start:]:
        if re.match(r"^#{1,6}\s+", line.strip()):
            break
        body.append(line)
    return "\n".join(body).strip()


# ── 图像元数据（不装 Pillow：PNG/JPEG/TIFF/SVG 的头几十字节够用了） ──

def _png_info(data: bytes) -> dict | None:
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return None
    width = height = None
    dpi = None
    pos = 8
    while pos + 8 <= len(data):
        length = int.from_bytes(data[pos:pos + 4], "big")
        chunk_type = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        if chunk_type == b"IHDR" and len(body) >= 8:
            width = int.from_bytes(body[0:4], "big")
            height = int.from_bytes(body[4:8], "big")
        elif chunk_type == b"pHYs" and len(body) >= 9 and body[8] == 1:
            pixels_per_meter = int.from_bytes(body[0:4], "big")
            if pixels_per_meter:
                dpi = round(pixels_per_meter * 0.0254)
        elif chunk_type == b"IDAT":
            break
        pos += 12 + length
    return {"widthPx": width, "heightPx": height, "dpi": dpi}


def _jpeg_info(data: bytes) -> dict | None:
    if not data.startswith(b"\xff\xd8"):
        return None
    width = height = None
    dpi = None
    pos = 2
    while pos + 4 <= len(data):
        if data[pos] != 0xFF:
            pos += 1
            continue
        marker = data[pos + 1]
        pos += 2
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            continue
        if pos + 2 > len(data):
            break
        length = int.from_bytes(data[pos:pos + 2], "big")
        if length < 2:
            break
        body = data[pos + 2:pos + length]
        if marker == 0xE0 and body.startswith(b"JFIF\x00") and len(body) >= 14:
            unit = body[7]
            density = int.from_bytes(body[8:10], "big")
            if unit == 1 and density:
                dpi = density
            elif unit == 2 and density:
                dpi = round(density * 2.54)
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                      0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            if len(body) >= 5:
                height = int.from_bytes(body[1:3], "big")
                width = int.from_bytes(body[3:5], "big")
            break
        pos += length
    return {"widthPx": width, "heightPx": height, "dpi": dpi}


def _tiff_info(data: bytes) -> dict | None:
    if data[:2] not in (b"II", b"MM"):
        return None
    endian = "<" if data[:2] == b"II" else ">"
    if int.from_bytes(data[2:4], endian) != 42:
        return None
    ifd = int.from_bytes(data[4:8], endian)
    if ifd + 2 > len(data):
        return None
    count = int.from_bytes(data[ifd:ifd + 2], endian)
    width = height = None
    x_resolution = None
    unit = 2
    for index in range(count):
        offset = ifd + 2 + index * 12
        if offset + 12 > len(data):
            break
        tag = int.from_bytes(data[offset:offset + 2], endian)
        field_type = int.from_bytes(data[offset + 2:offset + 4], endian)
        if field_type == 3:
            value = int.from_bytes(data[offset + 8:offset + 10], endian)
        elif field_type == 4:
            value = int.from_bytes(data[offset + 8:offset + 12], endian)
        elif field_type == 5:
            pointer = int.from_bytes(data[offset + 8:offset + 12], endian)
            if pointer + 8 > len(data):
                continue
            numerator = int.from_bytes(data[pointer:pointer + 4], endian)
            denominator = int.from_bytes(data[pointer + 4:pointer + 8], endian)
            value = (numerator / denominator) if denominator else None
        else:
            continue
        if tag == 256:
            width = value
        elif tag == 257:
            height = value
        elif tag == 282:
            x_resolution = value
        elif tag == 296:
            unit = value
    dpi = None
    if x_resolution:
        dpi = round(x_resolution * (2.54 if unit == 3 else 1))
    return {"widthPx": width, "heightPx": height, "dpi": dpi}


def _svg_info(text: str) -> dict:
    def size(attr: str):
        match = re.search(r'\b' + attr + r'\s*=\s*["\']([^"\']+)["\']', text)
        if not match:
            return None
        unit = re.match(r"^([\d.]+)\s*(mm|cm|in|pt|px)?$", match.group(1).strip())
        if not unit:
            return None
        factor = {"mm": 1.0, "cm": 10.0, "in": 25.4,
                  "pt": 25.4 / 72.0, "px": 25.4 / 96.0}[unit.group(2) or "px"]
        return float(unit.group(1)) * factor
    return {"widthMm": size("width"), "heightMm": size("height"),
            "vector": True, "dpi": None}


def image_meta(path: Path) -> dict | None:
    ext = path.suffix.lower()
    try:
        if ext == ".png":
            info = _png_info(_head_bytes(path))
        elif ext in (".jpg", ".jpeg"):
            info = _jpeg_info(_head_bytes(path))
        elif ext in (".tif", ".tiff"):
            info = _tiff_info(_head_bytes(path))
        elif ext == ".svg":
            info = _svg_info(_read_head(path, 262144))
        elif ext in (".pdf", ".eps"):
            return {"format": ext[1:], "vector": True, "dpi": None}
        else:
            return None
    except Exception:  # 损坏的文件不该让整次体检崩掉
        return None
    if not info:
        return None
    info["format"] = ext[1:]
    return info


# ── 体检主体 ──

def _check(checks: list[dict], check_id: str, label: str, status: str, detail: str) -> None:
    checks.append({"id": check_id, "label": label, "status": status, "detail": detail})


def _resolve_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else (LIBRARY / path)


def resolve_manuscript(pdir: Path | None, draft: str | None = None,
                       submission_id: str | None = None) -> Path | None:
    if draft:
        return _resolve_path(draft)
    if submission_id:
        record = load_submission(find_submission(submission_id))
        if record.get("manuscript"):
            return _resolve_path(record["manuscript"])
    if pdir is not None:
        for name in ("main.md", "manuscript.md"):
            candidate = pdir / "drafts" / name
            if candidate.exists():
                return candidate
        matches = sorted((pdir / "drafts").glob("*.md"))
        if matches:
            return matches[0]
    return None


def journal_check(project_slug: str, journal_key: str | None = None, draft: str | None = None,
                  submission_id: str | None = None) -> dict:
    ensure_skeleton(quiet=True)
    pdir = project_dir(project_slug)
    meta = read_json(pdir / "project.json", {})
    key = journal_key or meta.get("journal")
    if not key:
        fail("没说投哪本刊：给 --journal <档案键>，或在 project.json 里设 journal")
    journal = load_journal(key)
    figure_cfg = journal.get("figure") or {}
    text_cfg = journal.get("text") or {}
    refs_cfg = journal.get("references") or {}
    checks: list[dict] = []

    _check(checks, "journal.profile", "期刊档案", "pass",
           f"{journal.get('name')}（{journal.get('key')}）· confidence={journal.get('confidence')}")

    # 图：每条侧车查存在性、格式、像素/DPI、栏宽、字号线宽。
    sidecars = sorted(p for p in (pdir / "figures").rglob("*.json")) if (pdir / "figures").exists() else []
    if not sidecars:
        _check(checks, "figures.none", "已登记图", "warn", "这个课题还没有登记过图（register-figure）")
    for sidecar_path in sidecars:
        record = read_json(sidecar_path, {})
        figure_id = record.get("figureId") or sidecar_path.stem
        file_value = record.get("file")
        if not file_value:
            _check(checks, f"figure.{figure_id}.file", f"{figure_id} 图文件", "fail", "侧车没有 file 字段")
            continue
        image_path = _resolve_path(file_value)
        if not image_path.exists():
            _check(checks, f"figure.{figure_id}.exists", f"{figure_id} 图文件", "fail",
                   f"文件不存在：{file_value}")
            continue
        info = image_meta(image_path)
        if info is None:
            _check(checks, f"figure.{figure_id}.format", f"{figure_id} 图格式", "na",
                   f"读不出元数据（{image_path.suffix or '无扩展名'}）")
            continue
        vector = bool(info.get("vector"))
        if figure_cfg.get("vectorPreferred") and not vector:
            _check(checks, f"figure.{figure_id}.vector", f"{figure_id} 矢量图", "warn",
                   "期刊偏好矢量图（SVG/PDF），这张是位图")
        needed_dpi = (figure_cfg.get("rasterDpi") or {}).get("photo") or 300
        if vector:
            width_mm = info.get("widthMm")
            height_mm = info.get("heightMm")
            if width_mm is None:
                _check(checks, f"figure.{figure_id}.size", f"{figure_id} 物理尺寸", "na",
                       "SVG 没写 width/height（只有 viewBox），量不出毫米宽度")
        else:
            width_px = info.get("widthPx")
            height_px = info.get("heightPx")
            if not width_px or not height_px:
                _check(checks, f"figure.{figure_id}.size", f"{figure_id} 像素尺寸", "na", "读不出宽高")
                continue
            dpi = info.get("dpi")
            effective_dpi = needed_dpi
            if dpi is None:
                _check(checks, f"figure.{figure_id}.dpi", f"{figure_id} DPI", "warn",
                       f"缺 DPI 元数据，按 {needed_dpi} dpi 折算打印尺寸")
            else:
                effective_dpi = dpi
                _check(checks, f"figure.{figure_id}.dpi", f"{figure_id} DPI",
                       "pass" if dpi >= needed_dpi else "fail",
                       f"{dpi} dpi（档案要求 ≥ {needed_dpi}）")
            width_mm = width_px / effective_dpi * 25.4
            height_mm = height_px / effective_dpi * 25.4
        single = figure_cfg.get("singleColumnMm")
        double = figure_cfg.get("doubleColumnMm")
        if width_mm is not None:
            # 宽度不是「≤ 单栏」就通过：0.8 mm 的缩略图也满足不等式，却根本不能印。
            # 判据：过窄（不到单栏一半）直接 fail；单栏内 / 贴近双栏 pass；跨在中间 warn。
            near_double = bool(double) and abs(width_mm - double) <= double * 0.08
            if single and width_mm < single * 0.5:
                _check(checks, f"figure.{figure_id}.width", f"{figure_id} 栏宽", "fail",
                       f"{width_mm:.1f} mm 过窄（单栏 {single} mm 的一半都不到），要按栏宽重新导出")
            elif near_double:
                _check(checks, f"figure.{figure_id}.width", f"{figure_id} 栏宽", "pass",
                       f"{width_mm:.1f} mm ≈ 双栏 {double} mm")
            elif single and width_mm <= single + 0.5:
                _check(checks, f"figure.{figure_id}.width", f"{figure_id} 栏宽", "pass",
                       f"{width_mm:.1f} mm ≤ 单栏 {single} mm")
            elif double and width_mm <= double + 0.5:
                _check(checks, f"figure.{figure_id}.width", f"{figure_id} 栏宽", "warn",
                       f"{width_mm:.1f} mm 落在单栏 {single} / 双栏 {double} mm 之间，缩到单栏或扩到双栏")
            elif double:
                _check(checks, f"figure.{figure_id}.width", f"{figure_id} 栏宽", "fail",
                       f"{width_mm:.1f} mm > 双栏上限 {double} mm")
            else:
                _check(checks, f"figure.{figure_id}.width", f"{figure_id} 栏宽", "na",
                       f"{width_mm:.1f} mm（档案没写栏宽）")
        max_height = figure_cfg.get("maxHeightMm")
        if height_mm is not None and max_height:
            _check(checks, f"figure.{figure_id}.height", f"{figure_id} 图高",
                   "pass" if height_mm <= max_height else "fail",
                   f"{height_mm:.1f} / {max_height} mm")
        params = record.get("params") or {}
        font_pt = params.get("fontPt") or params.get("fontSize")
        line_pt = params.get("lineWidthPt") or params.get("lineWidth")
        min_font = figure_cfg.get("minFontPt")
        max_font = figure_cfg.get("maxFontPt")
        if font_pt is None:
            _check(checks, f"figure.{figure_id}.font", f"{figure_id} 字号", "na",
                   "侧车没记字号（register-figure --params 里带 fontPt）")
        elif min_font is not None and font_pt < min_font:
            _check(checks, f"figure.{figure_id}.font", f"{figure_id} 字号", "fail",
                   f"{font_pt} pt < 下限 {min_font} pt")
        elif max_font is not None and font_pt > max_font:
            _check(checks, f"figure.{figure_id}.font", f"{figure_id} 字号", "warn",
                   f"{font_pt} pt > 档案常见上限 {max_font} pt")
        else:
            _check(checks, f"figure.{figure_id}.font", f"{figure_id} 字号", "pass", f"{font_pt} pt")
        if line_pt is not None and figure_cfg.get("lineWidthPt") is not None:
            _check(checks, f"figure.{figure_id}.line", f"{figure_id} 线宽", "na",
                   f"侧车线宽 {line_pt} pt（档案建议 {figure_cfg.get('lineWidthPt')} pt，仅供参考）")

    # 稿：标题长度、摘要字数、引用键、DOI、作者列表长度。
    manuscript = resolve_manuscript(pdir, draft, submission_id)
    if manuscript is None or not manuscript.exists():
        _check(checks, "manuscript.exists", "稿件", "fail",
               "找不到稿件：给 --draft，或把稿子放在 drafts/main.md")
    else:
        text = _read_head(manuscript, 1 << 20)
        if not text.strip():
            _check(checks, "manuscript.empty", "稿件", "fail", f"稿件是空的：{rel(manuscript)}")
        else:
            _check(checks, "manuscript.exists", "稿件", "pass",
                   f"{rel(manuscript)} · 约 {count_words(text)} 字")
            title = _first_heading(text)
            title_max = text_cfg.get("titleMaxChars")
            if not title:
                _check(checks, "manuscript.title", "标题", "na", "稿件里没有一级标题（# …）")
            elif title_max:
                _check(checks, "manuscript.title", "标题长度",
                       "pass" if len(title) <= title_max else "fail",
                       f"{len(title)} / {title_max} 字符")
            abstract = extract_abstract(text)
            abstract_max = text_cfg.get("abstractMaxWords")
            if abstract is None:
                _check(checks, "manuscript.abstract", "摘要", "na", "没找到 Abstract / 摘要 段")
            else:
                words = count_words(abstract)
                if abstract_max:
                    _check(checks, "manuscript.abstract", "摘要字数",
                           "pass" if words <= abstract_max else "fail",
                           f"{words} / {abstract_max} 词")
                else:
                    _check(checks, "manuscript.abstract", "摘要", "pass",
                           f"{words} 词（档案没写字数上限）")
            keys = extract_keys(text)
            refs = read_json(REFS_JSON, {"refs": {}}).get("refs", {})
            if not keys:
                _check(checks, "refs.cited", "引用", "na", "稿件里没有引用键（[@key] / \\cite）")
            else:
                unknown = sorted({k for k in keys if k not in refs})
                if unknown:
                    _check(checks, "refs.unknown", "引用键在库里存在", "fail",
                           "库里没有：" + ", ".join(unknown[:20]))
                else:
                    _check(checks, "refs.unknown", "引用键在库里存在", "pass",
                           f"{len(set(keys))} 个键都能对上")
                if refs_cfg.get("doiRequired"):
                    no_doi = sorted({k for k in keys if k in refs and not refs[k].get("doi")})
                    _check(checks, "refs.doi", "每条引用有 DOI",
                           "fail" if no_doi else "pass",
                           ", ".join(no_doi[:20]) if no_doi else "全部有 DOI")
                limit = refs_cfg.get("maxAuthorsListed")
                if limit:
                    over = [f"{key}（{len((refs.get(key) or {}).get('authors') or [])} 位）"
                            for key in sorted(set(keys))
                            if len((refs.get(key) or {}).get("authors") or []) > limit]
                    _check(checks, "refs.authors", "作者超过档案上限就缩写",
                           "warn" if over else "pass",
                           "、".join(over[:10]) if over else f"没有超过 {limit} 位")

    checklist = [{"text": item, "auto": False}
                 for item in ((journal.get("submission") or {}).get("checklist") or [])]
    counts = {verdict: sum(1 for c in checks if c["status"] == verdict) for verdict in CHECK_VERDICTS}
    return {
        "project": pdir.name,
        "journal": {"key": journal.get("key"), "name": journal.get("name"),
                    "nameZh": journal.get("nameZh"), "confidence": journal.get("confidence"),
                    "sources": journal.get("sources") or []},
        "manuscript": rel(manuscript) if manuscript and manuscript.exists() else None,
        "checks": checks,
        "checklist": checklist,
        "counts": counts,
        "disclaimer": "期刊档案里的数值是默认值；投稿前以刊方现行要求为准。",
    }


def cmd_check_journal(args) -> None:
    result = journal_check(args.project, args.journal, draft=args.draft, submission_id=args.submission)
    counts = result["counts"]
    payload = {"ok": True, **result,
               "summary": (f"{result['journal']['name']} 体检：{counts['pass']} 通过 / "
                           f"{counts['warn']} 提醒 / {counts['fail']} 不合格 / {counts['na']} 未检。")}
    # 有不合格项就非零退出（CI / 投稿前闸门都能直接用），但 JSON 照常给出。
    emit(payload, 1 if counts["fail"] else 0)


# ── 投稿包 ──

def _zip_name(path: Path) -> str:
    inside = rel(path)
    if re.match(r"^[A-Za-z]:", inside) or inside.startswith("/"):
        return "external/" + path.name
    return inside


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def cmd_export_package(args) -> None:
    ensure_skeleton(quiet=True)
    pdir = project_dir(args.project)
    meta = read_json(pdir / "project.json", {})
    submission = None
    submission_path = None
    if args.submission:
        submission_path = find_submission(args.submission)
        submission = load_submission(submission_path)
    journal_key = args.journal or (submission or {}).get("journal") or meta.get("journal")
    journal = load_journal(journal_key) if journal_key else None
    manuscript = resolve_manuscript(pdir, args.draft, args.submission)
    if manuscript is None or not manuscript.exists():
        fail("没有稿件可打包：给 --draft <库根相对路径>，或把稿子放在 drafts/main.md")

    warnings: list[str] = []
    if journal is None:
        warnings.append("没有期刊档案：投稿包不含 checklist.md（先落 journals/<key>.json）")

    candidates: list[Path] = [manuscript]
    if submission_path is not None:
        candidates.append(submission_path)
    if (pdir / "figures").exists():
        for sidecar_path in sorted((pdir / "figures").rglob("*.json")):
            candidates.append(sidecar_path)
            record = read_json(sidecar_path, {})
            for field in ("file", "originProject", "spec"):
                value = record.get(field)
                if value:
                    candidates.append(_resolve_path(value))
            for value in (record.get("files") or []) + (record.get("sourceData") or []):
                if value:
                    candidates.append(_resolve_path(value))
    for sub in ("data", "tables"):
        base = pdir / sub
        if base.exists():
            candidates.extend(sorted(p for p in base.rglob("*") if p.is_file()))
    if REFS_BIB.exists():
        candidates.append(REFS_BIB)

    entries: list[dict] = []
    zip_entries: list[tuple[str, Path]] = []
    seen: dict[str, Path] = {}
    for candidate in candidates:
        try:
            path = candidate.resolve()
        except OSError:
            continue
        if not path.is_file():
            continue
        name = _zip_name(path)
        if name in seen:
            continue
        seen[name] = path
        entries.append({"path": name, "bytes": path.stat().st_size, "sha256": _sha256(path)})
        zip_entries.append((name, path))

    check_counts = None
    if journal is not None:
        report = journal_check(pdir.name, journal_key, draft=args.draft, submission_id=args.submission)
        check_counts = report["counts"]
        if check_counts.get("fail"):
            warnings.append(f"体检还有 {check_counts['fail']} 项不合格（跑 check-journal 看明细）")

    checklist_items = ((journal or {}).get("submission") or {}).get("checklist") or []
    checklist_lines = ["# 投稿清单", ""]
    if journal is not None:
        checklist_lines.append(f"- 目标期刊：{journal.get('name')}（{journal.get('nameZh') or '—'}）")
    checklist_lines += ["", "> 下面这些来自期刊档案的默认值，勾选前逐条对照刊方的投稿系统。", ""]
    checklist_lines += [f"- [ ] {item}" for item in checklist_items] or [
        "- [ ] （档案里没有 checklist：去刊方 Guide for Authors 抄一遍，别凭印象勾）"]
    checklist_md = "\n".join(checklist_lines) + "\n"

    counts: dict[str, int] = {}
    for entry in entries:
        ext = Path(entry["path"]).suffix.lower().lstrip(".") or "other"
        counts[ext] = counts.get(ext, 0) + 1
    manifest = {
        "schema": 1,
        "generatedAt": now(),
        "project": pdir.name,
        "title": meta.get("title"),
        "journal": journal_key,
        "journalName": (journal or {}).get("name"),
        "manuscript": _zip_name(manuscript.resolve()),
        "files": entries,
        "counts": counts,
        "checks": check_counts,
        "warnings": warnings,
        "disclaimer": "期刊档案是默认值；投稿前以刊方现行要求为准。",
    }

    stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    if args.out:
        out = Path(args.out)
        if not out.is_absolute():
            out = LIBRARY / out
        out.parent.mkdir(parents=True, exist_ok=True)
    else:
        out = SUBMISSIONS / "packages" / f"{pdir.name}-{stamp}.zip"
        out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1) + "\n")
        archive.writestr("checklist.md", checklist_md)
        for name, path in zip_entries:
            archive.write(path, arcname=name)

    emit({"ok": True, "package": rel(out), "bytes": out.stat().st_size,
          "files": len(entries), "counts": counts, "checks": check_counts,
          "warnings": warnings,
          "summary": (f"已打包 {len(entries)} 个文件 → {rel(out)}"
                      f"（{out.stat().st_size / 1048576:.1f} MB）"
                      + (f"；警告 {len(warnings)} 条" if warnings else "") + "。")})


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="research.py", description="科研模式科研库工具")
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("init", help="建/修复库骨架").set_defaults(func=cmd_init)
    sub.add_parser("status", help="库概况").set_defaults(func=cmd_status)

    np = sub.add_parser("new-project", help="新建课题")
    np.add_argument("slug")
    np.add_argument("--title")
    np.add_argument("--journal")
    np.set_defaults(func=cmd_new_project)

    sub.add_parser("list-projects", help="列课题").set_defaults(func=cmd_list_projects)

    ar = sub.add_parser("add-ref", help="加一条文献")
    ar.add_argument("--title", required=True)
    ar.add_argument("--authors", default="")
    ar.add_argument("--year", type=int)
    ar.add_argument("--container", help="期刊/会议/出版社")
    ar.add_argument("--volume")
    ar.add_argument("--issue")
    ar.add_argument("--pages")
    ar.add_argument("--doi")
    ar.add_argument("--url")
    ar.add_argument("--type", default="article",
                    choices=["article", "book", "inproceedings", "thesis", "report", "preprint", "misc"])
    ar.add_argument("--project", action="append")
    ar.add_argument("--key")
    ar.add_argument("--notes")
    ar.add_argument("--source", default="web_search")
    ar.add_argument("--verified-by", default="url-fetched",
                    choices=["doi-resolved", "url-fetched", "user-supplied", "unverified"])
    ar.add_argument("--accessed")
    ar.add_argument("--force", action="store_true")
    ar.set_defaults(func=cmd_add_ref)

    lr = sub.add_parser("list-refs", help="列/搜文献")
    lr.add_argument("--project")
    lr.add_argument("--query")
    lr.set_defaults(func=cmd_list_refs)

    rr = sub.add_parser("remove-ref", help="删掉一条文献登记（先备份 refs.json，再同步 refs.bib）")
    rr.add_argument("--key", help="引用键（refs.json 里的键）")
    rr.add_argument("--doi", help="或者按 DOI 定位（大小写不敏感）")
    rr.set_defaults(func=cmd_remove_ref)

    sub.add_parser("export-bib", help="重建 refs.bib").set_defaults(func=cmd_export_bib)

    asub = sub.add_parser("add-submission", help="登记一条投稿记录")
    asub.add_argument("--journal", required=True, help="期刊档案键（journals/<key>.json）或期刊名")
    asub.add_argument("--project", help="课题 slug")
    asub.add_argument("--title", help="稿件标题")
    asub.add_argument("--type", default="research-article",
                      choices=["research-article", "review", "letter", "communication",
                               "conference-paper", "thesis", "preprint", "other"])
    asub.add_argument("--status", default="drafting", choices=list(SUBMISSION_STATUSES))
    asub.add_argument("--manuscript", help="稿件文件路径（.md/.docx/.pdf）")
    asub.add_argument("--manuscript-id", help="期刊给的稿号")
    asub.add_argument("--doi", help="已见刊后的 DOI")
    asub.add_argument("--cover-letter")
    asub.add_argument("--file", action="append", help="投稿包里的附件（可多次）")
    asub.add_argument("--submitted-at", help="实际投出时间（ISO 8601）")
    asub.add_argument("--decision-expected-at", help="预计有回音的时间（ISO 8601）")
    asub.add_argument("--next-action", help="下一步要做什么")
    asub.add_argument("--next-action-due", help="下一步的截止（ISO 8601）")
    asub.add_argument("--note")
    asub.add_argument("--id")
    asub.add_argument("--force", action="store_true")
    asub.set_defaults(func=cmd_add_submission)

    lsub = sub.add_parser("list-submissions", help="列/筛投稿记录")
    lsub.add_argument("--project")
    lsub.add_argument("--journal")
    lsub.add_argument("--status", choices=list(SUBMISSION_STATUSES))
    lsub.add_argument("--active", action="store_true", help="只看进行中（submitted/under-review/revision）")
    lsub.add_argument("--due", action="store_true", help="只看有下一步截止的，按截止排序")
    lsub.set_defaults(func=cmd_list_submissions)

    usub = sub.add_parser("update-submission", help="推进投稿状态 / 记事件 / 改下一步")
    usub.add_argument("id")
    usub.add_argument("--status", choices=list(SUBMISSION_STATUSES))
    usub.add_argument("--note")
    usub.add_argument("--title")
    usub.add_argument("--type", choices=["research-article", "review", "letter", "communication",
                                         "conference-paper", "thesis", "preprint", "other"])
    usub.add_argument("--manuscript")
    usub.add_argument("--manuscript-id")
    usub.add_argument("--doi")
    usub.add_argument("--file", action="append")
    usub.add_argument("--submitted-at")
    usub.add_argument("--decision-expected-at")
    usub.add_argument("--next-action")
    usub.add_argument("--next-action-due")
    usub.set_defaults(func=cmd_update_submission)

    rf = sub.add_parser("register-figure", help="登记图的溯源侧车")
    rf.add_argument("--project", required=True)
    rf.add_argument("--file", required=True)
    rf.add_argument("--extra-file", action="append")
    rf.add_argument("--figure-id")
    rf.add_argument("--data", action="append")
    rf.add_argument("--graph")
    rf.add_argument("--journal")
    rf.add_argument("--params")
    rf.add_argument("--params-b64", dest="params_b64",
                    help="base64 编码的 params JSON（绕开 Windows shell 的引号吞噬）")
    rf.add_argument("--opju")
    rf.add_argument("--spec")
    rf.add_argument("--caption")
    rf.set_defaults(func=cmd_register_figure)

    lf = sub.add_parser("list-figures", help="列图")
    lf.add_argument("--project")
    lf.set_defaults(func=cmd_list_figures)

    se = sub.add_parser("search", help="跨课题检索")
    se.add_argument("query")
    se.add_argument("--kind", choices=["ref", "figure", "draft", "dataset", "table", "journal",
                                       "project", "submission", "note"])
    se.add_argument("--project")
    se.add_argument("--limit", type=int, default=20)
    se.set_defaults(func=cmd_search)

    sub.add_parser("reindex", help="重建索引").set_defaults(func=cmd_reindex)

    cc = sub.add_parser("check-citations", help="引用核查闸门")
    cc.add_argument("--draft", required=True)
    cc.add_argument("--require-doi", action="store_true")
    cc.add_argument("--list-unused", action="store_true")
    cc.set_defaults(func=cmd_check_citations)

    cj = sub.add_parser("check-journal", help="投稿合规体检（图/稿/引用对期刊档案）")
    cj.add_argument("--project", required=True)
    cj.add_argument("--journal", help="期刊档案键；缺省取 project.json 里的 journal")
    cj.add_argument("--draft", help="稿件路径（库根相对或绝对）；缺省用投稿记录 / drafts/main.md")
    cj.add_argument("--submission", help="投稿记录 id（从中取期刊与稿件）")
    cj.set_defaults(func=cmd_check_journal)

    ep = sub.add_parser("export-package", help="导出投稿包 zip（稿件 + 图 + 数据 + refs.bib + manifest）")
    ep.add_argument("--project", required=True)
    ep.add_argument("--journal", help="期刊档案键；缺省取投稿记录 / project.json")
    ep.add_argument("--submission", help="投稿记录 id（一并打进包里，取期刊）")
    ep.add_argument("--draft")
    ep.add_argument("--out", help="zip 输出路径（缺省 submissions/packages/<课题>-<时间戳>.zip）")
    ep.set_defaults(func=cmd_export_package)

    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())

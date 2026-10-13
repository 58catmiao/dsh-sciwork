# dsh-sciwork · Research Mode for DSH

> A complete "doing research" workbench for [DSH](https://github.com/deepseek-ai) (DeepSeek Harness): an agent preset called **Research Mode**, plus a real, on-disk research library.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4B6BFB.svg)](https://github.com/58catmiao/dsh-sciwork)
[![zero dependency](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](https://github.com/58catmiao/dsh-sciwork)

Version 0.1.0 · MIT · by [58catmiao](https://github.com/58catmiao) · repo <https://github.com/58catmiao/dsh-sciwork>

**中文:** [README.md](README.md)

---

## What this is

`dsh-sciwork` is not another "chat with your papers" box. It is a research workbench that **lives on your disk** and can be opened by other tools. Install it and you get four things at once:

1. **An agent preset, "Research Mode"** — it folds plotting, writing, references and journal rules into one workflow: find the evidence first, then act. Figures are made on a real Origin install, and every reference cited in a manuscript must carry a DOI or a URL.
2. **A real, on-disk research library** — an ordinary directory tree (projects / figures / data / drafts / references / journal profiles / submissions), a Python engine `research.py`, and a registration index.
3. **12 journal submission profiles** — Nature, Science, Cell, IEEE Trans, ACS, a generic Elsevier profile, MDPI, PLOS ONE, Chinese core journals, CNKI theses, GB/T 7714, and a generic thesis profile, each with its numeric requirements, clauses and citations to their sources.
4. **A visual "Research Library" panel plus a set of skills** — seven tabs, mostly read-only, with filtering, import and archive; the skills pin down *how* to plot, write and cite.

**The filesystem is always the authority.** The index is only a cache, and the panel never writes to it — every panel write goes through the library scripts. That means you can zip up the whole library and move it, or touch it directly with a file manager, Git, or any other editor.

- The host half is plain Node ESM with **zero npm dependencies**.
- The client is a hand-written single-file web client with **no build step**.
- Plotting depends on the upstream open-source plugin [dsh-origin-plugin](https://github.com/Fantasality/dsh-origin-plugin) (MIT, by Fantasality). **This repository does not include it** — it ships only an adaptor skill. See "Relationship to dsh-origin-plugin" below.

## Install

```bash
dsh plugin --profile <profile> add dsh-sciwork
```

Installing from the plugin marketplace takes the same path. **Restart Harness** afterwards.

What you get after installing:

- an agent preset "Research Mode" with id `research` (selectable in a session);
- a new sidebar panel entry, "Research Library" (科研库);
- one precisely registered read-only route, `/api/research/call`, which the panel uses for snapshots and actions;
- five skills added to the skill catalog.

> Prerequisites: Node on the machine (the host half and the self-test scripts use it) and a working Python 3 interpreter (the library engine `research.py` uses it). **`python` is not required to be on `PATH`** — the launcher probes candidates in order: explicit configuration → `SCIWORK_PYTHON` → the library's own venv → the Origin plugin directory's venv → `PATH`. Plotting additionally needs Origin — see below.

## Quick start

### 1. Create the library

```bash
# Preflight first: writes nothing, just reports what is missing
node scripts/install.mjs --verify-only

# Once the preflight passes, create the library
node scripts/install.mjs
```

The installer creates the library root, the `.research/` engine and index, `journals/` profiles and the `refs/` store. The root defaults to `<home>/Research` (`%USERPROFILE%\Research` on Windows) and can be changed with the `SCIWORK_LIBRARY` environment variable.

Installer flags:

| Flag | Meaning |
| --- | --- |
| `--verify-only` | Check only; write nothing. |
| `--library-root <dir>` | Set the library root, overriding the configured `libraryRoot`. |
| `--skip-library` | Do not lay down the library skeleton (install the plugin half only). |
| `--force-skills` | Overwrite a skill directory that already exists and has no `SKILL.md`. |

> Library-root resolution order: `--library-root` / the `SCIWORK_LIBRARY` environment variable (the former name `RESEARCH_LIBRARY` is still accepted) → `libraryRoot` in the package's `library/config.json` → `<home>/Research`. Note that an existing library's own `.research/config.json` `libraryRoot` also overrides the environment variable — the panel and the engine prefer the library's own configuration.

### 2. Open the panel

Click "Research Library" (科研库) in the DSH sidebar. The header row shows the current library root and live counts (projects / figures / drafts / datasets / references / journal profiles / submissions / index time); the seven tabs sit underneath.

### 3. Let the agent create a project

Select the "Research Mode" preset in a session, then just say:

> Create a project called `zt-ceremic` on the oxidation behaviour of ZrB₂-SiC ceramics.

The agent runs `research.py new-project` to lay down the directories, and every figure it plots and every results section it writes afterwards lands in that project's `figures/`, `origin/`, `data/` and `drafts/`. You can also click "New project" in the panel and do it yourself.

### 4. Make a figure

**The panel does not plot** (that capability was removed on 2026-10-13). To make a figure, tell the agent:

> Plot the XRD data in `projects/zt-ceremic/data/` as a comparison figure, using MDPI's layout requirements.

The agent plots on a real Origin install, verifies the result, exports it, and registers the figure's provenance back into the library.

## The panel: what each of the seven tabs does

Sidebar → "Research Library". There are seven tabs (Figures / Drafts / References / Data / Journal profiles / Submissions / Archive), plus a **counts header row** and a "Command console" overlay — neither of the latter two is a tab:

| Tab | What you see | What you can do |
| --- | --- | --- |
| **Counts header row** (not a tab) | Library root, live counts for the seven categories (projects / figures / drafts / datasets / references / journal profiles / submissions), index time, collection warnings | Click "Refresh" to re-read the snapshot; click "Tour" for a highlighted walkthrough of the UI |
| **Figures** | Registered figures, each with its registered provenance (source data, script, generated-at); grouped by project | View the figure, view a PDF attachment, copy the path, replot, archive, delete |
| **Drafts** | Markdown manuscripts under `drafts/` | Read in place, create a draft, edit and save, archive, delete |
| **References** | Entries in `refs/refs.json` plus local PDF attachments under `refs/pdf/` | Import (a DOI or URL is mandatory to register; a PDF is optional), view PDFs, archive, delete |
| **Data** | Data files under `data/` (`.txt/.csv/.dat` …) and project group headers | Preview rows and columns, run a **data transform** (6 operators), archive, delete |
| **Journal profiles** | The 12 profiles with id, strictness (high / medium / low) and update date | Read clauses and numeric requirements, filter, archive |
| **Submissions** | Submission records under `submissions/` (target journal, status, timeline) | Read records, filter, archive |
| **Archive** | Batch manifests under `.research/archive/<timestamp>/` plus hard-delete records | Restore a whole batch or a single file; hard-delete records keep the name only |
| **Command console** (overlay, not a tab) | The `research.py` subcommand list and a parameter form per command | Pick a command → fill the arguments → run → read stdout / stderr / the JSON result |

**The 6 data-transform operators**: `normalize`, `baseline` (baseline subtraction), `smooth`, `peaks` (peak finding), `integrate`, `linear`. Every transform leaves a provenance record next to the derived table (`.research/transforms/<project>/<table>.json`) and writes its output into the project's `tables/`.

**The panel's boundary, in one sentence**: it can view, filter, import, archive, delete, and run data transforms on tables — it does **not** plot. Every write lands a file and registers it through the library scripts, and **the panel itself never touches the registration index**.

## Configuration

Configuration has two layers. **`<root>/.research/config.json` inside the library is authoritative**; the environment variables tell DSH where the library is and which Python to use.

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `SCIWORK_LIBRARY` | `<home>/Research` | The research library root. Pointing this elsewhere switches libraries. |
| `RESEARCH_LIBRARY` | unset | Former name, kept for compatibility; `SCIWORK_LIBRARY` wins. |
| `SCIWORK_PYTHON` | probed per platform | The Python interpreter used to run `research.py`. Pointing it at a venv interpreter explicitly is recommended. |
| `SCIWORK_ORIGIN_PLUGIN` | unset | The directory where `dsh-origin-plugin` lives, so the adaptor skill can find it. |

Authoritative in-library configuration:

| Path | Meaning |
| --- | --- |
| `<root>/.research/config.json` | The authoritative config: library root, language, journal-profile strictness preference, index settings. |
| `<root>/.research/index.json` | The registration index (**a cache only**; `research.py reindex` rebuilds it from the filesystem). |
| `<root>/.research/archive/` | The archive area. "Archive" in the panel moves things here, and it is reversible. |
| `<root>/.research/lock` | The library write lock, so concurrent writes do not step on each other. |

## Directory layout

```text
<root>/                          # default <home>/Research, changeable via SCIWORK_LIBRARY
├── projects/
│   └── <project>/
│       ├── figures/             # finished figures (exported png / svg / pdf / tif)
│       ├── origin/              # Origin project files (.opju), still editable in Origin
│       ├── data/                # raw data
│       ├── tables/              # tables derived by data transforms
│       └── drafts/              # manuscript sections for this project
├── refs/
│   ├── refs.json                # reference entries (a DOI or URL is mandatory)
│   └── pdf/                     # local PDF attachments (optional)
├── journals/                    # journal submission profiles
├── submissions/                  # submission records and timelines
└── .research/                   # engine and metadata
    ├── research.py              # the single authoritative entry point for library operations
    ├── config.json              # authoritative config
    ├── index.json               # registration index (a cache; rebuildable)
    ├── archive/                 # archive area (reversible)
    ├── transforms/<project>/    # provenance records for data transforms
    └── lock                     # write lock
```

**Registration (adding references, registering figure provenance, rebuilding the index) is always done by `research.py`**, never by the panel on its own.

## The library's authoritative entry point: `research.py`

Every structured write to the library goes through it (the panel's "Command console" overlay is just a visual front end for it).

**Reads**:

| Subcommand | Meaning |
| --- | --- |
| `status` | Library overview: project count, reference count, registered figure count, journal-profile count. |
| `search <query>` | Cross-project search (projects / figures / drafts / data / references / journal profiles / submissions), with `--kind`, `--project`, `--limit`. |
| `list-projects` / `list-figures` / `list-refs` / `list-submissions` | List projects, registered figures, references, submission records; each takes its own filters. |
| `check-citations --draft <path>` | **The citation gate**: a non-zero exit means the manuscript has missing or unverified citations. Add `--require-doi` to require a DOI on every entry. |

**Writes**:

| Subcommand | Meaning |
| --- | --- |
| `init` | Create or repair the library skeleton (idempotent). |
| `new-project <slug>` | Create a project, optionally with `--title` and `--journal`. |
| `add-ref` | Register a reference. **A DOI or URL is mandatory** (zero fabricated citations); `--verified-by` records how it was verified. |
| `register-figure` | Register a figure's provenance sidecar: source data, Origin graph page, journal profile used, caption. |
| `add-submission` / `update-submission` | Record a submission / advance its status and event timeline. |
| `reindex` / `export-bib` | Rebuild the index / rebuild `refs.bib`. |

**Irreversible**: `remove-ref` deletes one reference registration (it backs up `refs.json` first).

> On Windows the library ships a Python wrapper, `.research/bin/py.cmd`, which picks an interpreter according to the library config; the invocation examples in the agent documentation go through it. To choose the interpreter yourself, use `SCIWORK_PYTHON`.

### The journal profiles at a glance

| Profile id | What it covers | Strictness |
| --- | --- | --- |
| `nature` | Nature family | high |
| `science` | Science family | medium |
| `cell` | Cell family | medium |
| `ieee-trans` | IEEE Transactions | medium |
| `acs` | ACS family | medium |
| `elsevier-generic` | Generic Elsevier | medium |
| `mdpi` | MDPI family | high |
| `plos-one` | PLOS ONE | high |
| `chinese-core-journal` | Chinese core journals | medium |
| `cnki-thesis` | CNKI theses | low |
| `gbt-7714` | The GB/T 7714 reference-format standard | low |
| `thesis-generic` | Generic theses | medium |

Strictness drives the default layout and the strictness of validation; each profile also carries concrete numbers and citations to its source. For how to read and apply a profile, see the `journal-profile` skill.

## Skills

| Skill | What it governs |
| --- | --- |
| `research-studio` | The main entry point. Routing table + three hard rules + a 30-second pre-flight check + a pre-delivery checklist + honest reporting (what can and cannot be proven). |
| `origin-plot` | Origin plotting discipline. Getting data into Origin, four plotting paths, inspecting the current state before editing anything, **both verification steps**, export / delivery / registration, never hijacking the Origin session the user is working in, and a list of pitfalls actually hit in practice. It includes usage of all 74 `origin_*` MCP tools. |
| `paper-writing` | Evidence discipline before writing, figure captions, Results, the structure and framing of Discussion, Chinese→English and polishing, replying to reviewers (response letters), and the pre-submission checklist. |
| `literature-refs` | Four hard rules, registering references, searching (evidence before registration), citing in a manuscript, listing and exporting, working with the writing skill, and common pitfalls. |
| `journal-profile` | How to read and apply journal profiles: profile fields, feeding parameters to plotting/writing, choosing a journal ("which one should I submit to?"), creating or updating a profile, working with the library scripts, and conflicts and changes. |

Skills are discipline documents, not code: they constrain the agent's behaviour and add no dependencies.

## Relationship to dsh-origin-plugin

- **The plotting capability comes from [dsh-origin-plugin](https://github.com/Fantasality/dsh-origin-plugin)** (MIT, by Fantasality). It provides the 74 `origin_*` MCP tools that talk to Origin on your machine.
- **This repository does not include dsh-origin-plugin**, and does not copy its code; `dsh-sciwork` ships only an **adaptor skill**, `skills/origin-plot`, that teaches the agent to use those 74 tools to research-delivery standards.
- `skills/origin-plot/references/origin-tools.json` is a **derived file**: generated from dsh-origin-plugin's tool list so the agent can look tools up offline (name / arguments / purpose).
- The two can be installed independently. Without Origin and dsh-origin-plugin, everything else in `dsh-sciwork` — the library, the panel, writing, references, journal profiles — still works; only the "make a figure" step is unavailable.
- The `SCIWORK_ORIGIN_PLUGIN` environment variable tells the adaptor skill where dsh-origin-plugin is installed.

## Self-tests

The repository ships three self-test scripts and one patch preflight. None of them writes to your real library (write actions run against an isolated copy behind a hard gate):

```bash
node scripts/selftest-host.mjs      # host half: route registration, path guards, snapshot shape
node scripts/selftest-actions.mjs   # the 22 actions: read/guard checks + writes against an isolated copy
node scripts/selftest-client.mjs    # client: the seven tabs' rendering, overlays, buttons and request shapes
python scripts/validate-patch.py    # cordis.patch.yml preflight: preset rows, persona, inserted row
```

The self-tests run in two modes, and **a fresh clone with no library configured can still run them**:

**A. Without pointing at any research library (CI / a freshly cloned machine)**

```bash
node scripts/selftest-host.mjs      # all pass, exit 0
node scripts/selftest-actions.mjs   # 63 passed · 0 failed · 2 skipped
node scripts/selftest-client.mjs    # 21 passed · 0 failed · content checks not run
python scripts/validate-patch.py    # ✓ patch preflight passed
```

Every **content** check (the ones that need real drafts / figures / data tables in the library) is recorded as `SKIP` or "not run"; the script prints a line saying so (`未运行：内容类检查需要一个可用的科研库（当前库根 …）`) and **exits 0** — having no library is not a failure.

**B. Pointing at a real library (measured baseline)**

```bash
SCIWORK_LIBRARY=/path/to/Research node scripts/selftest-actions.mjs   # 120 passed · 0 failed · 3 skipped
SCIWORK_LIBRARY=/path/to/Research node scripts/selftest-client.mjs    # 151 passed · 0 failed
```

- `selftest-host.mjs` — tallies passes and failures only, exit code 0. The only check that can be recorded as "skipped" is one that depends on the real library actually containing a figure file (when there is none, it is not counted as a failure).
- `selftest-client.mjs` — its summary line likewise has only those two columns; in mode B it measures `151 passed · 0 failed`, exit code 0.
- `validate-patch.py` — prints `✓ 补丁预检通过` (patch preflight passed), exit code 0. It reports the `preset-research` preset's top-level row count (19 rows, 29 leaf rows after recursion, 2 of them disabled by an `!!js` condition), its nested groups (planning / compaction / delegation), the persona length, and confirmation that the inserted `research-library` row belongs to the host plugin rather than to an agent preset.
- `selftest-actions.mjs` — the write-action stage **requires the library root to point at the isolated copy the script creates**. If it finds the snapshot pointing somewhere else, it prints `FAIL 隔离闸门：snapshot 指向副本` and exits with code 2, having written **not a single byte**. That is by design, not a plugin defect: write actions always run inside the copy and never touch your real library.

## License and credits

**License: MIT**, copyright 58catmiao. The license text lives in [LICENSE](./LICENSE).

### Credits

- **The Origin plotting capability** comes from [**dsh-origin-plugin**](https://github.com/Fantasality/dsh-origin-plugin) (MIT, by **Fantasality**). This repository does not include it; `skills/origin-plot/references/origin-tools.json` is derived from its tool list for offline lookup. Thanks to the author for open-sourcing this local Origin automation.
- **DSH (DeepSeek Harness)** provides the plugin mechanism, agent presets and tool routing that this plugin extends.
- The **journal profiles** are this project's own summaries of **numeric requirements, clauses and sources** — not official journal documents.

### On content copyright

This repository **contains no copyrighted paper text or journal PDFs**.

- The 12 journal profiles under `journals/` describe submission requirements as **numbers, clauses and summaries with sources cited** (word limits, figure requirements, reference formats, and so on); where a specific clause matters, the journal's own current author guidelines take precedence.
- `refs/` holds **your own** reference metadata (title, DOI, URL, …) and attachments you place in `refs/pdf/` yourself; the repository preloads no full text.
- The journal profiles are an **aid**, not legal or submission advice; any consequence of using them in place of the official guidelines is the user's own.

---

<div align="center">

**dsh-sciwork** · every research step lands on your own disk

</div>

# dsh-sciwork

> Research mode for DSH (DeepSeek Harness): an agent preset, a research library that lives on your disk, a panel, and a handful of skills.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4B6BFB.svg)](https://github.com/58catmiao/dsh-sciwork)
[![zero dependency](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](https://github.com/58catmiao/dsh-sciwork)

Version 0.4.8 · MIT · by [58catmiao](https://github.com/58catmiao) · repo <https://github.com/58catmiao/dsh-sciwork>

**中文:** [README.md](README.md)

---

## What it is

Installing it adds an agent preset called "Research Mode". The preset keeps plotting, writing, references and journal rules in one workflow: find the evidence before acting, plot on a real Origin install, and give every cited reference a DOI or a URL.

Under the preset sits a real research library, just an ordinary directory tree: projects, figures, data, drafts, references, journal profiles, submissions. It comes with a Python engine `research.py` and a registration index. The filesystem is the authority; the index is only a cache. A broken index can be rebuilt, and the whole library can be zipped up and moved, or opened with a file manager, Git, or any other editor.

You also get 12 journal submission profiles (Nature, Science, Cell, IEEE Trans, ACS, Elsevier, MDPI, PLOS ONE, Chinese core journals, CNKI theses, GB/T 7714, generic theses), each with numeric requirements and citations to its sources; a "Research Library" panel; and six skills that turn plotting, writing and citing into rules the agent has to follow.

The host half is plain Node ESM with zero npm dependencies. The client is a single-file web client with no build step. Plotting depends on the upstream [dsh-origin-plugin](https://github.com/Fantasality/dsh-origin-plugin) (MIT, by Fantasality). This repository does not include it; only an adaptor skill is bundled.

## Install

All three channels install the same thing. Pick whichever one your UI offers.

| Channel | How | Notes |
| --- | --- | --- |
| Official plugin page (sidebar "Plugins" → add plugin) | enter `@58catmiao/dsh-sciwork` | installs from npm; an unpacked ZIP's absolute path also works; click "enable now" afterwards |
| Terminal | `dsh plugin --profile <profile> add @58catmiao/dsh-sciwork` | arguments are forwarded to the profile's pnpm |
| Plugin marketplace ("Plugins → Discover") | add the index URL first, then install from Discover | the market only reads the indexes you give it; the index is pinned to a GitHub commit |

### Official plugin page

Sidebar "Plugins" → add plugin, then enter:

```
@58catmiao/dsh-sciwork
```

Click "enable now" and restart Harness. The panel is a client bundle, so reloading the page is not enough.

### Terminal

```bash
dsh plugin --profile <profile> add @58catmiao/dsh-sciwork
```

The package is published to npm. To track the latest `main`, replace the name with `github:58catmiao/dsh-sciwork`. Restart Harness afterwards.

### Plugin marketplace

"Plugins → Discover" does not crawl GitHub. It reads only the index URLs you add yourself. This repository ships one, pinned to the release commit:

```
https://raw.githubusercontent.com/58catmiao/dsh-sciwork/main/market/plugins.json
```

The market itself comes from the optional bundle `@deepseek-ai/dsh-experimental-plugin-market-bundle`. If that is not installed on your machine, the Discover tab will not appear; the plugin page or the terminal installs the same thing.

The third-party market `dshmarket` uses its own catalog and cannot read this index. It has to list the plugin first.

After each release the index is rewritten by `node scripts/make-market-index.mjs --commit v<version>`, which pins the version to that tag's commit. `node scripts/test-install.mjs` checks the index format and commit.

### No pnpm, or the command says the package cannot be found

`dsh plugin` ultimately hands the work to pnpm. If the machine does not ship one, you can install without any package manager.

**Option A: unpack the ZIP and wire it up**

1. On GitHub click `Code → Download ZIP` and unpack it to a fixed directory, for example `D:/apps/dsh-sciwork`.
2. From that directory run:

```bash
node scripts/install-plugin.mjs --profile <profile> --source .
```

It adds a `link:` dependency to the profile's `package.json`, links `<profile>/node_modules/@58catmiao/dsh-sciwork` to that directory, and appends `@58catmiao/dsh-sciwork` to `dsh.profile.bundles`. The existing `package.json` is backed up as `package.json.bak-<timestamp>`. `--dry-run` shows what it would change.

The plugin page's "add plugin" also accepts that directory's absolute path, with the same result.

**Option B: git, Node, no package manager**

```bash
git clone https://github.com/58catmiao/dsh-sciwork.git
cd dsh-sciwork
node scripts/install-plugin.mjs --profile <profile> --source .
```

Restart Harness, then check with `dsh --profile <profile> --dump-config | grep -c dsh-sciwork` (the result should be greater than 0).

### Nothing changed after installing

| Symptom | Check first |
| --- | --- |
| 404 or "package not found" | is the source written as `@58catmiao/dsh-sciwork` (before 0.4.8: `github:58catmiao/dsh-sciwork`) |
| "npm / pnpm not found" | use Option A, no package manager needed |
| the panel still looks old | restart Harness; a page reload does not reload the client bundle |
| "check for updates" says it is not a git work tree | that install is a copy or a link to an unpacked ZIP; update by unpacking the new ZIP and re-running `install-plugin.mjs` |
| no "Research Library" entry in the sidebar | `dsh --profile <profile> --dump-config` should contain a `name: '@58catmiao/dsh-sciwork'` section; if not, the bundle never made it into `dsh.profile.bundles` |
| the plugin is missing from Discover | add the index URL; is the marketplace bundle installed |
| skills are missing | since 0.3.13 skills are registered by the plugin on activation; if `~/.dsh/skills/<name>/SKILL.md` already exists it is skipped on purpose, so remove that directory and restart to switch to the bundled copy |

After installing you get:

- an agent preset "Research Mode" with id `research`. The seven stages (topic → design → data → analysis → figure → draft → submission) all happen inside this one preset; a stage is just a field in `project.json`.
- a sidebar panel "Research Library", opening on the workbench, with the plugin version in the header and a "check for updates" button.
- one read-only route, `/api/research/call`, used by the panel for snapshots and actions.
- six skills: `research-studio`, `research-stages`, `origin-plot`, `paper-writing`, `literature-refs`, `journal-profile`. They are registered when the plugin activates, so no manual `scripts/install.mjs` run is needed. Copies already under `~/.dsh/skills` are left alone and never overwritten.

Prerequisites: Node, and a working Python 3 for `research.py`. `python` does not have to be on `PATH`; the launcher probes, in order, explicit configuration → `SCIWORK_PYTHON` → the library's own venv → the Origin plugin directory's venv → `PATH`. Plotting also needs Origin.

## Quick start

### Create the library

```bash
# Preflight: writes nothing, only reports what is missing
node scripts/install.mjs --verify-only

# Once it passes, create the library
node scripts/install.mjs
```

The installer creates the library root, the `.research/` engine and index, `journals/` profiles and the `refs/` store. The root defaults to `<home>/Research` (`%USERPROFILE%\Research` on Windows) and can be changed with `SCIWORK_LIBRARY`.

| Flag | Meaning |
| --- | --- |
| `--verify-only` | Check only, write nothing |
| `--library-root <dir>` | Set the library root, overriding the configured `libraryRoot` |
| `--skip-library` | Do not lay down the library skeleton; install the plugin half only |
| `--force-skills` | Overwrite a skill directory that exists but has no `SKILL.md` |

Library root resolution order: `--library-root` or `SCIWORK_LIBRARY` (the old name `RESEARCH_LIBRARY` still works) → `libraryRoot` in `library/config.json` → `<home>/Research`. An existing library's `.research/config.json` also overrides the environment variable; the panel and the engine prefer the library's own configuration.

### Open the panel

Click "Research Library" in the DSH sidebar. It opens on the workbench, with the library root and live counts in the header and the to-dos and overview below. The button in the top right switches to the classic list panel with its seven tabs.

### Let the agent create a project

Select "Research Mode" in a session and say:

> Create a project called `zt-ceremic` on the oxidation behaviour of ZrB₂-SiC ceramics.

The agent runs `research.py new-project` to lay down the directories. Every figure it plots and every results section it writes afterwards lands in that project's `figures/`, `origin/`, `data/` and `drafts/`. You can also click "New project" in the panel.

### Make a figure

The panel does not plot. Tell the agent:

> Plot the XRD data in `projects/zt-ceremic/data/` as a comparison figure, using MDPI's layout requirements.

The agent plots on a real Origin install, verifies and exports the figure, then registers its provenance back into the library.

## The panel

Sidebar "Research Library". The workbench opens by default; the page header switches to the classic list panel. The list panel has eight tabs: Figures, Drafts, Notes, References, Data, Journal profiles, Submissions, Archive. A counts row sits at the top, and a "Command console" is a separate overlay.

The workbench shows the whole library on one screen: a header with counts (projects / figures / references / open submissions), a cross-project to-do table (submission deadlines are in the same table, earliest first), then a two-column area with the project list on the left and project detail on the right. The detail pane has the stage bar, a per-project artifact strip, open items and blockers, and recent changes. The footer shows the latest receipt, the last backup and the plugin version. It reads the local `package.json` on first paint; "check for updates" is the only thing that goes to GitHub. When a newer version exists it offers "update to vX.Y.Z", which runs `git pull --ff-only` and only works on a clean git work tree.

| Tab | What you see | What you can do |
| --- | --- | --- |
| Counts row (not a tab) | Library root, live counts for projects / figures / drafts / datasets / references / journal profiles / submissions, index time, collection warnings | Refresh the snapshot; start the guided tour |
| Figures | Registered figures with data source, script and generated-at, grouped by project | View the figure or a PDF attachment, copy its path, archive, delete |
| Drafts | Markdown under `drafts/` | Read, create, edit and save, archive, delete |
| Notes | `projects/<project>/notes/*.md` experiment logs | Read the full note, create, save (a `.bak` is kept), delete (moved to `notes/.trash/`) |
| References | Entries in `refs/refs.json` and local PDFs under `refs/pdf/` | Import (a DOI or URL is mandatory), view PDFs, archive, delete |
| Data | Data files under `data/`, grouped by project | Preview rows and columns, run a data transform, rename, archive, delete |
| Journal profiles | The 12 profiles with id, strictness and update date | Read clauses and numeric requirements, filter, archive |
| Submissions | Submission records under `submissions/` (target journal, status, timeline) | Read, filter, archive, run the submission gate |
| Archive | Batches under `.research/archive/<timestamp>/` plus hard-delete records | Restore a batch or a single file; hard-delete records keep only the name |
| Command console (overlay) | `research.py` subcommands and an argument form | Pick a command, fill in the arguments, run it, read stdout / stderr / JSON |

The six data-transform operators are `normalize`, `baseline`, `smooth`, `peaks`, `integrate` and `linear`. Every transform leaves a provenance record next to the derived table (`.research/transforms/<project>/<table>.json`) and writes its output into the project's `tables/`.

The submission gate lives in the Submissions tab. Pick a project and a journal profile, then run the check: figure width against the single- or double-column spec, effective resolution, raster versus vector, caption presence, title and abstract length, reference and DOI coverage, and whether every citation key in the draft exists in the library. Each item is `pass`, `warn`, `fail` or `na`, with its source and confidence. Anything the profile does not state is `na`; a generic default never poses as a journal requirement. "Export submission package" zips the manuscript, figures, data and `refs.bib` into `submissions/packages/`, with a per-file sha256 manifest and a checklist. The journal's current requirements still win over the profile.

The panel can view, filter, import, archive, delete, run table transforms, and do the pre-submission check and packaging. It does not plot. Every write lands a file and is registered through the library scripts; the panel never touches the index directly.

## Configuration

Two layers. `<root>/.research/config.json` inside the library is authoritative; environment variables tell DSH where the library is and which Python to use.

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `SCIWORK_LIBRARY` | `<home>/Research` | Library root. Pointing it elsewhere switches libraries |
| `RESEARCH_LIBRARY` | unset | Former name, kept for compatibility; `SCIWORK_LIBRARY` wins |
| `SCIWORK_PYTHON` | probed per platform | Interpreter used to run `research.py`; a venv interpreter is recommended |
| `SCIWORK_ORIGIN_PLUGIN` | unset | Where `dsh-origin-plugin` lives, for the adaptor skill |

Files inside the library:

| Path | Meaning |
| --- | --- |
| `<root>/.research/config.json` | Authoritative config: library root, language, journal-profile strictness, index settings |
| `<root>/.research/index.json` | Registration index, a cache only; `reindex` rebuilds it |
| `<root>/.research/archive/` | Archive area; "Archive" in the panel moves things here, and it is reversible |
| `<root>/.research/lock` | Write lock, so concurrent writes do not collide |

## Directory layout

```text
<root>/                          # default <home>/Research
├── projects/
│   └── <project>/
│       ├── figures/             # finished figures (png / svg / pdf / tif)
│       ├── origin/              # Origin projects (.opju)
│       ├── data/                # raw data
│       ├── tables/              # tables derived by data transforms
│       └── drafts/              # manuscript sections for this project
├── refs/
│   ├── refs.json                # reference entries (DOI or URL mandatory)
│   └── pdf/                     # local PDF attachments
├── journals/                    # journal submission profiles
├── submissions/                 # submission records and timelines
└── .research/                   # engine and metadata
    ├── research.py              # the single entry point for library operations
    ├── config.json              # authoritative config
    ├── index.json               # registration index (cache, rebuildable)
    ├── archive/                 # archive area
    ├── transforms/<project>/    # provenance for data transforms
    └── lock                     # write lock
```

Adding references, registering figure provenance and rebuilding the index are done by `research.py`, never by the panel on its own. Common subcommands: `new-project`, `add-ref`, `register-figure`, `add-submission`, `reindex`.

## research.py

Every structured write to the library goes through it. The panel's Command console is just a visual front end for it.

Reads:

| Subcommand | Meaning |
| --- | --- |
| `status` | Library overview: project, reference, registered figure and journal-profile counts |
| `search <query>` | Cross-project search with `--kind`, `--project`, `--limit` |
| `list-projects` / `list-figures` / `list-refs` / `list-submissions` | List projects, figures, references or submissions, each with its own filters |
| `check-citations --draft <path>` | Citation gate; a non-zero exit means the manuscript has missing or unverified citations. `--require-doi` demands a DOI on every entry |
| `check-journal --project <slug> [--journal <id>]` | Journal compliance check against a profile; any `fail` exits 1 |

Writes:

| Subcommand | Meaning |
| --- | --- |
| `init` | Create or repair the library skeleton (idempotent) |
| `new-project <slug>` | Create a project, optionally with `--title` and `--journal` |
| `add-ref` | Register a reference; a DOI or URL is mandatory. `--verified-by` records how it was verified |
| `register-figure` | Register a figure's provenance sidecar: source data, Origin graph page, journal profile, caption |
| `add-submission` / `update-submission` | Record a submission or advance its status and timeline |
| `export-package --project <slug> [--journal <id>]` | Submission package: manuscript, figures, data and `refs.bib` zipped, with a manifest and a checklist |
| `reindex` / `export-bib` | Rebuild the library index or `refs.bib` |

`remove-ref` deletes one reference registration, after backing up `refs.json`.

On Windows the library ships a Python wrapper, `.research/bin/py.cmd`, which picks an interpreter from the library config. To choose one yourself, use `SCIWORK_PYTHON`.

### The journal profiles

| id | Covers | Strictness |
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
| `gbt-7714` | GB/T 7714 reference format | low |
| `thesis-generic` | Generic theses | medium |

Strictness drives the default layout and how strictly the check applies. Each profile also carries concrete numbers and sources. See the `journal-profile` skill for how to read and apply one.

## Skills

| Skill | What it covers |
| --- | --- |
| `research-studio` | Main entry: routing table, three hard rules, a 30-second pre-flight check, a pre-delivery checklist |
| `research-stages` | What each of the seven stages should produce and when to move on |
| `origin-plot` | Origin discipline: getting data in, four plotting paths, inspecting state before editing, the two verification steps, export and registration, never hijacking the user's Origin session, plus usage of the 74 `origin_*` tools |
| `paper-writing` | Evidence before writing, captions, Results, Discussion, Chinese→English, polishing, replying to reviewers, pre-submission checks |
| `literature-refs` | Four hard rules, registering references, searching, citing, listing and exporting |
| `journal-profile` | Profile fields, feeding parameters to plotting and writing, choosing a journal, creating or updating a profile |

Skills are discipline text, not code. They constrain the agent and add no dependencies.

## Relationship to dsh-origin-plugin

Plotting comes from [dsh-origin-plugin](https://github.com/Fantasality/dsh-origin-plugin) (MIT, by Fantasality). It provides the 74 `origin_*` MCP tools that talk to Origin on your machine.

This repository does not include dsh-origin-plugin and does not copy its code. It ships only an adaptor skill, `skills/origin-plot`, that teaches the agent to use those 74 tools to research-delivery standards. `skills/origin-plot/references/origin-tools.json` is a derived file generated from its tool list, for offline lookup.

The two install independently. Without Origin and dsh-origin-plugin, the library, panel, writing, references and journal profiles all still work; only plotting is unavailable. `SCIWORK_ORIGIN_PLUGIN` tells the adaptor skill where the plugin is installed.

## Self-tests

The repository ships five self-test scripts and one patch preflight. None of them writes to your real library; write actions run against an isolated copy. The first five need Node only; the preflight needs PyYAML.

```bash
node scripts/selftest-host.mjs      # host half: route registration, path guards, snapshot shape
node scripts/selftest-actions.mjs   # the 47 actions: read/guard checks + writes against an isolated copy
node scripts/selftest-client.mjs    # client: eight tabs, overlays, buttons, request shapes
node scripts/selftest-live.mjs      # real wiring: real panel x real endpoint x real actions x real writes (temp library)
node scripts/test-install.mjs       # install surface: bundled skills, library script seeds, package files, apply wiring
python -m pip install pyyaml
python scripts/validate-patch.py    # cordis.patch.yml preflight
```

To run everything in one go, use `node scripts/cycle.mjs`. Since 0.4.5 it runs 22 checks in CI order, adds a read-only git status, prints a summary table and exit code, and writes the full report to `out/cycle/<date>/` (`out/` is gitignored).

Before pushing to a public repository there is one more gate: `node scripts/check-local-info.mjs` (also run by `cycle.mjs`). It takes the machine's home directory, user name, host name, temp directory and library root as markers and scans every tracked file plus any unpushed commit messages. A hit means machine information is in the repository; replace it with placeholders such as `<repo-root>`, `<library-root>` or `<system-temp>` before committing.

The tests also run without a library (CI, or a fresh clone):

```bash
node scripts/selftest-host.mjs      # all pass, exit 0
node scripts/selftest-actions.mjs   # all pass, content checks skipped
node scripts/selftest-client.mjs    # all pass, content checks skipped
python scripts/validate-patch.py    # patch preflight passed
```

Content checks that need a real library are recorded as skipped and the script exits 0. Having no library is not a failure.

With a real library (numbers vary with its contents; these are from a fixture library):

```bash
SCIWORK_LIBRARY=/path/to/Research node scripts/selftest-actions.mjs   # 202 passed · 0 failed · 3 skipped
SCIWORK_LIBRARY=/path/to/Research node scripts/e2e-panel.mjs          # 93 elements · 0 failed
SCIWORK_LIBRARY=/path/to/Research node scripts/selftest-client.mjs    # 252 passed · 0 failed
node scripts/selftest-live.mjs --real /path/to/Research             # 6 passed · 0 failed
```

`selftest-live.mjs` is the one real end-to-end script: a miniature React renders the real `lib/client.js`, the panel's `rpc.call` hits the real `lib/index.js` route, and execution goes through the real actions, dispatch, token and receipt into a temporary library. Only the DSH host's model service is faked. Default run: `51 passed · 0 failed · 6 skipped`, and the temp library is removed afterwards.

The write section of `selftest-actions.mjs` requires the library root to point at the isolated copy the script creates. If the snapshot points somewhere else it prints `FAIL 隔离闸门：snapshot 指向副本`, exits with code 2, and writes nothing. That is by design.

## Documentation

| File | Contents |
| --- | --- |
| [docs/INSTALL.md](https://github.com/58catmiao/dsh-sciwork/blob/main/docs/INSTALL.md) | Installation and first-time library setup, with troubleshooting |
| [docs/ARCHITECTURE.md](https://github.com/58catmiao/dsh-sciwork/blob/main/docs/ARCHITECTURE.md) | Structure and contracts: host actions, HTTP endpoint, panel boundary, path resolution, self-test scope |
| [docs/RELEASE.md](https://github.com/58catmiao/dsh-sciwork/blob/main/docs/RELEASE.md) | Maintainer manual: releases, marketplace publishing, screenshots, clean-machine checks |
| [docs/CYCLE-14D.md](https://github.com/58catmiao/dsh-sciwork/blob/main/docs/CYCLE-14D.md) | Maintainer manual: the 14-day cycle of debugging, feature work and GitHub sync |
| [CHANGELOG.md](./CHANGELOG.md) | Version history |
| [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) | Third-party components and credits |

## License and credits

MIT, copyright 58catmiao. The license text is in [LICENSE](./LICENSE).

Origin plotting comes from [dsh-origin-plugin](https://github.com/Fantasality/dsh-origin-plugin) (MIT, by Fantasality). This repository does not include it; `skills/origin-plot/references/origin-tools.json` is derived from its tool list for offline lookup.

DSH provides the plugin mechanism, agent presets and tool routing that this plugin extends.

The journal profiles are this project's own summaries of numeric requirements, clauses and sources, not official journal documents. This repository contains no paper text or journal PDFs. The profiles are an aid, not legal or submission advice; the journal's current author guidelines take precedence.

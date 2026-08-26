# ultra11y

[![CI](https://github.com/maxgfr/ultra11y/actions/workflows/ci.yml/badge.svg)](https://github.com/maxgfr/ultra11y/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/ultra11y?logo=npm)](https://www.npmjs.com/package/ultra11y)
[![agent plugin](https://img.shields.io/badge/Claude_Code_·_Codex_·_OpenCode-plugin-6b46c1)](#add-to-your-coding-agent)
[![node](https://img.shields.io/node/v/ultra11y)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/ultra11y)](LICENSE)

### Add to your coding agent

Two lines, and the accessibility review runs **by itself** before every commit, push and
pull request — you never type the skill's name:

| | |
|---|---|
| **Claude Code** | `/plugin marketplace add maxgfr/ultra11y` then `/plugin install ultra11y@ultra11y` |
| **OpenAI Codex CLI** | `codex plugin marketplace add maxgfr/ultra11y` then `codex plugin add ultra11y@ultra11y` |
| **OpenCode** | `npx ultra11y install --opencode` — or pin `"plugin": ["ultra11y@latest"]` in `opencode.json` |
| **Anything else** | `npx ultra11y install --agents-md` (no hook API: see the caveat below) |

<sub>Prefer the skills only, without the automatic hook? `npx skills add maxgfr/ultra11y`
(`--agent codex`, `--agent opencode`, …). Already on npm and just want the gate?
`npx ultra11y install --all`, and `npx ultra11y status` to check what is actually wired.
Full details, thresholds and off-switches under [Install](#install).</sub>

> Audit HTML/CSS/JSX against **WCAG 2.2 AA** accessibility and produce a dated compliance report — or author/review accessible markup without regressions. A [skills.sh](https://skills.sh) agent skill: a deterministic, zero-dependency static engine **plus** the agent's judgment, with `check`/`verify` gates against hallucinated non-conformities. **The central deliverable is the auditor conformance block** — theme, criterion + official wording, test(s), WCAG mapping + level, finding, expected state, verification, `file:line` occurrences — rendered identically by the `report` (compliance doc), the `prd` backlog and the GitHub issues, in the active standard's vocabulary and **in your language** (`--lang auto` follows the conversation/repo). **WCAG is the worldwide core; country standards (RGAA, …) are pluggable in-repo packs.**

ultra11y is built around an honest **division of labour**. Automated tools only catch a fraction of accessibility problems, so the engine does the *mechanical* work — 81 machine-detectable static checks tied to the WCAG 2.2 success criteria — and is explicit about everything it can't decide statically. What it can't, the **AI agent adjudicates** (statically, from the evidence, gated by `verify`/`check`) — not a deferral to a human:

- **Automatable (engine):** missing `alt`/`lang`/`title`, unlabeled fields, empty links/buttons, icon-only controls, iframes without title, tables without headers, heading-level skips, empty/dangling headings & labels, duplicate ids, invalid/broken ARIA, positive `tabindex`, autoplay/timed-refresh/`blink`/`marquee` media…
- **Agent judgment (gated):** alt-text relevance, link purpose in context, reading/tab order, caption accuracy — the agent rules on these via `verify --manual` → `--apply`, each verdict carrying a justification (or a groundable NC), never a silent "conforming".
- **Needs rendering (scan tier):** computed contrast, visible focus, zoom/reflow, content on hover — decided by `scan` (axe-core in a real browser); until then they stay **residual risks**, never silently "conforming".
- **Advisory vs non-conformity:** a good practice with no failing normative test (an `advisory` pack rule, a best-practice-only axe violation, an agent recommendation) renders as « Recommandation (non normative) » — it never flips a criterion to `NC` nor enters the conformance rate. An NC always cites a `normativeRef`.
- **Stateful scan probes:** the local runtime drives the page with bounded, non-navigating interactions (fill inputs then re-measure overflow; a live-region probe for status messages 4.1.3) — `--no-interact` opts out; `--interact-clicks` re-enables button clicks on authenticated scans (destructive-named buttons are never clicked).
- **Normative page sample (échantillon):** a country-standard audit runs over a declared `sample.pages` set — **`pages discover --crawl|--sitemap --write` builds it for you** (names read from each page's `<title>`, existing entries never overwritten), `sample check` lints its coverage against the standard's required page kinds, `scan --sample` scans it, and an un-scanned `--standard rgaa` report is flagged **partial**.
- **Pack-only detection (declarative):** a standards pack can ship its own `rules` (a bounded, ReDoS-guarded matcher DSL — no code) and normativity/severity `overrides`, projecting onto its criteria without forking the engine.

## Measured against a corpus it did not write

A self-authored fixture can only prove that a rule fires on the defect written for it. So the engine is also scored against the **[W3C ACT-Rules Community Group](https://act-rules.github.io) test corpus** — 1 134 `passed` / `failed` / `inapplicable` examples across 91 rules, authored independently of this project:

| | |
|---|---|
| Rules scored | **32** (the ACT rules an equivalent engine check exists for) |
| `failed` examples caught | **103 / 149** |
| `passed` / `inapplicable` examples left alone | **291 / 291** — no unexplained false positive |
| Deliberate divergences | 9, each argued on the record |
| Declared gaps (statically decidable, not implemented) | 13 |

Rules needing a rendered page (computed contrast, keyboard traps) or a human call (is this heading descriptive?) are **declared and routed**, not silently scored zero. The full per-rule matrix — including every gap and every divergence — is generated into [`skills/ultra11y/references/act.md`](skills/ultra11y/references/act.md) and re-checked on every build; the corpus itself is refreshed daily by a workflow, so the numbers cannot quietly go stale.

## Install

**As a CLI** — on npm, zero runtime dependencies (Node ≥ 22.18):

```sh
npx ultra11y --help          # no install
npm i -D ultra11y            # or as a dev dependency
```

**As a test-runner plugin** — audit a page inside your own E2E run, in the state your test
built it:

```js
import { checkA11y } from "ultra11y/playwright";   // or "ultra11y/cypress" (+ "/plugin")
await checkA11y(page, { as: "accueil" });
```

**As an agent skill** — the repository ships **two** (pick at the prompt, or pass the name):
`ultra11y` for full audits, compliance reports, PRD backlogs and standards packs, and
`review-a11y` for the fast loop that audits **exactly the code under change** (staged files,
working diff, or branch vs merge-base) and reports like a code reviewer. Both bundle the same
install-free engine.

```sh
npx skills add maxgfr/ultra11y                 # this agent
npx skills add maxgfr/ultra11y --agent codex   # …or opencode, cursor, gemini, amp, zed…
```

**As an agent plugin** — the same two skills, plus the hook that makes the review
**automatic**. Installed this way, a pending `git commit`, `git push` or `gh pr create`
that carries accessibility findings is stopped once and the agent is handed the findings,
so `review-a11y` runs before the work goes out — you never type the skill's name.

```
/plugin marketplace add maxgfr/ultra11y          # Claude Code
codex plugin marketplace add maxgfr/ultra11y     # Codex CLI
npx ultra11y install --opencode                  # OpenCode
```

Codex's hook engine is a near-clone of Claude Code's — same events, same envelope, and it
exports `${CLAUDE_PLUGIN_ROOT}` too — so both harnesses share one `hooks/hooks.json`.
OpenCode has no permission-decision channel, so there the gate surfaces as a **failed bash
call whose error message carries the findings**. Per-harness deltas, the Codex feature flag
and the trust prompt: [`skills/ultra11y/references/harnesses.md`](skills/ultra11y/references/harnesses.md).

Four things worth knowing, because they bound what "automatic" means here:

- A hook **cannot force** a skill to be invoked. It blocks the command and hands over the
  reason and the findings; the agent is what invokes `review-a11y`. In practice a motivated
  `deny` is enough — it is not a guarantee.
- **Hooks do not enable themselves.** Installing the plugin is what turns them on. On Codex
  they also need `[features] hooks = true`, which `install --codex` sets for you; run
  `npx ultra11y status` if you are not sure what is live.
- **No harness has a git event** (no `PreCommit`, no `PRCreated`), which is why the hook
  listens on `PreToolUse` for the shell tool — `Bash` on Claude Code, `shell` on Codex —
  and recognises the commands that publish work.
- On a harness with **no hook API at all** (Cursor, Amp, Zed, Gemini CLI…), nothing is
  automatic. `npx ultra11y install --agents-md` makes the engine discoverable and hands the
  agent the adjudication protocol; `init --hook` below is what actually enforces the gate.

The gate never blocks twice for the same findings, so a retry always lands. It stays out of
the way when git's own `no-verify` bypass is used, outside a repository, and whenever the
engine cannot answer.
Disable it per-repo with `"hook": { "failOn": "off" }` in `.ultra11yrc.json`, per-command
with `SKIP_A11Y=1`, or per-session with `ULTRA11Y_HOOK=off`; raise or lower the bar with
`ULTRA11Y_HOOK_FAIL_ON=blocking|major|minor` (default `blocking`).

**As an MCP server** — so an agent drives the engine as tools instead of shelling out:

```sh
claude mcp add ultra11y -- npx -y ultra11y mcp
```

**As a GitHub Action** — audits the PR diff and, optionally, the served pages:

```yaml
- uses: maxgfr/ultra11y@v5
  with: { since: auto, standard: rgaa, fail-on: blocking }
```

Or clone and run the bundled engine straight from the repo:

```sh
node scripts/ultra11y.mjs --help
```

## Commands

```
ultra11y audit    <globs… | ->  [--standard <pack>] [--out <dir>] [--include <glob>] [--exclude <glob>] [--ext <list>] [--jsx] [--graph] [--json] [--lang auto|en|fr] [--no-default-excludes]
ultra11y audit    [--changed | --since <ref> | --staged] [--max-files <n>] [--dedup exact|normalized|off] [--baseline <file>] [--fail-on blocking|major|minor]
ultra11y audit    [--captures <dir>] [--no-captures] [--require-captures]              # audit rendered-DOM captures alongside source
ultra11y audit    [--format sarif|github]                                               # CI: code-scanning SARIF, or inline annotations + job summary
ultra11y report   --in <audit.json> [--out <dir>] [--standard <pack>] [--format sarif|github] [--lang auto|en|fr]
ultra11y prd      --in <audit.json> [--out <dir>] [--split criterion] [--format audit|doc|remediation] [--standard <pack>] [--lang auto|en|fr]
ultra11y tickets  --in <audit.json> [--provider auto|github|gitlab|jira] [--grain criterion|page|page-criterion|single|file] [--transport auto|cli|rest] [--max-tickets <n>] [--dry-run] [--json]
ultra11y render   [<dir>] [--scaffold | --setup | --e2e | --coverage | --storybook] [--runner playwright|cypress] [--captures <dir>] [--out <file>] [--json]
ultra11y snapshot write [--root <dir>] [--fail-on blocking|major|minor] [--json]   # payload on stdin → .ultra11y/pages/<id>/ + audit
ultra11y snapshot list  [--root <dir>] [--json]
ultra11y pages    --in <audit.json> [--standard <pack>] [--json] [--lang auto|en|fr]   # the per-page criterion grid
ultra11y pages    --in <audit.json> --format report [--split page] [--out <dir>]        # the per-page report, with screenshots
ultra11y pages    discover --sitemap <url> | --crawl <url> [--depth <n>] [--max <n>] [--write]   # build the page sample
ultra11y dev      [--port <n>] [--standard <pack>]   |   dev --next                        # live overlay while you build + dashboard
ultra11y criteria [<sc>] [--list] [--standard <pack> [--theme <N>]] [--generate] [--json] [--lang auto|en|fr]
ultra11y judge    --in <audit.json> [--standard <pack>] [--runner api|claude|codex] [--model <id>] [--apply]   # API or local subscription CLI
ultra11y check    --report <md> [--standard <pack>] [--quiet] [--json]
ultra11y verify   --report <md> [--standard <pack>] [--semantic] [--apply <verdicts.json>] [--max-verify <n>] [--json]
ultra11y verify   --report <md> [--conformities <ledger|adjudication.json> | --no-conformities]   # also put the claimed CONFORMITIES on trial
ultra11y fix      <globs… | ->  [--write] [--iterate] [--changed | --since <ref> | --staged] [--safe] [--only <ids>] [--jsx] [--json]
ultra11y init     [--hook] [--ci] [--baseline] [--fail-on blocking|major|minor]
ultra11y pack     check <pack.json> [--guidance <g.json>]  |  scaffold                 # gate an (AI-)authored standards pack
ultra11y scan     <url|file…> [--runtime auto|local|docker] [--cwd <dir>] [--storage-state <file>] [--merge <audit.json>] [--out <dir>] [--json]
ultra11y scan     --sitemap <url> | --crawl <url> [--depth <n>] [--max <n>] [--runtime …] [--merge <audit.json>] [--json]
ultra11y mcp      [--transport stdio|http] [--cwd <dir>] [--allow-write] [--port <n>] [--bind <addr>] [--allow-remote]

# global: --pack <paths> (load external standards pack(s) at runtime) · --override
```

## Use it as an MCP server

The skill shells out to the CLI and parses its output. An MCP server skips both:
your agent calls ultra11y as typed tools, with JSON schemas in and structured
results out. Same engine, same standards data, no wrapper.

```bash
# stdio — the default, and what Claude Code / Claude Desktop / Cursor expect
claude mcp add ultra11y -- node /abs/path/to/scripts/ultra11y.mjs mcp

# or over HTTP, on loopback
node scripts/ultra11y.mjs mcp --transport http --port 7341
claude mcp add --transport http ultra11y http://127.0.0.1:7341/mcp
```

```jsonc
// Claude Desktop takes stdio servers only — a remote URL here will not work.
{ "mcpServers": { "ultra11y": { "command": "node", "args": ["/abs/path/to/scripts/ultra11y.mjs", "mcp"] } } }
// Cursor, HTTP:
{ "mcpServers": { "ultra11y": { "url": "http://127.0.0.1:7341/mcp" } } }
```

It serves all three MCP primitives, because a skill is three things: the engine
(**tools**), the method (**prompts**), and the documentation the method refers
to (**resources**). A client given only the tools runs the audit, sees no
errors, and reports the page as accessible — a false conformance claim, which is
the one output an accessibility tool must never produce.

### Tools

Sixteen read tools, in two blocks. **The audit block** tells you what the page does:

| Tool | What it does |
|------|--------------|
| `ultra11y_audit` | The static pass — findings keyed by success criterion |
| `ultra11y_adjudicate` | The criteria the engine **cannot** decide, with their evidence |
| `ultra11y_report` | The dated conformance report, WCAG or a country pack |
| `ultra11y_prd` | Non-conformities → remediation units with effort |
| `ultra11y_tickets` | The same backlog as a ticket plan — dry-run, files nothing |
| `ultra11y_check` | The gate: nothing asserted conformant that was never tested |
| `ultra11y_verify` | Claim↔evidence worklist |
| `ultra11y_pack_check` | Validate a country standards pack against what it really ships |
| `ultra11y_sample_check` | Lint the normative page sample |
| `ultra11y_pages` | The per-page view: the criterion × page grid, or one dossier per page |
| `ultra11y_read` | A file, or a line range, from the project |

**The reference block** tells you what the standard requires — the half that keeps an agent
from auditing out of memory. `cwd` is optional on all five; it selects whose packs are visible:

| Tool | What it does |
|------|--------------|
| `ultra11y_standards` | Which standards exist here, and how much of each any engine can decide |
| `ultra11y_criteria` | One criterion in full — wording, **numbered tests**, techniques, mapping, defined terms — or the index, or one theme |
| `ultra11y_glossary` | What a term the standard **defines** means, and which criteria it governs |
| `ultra11y_guidance` | The before/after implementation pattern, inherited through the WCAG mapping when the pack has none |
| `ultra11y_method` | The work plan: what the engine settles, what needs a render, what is yours |

`ultra11y_method` is the one to call first. It partitions the standard into evidence tiers —
`source`, `cross-file`, `rendered-page`, `browser`, `judgment`, `out-of-scope` — from the
engine's own per-criterion rule applicability, never from guessing at the wording of a test.
For RGAA it reports that **56 of 106 criteria declare that no engine rule can evidence them**.
That is the standard saying they are yours, and a plan that hides it reads as coverage that
does not exist.

`standard` carries no enum, deliberately: a country pack arrives with a project, so an enum
pinned when the tool list was built would reject a pack that is perfectly valid for the
project being asked about. The handler validates against the registry and names what it knows.

`--allow-write` additionally exposes `ultra11y_fix` (safe codemods, dry-run by
default) and `ultra11y_init` (hook/CI/baseline) — the tools that change **your**
project. `ultra11y_scan` is declared but declines over MCP: it drives a headless
browser and may pull a Docker image, which is not a subprocess lifecycle a
long-lived server should own. It tells you to run it from the CLI and re-audit.

Every tool audits exactly what the CLI would: the rendered captures and the page
snapshots under `.ultra11y/` are ingested here too, so the server never reports a
smaller audit than the same command run by hand.

Pass `--cwd <dir>` at startup to dedicate the server to one project — `cwd` then
becomes optional on every tool.

### Prompts — the workflow, not just the tools

| Prompt | Arguments | What it drives |
|--------|-----------|----------------|
| `audit_wcag` | `cwd`, `globs?`, `standard?` | audit → adjudicate → rule on each → report → check, with the untested criteria named |
| `adjudicate_criteria` | `cwd`, `standard?` | What alt-text relevance, link purpose, heading structure and reading order actually ask |
| `review_diff_a11y` | `cwd`, `since?` | Audit exactly the diff, refute the false positives, state the residual risks |

Each carries the coverage arithmetic: of the 55 WCAG 2.2 AA criteria the static
engine decides a handful, a browser decides fourteen, and **thirty-eight are
yours**.

### Resources — the documentation, and the standards themselves

`SKILL.md` and all 37 `references/*.md` are served under `skill://`, read off
disk at request time — so a documentation fix reaches every client without a
rebuild.

The standards are served too, under `std://`, because in MCP documentation is a
*resource*, not a tool call:

```
std://rgaa/criteria/8.3      std://rgaa/glossary/lien      std://rgaa/method
std://rgaa/themes/8          std://rgaa/guidance/13.2      std://rgaa/pack.json
std://wcag/criteria/1.4.3    std://wcag/glossary           std://wcag/method
```

`resources/list` carries a bounded index per standard; the per-item URIs are
**templates** (`resources/templates/list`), because enumerating RGAA's 106
criteria and 119 glossary terms would bloat every client's listing and go stale
the moment a project's own pack registers.

Two things worth knowing:

- **A criterion nobody tested is untested, never conformant.** Every tool
  description and every prompt says so, because the failure mode here is not a
  wrong answer — it is a confident silence.
- **The HTTP transport binds `127.0.0.1` and refuses anything else** unless you
  pass `--allow-remote`. This server reads local files; an exposed port is a
  read-anything primitive for whoever finds it.

## Standards packs (RGAA France first; add your country)

WCAG 2.2 AA is the ENGINE's canonical key, because its rules are tied to success criteria and
a pack criterion is defined as a projection of them. Each country standard ships as an in-repo
**standards pack** — a small JSON carrying that mapping — and `--standard` re-keys everything
a reader sees, starting with `audit` itself:

```sh
node scripts/ultra11y.mjs audit  src --standard rgaa                                # RGAA-titled summary by thématique, findings tagged [8.4]
node scripts/ultra11y.mjs audit  src --standard rgaa --out audits --json            # a pack-keyed document: 106 criteria, 13 themes
node scripts/ultra11y.mjs report --in audits/audit-latest.json --standard rgaa      # → audits/rgaa-YYYY-MM-DD.md
node scripts/ultra11y.mjs criteria --standard rgaa 8.3                              # a pack criterion (+ its WCAG SCs)
```

`.ultra11yrc.json { "standard": "rgaa" }` makes it the default for every command. Under a pack,
no deliverable carries a WCAG cross-reference — report, PRD, per-page sheets, CI annotations
and SARIF name that standard's criteria and nothing else; the WCAG core travels inside the
document's `core` field, where the pipeline reads it and no rendering does. The one place the
mapping is still printed is `criteria --standard rgaa <id>`, which is a reference lookup and
where a reader goes looking for it.

**RGAA 4.1.2** (France) ships as the flagship pack. Section 508 (US), EN 301 549 (EU) and
others are welcome — adding a country is a single PR (pack JSON + one registration line +
a test). See [`CONTRIBUTING.md`](CONTRIBUTING.md) and `skills/ultra11y/references/standards.md`.

### Scale, fixes, and repo automation

- **Scale** — the engine streams file-by-file (bounded memory), audits **only markup**,
  and lets you focus: `--changed`/`--since` (git diff only), priority ordering
  (layouts/templates/shared components first), content de-duplication, and an explicit
  `--max-files` cap with logged truncation. See `references/scale.md`.
- **Fixes** — `fix` puts the fixes in place (native-first, anti-hallucination): deterministic
  auto-codemods, fill-in `TODO` placeholders for the agent to complete, and judgment-only
  proposals. `--dry-run` is the default; `--write` applies but only after a re-audit proves
  no new non-conformity, and never on lossy JSX/TSX. See `references/fix.md`.
- **During your E2E run** — `import { checkA11y } from "ultra11y/playwright"` (or
  `ultra11y/cypress` + `ultra11y/cypress/plugin`) audits a targeted page **inside the test run
  you already have**; `render --e2e` still writes install-free fixtures for a repo that does
  not depend on ultra11y, and the two cannot drift (the fixtures interpolate the published
  module's tables, and a test gates both over the same findings). Cypress now feeds the pixel
  tier too, via `after:screenshot`. `checkA11y(page, { report: true })` emits the per-page
  report straight out of the run. The audit runs, so the page is checked in the state
  your test built (logged in, form filled, modal open) — state a separate `scan` run does not
  have. Each checked page is persisted as a **snapshot** (`.ultra11y/pages/<id>/`: the whole
  rendered document + computed styles + boxes), which is the durable half: the same page
  re-audits **offline, with no browser**, so CI and the per-page report work from it. Because
  a snapshot is a full document, the page-scoped rules finally run — RGAA **8.3** (`lang`),
  **8.5/8.6** (`title`) — and every finding carries both its page and the source file that
  rendered it. See `references/e2e.md` and `references/pages.md`.
- **In your browser** — a Chrome extension (`extension/`) audits the page you are *looking at*:
  a staging build, a page behind a login you walked through by hand. It is a client of the
  side-car, not a second engine — it fetches the engine's own collector rather than copying it,
  its manifest can reach **loopback and nothing else**, and the popup decides nothing the engine
  did not. See `references/extension.md`.
- **While you build** — `dev --next` writes a one-line Next overlay component and `dev` starts
  a loopback side-car: a floating panel lists the current page's non-conformities as you
  browse, each linking to its `file:line` in your editor, and `http://127.0.0.1:4111` shows
  the per-page grid accumulating. The overlay detaches itself before collecting — otherwise it
  would audit itself and shift every element index — and renders nothing outside development.
  See `references/devtools.md`.
- **A country standard is adjudicated at its OWN granularity** — 97 of RGAA's 106 criteria
  carry at least one judgment test and can still need adjudication to earn C; decisive rules
  can nevertheless prove their bounded failures.
  `verify --manual
  --standard rgaa` now keys the worklist by **RGAA criteria**, each carrying its numbered tests
  in full, its technical note, its particular cases, its guidance and the glossary definitions
  its tests cite (119 entries that previously had no reader). A `normativeRef` must cite one of
  the item's **own** tests — the laxer check accepted a WCAG id that happened to collide with
  an unrelated RGAA test number. Verdicts fold into a separate `packAdjudication` layer so a
  pack decision never rewrites the WCAG core. See `references/judgment.md`.
- **Rendered tier (offline)** — six rules read a snapshot's browser-only signals inside the
  ordinary `audit`: **no browser, no Docker, no running server**. `rendered-contrast` measures
  contrast on the *computed* styles (the inline-literal rule could only see colours written in
  the markup); `rendered-contrast-pixel` measures it **on the screenshot** for text over a
  gradient or image, where `background-color` is transparent and every CSSOM-based checker —
  axe-core included — is blind; `rendered-nontext-contrast` decides whether a form control's
  boundary is perceivable (**RGAA 3.3**); and two more read the *stylesheet itself*, which is
  the only place they exist: a focus indicator removed with nothing put back (**10.7**, until
  now reachable only by a live browser probe) and an orientation lock (**13.9**).
  `rendered-link-colour-only` makes **RGAA 10.6** decidable at all.
  Each can say *"I don't know"*: an unresolvable backdrop, a varied region, a cross-origin
  stylesheet, a `box-shadow` that might be the boundary — all leave the criterion undecided
  rather than guessed, and without signals the rules do not fire, so no pre-existing verdict
  changes. `tests/rgaa-coverage.test.ts` ratchets the result: **51 of 106** RGAA criteria now
  map onto an engine rule, up from 43, and the number can only go up.
- **Every scanned page is a snapshot** — `scan` no longer keeps only findings: each page it
  visits is persisted to `.ultra11y/pages/<id>/` (`--no-snapshot` opts out). That is what turns
  a URL into a real per-page verdict — a page known only by its URL can never be conforming by
  silence, so a sitemap-driven audit used to produce an almost empty grid. With a snapshot the
  page-scoped rules run (**RGAA 8.3 / 8.5 / 8.6**), the DOM **JavaScript built at runtime** is
  audited like any other markup, and the page re-audits **offline, with no browser**. The
  collection happens on the *pristine* page — before axe injects its source and before any probe
  fills an input or resizes the viewport — otherwise the snapshot would record our own
  instrumentation instead of the site.
- **Page by page** — RGAA is a per-page norm; the engine's verdict is scope-wide. `pages`
  bridges the two: one row per criterion, one column per page URL, embedded in `report` and
  rebuilt from a committed `audit.json` alone. The per-page status is not recomputed — a
  per-page *view* of the audit runs through the very same projection the report uses, so grid
  and report agree by construction. Two rules hold the line: a finding is attributed to a page
  only when something **says** so (else it is counted as unattributed, never spread across
  pages), and a criterion is conforming *by silence* only on a page whose real rendered DOM
  was audited. And `pages --format report [--split page]` turns that into the **deliverable an
  auditor hands over**: one dossier per page — identity, **screenshot**, rate, *every* criterion
  of the standard with its status on that page, then each non-conformity as the ordinary auditor
  block. It re-decides nothing and invents no format, so a page sheet and the compliance report
  cannot disagree; `check` gates it against invented criteria like any other report.
  See `references/pages.md`.
- **A shipped GitHub Action** — `uses: maxgfr/ultra11y@v5` audits the **code** (PR diff) and,
  optionally, the **pages** (it can start your app, wait for it, then scan real URLs or your
  declared sample). The engine ships inside the action, so there is nothing to install and no
  `setup-node`. The gate runs **last**, after SARIF, annotations, the summary, the sticky PR
  comment and the report — a red job is never a dead end. `adjudicate: api|agent` optionally
  rules on the judgment criteria that would otherwise stay « à évaluer » in CI, reading its key
  from the job environment and skipping itself without one. `ultra11y init --ci` writes a
  workflow using it. See `references/ci.md`.
- **Two PR comments, not one** — `comment-kind: digest` (the default) posts the distinct
  defects a reviewer can act on; `comment-kind: pages` posts the **page-by-page grid**: one row
  per page with its basis, its rate *and its denominator*, then the non-conforming criteria of
  each failing page. Each kind is keyed by its own sticky marker, so a workflow that gates code
  in one job and sweeps pages in another keeps **both** comments — sharing a marker is how a
  684-occurrence sweep silently overwrote a four-finding gate, and the actionable half is the
  one that vanished.
- **CI surfaces** — a red job says *that* the build broke, not *where*. `--format sarif` emits
  SARIF 2.1.0 for GitHub code scanning, so each finding lands as an **inline annotation on the
  causing line** of the PR; `--format github` does the same via `::error::` workflow commands
  plus a `$GITHUB_STEP_SUMMARY` table, for plans without code scanning. Alert identity reuses
  the baseline's `findingId`, so an alert survives line drift; a URL-keyed finding gets **no**
  location rather than a guessed one. Run it from `report --standard rgaa` for pack-keyed
  output. See `references/ci.md`.
- **Automation** — `init --hook` (default) wires a zero-dependency git pre-commit gate over the
  **strict staged snapshot**: it audits the exact index blobs, auto-applies the safe fixes and
  re-stages them, and blocks only on judgment issues. `init --baseline`/`--ci` is the opt-in
  regression variant (hook + committed baseline / GitHub Actions job) that fails only on **new**
  non-conformities, not the existing backlog. See `references/automation.md`.

### Optional model tier (`judge`) — for the runs with no agent in the loop

Inside a coding agent the judgment criteria are the agent's to rule on. Outside one — CI, a
browser extension, an E2E run — nobody does, so they stay « à évaluer ». `judge` adjudicates
them with a model, and is a **caller, not a second judge**: the worklist, the evidence and the
prompt are `verify --manual`'s own, and the verdicts pass through the **same fail-closed gate**
an agent's do. An unjustified `C`, an `NC` citing a line that does not resolve, a verdict for a
criterion nobody asked about, or an incomplete run are all refused — and a rejected
adjudication leaves the audit untouched. All-`manual` with reasons is accepted, because that is
a correct answer. Choose the transport explicitly:

```sh
# Anthropic Messages API
ANTHROPIC_API_KEY=… ultra11y judge --in audits/audit-latest.json --runner api --apply

# Local CLI subscriptions; each reuses that CLI's existing login
ultra11y judge --in audits/audit-latest.json --runner claude --apply
ultra11y judge --in audits/audit-latest.json --runner codex --apply
```

`--runner cli` remains an alias of `claude` for existing scripts. The Codex runner invokes
`codex exec` ephemerally, read-only, offline, without repository rules, hooks or user config;
it uses the model attached to the ChatGPT account unless `--model` is given. Its subscription
has no per-run dollar-budget flag, so `--max-budget-usd` is rejected for Codex rather than
pretending to enforce a ceiling. Use `--timeout` and `--max` to bound the local run.

The GitHub Action wires this as `adjudicate: api`, and offers `adjudicate: agent` as the other
half — the same worklist handed to a `claude-code-action` run, which can **open the cited files**
instead of ruling from harvested evidence alone. Both end in the same fail-closed gate; they
differ in evidence, not in trust. Both read `ANTHROPIC_API_KEY` from the **job environment**,
never from an input, and **skip themselves when it is absent** — which is exactly what a fork's
pull request looks like, so the job stays green and the criteria stay « à évaluer ». See
`references/ci.md` for the cost per run and for `gate-adjudicated`, which lets a model-ruled
non-conformity fail the build at the price of a red/green that no longer reproduces.
ChatGPT-subscription authentication stays local: public CI does not receive or manufacture a
Codex subscription secret.

### Optional dynamic tier (axe-core)

`scan` runs **axe-core in a headless browser** to decide the *needs-rendering* criteria the static engine leaves as residual risks — chiefly **computed colour contrast (1.4.3)** plus a 320px **reflow** check (1.4.10) and a render cross-check of the structural rules. Two runtimes (default `--runtime auto`): **`--runtime local`** uses a Playwright that resolves from your project (`--cwd`) — **no Docker** — and additionally probes focus visibility (2.4.7), 200% zoom (1.4.4), text spacing (1.4.12) and content-on-hover (1.4.13), plus **stateful** probes (fill inputs then re-measure overflow, and a live-region probe for status messages 4.1.3 — opt out with `--no-interact`, `--interact-clicks` for authed-scan button clicks), and takes `--storage-state` for authenticated pages; **`--runtime docker`** falls back to a self-contained image built on first use. `--merge` folds the findings into a static `AuditResult`, upgrading `manual` criteria to `C`/`NC`. A country-standard audit scans its declared page sample with `scan --sample` (lint it first with `sample check`):

```sh
node scripts/ultra11y.mjs audit "src/**/*.html" --out audits --json > /dev/null
node scripts/ultra11y.mjs scan http://localhost:3000 --runtime local --cwd . --merge audits/audit-latest.json --out audits
node scripts/ultra11y.mjs report --in audits/audit-latest.json --out audits
```

Only the Docker runtime needs Docker. `--runtime local` needs a Chromium binary (`npx playwright install chromium`) plus `@playwright/test` and `@axe-core/playwright` — which **come with the npm package**, since they are its own dependencies; the audited project's own copies take precedence when it has them. Running the engine as a **standalone skill bundle** is the exception: an installed skill has no `node_modules` beside it, so there the two packages must be in the audited project, reachable from `--cwd`. The engine bundle itself stays dependency-free either way. The Docker runner + Dockerfile are embedded in the engine and mirrored under `docker/` (with a `docker-compose.yml`). See `skills/ultra11y/references/dynamic.md`.

Typical audit flow:

```sh
node scripts/ultra11y.mjs audit "src/**/*.html" --json > audit.json
node scripts/ultra11y.mjs report --in audit.json --out audits      # audits/wcag-YYYY-MM-DD.md
node scripts/ultra11y.mjs check  --report audits/wcag-YYYY-MM-DD.md # integrity gate
```

### A report someone will actually open

`--html` turns the audit into a page: `audits/index.html` as the entry point, plus — from
`report` — a detachable single file that prints to PDF. Self-contained — no script, no
external asset, nothing pointing outside the directory — and it passes this engine's own
accessibility audit, which is the least a tool like this owes. `pages --html` writes the
navigable sheets only: **one composite per artifact**, or every inlined crop travels twice.

```sh
node scripts/ultra11y.mjs report --in audit.json --html --evidence --out audits
node scripts/ultra11y.mjs pages  --in audit.json --format report --split page \
  --evidence --html --out audits/pages
```

`--evidence` illustrates each non-conformity with an **annotated crop of the offending
element**, cut from the page snapshot: `selectorHint` is lossy, and a rendered-tier finding on
a client-rendered page is anchored at `dom.html:2` whatever it is really about. It illustrates
the Markdown conformance report as much as the HTML — one set of files in `assets/`, referenced
by every document that shows the defect — so `--html` is not required to get pictures.

It needs snapshots, and it says per page and per criterion what it could not draw and why — an
occurrence with no picture must never read as an occurrence with no defect. It distinguishes
an occurrence *folded* into another's picture from a distinct defect a limit *cut off*, because
only the second is a gap.

In the GitHub Action both are **on by default**, so the uploaded artifact has a front door
without changing a workflow. See `references/ci.md`.

The skill (`skills/ultra11y/SKILL.md` + `references/`) teaches the agent when and how to run these, how to complete the manual criteria, and the native-first authoring doctrine.

## Development

```sh
pnpm install
pnpm test               # vitest
pnpm run typecheck
pnpm run build          # tsup → scripts/ultra11y.mjs (engine) + dist/ (the e2e plugins)
pnpm run check:build    # asserts every committed artefact is reproducible from its source
pnpm run build:wcag     # re-derive src/data/wcag.json from the vendored W3C source
pnpm run build:pack:rgaa # re-build the RGAA pack from the vendored DINUM source
pnpm run build:criteria  # regenerate skills/ultra11y/references/criteria.md
pnpm run build:icons     # re-generate the browser extension's icons from their source
```

Releases are cut automatically by **semantic-release** on push to `main` (GitHub release +
npm publish via OIDC trusted publishing, plus the moving `v2` major tag). The version bump is
decided by **Conventional Commits**: a commit whose subject carries no `feat:`/`fix:` prefix
is analysed as *no release*, so a change that must ship needs at least one conventional commit
in the range — otherwise the major alias and npm keep serving the previous version while `main`
moves on.

## Data & licensing

- ultra11y's code: **MIT** (see `LICENSE`).
- The **WCAG 2.2** success-criteria dataset (`src/data/wcag.json`) is derived from the official W3C source ([w3c/wcag](https://github.com/w3c/wcag)); WCAG 2.2 is © **W3C**, reused under the **W3C Document License** (only SC ids/titles/levels are reproduced) — see `NOTICE`.
- The **RGAA pack** (`src/data/standards/rgaa.json`, `rgaa.glossary.json`) is derived from the official **RGAA 4.1.2** reference published by DINUM/DISIC, under the **Licence Ouverte / Etalab 2.0** — see `NOTICE`. Attribution: « RGAA 4.1.2 — DINUM ».
- The report format is inspired by DINUM/etalab-ia audit conventions; the native-first authoring rules are adapted from the SocialGouv accessibility skill. No source code was copied.

# ultra11y — RGAA 4.1.2 accessibility audits, on a WCAG 2.2 AA core

[![CI](https://github.com/SocialGouv/ultra11y/actions/workflows/ci.yml/badge.svg)](https://github.com/SocialGouv/ultra11y/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/ultra11y?logo=npm)](https://www.npmjs.com/package/ultra11y)
[![agent plugin](https://img.shields.io/badge/Claude_Code_·_Codex_·_OpenCode-plugin-6b46c1)](#add-to-your-coding-agent)
[![node](https://img.shields.io/node/v/ultra11y)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/ultra11y)](LICENSE)

**Documentation (in French): [socialgouv.github.io/ultra11y](https://socialgouv.github.io/ultra11y/)** — what the tool does, what it cannot check, criterion-by-criterion RGAA coverage and how it is tested, with every number generated from the code.

### Add to your coding agent

Two lines, and the accessibility review runs **by itself** before every commit, push and
pull request — you never type the skill's name:

| | |
|---|---|
| **Claude Code** | `/plugin marketplace add SocialGouv/ultra11y` then `/plugin install ultra11y@ultra11y` |
| **OpenAI Codex CLI** | `codex plugin marketplace add SocialGouv/ultra11y` then `codex plugin add ultra11y@ultra11y` |
| **OpenCode** 1.x and 2.x | `npx ultra11y install --opencode` — or pin `"plugins": ["ultra11y@latest"]` in `opencode.json` (OpenCode 1: `"plugin"`) |
| **Anything else** | `npx ultra11y install --agents-md` (no hook API: see the caveat below) |

<sub>Prefer the skills only, without the automatic hook? `npx skills add SocialGouv/ultra11y`
(`--agent codex`, `--agent opencode`, …). Already on npm and just want the gate?
`npx ultra11y install --all`, and `npx ultra11y status` to check what is actually wired.
Full details, thresholds and off-switches under [Install](#install).</sub>

> Audit a site against **RGAA 4.1.2**, the French State's accessibility standard (*référentiel général d'amélioration de l'accessibilité*), on its **WCAG 2.2 AA** core: a dated conformance report, the 106-criterion grid, a backlog and tickets — or author/review accessible markup without regressions. It never declares conforming what it has not verified. A [skills.sh](https://skills.sh) agent skill: a deterministic, zero-dependency static engine **plus** the agent's judgment, with `check`/`verify` gates against hallucinated non-conformities. **The central deliverable is the auditor conformance block** — theme, criterion + official wording, test(s), WCAG mapping + level, finding, expected state, verification, `file:line` occurrences — rendered identically by the `report` (compliance doc), the `prd` backlog and the GitHub issues, in the active standard's vocabulary and **in your language** (`--lang auto` follows the conversation/repo). **RGAA ships first; WCAG is the worldwide core it maps onto, and other country standards are pluggable in-repo packs.**

ultra11y is built around an honest **division of labour**. Automated tools only catch a fraction of accessibility problems, so the engine does the *mechanical* work — 102 machine-detectable static checks tied to the WCAG 2.2 success criteria — and is explicit about everything it can't decide statically. What it can't, the **AI agent adjudicates** (statically, from the evidence, gated by `verify`/`check`) — not a deferral to a human:

- **Automatable (engine):** missing `alt`/`lang`/`title`, unlabeled fields, empty links/buttons, icon-only controls, iframes without title, tables without headers, heading-level skips, empty/dangling headings & labels, duplicate ids, invalid/broken ARIA, positive `tabindex`, autoplay/timed-refresh/`blink`/`marquee` media…
- **Agent judgment (gated):** alt-text relevance, link purpose in context, reading/tab order, caption accuracy — the agent rules on these via `verify --manual` → `--apply`, each verdict carrying a justification (or a groundable NC), never a silent "conforming".
- **Needs rendering (scan tier):** computed contrast, visible focus, zoom/reflow, content on hover — decided by `scan` (axe-core in a real browser); until then they stay **residual risks**, never silently "conforming".
- **Advisory vs non-conformity:** a good practice with no failing normative test (an `advisory` pack rule, a best-practice-only axe violation, an agent recommendation) renders as « Recommandation (non normative) » — it never flips a criterion to `NC` nor enters the conformance rate. An NC always cites a `normativeRef`.
- **Stateful scan probes:** the scan drives the page with bounded, non-navigating interactions (fill inputs then re-measure overflow; a live-region probe for status messages 4.1.3) — `--no-interact` opts out; `--interact-clicks` re-enables button clicks on authenticated scans (destructive-named buttons are never clicked).
- **Normative page sample (échantillon):** a country-standard audit runs over a declared `sample.pages` set — **`pages discover --crawl|--sitemap --write` builds it for you** (names read from each page's `<title>`, existing entries never overwritten), `sample check` lints its coverage against the standard's required page kinds, `scan --sample` scans it, and an un-scanned `--standard rgaa` report is flagged **partial**.
- **Pack-only detection (declarative):** a standards pack can ship its own `rules` (a bounded, ReDoS-guarded matcher DSL — no code) and normativity/severity `overrides`, projecting onto its criteria without forking the engine.

## Measured against a corpus it did not write

A self-authored fixture can only prove that a rule fires on the defect written for it. So the engine is also scored against the **[W3C ACT-Rules Community Group](https://act-rules.github.io) test corpus** — 1 134 `passed` / `failed` / `inapplicable` examples across 91 rules, authored independently of this project:

| | |
|---|---|
| Rules scored | **44** (the ACT rules an equivalent engine check exists for) |
| `failed` examples caught | **168 / 187** |
| `passed` / `inapplicable` examples left alone | **401 / 401** — no unexplained false positive |
| Deliberate divergences | 9, each argued on the record |
| Declared gaps (statically decidable, not implemented) | 0 |

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
npx skills add SocialGouv/ultra11y                 # this agent
npx skills add SocialGouv/ultra11y --agent codex   # …or opencode, cursor, gemini, amp, zed…
```

**As an agent plugin** — the same two skills, plus the hook that makes the review
**automatic**. Installed this way, a pending `git commit`, `git push` or `gh pr create`
that carries accessibility findings is stopped once and the agent is handed the findings,
so `review-a11y` runs before the work goes out — you never type the skill's name.

```
/plugin marketplace add SocialGouv/ultra11y          # Claude Code
codex plugin marketplace add SocialGouv/ultra11y     # Codex CLI
npx ultra11y install --opencode                  # OpenCode 1.x or 2.x (detected; --opencode-version 1|2)
```

Codex's hook engine is a near-clone of Claude Code's — same events, same envelope, and it
exports `${CLAUDE_PLUGIN_ROOT}` too — so both harnesses share one `hooks/hooks.json`.
OpenCode has no permission-decision channel, so there the gate surfaces as a **failed shell
call whose error message carries the findings**. One plugin file serves OpenCode 1 and
OpenCode 2, whose plugin APIs differ: V2 reads its `setup(ctx)`, V1 its `server()`.
Per-harness deltas, the Codex feature flag and the trust prompt: [`skills/ultra11y/references/harnesses.md`](skills/ultra11y/references/harnesses.md).

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

**In CI — run iterion's [`rgaa-audit` bot](https://github.com/SocialGouv/iterion/tree/main/bots/rgaa-audit).**
ultra11y ships no CI integration of its own. The bot is the harness that turns the engine into an
audit with no one at the keyboard: it installs the engine pinned (version and sha256), renders
your page sample, has read-only agents adjudicate the judgment criteria, puts every claim on
trial, gates with `check` and files one issue per non-conforming criterion. See
[`references/ci.md`](skills/ultra11y/references/ci.md).

Or clone and run the bundled engine straight from the repo:

```sh
node scripts/ultra11y.mjs --help
```

## Commands

```
ultra11y audit    <globs… | ->  [--standard <pack>] [--out <dir>] [--include <glob>] [--exclude <glob>] [--ext <list>] [--jsx] [--graph] [--json] [--lang auto|en|fr] [--no-default-excludes]
ultra11y audit    [--changed | --since <ref> | --staged] [--max-files <n>] [--dedup exact|normalized|off] [--fail-on blocking|major|minor]
ultra11y audit    [--captures <dir>] [--no-captures] [--require-captures]              # audit rendered-DOM captures alongside source
ultra11y report   --in <audit.json> [--out <dir>] [--standard <pack>] [--html] [--evidence] [--lang auto|en|fr]
ultra11y prd      --in <audit.json> [--out <dir>] [--split criterion] [--format audit|doc] [--standard <pack>] [--lang auto|en|fr]
ultra11y tickets  --in <audit.json> [--provider auto|github|gitlab|jira] [--grain criterion|page|page-criterion|single|file] [--transport auto|cli|rest] [--max-tickets <n>] [--dry-run] [--json]
ultra11y render   [<dir>] [--scaffold | --setup | --coverage | --storybook] [--captures <dir>] [--out <file>] [--json]
ultra11y snapshot write [--root <dir>] [--fail-on blocking|major|minor] [--json]   # payload on stdin → .ultra11y/pages/<id>/ + audit
ultra11y snapshot list  [--root <dir>] [--json]
ultra11y pages    --in <audit.json> [--standard <pack>] [--json] [--lang auto|en|fr]   # the per-page criterion grid
ultra11y pages    --in <audit.json> --format report [--split page] [--out <dir>]        # the per-page report, with screenshots
ultra11y pages    discover --sitemap <url> | --crawl <url> [--depth <n>] [--max <n>] [--write]   # build the page sample
ultra11y criteria [<sc>] [--list] [--standard <pack> [--theme <N>]] [--generate] [--json] [--lang auto|en|fr]
ultra11y criteria --standard <pack> --glossary [<term>]  |  criteria [--standard <pack>] --plan   # defined terms · the work plan
ultra11y check    --report <md> [--standard <pack>] [--quiet] [--json]
ultra11y check    --in <audit.json> --require-decided[=pages] [--allow-undecided <file>] [--require-rendered]
ultra11y verify   --report <md> [--standard <pack>] [--semantic] [--apply <verdicts.json>] [--max-verify <n>] [--json]
ultra11y verify   --report <md> [--conformities <ledger|adjudication.json> | --no-conformities]   # also put the claimed CONFORMITIES on trial
ultra11y verify   --report <md> --in <audit.json> --manual   |   verify --apply <adjudication.json> --in <audit.json> [--ledger]
ultra11y orchestrate --run <dir> [--phase adjudicate|verify-report] [--eco] [--manifest]   # fan the judgment out to subagents
ultra11y fix      <globs… | ->  [--write] [--iterate] [--changed | --since <ref> | --staged] [--safe] [--only <ids>] [--jsx] [--json]
ultra11y init     [--hook] [--fail-on blocking|major|minor]
ultra11y pack     check <pack.json> [--guidance <g.json>]  |  scaffold                 # gate an (AI-)authored standards pack
ultra11y scan     <url|file…> [--cwd <dir>] [--root <dir>] [--storage-state <file>] [--merge <audit.json>] [--out <dir>] [--json]
ultra11y scan     --sample | --sitemap <url> | --crawl <url> [--depth <n>] [--max <n>] [--merge <audit.json>] [--json]

# global: --pack <paths> (load external standards pack(s) at runtime) · --override
```

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
node scripts/ultra11y.mjs criteria --standard rgaa --plan                           # the work plan: what each evidence tier settles
```

`.ultra11yrc.json { "standard": "rgaa" }` makes it the default for every command. Under a pack,
no deliverable carries a WCAG cross-reference — report, PRD, tickets and per-page sheets name
that standard's criteria and nothing else; the WCAG core travels inside the
document's `core` field, where the pipeline reads it and no rendering does. The one place the
mapping is still printed is `criteria --standard rgaa <id>`, which is a reference lookup and
where a reader goes looking for it.

**RGAA 4.1.2** (France) ships as the flagship pack. Section 508 (US), EN 301 549 (EU) and
others are welcome — adding a country is a single PR (pack JSON + one registration line +
a test). See [`CONTRIBUTING.md`](CONTRIBUTING.md) and `skills/ultra11y/references/standards.md`.

### What RGAA automation actually covers

The engine's 102 rules are not 102 RGAA criteria: several rules can evidence the same official
test, and a rule can detect a useful symptom without exhausting the criterion's alternatives,
exceptions or relevance checks. The generated contract classifies all **258 official RGAA
tests**:

- **30 `static` tests across 22 criteria:** `1.1`, `1.9`, `2.1`, `5.7`, `5.8`, `6.1`, `6.2`, `7.1`,
  `8.2`, `8.3`, `8.4`, `8.5`, `8.10`, `9.3`, `10.1`, `10.12`, `11.1`, `11.2`, `11.5`,
  `11.6`, `11.8`, `11.9`.
- **3 `rendered` tests across 3 criteria:** `1.1`, `8.1`, `10.7`.
- Those two tiers cover **24 distinct criteria that can produce a deterministic `NC`**;
  `1.1` belongs to both.
- **54 criteria receive a normative engine signal:** 24 have at least one decisive rule and
  43 receive candidate evidence, with overlap. One additional criterion receives only an
  advisory signal. A candidate is forwarded to adjudication and never changes a verdict by
  itself.
- Only **8.3 and 8.5** may earn `C` from a complete silent measurement. For the other
  mechanically detectable tests, silence can mean “no subject found” or “an alternative or
  exception still needs judging”, so it cannot prove conformity. 10.1 was on that list and
  left it: its rule tolerates `<u>`, tolerates `width`/`height` on nine tags where the
  glossary names five, and covers “presentation built out of spaces” with two heuristics —
  every one of them a deliberate under-report, which is the safe direction for a finding and
  the wrong one for a conformity.
- The remaining **225 `judgment` tests across 92 criteria** all enter the AI worklist,
  including an apparently absent subject whose `NA` still needs confirmation. Overall,
  **104 of 106 criteria require adjudication to earn `C`**.

The number can grow, but the useful target is **more observed, exact failures**, not a larger
marketing count. The best next candidates are complete rendered probes for zoom/reflow and
hover content (10.4, 10.11, 10.13), and contrast,
link distinction or orientation checks (3.2, 3.3, 10.6, 13.9) that first rule out every
official alternative and particular case. The ACT corpus's remaining misses are another
implementation queue, although closing one does not necessarily cover a new RGAA criterion. A candidate is
promoted only when a narrower rule demonstrably exhausts its cited official test; the two
`C`-by-silence criteria stay unchanged until an equally complete proof exists.

The generated [106-criterion / 258-test matrix](skills/ultra11y/references/rgaa-automation.md)
is the source of truth; CI rebuilds it from the vendored DINUM data and rejects drift.

**Downloadable PDF documents (RGAA 13.3).** The engine reads PDFs with its own zero-dependency
reader (Node `zlib` only): `audit report.pdf` / `audit "public/**/*.pdf"`, and `scan` — or the
Playwright fixture, through the test's own session — downloads the same-origin PDFs each captured
page links to into `.ultra11y/documents/`: a `.pdf` path, a `download` link, a link or route
naming PDF (`/api/declaration-pdf`), kept only when the response is a PDF; `scan --storage-state`
sends the session's matching cookies (bounded, `--no-pdf` / `pdf: false` to opt out). Five document checks — `pdf-untagged`, `pdf-lang-missing`,
`pdf-title-missing` (title + `DisplayDocTitle`), `pdf-no-text` (image-only scan) and the advisory
`pdf-structure-shallow` — are listed per document in the report and reach RGAA 13.3 as
**candidate** evidence: an accessible alternative version may exist, so they never decide a
verdict, and passing them is never PDF/UA conformance (veraPDF/PAC establish that). An encrypted
or malformed file is reported unreadable. See `skills/ultra11y/references/audit.md`.

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
  you already have**. Cypress feeds the pixel
  tier too, via `after:screenshot`. `checkA11y(page, { report: true })` emits the per-page
  report straight out of the run. The audit runs, so the page is checked in the state
  your test built (logged in, form filled, modal open) — state a separate `scan` run does not
  have. Each checked page is persisted as a **snapshot** (`.ultra11y/pages/<id>/`: the whole
  rendered document + computed styles + boxes), which is the durable half: the same page
  re-audits **offline, with no browser**, so CI and the per-page report work from it. Because
  a snapshot is a full document, the page-scoped rules finally run — RGAA **8.3** (`lang`),
  **8.5/8.6** (`title`) — and every finding carries both its page and the source file that
  rendered it. See `references/e2e.md` and `references/pages.md`.
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
  ordinary `audit`: **no browser, no running server**. `rendered-contrast` measures
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
  changes. `tests/rgaa-coverage.test.ts` pins a floor of **50 of 106** RGAA criteria mapped
  onto an engine rule, up from 43 before this tier; silently losing one fails CI.
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
  was audited. An adjudicated non-conformity counts only on the pages its findings are on; an adjudicated
  conformity stays a claim about the whole run, except on a page with none of the criterion's
  subject. Under a country standard, a page's rate is the RGAA page formula: conforming ÷
  (conforming + non-conforming), the criteria still to assess counted beside it and marking it
  provisional. And `pages --format report [--split page]` turns that into the **deliverable an
  auditor hands over**: one dossier per page — identity, **screenshot**, rate, *every* criterion
  of the standard with its status on that page, then each non-conformity as the ordinary auditor
  block. It re-decides nothing and invents no format, so a page sheet and the compliance report
  cannot disagree; `check` gates it against invented criteria like any other report.
  See `references/pages.md`.
- **CI through iterion** — ultra11y ships no GitHub Action or GitLab template. CI audits run
  through iterion's [`rgaa-audit` bot](https://github.com/SocialGouv/iterion/tree/main/bots/rgaa-audit),
  which drives the engine CLI pinned, adjudicates and refutes with read-only agents, and files
  the issues. The CLI it calls — `audit`, `scan --sample`, `verify --manual`/`--apply`/`--report`,
  `check`, `report`, `pages`, `tickets` — is the engine's stable contract. See `references/ci.md`.
- **Automation** — `init --hook` (default) wires a zero-dependency git pre-commit gate over the
  **strict staged snapshot**: it audits the exact index blobs, auto-applies the safe fixes and
  re-stages them, and blocks only on judgment issues. See `references/automation.md`.

### Optional dynamic tier (axe-core)

`scan` runs **axe-core in a headless browser** to decide the *needs-rendering* criteria the static engine leaves as residual risks — chiefly **computed colour contrast (1.4.3)** plus a 320px **reflow** check (1.4.10) and a render cross-check of the structural rules. It uses a Playwright that resolves from your project (`--cwd`), then from ultra11y's own dependencies, and additionally probes focus visibility (2.4.7), 200% zoom (1.4.4), text spacing (1.4.12) and content-on-hover (1.4.13), plus **stateful** probes (fill inputs then re-measure overflow, and a live-region probe for status messages 4.1.3 — opt out with `--no-interact`, `--interact-clicks` for authed-scan button clicks), and takes `--storage-state` for authenticated pages. `--merge` folds the findings into a static `AuditResult`, upgrading `manual` criteria to `C`/`NC`. A country-standard audit scans its declared page sample with `scan --sample` (lint it first with `sample check`):

```sh
node scripts/ultra11y.mjs audit "src/**/*.html" --out audits --json > /dev/null
node scripts/ultra11y.mjs scan http://localhost:3000 --cwd . --merge audits/audit-latest.json --out audits
node scripts/ultra11y.mjs report --in audits/audit-latest.json --out audits
```

The scan needs a Chromium binary (`npx playwright install chromium`, or one already on the machine named with `--browser-path /usr/bin/chromium` / `ULTRA11Y_BROWSER_PATH` — launched as given, never replaced by a fallback) plus `@playwright/test` and `@axe-core/playwright` — which **come with the npm package**, since they are its own dependencies; the audited project's own copies take precedence when it has them. Running the engine as a **standalone skill bundle** is the exception: an installed skill has no `node_modules` beside it, so there the two packages must be in the audited project, reachable from `--cwd`. The engine bundle itself stays dependency-free either way. See `skills/ultra11y/references/dynamic.md`.

Typical audit flow:

```sh
node scripts/ultra11y.mjs audit "src/**/*.html" --json > audit.json
node scripts/ultra11y.mjs report --in audit.json --out audits      # audits/wcag-YYYY-MM-DD.md
node scripts/ultra11y.mjs check  --report audits/wcag-YYYY-MM-DD.md # integrity gate
```

### A report someone will actually open

There are two deliberate publication profiles. In an interactive audit — on Claude Code, Codex
or OpenCode alike, following `skills/ultra11y/references/full-audit.md` — the skill produces the
detailed deliverable: adjudicated Markdown, a printable single-file HTML report,
per-page HTML/Markdown dossiers, screenshots and annotated evidence. In CI, iterion's
`rgaa-audit` bot publishes the dated report, the per-page grid, the coverage annex and the
verdict ledger.

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
pnpm run demo            # audit → report → check → criteria on tests/fixtures
```

Releases are cut automatically by **semantic-release** on push to `main` (GitHub release +
npm publish via OIDC trusted publishing, plus the moving `v5` major tag). The version bump is
decided by **Conventional Commits**: a commit whose subject carries no `feat:`/`fix:` prefix
is analysed as *no release*, so a change that must ship needs at least one conventional commit
in the range — otherwise the major alias and npm keep serving the previous version while `main`
moves on.

## Data & licensing

- ultra11y's code: **MIT** (see `LICENSE`).
- The **WCAG 2.2** success-criteria dataset (`src/data/wcag.json`) is derived from the official W3C source ([w3c/wcag](https://github.com/w3c/wcag)); WCAG 2.2 is © **W3C**, reused under the **W3C Document License** (only SC ids/titles/levels are reproduced) — see `NOTICE`.
- The **RGAA pack** (`src/data/standards/rgaa.json`, `rgaa.glossary.json`) is derived from the official **RGAA 4.1.2** reference published by DINUM/DISIC, under the **Licence Ouverte / Etalab 2.0** — see `NOTICE`. Attribution: « RGAA 4.1.2 — DINUM ».
- The report format is inspired by DINUM/etalab-ia audit conventions; the native-first authoring rules are adapted from the SocialGouv accessibility skill. No source code was copied.

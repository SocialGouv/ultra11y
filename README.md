# ultra11y

> Audit HTML/CSS/JSX against **WCAG 2.2 AA** accessibility and produce a dated compliance report — or author/review accessible markup without regressions. A [skills.sh](https://skills.sh) agent skill: a deterministic, zero-dependency static engine **plus** the agent's judgment, with `check`/`verify` gates against hallucinated non-conformities. **The central deliverable is the auditor conformance block** — theme, criterion + official wording, test(s), WCAG mapping + level, finding, expected state, verification, `file:line` occurrences — rendered identically by the `report` (compliance doc), the `prd` backlog and the GitHub issues, in the active standard's vocabulary and **in your language** (`--lang auto` follows the conversation/repo). **WCAG is the worldwide core; country standards (RGAA, …) are pluggable in-repo packs.**

ultra11y is built around an honest **division of labour**. Automated tools only catch a fraction of accessibility problems, so the engine does the *mechanical* work — 72 machine-detectable static checks tied to the WCAG 2.2 success criteria — and is explicit about everything it can't decide statically. What it can't, the **AI agent adjudicates** (statically, from the evidence, gated by `verify`/`check`) — not a deferral to a human:

- **Automatable (engine):** missing `alt`/`lang`/`title`, unlabeled fields, empty links/buttons, icon-only controls, iframes without title, tables without headers, heading-level skips, empty/dangling headings & labels, duplicate ids, invalid/broken ARIA, positive `tabindex`, autoplay/timed-refresh/`blink`/`marquee` media…
- **Agent judgment (gated):** alt-text relevance, link purpose in context, reading/tab order, caption accuracy — the agent rules on these via `verify --manual` → `--apply`, each verdict carrying a justification (or a groundable NC), never a silent "conforming".
- **Needs rendering (scan tier):** computed contrast, visible focus, zoom/reflow, content on hover — decided by `scan` (axe-core in a real browser); until then they stay **residual risks**, never silently "conforming".
- **Advisory vs non-conformity:** a good practice with no failing normative test (an `advisory` pack rule, a best-practice-only axe violation, an agent recommendation) renders as « Recommandation (non normative) » — it never flips a criterion to `NC` nor enters the conformance rate. An NC always cites a `normativeRef`.
- **Stateful scan probes:** the local runtime drives the page with bounded, non-navigating interactions (fill inputs then re-measure overflow; a live-region probe for status messages 4.1.3) — `--no-interact` opts out; `--interact-clicks` re-enables button clicks on authenticated scans (destructive-named buttons are never clicked).
- **Normative page sample (échantillon):** a country-standard audit runs over a declared `sample.pages` set — `sample check` lints its coverage against the standard's required page kinds, `scan --sample` scans it, and an un-scanned `--standard rgaa` report is flagged **partial**.
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

```sh
npx skills add maxgfr/ultra11y
```

The repository ships **two skills** (pick at the prompt, or pass the skill name):
`ultra11y` — full audits, compliance reports, PRD backlogs, standards packs — and
`review-a11y` — the fast review loop that audits **exactly the code under change**
(staged files, working diff, or branch vs merge-base) and reports like a code reviewer.
Both bundle the same install-free engine.

Or clone and run the bundled engine directly (Node ≥ 22.18, zero dependencies):

```sh
node scripts/ultra11y.mjs --help
```

## Commands

```
ultra11y audit    <globs… | ->  [--out <dir>] [--include <glob>] [--exclude <glob>] [--ext <list>] [--jsx] [--graph] [--json] [--lang auto|en|fr] [--no-default-excludes]
ultra11y audit    [--changed | --since <ref> | --staged] [--max-files <n>] [--dedup exact|normalized|off] [--baseline <file>] [--fail-on blocking|major|minor]
ultra11y audit    [--captures <dir>] [--no-captures] [--require-captures]              # audit rendered-DOM captures alongside source
ultra11y report   --in <audit.json> [--out <dir>] [--standard <pack>] [--lang auto|en|fr]
ultra11y prd      --in <audit.json> [--out <dir>] [--split criterion] [--format audit|doc|remediation] [--standard <pack>] [--gh-issues | --gh-single] [--lang auto|en|fr]
ultra11y render   [<dir>] [--scaffold | --setup | --coverage | --storybook] [--captures <dir>] [--out <file>] [--json]
ultra11y criteria [<sc>] [--list] [--standard <pack> [--theme <N>]] [--generate] [--json] [--lang auto|en|fr]
ultra11y check    --report <md> [--standard <pack>] [--quiet] [--json]
ultra11y verify   --report <md> [--standard <pack>] [--semantic] [--apply <verdicts.json>] [--max-verify <n>] [--json]
ultra11y fix      <globs… | ->  [--write] [--iterate] [--changed | --since <ref> | --staged] [--safe] [--only <ids>] [--jsx] [--json]
ultra11y init     [--hook] [--ci] [--baseline] [--fail-on blocking|major|minor]
ultra11y pack     check <pack.json> [--guidance <g.json>]  |  scaffold                 # gate an (AI-)authored standards pack
ultra11y scan     <url|file…> [--runtime auto|local|docker] [--cwd <dir>] [--storage-state <file>] [--merge <audit.json>] [--out <dir>] [--json]
ultra11y scan     --sitemap <url> | --crawl <url> [--depth <n>] [--max <n>] [--runtime …] [--merge <audit.json>] [--json]

# global: --pack <paths> (load external standards pack(s) at runtime) · --override
```

## Standards packs (RGAA France first; add your country)

WCAG 2.2 AA is the engine's canonical key. Each country standard ships as an in-repo
**standards pack** — a small JSON that maps the national standard's criteria onto WCAG
success criteria — so the same audit re-keys to any standard:

```sh
node scripts/ultra11y.mjs report   --in audits/audit-latest.json --standard rgaa   # → audits/rgaa-YYYY-MM-DD.md
node scripts/ultra11y.mjs criteria --standard rgaa 8.3                              # a pack criterion (+ its WCAG SCs)
```

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
- **Automation** — `init --hook` (default) wires a zero-dependency git pre-commit gate over the
  **strict staged snapshot**: it audits the exact index blobs, auto-applies the safe fixes and
  re-stages them, and blocks only on judgment issues. `init --baseline`/`--ci` is the opt-in
  regression variant (hook + committed baseline / GitHub Actions job) that fails only on **new**
  non-conformities, not the existing backlog. See `references/automation.md`.

### Optional dynamic tier (axe-core)

`scan` runs **axe-core in a headless browser** to decide the *needs-rendering* criteria the static engine leaves as residual risks — chiefly **computed colour contrast (1.4.3)** plus a 320px **reflow** check (1.4.10) and a render cross-check of the structural rules. Two runtimes (default `--runtime auto`): **`--runtime local`** uses a Playwright that resolves from your project (`--cwd`) — **no Docker** — and additionally probes focus visibility (2.4.7), 200% zoom (1.4.4), text spacing (1.4.12) and content-on-hover (1.4.13), plus **stateful** probes (fill inputs then re-measure overflow, and a live-region probe for status messages 4.1.3 — opt out with `--no-interact`, `--interact-clicks` for authed-scan button clicks), and takes `--storage-state` for authenticated pages; **`--runtime docker`** falls back to a self-contained image built on first use. `--merge` folds the findings into a static `AuditResult`, upgrading `manual` criteria to `C`/`NC`. A country-standard audit scans its declared page sample with `scan --sample` (lint it first with `sample check`):

```sh
node scripts/ultra11y.mjs audit "src/**/*.html" --out audits --json > /dev/null
node scripts/ultra11y.mjs scan http://localhost:3000 --runtime local --cwd . --merge audits/audit-latest.json --out audits
node scripts/ultra11y.mjs report --in audits/audit-latest.json --out audits
```

Only the Docker runtime needs Docker; `--runtime local` needs a project with `@playwright/test` + `@axe-core/playwright`. The rest of the skill is zero-dependency. The Docker runner + Dockerfile are embedded in the engine and mirrored under `docker/` (with a `docker-compose.yml`). See `skills/ultra11y/references/dynamic.md`.

Typical audit flow:

```sh
node scripts/ultra11y.mjs audit "src/**/*.html" --json > audit.json
node scripts/ultra11y.mjs report --in audit.json --out audits      # audits/wcag-YYYY-MM-DD.md
node scripts/ultra11y.mjs check  --report audits/wcag-YYYY-MM-DD.md # integrity gate
```

The skill (`skills/ultra11y/SKILL.md` + `references/`) teaches the agent when and how to run these, how to complete the manual criteria, and the native-first authoring doctrine.

## Development

```sh
pnpm install
pnpm test               # vitest
pnpm run typecheck
pnpm run build          # tsup → scripts/ultra11y.mjs, mirrored into skills/ultra11y/scripts/
pnpm run check:build    # asserts the committed bundle is reproducible
pnpm run build:wcag     # re-derive src/data/wcag.json from the vendored W3C source
pnpm run build:pack:rgaa # re-build the RGAA pack from the vendored DINUM source
pnpm run build:criteria  # regenerate skills/ultra11y/references/criteria.md
```

Releases are cut automatically by semantic-release on push to `main` (GitHub release + tarball, no npm publish).

## Data & licensing

- ultra11y's code: **MIT** (see `LICENSE`).
- The **WCAG 2.2** success-criteria dataset (`src/data/wcag.json`) is derived from the official W3C source ([w3c/wcag](https://github.com/w3c/wcag)); WCAG 2.2 is © **W3C**, reused under the **W3C Document License** (only SC ids/titles/levels are reproduced) — see `NOTICE`.
- The **RGAA pack** (`src/data/standards/rgaa.json`, `rgaa.glossary.json`) is derived from the official **RGAA 4.1.2** reference published by DINUM/DISIC, under the **Licence Ouverte / Etalab 2.0** — see `NOTICE`. Attribution: « RGAA 4.1.2 — DINUM ».
- The report format is inspired by DINUM/etalab-ia audit conventions; the native-first authoring rules are adapted from the SocialGouv accessibility skill. No source code was copied.

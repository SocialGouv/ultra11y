---
name: ultra11y
description: "Use to AUDIT existing HTML/CSS/JSX against WCAG 2.2 AA accessibility and produce a dated auditor-conformance report, OR to AUTHOR/REVIEW accessible markup (native-HTML-first, ARIA last). An install-free engine (`node scripts/ultra11y.mjs`, no keys) runs 78 static checks tied to WCAG criteria — alt/lang/title, unlabeled fields, empty links/buttons, tables, headings, ARIA vocabulary, label-in-name, autocomplete — measured against the official W3C ACT corpus. The engine decides 3 of the 55 criteria; the AI agent adjudicates the 38 judgment ones from harvested evidence + a per-criterion decision protocol (`verify --manual`, gated, fannable via `orchestrate`), and the 14 rendering ones go to `scan` — never silently conforming. Library/SFC code is audited as RENDERED captures (`render --setup`); country standards are pluggable packs (`--standard rgaa`, `scan --sample`). check/verify reject invented non-conformities. Triggers: 'audit WCAG/a11y', 'make accessible', 'fix a11y', 'audit RGAA'."
when_to_use: "Invoke when the user asks for an accessibility AUDIT or a formal deliverable: audit a repo, site or page against WCAG 2.2 AA or a country standard (RGAA, Section 508, EN 301 549); produce a dated conformance report, a criterion grid, a PRD backlog, or tickets (GitHub/GitLab/Jira); author accessible markup from scratch; wire the repo gate (init --hook/--ci) or a rendered-DOM capture pipeline. For a review of the code UNDER CHANGE (diff, branch, PR), use the `review-a11y` skill instead."
license: MIT
metadata:
  version: 5.3.3
---

# ultra11y — audit WCAG 2.2 AA and write accessible markup

On accessibility, an automated tool only sees part of the problem. `ultra11y` owns
that with a **division of labour**: the deterministic, install-free engine
(`node scripts/ultra11y.mjs <command>` — no `npm install`, no key; the JSX/TSX parser
is embedded in the bundle) does the *mechanical* work — detect the machine-checkable
non-conformities and tie each to the right **WCAG success criterion** — and **the AI agent**
(Claude running this skill) *adjudicates the judgment criteria itself* — alt relevance, link
purpose in context, reading order — statically, from the evidence the engine harvests
(`verify --manual`), each verdict gated by `verify`/`check`. Only the truly **rendered-DOM**
criteria (computed contrast, visible focus, zoom/reflow, content-on-hover) fall to the `scan`
tier (axe-core in a real browser); a human is at most optional oversight. Gates stop any
hallucinated non-conformity from surviving, and nothing is ever silently "conforming".

**WCAG 2.2 Level AA is the worldwide core.** Country standards — France's **RGAA**, the
US **Section 508**, the EU **EN 301 549** — are pluggable *standards packs* that map their
criteria onto WCAG. Add `--standard rgaa` to re-key reports/criteria; **plug an external
pack at runtime** with `--pack ./pack.json` (or a `.ultra11yrc.json`), no rebuild; or
contribute your country (see `references/standards.md`). Packs (and their concrete
**implementation guidance** — the RGAA SocialGouv/etalab good/bad patterns) can be
**AI-ingested** and gated by `pack check` so a fabricated mapping never passes — see
`references/packs.md` and `references/guidance.md`.

**Most of the work is yours.** Of the 55 WCAG 2.2 AA success criteria, the engine can decide
**3** outright; **14** need a rendered page (`scan`) and **38** are judgment calls the agent
adjudicates. So the engine's clean run is a starting point, never a verdict — and
`references/adjudication.md` is the page you actually work from.

> **Core rules:**
> 1. **Never invent a non-conformity**: every `NC` cites a real, resolvable element (`check` verifies it).
> 2. **Native HTML first, ARIA last**; never duplicate implicit semantics.
> 3. **Never invent a conformity either**: a `C` is cited exactly like an `NC` — it names in
>    `citations[]` the harvested evidence it cleared, each anchor resolvable and drawn from
>    the evidence that criterion was actually shown. A criterion presented with *no* evidence
>    cannot be `C` at all; it stays `manual`. And an adjudicated `C` is never merged with an
>    engine-decided one: reports list it separately and keep it out of the automatic pass rate.
> 4. **Residual is explicit, never silently conforming**: the AI agent *adjudicates* every
>    *judgment* criterion itself (`verify --manual`, gated), and the *rendering* criteria go to
>    `scan`; any criterion still unproven stays "to assess manually" — no status without a
>    recorded, justified verdict.
> 5. **Look the criterion up; never recall it.** `criteria [--standard <pack>] <id>` — or
>    `ultra11y_criteria` over MCP — returns the criterion's own wording, its **numbered
>    tests**, and the glossary definitions those tests cite. RGAA 8.3 is not "the page needs a
>    `lang` attribute"; it is test `8.3.1` with two alternative conditions, and the glossary
>    decides what its terms mean. An auditor block that cites `8.3.1` after reading it is
>    grounded; one that cites it from memory is a guess wearing a reference. Before auditing
>    against a country standard, run the plan (`ultra11y_method`): it tells you how many of its
>    criteria no tool will decide for you — for RGAA, **58 of 106**. See `references/mcp.md`.
> 6. **The FINAL rendered semantic HTML must be correct.** The engine sees only source; a
>    component library (DSFR/MUI…) or `.vue`/`.svelte`/`.astro` SFC hides the real markup, so
>    a green source audit is not proof. Verify the produced semantic HTML — install the
>    zero-touch **capture** harvester (`render --setup`) so every component your tests render
>    is serialized to `.ultra11y/captures` and audited, with `audit --require-captures` gating
>    the blind spots. See `references/automation.md` / `rendered.md`.
> 7. **Language**: ALWAYS pass `--lang` matching the language of your conversation with
>    the user; ask the user when ambiguous. Without the flag the CLI auto-detects (repo
>    `<html lang>` → the active standard's default locale → English) — a scripted/CI
>    fallback, not a substitute for passing `--lang` yourself.
> 8. **Technical tokens stay in English, even in French prose.** In any French deliverable
>    you write (report commentary, PRD, tracker tickets, judgment verdicts), attribute/
>    element/role names and their values are code, not prose — never translate them:
>    `aria-live` stays `aria-live` (never « région live »), same for `tabindex`, `alt`,
>    `role="alert"`, landmark role names. The engine's own fr catalog follows this; match
>    it. Normative standard vocabulary (RGAA wording such as « lien d'évitement ») keeps
>    its official French.

## The reference library

Domain knowledge first, then the tooling. Read the one that matches the question in front of you.

| Accessibility knowledge | |
|---|---|
| `references/adjudication.md` | How to decide each of the 52 criteria the engine hands you — the decision rule, when NA is legitimate, the questions |
| `references/naming.md` | Accessible-name computation, 2.5.3 label-in-name, visually-hidden CSS, naming images/SVG/figures |
| `references/widgets.md` | ARIA APG composite patterns, keyboard contracts, focus management, SPA route changes, live regions |
| `references/forms-and-errors.md` | Labels and instructions, the `autocomplete` token list, error identification/suggestion/prevention, redundant entry, accessible authentication |
| `references/structure.md` | Headings, landmarks, lists and `dl`, simple and complex tables, meaningful sequence |
| `references/media-and-motion.md` | Captions/audio description/transcripts, pointer gestures, target size, orientation, reflow, reduced motion |
| `references/forbidden-patterns.md` | 15 anti-patterns: bad → why → native fix → criterion |
| `references/focus-and-logic.md` | The focus/keyboard criteria you own, and how to reason about them |
| `references/criteria.md` | The 55 criteria: level, automatability class, engine rules, pack mapping (generated) |
| `references/act.md` | What the engine is measured to catch — and what it demonstrably does not (generated) |

| Running the tool | |
|---|---|
| `references/audit.md` | The audit loop end to end, and the normative page sample |
| `references/judgment.md` | The adjudication + refutation worklists, verdict vocabulary, fail-closed fold |
| `references/verify.md` | The `check`/`verify` gates |
| `references/false-positives.md` | Where a finding may still be wrong, and how to refute it |
| `references/rendered.md` · `references/automation.md` | Auditing produced HTML, captures, hooks and CI |
| `references/harnesses.md` | Where this runs: Claude Code, Codex CLI, OpenCode, and the AGENTS.md fallback |
| `references/orchestrators.md` | Driving the engine from a workflow engine / non-GitHub CI: pinning, the six-step pipeline, exit codes, the ticket set as JSON for any tracker |
| `references/ci.md` | `--format sarif\|github`: inline PR annotations, code scanning, job summary |
| `references/pages.md` | Page snapshots + the per-page criterion grid (`pages`), and its honesty rules |
| `references/e2e.md` | `render --e2e`: auditing a page during your Playwright/Cypress run |
| `references/devtools.md` | `dev`: the live overlay while you build, and the per-page dashboard |
| `references/extension.md` | The browser extension: audit the page you are looking at, through the side-car |
| `references/dynamic.md` | The `scan` tier: runtimes, probes, authenticated pages |
| `references/scale.md` | Focusing an audit on a large repository |
| `references/fix.md` · `references/correction.md` | Applying fixes, by priority, without regressions |
| `references/prd.md` | The auditor block as a backlog (markdown) |
| `references/tickets.md` | Filing that backlog as tickets: GitHub, GitLab, Jira, and at which granularity |
| `references/standards.md` · `references/packs.md` · `references/guidance.md` | Country standards, authoring a pack, implementation guidance |
| `references/mcp.md` | **The standards as a rule engine**: look a criterion up instead of recalling it — its numbered tests, the terms it defines, the fix, and the work plan. As MCP tools and `std://` resources, or the same data on the CLI |
| `references/methodology.md` | Statuses, pass rate, severities, report format |
| `references/cross-file.md` | `--graph`: imports and cross-file rules |
| `references/orchestration.md` | Fanning the judgment phases out across subagents |

## Choose by situation

- **"Audit / compliance report"** → `node scripts/ultra11y.mjs audit … --json`, then
  `report` (synthesis table + one **auditor conformance block** per NC criterion — same
  block `prd` and `tickets` use), then `check`; read **`references/audit.md`**.
- **"Code rendered by a library (DSFR, MUI…) or a `.vue`/`.svelte`/`.astro` SFC / avoid
  false negatives"** → audit the **produced HTML**, not the source template. Easiest:
  install the zero-touch **capture** harvester (`render --setup`) so your tests serialize
  every rendered component to `.ultra11y/captures` (auto-ingested, findings attributed to the
  source component; `render --coverage` and `audit --require-captures` track blind spots). Or
  `render` (build→audit recipe or SSR snapshot `--scaffold`) then `audit` on the output, and
  `scan` for computed rendering. SFC-source findings are flagged `preliminary` (a
  `scope.sourceTemplate` caveat); read **`references/rendered.md`**.
- **"A finding looks wrong / false positive on a component"** → the engine auto-suppresses
  most component false positives (slot/prop-injected names, component children, dynamic
  bindings, conditional headings) and marks SFC/library-source findings `preliminary`;
  confirm or refute the rest with `verify --apply`; read **`references/false-positives.md`**.
- **"Large repo / audit smartly"** → focus: `--changed` (git diff), template
  prioritization, dedup, `--max-files`; read **`references/scale.md`**.
- **"Cross-file analysis (tree + dependencies), JSX/TSX as a real AST"** →
  `audit --graph` resolves imports and applies cross-file rules (an icon-only component
  used without a name, an anchor target in another file…), no browser; read
  **`references/cross-file.md`**.
- **"Generate the fix markdown / PRDs"** → `prd` (the SAME auditor
  conformance block `report`'s NC section renders — theme/criterion/test/WCAG+level/
  finding/expected/verification in the active standard's vocabulary — as a backlog);
  `--split criterion`, `--format doc` for a product-requirements doc, `--format remediation`
  for the legacy dev backlog). It writes markdown only; read
  **`references/prd.md`**.
- **"Open tickets / issues for this (GitHub · GitLab · Jira)"** → `tickets`, a separate
  command that reads the audit and files it, writing no markdown. `--grain` picks what one
  ticket is: per criterion (default), per page, per page+criterion, per file, or one
  consolidated. De-dupe is by exact title, so re-running never duplicates. Always
  `--dry-run` first; read **`references/tickets.md`**.
- **"Plug or author a standards pack (RGAA & beyond), AI-ingest external rules"** →
  `--pack`/`.ultra11yrc.json` to load at runtime, `pack check` to gate it (the
  anti-hallucination guardrail), `pack scaffold` to start one; concrete before/after
  implementation guidance attaches to findings/PRD; read **`references/packs.md`** and
  **`references/guidance.md`**.
- **"Adjudicate the judgment criteria (judgment phase)"** → `verify --manual --in audit.json`
  emits an ADJUDICATION worklist (`ADJUDICATE.todo.json` + `ADJUDICATE.md`), one item per
  residual criterion, pre-loaded with the engine's harvested evidence (every alt, link text +
  context, literal colour pairs, control labels, heading outline, ARIA state, tabindex,
  lang-of-parts); the AI agent fills each `verdict` — `C`/`NA` (with a `justification`), `NC`
  (with a groundable finding), or `manual` (with a `reason`) — then `verify --apply … --in
  audit.json` folds them back FAIL-CLOSED; read **`references/judgment.md`**.
- **"Many items to adjudicate/verify (fan the judgment out to subagents)"** →
  `orchestrate --run <dir>` emits, from the run's CURRENT worklists, one launchable
  multi-agent workflow per ready phase + the `agents/<role>.md` dispatch contracts +
  a sequential `RUNBOOK.md` — the default execution path on a subagent-capable harness;
  see **Orchestration — route by harness** below.
- **"Focus, keyboard & interaction logic (the interaction-logic part)"** → the engine marks
  focus order/visible/trap and on-focus/on-input criteria as residual risks; the AI agent reads
  the full component source and adjudicates the keyboard/focus behaviour (visible-focus and the
  other rendered criteria go to `scan`); read **`references/focus-and-logic.md`**.
- **"Put the fixes in place"** → `fix` (dry-run by default, `--write` applies the safe
  codemods, proposes the rest without inventing anything); read **`references/fix.md`**.
- **"Fix by priority, no regressions (correction phase)"** → `fix` (`--write`,
  `--iterate`) + the `prd` backlog, blocking→major→minor; read **`references/correction.md`**.
- **"Automatic repo gate (hook / CI)"** → `init --hook` writes a git pre-commit gate over
  the **strict staged snapshot** (audits the exact index blobs, auto-applies safe fixes and
  re-stages them, blocks only on judgment issues); `init --baseline`/`--ci` is the opt-in
  "block only NEW non-conformities" variant. Installed as a **Claude Code plugin**, a third
  gate runs the `review-a11y` *skill* (not just the engine) on a pending commit/push/PR —
  that one is shipped by the plugin, not by `init`. For library/SFC code, commit rendered
  **captures** (`render --setup`) and stage them so the real semantic HTML is what's
  checked (`audit --require-captures`); read **`references/automation.md`**.
- **"Show me the problems while I build the page"** → `dev --next` writes a one-line overlay
  component and `dev` starts a loopback side-car: a floating panel lists the current page's
  non-conformities, each opening its `file:line` in your editor, and `http://127.0.0.1:4111`
  accumulates the per-page grid as you browse. Renders nothing outside development; read
  **`references/devtools.md`**.
- **"Check a page during our E2E tests"** → `render --e2e` writes Playwright/Cypress fixtures
  that audit the page **as your test left it** (logged in, form filled, modal open) — state a
  separate `scan` run does not have — and persist each checked page as a snapshot. `failOn`
  gates the test; `failOn: false` records without failing, which is how you adopt it on an
  existing backlog; read **`references/e2e.md`**.
- **"Audit the real PAGE, not the component"** → a **page snapshot**
  (`.ultra11y/pages/<id>/`) is the whole rendered document plus the browser-only signals
  (computed styles, boxes, a11y tree, screenshot), ingested by `audit` automatically. Because
  it is a FULL document, the page-scoped rules run on it — that is where RGAA 8.3 (lang),
  8.5/8.6 (title) and 12.6 become decidable at all; read **`references/pages.md`**.
- **"Decide the rendering criteria without a browser in CI"** → once a page snapshot exists,
  the **rendered tier** runs inside the ordinary `audit`: computed-style contrast
  (RGAA 3.2/10.5), screenshot-measured contrast for text over a gradient/image (the CSSOM
  blind spot axe-core shares), and colour-only link identification (**RGAA 10.6**, previously
  undecidable). Each leaves the criterion `manual` when it cannot measure — never a guess;
  read **`references/pages.md`**.
- **"Give me the RGAA grid, page by page"** → `pages --in audits/audit-latest.json --standard
  rgaa` (also embedded in `report`): one row per criterion, one column per page, rebuilt from
  the committed audit.json alone. Two rules hold: a finding is attributed to a page only when
  something SAYS so (else it is reported as unattributed, never spread), and `C` by silence is
  earned only by a page whose real DOM was audited — a source-only page keeps its undecided
  criteria « à évaluer »; read **`references/pages.md`**.
- **"I want a report PER PAGE, not a matrix"** → `pages --in audits/audit-latest.json
  --standard rgaa --format report --split page --out audits/pages`: one dossier per page —
  identity, its screenshot, its rate, EVERY criterion of the standard with its status on that
  page, then each non-conformity as the ordinary auditor block. Nothing is re-decided (the
  same projection as the grid) and no format is invented (the same auditor block as the
  report), so a page sheet and the compliance report cannot disagree. `check` gates it against
  invented criteria like any other report; read **`references/pages.md`**.
- **"Which pages should I even audit?"** → `pages discover --crawl http://localhost:3000
  --write` (or `--sitemap <url>`) writes the `sample.pages` block for you, taking each page's
  name from its served `<title>` and NEVER overwriting the auth/storageState/notes already
  declared. Then `sample check` lints the coverage and `scan --sample` scans and snapshots it.
  A client-rendered SPA exposes no routes in its served HTML — use a sitemap there; read
  **`references/dynamic.md`**.
- **"Audit these URLs page by page, in CI"** → the shipped Action takes `urls`, `sitemap`,
  `crawl` or `sample`, snapshots every page it visits, writes the per-page dossiers into its
  artifact and adds a per-page scoreboard to the job summary and the PR comment; read
  **`references/ci.md`**.
- **"Nobody is here to rule on the judgment criteria"** → `judge --in audits/audit-latest.json
  --standard rgaa [--apply]` adjudicates them with a model, for a run with no coding agent in
  the loop (CI, the extension, an E2E run). It is a CALLER, not a second judge: same worklist,
  same evidence, same prompt, and the verdicts pass the same fail-closed gate yours do. The
  only command that takes an API key — inside an agent, use `verify --manual` instead and rule
  yourself; read **`references/judgment.md`**.
- **"Show the findings ON the pull request, not just a red job"** → `--format sarif` (upload
  to code scanning → inline annotations at the right file:line) or `--format github`
  (`::error::` workflow commands + a `$GITHUB_STEP_SUMMARY` table) — from `report
  --standard rgaa` when you want the pack's criteria rather than WCAG's; read
  **`references/ci.md`**.
- **"Make this code accessible / review it"** → audit the snippet
  (`audit - < component.html`) native-first; read **`references/authoring.md`** and
  **`references/forbidden-patterns.md`**.
- **"What does criterion X mean"** → `criteria` (e.g. `criteria 1.4.3`, or
  `criteria --standard rgaa 8.3`); see **`references/criteria.md`**.
- **"How trustworthy is a given check / what does the engine NOT catch"** → the engine is
  scored against the **W3C ACT-Rules test corpus** (~1 100 third-party examples): which
  checks are consistent, where recall is partial, which deviations are deliberate, and
  which statically-decidable rules are still missing — read **`references/act.md`**. Use it
  to calibrate how much of a criterion the engine really settles before you adjudicate.
- **"Country standard (RGAA, Section 508, EN 301 549)"** → `--standard <pack>` on
  `report`/`prd`/`criteria`/`check`/`verify`; see **`references/standards.md`** and
  **`references/methodology.md`**. **For a country-standard audit, PROPOSE the scan by
  default**: such an audit is normatively defined over a declared page **sample**, and an
  un-scanned `--standard rgaa` report is marked **partial** — say so rather than implying
  full coverage. The sample workflow (`sample check`, `scan --sample`, `--merge`) is in
  **`references/audit.md`**.
- **"High-assurance audit"** → `verify --report … --semantic`; see **`references/verify.md`**.
- **"Check contrast / rendering (dynamic tier)"** → `scan <url> --merge …` runs axe-core in a
  headless browser and, on the local runtime, probes focus visibility, 200% zoom, text
  spacing and content-on-hover, with bounded stateful interactions and authenticated pages;
  read **`references/dynamic.md`**.

## Orchestration — route by harness

The judgment phases fan out: `ADJUDICATE.todo.json` (one item per residual criterion) and
`VERIFY.todo.json` (one entry per NC claim) are independent per-item worklists, and
`orchestrate --run <dir>` emits a launchable workflow, per-role dispatch contracts and a
sequential RUNBOOK from whichever worklists currently exist. Fan-out is an optimization,
never a requirement: the gates are harness-independent, every phase has a sequential
fallback with identical artifacts, and the fail-closed `verify --apply` fold always stays
with you. Read **`references/orchestration.md`** for the routing table and the rules.

## Command cheat sheet

The full surface is in `--help`; these are the lines you reach for.

```
node scripts/ultra11y.mjs audit "src/**/*.tsx" --graph --out audits --json   # the default audit (AST + cross-file, persisted)
node scripts/ultra11y.mjs audit - < component.html                           # a snippet via stdin
node scripts/ultra11y.mjs audit --changed --json                             # only the git diff (large repo)
node scripts/ultra11y.mjs audit --staged --fail-on blocking                  # gate EXACTLY the staged snapshot (pre-commit)
node scripts/ultra11y.mjs audit "dist/**/*.html"                             # the RENDERED HTML (reliable for DSFR/MUI…)
node scripts/ultra11y.mjs render --setup                                     # install the capture harvester (tests → .ultra11y/captures)
node scripts/ultra11y.mjs audit --require-captures                           # gate the components with no rendered capture
node scripts/ultra11y.mjs scan http://localhost:3000 --runtime local --cwd . --merge audits/audit-latest.json
node scripts/ultra11y.mjs verify --report audits/wcag-YYYY-MM-DD.md --in audits/audit-latest.json --manual --out audits
node scripts/ultra11y.mjs verify --apply audits/ADJUDICATE.todo.json --in audits/audit-latest.json --out audits
node scripts/ultra11y.mjs orchestrate --run audits                           # fan the judgment phases out (--eco for the sequential path)
node scripts/ultra11y.mjs report --in audits/audit-latest.json --out audits  # → audits/wcag-YYYY-MM-DD.md
node scripts/ultra11y.mjs prd     --in audits/audit-latest.json              # the same auditor block as a backlog
node scripts/ultra11y.mjs tickets --in audits/audit-latest.json --dry-run    # file it: GitHub/GitLab/Jira
node scripts/ultra11y.mjs check  --report audits/wcag-YYYY-MM-DD.md          # integrity gate
node scripts/ultra11y.mjs criteria 1.4.3                                     # one success criterion (--list for all)
node scripts/ultra11y.mjs fix "src/**/*.html" --write --iterate               # apply the safe codemods to a fixpoint
node scripts/ultra11y.mjs init --hook                                        # pre-commit gate (--baseline for the regression variant)
node scripts/ultra11y.mjs pack check ./packs/section508.json                  # gate an (AI-)authored standards pack
```
Add `--standard rgaa` to `report`/`prd`/`criteria`/`check`/`verify` for a country standard,
`--pack ./pack.json` to load one at runtime, and `--json` anywhere for machine output.
`--lang` follows the conversation (pass it explicitly — Core rule 5).

## The loop: audit → render → judge → fix → re-audit

To converge on conformance (not a single pass), chain the steps, letting the agent
drive the judgment and content stages:

1. **Audit** the source (`audit … --graph`) for a first map; on library-rendered code,
   **audit the render** (`render` → build/SSR → `audit`) for reliable verdicts (otherwise
   the scope-risk note reminds you).
2. **Adjudicate & refute** with `verify`, two worklists. (a) `verify --manual --in audit.json`
   emits `ADJUDICATE.todo.json` — one item per residual *judgment* criterion, pre-loaded with the
   engine's harvested evidence — which the AI agent rules on (`C`/`NC`/`NA`, or `manual` with a
   `reason` when it truly `needs-rendered-dom`), each verdict carrying a `justification` or a
   groundable finding; `verify --apply … --in audit.json` folds them back FAIL-CLOSED (agent NCs
   become real `agent:<sc>` findings that re-render in §2). (b) `verify --report … [--semantic]`
   builds `VERIFY.todo.json` to **refute any `preliminary`/SFC/library-source finding** the
   rendered DOM disproves (verdicts `supported`/`partial`/`refuted`/`unsupported`);
   `verify --apply` drops the refuted/unsupported ones (the anti-hallucination gate). This
   includes **focus & interaction logic** (read the full component source: keyboard
   operability, focus order/visibility, traps, on-focus/on-input changes; see
   `references/focus-and-logic.md`) and the per-rule traps in `references/false-positives.md`.
   Both worklists fan out (`orchestrate --run <dir> --phase adjudicate|verify-report` —
   see **Orchestration — route by harness**); the `--apply` fold always stays with you.
3. **Fix** by priority: `fix --write --iterate` for the mechanical part (anti-regression
   gate), then hand-apply the judgment/content fixes (alt, labels, structure) guided by
   `references/correction.md`.
4. **Re-audit** (on the render where relevant) and repeat.
5. **Deliver the auditor block.** `report` (compliance doc: synthesis + one auditor
   conformance block — theme/criterion/test/WCAG+level/finding/expected/verification —
   per NC criterion) and `prd` (the same blocks as an actionable backlog; `tickets`
   filing one GitHub issue per criterion with that identical block) are two views of the
   ONE building block, in the language of this conversation (pass `--lang` explicitly —
   Core rule 5).

6. **Hand the change over to `review-a11y`, in a subagent.** Once the deliverable is out,
   the code you just fixed still has to be reviewed as a *change*, and that is the other
   skill's job — see **Handing over to `review-a11y`** below.

**Stop** when `check` and `verify --apply` are green again and only explicitly-named
residual risks remain. (To automate the outer cadence, the harness `/loop` command can
re-run this cycle.)

## Handing over to `review-a11y`

This skill does the analysis end to end: audit, render, adjudicate, fix, re-audit, deliver.
When it has produced fixes, **dispatch `review-a11y` on the code under change as a subagent**,
and report what it returns.

```
Agent(subagent_type: "general-purpose", prompt: "Use the review-a11y skill on the working diff. Return its report verbatim.")
```

Two skills, two scopes, and the split is not cosmetic:

| | scope | asks |
|---|---|---|
| `ultra11y` (this one) | the repository, a page sample, a standard | *does this product conform, and where is the proof?* |
| `review-a11y` | exactly the code under change (staged, diff, or branch vs merge-base) | *is this change safe to merge?* |

**Why a subagent rather than an inline pass.** A full audit fills a context with a 3 MB
engine's output, dozens of reference files and a page sample; a review has to read the diff
closely with none of that in the way. Handing it over keeps the review's judgment
independent of the audit that just ran — the same reason `verify` refutes findings instead
of trusting them. If the harness has no subagent tool, invoke `review-a11y` directly: the
routing table in `references/orchestration.md` names the fallbacks, and the review is
identical either way.

**Do not paraphrase its verdict.** It returns a severity-ranked review with `file:line` and a
one-line verdict; that is the deliverable, not a summary of it.

## Combining engine, judgment and residual risk

`audit` classes each criterion `C`/`NC`/`NA` for the static subset and `manual` for the rest,
each carrying an `automatability` class that says WHY it is manual and how to close it:
**`static`** (the engine decides), **`needs-rendering`** (`scan`), **`judgment`** (you, from
the harvested evidence and the decision protocol). Engine `NC`s are confirmed candidates
with a cited `file:line`; a `preliminary: true` finding (SFC/library source) is provisional —
confirm it against the render or refute it. A criterion is never silently marked conforming:
the report is complete only when every applicable criterion is a justified `C`/`NC`/`NA` and
every residual risk is named. See **`references/methodology.md`**.

**Advisory recommendations are a distinct class.** A good-practice signal with NO failing
normative test renders under a dedicated section and can never flip a criterion to `NC` nor
enter `conformancePct`. An `NC` needs a `normativeRef`; a recommendation does not. Do not
promote one to the other — see **`references/false-positives.md`**.

## Do not

- Invent a non-conformity the engine did not find and you cannot see (contrast on
  **inline literal colours** is decided statically; **computed** contrast — external CSS,
  variables — goes through `scan` (Docker tier) or is verified at render before being declared).
- Add ARIA that duplicates native semantics.
- Mark a rendering/judgment criterion "conforming" without a recorded, gated justification
  (agent adjudication via `verify --manual`, or `scan` evidence).
- Hand-edit `references/criteria.md` (generated from the WCAG dataset via `criteria --generate`).

## Scope

Static engine: offline, deterministic, install-free; inputs are HTML + JSX/TSX (real AST,
cross-file analysis via `--graph`) + stdin. The **rendering** criteria (computed contrast,
reflow) are covered by the optional `scan` tier (axe-core, Docker **or** `--runtime local`).
The local runtime additionally **probes** focus visibility (2.4.7), 200% text zoom (1.4.4),
text spacing (1.4.12) and content-on-hover (1.4.13) — observed in the rendered page, raised
as NC only when the failure is seen (a clean probe leaves the SC `manual`, never silently
conforming); reading order and alt relevance are the AI agent's judgment, adjudicated from the
harvested evidence and gated (`verify --manual`).
Data: WCAG 2.2 ©
W3C (W3C Document License); the RGAA pack is RGAA 4.1.2 © DINUM, Licence Ouverte / Etalab
2.0 (see `NOTICE`).

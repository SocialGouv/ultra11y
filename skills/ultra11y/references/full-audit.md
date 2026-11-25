# The full audit — one route on every harness

Use this route whenever the user asks for a full or detailed audit, a compliance or
conformance report, or an RGAA audit — on Claude Code, Codex, OpenCode or any other harness.
Every step is a plain engine CLI call, so the same request produces the same deliverables
everywhere. The active agent session is the auditor: it reads the criterion briefs and writes
the verdicts itself.

`node scripts/ultra11y.mjs` below is the engine that ships inside this skill (see
**Running the engine** in `SKILL.md` for its path on each harness); `npx -y ultra11y` is the
same engine where no skill directory resolves.

`references/audit.md` is the quick path — a static audit, a report and the integrity `check`,
with no ledger, no refutation, no per-page dossiers and no completeness gate. Use it only for a
first look; never hand its output over as a conformance deliverable.

The completion criterion is a **defensible deliverable**, not merely a clean static scan:

- every declared page was captured, or the missing page is named;
- every discovered route is captured, scanned, or listed as not reached in the annex;
- every criterion on every captured page is `C`, `NC`, `NA`, or explicitly undecidable;
- every `NC` has a resolvable occurrence and every `C`/`NA` has grounded justification;
- the conformance report and per-page dossiers pass `check`;
- the user receives the paths to the Markdown report, HTML entry point, printable single file,
  page index and machine-readable grid.

## 1. Establish the scope

Read `.ultra11yrc.json` when present. Confirm the language and page sample (the standard is
always RGAA 4.1.2). Prefer `sample check` plus `scan --sample`; otherwise crawl without a hidden
cap (`--max 0`). A source-only report is partial and must say so. The `sample`
block of `.ultra11yrc.json` and the PDF document checks are described in `references/audit.md`.

**Start from the application's routes, not only the sample.** Record the route inventory
(`.ultra11y/routes.json`) from every source the project has: the sitemap, a crawl, and the
pages the E2E suite already captured.

```sh
node scripts/ultra11y.mjs pages discover --sitemap <url> --routes-only   # or --crawl <url> --max 0
node scripts/ultra11y.mjs pages discover --from-snapshots --routes-only  # routes the E2E run reached
```

`--routes-only` leaves the chosen RGAA sample untouched; `--write` merges the routes into the
sample as well.

**Then build the RGAA sample from the proposal, never by hand.** Two runs that hand-pick pages
audit different pages, and their verdicts cannot be compared:

```sh
node scripts/ultra11y.mjs pages discover --sitemap <url> --propose --write   # or --crawl <url> / --from-snapshots
node scripts/ultra11y.mjs sample check --standard rgaa
```

The proposal is deterministic: the required kinds (accueil, contact, mentions légales,
accessibilité, plan du site, aide, authentification, recherche, documents) matched by keyword
on the sorted URLs and titles, the search page with the fixed query `information`
(`--search-query` to change it), then one page per template cluster — URL pattern with ids,
slugs and dates normalized, or the DOM skeleton when a snapshot exists — largest first, ties
broken by URL, bounded by `--sample-size` (default 20). Each pick records its reason in
`notes`; a kind with no page is written to `sample.absent` with the reason. **Keep it.** Edit
it only with a recorded reason: a page you add carries its `notes`, a kind you remove gets a
`sample.absent` entry. `sample check` reports a kind dropped without a reason as missing.

Once an inventory exists, every `audit` and `scan --merge` lists each route in
the annex (section F): captured by the E2E tests, scanned, source code only, or not reached.
None is left out. A client-rendered SPA exposes no links in its served HTML, so give it a
sitemap or let its E2E captures supply the routes.

## 2. Audit source and rendered pages

Use every render source — each sees what the others cannot. **Playwright comes first** for
real pages: when the project has Playwright tests, wire `ultra11y/playwright` into them
(`checkA11y`, or `sweepSample` for the sample, `references/e2e.md`), or reuse the
`.ultra11y/pages` captures they already wrote, before you fall back on the crawler. Those
captures carry the state the tests built (a session, a filled form, an open dialog), and
`scan --all-routes` never rescans a route they hold.

- **Pages**: E2E captures (`.ultra11y/pages/`, from `ultra11y/playwright`/`ultra11y/cypress`)
  — run the E2E suite to refresh them — then the browser pass on the sample and the rest of
  the inventory (`scan --sample --all-routes`, below).
- **Components**: ultra11y's own render engine. It finds the exported components, the
  framework pages and the Storybook stories, renders each with the project's own
  `react-dom/server` in a throwaway harness, and writes `.ultra11y/captures/` plus the
  manifest `.ultra11y/render.json` (`references/rendered.md`). It never reads or runs the
  project's tests or snapshots.

```sh
node scripts/ultra11y.mjs render .        # components, pages and stories → .ultra11y/captures
```

Do not read the project's test files, `__snapshots__` or inline snapshots to find markup: they
hold what a test author wrote, sometimes broken on purpose, and go stale. Run `render` before
`audit`: the annex (section G) then lists every unit the engine rendered, skipped (with the
reason: missing provider, props, browser-only API, data fetching, transpile error, timeout) or
did not attempt. A component that takes props is rendered through its stories, or not at all:
cover the ones the annex lists with a story or the page that shows them. Component renders
have no computed style (`styles="none"`): they decide markup criteria on components, never
page-level or rendering criteria. Name in the coverage annex any source you could not run, and
why.

```sh
node scripts/ultra11y.mjs audit <paths> --graph --standard <standard> --lang <lang> --out audits --json
node scripts/ultra11y.mjs scan --sample --all-routes --cwd . \
  --standard <standard> --merge audits/audit-latest.json --out audits
```

`--all-routes` scans the sample, then every inventory route the sample does not hold, bounded
by `--max-routes` (default 50). A route the bound leaves out is listed as not reached, with
the reason. Use `--crawl <url> --max 0` instead when the project has neither a sample nor an
inventory. A rendering criterion stays undecidable when no browser measurement exists; source
inspection does not replace the scan.

**Then write and replay the journeys.** The scan never logs in, submits or opens a funnel. Read
the application (its routes, forms and interactive components) and write in
`.ultra11y/journeys/` the journeys that matter: authentication, the main form including an
invalid submit, search, every modal, menu or disclosure, and the multi-step funnel if there is
one. Format and examples are in `references/journeys.md`. Replay them with the keyboard alone:

```sh
node scripts/ultra11y.mjs journey run --all --keyboard --base-url <url> \
  --standard <standard> --merge audits/audit-latest.json --out audits
```

Each step becomes an audited page state. The replay also records keyboard reachability and
traps, focus into and out of dialogs, errors not tied to their field and unannounced status
messages. A failing step stops its journey with the reason, and annex H lists every step.
Fix the journey and run it again. Do not drop it.

`scan` and `ultra11y/playwright` run the same axe: ultra11y's own pinned `axe-core` and rule
tags, whatever version the project installs. The annex names the version that ran. If it says
« copie du projet audité », ultra11y's own copy could not be resolved; reinstall ultra11y with
its dependencies before you publish.

**A clean scan never concludes `C` on a rendering criterion**: 3.2, 3.3, 10.4,
10.11, 10.12, 12.9 and the other rendering criteria carry only *candidate* scan rules, so the
scan can raise their non-conformities but a clean run leaves them « à évaluer » — they come to
you in step 3, and `check --require-decided` counts 0 « mesure (scan) » for them. That is
expected, not a failed scan.

If the scan cannot start a browser, it falls back on Playwright's full Chromium build and then
on an installed Google Chrome; the error, when none starts, names the Playwright install that
was resolved and the command that installs its browser.

## 3. Adjudicate

Generate the judgment worklist with `verify --manual`, then rule on it in one of two ways —
the verdicts pass the same fail-closed fold whichever you pick:

- **adjudicate directly** in this session (the default for an interactive request);
- **fan out to subagents** when the worklist is large — `orchestrate --run audits --phase
  adjudicate` emits the batches and the per-role contracts, and any harness with subagents
  can dispatch them (Claude Code's Agent or Workflow tool, Codex subagents, OpenCode's Task
  tool); see `references/orchestration.md`. Subagents return verdicts; you fold them.

When nobody is in the loop (CI), the caller is iterion's `rgaa-audit` bot, which rules the same
worklist through the same gate; see `references/ci.md`.

Ruling directly: read each small
`audits/adjudicate/<criterion>.md` brief, decide against its official tests, fill the verdicts
in **`audits/ADJUDICATE.todo.json`** — the one file to write in a session with a shell (its
items carry the evidence and the `citations[]` slots; `ADJUDICATE.verdicts.json` is the
evidence-free twin for an adjudicator without a shell, and `verify --apply` accepts either, but
fill one, not both) — then fold it with `verify --apply … --ledger`. The ledger records every
accepted verdict, so the trial in step 4 can repair it and a later run can replay it. However
the verdicts were produced, the final fold stays in the parent session.

```sh
node scripts/ultra11y.mjs report --in audits/audit-latest.json \
  --standard <standard> --lang <lang> --out audits
node scripts/ultra11y.mjs verify --report audits/<standard>-<date>.md \
  --in audits/audit-latest.json --manual --standard <standard> --out audits
node scripts/ultra11y.mjs verify --apply audits/ADJUDICATE.todo.json \
  --in audits/audit-latest.json --standard <standard> --out audits --ledger
```

A rendering criterion whose brief says no evidence was harvested cannot be `C` (the fold
refuses it): record `manual` with reason `undecidable` and a justification saying what you
checked, and name it in the `--allow-undecided` file of step 6.

The first report is a draft, not the final deliverable. Follow `references/judgment.md` for
the verdict schema (including the `citations[]` shape) and fail-closed fold.

## 4. Challenge the claims

Render the report, generate the adversarial `VERIFY.todo.json`, adjudicate every claim, apply
the verdicts with `--prune --ledger`, then render again. This trial covers both alleged
non-conformities and agent-declared conformities **and** « non applicable » — on a small site
that is easily 70+ claims. Rule on the trial the same two ways as step 3: directly, or by
fanning out (`orchestrate --run audits --phase verify-report`) — the refuter has to open the
cited files.

```sh
node scripts/ultra11y.mjs report --in audits/audit-latest.json \
  --standard <standard> --lang <lang> --out audits
node scripts/ultra11y.mjs verify --report audits/<standard>-<date>.md \
  --in audits/audit-latest.json --standard <standard> --semantic --max-verify 0 --out audits
node scripts/ultra11y.mjs verify --apply audits/VERIFY.todo.json \
  --report audits/<standard>-<date>.md --in audits/audit-latest.json \
  --standard <standard> --out audits --prune --ledger
```

`--max-verify 0` puts every claim in one worklist. Without it the non-conformities are capped at
40 (the conformity half is never capped unless `--max-verify` is set); whatever a cap leaves
out is named on stderr, fails the apply as « missing », and under `--prune` a conformity that
was never tried goes back to « à évaluer » — so a capped trial costs you verdicts, it never
lets an untried claim through. If no ledger exists yet, `--prune --ledger` creates one and says
so.

`VERIFY.todo.json` is a bare JSON array of items (`n`, `criteriaId`, `kind`, `file`, `line`,
`selector`, `claim`, `verdict`, `note`, and `citations[]` on a conformity), whereas
`ADJUDICATE.todo.json` is an object with its items under `items` — fill `verdict` and `note` in
place in each entry.

## 5. Publish the detailed deliverable

```sh
node scripts/ultra11y.mjs report --in audits/audit-latest.json \
  --standard <standard> --lang <lang> --html --evidence --out audits
node scripts/ultra11y.mjs pages --in audits/audit-latest.json \
  --standard <standard> --lang <lang> --json --out audits
node scripts/ultra11y.mjs pages --in audits/audit-latest.json \
  --standard <standard> --lang <lang> --format report --split page \
  --html --evidence --out audits/pages
```

This produces the dated Markdown conformance report, `audits/index.html`, the printable
single-file HTML report, `audits/pages.json`, and the navigable per-page Markdown/HTML dossiers
with screenshots and annotated evidence when snapshots support them. It is a conformance
deliverable; generate a PRD, remediation backlog or tickets only when the user asks for fixes.

## 6. Gate and hand over

```sh
node scripts/ultra11y.mjs check --report audits/<standard>-<date>.md \
  --in audits/audit-latest.json --standard <standard>
node scripts/ultra11y.mjs check --in audits/audit-latest.json \
  --standard <standard> --require-rendered
node scripts/ultra11y.mjs check --in audits/audit-latest.json \
  --standard <standard> --require-decided=pages
node scripts/ultra11y.mjs check --report audits/pages/index.md \
  --standard <standard>
```

Append `--allow-undecided .ultra11y/undecidable-<standard>.json` to the completeness gate only
when the project records named exceptions with reasons. Report the scope, page count, criterion
count, provenance tally, remaining named exceptions and every deliverable path. A failed gate
is part of the result and must not be summarized as a complete report.

## The reference run

`tests/full-audit.e2e.test.ts` in the ultra11y repository is this route, run as written: every
command above, in this order, on `tests/fixtures/full-audit-app` (eleven served routes, a React
component directory, downloadable PDFs, two journeys replayed with `journey run --all
--keyboard --merge` — a menu disclosure and the contact form sent with an invalid address — and
a unit test with a snapshot and a Playwright spec that must never be read). The only thing it does not run is a model: a committed script fills
`ADJUDICATE.todo.json` and `VERIFY.todo.json`, copying every citation from the evidence the
engine harvested, so the run costs nothing and gives the same deliverable every time. It
asserts that every deliverable exists, that every `check` above passes (with an
`--allow-undecided` file naming what a human still has to rule), that the annex lists every
route, rendered component and journey step (sections F, G and H), that each journey state is a
page of the grid carrying its own findings, that pages with different findings get different rates, and that
no test file reaches the output. CI runs it in the `browser-tier` job. When this page and that
test disagree, one of them is wrong: change both together.

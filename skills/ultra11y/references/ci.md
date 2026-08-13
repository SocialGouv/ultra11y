# CI — the shipped action, SARIF, annotations, job summary

## The action

The whole surface in one step. The engine ships **inside** the action (one bundled `.mjs`,
zero dependencies), so there is nothing to install, no `setup-node`, and no version that can
drift from the action's own.

```yaml
permissions:
  contents: read
  security-events: write   # SARIF upload; without it the annotations still report
  pull-requests: write     # only if you set `comment: 'true'`

steps:
  - uses: actions/checkout@v4
    with: { fetch-depth: 0 }        # the diff gate needs the base ref
  - uses: maxgfr/ultra11y@v3      # or pin the exact version, as `init --ci` does
    with:
      since: auto                   # the PR's base branch
      standard: rgaa
      fail-on: blocking
      baseline: audits/baseline.json
      comment: 'true'
```

Page by page, with a real browser, in the same step:

```yaml
  - uses: maxgfr/ultra11y@v3
    with:
      standard: rgaa
      start: npm run start
      wait-on: http://localhost:3000
      urls: http://localhost:3000 http://localhost:3000/contact
      # …or `sample: 'true'` to scan the sample declared in .ultra11yrc.json
```

`ultra11y init --ci` writes a workflow using it, **pinned to the exact engine version that
generated the file** (`@v<that version>`) so a CI run stays reproducible. `@v<major>` — `@v3`
today — is a moving alias the release workflow repoints at each release, for teams who would
rather take fixes automatically. It moves **within** a major only: when a breaking change cuts
the next one, the old alias freezes where it is, so a pipeline pinned to it keeps working and
stops receiving features. Never `@main`: it would change under you with no version to blame.

**Order matters, and it is deliberate**: the audit runs first, then SARIF, annotations, the
summary, the comment and the report — and the **gate runs last**. A failing audit has
therefore already produced every surface, so a red job is never a dead end. `fail-on: ''`
turns the gate off entirely (report-only), which is how you adopt this on an existing backlog;
`baseline` is the other way — only NEW non-conformities can fail.

The SARIF upload is `continue-on-error`: a repository without Advanced Security keeps its
annotations instead of failing. Each upload carries `category: ultra11y-<standard>`, so a WCAG
run and an RGAA run coexist rather than overwriting each other. The Markdown report goes
through `check` before being uploaded, so CI cannot publish a report citing an invented
criterion.

## Adjudicating the judgment criteria in CI (`adjudicate`)

Of the 55 WCAG 2.2 AA criteria the engine decides a handful; **38 are judgment calls**, and
under RGAA **81 of 106** can only ever derive `manual`. Inside a coding agent the agent rules
on them. In CI nobody does, so they stay « à évaluer » and the published conformance rate is
partial by construction. `adjudicate` closes that — opt-in, in two modes.

```yaml
env:
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}   # the job's env, never an input
steps:
  - uses: maxgfr/ultra11y@v3
    with:
      standard: rgaa
      adjudicate: api          # or `agent`
```

| input | default | |
|---|---|---|
| `adjudicate` | `none` | `api` · `agent` · `none` |
| `adjudicate-model` | *(empty)* | model id for `api`; else `$ULTRA11Y_LLM_MODEL`, else the engine default |
| `gate-adjudicated` | `false` | let a model-ruled NC fail the job |

**`api`** sends the worklist to the Messages API in batches of 8 and folds the verdicts back.
**`agent`** emits the worklist plus `orchestrate --eco`'s runbook and hands them to a
`claude-code-action` run, then folds the same way. Both end in the **same fail-closed gate** an
agent's verdicts pass through, so neither can assert a conformance the engine refuses.

The difference between them is **evidence, not trust**. `judge` rules from the harvested
evidence alone — capped at 30 items per criterion, snippets truncated — while the agent can
open the cited files and read around them, which is what *link purpose **in context*** actually
asks for. Expect the API mode to answer `manual` more often; that is it being honest, not
broken. The metric that separates them is the count of criteria left to assess.

**Both modes read `ANTHROPIC_API_KEY` from the job environment, never from an input** — a
composite action's steps inherit it, and a secret that never travels through an input is one
fewer secret to leak into a log. When the key is absent the tier **skips itself**: the job stays
green, the report is still written, and the criteria stay « à évaluer ». That is not an edge
case — it is precisely what a **fork's pull request** looks like, where secrets are never
exposed. An adjudication that fails mid-flight (a rate-limited batch refuses the whole fold) is
absorbed the same way, because losing the verdicts must never cost you the audit.

**Cost is per run and does not amortise.** Roughly $0.20 for a WCAG run and $0.50 for RGAA at
Sonnet pricing — the worklist is re-sent whole each time and no batch is large enough to earn
prompt caching. On a busy repository that is real money per push; this belongs on the default
branch or a schedule far more often than on every PR.

**`gate-adjudicated` trades reproducibility for reach.** By default the gate re-audits the
**source**, so the red/green is a pure function of the commit whatever a model said about it.
Turn it on and the gate evaluates the adjudicated audit instead (`audit --in`), letting a
model-ruled non-conformity fail the job — and accepting that two runs on the same commit may
now disagree. Default off, deliberately.

```sh
# The same re-gate, outside the action:
node scripts/ultra11y.mjs audit --in audits/audit-latest.json --fail-on blocking
```

`--in` re-gates an audit that already exists rather than computing one, which is the only way
to gate on verdicts a second detection pass would not see. It refuses every flag that would
change *what* is audited (`--since`, `--baseline`, paths…): a gate that silently dropped your
scoping would be a gate nobody could trust.

# The `--format` renderings

A gate tells a developer *that* the build failed; it does not put the non-conformity **on the
line of code that caused it**. These two renderings do — they are what the action posts, and
you can run them yourself outside it.

Nothing new is measured here. Both are projections of the same `AuditResult`.

```
node scripts/ultra11y.mjs audit  "src/**/*.tsx" --jsx --format sarif  > a11y.sarif
node scripts/ultra11y.mjs audit  "src/**/*.tsx" --jsx --format github
node scripts/ultra11y.mjs report --in audits/audit-latest.json --standard rgaa --format sarif > rgaa.sarif
```

## `--format sarif` — inline PR annotations via code scanning

SARIF 2.1.0, the format GitHub code scanning ingests. Upload it and every finding becomes an
annotation on the right file and line of the pull request, plus an entry in the Security tab.

```yaml
- run: node scripts/ultra11y.mjs audit "src/**/*.tsx" --jsx --format sarif > a11y.sarif
- uses: github/codeql-action/upload-sarif@v3
  with: { sarif_file: a11y.sarif }
```

What the projection guarantees:

- **Levels.** `bloquant → error`, `majeur → warning`, `mineur → note`. An **advisory**
  (non-normative recommendation) is **never** an `error`, whatever its severity rank — it is
  always a `note`, so a recommendation cannot fail a reviewer's build on principle.
- **Stable alert identity.** `partialFingerprints` reuses `findingId()` — the *same* identity
  the baseline gate uses — so an alert survives line drift instead of being closed and
  reopened on every edit above it.
- **Rules table.** One entry per `ruleId`, tagged `accessibility`, `wcag:<sc>` and, under
  `--standard`, `<pack>:<criterion>` (e.g. `rgaa:1.1`), with the WCAG *Understanding* page as
  `helpUri`.
- **Repo-relative URIs.** An absolute path is relativised against the working directory;
  GitHub matches alerts against the checkout and would silently drop an absolute one.
- **No invented locations.** A finding keyed to a **URL** (a `scan` result the host-anchor
  resolver could not map back to source) is emitted with **no** physical location and its URL
  in `properties.url`. Pinning it to a guessed `file:line` is exactly the class of error the
  engine exists to refuse.

## `--format github` — annotations without code scanning

Advanced Security is not available on every plan. This mode writes
`::error file=…,line=…,col=…,title=…::` workflow commands to **stdout**, which every GitHub
plan renders inline on the diff, and appends a Markdown job summary to
`$GITHUB_STEP_SUMMARY` (severity table, and the per-page synthesis once a page sample has
been scanned and merged). With no `$GITHUB_STEP_SUMMARY` set, the summary goes to stderr so a
local run still shows it.

URL-keyed findings are **skipped** for annotations — there is no repo line to point at — and
counted in the summary instead, so they are never silently dropped.

## Which command to run it from

`audit` is always WCAG-keyed: it takes **no** `--standard`, by design (a pack is a derived
view, never a second source of truth). So:

| You want | Run |
|---|---|
| WCAG-keyed CI output, one shot | `audit … --format sarif` |
| **RGAA**-keyed CI output | `audit … --out audits` then `report --in audits/audit-latest.json --standard rgaa --format sarif` |
| Only what the PR introduced | `audit --since origin/main --baseline audits/baseline.json --format sarif` |

In `--baseline` gate mode the CI rendering covers **exactly the new findings** — the subject
of the gate is the regression, not the backlog, so a PR is annotated with what it introduced
and the existing backlog stays out of the diff.

Uploading two SARIF files in one workflow (a source audit and a page scan) is supported:
each run carries a distinct `automationDetails.id` (`ultra11y/<standard>/`), so GitHub keeps
them as separate analyses instead of one overwriting the other.

## The sticky PR comment

`ULTRA11Y_PR_COMMENT=1` (what the action's `comment: 'true'` sets) posts the job summary as a
pull-request comment and **edits it in place** on every subsequent run — a CI job that appends
a fresh comment on each push turns a busy PR into a wall of stale audits. The comment is keyed
by an invisible marker that includes the standard, so a WCAG run and an RGAA run keep separate
comments instead of overwriting each other, and a human's comment is never adopted (an edit is
destructive, so the match has to be exact).

It is best-effort, like issue creation: off a pull request, or with no `gh`/no auth, it
reports `skipped` and the run carries on. A comment is never worth failing a build over. If
listing the existing comments fails (permissions, rate limit) it creates a new one — a
duplicate comment is a far smaller harm than dropping the report.

## How this repo publishes itself (npm trusted publishing)

ultra11y's own release workflow holds **no npm token**. It publishes by OIDC: the job asks
GitHub for a short-lived id-token (`permissions: id-token: write`) and exchanges it with
registry.npmjs.org for a credential scoped to this package. Nothing long-lived is stored, so
there is no secret to leak or rotate.

Two things it depends on, both easy to break silently:

- **A trusted publisher** configured on npmjs.com for the package, naming this repository and
  **this workflow file**. Rename `release.yml` and the exchange stops matching.
- **npm >= 11.5.1** on the runner. `@semantic-release/npm` only *pre-flights* the exchange;
  the publish itself is `npm publish`, and the CLI does its own OIDC handshake. Node 24 still
  ships an older 11.x, so the workflow upgrades the CLI explicitly.

The package must exist before a trusted publisher can be attached to it, so the **first**
publish is manual — `npm publish` from a logged-in shell, after `pnpm run build`. The name is
unscoped and `publishConfig.access` is set, so nothing else is needed. Every release after
that is tokenless.

If the exchange fails, `@semantic-release/npm` logs why and falls back to demanding a token —
it does not publish unauthenticated.

## Page by page in CI

The action audits the **code** and, when you point it at a served app, the **pages**. The page
list can come from three places, and none of them has to be written by hand:

```yaml
- uses: maxgfr/ultra11y@v3
  with:
    standard: rgaa
    start: npm run start
    wait-on: http://localhost:3000
    sitemap: http://localhost:3000/sitemap.xml   # …or `crawl:` …or `urls:` …or `sample: 'true'`
    crawl-max: '20'
```

Every scanned page is also **persisted as a snapshot** and folded into the audit
(`snapshot: 'false'` opts out). That is not a nicety: a page known only by its URL cannot earn
a conforming verdict — the static rules never ran against its DOM — so without it the per-page
grid is almost empty and the job reports far less than it measured.

Two surfaces come out of it:

- **The scoreboard**, in the job summary and the sticky PR comment: one row per page with its
  rate and its blocking/major/minor counts, plus a `basis` column. That column is not
  decoration — a page marked *source* has no snapshot, so its silence is not conformity.
  It appears on a clean run too, which is exactly when a reviewer wants to see *which* pages
  passed.
- **The per-page dossiers**, in the uploaded artifact (`pages-report: 'true'`, the default):
  `audits/pages/index.md` plus one sheet per page — its screenshot, every criterion of the
  standard with its status on that page, and each non-conformity as the ordinary auditor block.

A run with no page in scope is not a failure: the report step says so and the job carries on.

## What the artifact looks like when you open it

`audits/` used to hold JSON, SARIF and Markdown: everything a machine needs and nothing that
opens. `html: 'true'` and `evidence: 'true'` are on by default, so it now has a front door.

```
audits/
├── index.html                        ← the entry point: rate, synthesis, page scoreboard, links
├── ultra11y-<std>-<date>.html        ← the whole audit in ONE file, printable to PDF
├── <std>-<date>.md                   ← the Markdown report (unchanged)
├── audit-latest.json                 ← the machine-readable audit (unchanged)
├── assets/
│   ├── <page-id>.png                 ← the page screenshot
│   └── <page-id>/<hash>.png          ← one annotated crop per distinct defect on that page
└── pages/
    ├── index.md + page-<id>.md       ← the per-page dossiers (unchanged)
    └── index.html + page-<id>.html   ← the same, navigable
```

Two conventions share `assets/` and that is deliberate: `<page-id>.png` is the whole page,
`<page-id>/` holds the crops OF that page. Renaming either would break the Markdown sheets
already published by earlier versions.

**One artifact, not two.** The HTML is written into the same `audits/` the Markdown already
travels in, and the upload now fires when EITHER producer ran. A separate artifact would mean
a second name to keep unique, a second 409 to hit, and a reviewer choosing between two
downloads.

**Everything is self-contained.** No script (an artifact viewer will not run one), no external
stylesheet or font, and no `src`/`href` that leaves `audits/` — the artifact is read after
being unzipped somewhere else, so a `../..` climb is a broken image for every reader. `ci.yml`
asserts this on a real `download-artifact` round trip, because the HTML step itself degrades
to a `::warning::` and cannot catch its own regression.

### The crops

An occurrence in a sheet gains a sub-bullet showing the element, ringed:

```md
- [ ] `.ultra11y/pages/accueil/dom.html:412` (`div.card`) — <img> without an alt attribute…
  - ![Cropped capture of the img element on the accueil page, outlined](./assets/accueil/c90959b13aa2.png)
```

They are derived AT RENDER TIME from the page snapshot, never stamped on the finding: a
rectangle in pixels is a property of the image, and a stamped box goes silently wrong the
moment the audit is re-rendered against a different capture. So `evidence` needs snapshots —
`snapshot: 'true'` (the default), the E2E plugins, or `ultra11y dev`.

The mark is **not monochrome**: a white halo, a red ring and corner brackets whose *shape*
says "here". A tool that reports 1.4.1 failures cannot ship a deliverable that commits one.

When a crop cannot be drawn, the report says so per page and per criterion, with the reason —
`no-screenshot`, `below-the-fold`, `unknown-scale`, `capped`, and eight more. **An occurrence
without a picture must never read as an occurrence without a defect.** Caps are 6 per rule, 12
per page and `evidence-max` overall (200 by default), because one design-system defect
multiplied by 38 routes is one defect, not 472 pictures.

### Printing it

The single file is the deliverable an auditor hands to a client: open
`ultra11y-<std>-<date>.html`, print, *Save as PDF*. The print sheet keeps each criterion and
its evidence on one sheet rather than splitting them across a page break.

Its images travel inside it as `data:` URIs, and base64 costs a third more than the bytes it
encodes — so there is a budget (`--inline-budget`, 12 MB) and a ladder. Over budget, page
screenshots go first, then all but one crop per criterion, then the images entirely. Every
rung is written **into the document** and onto stderr. Images degrade; the non-conformities
never do.

### Publishing it as a page (optional, and it costs something)

An artifact needs a download and a login. If the report should be a URL, GitHub Pages will
serve `audits/` as-is — it is already self-contained:

```yaml
- uses: actions/upload-pages-artifact@v3
  with: { path: audits }
- uses: actions/deploy-pages@v4
```

Know the trade before you take it: **a Pages site is public**, and this one names your
non-conformities, your file paths and your routes, with screenshots. On a private repository
that is a disclosure, not a convenience. It also needs `pages: write` and `id-token: write`,
and it overwrites the previous deployment — there is no per-run history the way artifacts have
one. Left alone, the artifact is the safer default, which is why this is a recipe here and not
an input on the action.

## The action is executed in ITS OWN CI, not just parsed

`tests/action.test.ts` reads `action.yml` and gates its shape. That cannot prove the thing
works: a composite action is bash — arrays, `set -e`, quoting — and the whole file could stay
green while the action was broken for every consumer.

So `ci.yml` has an `action` job that `uses: ./` for real, twice: report-only over a
non-conforming fixture (asserting the declared outputs, the written report, and that the
per-page step DEGRADES rather than failing when nothing was scanned), then the page-by-page
path — a served two-page site, crawled, scanned, snapshotted, folded in and rendered as
per-page dossiers, asserting that each crawled page is snapshot-based and that the finding on
one page did not leak onto the clean one. Both run with `sarif: false`, so the job needs no
`security-events: write` and works on a fork's pull request.

Two traps are worth naming, because running it is what found them.

`[ cond ] && cmd` returns 1 when the condition is false, and `-e` turns that into a dead job.
A test now forbids the form in `action.yml` **and** in every CI workflow.

And **artifact names are unique per workflow RUN, not per step**. Using the action twice in
one job — the code diff, then the served pages — died on a `409 Conflict`, with the report
written and never uploaded. Pass `artifact-name` on each invocation:

```yaml
- uses: maxgfr/ultra11y@v3
  with: { since: auto, artifact-name: a11y-code }
- uses: maxgfr/ultra11y@v3
  with: { crawl: http://localhost:3000, artifact-name: a11y-pages }
```

Left unset it keeps the historical `ultra11y-<standard>`, so a single-invocation workflow is
unaffected.


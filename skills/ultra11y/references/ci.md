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
  - uses: maxgfr/ultra11y@v5      # or pin the exact version, as `init --ci` does
    with:
      since: auto                   # the PR's base branch
      standard: rgaa
      fail-on: blocking
      baseline: audits/baseline.json
      comment: 'true'
```

Page by page, with a real browser, in the same step:

```yaml
  - uses: maxgfr/ultra11y@v5
    with:
      standard: rgaa
      start: npm run start
      wait-on: http://localhost:3000
      urls: http://localhost:3000 http://localhost:3000/contact
      # …or `sample: 'true'` to scan the sample declared in .ultra11yrc.json
      comment: 'true'
      comment-kind: pages           # the page-by-page grid, under its own sticky marker
```

For an exhaustive certification run whose output must stay small, use the compact profile:

```yaml
  - uses: maxgfr/ultra11y@v5
    with:
      standard: rgaa
      crawl: http://localhost:3000
      crawl-max: '0'
      ledger: 'true'
      require-rendered: 'true'
      require-decided: pages
      undecidable-file: .ultra11y/undecidable-rgaa.json
      report: 'false'
      html: 'false'
      evidence: 'false'
      pages-report: compact
```

This still gates every criterion on every captured page. Its visible summary lists the complete
page-by-page grid, while its artifact contains only `pages-status.md`, `pages.json`,
`audit-latest.json` and the portable verdict ledger. Use the detailed Claude Code route when a
human-readable conformance dossier is the deliverable; CI's job here is exhaustive evidence,
fast feedback and a clean handoff.

A page sweep is usually a **second job** — it needs a built app, a database, a browser — and
it can comment alongside the code gate above without either overwriting the other, because
each kind has its own marker. Give the two jobs distinct `artifact-name`s too: artifact names
must be unique within a run.

`ultra11y init --ci` writes a workflow using it, **pinned to the exact engine version that
generated the file** (`@v<that version>`) so a CI run stays reproducible. `@v<major>` — `@v5`
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

## The verdict ledger (`ledger`) — a complete grid in CI, with no model

Of the 55 WCAG 2.2 AA criteria the engine decides a handful; **38 are judgment calls**, and
under RGAA 92 criteria carry judgment tests and **103 of 106** still need adjudication to earn C. Inside a coding agent the agent rules on
them. In CI nobody does — so before the ledger, a CI grid was partial by construction and the
only way to close it was to pay for an agent pass on every run.

A **ledger** is a file of verdicts committed to the audited repository
(`.ultra11y/verdicts/<standard>.json`), each carrying its justification, its citations, and a
FINGERPRINT of the evidence it was ruled against:

```yaml
- uses: maxgfr/ultra11y@v5
  with:
    standard: rgaa
    ledger: 'true'          # or an explicit path
```

Replaying it is **a re-verification, not a cache hit**. Every stored verdict is rebuilt into an
ordinary adjudication over the evidence re-derived from the audit in front of it, and folded
through the same `applyAdjudication` — same coverage checks in both directions, same citation
matching against the criterion's own anchors, same content-level re-grounding. A verdict nobody
can prove is refused in CI exactly as it would be in a session.

Three properties are worth knowing:

- **A stale verdict is dropped, never carried.** When the code under a criterion changes, the
  evidence changes with it, the fingerprint stops matching, and the criterion returns to « à
  évaluer » saying so — with the date it was recorded and both evidence counts. A verdict that
  silently outlives the code it described is the one thing a conformance deliverable cannot
  afford. The log names every stale and every uncovered criterion, so a refresh pass knows
  exactly what to re-adjudicate.
- **A reformatting is not a change.** The fingerprint ignores line numbers and the replay
  re-anchors stored citations onto today's lines, so adding a comment at the top of a file does
  not invalidate every verdict in it.
- **A missing or refused ledger never fails the job.** The criteria stay « à évaluer », which is
  where they would have been without one.

To FILL it, run an adjudication with `ledger` set: the accepted verdicts are recorded on the way
out. Only accepted ones — a refused verdict in the ledger would be laundered back in on the next
replay. A defensible split is a weekly (or `workflow_dispatch`) job that adjudicates and commits
the refreshed ledger, and a pull-request job that only replays it.

## Adjudicating the judgment criteria in CI (`adjudicate`)

> **One pass is not always enough, and not because of the criteria.** The adjudicator can stop
> early: measured on a real run, `num_turns: 22` against a budget of 228, `is_error: false`, and
> 42 criteria still `verdict: null` — a whole worklist abandoned with no error to show for it.
> `adjudicate-passes: "3"` sends it round again on the residue. Each pass re-derives the worklist
> with `verify --manual`, which by construction holds only what is still `manual` (never reached,
> or ruled and refused by the gate, carrying its refusal), so a pass costs the remainder and
> nothing more — and a run that decided everything skips the rest before any model is invoked.

`adjudicate` is what FILLS the ledger — opt-in, in two modes. It runs **after** the replay, so a
paid pass only ever covers what the ledger did not: on a repository whose ledger is current, it
has nothing left to rule on and costs nothing.

```yaml
env:
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}   # the job's env, never an input
steps:
  - uses: maxgfr/ultra11y@v5
    with:
      standard: rgaa
      adjudicate: api          # or `agent`
```

| input | default | |
|---|---|---|
| `adjudicate` | `none` | `api` · `agent` · `none` |
| `adjudicate-runner` | `cli` | WHO drives the agent tier: `cli` (read-only `claude -p`, shared with GitLab) or the historical `action` transport (claude-code-action) |
| `adjudicate-grain` | `worklist` | how much the model rules on at once: `worklist` (batches of 8) or `criterion` (one call each). Needs `adjudicate-runner: cli` |
| `adjudicate-budget-usd` | *(empty)* | dollar ceiling per `cli` invocation |
| `adjudicate-model` | *(empty)* | model id for `api`; else `$ULTRA11Y_LLM_MODEL`, else the engine default |
| `adjudicate-max-turns` | *(empty)* | turn budget for `agent` with `adjudicate-runner: action`; empty derives it from the worklist. Ignored by the `cli` runner — see below |
| `adjudicate-passes` | `1` | how many times `agent` may go round; each pass re-derives the worklist from what is STILL undecided. Capped at 3 |
| `gate-adjudicated` | `false` | let a model-ruled NC fail the job |

**The turn budget is derived, and that matters more than it sounds.** The runbook is sequential
and the whole point of agent mode is that it opens the files a criterion cites, so the cost is
per item — under RGAA the worklist runs to ~80. A budget too small does not truncate the result,
it **loses** it: the fold is fail-closed on a single unfilled verdict, so a run cut short throws
away every verdict it had already produced, and you pay for all of them. The action therefore
counts the worklist and budgets from it. `adjudicate-max-turns` overrides that when you know
better.

**`api`** sends the worklist to the Messages API in batches of 8 and folds the verdicts back.
**`agent`** emits the worklist plus `orchestrate --eco`'s runbook and hands them to a
`claude-code-action` run, then folds the same way. Both end in the **same fail-closed gate** an
agent's verdicts pass through, so neither can assert a conformance the engine refuses.

### `adjudicate-runner: cli` — the same tier, without GitHub in it

`agent` has always meant "a model that can OPEN the files a criterion cites". Until now that
was spelled `anthropics/claude-code-action`, which made it a GitHub feature rather than a
tier: unusable from this skill, from a GitLab CI, from a cron — and unusable on **`push`**,
because claude-code-action parses the event context before it reads the prompt and refuses
what it does not know. `push` is the event an accessibility gate actually fires on.

`adjudicate-runner: cli` has the ENGINE spawn a headless `claude -p` instead. The Action keeps
`cli` as the historical Claude spelling; the standalone command also accepts explicit
`--runner claude`. Same worklist as the prompt, same system prompt, same schema, same fail-closed fold — only the transport
changes. One step replaces eleven, because `judge --apply` derives, rules, folds and records
the ledger in one go. And it is the same command you can run anywhere:

```bash
node scripts/ultra11y.mjs judge --in audits/audit-latest.json --out audits --apply \
  --runner cli --grain criterion --standard rgaa --ledger .ultra11y/verdicts/rgaa.json
```

It runs **read-only** (`Read`, `Grep`, `Glob`). The action path has to grant `Write`, because
writing `ADJUDICATE.verdicts.json` is its adjudicator's only way to return anything — measured
on a real run: 17 permission denials and the file untouched. Answering on stdout removes the
need, so the tier can no longer touch the audited source, and it still opens every file a
criterion cites. It also runs with `--safe-mode`: the audited repository's own `CLAUDE.md`,
hooks, skills and MCP servers are untrusted content and have no business loading into the
session that rules on it.

For a local/private runner already signed in to ChatGPT, the corresponding command is
`--runner codex`. It invokes `codex exec` ephemerally, read-only and offline, ignoring user
config, repository rules and hooks. It does not need an API key and deliberately is not wired
to the public Action: CI must not receive or synthesize a personal subscription credential.
Codex has no dollar-budget flag, so bound it with `--timeout` and `--max` instead.

**Bound it in dollars, not in turns.** `adjudicate-max-turns` does nothing on this runner:
`--max-turns` is not a flag of the Claude Code CLI, and the CLI **swallows unknown flags
without a word** (invent one and it still exits 0, printing the version). A turn budget
there would read as a ceiling in every log and be an unbounded run. Use
`adjudicate-budget-usd`, which the CLI enforces, and note that the engine also kills an
invocation that passes its wall clock — the only bound nothing can ignore.

**Pin the model.** The CLI's own default is Opus: measured on a one-turn probe, $0.164 against
$0.014 for Haiku. The engine states Haiku rather than inheriting that; `adjudicate-model`
overrides it.

**`adjudicate-grain: criterion`** sends one criterion per call. It costs more calls and buys
two things: the model sees one criterion's evidence instead of eight competing for its
attention, and a run that stops early loses at most ONE criterion — the cliff where a
truncated pass threw away everything it had already ruled on cannot happen. It works on the
`api` tier too. It is refused with `adjudicate-runner: action`, because a composite action
cannot loop over a `uses:` step.

### GitLab CI, and anything else with a shell

Because the tier is one engine command, there is no port to write. A ready template lives at
`skills/ultra11y/templates/gitlab-ci.yml` and is `include:`-able as-is:

```yaml
include:
  - remote: 'https://raw.githubusercontent.com/maxgfr/ultra11y/main/skills/ultra11y/templates/gitlab-ci.yml'

variables:
  ULTRA11Y_STANDARD: rgaa
  ULTRA11Y_URL: 'http://127.0.0.1:8080/'
```

with `CLAUDE_CODE_OAUTH_TOKEN` as a masked, protected CI/CD variable. Without it the job still
runs and still ships a report — the judgment criteria stay « to assess » rather than being
called conforming by silence, which is the same degradation the GitHub Action makes on a
fork's merge request.

The difference between them is **evidence, not trust**. `judge` rules from the harvested
evidence alone — capped at 30 items per criterion, snippets truncated — while the agent can
open the cited files and read around them, which is what *link purpose **in context*** actually
asks for. Expect the API mode to answer `manual` more often; that is it being honest, not
broken. The metric that separates them is the count of criteria left to assess.

**Both modes read their credential from the job environment, never from an input** — a
composite action's steps inherit it, and a secret that never travels through an input is one
fewer secret to leak into a log. When it is absent the tier **skips itself**: the job stays
green, the report is still written, and the criteria stay « à évaluer ». That is not an edge
case — it is precisely what a **fork's pull request** looks like, where secrets are never
exposed. An adjudication that fails mid-flight (a rate-limited batch refuses the whole fold) is
absorbed the same way, because losing the verdicts must never cost you the audit.

**The two modes do not take the same credential.** `api` runs `judge`, which speaks `x-api-key`
to `api.anthropic.com`; nothing else stands in for `ANTHROPIC_API_KEY` there. `agent` shells out
to `claude-code-action`, which accepts **either** an API key **or** the OAuth token a Pro/Max
subscriber mints with `claude setup-token` — so a repository that already runs Claude Code in CI
and holds only `CLAUDE_CODE_OAUTH_TOKEN` can adjudicate without buying API credit. Set whichever
you have; set both and the API key wins.

```yaml
env:
  # `agent` takes either of these. `api` takes only the first.
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

Asking for `api` with only the OAuth token is a warning, not a failure — the tier skips and says
which credential it would have needed, rather than failing a request the Messages API was always
going to reject.

**`agent` cannot run on every event.** `claude-code-action` resolves the GitHub event context
*before* it reads the prompt, and throws `Unsupported event type: <event>` on anything outside
`pull_request`, `pull_request_target`, `pull_request_review(_comment)`, `issues`,
`issue_comment`, `workflow_dispatch`, `repository_dispatch`, `schedule` and `workflow_run`.
**`push` is not in that list** — and `push` is exactly what an accessibility gate runs on. So the
tier checks the event and degrades to a warning there, the same way it does without a credential:
an a11y job must never go red for a reason that has nothing to do with accessibility. Put the
agent tier on the `pull_request` or `schedule` job, or use `adjudicate: api`, which has no such
constraint. The action also hands `claude-code-action` the job's own `GITHUB_TOKEN`, so this tier
never obliges you to add `id-token: write` for a step that makes no GitHub API call.

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
plan renders inline on the diff, and appends a compact Markdown job summary to
`$GITHUB_STEP_SUMMARY`. With no `$GITHUB_STEP_SUMMARY` set, the summary goes to stderr so a
local run still shows it.

The GitHub summary deliberately prints **coverage, never a percentage**:
`12/106 criteria decided in this run · 12 engine · 94 still to complete by scan or
adjudication`. A percentage over the decided subset looks like a conformance score for the
whole grid. Coverage and provenance are derived from the selected standard's criterion rows,
and the occurrence count is derived from the same projection; a WCAG finding that makes no
RGAA criterion non-conformant therefore appears in neither the heading nor an empty table.

URL-keyed findings are **skipped** for annotations — there is no repo line to point at — and
counted in the summary instead, so they are never silently dropped. The summary deliberately
stops at the run-level result and distinct non-conformities: the page scoreboard and its
traffic-light columns live in the explicit `pages`/`full` PR comment and the artifact, not in
every job summary.

## Which command to run it from

The engine remains WCAG-keyed internally, while `audit --standard <pack>` writes a pack-keyed
document with that core under `core`. CI renderers always project from the active standard's
grid. So:

| You want | Run |
|---|---|
| WCAG-keyed CI output, one shot | `audit … --format sarif` |
| **RGAA**-keyed CI output, one shot | `audit … --standard rgaa --format sarif` |
| Re-render an existing RGAA audit | `report --in audits/audit-latest.json --standard rgaa --format sarif` |
| Only what the PR introduced | `audit --since origin/main --baseline audits/baseline.json --format sarif` |

In `--baseline` gate mode the CI rendering covers **exactly the new findings** — the subject
of the gate is the regression, not the backlog, so a PR is annotated with what it introduced
and the existing backlog stays out of the diff.

Uploading two SARIF files in one workflow (a source audit and a page scan) is supported:
each run carries a distinct `automationDetails.id` (`ultra11y/<standard>/`), so GitHub keeps
them as separate analyses instead of one overwriting the other.

## The sticky PR comment

`ULTRA11Y_PR_COMMENT=1` (what the action's `comment: 'true'` sets) posts a pull-request comment
and **edits it in place** on every subsequent run — a CI job that appends a fresh comment on
each push turns a busy PR into a wall of stale audits. The comment is keyed by an invisible
marker, and a human's comment is never adopted (an edit is destructive, so the match has to be
exact).

It is **not** the job summary. That document has a 1 MiB budget and a reader who went looking
for it; a comment has 64 KiB and a reader scanning a diff. Two documents are available, chosen
with the action's `comment-kind` (`ULTRA11Y_PR_COMMENT_KIND`):

| kind | what it posts |
|---|---|
| `digest` (default) | The verdict, the coverage, and the distinct defects — one row per (criterion, rule, selector), so 472 occurrences of one design-system defect are one row. Then a link. |
| `pages` | The page-by-page grid: one row per page with its basis, its `C`/`NC` counts and severities — no misleading decided-subset percentage; then the FULL criterion × page grid (`C` / `NC` / `—` / `?`, collapsed), the criteria nobody has ruled on **named**, and a collapsed block per failing page listing its non-conforming criteria and where to fix them. Needs pages in scope; with none it says so rather than posting an empty scoreboard. |
| `full` | Both, in **one** comment under its own marker: everything `pages` posts, plus the run's distinct defects with their locations — the digest's actionable half. For a workflow that wants a single comment at the end with everything in it rather than two a reviewer has to reconcile. Same scope requirement as `pages`. |

**The marker carries both the standard and the kind**, so a WCAG run and an RGAA run keep
separate comments — and so do the code digest and the page grid of one standard. That last
part is not hypothetical: a workflow whose gate job and page-sweep job both commented under
one marker had the sweep (337 files, 684 occurrences) overwrite the gate's four actionable
findings on every run, and the tier that got muzzled was the page sweep. The kinds are also
built so neither key is a substring of the other, because the lookup matches with `includes`.

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
- uses: maxgfr/ultra11y@v5
  with:
    standard: rgaa
    start: npm run start
    wait-on: http://localhost:3000
    sitemap: http://localhost:3000/sitemap.xml   # …or `crawl:` …or `urls:` …or `sample: 'true'`
    crawl-max: '0'                               # 0 (the default) = no cap
```

**`crawl-max` and `crawl-depth` default to `0`, which means no bound.** A sweep that silently
stopped at 20 pages produced a report merely SHORTER than the site, and a shorter deliverable
reads exactly like a complete one. Set a number when the runner budget matters more than
coverage — a large site is unbounded runner time and an unbounded artifact, and `evidence-max`
guards only the crops. Every page reached is logged with its running count, so an unbounded
crawl is never a job that merely looks hung.

**Point the scan at the pages, not at a directory listing.** A crawl follows the links in the
served HTML, and a listing that links a source file makes the browser start a download instead
of a navigation — which stops the scan.

### The browser tier comes with the action now (`browser`)

The tier does not travel with the action, and that used to be a silent hole. `scan --runtime
local` resolves `@playwright/test` + `@axe-core/playwright` from the audited project first and
from ultra11y's own install second — and consumed as `uses: maxgfr/ultra11y@v5`, that second
anchor is a checkout with **no `node_modules` beside it**. So a repository that did not pin
Playwright itself resolved nothing, degraded to Docker, and lost every rendering criterion:
contrast, zoom, reflow, text spacing. The `urls` input meanwhile promised "a Chromium binary
for the Playwright that ships with ultra11y". It did not ship.

`browser: auto` (the default) closes it: the action asks the engine whether the tier resolves
(`status --browser`, the same function `scan` acts on — never a shell re-derivation), and only
if it does not, installs the two packages **pinned to the action's own manifest** plus a
Chromium binary into `$RUNNER_TEMP`, then points `--cwd` there. `install` skips the question;
`off` restores the old behaviour.

Three things it deliberately does:

- **Leaves a project that pins its own Playwright alone.** Two copies in one process hand out
  `Page` objects the other one's fixtures do not recognise.
- **Installs into a scratch prefix, never into your tree.** Installing a named package while
  omitting dev dependencies installs *nothing* when that package is already in the target's own
  devDependencies — npm answers "up to date" — which is how this repository's own CI once ran
  with no tier at all. A directory that declares nothing cannot be hit by it.
- **Never fails the job.** A tier it could not build is a `::warning::` and a scan that degrades
  exactly as it did before; a missing optional capability must not turn into a red build.

Cache the download to make it free after the first run:

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.cache/ms-playwright
    key: ms-playwright-${{ runner.os }}
```

Every scanned page is also **persisted as a snapshot** and folded into the audit
(`snapshot: 'false'` opts out). That is not a nicety: a page known only by its URL cannot earn
a conforming verdict — the static rules never ran against its DOM — so without it the per-page
grid is almost empty and the job reports far less than it measured.

Five surfaces come out of it:

- **The scoreboard**, in the explicit `pages`/`full` sticky PR comment and the artifact: one
  row per page with its rate and its blocking/major/minor counts, plus a `basis` column. The
  `basis` column is not
  decoration — a page marked *source* has no snapshot, so its silence is not conformity.
  It appears on a clean run too, which is exactly when a reviewer wants to see *which* pages
  passed.
- **The criteria, NAMED, under each page** — in the explicit page comment and per-page
  dossiers: what conforms, what does not, what nobody has ruled on, by id. Counts are the
  right shape for a scoreboard and
  the wrong one for acting: « 65 / 6 » says nothing about *which* six, and until now the ids
  lived only in an artifact nobody downloads. Every status comes from the same
  `pageCriterionRows` the dossiers render, so the summary and the deliverable cannot disagree.
- **The compact status result**, in the visible job summary and `audits/pages-status.md`: one
  folded block per page naming every conforming, non-conforming and not-yet-verifiable criterion.
  A manual criterion is labelled “impossible to verify” only when `undecidable-file` declares it
  by id with a reason; an unfinished adjudication remains “to verify”. `pages-report: compact`
  packages only this file, `pages.json`, `audit-latest.json` and the portable verdict ledger;
  adjudication worklists, screenshots, evidence crops and remediation reports stay out of the
  download. An exhaustive keyed run therefore pays for no second render. During an active
  adjudication refresh, a fresh verdict supersedes a now-stale allowance without failing the
  paid run; deterministic replay remains strict and asks the repository to remove stale entries.
- **The per-page dossiers**, in the uploaded artifact (`pages-report: 'true'`, the default):
  `audits/pages/index.md` plus one sheet per page — its screenshot, every criterion of the
  standard with its status on that page, and each non-conformity as the ordinary auditor block.
  They honour `evidence` and `html` like the compliance report does, so the annotated crops and
  the `page-<id>.html` mirrors are really in the artifact.
- **`audits/pages.json`**, the same projection for a machine — `{ pages: [{ id, name, url,
  basis, criteria: [{ id, status, decidedBy }], conformancePct, decided, total }],
  unattributed }`.

The action publishes the page dimension as **outputs** too, so a later job needs neither the
artifact nor a re-derivation: `pages-json-path`, `pages-report-path`, `pages-summary-path`, `pages-count` and
`pages-failing`. The two paths are paths on purpose — a criterion × page matrix is not a scalar,
a step output is size-capped, and truncating a grid into one would be a silent lie about
coverage.

A run with no page in scope is not a failure: the report step says so, the outputs stay
empty/`0`, and the job carries on. `0` pages is a different statement from a clean sweep, and
the two must not be read alike.

### The render gate (`require-rendered`)

`require-decided` asks whether every criterion carries a verdict; `require-sample` asks whether
the run looked at every page it declares. `require-rendered` asks the question underneath both:
were the criteria that need a browser given one?

```yaml
- uses: maxgfr/ultra11y@v5
  with:
    standard: rgaa
    crawl: http://localhost:3000
    runtime: local
    require-rendered: 'true'
```

It fails while a rendering criterion is still « to assess » **and** the run snapshotted no page
at all. It asks about the INSTRUMENT, never the answer: a run that rendered a page and still
could not settle 1.4.5 passes — that is the honest residual, and failing on it would push a
project to manufacture a verdict. Measured on a real keyed cascade: three passes, 311 turns and
$24.90 spent to be told that seven criteria needed a rendered DOM, by a workflow that audited
sources only. Pair it with `undecidable-file` for the criteria you genuinely cannot render.

### Pages behind a login (`storage-state`)

The pages worth auditing are rarely the public ones. A form-heavy funnel, a dashboard, a
back-office — all of them sit behind a sign-in, and a scan that reaches them anonymously does
not fail: it records **the sign-in screen** under the name of the page you asked for. That is
the worst failure mode an accessibility report has, because the document looks complete.

Produce a Playwright `storageState` in the job — most repositories already have one, written by
the setup project their E2E suite depends on — and hand the action its path:

```yaml
- run: npx playwright test --project=setup      # your existing login, writing the session file
- uses: maxgfr/ultra11y@v5
  with:
    standard: rgaa
    sample: 'true'
    storage-state: test-results/.auth/user.json
```

The path is forwarded to Playwright as a path and never read by the engine, so a session file
cannot end up in the job log. A per-page `storageState` in `.ultra11yrc.json` **overrides** this
one, so a sample can mix public and signed-in pages in a single run.

Two things worth knowing about an authenticated scan:

- **The click probe is off.** With a session loaded, a click can trigger a real mutation on a
  real record. The live-region probe still fills inputs and re-measures, but it does not click
  buttons unless you set `interact-clicks: 'true'`. (Buttons whose accessible name reads
  destructive are never clicked, session or not.)
- **A session is not a state machine.** Being signed in gets you past the login; it does not put
  a multi-step funnel on step 4. If a route is guarded by application state, seed that state in
  the job before scanning — otherwise the page redirects and you are back to auditing the wrong
  screen under the right name.

## What the artifact looks like when you open it

`audits/` used to hold JSON, SARIF and Markdown: everything a machine needs and nothing that
opens. `html: 'true'` and `evidence: 'true'` are on by default, so it now has a front door.

```
audits/
├── index.html                        ← the entry point: rate, synthesis, page scoreboard, links
├── ultra11y-<std>-<date>.html        ← the whole audit in ONE file, printable to PDF
├── <std>-<date>.md                   ← the Markdown report, illustrated by the same crops
├── audit-latest.json                 ← the machine-readable audit (unchanged)
├── pages.json                        ← the per-page grid, for a machine (`pages-json-path`)
├── pages-status.md                   ← every criterion grouped by status under every page
├── assets/
│   ├── <page-id>.png                 ← the page screenshot
│   └── <page-id>/<hash>.png          ← one annotated crop per distinct defect on that page
└── pages/
    ├── index.md + page-<id>.md       ← the per-page dossiers (unchanged)
    └── index.html + page-<id>.html   ← the same, navigable (needs `html: 'true'`)
```

The HTML sheets and the crops in `pages/` were documented here before the step produced them:
it passed neither `--html` nor `--evidence`, so `pages/index.html` did not exist and every page
sheet cited `dom.html:412 (div.card)` with no picture while the compliance report beside it
carried annotated crops of the same defects. The step now follows the same `html` and
`evidence` inputs the report does.

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

An occurrence gains a sub-bullet showing the element, ringed:

```md
- [ ] `.ultra11y/pages/accueil/dom.html:412` (`div.card`) — <img> without an alt attribute…
  - ![Cropped capture of the img element on the accueil page, outlined](./assets/accueil/c90959b13aa2.png)
```

**Every document that shows a non-conformity shows its crop**: the Markdown conformance
report, the per-page sheets, and the single-file composite. They all reference one set of
files in `assets/`; only the composite pays the base64 tax, because only it has to travel
alone. `report --evidence` therefore works with or without `--html` — the images are not an
HTML-only tier. `prd`, `gh` and `jira` deliberately stay text: their output is read on
github.com, where a path relative to `audits/` resolves to nothing, and a broken image in an
issue is worse than no image.

Crops are derived AT RENDER TIME from the page snapshot, never stamped on the finding: a
rectangle in pixels is a property of the image, and a stamped box goes silently wrong the
moment the audit is re-rendered against a different capture. So `evidence` needs snapshots —
`snapshot: 'true'` (the default), the E2E plugins, or `ultra11y dev`. Audited from source
alone, the tier is simply inactive and says nothing: a source finding never had pixels, so it
is not an occurrence that failed to be illustrated.

The mark is **not monochrome**: a white halo, a red ring and corner brackets whose *shape*
says "here". A tool that reports 1.4.1 failures cannot ship a deliverable that commits one.

When a crop cannot be drawn, the report says so per page and per criterion, with the reason —
`no-screenshot`, `below-the-fold`, `unknown-scale`, and nine more. **An occurrence without a
picture must never read as an occurrence without a defect.**

Two of those reasons look alike and are not:

| Reason | What it means | Costs the reader |
|---|---|---|
| `deduplicated` | the same defect on the same element, already shown by another occurrence's picture | nothing |
| `capped` | a **distinct** defect left undrawn because a limit ran out | a picture — raise `evidence-max` |

`evidence-max` (200 by default) is the run-wide fuse and the only one that is a setting: it
guards the upload's size. The per-rule (6) and per-page (12) limits are fixed, because they
are what makes one picture stand for a repeated defect — one design-system failure multiplied
by 38 routes is one defect, not 472 pictures.

### Printing it

The single file is the deliverable an auditor hands to a client: open
`ultra11y-<std>-<date>.html`, print, *Save as PDF*. The print sheet keeps each criterion and
its evidence on one sheet rather than splitting them across a page break.

Its images travel inside it as `data:` URIs, and base64 costs a third more than the bytes it
encodes — so there is a budget (the `inline-budget` input, `--inline-budget` on the CLI, 12 MB
by default) and a ladder. Over budget, page screenshots go first, then all but one crop per
criterion, then the images entirely. Every rung is written **into the document** and onto
stderr, and the other documents still reference every crop as a file. Images degrade; the
non-conformities
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
- uses: maxgfr/ultra11y@v5
  with: { since: auto, artifact-name: a11y-code }
- uses: maxgfr/ultra11y@v5
  with: { crawl: http://localhost:3000, artifact-name: a11y-pages }
```

Left unset it keeps the historical `ultra11y-<standard>`, so a single-invocation workflow is
unaffected.

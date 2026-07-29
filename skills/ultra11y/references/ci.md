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
  - uses: maxgfr/ultra11y@v2      # or pin the exact version, as `init --ci` does
    with:
      since: auto                   # the PR's base branch
      standard: rgaa
      fail-on: blocking
      baseline: audits/baseline.json
      comment: 'true'
```

Page by page, with a real browser, in the same step:

```yaml
  - uses: maxgfr/ultra11y@v2
    with:
      standard: rgaa
      start: npm run start
      wait-on: http://localhost:3000
      urls: http://localhost:3000 http://localhost:3000/contact
      # …or `sample: 'true'` to scan the sample declared in .ultra11yrc.json
```

`ultra11y init --ci` writes a workflow using it, **pinned to the exact engine version that
generated the file** (`@v<that version>`) so a CI run stays reproducible. `@v2` is a moving major alias
the release workflow keeps pointing at the latest release, for teams who would rather take
fixes automatically. Never `@main`: it would change under you without a version to blame.

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

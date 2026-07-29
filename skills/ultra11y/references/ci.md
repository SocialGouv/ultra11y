# CI surfaces — SARIF, annotations, job summary

`init --ci` (see `references/automation.md`) gives you a **gate**: a green or red job. That is
the floor, not the ceiling. A gate tells a developer *that* the build failed; it does not put
the non-conformity **on the line of code that caused it**. These `--format` renderings do.

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

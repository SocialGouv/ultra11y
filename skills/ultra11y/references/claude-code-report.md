# Detailed conformance reports in Claude Code

Use this route when the user asks Claude Code for an audit or conformance report. The active
Claude Code session is the auditor: it reads the criterion briefs and writes the verdicts
itself. It does not launch a nested `judge --runner claude` session.

The completion criterion is a **defensible deliverable**, not merely a clean static scan:

- every declared page was captured, or the missing page is named;
- every criterion on every captured page is `C`, `NC`, `NA`, or explicitly undecidable;
- every `NC` has a resolvable occurrence and every `C`/`NA` has grounded justification;
- the conformance report and per-page dossiers pass `check`;
- the user receives the paths to the Markdown report, HTML entry point, printable single file,
  page index and machine-readable grid.

## 1. Establish the scope

Read `.ultra11yrc.json` when present. Confirm the standard, language and page sample. For a
country standard, prefer `sample check` plus `scan --sample`; otherwise crawl without a hidden
cap (`--max 0`). A source-only country-standard report is partial and must say so.

## 2. Audit source and rendered pages

```sh
node scripts/ultra11y.mjs audit <paths> --graph --standard <standard> --lang <lang> --out audits --json
node scripts/ultra11y.mjs scan --sample --runtime local --cwd . \
  --standard <standard> --merge audits/audit-latest.json --out audits
```

Use `--crawl <url> --max 0` instead of `--sample` when the project has no declared sample. A
rendering criterion stays undecidable when no browser measurement exists; source inspection
does not replace the scan.

## 3. Adjudicate directly

Generate the judgment worklist with `verify --manual`. Read each small
`audits/adjudicate/<criterion>.md` brief, decide against its official tests, write the verdict
file, then fold it with `verify --apply`. Use the orchestration route when the worklist is large,
but keep the final fold in the parent session.

```sh
node scripts/ultra11y.mjs report --in audits/audit-latest.json \
  --standard <standard> --lang <lang> --out audits
node scripts/ultra11y.mjs verify --report audits/<standard>-<date>.md \
  --in audits/audit-latest.json --manual --standard <standard> --out audits
node scripts/ultra11y.mjs verify --apply audits/ADJUDICATE.verdicts.json \
  --in audits/audit-latest.json --standard <standard> --out audits
```

The first report is a draft, not the final deliverable. Follow `references/judgment.md` for
the verdict schema and fail-closed fold.

## 4. Challenge the claims

Render the report, generate the adversarial `VERIFY.todo.json`, adjudicate every claim, apply
the verdicts with `--prune --ledger`, then render again. This trial covers both alleged
non-conformities and agent-declared conformities.

```sh
node scripts/ultra11y.mjs report --in audits/audit-latest.json \
  --standard <standard> --lang <lang> --out audits
node scripts/ultra11y.mjs verify --report audits/<standard>-<date>.md \
  --in audits/audit-latest.json --standard <standard> --semantic --out audits
node scripts/ultra11y.mjs verify --apply audits/VERIFY.todo.json \
  --report audits/<standard>-<date>.md --in audits/audit-latest.json \
  --standard <standard> --out audits --prune --ledger
```

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

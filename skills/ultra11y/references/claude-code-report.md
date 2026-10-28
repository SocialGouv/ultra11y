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

What the scan does with a rendering criterion depends on the standard. Under the WCAG core a
clean scan concludes `C` (`decidedBy: "scan"`). **Under RGAA it does not**: 3.2, 3.3, 10.4,
10.11, 10.12, 12.9 and the other rendering criteria carry only *candidate* scan rules, so the
scan can raise their non-conformities but a clean run leaves them « à évaluer » — they come to
you in step 3, and `check --require-decided` counts 0 « mesure (scan) » for them. That is
expected, not a failed scan.

If the scan cannot start a browser, it falls back on Playwright's full Chromium build and then
on an installed Google Chrome; the error, when none starts, names the Playwright install that
was resolved and the command that installs its browser.

## 3. Adjudicate directly

Generate the judgment worklist with `verify --manual`. Read each small
`audits/adjudicate/<criterion>.md` brief, decide against its official tests, fill the verdicts
in **`audits/ADJUDICATE.todo.json`** — the one file to write in a session with a shell (its
items carry the evidence and the `citations[]` slots; `ADJUDICATE.verdicts.json` is the
evidence-free twin for an adjudicator without a shell, and `verify --apply` accepts either, but
fill one, not both) — then fold it with `verify --apply … --ledger`. The ledger records every
accepted verdict, so the trial in step 4 can repair it and a later run can replay it. Use the
orchestration route when the worklist is large, but keep the final fold in the parent session.

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
that is easily 70+ claims.

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

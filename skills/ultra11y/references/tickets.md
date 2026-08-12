# Tracker tickets (`tickets`) — GitHub · GitLab · Jira

`tickets` reads an `AuditResult` and **files it into a tracker**. It writes no Markdown.
`prd` and `report` write Markdown and file nothing. That split is deliberate: you could
previously not push without also producing a document, nor produce a document without
risking a push.

```
node scripts/ultra11y.mjs audit "src/**/*.tsx" --graph --out audit.json

node scripts/ultra11y.mjs tickets --in audit.json --dry-run                       # ALWAYS start here
node scripts/ultra11y.mjs tickets --in audit.json                                 # one ticket per criterion
node scripts/ultra11y.mjs tickets --in audit.json --grain page                    # one ticket per page
node scripts/ultra11y.mjs tickets --in audit.json --grain page-criterion          # one per page × criterion
node scripts/ultra11y.mjs tickets --in audit.json --grain single                  # one consolidated ticket
node scripts/ultra11y.mjs tickets --in audit.json --grain file                    # one ticket per source file
node scripts/ultra11y.mjs tickets --in audit.json --provider gitlab --standard rgaa --lang fr
node scripts/ultra11y.mjs tickets --in audit.json --provider jira --max-tickets 20
node scripts/ultra11y.mjs tickets --in audit.json --json                          # machine-readable plan + result
node scripts/ultra11y.mjs tickets --in audit.json --out ./run                     # the ticket SET as JSON, for any other board
```

## Filing on a tracker ultra11y does not speak

`--out <dir>` writes the tracker-agnostic set to `<dir>/issues-<date>.json` — a stable path a
workflow engine can read without parsing a payload that also carries prose. It works at every
grain, carries `occurrences[]` so a board with inline anchors needs nothing else, and writing
it **files nothing**. `schemaVersion` is what lets a consumer pin. See
`references/orchestrators.md`.

The ticket **body** is the same auditor block `report` §2 and the `prd` backlog render
(`src/auditor.ts`). There is one audit truth; the tracker sees exactly what the document says.

## Granularity (`--grain`)

What counts as ONE ticket. Default `criterion`.

| Grain | One ticket is | Title |
|---|---|---|
| `criterion` | a criterion, across the whole scope | `[a11y] WCAG 1.1.1 — Non-text Content` |
| `single` | the entire audit | `[a11y] WCAG — Accessibility audit` |
| `page` | a page and every non-conformity on it | `[a11y] WCAG [page:accueil] — Accessibility audit` |
| `page-criterion` | a criterion **on** a page | `[a11y] WCAG [page:accueil] 1.1.1 — Non-text Content` |
| `file` | a source file | `[a11y] WCAG [file:src/Button.tsx] — Accessibility audit` |

`WCAG` becomes the pack name under `--standard` (`[a11y] RGAA 1.1 — …`). A non-normative
recommendation gets the ` (recommendation)` suffix and the `recommendation` label, so it is
never triaged as a non-conformity.

Pick by who does the work: `criterion` suits one person fixing one rule everywhere,
`page`/`page-criterion` suit a team that owns pages, `file` suits a component owner,
`single` suits "one tracking ticket, we'll work from the report".

### The page grains keep the page honesty rules

- A page whose real rendered DOM was audited (`basis: snapshot`) can be conforming. A page
  assembled only by **source attribution** (`basis: attributed`) cannot: its ticket carries
  the warning that absence of a finding is not conformity. See `references/pages.md`.
- Findings **no page can claim** (shared components, files outside any route) get their OWN
  ticket, `[a11y] WCAG [unattributed] — Accessibility audit`. They are never dropped and
  never spread across pages — spreading would invent non-conformities.
- With **no page in scope**, `--grain page` exits `1` and tells you to capture snapshots
  (`render --e2e`) or scan a sample (`scan --sample`). It never files zero tickets in silence.

A `file` ticket carries no conformance rate: a file is not a page.

## De-duplication — the title IS the key

There is no hidden marker, no state file, no id map. The **exact title** is the identity,
compared client-side. That is the only key that survives all three trackers without
persisting anything, and it means re-running never creates duplicates.

Two consequences worth knowing before the first run:

- **Upgrading from `--gh-issues` costs nothing.** The `criterion` and `single` titles are
  byte-identical to the pre-v3 ones, so tickets already filed are recognised and skipped.
- **`--lang` forks the title** for grains carrying a criterion wording (`[a11y] WCAG 1.4.3 —
  Contrast (Minimum)` vs `— Contraste (minimum)`). Keep `--lang` consistent across runs
  against the same tracker. The FRAME is never localized: "Accessibility audit" stays English
  at `--lang fr`, precisely so it cannot fork.
- Renaming a snapshot directory changes the page id, hence the title. Same caveat.

If the tracker cannot be listed (permissions, rate limit), the run degrades to **create**
rather than dropping the backlog, and says the skip count is unverified.

## Providers and transports

`--provider auto` (default) reads `ULTRA11Y_TICKET_PROVIDER`, then `.ultra11yrc.json`, then
the `origin` git remote. **Jira is never auto-detected** — it owns no git remote — so name it.

`--transport auto` (default) prefers the CLI, which owns its own auth so ultra11y never holds
a token; it falls back to REST when only a token is available, and says what BOTH were
missing when neither works.

**REST is not redundant with the CLI.** `gh` ships on GitHub-*hosted* runners only: container
jobs, self-hosted runners and every non-GitHub CI have a token and no binary. GHES works
through `GITHUB_API_URL`, which Actions sets for you.

| | GitHub | GitLab | Jira |
|---|---|---|---|
| CLI | `gh` | `glab` | — (REST only) |
| token | `GH_TOKEN` → `GITHUB_TOKEN` | `GITLAB_TOKEN` | `JIRA_EMAIL`+`JIRA_API_TOKEN` (Cloud) or `JIRA_TOKEN` (Server/DC) |
| target | `GITHUB_REPOSITORY` → `ULTRA11Y_GITHUB_REPO` → git remote | `CI_PROJECT_ID` → `ULTRA11Y_GITLAB_PROJECT` → git remote | `ULTRA11Y_JIRA_PROJECT` (the project KEY) |
| API base | `GITHUB_API_URL` | `CI_API_V4_URL` | `ULTRA11Y_JIRA_URL` |

Also for Jira: `ULTRA11Y_JIRA_ISSUE_TYPE` (default `Task`) and `ULTRA11Y_JIRA_API` (`2`|`3`).

**Credentials live in the environment only.** A `token` / `apiToken` / `password` / `secret`
key anywhere in the config's `tickets` block is a hard error (exit 2) — `.ultra11yrc.json` is
committed, so a token in it is a leaked token.

### Per-tracker specifics

- **GitHub** — the issues endpoint also returns pull requests; they are filtered out, so a PR
  title can never suppress a real ticket. A `422` on labels retries unlabelled rather than
  losing the ticket. Bodies are clamped to 65 536 characters with a pointer to the PRD.
- **GitLab** — `CI_JOB_TOKEN` **cannot create issues**; when that is the token in play, the
  failure says so instead of returning a bare 403. Missing labels are auto-created by GitLab.
- **Jira** — API v3 requires ADF, not Markdown, so the body is rendered as one ADF paragraph
  per line: the text is faithful, the formatting is not. Set `ULTRA11Y_JIRA_API=2` for the v2
  endpoint (plain string) on Server/DC. Severity maps to priority (Highest/High/Low); a
  project that has not configured `priority` or `labels` gets a retry without them. Every
  ticket carries a constant `ultra11y` label so the de-dupe JQL can bound its search — the
  JQL only narrows candidates, the exact title match still decides.

## Guards

- **`--max-tickets`** (default 200) — `page-criterion` on a large RGAA audit runs to the
  hundreds, and a creation is hard to undo. Past the limit the command **refuses** and names
  the escape hatch. It never truncates silently.
- **`--dry-run`** — resolves the transport, lists what exists, prints create-vs-skip, creates
  nothing, exits 0. Run it first, every time.
- **Exit codes** — `0` filed/skipped/nothing to file · `1` at least one creation failed, the
  provider is unusable, or `--grain page*` with no page in scope · `2` usage, config, or the
  `--max-tickets` guard.

An unusable provider exits **1**, not 0. A push command that files nothing and reports green
is a silent failure.

## Configuration

```jsonc
// .ultra11yrc.json — flags always win
{ "tickets": { "provider": "gitlab", "grain": "page", "maxTickets": 100 } }
```

## Migrating from `prd --gh-issues`

| Before | Now |
|---|---|
| `prd --in a.json --gh-issues` | `tickets --in a.json --provider github --grain criterion` |
| `prd --in a.json --gh-single` | `tickets --in a.json --provider github --grain single` |
| `prd --in a.json --out d --issues-json` | `tickets --in a.json --out d --grain criterion` |

All three old flags now exit `2` and print the replacement. `prd` still writes the same Markdown;
its `--json` payload no longer carries a `gh` key.

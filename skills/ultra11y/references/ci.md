# CI: run iterion's `rgaa-audit` bot

ultra11y is a skill and an engine. It ships **no CI integration of its own** — no GitHub
Action, no GitLab template. An accessibility audit in CI runs through
[SocialGouv/iterion](https://github.com/SocialGouv/iterion)'s **`rgaa-audit` bot**:
[`bots/rgaa-audit`](https://github.com/SocialGouv/iterion/tree/main/bots/rgaa-audit).

That bot is the harness the engine needs to produce a real audit, not a wrapper around it:

- it installs this engine from npm, **pinned by version and by the sha256** of its entry file,
  and refuses to run anything that does not carry the fingerprint;
- the engine finds: the static audit, the rendered page sample, the committed ledger replay;
- **read-only agents judge** the criteria a static pass cannot decide — under RGAA,
  **104 of 106** still need adjudication to earn C — one batch per theme, from the evidence the
  engine harvested;
- a **second reader puts every claim on trial**, conformities included, before the report is
  written; an optional human gate approves or declares criteria undecidable;
- the engine refuses: its fold rejects an unjustified verdict, an uncited conformity or an
  ungroundable non-conformity, and `check` rejects a report citing what does not resolve;
- it files one board issue per non-conforming criterion, with no model in the loop.

How to run it, its variables (`scope_globs`, `rendered`, `serve_command`, `ledger_path`,
`human_review`, `require_complete`, `post_to_board`…) and its budget are documented in the
[bot's README](https://github.com/SocialGouv/iterion/tree/main/bots/rgaa-audit#readme). Read
that, not this page, to set up CI.

A bare engine run in a CI shell is not an audit: nobody rules on the judgment criteria, nobody
refutes, and the grid stays mostly « à évaluer ». Inside a coding agent the session is the
auditor (`references/full-audit.md`); in CI, the bot is.

## The engine CLI is the stable contract

iterion drives the engine through its CLI and nothing else, so the CLI — its commands, flags,
exit codes and JSON documents — is the contract a release must keep. The bot relies on:

| Command | What the bot uses it for |
|---|---|
| `status --browser` | whether the rendered tier resolves on the runner |
| `audit --standard rgaa --json` (+ `--graph`, `--jsx`, `--exclude`, `--max-files`, `--staged` / `--changed` / `--since <ref>`) | THE finding set, written to `audits/audit-latest.json` |
| `sample check` | lint the `.ultra11yrc.json` page sample against the standard's required page kinds |
| `scan --sample --merge <audit.json>` | render, snapshot and fold the page sample (`--storage-state` for pages behind a login) |
| `verify --apply <ledger>` | replay the committed verdict ledger (`.ultra11y/verdicts/<standard>.json`) — a re-verification against fresh evidence, never a cache hit |
| `verify --manual` | the adjudication worklist for the criteria still « à évaluer » |
| `verify --apply <adjudication.json> --ledger <file>` | the fail-closed fold, recording the accepted verdicts |
| `verify --report …` · `verify --apply <VERIFY.todo.json> --prune` | the refutation: every written claim on trial, refuted ones withdrawn |
| `report` · `report --html` | the dated conformance report, and its printable HTML |
| `check --report <md>` | the integrity gate: every cited criterion resolves, every NA is justified |
| `check --in … --require-decided=pages [--allow-undecided <file>] [--require-rendered]` | the completeness gates |
| `pages --in … --json --out <dir>` | the per-page criterion grid (`pages.json`) |
| `tickets --in … --dry-run --transport rest` | the issue plan, one per non-conforming criterion |

A change to any of these is a breaking change for the bot. `orchestrate --manifest` describes the
same loop as data for any orchestrator; see `references/orchestrators.md`.

The engine emits no CI-specific rendering (no SARIF, no workflow annotations, no pull-request
comment): the bot reads the JSON documents above and posts what it decides to post.

## How this repo publishes itself (npm trusted publishing)

This repository's own release workflow holds **no npm token**. It publishes by OIDC: the job
asks GitHub for a short-lived id-token (`permissions: id-token: write`) and exchanges it with
registry.npmjs.org for a credential scoped to this package. It depends on a **trusted
publisher** configured on npmjs.com naming this repository and `release.yml`, and on **npm >=
11.5.1** on the runner (Node 24 ships an older 11.x, so the workflow upgrades it). The package
had to exist first, so the **first** publish was manual; every release since is tokenless. If
the exchange fails, `@semantic-release/npm` falls back to demanding a token — it never publishes
unauthenticated.

Every release is the version the bot pins: `ultra11y.pin` in the bot directory holds it with
the fingerprint of its entry file.

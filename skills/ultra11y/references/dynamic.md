# Dynamic tier (axe-core) — optional

The static engine leaves some criteria "to assess" because they need a **render**: computed
contrast (1.4.3), focus visible (2.4.7), reflow/zoom (1.4.4/1.4.10), text spacing (1.4.12),
content on hover (1.4.13), target size (2.5.8). The dynamic tier decides them by running
**axe-core in a real headless browser** (Playwright). Two runtimes, same finding shape:

- **`--runtime local`** (recommended): resolves Playwright + `@axe-core/playwright`
  **at runtime**, from `--cwd` first and from ultra11y's own install second (no Docker, no
  global install). A project that pins its own Playwright keeps it, because `--cwd` is tried
  first. Adds the residual-criteria **probes** (below).
- **`--runtime docker`**: runs axe-core in a Docker image auto-built on first use (runner +
  Dockerfile embedded in the bundle). No host deps beyond Docker. Axe + 320px reflow only.
- **`--runtime auto`** (default): local if Playwright resolves **and** a browser binary is on
  disk, else Docker, else an actionable error.

## Prerequisites

- **local**: a Chromium browser (`npx playwright install chromium`), plus the two npm packages
  — and **where they have to live depends on how you run the engine**:

  | Channel | `@playwright/test` + `@axe-core/playwright` |
  |---|---|
  | ultra11y as an npm dependency (`ultra11y/playwright`, `pnpm exec ultra11y`) | **come with it** — they are its own `dependencies`. Nothing to install. |
  | the standalone skill bundle (`node scripts/ultra11y.mjs` from an installed skill) | **must be in the audited project**, reachable from `--cwd`. An installed skill is a directory of files with no `node_modules` beside it, so the second anchor finds nothing there. |
  | the **GitHub Action** (`uses: maxgfr/ultra11y@vN`) | **the action installs them for you** (`browser: auto`, the default) into the runner temp directory, plus a Chromium binary, and points `--cwd` at it. Same blind spot as the skill bundle — the action is a checkout with no `node_modules` — but here it is closed rather than documented. A repository that pins its own Playwright is left alone. |

  Which of those you are in is answerable: `status --browser [--cwd <dir>]` asks the very
  function `scan --runtime local` acts on, and reports `ok` plus, when it is not, WHICH package
  or binary is missing. That is what the action branches on, rather than re-deriving it.

  Either way, a project that installs them itself wins: `--cwd` is tried first, which is what a
  repository with its own pinned Playwright wants. When neither anchor resolves, `auto` degrades
  to Docker and says which package it could not find.
- **docker**: Docker running.

The rest of the skill (static audit) needs neither.

## Usage

```
# auto runtime (local if available, else Docker)
node scripts/ultra11y.mjs scan https://example.com --json

# explicit local runtime, resolving deps + browser from a project (e.g. a monorepo package)
node scripts/ultra11y.mjs scan http://localhost:3000 --runtime local --cwd packages/app --json

# authenticated pages: pass a Playwright storageState JSON (cookies/localStorage)
node scripts/ultra11y.mjs scan http://localhost:3000/dashboard --runtime local \
  --cwd packages/app --storage-state packages/app/test-results/.auth/user.json --json

# several explicit URLs at once (one browser, one context per page)
node scripts/ultra11y.mjs scan http://localhost:3000/ http://localhost:3000/login --runtime local --cwd packages/app

# merge with a static audit: the "to assess" criteria turn C/NC
node scripts/ultra11y.mjs audit "src/**/*.tsx" --jsx --out audits --json > /dev/null
node scripts/ultra11y.mjs scan http://localhost:3000 --runtime local --cwd packages/app --merge audits/audit-latest.json --out audits
node scripts/ultra11y.mjs report --in audits/audit-latest.json --out audits
```

`--storage-state` is **local-only**. Combining it with an **explicit** `--runtime docker` (or
the `--docker` alias) is an unsupported combination and errors out (exit 2) — the Docker tier
cannot use a Playwright storageState, and scanning unauthenticated would silently defeat the
flag. Under `--runtime auto` that happens to fall back to Docker (no local Playwright
resolved), it degrades with a warning instead — you didn't ask for Docker specifically.
Produce the file with Playwright (e.g. an e2e auth setup that logs in and
`context.storageState({ path })`).

### Cover many pages (crawl)

```
# every URL listed in a sitemap.xml
node scripts/ultra11y.mjs scan --sitemap https://example.com/sitemap.xml --json

# BFS of served same-origin links, from an entry page
node scripts/ultra11y.mjs scan --crawl https://example.com --depth 2 --max 50 --json
```

Each finding keeps the **page** it came from (`--merge` reports that URL as `file`). `--crawl`
follows links in the **served HTML** (SSR/MPA); for a pure SPA, use `--sitemap` or pass the
URLs explicitly. The crawl fetch is unauthenticated — for authed pages pass explicit URLs +
`--storage-state` instead.

## What the dynamic tier adds

- **Real contrast (1.4.3)** — axe computes the rendered colours (the main win, both runtimes).
- **Reflow (1.4.10)** — no horizontal scroll at 320px wide (both runtimes).
- **Cross-check** — axe re-validates the structural criteria (alt, labels, ARIA, headings…) at
  render; a render finding is **authoritative** and turns the criterion NC.

axe findings map to WCAG success criteria via a curated table (`axe-rule → SC`), completed by
axe's **native WCAG tags** (`wcag<abc>`). On merge (`--merge`), a `manual` criterion the tier
decides leaves the residual risks and becomes `C`/`NC` (ruleId `axe:<rule>` for axe findings).

### Residual-criteria probes (local runtime only)

Beyond axe, the local runtime runs bespoke Playwright probes for the criteria axe alone cannot
decide. Each raises a **definite NC only when the failure is observed** in the rendered page; a
clean probe leaves the SC `manual` (never silently conforming). Merged findings get a
`dyn-<engine>` ruleId.

| Probe | SC | How |
|---|---|---|
| focus visibility | 2.4.7 | Tab through focusables; flag any whose computed style (outline/box-shadow/border/background) is unchanged when focused |
| 200% zoom | 1.4.4 | Enlarge text to 200%; flag page-level horizontal scroll or text clipped in an `overflow:hidden` container |
| text spacing | 1.4.12 | Inject the WCAG 1.4.12 spacing override; flag clipped/truncated text |
| content on hover | 1.4.13 | For `aria-describedby` triggers whose target is hidden, hover to reveal then check it is dismissible (Escape) |

Visually-hidden (`clip`/1px sr-only) elements are excluded from these probes. **Target size
(2.5.8)** is intentionally left to axe-core's own `target-size` rule, which applies the inline
and 24px-spacing exceptions correctly (a hand-rolled probe was strictly noisier on real pages).

These probes are heuristic (conservative severities: focus + zoom `majeur`, the rest `mineur`)
and **local-only** — the Docker `RUNNER` is kept byte-identical to `docker/runner.mjs`
(`docker-sync` test), so mirroring the probes into the Docker path is deferred. Adversarially
verify probe findings (a `verify` pass) before filing them.

### Stateful interaction probes (local runtime, interactions ON by default)

The read-only probes above measure a page **as served**. Some non-conformities only appear
once the user has *interacted* — a filled field that overflows its cell, a status message
that never reaches a live region. The local runtime therefore also runs a **stateful** pass
that drives the page, then restores it. **Safety contract**: only NON-navigating actions are
performed — fill text inputs (a long representative value, respecting `maxlength`), toggle
checkbox/radio, click `button[type="button"]`. **Never** a link, a submit button, or a form
submit; every interaction records `location.href` first and aborts + restores if it changed;
every loop is bounded; original state is always restored.

| Stateful probe | SC | What it adds |
|---|---|---|
| fill-inputs → re-measure | 1.4.4 / 1.4.10 / 1.4.12 | fills visible text-like inputs with real content, then re-runs the zoom/reflow/spacing stress probes so an overflow that only occurs *when the field holds the value the auditor must type* is caught |
| live-region | 4.1.3 | triggers safe interactions and checks that a resulting status message lands in an `aria-live`/`role="status"`/`role="alert"` region (status-messages) — the extra SC `localTestedScs` reports only when interactions are on |

- **`--no-interact`** disables the whole stateful pass (fill + live-region), leaving only the
  read-only probes — use it when even bounded, non-navigating interaction is unwelcome.
- **Authenticated-scan click policy.** When a `--storage-state` session is loaded, the
  live-region probe does **not** click buttons by default (even a `type="button"` click can
  trigger a server mutation the `location.href` assertion cannot see). Fill/toggle still run.
  **`--interact-clicks`** re-enables the clicks explicitly; unauthenticated scans keep clicks
  on. Defense-in-depth on top: a button whose accessible name matches a
  destructive/submitting verb (delete, remove, send, submit, confirm, pay…) is **never**
  clicked, in either mode.

## Build the sample from the site (`pages discover`)

The crawler and the sitemap parser fed a scan and nothing else: no artefact was persisted, so
the multi-page contract stayed a `sample.pages` block written by hand — which is the step that
stops people auditing more than one page. `pages discover` writes it:

```
node scripts/ultra11y.mjs pages discover --crawl http://localhost:3000 --max 20      # print the proposal
node scripts/ultra11y.mjs pages discover --sitemap https://example.com/sitemap.xml --write
node scripts/ultra11y.mjs pages discover --from-snapshots --write                   # from what your tests already captured
```

`--from-snapshots` reads `.ultra11y/pages` instead of the network, and it is the only route that
can see a **state-reached** page: a modal or a funnel step behind a client-side transition has no
URL to crawl to, but a Playwright test calling `checkA11y` has already been there.

Each page gets a stable id from its URL path and a **name read from the served `<title>`** —
what a human reads in the report — falling back to a humanized path when the document has
none. The crawl's own responses are memoized, so the titles cost no extra request.

`--write` **merges**: a page already declared is kept verbatim, because `auth`,
`storageState` and `notes` are human work — someone worked out how to reach that page — and
re-running discovery must never destroy it. Only genuinely new URLs are appended, ids are
suffixed rather than collided, and the result is validated *before* the file is written (a
malformed block would break every later `scan --sample` with no hint of what caused it).

A client-rendered SPA does not expose its routes in the served HTML; use a sitemap there.

## Scan a normative page sample (`scan --sample`)

A real country-standard audit runs over a declared **page sample** (échantillon), not one
URL. Declare it by hand, or let `pages discover` above write it. Then:

```
node scripts/ultra11y.mjs sample check                                   # lint the sample's coverage vs the standard's required kinds
node scripts/ultra11y.mjs scan --sample --runtime local --cwd packages/app --merge audits/audit-latest.json --out audits
```

`scan --sample` iterates every configured sample page (per-page `--storage-state` supported
for authenticated pages), keeps each finding's originating **page name + auth flag** as
provenance (surfaced in the auditor ticket's *Pages / URLs impactées* and *Contexte de
reproduction*), and `--merge`s them into the audit. `sample check` is an **advisory** lint —
it reports which required page kinds the sample lacks (a malformed `sample` block is a hard
error, exit 2; a merely-incomplete one is guidance, exit 0). See `references/audit.md`
(sample concept) and `references/packs.md` (`sampleMethodology`).

**It lints BOTH inventories.** A project running the E2E producer keeps two: `.ultra11yrc.json`,
and the routes its tests actually snapshot. They drift — and a linter reading only the declared
list once pronounced a sample "complete" for a configuration that omitted the very URL a
certifying audit had been run on. `sample check` now prints the census first, unconditionally:

```
17 déclarée(s) · 38 instantanée(s) · 22 instantanée(s) non déclarée(s) · 1 déclarée(s) jamais capturée(s)
```

The required kinds are checked over the **union**, and « Échantillon complet » is never printed
bare while snapshotted pages are missing from the declared sample — so the verdict cannot be read
as a statement about an inventory it did not see. `pages discover --from-snapshots --write` folds
them in.

The issue that prompted this also floated a `via` recipe on a sample page (auth profile, path,
named interaction steps). It is deliberately **not** implemented: nothing in the engine could
execute it — every browser path is `goto`-only — so a JSON step DSL would reimplement, worse,
what a Playwright spec calling `checkA11y` already does.

### Cover the whole site: the crawl is unbounded by default

`--max` and `--depth` bound the crawl **when you ask them to**; absent — or `0` — there is no
bound at all. A sweep that silently stopped at 50 pages produced a report merely SHORTER than
the site, and a shorter deliverable reads exactly like a complete one. Termination does not
depend on the cap: the frontier never leaves the origin and every URL is de-duplicated by its
canonical form, so a cycle (or a site linking `/` and `/index.html` at once) is visited once.

Every page reached is announced on stderr with its running count, so an unbounded crawl is
never a job that merely looks hung — and `--json` on stdout stays machine-readable.

```
node scripts/ultra11y.mjs scan --crawl https://example.com --json          # the whole site
node scripts/ultra11y.mjs scan --crawl https://example.com --max 50        # bound it explicitly
```

A crawl follows links in the served HTML, including ones that are not pages: a directory
listing that links a `.tsx` file makes the browser start a download instead of a navigation,
and the scan stops there. Point `--crawl` at a real entry page, or pass the URLs.

## Every scanned page is also a SNAPSHOT

`scan` does not only keep findings: each page it visits is persisted to
`.ultra11y/pages/<id>/` (DOM + computed styles + boxes + stylesheets + a viewport
screenshot). The browser is already on the page, so this costs one `evaluate`. `--no-snapshot`
opts out.

### …and what it MEASURED, not only what it saw

The snapshot also carries `probes.json` and `axe.json`: which success criteria the live probes
actually ran on this page, and the axe pass that ran beside them. That is the half that decides
anything, and it used to be thrown away at write time.

The consequence was narrow and expensive. `renderedProvesOn` (`src/coverage.ts`) grants a
conforming verdict from `pageCoverage.scs` / `.axe`, both derived from those two files, so a
scanned page could report a rendering **violation** and could never conclude **conformity**:
1.4.4, 1.4.10, 1.4.12 have no offline rule at all, and 1.4.3's canonical decider is axe. On a
real RGAA run, 3.2 / 10.4 / 10.11 / 10.12 came back « à évaluer » on a page the probes had
zoomed, reflowed and tabbed through.

`probed` is the load-bearing field and it is written honestly: a probe that threw, a viewport
that would not resize, a text-spacing override that would not apply — none of them reach it.
The 320 px resize and the spacing override are part of their own measurement, so a probe read
at the wrong viewport is not recorded (and never raises a reflow non-conformity measured at
1280 px). The Docker runtime records `["1.4.10"]`, which is exactly what it measures.

Measured on a two-file fixture: **80 criteria to adjudicate from source alone, 41 once a single
page was scanned.**

That artefact is not a convenience — it is what makes a URL a real per-page verdict:

- **Without it a scanned page can never be conforming.** `src/pages.ts` grants `C` by silence
  only to a page whose real DOM the static rules ran against (`basis: "snapshot"`); a page
  known only by its URL stays `basis: "attributed"` and its criteria stay « à évaluer »
  forever. A sitemap-driven audit produced an almost empty grid.
- **The page-scoped rules finally run.** A snapshot is a full document, so RGAA **8.3**
  (`lang`), **8.4**, **8.5/8.6** (`title`) and 12.6 (`main`) become decidable — none of them
  can be judged from a component render, nor from source once a framework injects the
  document shell.
- **It captures what JavaScript built.** A link, a dialog or a nav injected at runtime exists
  in no source file; it exists in the snapshot, and the ordinary static rules see it.
- **It re-audits offline.** `audit` ingests `.ultra11y/pages` automatically, with no browser,
  no Docker and no running server — which is how CI decides these without booting the app.

The collection happens on the **pristine** page: before axe injects its source, before any
probe fills an input, resizes the viewport to 320px or bolts on the text-spacing stylesheet.
Collected later, the snapshot would record our own instrumentation instead of the site.

With `--merge`, the freshly written snapshots are audited and folded into the result in the
same run, and `scope.pages` is recorded — so `pages` and `report` speak page by page
immediately, not on the next `audit`.

## Render BEFORE you adjudicate

A `needs-rendering` criterion handed to an adjudicator on a source-only audit has exactly one
honest answer, `needs-rendered-dom`, and getting it costs a model pass. Measured on one keyed
RGAA cascade: three passes, 311 turns and $24.90, ending with seven criteria correctly reported
as needing a rendered DOM — on a workflow that had snapshotted nothing.

Two surfaces now say so before the money is spent, and neither guesses:

- **`verify --manual`** names them in the log and in `ADJUDICATE.md` when the worklist carries
  rendering criteria and no page's real DOM was read. Advisory: a source-only audit is a
  legitimate thing to want.
- **`check --in <audit.json> --require-rendered`** turns that into a gate, in the family of
  `--require-decided` (every criterion has a verdict) and `--require-sample` (every declared
  page was looked at). It asks about the INSTRUMENT, never the answer: a run that rendered a
  page and still could not settle 1.4.5 passes — that is the honest residual, and failing on it
  would push a project to manufacture a verdict. It honours `--allow-undecided`.

`orchestrate` carries the same warning into `RUNBOOK.md`, above the phase table, with the scan
command already written out.

## Limits

Even with the local probes, **reading order**, **alt relevance** and the other judgment criteria
are the AI agent's to adjudicate (gated, `verify --manual`), not the dynamic tier's. The probes
reduce — but do not eliminate — the residual on 2.4.7/1.4.4/1.4.12/1.4.13/2.5.8: confirm a sample
on screen (optional human oversight). pa11y can be added as a second source if needed.

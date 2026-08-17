# Run the audit during your E2E tests (Playwright / Cypress)

`scan` launches its **own** browser after the fact. That is a second run of your app, with
none of the state your tests just built: no login, no filled form, no opened modal. The E2E
integration inverts it — the audit runs **inside the run you already have**, on the page as
your test left it.

It ships **two ways**, with one behaviour.

**As published entry points** — when your repo already has `ultra11y` as a devDependency:

```js
import { test, checkA11y } from "ultra11y/playwright";
import ultra11y from "ultra11y/cypress/plugin";   // cypress.config.js
import "ultra11y/cypress";                         // cypress/support/e2e.js
```

Versioned, typed, and they resolve the engine that ships inside the very package you
installed, so a project can never pipe to a different build than the one it depends on.

**As install-free fixtures** — when it does not:

```
node scripts/ultra11y.mjs render --e2e            # detects Playwright / Cypress, writes the fixtures
node scripts/ultra11y.mjs render --e2e --runner cypress   # or force one
```

Fixtures land in `.ultra11y/e2e/`. They are **generated files**: no install, and they target
the engine build that produced them (`ULTRA11Y=<path>` overrides).

The two cannot drift: the fixtures interpolate the published module's severity tables rather
than restating them, and a test evaluates the generated `failingFindings` alongside the real
one over the same findings. A fixture that gated differently from the published plugin would
fail two projects differently while claiming to be the same tool.


## A page the browser did not stay on (`expectPath`)

`as`/`name` is the identity the report speaks, and the fixture applies it to whatever is on
screen. So a route your test could not open — a guarded step, an expired session — gets filed
under the requested page's name, and its sheet, screenshot and rate all describe another
screen. Nothing about the document looks wrong.

Pass the path you navigated to and the fixture refuses instead:

```js
await checkA11y(page, { as: "declaration-etape-4", expectPath: "/declaration/etape/4" });
// throws: /declaration/etape/4 landed on /declaration/etape/1 — not recording it as
// "declaration-etape-4". The state that opens this route is not the one the test built.
```

Opt-in, and path-only: a query or fragment the app appends to its own route is the same page.
`scan --sample` applies the same rule without being asked, because there the URL *is* the
instruction. A page reported missing is a bug in your seeding; a page reported under the wrong
name is a false conformance claim.

## Playwright

```js
import { test, checkA11y } from "../.ultra11y/e2e/playwright.mjs";

test("home page is accessible", async ({ page, ultra11y }) => {
  await page.goto("/");
  await ultra11y({ as: "accueil" });                 // via the fixture
});

// …or with no fixture, on any page object:
await checkA11y(page, { as: "contact", failOn: "major" });
```

## Cypress

Cypress test code runs in the **browser**, which cannot write to disk, so the collected page
round-trips through a Node task. Two files, two wiring points:

```js
// cypress.config.js
import ultra11y from "./.ultra11y/e2e/cypress-plugin.mjs";
export default defineConfig({ e2e: { setupNodeEvents(on, config) { ultra11y(on); return config; } } });

// cypress/support/e2e.js  (the supportFile)
import "../../.ultra11y/e2e/cypress-commands.mjs";
```

```js
cy.visit("/");
cy.ultra11y({ as: "accueil" });
```

## Options

| Option | Effect |
|---|---|
| `as` | the page **id** (directory name). Defaults to the slugified URL path |
| `name` | human page name for the report. Defaults to the document title |
| `failOn` | `"blocking"` (default), `"major"`, `"minor"`, or `false` to record without ever failing |
| `auth` | mark the page as sitting behind authentication |
| `sources` | source files that rendered it — findings are then reported against **your code** |
| `notes` | reproduction notes carried into the auditor ticket |

`failOn: false` is the useful one for adoption: record every page first, look at the real
backlog, then turn the gate on.

## What it does, exactly

Two steps per checked page, and the fixture owns neither:

1. the page is collected **in the browser** with the engine's own collector — DOM,
   computed-style digest, bounding boxes;
2. the payload is piped to `ultra11y snapshot write`, which persists
   `.ultra11y/pages/<id>/` **and** audits it, returning the `AuditResult`.

So the fixture knows nothing about the snapshot format, the provenance comment or the audit —
it is a pipe. There is no second implementation to drift out of sync, and any other producer
can use the same command.

## Both runners now feed the pixel tier

Playwright captures a **viewport screenshot** and sends it with the payload — that is what
feeds `rendered-contrast-pixel` (contrast over a gradient or a background image, the one case
computed styles cannot express). `screenshot: false` skips it.

Cypress used to have none: `cy.screenshot()` writes to a path Cypress chooses and names, so
the browser side never learns where the file went. The **`after:screenshot`** event is the
missing link — it hands the Node plugin the real path of the file Cypress just wrote, which
it reads back and attaches. So a Cypress-collected page gets every rule too.

The screenshot is taken **before** the collection: `cy.screenshot()` toggles a class on the
document while it captures, and serializing mid-capture would record that transient state as
if it were the page. If the event never fires, the page is recorded without a screenshot —
the criterion stays undecided, exactly as before, and is never guessed.

Everything else — the DOM, the computed styles, the boxes and the stylesheets — is identical
between the two.

## A report straight out of the test run

`checkA11y(page, { report: true })` — and `cy.ultra11y({ report: true })` — writes the per-page
report once the page is recorded — `audits/pages/index.md` plus one sheet per page, screenshots included. Off by
default: a report per checked page would be wasteful in a suite, so turn it on in a final
test, or run `pages --format report` yourself afterwards. Cypress test code cannot write
files, so there the option is declared in the browser and honoured by the Node plugin — same
option, same behaviour, because a runner that silently ignored it would be worse than one
that lacked it.

## Why the artefact matters more than the assertion

A failing assertion tells one developer, once. The **snapshot** is the durable part:

- It records the page as the browser actually built it, so the same page can be re-audited
  **offline, with no browser** — which is how CI decides rendering criteria without booting
  the app, and how the report speaks page by page.
- Because it is a full document (a component capture is a fragment), the page-scoped rules run
  on it: **RGAA 8.3** (`lang`), **8.5/8.6** (`title`), 12.6 (`main`). Those are not decidable
  from a component render, nor from source once a framework injects the document shell.
- Every finding carries `page` **and** `origin.sourceFile`, so a defect found at render time
  is reported against the code that caused it.

Commit `.ultra11y/pages/` to gate on it (`audit` ingests the directory automatically). Add
`sources` to your options and the failure message names your component instead of `dom.html`.

## Scoping

`snapshot write` audits **only the page it was handed** — never the whole pages tree — so a
test checking the contact page is never failed by the home page's backlog. Findings are
filtered to non-advisory ones before the gate: a non-normative recommendation never fails a
test.

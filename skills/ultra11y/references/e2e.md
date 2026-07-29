# Run the audit during your E2E tests (Playwright / Cypress)

`scan` launches its **own** browser after the fact. That is a second run of your app, with
none of the state your tests just built: no login, no filled form, no opened modal. The E2E
integration inverts it — the audit runs **inside the run you already have**, on the page as
your test left it.

```
node scripts/ultra11y.mjs render --e2e            # detects Playwright / Cypress, writes the fixtures
node scripts/ultra11y.mjs render --e2e --runner cypress   # or force one
```

Fixtures land in `.ultra11y/e2e/`. They are **generated files**, not a published library: no
install, and they target the engine build that produced them (`ULTRA11Y=<path>` overrides).

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

## One difference between the two runners

The Playwright fixture also captures a **viewport screenshot** and sends it with the payload,
which is what feeds the pixel tier (contrast over a gradient or a background image — the case
computed styles cannot express). Pass `screenshot: false` to skip it.

The Cypress command does **not**: `cy.screenshot()` writes to a path Cypress chooses and
names, so wiring it back into the payload reliably is more machinery than it is worth. A
Cypress-collected page therefore gets every rule except `rendered-contrast-pixel`, and that
criterion simply stays undecided for it rather than being guessed. If you need the pixel tier,
scan those pages separately (`scan <url>`), or capture them with Playwright.

Everything else — the DOM, the computed styles, the boxes and the stylesheets — is identical
between the two.

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

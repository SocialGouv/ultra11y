# The browser extension — audit the page you are looking at

`scan` needs a URL and a runtime. The E2E plugins need a test. The dev overlay needs a
component in your app. None of that helps when you are simply *looking* at a page — a
staging build, a page behind a login you just walked through by hand, someone else's site.

The extension covers that case, and it does so by being a **client of the engine you already
run**, not a second implementation of it.

```
node scripts/ultra11y.mjs dev --standard rgaa      # the side-car (loopback only)
# then load extension/ in chrome://extensions → "Load unpacked"
```

## What it does

| Button | What happens |
|---|---|
| **Audit this page** | collects the page with the engine's own collector, posts it to the side-car, which persists it as a snapshot and audits it — the findings come back and are listed |
| **Adjudicate with AI** | asks the side-car to rule on the judgment criteria (see `judgment.md`) |
| **Page-by-page grid** | opens the dashboard, where every page you audited accumulates |

Because the page is persisted as an ordinary snapshot, everything else already works on it:
`ultra11y audit` re-audits it offline, `pages --format report` writes its dossier, and it
takes its column in the grid.

## Where the boundaries are

- **The collector is fetched, never copied.** `GET /collector.js` serves the engine's own
  `COLLECT_SNAPSHOT`. A second implementation of the snapshot format living in an extension
  is how the two drift — and a drifted style digest is refused wholesale by the join check,
  so the drift would surface as silently missing verdicts.
- **The DOM goes to loopback and nowhere else.** The manifest's `host_permissions` are
  `127.0.0.1` and `localhost`, so the extension is *structurally incapable* of posting the
  page anywhere else. A test asserts it, because it is a promise made to the user.
- **The call is made from the service worker**, not from a content script: a content script's
  `fetch` runs in the audited page's origin and would be blocked by a strict `connect-src`,
  for reasons the user cannot see.
- **The API key never enters the audited page.** It lives in `chrome.storage.local`, is sent
  as a request header to the local server, and is used for the call without ever being written
  to disk or logged. Leave it empty to let the server use its own `ANTHROPIC_API_KEY`.
  Everything except that one button works with no key at all.
- **The popup decides nothing.** Every severity, criterion and verdict it shows was produced
  by the engine or refused by its gate. A gate-refused adjudication is reported as refused,
  with the audit left untouched — never as a number that implies the audit moved.

## What a green popup does NOT mean

The static engine decides a handful of criteria. « No non-conformity detected » means the
mechanical checks passed, not that the page conforms — the popup says so under every result.
The judgment criteria are ruled on by *Adjudicate with AI*, or by your coding agent through
`verify --manual`.

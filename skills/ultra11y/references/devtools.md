# See the defects while you build — `dev`

An audit at the end of a sprint finds the same defect fifty times. The cheapest moment to fix
an accessibility problem is the moment you write it, in the page you are looking at.

```
node scripts/ultra11y.mjs dev --next    # write the overlay component (once)
node scripts/ultra11y.mjs dev           # start the side-car, then run your app as usual
```

Two halves, deliberately separate:

- **the side-car** — a `node:http` server (a builtin: the zero-dependency promise holds) on
  `http://127.0.0.1:4111`. It receives collected pages, writes them as snapshots, audits them,
  and serves the dashboard.
- **the overlay** — framework-agnostic vanilla JS, served by the side-car and loaded by the
  app. A floating panel lists the current page's non-conformities; each links to its
  `file:line` and opens it in your editor through Next's own `/__nextjs_launch-editor`
  endpoint. It re-checks on every client-side navigation, not just the first paint.

## Wiring it into Next

`dev --next` writes `.ultra11y/next/overlay.jsx`. You add one line:

```tsx
// app/layout.tsx
import { Ultra11yOverlay } from "../.ultra11y/next/overlay";

<body>{children}<Ultra11yOverlay /></body>
```

A component you import, not a bundler hack — deliberately. Custom webpack configuration does
not exist under Turbopack (the Next default), and entry-point patching breaks across Next
versions; a client component does not. It **renders nothing outside development**: the whole
body short-circuits on `NODE_ENV`, so shipping it is inert.

The same overlay serves any framework — point a `<script src="http://127.0.0.1:4111/overlay.js">`
at it in dev and set `window.__ULTRA11Y_ENDPOINT__` if you moved the port.

## The dashboard

`http://127.0.0.1:4111` renders the **per-page criterion grid** (`references/pages.md`) for
every page you have visited: one row per criterion, one column per page, in the standard you
chose (`--standard rgaa`). It is a self-contained page — no external stylesheet, no script, no
network — and it accumulates as you browse. Visit five pages of your app and you have the
beginnings of a real échantillon, snapshotted and re-auditable offline.

## Two things worth knowing

**The overlay removes itself from the page before collecting.** It is DOM, and the collector
serializes DOM: left in place it would be captured, audited, and would report non-conformities
about *itself* — and, worse, its element would shift every document-order index by one and
break the join between the styles digest and the DOM. So the host is detached for the duration
of the collection and re-attached immediately after. It also lives in a shadow root, so the
app's CSS cannot reach it and its own cannot leak.

**The server binds to loopback only.** It writes files and returns audit results, so it is
never reachable from the network — `127.0.0.1`, never `0.0.0.0`. CORS is permissive because
the app runs on a different port; the loopback bind is what actually contains it. This is a
development tool, not something to expose.

## What it does NOT do

It runs the same static engine as `audit`, plus the rendered tier when the page carries
signals. It does not adjudicate the judgment criteria — alt relevance, link purpose, reading
order remain yours (`verify --manual`) — and a clean panel means "the engine found nothing
here", never "this page is accessible".

## The browser extension

The same side-car also backs a Chrome extension (`extension/`), for auditing a page you are
merely looking at — a staging build, a page behind a login you walked through by hand. It
adds `GET /health`, `GET /collector.js` and `POST /judge` to this server and holds no copy of
the engine. See `references/extension.md`.

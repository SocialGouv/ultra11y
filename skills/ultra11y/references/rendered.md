# Audit the RENDERED HTML (component libraries: DSFR, MUI…)

Auditing a component library's **JSX sources** gives **false negatives**:
`<Button iconId="fr-icon-add-line" />` (DSFR) actually renders
`<button class="fr-btn fr-icon-add-line">` where the icon is a CSS pseudo-element
(decorative) and the **accessible name comes only from `title`**. That HTML lives in
`node_modules` at runtime — no source analysis sees it. So for those components, **audit
what the JS produces**, not the source.

## Honest by default

When `audit` sees a JSX/TSX file rendering components imported from a **library** (a package
specifier, e.g. `@codegouvfr/react-dsfr`), it does not invent a verdict: it adds a **scope
risk** to the report ("preliminary source verdict — audit the build or `scan`") and names the
library(ies). A source verdict is therefore never silently "complete".

**`.vue`/`.svelte`/`.astro` single-file components are the same case.** They are parsed as
SOURCE templates (the HTML path with component case preserved), so `<slot>`/`{@render}`,
`v-for`/`{#each}`, dynamic bindings (`:aria-label`) and child components are invisible to
static analysis. Every finding raised on them is flagged **`preliminary: true`** and the run
adds a **`scope.sourceTemplate`** caveat ("audited SOURCE template only — audit the rendered
output"). Treat those verdicts as provisional: audit the rendered HTML (a static build) or
`scan` a live page before concluding, and refute any source finding the rendered DOM
disproves (`verify --apply`). See `references/false-positives.md`.

## ultra11y's render engine (`render`)

ultra11y renders the components itself. It does **not** read or run the project's tests,
`__snapshots__` or inline snapshots: those hold what a test author wrote, sometimes broken on
purpose, and they go stale.

```
node scripts/ultra11y.mjs render .      # components, pages, stories → .ultra11y/captures + .ultra11y/render.json
node scripts/ultra11y.mjs audit .       # ingests .ultra11y/captures; findings name the source component
```

- **Discovery.** Every `.tsx`/`.jsx` module of the project: its default export and its
  PascalCase exports that are React components. Next.js `app/**/page.tsx` and `pages/**` files
  are labelled with their route. Storybook stories (`*.stories.*`, CSF) are rendered with
  their `args`. Test, spec, mock, fixture and snapshot files are left out without being read;
  the manifest counts them (`testFilesIgnored`). `--include`/`--exclude` scope it,
  `--no-stories` leaves the stories out.
- **Rendering.** Each unit is rendered by the **project's own** `react-dom/server`
  (`renderToStaticMarkup`), in a throwaway harness ultra11y owns: a runner script in the OS
  temp dir, one child process per source file, the project as working directory. TSX/JSX is
  transpiled **in memory** with the transpiler the project already has — esbuild, else
  typescript, else sucrase (`--transpiler` picks one). No project file is written and no
  build runs. The harness resolves the tsconfig `paths` aliases, stubs style imports (CSS
  modules map each class to its name), static assets (their public path; an SVG is also a
  component), `next/font/*`, `server-only` and `client-only`. `fetch` is disabled: data
  fetching is reported, never performed. Each unit gets `--timeout` ms (default 10000); a
  unit past it is killed and recorded, and the rest of its file still renders.
- **Props.** A component that declares no props (or only defaulted ones) is rendered with
  none — that is what it renders. A component that **takes props** is not rendered without
  them: it would show a state no user meets (an empty label, an image without its alt). It is
  rendered through its stories when it has some (`via-story`), otherwise listed as not
  attempted (`props`). Write a story with the args a real screen passes to cover it.
- **Captures.** Each render is written to `.ultra11y/captures/<id>.html` with the provenance
  comment `<!-- ultra11y:capture v="1" source="src/Button.tsx" component="Button" name="…"
  renderer="react-dom/server 19.x" styles="none" -->`, so a finding on it is reported against
  the SOURCE component. A story is attributed to the component file beside it. A re-run
  rewrites only the captures that changed and removes the ones it no longer renders.
- **Honesty.** `.ultra11y/render.json` lists every unit: `rendered`, `skipped` with the
  reason (`provider` — a context the app mounts; `props`; `browser-api` — `window`,
  `document`, `localStorage` at render time; `data` — an async server component, a suspended
  fetch; `transpile`; `module` — an unresolved import; `timeout`; `empty`; `error`), or
  `not-attempted` (`props`, `via-story`, `unsupported-renderer` for `.vue`/`.svelte`/`.astro`,
  `no-renderer`, `no-transpiler`). `audit` reads it into `scope.renders`, and the report's
  annex (section G) lists every unit with its status and reason. A unit that throws is never
  dropped.
- **What a server render cannot decide.** It computes no style and lays out no box
  (`styles="none"`): colour, contrast, reflow, focus visibility stay « à évaluer » on these
  captures. A component capture is a fragment, so the page-level criteria (language, title)
  are not decided there either. Real pages go through Playwright (`ultra11y/playwright`) and
  `scan`.
- **React only.** Vue, Svelte and Astro components are listed as not attempted; audit their
  rendered output through a static build or `scan`.

`render --coverage` lists which components have a capture and which are still
opaque-source-only blind spots; `audit --require-captures` fails while one remains.
Commit `.ultra11y/captures` and `.ultra11y/render.json` when the pre-commit gate should see
the rendered markup: in diff-scoped mode (`--changed`/`--staged`/`--since`) the audit pulls in
the captures whose provenance points at a diffed source file. `fix` never rewrites captures.

## Other ways to get rendered HTML

`node scripts/ultra11y.mjs render --detect [<dir>]` detects the framework and prints the
"build → audit" recipe for the project (and flags the libraries it detects).

1. **Build output**: build the site/pages, then audit the emitted HTML with the static engine
   — it is real HTML, audited at full fidelity:
   ```
   npx astro build   # or next build (output:'export'), vite build…
   node scripts/ultra11y.mjs audit "dist/**/*.html"
   ```
   A bare `storybook build` does **NOT** emit one HTML file per story — `storybook-static/` is
   a single-page-app shell that renders stories client-side. The render engine renders the
   stories itself; per-story HTML produced another way (e.g. `@storybook/test-runner`) can be
   attributed to its source component with `render --storybook [<storybook-static>]
   [--captures <html-dir>]`, which renders nothing itself and fails (exit 1) when candidate
   HTML existed but none could be attributed.
2. **Headless browser**: `scan <url>` (browser tier, axe-core) against the running app — the
   most faithful, and required for the **rendering** criteria (computed contrast 1.4.3,
   reflow 1.4.10). `--merge` folds the result into a static AuditResult. During an E2E run,
   `ultra11y/playwright` records each page as your test left it (`references/e2e.md`).

## Choosing

- Components and design systems → `render`, then `audit` (and `audit --require-captures` as
  a gate).
- Full pages / SSG → build output (`dist`/`out`), then `audit`; pages behind a state →
  `ultra11y/playwright`.
- Rendering criteria (contrast, focus, zoom) → `scan` (browser).
- In all cases, do not conclude "conforming" on a library component from the source: that is
  what the scope risk reminds you — resolve it on the produced HTML (captures / `scan`), then
  let the AI agent adjudicate the criterion (`verify --manual`, gated).

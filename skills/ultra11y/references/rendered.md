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
output"). Treat those verdicts as provisional: audit the rendered HTML (a static Storybook
build is ideal for SFCs) or `scan` a live page before concluding, and refute any source
finding the rendered DOM disproves (`verify --apply`). See `references/false-positives.md`.

## Zero-touch test-render captures (recommended)

Rather than hand-write a render list, let your existing tests do the rendering. Install the
capture harvester once and every component your tests already render is serialized to a
provenance-tagged `.html` the static engine audits at full fidelity — the real markup a
library/SFC emits, not its source call:

```
node scripts/ultra11y.mjs render --setup     # writes .ultra11y/capture-setup.mjs + prints the runner wiring
# wire it into your runner (Vitest: setupFiles + globals:true; Jest: setupFilesAfterEnv), then:
npm test                                      # every rendered component → .ultra11y/captures/*.html
node scripts/ultra11y.mjs audit              # auto-ingests .ultra11y/captures; findings attribute to the source component
```

- **Attribution.** Each capture carries `<!-- ultra11y:capture source="src/Button.tsx" component="Button" … -->`,
  so a finding on the rendered DOM is reported against the SOURCE component, not the anonymous
  capture file. Storybook/manual dumps with no marker still audit as plain HTML.
- **Coverage + gate.** `render --coverage` lists which components have a capture vs which are
  still opaque-source-only blind spots; `audit --require-captures` fails when an opaque/control
  component lacks one — so "all components" actually get rendered-DOM coverage.
  `.vue`/`.svelte`/`.astro` self-defined components now count in this coverage universe too
  (previously invisible to the graph), so a previously-green `--require-captures` gate can newly
  report blind spots on an SFC-heavy repo — that is intended (a named blind spot beats
  invisibility); capture those components or scope the gate.
- **Commit `.ultra11y/captures`.** In diff-scoped mode (`--changed`/`--staged`/`--since`) the
  audit automatically pulls in the captures whose provenance points at a diffed source file —
  the pre-commit gate sees the real rendered markup for a touched component even though the
  (unchanged) capture itself isn't part of the diff. After a component change, re-run your
  tests so its capture refreshes, and stage the refreshed capture with the source change.
  `fix` never rewrites captures (generated output). Add `.gitattributes`:
  `.ultra11y/captures/*.html text eol=lf` for stable cross-platform diffs.
- **Storybook**: with **portable stories** (composeStories) rendered in your test suite, the
  harvester captures them for free. For per-story HTML produced another way (e.g.
  `@storybook/test-runner`), `render --storybook [<storybook-static>] [--captures <html-dir>]`
  attributes each file to its source component via the Storybook index, into `.ultra11y/captures`.
- ultra11y renders nothing itself — your test toolchain (jsdom/happy-dom) does. Disable with `ULTRA11Y_CAPTURES=off`.
- The harvester pipeline is covered by a real end-to-end test in ultra11y's own suite (a
  spawned vitest+jsdom project renders, the capture lands with correct provenance, and the
  engine ingests it) — the escaping scheme it embeds is locked byte-identical to the parser's.

## Unit-test snapshots (`__snapshots__/*.snap`) — nothing to install

The project's Jest/Vitest snapshot files already hold what its components rendered. `audit`
reads every `.snap` in scope: one **component** document per entry whose value is markup —
Testing Library's pretty-format DOM (`container`, `asFragment()`), react-test-renderer's
`toJSON()` (`className`, `onClick={[Function]}` → plain HTML), an `innerHTML` string snapshot.

- Each finding sits on the `.snap` **file and line** of the element, and names the entry
  (`origin.snapshot`, printed under the occurrence). It is attributed to `Button.tsx` when that
  file sits beside `Button.test.tsx`.
- A component, never a page: the page-scoped rules (title, lang) stay off. Rendered by jsdom:
  no computed style, so contrast, reflow and focus stay « à évaluer ».
- Skipped, and counted in `scope.unitSnapshots`: objects, prose, numbers, and shallow renders
  (`<Button>` is the component call, not its output).
- Snapshots are audited even under `__tests__/` — they are product output, not hand-typed
  fixtures. A suite that snapshots deliberately broken markup opts out with
  `--exclude "**/__snapshots__/**"`. A snapshot is never rewritten by `fix`: fix the component,
  then `vitest -u` / `jest -u`.
- Inline snapshots too: each `toMatchInlineSnapshot(`…`)` literal (after a property matcher
  or not) of a `.test`/`.spec` JS/TS file is dedented as the runner compares it and read the same
  way — findings on the **test file** and the literal's line, named after the enclosing
  `it`/`test` title (`inline snapshot @ line N` outside one). Only the markup literals: the rest
  of the test file stays a test artifact, never audited. Counted in `scope.unitSnapshots`
  (`inline`: how many of the `entries` were inline).

## Check a render inside the test (`ultra11y/vitest`, `ultra11y/jest`)

```js
import { checkA11y, toBeAccessible } from "ultra11y/vitest"; // or "ultra11y/jest"
expect.extend({ toBeAccessible });

const { container } = render(<Button variant="primary" />);
await checkA11y(container, { as: "button-primary", failOn: "major" });
expect(container).toBeAccessible();
```

Accepts an element, `asFragment()`, a render result, a document (its body) or an HTML string.
Each check writes `.ultra11y/captures/<id>.html` (`capture write`, the same capture format as
`render --setup`, marked `runner="vitest" env="jsdom" styles="none"`; without `as`, the id is
the test file's repo-relative path and the test title, slugged) and audits it; `failOn`
(`blocking` by default, `false` to record only) decides the test. Commit the captures: `audit`
re-reads them offline. `render --setup` remains the zero-touch way to record every render.

## Get rendered HTML

`node scripts/ultra11y.mjs render [<dir>]` detects the framework and prints the
"build → audit" recipe for the project (and flags the libraries it detects). Other routes,
simplest to most faithful:

1. **Build output** (recommended): build the site/pages, then audit the emitted HTML with the
   static engine — it is real HTML, audited at full fidelity:
   ```
   npx astro build   # or next build (output:'export'), vite build…
   node scripts/ultra11y.mjs audit "dist/**/*.html"
   ```
   **Storybook is the one exception**: a bare `storybook build` does **NOT** emit one HTML
   file per story — `storybook-static/` is a single-page-app shell (`iframe.html`/`index.html`)
   that renders stories client-side; auditing `storybook-static/**/*.html` sees only that shell,
   not your components. Get REAL per-story HTML first, either via `@storybook/test-runner`
   (renders every story in a real browser — dump/audit its output) or **portable stories**
   (`composeStories`) rendered in your OWN test suite, where the zero-touch capture harvester
   (`render --setup`) captures them for free. Only then does `render --storybook
   [<storybook-static>] [--captures <html-dir>]` do anything useful: it ATTRIBUTES that
   already-produced per-story HTML to its source component via the Storybook index — it does
   not render anything itself. Point it at nothing but the shell and it now fails honestly
   (exit 1, not a silent no-op) when candidate HTML existed but none could be attributed.
2. **SSR snapshot**: `render --scaffold` writes `ultra11y-render.tsx`, a `react-dom/server`
   harness (`renderToStaticMarkup`) that imports **your** components and writes HTML into
   `audits/rendered/`. **The written file is INERT until you fill in `COMPONENTS`** — running
   it as-is writes nothing (it self-reports `COMPONENTS is empty` and exits), and the CLI's own
   write-time message says so. Fill in the list, run it with your toolchain (`npx tsx
   ultra11y-render.tsx`), then audit `audits/rendered`. ultra11y does not embed React — your
   project renders.
3. **Headless browser**: `scan <url>` (browser tier, axe-core) against the running app — the
   most faithful, and required for the **rendering** criteria (computed contrast 1.4.3, reflow
   1.4.10). `--merge` folds the result into a static AuditResult.

## Choosing

- Components WITH a test suite → their `.snap` files (read as they are), the
  `ultra11y/vitest`/`ultra11y/jest` helper in the tests that matter, or zero-touch captures
  (`render --setup`), then `audit --require-captures`.
- Components / design system (no tests) → portable stories + `@storybook/test-runner` (real
  per-story HTML, then `render --storybook` to attribute it) **or** an SSR snapshot
  (`render --scaffold`), then `audit`. A bare `storybook build` alone is NOT enough (see above).
- Full pages / SSG → build output (`dist`/`out`), then `audit`.
- Rendering criteria (contrast, focus, zoom) → `scan` (browser).
- In all cases, do not conclude "conforming" on a library component from the source: that is
  what the scope risk reminds you — resolve it on the produced HTML (captures / `scan`), then let
  the AI agent adjudicate the criterion (`verify --manual`, gated).

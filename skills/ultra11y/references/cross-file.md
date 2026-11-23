# Cross-file analysis (`audit --graph`)

By default the engine audits **each file in isolation**. `--graph` (alias `--cross-file`)
adds a pass that **resolves imports between files**, builds a dependency + component graph,
and applies rules only the cross-file context makes visible — **without a browser** (no
Playwright). It complements the per-file static engine and the optional dynamic tier
(`scan`): all three feed the **same** `AuditResult`.

```
node scripts/ultra11y.mjs audit "src/**/*.tsx" --graph --json > audit.json
node scripts/ultra11y.mjs audit --changed --graph     # git diff, graph over the whole scope
```

## How it works (and why it scales)

- **Real AST**: `.jsx/.tsx` are parsed by a real JS/TS/JSX parser (`@babel/parser`, embedded
  in the bundle — still "no install"), not regex normalization. `PascalCase` components keep
  their case (per-file rules ignore them; only cross-file rules resolve them); native
  elements stay lowercase.
- **Two passes, bounded memory**: pass 1 — read each file, extract a small *graph node*
  (imports, components + render-control signals, ids, `<html lang>`, a Next.js metadata
  title), then **drop** the AST/Doc. Pass 2 — the usual audit loop, which also runs the
  cross-file rules with the graph in hand. The whole repo is never held in memory: O(number of files) small nodes.
- **`--changed --graph`**: the graph indexes the **whole** scope (to resolve a reference into
  an unchanged definition), but only the diffed files are audited.
- **Plain `.ts`/`.js` modules are graphed, never audited.** The graph's own discovery widens
  to `.ts`/`.js`/`.mjs`/`.cjs` on top of the markup allowlist: a **barrel**
  (`components/index.ts` re-exporting `Button.tsx`) or a plain-JS component definition is
  real cross-file structure that imports resolve through — chained re-exports
  (`export { Button } from "./Button"`, barrels of barrels) are followed to the real
  definition. Those files feed imports/re-exports/definitions/ids into the graph but never
  enter the audit loop (no markup rule ever runs on them).
- **`.vue`/`.svelte`/`.astro` SFCs are first-class graph nodes.** Parsed with component case
  preserved (same as the audit); the file's own `<script>` block — or an `.astro` file's
  `---…---` **frontmatter** — is parsed separately as a script AST for its imports; and each
  SFC synthesizes a self component definition (PascalCase basename), so a `.tsx` importing
  `./Widget.vue` resolves cross-file and the SFC counts in capture coverage. Astro
  frontmatter is also stripped (offset-preserving) before the template parse, so frontmatter
  TypeScript (`Array<string>`) never produces phantom elements or findings.
- **Import resolution**: relative specifiers (`./IconButton`), **tsconfig-paths aliases**
  (`@/components/Icon`, read from the nearest `tsconfig.json`'s `baseUrl`/`paths`), and
  **namespace members** (`<UI.Button/>` from `import * as UI`) all resolve to a discovered
  file. *Bounds (documented, never a silent false "conforming"):* bare `node_modules`
  specifiers (`react`) are out of scope; alias bases are resolved relative to the working
  dir (run the audit from the project root); React **context** value flow and dynamic
  `import()` are not traced.

## The cross-file rules

- **`cross-icon-only-unnamed`** (WCAG 2.4.4/4.1.2, *flag*): a component that renders an
  **icon-only** control and *can* receive a name (`{...props}` / `aria-label={…}` /
  `{children}`) is used **without a name**. The flag is placed **at the usage site**, with the
  component **definition** in `related`.
- **`cross-prop-drilled-name-lost`** (WCAG 4.1.2, *flag*): a usage passes an accessible-name
  prop (`aria-label`/`label`/…) to a component that renders a control but **neither spreads
  `{...props}` nor forwards a name** to it → the name is silently dropped. Flagged at the
  usage, with the control **definition** in `related`.
- **`cross-aria-ref-cross-file`** (WCAG 4.1.2, *suppression*): an `aria-labelledby`/
  `aria-describedby`/`aria-controls` whose target id lives in **another** file →
  suppresses the false `aria-ref-missing-id`. Suppressed only when **every** in-page-missing
  id resolves elsewhere, so a genuinely-dangling reference is never hidden.
- **`cross-aria-forwarding`** (WCAG 4.1.2, *suppression*): a native control that forwards
  `{...props}` is nameable by its parent → it **suppresses** the false
  `button-empty-name`/`icon-only-control-unnamed` on the **definition**.
- **`cross-skip-link-target`** (WCAG 2.4.1, *suppression*): an `href="#id"` anchor whose
  target lives in **another** file (imported layout/component) → suppresses the false "broken
  anchor". A target missing everywhere stays a true positive.
- **`cross-page-lang`** (WCAG 3.1.1, *suppression*): an `<html>` without `lang` whose imported
  layout/wrapper declares the language → suppresses the false positive.
- **`cross-next-metadata-title`** (WCAG 2.4.2, *suppression*): a shell component whose
  `<head>` has no `<title>`, rendered by Next.js App Router routes (`app/**/layout|page`,
  directly or through components and barrels) that **all** get a title from the metadata API
  (`metadata.title` / `generateMetadata`, in the route or a layout above it) → suppresses the
  false `title-missing-empty`. A shell no route renders, or rendered by one route with no
  metadata title, keeps its finding. Without `--graph`, a metadata layout in scope leaves 2.4.2
  open (manual, residual risk) for a title-less shell outside `app/` instead of failing it.
- **`cross-name-ref-cross-file`** (WCAG 1.3.1, *suppression*): a `<label for="id">` or a
  heading/`aria-labelledby` whose target id is **defined in another** file → suppresses the
  false `label-for-dangling` / empty-heading. Suppressed only when the id resolves elsewhere.

## Benefit for `fix`

Because the AST indexes the **real file** (exact offsets, non-*lossy* `Doc`), `fix` can apply
its *safe* codemods on JSX/TSX (remove redundant ARIA, insert `alt`/`lang`/`title`/
`aria-label`), always behind the anti-regression gate. Codemods that **rewrite** an attribute
name stay disabled on JSX (so `tabIndex={5}` is never turned into `tabindex="0"`).

> Cross-file flags merge into the same `AuditResult`: `report`, `prd`, `check` and `verify`
> consume them unchanged.

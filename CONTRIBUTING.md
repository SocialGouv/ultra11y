# Contributing to ultra11y

Thanks for helping make the web accessible everywhere. ultra11y's engine is keyed on
**WCAG 2.2 Level AA** — the worldwide standard. Country-specific standards (France's
RGAA, the US Section 508, the EU's EN 301 549, Canada/Ontario's AODA, …) ship as
**standards packs**: small, self-contained JSON files that map a national standard's
criteria onto WCAG success criteria. Adding your country is a single PR.

## Repo basics

- Node ≥ 22.18, pnpm. `pnpm install`, then:
  - `pnpm test` — Vitest suite
  - `pnpm typecheck` — `tsc --noEmit`
  - `pnpm lint` / `pnpm lint:fix` — Biome
  - `pnpm run build` — bundle the engine (tsup → `scripts/ultra11y.mjs`, mirrored into the skill)
  - `pnpm run check:build` — verify the bundle is reproducible and the skill bundle is intact
- The engine is **zero runtime dependencies** and **install-free** (`npx skills add maxgfr/ultra11y`).
  Anything you add must keep that true: data is bundled via static `import`, never read from disk at runtime.

## Adding a country standards pack

A pack is `src/data/standards/<key>.json` (plus an optional `<key>.glossary.json`) registered in
`src/standards/registry.ts`. RGAA is the reference example — read `src/data/standards/rgaa.json` and
`scripts/build-pack-rgaa.mjs` first.

### 1. Author the pack JSON

Shape (see `src/standards/types.ts` for the authoritative types):

```jsonc
{
  "key": "section508",                       // unique slug; MAY NOT be "wcag" (reserved core key)
  "name": "Section 508",
  "fullName": "Revised Section 508 (US)",
  "org": "U.S. Access Board",
  "country": "US",
  "baseVersion": "2018",
  "wcagVersion": "2.0",                       // the WCAG version this standard incorporates
  "locales": ["en"],
  "defaultLocale": "en",                      // REQUIRED; every LocaleString must carry it
  "license": "Public Domain (US Government work)",
  "source": "https://www.access-board.gov/ict/",
  "attribution": "Revised Section 508 — U.S. Access Board",
  "idPattern": "^E?\\d+\\.\\d+(\\.\\d+)?$",   // regex your criterion ids match
  "vocabulary": {                             // OPTIONAL — the auditor-display nouns (see standards.md)
    "theme": { "en": "Chapter" },             //   what your standard calls a theme / grouping
    "criterion": { "en": "Provision" },       //   … a criterion / item
    "test": { "en": "Requirement" },          //   … a test / sub-item
    "conformant": { "en": "Supports" },       //   … the "conformant" verdict
    "nonConformant": { "en": "Does not support" },
    "notApplicable": { "en": "Not applicable" },
    "auditorHeading": { "en": "Accessibility criterion" }
  },
  "themes": [{ "number": 1, "name": { "en": "…" }, "count": 1 }],
  "criteria": [
    {
      "id": "E205.4",
      "theme": 1,
      "title": { "en": "Accessibility Standard (WCAG)" },
      "titlePlain": { "en": "Accessibility Standard (WCAG)" },
      "wcag": ["1.1.1", "1.4.3", "4.1.2"]     // bare WCAG SC ids this criterion maps to
    }
  ]
}
```

Rules of the road:
- **`title`/`name` are `LocaleString`s** (`{ "en": "…", "fr": "…" }`). The pack's `defaultLocale`
  is mandatory on each; **English is strongly recommended** for worldwide readability. A national
  standard that is genuinely single-language (like RGAA, fr-only) is fine. Locale keys are
  free-form BCP-47-ish tags (`pt-BR`, `nl-BE`, …) validated by shape only — a pack's languages
  are decoupled from the CLI's own `--lang fr|en` UI frame. When `defaultLocale` is `fr`/`en`,
  it also feeds the CLI's `--lang auto` fallback chain (conversation → repo `<html lang>` →
  the pack's `defaultLocale` → English).
- **`idPattern` is the gate's id grammar.** `check` and `verify` build their criterion-citation
  regex FROM your pack's own `idPattern` (capture groups are neutralized automatically), so ANY
  id shape works out of the box — RGAA's `8.3`, a Section-508-style `E205.4`, whatever your
  standard uses. There is no fixed 2-segment constraint; the only requirement is that the
  pattern compiles and every criterion id matches it (`pack check` verifies both).
- **`wcag` holds bare 3-segment SC ids** (`"1.4.3"`, not `"1.4.3 Contrast (Minimum) (AA)"`).
- A criterion may map to a WCAG SC outside the 2.2 **AA** core (e.g. an AAA SC, or 4.1.1 Parsing
  which 2.2 removed) — real WCAG SCs the full WCAG universe recognizes (`src/wcag.ts`
  `knownScStatus`), not a single hardcoded exception. That's allowed: it won't receive an engine
  verdict, and if EVERY SC a criterion maps to is out-of-core, the derived report surfaces it
  under the *manual* section with a dedicated "out of engine scope" justification — never a
  silent *not applicable* (see `derivePackResults`'s `outOfScope` flag). Don't invent SC ids;
  every id you cite that IS in the core must resolve (`pnpm test` checks this).
- The pack does **not** carry engine rules or automatability. Those live in the WCAG core
  (`scripts/build-standards.mjs`); your pack only declares the criterion↔WCAG-SC mapping.
- **`vocabulary` is optional** (`LocaleString`s). It sets the nouns the `prd` auditor block +
  GitHub issues render — what your standard calls a *theme*, a *criterion*, a *test*, and its
  three conformance verdicts, plus an optional section heading and normative note. Anything you
  omit falls back to a generic default and the WCAG core keeps its own set, so a pack that ships
  no `vocabulary` still renders. This is what lets the auditor output speak your standard's
  language instead of RGAA's or WCAG's (see `references/standards.md` → *Auditor vocabulary*).
- Pick a redistributable source/licence and record it in `license` + `attribution`, the way the
  RGAA pack cites DINUM / Licence Ouverte Etalab 2.0. If the official text isn't redistributable,
  derive only the public criterion list + WCAG mapping and cite the source.

If your standard has an official machine-readable source, add a `scripts/build-pack-<key>.mjs`
(model it on `scripts/build-pack-rgaa.mjs`) that fetches/transforms it, and vendor a pinned copy
of the source under `scripts/vendor/<key>/` so the build is reproducible offline.

### 2. Register it

In `src/standards/registry.ts`, add a static import + one `register(...)` line (static imports are
required so the bundler inlines your pack — no runtime filesystem/glob):

```ts
import section508 from "../data/standards/section508.json";
// …
register(section508 as unknown as StandardPack, {} /* or your glossary */);
```

### 3. Add tests

Extend `tests/packs.test.ts` (or add `tests/packs-<key>.test.ts`): assert the header, that every
criterion carries the default locale, that ids match `idPattern`, and that every cited in-core SC
resolves via `hasSC`. Then `pnpm test` + `pnpm typecheck` + `pnpm lint` must be green.

### 4. Regenerate derived docs + bundle

```bash
node scripts/build-standards.mjs       # re-seed WCAG techniques from packs (deterministic)
node scripts/ultra11y.mjs criteria --generate > skills/ultra11y/references/criteria.md  # if applicable
pnpm run build && pnpm run check:build
```

### Using a pack

```bash
node scripts/ultra11y.mjs audit "src/**/*.html" --out audits        # WCAG-keyed audit (canonical)
node scripts/ultra11y.mjs report --in audits/audit-latest.json --standard section508
node scripts/ultra11y.mjs criteria --standard section508 --theme 1
```

### Runtime packs, guidance & AI ingestion

You don't have to ship a pack to use one. The same `StandardPack` JSON can be loaded
**at runtime** — no rebuild — with `--pack ./pack.json` (a file, or a directory holding
`pack.json` + optional `glossary.json`/`guidance.json`) or a `.ultra11yrc.json`. Whichever
route you take, the **same validator** runs first, and the `pack` command is the gate:

```bash
node scripts/ultra11y.mjs pack scaffold > pack.json                  # a blank, valid skeleton
node scripts/ultra11y.mjs pack check pack.json --guidance guidance.json   # fail-loud gate
```

`pack check` is the **anti-hallucination gate**: a fabricated SC (not a real WCAG SC), a
guidance entry whose `criterionId` doesn't resolve, or an unparseable code example fails
it. This is what makes **AI-assisted ingestion** safe — point the agent at an external
rule source (e.g. the RGAA SocialGouv/etalab rule packs), have it draft the pack + a
**guidance** dataset (concrete before/after implementation rules; see
`skills/ultra11y/references/guidance.md`) + proposed detectors, then iterate against
`pack check` until green. A deterministic fast-path scaffolder lives at
`scripts/import-pack.mjs`. Honesty rule for detectors: only add an engine rule for a
pattern that is statically decidable **and** maps to an SC in the WCAG 2.2 AA core;
everything else is guidance + residual risk, never silently conforming.

**You do not have to write guidance to get guidance.** Every guidance entry declares the
WCAG success criteria it implements, and a lookup walks every registered dataset — so the
moment your criteria carry their `wcag[]` mappings, they inherit the whole shipped corpus
(the RGAA patterns plus the WCAG-keyed set that covers what RGAA never reached). Inherited
entries are marked `inherited: true` / `via: "wcag:<sc>"` wherever they surface, so an
example borrowed through the crosswalk is never presented as your standard's own doctrine.
Write your own entries only where your standard genuinely differs.

Your pack also reaches the **MCP reference surface** for free: `ultra11y_criteria`,
`ultra11y_glossary`, `ultra11y_guidance`, `ultra11y_method` and the `std://<key>/…`
resources all resolve it, with no extra registration. See
`skills/ultra11y/references/mcp.md`.

## PR checklist

- [ ] Pack JSON validates; ids match `idPattern`; every in-core SC resolves.
- [ ] Registered in `src/standards/registry.ts` (static import).
- [ ] Tests added; `pnpm test`, `pnpm typecheck`, `pnpm lint` green.
- [ ] `pnpm run check:build` green (bundle reproducible).
- [ ] Source + licence recorded in `license` / `attribution`; `NOTICE` updated if you vendor source text.
- [ ] One conventional-commit (`feat: add <country> standards pack`); no unrelated changes.

## Engine rules & WCAG core

Changes to the static rules, the WCAG dataset, or automatability classes are bigger and standard-wide.
Open an issue first. The WCAG 2.2 dataset is derived from the W3C source (https://github.com/w3c/wcag)
by `scripts/build-standards.mjs` — never hand-edit `src/data/wcag.json`.

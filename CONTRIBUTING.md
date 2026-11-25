# Contributing to ultra11y

Thanks for helping make the web accessible. ultra11y audits against **RGAA 4.1.2**, the
French State's accessibility standard, and that is the only standard it reports against.
Internally the engine is keyed on **WCAG 2.2 Level AA** success criteria — every RGAA
criterion cites the WCAG criteria it maps onto, and the RGAA results are derived from them —
but WCAG never reaches a reader except as that mapping (« RGAA 1.1 (WCAG 1.1.1) »).

## Repo basics

- Node ≥ 22.18, pnpm. `pnpm install`, then:
  - `pnpm test` — Vitest suite
  - `pnpm typecheck` — `tsc --noEmit`
  - `pnpm lint` / `pnpm lint:fix` — Biome
  - `pnpm run build` — bundle the engine (tsup → `scripts/ultra11y.mjs`, mirrored into the skill)
  - `pnpm run check:build` — verify the bundle is reproducible and the skill bundle is intact
- The engine is **zero runtime dependencies** and **install-free** (`npx skills add SocialGouv/ultra11y`).
  Anything you add must keep that true: data is bundled via static `import`, never read from disk at runtime.

## The RGAA data

The RGAA criteria, tests, glossary and their WCAG mapping live in `src/data/standards/rgaa.json`
(+ `rgaa.glossary.json`), built from the official DINUM source by `scripts/build-pack-rgaa.mjs`
(`pnpm build:pack:rgaa`, checked by `pnpm check:pack:rgaa`) — never hand-edit them. The JSON
"pack" format and its loader (`src/standards/`) are internal plumbing: there is no user-facing
command or flag to load another standard.

## PR checklist

- [ ] Tests added; `pnpm test`, `pnpm typecheck`, `pnpm lint` green.
- [ ] `pnpm run check:build` green (bundle reproducible).
- [ ] Every user-visible output speaks RGAA first; WCAG only as the mapping.
- [ ] One conventional commit; no unrelated changes.


## Engine rules & WCAG core

Changes to the static rules, the WCAG dataset, or automatability classes are bigger and standard-wide.
Open an issue first. The WCAG 2.2 dataset is derived from the W3C source (https://github.com/w3c/wcag)
by `scripts/build-standards.mjs` — never hand-edit `src/data/wcag.json`.

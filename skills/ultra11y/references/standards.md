# The standard — RGAA 4.1.2, with WCAG as its mapping

ultra11y audits against **RGAA 4.1.2**, the French State's accessibility standard (13
thématiques, 106 critères, © DINUM, Licence Ouverte / Etalab 2.0). It is the default and the
only standard: every report, grid, rate, ticket and PRD speaks RGAA. `--standard rgaa` is
accepted for scripts that pass it; `--standard wcag` was removed and exits 2.

## Model

- **RGAA is what a reader sees.** Each RGAA criterion cites the WCAG success criteria it maps
  onto, and that is the only place WCAG appears in an output: « RGAA 1.1 (WCAG 1.1.1) ».
- **WCAG 2.2 AA is internal plumbing.** The engine's rules are keyed by WCAG success criterion
  (55 SC, Level A + AA, derived from the W3C source), `adjudication.json` is WCAG-keyed, and
  `derivePackResults` projects those results onto the RGAA criteria with the NC-dominates rule
  and each criterion's own `appliesTo` scoping. The audit JSON carries that core under `core`,
  where no rendering looks.
- **French WCAG titles are the official W3C AUTHORIZED translation**
  (https://www.w3.org/Translations/WCAG22-fr/, vendored at `scripts/vendor/wcag-2.2-fr.json`),
  so even the mapping cites normative wording, never a machine translation.
- **Out-of-core mappings are explicit.** An RGAA criterion whose mapping is entirely outside the
  AA core derives as **out of engine scope** — status `manual` with a dedicated justification,
  never a silent NA. Shipped example: **RGAA 8.1** (doctype → the removed WCAG 4.1.1).

## Reference lookup

```
node scripts/ultra11y.mjs criteria --theme 1          # an RGAA thématique
node scripts/ultra11y.mjs criteria 8.3                # one RGAA criterion (shows its WCAG mapping)
node scripts/ultra11y.mjs criteria --glossary lien    # a term RGAA DEFINES (normative)
node scripts/ultra11y.mjs criteria 1.4.3              # a WCAG mapping target, with the RGAA criteria citing it
node scripts/ultra11y.mjs criteria --plan             # the work plan per evidence tier
```

`criteria --plan` gives, for each evidence tier (source, cross-file, rendered page, browser,
judgment, out of scope), how many RGAA criteria it is the cheapest tier to prove conformant —
read from the engine's own rule applicability, not from the wording. 104 of 106 need more than
source to earn C. `--json` gives the same plan as data.

## Auditor vocabulary

The `prd` **auditor block** and the **tickets** speak RGAA's own nouns: Thématique, Critère,
Test, Conforme (C), Non conforme (NC), Non applicable (NA), « Critère d'accessibilité ».
`--lang fr|en` picks the locale; resolution lives in `src/standards/vocabulary.ts` and the RGAA
terms are set in `scripts/build-pack-rgaa.mjs`.

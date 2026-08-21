// Generic pack loader: localized lookups over a StandardPack (the genericized
// successor of the old src/rgaa.ts criterion/theme/glossary helpers).
import type { StandardPack, PackCriterion, LocaleString } from "./types.js";
import type { Lang, GlossaryEntry } from "../types.js";
import { packGlossary } from "./registry.js";

/** Resolve a localized string: requested lang → pack default → English → first available.
 *  `lang` is deliberately `string`, not the UI frame's `Lang` — a pack's own locales
 *  (`LocaleString` keys) are not constrained to "fr"|"en" (see src/standards/types.ts). */
export function localize(pack: StandardPack, s: LocaleString | undefined, lang: string): string {
  if (!s) return "";
  return s[lang] ?? s[pack.defaultLocale] ?? s.en ?? Object.values(s)[0] ?? "";
}

export function allCriteria(pack: StandardPack): PackCriterion[] {
  return pack.criteria;
}

export function getCriterion(pack: StandardPack, id: string): PackCriterion | undefined {
  return pack.criteria.find((c) => c.id === id);
}

export function hasId(pack: StandardPack, id: string): boolean {
  return pack.criteria.some((c) => c.id === id);
}

export function listTheme(pack: StandardPack, n: number): PackCriterion[] {
  return pack.criteria.filter((c) => c.theme === n);
}

export function themeName(pack: StandardPack, n: number, lang: Lang): string | undefined {
  const t = pack.themes.find((x) => x.number === n);
  return t ? localize(pack, t.name, lang) : undefined;
}

export function title(pack: StandardPack, c: PackCriterion, lang: Lang): string {
  return localize(pack, c.title, lang);
}

export function titlePlain(pack: StandardPack, c: PackCriterion, lang: Lang): string {
  return localize(pack, c.titlePlain, lang);
}

/** The criterion's own numbered test ids, in pack order: RGAA 11.1 → ["11.1.1", "11.1.2",
 *  "11.1.3"]. These are what an auditor actually rules on, and what a `normativeRef` must
 *  cite, so several surfaces render them (the auditor block, the report's to-rule-on list,
 *  the PRD, the adjudication worklist, the per-page grid). Centralised here so the id shape
 *  is defined once — it used to be re-derived inline at each call site.
 *
 *  Callers render these inside backticks, never followed by an em dash: `check`'s criterion
 *  scanner matches `(\d+\.\d+)\s*—` and would capture "2.1" out of "6.2.1 — …". */
export function packTestIds(pack: StandardPack, id: string): string[] {
  const tests = getCriterion(pack, id)?.tests;
  return tests ? Object.keys(tests).map((k) => `${id}.${k}`) : [];
}

/** Where the standard publishes this criterion, from the pack's `criterionUrl` template.
 *  Undefined when the pack declares none — the engine never guesses a URL for a standard. */
export function criterionUrl(pack: StandardPack, id: string): string | undefined {
  return pack.criterionUrl ? pack.criterionUrl.replaceAll("{id}", id) : undefined;
}

export function resolveGlossary(packKey: string, anchor: string): GlossaryEntry | undefined {
  return packGlossary(packKey)?.[anchor];
}

// A criterion's tests refer constantly to normatively-defined terms
// (`[alternative textuelle](#alternative-textuelle-image)`). The definitions live in the
// pack's glossary — 119 entries for RGAA — and they are normative: "relevant" and "if
// necessary" mean what the glossary says they mean. Attaching the ones THIS criterion's
// tests actually cite makes a criterion lookup self-sufficient.
const GLOSSARY_REF = /\[[^\]]+\]\(#([^)]+)\)/g;

/** The glossary anchors a criterion's tests / notes / particular cases refer to, in order. */
export function glossaryAnchorsOf(crit: { tests?: Record<string, string[]>; technicalNote?: string[]; particularCases?: string[] } | undefined): string[] {
  if (!crit) return [];
  const texts = [...Object.values(crit.tests ?? {}).flat(), ...(crit.technicalNote ?? []), ...(crit.particularCases ?? [])];
  const seen = new Set<string>();
  for (const t of texts) {
    GLOSSARY_REF.lastIndex = 0;
    for (let m = GLOSSARY_REF.exec(t); m; m = GLOSSARY_REF.exec(t)) if (m[1]) seen.add(m[1]);
  }
  return [...seen];
}

/** Replace every unescaped `(` that does NOT open a special construct with a
 *  non-capturing `(?:` — i.e. neutralize the pattern's OWN capturing groups.
 *  Leaves alone: an escaped literal (`\(`) and any `(?...` construct (`(?:`, `(?=`,
 *  `(?!`, `(?<=`, `(?<!`, a named group `(?<name>`…). Used by `idCaptureSource` so a
 *  pack `idPattern` that itself contains capturing groups (e.g. `^E(\d+)\.(\d+)$`,
 *  legal and accepted by `validatePack`) can never shift the positional captures of a
 *  caller (check.ts/verify.ts's NC-header regex reads title/file/line/selector by
 *  index) — after neutralization, embedding the result as ONE outer group always
 *  contributes exactly that one capturing group, regardless of pack authoring. */
export function neutralizeCaptureGroups(pattern: string): string {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "\\") {
      out += ch + (pattern[i + 1] ?? "");
      i++;
      continue;
    }
    out += ch === "(" && pattern[i + 1] !== "?" ? "(?:" : ch;
  }
  return out;
}

/** The pack's `idPattern` with its full-match anchors (`^`/`$`) stripped and its own
 *  capturing groups neutralized (see `neutralizeCaptureGroups`), for embedding as a
 *  SINGLE capture group inside a larger line pattern — the generic seam `check.ts`/
 *  `verify.ts` use to recognize THIS standard's own criterion-id grammar in a rendered
 *  report (WCAG's fixed 3-segment "1.4.3", or a pack's own shape: RGAA "8.3", a
 *  hypothetical Section 508 "E205.4"…). `idPattern` is validated compilable by
 *  `validatePack` before a pack is ever registered, so this is always a legal regex
 *  source. */
export function idCaptureSource(pack: StandardPack): string {
  return neutralizeCaptureGroups(pack.idPattern.replace(/^\^/, "").replace(/\$$/, ""));
}

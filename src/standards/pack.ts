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

/** A criterion's numbered tests WITH their wording — the unit an auditor actually signs off,
 *  so an acceptance criterion can name it instead of the success criterion it projects onto.
 *
 *  The wording is stripped of the glossary link syntax the pack stores it in
 *  (`[alternative textuelle](#alternative-textuelle-image)` → `alternative textuelle`): a
 *  Given/When/Then line is read, not clicked, and the anchors resolve nowhere outside a
 *  criterion lookup. A test with several sentences is joined; `criteria --standard <pack>
 *  <id>` is where the full text lives. */
export function packTests(pack: StandardPack, id: string): { id: string; wording: string }[] {
  const tests = getCriterion(pack, id)?.tests;
  if (!tests) return [];
  return Object.entries(tests).map(([k, sentences]) => ({
    id: `${id}.${k}`,
    wording: (Array.isArray(sentences) ? sentences.join(" ") : String(sentences)).replace(/\[([^\]]+)\]\(#[^)]+\)/g, "$1").trim(),
  }));
}

/** The criterion's tests NARROWED to the ones a set of findings actually cited — the subset a
 *  non-conformity is a claim about, rather than everything the criterion could have been
 *  failed on.
 *
 *  `refs` are raw `normativeRef` strings, taken from the findings by the caller: this stays a
 *  pure function over the pack, so a renderer can call it without the pack module learning
 *  what a `Finding` is.
 *
 *  IT FALLS BACK TO THE FULL LIST, and the fallback is the point. Three inputs mean « the
 *  citation does not narrow anything » and must render exactly as they did before this
 *  function existed: no references at all (an engine finding, or a ledger recorded before
 *  `normativeRef` was carried), a reference naming the CRITERION rather than one of its tests
 *  (`11.1`, which the gate also accepts), and a reference belonging to another criterion —
 *  the gate refuses those at the fold, so one reaching a renderer means the data predates the
 *  gate, and silently printing an empty test list would be worse than printing all of them.
 *  Order and duplicates come from the pack, never from the citation order. */
export function packTestsCited(pack: StandardPack, id: string, refs: readonly (string | undefined)[]): { id: string; wording: string }[] {
  const all = packTests(pack, id);
  const own = new Set(all.map((t) => t.id));
  const cited = new Set(refs.map((r) => (r ?? "").trim()).filter((r) => own.has(r)));
  return cited.size ? all.filter((t) => cited.has(t.id)) : all;
}

/** `packTestsCited` reduced to ids — the shape the auditor block and the report print. */
export function packTestIdsCited(pack: StandardPack, id: string, refs: readonly (string | undefined)[]): string[] {
  return packTestsCited(pack, id, refs).map((t) => t.id);
}

/** How many siblings a criterion may name. Three is a reading aid; six is a wall, and a wall
 *  is read as noise — which is how a marker that was supposed to sharpen attention loses it. */
const MAX_SIBLINGS = 3;

/** A neighbouring criterion that owns the ADJACENT question.
 *
 *  `mechanical` — the neighbour is the one an engine rule can fail: it asks whether the
 *  subject EXISTS, or is well-formed. `judgment` — the neighbour is the one no rule can
 *  settle: it asks whether the subject is RELEVANT. */
export interface SiblingCriterion {
  id: string;
  title: string;
  role: "mechanical" | "judgment";
}

/** THE NEIGHBOUR THAT OWNS THE ADJACENT QUESTION.
 *
 *  A country standard splits into pairs what WCAG states once: 2.4.2 asks only that a page
 *  have a title, and RGAA turns that into 8.5 (« a-t-elle un titre ? », eight engine rules
 *  away from being decided) and 8.6 (« ce titre est-il pertinent ? », which no rule can ever
 *  settle). 11.1/11.2 is the same split over form labels, and there are dozens more.
 *
 *  A cheap adjudicator collapses them: it files « this field has no label » under 11.2, whose
 *  every test presupposes a label EXISTS. The anti-fabrication gate cannot see it —
 *  `normativeRefResolves` proves 11.2.1 is a test of 11.2, which it is — so the brief has to
 *  name the split before the model writes the verdict.
 *
 *  Derived, never hand-listed: same THEME (RGAA 1.1.1 projects onto 19 criteria across the
 *  standard, and that is not a neighbourhood), at least one WCAG success criterion in common,
 *  and opposite sides of the mechanical/judgment line — two criteria that can both be failed
 *  mechanically are not a pair, they are two rules. Ranked by how much of the WCAG mapping
 *  they share, so the closest neighbour is named first, and capped. */
export function siblingCriteria(pack: StandardPack, id: string, lang: string = pack.defaultLocale): SiblingCriterion[] {
  const c = getCriterion(pack, id);
  if (!c) return [];
  return neighbourhood(pack, c)
    .slice(0, MAX_SIBLINGS)
    .map(({ crit }) => sibling(pack, crit, lang));
}

/** Mechanical: an engine rule can fail it. A criterion the pack declares `judgment`, and one
 *  that simply carries no rule, are both on the other side of the line. */
const isMechanical = (x: PackCriterion) => !x.judgment && (x.appliesTo?.ruleIds ?? []).length > 0;

const sibling = (pack: StandardPack, x: PackCriterion, lang: string): SiblingCriterion => ({
  id: x.id,
  // The plain title is the whole argument: « a-t-il une étiquette ? » beside « cette
  // étiquette est-elle pertinente ? » explains the split better than any prose could.
  title: localize(pack, x.titlePlain ?? x.title, lang),
  role: isMechanical(x) ? "mechanical" : "judgment",
});

/** The full ranked neighbourhood, BEFORE the reading-aid cap — closest first, ties in
 *  criterion order. `siblingCriteria` shows the top of it; `presupposedCriterion` needs the
 *  whole thing, because a cap can hide the very tie that disqualifies a refusal. */
function neighbourhood(pack: StandardPack, c: PackCriterion): { crit: PackCriterion; shared: number }[] {
  const mine = new Set(c.wcag ?? []);
  const mech = isMechanical(c);
  return pack.criteria
    .map((crit) => ({ crit, shared: (crit.wcag ?? []).filter((w) => mine.has(w)).length }))
    .filter(({ crit, shared }) => crit.id !== c.id && crit.theme === c.theme && shared > 0 && isMechanical(crit) !== mech)
    .sort((a, b) => b.shared - a.shared || a.crit.id.localeCompare(b.crit.id, undefined, { numeric: true }));
}

/** THE NEIGHBOUR WHOSE SUBJECT THIS CRITERION PRESUPPOSES — or none, and none is the honest
 *  answer far more often than the neighbourhood is empty.
 *
 *  `siblingCriteria` is a READING AID: « this observation may belong next door », three
 *  candidates, no claim that any one of them comes first. That breadth is right for a brief
 *  and wrong for a refusal, and the difference cost a true finding. RGAA 11.4 (« l'étiquette
 *  est-elle accolée à son champ ? ») neighbours 11.1, 11.5 and 11.6, each exactly one success
 *  criterion away. Only 11.1 owns 11.4's subject: with no label there is nothing to place.
 *  11.5 (« les champs de même nature sont-ils regroupés ? ») owns none of it — a radio group
 *  that was never grouped still has labels, and they are still placed well or badly. Reading
 *  the neighbourhood as a presupposition made an ungrouped radio immune to 11.4.
 *
 *  So: ONE neighbour, strictly closer than every other, mechanical (the side that can be
 *  failed without a model, which is what makes « the engine already owns this anchor » sayable
 *  at all). A tie is the pack declining to say which question comes first, and a refusal on a
 *  tie is a guess made against a finding that may well be true. On RGAA the rule keeps both
 *  pairs the split was drawn for — 11.2 → 11.1 (two shared success criteria against one) and
 *  8.6 → 8.5 (sole neighbour) — and stands down on the thirteen criteria whose neighbours are
 *  equidistant. */
export function presupposedCriterion(pack: StandardPack, id: string, lang: string = pack.defaultLocale): SiblingCriterion | undefined {
  const c = getCriterion(pack, id);
  if (!c || isMechanical(c)) return undefined;
  const ranked = neighbourhood(pack, c).filter(({ crit }) => isMechanical(crit));
  const first = ranked[0];
  if (!first || ranked[1]?.shared === first.shared) return undefined;
  return sibling(pack, first.crit, lang);
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

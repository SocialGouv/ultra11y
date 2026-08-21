// Types for a STANDARDS PACK — a pluggable, in-repo country accessibility standard
// (RGAA, Section 508, EN 301 549, AODA…) that maps its localized criteria onto WCAG
// success criteria. The WCAG 2.2 core (src/types.ts `Sc` / src/wcag.ts) stays canonical;
// a pack is a derived view. See CONTRIBUTING.md for the authoring contract.
// A localized string, keyed by a BCP-47-ish locale tag ("fr", "en", "pt-BR", "de"…) — NOT
// the UI frame's `Lang` ("fr"|"en", see src/types.ts): a pack may legitimately be
// authored in any language (e.g. a hypothetical German-only standard), decoupled from
// the languages the CLI's own tables (`L`) render in. `defaultLocale` (declared on the
// pack) MUST be present; other locales are optional. English is recommended for
// worldwide readability but a French-only standard like RGAA legitimately ships fr-only.
export type LocaleString = Partial<Record<string, string>>;

export interface PackTheme {
  number: number;
  name: LocaleString;
  count: number;
}

export interface PackCriterion {
  id: string; // pack-local id, e.g. RGAA "1.1"
  theme: number;
  title: LocaleString;
  titlePlain: LocaleString;
  tests?: Record<string, string[]>;
  // The standard's OWN test methodology, keyed by the same test numbers as `tests`: the
  // step-by-step procedure the referential publishes for each test. `tests` states WHAT is
  // required; this states HOW it is verified, in the standard's words rather than a
  // paraphrase. RGAA ships one for all 258 of its tests (DINUM's methodologies.json).
  //
  // It is what makes a pack criterion self-sufficient for an adjudicator: without it, a
  // country-standard brief could only borrow the decision rule of a WCAG success criterion
  // that asks a broader — sometimes different — question. Optional and additive, like
  // `appliesTo`: a pack that ships none is unaffected.
  methodology?: Record<string, string>;
  techniques?: string[];
  technicalNote?: string[];
  particularCases?: string[];
  wcag: string[]; // bare WCAG SC ids this criterion maps to, e.g. ["1.1.1", "4.1.2"]
  // Per-criterion APPLICABILITY: the engine rule ids whose findings this criterion can
  // actually be non-conformant on. A single WCAG SC maps to MANY pack criteria (RGAA
  // 1.1.1 → 19 criteria: informative-image, CAPTCHA, detailed-description, layout
  // tables, downloadable documents…), so an `img-alt-missing` failure must attach ONLY
  // to the informative-image criterion, not fan out to CAPTCHA/description/etc. A finding
  // collected via a mapped SC attaches iff its `ruleId` matches one of these (exact, or a
  // "prefix:*" wildcard for `axe:*`/`dyn-*`/`agent:*`). An empty list means "no engine
  // rule can evidence this criterion" (it stays manual/NA, never NC from a sibling's
  // failure). Optional/additive: a pack WITHOUT `appliesTo` keeps the legacy fan-out
  // (every mapped SC's findings attach) so third-party packs are unaffected.
  appliesTo?: { ruleIds: string[] };
  // The criterion's own wording asks MORE than the WCAG SCs it maps to, so a `C` on those
  // SCs is not an answer to it. RGAA 8.6 asks whether the page title is *pertinent*; WCAG
  // 2.4.2 only that a title exists. RGAA 13.3 asks whether a downloadable document has an
  // accessible version; no mapped SC ever opened the document. Without this flag the
  // projection returns `C` as soon as one mapped SC is `C` (see `aggregate` in derive.ts)
  // and publishes a conformity nobody assessed.
  //
  // A flagged criterion can still derive `NC` (a rule actually fired on it) and `NA`
  // (nothing applicable in scope); it simply never inherits a `C` — it derives `manual`
  // and goes to the agent, who rules on it against the criterion's own numbered tests.
  // `appliesTo` already carries the mirror-image promise for NC ("never NC from a
  // sibling's failure"); this is the same guarantee on the conforming side.
  judgment?: boolean;
}

// The localized DISPLAY vocabulary a standard uses when its audit is rendered for an
// AUDITOR (the `prd` auditor block + GitHub issues): the NOUNS the standard gives to a
// theme, a criterion, a test, and its three conformance verdicts, plus an optional
// section heading and a bespoke normative note. Every field is optional and localized —
// missing terms fall back to a generic default and the WCAG core keeps its own set (see
// src/standards/vocabulary.ts), so a pack that omits `vocabulary` still renders. This is
// what lets the auditor output speak each country's language rather than hardcoding RGAA
// ("Thématique / Critère / Test / C-NC-NA") or WCAG ("Principle · Guideline / Success
// criterion / Technique / Pass-Fail").
export interface PackVocabulary {
  theme?: LocaleString; // grouping noun, e.g. RGAA "Thématique"
  criterion?: LocaleString; // item noun, e.g. "Critère"
  test?: LocaleString; // sub-item noun, e.g. "Test"
  conformant?: LocaleString; // verdict, e.g. "Conforme (C)"
  nonConformant?: LocaleString; // verdict, e.g. "Non conforme (NC)"
  notApplicable?: LocaleString; // verdict, e.g. "Non applicable (NA)"
  auditorHeading?: LocaleString; // section/doc title, e.g. "Critère d'accessibilité"
  normativeNote?: LocaleString; // overrides the composed "Lecture auditeur — …" blockquote
}

// The NORMATIVE page-sample methodology for a standard — the REQUIRED page KINDS a real
// audit of it must cover. Standard-agnostic sample MECHANICS live in the core
// (src/types.ts SampleConfig + src/sample.ts); this pack field carries only the standard's
// own required-kinds LIST (RGAA: accueil, contact, mentions légales, déclaration
// d'accessibilité, plan du site, aide, authentification, pages représentatives + éléments
// transverses). Advisory: `ultra11y sample check` / `scan --sample` report which kinds the
// configured sample lacks (fuzzy match on a page's name/notes/url) — never a hard gate.
export interface SampleRequiredKind {
  id: string; // slug, e.g. "mentions-legales"
  label: LocaleString; // display label, e.g. { fr: "Mentions légales" }
  keywords: string[]; // fuzzy-match terms (accent-insensitive) against a page's name/notes/url
}
export interface SampleMethodology {
  requiredKinds: SampleRequiredKind[];
}

// ---- Declarative pack RULES — a bounded, validatable matcher DSL (NO arbitrary code).
// A pack ships its OWN detection for genuinely pack-only semantics WITHOUT forking the
// engine: a rule matches source elements structurally and emits a namespaced finding
// (`pack:<packKey>:<id>`) that projects onto the pack criterion it reports under. The
// vocabulary is deliberately CAPPED at what the built-in RGAA pack needs today (tag +
// attribute predicates + a visible-text predicate + bounded descendant conditions);
// anything more expressive belongs in a core WCAG-keyed engine rule instead (see
// skills/ultra11y/references/packs.md). A runtime pack loaded via `--pack` stays FULLY
// validatable — every regex is ReDoS-guarded, nesting is depth-bounded, JS plugins are
// rejected by construction (there is nowhere to put code).

// The operators an attribute predicate may use. `equals`/`matches` require `value`;
// `present`/`absent` ignore it. `matches` compiles the (ReDoS-guarded) value as a
// case-insensitive regex against the attribute value.
export type MatchOp = "present" | "absent" | "equals" | "matches";

export interface MatchAttr {
  name: string; // attribute name (case-insensitive), e.g. "href"
  op: MatchOp;
  value?: string; // required for equals/matches; a regex string for matches
}

// A predicate over an element's VISIBLE TEXT (whitespace-collapsed descendant text).
// `matches` fires when the text matches the (ReDoS-guarded, case-insensitive) regex;
// `lacks` fires when it does NOT — the negation the download-link rule needs to flag a
// link whose visible text omits the file format/weight.
export interface MatchText {
  op: "matches" | "lacks";
  value: string; // a regex string
}

// One structural condition node. All present sub-conditions must hold (AND). `has`
// requires that EACH listed node matches SOME descendant; `lacks` requires that NONE of
// its listed nodes matches ANY descendant. Nesting of has/lacks is depth-bounded by the
// validator (MAX_MATCH_DEPTH).
export interface MatchNode {
  tag?: string; // intrinsic tag to match (case-insensitive), e.g. "a"
  attrs?: MatchAttr[];
  text?: MatchText;
  has?: MatchNode[];
  lacks?: MatchNode[];
}

// The top-level match of a rule: a MatchNode plus an optional applicability scope —
// `page` restricts the rule to a full document (has an <html> element), `fragment`
// (default) lets it fire on any parsed source.
export interface PackRuleMatch extends MatchNode {
  scope?: "page" | "fragment";
}

// A predicate over a DOCUMENT-LEVEL signal that a page CAPTURE recorded — a property of the
// document that is not carried by any element, so no MatchNode can express it.
//
// Only `doctype` today, and it is the reason this exists: the doctype is not part of
// `documentElement.outerHTML`, so it survives only in the snapshot's meta (SnapshotMeta
// .doctype). RGAA 8.1 asks about it, maps onto the REMOVED WCAG 4.1.1, and was therefore a
// criterion no engine could ever decide — permanently « à évaluer », on every page, closable
// only by paying a model to answer a yes/no question about a string.
//
// SIGNAL-GATED, and that is the whole safety property: a rule carrying `doc` runs ONLY on a
// document whose signal is PRESENT. A source file has no doctype and never should; a capture
// written before the field existed did not record one. Neither is evidence of absence, so
// neither fires the rule and neither claims coverage for it.
export interface MatchDoc {
  signal: "doctype";
  /** `absent` fires on the empty string — the recorded « the page genuinely had none ».
   *  `matches` / `lacks` test the recorded value against a (ReDoS-guarded) regex. */
  op: "absent" | "matches" | "lacks";
  value?: string; // a regex string; required for matches/lacks
}

export interface PackRule {
  id: string; // slug (lower-kebab); the emitted finding's ruleId is `pack:<packKey>:<id>`
  criterion: string; // the pack criterion id this rule reports under (must exist)
  wcag: string[]; // WCAG SC(s) the finding keys on for the core projection (must exist)
  severity: "bloquant" | "majeur" | "mineur";
  advisory?: boolean; // non-normative recommendation — never flips a criterion to NC
  /** Element predicate. Required UNLESS the rule carries `doc`: a document-level rule has no
   *  element to select, and anchors its finding on the document root. */
  match?: PackRuleMatch;
  /** Document-level signal predicate. Mutually exclusive with `match` (the validator refuses
   *  both): a rule answers a question about an element, or one about the document. */
  doc?: MatchDoc;
  message: LocaleString; // { en, fr } — both required by the validator
  remediation: LocaleString; // { en, fr } — both required by the validator
}

// A per-pack normativity/severity OVERRIDE, keyed by a finding's ruleId (a core engine
// rule id, or a `pack:<key>:<id>` declarative rule). Applied in `derivePackResults`
// WITHIN THIS PACK'S PROJECTION ONLY — the core WCAG result is untouched. This is the
// precise "WCAG can differ from RGAA" mechanism: a pack can re-normativize a
// core-advisory finding (advisory→normative, or the reverse) and re-grade its severity
// inside its own view.
export interface PackOverride {
  advisory?: boolean;
  severity?: "bloquant" | "majeur" | "mineur";
}

// A GENERIC secondary crosswalk projection: it declares that a finding raised under
// `ruleId` ALSO projects onto an ADDITIONAL pack criterion whose official WCAG crosswalk
// does NOT contain the finding's SC. This is the explicit, opt-in DEVIATION from the
// SC-faithful projection — the standard-agnostic mechanism a country pack (or a
// `.ultra11yrc.json`) uses when its own body classifies a defect under a criterion the
// WCAG mapping alone would never reach. Shipped DISABLED (`enabled` absent/false) so the
// out-of-box projection stays WCAG-faithful; a config activates it (see src/config.ts +
// registry.enableSecondaryMapping). Matching is by EXACT `ruleId` in `derivePackResults`,
// bypassing BOTH the SC gate and the appliesTo/ruleMatches gate — so sibling rules on the
// same SC are never pulled in. A tagged secondary finding DRIVES status (NC), like any
// normative finding; there is no annotate-only variant.
export interface SecondaryMapping {
  ruleId: string; // an engine rule id (or a `pack:<key>:<id>` declarative rule) — EXACT match
  criterion: string; // the ADDITIONAL pack criterion id this ruleId also projects onto (must exist)
  note?: LocaleString; // optional localized note explaining the deviation, rendered on the finding
  enabled?: boolean; // opt-in switch; absent/false ⇒ inert (WCAG-faithful default)
}

export interface StandardPack {
  key: string; // unique slug, e.g. "rgaa" (may not be the reserved core key "wcag")
  name: string; // short display name, e.g. "RGAA"
  fullName?: string;
  org: string; // authoring body, e.g. "DINUM"
  country: string; // ISO-ish code, e.g. "FR"
  baseVersion: string; // standard version, e.g. "4.1.2"
  wcagVersion: string; // the WCAG version the pack maps to, e.g. "2.1"
  locales: string[]; // BCP-47-ish tags, e.g. ["fr"] or ["de"] — the pack's OWN locales,
  // independent of the UI frame's `Lang` (see `LocaleString` above)
  defaultLocale: string;
  license: string;
  source: string;
  attribution: string;
  idPattern: string; // regex (string) the pack's criterion ids match
  // Where the standard PUBLISHES a criterion, as a template with a single `{id}` placeholder
  // (e.g. "https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#{id}"). The
  // adjudication brief cites it so a reader — a model with a web tool, or a human reviewing
  // the brief — can reach the normative page this criterion was derived from. Optional: a
  // pack that declares none simply carries no link, and nothing France-specific is ever
  // hard-coded in the engine.
  criterionUrl?: string;
  vocabulary?: PackVocabulary; // localized auditor-display terms (optional; defaults apply)
  sampleMethodology?: SampleMethodology; // normative required page kinds (optional; advisory lint)
  // Declarative pack-only detection (optional). Each rule runs AFTER the core engine
  // rules in the audit pipeline (src/audit.ts) and emits a `pack:<key>:<id>` finding that
  // projects onto its criterion via the same appliesTo/ruleMatches machinery as engine
  // findings. Pack findings NEVER contribute to the core WCAG verdict.
  rules?: PackRule[];
  // Per-pack normativity/severity overrides keyed by finding ruleId, applied only within
  // this pack's projection (derivePackResults) — the core result is never mutated.
  overrides?: Record<string, PackOverride>;
  // Optional, opt-in secondary crosswalk projections (src/standards/types.ts
  // SecondaryMapping). Each shipped DISABLED by default; a config flips one on. Applied in
  // derivePackResults, keying by EXACT ruleId to project a finding onto an ADDITIONAL
  // criterion whose WCAG mapping does not contain the finding's SC — the standard-agnostic
  // "differs from the WCAG crosswalk on purpose" mechanism (RGAA 7.4 for live regions is
  // the first consumer). The core WCAG result is never touched.
  secondaryMappings?: SecondaryMapping[];
  themes: PackTheme[];
  criteria: PackCriterion[];
}

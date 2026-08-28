// Single source of truth for shared types + the embedded version. sync-version.mjs
// rewrites VERSION at release time (kept in lockstep with package.json + SKILL.md).
export const VERSION = "5.38.3";
export const SCHEMA_VERSION = 2;

// Lang = the UI FRAME's language — the `L` localization tables each module (report,
// check, verify, criteria…) renders in. NOT a country pack's own locale set, which may
// carry any BCP-47-ish tag ("de", "pt-BR"…) — see `LocaleString` in
// src/standards/types.ts for that decoupled, per-pack concept.
export type Lang = "fr" | "en";
export type Severity = "bloquant" | "majeur" | "mineur";
// C = conforme, NC = non conforme, NA = non applicable, manual = à évaluer
// (needs-rendering / judgment criteria the engine cannot decide on its own).
export type Status = "C" | "NC" | "NA" | "manual";

/** WHAT THE ENGINE REPORTS WHEN THERE IS NOTHING OF THAT KIND TO EVALUATE.
 *
 *  A criterion whose subject does not exist anywhere in scope — the table criteria on a site
 *  with no table, the media criteria on a site with no media — used to come back `NA`, its own
 *  third column. It no longer does: the owner's rule for this tool is that a criterion nothing
 *  contradicts is CONFORMING, and a reader working through a grid should meet two answers, not
 *  four.
 *
 *  What is NOT lost is why. Every criterion closed this way still carries the justification
 *  that names the subject looked for and the size of the scope it was looked for in, so the
 *  claim stays falsifiable — which is the only thing that separates "conforming" from
 *  "nobody checked". The three guardrails that governed the NA verdict govern this one
 *  unchanged (src/audit.ts): only subjects whose emptiness PROVES absence qualify, absence is
 *  folded across the whole scope, and an empty scope proves nothing.
 *
 *  `NA` stays in the type because the outside world still speaks it — a verdict ledger written
 *  before this change, an Ara export, a model's adjudication — and every one of those is folded
 *  to this value on the way in rather than rejected. */
export const INAPPLICABLE_STATUS = "C" as const satisfies Status;
export type Automatability = "static" | "needs-rendering" | "judgment";
export type ParserKind = "html" | "css" | "jsx" | "cross";

export interface GlossaryEntry {
  title: string;
  body: string;
}
export type Glossary = Record<string, GlossaryEntry>;

// ---- normative page sample (échantillon) — Task 5. STANDARD-AGNOSTIC mechanics: a real
// audit runs over a representative set of served pages (+ transverse elements audited on
// every page), NOT the whole file tree. The REQUIRED page KINDS a given standard mandates
// live in the pack (`sampleMethodology`, src/standards/types.ts), never here.
// SECURITY: `storageState` is a FILE PATH (a Playwright session file) — its CONTENT is
// never read into any output/report/finding; only the path is ever cited.
export interface SamplePage {
  id: string; // stable slug used for per-page provenance, e.g. "accueil"
  name: string; // human page name shown in the report, e.g. "Page d'accueil"
  url: string; // served URL (http(s)://) or a local HTML file path
  auth?: boolean; // the page sits behind authentication (renders an auth badge)
  storageState?: string; // Playwright storageState FILE PATH (content never read) — per-page auth
  notes?: string; // reproduction steps / required state, surfaced in the ticket repro block
  // Source files that RENDER this page. A finding raised on the page's DOM is then reported
  // against your component instead of against `dom.html`, which is the difference between a
  // report a developer can act on and one that points at a serialized blob. Declared here so
  // the sample is the single place a page is described — a repo that drives its own sweep no
  // longer needs a parallel route table to carry them.
  sources?: string[];
}
export interface SampleConfig {
  pages: SamplePage[];
  // Element descriptions audited on EVERY page (header, nav, footer, modals…).
  transverse?: string[];
}
// The sample as recorded in an AuditResult / DynamicResult. The `storageState` PATH is
// deliberately dropped (never persisted): the report needs name/url/auth/notes only.
export interface SampleScope {
  pages: Array<{ id: string; name: string; url: string; auth?: boolean; notes?: string }>;
  transverse?: string[];
}

// A sample page the scan REFUSED to record, because the browser ended up somewhere else —
// a session that had expired, a wizard step the application state does not open. Recording
// it would have filed another screen under this page's name, which reads as a complete
// report and is a false conformance claim. Reported so the sample or the seeded state can
// be fixed; never silently dropped.
export interface ScanRedirect {
  id: string;
  name: string;
  requested: string;
  landed: string;
  // WHY it was refused. `redirect`: the browser ended up at another address. `http-status`:
  // it stayed at the requested one but the server answered an error — a framework's own
  // not-found page is a full, valid document at the right URL, which no address comparison
  // can tell from the real thing. `error`: the browser threw while measuring it, and `detail`
  // carries what it said.
  reason?: "redirect" | "http-status" | "error";
  status?: number;
  /** What the browser said, when `reason` is `error`. Truncated — it is a signpost to the
   *  page, not a stack trace. */
  detail?: string;
}

// ---- WCAG 2.2 canonical core (src/data/wcag.json, produced by scripts/build-standards.mjs)
// The engine's canonical key. Success-criterion ids/titles/levels are derived from the
// official W3C source (https://github.com/w3c/wcag); rule coverage + automatability are
// engine-specific. RGAA and other country standards are derived packs (see src/standards/).
export type WcagLevel = "A" | "AA";

export interface Sc {
  sc: string; // dotted SC id, "<principle>.<guideline>.<n>", e.g. "1.4.3"
  principle: number; // 1..4
  guideline: string; // "1.4"
  title: string; // authoritative W3C English title
  // Authoritative French title from the W3C AUTHORIZED translation
  // (https://www.w3.org/Translations/WCAG22-fr/), vendored at scripts/vendor/wcag-2.2-fr.json.
  // Present on every core-AA SC (the build fails otherwise) — optional only so older
  // wcag.json snapshots still parse. See src/wcag.ts `scTitle`.
  titleFr?: string;
  level: WcagLevel;
  addedIn: string; // "2.0" | "2.1" | "2.2"
  automatability: Automatability;
  ruleIds: string[]; // engine rules contributing to this SC
  understanding: string; // W3C Understanding doc URL (manual-check grounding)
  techniques?: string[]; // language-neutral W3C technique codes
  // The criterion's NORMATIVE wording, verbatim from the W3C source, with its exceptions
  // and notes as labelled lines. Optional only so an older wcag.json snapshot still
  // parses — a freshly built dataset carries it for every criterion or the build fails.
  text?: string;
  // The same wording from the W3C AUTHORIZED French translation. Held to the same
  // completeness rule as `titleFr`: the build fails rather than let `--lang fr` render a
  // French heading over English requirement prose.
  textFr?: string;
  // The glossary slugs this criterion's wording LINKS to in the W3C source — the defined
  // terms it actually cites, not words that happen to appear in it.
  terms?: string[];
  // The same, for the French translation. The two pages do NOT share slugs — the FR page
  // names several definitions in the plural ("user-agents" where the English source file is
  // "user-agent") and a few differently outright ("purpose-of-each-link" for "link-purpose").
  // Mapping one onto the other would be a guess, so each language keeps its own list and
  // resolves against its own glossary.
  termsFr?: string[];
  tests?: string[]; // optional manual-check lines
  notes?: string;
}

export interface WcagPrinciple {
  number: number;
  title: string;
  titleFr?: string; // W3C authorized French translation — see Sc.titleFr
}
export interface WcagGuideline {
  number: string; // "1.4"
  title: string;
  titleFr?: string; // W3C authorized French translation — see Sc.titleFr
}

export interface WcagData {
  wcagVersion: string; // "2.2"
  level: string; // "AA"
  source: string;
  license: string;
  criteriaSource: string;
  principles: WcagPrinciple[];
  guidelines: WcagGuideline[];
  criteria: Sc[];
  // The terms WCAG itself normatively defines ("text alternative", "programmatically
  // determined"…), keyed by the W3C's own dfn slug. Optional so an older wcag.json
  // snapshot still parses; see src/wcag.ts `coreGlossary`.
  glossary?: Glossary;
  // The same terms from the W3C authorized French translation, under the SAME slugs.
  glossaryFr?: Glossary;
}

// ---- WCAG SC universe (src/data/wcag-universe.json, produced by
// scripts/build-standards.mjs --refresh-universe + build()): EVERY real WCAG 2.x
// success criterion — every level (A/AA/AAA), plus the obsolete/removed 4.1.1 Parsing —
// derived from the same vendored W3C source as the AA core, never invented. This is the
// guardrail a pack's out-of-core SC mapping (e.g. an AAA criterion, or the removed 4.1.1)
// is checked against, so validation never has to hardcode a single tolerated exception —
// see src/wcag.ts `knownScStatus` and src/standards/validate.ts `classifySc`.
export type ScStatus = "core-AA" | "out-of-core" | "removed";

export interface WcagUniverseEntry {
  id: string; // dotted SC id, e.g. "1.4.6"
  title: string;
  level: string; // "A" | "AA" | "AAA" | "" (no level ⇒ removed/obsolete)
  status: ScStatus;
}

export interface WcagUniverseData {
  wcagVersion: string;
  source: string;
  criteriaSource: string;
  provenance: string;
  criteria: WcagUniverseEntry[];
}

// ---- engine findings + audit result
export interface Finding {
  ruleId: string;
  criteriaId: string;
  file: string;
  line: number;
  col: number;
  selectorHint: string;
  severity: Severity;
  message: string;
  remediation: string;
  // Language-neutral resolution key (src/messages.ts MSG_CATALOG), additive/optional so
  // older AuditResult JSON (no `msg`) still renders via the baked message/remediation
  // above. `message`/`remediation` are the canonical ENGLISH bake (AI-facing); a renderer
  // resolves `msg` through resolveMessage/resolveRemediation for `--lang fr` (or any other
  // supported lang), falling back to the baked strings when absent or the id is unknown.
  msg?: { id: string; params?: Record<string, string | number> };
  snippet: string;
  // Source byte range of the anchoring element (htmlparser2 [start, end), open+close
  // tag). Optional so older AuditResult JSON still parses. Used by `fix` (codemods
  // edit by range) and by `init` baseline diffing (stable finding identity that
  // survives line drift). Absent for stdin/JSX findings where it would be unusable.
  sourceStart?: number;
  sourceEnd?: number;
  // Cross-file context: the OTHER site that explains this finding — e.g. the
  // component definition for a finding raised at a usage site. Optional/additive
  // (cross-file rules only), so existing AuditResult JSON still parses.
  // `note` is the canonical baked ENGLISH prose (mirrors message/remediation above);
  // `noteId` is an optional key into src/messages.ts's note catalog, resolved at
  // render time by `resolveNote` for `--lang fr` (or any other supported lang),
  // falling back to the baked `note` when absent or the id is unknown.
  related?: { file: string; line: number; col: number; selectorHint: string; note: string; noteId?: string };
  // AI signal: this finding was raised on a .vue/.svelte/.astro SOURCE template, whose
  // slot/dynamic-injected content is invisible to static analysis — so it is a
  // PRELIMINARY verdict to confirm against the rendered output, not a certainty.
  // Optional/additive (no schemaVersion bump); absent = full-confidence static finding.
  preliminary?: boolean;
  // Set when this finding was raised on a RENDERED capture file (real serialized DOM)
  // and re-attributed to the source component that produced it. `file`/`sourceStart`
  // still index the capture bytes (so `fix` and baseline diffing stay stable); origin
  // points back to the source. Optional/additive (no schemaVersion bump).
  origin?: { capture: string; sourceFile?: string; component?: string; sourceLine?: number };
  // PAGE IDENTITY — the stable id of the page snapshot this finding was raised on
  // (src/snapshot.ts). Set from the capture provenance for a snapshot-borne finding, and by
  // the per-page attribution pass (src/pages.ts) for a source finding it can attribute. It
  // is the join key of the per-page criterion grid; `sample.page` remains the human page
  // NAME carried by a merged dynamic finding. Optional/additive (no SCHEMA_VERSION bump) —
  // absent ⇒ the finding is not attributed to any one page.
  page?: string;
  // NON-NORMATIVE recommendation: a good-practice signal NOT backed by a testable
  // criterion of the active standard (e.g. "one h1 per page", a best-practice-only axe
  // violation, an agent-noted UX improvement). An advisory finding can NEVER flip a
  // criterion to NC nor enter `conformancePct`; it is rendered as « Recommandation (non
  // normative) », never as a non-conformity, but stays attached to its criterion and in
  // the flat findings list so grounding + `check` still resolve it. Optional/additive
  // (no SCHEMA_VERSION bump) — absent ⇒ normative, following the `preliminary`/`origin`/
  // `decidedBy` pattern.
  advisory?: boolean;
  // Per-sample provenance (`scan --sample`): the crawled page NAME, whether it sits behind
  // authentication, and optional reproduction notes. Attached by `mergeDynamic` from the
  // dynamic finding's originating sample page, so the auditor ticket (src/auditor.ts) can
  // render the human page name + auth flag under « Pages / URLs impactées » and the notes
  // under « Contexte de reproduction ». Optional/additive (no SCHEMA_VERSION bump).
  sample?: { page?: string; authRequired?: boolean; notes?: string };
  // Localized message/remediation PAIR carried on the finding itself — the runtime channel
  // `resolveMessage`/`resolveRemediation` read BEFORE the static MSG_CATALOG. Declarative
  // pack rules (src/standards/pack-rules.ts) are loaded at runtime and cannot register into
  // the compiled MSG_CATALOG, so a `pack:<key>:<id>` finding attaches its rule's `{en,fr}`
  // strings here; a renderer at `--lang fr` then picks the French text instead of falling
  // back to the English `message` bake. Keyed by the UI frame's `Lang` (fr|en). Optional/
  // additive (no SCHEMA_VERSION bump) — absent ⇒ resolve via `msg`/baked strings as before.
  i18n?: { message: Partial<Record<Lang, string>>; remediation: Partial<Record<Lang, string>> };
  // THE PRECISE NORMATIVE TEST THIS FINDING FAILS — a pack test id under a pack standard
  // (RGAA "11.1.2"), a WCAG SC id for the core. Set on an agent-declared non-conformity,
  // where `applyAdjudication` has already REFUSED the verdict unless it resolves to a test
  // of the adjudicated criterion (`normativeRefResolves`). Deliverables print this test
  // instead of enumerating every test of the criterion: an RGAA non-conformity is a claim
  // about one numbered test, and « 11.1.1 · 11.1.2 · 11.1.3 » under a finding that failed
  // only 11.1.2 overstates what was observed. Optional/additive (no SCHEMA_VERSION bump) —
  // absent ⇒ renderers fall back to the criterion's full test list, so a ledger recorded
  // before this field existed still renders exactly as it did.
  normativeRef?: string;
  // Set when this finding was projected onto a pack criterion via an opt-in SECONDARY
  // crosswalk mapping (src/standards/types.ts SecondaryMapping) — an additional criterion
  // whose official WCAG mapping does NOT contain the finding's SC, an explicit,
  // config-enabled deviation. Carried ONLY on the copy attached to the secondary criterion
  // in a pack projection (`derivePackResults`); the core finding is never mutated. `note`
  // is the resolved localized explanation of the deviation, appended by the auditor block
  // (src/auditor.ts). Optional/additive (no SCHEMA_VERSION bump) — absent ⇒ ordinary
  // SC-faithful projection, following the `advisory`/`preliminary`/`origin` pattern.
  secondary?: { note?: string };
}

/** ONE ANCHOR A VERDICT WAS SETTLED ON — the evidence an agent cleared a criterion on for a
 *  `C`, or ruled out of scope for an `NA`.
 *
 *  Structurally a prefix of the adjudication engine's `Evidence` (src/adjudicate.ts), and
 *  deliberately not that type: this lives on the audit DOCUMENT, which is read by renderers
 *  and by `verify`, and none of them should have to import the adjudication engine to read a
 *  file and a line. The harvester's own bookkeeping (`occurrences`, `alsoAt`, `pages`) is not
 *  copied — it describes the evidence class the citation was drawn from, not the claim.
 *
 *  It is what a second reader needs and the whole reason it is persisted: refuting a
 *  conformity means opening these anchors and asking whether they ESTABLISH the criterion or
 *  merely show that its subject exists. */
export interface CriterionCitation {
  file: string;
  line: number;
  selector: string;
  snippet: string;
  note?: string;
}

export interface CriterionResult {
  id: string; // WCAG success-criterion id, e.g. "1.4.3"
  guideline: string; // WCAG guideline this SC belongs to, e.g. "1.4"
  status: Status;
  findings: Finding[];
  justification?: string;
  /** The evidence an AGENT verdict was settled on — required by the fold for `C` and `NA`,
   *  and persisted here so `verify --report` can put the claim on trial without a ledger.
   *  Absent on an engine-decided criterion, which is recomputed from source on every run and
   *  is not a judgement anyone recorded. Optional/additive (no SCHEMA_VERSION bump). */
  citations?: CriterionCitation[];
  // Who decided this criterion's status. Absent = the deterministic engine (the default
  // for every audit). "agent" = an AI adjudication of a formerly-`manual` judgment/
  // rendering criterion, recorded via `verify --manual` → `verify --apply` (each carries a
  // justification; an NC carries groundable findings). "scan" = the dynamic tier upgraded
  // a needs-rendering residual to C/NC (src/scan.ts mergeDynamic). Optional/additive — no
  // SCHEMA_VERSION bump; older AuditResult JSON (no `decidedBy`) reads as engine-decided.
  decidedBy?: "engine" | "agent" | "scan";
  /** This criterion is conforming because NOTHING OF ITS KIND IS IN SCOPE, not because
   *  anything was verified — see INAPPLICABLE_STATUS.
   *
   *  It exists so the distinction stays machine-readable now that the two share a status. The
   *  snapshot merge needs it: a criterion closed for absence must be REOPENED the moment a
   *  rendered page puts its subject back in scope, and its "nothing of that kind here"
   *  justification must go with it — a stale one would have the report explaining that a site
   *  has no images directly above the images it found. */
  inapplicable?: boolean;
}

// ---- rendered signals (page snapshots) ---------------------------------------------------
// What a browser knows and source does not: the COMPUTED styles, the laid-out boxes and the
// accessibility tree. Collected by src/snapshot.ts, consumed by the rendered rules
// (src/rules/rendered.ts). Indexed by DOCUMENT-ORDER ORDINAL — a selector would have to
// survive serialization and re-parsing, an ordinal does not — and each entry repeats its
// `tag` so the join can be VERIFIED rather than trusted.

/** One element's computed style. `css` keys are CSS camelCase; values are exactly as the
 *  browser serialized them (`rgb(0, 0, 0)`, `16px`) and are never re-parsed at collection. */
export interface StyleEntry {
  i: number;
  tag: string;
  css: Record<string, string>;
}

export interface StyleDigest {
  v: number;
  entries: StyleEntry[];
  // Set when the collector hit its element cap. A truncated digest must never read as
  // "nothing more to see": the rendered rules leave the tail undecided.
  truncated?: boolean;
}

export interface BoxEntry {
  i: number;
  tag: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoxDigest {
  v: number;
  entries: BoxEntry[];
  truncated?: boolean;
}

/** One CSS rule as the browser parsed it. Some criteria are properties of the STYLESHEET, not
 *  of any element's computed style: whether focus styling is removed, whether a media query
 *  locks the orientation. Those are only answerable here. */
export interface CssRuleEntry {
  selector: string;
  /** Enclosing @media condition, when the rule sits inside one. */
  media?: string;
  /** Declarations, keys in CSS camelCase to match `StyleEntry.css`. */
  decls: Record<string, string>;
}

export interface CssDigest {
  v: number;
  rules: CssRuleEntry[];
  // Stylesheets whose rules the browser refused to expose (cross-origin, no CORS). A rule's
  // ABSENCE is then not evidence of anything, so the rules that read this digest decline to
  // conclude when it is non-zero. Silence here means "I could not look", not "nothing there".
  unreadable: number;
  /** Some ORDINARY rule was dropped past the pool cap. Deliberately a weaker statement than it
   *  used to be: the rules a rendered criterion reads (:focus/:target/:active styling, and
   *  anything declaring outline/position/animation/transition/transform) are kept whatever the
   *  pool is doing, so a rule that needs only those need not decline on this flag. */
  truncated?: boolean;
  /** How many ordinary rules were dropped, for the reader. */
  dropped?: number;
}

/** The accessibility tree as the browser computed it. Deliberately loose: producers differ.
 *  Recorded when a producer supplies it; no rule consumes it yet — it rides along as evidence
 *  for the agent's adjudication rather than driving an automated verdict. */
export interface AxNode {
  role?: string;
  name?: string;
  value?: string;
  description?: string;
  level?: number;
  disabled?: boolean;
  focusable?: boolean;
  children?: AxNode[];
}

/** The signals attached to a Doc parsed from a page snapshot's `dom.html`. Absent for every
 *  ordinary source file — a rendered rule simply does not fire, which is why adding this tier
 *  cannot change any existing verdict. */
export interface RenderSignals {
  /** Computed style by document-order index. Absent when the digest failed verification. */
  styles?: Map<number, StyleEntry>;
  boxes?: Map<number, BoxEntry>;
  axtree?: AxNode;
  /** The page's own stylesheets. Not element-indexed — it needs no alignment. */
  css?: CssDigest;
  /** Absolute path to the page screenshot, when one was captured. */
  screenshot?: string;
  /** What the live probes measured on this page, when the producer ran them (zoom, reflow,
   *  text spacing, focus visibility, hover). Carries `probed` — the criteria actually looked
   *  at — because an empty hit list is only evidence for those. */
  probes?: {
    focusVisible?: { selector: string; html: string; detail: string }[];
    hover?: { selector: string; html: string; detail: string }[];
    reflowZoom?: { selector: string; html: string; detail: string }[];
    textSpacing?: { selector: string; html: string; detail: string }[];
    reflow?: { horizontalScroll: boolean };
    probed?: string[];
  };
  /** What AXE-CORE found on this page, when the producer ran it.
   *
   *  The same rule engine `scan` drives, run instead inside the caller's own test — which is
   *  the only tier that ever reaches a page behind a login and a state machine. Folded through
   *  the same mapping (src/axe-map.ts), so an axe hit means the same thing whichever tier
   *  produced it.
   *
   *  `ran` is what makes the silence usable: a criterion with no violation is conforming only
   *  where axe actually ran, exactly as `probed` works for the live probes. */
  axe?: {
    violations?: { id: string; impact?: string | null; help?: string; tags?: string[]; nodes?: { target?: string[]; html?: string }[] }[];
    ran?: boolean;
  };
  /** The page's doctype declaration, from the snapshot's meta. Absent when the capture
   *  predates the field — a different statement from an empty string ("the page had none"),
   *  and the adjudication harvest keeps the two apart. */
  doctype?: string;
  /** The collector truncated: elements past the cap have NO signals and stay undecided. */
  truncated?: boolean;
}

// ---- the page dimension -----------------------------------------------------------------
// RGAA (and every other country standard) is a PER-PAGE norm: an audit runs over a declared
// sample of pages, and each criterion gets a status ON EACH PAGE. The engine's own verdict is
// scope-wide, so the page dimension is derived (src/pages.ts) rather than measured a second
// time. `scope.pages` records which pages were in play; the grid is computed on demand.

/** A page in scope, recorded on the AuditResult so the grid can be rebuilt from the JSON
 *  alone — no snapshots on disk, no browser. */
/** What a run actually MEASURED on ONE page — the evidence behind a per-page verdict.
 *
 *  The scope-wide fold (`renderedProves`, src/audit.ts) asks "was this measured on EVERY page?"
 *  and answers one status for the whole run. That is the right question for the run and the
 *  wrong one for a page: a criterion whose rules all ran on THIS page and raised nothing here
 *  is conforming HERE, whatever fired three routes away. Recording the coverage per page is
 *  what lets a page-by-page grid be complete without asking a model to re-judge every cell.
 *
 *  ABSENT MEANS UNKNOWN, never "nothing was measured" — same contract as `scope.pagesAudited`.
 *  An audit written before this field existed must conclude nothing from it, so every reader
 *  below treats `undefined` as "keep the criterion open". */
export interface PageCoverage {
  /** This page's DOM was parsed and folded, so the WHOLE static rule set ran against it. */
  dom?: boolean;
  /** An axe pass ran here, so every `axe:*` rule ran here. */
  axe?: boolean;
  /** Rendered rules (src/rules/rendered.ts) whose required signals were present on this page. */
  rules?: string[];
  /** Success criteria a LIVE PROBE measured here (zoom, 320px reflow, text spacing, Tab,
   *  hover). A probe that did not run measured nothing — its silence is never a verdict. */
  scs?: string[];
}

export interface PageScope {
  id: string; // stable page id (a snapshot directory name)
  name: string;
  url: string;
  auth?: boolean;
  route?: string;
  /** Stamped by `pagesOf()` from `scope.pageCoverage` — never persisted here, so the JSON
   *  carries one coverage map instead of repeating it inside every page entry. */
  coverage?: PageCoverage;
  // Source files that rendered this page. Used to attribute SOURCE findings to it.
  sources?: string[];
  notes?: string;
  // How much this page's verdict can be trusted:
  //  • "snapshot"    — its real rendered DOM was audited, so absence of a finding for an
  //                    engine-decidable criterion genuinely means conforming ON THIS PAGE;
  //  • "attributed"  — only source findings were mapped onto it, so absence of a finding
  //                    proves nothing and every undecided criterion stays `manual`;
  //  • "not-audited" — a snapshot for it EXISTS on disk, but this audit never read it. Same
  //                    verdict strength as "attributed" (nothing may be concluded from
  //                    silence) and deliberately NOT the same word: telling the reader a page
  //                    has no snapshot when it has one is a different false statement, not a
  //                    smaller one. See pagesOf().
  basis: "snapshot" | "attributed" | "not-audited";
}

/** One page's projection of the audit. Derived, never stored on the AuditResult: the full
 *  grid is criteria × pages and would bloat the JSON for no gain. */
export interface PageResult {
  id: string;
  name: string;
  url: string;
  auth?: boolean;
  basis: PageScope["basis"];
  criteria: CriterionResult[];
  findings: Finding[];
  // NULL WHEN NOTHING WAS DECIDED. A rate over zero decided criteria is not a rate, and printing
  // it as 100 is how 38 pages of an app with 16 known non-conformities each reported "100 %" —
  // the denominator was empty, not the defect list. Readers must render `—`, never a number, and
  // must show `decided/total` beside it so the figure can never be quoted without its basis.
  conformancePct: number | null;
  decided: number; // criteria this page actually decided (C + NC) — the rate's denominator
  total: number; // criteria in scope for this page under the active standard
}

// ---- adjudication under a COUNTRY STANDARD ------------------------------------------------
// An AuditResult is WCAG-keyed by construction and a pack is a derived projection. But 97 of
// RGAA's 106 criteria carry judgment tests and may still need adjudication to earn C, so much of the
// standard — and, on a run with no captures, nearly all of it — is settled
// by the agent — at the PACK's granularity, which is finer than WCAG's (1.1.1 alone fans out
// to 19 RGAA criteria). Folding those verdicts onto the WCAG criteria would make several RGAA
// criteria overwrite one another on a shared success criterion, so they are recorded here
// instead, and `derivePackResults` prefers them over its own derivation.
export interface PackCriterionAdjudication {
  id: string; // pack criterion id, e.g. RGAA "11.2"
  status: Status;
  justification?: string; // REQUIRED for C and NA
  reason?: "needs-rendered-dom" | "undecidable"; // REQUIRED for a still-manual verdict
  findings: Finding[]; // REQUIRED (≥1, groundable, each citing a test OF THIS CRITERION) for NC
  /** The evidence this verdict was settled on — the fold requires it for `C` and `NA`. See
   *  CriterionCitation: it is what lets `verify --report` attack the claim with no ledger. */
  citations?: CriterionCitation[];
  // Absent when the partial fold REFUSED this criterion's verdict: the entry then exists only
  // to carry the refusal as the criterion's `justification`, and claiming the agent decided it
  // would be the exact laundering the gate just prevented. Present ("agent") on every verdict
  // that actually landed, including a deliberate still-`manual` one.
  decidedBy?: "agent";
}

export interface GuidelineTally {
  key: string; // WCAG guideline number, e.g. "1.4"
  title: string;
  c: number;
  nc: number;
  na: number;
  manual: number;
}

export interface ResidualRisk {
  criteriaId: string;
  reason: string;
  automatability: Automatability;
}

export interface AuditResult {
  tool: "ultra11y";
  standard: "wcag"; // self-describing: the engine keys on WCAG 2.2 SCs (packs are derived views)
  version: string;
  schemaVersion: number;
  date: string; // YYYY-MM-DD
  scope: {
    inputs: string[];
    files: number;
    // Set when `--max-files` capped discovery (highest-priority files audited first).
    truncated?: { limit: number; total: number; skipped: number };
    // Set when content de-duplication collapsed identical files to one canonical audit.
    dedup?: { canonicalFiles: number; duplicateFiles: number };
    // Set when source files render component-LIBRARY components whose real HTML
    // output is invisible to static source analysis (e.g. DSFR). The source verdict
    // is preliminary for them — audit the build output (`render`) or `scan`.
    rendered?: { opaqueLibraries: string[]; files: number };
    // Set when .vue/.svelte/.astro SOURCE templates were audited. Their slots,
    // snippets and dynamic bindings are invisible to static analysis, so findings on
    // them are PRELIMINARY — audit the rendered output (`render`/`scan`) to confirm.
    sourceTemplate?: { files: number; extensions: string[] };
    // Set when RENDERED capture files (real serialized DOM) were audited at full
    // fidelity — the true markup a component library / SFC emits, not its source call.
    captures?: { files: number; components: string[] };
    // Set by the coverage pass (`--require-captures` / `render --coverage`): which
    // components have a rendered capture vs which are still opaque-source-only blind
    // spots. Keys are "posix/path#Component". `unattributed` = capture files with no
    // resolvable source (no provenance) — audited, but not credited to a component.
    captureCoverage?: { total: number; covered: string[]; blindSpots: string[]; unattributed: number };
    // Set when at least one `<html lang>`/`xml:lang` was seen: the repo's declared
    // language(s) (primary BCP-47 subtag, e.g. "fr-FR" → "fr"), sorted by descending
    // frequency. Used as the CLI's `--lang auto` repo-detection signal (see
    // `resolveLang` in src/cli.ts) — never invented when no document declares one.
    langs?: string[];
    // Set when a `scan --sample` run was merged in: the normative page sample the dynamic
    // tier was run over (name/url/auth/notes per page, storageState paths dropped). Drives
    // the report's « Constats par page » section. Optional/additive.
    sample?: SampleScope;
    // Set when PAGE SNAPSHOTS (.ultra11y/pages) were ingested: the pages in scope, with the
    // source files that rendered each. Recorded so the per-page grid can be rebuilt from this
    // JSON alone — offline, with no snapshots and no browser. Optional/additive.
    pages?: PageScope[];
    // The page ids whose DOM this audit ACTUALLY read, always written alongside `pages` — as
    // `[]` when none, never omitted. It is the evidence behind a page's `basis`, and evidence
    // that is absent whenever there is none to report is a guard that switches itself off in
    // exactly the run that needs it: a source-only `audit` records every snapshot directory on
    // disk as a page in scope while auditing none of them, and that is the run whose sheets all
    // read 100 %. An audit written before this field existed leaves it undefined, which is read
    // as "unknown" and changes nothing — the distinction is undefined vs [], not empty vs unset.
    pagesAudited?: string[];
    // What this run MEASURED on each page, keyed by page id — the evidence a per-page verdict
    // stands on. Written by `finalize` from the same accounting `renderedProves` folds
    // scope-wide, and stamped onto each `PageScope` by `pagesOf()`. A map rather than a field
    // per page so a 37-page audit carries one object instead of repeating the rule lists.
    // Optional/additive: absent means UNKNOWN and closes nothing (see PageCoverage).
    pageCoverage?: Record<string, PageCoverage>;
    // Set when dynamic scan results were merged in: which needs-rendering SCs the scan's
    // engines/probes actually MEASURED (verdict coverage — independent of whether anything
    // was found). Docker runner: 320px reflow only; the local runtime adds zoom / text
    // spacing / focus / hover (+ live regions when interactions are on). Union across
    // merges. Drives the partial-audit advisory (src/report.ts untestedNeedsRendering) so
    // the banner never claims a probe ran when it did not. Optional/additive.
    scan?: { testedScs: string[] };
    /** Subject ids that harvested at least one anchor anywhere in scope, sorted. The audit
     *  reads files in a stream and never holds them all, so absence is folded here once and
     *  then READ by every projection — the pack derivation above all, since a country
     *  standard is where a reader actually counts rows. See EXISTENCE_SUBJECTS. */
    subjectsSeen?: string[];
    /** The same fold per page id — what `pageView` narrows `subjectsSeen` onto, so a criterion
     *  can be closed for absence ON A PAGE and not only across the run. Absent on an audit
     *  written before the fold existed; that is "unknown", never "nothing". */
    pageSubjects?: Record<string, string[]>;
    // Sample pages a `scan --sample` REFUSED to record, and why. They are deliberately absent
    // from `sample` above — a page kept there would be re-added to the per-page grid with the
    // same basis as one really visited, so the deliverable would claim a page nobody looked
    // at. Carried here instead so the report can say what is missing rather than hide it.
    // Optional/additive — absent when every page was reached.
    redirected?: ScanRedirect[];
  };
  guidelines: GuidelineTally[];
  criteria: CriterionResult[];
  findings: Finding[];
  // Findings raised by DECLARATIVE PACK RULES (src/standards/pack-rules.ts), namespaced
  // `pack:<key>:<id>`. Kept SEPARATE from the core `findings`/`criteria` so the WCAG core
  // verdict is never touched by pack-only detection: they surface only when a pack
  // projection is derived (`derivePackResults` routes them through the SAME
  // appliesTo/ruleMatches machinery as engine findings). Optional/additive (no
  // SCHEMA_VERSION bump) — absent/empty ⇒ no pack ran a rule.
  packFindings?: Finding[];
  residualRisks: ResidualRisk[];
  // Automatic static-check pass rate over the machine-DECIDABLE SCs only (the small
  // static set + any judgment SC that fired a definite NC). NOT a full conformance
  // rate — most SCs are needs-rendering/judgment and stay manual (residual risk).
  conformancePct: number;
  // Set once `verify --apply <adjudication>` has folded an AI adjudication of the manual
  // criteria back into the audit (src/adjudicate.ts). `stillManual` = criteria the agent
  // left as an explicit residual (needs a rendered DOM → `scan`, or genuinely undecidable).
  // `rejected` = criteria whose verdict the gate REFUSED, which the partial fold leaves to
  // assess with the refusal as their reason (absent when nothing was refused; always absent
  // under `--strict`, where one refusal discards the whole fold).
  // Optional/additive — absent on a plain engine audit.
  adjudicated?: { date: string; applied: number; stillManual: number; rejected?: number };
  // Set when the agent adjudicated at a COUNTRY STANDARD's granularity (`verify --manual
  // --standard <pack>`). Kept SEPARATE from `criteria` so the WCAG core verdict is never
  // touched by a pack decision — and so several pack criteria sharing one success criterion
  // cannot overwrite each other. `derivePackResults` prefers these over its own derivation.
  // Optional/additive (no SCHEMA_VERSION bump).
  packAdjudication?: { standard: string; criteria: PackCriterionAdjudication[] };
}

// ---- optional dynamic tier (axe-core in a headless browser): Docker image, or a
// host/target Playwright resolved at runtime (`scan --local`). `engine` widens from
// the axe + 320px-reflow pair to the bespoke residual-criteria probes the local
// runtime adds (focus visibility, 200% zoom reflow, text spacing, content-on-hover)
// — the criteria axe alone cannot decide. (Target size 2.5.8 is left to axe's own rule.)
//
// The `input-overflow-*` and `live-region` engines are STATEFUL: they only ever
// populate when the local runtime runs with interactions ON (the default; `scan
// --no-interact` disables them). Each measures the page AFTER a real user action —
// long values typed into inputs, or a safe interaction (fill / toggle / click a
// type=button) — the class of non-conformity a pristine page never reveals. The
// three input-overflow engines share the "filled input clipped/unreadable" check but
// map to a different SC per stress (320px reflow 1.4.10, 200% zoom 1.4.4, text
// spacing 1.4.12); live-region maps to 4.1.3 Status Messages.
export type DynamicEngine =
  | "axe"
  | "reflow"
  | "focus-visible"
  | "focus-obscured"
  | "reflow-zoom"
  | "text-spacing"
  | "hover"
  | "keyboard-trap"
  | "input-overflow-reflow"
  | "input-overflow-zoom"
  | "input-overflow-spacing"
  | "live-region";

export interface DynamicFinding {
  criteriaId: string;
  axeRule: string;
  impact: string;
  severity: Severity;
  message: string;
  selector: string;
  snippet: string;
  engine: DynamicEngine;
  page?: string; // the scanned URL/page this finding came from (multi-page crawl)
  // Best-practice-only dynamic finding (no `wcag*` tag on the axe violation): folds into
  // the audit as an advisory recommendation, never a criterion NC. See Finding.advisory
  // and src/axe-map.ts `axeAdvisory`. Optional/additive — absent ⇒ normative.
  advisory?: boolean;
  // Per-sample provenance (`scan --sample`): the originating sample page. Carried through
  // `mergeDynamic` onto the merged Finding's `sample` for ticket rendering. Optional.
  sample?: { id: string; name: string; auth?: boolean; notes?: string };
}

export interface DynamicResult {
  tool: "ultra11y";
  engine: string; // e.g. "axe-core@playwright (docker)"
  target: string;
  date: string;
  findings: DynamicFinding[];
  // Set by a `scan --sample` run: the normative page sample scanned (recorded onto the
  // merged AuditResult's scope.sample). Optional/additive — absent for a plain scan.
  sample?: SampleScope;
  // Which needs-rendering SCs this run's engines/probes actually MEASURED (verdict
  // coverage — independent of whether anything was found). Docker: 320px reflow only;
  // local: + zoom / text spacing / focus / hover (+ live regions when interactions are
  // on). Merged into AuditResult.scope.scan by mergeDynamic. Optional/additive.
  testedScs?: string[];
  // Page ids of the SNAPSHOTS this run persisted under `.ultra11y/pages/<id>/`. A scan
  // already has the browser on the page, so it collects the document as well as the
  // findings — otherwise a URL-scanned page could never earn a conforming verdict (the
  // static rules never ran against its DOM, so src/pages.ts keeps it `manual` forever).
  // Empty/absent when snapshotting was off or every collection failed. Optional/additive.
  snapshots?: string[];
  // Sample pages dropped because the browser landed on a different path than the one asked
  // for. Absent when every page was reached. Optional/additive — see ScanRedirect.
  redirected?: ScanRedirect[];
}

// ---- the pack-keyed audit DOCUMENT -------------------------------------------------------
//
// What `audit --standard <pack>` emits, and what every `--in <audit.json>` consumer accepts
// beside the core `AuditResult`.
//
// The engine keys on WCAG success criteria because that is what its rules are tied to, and a
// pack criterion is DEFINED as a projection of them (rgaa.json maps each of its 106 criteria
// onto SCs). The derivation is therefore not a rendering choice that could be moved earlier —
// without the core results there is nothing to project FROM, and report/prd/check/verify/
// judge and the ledger all read them.
//
// So selecting a standard re-keys the DOCUMENT rather than the engine: the criteria, the
// findings, the tallies and the pass rate are the pack's own, and the canonical core travels
// beside them under `core`, where no rendering ever reads it. Nothing WCAG-keyed reaches a
// reader; nothing downstream loses the input it needs.
export interface PackAuditResult {
  tool: "ultra11y";
  /** Discriminates a pack document from a core `AuditResult` at a glance — and in
   *  `isPackAudit`, which must never mistake one for the other. */
  kind: "pack-audit";
  /** The pack key, e.g. "rgaa". Never "wcag": the core keeps its own shape. */
  standard: string;
  /** Display label, e.g. "RGAA 4.1.2" — so a reader of the JSON alone knows what it claims. */
  standardLabel: string;
  version: string;
  schemaVersion: number;
  date: string;
  scope: AuditResult["scope"];
  /** One entry per pack THEME (the RGAA « thématique »), a guideline's counterpart. */
  themes: PackThemeTally[];
  criteria: PackCriterionEntry[];
  /** Pack-keyed: `criteriaId` is the pack criterion, and `criteriaIds` carries every one the
   *  finding fires on when a rule maps to several (RGAA 9.2 AND 12.6 for one landmark miss). */
  findings: PackFinding[];
  residualRisks: ResidualRisk[];
  conformancePct: number;
  /** The canonical WCAG-keyed engine result. Internal plumbing, never rendered. */
  core: AuditResult;
}

export interface PackThemeTally {
  number: number;
  title: string;
  c: number;
  nc: number;
  na: number;
  manual: number;
}

export interface PackCriterionEntry {
  id: string;
  theme: number;
  title: string;
  status: Status;
  findings: PackFinding[];
  justification?: string;
  decidedBy?: "engine" | "agent" | "scan";
  inapplicable?: boolean;
  /** The exact test-level contract used to route deterministic checks and adjudication.
   *  Persisted in the pack audit so the JSON artifact is independently exhaustive. */
  automation?: {
    tests: Record<string, "static" | "rendered" | "judgment">;
    rules: Array<{
      id: string;
      tests: string[];
      effect: "decisive-nc" | "candidate" | "advisory";
      rationale?: string;
    }>;
    completeBySilence?: boolean;
  };
}

export type PackFinding = Omit<Finding, "criteriaId"> & {
  criteriaId: string;
  /** Every pack criterion this finding fires on; `criteriaId` is the first of them. */
  criteriaIds: string[];
};

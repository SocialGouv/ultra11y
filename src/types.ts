// Single source of truth for shared types + the embedded version. sync-version.mjs
// rewrites VERSION at release time (kept in lockstep with package.json + SKILL.md).
export const VERSION = "2.22.0";
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

export interface CriterionResult {
  id: string; // WCAG success-criterion id, e.g. "1.4.3"
  guideline: string; // WCAG guideline this SC belongs to, e.g. "1.4"
  status: Status;
  findings: Finding[];
  justification?: string;
  // Who decided this criterion's status. Absent = the deterministic engine (the default
  // for every audit). "agent" = an AI adjudication of a formerly-`manual` judgment/
  // rendering criterion, recorded via `verify --manual` → `verify --apply` (each carries a
  // justification; an NC carries groundable findings). "scan" = the dynamic tier upgraded
  // a needs-rendering residual to C/NC (src/scan.ts mergeDynamic). Optional/additive — no
  // SCHEMA_VERSION bump; older AuditResult JSON (no `decidedBy`) reads as engine-decided.
  decidedBy?: "engine" | "agent" | "scan";
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
    // Set when dynamic scan results were merged in: which needs-rendering SCs the scan's
    // engines/probes actually MEASURED (verdict coverage — independent of whether anything
    // was found). Docker runner: 320px reflow only; the local runtime adds zoom / text
    // spacing / focus / hover (+ live regions when interactions are on). Union across
    // merges. Drives the partial-audit advisory (src/report.ts untestedNeedsRendering) so
    // the banner never claims a probe ran when it did not. Optional/additive.
    scan?: { testedScs: string[] };
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
  // Optional/additive — absent on a plain engine audit.
  adjudicated?: { date: string; applied: number; stillManual: number };
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
  | "reflow-zoom"
  | "text-spacing"
  | "hover"
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
}

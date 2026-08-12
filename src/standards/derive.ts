// Project a WCAG-keyed AuditResult DOWN onto a pack's criteria — the inverse of the old
// presentation-only WCAG view (former src/standard.ts). For each pack criterion, gather
// the results of the WCAG SCs it maps to and fold them with the same NC-dominates rule.
// Presentation-only: the canonical, gated verdict lives on the WCAG core.
import type { AuditResult, CriterionResult, Status, Finding, Severity } from "../types.js";
import { CORE_KEY, loadPack } from "./registry.js";
import { knownScStatus } from "../wcag.js";
import type { LocaleString, PackCriterion, PackOverride, SecondaryMapping, StandardPack } from "./types.js";

export interface PackCriterionResult {
  id: string;
  theme: number;
  status: Status;
  findings: Finding[];
  scs: string[]; // contributing WCAG SCs
  // Set when EVERY WCAG SC this criterion maps to is outside the engine's WCAG 2.2 AA
  // core (out-of-core AAA, or removed) — the engine has no core SC to project a verdict
  // from, so it's neither a genuine C/NC/NA, just permanently out of scope (status
  // "manual" — see src/report.ts renderPackReport for the dedicated justification).
  outOfScope?: boolean;
  // Set when a mapped SC DID fail, but on elements outside this criterion's applicability
  // scope (per the pack's `appliesTo`) — so the criterion is NOT non-conformant off a
  // sibling's failure. It derives as `manual` (assess separately) with a dedicated
  // scoped-out justification (see src/report.ts renderPackReport).
  scopedOut?: boolean;
  // Set when the pack marks this criterion `judgment` and the projection WOULD have
  // inherited a `C` from a mapped SC that never answered the criterion's own question
  // (RGAA 8.6 "is the title pertinent?" off WCAG 2.4.2 "a title exists"). It derives
  // `manual` instead — see `judgmentGuard` and src/report.ts for the justification.
  judgment?: boolean;
  // Recorded on the adjudicated branch below (an agent verdict at the pack's own
  // granularity wins over the derivation). Declared here because renderings distinguish a
  // conformity the engine PROVED from one an agent RULED — they are not the same claim.
  justification?: string;
  decidedBy?: "engine" | "agent" | "scan";
}

// NC dominates (a real failure anywhere fails the criterion); then a decided C; then
// manual (residual); else NA. Mirrors the core's aggregation.
function aggregate(statuses: Status[]): Status {
  if (statuses.includes("NC")) return "NC";
  if (statuses.includes("C")) return "C";
  if (statuses.includes("manual")) return "manual";
  return "NA";
}

/** Does a finding's ruleId satisfy one of a criterion's applicability patterns?
 *  Exact match, or a "prefix:*" wildcard (axe:* / dyn-* / agent:*), or a bare "*". */
function ruleMatches(ruleId: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (p === "*") return true;
    if (p.endsWith(":*") || p.endsWith("-*")) {
      if (ruleId.startsWith(p.slice(0, -1))) return true;
    } else if (p === ruleId) return true;
  }
  return false;
}

/** Which of a pack's criterion ids a single finding maps onto — the same wcag/appliesTo
 *  projection `derivePackResults` runs per-criterion, exposed per-finding for callers that
 *  render one finding at a time (e.g. src/report.ts's per-page section) rather than the
 *  full aggregated view. A criterion's id is included iff its `wcag` list contains the
 *  finding's SC AND (legacy fan-out when the criterion has no `appliesTo`, or the
 *  finding's ruleId matches one of its `appliesTo.ruleIds` patterns via `ruleMatches`).
 *  Usually one id; can be several (e.g. `contrast-literal` → RGAA 3.2 + 10.5); can be
 *  none when the pack has no criterion mapped to this finding's SC (caller falls back to
 *  the WCAG SC id). */
export function packCriteriaForFinding(pack: StandardPack, finding: Finding): string[] {
  return pack.criteria
    .filter((pc) => pc.wcag.includes(finding.criteriaId) && (!pc.appliesTo || ruleMatches(finding.ruleId, pc.appliesTo.ruleIds)))
    .map((pc) => pc.id);
}

/** The pack-projection pass rate: C ÷ (C + NC) over the pack's own criteria (NOT the core
 *  WCAG criteria) — the same basis the pack report's per-criterion NC table already uses.
 *  Mirrors the core denominator-zero convention (src/audit.ts conformancePct): no decided
 *  criterion ⇒ 100, never a divide-by-zero. `manual`/`NA` criteria don't enter the ratio,
 *  same as core. Exists so a pack report's header rate can't drift from its own table once
 *  pack overrides (advisory/severity flips) make the two diverge from core `conformancePct`. */
export function packConformancePct(derived: PackCriterionResult[]): number {
  // Agent-adjudicated conformities are deliberately excluded, mirroring the core
  // (`recomputeTallies` in src/adjudicate.ts): this number is the AUTOMATIC pass rate, and
  // a judgement — however well gated — is not an automatic verification. An agent NC still
  // counts; lowering the rate off evidenced findings is the safe direction.
  const c = derived.filter((d) => d.status === "C" && d.decidedBy !== "agent").length;
  const nc = derived.filter((d) => d.status === "NC").length;
  return c + nc === 0 ? 100 : Math.round((c / (c + nc)) * 100);
}

/** Apply a pack's normativity/severity overrides to a finding WITHIN the pack projection.
 *  Returns a COPY when an override applies (the core finding is never mutated), or the
 *  original reference when there is nothing to change. */
function overrideFinding(f: Finding, overrides: Record<string, PackOverride> | undefined): Finding {
  const o = overrides?.[f.ruleId];
  if (!o) return f;
  const patched: Finding = { ...f };
  if (o.advisory !== undefined) patched.advisory = o.advisory;
  if (o.severity) patched.severity = o.severity as Severity;
  return patched;
}

/** Resolve a mapping's localized note to a single display string at derive time (no lang in
 *  scope): prefer the pack's default locale, then en/fr, then any present value. */
function pickLocale(ls: LocaleString | undefined, preferred: string): string | undefined {
  if (!ls) return undefined;
  return ls[preferred] ?? ls.en ?? ls.fr ?? Object.values(ls).find((v): v is string => typeof v === "string");
}

/** Copy-tag a finding as projected via a secondary mapping (copy-on-write — the core
 *  finding is never mutated, mirroring `overrideFinding`). Carries the resolved deviation
 *  note so the auditor block can append it. */
function tagSecondary(f: Finding, note: string | undefined): Finding {
  return { ...f, secondary: note ? { note } : {} };
}

/** Apply a pack's ENABLED secondary crosswalk mappings to one criterion's base result. For
 *  every enabled mapping targeting `pc`, gather source findings whose ruleId matches EXACTLY
 *  (bypassing both the SC gate and the appliesTo/ruleMatches gate), copy-tag them, attach,
 *  and let a normative one drive the criterion to NC (re-aggregation: NC dominates). A base
 *  with no active/matching mapping is returned untouched. */
function applySecondaryMappings(
  base: PackCriterionResult,
  pc: PackCriterion,
  enabled: SecondaryMapping[],
  sources: Finding[],
  defaultLocale: string,
): PackCriterionResult {
  const active = enabled.filter((m) => m.criterion === pc.id);
  if (!active.length) return base;
  const added: Finding[] = [];
  for (const m of active) for (const f of sources) if (f.ruleId === m.ruleId) added.push(tagSecondary(f, pickLocale(m.note, defaultLocale)));
  if (!added.length) return base;
  const findings = [...base.findings, ...added];
  // A normative secondary finding drives NC (aggregate: NC dominates), and supersedes an
  // out-of-scope/scoped-out base verdict; an advisory-only one just rides along for display.
  if (added.some((f) => !f.advisory)) return { id: pc.id, theme: pc.theme, status: aggregate([base.status, "NC"]), findings, scs: base.scs };
  return { ...base, findings };
}

/** A criterion the pack marks `judgment` never INHERITS a `C` from its mapped WCAG SCs.
 *
 *  The projection folds the SCs DINUM's own crosswalk cites, and `aggregate` returns `C`
 *  as soon as one of them is `C`. That is the right answer when the RGAA question and the
 *  SC ask the same thing, and a fabricated conformity when the RGAA wording asks more:
 *  RGAA 8.6 wants a *pertinent* page title, WCAG 2.4.2 only a present one; RGAA 13.3 wants
 *  an accessible version of a downloaded document, and no mapped SC ever opened it. Those
 *  derived `C`s were the one error this tool must not make, so they become `manual` and go
 *  to the agent instead.
 *
 *  Only `C` is intercepted: an `NC` was evidenced by a rule that really fired on this
 *  criterion, and an `NA` means nothing in scope is concerned — both stay. */
function judgmentGuard(r: PackCriterionResult, pc: PackCriterion): PackCriterionResult {
  if (!pc.judgment || r.status !== "C") return r;
  return { ...r, status: "manual" as Status, judgment: true };
}

export function derivePackResults(audit: AuditResult, packKey: string): PackCriterionResult[] {
  const pack = loadPack(packKey);
  const byScId = new Map(audit.criteria.map((c) => [c.id, c]));
  // Declarative pack-rule findings belonging to THIS pack (namespaced pack:<key>:). They
  // ride in the audit's dedicated `packFindings` list (never the core criteria), and are
  // routed onto a criterion here via the same appliesTo/ruleMatches machinery as engine
  // findings, keyed by the SC the rule declared.
  const myPackFindings = (audit.packFindings ?? []).filter((f) => f.ruleId.startsWith(`pack:${packKey}:`));
  const overrides = pack.overrides;
  const deriveBase = (pc: PackCriterion): PackCriterionResult => {
    // A criterion whose WCAG mapping is ENTIRELY outside the engine's core (e.g. RGAA 8.1
    // → only the removed 4.1.1, or a hypothetical pack criterion citing only an AAA SC)
    // has no core SC the engine could ever audit — it's out of scope, not a silent NA.
    const outOfScope = pc.wcag.every((sc) => {
      const s = knownScStatus(sc);
      return s === "out-of-core" || s === "removed";
    });
    if (outOfScope) {
      return { id: pc.id, theme: pc.theme, status: "manual" as Status, findings: [], scs: pc.wcag, outOfScope: true };
    }
    const scResults = pc.wcag.map((sc) => byScId.get(sc)).filter((x): x is CriterionResult => !!x);
    // Declarative pack findings whose declared SC this criterion maps to — merged with the
    // core SC findings, then run through the pack's overrides (advisory/severity flips that
    // apply ONLY in this projection; the core copies are never mutated).
    const packFs = myPackFindings.filter((f) => pc.wcag.includes(f.criteriaId));
    const allFindings = [...scResults.flatMap((r) => r.findings), ...packFs].map((f) => overrideFinding(f, overrides));

    // No applicability data (third-party pack) → legacy fan-out: every mapped SC's
    // findings attach (advisory ones project too, so a pack view can render the
    // recommendation) and the SC statuses aggregate directly. The SC status already
    // excludes advisory findings (src/audit.ts finalize), so the aggregate is NC-clean.
    if (!pc.appliesTo) {
      const status: Status = scResults.length ? aggregate(scResults.map((r) => r.status)) : "NA";
      return { id: pc.id, theme: pc.theme, status, findings: allFindings, scs: pc.wcag };
    }

    // Applicability-aware projection: a finding attaches ONLY if its rule is one this
    // criterion can actually be non-conformant on. NC is driven by NON-ADVISORY findings
    // only; advisory findings still attach (so the pack report/PRD renders the
    // recommendation) but never flip the criterion to NC.
    const findings = allFindings.filter((f) => ruleMatches(f.ruleId, pc.appliesTo!.ruleIds));
    const normativeFindings = findings.filter((f) => !f.advisory);
    if (normativeFindings.length) {
      return { id: pc.id, theme: pc.theme, status: "NC" as Status, findings, scs: pc.wcag };
    }
    // No NORMATIVE finding attaches. A mapped SC may still be NC, but on out-of-scope
    // elements (a sibling criterion's failure) — that NC is NOT ours: derive as manual
    // (assess separately), never a foreign NC. Any advisory findings that DO belong here
    // still attach for display (a recommendation, never a non-conformity). This ordering
    // matters: an attached advisory recommendation must not let a scoped-out sibling NC
    // silently flip us to a foreign verdict.
    if (scResults.some((r) => r.status === "NC")) {
      return { id: pc.id, theme: pc.theme, status: "manual" as Status, findings, scs: pc.wcag, scopedOut: true };
    }
    // Otherwise the ordinary non-NC aggregate (C / manual / NA) over the mapped SCs, with
    // any advisory findings kept on the result so the pack view surfaces them.
    const status: Status = scResults.length ? aggregate(scResults.map((r) => r.status)) : "NA";
    return { id: pc.id, theme: pc.theme, status, findings, scs: pc.wcag };
  };

  // Secondary crosswalk projections (opt-in, config-enabled). Sourced from EVERY audit
  // finding (core SC findings + this pack's declarative pack findings), matched by EXACT
  // ruleId — so a sibling rule on the same SC is never pulled onto the secondary criterion.
  const enabledSecondary = (pack.secondaryMappings ?? []).filter((m) => m.enabled === true);
  const secondarySources = enabledSecondary.length ? [...audit.criteria.flatMap((c) => c.findings), ...myPackFindings] : [];
  // An agent adjudication recorded AT THIS PACK'S GRANULARITY wins over the derivation. The
  // engine's projection is an inference from WCAG; a recorded verdict is a decision taken on
  // the pack's own criterion, against its own numbered tests. Nothing else in the pipeline
  // needs to know: report, per-page grid, PRD and packConformancePct all read this function.
  const adjudicated = audit.packAdjudication?.standard === packKey ? new Map(audit.packAdjudication.criteria.map((c) => [c.id, c])) : undefined;

  return pack.criteria.map((pc) => {
    const decided = adjudicated?.get(pc.id);
    if (decided) {
      return {
        id: pc.id,
        theme: pc.theme,
        status: decided.status,
        findings: decided.findings,
        scs: pc.wcag,
        ...(decided.justification ? { justification: decided.justification } : {}),
        decidedBy: "agent" as const,
      };
    }
    const base = judgmentGuard(deriveBase(pc), pc);
    return enabledSecondary.length ? applySecondaryMappings(base, pc, enabledSecondary, secondarySources, pack.defaultLocale) : base;
  });
}

/** The findings a rendering keyed by `standard` should show.
 *
 *  The core is WCAG: a declarative pack rule's finding is NOT a WCAG non-conformity and must
 *  never enter a WCAG-keyed surface (nor `audit --fail-on`, which is why `audit` takes no
 *  `--standard`). Under a pack, its own rule findings are part of its verdict and belong in
 *  every rendering of it — the report already includes them; SARIF, the annotations and the
 *  per-page grid used to drop them silently. */
export function findingsForStandard(audit: AuditResult, standard: string): Finding[] {
  if (standard === CORE_KEY) return audit.findings;
  const mine = (audit.packFindings ?? []).filter((f) => f.ruleId.startsWith(`pack:${standard}:`));
  return mine.length ? [...audit.findings, ...mine] : audit.findings;
}

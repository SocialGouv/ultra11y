// Project a WCAG-keyed AuditResult DOWN onto a pack's criteria — the inverse of the old
// presentation-only WCAG view (former src/standard.ts). For each pack criterion, gather
// the results of the WCAG SCs it maps to and fold them with the same NC-dominates rule.
// Presentation-only: the canonical, gated verdict lives on the WCAG core.
import { ownPackSubjects, subjectsAbsent, subjectsForPackCriterion } from "../adjudicate-subjects.js";
import { findingId } from "../baseline.js";
import { coverageFor, criterionMeasuredOn, unionCoverage } from "../coverage.js";
import type { AuditResult, CriterionResult, PageCoverage, Status, Finding, Severity } from "../types.js";
import { CORE_KEY, loadPack } from "./registry.js";
import { knownScStatus } from "../wcag.js";
import type { LocaleString, PackCriterion, PackOverride, SecondaryMapping, StandardPack } from "./types.js";
import { INAPPLICABLE_STATUS } from "../types.js";

export interface PackCriterionResult {
  id: string;
  theme: number;
  status: Status;
  findings: Finding[];
  /** Engine signals relevant to this criterion but not sufficient to establish NC. They are
   * carried to the adjudication worklist and never enter conformance tallies or gates. */
  candidateFindings?: Finding[];
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
  /** Conforming because nothing of its kind is in scope, not because anything was verified.
   *  Mirrors CriterionResult.inapplicable — see INAPPLICABLE_STATUS. */
  inapplicable?: boolean;
}

/** Whether subject harvesting only PROVISIONALLY closed a judgment criterion.
 *
 * The absence is useful evidence for the adjudicator, but it is not a published verdict:
 * every official `judgment` test still has to pass through the agent. Keep the raw derived
 * result intact for that worklist, while report/page projections use this predicate to show
 * the row as open until an agent has confirmed `NA`. */
export function isProvisionalJudgmentInapplicable(result: PackCriterionResult, criterion?: PackCriterion): boolean {
  if (result.status !== INAPPLICABLE_STATUS || result.inapplicable !== true || result.decidedBy === "agent") return false;
  // `derivePackResults` stamps the fact on the result so downstream arithmetic that only
  // receives the derived rows (not the pack) can make the same publication decision as the
  // report. Keep the criterion lookup as a compatibility fallback for callers holding a row
  // produced before that stamp was added.
  return result.judgment === true || Object.values(criterion?.automation?.tests ?? {}).includes("judgment");
}

// NC dominates (a real failure anywhere fails the criterion); then a decided C; then
// manual (residual); else nothing of that kind exists here. Mirrors the core's aggregation.
//
// A mapped success criterion that came back inapplicable already reads `C` (see
// INAPPLICABLE_STATUS), so the last line is reached only by a pack criterion mapping onto no
// success criterion at all — same answer, same reason.
function aggregate(results: Pick<CriterionResult, "status" | "inapplicable">[]): Status {
  if (results.some((r) => r.status === "NC")) return "NC";
  // A VERIFIED conformity only. An absence-closed one reads `C` too (INAPPLICABLE_STATUS) and
  // must NOT outrank a sibling still to assess: a pack criterion mapping onto one criterion
  // nothing was found for and one nobody has ruled on is undecided, not conforming. Getting
  // this wrong is the precise shape of "conforming because nobody looked" — measured on RGAA
  // 6.1, which mapped onto an image criterion closed for absence and a link criterion still
  // open, and came back conforming on a page whose links had never been read.
  if (results.some((r) => r.status === "C" && !r.inapplicable)) return "C";
  if (results.some((r) => r.status === "manual")) return "manual";
  return INAPPLICABLE_STATUS;
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
    .filter((pc) => {
      if (!pc.wcag.includes(finding.criteriaId) || (pc.appliesTo && !ruleMatches(finding.ruleId, pc.appliesTo.ruleIds))) return false;
      if (!pc.automation) return true;
      return pc.automation.rules.some((rule) => ruleMatches(finding.ruleId, [rule.id]) && rule.effect !== "candidate");
    })
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
  // Subject harvesting may only PROVISIONALLY conclude that a judgment criterion is
  // inapplicable. The report publishes that row as manual until the agent confirms NA, so the
  // headline arithmetic must use the same status rather than credit a hidden conformity.
  const c = derived.filter((d) => d.status === "C" && d.decidedBy !== "agent" && !isProvisionalJudgmentInapplicable(d)).length;
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
  if (added.some((f) => !f.advisory))
    return {
      ...base,
      id: pc.id,
      theme: pc.theme,
      status: aggregate([{ status: base.status, inapplicable: base.inapplicable }, { status: "NC" }]),
      findings,
      scs: base.scs,
    };
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
  if (!(pc.judgment || (pc.automation && pc.automation.completeBySilence !== true)) || r.status !== "C") return r;
  // …unless there is nothing of that kind in scope. The guard exists because the RGAA question
  // is usually BROADER than the success criteria it maps onto, so inheriting their `C` would
  // answer a narrower question than the one asked. A broader question still needs a subject:
  // with no table on the site, "is every complex table's summary relevant?" has nothing to bite
  // on, and reopening it prints a row of work that does not exist.
  if (r.inapplicable) return r;
  return { ...r, status: "manual" as Status, judgment: true };
}

/** THE ONE THING A MEASUREMENT MAY DO TO A DERIVED VERDICT: rescue an UNDECIDED criterion.
 *
 *  `appliesTo.ruleIds` is the pack's own statement of what a criterion can be non-conformant
 *  on. Turned around, it also says what DECIDES it: every one of those rules ran against this
 *  page and none of them fired ⇒ the page conforms — measured, not inferred from silence.
 *  Without it a projection can only repeat the RUN's verdict, so a criterion failing on one
 *  route re-opens « à évaluer » on the thirty-six routes the same rules had just cleared.
 *  Measured on a real RGAA sweep: 7 of the home page's 9 undecided criteria were exactly that.
 *
 *  A RESCUE AND NOT A SHORTCUT, deliberately, and applied LAST. Written as an early branch
 *  inside `deriveBase` it also caught criteria the derivation had already settled, and turned
 *  RGAA 4.10 — conforming for want of any audio in the whole scope — into a plain `C` that
 *  `judgmentGuard` then reopened as « à évaluer ». A criterion that already carries a verdict
 *  keeps it; this only ever touches `manual`.
 *
 *  Three refusals:
 *   • `judgment` criteria. « All its rules were silent » does not answer a question about
 *     PERTINENCE, which is the whole reason `judgmentGuard` exists. Read from the PACK, not
 *     from the derived flag: that flag is only set when the guard actually intercepted a `C`.
 *   • `outOfScope`: no core success criterion to project from at all, which no measurement fixes.
 *   • an ADJUDICATED verdict never reaches here — the adjudication branch returns before this.
 *     An agent that ruled « undecidable » examined the criterion and said so; a rule that
 *     measured something narrower must not overturn it. That is what keeps RGAA 11.9 (« chaque
 *     intitulé de bouton est-il PERTINENT ? ») open when all the engine proved is that the
 *     buttons have names. */
function measuredRescue(
  r: PackCriterionResult,
  pc: PackCriterion,
  cov: PageCoverage | undefined,
  ran: PageCoverage | undefined,
  pageId: string | undefined,
): PackCriterionResult {
  if (r.status !== "manual" || pc.judgment || r.outOfScope || pc.automation?.completeBySilence !== true) return r;
  if (!criterionMeasuredOn(pc.appliesTo?.ruleIds, pc.wcag, cov, ran)) return r;
  // The stale explanations go with the stale status: `scopedOut` and `judgment` say why the
  // criterion STAYED open, and it no longer is.
  const { scopedOut: _scopedOut, judgment: _judgment, ...rest } = r;
  return { ...rest, status: "C" as Status, decidedBy: "scan" as const, justification: measuredReason(pc, pageId) };
}

/** Why a criterion conforms HERE when the run as a whole did not settle it: because every rule
 *  that could fail it ran and reported nothing. Names the rules, so the claim stays falsifiable
 *  — a reader can check that they really ran against this page's snapshot. */
function measuredReason(pc: PackCriterion, pageId: string | undefined): string {
  const rules = (pc.appliesTo?.ruleIds ?? []).join(", ");
  return pageId === undefined
    ? `Measured on every page in scope: ${rules} ran and raised nothing. Conformity here is a MEASUREMENT, not a judgement — a page any of these rules had not run on would have kept this criterion open.`
    : `Measured on this page: ${rules} ran against its rendered snapshot and raised nothing. Conformity here is a MEASUREMENT, not a judgement, and it is about THIS page — the criterion may be non-conforming elsewhere in scope.`;
}

export function derivePackResults(audit: AuditResult, packKey: string, pageId?: string): PackCriterionResult[] {
  const pack = loadPack(packKey);
  const byScId = new Map(audit.criteria.map((c) => [c.id, c]));
  // WHAT WAS MEASURED, and where. `pageId` focuses the projection on one page — the per-page
  // grid and the per-page sheet pass it — and its absence means the whole run, where the
  // answer is the INTERSECTION across every page ("measured everywhere, or nothing"). Both
  // read the same fold, so a page cannot claim a conformity the run's own grid denies.
  const cov = coverageFor(audit, pageId);
  const ran = unionCoverage(audit);
  // Declarative pack-rule findings belonging to THIS pack (namespaced pack:<key>:). They
  // ride in the audit's dedicated `packFindings` list (never the core criteria), and are
  // routed onto a criterion here via the same appliesTo/ruleMatches machinery as engine
  // findings, keyed by the SC the rule declared.
  const myPackFindings = (audit.packFindings ?? []).filter((f) => f.ruleId.startsWith(`pack:${packKey}:`));
  const overrides = pack.overrides;
  // « Nothing of this kind exists here », asked of the PACK's own criterion rather than of the
  // success criteria it maps to.
  //
  // This layer has to exist separately from the WCAG one because a pack criterion is usually
  // narrower than its mapping: RGAA theme 5 is tables end to end, and it maps onto WCAG 1.3.1,
  // which is about structure in general and stays wide open on a page with no table. Deriving
  // from the SC alone can therefore never close a theme that has nothing to answer — and the
  // country standard is exactly where a reader counts rows, so it is where the noise costs
  // most. Measured on a real audit: 96 of 106 RGAA criteria « à évaluer », whole themes among
  // them applicable to nothing in scope.
  //
  // `subjectsSeen === undefined` means the audit predates the fold, not that nothing was
  // found: conclude nothing from it, exactly as the audit itself refuses to conclude from a
  // scope that read no file.
  const seen = audit.scope.subjectsSeen;
  const subjectAbsent = (pc: PackCriterion): boolean => seen !== undefined && subjectsAbsent(subjectsForPackCriterion(packKey, pc.id, pc.wcag), new Set(seen));
  // Did the criterion's OWN subject turn up? Only its own counts: a criterion that declares none
  // has nothing to defend against an inherited closure, and the union it borrows from its WCAG
  // mapping is exactly where that closure came from.
  const ownSubjectSeen = (pc: PackCriterion): boolean => {
    if (seen === undefined) return false;
    const own = ownPackSubjects(packKey, pc.id);
    if (!own?.length) return false;
    const present = new Set(seen);
    return own.some((id) => present.has(id));
  };

  // Rules the PACK ITSELF brings, by finding id. A criterion whose `appliesTo` names one of
  // these has an instrument regardless of what its WCAG mapping is worth — which is the whole
  // point of a pack shipping its own detection.
  const ownRuleIds = new Set((pack.rules ?? []).map((r) => `pack:${packKey}:${r.id}`));

  const deriveBase = (pc: PackCriterion): PackCriterionResult => {
    // A criterion whose WCAG mapping is ENTIRELY outside the engine's core (e.g. a pack
    // criterion citing only an AAA SC) has no core SC the engine could ever audit — it's out
    // of scope, not a silent NA.
    //
    // UNLESS THE PACK BROUGHT ITS OWN INSTRUMENT. « Out of scope » is a statement about what
    // this engine can measure, not about the WCAG crosswalk, and the two stopped agreeing the
    // moment a pack could ship declarative rules. RGAA 8.1 is the case that forced the
    // distinction: it maps only onto the REMOVED 4.1.1, so it was permanently « à évaluer » —
    // while its subject, the doctype, is recorded on every capture and decided by this pack's
    // own `doctype-missing` rule. Deriving from the mapping alone would go on calling a
    // criterion unmeasurable while the measurement sat in the audit.
    const outOfScope =
      pc.wcag.every((sc) => {
        const s = knownScStatus(sc);
        return s === "out-of-core" || s === "removed";
      }) && !(pc.appliesTo?.ruleIds ?? []).some((id) => ownRuleIds.has(id));
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
      const status: Status = scResults.length ? aggregate(scResults) : INAPPLICABLE_STATUS;
      if (status === "manual" && subjectAbsent(pc)) {
        return { id: pc.id, theme: pc.theme, status: INAPPLICABLE_STATUS as Status, findings: allFindings, scs: pc.wcag, inapplicable: true };
      }
      // Conforming for want of a subject only when EVERY success criterion it maps onto was —
      // one that was actually verified makes this a verified conformity, not an empty one.
      const inapplicable = status === INAPPLICABLE_STATUS && (scResults.length === 0 || scResults.every((r) => r.inapplicable));
      return { id: pc.id, theme: pc.theme, status, findings: allFindings, scs: pc.wcag, ...(inapplicable ? { inapplicable: true } : {}) };
    }

    // Applicability-aware projection: a finding attaches ONLY if its rule is one this
    // criterion can actually be non-conformant on. NC is driven by NON-ADVISORY findings
    // only; advisory findings still attach (so the pack report/PRD renders the
    // recommendation) but never flip the criterion to NC.
    const applicableFindings = allFindings.filter((f) => ruleMatches(f.ruleId, pc.appliesTo!.ruleIds));
    const contractFor = (ruleId: string) => pc.automation?.rules.find((rule) => ruleMatches(ruleId, [rule.id]));
    const candidateFindings = pc.automation ? applicableFindings.filter((f) => !f.advisory && contractFor(f.ruleId)?.effect === "candidate") : [];
    const findings = pc.automation ? applicableFindings.filter((f) => f.advisory || contractFor(f.ruleId)?.effect !== "candidate") : applicableFindings;
    const candidate = candidateFindings.length ? { candidateFindings } : {};
    const normativeFindings = findings.filter((f) => !f.advisory && (!pc.automation || contractFor(f.ruleId)?.effect === "decisive-nc"));
    if (normativeFindings.length) {
      return { id: pc.id, theme: pc.theme, status: "NC" as Status, findings, scs: pc.wcag, ...candidate };
    }
    // No NORMATIVE finding attaches. A mapped SC may still be NC, but on out-of-scope
    // elements (a sibling criterion's failure) — that NC is NOT ours: derive as manual
    // (assess separately), never a foreign NC. Any advisory findings that DO belong here
    // still attach for display (a recommendation, never a non-conformity). This ordering
    // matters: an attached advisory recommendation must not let a scoped-out sibling NC
    // silently flip us to a foreign verdict.
    // …UNLESS OUR OWN SUBJECT IS NOT HERE AT ALL, in which case there is nothing to assess
    // separately and « manual » is simply wrong.
    //
    // A sibling's NC says something of ITS kind failed. It says nothing about ours, and the
    // branch below reads it as "come back to this one later" — which is right when our subject
    // exists and nobody has ruled on it, and a permanent open when it does not.
    //
    // Measured on tests/fixtures/realworld: mentions-legales.html declares no language (its
    // seeded 8.3 defect), so WCAG 3.1.1 is NC there. RGAA 8.4 — « pour chaque page AYANT une
    // langue par défaut, le code est-il pertinent ? », subject `declaredLang` — attaches no
    // finding of its own, inherited 3.1.1's NC through this branch, and stayed « à évaluer » on
    // that page for ever: it is `judgment: true`, so silence never earned it a `C` either, and
    // no adjudication could reach a criterion the run-level worklist had already closed.
    //
    // Ordered before the sibling check rather than after, because the two answer different
    // questions and absence is the more specific one.
    if (subjectAbsent(pc)) {
      return { id: pc.id, theme: pc.theme, status: INAPPLICABLE_STATUS as Status, findings, scs: pc.wcag, inapplicable: true, ...candidate };
    }
    if (scResults.some((r) => r.status === "NC")) {
      return { id: pc.id, theme: pc.theme, status: "manual" as Status, findings, scs: pc.wcag, scopedOut: true, ...candidate };
    }
    // A criterion the PACK decides on its own — its instrument is a pack rule, and its WCAG
    // mapping contributes no result (RGAA 8.1: the only SC it cites was removed). The empty
    // aggregate below would read that as « nothing of this kind is in scope » and publish a
    // conformity for want of a subject — on a page nobody captured, where the rule never ran.
    //
    // The honest answer is « undecided », handed to `measuredRescue`: it turns into `C` on the
    // pages where the rule DID run and reported nothing, with a justification naming it, and
    // stays open on the pages where it declined. That is the difference between a measurement
    // and an absence of evidence, and it is the whole reason this branch exists.
    if (!scResults.length && (pc.appliesTo?.ruleIds ?? []).some((id) => ownRuleIds.has(id))) {
      return { id: pc.id, theme: pc.theme, status: "manual" as Status, findings, scs: pc.wcag, ...candidate };
    }
    // Otherwise the ordinary non-NC aggregate (C / manual / NA) over the mapped SCs, with
    // any advisory findings kept on the result so the pack view surfaces them.
    const status: Status = scResults.length ? aggregate(scResults) : INAPPLICABLE_STATUS;
    // NOTHING OF THAT KIND IS IN SCOPE — asked of any verdict but NC.
    //
    // It used to be asked only of `manual`, which quietly missed the case that matters most on
    // a judgment criterion: `aggregate` ranks a verified `C` above `manual`, so one mapped SC
    // coming back conforming makes the whole aggregate `C` — and `judgmentGuard` then reopens
    // that `C` as « à évaluer », because a derived conformity cannot answer a broader question.
    // The criterion ends up open even though its subject does not exist anywhere in scope.
    // Measured on RGAA 13.3/13.4 (« ce document bureautique a-t-il une version accessible ? »)
    // over a site with nothing downloadable: permanently « à évaluer », and the only way to
    // close them was to pay a model to answer « there are no documents ».
    //
    // NC is excluded and stays excluded: something actually fired, so the subject is there.
    if (status !== "NC" && subjectAbsent(pc)) {
      return { id: pc.id, theme: pc.theme, status: INAPPLICABLE_STATUS as Status, findings, scs: pc.wcag, inapplicable: true, ...candidate };
    }
    const inapplicable = status === INAPPLICABLE_STATUS && (scResults.length === 0 || scResults.every((r) => r.inapplicable));
    // AN INHERITED ABSENCE CANNOT CLOSE A CRITERION WHOSE OWN SUBJECT IS PRESENT.
    //
    // `inapplicable` here means every mapped success criterion came back « nothing of that kind
    // is in scope ». That is a statement about THEIR subject, and a pack criterion frequently
    // asks about a different one — which is the entire reason PACK_SUBJECTS exists. Publishing
    // their absence as our conformity is the precise shape of « conforming because nobody
    // looked », and it is worse than leaving the criterion open: in the deliverable it reads
    // identically to a verified conformity.
    //
    // Measured on RGAA 13.2 (« l'ouverture d'une nouvelle fenêtre ne doit pas être déclenchée
    // sans action de l'utilisateur »), which maps onto WCAG 3.2.1, whose subject is a script. On
    // a page carrying `target="_blank"` and no script, 3.2.1 is honestly inapplicable — and 13.2
    // inherited that and reported « conforme faute de sujet » over a link sitting in its own
    // harvest. It surfaced the day `contextChange` became an existence subject, which is what
    // made 3.2.1 closable at all; the flaw predates that and was merely unreachable.
    //
    // The answer is « undecided », never a conformity: our subject is here and nobody has ruled
    // on it. NC is already excluded above, and a criterion declaring no subject of its own is
    // untouched.
    if (inapplicable && ownSubjectSeen(pc)) {
      return { id: pc.id, theme: pc.theme, status: "manual" as Status, findings, scs: pc.wcag, ...candidate };
    }
    return { id: pc.id, theme: pc.theme, status, findings, scs: pc.wcag, ...(inapplicable ? { inapplicable: true } : {}), ...candidate };
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
      // A recorded `NA` — from a ledger written before this engine stopped reporting a third
      // column, or from a model that still speaks it — means "nothing of that kind is in
      // scope", which reads as conforming here (INAPPLICABLE_STATUS). Folded on the way out
      // as well as on the way in (`applyAdjudication`), because a REPLAYED verdict never
      // passes through that fold: it is read straight from the audit JSON.
      const na = decided.status === "NA";
      return {
        id: pc.id,
        theme: pc.theme,
        status: na ? INAPPLICABLE_STATUS : decided.status,
        ...(na ? { inapplicable: true } : {}),
        findings: decided.findings,
        scs: pc.wcag,
        ...(decided.justification ? { justification: decided.justification } : {}),
        decidedBy: "agent" as const,
      };
    }
    const base = judgmentGuard(deriveBase(pc), pc);
    const derived = enabledSecondary.length ? applySecondaryMappings(base, pc, enabledSecondary, secondarySources, pack.defaultLocale) : base;
    const measured = measuredRescue(derived, pc, cov, ran, pageId);
    // Preserve the raw absence-derived `C` for the adjudication worklist, but carry enough
    // metadata for consumers that do not also receive the pack (notably
    // `packConformancePct`) to publish/count it as the open judgment it still is.
    return isProvisionalJudgmentInapplicable(measured, pc) ? { ...measured, judgment: true } : measured;
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
  // The standard's DERIVED GRID is the authority. Returning every core finding here and
  // relying on each renderer to filter it afterwards produced contradictory surfaces: the
  // RGAA heading counted four WCAG 1.3.1 findings while the table (correctly) had no RGAA
  // criterion to attach them to. It also made severity gates fail on defects the selected
  // standard did not count. A finding belongs here only when at least one derived criterion
  // actually carries it.
  // `audit.findings` is also the selection boundary used by baseline-mode CI: that path
  // narrows the flat list to NEW findings while deliberately retaining the full criterion
  // grid for coverage. Match by stable occurrence id (not object identity, which is lost on
  // JSON round-trips), otherwise deriving from the retained grid resurrects the backlog.
  const eligible = new Set(
    [
      ...audit.findings,
      ...(audit.packFindings ?? []).filter((finding) => finding.ruleId.startsWith(`pack:${standard}:`)),
      ...(audit.packAdjudication?.standard === standard ? audit.packAdjudication.criteria.flatMap((criterion) => criterion.findings) : []),
    ].map(findingId),
  );
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const criterion of derivePackResults(audit, standard)) {
    for (const finding of criterion.findings) {
      const id = findingId(finding);
      if (!eligible.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(finding);
    }
  }
  return out;
}

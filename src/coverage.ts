// WHAT A RUN MEASURED, READ BACK — the one place that answers "did this instrument run here?".
//
// The engine has always known which rules ran on which page (src/audit.ts `Accum`), and it has
// always thrown that dimension away: `renderedProves` folded it with an AND across every page
// ("measured everywhere, or nothing"), published one status for the whole run, and discarded
// the rest. That is the right question for a run and the wrong one for a page.
//
// The cost was measured on a real RGAA sweep: 12 criteria non-conforming run-wide, and on the
// home page — which the probes had zoomed, reflowed, tabbed through and measured — 7 of them
// came back « à évaluer », because the projection could only read the run's verdict and the
// run's verdict said NC. Seven of that page's nine undecided cells were pages nobody needed to
// judge; they had already been measured, and the measurement had passed.
//
// So the coverage is persisted per page (`AuditResult.scope.pageCoverage`) and read here. Three
// rules govern every function below, and they are what keeps this from becoming a machine for
// manufacturing conformity:
//
//   1. `undefined` NEVER CONCLUDES. An audit written before the coverage existed, a page nothing
//      was recorded for, a rule nobody can classify — all answer "not measured", which leaves
//      the criterion open. Absence of evidence is not evidence of absence, here as everywhere.
//   2. AN INSTRUMENT THAT DID NOT RUN MEASURED NOTHING. A rule that declined, a probe that never
//      fired, an axe pass that never happened — their silence is not a clean result.
//   3. THE SCOPE-WIDE ANSWER IS THE INTERSECTION, never the union. One page whose collector
//      truncated and the rule drops out for the whole run. The union exists for one narrow
//      question — "is this instrument part of this run at all?" — and never decides a status.
import { AXE_DECIDES } from "./axe-map.js";
import { renderedRulesFor, RENDERED_SIGNAL_RULES } from "./rules/rendered.js";
import type { AuditResult, PageCoverage } from "./types.js";

/** Did the rendered tier prove this success criterion, given one coverage record?
 *
 *  The SAME fold `finalize` applies scope-wide, over one record instead of the accumulator —
 *  extracted so the run verdict and the page verdict cannot drift. A second implementation of
 *  "did the rendered tier prove this?" is a second chance to publish a conformity the other
 *  half would refuse. */
export function renderedProvesOn(sc: string, cov: PageCoverage | undefined): boolean {
  if (!cov) return false;
  // A LIVE PROBE is the other way a criterion gets measured, and for several it is the only
  // way: zoom, reflow, text spacing, hover and focus visibility are properties of a page being
  // acted on, which no digest can settle.
  if (cov.scs?.includes(sc)) return true;
  // AXE, for the handful of criteria it is the canonical decider of (AXE_DECIDES).
  if (AXE_DECIDES[sc] && cov.axe) return true;
  const rules = renderedRulesFor(sc);
  // A criterion NO rule measures (1.4.5, 2.1.2, 2.3.1, 2.4.11, 2.5.8) can never be concluded
  // here — its silence is not a measurement, and reading it as one is exactly the failure this
  // tier exists to avoid.
  if (!rules.length) return false;
  return rules.every((ruleId) => cov.rules?.includes(ruleId) === true);
}

/** Every instrument this run used ANYWHERE. Answers one question and only one: is this rule
 *  part of this run's instrumentation at all? A repository audited without a browser has no
 *  `axe:*` rule in it, and demanding that axe ran on a page would then keep every criterion
 *  open for want of a tool nobody was ever going to use. It must never decide a status — see
 *  rule 3 in the header. */
export function unionCoverage(audit: AuditResult): PageCoverage | undefined {
  const all = Object.values(audit.scope.pageCoverage ?? {});
  if (!all.length) return undefined;
  return {
    dom: all.some((c) => c.dom === true),
    axe: all.some((c) => c.axe === true),
    rules: [...new Set(all.flatMap((c) => c.rules ?? []))].sort(),
    scs: [...new Set(all.flatMap((c) => c.scs ?? []))].sort(),
  };
}

/** What the WHOLE run may conclude from: the intersection across every page in scope.
 *
 *  One page whose collector truncated, whose style digest failed verification or whose
 *  stylesheet was cross-origin, and the rule drops out for the entire scope. Undefined with no
 *  page recorded — an empty record would report `axe: true` by the vacuous "axe ran on all zero
 *  pages", and every AXE_DECIDES criterion would come back conforming on a source-only audit. */
export function intersectCoverage(audit: AuditResult): PageCoverage | undefined {
  const entries = Object.values(audit.scope.pageCoverage ?? {});
  if (!entries.length) return undefined;
  const onEvery = (pick: (c: PageCoverage) => string[] | undefined): string[] =>
    [...new Set(entries.flatMap((c) => pick(c) ?? []))].filter((id) => entries.every((c) => (pick(c) ?? []).includes(id))).sort();
  return {
    dom: entries.every((c) => c.dom === true),
    axe: entries.every((c) => c.axe === true),
    rules: onEvery((c) => c.rules),
    scs: onEvery((c) => c.scs),
  };
}

/** The coverage a projection should read: one page's own record when a page is in focus, else
 *  the run's intersection. One helper so no caller has to remember which of the two it wants. */
export function coverageFor(audit: AuditResult, pageId?: string): PageCoverage | undefined {
  return pageId === undefined ? intersectCoverage(audit) : audit.scope.pageCoverage?.[pageId];
}

/** Did the instrument named by this rule id run, given a coverage record?
 *
 *  Four tiers, and the classification is by rule id because that is what a pack's `appliesTo`
 *  speaks in:
 *   • `axe:*`   — an axe pass covers its whole ruleset at once, so `axe` answers for all of them;
 *   • `dyn-*`   — a live probe, which reports coverage per CRITERION rather than per rule, so the
 *                 caller passes the criterion's success criteria and any one of them being
 *                 probed here means the probe acted on this page;
 *   • a rendered rule — recorded by id, because each one needs its own signals and any of them
 *                 can decline on a page whose digest was incomplete;
 *   • anything else is a static engine rule, and the static set runs in full against every
 *                 document the audit parsed — so reading this page's DOM ran all of them. */
function ruleRanOn(ruleId: string, cov: PageCoverage, scs: string[]): boolean {
  if (ruleId.startsWith("axe:")) return cov.axe === true;
  if (ruleId.startsWith("dyn-")) return scs.some((sc) => cov.scs?.includes(sc) === true);
  if (RENDERED_SIGNAL_RULES.includes(ruleId)) return cov.rules?.includes(ruleId) === true;
  return cov.dom === true;
}

/** Did EVERY instrument that can make this criterion non-conforming run on this page — and did
 *  at least one of them exist in this run at all?
 *
 *  This is the per-page counterpart of `renderedProvesOn`, asked at a PACK criterion's own
 *  granularity. `appliesTo.ruleIds` is the pack's own statement of what this criterion can fail
 *  on (src/standards/derive.ts routes findings through it); the inverse — every one of those
 *  rules ran here and none of them fired — is this page's conformity, measured rather than
 *  inferred from silence.
 *
 *  Three refusals, each of them load-bearing:
 *   • no `appliesTo`, or an empty one: NO rule decides this criterion (RGAA 12.3, « la page plan
 *     du site est-elle pertinente ? »), so nothing here may close it. It is the agent's to rule.
 *   • a WILDCARD pattern (`*`, `axe:*`, `dyn-*`): the rule set it stands for cannot be
 *     enumerated, so "all of them ran" is unprovable. Refuse rather than assume.
 *   • an instrument this run never used anywhere is not a gap in coverage — it is a tool the
 *     run does not own. Excluded from the fold by `ran`, never silently treated as clean. */
export function criterionMeasuredOn(ruleIds: string[] | undefined, scs: string[], cov: PageCoverage | undefined, ran: PageCoverage | undefined): boolean {
  if (!cov || !ran || !ruleIds?.length) return false;
  if (ruleIds.some((p) => p === "*" || p.endsWith(":*") || p.endsWith("-*"))) return false;
  const inThisRun = ruleIds.filter((id) => ruleRanOn(id, ran, scs));
  if (!inThisRun.length) return false;
  return inThisRun.every((id) => ruleRanOn(id, cov, scs));
}

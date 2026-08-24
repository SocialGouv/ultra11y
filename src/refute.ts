// APPLYING WHAT THE REFUTATION TRIAL DECIDED.
//
// `verify --apply` has always been a GATE: it counts the refuted claims and exits non-zero.
// That is the right shape for a human-adjudicated run — someone reads the failure and fixes
// the report. It is the wrong shape for the run this exists to make safe.
//
// A cheap adjudicator over-accuses as a matter of course. Measured on a full RGAA pass with
// Haiku: 74 non-conformities where a stronger model, gated identically, found 57 — and 19 of
// them on criteria the reference ledger had cleared. With that model the refutation pass is
// not a formality that occasionally trips; it fires every run. A pipeline whose only outcome
// is red is a pipeline nobody runs twice, and the safety it was supposed to add is gone.
//
// So `--prune` applies the outcome. The two axes are NOT symmetric, and the asymmetry is the
// whole doctrine:
//
//   A refuted NON-CONFORMITY is deleted. If it was the criterion's last one, the criterion
//   goes back to « to assess » — never to conforming. Deleting a failure does not establish a
//   pass; it establishes that nobody has shown one.
//
//   A refuted CONFORMITY sends its criterion back to « to assess » too, and never to NC.
//   Refuting a conformity proves nothing against the criterion — only that the evidence
//   offered observed a presence rather than a relevance.
//
// Both land on « to assess » from opposite directions, which is the only honest place for a
// claim that was withdrawn with nothing put in its stead.
//
// AND IT NEVER REWRITES AN ENGINE VERDICT. A criterion the deterministic engine decided is
// recomputed from source on every run: pruning it here would be undone by the next audit, and
// a rule that produces a false positive is a bug in the rule, fixed in the rule. Only recorded
// JUDGEMENTS are pruned, which is the same line `conformityClaimsFromAudit` draws.
import type { AuditResult, CriterionResult, Finding, Lang, PackCriterionAdjudication } from "./types.js";
import { recomputeTallies } from "./adjudicate.js";
import { type StandardId, isCore } from "./standards/index.js";
import type { VerifyItem } from "./verify.js";

/** Verdicts that WITHDRAW a claim. `partial` is deliberately absent: it means the claim holds
 *  and its wording is imprecise, which is a report edit, not a retraction. The pair here is
 *  exactly the pair `applyVerdicts` fails the gate on. */
const WITHDRAWN: ReadonlySet<string> = new Set(["refuted", "unsupported"]);

const REASON = {
  fr: {
    nc: "Non-conformité réfutée à la contre-expertise : le constat ne tient pas sur l'élément cité. Le critère retourne « à évaluer » — réfuter une non-conformité n'établit pas la conformité.",
    c: "Conformité revendiquée non étayée à la contre-expertise : l'évidence citée constate une présence, pas une conformité. Le critère retourne « à évaluer » — il ne devient PAS une non-conformité.",
  },
  en: {
    nc: "Non-conformity refuted on review: the observation does not hold on the cited element. The criterion goes back to “to assess” — refuting a non-conformity does not establish conformity.",
    c: "Claimed conformity unsupported on review: the cited evidence observes a presence, not a conformity. The criterion goes back to “to assess” — it does NOT become a non-conformity.",
  },
} as const;

export interface PruneResult {
  audit: AuditResult;
  /** Agent non-conformities deleted because the trial withdrew them. */
  removedFindings: number;
  /** Criteria whose last non-conformity was deleted, so they are open again. */
  reopenedCriteria: string[];
  /** Criteria whose claimed conformity was withdrawn, so they are open again. */
  clearedConformities: string[];
  /** Withdrawn claims left untouched because they name an ENGINE verdict. Reported rather
   *  than silently dropped: a refuted engine finding is a real signal about a RULE, and the
   *  caller should be able to say how many it is sitting on. */
  skippedEngine: number;
}

/** One element, keyed as the worklist keys it: file, line and selector. */
const key = (file: string, line: number, selector: string): string => `${file.trim()}|${line}|${(selector ?? "").trim()}`;
const findingKey = (f: Finding): string => key(f.file, f.line, f.selectorHint);

/**
 * Apply a filled refutation worklist to an audit, returning a NEW audit.
 *
 * The input is never mutated: a caller that decides not to write the result — because the gate
 * failed for another reason, because it is only reporting — must still hold the audit it had.
 */
export function pruneRefuted(audit: AuditResult, standard: StandardId, items: VerifyItem[], lang: Lang = "en"): PruneResult {
  const next: AuditResult = structuredClone(audit);
  const reason = REASON[lang] ?? REASON.en;
  const withdrawn = items.filter((it) => WITHDRAWN.has((it.verdict ?? "").trim().toLowerCase()));
  const removedNc = new Map<string, Set<string>>(); // criterion → anchors to delete
  const withdrawnC = new Set<string>();
  for (const it of withdrawn) {
    if (it.kind === "c") withdrawnC.add(it.criteriaId);
    else (removedNc.get(it.criteriaId) ?? removedNc.set(it.criteriaId, new Set()).get(it.criteriaId)!).add(key(it.file, it.line, it.selector));
  }

  const reopenedCriteria: string[] = [];
  const clearedConformities: string[] = [];
  let removedFindings = 0;
  let skippedEngine: number;
  // Every anchor actually deleted from a criterion, so the flat findings list is filtered by
  // what the criteria agreed to lose — never by the worklist, which may name an engine anchor
  // this pass refuses to touch.
  const deleted = new Set<string>();

  // The criteria this pass actually acted on. Everything a withdrawn claim named and that is
  // NOT in here was an engine verdict — either recorded as one, or (under a pack) never
  // recorded AT ALL, because a criterion the engine decides has no adjudication entry to find.
  // That second case used to fall through both loops and be reported as nothing whatsoever: a
  // refutation silently ignored, on a run whose whole point is not to ignore things. Measured
  // on the fixture: `--standard rgaa` with no adjudication, one engine non-conformity refuted,
  // and the step printed « 0 deleted, 0 back to to assess » and no warning at all.
  const acted = new Set<string>();

  /** Shared between the pack layer and the core layer: they carry different record types but
   *  the decision is identical, and writing it twice is how the two drift. */
  const prune = (rec: { id: string; decidedBy?: string; findings: Finding[] }, setOpen: (why: string) => void) => {
    const isAgent = rec.decidedBy === "agent";
    const drop = removedNc.get(rec.id);
    if (drop?.size) {
      if (isAgent) {
        acted.add(rec.id);
        const keep = rec.findings.filter((f) => {
          const k = findingKey(f);
          // An advisory rides alongside the verdict and is not the claim under trial, so a
          // refuted non-conformity never takes a recommendation down with it.
          if (f.advisory || !drop.has(k)) return true;
          deleted.add(`${rec.id}|${k}`);
          removedFindings++;
          return false;
        });
        rec.findings = keep;
        if (!keep.some((f) => !f.advisory)) {
          reopenedCriteria.push(rec.id);
          setOpen(reason.nc);
        }
      }
    }
    if (withdrawnC.has(rec.id) && isAgent) {
      acted.add(rec.id);
      clearedConformities.push(rec.id);
      setOpen(reason.c);
    }
  };

  if (!isCore(standard) && next.packAdjudication?.standard === standard) {
    for (const rec of next.packAdjudication.criteria as PackCriterionAdjudication[]) {
      prune(rec, (why) => {
        // EXACTLY the shape the gate's own refusal records (`applyAdjudication`, pack branch):
        // still-`manual`, an explicit reason, the explanation in the justification, and NO
        // `decidedBy` — because nobody decided it. `derivePackResults` prefers any recorded
        // entry over its derivation, so this is what the report, the grid and the conformance
        // rate will all read.
        rec.status = "manual";
        rec.reason = "undecidable";
        rec.justification = why;
        rec.findings = [];
        delete rec.decidedBy;
        delete rec.citations;
      });
    }
  } else if (isCore(standard)) {
    for (const rec of next.criteria as CriterionResult[]) {
      prune(rec, (why) => {
        rec.status = "manual";
        rec.justification = why;
        rec.findings = [];
        delete rec.decidedBy;
        delete rec.citations;
        delete rec.inapplicable;
      });
    }
  }

  // Everything the trial withdrew that this pass did not act on — counted here rather than
  // inside the loops, so the case where there is no record to iterate at all is counted too.
  skippedEngine = withdrawn.filter((it) => !acted.has(it.criteriaId)).length;

  // The flat list mirrors the criteria, and only them: an anchor the criteria refused to drop
  // stays here too, or `check`'s grounding would resolve a finding no criterion carries.
  if (deleted.size) next.findings = next.findings.filter((f) => !deleted.has(`${f.criteriaId}|${findingKey(f)}`));
  // A pack prune leaves the WCAG-keyed core untouched, so the core tallies are still right;
  // recomputing is only needed — and only correct — when the core itself changed.
  if (isCore(standard)) recomputeTallies(next);

  return { audit: next, removedFindings, reopenedCriteria, clearedConformities, skippedEngine };
}

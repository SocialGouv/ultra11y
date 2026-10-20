// A BARE NA CANNOT CLEAR EVIDENCE THE AGENT WAS SHOWN.
//
// The contract carried by every worklist (`adjudicationContract`, echoed by the judge schema
// and the brief) requires a `NA` to carry `citations[]` whenever evidence was presented — "to
// say which of those items fall outside the criterion's scope". The fold enforced only the
// `C` half of that sentence, so `verify --apply` accepted a NA with a justification and no
// citations on a criterion carrying harvested evidence: it landed INAPPLICABLE_STATUS, was
// counted « conforme faute de sujet » in the report, and an agent could wave shown evidence
// out of scope with a sentence.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { applyAdjudication, buildAdjudicationWorklist, type AdjudicationFile, type AdjudicationItem } from "../src/adjudicate.js";
import { derivePackResults } from "../src/standards/index.js";
import { INAPPLICABLE_STATUS, type AuditResult } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-na-evidence-"));
const PAGE = join(dir, "page.html");
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Aide</title></head><body><main><h1>Aide</h1><a href="/contact">Nous contacter</a></main></body></html>`,
);

const file = (items: AdjudicationItem[]): AdjudicationFile => ({
  tool: "ultra11y",
  kind: "adjudication",
  schemaVersion: 2,
  standard: "rgaa",
  auditDate: "2026-08-18",
  items,
});

/** The whole criterion ruled NA, plus every other one left `manual` — the shape of a real
 *  one-item adjudication file. */
const naOn = (criteriaId: string, citations?: AdjudicationItem["citations"]) =>
  buildAdjudicationWorklist(runAudit({ inputs: [PAGE] }), { standard: "rgaa" }).map(
    (i): AdjudicationItem =>
      i.criteriaId === criteriaId
        ? { ...i, verdict: "NA", justification: "aucun élément concerné dans le périmètre", citations }
        : { ...i, verdict: "manual", reason: "undecidable" },
  );

const statusOf = (audit: AuditResult, id: string) => derivePackResults(audit, "rgaa").find((c) => c.id === id)?.status;

describe("a NA verdict on a criterion with evidence must cite it", () => {
  it("refuses a bare NA on a criterion carrying harvested evidence, and names the criterion", () => {
    const audit = runAudit({ inputs: [PAGE] });
    const target = buildAdjudicationWorklist(audit, { standard: "rgaa" }).find((i) => i.evidence.length > 0)!;
    const r = applyAdjudication(audit, file(naOn(target.criteriaId)), { cwd: dir });
    expect(r.ok).toBe(false);
    expect(r.rejectedCriteria).toContain(target.criteriaId);
    expect(r.issues.join("\n")).toMatch(new RegExp(`criterion ${target.criteriaId}: a NA verdict on a criterion with evidence must cite it`));
    // Refused means refused: the criterion keeps its « à évaluer » status.
    expect(statusOf(r.audit, target.criteriaId)).toBe("manual");
  });

  it("accepts a NA that cites the evidence it ruled out of scope", () => {
    const audit = runAudit({ inputs: [PAGE] });
    const target = buildAdjudicationWorklist(audit, { standard: "rgaa" }).find((i) => i.evidence.length > 0)!;
    const r = applyAdjudication(audit, file(naOn(target.criteriaId, [target.evidence[0]!])), { cwd: dir });
    expect(r.ok, r.issues.join("\n")).toBe(true);
    expect(statusOf(r.audit, target.criteriaId)).toBe(INAPPLICABLE_STATUS);
  });

  it("still accepts a bare NA on a criterion with no evidence — there is nothing to cite", () => {
    const audit = runAudit({ inputs: [PAGE] });
    const blind = buildAdjudicationWorklist(audit, { standard: "rgaa" }).find((i) => i.evidence.length === 0);
    expect(blind, "expected at least one criterion with no harvested evidence").toBeDefined();
    const r = applyAdjudication(audit, file(naOn(blind!.criteriaId)), { cwd: dir });
    expect(r.ok, r.issues.join("\n")).toBe(true);
    expect(statusOf(r.audit, blind!.criteriaId)).toBe(INAPPLICABLE_STATUS);
  });
});

// SELECT A STANDARD AND YOU GET THAT STANDARD — on every surface, with nothing borrowed from
// another referential.
//
// This used to be true of `report`/`prd`/`tickets` and false of everything else. `audit` took
// no `--standard` at all and ignored `.ultra11yrc.json { "standard": "rgaa" }`, so a French
// project audited against RGAA was told:
//
//     WCAG 2.2 AA audit (ultra11y static engine) — …
//     WCAG guideline        C  NC  NA  ⏳
//       🟡 [3.1.1] site/index.html:14  Invalid language code …
//
// — the wrong referential, the wrong criterion ids and the wrong language, one command before
// `report --standard rgaa` produced flawless French RGAA. The deliverables that DID speak RGAA
// then carried a « **WCAG** : 1.1.1 (A) » line beside every criterion, and their acceptance
// criteria named success criteria rather than the numbered RGAA tests an auditor signs off.
//
// The sharpest symptom was in CI annotations, and it was not merely a wrong vocabulary but a
// false statement: an agent verdict recorded at the pack's own granularity carries
// `criteriaId: "4.11"`, `packCriteriaForFinding` matches nothing for it (4.11 is not a success
// criterion), and the fallback printed « WCAG 4.11 » — a criterion that exists in no version of
// WCAG. 27 such findings on this repository's own fixture.
//
// Every assertion below is about VOCABULARY, never about verdicts: the engine still keys on
// WCAG success criteria because its rules are tied to them and a pack criterion is defined as
// a projection of them. What changed is that the projection now happens before anything
// reaches a reader.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import { auditSummary } from "../src/output.js";
import { renderPackReport } from "../src/report.js";
import { renderPrdDoc, renderBacklog, renderPerCriterion } from "../src/prd.js";
import { annotations, stepSummary } from "../src/annotate.js";
import { toSarif } from "../src/sarif.js";
import { derivePackResults, isProvisionalJudgmentInapplicable, loadPack } from "../src/standards/index.js";
import { packAuditDocument, packCriteriaOf, packCriterionLabel, isPackAudit, unwrapAudit } from "../src/standards/document.js";
import type { AuditResult, Finding } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-pack-only-"));
const PAGE = join(dir, "index.html");
// Deliberately defective markup: a missing alt, an invalid lang, a presentational element and
// an unlabelled field, so several themes of the grid have something to say.
writeFileSync(
  PAGE,
  `<!doctype html><html lang="francais"><head><title>Boutique</title></head><body>
<header><center><font color="red">Promo</font></center></header>
<main><img src="hero.png"><input type="text" name="courriel"></main>
</body></html>`,
);

const audit = (): AuditResult => runAudit({ inputs: [PAGE] });

/** Every surface a reader of an RGAA run actually sees, rendered as one blob. */
const rgaaSurfaces = (r: AuditResult): Record<string, string> => ({
  "audit summary": auditSummary(r, "fr", "rgaa"),
  report: renderPackReport(r, loadPack("rgaa"), "fr"),
  "prd (doc)": renderPrdDoc(r, "fr", "rgaa"),
  "prd (auditor backlog)": renderBacklog(r, "fr", "rgaa"),
  "prd (per criterion)": renderPerCriterion(r, "fr", "rgaa")
    .map((f) => f.content)
    .join("\n"),
  annotations: annotations(r, { standard: "rgaa", lang: "fr" }).join("\n"),
  "step summary": stepSummary(r, { standard: "rgaa", lang: "fr" }),
  sarif: JSON.stringify(toSarif(r, { standard: "rgaa", lang: "fr" })),
});

describe("a run under --standard rgaa names RGAA and nothing else", () => {
  it.each(Object.keys(rgaaSurfaces(audit())))("%s carries no WCAG reference", (surface) => {
    expect(rgaaSurfaces(audit())[surface]).not.toMatch(/wcag/i);
  });

  it("still names WCAG under the core, which is the whole point of the core", () => {
    const summary = auditSummary(audit(), "en");
    expect(summary).toMatch(/WCAG/);
    expect(JSON.stringify(toSarif(audit(), { lang: "en" }))).toMatch(/wcag:/);
  });

  it("tags findings with the pack's criteria, not with success criteria", () => {
    const summary = auditSummary(audit(), "fr", "rgaa");
    // The invalid `lang` is RGAA 8.4; under the core the same finding reads 3.1.1.
    expect(summary).toMatch(/\[8\.4\]/);
    expect(summary).not.toMatch(/\[3\.1\.1\]/);
    expect(auditSummary(audit(), "en")).toMatch(/\[3\.1\.1\]/);
  });

  it("titles the summary with the pack and tabulates its themes", () => {
    const summary = auditSummary(audit(), "fr", "rgaa");
    expect(summary).toMatch(/Audit RGAA 4\.1\.2/);
    expect(summary).toMatch(/Thématique/);
    expect(summary).toMatch(/10\. Présentation/);
  });
});

describe("a finding already keyed on a pack criterion", () => {
  // The shape an agent verdict folds in as: ruleId `agent:<pack criterion>`, criteriaId the
  // pack criterion itself. `packCriteriaForFinding` cannot match it — it looks the id up among
  // success criteria — so this is the case the old fallback turned into « WCAG 4.11 ».
  const agentFinding = {
    ruleId: "agent:4.11",
    criteriaId: "4.11",
    file: "index.html",
    line: 1,
    col: 1,
    selectorHint: "video",
    severity: "majeur",
    message: "Le lecteur vidéo n'est pas contrôlable au clavier.",
    remediation: "Exposez les contrôles au clavier.",
  } as unknown as Finding;

  it("is recognised as belonging to the pack, and labelled with the pack", () => {
    const pack = loadPack("rgaa");
    expect(packCriteriaOf(pack, agentFinding)).toEqual(["4.11"]);
    expect(packCriterionLabel(pack, agentFinding)).toBe("RGAA 4.11");
  });

  it("reaches CI annotations as RGAA 4.11, never as a WCAG criterion that does not exist", () => {
    const r = {
      ...audit(),
      findings: [agentFinding],
      packAdjudication: {
        standard: "rgaa",
        criteria: [{ id: "4.11", status: "NC" as const, findings: [agentFinding], decidedBy: "agent" as const }],
      },
    };
    const out = annotations(r, { standard: "rgaa", lang: "fr" }).join("\n");
    expect(out).toContain("RGAA 4.11");
    expect(out).not.toMatch(/WCAG/);
  });

  it("is dropped, not relabelled, when it belongs to no criterion of the standard", () => {
    const alien = { ...agentFinding, ruleId: "agent:99.99", criteriaId: "99.99" } as Finding;
    expect(packCriteriaOf(loadPack("rgaa"), alien)).toEqual([]);
    expect(packCriterionLabel(loadPack("rgaa"), alien)).toBeNull();
    expect(annotations({ ...audit(), findings: [alien] }, { standard: "rgaa", lang: "fr" }).join("\n")).not.toContain("99.99");
  });
});

describe("the pack-keyed audit document", () => {
  it("is the pack's grid on the surface and the engine's core underneath", () => {
    const doc = packAuditDocument(audit(), "rgaa", "fr");
    expect(doc.kind).toBe("pack-audit");
    expect(doc.standard).toBe("rgaa");
    expect(doc.standardLabel).toBe("RGAA 4.1.2");
    expect(doc.criteria).toHaveLength(106);
    expect(doc.themes).toHaveLength(13);
    expect(doc.core.standard).toBe("wcag");
    expect(doc.core.criteria).toHaveLength(55);
  });

  it("unwraps back to the core, and is idempotent under a second wrap", () => {
    const doc = packAuditDocument(audit(), "rgaa", "fr");
    expect(isPackAudit(doc)).toBe(true);
    expect((unwrapAudit(doc) as AuditResult).standard).toBe("wcag");
    // Four `--in` readers cast their JSON straight to AuditResult with no guard, so a pack
    // document reaching one of them was wrapped a SECOND time: `core.core`, no `guidelines`
    // where the next reader looks, and `report` refusing an audit it had just written.
    const twice = packAuditDocument(doc, "rgaa", "fr");
    expect(twice.core.standard).toBe("wcag");
    expect((twice.core as unknown as { core?: unknown }).core).toBeUndefined();
  });

  it("never lets a criterion that is not NC carry a NORMATIVE finding", () => {
    // Re-keying the raw rule→criterion mapping looked equivalent to reading the derivation and
    // was not: `derivePackResults` applies the pack's `appliesTo` scoping, its judgment guard
    // and any agent verdict at the pack's own granularity, so a criterion can end up NOT
    // non-conformant while rules mapping to it fired elsewhere. Measured on this repository's
    // fixture: RGAA 4.3 came out « C » carrying three `media-no-track` findings — a conforming
    // criterion publishing its own non-conformities.
    //
    // ADVISORY findings are the deliberate exception, and the reason this is not simply
    // "carries no findings": a recommendation is explicitly NOT a non-conformity, so it rides
    // along on a criterion nobody has ruled without saying anything about its status.
    const doc = packAuditDocument(audit(), "rgaa", "fr");
    const contradictory = doc.criteria.filter((c) => c.status !== "NC" && c.findings.some((f) => !f.advisory));
    expect(contradictory.map((c) => `${c.id} (${c.status})`)).toEqual([]);
  });

  it("lists each finding once, carrying every criterion it counts against", () => {
    const doc = packAuditDocument(audit(), "rgaa", "fr");
    // A finding appears ONCE at the top level however many criteria it counts against —
    // listing it per criterion would report several defects where the page has one.
    const keys = doc.findings.map((f) => `${f.ruleId}|${f.file}|${f.line}|${f.selectorHint}`);
    expect(new Set(keys).size).toBe(keys.length);
    // Its `criteriaId` is always the first of its `criteriaIds`, so every consumer of the
    // single-id field keeps working while the full list stays available.
    for (const f of doc.findings) expect(f.criteriaId).toBe(f.criteriaIds[0]);
    // …and every top-level finding is one the derivation attributed to some criterion.
    const fromCriteria = new Set(doc.criteria.flatMap((c) => c.findings.map((f) => `${f.ruleId}|${f.file}|${f.line}`)));
    for (const f of doc.findings) expect(fromCriteria.has(`${f.ruleId}|${f.file}|${f.line}`)).toBe(true);
  });

  it("counts NA as a subset of C, so C + NC + manual is the criterion count", () => {
    const doc = packAuditDocument(audit(), "rgaa", "fr");
    const sum = (k: "c" | "nc" | "na" | "manual") => doc.themes.reduce((n, t) => n + t[k], 0);
    expect(sum("c") + sum("nc") + sum("manual")).toBe(106);
    expect(sum("na")).toBeLessThanOrEqual(sum("c"));
  });

  it("publishes provisional judgment inapplicability as manual in JSON, tallies and residual risks", () => {
    const source = audit();
    const provisionalIds = derivePackResults(source, "rgaa")
      .filter((row) => isProvisionalJudgmentInapplicable(row))
      .map((row) => row.id);
    expect(provisionalIds.length).toBeGreaterThan(0);
    const doc = packAuditDocument(source, "rgaa", "fr");
    for (const id of provisionalIds) {
      const c = doc.criteria.find((row) => row.id === id)!;
      expect(c.status).toBe("manual");
      expect(c.inapplicable).toBeUndefined();
      expect(c.justification).toContain("l'IA doit confirmer");
      expect(doc.residualRisks.some((risk) => risk.criteriaId === id && risk.reason.length > 0)).toBe(true);
    }
    const tallyManual = doc.themes.reduce((n, theme) => n + theme.manual, 0);
    expect(tallyManual).toBe(doc.criteria.filter((c) => c.status === "manual").length);
  });
});

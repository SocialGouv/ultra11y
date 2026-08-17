import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import { renderReport } from "../src/report.js";
import { buildWorklist } from "../src/verify.js";
import {
  buildAdjudicationWorklist,
  applyAdjudication,
  writeAdjudication,
  formatAdjudication,
  ADJUDICATE_MAX_EVIDENCE,
  type AdjudicationFile,
  type AdjudicationItem,
} from "../src/adjudicate.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-adj-"));
function fixture(name: string, html: string): string {
  const f = join(dir, name);
  writeFileSync(f, html);
  return f;
}

// A page rich enough to harvest evidence for several judgment criteria.
const PAGE = fixture(
  "page.html",
  `<!doctype html>
<html lang="en">
<head><title>Shop</title></head>
<body>
<main>
<h1>Welcome</h1>
<img src="hero.png" alt="A hiker on a ridge at sunrise">
<img src="chart.png" alt="chart">
<p style="color:#333; background:#fff">Readable</p>
<a href="/pricing">Read more</a>
<a href="/help">Contact support</a>
<label for="email">Email</label><input id="email" type="email">
</main>
</body>
</html>`,
);

function auditPage() {
  return runAudit({ inputs: [PAGE] });
}

function file(items: AdjudicationItem[], auditDate = "2026-07-08"): AdjudicationFile {
  return { tool: "ultra11y", kind: "adjudication", schemaVersion: 2, standard: "wcag", auditDate, items };
}

describe("buildAdjudicationWorklist", () => {
  const audit = auditPage();
  const items = buildAdjudicationWorklist(audit);

  it("emits exactly one item per residual-risk (manual) criterion", () => {
    const residualIds = new Set(audit.residualRisks.map((r) => r.criteriaId));
    const itemIds = new Set(items.map((i) => i.criteriaId));
    expect(itemIds).toEqual(residualIds);
    expect(items.every((i) => i.verdict === null && i.decidedBy === "agent")).toBe(true);
  });

  it("harvests every image's alt value for 1.1.1", () => {
    const c = items.find((i) => i.criteriaId === "1.1.1")!;
    const alts = c.evidence.map((e) => e.snippet).join(" ");
    expect(alts).toContain("A hiker on a ridge at sunrise");
    expect(alts).toContain('alt="chart"');
    expect(c.evidence.every((e) => e.line > 0 && e.file.includes("page.html"))).toBe(true);
  });

  it("harvests link text + href + nearest heading context for 2.4.4", () => {
    const c = items.find((i) => i.criteriaId === "2.4.4")!;
    const blob = JSON.stringify(c.evidence);
    expect(blob).toContain("Read more");
    expect(blob).toContain("/pricing");
    expect(c.evidence.some((e) => (e.note ?? "").includes("Welcome"))).toBe(true); // preceding <h1>
  });

  it("harvests literal inline color pairs for 1.4.3", () => {
    const c = items.find((i) => i.criteriaId === "1.4.3");
    // 1.4.3 is needs-rendering; if present as residual it should carry the color evidence.
    if (c) expect(JSON.stringify(c.evidence)).toMatch(/#333|#fff/);
  });

  it("caps evidence per criterion and records the truncation honestly", () => {
    const many = fixture(
      "many.html",
      `<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>h</h1>${Array.from({ length: 50 }, (_, i) => `<a href="/l${i}">link ${i}</a>`).join("")}</main></body></html>`,
    );
    const a = runAudit({ inputs: [many] });
    const c = buildAdjudicationWorklist(a).find((i) => i.criteriaId === "2.4.4")!;
    expect(c.evidence.length).toBe(ADJUDICATE_MAX_EVIDENCE);
    expect(c.evidenceTruncated).toBeDefined();
    expect(c.evidenceTruncated!.total).toBeGreaterThan(ADJUDICATE_MAX_EVIDENCE);
  });
});

// A C verdict is now evidence-bound: it must cite the harvested evidence it cleared, and a
// criterion with NO evidence cannot be C at all (it stays manual). These helpers build the
// honest shape so the fixtures below exercise the gate rather than fight it.
const clearWith = (i: AdjudicationItem, justification: string): AdjudicationItem =>
  i.evidence.length ? { ...i, verdict: "C" as const, justification, citations: [i.evidence[0]!] } : { ...i, verdict: "manual" as const, reason: "undecidable" };

describe("applyAdjudication — updates the audit + records provenance", () => {
  it("applies a C verdict with justification and records decidedBy:agent", () => {
    const audit = auditPage();
    const items = buildAdjudicationWorklist(audit).map((i) =>
      i.criteriaId === "2.4.4" ? clearWith(i, "Every link text is self-describing in context.") : { ...i, verdict: "manual" as const, reason: "undecidable" },
    );
    const r = applyAdjudication(audit, file(items));
    expect(r.ok).toBe(true);
    const c = r.audit.criteria.find((c) => c.id === "2.4.4")!;
    expect(c.status).toBe("C");
    expect(c.decidedBy).toBe("agent");
    expect(c.justification).toContain("self-describing");
  });

  it("an agent NC lands in audit.findings, renders in §2, and re-enters the verify worklist", () => {
    const audit = auditPage();
    const items = buildAdjudicationWorklist(audit).map((i) =>
      i.criteriaId === "1.1.1"
        ? {
            ...i,
            verdict: "NC" as const,
            findings: [
              {
                file: PAGE,
                line: 9,
                selector: "img",
                message: 'alt="chart" is not descriptive',
                snippet: 'alt="chart"',
                severity: "majeur" as const,
                normativeRef: "1.1.1",
              },
            ],
          }
        : { ...i, verdict: "manual" as const, reason: "undecidable" },
    );
    const r = applyAdjudication(audit, file(items));
    expect(r.ok).toBe(true);
    expect(r.audit.findings.some((f) => f.ruleId === "agent:1.1.1")).toBe(true);
    const report = renderReport(r.audit, "en");
    expect(report).toMatch(/1\.1\.1/);
    const wl = buildWorklist(report, "wcag", Number.POSITIVE_INFINITY);
    expect(wl.some((w) => w.criteriaId === "1.1.1")).toBe(true);
  });

  it("keeps an agent C out of the AUTOMATIC pass rate, and lets an agent NC into it", () => {
    // `conformancePct` is labelled everywhere as the automatic static-check rate. An
    // adjudicated conformity is a judgement, however well gated, so it must not inflate
    // that number — otherwise one `judge` pass turns opinion into a machine-verified
    // figure. A non-conformity is evidenced, and lowering the rate is the safe direction.
    const audit = auditPage();
    const before = audit.conformancePct;

    const cleared = buildAdjudicationWorklist(audit).map((i) => clearWith(i, "assessed conforming from source"));
    const rC = applyAdjudication(audit, file(cleared));
    expect(rC.ok).toBe(true);
    expect(rC.audit.criteria.some((c) => c.status === "C" && c.decidedBy === "agent")).toBe(true);
    expect(rC.audit.conformancePct).toBe(before);

    const accused = buildAdjudicationWorklist(audit).map((i) =>
      i.criteriaId === "2.4.4"
        ? {
            ...i,
            verdict: "NC" as const,
            justification: "",
            findings: [
              {
                file: PAGE,
                line: 11,
                selector: "a",
                message: "Link text is not explicit out of context.",
                snippet: '<a href="/pricing">Read more</a>',
                normativeRef: "2.4.4",
              },
            ],
          }
        : { ...i, verdict: "manual" as const, reason: "undecidable" },
    );
    const rNC = applyAdjudication(audit, file(accused));
    expect(rNC.ok).toBe(true);
    expect(rNC.audit.conformancePct).toBeLessThan(before);
  });

  it("§5 shrinks to only still-manual items and keeps the '## 5.' heading", () => {
    const audit = auditPage();
    const items = buildAdjudicationWorklist(audit).map((i, idx) =>
      idx === 0 ? { ...i, verdict: "manual" as const, reason: "needs-rendered-dom" } : clearWith(i, "assessed from source"),
    );
    const r = applyAdjudication(audit, file(items));
    const report = renderReport(r.audit, "en");
    expect(report).toContain("## 5.");
    // It SHRINKS — it does not empty: a criterion the harvester found no evidence for
    // cannot be cleared, so it honestly stays manual instead of being waved through.
    const manualCount = r.audit.criteria.filter((c) => c.status === "manual").length;
    expect(manualCount).toBeLessThan(audit.residualRisks.length);
    expect(r.audit.criteria.filter((c) => c.status === "C" && c.decidedBy === "agent").length).toBeGreaterThan(0);
  });
});

// The fold is fail-closed PER VERDICT, not per FILE. Measured on a real CI run: 95 of 96
// verdicts were filled correctly, one was null, and the all-or-nothing fold discarded all 96 —
// so a $16 adjudication published « to assess » across the whole grid. A refusal must cost its
// own criterion and nothing else.
describe("applyAdjudication — partial fold", () => {
  const withOneNull = () => {
    const audit = auditPage();
    const items = buildAdjudicationWorklist(audit).map((i) =>
      i.criteriaId === "1.1.1" ? { ...i, verdict: null } : clearWith(i, "assessed conforming from source"),
    );
    return { audit, items };
  };

  it("applies every valid verdict and refuses only the offending criterion", () => {
    const { audit, items } = withOneNull();
    const r = applyAdjudication(audit, file(items));

    expect(r.rejected).toBe(1);
    expect(r.rejectedCriteria).toEqual(["1.1.1"]);
    expect(r.applied).toBeGreaterThan(1); // the other verdicts landed…
    expect(r.audit.criteria.find((c) => c.id === "1.1.1")!.status).toBe("manual"); // …this one did not
    // `ok` still reports "the file had issues" — a caller that wants the old contract reads it.
    expect(r.ok).toBe(false);
  });

  it("never applies a refused verdict, even when the rest of the file is clean", () => {
    const audit = auditPage();
    // A C verdict citing evidence it was never shown — the fabrication check.
    const items = buildAdjudicationWorklist(audit).map((i) =>
      i.criteriaId === "2.4.4"
        ? { ...i, verdict: "C" as const, justification: "looks fine", citations: [{ file: PAGE, line: 999, selector: "a", snippet: "invented" }] }
        : clearWith(i, "assessed conforming from source"),
    );
    const r = applyAdjudication(audit, file(items));

    expect(r.rejectedCriteria).toContain("2.4.4");
    const c = r.audit.criteria.find((c) => c.id === "2.4.4")!;
    expect(c.status).toBe("manual");
    expect(c.decidedBy).not.toBe("agent");
  });

  it("keeps a refused criterion in the residual set, carrying the refusal as its reason", () => {
    const { audit, items } = withOneNull();
    const r = applyAdjudication(audit, file(items));

    const residual = r.audit.residualRisks.find((x) => x.criteriaId === "1.1.1");
    expect(residual).toBeDefined();
    // The whole point of the reason: no blank « to assess » cell anywhere in the report.
    expect(residual!.reason).toMatch(/refused by the gate/i);
    expect(residual!.reason).toMatch(/unadjudicated/i);
    expect(residual!.reason).not.toMatch(/^\s*$/);
  });

  it("records the refusal count on the audit, and omits it when nothing was refused", () => {
    const { audit, items } = withOneNull();
    expect(applyAdjudication(audit, file(items)).audit.adjudicated?.rejected).toBe(1);

    const clean = auditPage();
    const allClear = buildAdjudicationWorklist(clean).map((i) => clearWith(i, "assessed conforming from source"));
    const rClean = applyAdjudication(clean, file(allClear));
    expect(rClean.rejected).toBe(0);
    expect(rClean.audit.adjudicated?.rejected).toBeUndefined();
  });

  it("strict mode restores the all-or-nothing fold", () => {
    const { audit, items } = withOneNull();
    const r = applyAdjudication(audit, file(items), { strict: true });

    expect(r.ok).toBe(false);
    expect(r.applied).toBe(0);
    expect(r.rejected).toBe(0); // nothing was singled out — the FILE was refused
    expect(r.audit).toBe(audit); // the audit is returned untouched
  });

  it("refuses a coverage gap without costing the criteria that were ruled on", () => {
    const audit = auditPage();
    const all = buildAdjudicationWorklist(audit).map((i) => clearWith(i, "assessed conforming from source"));
    const missing = all[0]!.criteriaId;
    const r = applyAdjudication(audit, file(all.slice(1)));

    expect(r.rejectedCriteria).toContain(missing);
    expect(r.applied).toBeGreaterThan(0);
    expect(r.audit.residualRisks.find((x) => x.criteriaId === missing)!.reason).toMatch(/coverage gap/i);
  });
});

describe("applyAdjudication — fail-closed validation", () => {
  const baseItems = () => buildAdjudicationWorklist(auditPage());
  const decideAll = (over: Partial<AdjudicationItem>, only?: string) =>
    baseItems().map((i) =>
      only && i.criteriaId !== only
        ? { ...i, verdict: "manual" as const, reason: "undecidable" }
        : { ...i, verdict: "manual" as const, reason: "undecidable", ...over },
    );

  it("fails on a null verdict (unadjudicated criterion)", () => {
    const items = baseItems(); // all verdict null
    expect(applyAdjudication(auditPage(), file(items)).ok).toBe(false);
  });

  // ---- The conforming side of the gate ----
  // A clearing verdict used to be validated by one predicate: "the justification is a
  // non-empty string". A model answering C to every criterion with the justification "x"
  // therefore passed, and the report published dozens of conformities nobody had
  // assessed — the one error this tool must not make. A C is now cited like an NC.

  it("refuses a C whose justification is prose with no citation", () => {
    const items = decideAll({ verdict: "C", justification: "Tout va bien, j'ai regardé." }, "2.4.4");
    const r = applyAdjudication(auditPage(), file(items));
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/2\.4\.4.*must cite at least one/s);
  });

  it("refuses a C on a criterion the harvester found no evidence for", () => {
    // Nothing was presented, so nothing could have been read: the honest verdicts are
    // `manual` or `NA`, and a `C` here would be conformity by silence.
    const blind = baseItems().find((i) => i.evidence.length === 0);
    expect(blind, "expected at least one criterion with no harvested evidence").toBeDefined();
    const items = decideAll({ verdict: "C", justification: "conforme" }, blind!.criteriaId);
    const r = applyAdjudication(auditPage(), file(items));
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/needs evidence to cite/);
  });

  it("refuses a citation that is not among the evidence the criterion was shown", () => {
    const src = baseItems().find((i) => i.criteriaId === "2.4.4")!;
    const items = decideAll({ verdict: "C", justification: "ok", citations: [{ ...src.evidence[0]!, line: 9999 }] }, "2.4.4");
    const r = applyAdjudication(auditPage(), file(items));
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/not among this criterion's harvested evidence/);
  });

  it("accepts a C that cites the evidence it was shown", () => {
    const src = baseItems().find((i) => i.criteriaId === "2.4.4")!;
    const items = decideAll({ verdict: "C", justification: "Chaque intitulé est explicite.", citations: [src.evidence[0]!] }, "2.4.4");
    const r = applyAdjudication(auditPage(), file(items));
    expect(r.ok, r.issues.join(" | ")).toBe(true);
    expect(r.audit.criteria.find((c) => c.id === "2.4.4")?.status).toBe("C");
  });

  it("refuses an item for a criterion the engine already decided", () => {
    // The coverage check only proved every OPEN criterion was ruled on. Without the other
    // direction, a surplus item overwrote an engine-decided verdict with an agent one.
    const audit = auditPage();
    const decided = audit.criteria.find((c) => c.status === "NC" || c.status === "C")!;
    const surplus: AdjudicationItem = {
      ...baseItems()[0]!,
      criteriaId: decided.id,
      evidence: [],
      verdict: "C",
      justification: "x",
      reason: null,
      findings: [],
    };
    const items = [...decideAll({}), surplus];
    const r = applyAdjudication(audit, file(items));
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/not open for adjudication/);
  });

  it("fails a C without a justification", () => {
    const items = decideAll({ verdict: "C", justification: "" }, "2.4.4");
    const r = applyAdjudication(auditPage(), file(items));
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/2\.4\.4/);
  });

  it("fails an NA without a justification", () => {
    const items = decideAll({ verdict: "NA", justification: "" }, "2.4.4");
    expect(applyAdjudication(auditPage(), file(items)).ok).toBe(false);
  });

  it("fails an NC without a groundable finding", () => {
    const items = decideAll({ verdict: "NC", findings: [] }, "1.1.1");
    expect(applyAdjudication(auditPage(), file(items)).ok).toBe(false);
  });

  it("fails a manual verdict without a reason", () => {
    const items = decideAll({ verdict: "manual", reason: null }, "1.1.1");
    expect(applyAdjudication(auditPage(), file(items)).ok).toBe(false);
  });

  it("fails when a residual criterion is missing from the adjudication file (coverage gap)", () => {
    const items = baseItems()
      .map((i) => ({ ...i, verdict: "manual" as const, reason: "undecidable" }))
      .slice(0, -1); // drop one
    expect(applyAdjudication(auditPage(), file(items)).ok).toBe(false);
  });

  it("fails an agent NC whose snippet does not match the cited source", () => {
    const items = decideAll(
      { verdict: "NC", findings: [{ file: PAGE, line: 9, selector: "video", message: "bogus", snippet: "<video controls></video>", normativeRef: "1.1.1" }] },
      "1.1.1",
    );
    const r = applyAdjudication(auditPage(), file(items));
    expect(r.ok).toBe(false);
    expect(r.grounding.failed).toBeGreaterThan(0);
  });

  it("fails an NC finding with no normativeRef (a good practice needs a normative test to be an NC)", () => {
    const items = decideAll(
      { verdict: "NC", findings: [{ file: PAGE, line: 9, selector: "img", message: 'alt="chart" is vague', snippet: 'alt="chart"' }] },
      "1.1.1",
    );
    const r = applyAdjudication(auditPage(), file(items));
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/normativeRef/);
  });

  it("fails an NC finding whose normativeRef does not resolve to a real WCAG SC", () => {
    const items = decideAll(
      { verdict: "NC", findings: [{ file: PAGE, line: 9, selector: "img", message: 'alt="chart" is vague', snippet: 'alt="chart"', normativeRef: "9.9.9" }] },
      "1.1.1",
    );
    const r = applyAdjudication(auditPage(), file(items));
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/9\.9\.9|does not resolve/);
  });
});

// normativeRefResolves' pack branch (src/adjudicate.ts): for a non-core standard the ref
// must resolve either as a pack CRITERION id (`hasId`) or as a pack TEST id
// ("<criterionId>.<testKey>", split at the last dot — see the function's own doc comment).
// The WCAG-core branch (hasSC) is covered above; this exercises the RGAA pack branch,
// which had no coverage at all.
describe("applyAdjudication — pack normativeRef resolution (RGAA)", () => {
  // Under a pack the worklist is keyed by PACK criterion, so a citation is checked against
  // that criterion's own numbered tests. Building a WCAG-keyed worklist and folding it as
  // RGAA (what these tests used to do) is the incoherent state that let a WCAG success
  // criterion be silently read as an unrelated RGAA test — see tests/adjudicate-pack.test.ts.
  const rgaaFile = (items: AdjudicationItem[]): AdjudicationFile => ({
    tool: "ultra11y",
    kind: "adjudication",
    schemaVersion: 2,
    standard: "rgaa",
    auditDate: "2026-07-08",
    items,
  });
  /** Every RGAA item left `manual`, except `only`, which takes `over`. */
  const decideAllRgaa = (over: Partial<AdjudicationItem>, only: string) =>
    buildAdjudicationWorklist(auditPage(), { standard: "rgaa" }).map((i) =>
      i.criteriaId === only
        ? { ...i, verdict: "manual" as const, reason: "undecidable", ...over }
        : { ...i, verdict: "manual" as const, reason: "undecidable" },
    );
  const ncOn = (criterion: string, normativeRef: string) =>
    decideAllRgaa(
      {
        verdict: "NC",
        reason: null,
        findings: [{ file: PAGE, line: 9, selector: "img", message: 'alt="chart" is vague', snippet: 'alt="chart"', normativeRef }],
      },
      criterion,
    );

  it('accepts the pack CRITERION id itself as normativeRef (RGAA "1.1" on criterion 1.1)', () => {
    const r = applyAdjudication(auditPage(), rgaaFile(ncOn("1.1", "1.1")));
    expect(r.ok, r.issues.join(" | ")).toBe(true);
  });

  it('accepts one of that criterion\'s own tests (RGAA "1.1.1" on criterion 1.1)', () => {
    const r = applyAdjudication(auditPage(), rgaaFile(ncOn("1.1", "1.1.1")));
    expect(r.ok, r.issues.join(" | ")).toBe(true);
  });

  it('rejects a criterion id absent from the pack ("9.9.9")', () => {
    const r = applyAdjudication(auditPage(), rgaaFile(ncOn("1.1", "9.9.9")));
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/9\.9\.9/);
  });

  it('rejects a real criterion with an unknown test key ("1.1.99")', () => {
    const r = applyAdjudication(auditPage(), rgaaFile(ncOn("1.1", "1.1.99")));
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/1\.1\.99/);
  });

  it("rejects a test belonging to ANOTHER criterion — the collision that used to pass", () => {
    // "3.2.1" is a real RGAA test, but of criterion 3.2, not 1.1.
    const r = applyAdjudication(auditPage(), rgaaFile(ncOn("1.1", "3.2.1")));
    expect(r.ok).toBe(false);
  });
});

describe("applyAdjudication — recommendations fold as advisory (status-neutral)", () => {
  it("folds a recommendation into audit.findings as an advisory finding without flipping the criterion", () => {
    const audit = auditPage();
    const items = buildAdjudicationWorklist(audit).map((i) =>
      i.criteriaId === "2.4.4"
        ? {
            ...i,
            verdict: "C" as const,
            justification: "Every link text is self-describing.",
            citations: [i.evidence[0]!],
            // A non-normative good practice noted alongside the conformant verdict.
            recommendations: [{ file: PAGE, line: 9, selector: "img", message: "Consider a more descriptive alt.", snippet: 'alt="chart"' }],
          }
        : { ...i, verdict: "manual" as const, reason: "undecidable" },
    );
    const r = applyAdjudication(audit, file(items));
    expect(r.ok).toBe(true);
    // The recommendation lands as an advisory finding on its criterion…
    const rec = r.audit.findings.find((f) => f.advisory && f.criteriaId === "2.4.4");
    expect(rec).toBeDefined();
    // …but the criterion keeps its adjudicated status (C), never NC.
    expect(r.audit.criteria.find((c) => c.id === "2.4.4")?.status).toBe("C");
  });

  it("fails when a recommendation snippet does not ground to the cited source", () => {
    const audit = auditPage();
    const items = buildAdjudicationWorklist(audit).map((i) =>
      i.criteriaId === "2.4.4"
        ? {
            ...i,
            verdict: "C" as const,
            justification: "Links are fine.",
            citations: [i.evidence[0]!],
            recommendations: [{ file: PAGE, line: 9, selector: "video", message: "bogus", snippet: "<video controls></video>" }],
          }
        : { ...i, verdict: "manual" as const, reason: "undecidable" },
    );
    const r = applyAdjudication(audit, file(items));
    expect(r.ok).toBe(false);
    expect(r.grounding.failed).toBeGreaterThan(0);
  });
});

// Task 3 — judgment-tier strengthening: the new evidence harvesters + the SC-keyed
// manual-questions bank rendered by formatAdjudication.
describe("Task-3 harvesters + manual-question bank", () => {
  const RICH = fixture(
    "judgment.html",
    `<!doctype html>
<html lang="en">
<head><title>Profile</title></head>
<body>
<main>
<h1>Profile</h1>
<div class="field"><div class="field-label">Name</div><div class="field-value">Ada</div></div>
<a href="/pricing">Pricing</a>
<a href="/guide.pdf">Download the guide</a>
<div aria-live="polite" role="status" class="status">Saved</div>
<dialog><p>Details</p></dialog>
<button tabindex="0">ok</button>
</main>
</body>
</html>`,
  );
  const items = buildAdjudicationWorklist(runAudit({ inputs: [RICH] }));
  const evOf = (sc: string) => JSON.stringify(items.find((i) => i.criteriaId === sc)?.evidence ?? []);

  it("1.3.1 harvests div-presented key/value pairs (RGAA 8.9/9.3)", () => {
    const blob = evOf("1.3.1");
    expect(blob).toContain("key/value pair");
    expect(blob).toContain("Name");
    expect(blob).toContain("Ada");
  });

  it("2.4.4 flags a document-download link's format as a recommendation, not an NC (RGAA 6.1)", () => {
    const blob = evOf("2.4.4");
    expect(blob).toContain("guide.pdf");
    expect(blob).toMatch(/download-format=pdf/);
    expect(blob).toMatch(/recommendation/);
  });

  it("4.1.3 harvests live regions (RGAA 7.5)", () => {
    expect(evOf("4.1.3")).toMatch(/aria-live/);
  });

  it("2.4.3 harvests SPA focus signals — <dialog> + tabindex (RGAA 12.8)", () => {
    const blob = evOf("2.4.3");
    expect(blob).toMatch(/dialog/);
    expect(blob).toMatch(/tabindex/);
  });

  it("formatAdjudication renders the SC-keyed questions for a residual criterion in both languages", () => {
    const en = formatAdjudication(items, "en");
    const fr = formatAdjudication(items, "fr");
    expect(en).toContain("To verify manually");
    expect(en).toMatch(/Div-presented fields \(RGAA 8\.9\)/);
    expect(fr).toContain("À vérifier manuellement");
    expect(fr).toMatch(/Champs présentés en div \(RGAA 8\.9\)/);
  });
});

describe("writeAdjudication", () => {
  it("writes ADJUDICATE.todo.json + ADJUDICATE.md", () => {
    const items = buildAdjudicationWorklist(auditPage());
    const out = join(dir, "wl");
    const w = writeAdjudication(items, out, { standard: "wcag", auditDate: "2026-07-08", lang: "en" });
    expect(existsSync(w.todoPath)).toBe(true);
    expect(existsSync(w.mdPath)).toBe(true);
    const todo = JSON.parse(readFileSync(w.todoPath, "utf8")) as AdjudicationFile;
    expect(todo.kind).toBe("adjudication");
    expect(todo.items.length).toBe(items.length);
    expect(readFileSync(w.mdPath, "utf8")).toMatch(/C \/ NC \/ NA|verdict/i);
  });
});

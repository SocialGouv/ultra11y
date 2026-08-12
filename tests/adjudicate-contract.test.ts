// The adjudication CONTRACT — what a caller filling the worklist is allowed to write, and
// how the gate answers when they get it wrong.
//
// The file is filled by someone who is not reading ultra11y's source: an agent in a coding
// harness, an orchestrator's tool node, a script. Two things follow, and both are tested
// here. The vocabulary has to travel WITH the worklist, and a spelling accident ("na" for
// "NA") must not read as a disagreement about accessibility — while a verdict that is
// genuinely outside the vocabulary must still fail closed.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import {
  buildAdjudicationWorklist,
  applyAdjudication,
  adjudicationContract,
  normalizeVerdict,
  canonicalizeAdjudication,
  VERDICTS,
  MANUAL_REASON_VALUES,
  type AdjudicationFile,
  type AdjudicationItem,
} from "../src/adjudicate.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-contract-"));
const PAGE = join(dir, "page.html");
writeFileSync(
  PAGE,
  `<!doctype html>
<html lang="en">
<head><title>Shop</title></head>
<body><main>
<h1>Welcome</h1>
<img src="hero.png" alt="A hiker on a ridge at sunrise">
<a href="/pricing">Read more</a>
<label for="email">Email</label><input id="email" type="email">
</main></body>
</html>`,
);

const auditPage = () => runAudit({ inputs: [PAGE] });

function file(items: AdjudicationItem[]): AdjudicationFile {
  return { tool: "ultra11y", kind: "adjudication", schemaVersion: 2, standard: "wcag", auditDate: "2026-08-12", items };
}

/** Every item `manual`, except the ones the caller overrides — the shape most tests want. */
function allManualExcept(audit: ReturnType<typeof auditPage>, override: (i: AdjudicationItem) => AdjudicationItem | null): AdjudicationItem[] {
  return buildAdjudicationWorklist(audit).map((i) => override(i) ?? ({ ...i, verdict: "manual" as const, reason: "undecidable" } as AdjudicationItem));
}

describe("the worklist declares its own contract", () => {
  it("names the verdicts, the manual reasons, and what each verdict additionally requires", () => {
    const c = adjudicationContract();
    expect(c.verdicts).toEqual([...VERDICTS]);
    expect(c.manualReasons).toEqual([...MANUAL_REASON_VALUES]);
    // Every verdict in the vocabulary is described — a caller reading only the file learns
    // that C/NA need a justification and NC needs a grounded, normatively-cited finding.
    for (const v of VERDICTS) expect(c.requires[v]).toBeTruthy();
    expect(c.requires.NC).toMatch(/normativeRef/);
    expect(c.requires.manual).toContain("needs-rendered-dom");
  });

  it("is advisory: the gate validates against its own constants, not the file's header", () => {
    const audit = auditPage();
    const items = allManualExcept(audit, () => null);
    // A tampered/stale header claiming a wider vocabulary must not widen what is accepted.
    const f = { ...file(items), contract: { verdicts: ["whatever"], manualReasons: [], requires: {} } } as AdjudicationFile;
    f.items[0] = { ...f.items[0]!, verdict: "whatever" as never, reason: null };
    const r = applyAdjudication(audit, f);
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/unknown verdict "whatever"/);
  });
});

describe("verdict spelling is not a decision", () => {
  it("normalizes case for every verdict in the vocabulary", () => {
    expect(normalizeVerdict("na")).toBe("NA");
    expect(normalizeVerdict("nc")).toBe("NC");
    expect(normalizeVerdict("c")).toBe("C");
    expect(normalizeVerdict("MANUAL")).toBe("manual");
    expect(normalizeVerdict("  Na  ")).toBe("NA");
  });

  it("refuses to guess at anything outside the vocabulary", () => {
    expect(normalizeVerdict("conforming")).toBeUndefined();
    expect(normalizeVerdict("")).toBeUndefined();
    expect(normalizeVerdict(null)).toBeUndefined();
    expect(normalizeVerdict(3)).toBeUndefined();
  });

  it("canonicalizes manual reasons too, and leaves unknown values alone for the gate to report", () => {
    const items = [
      { criteriaId: "1.1.1", verdict: "nc", reason: null },
      { criteriaId: "1.4.3", verdict: "MANUAL", reason: "Needs-Rendered-DOM" },
      { criteriaId: "2.4.4", verdict: "bogus", reason: null },
    ] as unknown as AdjudicationItem[];
    canonicalizeAdjudication(file(items));
    expect(items[0]!.verdict).toBe("NC");
    expect(items[1]!.verdict).toBe("manual");
    expect(items[1]!.reason).toBe("needs-rendered-dom");
    expect(items[2]!.verdict).toBe("bogus"); // untouched — the gate reports it
  });

  it("a lower-case adjudication applies exactly like its canonical spelling", () => {
    // The claim is an EQUIVALENCE: casing must not change the outcome. Asserting a
    // specific outcome instead would couple this test to which criteria the fixture
    // happens to leave residual — a fact that belongs to the audit, not to the
    // spelling of a verdict.
    const audit = auditPage();
    const JUSTIFICATION = "Every link text is self-describing in context.";
    const written = (verdict: string) =>
      allManualExcept(audit, (i) => (i.criteriaId === "2.4.4" ? ({ ...i, verdict, justification: JUSTIFICATION } as unknown as AdjudicationItem) : null));

    const lower = applyAdjudication(auditPage(), file(written("c")));
    const canonical = applyAdjudication(auditPage(), file(written("C")));

    expect(lower.issues).toEqual(canonical.issues);
    expect(lower.ok).toBe(canonical.ok);
    expect(lower.applied).toBe(canonical.applied);
    expect(lower.stillManual).toBe(canonical.stillManual);
    expect(lower.audit.conformancePct).toBe(canonical.audit.conformancePct);
    expect(lower.audit.criteria.find((c) => c.id === "2.4.4")?.status).toBe(canonical.audit.criteria.find((c) => c.id === "2.4.4")?.status);
    // And the equivalence is not vacuous: "c" really was read as a verdict.
    expect(normalizeVerdict("c")).toBe("C");
  });

  it("still fail-closes on a verdict outside the vocabulary — and names the vocabulary", () => {
    const audit = auditPage();
    const items = allManualExcept(audit, (i) => (i.criteriaId === "2.4.4" ? ({ ...i, verdict: "conforming" as never } as AdjudicationItem) : null));
    const r = applyAdjudication(audit, file(items));
    expect(r.ok).toBe(false);
    const msg = r.issues.find((i) => i.includes("unknown verdict"))!;
    expect(msg).toContain('"conforming"');
    for (const v of VERDICTS) expect(msg).toContain(v);
  });

  it("names the accepted reasons when a manual verdict cites none", () => {
    const audit = auditPage();
    const items = allManualExcept(audit, (i) => (i.criteriaId === "2.4.4" ? ({ ...i, verdict: "manual" as const, reason: null } as AdjudicationItem) : null));
    const r = applyAdjudication(audit, file(items));
    expect(r.ok).toBe(false);
    const msg = r.issues.find((i) => i.includes("manual verdict"))!;
    for (const reason of MANUAL_REASON_VALUES) expect(msg).toContain(reason);
  });

  it("case tolerance does not weaken the justification requirement", () => {
    const audit = auditPage();
    // "na" normalizes to NA — which still needs a justification, and has none here.
    const items = allManualExcept(audit, (i) => (i.criteriaId === "2.4.4" ? ({ ...i, verdict: "na" as never, justification: "" } as AdjudicationItem) : null));
    const r = applyAdjudication(audit, file(items));
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/NA verdict requires a justification/);
  });
});

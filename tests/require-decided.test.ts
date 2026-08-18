// `check --require-decided` — the gate that turns "100% decided" from a hope into a check.
//
// It exists because a job can be green while deciding almost nothing. Measured on a real pull
// request: the page tier ran, adjudicated nothing, published 94 of 106 criteria as « à
// évaluer », and reported success — `fail-on` governs non-conformities, and an adjudication
// that lands nothing only warns. Anyone trusting the green tick was reading a grid nobody
// had filled in.
import { describe, expect, it } from "vitest";

import { checkDecided, isUndecidedFile } from "../src/check.js";
import type { AuditResult, CriterionResult } from "../src/types.js";

const audit = (criteria: Pick<CriterionResult, "id" | "status">[]): AuditResult =>
  ({
    tool: "ultra11y",
    standard: "wcag",
    version: "0",
    schemaVersion: 2,
    date: "2026-08-18",
    scope: { inputs: ["src"], files: 1 },
    criteria: criteria.map((c) => ({ ...c, guideline: c.id.split(".").slice(0, 2).join("."), findings: [] })),
    guidelines: [],
    findings: [],
    residualRisks: [],
    conformancePct: 100,
  }) as unknown as AuditResult;

describe("check --require-decided", () => {
  it("passes when every criterion carries a verdict", () => {
    const r = checkDecided(
      audit([
        { id: "1.1.1", status: "C" },
        { id: "1.4.3", status: "NC" },
        { id: "1.2.1", status: "NA" },
      ]),
    );
    expect(r.ok).toBe(true);
    expect(r.undecided).toEqual([]);
  });

  it("fails and NAMES the criteria still to assess", () => {
    const r = checkDecided(
      audit([
        { id: "1.1.1", status: "C" },
        { id: "2.4.4", status: "manual" },
        { id: "1.3.1", status: "manual" },
      ]),
    );
    expect(r.ok).toBe(false);
    expect(r.undecided).toEqual(["1.3.1", "2.4.4"]);
    expect(r.issues.join(" ")).toMatch(/1\.3\.1, 2\.4\.4/);
  });

  it("accepts a criterion that is DECLARED undecidable, with its reason", () => {
    const r = checkDecided(audit([{ id: "2.4.4", status: "manual" }]), "wcag", "en", {
      allow: { entries: [{ criteriaId: "2.4.4", reason: "no page in scope carries a link to judge" }] },
    });
    expect(r.ok).toBe(true);
    expect(r.allowed).toHaveLength(1);
    expect(r.undecided).toEqual([]);
  });

  it("refuses a declaration with no reason — 'documented' has to mean something", () => {
    const r = checkDecided(audit([{ id: "2.4.4", status: "manual" }]), "wcag", "en", {
      allow: { entries: [{ criteriaId: "2.4.4", reason: "  " }] },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join(" ")).toMatch(/no reason/);
  });

  it("refuses a STALE declaration, so an exception cannot outlive what it excused", () => {
    const r = checkDecided(audit([{ id: "2.4.4", status: "C" }]), "wcag", "en", {
      allow: { entries: [{ criteriaId: "2.4.4", reason: "was undecidable last quarter" }] },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join(" ")).toMatch(/now carries a verdict/);
  });

  it("recognises an allowance file by its entries array, and nothing else", () => {
    expect(isUndecidedFile({ entries: [] })).toBe(true);
    expect(isUndecidedFile({ criteria: [] })).toBe(false);
    expect(isUndecidedFile(null)).toBe(false);
  });
});

describe("a not-applicable verdict is not a conformity, and is not gated like one", () => {
  it("accepts an NA with a justification and no citations", async () => {
    // The engine's OWN NA carries a justification naming what it searched for, and no
    // citations (src/audit.ts subjectMatterReason). Demanding citations from the agent was
    // holding it to a stricter standard than the engine — and a contradictory one: an NA says
    // "none of this is what the criterion is about", so citing the elements it just ruled out
    // of scope makes no sense. Measured on a real run, six criteria were refused for this
    // alone, every one of them an honest NA.
    const { applyAdjudication, buildAdjudicationWorklist } = await import("../src/adjudicate.js");
    const { runAudit } = await import("../src/audit.js");
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = mkdtempSync(join(tmpdir(), "u11y-na-"));
    const f = join(dir, "p.html");
    writeFileSync(f, `<!doctype html><html lang="fr"><head><title>T</title></head><body><main><h1>H</h1><a href="/x">Voir la page x</a></main></body></html>`);
    const audit = runAudit({ inputs: [f] });
    const items = buildAdjudicationWorklist(audit).map((it) =>
      it.criteriaId === "2.4.4"
        ? { ...it, verdict: "NA" as const, justification: "Aucun lien de ce type n'est concerné dans le périmètre audité." }
        : { ...it, verdict: "manual" as const, reason: "undecidable" },
    );
    const r = applyAdjudication(audit, { tool: "ultra11y", kind: "adjudication", schemaVersion: 2, standard: "wcag", auditDate: audit.date, items });

    expect(r.issues.join("\n")).not.toMatch(/must cite at least one/);
    expect(r.audit.criteria.find((c) => c.id === "2.4.4")?.status).toBe("NA");
  });
});

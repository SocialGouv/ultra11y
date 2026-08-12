// Adjudicating under a COUNTRY STANDARD. 99 of the 106 RGAA criteria can only ever derive
// `manual`, so this path carries ~93% of an RGAA audit — and it used to be 100% WCAG-keyed:
// `--standard` was accepted and then never read.
//
// The sharpest bug it hid: RGAA test ids share the `N.N.N` shape with WCAG SC ids, so the
// anti-fabrication gate silently accepted a WCAG citation as an unrelated RGAA test. Keying
// the worklist by RGAA criterion is what closes it — a citation is now checked against the
// item's OWN test list.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import { buildAdjudicationWorklist, applyAdjudication, formatAdjudication, type AdjudicationFile, type AdjudicationItem } from "../src/adjudicate.js";
import { derivePackResults } from "../src/standards/index.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-adj-pack-"));
const PAGE = join(dir, "page.html");
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Boutique</title></head><body><main>
<h1>Bienvenue</h1>
<img src="hero.png" alt="Un randonneur sur une crête">
<label for="email">Email</label><input id="email" type="email">
<a href="/aide">Contacter le support</a>
</main></body></html>`,
);

const audit = () => runAudit({ inputs: [PAGE] });
const rgaaItems = () => buildAdjudicationWorklist(audit(), { standard: "rgaa" });

const adjFile = (items: AdjudicationItem[], standard = "rgaa"): AdjudicationFile => ({
  tool: "ultra11y",
  kind: "adjudication",
  schemaVersion: 2,
  standard,
  auditDate: "2026-07-29",
  items,
});

/** Clear every item so only the item under test can fail the run. A C is evidence-bound
 *  (it must cite the harvested evidence it cleared), and a criterion the harvester found
 *  nothing for cannot be cleared at all — it honestly stays manual. */
const clear = (it: AdjudicationItem): AdjudicationItem =>
  it.evidence.length
    ? { ...it, verdict: "C" as const, justification: "vérifié sur la page", citations: [it.evidence[0]!] }
    : { ...it, verdict: "manual" as const, reason: "undecidable" };

const allConforming = (items: AdjudicationItem[], override?: Partial<AdjudicationItem> & { criteriaId: string }): AdjudicationItem[] =>
  items.map((it) => (it.criteriaId === override?.criteriaId ? ({ ...it, ...override } as AdjudicationItem) : clear(it)));

describe("the worklist is keyed by the standard actually in play", () => {
  it("emits RGAA criteria, not WCAG success criteria", () => {
    const ids = rgaaItems().map((i) => i.criteriaId);
    expect(ids.length).toBeGreaterThan(50); // 99 of 106 can only derive manual
    // RGAA ids have two segments; WCAG SC ids have three.
    for (const id of ids) expect(id, `"${id}" is not an RGAA criterion id`).toMatch(/^\d+\.\d+$/);
    expect(ids).toContain("11.2"); // « Chaque étiquette … est-elle pertinente ? »
  });

  it("still emits WCAG success criteria for the core", () => {
    const ids = buildAdjudicationWorklist(audit()).map((i) => i.criteriaId);
    for (const id of ids) expect(id).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("covers exactly the pack criteria that derive `manual` — no more, no less", () => {
    const manual = new Set(
      derivePackResults(audit(), "rgaa")
        .filter((c) => c.status === "manual")
        .map((c) => c.id),
    );
    expect(new Set(rgaaItems().map((i) => i.criteriaId))).toEqual(manual);
  });

  it("titles each item with the RGAA criterion, not the WCAG one", () => {
    const it112 = rgaaItems().find((i) => i.criteriaId === "11.2");
    expect(it112?.title).toMatch(/étiquette/i);
    expect(it112?.title).not.toMatch(/Labels or Instructions/);
  });

  it("carries evidence harvested for the WCAG criteria the RGAA criterion maps onto", () => {
    // RGAA 1.1 maps to WCAG 1.1.1, whose harvester collects every image.
    const it11 = rgaaItems().find((i) => i.criteriaId === "1.1");
    expect(it11?.evidence.some((e) => e.snippet.includes("hero.png"))).toBe(true);
  });

  it("does not duplicate evidence when several mapped SCs harvest the same element", () => {
    for (const item of rgaaItems()) {
      const keys = item.evidence.map((e) => `${e.file}:${e.line}:${e.selector}`);
      expect(new Set(keys).size, `${item.criteriaId} has duplicate evidence`).toBe(keys.length);
    }
  });
});

describe("the citation gate, under a pack", () => {
  const nc = (criteriaId: string, normativeRef: string): Partial<AdjudicationItem> & { criteriaId: string } => ({
    criteriaId,
    verdict: "NC",
    justification: "",
    findings: [{ file: PAGE, line: 3, message: "étiquette non pertinente", normativeRef, snippet: "<label" }],
  });

  it("accepts a test id belonging to the criterion under adjudication", () => {
    const r = applyAdjudication(audit(), adjFile(allConforming(rgaaItems(), nc("11.2", "11.2.1"))));
    expect(r.ok, r.issues.join(" | ")).toBe(true);
  });

  it("REJECTS a WCAG success-criterion id that merely collides with an RGAA test id", () => {
    // The bug this file exists for: "1.4.3" is WCAG Contrast Minimum, but also parses as
    // RGAA test 1.4.3 — a CAPTCHA-image test — and used to be accepted silently.
    const r = applyAdjudication(audit(), adjFile(allConforming(rgaaItems(), nc("11.2", "1.4.3"))));
    expect(r.ok).toBe(false);
    expect(r.issues.join(" ")).toMatch(/1\.4\.3/);
  });

  it("REJECTS a real RGAA test that belongs to a DIFFERENT criterion", () => {
    const r = applyAdjudication(audit(), adjFile(allConforming(rgaaItems(), nc("11.2", "1.1.1"))));
    expect(r.ok).toBe(false);
  });

  it("REJECTS a W3C technique code — the gate never accepted those under a pack", () => {
    const r = applyAdjudication(audit(), adjFile(allConforming(rgaaItems(), nc("11.2", "ARIA6"))));
    expect(r.ok).toBe(false);
  });

  it("REJECTS a fabricated test number on the right criterion", () => {
    const r = applyAdjudication(audit(), adjFile(allConforming(rgaaItems(), nc("11.2", "11.2.99"))));
    expect(r.ok).toBe(false);
  });

  it("still requires a normativeRef at all", () => {
    const items = allConforming(rgaaItems(), {
      criteriaId: "11.2",
      verdict: "NC",
      justification: "",
      findings: [{ file: PAGE, line: 3, message: "x", snippet: "<label" }],
    });
    expect(applyAdjudication(audit(), adjFile(items)).ok).toBe(false);
  });
});

describe("folding a pack adjudication back", () => {
  const folded = () => applyAdjudication(audit(), adjFile(allConforming(rgaaItems())));

  it("succeeds and records the verdicts under the pack, not on the WCAG criteria", () => {
    const r = folded();
    expect(r.ok, r.issues.join(" | ")).toBe(true);
    expect(r.audit.packAdjudication?.standard).toBe("rgaa");
    expect(r.audit.packAdjudication?.criteria.length).toBeGreaterThan(50);
  });

  it("leaves the WCAG core verdict untouched — a pack is a projection, never a second source", () => {
    const before = audit();
    const after = folded().audit;
    expect(after.criteria.map((c) => `${c.id}:${c.status}`)).toEqual(before.criteria.map((c) => `${c.id}:${c.status}`));
    expect(after.conformancePct).toBe(before.conformancePct);
  });

  it("makes the pack projection reflect the adjudication", () => {
    const after = folded().audit;
    const derived = derivePackResults(after, "rgaa");
    expect(derived.find((c) => c.id === "11.2")?.status).toBe("C");
    expect(derived.find((c) => c.id === "11.2")?.decidedBy).toBe("agent");
    // Every criterion the agent CLEARED is now C in the projection — and the ones still
    // manual are exactly the ones it could not clear (no harvested evidence to cite),
    // which is the honest outcome, not a coverage failure.
    const cleared = new Set(
      allConforming(rgaaItems())
        .filter((i) => i.verdict === "C")
        .map((i) => i.criteriaId),
    );
    expect(cleared.size).toBeGreaterThan(0);
    for (const id of cleared) expect(derived.find((c) => c.id === id)?.status, id).toBe("C");
    for (const c of derived.filter((c) => c.status === "manual")) expect(cleared.has(c.id), c.id).toBe(false);
  });

  it("fails closed on an unadjudicated criterion (coverage gap)", () => {
    const items = rgaaItems().map((it, i) => (i === 0 ? it : clear(it)));
    const r = applyAdjudication(audit(), adjFile(items));
    expect(r.ok).toBe(false);
    expect(r.issues.join(" ")).toMatch(/unadjudicated|verdict is null/i);
  });

  it("keeps a still-manual verdict manual, with its reason", () => {
    const items = allConforming(rgaaItems(), { criteriaId: "3.2", verdict: "manual", justification: "", reason: "needs-rendered-dom" });
    const r = applyAdjudication(audit(), adjFile(items));
    expect(r.ok, r.issues.join(" | ")).toBe(true);
    expect(derivePackResults(r.audit, "rgaa").find((c) => c.id === "3.2")?.status).toBe("manual");
  });
});

describe("the rendered worklist is self-sufficient", () => {
  const md = () => formatAdjudication(rgaaItems(), "fr", "rgaa");

  it("shows the criterion's own numbered tests, in full", () => {
    const t = md();
    expect(t).toContain("11.2.1");
    expect(t).toMatch(/fonction exacte/); // real test wording, not a summary
  });

  it("proposes ONLY citable references the gate will accept", () => {
    const t = md();
    // W3C technique codes are what the old worklist proposed — and what the gate refuses.
    expect(t).not.toMatch(/\bARIA\d+\b/);
    expect(t).not.toMatch(/\bH\d{2}\b/);
  });

  it("names the standard rather than speaking WCAG", () => {
    expect(md()).toContain("RGAA");
  });

  it("still renders the WCAG core worklist unchanged", () => {
    const core = formatAdjudication(buildAdjudicationWorklist(audit()), "en");
    expect(core).toMatch(/1\.1\.1/);
  });
});

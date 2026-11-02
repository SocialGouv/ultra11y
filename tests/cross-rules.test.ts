import { describe, it, expect } from "vitest";
import { runAudit } from "../src/audit.js";
import type { AuditResult, Finding } from "../src/types.js";
import { renderBacklog } from "../src/prd.js";
import { NOTE_CATALOG } from "../src/messages.js";

const SCOPE = ["tests/fixtures/cross-file"];
const find = (fs: Finding[], ruleId: string, fileEndsWith: string): Finding | undefined => fs.find((f) => f.ruleId === ruleId && f.file.endsWith(fileEndsWith));

/** Wrap a single real finding in a minimal AuditResult so it can be run through the
 *  actual renderers (renderBacklog), exercising the full engine → render pipeline. */
function auditOf(finding: Finding): AuditResult {
  return {
    tool: "ultra11y",
    standard: "wcag",
    version: "9.9.9",
    schemaVersion: 2,
    date: "2026-06-29",
    scope: { inputs: SCOPE, files: 1 },
    guidelines: [],
    criteria: [],
    findings: [finding],
    residualRisks: [],
    conformancePct: 50,
  };
}

describe("cross-file rules (audit --graph)", () => {
  const plain = runAudit({ inputs: SCOPE, dedup: "off" }).findings;
  const graph = runAudit({ inputs: SCOPE, dedup: "off", graph: true }).findings;

  it("flags an icon-only component used without a name, pointing at its definition", () => {
    const f = find(graph, "cross-icon-only-unnamed", "page-bad.tsx");
    expect(f).toBeDefined();
    expect(f?.related?.file).toMatch(/IconButton\.tsx$/);
    expect(f?.criteriaId).toBe("4.1.2");
  });

  it("does not flag a usage that passes an accessible name", () => {
    expect(find(graph, "cross-icon-only-unnamed", "page-good.tsx")).toBeUndefined();
  });

  it("bakes the related-site note in English with a resolvable noteId, and localizes it at render time (fr: exact original French; en: no mixed language)", () => {
    const f = find(graph, "cross-icon-only-unnamed", "page-bad.tsx")!;
    // The engine bakes English + attaches a noteId (mirrors message/remediation).
    expect(f.related?.noteId).toBe("related.icon-component-def");
    expect(f.related?.note).toBe(NOTE_CATALOG["related.icon-component-def"]!.en);

    const en = renderBacklog(auditOf(f), "en");
    expect(en).toContain(`↳ ${NOTE_CATALOG["related.icon-component-def"]!.en}`);
    expect(en).not.toMatch(/définition du composant/); // no French leak in EN output

    const fr = renderBacklog(auditOf(f), "fr");
    // Exact original French string (non-regression vs. the pre-fix baked note).
    expect(fr).toContain("↳ définition du composant à icône seule");
  });

  it("does not flag an icon button that is self-named by a dynamic aria-label in its definition", () => {
    // QtyButton's <button> always has aria-label={kind ? "…" : "…"} — it is named, not unnamed.
    expect(find(graph, "cross-icon-only-unnamed", "self-named-icon.tsx")).toBeUndefined();
  });

  it("suppresses the single-file icon-only finding on a spread-props component definition", () => {
    // Without the graph the definition's <button> trips the single-file rule…
    expect(find(plain, "icon-only-control-unnamed", "IconButton.tsx")).toBeDefined();
    // …with the graph, cross-aria-forwarding suppresses it.
    expect(find(graph, "icon-only-control-unnamed", "IconButton.tsx")).toBeUndefined();
  });

  it("suppresses a skip-link-target false positive whose target lives in another file", () => {
    expect(find(plain, "skip-link-target-missing", "Layout.tsx")).toBeDefined();
    expect(find(graph, "skip-link-target-missing", "Layout.tsx")).toBeUndefined();
  });

  it("flags a prop-drilled accessible name lost across a component boundary", () => {
    const f = find(graph, "cross-prop-drilled-name-lost", "page-prop-drill.tsx");
    expect(f).toBeDefined();
    expect(f?.related?.file).toMatch(/SaveButton\.tsx$/);
    expect(f?.criteriaId).toBe("4.1.2");
    // graph-only: the plain (single-file) pass cannot see across the boundary.
    expect(find(plain, "cross-prop-drilled-name-lost", "page-prop-drill.tsx")).toBeUndefined();
  });

  it("bakes the prop-drilled related-site note in English with a resolvable noteId, and localizes it at render time (fr: exact original French; en: no mixed language)", () => {
    const f = find(graph, "cross-prop-drilled-name-lost", "page-prop-drill.tsx")!;
    expect(f.related?.noteId).toBe("related.name-drop-def");
    expect(f.related?.note).toBe(NOTE_CATALOG["related.name-drop-def"]!.en);

    const en = renderBacklog(auditOf(f), "en");
    expect(en).toContain(`↳ ${NOTE_CATALOG["related.name-drop-def"]!.en}`);
    expect(en).not.toMatch(/contrôle qui ne reçoit pas/); // no French leak in EN output

    const fr = renderBacklog(auditOf(f), "fr");
    expect(fr).toContain("↳ contrôle qui ne reçoit pas le nom passé");
  });

  it("only adds/removes cross-file effects — the rest of the findings are unchanged", () => {
    // every plain finding that isn't one of the two suppressed kinds still appears
    const suppressed = new Set(["icon-only-control-unnamed", "skip-link-target-missing"]);
    const stillThere = plain.filter((f) => !suppressed.has(f.ruleId));
    for (const f of stillThere) {
      expect(graph.some((g) => g.ruleId === f.ruleId && g.file === f.file && g.line === f.line)).toBe(true);
    }
  });
});

describe("cross-file suppressors for id-ref rules (audit --graph)", () => {
  const S = ["tests/fixtures/cross-suppress"];
  const plain = runAudit({ inputs: S, dedup: "off" }).findings;
  const graph = runAudit({ inputs: S, dedup: "off", graph: true }).findings;
  const has = (fs: Finding[], ruleId: string, endsWith = "consumer.tsx") => fs.some((f) => f.ruleId === ruleId && f.file.endsWith(endsWith));

  it("suppresses aria-ref-missing-id when the target id is defined in another file", () => {
    expect(has(plain, "aria-ref-missing-id")).toBe(true);
    expect(has(graph, "aria-ref-missing-id")).toBe(false);
  });

  it("suppresses aria-ref-missing-id when the target is a const-bound id={X} in another file", () => {
    // consumer.tsx: <button aria-controls="cse-modal">; defs.tsx: const MODAL_ID="cse-modal"; <dialog id={MODAL_ID}>
    const plainBtn = plain.find((f) => f.ruleId === "aria-ref-missing-id" && /cse-modal/.test(f.message));
    expect(plainBtn).toBeDefined();
    expect(graph.find((f) => f.ruleId === "aria-ref-missing-id" && /cse-modal/.test(f.message))).toBeUndefined();
  });

  it("suppresses label-for-dangling when the field lives in an imported component", () => {
    expect(has(plain, "label-for-dangling")).toBe(true);
    expect(has(graph, "label-for-dangling")).toBe(false);
  });

  it("suppresses empty-heading when the heading is named by a cross-file aria-labelledby", () => {
    expect(has(plain, "empty-heading")).toBe(true);
    expect(has(graph, "empty-heading")).toBe(false);
  });

  it("does NOT flag cross-prop-drilled-name-lost when the control already has a literal name", () => {
    expect(has(graph, "cross-prop-drilled-name-lost", "uses-literal.tsx")).toBe(false);
  });

  // #133 — egapro's SelectedFilesTable passes `title` on to its <caption>: the name is read, not lost.
  const drilled = graph.filter((f) => f.ruleId === "cross-prop-drilled-name-lost" && f.file.endsWith("uses-captioned.tsx"));
  it("does NOT flag cross-prop-drilled-name-lost when the component reads the passed prop (destructured or props.X)", () => {
    expect(drilled.some((f) => f.line === 6)).toBe(false);
    expect(drilled.some((f) => f.line === 7)).toBe(false);
  });

  it("still flags it when the component reads its props but never the passed name", () => {
    expect(drilled.map((f) => f.line)).toEqual([8]);
  });
});

// The reference block: standards, glossary, guidance, method.
//
// A client given only the audit tools can run an audit, see no errors, and report the page
// as accessible. These four exist so it can find out what the standard actually asks first
// — which standards exist, what their terms mean, how to implement a criterion, and how
// much of the work no tool will do for it.
import { describe, expect, it } from "vitest";
import { callTool } from "../src/mcp/handlers.js";
import { REFERENCE_TOOLS, TOOL_META, toolsFor } from "../src/mcp/tools.js";

async function j(name: string, args: Record<string, unknown> = {}): Promise<any> {
  return JSON.parse((await callTool(name, args)).text);
}

describe("the reference tools are declared like every other read tool", () => {
  it("is advertised without --allow-write, and annotated read-only and closed-world", () => {
    const names = toolsFor("2025-06-18").map((t) => t.name);
    for (const t of REFERENCE_TOOLS) {
      expect(names, t.name).toContain(t.name);
      expect(TOOL_META[t.name], t.name).toEqual({ openWorld: false });
    }
  });

  it("makes cwd optional on all of them — they read the standard, not the project", () => {
    for (const t of REFERENCE_TOOLS) expect(t.inputSchema.required, t.name).not.toContain("cwd");
  });
});

describe("ultra11y_standards", () => {
  it("lists the core and the built-in packs with their coverage arithmetic", async () => {
    const r = await j("ultra11y_standards");
    const keys = r.standards.map((s: { key: string }) => s.key);
    expect(keys).toContain("wcag");
    expect(keys).toContain("rgaa");

    const wcag = r.standards.find((s: { key: string }) => s.key === "wcag");
    expect(wcag.core).toBe(true);
    expect(wcag.counts.criteria).toBe(55);

    const rgaa = r.standards.find((s: { key: string }) => s.key === "rgaa");
    expect(rgaa.core).toBe(false);
    expect(rgaa.counts).toMatchObject({ themes: 13, criteria: 106, noEngineRule: 58 });
    // The attribution a redistributed standard must carry.
    expect(rgaa.license).toBeTruthy();
    expect(rgaa.attribution).toBeTruthy();
    expect(rgaa.glossary).toBe(119);
  });
});

describe("ultra11y_glossary", () => {
  it("resolves a normative term and names the criteria it governs", async () => {
    const r = await j("ultra11y_glossary", { standard: "rgaa", term: "image-porteuse-d-information" });
    expect(r.kind).toBe("glossary-term");
    expect(r.body.length).toBeGreaterThan(20);
    expect(r.citedBy.length).toBeGreaterThan(0);
  });

  it("serves the WCAG core's own terms, not just a country pack's", async () => {
    // WCAG's definitions are normative the same way a pack's are: 1.4.3 sets 3:1 for "large
    // scale" text, and what counts as large scale is the glossary's call, not the reader's.
    const r = await j("ultra11y_glossary", { standard: "wcag", term: "large scale" });
    expect(r.anchor).toBe("large-scale");
    expect(r.body).toMatch(/18 point/);
  });
});

describe("ultra11y_guidance", () => {
  it("returns the before/after pair for a criterion", async () => {
    const r = await j("ultra11y_guidance", { standard: "rgaa", criterion: "13.2" });
    expect(r.count).toBeGreaterThan(0);
    expect(r.entries[0].examples[0].good).toBeTruthy();
  });

  it("marks an inherited entry, so it never reads as national doctrine", async () => {
    const r = await j("ultra11y_guidance", { standard: "rgaa", criterion: "13.2" });
    expect(r.entries.some((e: { via: string }) => e.via === "pack")).toBe(true);
    expect(r.entries.some((e: { inherited: boolean }) => e.inherited)).toBe(true);
  });

  it("now reaches every AA criterion, including the six WCAG 2.2 added after RGAA froze", async () => {
    // Before the WCAG-keyed dataset, these came back empty — a country pack derived from
    // WCAG 2.1 cannot supply guidance for criteria that did not exist when it was written.
    for (const sc of ["2.4.11", "2.5.7", "2.5.8", "3.2.6", "3.3.7", "3.3.8"]) {
      const r = await j("ultra11y_guidance", { standard: "wcag", criterion: sc });
      expect(r.count, sc).toBeGreaterThan(0);
      expect(r.entries[0].summary, sc).toBeTruthy();
    }
  });

  it("says plainly that guidance illustrates and never decides a verdict", async () => {
    const r = await j("ultra11y_guidance", { standard: "rgaa", criterion: "13.2" });
    expect(r.note).toMatch(/never decides a verdict/);
  });

  it("refuses a criterion the standard does not define", async () => {
    await expect(j("ultra11y_guidance", { standard: "rgaa", criterion: "99.9" })).rejects.toThrow(/no such RGAA criterion/);
  });
});

describe("ultra11y_method", () => {
  it("partitions the standard: every criterion in exactly one tier", async () => {
    const r = await j("ultra11y_method", { standard: "rgaa" });
    expect(r.total).toBe(106);
    expect(r.buckets.reduce((n: number, b: { count: number }) => n + b.count, 0)).toBe(106);
  });

  it("reproduces the WCAG coverage arithmetic the whole tool quotes", async () => {
    const r = await j("ultra11y_method", { standard: "wcag" });
    const by = Object.fromEntries(r.buckets.map((b: { tier: string; count: number }) => [b.tier, b.count]));
    expect(by.source).toBe(3);
    expect((by["rendered-page"] ?? 0) + (by.browser ?? 0)).toBe(14);
    expect(by.judgment).toBe(38);
  });

  it("names the tool that produces each tier's evidence", async () => {
    const r = await j("ultra11y_method", { standard: "rgaa" });
    const browser = r.buckets.find((b: { tier: string }) => b.tier === "browser");
    // This server declines to drive a browser, so the plan must point at the CLI.
    expect(browser.tool).toMatch(/scan/);
    expect(browser.how).toMatch(/CLI/);
  });

  it("keeps `provable from source` and `failable from source` as separate counts", async () => {
    const r = await j("ultra11y_method", { standard: "rgaa" });
    expect(r.sourceIsEnough.count).toBeGreaterThan(0);
    expect(r.canFailFromSource.count).toBeGreaterThan(0);
    expect(r.canFailFromSource.note).toMatch(/cannot be PROVEN conformant/);
  });

  it("carries the per-page sample methodology for a standard that has one", async () => {
    const r = await j("ultra11y_method", { standard: "rgaa" });
    expect(r.sample.requiredKinds.length).toBe(9);
  });

  it("states the coverage limit, so a plan never reads as a clean bill of health", async () => {
    const r = await j("ultra11y_method", { standard: "wcag" });
    expect(r.coverageNote).toMatch(/untested, never conformant/);
  });

  it("filters to one tier, and explains itself at detail: full", async () => {
    const r = await j("ultra11y_method", { standard: "rgaa", tier: "out-of-scope", detail: "full" });
    expect(r.buckets).toHaveLength(1);
    expect(r.buckets[0].criteria.map((c: { id: string }) => c.id)).toEqual(["8.1"]);
    expect(r.buckets[0].criteria[0].why).toBeTruthy();
    expect(r.buckets[0].criteria[0].title).toBeTruthy();
  });
});

import { describe, it, expect } from "vitest";
import { TOOLS, WRITE_TOOLS, TOOL_META, annotationsFor, toolsFor } from "../src/mcp/tools.js";
import { validateArgs } from "../src/mcp/protocol.js";

const ALL = [...TOOLS, ...WRITE_TOOLS];

describe("tool declarations", () => {
  it("names every tool consistently and uniquely", () => {
    const names = ALL.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^ultra11y_[a-z_0-9]+$/);
  });

  it("declares a well-formed object schema whose required properties exist", () => {
    for (const t of ALL) {
      expect(t.inputSchema.type, t.name).toBe("object");
      expect(Array.isArray(t.inputSchema.required), t.name).toBe(true);
      for (const r of t.inputSchema.required) {
        expect(Object.keys(t.inputSchema.properties), `${t.name}.required lists "${r}"`).toContain(r);
      }
      for (const [key, spec] of Object.entries(t.inputSchema.properties)) {
        expect(spec.description, `${t.name}.${key} has no description`).toBeTruthy();
      }
    }
  });

  it("gives every tool a description that says what it is for", () => {
    for (const t of ALL) {
      expect(t.description.length, t.name).toBeGreaterThan(80);
      expect(t.title, t.name).toBeTruthy();
    }
  });

  it("keeps the standard and lang enums to what the engine actually loads", () => {
    for (const t of ALL) {
      const std = t.inputSchema.properties.standard;
      if (std) expect([...std.enum!].sort(), t.name).toEqual(["rgaa", "wcag"]);
      const lang = t.inputSchema.properties.lang;
      if (lang) expect([...lang.enum!].sort(), t.name).toEqual(["en", "fr"]);
    }
  });

  it("states the coverage limit on the tool a client reaches for first", () => {
    // The single most important sentence in this server. Without it, a clean
    // static audit reads as a clean audit — a false conformance claim, which is
    // the one output an accessibility tool must never produce.
    const audit = TOOLS.find((t) => t.name === "ultra11y_audit")!;
    expect(audit.description).toMatch(/55 WCAG 2\.2 AA criteria/);
    expect(audit.description).toMatch(/YOUR judgment/);
    expect(audit.description).toMatch(/untested, never conformant/);
  });

  it("warns that the browser-backed tool is slow", () => {
    const scan = WRITE_TOOLS.find((t) => t.name === "ultra11y_scan")!;
    expect(scan.description).toMatch(/SLOW/);
    expect(scan.description).toMatch(/headless browser/);
  });

  it("declares an outputSchema only where the result shape is small and stable", () => {
    expect(ALL.filter((t) => t.outputSchema).map((t) => t.name)).toEqual(["ultra11y_read"]);
  });
});

describe("annotations", () => {
  // Asserted tool by tool: a new tool with no expected row fails here rather
  // than sliding in unannotated.
  const EXPECTED: Record<string, { readOnlyHint: boolean; openWorldHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean }> = {
    ultra11y_audit: { readOnlyHint: true, openWorldHint: false },
    ultra11y_report: { readOnlyHint: true, openWorldHint: false },
    ultra11y_prd: { readOnlyHint: true, openWorldHint: false },
    ultra11y_tickets: { readOnlyHint: true, openWorldHint: false },
    ultra11y_criteria: { readOnlyHint: true, openWorldHint: false },
    ultra11y_check: { readOnlyHint: true, openWorldHint: false },
    ultra11y_verify: { readOnlyHint: true, openWorldHint: false },
    ultra11y_adjudicate: { readOnlyHint: true, openWorldHint: false },
    ultra11y_pack_check: { readOnlyHint: true, openWorldHint: false },
    ultra11y_sample_check: { readOnlyHint: true, openWorldHint: false },
    ultra11y_pages: { readOnlyHint: true, openWorldHint: false },
    ultra11y_read: { readOnlyHint: true, openWorldHint: false },
    ultra11y_fix: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    ultra11y_scan: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    ultra11y_init: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  };

  it("annotates every declared tool, and only declared tools", () => {
    expect(Object.keys(TOOL_META).sort()).toEqual(ALL.map((t) => t.name).sort());
    expect(Object.keys(EXPECTED).sort()).toEqual(ALL.map((t) => t.name).sort());
  });

  it("matches the expected hint matrix", () => {
    for (const [name, want] of Object.entries(EXPECTED)) {
      expect(annotationsFor(name), name).toEqual(want);
    }
  });

  it("marks exactly the tools that change the user's project", () => {
    const writers = ALL.filter((t) => TOOL_META[t.name]!.write).map((t) => t.name);
    expect(writers.sort()).toEqual(["ultra11y_fix", "ultra11y_init", "ultra11y_scan"]);
  });
});

describe("toolsFor", () => {
  it("hides the write tools unless the server was started with --allow-write", () => {
    const readOnly = toolsFor("2025-06-18").map((t) => t.name);
    for (const w of ["ultra11y_fix", "ultra11y_scan", "ultra11y_init"]) expect(readOnly).not.toContain(w);
    expect(toolsFor("2025-06-18", { allowWrite: true }).map((t) => t.name)).toContain("ultra11y_fix");
  });

  it("gates rich fields and annotations on the negotiated protocol version", () => {
    const old = toolsFor("2024-11-05").find((t) => t.name === "ultra11y_read")!;
    expect(old.annotations).toBeUndefined();
    expect(old.title).toBeUndefined();

    const now = toolsFor("2025-06-18").find((t) => t.name === "ultra11y_read")!;
    expect(now.annotations).toBeTruthy();
    expect(now.outputSchema).toBeTruthy();
  });

  it("makes `cwd` optional, and says so, when the server has a default project", () => {
    for (const t of toolsFor("2025-06-18", { defaultCwd: "/srv/app", allowWrite: true })) {
      if (!t.inputSchema.properties.cwd) continue;
      expect(t.inputSchema.required, t.name).not.toContain("cwd");
      expect(t.inputSchema.properties.cwd.description, t.name).toContain("/srv/app");
    }
  });
});

describe("declared schemas accept what the handlers expect", () => {
  it("validates a representative call per tool", () => {
    const sample: Record<string, Record<string, unknown>> = {
      ultra11y_audit: { cwd: "/p", globs: ["src/**/*.tsx"], graph: true, max_files: 50 },
      ultra11y_report: { cwd: "/p", standard: "rgaa", lang: "fr" },
      ultra11y_prd: { cwd: "/p", split: "criterion" },
      ultra11y_tickets: { cwd: "/p", grain: "page-criterion" },
      ultra11y_criteria: { sc: "1.1.1", lang: "fr" },
      ultra11y_check: { cwd: "/p", report_text: "# report" },
      ultra11y_verify: { cwd: "/p", report_text: "# report", max_verify: 10 },
      ultra11y_adjudicate: { cwd: "/p", standard: "wcag" },
      ultra11y_pack_check: { cwd: "/p", pack: "/p/pack.json" },
      ultra11y_sample_check: { cwd: "/p" },
      ultra11y_pages: { cwd: "/p", standard: "rgaa", format: "report", lang: "fr" },
      ultra11y_read: { cwd: "/p", path: "index.html", start_line: 1, end_line: 20 },
      ultra11y_fix: { cwd: "/p", write: true, only: ["img-alt"] },
      ultra11y_scan: { cwd: "/p", target: "https://example.com", runtime: "docker" },
      ultra11y_init: { cwd: "/p", hook: true, fail_on: "error" },
    };
    for (const t of ALL) {
      expect(validateArgs(t.inputSchema, sample[t.name]!), t.name).toBeUndefined();
    }
  });

  it("rejects a missing required argument and an out-of-enum value", () => {
    const packCheck = TOOLS.find((t) => t.name === "ultra11y_pack_check")!;
    expect(validateArgs(packCheck.inputSchema, { cwd: "/p" })).toMatch(/`pack` is required/);
    const report = TOOLS.find((t) => t.name === "ultra11y_report")!;
    expect(validateArgs(report.inputSchema, { cwd: "/p", standard: "en301549" })).toMatch(/standard/);
  });

  it("lets ultra11y_criteria be called with no arguments at all", () => {
    // It reads the vendored standard, not a project — asking for the criteria
    // reference must not require naming one.
    const criteria = TOOLS.find((t) => t.name === "ultra11y_criteria")!;
    expect(criteria.inputSchema.required).toEqual([]);
    expect(validateArgs(criteria.inputSchema, {})).toBeUndefined();
  });
});

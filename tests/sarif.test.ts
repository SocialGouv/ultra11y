import { describe, it, expect } from "vitest";
import { toSarif } from "../src/sarif.js";
import { findingId } from "../src/baseline.js";
import { VERSION } from "../src/types.js";
import type { AuditResult, Finding } from "../src/types.js";

const F = (over: Partial<Finding> = {}): Finding => ({
  ruleId: "img-alt-missing",
  criteriaId: "1.1.1",
  file: "src/a.html",
  line: 3,
  col: 5,
  selectorHint: "img",
  severity: "bloquant",
  message: "Image without a text alternative.",
  remediation: "Add an alt attribute describing the image's purpose.",
  snippet: "<img src=x>",
  sourceStart: 10,
  sourceEnd: 20,
  ...over,
});

const audit = (findings: Finding[]): AuditResult => ({ findings, date: "2026-07-29", scope: { inputs: [], files: 1 } }) as unknown as AuditResult;

describe("SARIF envelope", () => {
  it("is a well-formed 2.1.0 log naming ultra11y and its version", () => {
    const log = toSarif(audit([F()]));
    expect(log.version).toBe("2.1.0");
    expect(log.$schema).toContain("sarif-2.1.0");
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0]?.tool.driver.name).toBe("ultra11y");
    expect(log.runs[0]?.tool.driver.version).toBe(VERSION);
  });

  it("tags the run so several uploads (code / pages) stay distinct in one PR", () => {
    expect(toSarif(audit([F()])).runs[0]?.automationDetails?.id).toBe("ultra11y/wcag/");
    expect(toSarif(audit([F()]), { standard: "rgaa" }).runs[0]?.automationDetails?.id).toBe("ultra11y/rgaa/");
  });

  it("emits an empty results array for a clean audit, never a null run", () => {
    const log = toSarif(audit([]));
    expect(log.runs[0]?.results).toEqual([]);
    expect(log.runs[0]?.tool.driver.rules).toEqual([]);
  });
});

describe("rules table", () => {
  it("declares each ruleId once and indexes results into it", () => {
    const log = toSarif(audit([F(), F({ sourceStart: 50 }), F({ ruleId: "link-empty", criteriaId: "2.4.4", sourceStart: 90 })]));
    const rules = log.runs[0]?.tool.driver.rules ?? [];
    expect(rules.map((r) => r.id)).toEqual(["img-alt-missing", "link-empty"]);
    const results = log.runs[0]?.results ?? [];
    expect(results.map((r) => r.ruleIndex)).toEqual([0, 0, 1]);
    for (const r of results) expect(rules[r.ruleIndex]?.id).toBe(r.ruleId);
  });

  it("links each rule to its WCAG Understanding page", () => {
    const rule = toSarif(audit([F()])).runs[0]?.tool.driver.rules[0];
    expect(rule?.helpUri).toBe("https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html");
  });

  it("carries the success criterion as a tag", () => {
    const rule = toSarif(audit([F()])).runs[0]?.tool.driver.rules[0];
    expect(rule?.properties?.tags).toContain("accessibility");
    expect(rule?.properties?.tags).toContain("wcag:1.1.1");
  });

  it("carries the pack criterion as a tag when a standard is projected", () => {
    const rule = toSarif(audit([F()]), { standard: "rgaa" }).runs[0]?.tool.driver.rules[0];
    expect(rule?.properties?.tags).toContain("rgaa:1.1");
  });
});

describe("severity mapping", () => {
  it("maps bloquant/majeur/mineur onto error/warning/note", () => {
    const log = toSarif(audit([F({ severity: "bloquant" }), F({ severity: "majeur", sourceStart: 50 }), F({ severity: "mineur", sourceStart: 90 })]));
    expect((log.runs[0]?.results ?? []).map((r) => r.level)).toEqual(["error", "warning", "note"]);
  });

  it("never reports a non-normative recommendation as an error", () => {
    const log = toSarif(audit([F({ severity: "bloquant", advisory: true })]));
    expect(log.runs[0]?.results[0]?.level).toBe("note");
  });
});

describe("locations", () => {
  it("points at the repo-relative file, line and column", () => {
    const loc = toSarif(audit([F()])).runs[0]?.results[0]?.locations?.[0]?.physicalLocation;
    expect(loc?.artifactLocation.uri).toBe("src/a.html");
    expect(loc?.region?.startLine).toBe(3);
    expect(loc?.region?.startColumn).toBe(5);
  });

  it("clamps a line 0 (unresolved dynamic anchor) to 1 — SARIF forbids line 0", () => {
    const loc = toSarif(audit([F({ line: 0, col: 0 })])).runs[0]?.results[0]?.locations?.[0]?.physicalLocation;
    expect(loc?.region?.startLine).toBe(1);
    expect(loc?.region?.startColumn).toBe(1);
  });

  it("relativises an absolute path under the base dir — GitHub only anchors repo-relative URIs", () => {
    const loc = toSarif(audit([F({ file: "/repo/src/a.html" })]), { baseDir: "/repo" }).runs[0]?.results[0]?.locations?.[0]?.physicalLocation;
    expect(loc?.artifactLocation.uri).toBe("src/a.html");
  });

  it("leaves an absolute path OUTSIDE the base dir alone rather than inventing a relative one", () => {
    const loc = toSarif(audit([F({ file: "/elsewhere/a.html" })]), { baseDir: "/repo" }).runs[0]?.results[0]?.locations?.[0]?.physicalLocation;
    expect(loc?.artifactLocation.uri).toBe("/elsewhere/a.html");
  });

  it("normalises Windows separators to POSIX", () => {
    const loc = toSarif(audit([F({ file: "src\\pages\\a.html" })])).runs[0]?.results[0]?.locations?.[0]?.physicalLocation;
    expect(loc?.artifactLocation.uri).toBe("src/pages/a.html");
  });

  it("omits a physical location for a URL-keyed finding, keeping the URL in properties", () => {
    const res = toSarif(audit([F({ file: "https://example.com/contact" })])).runs[0]?.results[0];
    expect(res?.locations).toEqual([]);
    expect(res?.properties?.url).toBe("https://example.com/contact");
  });

  it("keeps the sample page as a property so a page-level finding stays attributable", () => {
    const res = toSarif(audit([F({ sample: { page: "Contact" } })])).runs[0]?.results[0];
    expect(res?.properties?.page).toBe("Contact");
  });
});

describe("fingerprints", () => {
  it("reuses the baseline finding identity so GitHub dedupes across runs", () => {
    const f = F();
    const res = toSarif(audit([f])).runs[0]?.results[0];
    expect(res?.partialFingerprints?.["ultra11yFindingId/v1"]).toBe(findingId(f));
  });

  it("is stable across line drift, like the baseline gate", () => {
    const a = toSarif(audit([F({ line: 3 })])).runs[0]?.results[0]?.partialFingerprints?.["ultra11yFindingId/v1"];
    const b = toSarif(audit([F({ line: 99 })])).runs[0]?.results[0]?.partialFingerprints?.["ultra11yFindingId/v1"];
    expect(a).toBe(b);
  });
});

describe("message", () => {
  it("carries the localized message and the remediation", () => {
    const text = toSarif(audit([F()]), { lang: "en" }).runs[0]?.results[0]?.message.text ?? "";
    expect(text).toContain("Image without a text alternative.");
    expect(text).toContain("Add an alt attribute");
  });

  it("speaks the pack's criterion id when a standard is projected", () => {
    const text = toSarif(audit([F()]), { standard: "rgaa", lang: "fr" }).runs[0]?.results[0]?.message.text ?? "";
    expect(text).toContain("RGAA 1.1");
  });
});

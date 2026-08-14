// A conformity nobody could have measured is refused.
//
// Contrast, focus visibility and reflow are not decided by reading source — they are
// measured on a render. An audit that never rendered anything and still publishes them as
// conformant is making the one claim an accessibility tool must never make: a pass nobody
// tested. The failure mode here is not a wrong answer, it is a confident silence.
import { describe, expect, it } from "vitest";
import { checkReport } from "../src/check.js";
import { runAudit } from "../src/audit.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "u11y-evidence-"));
writeFileSync(join(dir, "page.html"), '<!doctype html><html lang="en"><head><title>T</title></head><body><p>x</p></body></html>');
const audit = runAudit({ inputs: [join(dir, "page.html")] });
rmSync(dir, { recursive: true, force: true });

/** A minimal report shaped like the real one, claiming `ids` conformant via the engine. */
function reportClaiming(ids: string[]): string {
  return [
    "# Audit",
    "",
    "- **Pass rate**: 100%",
    "",
    "## 1. Scope",
    "",
    "## 2. Non-conformities",
    "",
    "## 3. Conformant",
    "",
    ...ids.map((id) => `- ${id} — Something`),
    "",
    "## 4. Not applicable",
    "",
    "## 5. To assess",
    "",
  ].join("\n");
}

describe("a rendering criterion claimed conformant without a render", () => {
  it("is refused, and the message names the tool that would produce the evidence", () => {
    // 1.4.3 Contrast (Minimum) is measured on the render. This audit is source-only.
    const r = checkReport(reportClaiming(["1.4.3"]), "wcag", "en", { audit });
    expect(r.ok).toBe(false);
    const issue = r.issues.find((i) => i.includes("1.4.3"))!;
    expect(issue).toMatch(/Unevidenced conformity/);
    expect(issue).toMatch(/ultra11y render|ultra11y scan/);
  });

  it("refuses a browser-tier criterion when no scan was merged", () => {
    // 1.4.4 Resize Text needs a real browser: no static or snapshot rule decides it.
    const r = checkReport(reportClaiming(["1.4.4"]), "wcag", "en", { audit });
    expect(r.issues.some((i) => i.includes("1.4.4") && /scan/.test(i))).toBe(true);
  });
});

describe("what the gate must NOT refuse", () => {
  it("leaves a criterion the static engine really does decide alone", () => {
    // 3.1.1 Language of Page is settled from source. Claiming it conformant is legitimate.
    const r = checkReport(reportClaiming(["3.1.1"]), "wcag", "en", { audit });
    expect(r.issues.some((i) => i.includes("3.1.1"))).toBe(false);
  });

  it("leaves an AGENT's ruling alone — it saw something the audit cannot record", () => {
    // Section 3 separates engine-decided conformity from an agent's judgement, and only the
    // engine half is gated. An adjudication is evidence-bound by the semantic gate instead.
    const md = reportClaiming([]).replace(
      "## 3. Conformant\n",
      "## 3. Conformant\n\n### Ruled by the agent\n\n- 1.4.3 — Contrast (Minimum) — _checked in the browser_\n",
    );
    const r = checkReport(md, "wcag", "en", { audit });
    expect(r.issues.some((i) => i.includes("1.4.3"))).toBe(false);
  });

  it("does nothing without an audit to compare against", () => {
    // No audit in hand means no way to know what evidence exists. Refusing on a guess would
    // be as wrong as passing on one.
    const r = checkReport(reportClaiming(["1.4.3"]), "wcag", "en");
    expect(r.issues.some((i) => /Unevidenced/.test(i))).toBe(false);
  });

  it("reads an absent pagesAudited as unknown, never as zero", () => {
    // An audit written before that field existed must not start failing on a technicality.
    const legacy = { ...audit, scope: { ...audit.scope, pagesAudited: undefined } };
    const r = checkReport(reportClaiming(["1.4.3"]), "wcag", "en", { audit: legacy });
    expect(r.issues.some((i) => i.includes("1.4.3"))).toBe(false);
  });

  it("accepts a rendering criterion once a scan has been merged", () => {
    const scanned = { ...audit, scope: { ...audit.scope, scan: { testedScs: ["1.4.3", "1.4.4"] } } };
    const r = checkReport(reportClaiming(["1.4.3", "1.4.4"]), "wcag", "en", { audit: scanned });
    expect(r.issues.some((i) => /Unevidenced/.test(i))).toBe(false);
  });
});

describe("the gate speaks the report's language", () => {
  it("refuses in French for a French report", () => {
    const r = checkReport(reportClaiming(["1.4.3"]), "wcag", "fr", { audit });
    expect(r.issues.some((i) => /Conformité non étayée/.test(i))).toBe(true);
  });
});

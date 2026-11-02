// #116 — `report --json` must say what the report says (#110's promise). Under a pack it emitted
// the WCAG core's `conformancePct` (e.g. 90) above a document headlining its own conformity rate
// (e.g. 2 % = 2 ÷ 102), and echoed the raw `--standard` flag instead of the resolved key.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { packReportRates } from "../src/report.js";
import { loadPack } from "../src/standards/index.js";

const FIX = new URL("./fixtures/", import.meta.url).pathname;
const BIN = new URL("../scripts/ultra11y.mjs", import.meta.url).pathname;
const audit = runAudit({ inputs: [`${FIX}non-conforming/bad.html`] });

const dir = mkdtempSync(join(tmpdir(), "u11y-report-json-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const input = join(dir, "audit.json");
writeFileSync(input, JSON.stringify(audit));

interface ReportJson {
  path: string;
  standard: string;
  conformancePct: number | null;
  conformance?: { pct: number; validated: number; applicable: number; na: number; open: number; decided: number; total: number };
  automaticPct?: number;
  automatic?: { pct: number; validated: number; decided: number };
}
const cliReport = (...flags: string[]): ReportJson => {
  const out = mkdtempSync(join(dir, "out-"));
  return JSON.parse(execFileSync("node", [BIN, "report", "--in", input, "--lang", "fr", "--out", out, "--json", ...flags], { encoding: "utf8" })) as ReportJson;
};

describe("report --json carries the rate the pack report prints (#116)", () => {
  const expected = packReportRates(audit, loadPack("rgaa"));

  it("emits the pack's own conformity rate and its operands, not the WCAG core rate", () => {
    const j = cliReport("--standard", "rgaa");
    expect(expected.conformance.pct).not.toBe(audit.conformancePct); // the fixture tells the two apart
    expect(j.conformancePct).toBe(expected.conformance.pct);
    expect(j.conformance).toEqual(expected.conformance);
    expect(j.automaticPct).toBe(expected.automatic.pct);
    expect(j.automatic).toEqual(expected.automatic);
  });

  it("is the number and the operands the written report headlines", () => {
    const j = cliReport("--standard", "rgaa");
    const md = readFileSync(j.path, "utf8");
    const c = j.conformance!;
    expect(md).toContain(`${j.conformancePct}% — critères validés ÷ critères applicables (${c.validated} ÷ ${c.applicable})`);
  });

  it("names the resolved standard key, not the raw flag", () => {
    expect(cliReport("--standard", "RGAA").standard).toBe("rgaa");
  });

  it("keeps the WCAG core rate for a core report, without pack operands", () => {
    const j = cliReport();
    expect(j.standard).toBe("wcag");
    expect(j.conformancePct).toBe(audit.conformancePct);
    expect(j.conformance).toBeUndefined();
    expect(j.automatic).toBeUndefined();
  });
});

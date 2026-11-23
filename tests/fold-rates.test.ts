// #156 — `verify --apply --json` printed one rate, `conformancePct`, and callers read it as THE
// rate of the adjudicated audit. It is the WCAG core's AUTOMATIC static pass rate, frozen by
// design against judgements, so a fold that ruled a whole RGAA grid left it where it was. The
// payload keeps it, and now says what it is (`automaticPassRatePct`) and carries the standard's
// own conformity rate beside it — the object `report --json` carries.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { type AdjudicationItem, buildAdjudicationWorklist } from "../src/adjudicate.js";
import { runAudit } from "../src/audit.js";
import { main } from "../src/cli.js";
import { foldRates, packReportRates } from "../src/report.js";
import { loadPack } from "../src/standards/index.js";

const BAD = new URL("./fixtures/non-conforming/bad.html", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "u11y-fold-rates-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

const audit = runAudit({ inputs: [BAD] });

describe("foldRates", () => {
  it("under the core: the automatic pass rate, under its own name, and nothing else", () => {
    expect(foldRates(audit, "wcag")).toEqual({ automaticPassRatePct: audit.conformancePct });
  });

  it("under a pack: the standard's conformity rate and its operands, as `report --json` has them", () => {
    const { conformance } = packReportRates(audit, loadPack("rgaa"));
    expect(foldRates(audit, "rgaa")).toEqual({
      automaticPassRatePct: audit.conformancePct,
      conformanceRatePct: conformance.applicable === 0 ? null : conformance.pct,
      conformance,
    });
  });
});

describe("verify --apply --json", () => {
  it("keeps `conformancePct` and adds the two rates a reader can tell apart", async () => {
    const input = join(dir, "audit.json");
    writeFileSync(input, JSON.stringify(audit));
    const items = buildAdjudicationWorklist(audit, { standard: "rgaa" })
      .filter((i) => !i.signals?.length && i.evidence.length && i.evidenceComplete !== false)
      .map((i) => ({ ...i, verdict: "C", justification: "vérifié sur le code", citations: [i.evidence[0]!] }) as AdjudicationItem);
    expect(items.length).toBeGreaterThan(0);
    const adjudication = join(dir, "adjudication.json");
    writeFileSync(adjudication, JSON.stringify({ tool: "ultra11y", kind: "adjudication", schemaVersion: 2, standard: "rgaa", auditDate: audit.date, items }));

    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main(["verify", "--apply", adjudication, "--in", input, "--out", join(dir, "out"), "--json"])).toBe(0);
    const j = JSON.parse(out.join("\n"));

    expect(j.automaticPassRatePct).toBe(j.conformancePct);
    expect(j.conformance.validated).toBeGreaterThan(0);
    expect(j.conformanceRatePct).toBe(j.conformance.pct);
    // The fixture tells the two apart, which is the whole point of naming them.
    expect(j.conformanceRatePct).not.toBe(j.automaticPassRatePct);
  });
});

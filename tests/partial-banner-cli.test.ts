// #100 — the CLI warning and `report --json` (partialAudit / untestedCriteria) must say what the
// document says. They called `untestedNeedsRendering(result)` WITHOUT the verdicts the pack grid
// rules on, so after adjudication egapro's terminal listed four « untested » topics above a
// report that named one. And the remedy must fit the run: telling a run that already scanned to
// « run scan --sample » sends its reader round in a circle.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { packPartialAudit, partialAuditBanner, renderPackReport } from "../src/report.js";
import { loadPack } from "../src/standards/index.js";
import type { AuditResult } from "../src/types.js";

const FIX = new URL("./fixtures/", import.meta.url).pathname;
const BIN = new URL("../scripts/ultra11y.mjs", import.meta.url).pathname;
const source = runAudit({ inputs: [`${FIX}non-conforming/bad.html`] });
const rendered: AuditResult = {
  ...source,
  scope: { ...source.scope, pagesAudited: ["accueil", "contact"], captures: { files: 2, components: [] } },
};
const ALL_BUT_LIVE = ["1.3.4", "1.4.1", "1.4.3", "1.4.4", "1.4.10", "1.4.11", "1.4.12", "1.4.13", "2.1.2", "2.4.7", "2.4.11"];
const withVerdict: AuditResult = {
  ...rendered,
  scope: { ...rendered.scope, scan: { testedScs: ALL_BUT_LIVE } },
  packAdjudication: {
    standard: "rgaa",
    criteria: [
      {
        id: "7.5",
        status: "NC",
        justification: "Le bloc d'erreur apparaît hors de toute région live.",
        findings: [
          {
            ruleId: "agent:7.5",
            criteriaId: "4.1.3",
            file: "src/Step1.tsx",
            line: 361,
            col: 1,
            selectorHint: "div.fr-alert",
            severity: "majeur" as const,
            message: "Message de statut hors région live.",
            remediation: "",
            snippet: '<div class="fr-alert">',
          },
        ],
      },
    ],
  },
} as AuditResult;

const dir = mkdtempSync(join(tmpdir(), "u11y-partial-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const cliReport = (a: AuditResult) => {
  const f = join(dir, `a${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, JSON.stringify(a));
  const out = execFileSync("node", [BIN, "report", "--in", f, "--standard", "rgaa", "--lang", "fr", "--out", dir, "--json"], { encoding: "utf8" });
  return JSON.parse(out) as { partialAudit?: boolean; untestedCriteria?: string[] };
};

describe("the CLI partial-audit warning says what the report says (#100)", () => {
  it("packPartialAudit is the document's own list", () => {
    expect(packPartialAudit(withVerdict, "rgaa")).toEqual([]);
    expect(renderPackReport(withVerdict, loadPack("rgaa"), "fr")).not.toContain("Audit partiel");
  });

  it("report --json no longer lists a criterion the grid rules on", () => {
    const j = cliReport(withVerdict);
    expect(j.partialAudit).toBeUndefined();
    expect(j.untestedCriteria).toBeUndefined();
  });

  it("still lists what nothing measured and nothing decided", () => {
    const j = cliReport({ ...rendered, scope: { ...rendered.scope, scan: { testedScs: ALL_BUT_LIVE } } } as AuditResult);
    expect(j.untestedCriteria).toEqual(["4.1.3"]);
  });
});

describe("the remedy fits what the run already did (#100)", () => {
  it("advises a browser pass only when none ran", () => {
    expect(partialAuditBanner("fr", ["4.1.3"])).toContain("scan --sample");
    expect(partialAuditBanner("fr", ["4.1.3"], { scanned: true })).not.toContain("Lancez `ultra11y scan --sample`");
  });

  it("explains why live regions stayed unmeasured after a scan, and how to measure them", () => {
    const fr = partialAuditBanner("fr", ["4.1.3"], { scanned: true });
    expect(fr).toMatch(/interactions/);
    expect(fr).toMatch(/storage-state|authentifi/);
    expect(fr).toContain("checkA11y");
    expect(partialAuditBanner("en", ["4.1.3"], { scanned: true })).toMatch(/interactions/);
  });

  it("points colour, contrast and focus at the captures' style digest, not at another scan", () => {
    const fr = partialAuditBanner("fr", ["1.4.1", "1.4.11"], { scanned: true });
    expect(fr).toContain("styles.json");
    expect(fr).not.toContain("Lancez `ultra11y scan --sample`");
  });
});

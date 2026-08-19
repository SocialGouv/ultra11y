// A FINDING NOBODY CAN ANCHOR MUST NOT REACH — OR CRASH — A CI SURFACE.
//
// Measured on a real run (SocialGouv/egapro, 2026-08-19): the first pull request on which the
// agent adjudication ruled produced an NC whose declaration carried no `file`. `agentFinding`
// copied it verbatim, `repoRelative` did `file.split("\\")` on `undefined`, and `report --format
// sarif` died with «Cannot read properties of undefined (reading 'split')» — taking the SARIF,
// the annotations, the PR comment, the report, the HTML and the artifact upload with it, since
// every one of those steps runs after it.
//
// Two defences, because they answer different questions. The fold must not MINT a finding it
// cannot anchor: an NC that cites nothing is exactly what the gate exists to refuse, and letting
// one through publishes a non-conformity nobody can go and look at. And the path helper must not
// CRASH on one whatever its provenance — an audit JSON can also be hand-written, or come from an
// external tool's adapter, and a rendering surface that explodes on bad input tells its reader
// nothing at all.
import { describe, expect, it } from "vitest";

import { applyAdjudication, type AdjudicationFile } from "../src/adjudicate.js";
import { runAudit } from "../src/audit.js";
import { toSarif } from "../src/sarif.js";
import { repoRelative } from "../src/util.js";

const audit = () =>
  runAudit({ inputs: ["-"], stdin: `<!doctype html><html lang="fr"><head><title>t</title></head><body><main><h1>H</h1><p>x</p></main></body></html>` });

const adjFile = (findings: unknown[]): AdjudicationFile =>
  ({
    tool: "ultra11y",
    kind: "adjudication",
    schemaVersion: 2,
    auditDate: "2026-08-19",
    standard: "wcag",
    items: [
      {
        criteriaId: "1.3.1",
        automatability: "judgment",
        evidence: [],
        verdict: "NC",
        justification: "",
        reason: null,
        findings,
        recommendations: [],
        decidedBy: "agent",
      },
    ],
  }) as unknown as AdjudicationFile;

describe("repoRelative", () => {
  it("survives a finding with no file, instead of taking every CI surface down with it", () => {
    expect(() => repoRelative(undefined as unknown as string, "/repo")).not.toThrow();
    expect(repoRelative(undefined as unknown as string, "/repo")).toBe("");
    expect(repoRelative("", "/repo")).toBe("");
  });

  it("still relativises a real path", () => {
    expect(repoRelative("/repo/src/a.tsx", "/repo")).toBe("src/a.tsx");
  });
});

describe("the adjudication fold", () => {
  it("refuses an NC declaration that names no file", () => {
    // Not a rendering concern: an NC nobody can open is a non-conformity nobody can act on, and
    // the citation gate is the whole reason a model verdict is allowed into an audit at all.
    const r = audit();
    const res = applyAdjudication(r, adjFile([{ message: "quelque chose ne va pas", line: 3 }]));
    expect(res.applied).toBe(0);
    expect(res.rejected).toBeGreaterThan(0);
    expect(res.rejectedCriteria).toContain("1.3.1");
    expect(res.issues.join(" ")).toMatch(/name the file/i);
    expect(r.findings.some((f) => f.ruleId === "agent:1.3.1")).toBe(false);
  });

  it("and the report surfaces still render on an audit that already carries one", () => {
    // Defence in depth: an audit JSON can be hand-written or produced by an external adapter,
    // and neither goes through the fold.
    const r = audit();
    r.findings.push({
      ruleId: "agent:1.3.1",
      criteriaId: "1.3.1",
      line: 3,
      col: 1,
      selectorHint: "",
      severity: "majeur",
      message: "sans fichier",
      remediation: "",
      snippet: "",
    } as unknown as (typeof r.findings)[number]);
    expect(() => toSarif(r, { standard: "rgaa", lang: "fr" })).not.toThrow();
  });
});

// A CLEARING VERDICT DOES NOT ERASE A NON-CONFORMITY THE ENGINE PROVED.
//
// Under a pack, the worklist hands an engine-proven NC back to the adjudicator when some page
// cells are still open: the deterministic finding settles the run and the page it fired on,
// and the verdict is asked for the other pages. Folded run-wide, an agent `C` replaced the
// proof: found by the full-audit e2e run (tests/full-audit.e2e.test.ts), where an unlabelled
// email field on the contact page vanished from the report, the grid and the contact page's
// own sheet once 11.1 was ruled `C` for the rest of the site.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runAudit } from "../src/audit.js";
import { derivePackResults } from "../src/standards/index.js";
import type { AuditResult } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-clear-nc-"));
const PAGE = join(dir, "contact.html");
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Contact</title></head><body><main>
<h1>Contact</h1>
<form><p>Adresse électronique</p><input type="email" name="courriel"><button type="submit">Envoyer</button></form>
</main></body></html>`,
);

const withVerdict = (audit: AuditResult, status: "C" | "NA" | "NC"): AuditResult => ({
  ...audit,
  packAdjudication: {
    standard: "rgaa",
    criteria: [
      {
        id: "11.1",
        status,
        justification: "Every other field has a label.",
        findings: [],
        decidedBy: "agent",
      },
    ],
  },
});

describe("an agent verdict over an engine-proven NC", () => {
  const audit = runAudit({ inputs: [PAGE] });
  const engine = derivePackResults(audit, "rgaa").find((c) => c.id === "11.1")!;

  it("starts from a deterministic NC (the precondition of this file)", () => {
    expect(engine.status).toBe("NC");
    expect(engine.findings.some((f) => !f.advisory && !f.ruleId.startsWith("agent:"))).toBe(true);
  });

  it.each(["C", "NA"] as const)("keeps the NC and its engine findings when the verdict is %s", (status) => {
    const folded = derivePackResults(withVerdict(audit, status), "rgaa").find((c) => c.id === "11.1")!;
    expect(folded.status).toBe("NC");
    expect(folded.findings.map((f) => f.ruleId)).toEqual(engine.findings.map((f) => f.ruleId));
    expect(folded.decidedBy).toBeUndefined();
  });

  it("still applies the clearing verdict where the view carries no proof (another page)", () => {
    const clean = {
      ...audit,
      findings: [],
      criteria: audit.criteria.map((c) => ({ ...c, findings: [], status: c.status === "NC" ? ("C" as const) : c.status })),
    };
    const folded = derivePackResults(withVerdict(clean, "C"), "rgaa").find((c) => c.id === "11.1")!;
    expect(folded.status).toBe("C");
    expect(folded.decidedBy).toBe("agent");
  });
});

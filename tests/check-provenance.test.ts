// « DID ALL 106 ACTUALLY RUN? » — answered by the run, not by hand.
//
// The question was answered by counting ledger entries against a worklist, and that count
// answers the wrong thing: a criterion the static engine settled appears in neither, so a run
// where the engine decided 55 of 106 reads as « 51 criteria audited » when 106 were. The split
// says who settled each one, and it is also the number to watch between runs — every criterion
// that moves from `agent` to `engine` or `scan` is one the pass stops paying a model to read.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import { checkDecided } from "../src/check.js";
import { buildAdjudicationWorklist, applyAdjudication, type AdjudicationFile, type AdjudicationItem } from "../src/adjudicate.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-prov-"));
const PAGE = join(dir, "page.html");
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Boutique</title></head><body><main>
<h1>Bienvenue</h1><img src="a.png" alt="Un randonneur">
<form action="/x"><label for="e">Email</label><input id="e" type="email"><button>Envoyer</button></form>
<a href="/aide">Contacter le support</a>
</main></body></html>`,
);

const audit = () => runAudit({ inputs: [PAGE] });

describe("the provenance split", () => {
  it("accounts for every criterion of the standard, exactly once", () => {
    const p = checkDecided(audit(), "rgaa", "fr").provenance;
    expect(p.total).toBe(106);
    expect(p.engine + p.scan + p.agent + p.declared + p.undecided).toBe(p.total);
  });

  it("credits the static engine on a run with no adjudication at all", () => {
    const p = checkDecided(audit(), "rgaa", "fr").provenance;
    expect(p.engine).toBeGreaterThan(0);
    expect(p.agent).toBe(0);
  });

  it("moves criteria into `agent` once they are adjudicated, and out of `undecided`", () => {
    const before = checkDecided(audit(), "rgaa", "fr").provenance;
    const items = buildAdjudicationWorklist(audit(), { standard: "rgaa" });
    const adj: AdjudicationFile = {
      tool: "ultra11y",
      kind: "adjudication",
      schemaVersion: 2,
      standard: "rgaa",
      auditDate: "2026-08-24",
      items: items.map(
        (it): AdjudicationItem =>
          it.evidence.length
            ? { ...it, verdict: "C", justification: "vérifié sur la page", citations: [it.evidence[0]!] }
            : { ...it, verdict: "manual", reason: "undecidable" },
      ),
    };
    const r = applyAdjudication(audit(), adj, { cwd: dir });
    const after = checkDecided(r.audit, "rgaa", "fr").provenance;
    expect(after.agent).toBeGreaterThan(0);
    expect(after.undecided).toBeLessThan(before.undecided);
    expect(after.engine + after.scan + after.agent + after.declared + after.undecided).toBe(106);
  });

  // A refused verdict leaves a record shaped like an agent one. Counting it under `agent` would
  // report an adjudication for a criterion nobody decided — the exact laundering the gate
  // refuses one line earlier.
  it("counts a still-open criterion as undecided, whatever provenance its record carries", () => {
    const a = audit();
    const p = checkDecided(a, "rgaa", "fr").provenance;
    const open = new Set(
      checkDecided(a, "rgaa", "fr")
        .undecided.concat([])
        .map((x) => x),
    );
    expect(p.undecided).toBe(open.size);
  });

  it("answers for the WCAG core too", () => {
    const p = checkDecided(audit(), "wcag", "fr").provenance;
    expect(p.total).toBe(55);
    expect(p.engine + p.scan + p.agent + p.declared + p.undecided).toBe(55);
  });
});

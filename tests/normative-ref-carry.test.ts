// THE TEST THE AGENT CITED, NOT EVERY TEST OF ITS CRITERION.
//
// An RGAA non-conformity is a claim about ONE numbered test. The gate already proves it:
// `normativeRefResolves` (src/adjudicate.ts) refuses an NC whose `normativeRef` does not
// resolve to a test OF THE ADJUDICATED CRITERION. Then `agentFinding` dropped the field on
// the floor, and every deliverable fell back to `packTestIds` — printing « 11.1.1 · 11.1.2 ·
// 11.1.3 » where the auditor had signed « 11.1.2 ». For an RGAA NC that IS the substance of
// the finding, and it is also the only thing that lets a second reader ask the question that
// catches an over-accusing adjudicator: is this observation attached to the right test?
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import { buildAdjudicationWorklist, applyAdjudication, type AdjudicationFile, type AdjudicationItem } from "../src/adjudicate.js";
import { auditorUnitModel } from "../src/auditor.js";
import { acceptanceCriteria, type PrdUnit } from "../src/prd.js";
import { loadPack, packTestIds, packTestsCited } from "../src/standards/index.js";
import type { Finding } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-normref-"));
const PAGE = join(dir, "page.html");
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Boutique</title></head><body><main>
<h1>Bienvenue</h1>
<img src="hero.png" alt="Un randonneur sur une crête">
<label for="email">Email</label><input id="email" type="email">
<a href="/aide">Contacter le support</a>
</main></body></html>`,
);

const audit = () => runAudit({ inputs: [PAGE] });

const adjFile = (items: AdjudicationItem[]): AdjudicationFile => ({
  tool: "ultra11y",
  kind: "adjudication",
  schemaVersion: 2,
  standard: "rgaa",
  auditDate: "2026-08-24",
  items,
});

/** Clear every criterion but the one under test, so only it can fail the run. */
const clear = (it: AdjudicationItem): AdjudicationItem =>
  it.evidence.length
    ? { ...it, verdict: "C" as const, justification: "vérifié sur la page", citations: [it.evidence[0]!] }
    : { ...it, verdict: "manual" as const, reason: "undecidable" };

/** An NC on `id` citing exactly one of its numbered tests, anchored on its own evidence. */
function ncOn(id: string, normativeRef: string) {
  const items = buildAdjudicationWorklist(audit(), { standard: "rgaa" });
  const target = items.find((i) => i.criteriaId === id);
  expect(target, `${id} is not on the RGAA worklist`).toBeDefined();
  const ev = target!.evidence[0];
  expect(ev, `${id} harvested no evidence to anchor an NC on`).toBeDefined();
  return applyAdjudication(
    audit(),
    adjFile(
      items.map((it) =>
        it.criteriaId === id
          ? ({
              ...it,
              verdict: "NC" as const,
              findings: [{ file: ev!.file, line: ev!.line, selector: ev!.selector, snippet: ev!.snippet, message: "constat de test", normativeRef }],
            } as AdjudicationItem)
          : clear(it),
      ),
    ),
    { cwd: dir },
  );
}

describe("the fold carries the cited normative test", () => {
  it("keeps `normativeRef` on the finding it just validated", () => {
    const r = ncOn("11.2", "11.2.1");
    expect(r.rejectedCriteria, r.issues.join("\n")).not.toContain("11.2");
    const crit = r.audit.packAdjudication?.criteria.find((c) => c.id === "11.2");
    expect(crit?.status).toBe("NC");
    expect(crit?.findings[0]?.normativeRef).toBe("11.2.1");
    // …and on the flat findings list every downstream surface reads.
    expect(r.audit.findings.find((f) => f.criteriaId === "11.2")?.normativeRef).toBe("11.2.1");
  });
});

describe("packTestsCited narrows a criterion's tests to the ones actually cited", () => {
  const pack = loadPack("rgaa");

  it("returns only the cited test", () => {
    expect(packTestsCited(pack, "11.1", ["11.1.2"]).map((t) => t.id)).toEqual(["11.1.2"]);
  });

  it("falls back to every test when nothing was cited", () => {
    expect(packTestsCited(pack, "11.1", []).map((t) => t.id)).toEqual(packTestIds(pack, "11.1"));
  });

  it("falls back to every test when the citation names the criterion rather than a test", () => {
    expect(packTestsCited(pack, "11.1", ["11.1"]).map((t) => t.id)).toEqual(packTestIds(pack, "11.1"));
  });

  it("ignores a reference belonging to another criterion", () => {
    expect(packTestsCited(pack, "11.2", ["11.1.1"]).map((t) => t.id)).toEqual(packTestIds(pack, "11.2"));
  });

  it("keeps the pack's own order and de-duplicates", () => {
    expect(packTestsCited(pack, "11.1", ["11.1.3", "11.1.1", "11.1.3"]).map((t) => t.id)).toEqual(["11.1.1", "11.1.3"]);
  });
});

const unit = (criteriaId: string, refs: (string | undefined)[]): PrdUnit => ({
  criteriaId,
  title: "Chaque champ de formulaire a-t-il une étiquette ?",
  label: `RGAA ${criteriaId} — étiquette`,
  refs: [],
  severity: "bloquant",
  findings: refs.map(
    (normativeRef, i): Finding => ({
      ruleId: `agent:${criteriaId}`,
      criteriaId,
      file: "page.html",
      line: i + 1,
      col: 1,
      selectorHint: "input#email",
      severity: "bloquant",
      message: "constat",
      remediation: "corriger",
      snippet: '<input id="email">',
      ...(normativeRef ? { normativeRef } : {}),
    }),
  ),
});

describe("the auditor block prints the cited test, not the whole criterion", () => {
  const testsField = (u: PrdUnit) => auditorUnitModel(u, "rgaa", "fr").fields.find((f) => f.label.startsWith("Test"))?.value;

  it("names only the test the finding cites", () => {
    expect(testsField(unit("11.1", ["11.1.2"]))).toBe("11.1.2");
  });

  it("names the union when several findings cite different tests", () => {
    expect(testsField(unit("11.1", ["11.1.3", "11.1.1"]))).toBe("11.1.1 · 11.1.3");
  });

  it("still names every test when no finding cites one — an old ledger must not lose its tests", () => {
    const pack = loadPack("rgaa");
    expect(testsField(unit("11.1", [undefined]))).toBe(packTestIds(pack, "11.1").join(" · "));
  });
});

describe("the acceptance criteria are the cited tests", () => {
  it("emits one Given/When/Then per cited test, not per test of the criterion", () => {
    const lines = acceptanceCriteria(unit("11.1", ["11.1.2"]), "rgaa", "fr");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("RGAA 11.1.2");
  });

  it("keeps every test when nothing was cited", () => {
    const pack = loadPack("rgaa");
    expect(acceptanceCriteria(unit("11.1", [undefined]), "rgaa", "fr")).toHaveLength(packTestIds(pack, "11.1").length);
  });
});

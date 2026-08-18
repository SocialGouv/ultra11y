// THE FILE THE AGENT EDITS HAS TO CARRY A USABLE CITATION ALREADY.
//
// `ADJUDICATE.verdicts.json` is the only file the CI adjudicator writes, and it was stripped of
// evidence AND of citations: the agent had to author `citations: [{file, line, selector,
// snippet}]` from scratch, cross-referencing a separate brief, for every criterion it cleared.
//
// Measured on a real run: thirty criteria came back `C` with a justification and no citations
// at all, and the fold refused every one of them — « a C verdict must cite at least one of the
// N evidence item(s) it was shown ». The agent had read the evidence; it had simply not copied
// an anchor into a second file.
//
// So the skeleton arrives with the representatives already cited. That decides NOTHING — the
// verdict and the justification are still the agent's, and a `C` still has to survive
// grounding, the coverage check and the complete-evidence rule. What it removes is a
// transcription step that was costing correct verdicts.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import {
  applyAdjudication,
  buildAdjudicationWorklist,
  hydrateAdjudication,
  slimAdjudicationItems,
  type AdjudicationFile,
  type AdjudicationItem,
} from "../src/adjudicate.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-slim-"));
const PAGE = join(dir, "page.html");
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Aide</title></head><body><main><h1>Aide</h1><img src="/a.svg" alt="Schéma" class="fr-responsive-img"><a href="/contact">Nous contacter</a></main></body></html>`,
);

const items = () => buildAdjudicationWorklist(runAudit({ inputs: [PAGE] }), { standard: "rgaa" });
const file = (list: AdjudicationItem[]): AdjudicationFile => ({
  tool: "ultra11y",
  kind: "adjudication",
  schemaVersion: 2,
  standard: "rgaa",
  auditDate: "2026-08-18",
  items: list,
});

describe("the verdicts skeleton pre-fills the citations", () => {
  it("carries a citation for every criterion that has evidence", () => {
    const slim = slimAdjudicationItems(items());
    const withEvidence = items().filter((i) => i.evidence.length);
    expect(withEvidence.length).toBeGreaterThan(0);
    for (const it of withEvidence) {
      const s = slim.find((x) => x.criteriaId === it.criteriaId)!;
      expect(s.citations?.length, `${it.criteriaId} has no pre-filled citation`).toBeGreaterThan(0);
    }
  });

  it("cites the real harvested anchors, with the snippet the fold can ground", () => {
    const slim = slimAdjudicationItems(items());
    const src = items().find((i) => i.evidence.length)!;
    const s = slim.find((x) => x.criteriaId === src.criteriaId)!;
    const first = s.citations![0] as { file: string; line: number; snippet?: string };
    expect(first.file).toBe(src.evidence[0]!.file);
    expect(first.line).toBe(src.evidence[0]!.line);
    expect(first.snippet).toBe(src.evidence[0]!.snippet);
  });

  it("still strips the bulk — the skeleton is small on purpose", () => {
    const slim = slimAdjudicationItems(items());
    expect(slim.every((i) => i.evidence.length === 0)).toBe(true);
  });

  it("leaves a criterion with no evidence uncited — there is nothing to cite", () => {
    const slim = slimAdjudicationItems(items());
    for (const it of items().filter((i) => !i.evidence.length)) {
      expect(slim.find((x) => x.criteriaId === it.criteriaId)!.citations ?? []).toEqual([]);
    }
  });

  it("makes a C that keeps the pre-filled citation land, instead of being refused", () => {
    // The whole point, end to end: the agent rules and justifies, the citation is already
    // there, and the fold accepts because the anchor is real.
    const slim = slimAdjudicationItems(items()).map((i) =>
      i.citations?.length
        ? ({ ...i, verdict: "C", justification: "vérifié sur la page" } as AdjudicationItem)
        : ({ ...i, verdict: "manual", reason: "undecidable" } as AdjudicationItem),
    );
    // `verify --apply` puts the evidence back before folding — a verdicts-only file is a
    // contract, not a shortcut past the gate. The test walks the same path.
    const audit = runAudit({ inputs: [PAGE] });
    const adj = file(slim);
    hydrateAdjudication(adj, audit, { cwd: dir });
    const r = applyAdjudication(audit, adj, { cwd: dir });
    expect(r.applied, r.issues.join("\n")).toBeGreaterThan(0);
    expect(r.issues.join("\n")).not.toMatch(/must cite at least one/);
  });
});

// The file the prompt calls "the small one to WRITE" has to stay small.
//
// The first cut of the pre-fill copied the whole Evidence object — `note`, `occurrences`,
// `pages`, and `alsoAt`, which on one criterion held 167 sibling anchors. The skeleton went to
// 367 KB. Measured on a real run: the adjudicator stopped after 22 turns of a 228 budget,
// wrote nothing, and all 42 criteria came back `unadjudicated`.
describe("the skeleton stays small enough to be written", () => {
  it("carries only what says WHICH element — never the population or the siblings", () => {
    const slim = slimAdjudicationItems(items());
    for (const it of slim) {
      for (const c of it.citations ?? []) {
        expect(Object.keys(c).sort()).toEqual(["file", "line", "selector", "snippet"].filter((k) => k in (c as object)).sort());
        expect((c as { alsoAt?: unknown }).alsoAt).toBeUndefined();
        expect((c as { pages?: unknown }).pages).toBeUndefined();
        expect((c as { occurrences?: unknown }).occurrences).toBeUndefined();
        expect((c as { note?: unknown }).note).toBeUndefined();
      }
    }
  });

  it("keeps a pre-filled snippet short — it identifies, it does not reproduce", () => {
    for (const it of slimAdjudicationItems(items())) {
      for (const c of it.citations ?? []) expect(((c as { snippet?: string }).snippet ?? "").length).toBeLessThanOrEqual(120);
    }
  });
});

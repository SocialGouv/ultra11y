// REFUTING A CONFORMITY — the half of the gate that did not exist.
//
// `verify` built its adversarial worklist from the report's non-conformities and from nothing
// else, so every `C` an agent recorded was challenged by exactly nobody. A criterion could be
// cleared because its subject was PRESENT rather than because it was RIGHT — an `<img>` with
// some alt text, a page with some `<title>` — and the conformance claim shipped.
//
// That is the expensive direction of the two. An invented non-conformity costs a reviewer an
// argument; an invented conformity is published as a statement that a site is accessible on a
// criterion nobody checked.
//
// The vocabulary is deliberately the SAME on both halves, because the question is the same —
// does the cited evidence support the claim? — and only the claim is inverted. What differs is
// the remedy, which is why the two are counted apart: a refuted non-conformity is deleted from
// the report; a refuted conformity sends its criterion back to « to assess », never to NC.
// Refuting a conformity proves nothing against the criterion.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildConformityWorklist,
  applyVerdicts,
  conformityClaimsFromAudit,
  formatWorklist,
  verifyGroundingInputs,
  type ConformityClaim,
  type VerifyItem,
} from "../src/verify.js";
import { runAudit } from "../src/audit.js";
import { pruneRefuted } from "../src/refute.js";
import type { AuditResult } from "../src/types.js";

const claim = (over: Partial<ConformityClaim> = {}): ConformityClaim => ({
  criteriaId: "1.3",
  verdict: "C",
  justification: "L'image logo.png porte une alternative textuelle pertinente via title.",
  citations: [{ file: "index.html", line: 59, selector: "img", snippet: '<img src="/img/logo.png" alt="" title="Logo Orbit">' }],
  ...over,
});

describe("the conformity worklist", () => {
  it("puts one evidence-set item on trial per claimed conformity", () => {
    const items = buildConformityWorklist([
      claim({
        citations: [
          { file: "a.html", line: 1, selector: "img" },
          { file: "b.html", line: 2, selector: "img" },
        ],
      }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("c");
    expect(items[0]!.file).toBe("a.html");
    expect(items[0]!.citations?.map((citation) => citation.file)).toEqual(["a.html", "b.html"]);
  });

  it("carries the agent's own justification as the claim, not a paraphrase of it", () => {
    // Attacking a summary would let a bad justification survive by never being read.
    expect(buildConformityWorklist([claim()])[0]!.claim).toBe("L'image logo.png porte une alternative textuelle pertinente via title.");
  });

  it("ignores every verdict that does not clear the criterion", () => {
    expect(buildConformityWorklist([claim({ verdict: "NC" }), claim({ verdict: "manual" })])).toEqual([]);
  });

  // « Non applicable » CLEARS a criterion — the audit folds it to C and the rate counts it as
  // conforming — so it stands trial like any other clearing claim. A ledger stores it as `NA`.
  it("puts a ledger NA on trial like a C", () => {
    const items = buildConformityWorklist([claim({ verdict: "NA" })]);
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("c");
  });

  // The hole an external orchestrator walked through: an NA on a criterion whose harvest came
  // back empty cites nothing, and the worklist used to drop every claim without a citation. The
  // NA then counted as conforming with no second reader ever looking at it.
  it("puts an UNCITED clearing claim on trial at the scope level instead of dropping it", () => {
    const items = buildConformityWorklist([claim({ criteriaId: "12.8", verdict: "NA", citations: undefined, justification: "Aucun tabindex." })]);
    expect(items).toEqual([expect.objectContaining({ criteriaId: "12.8", kind: "c", uncited: true, file: "", line: 0, claim: "Aucun tabindex." })]);
  });

  it("asks the scope question for an uncited item, and grounds nothing for it", () => {
    const items = buildConformityWorklist([claim({ criteriaId: "12.8", verdict: "NA", citations: [] })]);
    const md = formatWorklist(items, false, "rgaa", "fr");
    expect(md).toContain("périmètre audité (aucune évidence citée)");
    expect(md).toContain("L'absence de collecte n'est pas une preuve");
    expect(verifyGroundingInputs(items)).toEqual([]);
  });

  it("sends a refuted uncited NA back to « to assess » like any refused conformity", () => {
    const [it0] = buildConformityWorklist([claim({ criteriaId: "12.8", verdict: "NA", citations: [] })]);
    const r = applyVerdicts([{ ...it0!, verdict: "refuted" }]);
    expect(r.conformitiesRefused.map((f) => f.criteriaId)).toEqual(["12.8"]);
  });

  it("numbers on from where the non-conformity half stopped", () => {
    expect(buildConformityWorklist([claim()], 7)[0]!.n).toBe(8);
  });

  it("honours the cap, so a large ledger cannot blow up the worklist", () => {
    const many = Array.from({ length: 10 }, (_, i) => claim({ criteriaId: `1.${i + 1}` }));
    expect(buildConformityWorklist(many, 0, 3)).toHaveLength(3);
  });
});

describe("the gate", () => {
  const item = (over: Partial<VerifyItem> = {}): VerifyItem => ({
    n: 1,
    criteriaId: "1.3",
    file: "index.html",
    line: 59,
    selector: "img",
    claim: "…",
    verdict: null,
    note: "",
    ...over,
  });

  it("fails a refuted conformity and counts it apart from a refuted non-conformity", () => {
    const r = applyVerdicts([item({ n: 1, verdict: "refuted" }), item({ n: 2, kind: "c", verdict: "refuted", criteriaId: "8.6" })]);
    expect(r.ok).toBe(false);
    expect(r.refuted).toBe(2);
    expect(r.conformitiesRefused.map((f) => f.criteriaId)).toEqual(["8.6"]);
  });

  it("passes a conformity whose citation the second reader upheld", () => {
    const r = applyVerdicts([item({ kind: "c", verdict: "supported" })]);
    expect(r.ok).toBe(true);
    expect(r.conformitiesRefused).toEqual([]);
  });

  it("does not let a conformity verdict cover the non-conformity on the same anchor", () => {
    // One criterion can be claimed non-conformant on one element and conformant on another —
    // RGAA 1.3 clearing four images and failing a fifth. With `kind` outside the coverage key
    // the two claims collide, and the gate reads the conformity as covering the NC.
    const expected = [item({ n: 1 }), item({ n: 2, kind: "c" })];
    const onlyTheConformity = [item({ n: 2, kind: "c", verdict: "supported" })];
    const r = applyVerdicts(onlyTheConformity, expected);
    expect(r.ok).toBe(false);
    expect(r.missing).toBe(1);
  });

  it("treats a worklist written before conformities existed exactly as before", () => {
    // No `kind` at all — every stored verdicts file keys and gates identically.
    const r = applyVerdicts([item({ verdict: "supported" })], [item({})]);
    expect(r.ok).toBe(true);
    expect(r.missing).toBe(0);
  });
});

describe("the rendered worklist", () => {
  const md = () => formatWorklist([...buildConformityWorklist([claim()], 0)], false, "rgaa", "fr");

  it("gives the conformities their own section and inverts the question", () => {
    expect(md()).toContain("## Conformités revendiquées");
    expect(md()).toMatch(/La question est INVERSÉE/);
    expect(md()).toMatch(/établit-elle.{0,40}le critère, ou montre-t-elle seulement que son sujet EXISTE/s);
  });

  it("says what a refuted conformity does — and what it must not do", () => {
    expect(md()).toMatch(/retourne « à évaluer » — il ne devient PAS une non-conformité/);
  });

  it("adds nothing when there is no conformity to try", () => {
    expect(formatWorklist([], false, "rgaa", "fr")).not.toContain("Conformités revendiquées");
  });
});

// Which uncited clearing claims the AUDIT hands to the trial. The engine's own absence fold is
// the one proof an empty harvest can carry: when every subject of the criterion is an element
// species (`<img>`, `<table>`…) and none exists anywhere in the scope, the NA is the engine's
// arithmetic, and a refuter would be billed for re-checking it. Anything else stands trial.
describe("uncited claims taken from an audit", () => {
  const audited = (): AuditResult => {
    const dir = mkdtempSync(join(tmpdir(), "ultra11y-na-trial-"));
    const file = join(dir, "page.html");
    writeFileSync(
      file,
      `<!doctype html><html lang="fr"><head><title>Accueil</title></head><body><main><h1>Accueil</h1><p>Texte.</p><a href="/a">Lien</a></main></body></html>`,
    );
    return runAudit({ inputs: [file] });
  };
  const clearAsAgent = (audit: AuditResult, ids: string[]): AuditResult => {
    for (const c of audit.criteria) {
      if (!ids.includes(c.id)) continue;
      c.status = "C";
      c.decidedBy = "agent";
      c.justification = "Non applicable : rien de concerné.";
      delete c.citations;
    }
    return audit;
  };

  it("tries an uncited NA whose empty harvest proves nothing (focus order)", () => {
    const claims = conformityClaimsFromAudit(clearAsAgent(audited(), ["2.4.3"]), "wcag");
    expect(claims.map((c) => c.criteriaId)).toEqual(["2.4.3"]);
  });

  // The RGAA case that was reported: a pack adjudication keeps the agent's NA as `NA`, and the
  // filter read `C` only — so on an RGAA audit no agent NA was EVER tried. 12.8 (tab order)
  // must stand trial; 5.1 (complex tables) on a page with no <table> is the engine's own proof.
  it("tries an RGAA agent NA kept as `NA`, except where the engine proves the absence", () => {
    const audit = audited();
    expect(audit.scope.subjectsSeen).not.toContain("tables");
    const na = (id: string) => ({ id, status: "NA" as const, decidedBy: "agent" as const, justification: "Non applicable." });
    audit.packAdjudication = { standard: "rgaa", criteria: [na("12.8"), na("10.11"), na("5.1")] } as unknown as AuditResult["packAdjudication"];
    expect(conformityClaimsFromAudit(audit, "rgaa").map((c) => c.criteriaId)).toEqual(["12.8", "10.11"]);
  });

  it("records an empty-harvest reason when a refuted NA is pruned", () => {
    const audit = audited();
    audit.packAdjudication = {
      standard: "rgaa",
      criteria: [{ id: "12.8", status: "NA", decidedBy: "agent", justification: "Non applicable." }],
    } as unknown as AuditResult["packAdjudication"];
    const [item] = buildConformityWorklist(conformityClaimsFromAudit(audit, "rgaa"));
    const { audit: next } = pruneRefuted(audit, "rgaa", [{ ...item!, verdict: "refuted" }], "fr");
    const rec = next.packAdjudication!.criteria.find((c) => c.id === "12.8")!;
    expect(rec.status).toBe("manual");
    expect(rec.justification).toContain("l'absence de collecte ne prouve pas");
  });

  it("does not try an uncited NA the engine's absence fold already proves (no image at all)", () => {
    const audit = audited();
    expect(audit.scope.subjectsSeen).not.toContain("images");
    expect(conformityClaimsFromAudit(clearAsAgent(audit, ["1.1.1"]), "wcag")).toEqual([]);
  });
});

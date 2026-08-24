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
import { buildConformityWorklist, applyVerdicts, formatWorklist, type ConformityClaim, type VerifyItem } from "../src/verify.js";

const claim = (over: Partial<ConformityClaim> = {}): ConformityClaim => ({
  criteriaId: "1.3",
  verdict: "C",
  justification: "L'image logo.png porte une alternative textuelle pertinente via title.",
  citations: [{ file: "index.html", line: 59, selector: "img", snippet: '<img src="/img/logo.png" alt="" title="Logo Orbit">' }],
  ...over,
});

describe("the conformity worklist", () => {
  it("puts one item on trial per citation the agent cleared the criterion on", () => {
    const items = buildConformityWorklist([
      claim({
        citations: [
          { file: "a.html", line: 1, selector: "img" },
          { file: "b.html", line: 2, selector: "img" },
        ],
      }),
    ]);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.kind === "c")).toBe(true);
    expect(items.map((i) => i.file)).toEqual(["a.html", "b.html"]);
  });

  it("carries the agent's own justification as the claim, not a paraphrase of it", () => {
    // Attacking a summary would let a bad justification survive by never being read.
    expect(buildConformityWorklist([claim()])[0]!.claim).toBe("L'image logo.png porte une alternative textuelle pertinente via title.");
  });

  it("ignores every verdict that is not a claimed conformity", () => {
    expect(buildConformityWorklist([claim({ verdict: "NC" }), claim({ verdict: "NA" }), claim({ verdict: "manual" })])).toEqual([]);
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

// EXISTENCE IS ONE CRITERION, RELEVANCE IS ANOTHER — and a cheap adjudicator writes the
// observation under whichever of the two it read last.
//
// Measured on a full RGAA run with Haiku: 74 non-conformities against a stronger model's 57,
// 19 of them on criteria the reference ledger cleared. The failure has a shape. RGAA lays
// existence/relevance PAIRS across the whole standard, and the model collapses them —
// « this field has no label » filed under 11.2 (which asks whether the label is RELEVANT,
// presupposing one exists) when it belongs to 11.1; « the page title is empty » filed under
// 8.6 when it belongs to 8.5.
//
// The gate cannot catch it, and that is structural: `normativeRefResolves` proves the cited
// test belongs to the adjudicated criterion, and 11.2.1 does belong to 11.2. It never asks
// whether the READING was right. So the brief has to say it, out of the pack's own data: a
// criterion states which neighbour owns the adjacent question.
import { describe, it, expect } from "vitest";
import { loadPack, siblingCriteria, presupposedCriterion } from "../src/standards/index.js";
import { formatAdjudication, type AdjudicationItem } from "../src/adjudicate.js";

const pack = loadPack("rgaa");
const ids = (id: string) => siblingCriteria(pack, id).map((s) => s.id);

describe("siblingCriteria names the neighbour that owns the adjacent question", () => {
  it("puts 11.1 (does a label exist?) first for 11.2 (is the label relevant?)", () => {
    expect(ids("11.2")[0]).toBe("11.1");
  });

  it("names it as the MECHANICAL side — 11.2 carries no engine rule, 11.1 carries eleven", () => {
    expect(siblingCriteria(pack, "11.2")[0]).toMatchObject({ id: "11.1", role: "mechanical" });
  });

  it("pairs 8.5 and 8.6 — same success criterion, one asks existence, the other relevance", () => {
    expect(ids("8.6")).toEqual(["8.5"]);
    expect(siblingCriteria(pack, "8.6")[0]?.role).toBe("mechanical");
  });

  it("works in the other direction: from 11.1, the judgment neighbour is 11.2", () => {
    expect(siblingCriteria(pack, "11.1").find((s) => s.id === "11.2")?.role).toBe("judgment");
  });

  it("carries the neighbour's plain title — the wording is what makes the split legible", () => {
    expect(siblingCriteria(pack, "11.2")[0]?.title).toMatch(/étiquette/i);
  });
});

describe("the neighbourhood stays bounded — a reading aid, never a wall", () => {
  it("never lists more than three", () => {
    for (const c of pack.criteria) expect(siblingCriteria(pack, c.id).length, c.id).toBeLessThanOrEqual(3);
  });

  it("never crosses a theme — RGAA 1.1.1 maps onto 19 criteria, and that is not a neighbourhood", () => {
    for (const c of pack.criteria) {
      for (const s of siblingCriteria(pack, c.id)) {
        expect(pack.criteria.find((x) => x.id === s.id)?.theme, `${c.id} → ${s.id}`).toBe(c.theme);
      }
    }
  });

  it("pairs only ACROSS the mechanical/judgment split — two mechanical criteria are not a pair", () => {
    const mechanical = (id: string) => {
      const c = pack.criteria.find((x) => x.id === id)!;
      return !c.judgment && (c.appliesTo?.ruleIds ?? []).length > 0;
    };
    for (const c of pack.criteria) {
      for (const s of siblingCriteria(pack, c.id)) expect(mechanical(s.id), `${c.id} → ${s.id}`).not.toBe(mechanical(c.id));
    }
  });

  it("returns nothing for a criterion with no neighbour, and for an unknown id", () => {
    expect(siblingCriteria(pack, "12.8")).toEqual([]);
    expect(siblingCriteria(pack, "99.9")).toEqual([]);
  });
});

const item = (criteriaId: string): AdjudicationItem => ({
  criteriaId,
  automatability: "judgment",
  title: "critère sous test",
  evidence: [{ file: "page.html", line: 1, selector: "input#email", snippet: '<input id="email">' }],
  verdict: null,
  justification: "",
  reason: "",
  findings: [],
  decidedBy: "agent",
});

// THE NEIGHBOURHOOD IS A READING AID; THE PRESUPPOSITION IS A CLAIM.
//
// `siblingCriteria` names up to three candidates and asserts nothing about which question
// comes first — right for a brief a model reads, wrong for a gate that refuses findings. The
// fold used the first for the second and refused RGAA 11.4 on a radio the engine had ruled
// 11.5 non-conformant, as though an ungrouped group had no labels left to place.
describe("presupposedCriterion answers only where the pack singles ONE neighbour out", () => {
  it("keeps 11.2 → 11.1: two shared success criteria against 11.5's and 11.6's one", () => {
    expect(presupposedCriterion(pack, "11.2")).toMatchObject({ id: "11.1", role: "mechanical" });
  });

  it("keeps 8.6 → 8.5, the pair with no other candidate at all", () => {
    expect(presupposedCriterion(pack, "8.6")).toMatchObject({ id: "8.5", role: "mechanical" });
  });

  it("stands down on 11.4, whose three neighbours are equidistant", () => {
    expect(ids("11.4")).toEqual(["11.1", "11.5", "11.6"]);
    expect(presupposedCriterion(pack, "11.4")).toBeUndefined();
  });

  it("never answers for a criterion the engine can fail itself, nor for an unknown id", () => {
    expect(presupposedCriterion(pack, "11.1")).toBeUndefined();
    expect(presupposedCriterion(pack, "99.9")).toBeUndefined();
  });

  it("only ever names a mechanical neighbour, and one the neighbourhood also lists", () => {
    for (const c of pack.criteria) {
      const p = presupposedCriterion(pack, c.id);
      if (!p) continue;
      expect(p.role, c.id).toBe("mechanical");
      expect(ids(c.id), c.id).toContain(p.id);
    }
  });
});

describe("the brief states it, in the standard's own words", () => {
  const brief = (id: string, lang: "fr" | "en" = "fr") => formatAdjudication([item(id)], lang, "rgaa", { preamble: false });

  it("names the neighbour and its id", () => {
    const md = brief("11.2");
    expect(md).toMatch(/11\.1/);
    expect(md).toMatch(/pertinen/i); // this criterion's own question
  });

  it("says an absence belongs to the neighbour, not here", () => {
    expect(brief("11.2")).toMatch(/11\.1/);
    expect(brief("8.6")).toMatch(/8\.5/);
  });

  it("renders in English too", () => {
    expect(brief("11.2", "en")).toMatch(/11\.1/);
  });

  it("emits nothing at all for a criterion with no neighbour", () => {
    const md = brief("12.8");
    expect(md).not.toMatch(/Voisinage|Neighbouring/);
  });
});

describe("a definition is read before the wording that uses it", () => {
  it("puts the glossary ahead of the numbered tests", () => {
    // RGAA 5.1 turns entirely on what « tableau de données complexe » means — a table whose
    // headers are NOT laid out on the first row and/or first column alone. Haiku read the
    // definition inside out and declared a table complex for meeting the SIMPLE case. The
    // definition cannot sit below the test that depends on it.
    const md = formatAdjudication([item("5.1")], "fr", "rgaa", { preamble: false });
    const glossary = md.indexOf("tableau de données complexe");
    const tests = md.indexOf("`5.1.1`");
    expect(glossary, "the glossary term is not rendered at all").toBeGreaterThan(-1);
    expect(tests, "the numbered tests are not rendered at all").toBeGreaterThan(-1);
    expect(glossary).toBeLessThan(tests);
  });
});

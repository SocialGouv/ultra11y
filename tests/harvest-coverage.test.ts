import { describe, expect, it } from "vitest";

import { PACK_SUBJECTS, SC_SUBJECTS, SUBJECTS } from "../src/adjudicate-subjects.js";
import { allSC } from "../src/wcag.js";
import { loadPack } from "../src/standards/index.js";

// THE KEYSTONE, and the mirror of the one in data-integrity-adjudication.test.ts.
//
// That test refuses to let a criterion reach the agent without a stated DECISION RULE, on the
// grounds that a criterion handed over with no rule is where an audit quietly becomes an
// opinion. This one refuses the other half: a criterion handed over with nothing to LOOK AT.
//
// It is not hypothetical. Measured on a real 338-file audit before this table existed, 36 of
// the 90 open RGAA criteria arrived with `evidence: []` — and the fold refuses a `C` on an
// empty set, so those 36 could only ever come back « à évaluer », whatever the adjudicator
// did. Presence of a subject is the structural property that keeps that from returning.
//
// What this test does NOT prove is AIM: that a subject collects the right elements. Aim is
// reviewed criterion by criterion against the `Ask` questions in src/data/adjudication.json.

describe("every criterion the engine hands over has something to look at", () => {
  it("names at least one subject for every non-static success criterion", () => {
    const missing = allSC()
      .filter((c) => c.automatability !== "static")
      .map((c) => c.sc)
      .filter((sc) => !(SC_SUBJECTS[sc] ?? []).length);
    expect(missing, `success criteria with no harvest subject: ${missing.join(", ")}`).toEqual([]);
  });

  it("names only subjects that exist", () => {
    const unknown = new Set<string>();
    for (const ids of Object.values(SC_SUBJECTS)) for (const id of ids) if (!SUBJECTS[id]) unknown.add(id);
    for (const byCriterion of Object.values(PACK_SUBJECTS))
      for (const ids of Object.values(byCriterion)) for (const id of ids) if (!SUBJECTS[id]) unknown.add(id);
    expect([...unknown], "subject ids referenced but not implemented").toEqual([]);
  });

  it("keys pack overrides on criteria the pack actually has", () => {
    for (const [standard, byCriterion] of Object.entries(PACK_SUBJECTS)) {
      const pack = loadPack(standard as Parameters<typeof loadPack>[0]);
      const known = new Set(pack.criteria.map((c) => c.id));
      const strays = Object.keys(byCriterion).filter((id) => !known.has(id));
      expect(strays, `${standard} overrides criteria it does not define: ${strays.join(", ")}`).toEqual([]);
    }
  });

  it("resolves a subject for every pack criterion, through its override or its mapped SCs", () => {
    // The union path is what most pack criteria take, and it inherits the gap above: a pack
    // criterion whose mapped success criteria have no subject has none either. RGAA 8.1 is the
    // case that forces the override table to exist at all — it maps onto the removed WCAG
    // 4.1.1, so there is no success criterion to inherit from and the pack is the only place
    // its subject (the doctype) can be named.
    for (const standard of ["rgaa"] as const) {
      const pack = loadPack(standard);
      const bare: string[] = [];
      for (const pc of pack.criteria) {
        const own = PACK_SUBJECTS[standard]?.[pc.id];
        if (own?.length) continue;
        const inherited = (pc.wcag ?? []).flatMap((sc) => SC_SUBJECTS[sc] ?? []);
        if (!inherited.length) bare.push(pc.id);
      }
      expect(bare, `${standard} criteria that would arrive with an empty worklist: ${bare.join(", ")}`).toEqual([]);
    }
  });
});

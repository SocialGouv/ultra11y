import { describe, it, expect } from "vitest";
import { ALL_RULES, ruleIds } from "../src/rules/registry.js";
import { allSC, getSC } from "../src/wcag.js";

describe("rule registry ↔ WCAG dataset coverage", () => {
  it("registers 75 rules with unique ids", () => {
    expect(ALL_RULES.length).toBe(75);
    expect(new Set(ruleIds()).size).toBe(75);
  });

  it("every rule maps only to real WCAG SCs, never to the removed 4.1.1", () => {
    for (const r of ALL_RULES) {
      expect(r.criteria.length).toBeGreaterThan(0);
      for (const c of r.criteria) {
        expect(getSC(c), `${r.id} → ${c}`).toBeDefined();
        expect(c, `${r.id} maps to the removed 4.1.1 Parsing`).not.toBe("4.1.1");
      }
    }
  });

  it("every ruleId in the dataset is a registered rule (no dangling mapping)", () => {
    const registered = new Set(ruleIds());
    for (const c of allSC()) {
      for (const rid of c.ruleIds) expect(registered.has(rid), `${c.sc} cites unknown rule ${rid}`).toBe(true);
    }
  });

  it("every registered rule is referenced by the dataset (no orphan rule)", () => {
    const cited = new Set(allSC().flatMap((c) => c.ruleIds));
    for (const r of ALL_RULES) expect(cited.has(r.id), `rule ${r.id} is not cited by any SC`).toBe(true);
  });

  it("rule.criteria and dataset ruleIds agree both ways", () => {
    // if an SC lists a rule, that rule must list the SC (split-SC rules appear under both)
    for (const c of allSC()) {
      for (const rid of c.ruleIds) {
        const r = ALL_RULES.find((x) => x.id === rid)!;
        expect(r.criteria, `${rid} should cover ${c.sc}`).toContain(c.sc);
      }
    }
    // every static SC has at least one rule (non-static may carry a definite-NC rule)
    for (const c of allSC()) {
      if (c.automatability === "static") expect(c.ruleIds.length, c.sc).toBeGreaterThan(0);
    }
  });
});

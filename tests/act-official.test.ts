// Conformance against the OFFICIAL W3C ACT-Rules Community Group corpus
// (scripts/vendor/act-testcases.json, refreshed by scripts/build-act-corpus.mjs).
//
// This is the engine's only externally-authored yardstick. The scoring contract lives in
// src/act.ts; these tests pin the two properties that must never regress:
//
//   • PRECISION is absolute — a `passed` or `inapplicable` example must never be reported
//     as failing by a rule that claims to test it. A false positive here is a real bug.
//   • RECALL is a ratchet — the number of `failed` examples caught may go up, never down.
//
// Rules the engine cannot decide from source are declared `rendered` / `judgment` in the
// mapping and are NOT scored; the map is drift-gated so a new upstream rule cannot slip
// in unclassified.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ACT_RULES, evaluateAct, type ActTestcase } from "../src/act.js";
import { ruleIds } from "../src/rules/registry.js";

const snapshot = JSON.parse(readFileSync(new URL("../scripts/vendor/act-testcases.json", import.meta.url), "utf8")) as {
  rules: number;
  testcases: ActTestcase[];
};
const results = evaluateAct(snapshot.testcases);
const scored = results.filter((r) => r.verdict !== "not-scored");

describe("ACT corpus — integrity of the vendored snapshot", () => {
  it("holds the whole published corpus", () => {
    expect(snapshot.testcases.length).toBeGreaterThan(1000);
    expect(new Set(snapshot.testcases.map((t) => t.ruleId)).size).toBe(snapshot.rules);
    for (const tc of snapshot.testcases) expect(tc.html.length, `${tc.ruleId}/${tc.testcaseId} has no HTML`).toBeGreaterThan(0);
  });

  it("classifies every upstream rule — no rule slips in unclassified", () => {
    const upstream = [...new Set(snapshot.testcases.map((t) => t.ruleId))].sort();
    const classified = Object.keys(ACT_RULES).sort();
    expect(
      upstream.filter((id) => !classified.includes(id)),
      "new ACT rules to classify in src/act.ts",
    ).toEqual([]);
    expect(
      classified.filter((id) => !upstream.includes(id)),
      "ACT rules classified here but gone upstream",
    ).toEqual([]);
  });

  it("maps only engine rules that actually exist", () => {
    const known = new Set(ruleIds());
    for (const [actId, m] of Object.entries(ACT_RULES)) {
      for (const r of m.engineRules) expect(known.has(r), `${actId} maps to unknown engine rule "${r}"`).toBe(true);
    }
  });

  it("never claims a mapping for a non-static scope", () => {
    for (const [actId, m] of Object.entries(ACT_RULES)) {
      if (m.scope !== "static") expect(m.engineRules, `${actId} is ${m.scope} yet maps engine rules`).toEqual([]);
    }
  });
});

describe("ACT corpus — precision (absolute)", () => {
  it("reports NOTHING on a passed/inapplicable example of a rule it claims", () => {
    const offenders = results
      .filter((r) => r.falsePositives.length)
      .map((r) => `${r.ruleId} ${r.ruleName}: ${r.falsePositives.map((fp) => `${fp.testcaseId.slice(0, 8)} [${fp.ruleIds.join(",")}]`).join(", ")}`);
    expect(offenders, "false positives against third-party HTML").toEqual([]);
  });

  it("has no inconsistent rule", () => {
    expect(
      results.filter((r) => r.verdict === "inconsistent").map((r) => r.ruleId),
      "a rule is inconsistent only when it produced a false positive",
    ).toEqual([]);
  });
});

// A ratchet, not a target: raise these when a new rule lands, never lower them. They are
// COUNTS, not percentages, so the gate cannot be gamed by dropping a mapping — narrowing
// coverage lowers the count and fails just as loudly as a recall regression.
const RATCHET = {
  scoredRules: 32, // ACT rules with at least one mapped engine rule
  cleanRules: 6, // of those, consistent or divergent-with-a-reason (i.e. no missed failure)
  caughtFailures: 103, // `failed` examples caught across all scored rules
  cleanCases: 291, // `passed`/`inapplicable` examples checked and left alone
};

describe("ACT corpus — recall (ratchet)", () => {
  it(`scores at least ${RATCHET.scoredRules} ACT rules`, () => {
    expect(scored.length).toBeGreaterThanOrEqual(RATCHET.scoredRules);
  });

  it(`catches every failed example of at least ${RATCHET.cleanRules} rules`, () => {
    const clean = scored.filter((r) => r.verdict === "consistent" || r.verdict === "divergent");
    expect(clean.length, `clean: ${clean.map((r) => r.ruleId).join(", ")}`).toBeGreaterThanOrEqual(RATCHET.cleanRules);
  });

  it(`catches at least ${RATCHET.caughtFailures} failed examples`, () => {
    const caught = scored.reduce((n, r) => n + r.caught, 0);
    expect(caught).toBeGreaterThanOrEqual(RATCHET.caughtFailures);
  });

  it(`checks at least ${RATCHET.cleanCases} clean examples (the precision claim's denominator)`, () => {
    expect(scored.reduce((n, r) => n + r.clean, 0)).toBeGreaterThanOrEqual(RATCHET.cleanCases);
  });

  it("gives every documented divergence a reason", () => {
    for (const r of results) for (const d of r.divergences) expect(d.reason, `${r.ruleId}/${d.testcaseId} diverges with no reason`).toBeTruthy();
  });

  it("names every declared gap so the to-do list stays visible", () => {
    const gaps = results.filter((r) => r.mapping.gap);
    // Not an assertion about the count — just that a gap always carries a reason, so the
    // matrix can never say "not covered" without saying why.
    for (const g of gaps) expect(g.mapping.note, `${g.ruleId} is a gap with no explanation`).toBeTruthy();
  });
});

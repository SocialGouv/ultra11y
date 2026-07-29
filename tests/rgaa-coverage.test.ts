// COVERAGE RATCHET for the RGAA pack, in the style of tests/act-official.test.ts.
//
// "How many RGAA criteria can the engine actually evidence?" is the number the rendered tier
// exists to move. Pinning it here means the answer is measured, not claimed — and that it can
// only go UP: a refactor that silently unmaps a criterion fails CI instead of quietly
// shrinking the audit.
//
// The floor is deliberately a `toBeGreaterThanOrEqual`, not an equality: adding rules should
// never be blocked by a test, only removing coverage should.
import { describe, it, expect } from "vitest";
import { loadPack } from "../src/standards/index.js";
import { ruleIds } from "../src/rules/registry.js";
import { crossRuleIds } from "../src/rules/cross-registry.js";
import { getSC } from "../src/wcag.js";

const pack = loadPack("rgaa");
const withRules = pack.criteria.filter((c) => (c.appliesTo?.ruleIds.length ?? 0) > 0);

// Measured before the rendered tier landed: 43 of 106. Raise this line when coverage grows;
// never lower it.
const FLOOR = 48;

describe("how much of RGAA the engine can evidence", () => {
  it(`maps at least ${FLOOR} of the ${pack.criteria.length} criteria onto an engine rule`, () => {
    expect(withRules.length).toBeGreaterThanOrEqual(FLOOR);
  });

  it("keeps the floor honest — the constant must not drift above what is real", () => {
    expect(FLOOR).toBeLessThanOrEqual(withRules.length);
  });

  it("reports coverage per theme, so a gap is visible rather than averaged away", () => {
    const byTheme = new Map<number, { covered: number; total: number }>();
    for (const c of pack.criteria) {
      const t = byTheme.get(c.theme) ?? { covered: 0, total: 0 };
      t.total++;
      if ((c.appliesTo?.ruleIds.length ?? 0) > 0) t.covered++;
      byTheme.set(c.theme, t);
    }
    expect(byTheme.size).toBe(pack.themes.length);
    // Every theme must be accounted for; several are legitimately at zero (multimedia needs
    // a human to watch the video), and that must stay VISIBLE, not be rounded away.
    for (const [theme, t] of byTheme) expect(t.total, `theme ${theme}`).toBeGreaterThan(0);
  });
});

describe("the mapping is real, not aspirational", () => {
  it("cites only rules the engine actually ships", () => {
    // The static registry plus the cross-file one — both are real engine rules; only the
    // dynamic-tier ids (axe:*, dyn-*) and declarative pack rules come from elsewhere.
    const registered = new Set([...ruleIds(), ...crossRuleIds()]);
    for (const c of withRules) {
      for (const rid of c.appliesTo?.ruleIds ?? []) {
        if (rid.startsWith("axe:") || rid.startsWith("dyn-") || rid.startsWith("pack:")) continue;
        expect(registered.has(rid), `RGAA ${c.id} cites unknown rule ${rid}`).toBe(true);
      }
    }
  });

  it("only attaches a rule to a criterion they genuinely share a success criterion with", () => {
    for (const c of withRules) {
      for (const sc of c.wcag) expect(getSC(sc) ?? sc === "4.1.1", `RGAA ${c.id} → WCAG ${sc}`).toBeTruthy();
    }
  });
});

describe("the rendered tier's own contribution", () => {
  const has = (id: string, rule: string) => pack.criteria.find((c) => c.id === id)?.appliesTo?.ruleIds.includes(rule) ?? false;

  it("makes computed contrast evidence RGAA 3.2 and 10.5", () => {
    expect(has("3.2", "rendered-contrast")).toBe(true);
    expect(has("10.5", "rendered-contrast")).toBe(true);
  });

  it("makes screenshot-measured contrast evidence the same criteria — the gradient case", () => {
    expect(has("3.2", "rendered-contrast-pixel")).toBe(true);
    expect(has("10.5", "rendered-contrast-pixel")).toBe(true);
  });

  it("makes RGAA 10.6 decidable at all — it had no rule before", () => {
    expect(has("10.6", "rendered-link-colour-only")).toBe(true);
  });

  it("does NOT also claim 3.1, which would count one colour-only link twice", () => {
    expect(has("3.1", "rendered-link-colour-only")).toBe(false);
  });

  it("adds the two tests the declarative DSL can genuinely decide", () => {
    // The DSL decides one class: "the element exists — is its attribute well-formed?".
    // 11.8.2 (<optgroup> without label) and 8.10.2 (dir value not rtl/ltr/auto) are exactly
    // that. Their sibling tests ("si nécessaire", "est-il pertinent ?") stay the agent's.
    expect(has("11.8", "pack:rgaa:optgroup-without-label")).toBe(true);
    expect(has("8.10", "pack:rgaa:dir-value-invalid")).toBe(true);
  });

  it("leaves criteria no rule can evidence alone, rather than forcing a verdict", () => {
    // 8.1 maps only to the REMOVED WCAG 4.1.1: permanently out of the engine's reach.
    expect(pack.criteria.find((c) => c.id === "8.1")?.appliesTo?.ruleIds ?? []).toEqual([]);
    // 13.3 depends on downloadable office documents — nothing in the DOM decides it.
    expect(pack.criteria.find((c) => c.id === "13.3")?.appliesTo?.ruleIds ?? []).toEqual([]);
    // Structurally out of the DSL's reach, and honestly left alone: 11.4 is positional
    // (no sibling/order notion), 10.14 needs CSS :hover rules, 13.2 needs JS semantics,
    // and the whole of theme 12 needs cross-page reasoning runPackRules cannot do.
    for (const id of ["11.4", "10.14", "13.2", "12.1", "12.2", "12.5"]) {
      expect(pack.criteria.find((c) => c.id === id)?.appliesTo?.ruleIds ?? [], `RGAA ${id}`).toEqual([]);
    }
  });
});

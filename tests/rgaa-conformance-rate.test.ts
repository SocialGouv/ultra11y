// THE NUMBER AT THE TOP OF A DELIVERABLE THAT FEEDS A DECLARATION OF ACCESSIBILITY.
//
// egapro's run 33416093626 published « Taux de réussite automatique : 17 % » above a grid
// reading 91 C / 10 NC / 32 NA / 5 à évaluer. Both are arithmetically correct — 17 % is
// `packConformancePct`, which counts only the conformities NO agent ruled on (2 out of 12) —
// and the headline is still not defensible: a reader takes away 17 % from a document whose own
// table says nine tenths of the criteria pass.
//
// The formula a French declaration may reproduce is fixed by the state and is not either of
// those: « critères validés ÷ critères APPLICABLES », the non-applicable ones excluded from the
// denominator (accessibilite.numerique.gouv.fr / obligations / évaluation de conformité).
// Here: (91 − 32) ÷ (106 − 32) = 59 ÷ 74 ≈ 80 %.
//
// Three properties follow, and each is a way to publish a wrong number:
//   • NA leaves the DENOMINATOR — it never was a fourth column here, so it has to be
//     subtracted from both halves rather than ignored;
//   • the rate is PROVISIONAL while criteria are open, because an open criterion sits in the
//     denominator and not in the numerator: the number can only go up;
//   • the formula is NAMED beside the number, so nobody has to guess which of the three it is.
import { describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { conformanceRate, renderPackReport, reportTotals } from "../src/report.js";
import { checkReport } from "../src/check.js";
import { loadPack } from "../src/standards/index.js";

const FIX = new URL("./fixtures/", import.meta.url).pathname;
const audit = runAudit({ inputs: [`${FIX}non-conforming/bad.html`] });

describe("the official RGAA formula", () => {
  it("excludes the non-applicable criteria from BOTH halves", () => {
    // egapro's own numbers.
    expect(conformanceRate({ c: 91, nc: 10, na: 32, manual: 5 })).toEqual({
      pct: 80,
      validated: 59,
      applicable: 74,
      na: 32,
      open: 5,
      decided: 101,
      total: 106,
    });
  });

  it("is provisional exactly while a criterion is open", () => {
    expect(conformanceRate({ c: 91, nc: 10, na: 32, manual: 5 }).open).toBe(5);
    expect(conformanceRate({ c: 96, nc: 10, na: 32, manual: 0 }).open).toBe(0);
  });

  it("says 100 % rather than dividing by zero when nothing is applicable", () => {
    expect(conformanceRate({ c: 40, nc: 0, na: 40, manual: 0 }).pct).toBe(100);
  });
});

describe("the pack report leads with it", () => {
  const md = renderPackReport(audit, loadPack("rgaa"), "fr");
  const t = reportTotals([]);

  it("prints the conformity rate, its formula and its two operands", () => {
    expect(md).toMatch(/Taux de conformité RGAA/);
    expect(md).toMatch(/critères validés ÷ critères applicables/);
    expect(md).toMatch(/\(\d+ ÷ \d+\)/);
  });

  it("says the rate is provisional while criteria are open", () => {
    expect(md).toMatch(/provisoire/i);
  });

  it("separates C, NC, NA and « à évaluer » in a decided count", () => {
    expect(md).toMatch(/\*\*Décidés\*\* : \d+\/\d+/);
  });

  it("names where the decisions came from", () => {
    expect(md).toMatch(/Provenance des décisions/);
  });

  it("keeps the automatic rate, with its own numerator and denominator, below the headline", () => {
    const headline = md.indexOf("Taux de conformité RGAA");
    const automatic = md.indexOf("Taux de réussite automatique");
    expect(headline).toBeGreaterThan(-1);
    expect(automatic).toBeGreaterThan(headline);
    expect(md.slice(automatic, automatic + 200)).toMatch(/\(\d+ ÷ \d+\)/);
  });

  it("does the same in English", () => {
    const en = renderPackReport(audit, loadPack("rgaa"), "en");
    expect(en).toMatch(/RGAA 4\.1\.2 conformity rate/);
    expect(en).toMatch(/validated criteria ÷ applicable criteria/);
  });

  // The core WCAG report is a different document with a different audience, and the plan
  // changes the country-standard deliverable only. Pinned so the change cannot leak.
  it("leaves the core WCAG report's headline alone", () => {
    expect(reportTotals([])).toEqual(t);
  });
});

describe("`check` verifies every rate it finds against the synthesis table", () => {
  it("accepts a pack report whose two rates both follow from the grid", () => {
    const md = renderPackReport(audit, loadPack("rgaa"), "fr");
    const r = checkReport(md, "rgaa", "fr");
    expect(r.issues.filter((i) => /[Tt]aux/.test(i))).toEqual([]);
  });

  it("rejects a headline rate that does not follow from it", () => {
    const md = renderPackReport(audit, loadPack("rgaa"), "fr").replace(/(Taux de conformité RGAA[^\n]*?: )\d+%/, "$199%");
    expect(checkReport(md, "rgaa", "fr").issues.some((i) => /[Tt]aux/.test(i))).toBe(true);
  });
});

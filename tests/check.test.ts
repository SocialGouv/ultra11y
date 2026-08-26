import { describe, it, expect } from "vitest";
import { runAudit } from "../src/audit.js";
import { renderReport, renderPackReport } from "../src/report.js";
import { mergeDynamic } from "../src/scan.js";
import { checkReport } from "../src/check.js";
import { registerRuntimePack, loadPack } from "../src/standards/index.js";

const FIX = new URL("./fixtures/", import.meta.url).pathname;
const bad = runAudit({ inputs: [`${FIX}non-conforming/bad.html`] });
const validReport = renderReport(bad, "fr");

const BROKEN = `# Rapport d'audit
- **Taux de réussite automatique** : 50%

## 1. Synthèse par règle WCAG
| Règle | C |
|---|---|

## 2. Non-conformités (par priorité)
- **9.9.9 — Invented criterion** — \`x.html:1\` (\`div\`)
  - une non-conformité hallucinée

## 4. Critères non applicables (NA)
- 1.4.5 — Images of Text

## 5. Critères à évaluer manuellement
- 1.4.3 — Contrast — _à vérifier_
`;

describe("checkReport", () => {
  it("passes a well-formed WCAG report", () => {
    const r = checkReport(validReport);
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  // Task 5 (Phase 4): §2 now renders one auditor block per NC criterion instead of a
  // flat per-finding bullet — confirm the citation regex still recognizes every real
  // criterion in that new shape, for BOTH the core report and a derived pack report.
  it("passes a freshly-generated WCAG report in English too (new auditor-block NC shape)", () => {
    const r = checkReport(renderReport(bad, "en"), "wcag", "en");
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it("passes a freshly-generated RGAA pack report (new auditor-block NC shape, pack vocabulary)", () => {
    const rgaaReport = renderPackReport(bad, loadPack("rgaa"), "fr");
    const r = checkReport(rgaaReport, "rgaa", "fr");
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  // Task 5: an RGAA report with no merged scan carries the partial-audit banner in its
  // header. The banner (a blockquote with no criterion-shaped token) must not trip the
  // structural gate — the report still passes, in fr and en.
  it("passes an RGAA report carrying the partial-audit banner", () => {
    const fr = renderPackReport(bad, loadPack("rgaa"), "fr");
    expect(fr).toContain("Audit partiel");
    expect(checkReport(fr, "rgaa", "fr").ok).toBe(true);
    const en = renderPackReport(bad, loadPack("rgaa"), "en");
    expect(en).toContain("Partial audit");
    expect(checkReport(en, "rgaa", "en").ok).toBe(true);
  });

  // Task 2: the report's §2 now embeds the full ticket template (Priorité, Partie technique,
  // Contexte de reproduction). Those extra sections + a served-URL reproduction block must
  // NOT trip the structural gate (no fabricated criterion refs, sections 1–5 intact).
  it("passes a simplified report while keeping technical ticket detail out of the conformance artifact", () => {
    const dynAudit = mergeDynamic(runAudit({ inputs: [`${FIX}conforming/good.html`] }), {
      tool: "ultra11y",
      engine: "axe-core@playwright (docker)",
      target: "https://exemple.fr",
      date: bad.date,
      findings: [
        {
          criteriaId: "1.4.10",
          axeRule: "reflow",
          impact: "serious",
          severity: "majeur",
          message: "Horizontal scrolling at 320px width",
          selector: "document",
          snippet: "",
          engine: "reflow",
          page: "https://exemple.fr/profil",
        },
      ],
    });
    const md = renderReport(dynAudit, "en");
    expect(md).not.toContain("Technical details");
    expect(md).not.toContain("Reproduction context");
    const r = checkReport(md, "wcag", "en");
    expect(r.ok, r.issues.join("\n")).toBe(true);
  });

  it("flags a missing section, an invented SC, and an unjustified NA", () => {
    const r = checkReport(BROKEN);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes("Section 3"))).toBe(true);
    expect(r.issues.some((i) => i.includes("9.9.9"))).toBe(true);
    expect(r.issues.some((i) => i.includes("1.4.5"))).toBe(true);
  });

  it("flags a fabricated criterion cited WITHOUT an em-dash title (bare auditor-block shape)", () => {
    // A non-existent criterion renders its heading, its "**Success criterion** :" line and
    // its "**WCAG** :" line WITHOUT a title (the title lookup fails) — so an em-dash-only
    // anchor is blind to it by construction. check must still reject it.
    const bareFab = `# Accessibility audit report — WCAG 2.2 Level AA
- **Automatic static-check pass rate** : 50%

## 1. Synthesis by WCAG guideline
x

## 2. Non-conformities (by priority)

#### 🔴 9.9.9

> Auditor view — WCAG 2.2 AA. Normative mapping.

**Success criterion** : 9.9.9
**WCAG** : 9.9.9

**Finding (Fail)** : 1 occurrence(s) — Fabricated.

## 3. x
## 4. x
## 5. x
`;
    const r = checkReport(bareFab, "wcag", "en");
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes("9.9.9"))).toBe(true);
  });

  it("still passes a real criterion cited without an em-dash on its WCAG line", () => {
    // Guard the fix against over-reach: a real SC on a bare **WCAG** : line must NOT be flagged.
    const realBare = `# Report — WCAG 2.2 Level AA
- **Rate** : 50%
## 1. x
## 2. y

#### 🔴 1.4.3

**Success criterion** : 1.4.3
**WCAG** : 1.4.3

## 3. x
## 4. x
## 5. x
`;
    const r = checkReport(realBare, "wcag", "en");
    expect(r.issues.some((i) => i.includes("1.4.3"))).toBe(false);
  });

  it("flags a pass rate outside 0–100", () => {
    const tampered = validReport.replace(/:\s*\d+(?:[.,]\d+)?\s*%/, ": 999%");
    const r = checkReport(tampered);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes("999") || i.toLowerCase().includes("range") || i.toLowerCase().includes("born"))).toBe(true);
  });

  // A header rate must be ARITHMETICALLY consistent with the report's own C/NC synthesis
  // Total row — not just present and in-range. A report that claims "99%" while its table
  // implies 1 ÷ (1 + 5) = 17% is lying, and `check` must catch it.
  const RATE_REPORT = (headerPct: number) => `# Accessibility audit report — WCAG 2.2 Level AA
- **Automatic static-check pass rate** : ${headerPct}% (machine-decidable subset: C ÷ (C + NC))

## 1. Synthesis by WCAG guideline
| WCAG guideline | C | NC | NA | To assess |
|---|---|---|---|---|
| 1. Perceivable | 1 | 5 | 0 | 0 |
| **Total** | **1** | **5** | **0** | **0** |

## 2. Non-conformities (by priority)
No non-conformity detected by the static engine.

## 3. Conforming criteria (C)
- 1.1.1 — Non-text Content

## 4. Not-applicable criteria (NA)
None.

## 5. Criteria to adjudicate
None.
`;

  it("fails when the header pass rate contradicts its own C/NC synthesis totals", () => {
    const r = checkReport(RATE_REPORT(99), "wcag", "en"); // table implies 17%, header says 99%
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.toLowerCase().includes("rate") && (i.includes("99") || i.includes("17")))).toBe(true);
  });

  it("passes when the header pass rate matches the synthesis totals (17%)", () => {
    const r = checkReport(RATE_REPORT(17), "wcag", "en"); // 1 ÷ 6 = 17%
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it("gates a derived pack report against the pack's own 2-segment ids", () => {
    const rgaaReport = `# Rapport — RGAA 4.1.2
- **Taux** : 50%
## 1. x
## 2. y
- **RGAA 8.3 — Langue** — \`a.html:1\` (\`html\`)
  - manquant
## 3. z
## 4. NA
- RGAA 9.9 — invented — _x_
## 5. manual
`;
    const r = checkReport(rgaaReport, "rgaa");
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes("9.9"))).toBe(true); // 9.9 is not a real RGAA id
  });

  it("gates a pack report by the PACK'S OWN idPattern grammar, not a fixed 2-segment shape (e.g. Section 508 E205.4)", () => {
    registerRuntimePack({
      key: "synth508check",
      name: "Synth508",
      org: "O",
      country: "US",
      baseVersion: "1",
      wcagVersion: "2.2",
      locales: ["en"],
      defaultLocale: "en",
      license: "x",
      source: "x",
      attribution: "x",
      idPattern: "^E\\d+\\.\\d+$",
      themes: [{ number: 1, name: { en: "Interface" }, count: 1 }],
      criteria: [{ id: "E205.4", theme: 1, title: { en: "Focus Visible" }, titlePlain: { en: "Focus Visible" }, wcag: ["2.4.7"] }],
    });
    const md = `# Report — Synth508 1
- **Rate** : 50%
## 1. x
## 2. y
- **E205.4 — Focus Visible** — \`a.html:1\` (\`a\`)
  - missing
## 3. z
## 4. NA
- E999.9 — invented — _x_
## 5. manual
`;
    const r = checkReport(md, "synth508check");
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes("E999.9"))).toBe(true); // fabricated id
    expect(r.issues.some((i) => i.includes("E205.4"))).toBe(false); // real criterion recognized
  });
});

// ---- check --semantic (family P0-2/P0-3): the semantic gate must ENGAGE or FAIL — never
// exit green while silently inactive, and a passing verdict must be re-grounded in source. ----
import { mkdtempSync, writeFileSync as wf } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSemantic } from "../src/check.js";
import { buildWorklist } from "../src/verify.js";

function tmpReport(): { dir: string; reportPath: string; md: string } {
  const dir = mkdtempSync(join(tmpdir(), "u11y-sem-"));
  const reportPath = join(dir, "wcag-report.md");
  wf(reportPath, validReport);
  return { dir, reportPath, md: validReport };
}

describe("checkSemantic", () => {
  it("fails closed when no verdicts artifact exists next to the report (never green-but-inactive)", () => {
    const { reportPath, md } = tmpReport();
    const r = checkSemantic(md, { reportPath });
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n").toLowerCase()).toMatch(/verify|verdict/);
  });

  it("fails on an unadjudicated / truncated verdicts file (coverage gap)", () => {
    const { dir, reportPath, md } = tmpReport();
    const items = buildWorklist(md, "wcag", Number.POSITIVE_INFINITY);
    // Adjudicate all but one, and drop the last item entirely: both must fail the gate.
    const filled = items.map((it, i) => ({ ...it, verdict: i === 0 ? null : "supported" })).slice(0, -1);
    wf(join(dir, "VERIFY.todo.json"), JSON.stringify(filled));
    const r = checkSemantic(md, { reportPath });
    expect(r.ok).toBe(false);
  });

  it("fails when a supported verdict cites content the source file does not contain", () => {
    const { dir, reportPath, md } = tmpReport();
    const items = buildWorklist(md, "wcag", Number.POSITIVE_INFINITY).map((it) => ({ ...it, verdict: "supported" }));
    // Corrupt one citation: point it at a selector/element that exists nowhere in the file.
    items[0] = { ...items[0]!, selector: "video#does-not-exist", snippet: '<video id="does-not-exist">' } as never;
    wf(join(dir, "VERIFY.todo.json"), JSON.stringify(items));
    const r = checkSemantic(md, { reportPath });
    expect(r.ok).toBe(false);
    expect(r.failed).toBeGreaterThan(0);
  });

  it("passes end-to-end on a genuine audit→report→verify→adjudicate chain", () => {
    const { dir, reportPath, md } = tmpReport();
    const items = buildWorklist(md, "wcag", Number.POSITIVE_INFINITY).map((it) => ({ ...it, verdict: "supported" }));
    wf(join(dir, "VERIFY.todo.json"), JSON.stringify(items));
    const r = checkSemantic(md, { reportPath });
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.total).toBe(items.length);
    expect(r.failed).toBe(0);
  });

  it("honours an explicit --verdicts path over auto-discovery", () => {
    const { dir, reportPath, md } = tmpReport();
    const items = buildWorklist(md, "wcag", Number.POSITIVE_INFINITY).map((it) => ({ ...it, verdict: "supported" }));
    const elsewhere = join(dir, "custom-verdicts.json");
    wf(elsewhere, JSON.stringify(items));
    const r = checkSemantic(md, { reportPath, verdictsPath: elsewhere });
    expect(r.ok).toBe(true);
  });
});

// ---- check --standard rgaa --in <audit.json>: applicability gate (R1) ----
import { renderPackReport as rpr } from "../src/report.js";

describe("checkReport --in (pack applicability gate)", () => {
  const rgaaReport = rpr(bad, loadPack("rgaa"), "fr");
  it("passes a freshly-derived RGAA report against its own audit", () => {
    const r = checkReport(rgaaReport, "rgaa", "fr", { audit: bad });
    expect(r.ok).toBe(true);
  });
  it("fails a hand-edited RGAA report that over-projects an NC onto an inapplicable criterion", () => {
    // Inject a fake NC auditor block for RGAA 1.4 (CAPTCHA) — a criterion the audit
    // never derives as NC. The applicability gate must catch it.
    // Insert INSIDE section 2 (the non-conformity section) — a block after it, e.g. in the
    // Recommendations section, is not an NC projection at all.
    const ncHeading = /^## 2\..*$/m.exec(rgaaReport)![0];
    const tampered = rgaaReport.replace(
      ncHeading,
      `${ncHeading}\n\n#### 🔴 RGAA 1.4 — CAPTCHA\n**Thématique** : 1.\n**Critère** : 1.4 — CAPTCHA\n- [ ] \`x.html:1\` (\`img\`) — bogus\n`,
    );
    const r = checkReport(tampered, "rgaa", "fr", { audit: bad });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes("1.4"))).toBe(true);
  });
  it("does nothing extra without --in (grammar-only, back-compat)", () => {
    expect(checkReport(rgaaReport, "rgaa", "fr").ok).toBe(true);
  });
});

// Advisory (« Recommandation ») findings must be invisible to the check gates: they are
// not NC, so they must not trip the rate-consistency gate (core) nor the NC over/under-
// projection gate (pack). two-h1.html carries an advisory-only 1.3.1 (h1-multiple) and no
// normative NC.
describe("checkReport — advisory findings excluded from the gates", () => {
  const twoH1 = runAudit({ inputs: [`${FIX}egapro-feedback/fp/two-h1.html`] });

  it("has no normative NC yet renders a recommendation for 1.3.1", () => {
    expect(twoH1.criteria.some((c) => c.status === "NC")).toBe(false);
    const md = renderReport(twoH1, "en");
    expect(md).toMatch(/Recommendations \(non-normative\)/);
    expect(md).toMatch(/1\.3\.1/);
  });

  it("the core report passes checkReport (rate-consistency gate not tripped by the advisory)", () => {
    const r = checkReport(renderReport(twoH1, "en"), "wcag", "en");
    expect(r.ok, r.issues.join("\n")).toBe(true);
  });

  it("the derived RGAA report passes the applicability gate (no over/under-projected NC from the advisory)", () => {
    const md = rpr(twoH1, loadPack("rgaa"), "fr");
    const r = checkReport(md, "rgaa", "fr", { audit: twoH1 });
    expect(r.ok, r.issues.join("\n")).toBe(true);
  });
});

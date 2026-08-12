import { describe, it, expect } from "vitest";
import type { AuditResult } from "../src/types.js";
import type { PrdUnit } from "../src/prd.js";
import { renderAuditorUnit, renderAuditorBacklog, renderAuditorPerCriterion } from "../src/auditor.js";
import { vocabularyFor } from "../src/standards/vocabulary.js";

function unit(criteriaId: string, title: string, refs: string[] = []): PrdUnit {
  return {
    criteriaId,
    title,
    label: `${criteriaId} — ${title}`,
    refs,
    severity: "bloquant",
    findings: [
      {
        ruleId: "img-alt-missing",
        criteriaId,
        file: "src/a.tsx",
        line: 3,
        col: 1,
        selectorHint: "img",
        severity: "bloquant",
        message: "image sans alternative",
        remediation: "Ajoutez alt",
        snippet: "<img>",
      },
    ],
  };
}

const AUDIT: AuditResult = {
  tool: "ultra11y",
  standard: "wcag",
  version: "9.9.9",
  schemaVersion: 2,
  date: "2026-06-29",
  scope: { inputs: ["src"], files: 1 },
  guidelines: [],
  criteria: [{ id: "1.1.1", guideline: "1.1", status: "NC", findings: [unit("x", "x").findings[0]!] }],
  findings: [unit("1.1.1", "x").findings[0]!],
  residualRisks: [],
  conformancePct: 50,
};

describe("vocabularyFor", () => {
  it("uses the WCAG core vocabulary for the core standard", () => {
    const v = vocabularyFor("wcag", "en");
    expect(v.criterion).toBe("Success criterion");
    expect(v.test).toBe("Technique");
    expect(v.nonConformant).toBe("Fail");
  });

  it("uses the RGAA pack vocabulary (fr) for --standard rgaa", () => {
    const v = vocabularyFor("rgaa", "fr");
    expect(v.theme).toBe("Thématique");
    expect(v.criterion).toBe("Critère");
    expect(v.nonConformant).toBe("Non conforme (NC)");
    expect(v.auditorHeading).toBe("Critère d’accessibilité");
  });

  it("falls back to the generic default when a standard/term is unknown", () => {
    const v = vocabularyFor("does-not-exist", "fr");
    expect(v.theme).toBe("Thématique"); // generic fr default
    expect(v.criterion).toBe("Critère");
  });
});

describe("renderAuditorUnit", () => {
  it("renders the WCAG core block with core vocabulary + SC level", () => {
    const md = renderAuditorUnit(unit("1.1.1", "Non-text Content"), "wcag", "en").join("\n");
    expect(md).toContain("**Success criterion** : 1.1.1 — Non-text Content");
    expect(md).toContain("**WCAG** : 1.1.1 (A)");
    expect(md).toContain("**Finding (Fail)**");
    expect(md).toContain("**Expected (Pass)** : Ajoutez alt");
    expect(md).toContain("`src/a.tsx:3`");
  });

  it("renders the RGAA pack block with theme, test numbers, and pack vocabulary (fr)", () => {
    const md = renderAuditorUnit(unit("11.6", "Légende", ["1.3.1", "3.3.2"]), "rgaa", "fr").join("\n");
    expect(md).toContain("**Thématique** : 11."); // theme name resolved
    expect(md).toContain("**Critère** : 11.6 — Légende");
    expect(md).toContain("**Test(s)** : 11.6.1"); // test numbers from pack tests
    expect(md).toContain("**WCAG** : 1.3.1 (A) · 3.3.2 (A)"); // per-ref level
    expect(md).toContain("**Constat (Non conforme (NC))**");
    expect(md).toContain("**Attendu (Conforme (C))** : Ajoutez alt");
  });

  it("renders the WCAG core block in French with localized principle/guideline titles (W3C authorized translation)", () => {
    const md = renderAuditorUnit(unit("1.4.3", "Contraste (minimum)"), "wcag", "fr").join("\n");
    expect(md).toContain("**Principe · Règle** : 1 Perceptible · 1.4 Distinguable"); // resolved by lang, not hardcoded English
    expect(md).toContain("**Critère de succès** : 1.4.3 — Contraste (minimum)");
    expect(md).toContain("**WCAG** : 1.4.3 (AA)");
  });

  it("emits a criterion heading only when asked (issue body omits it)", () => {
    expect(renderAuditorUnit(unit("1.1.1", "X"), "wcag", "en", { heading: "###" })[0]).toMatch(/^### /);
    expect(renderAuditorUnit(unit("1.1.1", "X"), "wcag", "en")[0]).toMatch(/^> /); // starts with the normative note
  });

  // The `_rendered capture of …_` origin-attribution line (moved from report.ts's deleted
  // ncEntry into this shared block) was untested end to end. Mirrors the origin shape
  // produced by real capture ingestion (see tests/capture.test.ts).
  it("renders the origin-attribution line for a capture-originated finding (component + source file)", () => {
    const u = unit("1.1.1", "Non-text Content");
    u.findings[0]!.origin = { capture: "captures/button-icon.html", sourceFile: "src/Button.tsx", component: "Button" };
    const md = renderAuditorUnit(u, "wcag", "en").join("\n");
    expect(md).toContain("- _rendered capture of `Button` — source `src/Button.tsx`_");
  });

  it("anchors the origin line at the source component's definition line once graph-resolved (origin.sourceLine)", () => {
    const u = unit("1.1.1", "Non-text Content");
    u.findings[0]!.origin = { capture: "captures/button-icon.html", sourceFile: "src/Button.tsx", component: "Button", sourceLine: 12 };
    const md = renderAuditorUnit(u, "wcag", "en").join("\n");
    expect(md).toContain("- _rendered capture of `Button` — source `src/Button.tsx:12`_");
  });

  it("falls back to the finding's own file / capture path when component or sourceFile is unknown", () => {
    const u = unit("1.1.1", "Non-text Content");
    u.findings[0]!.origin = { capture: "captures/storybook-dump.html" };
    const md = renderAuditorUnit(u, "wcag", "en").join("\n");
    expect(md).toContain("- _rendered capture of `src/a.tsx` — source `captures/storybook-dump.html`_");
  });

  it("says nothing rather than 'capture of X — X' when the provenance names no source", () => {
    // A page snapshot whose producer wrote no provenance comment: identity is synthesized from
    // the path, so origin carries the capture file and nothing else — and the finding's own file
    // IS that capture. The line would be tautological.
    const u = unit("1.1.1", "Non-text Content");
    u.findings[0]!.file = ".ultra11y/pages/accueil/dom.html";
    u.findings[0]!.origin = { capture: ".ultra11y/pages/accueil/dom.html" };
    const md = renderAuditorUnit(u, "wcag", "en").join("\n");
    expect(md).not.toContain("rendered capture of");
  });

  it("appends the deviation note for a finding projected via a secondary crosswalk mapping", () => {
    const u = unit("1.1.1", "Non-text Content");
    u.findings[0]!.secondary = { note: "Relève aussi de ce critère selon le référentiel." };
    const md = renderAuditorUnit(u, "wcag", "en").join("\n");
    // The note rides as an inert sub-bullet right after the occurrence checklist line.
    expect(md).toContain("  - ↳ Relève aussi de ce critère selon le référentiel.");
    // Still a parseable occurrence checklist line (the secondary note never replaces it).
    expect(md).toContain("`src/a.tsx:3`");
  });

  it("renders the localized (fr) origin-attribution line", () => {
    const u = unit("1.1.1", "Non-text Content");
    u.findings[0]!.origin = { capture: "captures/button-icon.html", sourceFile: "src/Button.tsx", component: "Button" };
    const md = renderAuditorUnit(u, "wcag", "fr").join("\n");
    expect(md).toContain("- _capture rendue de `Button` — source `src/Button.tsx`_");
  });

  // An advisory unit renders the « Recommandation (non normative) » vocabulary and
  // MUST NOT emit the "**<criterion>** : <id>" colon grammar the verify worklist parser
  // keys on — so it can never enter the non-conformity worklist.
  it("renders an advisory unit with recommendation vocabulary, not the NC criterion-line grammar (fr)", () => {
    const u = { ...unit("1.3.1", "Structuration de l'information"), advisory: true };
    const md = renderAuditorUnit(u, "wcag", "fr").join("\n");
    expect(md).toContain("Recommandation (non normative)");
    expect(md).not.toContain("**Critère de succès** : 1.3.1"); // no NC criterion line
    expect(md).not.toContain("**Constat (Non conforme"); // no NC finding wording
    // The verify worklist parser's criterion-line shape must be absent.
    expect(md).not.toMatch(/^\*\*[^*:]+\*\*\s*:\s*1\.3\.1(?:\s*—.*)?\s*$/m);
  });

  it("renders an advisory unit in English with the non-normative recommendation vocabulary", () => {
    const u = { ...unit("1.3.1", "Info and Relationships"), advisory: true };
    const md = renderAuditorUnit(u, "wcag", "en").join("\n");
    expect(md).toContain("Recommendation (non-normative)");
    expect(md).not.toContain("**Success criterion** : 1.3.1");
  });
});

// Task 2: the unified owner-validated ticket template — Priorité + Partie technique
// (Fichiers / Pages / Changement attendu / Critères d'acceptation / Complexité) + Contexte
// de reproduction — all native in renderAuditorUnit, shared by report/prd/gh.
describe("renderAuditorUnit — unified ticket template (Task 2)", () => {
  it("emits the explicit Priorité line from the severity icon + label", () => {
    expect(renderAuditorUnit(unit("1.1.1", "Non-text Content"), "wcag", "fr").join("\n")).toContain("**Priorité** : 🔴 Bloquant");
    expect(renderAuditorUnit(unit("1.1.1", "Non-text Content"), "wcag", "en").join("\n")).toContain("**Priority** : 🔴 Blocking");
  });

  it("emits Partie technique with impacted files, expected change, acceptance criteria and complexity", () => {
    const md = renderAuditorUnit(unit("1.1.1", "Non-text Content"), "wcag", "fr", { heading: "###" }).join("\n");
    expect(md).toContain("#### Partie technique"); // nested one level below the ### unit heading
    expect(md).toContain("**Fichiers impactés**");
    expect(md).toContain("- `src/a.tsx`");
    expect(md).toContain("**Changement attendu**");
    expect(md).toContain("**Critères d'acceptation**");
    expect(md).toContain("- [ ] **Étant donné**"); // Given/When/Then checkbox, ported from renderPrdDoc
    expect(md).toContain("(WCAG 1.1.1)");
    expect(md).toContain("**Complexité** : S (3 pts)"); // shared effortOf heuristic
  });

  it("clamps the Partie technique heading to #### even under a #### unit heading (verify parser reset)", () => {
    const md = renderAuditorUnit(unit("1.1.1", "Non-text Content"), "wcag", "en", { heading: "####" }).join("\n");
    expect(md).toContain("#### Technical details");
    expect(md).not.toContain("##### Technical details"); // a level-5 heading would not reset the parser
  });

  it("--no-technical (technical:false) suppresses Partie technique + Contexte de reproduction but keeps Priorité", () => {
    const md = renderAuditorUnit(unit("1.1.1", "Non-text Content"), "wcag", "en", { heading: "###", technical: false }).join("\n");
    expect(md).toContain("**Priority** :"); // section 1 stays
    expect(md).toContain("- [ ] `src/a.tsx:3`"); // occurrence checklist stays
    expect(md).not.toContain("Technical details");
    expect(md).not.toContain("Reproduction context");
  });

  it("a mixed unit shows advisory findings in a distinct « Recommandations associées » sub-list, excluded from the NC count", () => {
    const u = unit("1.1.1", "Non-text Content");
    u.findings.push({
      ruleId: "h1-missing",
      criteriaId: "1.1.1",
      file: "src/b.tsx",
      line: 9,
      col: 1,
      selectorHint: "h1",
      severity: "mineur",
      message: "recommandation non normative",
      remediation: "Ajoutez un h1",
      snippet: "<h1>",
      advisory: true,
    });
    const md = renderAuditorUnit(u, "wcag", "fr", { heading: "###" }).join("\n");
    // The NC count reflects ONLY the normative occurrence.
    expect(md).toContain("**Constat (Non conforme)** : 1 occurrence(s)");
    // The advisory rides in a distinct sub-list with a non-checkbox bullet.
    expect(md).toContain("_Recommandations associées (non normatives)_");
    expect(md).toContain("- 💡 `src/b.tsx:9`");
    // …and never in the parseable checklist.
    expect(md).not.toContain("- [ ] `src/b.tsx:9`");
  });

  it("emits Contexte de reproduction for a served URL whose static anchor is unresolved (line 0)", () => {
    const u: PrdUnit = {
      criteriaId: "1.4.10",
      title: "Reflow",
      label: "1.4.10 — Reflow",
      refs: [],
      severity: "majeur",
      findings: [
        {
          ruleId: "dyn-reflow",
          criteriaId: "1.4.10",
          file: "https://exemple.fr/profil",
          line: 0,
          col: 0,
          selectorHint: "document",
          severity: "majeur",
          message: "reflow horizontal",
          remediation: "Corrigez le reflow",
          snippet: "",
        },
      ],
    };
    const md = renderAuditorUnit(u, "wcag", "en", { heading: "###" }).join("\n");
    expect(md).toContain("**Impacted pages / URLs**");
    expect(md).toContain("- `https://exemple.fr/profil`");
    expect(md).toContain("**Reproduction context**");
    expect(md).toContain("authentication required : unknown"); // no Task-5 sample metadata yet → graceful
    expect(md).toContain("required state / steps to reproduce");
    // A URL location is NOT listed under Fichiers impactés.
    expect(md).not.toContain("**Impacted files**");
  });

  it("does NOT emit Contexte de reproduction for ordinary source-file findings (no URL / auth)", () => {
    const md = renderAuditorUnit(unit("1.1.1", "Non-text Content"), "wcag", "en", { heading: "###" }).join("\n");
    expect(md).not.toContain("Reproduction context");
  });
});

describe("renderAuditorBacklog / renderAuditorPerCriterion", () => {
  it("titles the backlog with the standard's auditor heading and sections by severity", () => {
    const md = renderAuditorBacklog(AUDIT, "en", "wcag");
    expect(md).toContain("# Accessibility criterion — WCAG 2.2 AA");
    expect(md).toContain("## 🔴 Blocking (1)");
  });

  it("titles the RGAA backlog in French", () => {
    const md = renderAuditorBacklog(AUDIT, "fr", "rgaa");
    expect(md).toContain("# Critère d’accessibilité — RGAA 4.1.2");
  });

  it("writes one auditor doc per criterion", () => {
    const files = renderAuditorPerCriterion(AUDIT, "en", "wcag");
    expect(files.map((f) => f.name)).toEqual(["prd-1.1.1-2026-06-29.md"]);
    expect(files[0]!.content).toContain("Accessibility criterion");
  });
});

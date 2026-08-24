import { describe, it, expect } from "vitest";
import type { AuditResult } from "../src/types.js";
import type { PrdUnit } from "../src/prd.js";
import { auditorUnitModel, renderAuditorUnit, renderAuditorBacklog, renderAuditorPerCriterion } from "../src/auditor.js";
import { AUDITOR_OCCURRENCE } from "../src/verify.js";
import { vocabularyFor } from "../src/standards/vocabulary.js";

/** A repeated rendered-tier occurrence: one design-system defect, many routes. All of them are
 *  anchored at the same line (a client-rendered DOM serializes onto one line), so `col` is what
 *  distinguishes them — exactly the shape the per-page sheet has to fold. */
function rep(selector: string, col: number) {
  return {
    ruleId: "rendered-link-colour-only",
    criteriaId: "1.4.1",
    file: ".ultra11y/pages/accueil/dom.html",
    line: 2,
    col,
    selectorHint: selector,
    severity: "majeur" as const,
    message: "lien identifié par la couleur seule",
    remediation: "Ajoutez un indice non coloré",
    snippet: "<a>",
  };
}

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
    // …and NOTHING from another referential: the block used to carry
    // « **WCAG** : 1.3.1 (A) · 3.3.2 (A) » here.
    expect(md).not.toMatch(/WCAG/);
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

  it("does not collapse by default — every existing consumer keeps its exact output", () => {
    const u = unit("1.4.1", "Use of Color");
    u.findings = [rep("a.fr-link", 41), rep("a.fr-link", 88), rep("a.fr-link", 120)];
    const md = renderAuditorUnit(u, "wcag", "en").join("\n");
    expect(md).not.toContain("×3");
    expect(md.split("\n").filter((l) => AUDITOR_OCCURRENCE.test(l))).toHaveLength(3);
    // Flush, never indented, when nothing is folded.
    expect(md).not.toMatch(/^ +- \[ \] /m);
  });

  it("folds repeated occurrences of one rule+selector under a counted header when asked", () => {
    const u = unit("1.4.1", "Use of Color");
    u.findings = [rep("a.fr-link", 41), rep("a.fr-link", 88), rep("a.fr-btn", 12)];
    const md = renderAuditorUnit(u, "wcag", "en", { collapse: true }).join("\n");
    expect(md).toContain("· ×2");
    // The lone occurrence is not given a header, and stays flush.
    expect(md).not.toContain("· ×1");
  });

  it("HONESTY: folding changes what is scanned, never what is claimed or adjudicated", () => {
    const u = unit("1.4.1", "Use of Color");
    u.findings = [rep("a.fr-link", 41), rep("a.fr-link", 88), rep("a.fr-link", 120), rep("a.fr-btn", 12)];
    const md = renderAuditorUnit(u, "wcag", "en", { collapse: true }).join("\n");
    // The block still announces the raw occurrence count...
    expect(md).toContain("4 occurrence(s)");
    // ...the group counts still sum to it...
    const sum = [...md.matchAll(/· ×(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
    expect(sum + 1).toBe(4); // the ×3 group plus the ungrouped singleton
    // ...and every occurrence still has its own parseable checkbox line.
    expect(md.split("\n").filter((l) => AUDITOR_OCCURRENCE.test(l))).toHaveLength(4);
  });

  it("keeps a group HEADER out of the verify worklist — one item per finding, never per group", () => {
    const u = unit("1.4.1", "Use of Color");
    u.findings = [rep("a.fr-link", 41), rep("a.fr-link", 88)];
    const md = renderAuditorUnit(u, "wcag", "en", { collapse: true }).join("\n");
    const header = md.split("\n").find((l) => l.includes("· ×2"))!;
    expect(AUDITOR_OCCURRENCE.test(header)).toBe(false);
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

// THE BYTE NET. `renderAuditorUnit` is the single Markdown surface behind `report §2`, `prd`,
// every tracker issue body and every per-page sheet, and three parsers read it back:
// verify.ts's AUDITOR_OCCURRENCE, verify.ts's HEADING_LINE and check.ts's criterion scanner.
// The behavioural tests above assert what a reader sees; these assert the BYTES, so that
// splitting the renderer into a model + a serializer — or hanging a crop sub-bullet off an
// occurrence — cannot move a character no test was watching.
//
// A failing snapshot here is not automatically a bug: it is a diff to READ. Accept it only
// once you can name the byte that moved and why it had to.
describe("renderAuditorUnit — reference bytes", () => {
  /** The finding shapes that hang inert sub-bullets off an occurrence line, all at once. */
  function rich(): PrdUnit {
    const u = unit("1.1.1", "Non-text Content");
    u.findings[0]!.related = { file: "src/Icon.tsx", line: 7, col: 2, selectorHint: "svg", note: "Composant défini ici." };
    u.findings[0]!.secondary = { note: "Relève aussi de ce critère selon le référentiel." };
    u.findings[0]!.origin = { capture: "captures/button-icon.html", sourceFile: "src/Button.tsx", component: "Button", sourceLine: 12 };
    return u;
  }

  const CASES: Array<[string, () => string[]]> = [
    ["wcag · en · bare (issue body)", () => renderAuditorUnit(unit("1.1.1", "Non-text Content"), "wcag", "en")],
    ["wcag · fr · heading", () => renderAuditorUnit(unit("1.4.3", "Contraste (minimum)"), "wcag", "fr", { heading: "###" })],
    ["rgaa · fr · heading", () => renderAuditorUnit(unit("11.6", "Légende", ["1.3.1", "3.3.2"]), "rgaa", "fr", { heading: "###" })],
    ["rgaa · en · heading", () => renderAuditorUnit(unit("11.6", "Légende", ["1.3.1", "3.3.2"]), "rgaa", "en", { heading: "###" })],
    ["wcag · fr · related + secondary + origin", () => renderAuditorUnit(rich(), "wcag", "fr", { heading: "###" })],
    ["wcag · en · related + secondary + origin", () => renderAuditorUnit(rich(), "wcag", "en", { heading: "###" })],
    [
      "wcag · fr · advisory unit",
      () => renderAuditorUnit({ ...unit("1.3.1", "Structuration de l'information"), advisory: true }, "wcag", "fr", { heading: "###" }),
    ],
    ["wcag · en · advisory unit", () => renderAuditorUnit({ ...unit("1.3.1", "Info and Relationships"), advisory: true }, "wcag", "en", { heading: "###" })],
    [
      "wcag · fr · mixed unit (normative + advisory)",
      () => {
        const u = unit("1.1.1", "Non-text Content");
        u.findings.push({
          ...u.findings[0]!,
          file: "src/b.tsx",
          line: 9,
          selectorHint: "h1",
          severity: "mineur",
          message: "recommandation non normative",
          remediation: "Ajoutez un h1",
          advisory: true,
        });
        return renderAuditorUnit(u, "wcag", "fr", { heading: "###" });
      },
    ],
    [
      "wcag · en · collapsed occurrences",
      () => {
        const u = unit("1.4.1", "Use of Color");
        u.findings = [rep("a.fr-link", 41), rep("a.fr-link", 88), rep("a.fr-link", 120), rep("a.fr-btn", 12)];
        return renderAuditorUnit(u, "wcag", "en", { heading: "###", collapse: true });
      },
    ],
    [
      "wcag · en · uncollapsed occurrences",
      () => {
        const u = unit("1.4.1", "Use of Color");
        u.findings = [rep("a.fr-link", 41), rep("a.fr-link", 88), rep("a.fr-link", 120), rep("a.fr-btn", 12)];
        return renderAuditorUnit(u, "wcag", "en", { heading: "###" });
      },
    ],
    ["wcag · en · technical:false", () => renderAuditorUnit(unit("1.1.1", "Non-text Content"), "wcag", "en", { heading: "###", technical: false })],
    [
      "wcag · fr · served URL with sample provenance",
      () => {
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
              sample: { page: "Profil", authRequired: true, notes: "Se connecter puis ouvrir /profil." },
            },
          ],
        };
        return renderAuditorUnit(u, "wcag", "fr", { heading: "###" });
      },
    ],
  ];

  it.each(CASES)("%s", (_name, render) => {
    expect(render().join("\n")).toMatchSnapshot();
  });

  // The three grammars the bytes above have to keep feeding. Asserted here as well as in the
  // snapshot, because a snapshot tells you a byte moved but not which contract it broke.
  it("every occurrence of every case stays parseable, and no group header ever is", () => {
    for (const [name, render] of CASES) {
      const lines = render();
      for (const line of lines) {
        if (line.includes("· ×")) expect(AUDITOR_OCCURRENCE.test(line), `${name}: a group header entered the worklist`).toBe(false);
        if (line.trimStart().startsWith("- 💡")) expect(AUDITOR_OCCURRENCE.test(line), `${name}: an advisory entered the worklist`).toBe(false);
      }
      // No line may open a heading deeper than #### — verify.ts's HEADING_LINE stops resetting
      // the current criterion at level 5, and a technical-section line would leak into it.
      expect(
        lines.some((l) => /^#{5,}\s/.test(l)),
        `${name}: a level-5+ heading`,
      ).toBe(false);
    }
  });
});

describe("auditorUnitModel", () => {
  it("carries the criterion block as decisions, in the order the Markdown serializes them", () => {
    const m = auditorUnitModel(unit("1.4.3", "Contraste (minimum)"), "wcag", "fr");
    expect(m.fields.map((f) => f.label)).toEqual(["Principe · Règle", "Critère de succès", "Technique", "WCAG", "Priorité"]);
    expect(m.fields.find((f) => f.label === "WCAG")?.value).toBe("1.4.3 (AA)");
    // The core's own terms — the parenthesized "(C)" / "(NC)" are RGAA's, not WCAG's.
    expect(m.conformanceTerms).toEqual({ conformant: "Conforme", nonConformant: "Non conforme" });
  });

  it("resolves the pack's own vocabulary and test numbers under --standard rgaa", () => {
    const m = auditorUnitModel(unit("11.6", "Légende", ["1.3.1"]), "rgaa", "fr");
    expect(m.fields.map((f) => f.label)).toEqual(["Thématique", "Critère", "Test(s)", "Priorité"]);
    expect(m.fields[0]!.value).toBe("11. Formulaires");
    expect(m.conformanceTerms.nonConformant).toBe("Non conforme (NC)");
  });

  // A PACK DELIVERABLE NAMES ONE REFERENTIAL. The block used to carry a « WCAG 1.3.1 (A) »
  // field beside the RGAA theme/criterion/tests, which left an auditor working to RGAA
  // reconciling two referentials inside a document that answers to one. The mapping is still
  // what computes the projection and `criteria --standard rgaa <id>` still prints it — a
  // conformance report is simply not where it belongs.
  it("carries no WCAG cross-reference under a pack, and keeps one under the core", () => {
    const pack = auditorUnitModel(unit("11.6", "Légende", ["1.3.1"]), "rgaa", "fr");
    expect(pack.fields.some((f) => f.label === "WCAG")).toBe(false);
    expect(renderAuditorUnit(unit("11.6", "Légende", ["1.3.1"]), "rgaa", "fr", {}).join("\n")).not.toMatch(/WCAG/);

    const core = auditorUnitModel(unit("1.4.3", "Contraste (minimum)"), "wcag", "fr");
    expect(core.fields.find((f) => f.label === "WCAG")?.value).toBe("1.4.3 (AA)");
  });

  it("never counts an advisory as a non-conformity, and never folds unless asked", () => {
    const u = unit("1.4.1", "Use of Color");
    u.findings = [rep("a.fr-link", 41), rep("a.fr-link", 88), { ...rep("a.fr-btn", 12), advisory: true }];
    expect(auditorUnitModel(u, "wcag", "en").occurrences).toBe(2);
    expect(auditorUnitModel(u, "wcag", "en").advisories).toHaveLength(1);
    expect(auditorUnitModel(u, "wcag", "en").groups.map((g) => g.count)).toEqual([1, 1]);
    expect(auditorUnitModel(u, "wcag", "en", { collapse: true }).groups.map((g) => g.count)).toEqual([2]);
  });
});

// The crop sub-bullet is emitted in ONE place (renderOccurrenceDetails), so report §2, prd,
// every tracker issue body and every page sheet inherit it at once. What it must never do is
// enter the verify worklist or the check criterion scanner.
describe("renderAuditorUnit — the crop sub-bullet", () => {
  const cropFor = (f: { line: number }) =>
    f.line === 3 ? { href: "./assets/accueil/ab12cd34ef56.png", alt: "Capture recadrée : img sur Accueil" } : undefined;

  it("hangs the crop under its occurrence, and only under the one that has it", () => {
    const u = unit("1.1.1", "Non-text Content");
    u.findings.push({ ...u.findings[0]!, file: "src/b.tsx", line: 9, selectorHint: "h1" });
    const lines = renderAuditorUnit(u, "wcag", "fr", { cropFor });
    const at = lines.findIndex((l) => l.includes("src/a.tsx:3"));
    expect(lines[at + 1]).toBe("  - ![Capture recadrée : img sur Accueil](./assets/accueil/ab12cd34ef56.png)");
    expect(lines.filter((l) => l.includes("!["))).toHaveLength(1);
  });

  it("indents under a folded group, so the crop follows its own occurrence and not the header", () => {
    const u = unit("1.4.1", "Use of Color");
    u.findings = [rep("a.fr-link", 41), rep("a.fr-link", 88)];
    u.findings[0]!.line = 3;
    const lines = renderAuditorUnit(u, "wcag", "en", { collapse: true, cropFor });
    const at = lines.findIndex((l) => l.includes("!["));
    expect(lines[at]).toMatch(/^ {4}- !\[/); // two for the group indent, two for the sub-bullet
    expect(lines[at - 1]).toContain("- [ ] `.ultra11y/pages/accueil/dom.html:3`");
  });

  it("stays out of the verify worklist — no checkbox, whatever the indent", () => {
    const u = unit("1.1.1", "Non-text Content");
    const lines = renderAuditorUnit(u, "wcag", "en", { cropFor });
    for (const l of lines.filter((x) => x.includes("!["))) expect(AUDITOR_OCCURRENCE.test(l)).toBe(false);
  });

  // src/check.ts scans the WHOLE document for "<id> —": an alt reading "1.1.1 — Non-text
  // Content" would be counted as a criterion mention the report never made.
  it("no alt this engine generates may look like a criterion mention", () => {
    const u = unit("1.1.1", "Non-text Content");
    const lines = renderAuditorUnit(u, "wcag", "fr", { cropFor });
    for (const l of lines.filter((x) => x.includes("!["))) expect(l).not.toMatch(/\d+\.\d+\s*—/);
  });

  it("without a lookup the block is byte-identical — evidence is additive or it is nothing", () => {
    const u = unit("1.1.1", "Non-text Content");
    expect(renderAuditorUnit(u, "wcag", "fr", { cropFor: () => undefined })).toEqual(renderAuditorUnit(u, "wcag", "fr"));
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

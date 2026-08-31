// THE THREE BANNERS THAT NEVER LOOKED AT WHAT THE RUN ACTUALLY DID.
//
// The repository has known how to tell a source-only audit from one that ingested rendered
// pages since the day the snapshot tier landed — it is what produces « ✅ 37 fichier(s) de
// capture rendus audités » and « Pages rendues réellement testées : 37 ». These three headers
// were simply never wired to it, so a run that captured thirty-seven real pages, measured them
// in a browser and had an adjudicator rule on the result still introduced itself as a
// preliminary static pass and told its reader to go and audit the build output.
//
// Measured on egapro's run 33416093626 — 37 pages, 106 criteria, 91 C / 10 NC — the report
// carried all three at once, and the third named « régions live » on a document whose own grid
// rules RGAA 7.5 non-conformant with three cited findings.
//
// A deliverable that contradicts itself in its own header is not one an auditor can sign.
import { describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { renderPackReport, renderReport, untestedNeedsRendering } from "../src/report.js";
import { loadPack } from "../src/standards/index.js";
import type { AuditResult } from "../src/types.js";

const FIX = new URL("./fixtures/", import.meta.url).pathname;
const source = runAudit({ inputs: [`${FIX}non-conforming/bad.html`] });

/** The same audit, as it looks after a sweep that captured and read real pages. */
const rendered: AuditResult = {
  ...source,
  scope: {
    ...source.scope,
    pagesAudited: ["accueil", "contact"],
    captures: { files: 2, components: [] },
    rendered: { files: 81, opaqueLibraries: ["react", "next/link"] },
  },
};

describe("the tool line says what this run did, not what the engine can do", () => {
  it("calls a source-only run what it is — a preliminary static pass", () => {
    expect(renderReport(source, "fr")).toContain("audit préliminaire");
  });

  it("stops calling a run that audited rendered pages « préliminaire »", () => {
    const md = renderReport(rendered, "fr");
    expect(md).not.toContain("audit préliminaire");
    expect(md).toContain("Pages rendues réellement testées : 2");
  });

  it("does the same in English", () => {
    expect(renderReport(rendered, "en")).not.toContain("preliminary audit");
  });
});

describe("the opaque-library caveat stops telling a reader to do what the run already did", () => {
  it("still asks a SOURCE-ONLY run to audit the build output", () => {
    const md = renderReport({ ...source, scope: { ...source.scope, rendered: { files: 81, opaqueLibraries: ["react"] } } }, "fr");
    expect(md).toContain("Auditez la sortie de build");
  });

  it("does NOT, once the rendered DOM of those pages has been audited", () => {
    const md = renderReport(rendered, "fr");
    // The FACT stays — those source files really do render opaque components — but the
    // instruction is spent: the run read the produced HTML on two captured pages.
    expect(md).toContain("composants de bibliothèque");
    expect(md).not.toContain("Auditez la sortie de build");
    expect(md).toMatch(/2 page/);
  });

  it("does the same in English", () => {
    expect(renderReport(rendered, "en")).not.toContain("Audit the build output");
  });
});

describe("the partial-audit banner does not contradict the grid printed underneath it", () => {
  /** A run where every other rendering criterion was measured, and the live-region one carries
   *  an adjudicated verdict at the pack's own granularity — the shape `verify --apply` folds
   *  into the audit, and exactly what egapro's run published for RGAA 7.5. */
  const withVerdict: AuditResult = {
    ...rendered,
    scope: { ...rendered.scope, scan: { testedScs: ["1.3.4", "1.4.1", "1.4.3", "1.4.4", "1.4.10", "1.4.11", "1.4.12", "1.4.13", "2.1.2", "2.4.7", "2.4.11"] } },
    packAdjudication: {
      standard: "rgaa",
      criteria: [
        {
          id: "7.5",
          status: "NC",
          justification: "Le bloc d'erreur de validation apparaît hors de toute région live.",
          findings: [
            {
              ruleId: "agent:7.5",
              criteriaId: "4.1.3",
              file: "src/Step1.tsx",
              line: 361,
              col: 1,
              selectorHint: "div.fr-alert",
              severity: "majeur" as const,
              message: "Message de statut hors région live.",
              remediation: "",
              snippet: '<div class="fr-alert">',
            },
          ],
        },
      ],
    },
  };

  it("names a rendering criterion nothing measured AND nothing decided", () => {
    expect(untestedNeedsRendering(rendered)).toContain("4.1.3");
    expect(renderPackReport(rendered, loadPack("rgaa"), "fr")).toContain("Audit partiel");
  });

  it("stops naming it once the report's own grid rules on it", () => {
    // RGAA 7.5 « les messages de statut sont-ils correctement restitués » is the pack
    // criterion 4.1.3 projects onto. Ruled NC, with citations. Publishing « les critères à
    // restituer n'ont pas été testés » over that verdict is the document arguing with itself.
    const md = renderPackReport(withVerdict, loadPack("rgaa"), "fr");
    expect(md).not.toContain("Audit partiel");
    expect(renderPackReport(withVerdict, loadPack("rgaa"), "en")).not.toContain("Partial audit");
  });

  it("keeps naming a criterion that is merely CONFORMING BY SILENCE — that is what the banner is for", () => {
    // A verdict reached because nothing contradicted it is not a measurement, and suppressing
    // the banner on it would delete the one warning that mattered.
    const bySilence: AuditResult = {
      ...rendered,
      criteria: rendered.criteria.map((c) => (c.id === "4.1.3" ? { ...c, status: "C" as const } : c)),
    };
    expect(untestedNeedsRendering(bySilence)).toContain("4.1.3");
  });
});

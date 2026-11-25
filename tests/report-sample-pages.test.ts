// AN ELEVEN-PAGE SAMPLE IS NOT « 30 PAGES AUDITÉES » (#232).
//
// Every snapshot directory is an entry of the page scope, and a replayed journey writes one per
// step. The report counted them all as pages, averaged the RGAA « taux moyen » over all of them,
// and labelled every occurrence no page claimed « sans page », whether it sat in a component no
// page serves or in a downloadable document. And an agent-declared non-conformity carried an
// English stock remediation into every NC row of the French report.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { resolveRemediation } from "../src/messages.js";
import { attributePages, derivePages, occurrencesByPage, pageResolver, pageScopesFrom, pagesOf } from "../src/pages.js";
import { renderPagesIndex } from "../src/pages-report.js";
import { averageConformanceRate, renderPackReport } from "../src/report.js";
import { PAGES_DIR, readSnapshots } from "../src/snapshot.js";
import { loadPack } from "../src/standards/index.js";
import type { AuditResult, Finding } from "../src/types.js";

/** Two sample pages, one journey state of the contact page and one captured route the sample
 *  does not declare. The state and the stray route both lack a title (RGAA 8.5): if they were
 *  counted, they would drag the mean down. */
function sampleWithExtras(): AuditResult {
  const root = mkdtempSync(join(tmpdir(), "u11y-sample-pages-"));
  const entries = [
    { id: "accueil", path: "/", title: true },
    { id: "contact", path: "/contact", title: true },
    { id: "contact-01-click-button-envoyer", path: "/contact", title: false },
    { id: "archives", path: "/archives", title: false },
  ];
  const doms = entries.map((p) => {
    const dir = join(root, PAGES_DIR, p.id);
    mkdirSync(dir, { recursive: true });
    const url = `https://exemple.fr${p.path}`;
    writeFileSync(join(dir, "meta.json"), JSON.stringify({ v: 1, id: p.id, name: p.id, url }));
    writeFileSync(
      join(dir, "dom.html"),
      `<!-- ultra11y:capture v=1 page=${p.id} url=${url} -->\n<!doctype html><html lang="fr"><head>${p.title ? "<title>Page</title>" : ""}</head><body><main><h1>Page</h1><p>Texte</p></main></body></html>\n`,
    );
    return join(dir, "dom.html");
  });
  const audit = runAudit({ inputs: doms });
  audit.scope.pages = pageScopesFrom(readSnapshots(root));
  audit.scope.sample = {
    pages: [
      { id: "accueil", name: "accueil", url: "https://exemple.fr/" },
      { id: "contact", name: "contact", url: "https://exemple.fr/contact" },
    ],
  };
  audit.scope.journeys = {
    manifest: ".ultra11y/journey-runs.json",
    journeys: [
      {
        name: "contact",
        file: ".ultra11y/journeys/contact.json",
        keyboard: true,
        status: "done",
        steps: [{ n: 1, action: "click", label: 'click button "Envoyer"', status: "done", page: "contact-01-click-button-envoyer" }],
      },
    ],
  };
  attributePages(audit, audit.scope.pages);
  rmSync(root, { recursive: true, force: true });
  return audit;
}

describe("sample pages, journey states and out-of-sample routes", () => {
  const audit = sampleWithExtras();
  const scope = pagesOf(audit);
  const derived = derivePages(audit, scope);

  it("classifies each entry against the declared sample and the journeys, sample pages first", () => {
    expect(scope.map((p) => [p.id, p.kind])).toEqual([
      ["accueil", undefined],
      ["contact", undefined],
      ["archives", "out-of-sample"],
      ["contact-01-click-button-envoyer", "journey-state"],
    ]);
    expect(scope.find((p) => p.kind === "journey-state")?.journey).toEqual({ name: "contact", step: 1 });
  });

  it("takes the RGAA mean over the sample pages only, and counts what it leaves out", () => {
    const avg = averageConformanceRate(audit, derived, "rgaa", "fr");
    expect(avg.pages.map((p) => p.id)).toEqual(["accueil", "contact"]);
    expect(avg.outside).toEqual({ states: 1, routes: 1 });
    // The rate formula is untouched: the mean of the two sample pages' own ratios.
    const mean = avg.pages.reduce((n, p) => n + p.validated / p.applicable, 0) / avg.pages.length;
    expect(avg.pct).toBe(Math.round(mean * 100));
  });

  it("counts two audited pages in the report header and lists the state and the route apart", () => {
    const md = renderPackReport(audit, loadPack("rgaa"), "fr");
    expect(md).toContain("- **Pages auditées** : 2 — accueil, contact");
    expect(md).toContain("- **Routes hors échantillon** : 1 — archives");
    expect(md).toContain("- **États de parcours** : 1 — contact-01-click-button-envoyer");
    expect(md).toContain("des 2 pages de l'échantillon");
    expect(md).toContain("hors moyenne : 1 état(s) de parcours, 1 route(s) hors échantillon");
    // Their findings still count against the criterion — and are located on the labelled entry.
    expect(md).toMatch(
      /RGAA 8\.5 — [^\n]*\| 2 \| [^\n]*archives \(hors échantillon\)[^\n]*contact-01-click-button-envoyer \(état de parcours — contact, étape 1\)/,
    );
  });

  it("labels the entries in English under --lang en", () => {
    const md = renderPackReport(audit, loadPack("rgaa"), "en");
    expect(md).toContain("- **Pages audited** : 2 — accueil, contact");
    expect(md).toContain("- **Journey states** : 1");
    expect(md).toContain("left out of the mean: 1 journey state(s), 1 route(s) outside the sample");
  });

  it("counts the same way in the pages index", () => {
    const md = renderPagesIndex(audit, derived, { standard: "rgaa", lang: "fr" });
    expect(md).toContain("- **Pages** : 2");
    expect(md).toContain("- **Routes hors échantillon** : 1");
    expect(md).toContain("- **États de parcours** : 1");
  });

  it("keeps a journey's step on a declared sample page a page", () => {
    const a = sampleWithExtras();
    a.scope.journeys!.journeys[0]!.steps.push({ n: 0, action: "goto", label: "goto /contact", status: "done", page: "contact" });
    expect(pagesOf(a).find((p) => p.id === "contact")?.kind).toBeUndefined();
  });

  it("calls every entry a page when no sample is declared, journey states excepted", () => {
    const a = sampleWithExtras();
    delete a.scope.sample;
    expect(pagesOf(a).map((p) => p.kind)).toEqual([undefined, undefined, undefined, "journey-state"]);
  });
});

describe("occurrences on no page say what they were found in", () => {
  const audit = sampleWithExtras();
  const base = audit.findings[0]!;
  const off = (over: Partial<Finding>): Finding => ({ ...base, page: undefined, ...over });
  audit.scope.renders = {
    manifest: ".ultra11y/render.json",
    rendered: 1,
    skipped: 0,
    notAttempted: 0,
    units: [
      {
        id: "src-components-Logo__Logo",
        file: "src/components/Logo.tsx",
        export: "Logo",
        component: "Logo",
        kind: "component",
        status: "rendered",
        capture: ".ultra11y/captures/src-components-Logo__Logo.html",
      },
    ],
  } as unknown as NonNullable<AuditResult["scope"]["renders"]>;
  const findings = [
    off({ file: ".ultra11y/captures/src-components-Logo__Logo.html" }),
    off({ file: "src/components/Logo.tsx" }),
    off({ file: "public/docs/formulaire.pdf" }),
    off({ file: "src/legacy.html" }),
  ];

  it("tells a component no page serves from a downloadable document and from the rest", () => {
    const { orphans, offPage } = occurrencesByPage(findings, pageResolver(audit));
    expect(orphans).toBe(4);
    expect(offPage).toEqual({ component: 2, document: 1, unknown: 1 });
  });
});

describe("the stock remediation of an agent-declared non-conformity", () => {
  it("is French in a French report and stays English under --lang en", () => {
    const f = { remediation: "Address the reported non-conformity." };
    expect(resolveRemediation(f, "fr")).toBe("Corrigez la non-conformité relevée.");
    expect(resolveRemediation(f, "en")).toBe("Address the reported non-conformity.");
    expect(resolveRemediation({ remediation: "See WCAG 1.1.1." }, "fr")).toBe("Voir le critère de succès WCAG 1.1.1.");
    // An agent's own remediation is never rewritten.
    expect(resolveRemediation({ remediation: "Add an alt." }, "fr")).toBe("Add an alt.");
  });
});

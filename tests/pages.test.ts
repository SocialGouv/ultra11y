import { describe, it, expect } from "vitest";
import { attributePages, derivePages, renderPageGrid, unattributedFindings } from "../src/pages.js";
import type { AuditResult, CriterionResult, Finding, PageScope } from "../src/types.js";

const F = (over: Partial<Finding> = {}): Finding => ({
  ruleId: "img-alt-missing",
  criteriaId: "1.1.1",
  file: "src/a.html",
  line: 1,
  col: 1,
  selectorHint: "img",
  severity: "bloquant",
  message: "m",
  remediation: "r",
  snippet: "",
  ...over,
});

const C = (id: string, status: CriterionResult["status"], findings: Finding[] = []): CriterionResult => ({
  id,
  guideline: id.split(".").slice(0, 2).join("."),
  status,
  findings,
});

const audit = (over: Partial<AuditResult> = {}): AuditResult =>
  ({
    tool: "ultra11y",
    standard: "wcag",
    date: "2026-07-29",
    scope: { inputs: [], files: 1 },
    criteria: [],
    guidelines: [],
    findings: [],
    residualRisks: [],
    conformancePct: 100,
    ...over,
  }) as unknown as AuditResult;

const PAGES: PageScope[] = [
  { id: "accueil", name: "Accueil", url: "https://x/", sources: ["app/page.tsx"], basis: "snapshot" },
  { id: "contact", name: "Contact", url: "https://x/contact", sources: ["app/contact/page.tsx"], basis: "snapshot" },
];

describe("attributing findings to pages", () => {
  it("leaves a finding already stamped by its snapshot alone", () => {
    const r = audit({ findings: [F({ page: "accueil" })] });
    attributePages(r, PAGES);
    expect(r.findings[0]?.page).toBe("accueil");
  });

  it("attributes a SOURCE finding via the page's recorded source files", () => {
    const r = audit({ findings: [F({ file: "app/contact/page.tsx" })] });
    attributePages(r, PAGES);
    expect(r.findings[0]?.page).toBe("contact");
  });

  it("matches a source on a path suffix, so cwd-relative and repo-relative both resolve", () => {
    const r = audit({ findings: [F({ file: "/repo/app/page.tsx" })] });
    attributePages(r, PAGES);
    expect(r.findings[0]?.page).toBe("accueil");
  });

  it("attributes a merged dynamic finding by its page URL", () => {
    const r = audit({ findings: [F({ file: "https://x/contact" })] });
    attributePages(r, PAGES);
    expect(r.findings[0]?.page).toBe("contact");
  });

  it("attributes a scan --sample finding by its human page name", () => {
    const r = audit({ findings: [F({ file: "whatever", sample: { page: "Contact" } })] });
    attributePages(r, PAGES);
    expect(r.findings[0]?.page).toBe("contact");
  });

  it("leaves a finding it cannot attribute UNATTRIBUTED rather than guessing a page", () => {
    const r = audit({ findings: [F({ file: "src/lib/util.ts" })] });
    attributePages(r, PAGES);
    expect(r.findings[0]?.page).toBeUndefined();
    expect(unattributedFindings(r).length).toBe(1);
  });

  it("never attributes one finding to two pages — the first match wins, deterministically", () => {
    const shared: PageScope[] = [
      { id: "a", name: "A", url: "https://x/a", sources: ["app/shared.tsx"], basis: "snapshot" },
      { id: "b", name: "B", url: "https://x/b", sources: ["app/shared.tsx"], basis: "snapshot" },
    ];
    const r = audit({ findings: [F({ file: "app/shared.tsx" })] });
    attributePages(r, shared);
    expect(r.findings[0]?.page).toBe("a");
  });
});

describe("per-page criterion status", () => {
  it("is NC on the page that has the finding and C on the page that does not", () => {
    const nc = F({ page: "accueil", criteriaId: "1.1.1" });
    const r = audit({ findings: [nc], criteria: [C("1.1.1", "NC", [nc])] });
    const pages = derivePages(r, PAGES);
    expect(pages.find((p) => p.id === "accueil")?.criteria.find((c) => c.id === "1.1.1")?.status).toBe("NC");
    expect(pages.find((p) => p.id === "contact")?.criteria.find((c) => c.id === "1.1.1")?.status).toBe("C");
  });

  it("keeps a globally undecidable criterion `manual` on every page", () => {
    const r = audit({ criteria: [C("1.4.3", "manual")] });
    for (const p of derivePages(r, PAGES)) expect(p.criteria.find((c) => c.id === "1.4.3")?.status).toBe("manual");
  });

  it("carries a not-applicable criterion through as NA", () => {
    const r = audit({ criteria: [C("1.2.1", "NA")] });
    for (const p of derivePages(r, PAGES)) expect(p.criteria.find((c) => c.id === "1.2.1")?.status).toBe("NA");
  });

  it("refuses to call a criterion conforming on a page with NO snapshot — absence of evidence is not evidence", () => {
    const attributed: PageScope[] = [{ id: "solo", name: "Solo", url: "https://x/s", sources: ["app/s.tsx"], basis: "attributed" }];
    const r = audit({ criteria: [C("1.1.1", "C")] });
    expect(derivePages(r, attributed)[0]?.criteria.find((c) => c.id === "1.1.1")?.status).toBe("manual");
  });

  it("never lets a non-normative recommendation flip a page criterion to NC", () => {
    const adv = F({ page: "accueil", criteriaId: "1.3.1", advisory: true });
    const r = audit({ findings: [adv], criteria: [C("1.3.1", "C", [adv])] });
    const page = derivePages(r, PAGES).find((p) => p.id === "accueil");
    expect(page?.criteria.find((c) => c.id === "1.3.1")?.status).toBe("C");
  });

  it("computes a per-page pass rate over that page's decided criteria only", () => {
    const nc = F({ page: "accueil", criteriaId: "1.1.1" });
    const r = audit({ findings: [nc], criteria: [C("1.1.1", "NC", [nc]), C("2.4.2", "C"), C("1.4.3", "manual")] });
    const pages = derivePages(r, PAGES);
    // accueil: 1 C, 1 NC, 1 manual → 50%. contact: 2 C → 100%.
    expect(pages.find((p) => p.id === "accueil")?.conformancePct).toBe(50);
    expect(pages.find((p) => p.id === "contact")?.conformancePct).toBe(100);
  });

  it("collects each page's own findings", () => {
    const a = F({ page: "accueil" });
    const b = F({ page: "contact", ruleId: "link-empty-name" });
    const r = audit({ findings: [a, b], criteria: [C("1.1.1", "NC", [a, b])] });
    const pages = derivePages(r, PAGES);
    expect(pages.find((p) => p.id === "accueil")?.findings).toHaveLength(1);
    expect(pages.find((p) => p.id === "contact")?.findings).toHaveLength(1);
  });

  it("returns no pages at all when none were declared, rather than inventing one", () => {
    expect(derivePages(audit(), [])).toEqual([]);
  });
});

describe("the rendered grid", () => {
  const nc = F({ page: "accueil", criteriaId: "1.1.1" });
  const r = audit({ findings: [nc], criteria: [C("1.1.1", "NC", [nc]), C("2.4.2", "C"), C("1.4.3", "manual")] });

  it("has one column per page and one row per criterion", () => {
    const md = renderPageGrid(r, PAGES, "wcag", "en");
    expect(md).toContain("Accueil");
    expect(md).toContain("Contact");
    expect(md).toContain("1.1.1");
    expect(md).toContain("1.4.3");
  });

  it("speaks the pack's own criteria under --standard", () => {
    const md = renderPageGrid(r, PAGES, "rgaa", "fr");
    expect(md).toContain("1.1"); // RGAA criterion, not the WCAG SC
    expect(md).toMatch(/Thématique|Images/);
  });

  it("shows the four statuses distinguishably", () => {
    const md = renderPageGrid(r, PAGES, "wcag", "en");
    for (const token of ["NC", "C", "?"]) expect(md).toContain(token);
  });

  it("reports the unattributed findings explicitly instead of dropping them", () => {
    const orphan = F({ file: "src/lib/util.ts", criteriaId: "1.1.1" });
    const r2 = audit({ findings: [orphan], criteria: [C("1.1.1", "NC", [orphan])] });
    const md = renderPageGrid(r2, PAGES, "wcag", "en");
    expect(md).toMatch(/unattributed|1 finding/i);
  });

  it("says so plainly when there are no pages", () => {
    expect(renderPageGrid(audit(), [], "wcag", "en")).toMatch(/no page/i);
  });
});

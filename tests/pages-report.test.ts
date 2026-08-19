import { describe, it, expect } from "vitest";
import { runAudit } from "../src/audit.js";
import { derivePages, pageScopesFrom } from "../src/pages.js";
import { renderPageDocument, renderPagesDocument, renderPagesIndex, renderPageReport, isPagesReport } from "../src/pages-report.js";
import { checkReport } from "../src/check.js";
import { AUDITOR_OCCURRENCE } from "../src/verify.js";
import { renderPackReport, renderReport } from "../src/report.js";
import { derivePackResults, loadPack, packTestIds } from "../src/standards/index.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAGES_DIR } from "../src/snapshot.js";
import type { AuditResult, PageResult, PageScope } from "../src/types.js";
import { formatRate } from "../src/pages.js";

// The per-page REPORT (issue #4052): the grid answers "which criteria fail across pages?",
// the report answers "what is the state of THIS page?". The tests below pin the two
// invariants that make it trustworthy — nothing is re-decided here, and the non-conformities
// are the shared auditor block — plus the honesty text a clean-looking sheet must carry.

function auditOfPages(pages: { id: string; name: string; url: string; dom: string; auth?: boolean }[]): {
  result: AuditResult;
  scope: PageScope[];
  derived: PageResult[];
} {
  const root = mkdtempSync(join(tmpdir(), "ultra11y-pages-report-"));
  const snapshots = [];
  for (const p of pages) {
    const dir = join(root, PAGES_DIR, p.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "dom.html"), `<!-- ultra11y:capture v="1" page="${p.id}" url="${p.url}" -->\n${p.dom}\n`);
    writeFileSync(join(dir, "meta.json"), JSON.stringify({ v: 1, id: p.id, name: p.name, url: p.url, ...(p.auth !== undefined ? { auth: p.auth } : {}) }));
    snapshots.push({ meta: { v: 1, id: p.id, name: p.name, url: p.url, ...(p.auth !== undefined ? { auth: p.auth } : {}) } });
  }
  const result = runAudit({ inputs: [join(root, PAGES_DIR)] });
  const scope = pageScopesFrom(snapshots);
  result.scope.pages = scope;
  return { result, scope, derived: derivePages(result, scope) };
}

const GOOD = '<html lang="fr"><head><title>Accueil</title></head><body><main><h1>Bonjour</h1></main></body></html>';
const BAD = '<html lang="fr"><head><title>Contact</title></head><body><main><img src="a.png"><button></button></main></body></html>';

describe("renderPageReport", () => {
  const { result, derived } = auditOfPages([
    { id: "accueil", name: "Page d'accueil", url: "https://exemple.fr/", dom: GOOD },
    { id: "contact", name: "Contact", url: "https://exemple.fr/contact", dom: BAD, auth: true },
  ]);
  const contact = derived.find((p) => p.id === "contact")!;
  const md = renderPageReport(result, contact, { standard: "rgaa", lang: "fr" });

  it("lists EVERY criterion of the active standard, not only the ones that fired", () => {
    const pack = loadPack("rgaa");
    expect(pack.criteria.length).toBe(106);
    for (const c of pack.criteria) expect(md).toContain(`| ${c.id} — `);
  });

  it("groups the criteria by the standard's own themes", () => {
    // Three cells now: the grid carries the criterion's own numbered tests.
    expect(md).toContain("| **1. Images** | | |");
    expect(md).toContain("| **8. Éléments obligatoires** | | |");
  });

  it("marks the page's own status, which is not the scope-wide one", () => {
    expect(md).toMatch(/\| 1\.1 —[^|]*\|[^|]*\| NC \|/); // the image with no alt is on THIS page
    expect(md).toMatch(/\| 8\.3 —[^|]*\|[^|]*\| C \|/); // lang is declared on THIS page
  });

  it("renders each non-conformity through the shared auditor block, occurrence line included", () => {
    expect(md).toContain("#### 🔴 RGAA 1.1 —");
    // The machine-parseable occurrence contract (AUDITOR_OCCURRENCE, src/verify.ts).
    expect(md).toMatch(/^- \[ \] `[^`]+:\d+` \(`[^`]*`\) — /m);
  });

  it("shows the auth badge and the page identity", () => {
    expect(md).toContain("## Contact 🔒");
    expect(md).toContain("- **URL** : `https://exemple.fr/contact`");
    expect(md).toContain("- **Base** : instantané");
  });

  it("says a criterion left to assess is NOT conforming", () => {
    expect(md).toContain("n'est ni conforme ni non conforme");
  });

  it("says so explicitly when there is no screenshot, rather than showing nothing", () => {
    expect(md).toContain("Aucune capture d'écran pour cette page");
  });

  it("embeds the screenshot the caller resolved", () => {
    const withShot = renderPageReport(result, contact, {
      standard: "rgaa",
      lang: "fr",
      screenshots: new Map([["contact", "../../.ultra11y/pages/contact/screen.png"]]),
    });
    expect(withShot).toContain("![Capture d'écran de la page Contact](../../.ultra11y/pages/contact/screen.png)");
  });

  it("warns on a SOURCE-only page that silence is not conformity", () => {
    const sourceOnly: PageResult = { ...contact, basis: "attributed" };
    const src = renderPageReport(result, sourceOnly, { standard: "rgaa", lang: "fr" });
    expect(src).toContain("n'a **pas** d'instantané");
    expect(src).toContain("- **Base** : source");
  });

  it("carries every criterion's own numbered tests, not only the ones that fired", () => {
    // A sheet that lists 106 criteria but only says what to check for the handful that
    // triggered tells the auditor nothing about the work left to do.
    const pack = loadPack("rgaa");
    for (const c of pack.criteria) {
      const tests = packTestIds(pack, c.id);
      if (!tests.length) continue;
      const row = new RegExp(`\\| ${c.id.replace(".", "\\.")} —[^|]*\\|([^|]*)\\|`).exec(md);
      expect(row, `criterion ${c.id} missing from the grid`).not.toBeNull();
      for (const t of tests) expect(row![1], `criterion ${c.id}`).toContain(`\`${t}\``);
    }
  });

  it("re-decides nothing: every status equals the shared pack projection for that page", () => {
    // The whole point of invariant 1. Recompute independently and compare cell by cell.
    const viaProjection = derivePackResults({ ...result, criteria: contact.criteria, findings: contact.findings }, "rgaa");
    const MARK = { C: "C", NC: "NC", NA: "—", manual: "?" } as const;
    for (const pc of viaProjection) {
      // label | tests | status
      const row = new RegExp(`\\| ${pc.id.replace(".", "\\.")} —[^|]*\\|[^|]*\\| (\\S+) \\|`).exec(md);
      expect(row, `criterion ${pc.id} missing from the grid`).not.toBeNull();
      expect(row![1], `criterion ${pc.id}`).toBe(MARK[pc.status]);
    }
  });
});

describe("the index", () => {
  const { result, derived } = auditOfPages([
    { id: "accueil", name: "Page d'accueil", url: "https://exemple.fr/", dom: GOOD },
    { id: "contact", name: "Contact", url: "https://exemple.fr/contact", dom: BAD },
  ]);
  const md = renderPagesIndex(result, derived, {
    standard: "rgaa",
    lang: "fr",
    hrefs: new Map([
      ["accueil", "./page-accueil.md"],
      ["contact", "./page-contact.md"],
    ]),
  });

  it("has one row per page, with its rate and severity counts", () => {
    expect(md).toContain("| Page d'accueil | `https://exemple.fr/` | instantané |");
    expect(md).toContain("| Contact | `https://exemple.fr/contact` | instantané |");
  });

  it("links each row to its sheet", () => {
    expect(md).toContain("[contact](./page-contact.md)");
  });

  it("counts the blocking findings of the failing page and none on the clean one", () => {
    const contactRow = md.split("\n").find((l) => l.startsWith("| Contact |"))!;
    const accueilRow = md.split("\n").find((l) => l.startsWith("| Page d'accueil |"))!;
    // <img> with no alt + <button> with no name are both blocking.
    expect(contactRow).toMatch(/\| 2 \| 0 \| 0 \|/);
    expect(accueilRow).toMatch(/\| 0 \| 0 \| 0 \|/);
  });

  it("folds a page sheet's repeated occurrences without changing what it claims", () => {
    // 12 links failing one DSFR rule with one selector is ONE defect to fix and twelve places to
    // fix it. Listing twelve near-identical lines is what would trade an empty report for an
    // unreadable one — but the count and the adjudicable items must not move.
    const p = derived.find((x) => x.id === "contact")!;
    const one = p.findings.find((f) => !f.advisory)!;
    // Twelve occurrences of one rule on one selector, as a design-system defect produces. The
    // clones must reach the CRITERION's own finding list — that is what prdUnits reads.
    const clones = Array.from({ length: 11 }, (_, i) => ({ ...one, col: 40 + i }));
    const many: PageResult = {
      ...p,
      findings: [...p.findings, ...clones],
      criteria: p.criteria.map((c) => (c.id === one.criteriaId ? { ...c, findings: [...c.findings, ...clones] } : c)),
    };
    const sheet = renderPageReport(result, many, { standard: "rgaa", lang: "fr" });

    // Folded for the reader: one counted header instead of twelve near-identical lines.
    expect(sheet).toContain("· ×12");
    // ...and untouched for the gate: every occurrence still has its own adjudicable line, the
    // counted header excluded. Not an equality with the finding count — under a pack one finding
    // legitimately projects onto several criteria, so the fan-out can exceed it; what must never
    // happen is the fold REDUCING it.
    const normative = many.findings.filter((f) => !f.advisory).length;
    expect(sheet.split("\n").filter((l) => AUDITOR_OCCURRENCE.test(l)).length).toBeGreaterThanOrEqual(normative);
    // ...and untouched for the reader's arithmetic: the block still claims the raw count.
    expect(sheet).toContain("12 occurrence");
  });

  it("never prints a bare rate — every cell carries the denominator it was computed over", () => {
    // The whole of issue #16 item 2: the index is the artefact people paste into a PR, and it
    // printed `100 %` next to three zeroes while its own sheet said two criteria out of 106 had
    // been assessed.
    const rows = md.split("\n").filter((l) => l.startsWith("| Page d'accueil |") || l.startsWith("| Contact |"));
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row).toMatch(/\| (?:\d+ %|—) \(\d+\/106\) \|/);
  });

  it("renders `—`, never a number, for a page on which nothing was decided", () => {
    // 100 % over an empty denominator reads as a perfect page and is the mechanism behind a
    // scoreboard of flawless rows nobody assessed. Asserted on `formatRate`, which is what
    // every surface calls: the index recomputes its own coverage from the audit (see
    // `pageCriterionRows`), so handing it a doctored page object would test the fixture and
    // not the rule.
    expect(formatRate(null, 0, 106)).toBe("— (0/106)");
    expect(formatRate(null, 0, 106)).not.toMatch(/%/);
    expect(formatRate(100, 23, 106)).toBe("100 % (23/106)");
  });

  it("names the short rate column in both languages", () => {
    expect(md).toContain("| Taux (critères décidés) |");
    const en = renderPagesIndex(result, derived, { standard: "rgaa", lang: "en" });
    expect(en).toContain("| Rate (decided criteria) |");
    // ...and the eight-column shape is unchanged, so the separator row still lines up.
    const header = md.split("\n").find((l) => l.startsWith("| Page |"))!;
    expect(header.split("|").length - 2).toBe(8);
  });

  it("ANTI-DRIFT: the index cell and the sheet's coverage line report the same denominator", () => {
    // These were computed in two places and disagreed — the sheet said 2/106, the index said
    // 100 %. One extraction (`coverageOf`) now feeds both; this is what stops them parting again.
    for (const p of derived) {
      const sheet = renderPageReport(result, p, { standard: "rgaa", lang: "fr" });
      const fromSheet = /Couverture : (\d+)\/(\d+) critère/.exec(sheet);
      expect(fromSheet, `no coverage line on the ${p.id} sheet`).toBeTruthy();
      const row = md.split("\n").find((l) => l.startsWith(`| ${p.name} |`))!;
      expect(row).toContain(`(${fromSheet![1]}/${fromSheet![2]})`);
    }
  });
});

describe("`check` on a per-page report", () => {
  const { result, derived } = auditOfPages([{ id: "contact", name: "Contact", url: "https://exemple.fr/contact", dom: BAD }]);
  const md = renderPageDocument(result, derived[0]!, { standard: "rgaa", lang: "fr" });

  it("is recognized as a per-page report", () => {
    expect(isPagesReport(md)).toBe(true);
    expect(isPagesReport(renderReport(result, "fr"))).toBe(false);
  });

  it("passes without demanding the §1–5 structure of a conformance report", () => {
    const res = checkReport(md, "rgaa", "fr");
    expect(res.issues).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("STILL refuses an invented criterion — that gate is the point of `check`", () => {
    const forged = md.replace("| 1.2 —", "| 42.9 —");
    const res = checkReport(forged, "rgaa", "fr");
    expect(res.ok).toBe(false);
    expect(res.issues.join(" ")).toContain("42.9");
  });

  it("does not compare a per-page NC set against the SCOPE-WIDE derivation", () => {
    // Criteria failing on one page and not another would otherwise all read as over-projected.
    const res = checkReport(md, "rgaa", "fr", { audit: result });
    expect(res.issues.filter((i) => i.includes("sur-projeté") || i.includes("absent"))).toEqual([]);
  });
});

describe("the combined document", () => {
  const { result, derived } = auditOfPages([
    { id: "accueil", name: "Page d'accueil", url: "https://exemple.fr/", dom: GOOD },
    { id: "contact", name: "Contact", url: "https://exemple.fr/contact", dom: BAD },
  ]);

  it("carries the index then one section per page", () => {
    const md = renderPagesDocument(result, derived, { standard: "rgaa", lang: "fr" });
    expect(md).toContain("# Rapport page par page — index");
    expect(md).toContain("## Page d'accueil");
    expect(md).toContain("## Contact");
    expect(checkReport(md, "rgaa", "fr").ok).toBe(true);
  });

  it("renders in English too", () => {
    const md = renderPagesDocument(result, derived, { standard: "rgaa", lang: "en" });
    expect(md).toContain("Page-by-page report — index");
    expect(md).toContain("Criteria grid");
  });
});

describe("the main report speaks of every page in scope, not only a scanned sample", () => {
  const { result } = auditOfPages([{ id: "contact", name: "Contact", url: "https://exemple.fr/contact", dom: BAD }]);

  it("includes a snapshotted page in « Constats par page » with no sample declared", () => {
    expect(result.scope.sample).toBeUndefined();
    const md = renderPackReport(result, loadPack("rgaa"), "fr");
    expect(md).toContain("## 📄 Constats par page");
    expect(md).toContain("### Contact — `https://exemple.fr/contact`");
  });

  it("keeps the §1–5 numbering the conformance gate requires", () => {
    const md = renderPackReport(result, loadPack("rgaa"), "fr");
    expect(checkReport(md, "rgaa", "fr").ok).toBe(true);
  });
});

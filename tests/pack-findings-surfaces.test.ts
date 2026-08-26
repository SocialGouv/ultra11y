// A declarative PACK-RULE finding is part of a pack's verdict. It reached the report and the
// PRD, and was silently dropped everywhere else: `attributePages` only walked
// `result.findings`, so `f.page` was never set and `pageView`'s filter always yielded [] —
// a pack rule could be NC in the report and reach no cell of the grid, while the grid's own
// docstring claimed the two agree "by construction".
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import { PAGES_DIR } from "../src/snapshot.js";
import { attributePages, derivePages, renderPageGrid } from "../src/pages.js";
import { toSarif } from "../src/sarif.js";
import { annotations, stepSummary } from "../src/annotate.js";
import { derivePackResults } from "../src/standards/index.js";
import { renderPackReport } from "../src/report.js";
import { loadPack } from "../src/standards/index.js";
import { renderPrdDoc, prdUnits, partitionUnits } from "../src/prd.js";
import type { PageScope } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-packsurf-"));
const PAGE = join(dir, "page.html");
// A download link naming neither format nor size: the one declarative RGAA rule
// (pack:rgaa:download-link-format → criterion 6.1).
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Docs</title></head><body><main><h1>Docs</h1>
<a href="/rapport.pdf">Rapport annuel</a></main></body></html>`,
);

const audit = () => runAudit({ inputs: [PAGE] });
const SCOPE: PageScope[] = [{ id: "docs", name: "Docs", url: "https://x/docs", sources: [PAGE], basis: "snapshot" }];

describe("the pack rule fires at all", () => {
  it("produces a namespaced pack finding", () => {
    const r = audit();
    expect((r.packFindings ?? []).map((f) => f.ruleId)).toContain("pack:rgaa:download-link-format");
  });

  it("reaches the RGAA projection", () => {
    const c61 = derivePackResults(audit(), "rgaa").find((c) => c.id === "6.1");
    expect(c61?.findings.some((f) => f.ruleId === "pack:rgaa:download-link-format")).toBe(true);
  });
});

describe("it reaches the per-page grid", () => {
  it("is attributed to a page, like any other finding", () => {
    const r = audit();
    attributePages(r, SCOPE);
    const pf = (r.packFindings ?? []).find((f) => f.ruleId === "pack:rgaa:download-link-format");
    expect(pf?.page).toBe("docs");
  });

  it("reaches that page's own projection — the grid and the report now agree", () => {
    const r = audit();
    attributePages(r, SCOPE);
    const page = derivePages(r, SCOPE).find((p) => p.id === "docs");
    expect(page).toBeDefined();
    const md = renderPageGrid(r, SCOPE, "rgaa", "fr");
    // 6.1 must appear as a row; its cell is driven by the pack finding.
    expect(md).toContain("6.1");
  });
});

describe("it reaches the standard-keyed CI surfaces", () => {
  const withPages = () => {
    const r = audit();
    attributePages(r, SCOPE);
    return r;
  };

  it("appears in an RGAA-keyed SARIF", () => {
    const ids = toSarif(withPages(), { standard: "rgaa" }).runs[0]?.results.map((x) => x.ruleId) ?? [];
    expect(ids).toContain("pack:rgaa:download-link-format");
  });

  it("is ABSENT from a WCAG-keyed SARIF — a pack rule is not a WCAG non-conformity", () => {
    const ids = toSarif(withPages()).runs[0]?.results.map((x) => x.ruleId) ?? [];
    expect(ids).not.toContain("pack:rgaa:download-link-format");
  });

  it("appears in the RGAA job summary and not the WCAG one", () => {
    expect(stepSummary(withPages(), { standard: "rgaa", lang: "fr" })).toContain("RGAA 6.1");
    expect(stepSummary(withPages(), { lang: "en" })).not.toContain("download-link-format");
  });

  it("annotates under RGAA, never under WCAG", () => {
    const rgaa = annotations(withPages(), { standard: "rgaa" }).join("\n");
    expect(rgaa).toContain("download-link-format");
    expect(annotations(withPages()).join("\n")).not.toContain("download-link-format");
  });

  it("stays a NOTICE — the shipped rule is advisory, and an advisory never fails a build", () => {
    const rgaa = annotations(withPages(), { standard: "rgaa" }).find((l) => l.includes("download-link-format")) ?? "";
    expect(rgaa.startsWith("::notice ")).toBe(true);
  });
});

describe("the two new declarative rules", () => {
  const auditOf = (html: string) => {
    const f = join(dir, `${Math.abs(html.length)}-${html.charCodeAt(20) || 0}.html`);
    writeFileSync(f, html);
    return runAudit({ inputs: [f] });
  };
  const packRuleIds = (html: string) => (auditOf(html).packFindings ?? []).map((f) => f.ruleId);
  const DOC = (body: string) => `<!doctype html><html lang="fr"><head><title>t</title></head><body><main>${body}</main></body></html>`;

  it("flags an <optgroup> with no label (RGAA test 11.8.2)", () => {
    expect(packRuleIds(DOC("<select><optgroup><option>a</option></optgroup></select>"))).toContain("pack:rgaa:optgroup-without-label");
  });

  it("accepts a labelled <optgroup>", () => {
    expect(packRuleIds(DOC('<select><optgroup label="Europe"><option>a</option></optgroup></select>'))).not.toContain("pack:rgaa:optgroup-without-label");
  });

  it("flags a dir value that is not rtl/ltr (RGAA test 8.10.2)", () => {
    expect(packRuleIds(DOC('<p dir="rlt">texte</p>'))).toContain("pack:rgaa:dir-value-invalid");
  });

  it("accepts the two values admitted by RGAA", () => {
    for (const v of ["rtl", "ltr"]) {
      expect(packRuleIds(DOC(`<p dir="${v}">texte</p>`)), v).not.toContain("pack:rgaa:dir-value-invalid");
    }
  });

  it("reports HTML's auto value because RGAA 4.1.2 admits only rtl or ltr", () => {
    expect(packRuleIds(DOC('<p dir="auto">texte</p>'))).toContain("pack:rgaa:dir-value-invalid");
  });

  it("says nothing about an element with no dir at all", () => {
    expect(packRuleIds(DOC("<p>texte</p>"))).not.toContain("pack:rgaa:dir-value-invalid");
  });

  it("drives its RGAA criterion to NC — these are normative, unlike the download-link rule", () => {
    const r = auditOf(DOC("<select><optgroup><option>a</option></optgroup></select>"));
    expect(derivePackResults(r, "rgaa").find((c) => c.id === "11.8")?.status).toBe("NC");
  });
});

describe("the work that is NOT a non-conformity is still shown", () => {
  // Most RGAA criteria still need adjudication to earn C. The report listed them one bare line
  // each, and the PRD skipped them entirely (`if (!pr.findings.length) continue`) — so the
  // backlog of an RGAA audit was silently missing ~93% of the job.
  const r = () => runAudit({ inputs: [PAGE] });

  it("report §5 summarizes the work without repeating the exhaustive grid", () => {
    const md = renderPackReport(r(), loadPack("rgaa"), "fr");
    const toRule = md.slice(md.indexOf("## 5."));
    expect(toRule).toMatch(/\d+ critère\(s\) \/ \d+ test\(s\) restent à trancher/);
    expect(toRule).toContain("grille exhaustive ci-dessus");
    expect(toRule).not.toMatch(/RGAA 6\.1|`6\.1\.1`/);
  });

  it("does NOT list a criterion whose subject the page does not contain", () => {
    // The other half of the same job, and the one that decides whether a backlog is read. This
    // page has no form control, so RGAA theme 11 has nothing to rule on — listing it is not
    // thoroughness, it is thirteen rows of work that does not exist. « Non applicable » is the
    // normative verdict for a criterion with no subject, and it keeps the backlog honest.
    const md = renderPackReport(r(), loadPack("rgaa"), "fr");
    const toRule = md.slice(md.indexOf("## 5."));
    expect(toRule).not.toMatch(/RGAA 11\.2/);
  });

  it("report §5 points at the command that produces the full wording", () => {
    expect(renderPackReport(r(), loadPack("rgaa"), "fr")).toContain("verify --manual");
  });

  it("the PRD lists them as work to rule on", () => {
    const doc = renderPrdDoc(r(), "fr", "rgaa");
    expect(doc).toMatch(/Critères à trancher \(\d+\)/);
    expect(doc).toMatch(/RGAA 6\.1/);
    // …and not the form theme, which this page has nothing for.
    expect(doc).not.toMatch(/RGAA 11\.2\b/);
  });

  it("and says plainly that they are NOT non-conformities", () => {
    expect(renderPrdDoc(r(), "fr", "rgaa")).toMatch(/PAS des non-conformités/);
  });

  it("adds nothing to the WCAG core PRD — this is a country-standard concern", () => {
    expect(renderPrdDoc(r(), "en")).not.toMatch(/Criteria to rule on/);
  });

  it("carries the page when raised on a snapshot, so the grid can see it", () => {
    // Same regression as the module header, re-opened through the snapshot door: pack rules
    // build their Finding without going through src/rules/rule.ts, so they used to skip capture
    // provenance entirely and stay unattributed even when the DOM knew which page it was.
    const snapRoot = mkdtempSync(join(tmpdir(), "u11y-packsnap-"));
    const snapDir = join(snapRoot, PAGES_DIR, "docs");
    mkdirSync(snapDir, { recursive: true });
    writeFileSync(join(snapDir, "meta.json"), JSON.stringify({ v: 1, id: "docs", name: "Docs", url: "https://x/docs" }));
    writeFileSync(
      join(snapDir, "dom.html"),
      `<!doctype html><html lang="fr"><head><title>Docs</title></head><body><main><h1>Docs</h1>
<a href="/rapport.pdf">Rapport annuel</a></main></body></html>`,
    );
    const res = runAudit({ inputs: [join(snapRoot, PAGES_DIR)] });
    const pack = res.packFindings ?? [];
    expect(pack.length).toBeGreaterThan(0);
    for (const f of pack) expect(f.page).toBe("docs");
  });

  it("never lets a manual criterion into the NON-CONFORMITY channel", () => {
    // A manual criterion MAY still carry an advisory finding (RGAA 6.1 does, from the
    // download-link rule) and legitimately appears in the advisory channel. What must never
    // happen is it reading as an NC.
    const { nc } = partitionUnits(prdUnits(r(), "rgaa", "fr"));
    const manual = derivePackResults(r(), "rgaa")
      .filter((c) => c.status === "manual")
      .map((c) => c.id);
    for (const id of manual)
      expect(
        nc.map((u) => u.criteriaId),
        `${id} leaked into the NC channel`,
      ).not.toContain(id);
  });
});

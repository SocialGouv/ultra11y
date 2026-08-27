import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditResult } from "../src/types.js";
import { prdUnits, partitionUnits, renderBacklog, renderPerCriterion, renderPrdDoc, toRuleOnSection, writePrd } from "../src/prd.js";
import { runAudit } from "../src/audit.js";
import { derivePackResults, isProvisionalJudgmentInapplicable, packConformancePct } from "../src/standards/index.js";

const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;

const tmps: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "u11y-prd-"));
  tmps.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const AUDIT: AuditResult = {
  tool: "ultra11y",
  standard: "wcag",
  version: "9.9.9",
  schemaVersion: 2,
  date: "2026-06-29",
  scope: { inputs: ["src"], files: 3 },
  guidelines: [],
  criteria: [],
  findings: [
    {
      ruleId: "positive-tabindex",
      criteriaId: "2.4.3",
      file: "src/a.html",
      line: 9,
      col: 1,
      selectorHint: "div",
      severity: "majeur",
      message: "tabindex positif",
      remediation: "Utilisez tabindex=0",
      snippet: "<div tabindex=5>",
    },
    {
      ruleId: "img-alt-missing",
      criteriaId: "1.1.1",
      file: "src/a.html",
      line: 3,
      col: 1,
      selectorHint: "img",
      severity: "bloquant",
      message: "img sans alt",
      remediation: "Ajoutez alt",
      snippet: "<img>",
    },
    {
      ruleId: "cross-icon-only-unnamed",
      criteriaId: "4.1.2",
      file: "src/page.tsx",
      line: 5,
      col: 7,
      selectorHint: "IconButton",
      severity: "bloquant",
      message: "icône seule sans nom",
      remediation: "Passez aria-label",
      snippet: "<IconButton/>",
      related: { file: "src/IconButton.tsx", line: 2, col: 10, selectorHint: "IconButton", note: "définition du composant" },
    },
  ],
  residualRisks: [],
  conformancePct: 50,
};

describe("prdUnits", () => {
  it("groups findings by WCAG SC, ordered by severity then SC id", () => {
    const units = prdUnits(AUDIT);
    expect(units.map((u) => u.criteriaId)).toEqual(["1.1.1", "4.1.2", "2.4.3"]);
    expect(units[0]!.severity).toBe("bloquant");
    expect(units[2]!.severity).toBe("majeur");
    expect(units[0]!.label).toMatch(/^1\.1\.1 — /); // SC label resolved from the WCAG dataset
  });

  it("localizes unit title/label by lang (fr) — the W3C authorized translation, not the baked-in English", () => {
    const en = prdUnits(AUDIT, "wcag", "en").find((u) => u.criteriaId === "1.1.1")!;
    expect(en.title).toBe("Non-text Content");
    const fr = prdUnits(AUDIT, "wcag", "fr").find((u) => u.criteriaId === "1.1.1")!;
    expect(fr.title).toBe("Contenu non textuel");
    expect(fr.label).toBe("1.1.1 — Contenu non textuel");
  });

  it("flags an all-advisory unit and partitionUnits routes it to the advisory channel", () => {
    // two-h1.html: 1.3.1 has only the advisory h1-multiple finding → an advisory unit.
    const audit = runAudit({ inputs: [`${FIXTURES}egapro-feedback/fp/two-h1.html`] });
    const units = prdUnits(audit);
    const u131 = units.find((u) => u.criteriaId === "1.3.1")!;
    expect(u131.advisory).toBe(true);
    const { nc, advisory } = partitionUnits(units);
    expect(advisory.some((u) => u.criteriaId === "1.3.1")).toBe(true);
    expect(nc.some((u) => u.criteriaId === "1.3.1")).toBe(false);
  });

  it("a mixed unit (normative + advisory findings) stays NC, not advisory", () => {
    // Two <h1> (advisory) AND an img with no alt on 1.1.1 (normative NC on a DIFFERENT
    // criterion). 1.3.1 stays advisory; 1.1.1 stays NC.
    const dir = mkdtempSync(join(tmpdir(), "u11y-prd-mixed-"));
    tmps.push(dir);
    const f = join(dir, "mixed.html");
    // A skip AND two h1 on 1.3.1: h1-multiple advisory + heading-order-skip normative → mixed.
    writeFileSync(f, `<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>A</h1><h1>B</h1><h2>x</h2><h4>y</h4></main></body></html>`);
    const audit = runAudit({ inputs: [f] });
    const u131 = prdUnits(audit).find((u) => u.criteriaId === "1.3.1")!;
    expect(u131.advisory).toBe(false); // a normative heading-order-skip is present
  });
});

describe("renderBacklog", () => {
  const md = renderBacklog(AUDIT, "fr");
  it("is a single doc sectioned by priority with occurrences and remediation", () => {
    expect(md).toContain("# Plan de correction");
    expect(md).toContain("WCAG 2.2 AA");
    expect(md).toContain("## 🔴 Bloquant (2)");
    expect(md).toContain("## 🟠 Majeur (1)");
    expect(md).toContain("`src/a.html:3`");
    expect(md).toContain("Ajoutez alt");
  });
  it("renders the cross-file definition site for a related finding", () => {
    expect(md).toContain("`src/IconButton.tsx:2`");
    expect(md).toContain("↳");
  });
  it("handles an empty audit gracefully", () => {
    const empty = renderBacklog({ ...AUDIT, findings: [] }, "fr");
    expect(empty).toContain("Aucune correction");
  });
});

describe("renderPerCriterion + writePrd", () => {
  it("produces one PRD doc per SC", () => {
    const files = renderPerCriterion(AUDIT, "fr");
    expect(files.map((f) => f.name)).toEqual(["prd-1.1.1-2026-06-29.md", "prd-4.1.2-2026-06-29.md", "prd-2.4.3-2026-06-29.md"]);
    expect(files[0]!.content).toContain("# PRD — 1.1.1");
  });

  it("writes a single AUDITOR backlog file by default", () => {
    const out = tmp();
    const paths = writePrd(AUDIT, { out, lang: "fr", standard: "wcag" });
    expect(paths).toEqual([join(out, "prd-2026-06-29.md")]);
    const md = readFileSync(paths[0]!, "utf8");
    expect(md).toContain("Critère d'accessibilité"); // auditor doc title (core fr vocabulary)
    expect(md).toContain("Constat"); // auditor finding line, not the dev "Correction"
  });

  it("writes the legacy dev backlog with --format remediation", () => {
    const out = tmp();
    const paths = writePrd(AUDIT, { out, lang: "fr", format: "remediation", standard: "wcag" });
    expect(readFileSync(paths[0]!, "utf8")).toContain("Plan de correction");
  });

  it("the default audit backlog carries the technical ticket sections; --no-technical suppresses them", () => {
    const withTech = readFileSync(writePrd(AUDIT, { out: tmp(), lang: "fr", standard: "wcag", technical: true })[0]!, "utf8");
    expect(withTech).toContain("Partie technique");
    expect(withTech).toContain("**Complexité** :");
    const noTech = readFileSync(writePrd(AUDIT, { out: tmp(), lang: "fr", standard: "wcag", technical: false })[0]!, "utf8");
    expect(noTech).not.toContain("Partie technique");
    expect(noTech).toContain("**Priorité** :"); // section 1 (Priorité) stays either way
    expect(noTech).toContain("Constat"); // the auditor NC block stays
  });

  it("writes one file per SC with --split criterion", () => {
    const out = tmp();
    const paths = writePrd(AUDIT, { out, lang: "fr", split: "criterion", standard: "wcag" });
    expect(paths.length).toBe(3);
    expect(readdirSync(out).sort()).toEqual(["prd-1.1.1-2026-06-29.md", "prd-2.4.3-2026-06-29.md", "prd-4.1.2-2026-06-29.md"]);
  });
});

describe("renderPrdDoc (--format doc)", () => {
  it("emits epics, one user story per criterion, and a Given/When/Then per criterion", () => {
    const doc = renderPrdDoc(AUDIT, "en", "wcag");
    expect(doc).toContain("## Epic — ");
    expect(doc).toMatch(/### .*User story —/);
    expect(doc).toContain("As a user relying on assistive technology");
    expect(doc).toMatch(/\*\*Given\*\*.*\*\*When\*\*.*\*\*Then\*\*/);
    expect(doc).toContain("`src/a.html:3`"); // task list keeps the occurrences
  });

  it("epics + acceptance-criteria lines resolve WCAG guideline/SC titles by lang (fr)", () => {
    const doc = renderPrdDoc(AUDIT, "fr", "wcag");
    expect(doc).toContain("## Épopée — 1.1 Équivalents textuels"); // guideline title resolved by key + lang
    expect(doc).toContain("« Contenu non textuel » (WCAG 1.1.1)"); // Then clause uses the fr SC title
  });

  it("groups by RGAA theme under --standard rgaa", () => {
    // The pack view projects from r.criteria (CriterionResult[]), so populate it.
    const withCriteria: AuditResult = {
      ...AUDIT,
      criteria: [
        {
          id: "1.1.1",
          guideline: "1.1",
          status: "NC",
          findings: [{ ...AUDIT.findings[1]!, ruleId: "input-image-alt-missing", selectorHint: 'input[type="image"]', snippet: '<input type="image">' }],
        },
      ],
    };
    const doc = renderPrdDoc(withCriteria, "fr", "rgaa");
    expect(doc).toContain("## Épopée — ");
    expect(doc).toContain("RGAA"); // pack-labelled stories
  });

  it("writePrd --format doc writes a prd-doc-<date>.md file", () => {
    const out = tmp();
    const paths = writePrd(AUDIT, { out, lang: "en", format: "doc", standard: "wcag" });
    expect(paths).toEqual([join(out, "prd-doc-2026-06-29.md")]);
    expect(readFileSync(paths[0]!, "utf8")).toContain("Epic — ");
  });
});

// Task #9: PRD headers (remediation backlog / per-criterion / doc format) must show the
// pack's OWN projection rate for a pack standard, never the core WCAG `conformancePct` —
// consistent with the pack report's header (src/report.ts). Core headers stay unchanged.
describe("PRD header rate uses the pack projection tally, not core conformancePct (Task #9)", () => {
  const bad = runAudit({ inputs: [`${FIXTURES}non-conforming/bad.html`] });

  it("renderBacklog (pack) shows packConformancePct over the pack's derived criteria", () => {
    const expected = packConformancePct(derivePackResults(bad, "rgaa"));
    const md = renderBacklog(bad, "fr", "rgaa");
    expect(md).toMatch(new RegExp(`Taux de réussite automatique\\*\\* : ${expected}%`));
  });

  it("renderBacklog (core) is UNCHANGED — shows r.conformancePct", () => {
    const md = renderBacklog(bad, "fr", "wcag");
    expect(md).toMatch(new RegExp(`Taux de réussite automatique\\*\\* : ${bad.conformancePct}%`));
  });

  it("renderPrdDoc (pack) shows packConformancePct in its header", () => {
    const expected = packConformancePct(derivePackResults(bad, "rgaa"));
    const doc = renderPrdDoc(bad, "fr", "rgaa");
    expect(doc).toMatch(new RegExp(`Taux de réussite automatique\\*\\* : ${expected}%`));
  });

  it("lists provisional judgment inapplicability among the criteria still to rule on", () => {
    const derived = derivePackResults(bad, "rgaa");
    const expected = derived.filter((row) => row.status === "manual" || isProvisionalJudgmentInapplicable(row)).length;
    expect(expected).toBeGreaterThan(derived.filter((row) => row.status === "manual").length);
    expect(toRuleOnSection(bad, "rgaa", "fr")[0]).toBe(`## Critères à trancher (${expected})`);
  });

  it("renderPrdDoc (core) is UNCHANGED — shows r.conformancePct", () => {
    const doc = renderPrdDoc(bad, "fr", "wcag");
    expect(doc).toMatch(new RegExp(`Taux de réussite automatique\\*\\* : ${bad.conformancePct}%`));
  });

  it("renderPerCriterion (pack, --split criterion) stamps the same pack rate on every generated file", () => {
    const expected = packConformancePct(derivePackResults(bad, "rgaa"));
    const files = renderPerCriterion(bad, "fr", "rgaa");
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(f.content).toContain(`Taux de réussite automatique** : ${expected}%`);
  });

  it("renderPerCriterion (core, --split criterion) is UNCHANGED — every file shows r.conformancePct", () => {
    const files = renderPerCriterion(AUDIT, "fr", "wcag");
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(f.content).toContain(`Taux de réussite automatique** : ${AUDIT.conformancePct}%`);
  });
});

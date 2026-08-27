import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import { buildAdjudicationWorklist, packAutomatability } from "../src/adjudicate.js";
import { derivePackResults, loadPack } from "../src/standards/index.js";

describe("RGAA test-level automation contract", () => {
  const pack = loadPack("rgaa");

  it("classifies all 106 criteria and all 258 official tests", () => {
    expect(pack.criteria).toHaveLength(106);
    const tests = pack.criteria.flatMap((criterion) => Object.keys(criterion.tests ?? {}).map((test) => `${criterion.id}.${test}`));
    expect(tests).toHaveLength(258);
    for (const criterion of pack.criteria) {
      expect(criterion.automation, criterion.id).toBeDefined();
      expect(Object.keys(criterion.automation!.tests).sort(), criterion.id).toEqual(Object.keys(criterion.tests ?? {}).sort());
      expect(criterion.automation!.rules.map((rule) => rule.id).sort(), criterion.id).toEqual((criterion.appliesTo?.ruleIds ?? []).sort());
    }
    const tiers = pack.criteria.flatMap((criterion) => Object.values(criterion.automation!.tests));
    expect({
      static: tiers.filter((tier) => tier === "static").length,
      rendered: tiers.filter((tier) => tier === "rendered").length,
      judgment: tiers.filter((tier) => tier === "judgment").length,
    }).toEqual({ static: 27, rendered: 3, judgment: 228 });
    expect(pack.criteria.filter((criterion) => Object.values(criterion.automation!.tests).includes("judgment"))).toHaveLength(92);
  });

  it("publishes the reviewed routing of every criterion and every test in the static artifact", () => {
    const matrix = readFileSync(join(process.cwd(), "skills/ultra11y/references/rgaa-automation.md"), "utf8");
    for (const criterion of pack.criteria) expect(matrix, `missing reviewed row for ${criterion.id}`).toContain(`| ${criterion.id} |`);
    for (const criterion of pack.criteria) {
      for (const test of Object.keys(criterion.tests ?? {})) expect(matrix, `missing test ${criterion.id}.${test}`).toContain(`| ${criterion.id}.${test} |`);
    }
  });

  it("keeps the public README aligned with the generated automation contract", () => {
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    expect(readme).toContain("27 `static` tests across 19 criteria");
    expect(readme).toContain("3 `rendered` tests across 3 criteria");
    expect(readme).toContain("21 distinct criteria that can produce a deterministic `NC`");
    expect(readme).toContain("49 criteria receive a normative engine signal");
    expect(readme).toContain("228 `judgment` tests across 92 criteria");
    expect(readme).toContain("103 of 106 criteria require adjudication to earn `C`");
  });

  it("allows C by silence only on the explicit, fully covered allowlist", () => {
    expect(
      pack.criteria
        .filter((criterion) => criterion.automation?.completeBySilence)
        .map((criterion) => criterion.id)
        .sort(),
    ).toEqual(["10.1", "8.3", "8.5"]);
    expect(
      packAutomatability(
        [],
        pack.criteria.find((criterion) => criterion.id === "8.5"),
      ),
    ).toBe("static");
    expect(
      packAutomatability(
        [],
        pack.criteria.find((criterion) => criterion.id === "10.1"),
      ),
    ).toBe("static");
    expect(
      packAutomatability(
        [],
        pack.criteria.find((criterion) => criterion.id === "10.7"),
      ),
    ).toBe("judgment");
  });

  it("pins every automatable test and its decisive rules, one by one", () => {
    const automated = pack.criteria.flatMap((criterion) =>
      Object.entries(criterion.automation!.tests)
        .filter(([, tier]) => tier !== "judgment")
        .map(([test, tier]) => ({
          test: `${criterion.id}.${test}`,
          tier,
          rules: criterion
            .automation!.rules.filter((rule) => rule.effect === "decisive-nc" && rule.tests.includes(test))
            .map((rule) => rule.id)
            .sort(),
        })),
    );
    expect(automated).toEqual([
      { test: "1.1.2", tier: "rendered", rules: ["axe:area-alt"] },
      { test: "1.1.3", tier: "static", rules: ["axe:input-image-alt", "input-image-alt-missing"] },
      { test: "2.1.1", tier: "static", rules: ["axe:frame-title", "iframe-title-missing"] },
      { test: "5.7.2", tier: "static", rules: ["table-scope-invalid"] },
      { test: "5.7.3", tier: "static", rules: ["table-scope-invalid"] },
      { test: "5.7.4", tier: "static", rules: ["headers-attr-dangling"] },
      { test: "5.8.1", tier: "static", rules: ["layout-table-data-markup"] },
      { test: "6.2.1", tier: "static", rules: ["axe:link-name", "link-empty-name"] },
      { test: "7.1.1", tier: "static", rules: ["axe:button-name", "axe:input-button-name", "button-empty-name", "menuitem-empty-name"] },
      { test: "7.1.3", tier: "static", rules: ["label-in-name-mismatch"] },
      { test: "8.1.1", tier: "rendered", rules: ["pack:rgaa:doctype-missing"] },
      { test: "8.2.1", tier: "static", rules: ["axe:duplicate-id", "axe:duplicate-id-active", "axe:duplicate-id-aria", "duplicate-attribute", "duplicate-id"] },
      { test: "8.3.1", tier: "static", rules: ["document-language-missing"] },
      { test: "8.4.1", tier: "static", rules: ["axe:html-lang-valid", "html-lang-xml-lang-mismatch", "lang-invalid"] },
      { test: "8.5.1", tier: "static", rules: ["axe:document-title", "title-missing-empty"] },
      { test: "8.10.2", tier: "static", rules: ["pack:rgaa:dir-value-invalid"] },
      { test: "9.3.1", tier: "static", rules: ["axe:list", "axe:listitem", "list-structure"] },
      { test: "9.3.2", tier: "static", rules: ["axe:list", "axe:listitem", "list-structure"] },
      { test: "9.3.3", tier: "static", rules: ["axe:definition-list", "axe:dlitem", "list-structure"] },
      { test: "10.1.1", tier: "static", rules: ["presentational-element"] },
      { test: "10.1.2", tier: "static", rules: ["presentational-attribute"] },
      { test: "10.1.3", tier: "static", rules: ["presentational-spacing"] },
      { test: "10.7.1", tier: "rendered", rules: ["dyn-focus-visible"] },
      { test: "10.12.1", tier: "static", rules: ["letter-spacing-important", "line-height-important", "word-spacing-important"] },
      { test: "11.1.1", tier: "static", rules: ["axe:label", "axe:select-name", "control-label-missing"] },
      { test: "11.5.1", tier: "static", rules: ["radio-checkbox-group-ungrouped"] },
      { test: "11.6.1", tier: "static", rules: ["axe:fieldset", "fieldset-legend-missing"] },
      { test: "11.8.2", tier: "static", rules: ["pack:rgaa:optgroup-without-label"] },
      { test: "11.9.1", tier: "static", rules: ["form-button-empty-name"] },
      { test: "11.9.2", tier: "static", rules: ["form-label-in-name-mismatch"] },
    ]);
  });

  it("scopes representative candidate signals to the exact official tests they can inform", () => {
    const candidateTests = (criterionId: string, ruleId: string) =>
      pack.criteria.find((criterion) => criterion.id === criterionId)?.automation?.rules.find((rule) => rule.id === ruleId && rule.effect === "candidate")
        ?.tests;

    expect(candidateTests("1.1", "img-alt-missing")).toEqual(["1"]);
    expect(candidateTests("4.3", "media-no-track")).toEqual(["1"]);
    expect(candidateTests("8.4", "axe:html-xml-lang-mismatch")).toEqual(["1"]);
    expect(candidateTests("11.1", "label-for-dangling")).toEqual(["2"]);
    expect(candidateTests("13.1", "meta-refresh-redirect")).toEqual(["2"]);
    expect(pack.criteria.find((criterion) => criterion.id === "10.5")?.automation?.rules).toEqual([]);
  });

  it("routes all 92 judgment criteria to the AI, including those provisionally inapplicable", () => {
    const dir = mkdtempSync(join(tmpdir(), "u11y-rgaa-judgment-"));
    const file = join(dir, "page.html");
    writeFileSync(file, '<!doctype html><html lang="fr"><head><title>T</title></head><body><main><h1>T</h1><p>Texte</p></main></body></html>');
    const audit = runAudit({ inputs: [file] });
    const derived = derivePackResults(audit, "rgaa");
    const openJudgment = derived
      .filter(
        (row) => row.status === "manual" && Object.values(pack.criteria.find((criterion) => criterion.id === row.id)!.automation!.tests).includes("judgment"),
      )
      .map((row) => row.id)
      .sort();
    const items = buildAdjudicationWorklist(audit, { standard: "rgaa" });
    const worklist = new Map(items.map((item) => [item.criteriaId, item]));
    const allJudgment = pack.criteria.filter((criterion) => Object.values(criterion.automation!.tests).includes("judgment")).map((criterion) => criterion.id);
    expect(openJudgment.length).toBeLessThan(92);
    expect(allJudgment).toHaveLength(92);
    expect(allJudgment.filter((id) => !worklist.has(id))).toEqual([]);
    expect(items).toHaveLength(98);
    for (const id of allJudgment) {
      const criterion = pack.criteria.find((row) => row.id === id)!;
      const expected = Object.entries(criterion.automation!.tests)
        .filter(([, tier]) => tier === "judgment")
        .map(([test]) => `${id}.${test}`);
      expect(worklist.get(id)?.testIds, id).toEqual(expect.arrayContaining(expected));
    }
  });

  it("routes a non-conclusive static signal into the adjudication worklist", () => {
    const dir = mkdtempSync(join(tmpdir(), "u11y-rgaa-candidate-"));
    const file = join(dir, "page.html");
    writeFileSync(
      file,
      '<!doctype html><html lang="fr"><head><title>T</title></head><body><main><h1>T</h1><p style="color:#777;background:#777">Texte</p></main></body></html>',
    );
    const audit = runAudit({ inputs: [file] });
    const criterion = derivePackResults(audit, "rgaa").find((row) => row.id === "3.2")!;
    expect(criterion.status).toBe("manual");
    expect(criterion.findings).toEqual([]);
    expect(criterion.candidateFindings?.some((finding) => finding.ruleId === "contrast-literal")).toBe(true);

    const item = buildAdjudicationWorklist(audit, { standard: "rgaa" }).find((row) => row.criteriaId === "3.2")!;
    expect(item.signals?.some((signal) => signal.ruleId === "contrast-literal" && signal.tests.length > 0)).toBe(true);
  });
});

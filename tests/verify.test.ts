import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import { renderReport, renderPackReport } from "../src/report.js";
import { buildWorklist, applyVerdicts, writeWorklist, formatWorklist, AUDITOR_OCCURRENCE, type VerifyItem } from "../src/verify.js";
import { registerRuntimePack, loadPack, derivePackResults } from "../src/standards/index.js";
import { renderAuditorUnit, occurrenceLine } from "../src/auditor.js";
import type { AuditResult, Finding } from "../src/types.js";
import type { PrdUnit } from "../src/prd.js";

const FIX = new URL("./fixtures/", import.meta.url).pathname;
const bad = runAudit({ inputs: [`${FIX}non-conforming/bad.html`] });
const good = runAudit({ inputs: [`${FIX}conforming/good.html`] });
const report = renderReport(bad, "fr");

describe("buildWorklist", () => {
  it("turns each non-conformity into a claim↔criterion↔element item", () => {
    const items = buildWorklist(report);
    expect(items.length).toBeGreaterThan(5);
    const first = items[0]!;
    expect(first.criteriaId).toMatch(/^\d+\.\d+\.\d+$/); // WCAG success-criterion id
    expect(first.file).toContain("bad.html");
    expect(first.line).toBeGreaterThan(0);
    expect(first.claim.length).toBeGreaterThan(0);
    expect(first.verdict).toBeNull();
  });

  it("respects --max-verify", () => {
    expect(buildWorklist(report, "wcag", 2)).toHaveLength(2);
  });

  // Parser-twin: a report containing advisory (« Recommandation ») blocks must yield the
  // EXACT same worklist as one without them — advisory blocks are deliberately rendered
  // without the criterion-line grammar the worklist parser keys on (src/verify.ts
  // auditorCriterionLine), so they never enter the non-conformity worklist.
  it("advisory recommendation blocks do not enter the worklist (parser-twin)", () => {
    const dir = mkdtempSync(join(tmpdir(), "u11y-adv-"));
    // 1.3.1 advisory-only (two <h1> → h1-multiple) + 1.1.1 normative NC (img with no alt).
    const withAdvisory = join(dir, "mixed.html");
    writeFileSync(
      withAdvisory,
      `<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>A</h1><h1>B</h1><img src="x.png"></main></body></html>`,
    );
    const audit = runAudit({ inputs: [withAdvisory] });
    // Sanity: the audit really carries an advisory finding AND a normative one.
    expect(audit.findings.some((f) => f.advisory)).toBe(true);
    expect(audit.findings.some((f) => !f.advisory)).toBe(true);

    const reportWithAdvisory = renderReport(audit, "en");
    expect(reportWithAdvisory).toMatch(/Recommendations \(non-normative\)/);

    // The twin: the same audit with every advisory finding stripped (so no advisory blocks
    // render at all). The worklist must be identical.
    const stripped: AuditResult = structuredClone(audit);
    stripped.findings = stripped.findings.filter((f) => !f.advisory);
    for (const c of stripped.criteria) c.findings = c.findings.filter((f) => !f.advisory);
    const reportWithout = renderReport(stripped, "en");
    expect(reportWithout).not.toMatch(/Recommendations \(non-normative\)/);

    const twinKeys = (md: string) =>
      buildWorklist(md, "wcag", Number.POSITIVE_INFINITY).map((i) => `${i.criteriaId}|${i.file}|${i.line}|${i.selector}|${i.claim}`);
    const a = twinKeys(reportWithAdvisory);
    const b = twinKeys(reportWithout);
    expect(a).toEqual(b);
    // And the advisory criterion (1.3.1) is NOT in the worklist.
    expect(buildWorklist(reportWithAdvisory, "wcag", Number.POSITIVE_INFINITY).some((i) => i.criteriaId === "1.3.1")).toBe(false);
    // …while the normative one (1.1.1) IS.
    expect(a.some((k) => k.startsWith("1.1.1|"))).toBe(true);
  });

  it("parses a pack's NC header by the PACK'S OWN idPattern grammar, not a fixed 2-segment shape (e.g. Section 508 E205.4)", () => {
    registerRuntimePack({
      key: "synth508verify",
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
  - focus indicator missing
## 3. z
## 4. NA
## 5. manual
`;
    const items = buildWorklist(md, "synth508verify");
    expect(items).toHaveLength(1);
    expect(items[0]!.criteriaId).toBe("E205.4");
  });

  it("does not mis-align positional captures when the pack's idPattern itself contains capturing groups (e.g. Section 508 E205.4 as `^E(\\d+)\\.(\\d+)$`)", () => {
    registerRuntimePack({
      key: "synth508capturegroups",
      name: "Synth508Groups",
      org: "O",
      country: "US",
      baseVersion: "1",
      wcagVersion: "2.2",
      locales: ["en"],
      defaultLocale: "en",
      license: "x",
      source: "x",
      attribution: "x",
      idPattern: "^E(\\d+)\\.(\\d+)$",
      themes: [{ number: 1, name: { en: "Interface" }, count: 1 }],
      criteria: [{ id: "E205.4", theme: 1, title: { en: "Focus Visible" }, titlePlain: { en: "Focus Visible" }, wcag: ["2.4.7"] }],
    });
    const md = `# Report — Synth508Groups 1
- **Rate** : 50%
## 1. x
## 2. y
- **E205.4 — Focus Visible** — \`a.html:42\` (\`button.cta\`)
  - focus indicator missing
## 3. z
## 4. NA
## 5. manual
`;
    const items = buildWorklist(md, "synth508capturegroups");
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.criteriaId).toBe("E205.4");
    expect(item.claim).toBe("focus indicator missing");
    expect(item.file).toBe("a.html");
    expect(item.line).toBe(42);
    expect(Number.isNaN(item.line)).toBe(false);
    expect(item.selector).toBe("button.cta");
  });
});

// Task 2: `renderAuditorUnit` now natively emits the full owner-validated ticket
// structure (Priorité, Partie technique, Contexte de reproduction). The verify worklist
// parser keys ONLY on the section-1 criterion line + the section-2 occurrence checklist,
// which stay before any newly-introduced heading. These twins prove the new sections are
// worklist-INERT — the round-trip stays byte-for-byte identical to the pre-change shape.
describe("parser-twin: the full ticket template is worklist-inert (Task 2)", () => {
  const NO_CAP = Number.POSITIVE_INFINITY;
  const finding = (file: string, line: number, sel: string, msg: string, advisory = false): Finding => ({
    ruleId: "r",
    criteriaId: "1.3.1",
    file,
    line,
    col: 1,
    selectorHint: sel,
    severity: "bloquant",
    message: msg,
    remediation: "Corrigez l'élément cité",
    snippet: "<x>",
    ...(advisory ? { advisory: true } : {}),
  });
  const ncUnit = (findings: Finding[]): PrdUnit => ({
    criteriaId: "1.3.1",
    title: "Info and Relationships",
    label: "1.3.1 — Info and Relationships",
    refs: [],
    severity: "bloquant",
    findings,
  });
  const keys = (md: string) => buildWorklist(md, "wcag", NO_CAP).map((i) => `${i.criteriaId}|${i.file}|${i.line}|${i.selector}|${i.claim}`);

  it("the NEW full template yields the SAME worklist as the pre-change occurrence-only template", () => {
    const u = ncUnit([finding("src/a.tsx", 3, "img", "image sans alt"), finding("src/b.tsx", 7, "svg", "svg sans titre")]);
    // Pre-change shape: criterion line + occurrence checklist only (no Priorité, no
    // Partie technique / Contexte de reproduction). Hand-built to the exact grammar verify parses.
    const legacy = [
      "### 🔴 1.3.1 — Info and Relationships",
      "",
      "**Success criterion** : 1.3.1 — Info and Relationships",
      "",
      "- [ ] `src/a.tsx:3` (`img`) — image sans alt",
      "- [ ] `src/b.tsx:7` (`svg`) — svg sans titre",
      "",
    ].join("\n");
    const full = renderAuditorUnit(u, "wcag", "en", { heading: "###" }).join("\n");
    // The full template really does carry the new sections…
    expect(full).toContain("Technical details");
    expect(full).toContain("Priority");
    // …yet the worklist is identical to the minimal one.
    expect(keys(full)).toEqual(keys(legacy));
    expect(keys(full)).toHaveLength(2);
  });

  it("`--no-technical` and the default full render produce the SAME worklist", () => {
    const u = ncUnit([finding("src/a.tsx", 3, "img", "image sans alt")]);
    const withTech = renderAuditorUnit(u, "wcag", "en", { heading: "###" }).join("\n");
    const noTech = renderAuditorUnit(u, "wcag", "en", { heading: "###", technical: false }).join("\n");
    expect(noTech).not.toContain("Technical details");
    expect(keys(withTech)).toEqual(keys(noTech));
  });

  // Carried-over Task-1 review item: a MIXED unit (normative NC findings + advisory findings)
  // must exclude the advisory occurrences from the parseable checklist — they ride in a
  // distinct, NON-parseable « Related recommendations » sub-list instead.
  it("a mixed NC unit yields a worklist with ONLY the normative occurrences", () => {
    const u = ncUnit([
      finding("src/a.tsx", 3, "img", "image sans alt"), // normative
      finding("src/b.tsx", 7, "h1", "second h1 non normatif", true), // advisory
    ]);
    const md = renderAuditorUnit(u, "wcag", "en", { heading: "###" }).join("\n");
    const items = buildWorklist(md, "wcag", NO_CAP);
    expect(items).toHaveLength(1);
    expect(items[0]!.file).toBe("src/a.tsx");
    expect(items.some((i) => i.file === "src/b.tsx")).toBe(false);
    // The advisory occurrence is still shown, just outside the parseable checklist.
    expect(md).toContain("src/b.tsx:7");
    expect(md).toContain("Related recommendations");
  });
});

// THE critical anti-hallucination guard for Phase 4: report.ts §2 now renders one
// auditor block PER CRITERION (not one flat bullet per finding), so `buildWorklist`
// must walk the criterion↔occurrence structure correctly. If this guard didn't exist
// and the parsing regex silently under/over-matched, `verify` would gate the WRONG
// number of claims (or none at all) without any test ever noticing.
describe("round-trip guard: buildWorklist(renderReport(...)) recovers EXACTLY the fixture's NC findings", () => {
  const NO_CAP = Number.MAX_SAFE_INTEGER;
  // The worklist recovers only the NORMATIVE occurrences: advisory findings riding along
  // in a mixed unit (bad.html's 1.3.1 carries an advisory h1-missing) are excluded from the
  // parseable checklist per the Task-1 review item, so the count is the normative subset.
  const normativeCount = bad.findings.filter((f) => !f.advisory).length;

  it("core WCAG, fr: item count == the normative NC finding count", () => {
    const items = buildWorklist(renderReport(bad, "fr"), "wcag", NO_CAP);
    expect(items.length).toBe(normativeCount);
    expect(items.length).toBeGreaterThan(0);
  });

  it("core WCAG, en: item count == the normative NC finding count", () => {
    const items = buildWorklist(renderReport(bad, "en"), "wcag", NO_CAP);
    expect(items.length).toBe(normativeCount);
  });

  it("RGAA pack, fr: item count == the pack-projected NORMATIVE finding count (a WCAG finding may fan out to several RGAA criteria)", () => {
    const expectedCount = derivePackResults(bad, "rgaa").reduce((n, p) => n + p.findings.filter((f) => !f.advisory).length, 0);
    const items = buildWorklist(renderPackReport(bad, loadPack("rgaa"), "fr"), "rgaa", NO_CAP);
    expect(items.length).toBe(expectedCount);
    expect(items.length).toBeGreaterThan(0);
  });

  it("RGAA pack, en: item count == the pack-projected NORMATIVE finding count", () => {
    const expectedCount = derivePackResults(bad, "rgaa").reduce((n, p) => n + p.findings.filter((f) => !f.advisory).length, 0);
    const items = buildWorklist(renderPackReport(bad, loadPack("rgaa"), "en"), "rgaa", NO_CAP);
    expect(items.length).toBe(expectedCount);
  });

  it("a conforming report round-trips to zero items (no false positives)", () => {
    expect(buildWorklist(renderReport(good, "fr"), "wcag", NO_CAP)).toHaveLength(0);
  });

  it("every item's criteriaId/file/line/claim is a real, non-empty value (no partial/garbled captures)", () => {
    const items = buildWorklist(renderReport(bad, "en"), "wcag", NO_CAP);
    for (const it of items) {
      expect(it.criteriaId).toMatch(/^\d+\.\d+\.\d+$/);
      expect(it.file.length).toBeGreaterThan(0);
      expect(it.line).toBeGreaterThan(0);
      expect(it.claim.length).toBeGreaterThan(0);
    }
  });

  it("still verifies a LEGACY (pre-Phase-4) flat-bullet report via the fallback parser", () => {
    const legacy = [
      "# Report",
      "- **Rate** : 50%",
      "## 1. x",
      "## 2. y",
      "- **1.4.3 — Contrast (Minimum)** — `a.html:1` (`div`)",
      "  - contrast too low",
      "  - _Fix :_ increase contrast",
      "## 3. z",
      "## 4. NA",
      "## 5. manual",
      "",
    ].join("\n");
    const items = buildWorklist(legacy, "wcag");
    expect(items).toHaveLength(1);
    expect(items[0]!.criteriaId).toBe("1.4.3");
    expect(items[0]!.claim).toBe("contrast too low");
  });
});

describe("applyVerdicts", () => {
  const base = (): VerifyItem[] => buildWorklist(report, "wcag", 3);

  it("passes when every claim is supported", () => {
    const items = base().map((i) => ({ ...i, verdict: "supported" as const }));
    expect(applyVerdicts(items).ok).toBe(true);
  });

  it("fails on a refuted or unsupported claim", () => {
    const items = base().map((i, n) => ({ ...i, verdict: n === 0 ? ("refuted" as const) : ("supported" as const) }));
    const r = applyVerdicts(items);
    expect(r.ok).toBe(false);
    expect(r.refuted).toBe(1);
  });

  it("fails when a claim is left unadjudicated", () => {
    const items = base(); // verdicts still null
    const r = applyVerdicts(items);
    expect(r.ok).toBe(false);
    expect(r.unadjudicated).toBe(3);
  });

  it("rejects an unknown/typo verdict token instead of silently passing", () => {
    const items = base().map((i) => ({ ...i, verdict: "conforming" as unknown as VerifyItem["verdict"] }));
    const r = applyVerdicts(items);
    expect(r.ok).toBe(false);
  });

  it("with an `expected` worklist, an empty verdicts set FAILS on coverage (missing NCs)", () => {
    const expected = base();
    const r = applyVerdicts([], expected);
    expect(r.ok).toBe(false);
    expect(r.missing).toBe(expected.length);
    expect(r.total).toBe(expected.length);
  });

  it("with an `expected` worklist, dropping one to-be-refuted item is caught as missing", () => {
    const expected = base();
    const items = expected.slice(1).map((i) => ({ ...i, verdict: "supported" as const })); // hide item 0
    const r = applyVerdicts(items, expected);
    expect(r.ok).toBe(false);
    expect(r.missing).toBe(1);
  });

  it("with an `expected` worklist, full coverage all-supported passes", () => {
    const expected = base();
    const items = expected.map((i) => ({ ...i, verdict: "supported" as const }));
    expect(applyVerdicts(items, expected).ok).toBe(true);
  });

  it("normalizes case: 'Refuted' fails the gate, 'Supported' passes", () => {
    const refuted = base().map((i) => ({ ...i, verdict: "Refuted" as unknown as VerifyItem["verdict"] }));
    expect(applyVerdicts(refuted).ok).toBe(false);
    const supported = base().map((i) => ({ ...i, verdict: "Supported" as unknown as VerifyItem["verdict"] }));
    expect(applyVerdicts(supported).ok).toBe(true);
  });

  it("accepts 'partial' as supporting the non-conformity", () => {
    const items = base().map((i) => ({ ...i, verdict: "partial" as const }));
    expect(applyVerdicts(items).ok).toBe(true);
  });
});

describe("formatWorklist (judgment grounding)", () => {
  it("grounds each SC on its W3C Understanding doc and a pre-completion validation checklist", () => {
    const md = formatWorklist(buildWorklist(report, "wcag", 3), false);
    expect(md).toContain("Understanding");
    expect(md).toContain("Pre-completion checklist");
  });

  // Scoped fix (Task 5): the worklist's grounding line used to print the raw baked
  // English `sc.title` even in `--lang fr`. It now resolves through `scTitle(id, lang)`
  // like every other renderer, so a `--lang fr` verify worklist is fully French.
  it("localizes the grounding SC title through scTitle(id, lang) instead of the raw English bake", () => {
    const items = buildWorklist(renderReport(bad, "en"), "wcag", 1);
    expect(items[0]!.criteriaId).toBe("1.1.1"); // Non-text Content / Contenu non textuel

    const fr = formatWorklist(items, false, "wcag", "fr");
    expect(fr).toContain("Contenu non textuel"); // W3C authorized French title
    expect(fr).not.toContain("Non-text Content");

    const en = formatWorklist(items, false, "wcag", "en");
    expect(en).toContain("Non-text Content");
  });
});

describe("writeWorklist", () => {
  it("writes VERIFY.todo.json + VERIFY.md", () => {
    const out = join(tmpdir(), "ultra11y-verify");
    const { todoPath, mdPath, count } = writeWorklist(buildWorklist(report, "wcag", 5), out, true);
    expect(existsSync(todoPath)).toBe(true);
    expect(existsSync(mdPath)).toBe(true);
    expect(count).toBe(5);
    expect(readFileSync(mdPath, "utf8")).toContain("--semantic");
  });
});

// Pins the shared renderer (src/auditor.ts `occurrenceLine`) directly to the parser it
// must stay byte-compatible with (`AUDITOR_OCCURRENCE`, src/verify.ts:48) — the checkbox
// marker line has to match, and the advisory `💡` line has to NOT match, so the two can
// never drift apart across future edits to either side.
describe("occurrenceLine ↔ AUDITOR_OCCURRENCE (renderer/parser coupling)", () => {
  const sampleFinding: Finding = {
    ruleId: "r",
    criteriaId: "1.1.1",
    file: "src/a.tsx",
    line: 3,
    col: 1,
    selectorHint: "img",
    severity: "bloquant",
    message: "image sans alt",
    remediation: "Corrigez l'élément cité",
    snippet: "<img>",
  };

  it("the checkbox marker satisfies the worklist parser", () => {
    expect(AUDITOR_OCCURRENCE.test(occurrenceLine(sampleFinding, "en", { marker: "checkbox" }))).toBe(true);
  });

  it("the advisory marker deliberately does NOT satisfy the worklist parser", () => {
    expect(AUDITOR_OCCURRENCE.test(occurrenceLine(sampleFinding, "en", { marker: "advisory" }))).toBe(false);
  });
});

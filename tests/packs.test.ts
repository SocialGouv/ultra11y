import { describe, it, expect } from "vitest";
import {
  loadPack,
  getPack,
  isCore,
  hasStandard,
  listStandards,
  packsForSc,
  resolveStandard,
  derivePackResults,
  registerRuntimePack,
  title as packTitle,
  vocabularyFor,
} from "../src/standards/index.js";
import { hasSC, knownScStatus } from "../src/wcag.js";
import type { AuditResult, Finding } from "../src/types.js";
import { INAPPLICABLE_STATUS } from "../src/types.js";

const finding = (criteriaId: string, ruleId = "x"): Finding => ({
  ruleId,
  criteriaId,
  file: "a.html",
  line: 1,
  col: 1,
  selectorHint: "x",
  severity: "bloquant",
  message: "m",
  remediation: "r",
  snippet: "s",
});

// A small synthetic WCAG-keyed AuditResult, so derive() is tested on a fixed input
// rather than a full live audit.
const synthetic = (): AuditResult => ({
  tool: "ultra11y",
  standard: "wcag",
  version: "test",
  schemaVersion: 2,
  date: "2026-01-01",
  scope: { inputs: ["a.html"], files: 1 },
  guidelines: [],
  criteria: [
    // A realistic finding (html-lang-missing → 3.1.1) so the applicability-aware derive
    // attaches it to RGAA 8.3 (default-language), not to every 3.1.1-mapped sibling.
    { id: "3.1.1", guideline: "3.1", status: "NC", findings: [finding("3.1.1", "html-lang-missing")] },
    { id: "1.1.1", guideline: "1.1", status: "C", findings: [] },
  ],
  findings: [finding("3.1.1", "html-lang-missing")],
  residualRisks: [],
  conformancePct: 50,
});

describe("standards registry", () => {
  it("knows the WCAG core and the RGAA pack", () => {
    expect(isCore("wcag")).toBe(true);
    expect(isCore("rgaa")).toBe(false);
    expect(hasStandard("wcag")).toBe(true);
    expect(hasStandard("rgaa")).toBe(true);
    expect(hasStandard("nope")).toBe(false);
    expect(listStandards()).toContain("wcag");
    expect(listStandards()).toContain("rgaa");
  });

  it("loadPack throws on an unknown key (never silent fallback)", () => {
    expect(() => loadPack("nope")).toThrow(/unknown standards pack/);
    expect(getPack("nope")).toBeUndefined();
    expect(loadPack("rgaa").key).toBe("rgaa");
  });

  it("resolveStandard defaults to wcag, lower-cases packs, throws on unknown", () => {
    expect(resolveStandard(undefined)).toBe("wcag");
    expect(resolveStandard(true)).toBe("wcag");
    expect(resolveStandard("rgaa")).toBe("rgaa");
    expect(resolveStandard("RGAA")).toBe("rgaa");
    expect(() => resolveStandard("nope")).toThrow(/unknown standard/);
  });

  it("packsForSc reverse-maps a WCAG SC to pack criteria", () => {
    const hits = packsForSc("3.1.1");
    const rgaa = hits.find((h) => h.key === "rgaa");
    expect(rgaa).toBeDefined();
    expect(rgaa!.ids).toContain("8.3");
  });
});

describe("RGAA pack schema", () => {
  const pack = loadPack("rgaa");
  const idRe = new RegExp(pack.idPattern);

  it("declares a valid header (key, default locale, attribution)", () => {
    expect(pack.key).toBe("rgaa");
    expect(pack.key).not.toBe("wcag"); // reserved
    expect(pack.locales).toContain(pack.defaultLocale);
    expect(pack.attribution).toMatch(/DINUM/);
    expect(pack.themes.length).toBe(13);
    expect(pack.criteria.length).toBe(106);
  });

  it("every theme + criterion carries the default locale", () => {
    for (const t of pack.themes) expect(t.name[pack.defaultLocale], `theme ${t.number}`).toBeDefined();
    for (const c of pack.criteria) {
      expect(c.id, c.id).toMatch(idRe);
      expect(c.title[pack.defaultLocale], `title ${c.id}`).toBeDefined();
      expect(c.titlePlain[pack.defaultLocale], `titlePlain ${c.id}`).toBeDefined();
    }
  });

  it("maps every criterion to well-formed SCs; any SC outside the AA core is a REAL known WCAG SC (out-of-core or removed), never unknown", () => {
    for (const c of pack.criteria) {
      expect(c.wcag.length, `wcag of ${c.id}`).toBeGreaterThan(0);
      for (const sc of c.wcag) {
        expect(sc, `SC shape ${sc}`).toMatch(/^\d+\.\d+\.\d+$/);
        // RGAA (a WCAG 2.1 standard) may map to SCs outside our WCAG 2.2 AA core; today
        // the ONLY such SC is 4.1.1 Parsing (obsolete, removed in 2.2) — but the
        // assertion is against the real SC-universe classification, not a hardcoded id,
        // so a future pack citing a real AAA SC is equally tolerated.
        if (!hasSC(sc)) expect(knownScStatus(sc), `${c.id} → ${sc} must be a real out-of-core/removed WCAG SC`).toMatch(/^(out-of-core|removed)$/);
      }
    }
  });

  it("all but one criterion (8.1 doctype → removed 4.1.1) map into the WCAG 2.2 AA core", () => {
    const orphaned = pack.criteria.filter((c) => !c.wcag.some((sc) => hasSC(sc))).map((c) => c.id);
    expect(orphaned).toEqual(["8.1"]);
  });
});

describe("pack locales are decoupled from the UI frame's Lang (fr|en)", () => {
  it("registers a de-only pack and renders its title/vocabulary through the 'en' UI frame", () => {
    const r = registerRuntimePack({
      key: "deonly",
      name: "DeOnly",
      org: "O",
      country: "DE",
      baseVersion: "1",
      wcagVersion: "2.2",
      locales: ["de"],
      defaultLocale: "de",
      license: "x",
      source: "x",
      attribution: "x",
      idPattern: "^\\d+\\.\\d+$",
      vocabulary: { criterion: { de: "Kriterium" } },
      themes: [{ number: 1, name: { de: "Bilder" }, count: 1 }],
      criteria: [{ id: "1.1", theme: 1, title: { de: "Alternativtext" }, titlePlain: { de: "Alternativtext" }, wcag: ["1.1.1"] }],
    });
    expect(r.ok).toBe(true);
    const pack = loadPack("deonly");
    // Rendered with the UI frame's "en" — falls back through the pack's own defaultLocale
    // ("de") since the pack carries no "en" string at all, per the localize() fallback chain.
    expect(packTitle(pack, pack.criteria[0]!, "en")).toBe("Alternativtext");
    expect(vocabularyFor("deonly", "en").criterion).toBe("Kriterium");
  });
});

describe("derivePackResults (WCAG → pack projection)", () => {
  it("projects a WCAG-keyed audit onto RGAA criteria with NC-dominates", () => {
    const results = derivePackResults(synthetic(), "rgaa");
    const byId = new Map(results.map((r) => [r.id, r]));
    // RGAA 8.3 maps to WCAG 3.1.1 (NC in the fixture) → NC, carrying the finding.
    expect(byId.get("8.3")?.status).toBe("NC");
    expect(byId.get("8.3")?.findings.length).toBe(1);
    // RGAA 1.1 maps to 1.1.1 (C in the fixture) → C.
    expect(byId.get("1.1")?.status).toBe("C");
    // A criterion whose SCs are absent from the audit → NA.
    const na = results.find((r) => r.scs.every((sc) => sc !== "3.1.1" && sc !== "1.1.1"));
    expect(na?.status).toBe(INAPPLICABLE_STATUS);
  });

  it("flags a criterion whose ENTIRE WCAG mapping is out-of-core/removed as manual + outOfScope, never a silent NA", () => {
    // RGAA 8.1 (doctype) maps ONLY to the removed 4.1.1 Parsing — the engine has no core
    // SC to project a verdict from, so it must surface as an explicit out-of-scope manual
    // check, not disappear as an ordinary "not applicable".
    const results = derivePackResults(synthetic(), "rgaa");
    const byId = new Map(results.map((r) => [r.id, r]));
    const doctype = byId.get("8.1");
    expect(doctype?.status).toBe("manual");
    expect(doctype?.outOfScope).toBe(true);
    // an ordinary in-core-but-absent-from-audit criterion stays a plain NA, no outOfScope flag
    const na = results.find((r) => r.scs.every((sc) => sc !== "3.1.1" && sc !== "1.1.1"));
    expect(na?.outOfScope).toBeUndefined();
  });
});

describe("derivePackResults — normativity/severity overrides (pack projection only)", () => {
  // A synthetic pack shipping ONE declarative rule (advisory) routed onto criterion "1.1"
  // via appliesTo, plus an override that re-normativizes + re-grades it. The override must
  // change the PACK projection without touching the core AuditResult.
  function packWith(overrides?: Record<string, unknown>) {
    return {
      key: overrides ? "ovr" : "noovr",
      name: "Ovr",
      org: "O",
      country: "US",
      baseVersion: "1",
      wcagVersion: "2.2",
      locales: ["en"],
      defaultLocale: "en",
      license: "x",
      source: "x",
      attribution: "x",
      idPattern: "^\\d+\\.\\d+$",
      rules: [
        {
          id: "demo",
          criterion: "1.1",
          wcag: ["1.1.1"],
          severity: "mineur",
          advisory: true,
          match: { tag: "a" },
          message: { en: "m", fr: "m" },
          remediation: { en: "x", fr: "x" },
        },
      ],
      ...(overrides ? { overrides } : {}),
      themes: [{ number: 1, name: { en: "T" }, count: 1 }],
      criteria: [
        { id: "1.1", theme: 1, title: { en: "A" }, titlePlain: { en: "A" }, wcag: ["1.1.1"], appliesTo: { ruleIds: ["pack:ovr:demo", "pack:noovr:demo"] } },
      ],
    };
  }

  // A WCAG-keyed audit whose ONLY pack signal is an ADVISORY pack-rule finding riding in
  // packFindings; the core criterion 1.1.1 is a clean C with no findings.
  function auditWithPackFinding(ruleId: string): AuditResult {
    return {
      ...synthetic(),
      criteria: [{ id: "1.1.1", guideline: "1.1", status: "C", findings: [] }],
      findings: [],
      packFindings: [{ ...finding("1.1.1", ruleId), advisory: true, severity: "mineur" }],
    };
  }

  it("without an override the pack-rule finding stays advisory → the criterion is NOT NC", () => {
    registerRuntimePack(packWith(undefined));
    const rows = derivePackResults(auditWithPackFinding("pack:noovr:demo"), "noovr");
    const c = rows.find((r) => r.id === "1.1")!;
    expect(c.status).not.toBe("NC");
    expect(c.findings.some((f) => f.ruleId === "pack:noovr:demo")).toBe(true);
  });

  it("an override flipping advisory→normative makes the criterion NC in the pack projection but leaves the core result untouched", () => {
    registerRuntimePack(packWith({ "pack:ovr:demo": { advisory: false, severity: "majeur" } }));
    const audit = auditWithPackFinding("pack:ovr:demo");
    const rows = derivePackResults(audit, "ovr");
    const c = rows.find((r) => r.id === "1.1")!;
    expect(c.status).toBe("NC"); // re-normativized within the projection
    expect(c.findings.find((f) => f.ruleId === "pack:ovr:demo")?.severity).toBe("majeur"); // re-graded
    // Core result is UNTOUCHED: the SC stays C, and the original packFindings entry keeps
    // its advisory flag (derive worked on a copy, never mutated the source).
    expect(audit.criteria.find((cr) => cr.id === "1.1.1")?.status).toBe("C");
    expect(audit.packFindings?.[0]?.advisory).toBe(true);
    expect(audit.packFindings?.[0]?.severity).toBe("mineur");
  });
});

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import {
  derivePackResults,
  enableSecondaryMapping,
  loadPack,
  packConformancePct,
  registerRuntimePack,
  type PackCriterionResult,
} from "../src/standards/index.js";
import { toDynamicResult, mergeDynamic } from "../src/scan.js";
import type { AuditResult, Finding, Status } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-derive-"));
function auditHtml(html: string) {
  const f = join(dir, `page-${Math.abs(hash(html))}.html`);
  writeFileSync(f, html);
  return runAudit({ inputs: [f] });
}
// deterministic label helper (no Math.random / Date in tests here)
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const statusOf = (rows: ReturnType<typeof derivePackResults>, id: string) => rows.find((r) => r.id === id)?.status;

describe("RGAA applicability — an image-alt NC no longer over-projects", () => {
  // A page whose ONLY failure is an informative <img> with no alt (WCAG 1.1.1).
  const audit = auditHtml(`<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>H</h1><img src="hero.png"></main></body></html>`);
  const rows = derivePackResults(audit, "rgaa");

  it("routes the ambiguous missing-alt finding to RGAA 1.1 as an adjudication signal", () => {
    expect(statusOf(rows, "1.1")).toBe("manual");
    const c11 = rows.find((r) => r.id === "1.1")!;
    expect(c11.findings).toEqual([]);
    expect(c11.candidateFindings?.some((f) => f.ruleId === "img-alt-missing")).toBe(true);
  });

  it("leaves the plainly-inapplicable image criteria NON-NC (CAPTCHA 1.4/1.5, detailed-description 1.6/1.7)", () => {
    for (const id of ["1.4", "1.5", "1.6", "1.7"]) {
      expect(statusOf(rows, id), `RGAA ${id} must not be NC`).not.toBe("NC");
    }
  });

  it("leaves downloadable-document (13.3/13.4) and layout-table (5.3) criteria NON-NC", () => {
    for (const id of ["13.3", "13.4", "5.3"]) {
      expect(statusOf(rows, id), `RGAA ${id} must not be NC`).not.toBe("NC");
    }
  });

  it("never lets a JUDGMENT criterion inherit a C from a weaker mapped SC", () => {
    // The projection folds the SCs DINUM's crosswalk cites and returns C as soon as one is
    // C. That answered the wrong question wherever the RGAA wording asks more: 8.6 wants a
    // *pertinent* page title, WCAG 2.4.2 only a present one; 13.3 wants an accessible
    // version of a downloaded document, and no mapped SC ever opened it — so a page whose
    // only merit was a `lang` attribute derived C on both, and so did a page carrying no
    // document at all. They now derive `manual` and go to the agent.
    const pack = loadPack("rgaa");
    for (const id of ["8.4", "8.6", "13.3", "13.4", "4.10"]) {
      expect(pack.criteria.find((c) => c.id === id)?.judgment, `RGAA ${id} must be flagged judgment`).toBe(true);
    }
    // The guard bites where the criterion HAS a subject to be broader about: this page carries
    // a language and a title, so those questions are still open.
    for (const id of ["8.4", "8.6"]) {
      expect(statusOf(rows, id), `RGAA ${id} must never be C`).not.toBe("C");
      expect(rows.find((r) => r.id === id)?.inapplicable, `RGAA ${id} has a subject here`).toBeUndefined();
    }
    // …and it does not bite where there is no subject at all — where the honest answer is
    // « nothing of that kind here », which reads `C` and carries `inapplicable`. 4.10 asks
    // whether automatically triggered SOUND is controllable and this page has no media; 13.3
    // and 13.4 ask about downloadable documents and this page links to none. Reopening any of
    // them would print a row of work that does not exist.
    //
    // 13.3/13.4 reach that answer only since absence is asked BEFORE a mapped SC's NC is
    // inherited: both map onto 1.1.1, which IS non-conforming here (the alt-less image), and
    // that sibling failure used to short-circuit them to « à évaluer » on every page with an
    // unrelated image defect — permanently, since both are `judgment`.
    for (const id of ["4.10", "13.3", "13.4"]) {
      expect(statusOf(rows, id), `RGAA ${id} has no subject here and must read C`).toBe("C");
      expect(rows.find((r) => r.id === id)?.inapplicable, `RGAA ${id} must say it is C for want of a subject`).toBe(true);
    }
    // The mechanical siblings are untouched: presence of a language / of a title really is
    // what the engine checked, so they stay decidable.
    for (const id of ["8.3", "8.5"]) {
      expect(pack.criteria.find((c) => c.id === id)?.judgment, `RGAA ${id} must NOT be flagged judgment`).toBeUndefined();
    }
  });

  it("a criterion whose mapped SC failed on out-of-scope elements derives as manual with a scoped justification (never a foreign finding)", () => {
    const c14 = rows.find((r) => r.id === "1.4")!;
    expect(c14.status).toBe("manual");
    expect(c14.findings).toHaveLength(0); // no img-alt finding leaks in
    expect(c14.scopedOut).toBe(true);
  });
});

describe("RGAA applicability — real per-element mapping holds across themes", () => {
  const audit = auditHtml(`<!doctype html><html><head></head><body><main><h1>H</h1><iframe src="x"></iframe></main></body></html>`);
  const rows = derivePackResults(audit, "rgaa");

  it("html-lang-missing → RGAA 8.3 signal, because RGAA also permits language on every text ancestor", () => {
    expect(statusOf(rows, "8.3")).toBe("manual");
    expect(rows.find((row) => row.id === "8.3")?.candidateFindings?.some((finding) => finding.ruleId === "html-lang-missing")).toBe(true);
  });

  it("iframe-title-missing → RGAA 2.1 (frame title) NC", () => {
    expect(statusOf(rows, "2.1")).toBe("NC");
    // 2.2 (frame-title relevance, judgment) must stay non-NC.
    expect(statusOf(rows, "2.2")).not.toBe("NC");
  });
});

describe("RGAA applicability — a pack WITHOUT appliesTo keeps the legacy fan-out (third-party compat)", () => {
  registerRuntimePack({
    key: "legacyfan",
    name: "LegacyFan",
    org: "O",
    country: "US",
    baseVersion: "1",
    wcagVersion: "2.2",
    locales: ["en"],
    defaultLocale: "en",
    license: "x",
    source: "x",
    attribution: "x",
    idPattern: "^L\\d+$",
    themes: [{ number: 1, name: { en: "T" }, count: 2 }],
    // Two criteria BOTH mapping 1.1.1, neither declaring appliesTo → both fan out.
    criteria: [
      { id: "L1", theme: 1, title: { en: "A" }, titlePlain: { en: "A" }, wcag: ["1.1.1"] },
      { id: "L2", theme: 1, title: { en: "B" }, titlePlain: { en: "B" }, wcag: ["1.1.1"] },
    ],
  });
  it("both criteria are NC (no applicability data = old behavior, unchanged)", () => {
    const audit = auditHtml(`<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>H</h1><img src="x"></main></body></html>`);
    const rows = derivePackResults(audit, "legacyfan");
    expect(statusOf(rows, "L1")).toBe("NC");
    expect(statusOf(rows, "L2")).toBe("NC");
  });
});

describe("RGAA applicability — the stateful scan probes project onto the right themes", () => {
  // A merged audit carrying the Task-4 stateful probe findings, then derived to RGAA.
  const audit = auditHtml(`<!doctype html><html lang="fr"><head><title>t</title></head><body><main><h1>H</h1></main></body></html>`);
  const dyn = toDynamicResult(
    {
      url: "https://exemple.fr",
      violations: [],
      reflow: { horizontalScroll: false },
      inputOverflowReflow: [{ selector: "input.a", html: "<input>", detail: "clip 320" }],
      inputOverflowZoom: [{ selector: "input.a", html: "<input>", detail: "clip 200%" }],
      inputOverflowSpacing: [{ selector: "input.a", html: "<input>", detail: "clip spacing" }],
      liveRegion: [{ selector: "div.toast", html: "<div>", detail: "unannounced update" }],
    },
    "https://exemple.fr",
    "fr",
    "axe-core@playwright (local)",
  );
  const rows = derivePackResults(mergeDynamic(audit, dyn, "fr"), "rgaa");
  const statusOfR = (id: string) => rows.find((r) => r.id === id)?.status;

  it("routes input-overflow to adjudication for the RGAA exceptions instead of asserting NC", () => {
    for (const id of ["10.11", "10.4", "10.12"]) {
      expect(statusOfR(id)).toBe("manual");
      expect(rows.find((row) => row.id === id)?.candidateFindings?.some((finding) => finding.ruleId.startsWith("dyn-input-overflow"))).toBe(true);
    }
  });

  it("live-region lands as an RGAA 7.5 signal, NOT 7.4 (change of context)", () => {
    expect(statusOfR("7.5")).toBe("manual");
    expect(rows.find((row) => row.id === "7.5")?.candidateFindings?.some((finding) => finding.ruleId === "dyn-live-region")).toBe(true);
    expect(statusOfR("7.4")).not.toBe("NC");
  });
});

describe("RGAA declarative rule — download-link-format (advisory, criterion 6.1)", () => {
  const page = (link: string) => `<!doctype html><html lang="fr"><head><title>t</title></head><body><main><h1>H</h1>${link}</main></body></html>`;

  it("a download link whose text omits format/weight raises a namespaced pack finding kept OUT of the core result", () => {
    const audit = auditHtml(page(`<a href="rapport.pdf">Rapport annuel</a>`));
    // The finding rides in packFindings only — the core WCAG findings/criteria are untouched.
    expect(audit.packFindings?.some((f) => f.ruleId === "pack:rgaa:download-link-format")).toBe(true);
    expect(audit.findings.some((f) => f.ruleId.startsWith("pack:"))).toBe(false);
    expect(audit.criteria.every((c) => c.findings.every((f) => !f.ruleId.startsWith("pack:")))).toBe(true);
  });

  it("projects onto RGAA 6.1 as an ADVISORY recommendation and NEVER makes 6.1 NC", () => {
    const rows = derivePackResults(auditHtml(page(`<a href="rapport.pdf">Rapport annuel</a>`)), "rgaa");
    const c61 = rows.find((r) => r.id === "6.1")!;
    expect(c61.findings.some((f) => f.ruleId === "pack:rgaa:download-link-format" && f.advisory === true)).toBe(true);
    expect(c61.status).not.toBe("NC");
  });

  it("does not fire when the link text already states the format and weight", () => {
    const audit = auditHtml(page(`<a href="rapport.pdf">Rapport annuel (PDF, 2 Mo)</a>`));
    expect(audit.packFindings?.some((f) => f.ruleId === "pack:rgaa:download-link-format") ?? false).toBe(false);
  });
});

describe("secondary crosswalk mappings — generic, opt-in projection (Task 13)", () => {
  // A synthetic pack: criterion "1.2" is the SC-faithful home of image-alt failures (1.1.1),
  // and "1.1" (change of context, 3.2.1) is an ADDITIONAL criterion the pack's body wants an
  // img-alt failure to ALSO land on — a deviation the WCAG crosswalk (3.2.1) would never
  // make. It ships the mapping DISABLED.
  registerRuntimePack({
    key: "sekmap",
    name: "SecMapPack",
    org: "O",
    country: "XX",
    baseVersion: "1",
    wcagVersion: "2.2",
    locales: ["en"],
    defaultLocale: "en",
    license: "x",
    source: "x",
    attribution: "x",
    idPattern: "^\\d+\\.\\d+$",
    themes: [{ number: 1, name: { en: "T" }, count: 2 }],
    criteria: [
      { id: "1.1", theme: 1, title: { en: "Change of context" }, titlePlain: { en: "Change of context" }, wcag: ["3.2.1"], appliesTo: { ruleIds: [] } },
      {
        id: "1.2",
        theme: 1,
        title: { en: "Image alt" },
        titlePlain: { en: "Image alt" },
        wcag: ["1.1.1"],
        appliesTo: { ruleIds: ["img-alt-missing", "input-image-alt-missing"] },
      },
    ],
    secondaryMappings: [{ ruleId: "img-alt-missing", criterion: "1.1", note: { en: "also 1.1 per pack body", fr: "aussi 1.1" }, enabled: false }],
  });

  // Two DIFFERENT 1.1.1 failures — an <img> and an <input type=image> — so the exact-ruleId
  // guarantee (only img-alt-missing crosses over, never input-image-alt-missing) is testable.
  const audit = auditHtml(
    `<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>H</h1><img src="x"><input type="image" src="y"></main></body></html>`,
  );

  it("DISABLED (out-of-box): the secondary criterion is NOT NC and carries no crossed-over finding; the SC-faithful criterion is NC", () => {
    const rows = derivePackResults(audit, "sekmap");
    expect(statusOf(rows, "1.1")).not.toBe("NC");
    expect(rows.find((r) => r.id === "1.1")!.findings.some((f) => f.ruleId === "img-alt-missing")).toBe(false);
    expect(statusOf(rows, "1.2")).toBe("NC"); // SC-faithful home, unchanged
  });

  it("ENABLED: the secondary criterion becomes NC, carries ONLY the exact-ruleId finding tagged `secondary` (+ note), and the SC-faithful criterion stays NC", () => {
    enableSecondaryMapping("sekmap", { ruleId: "img-alt-missing", criterion: "1.1" });
    const rows = derivePackResults(audit, "sekmap");
    const c11 = rows.find((r) => r.id === "1.1")!;
    expect(c11.status).toBe("NC");
    const crossed = c11.findings.find((f) => f.ruleId === "img-alt-missing");
    expect(crossed?.secondary).toBeDefined();
    expect(crossed?.secondary?.note).toBe("also 1.1 per pack body"); // resolved at the pack's defaultLocale
    // EXACT match: a sibling 1.1.1 rule (input-image-alt-missing) is NOT pulled onto 1.1.
    expect(c11.findings.some((f) => f.ruleId === "input-image-alt-missing")).toBe(false);
    // The copy-on-write tag never mutates the core finding.
    expect(audit.findings.find((f) => f.ruleId === "img-alt-missing")?.secondary).toBeUndefined();
    expect(statusOf(rows, "1.2")).toBe("NC"); // SC-faithful home STILL NC
  });
});

describe("RGAA 7.4 secondary mapping — live regions, disabled by default (Task 13)", () => {
  // A synthetic 4.1.3 (status messages) result carrying the live-region probe finding plus
  // its two static SC-siblings — so the EXACT-ruleId cross-over guarantee is testable. 7.5
  // is 4.1.3's WCAG-faithful RGAA home; 7.4 (change of context, 3.2.1/3.2.2) is the opt-in
  // secondary target. A fresh audit per call avoids any secondary-tag bleed across cases.
  const mkFinding = (ruleId: string): Finding => ({
    ruleId,
    criteriaId: "4.1.3",
    file: "page.html",
    line: 1,
    col: 1,
    selectorHint: "div.toast",
    severity: "majeur",
    message: "live region",
    remediation: "fix",
    snippet: "<div>",
  });
  const synthAudit = (): AuditResult => {
    const findings = [mkFinding("dyn-live-region"), mkFinding("status-message-not-assertive"), mkFinding("live-region-conflict")];
    return {
      tool: "ultra11y",
      standard: "wcag",
      version: "0",
      schemaVersion: 2,
      date: "2026-07-13",
      scope: { inputs: ["page.html"], files: 1 },
      guidelines: [],
      criteria: [{ id: "4.1.3", guideline: "4.1", status: "NC", findings: [...findings] }],
      findings: [...findings],
      residualRisks: [],
      conformancePct: 0,
    };
  };

  it("DISABLED (out-of-box): 7.4 carries nothing; 7.5 receives the non-conclusive WCAG-faithful signal", () => {
    const rows = derivePackResults(synthAudit(), "rgaa");
    const c74 = rows.find((r) => r.id === "7.4")!;
    expect(c74.status).not.toBe("NC");
    expect(c74.findings.some((f) => f.ruleId === "dyn-live-region")).toBe(false);
    expect(statusOf(rows, "7.5")).toBe("manual");
    expect(rows.find((row) => row.id === "7.5")?.candidateFindings?.some((finding) => finding.ruleId === "dyn-live-region")).toBe(true);
  });

  it("ENABLED: 7.4 gets the explicit secondary NC; 7.5 keeps the original signal", () => {
    const pack = loadPack("rgaa");
    const mapping = pack.secondaryMappings!.find((m) => m.ruleId === "dyn-live-region" && m.criterion === "7.4")!;
    const wasEnabled = mapping.enabled;
    try {
      enableSecondaryMapping("rgaa", { ruleId: "dyn-live-region", criterion: "7.4" });
      const rows = derivePackResults(synthAudit(), "rgaa");
      const c74 = rows.find((r) => r.id === "7.4")!;
      expect(c74.status).toBe("NC");
      const crossed = c74.findings.find((f) => f.ruleId === "dyn-live-region");
      expect(crossed?.secondary).toBeDefined();
      expect(crossed?.secondary?.note).toContain("7.4"); // the fr deviation note (pack default locale)
      // EXACT match: the sibling 4.1.3 rules are NOT dragged onto 7.4.
      expect(c74.findings.some((f) => f.ruleId === "status-message-not-assertive")).toBe(false);
      expect(c74.findings.some((f) => f.ruleId === "live-region-conflict")).toBe(false);
      expect(statusOf(rows, "7.5")).toBe("manual");
      expect(rows.find((row) => row.id === "7.5")?.candidateFindings?.some((finding) => finding.ruleId === "dyn-live-region")).toBe(true);
    } finally {
      mapping.enabled = wasEnabled; // restore the shipped-disabled default for other tests
    }
  });
});

describe("the built RGAA pack carries applicability data", () => {
  it("every RGAA criterion declares an explicit appliesTo (so no SC-sibling can leak a foreign finding)", () => {
    const pack = loadPack("rgaa");
    for (const c of pack.criteria) {
      expect(c.appliesTo, `RGAA ${c.id} missing appliesTo`).toBeDefined();
      expect(Array.isArray(c.appliesTo!.ruleIds)).toBe(true);
    }
  });
  it("RGAA 1.1 lists the image-alt rules and 1.4 (CAPTCHA) lists none", () => {
    const pack = loadPack("rgaa");
    const c11 = pack.criteria.find((c) => c.id === "1.1")!;
    expect(c11.appliesTo!.ruleIds).toContain("img-alt-missing");
    const c14 = pack.criteria.find((c) => c.id === "1.4")!;
    expect(c14.appliesTo!.ruleIds).toEqual([]);
  });
});

// Task #9: the pack-report header must show the SAME pass rate as its own per-criterion
// NC table (the projection tally), never the core WCAG `conformancePct` — the two bases
// (pack criteria vs WCAG SCs) can diverge, today already by fan-out/fan-in and — once
// pack overrides land (Task #13) — by advisory/severity flips too. Hand-built
// `PackCriterionResult[]` arrays are the primary evidence (per the task brief), since no
// shipped pack ships overrides yet to exercise a real divergence end to end.
describe("packConformancePct", () => {
  const row = (id: string, status: Status): PackCriterionResult => ({ id, theme: 1, status, findings: [], scs: [] });

  it("computes C / (C + NC), rounded — manual and NA never enter the ratio", () => {
    // 2 C, 1 NC, 1 manual, 1 NA → 2/3 = 66.67% → rounds to 67.
    const derived = [row("1", "C"), row("2", "C"), row("3", "NC"), row("4", "manual"), row("5", "NA")];
    expect(packConformancePct(derived)).toBe(67);
  });

  it("mirrors the core denominator-zero convention (audit.ts conformancePct): no decided criterion ⇒ 100, never NaN/divide-by-zero", () => {
    expect(packConformancePct([])).toBe(100);
    expect(packConformancePct([row("1", "manual"), row("2", "NA")])).toBe(100);
  });

  it("is 100 when every decided criterion conforms, 0 when every decided criterion fails", () => {
    expect(packConformancePct([row("1", "C"), row("2", "C"), row("3", "manual")])).toBe(100);
    expect(packConformancePct([row("1", "NC"), row("2", "NC"), row("3", "NA")])).toBe(0);
  });

  it("can diverge from a core WCAG conformancePct computed over a different criteria basis — the whole point of the task", () => {
    // A pack projection with 3 decided criteria, 2 conforming → 67%. A hand-built core
    // AuditResult.conformancePct of 50% (over a totally different WCAG-SC basis) must NOT
    // be what a pack report/PRD header shows — it must show this 67%, wired via
    // src/report.ts render()'s `headerRatePct` opt and src/prd.ts header()'s `ratePct` opt.
    const derived = [row("1", "C"), row("2", "C"), row("3", "NC")];
    const corePct = 50;
    expect(packConformancePct(derived)).toBe(67);
    expect(packConformancePct(derived)).not.toBe(corePct);
  });
});

// ABSENCE IS A PER-PAGE FACT, and asking it of the whole run left criteria open for ever.
//
// `subjectsSeen` answers "does anything of this kind exist ANYWHERE in scope?". That is the
// right question for the run's grid and the wrong one for a page: a criterion whose subject
// lives on one route could never be closed on the others, because scope-wide presence cannot
// conclude absence here — and a `judgment` criterion never earns a `C` by silence either. The
// audit now folds subjects per page as well, and `pageView` narrows onto that.
//
// Only EXISTENCE_SUBJECTS can conclude anything from it, and those are element species whose
// absence on a page is a fact a reader can check. The site-level criteria are safe by
// construction — RGAA 12.1–12.5 declare `navMechanisms`/`repeatedBlocks`, neither of which is
// an existence subject — so narrowing can never close « the ensemble has two navigation
// systems » on a page that happens to carry one. That is asserted below, not assumed.
describe("a criterion is closed for absence ON A PAGE, not only across the run", () => {
  const site = mkdtempSync(join(tmpdir(), "u11y-perpage-"));
  // Two pages. One declares a language and links to a PDF; the other declares neither — and
  // its missing language is its own defect, RGAA 8.3.
  const withLang = join(site, "avec.html");
  const noLang = join(site, "sans.html");
  writeFileSync(
    withLang,
    `<!doctype html><html lang="fr"><head><title>Avec</title></head><body><main><h1>Avec</h1>` +
      `<a href="/rapport.pdf">Rapport</a><nav aria-label="Principale"><a href="/sans.html">Sans</a></nav></main></body></html>`,
  );
  writeFileSync(
    noLang,
    `<!doctype html><html><head><title>Sans</title></head><body><main><h1>Sans</h1>` + `<p>Aucune langue déclarée ici.</p></main></body></html>`,
  );
  const audit = runAudit({ inputs: [site] });

  it("folds the subjects each document carries, per page as well as per run", () => {
    // Source files are not pages — only a snapshot is — so this audit records no per-page fold
    // and the run-wide one still answers. The fold itself is exercised end to end by the
    // browser tier and by the RGAA fixture; what matters here is that its ABSENCE changes
    // nothing, so an audit written before it reads exactly as it always did.
    expect(audit.scope.subjectsSeen, "the run-wide fold must still be recorded").toBeDefined();
    expect(audit.scope.subjectsSeen).toContain("downloadDocs");
  });

  it("does not let a sibling criterion's NC keep an absent-subject criterion open", () => {
    // THE BRANCH THIS FIXES. `sans.html` declares no language, so WCAG 3.1.1 is non-conforming
    // there — because RGAA 8.3 failed, not 8.4. 8.4 asks « pour chaque page AYANT une langue
    // par défaut, le code est-il pertinent ? » and its subject, `declaredLang`, is not there.
    //
    // Inheriting 3.1.1's NC read that as "assess this separately", which is the right answer
    // for a criterion whose subject exists and nobody has ruled on, and a permanent open for
    // one with nothing to assess: 8.4 is `judgment`, so silence never closes it either.
    const only = runAudit({ inputs: [noLang] });
    const rows = derivePackResults(only, "rgaa");
    expect(statusOf(rows, "8.3"), "the missing language still needs the RGAA alternative adjudicated").toBe("manual");
    expect(rows.find((row) => row.id === "8.3")?.candidateFindings?.some((finding) => finding.ruleId === "html-lang-missing")).toBe(true);
    const c84 = rows.find((r) => r.id === "8.4");
    expect(c84?.status, "8.4 has no language code to judge on a page that declares none").toBe("C");
    expect(c84?.inapplicable, "…and it must say it is C for want of a subject, never as a verdict").toBe(true);
  });

  it("still leaves 8.4 open where a language IS declared", () => {
    // The other half, and the one that stops this from being a licence to close: the subject is
    // there, so whether `fr` is the language the content is actually written in is nobody's
    // verdict yet.
    const only = runAudit({ inputs: [withLang] });
    const rows = derivePackResults(only, "rgaa");
    const c84 = rows.find((r) => r.id === "8.4");
    expect(c84?.status, "8.4 must stay open where a code was declared").toBe("manual");
    expect(c84?.inapplicable).toBeUndefined();
  });

  it("never closes a site-level navigation criterion for want of a subject", () => {
    // 12.1–12.5 are about an ENSEMBLE of pages. Their subjects are deliberately not existence
    // subjects, so no absence — per page or per run — may conclude anything about them. A page
    // with no navigation at all is a failure of those criteria, never an inapplicability.
    const only = runAudit({ inputs: [noLang] });
    const rows = derivePackResults(only, "rgaa");
    for (const id of ["12.1", "12.2", "12.3", "12.4", "12.5"]) {
      expect(rows.find((r) => r.id === id)?.inapplicable, `RGAA ${id} must never be closed for absence`).toBeUndefined();
    }
  });
});

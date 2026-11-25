// ONE VERDICT, EVERY PAGE (#197) — PER-PAGE OUTCOMES ON AN ADJUDICATION.
//
// A run-wide verdict is scope-wide, and that scope is what left a criterion « à évaluer » on
// every page whose subject was clean while one page failed it: one NC whose finding sat on the
// contact page could not speak for the login page. A `pages` map lets ONE verdict carry its
// PER-PAGE OUTCOMES instead, and this file pins the whole seam — the contract and briefs that
// announce it, the fail-closed gate that refuses a page outcome settled on another page's
// evidence, the grid that shows each page its own verdict, and the ledger that records,
// replays and prunes them.
//
// The page-local honesty rule (#197) is FILE-based: an anchor belongs to a page when the file
// it was read from IS that page's capture (`.ultra11y/pages/<id>/dom.html`). The audit here
// runs over source files, so to exercise the rule two synthetic capture anchors are pushed onto
// criterion 11.2's evidence, and the real files those anchors name are written under the audited
// directory — grounding re-opens them from disk, exactly what a rendered audit hands the fold.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  adjudicationContract,
  applyAdjudication,
  buildAdjudicationWorklist,
  formatAdjudication,
  type AdjudicationFile,
  type AdjudicationItem,
  type ApplyAdjudicationResult,
  type Evidence,
} from "../src/adjudicate.js";
import { runAudit } from "../src/audit.js";
import { entriesFrom, mergeLedger, pruneLedger, replayLedger } from "../src/ledger.js";
import { attributePages, derivePages, pageGridModel } from "../src/pages.js";
import { pageCriterionRows } from "../src/pages-report.js";
import { derivePackResults } from "../src/standards/index.js";
import { PAGES_DIR } from "../src/snapshot.js";
import type { AuditResult, PageScope, Status } from "../src/types.js";
import type { VerifyItem } from "../src/verify.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-adj-pages-"));
const CAPTURE_LINE = 3;
const LABEL_SNIPPET = '<label for="courriel">Votre courriel</label>';

/** Source page and page capture share one layout, so the label sits at the same line in both. */
const pageHtml = (title: string, extra = "") =>
  [
    "<!doctype html>",
    `<html lang="fr"><head><title>${title}</title></head><body><main>`,
    '<form action="/inscription"><label for="courriel">Votre courriel</label><input id="courriel" name="courriel" type="email"></form>',
    ...(extra ? [extra] : []),
    "</main></body></html>",
  ].join("\n");

const bad = join(dir, "bad.html");
const good = join(dir, "good.html");
writeFileSync(bad, pageHtml("Bad", '<input type="image" src="/x.png">'));
writeFileSync(good, pageHtml("Good"));

// The captures the page-local rule reads, written where the published layout puts them —
// `snapshotPageId` recovers the page id from exactly this path, and grounding re-opens the file.
for (const id of ["bad", "good"]) {
  mkdirSync(join(dir, PAGES_DIR, id), { recursive: true });
  writeFileSync(join(dir, PAGES_DIR, id, "dom.html"), pageHtml(id === "bad" ? "Bad" : "Good"));
}

const SCOPE: PageScope[] = [
  { id: "bad", name: "Bad", url: "https://x/bad", sources: [bad], basis: "snapshot" },
  { id: "good", name: "Good", url: "https://x/good", sources: [good], basis: "snapshot" },
];

const auditOf = (): AuditResult => {
  const audit = runAudit({ inputs: [bad, good] });
  audit.scope.pages = SCOPE.map((p) => ({ ...p }));
  audit.scope.pagesAudited = ["bad", "good"];
  attributePages(audit, audit.scope.pages);
  return audit;
};

const file = (items: AdjudicationItem[], standard: AdjudicationFile["standard"] = "rgaa"): AdjudicationFile => ({
  tool: "ultra11y",
  kind: "adjudication",
  schemaVersion: 2,
  standard,
  auditDate: "2026-11-24",
  items,
});

const badCapture = `${PAGES_DIR}/bad/dom.html`;
const goodCapture = `${PAGES_DIR}/good/dom.html`;
const BAD_CAPTURE_ANCHOR: Evidence = { file: badCapture, line: CAPTURE_LINE, selector: "label", snippet: LABEL_SNIPPET };
const GOOD_CAPTURE_ANCHOR: Evidence = { file: goodCapture, line: CAPTURE_LINE, selector: "label", snippet: LABEL_SNIPPET };
/** A citation of 11.2's own harvested source anchor — what the ordinary gates accept without
 *  any page-capture anchor in play. */
const GOOD_SOURCE_CITATION: Evidence = { file: good, line: CAPTURE_LINE, selector: "label", snippet: LABEL_SNIPPET };
/** The NC finding the run-wide verdict rests on, observed on bad's source. */
const SOURCE_FINDING = {
  file: bad,
  line: CAPTURE_LINE,
  selector: "label",
  message: "Étiquette non pertinente.",
  snippet: LABEL_SNIPPET,
  normativeRef: "11.2.1",
};
/** The same failure observed on bad's CAPTURE — what a page-local NC must rest on. */
const CAPTURE_FINDING = { ...SOURCE_FINDING, file: badCapture };

function worklistItem(audit: AuditResult, criteriaId: string, why: string): AdjudicationItem {
  const it = buildAdjudicationWorklist(audit, { standard: "rgaa" }).find((i) => i.criteriaId === criteriaId);
  expect(it, why).toBeDefined();
  return it!;
}

/** The 11.2 worklist item as the harvest produced it. */
const plainItem = (audit: AuditResult): AdjudicationItem =>
  worklistItem(audit, "11.2", "RGAA 11.2 has to be open on this fixture for the suite to mean anything");

/** The 11.2 item carrying the two page-capture anchors, so the page-local rule has something to
 *  bite on: without them the rule is silent and the ordinary membership/grounding gates decide. */
const itemWithCaptureAnchors = (audit: AuditResult): AdjudicationItem => {
  const it = plainItem(audit);
  return { ...it, evidence: [...it.evidence, BAD_CAPTURE_ANCHOR, GOOD_CAPTURE_ANCHOR] };
};

/** What these tests write into a `pages` map — deliberately looser than `PageVerdict`, because
 *  the gate reads the raw JSON and must REFUSE (not type-check) the junk several cases feed it. */
type RawPageVerdict = { verdict: unknown; justification?: string; citations?: Evidence[]; findings?: unknown };

/** Fold ONLY criterion 11.2 — a valid run-wide NC plus the `pages` map the caller fills — so
 *  every refusal below is attributable to the map alone. `withCaptures` pushes the synthetic
 *  page-capture anchors onto the item for the page-local rule. */
function fold112(pages: Record<string, RawPageVerdict> | undefined, runWide: Partial<AdjudicationItem> = {}, withCaptures = false): ApplyAdjudicationResult {
  const audit = auditOf();
  const item = withCaptures ? itemWithCaptureAnchors(audit) : plainItem(audit);
  const base: Partial<AdjudicationItem> = { verdict: "NC", justification: "", findings: [{ ...SOURCE_FINDING }] };
  const ruled = { ...item, ...base, ...runWide, pages } as unknown as AdjudicationItem;
  return applyAdjudication(audit, file([ruled]), { cwd: dir });
}

/** Clear every open criterion the way a well-behaved adjudicator would, so the fold under test
 *  can come back `ok`: the criteria that carry evidence cite it, the rest abstain honestly. */
const cleared = (items: AdjudicationItem[]): AdjudicationItem[] =>
  items.map((i) =>
    i.evidence.length && i.evidenceComplete !== false
      ? ({ ...i, verdict: "C", justification: "vérifié sur la page", citations: [i.evidence[0]!] } as AdjudicationItem)
      : ({ ...i, verdict: "manual", reason: "undecidable" } as AdjudicationItem),
  );

/** One criterion's column of the page grid, one cell per audited page. */
function cellsFor(audit: AuditResult, criteriaId: string): Map<string, Status> {
  attributePages(audit, audit.scope.pages ?? []);
  return pageGridModel(audit, derivePages(audit, audit.scope.pages ?? []), "rgaa", "fr").status.get(criteriaId) ?? new Map();
}

const rowOn = (audit: AuditResult, pageIndex: number, criteriaId: string) => {
  const page = derivePages(audit, audit.scope.pages ?? [])[pageIndex]!;
  return pageCriterionRows(audit, page, "rgaa", "fr").find((c) => c.id === criteriaId);
};

describe("the contract and the briefs carry the per-page outcomes", () => {
  it("states what a pages map requires, and that there is no per-page manual", () => {
    const pages = adjudicationContract().requires.pages ?? "";
    expect(typeof pages).toBe("string");
    expect(pages.length).toBeGreaterThan(0);
    expect(pages).toContain('"C" | "NC" | "NA"');
    expect(pages).toContain("AUDITED PAGE id");
    expect(pages).toContain('no per-page "manual"');
  });

  it("carries the pages line in the French and English briefs, with the audited page ids", () => {
    const audit = auditOf();
    const items = buildAdjudicationWorklist(audit, { standard: "rgaa" }).filter((i) => i.criteriaId === "11.2");
    const pages = audit.scope.pages!.map((p) => ({ id: p.id, name: p.name, url: p.url }));
    const fr = formatAdjudication(items, "fr", "rgaa", { preamble: false, pages });
    const en = formatAdjudication(items, "en", "rgaa", { preamble: false, pages });
    // The verdict vocabulary is what a per-criterion brief keeps when the preamble is dropped —
    // the `pages` line travels with it, or a CI adjudicator never learns the map exists.
    for (const md of [fr, en]) expect(md).toMatch(/^- `pages` — /m);
    expect(fr).toMatch(/Pages auditées \(ids utilisables comme clés de `pages`\)/);
    expect(fr).toContain("bad — Bad (https://x/bad)");
    expect(en).toMatch(/Audited pages \(usable as `pages` keys\)/);
  });
});

describe("a verdict may settle each audited page (#197)", () => {
  it("folds NC run-wide with a per-page C and NC, records them, and shows each page its own verdict", () => {
    const audit = auditOf();
    const ruled: AdjudicationItem = {
      ...itemWithCaptureAnchors(audit),
      verdict: "NC",
      justification: "",
      findings: [{ ...SOURCE_FINDING }],
      pages: {
        bad: { verdict: "NC", justification: "Étiquette non pertinente sur cette page.", findings: [{ ...CAPTURE_FINDING }] },
        good: { verdict: "C", justification: "Étiquette pertinente sur cette page.", citations: [{ ...GOOD_CAPTURE_ANCHOR }] },
      },
    };
    const others = cleared(buildAdjudicationWorklist(audit, { standard: "rgaa" })).filter((i) => i.criteriaId !== "11.2");
    const r = applyAdjudication(audit, file([ruled, ...others]), { cwd: dir });
    expect(r.ok, r.issues.join("\n")).toBe(true);
    const result = r.audit;
    const entry = result.packAdjudication?.criteria.find((c) => c.id === "11.2");
    expect(entry?.status).toBe("NC");
    expect(entry?.pages?.bad).toMatchObject({ status: "NC" });
    expect(entry?.pages?.good).toMatchObject({ status: "C", justification: "Étiquette pertinente sur cette page." });
    // The page's citations are narrowed to CriterionCitation: the harvester's class bookkeeping
    // describes the evidence, not the claim, and must not be persisted on the verdict.
    const cit = entry?.pages?.good?.citations?.[0];
    expect(Object.keys(cit ?? {}).sort()).toEqual(["file", "line", "selector", "snippet"]);
    // THE GRID: the run-wide row stays NC, each named page reads its own outcome.
    expect(derivePackResults(result, "rgaa").find((c) => c.id === "11.2")?.status).toBe("NC");
    expect(rowOn(result, 0, "11.2")).toMatchObject({ status: "NC" });
    expect(rowOn(result, 1, "11.2")).toMatchObject({ status: "C" });
  });

  it("reads a per-page NA as inapplicable on that page, and leaves the unnamed page to the run-wide verdict", () => {
    const r = fold112({ good: { verdict: "NA", justification: "Hors de portée sur cette page.", citations: [{ ...GOOD_CAPTURE_ANCHOR }] } }, {}, true);
    expect(r.rejectedCriteria, r.issues.join("\n")).toEqual([]);
    const result = r.audit;
    expect(rowOn(result, 1, "11.2")).toMatchObject({ status: "C", inapplicable: true });
    expect(rowOn(result, 0, "11.2")).toMatchObject({ status: "NC" });
  });

  it("keeps the NC the engine proved on a page when the per-page outcome clears it", () => {
    // The unlabelled image button on `bad` is a deterministic failure; the derive guard exists
    // so a clearing verdict can never replace that proof — not run-wide, not on the page.
    const audit = auditOf();
    const before = cellsFor(audit, "1.1");
    expect(before.get("bad")).toBe("NC");
    expect(before.get("good")).toBe("manual");
    const it11 = worklistItem(audit, "1.1", "the image button has to put 1.1 on the worklist");
    const img = it11.evidence.find((e) => e.file === bad);
    expect(img, "the engine's own anchor has to be among the evidence").toBeDefined();
    const r = applyAdjudication(
      audit,
      file([
        {
          ...it11,
          verdict: "C",
          justification: "Image bouton nommée.",
          citations: [img!],
          pages: { bad: { verdict: "C", justification: "Nommée ici aussi.", citations: [img!] } },
        } as AdjudicationItem,
      ]),
      { cwd: dir },
    );
    expect(r.rejectedCriteria, r.issues.join("\n")).toEqual([]);
    const result = r.audit;
    const cells = cellsFor(result, "1.1");
    expect(cells.get("bad"), "a clearing verdict never erases an engine-proven non-conformity on that page").toBe("NC");
    expect(cells.get("good")).toBe("C");
    expect(derivePackResults(result, "rgaa").find((c) => c.id === "1.1")?.status).toBe("NC");
  });

  it("settles the pages it can under a still-manual verdict, and the run-wide row stays open (#231)", () => {
    const r = fold112(
      { good: { verdict: "C", justification: "Étiquette pertinente sur cette page.", citations: [{ ...GOOD_CAPTURE_ANCHOR }] } },
      { verdict: "manual", reason: "undecidable" },
      true,
    );
    expect(r.rejectedCriteria, r.issues.join("\n")).toEqual([]);
    const entry = r.audit.packAdjudication?.criteria.find((c) => c.id === "11.2");
    expect(entry?.status).toBe("manual");
    expect(entry?.pages?.good).toMatchObject({ status: "C" });
    expect(derivePackResults(r.audit, "rgaa").find((c) => c.id === "11.2")?.status).toBe("manual");
    expect(rowOn(r.audit, 1, "11.2")).toMatchObject({ status: "C" });
    expect(rowOn(r.audit, 0, "11.2")?.status, "an unnamed page keeps the run-wide abstention").toBe("manual");
  });

  it("refuses a page NC under a still-manual verdict: a criterion failing on one page is NC run-wide", () => {
    const r = fold112(
      { bad: { verdict: "NC", justification: "Étiquette non pertinente.", findings: [{ ...CAPTURE_FINDING }] } },
      { verdict: "manual", reason: "undecidable", findings: [] },
      true,
    );
    expect(r.rejectedCriteria).toContain("11.2");
    expect(r.issues.join("\n")).toMatch(/a page NC under a run-wide manual contradicts it/);
    expect(r.audit.packAdjudication?.criteria.find((c) => c.id === "11.2")?.pages).toBeUndefined();
  });

  it("still gates every page outcome under a still-manual verdict: an uncited page C is refused", () => {
    const r = fold112({ good: { verdict: "C", justification: "Étiquette pertinente." } }, { verdict: "manual", reason: "undecidable" }, true);
    expect(r.rejectedCriteria).toContain("11.2");
    expect(r.issues.join("\n")).toMatch(/must cite at least one of/);
  });

  it("records no pages key for a verdict that carries none, so every earlier shape is unchanged", () => {
    const r = fold112(undefined);
    expect(r.rejectedCriteria, r.issues.join("\n")).toEqual([]);
    const entry = r.audit.packAdjudication?.criteria.find((c) => c.id === "11.2");
    expect(entry?.status).toBe("NC");
    expect(entry).toBeDefined();
    expect(Object.hasOwn(entry!, "pages")).toBe(false);
  });

  it("folds a per-page verdict written in lower case and records it upper case", () => {
    // Case carries no meaning: "nc" can only mean NC, and the recorded shape is the canonical one.
    const r = fold112({ bad: { verdict: "nc", justification: "Étiquette non pertinente.", findings: [{ ...SOURCE_FINDING }] } });
    expect(r.rejectedCriteria, r.issues.join("\n")).toEqual([]);
    const entry = r.audit.packAdjudication?.criteria.find((c) => c.id === "11.2");
    expect(entry?.pages?.bad?.status).toBe("NC");
    expect(cellsFor(r.audit, "11.2").get("bad")).toBe("NC");
  });
});

describe("the gate refuses a page outcome that fails its own gate (#197)", () => {
  // The three surfaces every refusal shows on: the fold rejected the whole item, its recorded
  // row went back to « to assess » carrying the refusal, and the issue names the page.
  const expectRefused = (r: ApplyAdjudicationResult, issue: RegExp, pageId: string) => {
    expect(r.ok).toBe(false);
    expect(r.rejectedCriteria, r.issues.join("\n")).toContain("11.2");
    expect(r.issues.join("\n")).toMatch(issue);
    expect(r.issues.join("\n")).toContain(`page ${pageId}`);
    const entry = r.audit.packAdjudication?.criteria.find((c) => c.id === "11.2");
    expect(entry?.status, "a refused page outcome refuses the whole item").toBe("manual");
    expect(entry?.justification ?? "").toMatch(/Adjudication refused by the gate/);
    expect(entry?.pages, "a refused item persists no pages").toBeUndefined();
  };

  it("refuses a page id that is not one of the audit's pages, naming the known ones", () => {
    const r = fold112({ nowhere: { verdict: "C", justification: "x", citations: [{ ...GOOD_CAPTURE_ANCHOR }] } }, {}, true);
    expectRefused(r, /nowhere is not an audited page of this audit/, "nowhere");
    expect(r.issues.join("\n")).toMatch(/known: bad, good/);
  });

  it("refuses a per-page manual: an undecided page stays out of the map", () => {
    expectRefused(fold112({ bad: { verdict: "manual", justification: "à voir" } }), /a page verdict is C, NC or NA/, "bad");
  });

  it("refuses a per-page C that cites nothing on a criterion that has evidence", () => {
    expectRefused(fold112({ good: { verdict: "C", justification: "Étiquette pertinente." } }, {}, true), /must cite at least one of/, "good");
  });

  it("refuses a per-page C without a justification", () => {
    expectRefused(fold112({ good: { verdict: "C", citations: [{ ...GOOD_CAPTURE_ANCHOR }] } }, {}, true), /a C verdict requires a justification/, "good");
  });

  it("refuses a per-page NC without findings", () => {
    expectRefused(fold112({ bad: { verdict: "NC", justification: "x" } }, {}, true), /an NC verdict requires at least one groundable finding/, "bad");
  });

  it("refuses an NC finding whose normativeRef is a WCAG id instead of a test of the criterion", () => {
    // "1.3.5" has the N.N.N shape of a WCAG success criterion AND of an RGAA test — a laxer
    // gate silently read the WCAG id as an unrelated pack test. The ref must resolve to the
    // item's OWN criterion's tests, and a per-page finding is held to that same bound.
    const r = fold112({ bad: { verdict: "NC", findings: [{ ...SOURCE_FINDING, normativeRef: "1.3.5" }] } });
    expectRefused(r, /normativeRef "1\.3\.5" is not a test of rgaa 11\.2/, "bad");
  });

  it("refuses a page outcome settled on ANOTHER page's evidence — the page-local rule", () => {
    // The criterion carries an anchor harvested from bad's capture; ruling bad's outcome from
    // good's capture covers only good, and reading it as bad's verdict would fake a decision
    // the agent never made here.
    const r = fold112(
      { bad: { verdict: "C", justification: "ruled from the other page's capture", citations: [{ ...GOOD_CAPTURE_ANCHOR }] } },
      { verdict: "C", justification: "Étiquettes pertinentes.", findings: [], citations: [{ ...GOOD_SOURCE_CITATION }] },
      true,
    );
    expectRefused(r, /citation .*good\/dom\.html:3 is not this page's evidence/, "bad");
  });

  it("refuses a page outcome citing another page's SOURCE file, not only its capture", () => {
    const r = fold112(
      { bad: { verdict: "C", justification: "ruled from the other page's source", citations: [{ ...GOOD_SOURCE_CITATION }] } },
      { verdict: "C", justification: "Étiquettes pertinentes.", findings: [], citations: [{ ...GOOD_SOURCE_CITATION }] },
    );
    expectRefused(r, /good\.html:3 is not this page's evidence/, "bad");
  });

  it("refuses a page NC whose finding sits on another page", () => {
    const r = fold112({ good: { verdict: "NC", findings: [{ ...CAPTURE_FINDING }] } }, {}, true);
    expectRefused(r, /finding .*bad\/dom\.html:3 is not this page's evidence/, "good");
  });

  it("refuses an ungrounded page citation: on the page's own capture, but not what the file holds", () => {
    const forged = { ...GOOD_CAPTURE_ANCHOR, line: 40, selector: "video", snippet: '<video src="/forged.mp4"></video>' };
    const r = fold112({ good: { verdict: "C", justification: "Étiquette pertinente.", citations: [forged] } }, {}, true);
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/page good.*(not found|fabricated)/);
    // EVERY refusal line names its criterion and page, the grounding ones included (#223).
    const grounding = r.issues.filter((i) => /cited (snippet|selector|file|line)/.test(i));
    expect(grounding.length, r.issues.join("\n")).toBeGreaterThan(0);
    for (const i of grounding) expect(i).toMatch(/^criterion 11\.2, page good: cited /);
    expect(r.rejectedCriteria, r.issues.join("\n")).toContain("11.2");
    expect(r.audit.packAdjudication?.criteria.find((c) => c.id === "11.2")?.pages).toBeUndefined();
  });

  it("refuses a page NC under a run-wide C: a criterion failing on one page is NC run-wide", () => {
    const r = fold112(
      { bad: { verdict: "NC", findings: [{ ...SOURCE_FINDING }] } },
      { verdict: "C", justification: "Étiquettes pertinentes.", findings: [], citations: [{ ...GOOD_SOURCE_CITATION }] },
    );
    expectRefused(r, /a page NC under a run-wide C contradicts it/, "bad");
  });

  it("refuses a page C where the run-wide NC's own finding sits", () => {
    const r = fold112({ bad: { verdict: "C", justification: "Étiquette pertinente.", citations: [{ ...BAD_CAPTURE_ANCHOR }] } }, {}, true);
    expectRefused(r, /contradicts the run-wide NC finding/, "bad");
  });

  it("refuses a page C on a page that carries none of the criterion's evidence", () => {
    // 11.2's label class is harvested on both sources (good's as an `alsoAt` sibling of bad's):
    // keep bad's representative alone so good has nothing of its own to clear.
    const audit = auditOf();
    const item = plainItem(audit);
    const ruled = {
      ...item,
      evidence: item.evidence.filter((e) => e.file === bad).map(({ alsoAt: _also, occurrences: _n, ...e }) => e),
      verdict: "NC",
      justification: "",
      findings: [{ ...SOURCE_FINDING }],
      pages: { good: { verdict: "C", justification: "rien à voir", citations: [] } },
    } as unknown as AdjudicationItem;
    const r = applyAdjudication(audit, file([ruled]), { cwd: dir });
    expect(r.rejectedCriteria).toContain("11.2");
    expect(r.issues.join("\n")).toMatch(/needs this page.s own evidence to cite/);
  });

  it("refuses a page NC without a justification", () => {
    expectRefused(fold112({ bad: { verdict: "NC", findings: [{ ...SOURCE_FINDING }] } }), /an NC verdict on a page requires a justification/, "bad");
  });

  it("refuses junk page findings by name, and never records them", () => {
    for (const junk of [null, "bad.html:3", 42, []]) {
      const r = fold112({ bad: { verdict: "NC", justification: "x", findings: [{ ...SOURCE_FINDING }, junk] } });
      expectRefused(r, /finding #2 is not an object/, "bad");
    }
  });

  it("refuses a fileless page finding and a non-string page justification instead of crashing", () => {
    const { file: _f, ...noFile } = SOURCE_FINDING;
    expectRefused(fold112({ bad: { verdict: "NC", justification: "x", findings: [noFile] } }), /must name the file/, "bad");
    expectRefused(
      fold112({ bad: { verdict: "NC", justification: 42 as unknown as string, findings: [{ ...SOURCE_FINDING }] } }),
      /"justification" must be a string/,
      "bad",
    );
  });

  it("refuses junk in a page outcome instead of crashing on it", () => {
    const r = fold112({ good: { verdict: "C", justification: "x", citations: "good.html:3" as unknown as Evidence[] } }, {}, true);
    expectRefused(r, /"citations" must be an array/, "good");
  });
});

describe("a page NA on a page without the subject is grounded in an absence proof (#231)", () => {
  // 11.2's label class is harvested on both sources: keep bad's representative alone, so page
  // `good` carries none of the criterion's evidence — the shape of the 29 image-less pages.
  const foldBadOnly = (good: RawPageVerdict, prepare?: (audit: AuditResult) => void): ApplyAdjudicationResult => {
    const audit = auditOf();
    prepare?.(audit);
    const item = plainItem(audit);
    const ruled = {
      ...item,
      evidence: item.evidence.filter((e) => e.file === bad).map(({ alsoAt: _also, occurrences: _n, ...e }) => e),
      verdict: "manual",
      reason: "undecidable",
      pages: { good },
    } as unknown as AdjudicationItem;
    return applyAdjudication(audit, file([ruled]), { cwd: dir });
  };
  /** Where the absence was observed: page good's own `<main>`, in a source the page declares. */
  const MAIN_OF_GOOD: Evidence = { file: good, line: 2, selector: "main", snippet: "<main>" };

  it("refuses an uncited page NA with no census: an NA with nothing under it", () => {
    const r = foldBadOnly({ verdict: "NA", justification: "Aucun champ sur cette page." });
    expect(r.rejectedCriteria).toContain("11.2");
    expect(r.issues.join("\n")).toMatch(
      /criterion 11\.2, page good: a NA verdict on a page that carries none of this criterion's evidence must still ground the absence/,
    );
  });

  it("accepts a page NA citing the page's own markup where the absence was observed", () => {
    const r = foldBadOnly({ verdict: "NA", justification: "Le <main> de cette page ne porte aucun champ.", citations: [{ ...MAIN_OF_GOOD }] });
    expect(r.rejectedCriteria, r.issues.join("\n")).toEqual([]);
    expect(r.audit.packAdjudication?.criteria.find((c) => c.id === "11.2")?.pages?.good).toMatchObject({ status: "NA" });
    expect(rowOn(r.audit, 1, "11.2")).toMatchObject({ status: "C", inapplicable: true });
  });

  it("refuses an absence citation the page does not hold — grounding still re-reads the file", () => {
    const r = foldBadOnly({ verdict: "NA", justification: "Rien ici.", citations: [{ ...MAIN_OF_GOOD, snippet: "<aside>nothing</aside>" }] });
    expect(r.rejectedCriteria).toContain("11.2");
    expect(r.issues.join("\n")).toMatch(/page good: cited snippet not found/);
  });

  it("refuses an absence citation of ANOTHER page's markup", () => {
    const r = foldBadOnly({ verdict: "NA", justification: "Rien ici.", citations: [{ ...MAIN_OF_GOOD, file: bad }] });
    expect(r.rejectedCriteria).toContain("11.2");
    expect(r.issues.join("\n")).toMatch(/is not this page's evidence/);
  });

  it("accepts an uncited page NA when the engine's per-page census proves the subject absent there", () => {
    const r = foldBadOnly({ verdict: "NA", justification: "Aucun champ sur cette page." }, (audit) => {
      // The census read page good's capture and found none of the criterion's subjects.
      audit.scope.pageSubjects = { bad: [...(audit.scope.subjectsSeen ?? [])], good: [] };
    });
    expect(r.rejectedCriteria, r.issues.join("\n")).toEqual([]);
  });
});

describe("a run-wide finding anchored on a page but not shown there (#231)", () => {
  // The run-wide NC rests on bad's CAPTURE (a journey state's DOM), and page bad is ruled C on
  // its own evidence while naming that finding as not shown on this page.
  const FINDING_REF = `${badCapture}:${CAPTURE_LINE}`;
  const badC = (extra: Partial<RawPageVerdict> & { notShownHere?: unknown } = {}): Record<string, RawPageVerdict> => ({
    bad: {
      verdict: "C",
      justification: "L'erreur n'est pas affichée dans cet état ; l'étiquette est pertinente.",
      citations: [{ ...BAD_CAPTURE_ANCHOR }],
      ...extra,
    },
  });
  const ncOnCapture = { findings: [{ ...CAPTURE_FINDING }] };

  it("still refuses the page C when the finding is not named", () => {
    const r = fold112(badC(), ncOnCapture, true);
    expect(r.rejectedCriteria).toContain("11.2");
    expect(r.issues.join("\n")).toMatch(/contradicts the run-wide NC finding .*notShownHere/);
  });

  it("accepts a grounded page C that names the finding in notShownHere, keeps the run-wide NC, and records it", () => {
    const r = fold112(badC({ notShownHere: [FINDING_REF] } as Partial<RawPageVerdict>), ncOnCapture, true);
    expect(r.rejectedCriteria, r.issues.join("\n")).toEqual([]);
    const entry = r.audit.packAdjudication?.criteria.find((c) => c.id === "11.2");
    expect(entry?.status).toBe("NC");
    expect(entry?.pages?.bad).toMatchObject({ status: "C", notShownHere: [FINDING_REF] });
    expect(derivePackResults(r.audit, "rgaa").find((c) => c.id === "11.2")?.status).toBe("NC");
    expect(rowOn(r.audit, 0, "11.2")).toMatchObject({ status: "C" });
  });

  it("refuses the override when the page C cites nothing of its own", () => {
    const r = fold112(badC({ citations: [], notShownHere: [FINDING_REF] } as Partial<RawPageVerdict>), ncOnCapture, true);
    expect(r.rejectedCriteria).toContain("11.2");
    expect(r.issues.join("\n")).toMatch(/must cite at least one of/);
  });

  it("refuses a notShownHere entry naming no run-wide finding on this page", () => {
    const r = fold112(badC({ notShownHere: [FINDING_REF, `${badCapture}:99`] } as Partial<RawPageVerdict>), ncOnCapture, true);
    expect(r.rejectedCriteria).toContain("11.2");
    expect(r.issues.join("\n")).toMatch(/notShownHere names .*:99, which is not a run-wide NC finding sitting on this page/);
  });

  it("refuses notShownHere on a page NC, and a malformed notShownHere", () => {
    const onNc = fold112(
      { bad: { verdict: "NC", justification: "x", findings: [{ ...CAPTURE_FINDING }], notShownHere: [FINDING_REF] } as RawPageVerdict },
      ncOnCapture,
      true,
    );
    expect(onNc.issues.join("\n")).toMatch(/a page NC rests on its own findings/);
    const junk = fold112(badC({ notShownHere: FINDING_REF } as unknown as Partial<RawPageVerdict>), ncOnCapture, true);
    expect(junk.issues.join("\n")).toMatch(/"notShownHere" must be an array/);
  });

  it("round-trips notShownHere through the ledger, and the replay re-folds", () => {
    const audit = auditOf();
    const adj = file([
      {
        ...itemWithCaptureAnchors(audit),
        verdict: "NC",
        justification: "",
        ...ncOnCapture,
        pages: badC({ notShownHere: [FINDING_REF] } as Partial<RawPageVerdict>),
      } as unknown as AdjudicationItem,
    ]);
    expect(applyAdjudication(audit, adj, { cwd: dir }).rejectedCriteria).toEqual([]);
    const entries = entriesFrom(adj, new Set(["11.2"]), audit.date, dir);
    expect(entries.find((e) => e.criteriaId === "11.2")?.pages?.bad?.notShownHere).toEqual([FINDING_REF]);
    const replay = replayLedger(audit, mergeLedger(undefined, "rgaa", entries), { cwd: dir, standard: "rgaa" });
    const replayed = replay.adj.items.find((i) => i.criteriaId === "11.2");
    expect(replayed?.pages?.bad?.notShownHere).toEqual([FINDING_REF]);
  });
});

describe("the WCAG core has no page grid of its own", () => {
  it("refuses a pages map on a core-standard item", () => {
    const audit = runAudit({ inputs: [bad] });
    const it1 = buildAdjudicationWorklist(audit).find((i) => i.evidence.length > 0);
    expect(it1, "the fixture has to leave a core criterion with evidence open").toBeDefined();
    const r = applyAdjudication(
      audit,
      file(
        [
          {
            ...it1!,
            verdict: "C",
            justification: "vérifié sur la page",
            citations: [it1!.evidence[0]!],
            pages: { bad: { verdict: "C", justification: "x", citations: [it1!.evidence[0]!] } },
          } as AdjudicationItem,
        ],
        "wcag",
      ),
      { cwd: dir },
    );
    expect(r.ok).toBe(false);
    expect(r.rejectedCriteria).toContain(it1!.criteriaId);
    expect(r.issues.join("\n")).toMatch(/pack-standard feature/);
  });
});

describe("the ledger records, replays and prunes the per-page outcomes", () => {
  it("records the per-page outcomes on the entry, and a replay puts them back on the item", () => {
    const audit = auditOf();
    const adj = file([
      {
        ...plainItem(audit),
        verdict: "NC",
        justification: "",
        findings: [{ ...SOURCE_FINDING }],
        pages: {
          bad: { verdict: "NC", justification: "Étiquette non pertinente sur cette page.", findings: [{ ...SOURCE_FINDING }] },
          good: { verdict: "C", justification: "Étiquette pertinente sur cette page.", citations: [{ ...GOOD_SOURCE_CITATION }] },
        },
      } as AdjudicationItem,
    ]);
    const r = applyAdjudication(audit, adj, { cwd: dir });
    expect(r.rejectedCriteria, r.issues.join("\n")).toEqual([]);
    const entry = entriesFrom(adj, new Set(["11.2"]), audit.date, dir).find((e) => e.criteriaId === "11.2");
    expect(entry?.pages?.bad?.status).toBe("NC");
    expect(entry?.pages?.good?.status).toBe("C");
    // A committed ledger names paths a reviewer can open: respelled relative to the audited root.
    expect(entry?.pages?.bad?.findings?.[0]?.file).toBe("bad.html");
    expect(entry?.pages?.good?.citations?.[0]?.file).toBe("good.html");

    const ledger = mergeLedger(undefined, "rgaa", entriesFrom(adj, new Set(["11.2"]), audit.date, dir));
    const replay = replayLedger(audit, ledger, { cwd: dir, standard: "rgaa" });
    expect(replay.fresh).toContain("11.2");
    const replayed = replay.adj.items.find((i) => i.criteriaId === "11.2");
    expect(replayed?.pages?.bad?.verdict).toBe("NC");
    expect(replayed?.pages?.good?.verdict).toBe("C");
    expect(replayed?.pages?.bad?.findings?.length).toBeGreaterThan(0);

    // …and the replayed verdict re-folds: the whole point of the ledger is a verdict that
    // re-passes TODAY's gate, page outcomes included.
    const residualReasons = Object.fromEntries(
      buildAdjudicationWorklist(audit, { standard: "rgaa" })
        .filter((i) => i.criteriaId !== "11.2")
        .map((i) => [i.criteriaId, "not re-adjudicated in this test"]),
    );
    const refold = applyAdjudication(audit, { ...replay.adj, auditDate: audit.date }, { cwd: dir, residualReasons });
    expect(refold.rejectedCriteria, refold.issues.join("\n")).toEqual([]);
    expect(refold.ok).toBe(true);
  });

  it("records only the page findings the gate checks, whatever junk the raw file carries", () => {
    const audit = auditOf();
    const adj = file([
      {
        ...plainItem(audit),
        verdict: "NC",
        justification: "",
        findings: [{ ...SOURCE_FINDING }],
        pages: { bad: { verdict: "NC", justification: 42, findings: [{ ...SOURCE_FINDING }, null, "bad.html:3", { message: "no file" }] } },
      } as unknown as AdjudicationItem,
    ]);
    const entry = entriesFrom(adj, new Set(["11.2"]), audit.date, dir).find((e) => e.criteriaId === "11.2");
    expect(entry?.pages?.bad?.findings?.map((f) => f.file)).toEqual(["bad.html"]);
    expect(entry?.pages?.bad && Object.hasOwn(entry.pages.bad, "justification")).toBe(false);
  });

  it("prunes a withdrawn anchor from the page it anchors, and drops a page-NC left findingless", () => {
    // The run-wide NC rests on bad's CAPTURE; the page outcome rests on bad's SOURCE. Withdrawing
    // the source anchor must NOT drop the entry — only the page outcome that finding anchored.
    const audit = auditOf();
    const adj = file([
      {
        ...itemWithCaptureAnchors(audit),
        verdict: "NC",
        justification: "",
        findings: [{ ...CAPTURE_FINDING }],
        pages: {
          bad: { verdict: "NC", justification: "Étiquette non pertinente sur cette page.", findings: [{ ...SOURCE_FINDING }] },
          good: { verdict: "C", justification: "Étiquette pertinente sur cette page.", citations: [{ ...GOOD_SOURCE_CITATION }] },
        },
      } as AdjudicationItem,
    ]);
    const r = applyAdjudication(audit, adj, { cwd: dir });
    expect(r.rejectedCriteria, r.issues.join("\n")).toEqual([]);
    const ledger = mergeLedger(undefined, "rgaa", entriesFrom(adj, new Set(["11.2"]), audit.date, dir));
    const refuted: VerifyItem[] = [
      { n: 1, criteriaId: "11.2", file: "bad.html", line: CAPTURE_LINE, selector: "label", claim: "Étiquette non pertinente.", verdict: "refuted", note: "" },
    ];
    const pruned = pruneLedger(ledger, refuted, [], [], dir);
    expect(pruned.removedFindings).toBe(1);
    expect(pruned.removedEntries).toBe(0);
    const kept = pruned.ledger.entries.find((e) => e.criteriaId === "11.2");
    expect(kept?.verdict).toBe("NC");
    expect(kept?.findings?.length).toBe(1);
    expect(Object.keys(kept?.pages ?? {}), "a page-NC left findingless must not survive").toEqual(["good"]);
    expect(kept?.pages?.good?.status).toBe("C");
  });
});

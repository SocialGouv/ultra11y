// WHAT THE BRIEF PROMISES MUST BE THERE (#131).
//
// A senior-auditor adjudication of egapro's 46 undecided criteria (39 captures) found three
// places where the brief or the contract misled its reader:
//   • every brief listed `axtree.json` among the capture files — no capture writes one;
//   • the 9.1 « À éviter » example (h1 → h3) taught that a skipped level fails 9.1, which the
//     RGAA glossary (« Titre ») says it does not;
//   • the gate requires a recommendation to be a `{ file, line, … }` object drawn from the
//     evidence, and the contract never said so — 6 criteria were refused for it.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import {
  adjudicationContract,
  applyAdjudication,
  buildAdjudicationWorklist,
  captureFilesPresent,
  formatAdjudication,
  type AdjudicationFile,
  type AdjudicationItem,
} from "../src/adjudicate.js";
import { guidanceForCriterion } from "../src/guidance/index.js";
import { PAGES_DIR, SNAPSHOT_VERSION, writeSnapshot } from "../src/snapshot.js";
import { verdictSystemPrompt } from "../src/verdict-rules.js";

const DOM = `<!doctype html><html lang="fr"><head><title>Aide</title></head><body><main><h1>Aide</h1><p style="color:#767676;background:#fff">Texte</p><a href="/c">Contact</a></main></body></html>`;

/** A capture holding exactly the files a producer supplied — `dom.html`/`meta.json` always. */
function capture(extra: Partial<Parameters<typeof writeSnapshot>[1]> = {}): { root: string; pages: string } {
  const root = mkdtempSync(join(tmpdir(), "u11y-brief-files-"));
  writeSnapshot(root, { meta: { v: SNAPSHOT_VERSION, id: "aide", name: "Aide", url: "https://x/aide" }, dom: DOM, ...extra } as Parameters<
    typeof writeSnapshot
  >[1]);
  return { root, pages: join(root, PAGES_DIR) };
}

const brief = (input: string, lang: "fr" | "en" = "fr") =>
  formatAdjudication(buildAdjudicationWorklist(runAudit({ inputs: [input] }), { standard: "rgaa" }), lang, "rgaa");

/** The « rendered page is available » note alone — the rest of a brief may quote file names
 *  of its own (an evidence path, a methodology). */
const renderedNote = (md: string): string => md.split("\n").find((l) => /RENDU DISPONIBLE|RENDERED PAGE IS AVAILABLE/.test(l)) ?? "";

describe("the brief names only the capture files that exist", () => {
  it("never promises an axtree.json no capture wrote — nor a digest the producer did not supply", () => {
    const { pages } = capture();
    for (const lang of ["fr", "en"] as const) {
      const note = renderedNote(brief(pages, lang));
      expect(note, lang).not.toBe("");
      expect(note).toContain("dom.html");
      for (const absent of ["axtree.json", "styles.json", "boxes.json", "screen.png"]) expect(note, `${lang}: ${absent}`).not.toContain(absent);
    }
  });

  it("names each digest that IS on disk, axtree.json included when a producer supplied it", () => {
    const { pages } = capture({
      styles: { v: 1, entries: [] },
      boxes: { v: 1, entries: [] },
      axtree: { role: "RootWebArea", name: "Aide" },
      // 1×1 transparent PNG
      screenshotBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    } as Partial<Parameters<typeof writeSnapshot>[1]>);
    const note = renderedNote(brief(pages));
    for (const present of ["dom.html", "styles.json", "boxes.json", "axtree.json", "screen.png"]) expect(note, present).toContain(present);
    for (const absent of ["css.json", "probes.json", "axe.json"]) expect(note, absent).not.toContain(absent);
  });

  it("captureFilesPresent reads the union across captures, in reading order, and never returns nothing", () => {
    const a = capture({ styles: { v: 1, entries: [] } } as Partial<Parameters<typeof writeSnapshot>[1]>);
    const b = capture({ boxes: { v: 1, entries: [] } } as Partial<Parameters<typeof writeSnapshot>[1]>);
    expect(captureFilesPresent([join(a.pages, "aide", "dom.html"), join(b.pages, "aide", "dom.html"), "src/App.tsx"])).toEqual([
      "dom.html",
      "styles.json",
      "boxes.json",
    ]);
    // Relative paths resolve against cwd.
    expect(captureFilesPresent([".ultra11y/pages/aide/dom.html"], a.root)).toEqual(["dom.html", "styles.json"]);
    // A capture that cannot be read from here: only the file the evidence itself names.
    expect(captureFilesPresent([".ultra11y/pages/nowhere/dom.html"], a.root)).toEqual(["dom.html"]);
  });

  it("the gate's needs-rendered-dom refusal lists the same files, and no phantom", () => {
    const { root } = capture({ styles: { v: 1, entries: [] } } as Partial<Parameters<typeof writeSnapshot>[1]>);
    const page = join(root, "page.html");
    writeFileSync(page, DOM);
    const item = {
      criteriaId: "1.4.1",
      automatability: "needs-rendering",
      verdict: "manual",
      reason: "needs-rendered-dom",
      evidence: [{ file: ".ultra11y/pages/aide/dom.html", line: 2, selector: "a", snippet: '<a href="/c">Contact</a>' }],
      citations: [],
    } as unknown as AdjudicationItem;
    const r = applyAdjudication(
      runAudit({ inputs: [page] }),
      { tool: "ultra11y", kind: "adjudication", schemaVersion: 2, standard: "wcag", auditDate: "2026-11-02", items: [item] } as AdjudicationFile,
      { cwd: root },
    );
    const refusal = r.issues.find((i) => /needs-rendered-dom/.test(i)) ?? "";
    expect(refusal).toContain("(dom.html, styles.json)");
    expect(refusal).not.toContain("axtree.json");
  });

  it("the judge's system prompt no longer promises axtree.json either", () => {
    expect(verdictSystemPrompt()).not.toContain("axtree.json");
    expect(verdictSystemPrompt()).toContain("dom.html");
  });
});

describe("the 9.1 guidance matches the RGAA text", () => {
  const [g] = guidanceForCriterion("rgaa", "9.1");

  it("does not show a skipped heading level as the thing to avoid", () => {
    expect(g).toBeDefined();
    for (const ex of g!.examples) {
      const bad = ex.bad ?? "";
      const levels = [...bad.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
      for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!, bad).toBeLessThanOrEqual(1);
    }
    // What it shows instead is a test 9.1 has: a passage acting as a heading, not marked up as one.
    expect(g!.examples.some((ex) => !/<h[1-6]\b[^>]*>Déclarer/.test(ex.bad ?? "") && /<h2>Déclarer en ligne<\/h2>/.test(ex.good ?? ""))).toBe(true);
  });

  it("says a skip or a missing h1 does not fail the criterion, as the glossary does", () => {
    expect(g!.summary.fr).toMatch(/n'invalide pas le critère/);
    expect(g!.summary.fr).not.toMatch(/sans saut de niveau|h1 unique/);
    expect(g!.summary.en).toMatch(/does not fail the criterion/);
    expect(g!.summary.en).not.toMatch(/no skipped level|single h1/);
  });

  it("and the 9.1 brief carries that example, never the h1 → h3 one", () => {
    const dir = mkdtempSync(join(tmpdir(), "u11y-91-"));
    const page = join(dir, "page.html");
    writeFileSync(page, `<!doctype html><html lang="fr"><head><title>T</title></head><body><main><h1>Titre</h1><h2>Section</h2></main></body></html>`);
    const items = buildAdjudicationWorklist(runAudit({ inputs: [page] }), { standard: "rgaa" }).filter((i) => i.criteriaId === "9.1");
    expect(items).toHaveLength(1);
    const md = formatAdjudication(items, "fr", "rgaa", { preamble: false });
    expect(md).not.toContain("<h1>Titre</h1><h3>Sous-section</h3>");
    expect(md).toContain("<h2>Déclarer en ligne</h2>");
  });
});

describe("the contract documents the recommendation shape", () => {
  it("in the machine-readable contract every worklist carries", () => {
    const rec = adjudicationContract().requires.recommendations;
    expect(rec).toBeDefined();
    expect(rec).toMatch(/OBJECT \{ file, line, message/);
    expect(rec).toMatch(/own evidence/);
    expect(rec).toMatch(/bare sentence/);
  });

  it("in the brief's rule, both languages", () => {
    const dir = mkdtempSync(join(tmpdir(), "u11y-rec-"));
    const page = join(dir, "page.html");
    writeFileSync(page, DOM);
    const items = buildAdjudicationWorklist(runAudit({ inputs: [page] }), { standard: "rgaa" }).slice(0, 1);
    expect(formatAdjudication(items, "fr", "rgaa", { preamble: false })).toMatch(/`recommendations\[\]`.*objet `\{ file, line, message/);
    expect(formatAdjudication(items, "en", "rgaa", { preamble: false })).toMatch(/`recommendations\[\]`.*object `\{ file, line, message/);
  });

  it("the gate still refuses a sentence, and its refusal names the shape", () => {
    const dir = mkdtempSync(join(tmpdir(), "u11y-rec2-"));
    const page = join(dir, "page.html");
    writeFileSync(page, DOM);
    const audit = runAudit({ inputs: [page] });
    const items = buildAdjudicationWorklist(audit).map(
      (i, n) =>
        ({
          ...i,
          verdict: "manual",
          reason: "undecidable",
          ...(n === 0 ? { recommendations: ["Ajouter un lien d'évitement." as unknown as never] } : {}),
        }) as AdjudicationItem,
    );
    const r = applyAdjudication(audit, { tool: "ultra11y", kind: "adjudication", schemaVersion: 2, standard: "wcag", auditDate: "2026-11-02", items });
    expect(r.rejectedCriteria).toEqual([items[0]!.criteriaId]);
    expect(r.issues.join("\n")).toMatch(/object \{ file, line, message/);
  });

  it("…and accepts the documented shape, grounded on the criterion's evidence", () => {
    const dir = mkdtempSync(join(tmpdir(), "u11y-rec3-"));
    const page = join(dir, "page.html");
    writeFileSync(page, DOM);
    const audit = runAudit({ inputs: [page] });
    const items = buildAdjudicationWorklist(audit);
    const withEv = items.findIndex((i) => i.evidence.some((e) => e.snippet));
    expect(withEv).toBeGreaterThanOrEqual(0);
    const ev = items[withEv]!.evidence.find((e) => e.snippet)!;
    const filled = items.map(
      (i, n) =>
        ({
          ...i,
          verdict: "manual",
          reason: "undecidable",
          ...(n === withEv
            ? { recommendations: [{ file: ev.file, line: ev.line, selector: ev.selector, snippet: ev.snippet, message: "Bonne pratique." }] }
            : {}),
        }) as AdjudicationItem,
    );
    const r = applyAdjudication(audit, { tool: "ultra11y", kind: "adjudication", schemaVersion: 2, standard: "wcag", auditDate: "2026-11-02", items: filled });
    expect(r.rejected, r.issues.join(" | ")).toBe(0);
  });
});

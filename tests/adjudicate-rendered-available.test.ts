// « IL FAUT UN DOM RENDU » EST FAUX QUAND LE DOM RENDU EST LÀ.
//
// A criterion the engine flags `needs-rendering` — colour information, keyboard operability of a
// script, a pointer gesture — was handed to the adjudicator with one instruction: answer
// `needs-rendered-dom` and let `scan` deal with it. On an audit that has just ingested
// thirty-five page snapshots, that is simply untrue: the rendered DOM is on disk, with its
// computed styles, its boxes, its accessibility tree and a screenshot per page.
//
// Measured on a real run: 3.1, 7.3 and 12.9 came back `needs-rendered-dom` while
// `.ultra11y/pages/` held the very captures that settle them. No amount of budget fixes that —
// the tool was telling the adjudicator to give up.
//
// So when the harvest carries snapshot anchors, the brief says so, names the files, and says
// what `needs-rendered-dom` is still for: a criterion with NO capture behind it.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { buildAdjudicationWorklist, formatAdjudication, unrenderedResidual } from "../src/adjudicate.js";
import { PAGES_DIR, SNAPSHOT_VERSION, writeSnapshot } from "../src/snapshot.js";

const DOM = `<!doctype html><html lang="fr"><head><title>Aide</title></head><body><main><h1>Aide</h1><p style="color:#767676;background:#fff">Texte</p><a href="/c">Contact</a></main></body></html>`;

function withSnapshots(): string {
  const root = mkdtempSync(join(tmpdir(), "u11y-rend-"));
  writeSnapshot(root, {
    meta: { v: SNAPSHOT_VERSION, id: "aide", name: "Aide", url: "https://x/aide" },
    dom: DOM,
  } as Parameters<typeof writeSnapshot>[1]);
  return join(root, PAGES_DIR);
}

function sourceOnly(): string {
  const dir = mkdtempSync(join(tmpdir(), "u11y-src-"));
  const f = join(dir, "page.html");
  writeFileSync(f, DOM);
  return f;
}

const brief = (input: string, lang: "fr" | "en" = "fr") =>
  formatAdjudication(buildAdjudicationWorklist(runAudit({ inputs: [input] }), { standard: "rgaa" }), lang, "rgaa");

describe("the brief says the rendered DOM is available, when it is", () => {
  it("tells the adjudicator the capture is there, and what it holds", () => {
    const md = brief(withSnapshots());
    expect(md).toMatch(/RENDU DISPONIBLE|rendu de la page est/i);
    // The files that settle a rendering criterion, named so they can be opened.
    for (const f of ["dom.html", "styles.json", "boxes.json"]) expect(md).toContain(f);
  });

  it("says what `needs-rendered-dom` is still for — a criterion with NO capture behind it", () => {
    expect(brief(withSnapshots())).toMatch(/needs-rendered-dom/);
    expect(brief(withSnapshots())).toMatch(/aucune capture|sans capture/i);
  });

  it("says it in English too", () => {
    const md = brief(withSnapshots(), "en");
    expect(md).toMatch(/RENDERED PAGE IS AVAILABLE|the rendered page is/i);
    expect(md).toContain("styles.json");
  });

  it("keeps quiet when there is genuinely nothing rendered to read", () => {
    // The note must not appear on a source-only audit: there, `needs-rendered-dom` IS the
    // correct answer, and saying otherwise would push an adjudicator to guess.
    expect(brief(sourceOnly())).not.toMatch(/RENDU DISPONIBLE|styles\.json/);
  });
});

// THE MIRROR, AND THE MORE EXPENSIVE FAILURE OF THE TWO.
//
// The gate above catches a deferral to a tier that has already run. This one catches the
// opposite: a run where the tier NEVER ran. Measured on the 2026-08-20 RGAA cascade — three
// passes, 311 turns, $24.90 — seven criteria came back `needs-rendered-dom` and every one of
// them was RIGHT, because the workflow audited sources only and no page was ever snapshotted.
// Nothing in the run said so. The bill was paid to be told that a step nobody had run had not
// run.
//
// Advisory, never a gate here: a source-only audit is a legitimate thing to want, and the
// worklist is not where a project's scope gets decided. `check --require-rendered` is the
// opt-in that fails.
describe("the worklist says when NOTHING was rendered", () => {
  const worklistFor = (input: string) => {
    const audit = runAudit({ inputs: [input] });
    return { audit, items: buildAdjudicationWorklist(audit, { standard: "rgaa" }) };
  };

  it("names only criteria whose decisive rendered test nobody could have measured", () => {
    const { audit, items } = worklistFor(sourceOnly());
    const open = unrenderedResidual(audit, items);
    expect(open.length).toBeGreaterThan(0);
    expect(open).toEqual(["1.1", "8.1", "10.7"]);
  });

  it("says nothing once a page's real DOM has been read", () => {
    const { audit, items } = worklistFor(join(withSnapshots(), "aide", "dom.html"));
    expect(unrenderedResidual(audit, items)).toEqual([]);
  });

  it("puts the warning, and the ids, in the brief", () => {
    const { audit, items } = worklistFor(sourceOnly());
    const md = formatAdjudication(items, "fr", "rgaa", { unrendered: unrenderedResidual(audit, items) });
    expect(md).toMatch(/aucune page.*instantan|scan/i);
    expect(md).toContain("`8.1`");
    expect(md).toContain("`10.7`");
  });

  it("says it in English too, and names the command that closes it", () => {
    const { audit, items } = worklistFor(sourceOnly());
    const md = formatAdjudication(items, "en", "rgaa", { unrendered: unrenderedResidual(audit, items) });
    expect(md).toMatch(/no page.*snapshot/i);
    expect(md).toContain("scan");
  });

  it("adds nothing to a brief that was not given the list", () => {
    const { items } = worklistFor(sourceOnly());
    expect(formatAdjudication(items, "fr", "rgaa")).not.toMatch(/aucune page n'a été/i);
  });
});

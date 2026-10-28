// THE CRITERIA EVERY PAGE IS SUBJECT TO, AND WHAT THE ADJUDICATOR IS GIVEN TO RULE THEM (#65).
//
// Measured on the documentation site, crawled and scanned: 3.2, 3.3, 7.3, 10.1, 10.4, 10.5,
// 10.9, 10.10, 10.11, 10.12, 10.14, 12.9, 12.11, 13.9 and 13.11 reached the worklist with NO
// evidence, so the gate refused every `C` and the adjudicator could only answer « undecidable »
// or NA. The five wrong NAs of #61 (8.2, 10.11, 10.12, 12.8, 13.9) were written exactly there.
//
// Two guarantees, pinned here:
//   1. on an ordinary styled page with no ARIA, no tabindex and no inline style, each of those
//      criteria is handed SOMETHING to cite: the stylesheets, the declarations that matter, the
//      tab order, the markup to validate — and on a capture, what the browser measured;
//   2. for the criteria every page with content is subject to, an agent's NA is refused.
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { applyAdjudication, buildAdjudicationWorklist } from "../src/adjudicate.js";
import { runAudit } from "../src/audit.js";
import type { AdjudicationFile, AdjudicationItem } from "../src/adjudicate.js";

const root = mkdtempSync(join(tmpdir(), "u11y-rendering-evidence-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const PAGE = join(root, "page.html");
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Démarches — Mairie</title>
<style>
  body { color: #1e1e1e; background-color: #ffffff; }
  a { color: #000091; }
  .carte { width: 400px; line-height: 1.4; }
</style></head><body>
<header><nav><a href="/">Accueil</a> <a href="/contact">Contact</a></nav></header>
<main><h1>Démarches</h1><p class="carte">Pour continuer, cliquez sur le bouton « Valider » ci-dessous.</p>
<form action="/valider"><button type="submit">Valider</button></form></main>
</body></html>`,
);
const audit = runAudit({ inputs: [PAGE] });
const items = buildAdjudicationWorklist(audit, { standard: "rgaa", cwd: root });
const item = (id: string) => items.find((i) => i.criteriaId === id)!;

describe("a rendering criterion arrives with something to cite", () => {
  it.each(["3.2", "3.3", "7.3", "8.2", "10.1", "10.4", "10.5", "10.9", "10.10", "10.11", "10.12", "12.8", "13.9", "13.11"])("%s", (id) => {
    expect(item(id), `${id} is not on the worklist`).toBeDefined();
    expect(item(id).evidence.length, `${id} has no evidence`).toBeGreaterThan(0);
  });

  it("aims it: the fixed width is reflow's, the line-height spacing's, the colour declarations contrast's", () => {
    const notes = (id: string) =>
      item(id)
        .evidence.map((e) => e.note ?? "")
        .join("\n");
    expect(notes("10.11")).toMatch(/width: 400px/);
    expect(notes("10.12")).toMatch(/line-height/);
    expect(notes("3.2")).toMatch(/color: #1e1e1e/);
    expect(notes("12.8")).toMatch(/tab order/);
    expect(notes("8.2")).toMatch(/W3C Nu/);
  });

  it("on a recorded capture, hands over what the browser MEASURED — probes that ran and found nothing included", () => {
    const pages = join(root, "golden");
    cpSync(join(import.meta.dirname, "fixtures", "rgaa-golden", "rendered"), pages, { recursive: true });
    const captured = runAudit({ inputs: [join(pages, ".ultra11y", "pages", "conforme-html")] });
    const worklist = buildAdjudicationWorklist(captured, { standard: "rgaa", cwd: pages });
    const notes = (id: string) => (worklist.find((i) => i.criteriaId === id)?.evidence ?? []).map((e) => e.note ?? "").join("\n");
    expect(notes("10.11")).toMatch(/live probe for WCAG 1\.4\.10 RAN: horizontal scroll at 320px: no; 0 issue/);
    expect(notes("10.12")).toMatch(/live probe for WCAG 1\.4\.12 RAN/);
    expect(notes("3.2")).toMatch(/computed text colour .* — \d+\.\d+:1/);
  });
});

describe("« non applicable » is refused where every page is concerned", () => {
  const fold = (id: string, verdict: "NA" | "C") => {
    const it = item(id);
    const adjudicated: AdjudicationItem = { ...it, verdict, justification: "Rien sur la page n'est concerné.", citations: it.evidence.slice(0, 1) };
    const file: AdjudicationFile = {
      tool: "ultra11y",
      kind: "adjudication",
      schemaVersion: 2,
      standard: "rgaa",
      auditDate: "2026-10-28",
      items: [adjudicated],
    };
    return applyAdjudication(audit, file, { cwd: root });
  };

  it.each(["8.2", "10.4", "10.11", "10.12", "12.8", "13.9"])("%s", (id) => {
    expect(fold(id, "NA").issues.join("\n")).toMatch(/applies to every page with content/);
    expect(fold(id, "C").issues.join("\n")).not.toMatch(/applies to every page with content/);
  });
});

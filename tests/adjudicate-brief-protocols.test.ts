// EVERY BRIEF CARRIES ITS PROTOCOL, AND EVERY PROCEDURE WHOLE (#230).
//
// A full skill-driven audit (ultra11y 9.6.1, RGAA) found that judgment.md's promise — each
// ADJUDICATE.md item preloaded with its decision protocol (src/data/adjudication.json) — held
// for 0 of 102 briefs, and that the official test methodologies were cut at 900/260 characters
// with « … » (11 cuts in 1.1.md alone), losing the sentence that says when a test passes.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { adjudicationForWcagRefs } from "../src/adjudication-data.js";
import { buildAdjudicationWorklist, formatAdjudication, writeAdjudication } from "../src/adjudicate.js";
import { runAudit } from "../src/audit.js";
import { getCriterion, loadPack } from "../src/standards/index.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-protocols-"));
const PAGE = join(dir, "page.html");
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Boutique</title></head><body><main>
<h1>Bienvenue</h1><img src="a.png" alt="Un randonneur"><img src="b.png" alt="">
<form action="/x"><label for="e">Email</label><input id="e" type="email"><button>Envoyer</button></form>
<a href="/aide">Contacter le support</a><a href="/x">ici</a>
</main></body></html>`,
);

const items = () => buildAdjudicationWorklist(runAudit({ inputs: [PAGE] }), { standard: "rgaa" });
const pack = loadPack("rgaa");

/** A methodology as the brief prints it: cross-references reduced to their label, one line. */
const flat = (s: string) =>
  s
    .replace(/\[([^\]]+)\]\(#[^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

describe("each RGAA brief carries the decision protocol of the WCAG criteria it maps onto", () => {
  it("prints every mapped protocol — decision rule, NA rule and questions — in every brief", () => {
    let withProtocol = 0;
    for (const it of items()) {
      const md = formatAdjudication([it], "fr", "rgaa", { preamble: false });
      const protocols = adjudicationForWcagRefs(getCriterion(pack, it.criteriaId)?.wcag ?? [], "fr");
      if (!protocols.length) continue;
      withProtocol++;
      expect(md, it.criteriaId).toContain("### Protocole de décision hérité de WCAG");
      for (const p of protocols) {
        expect(md, `${it.criteriaId} ← ${p.sc}`).toContain(`> **Critère de succès WCAG ${p.sc}** — ${p.decide}`);
        if (p.na) expect(md, `${it.criteriaId} ← ${p.sc} NA`).toContain(p.na);
        for (const q of p.questions) expect(md, `${it.criteriaId} ← ${p.sc}`).toContain(`- ${q}`);
      }
    }
    // Non-vacuous: almost every RGAA criterion maps onto at least one judged success criterion.
    expect(withProtocol).toBeGreaterThan(50);
  });

  it("places it after the standard's own text and labels it as subordinate to it", () => {
    const it11 = items().find((i) => i.criteriaId === "1.1")!;
    for (const lang of ["fr", "en"] as const) {
      const md = formatAdjudication([it11], lang, "rgaa", { preamble: false });
      const heading = lang === "fr" ? "### Protocole de décision hérité de WCAG" : "### Decision protocol inherited from WCAG";
      const at = md.indexOf(heading);
      expect(at, lang).toBeGreaterThan(0);
      // Below the numbered tests and their methodology — never in place of them.
      expect(md.indexOf("`1.1.1`")).toBeLessThan(at);
      expect(md.slice(at)).toMatch(lang === "fr" ? /priment et fondent seuls le verdict/ : /prevail and alone ground the verdict/);
      expect(md.slice(at)).toContain(lang === "fr" ? "Critère de succès WCAG 1.1.1" : "WCAG success criterion 1.1.1");
    }
  });

  it("lands in the on-disk briefs and in ADJUDICATE.md, never in the shared contract", () => {
    const out = mkdtempSync(join(tmpdir(), "u11y-protocols-out-"));
    const w = writeAdjudication(items(), out, { standard: "rgaa", auditDate: "2026-11-25", lang: "fr" });
    expect(readFileSync(join(w.itemsDir, "1.1.md"), "utf8")).toContain("Critère de succès WCAG 1.1.1");
    expect(readFileSync(w.mdPath, "utf8")).toContain("Critère de succès WCAG 1.1.1");
    expect(readFileSync(w.contractPath, "utf8")).not.toContain("Protocole de décision hérité de WCAG");
  });

  it("can be billed apart from the body under `protocols: false`", () => {
    const it11 = items().find((i) => i.criteriaId === "1.1")!;
    const md = formatAdjudication([it11], "fr", "rgaa", { preamble: false, protocols: false });
    expect(md).not.toContain("Protocole de décision hérité de WCAG");
    expect(md).toContain("`1.1.1`");
  });
});

describe("an official test methodology is never truncated", () => {
  it("prints every procedure of every criterion whole, touched by the harvest or not", () => {
    let checked = 0;
    for (const it of items()) {
      const md = formatAdjudication([it], "fr", "rgaa", { preamble: false, contract: false });
      const methodology = getCriterion(pack, it.criteriaId)?.methodology ?? {};
      for (const [k, text] of Object.entries(methodology)) {
        if (!text.trim()) continue;
        if (it.testIds?.length && !it.testIds.includes(`${it.criteriaId}.${k}`)) continue;
        expect(md, `${it.criteriaId}.${k}`).toContain(`_Méthodologie de test officielle_ : ${flat(text)}`);
        checked++;
      }
      for (const m of md.matchAll(/_Méthodologie de test officielle_ : (.*)/g)) expect(m[1]!.endsWith("…"), m[1]!.slice(0, 60)).toBe(false);
    }
    expect(checked).toBeGreaterThan(150);
  });

  it("keeps RGAA 1.1's procedures to their last sentence", () => {
    const md = formatAdjudication([items().find((i) => i.criteriaId === "1.1")!], "fr", "rgaa", { preamble: false });
    const lines = [...md.matchAll(/_Méthodologie de test officielle_ : (.*)/g)].map((m) => m[1]!);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line, line.slice(0, 60)).toMatch(/[.»)]$/);
  });
});

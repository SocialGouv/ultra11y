// WHAT THE ADJUDICATION PASS PAYS FOR, AS A TRACKED NUMBER.
//
// At `--grain criterion` — the grain the reliable recipe uses, because it is the one where a
// killed run loses a single criterion — every fixed block in the brief is paid once PER
// CRITERION. Measured on a full RGAA worklist before this was looked at: 622 KB, ≈173 000
// input tokens for one pass, of which 28% was the verdict contract restated 81 times beside a
// system prompt that already carried every one of its clauses.
//
// The cuts are of two kinds, and only one of them is free:
//
//   FREE — the contract, under `contract: false`. `verdictSystemPrompt()` and the brief's
//   contract come from the same source (src/verdict-rules.ts), so a backend that sends the
//   system prompt is sending it twice. Only `judge` sets the flag, and only because it is the
//   one caller that provably ships a system prompt.
//
//   PAID — the procedure of a test whose mechanism the harvest did not find. It is bounded
//   rather than removed, and the WORDING of every test stays whole. The glossary is NOT on this
//   list any more (#182): every term the criterion cites is printed, each definition whole.
//
// This file pins both, and the ceiling, so context cost cannot drift without a diff saying so.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import { buildAdjudicationWorklist, formatAdjudication, glossaryAnchorsOf } from "../src/adjudicate.js";
import { getCriterion, loadPack, resolveGlossary } from "../src/standards/index.js";
import { verdictSystemPrompt } from "../src/verdict-rules.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-ctx-"));
const PAGE = join(dir, "page.html");
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Boutique</title></head><body><main>
<h1>Bienvenue</h1><img src="a.png" alt="Un randonneur"><img src="b.png" alt="">
<form action="/x"><label for="e">Email</label><input id="e" type="email">
<input id="f" type="text"><button>Envoyer</button></form>
<table><caption>Prix</caption><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
<a href="/aide">Contacter le support</a><a href="/x">ici</a>
</main></body></html>`,
);

const items = () => buildAdjudicationWorklist(runAudit({ inputs: [PAGE] }), { standard: "rgaa" });

/** Every definition the glossary block prints: the `- **term** — …` lines that follow its
 *  heading (and the blank line after it), up to the first line that is not one. */
function printedDefinitions(md: string): string[] {
  const lines = md.split("\n");
  const start = lines.indexOf("> **Termes définis par le référentiel**");
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("- **")) out.push(line);
    else if (line === "" && !out.length) continue;
    else break;
  }
  return out;
}

describe("the contract is dropped only where a system prompt already carries it", () => {
  const one = () => [items()[0]!];

  it("is present by default — a brief read with no system prompt must carry its own rules", () => {
    const md = formatAdjudication(one(), "fr", "rgaa", { preamble: false });
    expect(md).toMatch(/CONTRAT DE VERDICT|VERDICT CONTRACT/);
  });

  it("is absent under `contract: false`", () => {
    const md = formatAdjudication(one(), "fr", "rgaa", { preamble: false, contract: false });
    expect(md).not.toMatch(/CONTRAT DE VERDICT|VERDICT CONTRACT/);
  });

  // The point of the cut: nothing normative is lost, it is stated once instead of N times.
  it("says the same things the system prompt says", () => {
    const sys = verdictSystemPrompt();
    for (const clause of ["C", "NC", "NA", "manual"]) expect(sys).toContain(clause);
    expect(sys).toMatch(/normativeRef/);
    expect(sys).toMatch(/citation/i);
  });

  // The on-disk briefs (#222): the contract is written ONCE to ADJUDICATE.contract.md and each
  // brief carries a one-line pointer. The saving is the whole inline contract, per criterion.
  it("is a one-line pointer under `sharedContract`, saving the whole inline contract per brief", () => {
    const inline = formatAdjudication(one(), "fr", "rgaa", { preamble: false });
    const shared = formatAdjudication(one(), "fr", "rgaa", { preamble: false, sharedContract: "ADJUDICATE.contract.md" });
    expect(shared).toMatch(/CONTRAT DE VERDICT/);
    expect(shared).toContain("ADJUDICATE.contract.md");
    expect(shared).not.toMatch(/UNE NC EN FORME D'ABSENCE/);
    expect(inline.length - shared.length).toBeGreaterThan(2000);
  });

  it("still renders the criterion itself, its tests and its evidence", () => {
    const md = formatAdjudication(one(), "fr", "rgaa", { preamble: false, contract: false });
    expect(md).toMatch(/^#{1,3} .*\d+\.\d+/m);
    expect(md).toMatch(/Tests RGAA/);
  });
});

describe("the bounded blocks stay bounded", () => {
  const all = () => items().map((it) => formatAdjudication([it], "fr", "rgaa", { preamble: false, contract: false }));

  it("never cuts a glossary definition — the glossary is not a bounded block (#182)", () => {
    const pack = loadPack("rgaa");
    let checked = 0;
    for (const it of items()) {
      const md = formatAdjudication([it], "fr", "rgaa", { preamble: false, contract: false });
      const expected = glossaryAnchorsOf(getCriterion(pack, it.criteriaId))
        .map((a) => resolveGlossary("rgaa", a))
        .filter((e) => e !== undefined)
        .map((e) => `- **${e.title}** — ${e.body.replace(/\s+/g, " ").trim()}`);
      const printed = printedDefinitions(md);
      expect(printed, it.criteriaId).toEqual(expected);
      checked += printed.length;
    }
    // Non-vacuous: a worklist of ~100 RGAA criteria cites hundreds of defined terms.
    expect(checked).toBeGreaterThan(100);
  });

  it("the extractor sees a cut definition — the check above can fail", () => {
    const md = formatAdjudication([items().find((i) => i.criteriaId === "11.5") ?? items()[0]!], "fr", "rgaa", { preamble: false, contract: false });
    const printed = printedDefinitions(md);
    expect(printed.length).toBeGreaterThan(0);
    const cut = md.replace(printed[0]!, `${printed[0]!.slice(0, 120)}…`);
    expect(printedDefinitions(cut)).not.toEqual(printed);
  });

  it("keeps every numbered test's WORDING, never abridged by the procedure budget", () => {
    // The budget cuts procedures, never wordings: an unmarked test is still the adjudicator's
    // to rule on, and a test it cannot read is a test it will skip.
    const md = formatAdjudication([items().find((i) => i.criteriaId === "11.2")!], "fr", "rgaa", { preamble: false, contract: false });
    for (const n of ["11.2.1", "11.2.2", "11.2.3", "11.2.4", "11.2.5", "11.2.6"]) expect(md).toContain(`\`${n}\``);
  });

  it("never truncates a procedure below the untouched budget", () => {
    for (const md of all()) {
      for (const m of md.matchAll(/_Méthodologie de test officielle_ : (.*)/g)) {
        const text = m[1]!;
        if (text.endsWith("…")) expect(text.length, text.slice(0, 60)).toBeGreaterThanOrEqual(260);
      }
    }
  });
});

// A RATCHET, in the spirit of tests/rgaa-coverage.test.ts's FLOOR. It is not a performance
// micro-benchmark: it is the bill. Every character here is bought once per criterion, on every
// pass, on every run, and a block quietly added to the brief is a line item nobody voted for.
//
// WHEN THIS GOES RED after a `standards-refresh`, the pack's own text grew and the ceiling
// moves with a one-line diff that says so. When it goes red after a change to the BRIEF, ask
// what was added and whether a model that already has the criterion's tests needed it.
//
// 5600 → 6500 (#182): the glossary is printed whole, every cited term and every definition in
// full. A cut definition was the main cause of disputed non-conformities in a field review;
// the ~700 characters per criterion it costs were voted for.
describe("the context bill", () => {
  it("stays under its ceiling for a full RGAA worklist at criterion grain", () => {
    const rendered = items().map((it) => formatAdjudication([it], "fr", "rgaa", { preamble: false, contract: false }));
    const total = rendered.reduce((a, md) => a + md.length, 0);
    const perCriterion = Math.round(total / rendered.length);
    expect(rendered.length).toBeGreaterThan(50);
    expect(perCriterion, `${perCriterion} characters per criterion × ${rendered.length} criteria = ${total}`).toBeLessThan(6500);
  });
});

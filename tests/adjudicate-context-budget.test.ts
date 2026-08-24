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
//   PAID — the glossary's tail and the procedure of a test whose mechanism the harvest did not
//   find. Both are bounded rather than removed, and the WORDING of every test stays whole.
//
// This file pins both, and the ceiling, so context cost cannot drift without a diff saying so.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import { buildAdjudicationWorklist, formatAdjudication } from "../src/adjudicate.js";
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

  it("still renders the criterion itself, its tests and its evidence", () => {
    const md = formatAdjudication(one(), "fr", "rgaa", { preamble: false, contract: false });
    expect(md).toMatch(/^#{1,3} .*\d+\.\d+/m);
    expect(md).toMatch(/Tests RGAA/);
  });
});

describe("the bounded blocks stay bounded", () => {
  const all = () => items().map((it) => formatAdjudication([it], "fr", "rgaa", { preamble: false, contract: false }));

  it("never prints more than five glossary terms for one criterion", () => {
    for (const md of all()) {
      const block = md.split("**Termes définis par le référentiel**")[1]?.split("\n\n")[0] ?? "";
      expect(block.split("\n").filter((l) => l.startsWith("- **")).length).toBeLessThanOrEqual(5);
    }
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
describe("the context bill", () => {
  it("stays under its ceiling for a full RGAA worklist at criterion grain", () => {
    const rendered = items().map((it) => formatAdjudication([it], "fr", "rgaa", { preamble: false, contract: false }));
    const total = rendered.reduce((a, md) => a + md.length, 0);
    const perCriterion = Math.round(total / rendered.length);
    expect(rendered.length).toBeGreaterThan(50);
    expect(perCriterion, `${perCriterion} characters per criterion × ${rendered.length} criteria = ${total}`).toBeLessThan(5600);
  });
});

// RGAA RULING NOTES, A SEVERITY RUBRIC AND 8.7 CANDIDATES (#183).
//
// A field review found verdicts and severities the RGAA method does not support, on criteria
// whose deciding sentence was already in the brief: 9.4 « citations » that were tooltips and
// page titles, 10.10 NCs over a reference that named its target, 10.11 NCs over a decorative
// overflow, 6.1 placeholder links ruled bloquant where the particular case makes them NA, and
// the same links charged again under 12.3. Severity was a bare enum. And 8.7 had nothing to
// show on a French page saying « deep linking ».
//
// Pinned here: every ruling note rests on words the vendored standard actually contains; the
// notes and the rubric reach the brief; the fold caps a recommendation and names a defect
// charged twice; the 8.7 harvester surfaces English terms and stays quiet on French borrowings.
// Synthetic fixtures throughout.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import {
  agentSeverity,
  applyAdjudication,
  buildAdjudicationWorklist,
  duplicateCharges,
  formatAdjudication,
  renderAdjudicationReference,
  type AdjudicationFile,
  type AdjudicationItem,
} from "../src/adjudicate.js";
import { englishTermsIn, SUBJECTS } from "../src/adjudicate-subjects.js";
import { PACK_RULINGS, packRulingNotes, severityRubricLine } from "../src/adjudication-rulings.js";
import { orchestrateRun } from "../src/orchestrate.js";
import { parseHtml } from "../src/parse/html.js";
import rgaa from "../src/data/standards/rgaa.json";
import glossary from "../src/data/standards/rgaa.glossary.json";
import type { Finding } from "../src/types.js";

/** Every word of the vendored standard a ruling may quote: tests, methodology, notes, glossary. */
function packCorpus(): string {
  const parts: string[] = [];
  for (const c of (rgaa as unknown as { criteria: Record<string, unknown>[] }).criteria) {
    parts.push(JSON.stringify((c.title as { fr?: string })?.fr ?? ""));
    for (const lines of Object.values((c.tests ?? {}) as Record<string, string[]>)) parts.push(...lines);
    parts.push(...Object.values((c.methodology ?? {}) as Record<string, string>));
    parts.push(...((c.technicalNote ?? []) as string[]), ...((c.particularCases ?? []) as string[]));
  }
  for (const e of Object.values(glossary as Record<string, { body?: string }>)) parts.push(e.body ?? "");
  return spaces(parts.join("\n"));
}

/** French typography puts a no-break space before « ; : ? ! » — a quote typed in source code
 *  carries a plain one. The words must match; the kind of space is not the claim. */
const spaces = (s: string): string => s.replace(/[\u00a0\u202f]/g, " ");

describe("every ruling note rests on the standard's own words", () => {
  const corpus = packCorpus();
  for (const [pack, byId] of Object.entries(PACK_RULINGS)) {
    for (const [id, r] of Object.entries(byId)) {
      it(`${pack} ${id}: each quoted ground occurs verbatim in the vendored pack`, () => {
        expect(r.grounds.length).toBeGreaterThan(0);
        for (const g of r.grounds) expect(corpus, `« ${g} » is not in the pack`).toContain(spaces(g));
      });
      it(`${pack} ${id}: every note exists in both languages`, () => {
        for (const n of r.notes) {
          expect(n.fr.trim()).not.toBe("");
          expect(n.en.trim()).not.toBe("");
        }
      });
    }
  }

  it("covers the criteria the field review found misread", () => {
    expect(Object.keys(PACK_RULINGS.rgaa ?? {}).sort()).toEqual(["10.10", "10.11", "12.3", "6.1", "8.7", "9.4"].sort());
  });
});

describe("the notes say what the method says", () => {
  const en = (id: string) => packRulingNotes("rgaa", id, "en").join("\n");
  it("9.4: a citation is a third party's verbatim words; inline fails only 9.4.1; no <blockquote> in phrasing content", () => {
    expect(en("9.4")).toMatch(/THIRD PARTY, presented as reproduced verbatim/);
    expect(en("9.4")).toMatch(/glossary tooltip/);
    expect(en("9.4")).toMatch(/can only fail 9\.4\.1/);
    expect(en("9.4")).toMatch(/Never propose `<blockquote>` where only phrasing content is allowed/);
  });
  it("10.10: a reference that names its target passes even when the name is stale", () => {
    expect(en("10.10")).toMatch(/even when the name it uses is stale/);
    expect(en("10.10")).toMatch(/a recommendation, not a 10\.10 NC/);
  });
  it("10.11: NC only when information or a function is unavailable; decorative overflow is a recommendation; one finding per shared component", () => {
    expect(en("10.11")).toMatch(/INFORMATION or FUNCTION is no longer available/);
    expect(en("10.11")).toMatch(/decorative image, or of a box alone .* is a recommendation/);
    expect(en("10.11")).toMatch(/ONE finding/);
    expect(en("10.11")).toMatch(/not a rule of the standard/);
  });
  it("6.1: a placeholder link meaningless to everyone is NA; `title` is not a link context", () => {
    expect(en("6.1")).toMatch(/ambigu pour tout le monde.*NOT APPLICABLE/s);
    expect(en("6.1")).toMatch(/`title` attribute is NOT a link context/);
  });
  it("12.3: placeholder entries are at most one mineur 12.3.3, after checking the targets", () => {
    expect(en("12.3")).toMatch(/AT MOST one minor \(`mineur`\) NC on 12\.3\.3/);
    expect(en("12.3")).toMatch(/only AFTER checking where the links lead/);
  });
});

// ---- the brief ---------------------------------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), "u11y-rulings-"));
const PAGE = join(dir, "page.html");
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Plan du site</title></head><body><header><nav aria-label="Principale"><ul>
<li><a href="#">Inaccessible</a></li>
<li><a href="/contact">Contact</a></li>
</ul></nav></header><main><h1>Plan du site</h1>
<p>Le service propose le deep linking vers chaque fiche, comme l'indique le bouton Outils d'accessibilité en haut à droite.</p>
<p>Selon l'autrice, « la mesure ne vaut que si elle est publiée en entier ».</p>
<blockquote><p>Un texte cité en bloc, pour la démonstration.</p></blockquote>
</main><footer><a href="/mentions">Mentions légales</a></footer></body></html>`,
);
const audit = () => runAudit({ inputs: [PAGE] });
const worklist = () => buildAdjudicationWorklist(audit(), { standard: "rgaa" });
const briefOf = (id: string, lang: "fr" | "en" = "en") => {
  const items = worklist().filter((it) => it.criteriaId === id);
  expect(items, `${id} is not in the worklist`).toHaveLength(1);
  return formatAdjudication(items, lang, "rgaa", { preamble: false });
};

describe("the ruling notes reach the per-criterion brief", () => {
  for (const id of ["9.4", "10.10", "10.11", "6.1", "12.3", "8.7"]) {
    it(`RGAA ${id}: printed under the criterion's own text, in the brief's language`, () => {
      const items = worklist().filter((it) => it.criteriaId === id);
      if (!items.length) return; // closed by the engine on this page: no brief to carry it
      for (const lang of ["en", "fr"] as const) {
        const md = formatAdjudication(items, lang, "rgaa", { preamble: false });
        for (const n of packRulingNotes("rgaa", id, lang)) expect(md).toContain(n);
      }
    });
  }

  it("at least the citation and link criteria are open on this page, so the test is not vacuous", () => {
    const open = new Set(worklist().map((it) => it.criteriaId));
    expect(open.has("9.4")).toBe(true);
    expect(open.has("6.1")).toBe(true);
    expect(briefOf("9.4")).toMatch(/How the RGAA text settles this criterion's recurring cases/);
  });

  it("a criterion with no ruling note gets no ruling block", () => {
    const id = worklist().find((it) => !packRulingNotes("rgaa", it.criteriaId, "en").length)?.criteriaId;
    expect(id).toBeDefined();
    expect(briefOf(id!)).not.toMatch(/settles this criterion's recurring cases/);
  });

  it("every brief carries the severity rubric, in both languages", () => {
    expect(briefOf("9.4", "en")).toContain(severityRubricLine("en"));
    expect(briefOf("9.4", "fr")).toContain(severityRubricLine("fr"));
    expect(severityRubricLine("en")).toMatch(
      /`bloquant`: no access, no workaround; `majeur`: access at the cost of a significant extra effort; `mineur`: a nuisance/,
    );
  });

  it("…and the combined document too, but not a brief sent with its own system prompt", () => {
    const items = worklist();
    expect(formatAdjudication(items, "en", "rgaa")).toContain(severityRubricLine("en"));
    expect(formatAdjudication(items, "en", "rgaa", { contract: false })).not.toContain(severityRubricLine("en"));
  });
});

describe("the reference page and the contracts carry the same rubric and notes", () => {
  it("references/adjudication.md lists the RGAA notes with their grounds, and the rubric", () => {
    const md = renderAdjudicationReference("fr");
    expect(md).toContain("## Gravité");
    expect(md).toMatch(/### RGAA 4\.1\.2 9\.4/);
    expect(md).toMatch(/\*\*Fondements\.\*\* « Retrouver dans le document les citations courtes/);
    const en = renderAdjudicationReference("en");
    expect(en).toContain("## Severity");
    expect(en).toMatch(/\*\*Grounds\.\*\* « Retrouver dans le document les citations courtes/);
    // Glossary link markup is stripped from a quoted ground, as it is everywhere it is shown.
    expect(md).not.toMatch(/\]\(#page-plan-du-site\)/);
    expect(readFileSync(new URL("../skills/ultra11y/references/adjudication.md", import.meta.url), "utf8")).toBe(md);
  });

  it("the fan-out adjudicator contract carries the rubric (the eco one is pinned by verdict-rules-sync)", () => {
    const run = mkdtempSync(join(tmpdir(), "u11y-rulings-run-"));
    writeFileSync(
      join(run, "ADJUDICATE.todo.json"),
      JSON.stringify({ tool: "ultra11y", kind: "adjudication", schemaVersion: 2, standard: "rgaa", auditDate: "2026-08-24", items: [{ criteriaId: "9.4" }] }),
    );
    orchestrateRun(run, "/tmp/engine.mjs", { phase: "adjudicate" });
    const md = readFileSync(join(run, "orchestration", "agents", "adjudicator.md"), "utf8");
    expect(md).toMatch(/SEVERITY FOLLOWS ONE RUBRIC/);
    expect(md).toMatch(/keeps ONE severity, the highest/);
  });
});

// ---- the fold ----------------------------------------------------------------------------

describe("a recommendation is never above mineur", () => {
  it("whatever severity the model wrote", () => {
    for (const v of ["bloquant", "majeur", "critical", "serious", "moderate", "mineur", undefined]) expect(agentSeverity(v, true)).toBe("mineur");
  });
  it("an NC keeps the severity it was given", () => {
    expect(agentSeverity("bloquant", false)).toBe("bloquant");
    expect(agentSeverity("mineur", false)).toBe("mineur");
  });
});

const finding = (criteriaId: string, severity: Finding["severity"], over: Partial<Finding> = {}): Finding => ({
  ruleId: `agent:${criteriaId}`,
  criteriaId,
  file: "site/plan.html",
  line: 12,
  col: 1,
  selectorHint: "a",
  severity,
  message: "m",
  remediation: "r",
  snippet: "<a>",
  ...over,
});

describe("one defect, one severity: an anchor charged under several criteria is named", () => {
  it("names the anchor, each criterion's severity, and the highest", () => {
    const w = duplicateCharges([finding("6.1", "bloquant"), finding("12.3", "majeur")]);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/site\/plan\.html:12 \(a\) is charged under 2 criteria \(6\.1 bloquant, 12\.3 majeur\)/);
    expect(w[0]).toMatch(/the highest \(bloquant\)/);
  });
  it("stays silent for one criterion with several findings, distinct anchors, recommendations and engine findings", () => {
    expect(duplicateCharges([finding("6.1", "bloquant"), finding("6.1", "majeur")])).toEqual([]);
    expect(duplicateCharges([finding("6.1", "bloquant"), finding("12.3", "majeur", { line: 13 })])).toEqual([]);
    expect(duplicateCharges([finding("6.1", "bloquant"), finding("12.3", "mineur", { advisory: true })])).toEqual([]);
    expect(duplicateCharges([finding("6.1", "bloquant"), finding("12.3", "majeur", { ruleId: "pack:rgaa:x" })])).toEqual([]);
  });

  it("the fold reports it as a warning, and keeps both verdicts", () => {
    const items = worklist();
    // Two open criteria whose harvest shares one exact anchor.
    const key = (e: { file: string; line: number; selector: string }) => `${e.file}|${e.line}|${e.selector}`;
    let pair: [AdjudicationItem, AdjudicationItem, AdjudicationItem["evidence"][number]] | undefined;
    for (const a of items) {
      for (const b of items) {
        if (a === b || pair) continue;
        const shared = a.evidence.find((e) => b.evidence.some((x) => key(x) === key(e)) && e.snippet?.trim());
        if (shared) pair = [a, b, shared];
      }
    }
    expect(pair, "two open criteria share an anchor on this page").toBeDefined();
    const [a, b, at] = pair!;
    const testOf = (id: string) =>
      `${id}.${Object.keys((rgaa as unknown as { criteria: { id: string; tests: Record<string, unknown> }[] }).criteria.find((c) => c.id === id)!.tests)[0]}`;
    const nc = (it: AdjudicationItem, severity: Finding["severity"]): AdjudicationItem => ({
      ...it,
      verdict: "NC",
      findings: [
        { file: at.file, line: at.line, selector: at.selector, snippet: at.snippet, message: "constat", severity, normativeRef: testOf(it.criteriaId) },
      ],
    });
    const rest = (it: AdjudicationItem): AdjudicationItem => ({ ...it, verdict: "manual", reason: "undecidable" });
    const adj: AdjudicationFile = {
      tool: "ultra11y",
      kind: "adjudication",
      schemaVersion: 2,
      standard: "rgaa",
      auditDate: "2026-08-24",
      items: items.map((it) => (it === a ? nc(it, "bloquant") : it === b ? nc(it, "majeur") : rest(it))),
    };
    const r = applyAdjudication(audit(), adj, { cwd: dir });
    expect(r.rejectedCriteria).not.toContain(a.criteriaId);
    expect(r.rejectedCriteria).not.toContain(b.criteriaId);
    expect(r.duplicateCharges).toHaveLength(1);
    expect(r.duplicateCharges![0]).toContain(`${a.criteriaId} bloquant, ${b.criteriaId} majeur`);
    expect(r.duplicateCharges![0]).toMatch(/the highest \(bloquant\)/);
  });
});

// ---- 8.7 recall --------------------------------------------------------------------------

const capture = (body: string, lang = "fr") =>
  parseHtml(`<html lang="${lang}"><head><title>T</title></head><body>${body}</body></html>`, ".ultra11y/pages/p/dom.html");
const termNotes = (docs: ReturnType<typeof capture>[]) => (SUBJECTS.foreignTerms?.(docs) ?? []).map((x) => x.ev.note ?? "");

describe("8.7 harvests English terms the function-word lexicon cannot see", () => {
  it("« deep linking » on a French page is a candidate, said to be a lead", () => {
    const notes = termNotes([capture(`<main><p>Le service prend en charge le deep linking vers chaque fiche.</p></main>`)]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/candidate English term\(s\) "deep linking", NOT marked with lang/);
    expect(notes[0]).toMatch(/a lead, not an NC/);
  });

  it("listed borrowings that are not French words are candidates too", () => {
    expect(englishTermsIn("Envoyez-nous votre feedback sur le workflow")).toEqual(["feedback", "workflow"]);
    expect(englishTermsIn("Un call to action visible")).toEqual(["call to action"]);
  });

  it("French borrowings in the dictionary, and a French determiner before -ing, are not", () => {
    expect(englishTermsIn("Le parking est fermé, le marketing aussi, et du coaching est proposé")).toEqual([]);
    expect(englishTermsIn("Une séance de jogging matinal")).toEqual([]);
    expect(termNotes([capture(`<main><p>Le parking de la mairie est ouvert le samedi.</p></main>`)])).toEqual([]);
  });

  it("a passage already marked with lang, and a page declared in English, give no candidate", () => {
    expect(termNotes([capture(`<main><p>Le service prend en charge le <span lang="en">deep linking</span>.</p></main>`)])).toEqual([]);
    expect(termNotes([capture(`<main><p>Our service supports deep linking.</p></main>`, "en")])).toEqual([]);
  });

  it("a run the function-word lexicon already lists is left to langParts: one text, one candidate", () => {
    const page = capture(`<main><p>Read more about deep linking</p></main>`);
    expect(termNotes([page])).toEqual([]);
    expect((SUBJECTS.langParts?.([page]) ?? []).some((x) => /candidate foreign passage/.test(x.ev.note ?? ""))).toBe(true);
  });

  it("reaches the RGAA 8.7 worklist item", () => {
    const it87 = worklist().find((it) => it.criteriaId === "8.7");
    expect(it87, "8.7 is open on this page").toBeDefined();
    expect(it87!.evidence.some((e) => /candidate English term\(s\) "deep linking"/.test(e.note ?? ""))).toBe(true);
  });
});

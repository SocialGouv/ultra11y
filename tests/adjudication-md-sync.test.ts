// references/adjudication.md is GENERATED from src/data/adjudication.json, the ruling notes and
// the RGAA pack, like references/criteria.md and references/act.md. This test fails when the
// committed file drifts, so the page an agent reads and the worklist it answers can never
// disagree. It is organised by RGAA criterion (#230): RGAA is the only standard a report shows.
//
// Regenerate with: pnpm run build:adjudication
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { renderAdjudicationReference } from "../src/adjudicate.js";
import { ADJUDICATION } from "../src/adjudication-data.js";
import { loadPack } from "../src/standards/index.js";

const DOC = new URL("../skills/ultra11y/references/adjudication.md", import.meta.url);
const rendered = renderAdjudicationReference("fr");

if (process.env.UPDATE_ADJUDICATION_MD) writeFileSync(DOC, rendered);

describe("references/adjudication.md is generated, never hand-edited", () => {
  it("matches the current dataset", () => {
    expect(readFileSync(DOC, "utf8")).toBe(rendered);
  });

  it("has one section per RGAA criterion, under its theme, in the referential's order", () => {
    const pack = loadPack("rgaa");
    let last = -1;
    for (const c of pack.criteria) {
      const at = rendered.indexOf(`\n### RGAA ${c.id} — `);
      expect(at, `${c.id} has no section`).toBeGreaterThan(last);
      last = at;
    }
    for (const theme of pack.themes) expect(rendered).toMatch(new RegExp(`^## Thématique ${theme.number} — `, "m"));
    // No longer indexed by WCAG success criterion, nor counting them.
    expect(rendered).not.toMatch(/^### \d+\.\d+\.\d+ — /m);
    expect(rendered).not.toContain("52 critères");
  });

  it("prints each inherited protocol whole once, and points back to it after", () => {
    const pack = loadPack("rgaa");
    const mapped = new Set(pack.criteria.flatMap((c) => c.wcag.filter((sc) => ADJUDICATION[sc])));
    expect(mapped.size).toBeGreaterThan(30);
    for (const sc of mapped) {
      const decide = `**Trancher.** ${ADJUDICATION[sc]!.decide.fr}`;
      expect(rendered.split(decide).length - 1, sc).toBe(1);
      for (const q of ADJUDICATION[sc]!.questions) expect(rendered, sc).toContain(`- ${q.fr}`);
    }
    expect(rendered).toMatch(/\*\*Protocole hérité — critère de succès WCAG 1\.1\.1 \(.*\) :\*\* voir RGAA 1\.1\./);
  });

  it("is written in French", () => {
    expect(rendered).toContain("# Trancher les critères que le moteur vous confie");
    expect(rendered).toContain("**Tests citables.**");
  });

  it("states the two rules that govern a verdict", () => {
    expect(rendered).toContain("doit citer un test normatif qui se résout");
    expect(rendered).toContain("est une recommandation");
    const en = renderAdjudicationReference("en");
    expect(en).toContain("must cite a normative test that resolves");
    expect(en).toContain("is a recommendation");
  });
});

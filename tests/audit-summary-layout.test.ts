// THE `audit` SUMMARY HAS TO READ AS WHAT IT IS.
//
// Measured on `audit --standard rgaa --lang fr` of a 7-page site: the header did not line up
// with its columns, theme names were cut at 28 characters (« 9. Structuration de l'inform »),
// and the second line read « 100% réussite automatique » while 101 of 106 criteria were still
// to judge — a number that sounds like a verdict on the site. The line now says how many
// criteria were decided out of the total, and the table sizes itself to its widest cell.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runAudit } from "../src/audit.js";
import { auditSummary } from "../src/output.js";
import { packAuditDocument } from "../src/standards/document.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-summary-"));
const PAGE = join(dir, "index.html");
writeFileSync(PAGE, `<!doctype html><html lang="fr"><head><title>x</title></head><body><main><h1>a</h1><img src="a.png"></main></body></html>`);
const audit = () => runAudit({ inputs: [PAGE] });

/** The table rows: from the header line to the first blank-ish note line. */
function table(summary: string): string[] {
  const lines = summary.split("\n");
  const start = lines.findIndex((l) => /^(Thématique|Theme|WCAG guideline|Règle WCAG)\s/.test(l));
  const end = lines.findIndex((l, i) => i > start && !/\d\s*$/.test(l));
  return lines.slice(start, end);
}

describe("audit summary", () => {
  for (const [lang, standard] of [
    ["fr", "rgaa"],
    ["en", "rgaa"],
    ["fr", "wcag"],
    ["en", "wcag"],
  ] as const) {
    it(`aligns every column on its header (${standard}, ${lang})`, () => {
      const rows = table(auditSummary(audit(), lang, standard));
      expect(rows.length).toBeGreaterThan(5);
      // Every line ends at the same display column: « ⏳ » is drawn two columns wide.
      const width = (l: string) => [...l].length + (l.includes("⏳") ? 1 : 0);
      const widths = new Set(rows.map(width));
      expect([...widths], rows.join("\n")).toHaveLength(1);
    });
  }

  it("never truncates a theme name", () => {
    const summary = auditSummary(audit(), "fr", "rgaa");
    for (const th of packAuditDocument(audit(), "rgaa", "fr").themes) expect(summary).toContain(`${th.number}. ${th.title}`);
  });

  it("says how many criteria were decided out of the total, not a pass rate", () => {
    const fr = auditSummary(audit(), "fr", "rgaa");
    expect(fr).not.toMatch(/réussite automatique/);
    expect(fr).toMatch(/\d+\/106 critères décidés \(C \d+ · NC \d+\) · \d+ à adjuger/);
    const en = auditSummary(audit(), "en");
    expect(en).toMatch(/\d+\/\d+ criteria decided/);
    expect(en.split("\n")[1]).not.toMatch(/%/);
  });
});

// A REPORT ABOUT HTML HAS TO BE ABLE TO SAY "h1".
//
// The message catalogue names elements the way a developer reads them. Rendered into Markdown,
// a bare tag IS HTML, and GitHub parses it away. Measured on a real pull-request comment, the
// h1 recommendation reached its reader as « Recommandation : plusieurs / dans la page (2) […]
// mais « un seul  par page » » — a sentence about a tag, with the tag deleted, twice.
//
// These tests pin the two halves: `mdText` itself, and the fact that the surfaces which emit
// Markdown actually call it, message catalogue included.
import { describe, expect, it } from "vitest";

import { mdText } from "../src/md.js";
import { renderAuditorUnit } from "../src/auditor.js";
import { resolveMessage } from "../src/messages.js";
import { agentSeverity } from "../src/adjudicate.js";
import type { PrdUnit } from "../src/prd.js";
import type { Finding } from "../src/types.js";

describe("mdText", () => {
  it("puts a bare tag beyond the reach of the HTML parser", () => {
    expect(mdText("plusieurs <h1> dans la page")).toBe("plusieurs `<h1>` dans la page");
    expect(mdText("Limite du composant <button> non perceptible")).toBe("Limite du composant `<button>` non perceptible");
  });

  it("handles a closing tag, a pair, and a tag carrying attributes", () => {
    expect(mdText("entre <canvas>…</canvas>")).toBe("entre `<canvas>`…`</canvas>`");
    expect(mdText('ex. <html lang="fr">.')).toBe('ex. `<html lang="fr">`.');
    expect(mdText('dans <div role="img" aria-label="…">')).toBe('dans `<div role="img" aria-label="…">`');
  });

  it("is idempotent — a tag already in a code span is left alone", () => {
    expect(mdText("scope sur les `<th>`")).toBe("scope sur les `<th>`");
    expect(mdText(mdText("les <th> du tableau"))).toBe("les `<th>` du tableau");
  });

  it("leaves prose that merely contains a chevron untouched", () => {
    expect(mdText("un rapport < 3:1")).toBe("un rapport < 3:1");
    expect(mdText("a < b > c")).toBe("a < b > c");
    expect(mdText("x<y et 2<3")).toBe("x<y et 2<3");
  });

  it("rewrites only the gaps between code spans", () => {
    expect(mdText("`déjà` puis <em> puis `<b>` puis <i>")).toBe("`déjà` puis `<em>` puis `<b>` puis `<i>`");
  });
});

describe("the h1 recommendation, end to end", () => {
  const finding = (): Finding =>
    ({
      ruleId: "h1-multiple",
      criteriaId: "1.3.1",
      file: "src/app/page.tsx",
      line: 12,
      col: 1,
      selectorHint: "h1",
      severity: "mineur",
      message: "several h1 in the page",
      remediation: "keep one h1",
      msg: { id: "h1-multiple", params: { count: 2 } },
      advisory: true,
    }) as unknown as Finding;

  it("still names the tag in the catalogue — the fix is at the boundary, not in the wording", () => {
    expect(resolveMessage(finding(), "fr")).toContain("<h1>");
  });

  it("reaches a Markdown surface with the tag intact and inert", () => {
    const unit: PrdUnit = {
      criteriaId: "9.1",
      title: "Structuration",
      label: "RGAA 9.1",
      refs: ["1.3.1"],
      severity: "mineur",
      advisory: true,
      findings: [finding()],
    } as unknown as PrdUnit;
    const md = renderAuditorUnit(unit, "rgaa", "fr").join("\n");
    expect(md).toContain("`<h1>`");
    // Nothing a Markdown renderer would swallow: no `<h1>` survives outside a code span.
    expect(md.replace(/`[^`]*`/g, "")).not.toMatch(/<h1>/);
  });
});

// A SEVERITY THE ENGINE DOES NOT KNOW CORRUPTS EVERY SURFACE KEYED ON IT.
//
// `AgentFinding.severity` is typed, and the type is a promise about our own code — not about a
// JSON file a model produced, nor a verdict ledger replaying one it produced months ago.
// Measured on a real pull-request comment: a verdict carrying axe's `"moderate"` rendered as
// « | undefined moderate | », with no icon and no ordering; the same value would have produced
// an empty SARIF level and an unsortable annotation.
describe("an agent's severity is normalised at the boundary", () => {
  it("maps axe's vocabulary the way the engine already maps it", () => {
    expect(agentSeverity("moderate", false)).toBe("majeur");
    expect(agentSeverity("critical", false)).toBe("bloquant");
    expect(agentSeverity("serious", false)).toBe("bloquant");
    expect(agentSeverity("minor", false)).toBe("mineur");
  });

  it("keeps a severity the engine does know", () => {
    expect(agentSeverity("bloquant", false)).toBe("bloquant");
    expect(agentSeverity("majeur", false)).toBe("majeur");
    expect(agentSeverity("mineur", false)).toBe("mineur");
  });

  it("falls back to the SAME default an absent severity gets, never downgrading an NC", () => {
    // `mineur` here would silently demote a non-conformity because a model misspelt a word.
    expect(agentSeverity("catastrophic", false)).toBe("majeur");
    expect(agentSeverity(undefined, false)).toBe("majeur");
    expect(agentSeverity(null, false)).toBe("majeur");
    expect(agentSeverity(3, false)).toBe("majeur");
  });

  it("keeps a recommendation minor, whatever it says", () => {
    expect(agentSeverity(undefined, true)).toBe("mineur");
    expect(agentSeverity("nonsense", true)).toBe("mineur");
  });

  it("renders with an icon on every Markdown surface", () => {
    // The regression itself: a severity outside the vocabulary printed « undefined moderate ».
    for (const sev of ["moderate", "catastrophic", undefined]) {
      expect(["bloquant", "majeur", "mineur"]).toContain(agentSeverity(sev, false));
    }
  });
});

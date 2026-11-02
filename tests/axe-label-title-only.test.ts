// #117 — axe's best-practice `label-title-only` was projected as a BLOCKING 4.1.2 failure. A field
// named by a (visually hidden) aria-labelledby target, or by title/aria-describedby, HAS an
// accessible name; the engine's static twin control-name-title-only is « mineur ». On egapro,
// RGAA 11.10.2's fix (aria-describedby toward the required-fields mention) on a table whose
// fields are named by sr-only aria-labelledby texts turned into 22 blocking findings.
import { describe, expect, it } from "vitest";

import { axeNodeTreatment } from "../src/axe-map.js";
import { toDynamicResult } from "../src/scan.js";

const violation = (html: string) => ({
  id: "label-title-only",
  impact: "serious",
  help: "Form elements should have a visible label",
  tags: ["cat.forms", "best-practice"],
  nodes: [{ target: ["#q1"], html }],
});

describe("axe label-title-only is never a blocking 4.1.2 failure (#117)", () => {
  it("a field named by aria-labelledby (hidden target) is advisory", () => {
    const t = axeNodeTreatment(
      "label-title-only",
      ["cat.forms", "best-practice"],
      "serious",
      '<input id="q1" aria-labelledby="q1-label" aria-describedby="note">',
    );
    expect(t.advisory).toBe(true);
  });

  it("a field named by title only keeps its parity with control-name-title-only: normative but minor", () => {
    const t = axeNodeTreatment("label-title-only", ["cat.forms", "best-practice"], "serious", '<input id="q1" title="Seuil">');
    expect(t.advisory).toBe(false);
    expect(t.severity).toBe("mineur");
  });

  it("the scan merge applies the same treatment per node", () => {
    const r = toDynamicResult(
      { url: "https://exemple.fr/", violations: [violation('<input id="q1" aria-labelledby="q1-label" aria-describedby="note">')] } as never,
      "https://exemple.fr/",
    );
    const f = r.findings.find((x) => x.axeRule === "label-title-only")!;
    expect(f.advisory).toBe(true);
    expect(f.severity).not.toBe("bloquant");
  });

  it("other rules keep their impact-derived severity", () => {
    expect(axeNodeTreatment("label", ["wcag2a", "wcag412"], "critical", "<input>").severity).toBe("bloquant");
  });
});

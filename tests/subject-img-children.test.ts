// #108 — the descendants of role="img" are presentational: not in the accessibility tree, so
// neither their alt/aria-label nor their text is ever read. On egapro's /admin/stats the
// adjudicator was handed the Recharts legend <svg aria-label="2025 legend icon"> inside each
// <div role="img" aria-label="…"> chart, and ruled three false NCs (1.2, 4.8, 8.7) on them.
import { describe, expect, it } from "vitest";

import { harvestSubjects, subjectsForPackCriterion } from "../src/adjudicate-subjects.js";
import { parseHtml } from "../src/parse/html.js";
import { loadPack } from "../src/standards/index.js";

const page = (body: string) => `<!doctype html><html lang="fr"><head><title>T</title></head><body><main><h1>H</h1>${body}</main></body></html>`;
const harvest = (id: string, body: string) => {
  const pc = loadPack("rgaa").criteria.find((c) => c.id === id)!;
  return harvestSubjects(subjectsForPackCriterion("rgaa", id, pc.wcag), [parseHtml(page(body), "p.html")]);
};
const CHART = `<div role="img" aria-label="Courbe de progression"><svg class="recharts-surface"><g><text>Median days</text></g></svg>
  <ul><li><svg aria-label="2025 legend icon"><title></title><desc></desc></svg><span>Download report</span></li></ul></div>`;

describe("the presentational children of role=img are not subjects (#108)", () => {
  it("harvests the chart container as THE image, not the svgs inside it", () => {
    const images = harvest("1.2", CHART).filter((x) => x.cls.startsWith("image|"));
    expect(images).toHaveLength(1);
    expect(images[0]!.cls).toContain("Courbe de progression");
  });

  it("offers no foreign-language candidate from text the chart does not expose", () => {
    expect(harvest("8.7", CHART).some((x) => x.cls.startsWith("foreign|"))).toBe(false);
    // …while the same English outside the chart is still a candidate
    expect(harvest("8.7", "<p>Download report</p>").some((x) => x.cls.startsWith("foreign|"))).toBe(true);
  });

  it("still harvests an <img alt> inside a <button>, whose alt names the button", () => {
    const images = harvest("1.2", `<button type="button"><img src="i.svg" alt="Fermer"></button>`).filter((x) => x.cls.startsWith("image|"));
    expect(images).toHaveLength(1);
  });
});

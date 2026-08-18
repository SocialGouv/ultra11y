// AN ADJUDICATOR THAT POINTS AT THE RIGHT ELEMENT MUST NOT BE REFUSED FOR RETYPING IT.
//
// Measured on a real run (SocialGouv/egapro#4169, 81 criteria adjudicated by Claude Code):
// the agent filled every item — 38 C, 26 NA, 1 NC, 16 honest « manual » — and the gate applied
// ELEVEN. It refused fifty-four, every one of them for the same reason:
//
//     ✗ cited snippet not found in .ultra11y/pages/aide/dom.html:2
//
// 78 of the 82 citations landed exactly on a harvested anchor of their own criterion. What
// failed was the SNIPPET: asked to cite `{file, line, selector, snippet}`, the agent wrote the
// element out — `<img alt="" src="/assets/images/home/help-illustration.svg">` — instead of
// copying the brief's `snippet` field byte for byte. Attributes reordered, the class attribute
// dropped. A rendered snapshot serializes the whole document on ONE line, so every anchor in it
// is « line 2 » and the grounding window is the entire page: the substring check then fails on
// nothing but transcription.
//
// The gate exists to stop an agent INVENTING a location. Membership already proves that: the
// citation has to land on an anchor this criterion was actually shown. Once it does, the
// harvested anchor is the ground truth — the engine read it out of the file itself — and
// re-checking the agent's retyping of it against the file is a spelling test, not an evidence
// test. So a citation that resolves to harvested evidence is grounded against THAT ANCHOR.
//
// Everything outside the harvest keeps the strict check, unchanged: that is where a fabricated
// location would hide, and this must not become a way to launder one.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { applyAdjudication, buildAdjudicationWorklist, type AdjudicationFile, type AdjudicationItem } from "../src/adjudicate.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-cite-"));

/** One line, like a browser's `documentElement.outerHTML` — which is what a page snapshot is,
 *  and why every anchor in one sits on the same line. */
const PAGE = join(dir, "page.html");
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Aide</title></head><body><main><h1>Aide</h1><img src="/assets/help.svg" alt="" class="fr-responsive-img" loading="lazy"><a href="/contact" class="fr-link">Nous contacter</a></main></body></html>`,
);

const audit = () => runAudit({ inputs: [PAGE] });
const file = (items: AdjudicationItem[]): AdjudicationFile => ({
  tool: "ultra11y",
  kind: "adjudication",
  schemaVersion: 2,
  standard: "rgaa",
  auditDate: "2026-08-18",
  items,
});

/** The worklist item for `criteriaId`, or the first one carrying evidence. */
function itemWithEvidence(criteriaId?: string): AdjudicationItem {
  const items = buildAdjudicationWorklist(audit(), { standard: "rgaa" });
  const it = criteriaId ? items.find((i) => i.criteriaId === criteriaId) : items.find((i) => i.evidence.length > 0);
  if (!it) throw new Error(`no worklist item${criteriaId ? ` for ${criteriaId}` : " with evidence"}`);
  return it;
}

/** Everything else ruled `manual`, so only the item under test can move the result. */
function only(it: AdjudicationItem): AdjudicationItem[] {
  return buildAdjudicationWorklist(audit(), { standard: "rgaa" }).map((x) =>
    x.criteriaId === it.criteriaId ? it : ({ ...x, verdict: "manual", reason: "undecidable" } as AdjudicationItem),
  );
}

describe("a citation that lands on harvested evidence is grounded against that evidence", () => {
  it("accepts a verdict whose snippet is a faithful retyping rather than a copy", () => {
    const base = itemWithEvidence();
    const anchor = base.evidence[0]!;
    // What the agent actually does: it writes the element out from the brief's description.
    // Attributes reordered, `class` and `loading` dropped — the element is unmistakable, the
    // string is not in the file.
    const retyped = '<img alt="" src="/assets/help.svg">';
    expect(anchor.snippet).not.toBe(retyped);

    const cleared: AdjudicationItem = {
      ...base,
      verdict: "C",
      justification: 'Toutes les images de décoration portent alt="" — vérifié sur la page.',
      citations: [{ file: anchor.file, line: anchor.line, selector: anchor.selector, snippet: retyped }],
    };
    const r = applyAdjudication(audit(), file(only(cleared)), { cwd: dir });
    expect(r.rejectedCriteria, r.issues.join("\n")).not.toContain(base.criteriaId);
    expect(r.applied).toBeGreaterThan(0);
  });

  it("still refuses a citation pointing where no evidence was harvested and no content matches", () => {
    // The bound that matters: this must not become a way to launder a fabricated location.
    const base = itemWithEvidence();
    const invented: AdjudicationItem = {
      ...base,
      verdict: "C",
      justification: "vérifié",
      citations: [{ file: "src/does-not-exist.tsx", line: 12, selector: "img", snippet: '<img alt="">' }],
    };
    const r = applyAdjudication(audit(), file(only(invented)), { cwd: dir });
    expect(r.rejectedCriteria).toContain(base.criteriaId);
  });

  it("still refuses a citation that claims a different KIND of element than the anchor holds", () => {
    // What survives when byte-exact matching is given up. A snapshot is one line, so the line
    // number discriminates nothing and the tag is the only discriminator left: retyping an
    // <img> is fine, calling it a <video> is not.
    const base = itemWithEvidence();
    const anchor = base.evidence[0]!;
    const wrongKind: AdjudicationItem = {
      ...base,
      verdict: "C",
      justification: "vérifié",
      citations: [{ file: anchor.file, line: anchor.line, selector: "video", snippet: '<video controls src="/tour.mp4"></video>' }],
    };
    const r = applyAdjudication(audit(), file(only(wrongKind)), { cwd: dir });
    expect(r.rejectedCriteria).toContain(base.criteriaId);
    expect(r.issues.join("\n")).toMatch(/cite the element you actually read/);
  });

  it("accepts the same element with its attributes in another order and some of them dropped", () => {
    const base = itemWithEvidence();
    const anchor = base.evidence[0]!;
    const tag = /<\s*([a-zA-Z][\w-]*)/.exec(anchor.snippet ?? "")?.[1] ?? "img";
    const cleared: AdjudicationItem = {
      ...base,
      verdict: "C",
      justification: "vérifié sur la page",
      citations: [{ file: anchor.file, line: anchor.line, selector: anchor.selector, snippet: `<${tag} alt="">` }],
    };
    const r = applyAdjudication(audit(), file(only(cleared)), { cwd: dir });
    expect(r.rejectedCriteria, r.issues.join("\n")).not.toContain(base.criteriaId);
  });
});

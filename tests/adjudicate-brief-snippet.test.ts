// THE BRIEF HAS TO SHOW THE THING IT ASKS TO BE COPIED.
//
// The contract tells an adjudicator to cite `{file, line, selector, snippet}` and says the
// snippet is what proves the citation resolves to the element it meant. The rendered brief
// then showed the file, the line, the selector, the occurrence counts, the sibling anchors —
// and never the snippet. What it did show, at the end of each line, was the harvester's NOTE,
// which for an image subject reads `<svg> alt="" aria-label="" src=""`.
//
// That is markup-shaped, and it is the only markup-shaped string on the line. Measured on a
// real run: the agent copied it, verbatim, into 34 citations. Every one carried a tag glued to
// three empty attributes — no distinctive content at all — and the fold refused them, correctly
// and uselessly, because a citation that repeats a template proves nothing.
//
// The agent was not being careless. It was copying the only thing it had been given.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { buildAdjudicationWorklist, formatAdjudication } from "../src/adjudicate.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-brief-"));
const PAGE = join(dir, "page.html");
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Aide</title></head><body><main><h1>Aide</h1>
<img src="/assets/images/aide/nouveau-site.png" alt="" class="fr-responsive-img" loading="lazy">
<a href="/nous-contacter" class="fr-link">Nous contacter</a>
</main></body></html>`,
);

const items = () => buildAdjudicationWorklist(runAudit({ inputs: [PAGE] }), { standard: "rgaa" });
const brief = (lang: "fr" | "en" = "fr") => formatAdjudication(items(), lang, "rgaa");

describe("the criterion brief shows the snippet a citation is asked to carry", () => {
  it("prints the harvested markup, not only the note that describes it", () => {
    const md = brief();
    expect(md).toContain("fr-responsive-img");
    expect(md).toContain("nouveau-site.png");
  });

  it("labels it, so it is not mistaken for the note beside it", () => {
    expect(brief()).toMatch(/snippet/i);
    expect(brief("en")).toMatch(/snippet/i);
  });

  it("still carries the note — the two say different things", () => {
    // The note is the harvester's question ("is this alternative pertinent?"); the snippet is
    // the element. Dropping either would trade one gap for another.
    expect(brief()).toMatch(/aria-label/);
  });

  it("shows a snippet for every evidence item that has one", () => {
    const md = brief();
    const withSnippets = items()
      .flatMap((i) => i.evidence)
      .filter((e) => e.snippet?.trim());
    expect(withSnippets.length).toBeGreaterThan(0);
    for (const e of withSnippets) {
      const head = e.snippet!.trim().slice(0, 24);
      expect(md, `no snippet rendered for ${e.file}:${e.line}`).toContain(head);
    }
  });
});

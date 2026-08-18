// RGAA THEME 2 IS ABOUT FRAMES, AND IT WAS BEING SHOWN ARIA ATTRIBUTES.
//
// 2.1 asks « chaque cadre a-t-il un titre de cadre ? » and 2.2 « ce titre est-il pertinent ? ».
// Neither declared a subject, so both inherited the union of their mapped success criterion —
// 4.1.2, whose subject is `aria`. The adjudicator was therefore handed every ARIA attribute in
// the application and asked a question about `<iframe title>`. Measured on a real run, it
// answered `undecidable` on both, twice, and it was right to: nothing it had been shown could
// settle the question.
//
// The harvest-coverage test only proves a criterion has SOMETHING to look at. Aim — that the
// something is what the criterion is about — is reviewed criterion by criterion, and this is
// that review for theme 2.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { buildAdjudicationWorklist } from "../src/adjudicate.js";
import { derivePackResults } from "../src/standards/index.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-frames-"));
function page(name: string, body: string): string {
  const f = join(dir, name);
  writeFileSync(f, `<!doctype html><html lang="fr"><head><title>t</title></head><body><main><h1>h</h1>${body}</main></body></html>`);
  return f;
}

const WITH_FRAME = page("frame.html", '<iframe title="Vidéo de présentation" src="https://player.example/v/1"></iframe>');
const NO_FRAME = page("plain.html", '<p>Texte seulement.</p><button aria-label="Fermer">×</button>');

const item = (file: string, id: string) => buildAdjudicationWorklist(runAudit({ inputs: [file] }), { standard: "rgaa" }).find((i) => i.criteriaId === id);
const rgaa = (file: string, id: string) => derivePackResults(runAudit({ inputs: [file] }), "rgaa").find((c) => c.id === id);

describe("theme 2 is shown the frames it is about", () => {
  it("harvests the frame, with the title the criterion asks about", () => {
    const it21 = item(WITH_FRAME, "2.1");
    expect(it21, "2.1 is not in the worklist").toBeDefined();
    const blob = JSON.stringify(it21!.evidence);
    expect(blob).toContain("iframe");
    expect(blob).toContain("Vidéo de présentation");
  });

  it("gives 2.2 the same subject — the title's relevance is about the same element", () => {
    expect(JSON.stringify(item(WITH_FRAME, "2.2")!.evidence)).toContain("Vidéo de présentation");
  });

  it("rules both NOT APPLICABLE when the application has no frame at all", () => {
    // A page with no <iframe> has nothing to answer, and « à évaluer » would say only that
    // nobody looked. The ARIA attributes it does carry must not keep the theme open.
    expect(rgaa(NO_FRAME, "2.1")?.status).toBe("NA");
    expect(rgaa(NO_FRAME, "2.2")?.status).toBe("NA");
  });

  it("reopens the theme the moment a frame appears", () => {
    expect(rgaa(WITH_FRAME, "2.1")?.status).not.toBe("NA");
    expect(rgaa(WITH_FRAME, "2.2")?.status).not.toBe("NA");
  });

  it("stops handing theme 2 the whole ARIA harvest", () => {
    // The regression that motivated this: an unrelated aria-label must not be what 2.1 is
    // ruled on.
    expect(JSON.stringify(item(WITH_FRAME, "2.1")!.evidence)).not.toContain("Fermer");
  });
});

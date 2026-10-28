// ENGINE FINDINGS THE RGAA PROJECTION USED TO DROP (issue #65).
//
// A finding reaches an RGAA criterion only if its rule is listed in that criterion's
// `appliesTo` (scripts/build-pack-rgaa.mjs RULE_TO_CRITERIA). These rules fired, raised a WCAG
// non-conformity, and vanished from the RGAA grid because no criterion named them — so the
// criterion they answer stayed « à évaluer » with the answer sitting in the audit.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { derivePackResults, loadPack } from "../src/standards/index.js";

const root = mkdtempSync(join(tmpdir(), "u11y-unmapped-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
function rgaa(body: string) {
  const f = join(root, `p${n++}.html`);
  writeFileSync(f, `<!doctype html><html lang="fr"><head><title>Page de test</title></head><body><main><h1>Titre</h1>${body}</main></body></html>`);
  const rows = derivePackResults(runAudit({ inputs: [f] }), "rgaa");
  return (id: string) => rows.find((r) => r.id === id)!;
}
const ids = (fs: { ruleId: string }[] | undefined) => (fs ?? []).map((f) => f.ruleId);

describe("every engine finding lands on the RGAA criterion it answers", () => {
  it("an unknown aria-* attribute or a bad ARIA value is invalid code (8.2.1) and an AT-compatibility signal (7.1)", () => {
    const r = rgaa('<div role="button" tabindex="0" aria-labeledby="x" aria-pressed="maybe">Prévisualiser</div><p id="x">x</p>');
    expect(r("8.2").status).toBe("NC");
    expect(ids(r("8.2").findings)).toEqual(expect.arrayContaining(["invalid-aria-attr", "invalid-aria-value"]));
    expect(ids(r("7.1").candidateFindings)).toEqual(expect.arrayContaining(["invalid-aria-attr", "invalid-aria-value"]));
  });

  it("a missing required ARIA state and a prohibited ARIA attribute reach 7.1 as evidence", () => {
    const r = rgaa('<div role="slider" tabindex="0" aria-label="Volume"></div><p role="paragraph" aria-label="Introduction">Texte</p>');
    expect(ids(r("7.1").candidateFindings)).toEqual(expect.arrayContaining(["aria-required-attr", "aria-prohibited-attr"]));
  });

  it("a <select> whose change navigates is 7.4's own case", () => {
    const r = rgaa('<form><label for="s">Salle</label><select id="s" onchange="location.href=this.value"><option>A</option></select></form>');
    expect(ids(r("7.4").candidateFindings)).toContain("on-input-context-change");
  });

  it("a <dt> outside any <dl> reaches 9.3.3 — as evidence, since a component may render it into a parent's <dl>", () => {
    const r = rgaa("<div><dt>Terme</dt><dd>Définition</dd></div>");
    expect(ids(r("9.3").candidateFindings)).toContain("dl-structure");
  });

  it("the rendered tier's ARIA-name and link-in-text checks are routed too", () => {
    const pack = loadPack("rgaa");
    const routed = (criterion: string) => pack.criteria.find((c) => c.id === criterion)!.appliesTo!.ruleIds;
    expect(routed("11.1")).toEqual(expect.arrayContaining(["axe:aria-input-field-name", "axe:aria-toggle-field-name"]));
    expect(routed("10.6")).toContain("axe:link-in-text-block");
    expect(routed("7.1")).toEqual(
      expect.arrayContaining(["axe:aria-command-name", "axe:aria-dialog-name", "axe:aria-meter-name", "axe:aria-progressbar-name", "axe:aria-tooltip-name"]),
    );
  });
});

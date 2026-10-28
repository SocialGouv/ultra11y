// DECISIVE RULES THAT CLAIMED MORE THAN THE RGAA TEST THEY DECIDE (issue #65).
//
// A `decisive-nc` rule makes its criterion non-conforming with no adjudicator in the loop, so
// every one of them has to fail ONLY what the cited test fails. Each case below is markup the
// official test accepts, on which a decisive rule fired anyway — and, beside it, the failing
// twin that must keep firing, so the fix narrows the rule rather than blinding it.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { derivePackResults } from "../src/standards/index.js";

const root = mkdtempSync(join(tmpdir(), "u11y-overclaim-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
function audit(source: string, ext = "html") {
  const f = join(root, `p${n++}.${ext}`);
  writeFileSync(f, source);
  return runAudit({ inputs: [f] });
}
const page = (body: string, head = "") =>
  `<!doctype html><html lang="fr"><head><title>Page de test</title>${head}</head><body><main><h1>Titre</h1>${body}</main></body></html>`;
const rules = (a: ReturnType<typeof runAudit>) => [...a.findings, ...(a.packFindings ?? [])].map((f) => f.ruleId);
const rgaa = (a: ReturnType<typeof runAudit>, id: string) => derivePackResults(a, "rgaa").find((r) => r.id === id)!;

describe("decisive RGAA rules fail only what their test fails", () => {
  it("6.2.1 — an <svg role=img aria-label> inside a link is its intitulé", () => {
    const ok = audit(page('<p><a href="/aide"><svg role="img" aria-label="Aide en ligne" width="16" height="16"><circle cx="8" cy="8" r="7"/></svg></a></p>'));
    expect(rules(ok)).not.toContain("link-empty-name");
    expect(rgaa(ok, "6.2").status).not.toBe("NC");
    const empty = audit(page('<p><a href="/aide"><svg aria-hidden="true" width="16" height="16"><circle cx="8" cy="8" r="7"/></svg></a></p>'));
    expect(rgaa(empty, "6.2").status).toBe("NC");
  });

  it("10.1.2 — `color` on <link rel=mask-icon> is document metadata, not presentation", () => {
    const ok = audit(page("<p>Texte</p>", '<link rel="mask-icon" href="/m.svg" color="#000091">'));
    expect(rules(ok)).not.toContain("presentational-attribute");
    expect(rgaa(audit(page('<p align="center">Texte</p>')), "10.1").status).toBe("NC");
  });

  it("11.5.1 — one checkbox per table row is labelled by its row, not an ungrouped question", () => {
    const rows = audit(
      page(
        '<form><table><caption>Messages</caption><tr><th scope="col">Choix</th><th scope="col">Sujet</th></tr>' +
          '<tr><td><input type="checkbox" name="ids[]" id="c1"><label for="c1">Sélectionner « Facture »</label></td><td>Facture</td></tr>' +
          '<tr><td><input type="checkbox" name="ids[]" id="c2"><label for="c2">Sélectionner « Relance »</label></td><td>Relance</td></tr></table></form>',
      ),
    );
    expect(rules(rows)).not.toContain("radio-checkbox-group-ungrouped");
    const radios = audit(
      page(
        '<form>Civilité <input type="radio" name="civ" id="a"><label for="a">Madame</label><input type="radio" name="civ" id="b"><label for="b">Monsieur</label></form>',
      ),
    );
    expect(rgaa(radios, "11.5").status).toBe("NC");
  });

  it("11.6.1 — a fieldset around a single field is not a grouping of fields", () => {
    const lone = audit(page('<form><fieldset><label for="n">Nom</label><input id="n" type="text"></fieldset></form>'));
    expect(rules(lone)).not.toContain("fieldset-legend-missing");
    const group = audit(
      page(
        '<form><fieldset><input type="checkbox" id="a" name="x"><label for="a">A</label><input type="checkbox" id="b" name="x"><label for="b">B</label></fieldset></form>',
      ),
    );
    expect(rgaa(group, "11.6").status).toBe("NC");
  });

  it("label-in-name on a LINK is test 6.1.5, never a script criterion (7.1)", () => {
    const link = audit(page('<p><a href="/" aria-label="Aller vers la page principale">Accueil</a></p>'));
    expect(rules(link)).toContain("link-label-in-name-mismatch");
    expect(rules(link)).not.toContain("label-in-name-mismatch");
    expect(rgaa(link, "6.1").status).toBe("NC");
    expect(rgaa(link, "7.1").status).not.toBe("NC");
    const widget = audit(page('<button type="button" onclick="t()" aria-label="Basculer">Menu</button>'));
    expect(rgaa(widget, "7.1").status).toBe("NC");
  });

  it("8.3.1 — on HTML5, xml:lang alone is no default language (methodology: lang on <html>)", () => {
    const xml = audit('<!doctype html><html xml:lang="fr"><head><title>T</title></head><body><main><h1>T</h1><p>Bonjour</p></main></body></html>');
    expect(rgaa(xml, "8.3").status).toBe("NC");
    const xhtml11 = audit(
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html xml:lang="fr"><head><title>T</title></head><body><p>Bonjour</p></body></html>',
    );
    expect(rgaa(xhtml11, "8.3").status).not.toBe("NC");
  });

  it("8.2.1 — an id reused across the arms of one v-if/v-else renders once", () => {
    const vue = audit('<template><main><p v-if="ok" id="msg">Oui</p><p v-else id="msg">Non</p></main></template>', "vue");
    expect(rules(vue)).not.toContain("duplicate-id");
    const both = audit('<template><main><p id="msg">Oui</p><p id="msg">Non</p></main></template>', "vue");
    expect(rules(both)).toContain("duplicate-id");
  });

  it("9.3 — a kebab-case wrapper in a list renders its <li>s into it", () => {
    const vue = audit('<template><ul><transition-group name="f"><li v-for="x in xs" :key="x">{{ x }}</li></transition-group></ul></template>', "vue");
    expect(rules(vue)).not.toContain("list-structure");
    expect(rules(audit(page("<ul><div>Pas un item</div></ul>")))).toContain("list-structure");
  });
});

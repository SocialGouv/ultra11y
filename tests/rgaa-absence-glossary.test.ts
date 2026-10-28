// AN ABSENCE IS ONLY AS WIDE AS THE SUBJECT THAT LOOKED FOR IT (issue #65).
//
// A criterion closes « non applicable » on its own when every subject it declares comes back
// empty across the scope (EXISTENCE_SUBJECTS, src/adjudicate-subjects.ts). That is a sound
// conclusion only if the subject looks for everything the RGAA glossary calls by that name —
// and five of them looked for less:
//
//   « champ de saisie de formulaire »  input/select/textarea only — no ARIA field, no output,
//                                       progress, meter, datalist, no contenteditable;
//   « bouton (formulaire) »             nothing at all: 11.9 read `controls`, which has no button;
//   « liste »                           <ul>/<ol>/<dl> — not role="list", and not the visual list
//                                       9.3.1 is written about (« regroupées visuellement »);
//   « tableau de données »              <table> — not role="table"/"grid", which 5.6/5.7 name;
//   « lien »                            <a href> — not role="link", which the glossary names;
//   « image »                           no <input type="image">, which 1.1.3 is entirely about;
//   « document bureautique »            pdf/doc/xls — not odt, ods, odp, ppt(x), rtf, epub, nor a
//                                       download link.
//
// Every case below is a page whose subject IS there, in a form the narrow subject missed; each
// was published « non applicable » before this test existed.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { derivePackResults } from "../src/standards/index.js";

const root = mkdtempSync(join(tmpdir(), "u11y-glossary-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
function rgaa(body: string, ids: string[]) {
  const f = join(root, `p${n++}.html`);
  writeFileSync(f, `<!doctype html><html lang="fr"><head><title>Page de test</title></head><body><main><h1>Titre</h1>${body}</main></body></html>`);
  const rows = derivePackResults(runAudit({ inputs: [f] }), "rgaa");
  return ids.map((id) => {
    const r = rows.find((row) => row.id === id)!;
    return `${id}:${r.inapplicable ? "NA" : r.status}`;
  });
}
const notNA = (body: string, ids: string[]) => expect(rgaa(body, ids).filter((s) => s.endsWith(":NA"))).toEqual([]);

describe("an RGAA subject is as wide as its glossary entry", () => {
  it("an ARIA or contenteditable field is a form field (11.1–11.4, 11.10)", () => {
    notNA('<span id="l">Nom</span><div role="textbox" contenteditable="true" aria-labelledby="l"></div>', ["11.1", "11.2", "11.4", "11.10"]);
  });

  it("a page whose only form element is a button still has a button whose label is judged (11.9)", () => {
    notNA('<form action="/deconnexion"><button type="submit">Se déconnecter</button></form>', ["11.9"]);
  });

  it("an ARIA list is a list (9.3)", () => {
    notNA('<div role="list"><div role="listitem">Un</div><div role="listitem">Deux</div></div>', ["9.3"]);
  });

  it("a list drawn with bullets and <br> is the list 9.3.1 asks about", () => {
    notNA("<p>• Peinture<br>• Musique<br>• Théâtre</p>", ["9.3"]);
  });

  it("an ARIA table is a data table (theme 5)", () => {
    notNA(
      '<div role="table" aria-label="Tarifs"><div role="row"><div role="columnheader">Offre</div></div><div role="row"><div role="cell">Base</div></div></div>',
      ["5.4", "5.5", "5.6", "5.7"],
    );
  });

  it("an image button is an image (theme 1)", () => {
    notNA('<form><input type="image" src="loupe.png" alt="Rechercher"></form>', ["1.1", "1.3"]);
  });

  it("an ARIA link is a link (6.1, 6.2)", () => {
    notNA('<span role="link" tabindex="0" onclick="go()">Nos tarifs</span>', ["6.1", "6.2"]);
  });

  it("every office format, and any download link, is a downloadable document (13.3, 13.4)", () => {
    for (const href of ["/programme.odt", "/budget.ods", "/diaporama.pptx", "/note.rtf", "/guide.epub"])
      notNA(`<p><a href="${href}">Document</a></p>`, ["13.3", "13.4"]);
    notNA('<p><a href="/telecharger?id=3" download>Formulaire Cerfa</a></p>', ["13.3", "13.4"]);
  });

  it("a page whose pointer actions all fire on click still has pointer actions to judge (13.11)", () => {
    notNA('<button type="button" onclick="vider()">Vider le panier</button>', ["13.11"]);
  });
});

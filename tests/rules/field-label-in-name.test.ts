import { describe, it, expect } from "vitest";
import { findOf } from "./helpers.js";

const RULE = "field-label-in-name-mismatch";

// RGAA 11.2.5 (condition 1) / WCAG 2.5.3: a field with a visible label whose aria-label
// replaces it must still contain that label. The pattern egapro shipped (#4919): a file input
// named « Sélectionner des fichiers » under a <label> asking for the CSE opinion.
describe("field-label-in-name-mismatch (RGAA 11.2.5 / WCAG 2.5.3)", () => {
  it("non-conforming: an aria-label that drops the visible <label for> text", () => {
    const html = `<label for="cse">Veuillez importer le ou les avis émis par votre CSE
      <span class="fr-hint-text">Taille maximale : 10 Mo par fichier.</span></label>
      <input type="file" id="cse" aria-label="Sélectionner des fichiers">`;
    const f = findOf(html, RULE);
    expect(f).toHaveLength(1);
    expect(f[0]!.criteriaId).toBe("2.5.3");
  });

  it("non-conforming: a wrapping <label>, on select and textarea too", () => {
    expect(findOf(`<label>Département <select aria-label="Choix"><option>1</option></select></label>`, RULE)).toHaveLength(1);
    expect(findOf(`<label for="m">Votre message</label><textarea id="m" aria-label="Zone de texte"></textarea>`, RULE)).toHaveLength(1);
  });

  it("conforming: the aria-label contains the visible label (case and punctuation ignored)", () => {
    expect(findOf(`<label for="e">Adresse e-mail</label><input id="e" type="email" aria-label="adresse e mail professionnelle">`, RULE)).toHaveLength(0);
    expect(findOf(`<label for="n">Nom :</label><input id="n" aria-label="Nom">`, RULE)).toHaveLength(0);
  });

  it("conforming: the hint inside the label is not part of the intitulé", () => {
    expect(
      findOf(`<label for="d">Date de début<span class="fr-hint-text">Format jj/mm/aaaa</span></label><input id="d" aria-label="Date de début">`, RULE),
    ).toHaveLength(0);
  });

  it("not decidable or not applicable: no finding", () => {
    // no aria-label: the <label> IS the name
    expect(findOf(`<label for="a">Nom</label><input id="a">`, RULE)).toHaveLength(0);
    // aria-labelledby wins over aria-label — a different question
    expect(findOf(`<span id="t">Autre</span><label for="b">Nom</label><input id="b" aria-labelledby="t" aria-label="X y z">`, RULE)).toHaveLength(0);
    // dynamic aria-label or dynamic label text proves nothing
    expect(findOf(`<label for="c">Nom</label><input id="c" aria-label="{label}">`, RULE)).toHaveLength(0);
    expect(findOf(`<label for="c2">{title}</label><input id="c2" aria-label="Fichier">`, RULE)).toHaveLength(0);
    // a label that is not visible, or a hidden field
    expect(findOf(`<label for="h" hidden>Nom</label><input id="h" aria-label="Identité">`, RULE)).toHaveLength(0);
    expect(findOf(`<label for="h2">Nom</label><input id="h2" type="hidden" aria-label="Identité">`, RULE)).toHaveLength(0);
    // glyph-length labels are symbols, a particular case of 11.2.5
    expect(findOf(`<label for="g">Go</label><input id="g" aria-label="Rechercher">`, RULE)).toHaveLength(0);
    // buttons belong to the 11.9.2 twin, not to this rule
    expect(findOf(`<label for="s">Envoyer</label><input id="s" type="submit" value="Envoyer" aria-label="Valider">`, RULE)).toHaveLength(0);
  });
});

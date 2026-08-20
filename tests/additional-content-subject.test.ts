// RGAA 10.14 ET 12.11 N'AVAIENT PAS DE SUJET.
//
// Les deux critères portent sur le CONTENU ADDITIONNEL — ce qui apparaît au survol, à la prise
// de focus ou à l'activation d'un composant. Aucun moissonneur ne le levait : ils étaient mappés
// sur `focusables` + `pointerHandlers`, qui cherchent des iframes, des dialogues et des
// gestionnaires de pointeur. Sur une page dont l'infobulle est faite en CSS, cela ne lève rien
// du sujet.
//
// Mesuré sur tests/fixtures/realworld : les deux critères sont arrivés devant un adjudicateur
// payant en portant UNE évidence à eux deux — `e.preventDefault();`, extrait d'un gestionnaire
// de soumission React — et on leur demandait si l'infobulle du site est atteignable au clavier.
// Aucun modèle ne répond à cela, et la réponse honnête (`undecidable`) laisse le critère
// « à évaluer » pour toujours.
import { describe, expect, it } from "vitest";

import { SUBJECTS, subjectsForPackCriterion } from "../src/adjudicate-subjects.js";
import { parseHtml } from "../src/parse/html.js";

const doc = (html: string) => parseHtml(html, "page.html");

const notes = (html: string): string[] => (SUBJECTS.additionalContent?.([doc(html)]) ?? []).map((x) => x.ev.note ?? "");

describe("the additionalContent subject harvests what 10.14 and 12.11 are about", () => {
  it("levers a tooltip and the component that reveals it, as a pair", () => {
    const n = notes(
      `<main><button type="button" aria-describedby="t1">Qu’est-ce que le TLS ?</button><span role="tooltip" id="t1">Un certificat chiffre le trafic.</span></main>`,
    );
    expect(n.some((x) => /role="tooltip"/.test(x))).toBe(true);
    expect(n.some((x) => /aria-describedby="t1"/.test(x) && /reveals #t1/.test(x))).toBe(true);
  });

  it("levers a disclosure — the trigger and the panel it controls", () => {
    const n = notes(`<main><button aria-expanded="false" aria-controls="p1">Plus</button><div id="p1">Détail</div></main>`);
    expect(n.some((x) => /aria-expanded/.test(x))).toBe(true);
    expect(n.some((x) => /aria-controls="p1"/.test(x))).toBe(true);
  });

  it("levers the native pair and the popover API", () => {
    const n = notes(
      `<main><details><summary>Voir</summary><p>Détail</p></details><div popover id="pop">Aide</div><button popovertarget="pop">Aide</button></main>`,
    );
    expect(n.some((x) => /native disclosure/.test(x))).toBe(true);
    expect(n.some((x) => /popover=/.test(x))).toBe(true);
    expect(n.some((x) => /popovertarget="pop"/.test(x))).toBe(true);
  });

  it("levers the STYLESHEET RULE, which is where « via les styles CSS uniquement » is decided", () => {
    // A `:hover` rule with no focus twin IS the non-conformity; both together are the
    // conformity. Neither is visible anywhere in the DOM.
    const n = notes(`<head><style>.a:hover .b{display:block}.a:focus-within .b{display:block}</style></head><body><main><p>x</p></main></body>`);
    expect(n.some((x) => /focus twin/.test(x))).toBe(true);
  });

  it("stays quiet on a page with no additional content at all", () => {
    expect(notes(`<main><h1>Titre</h1><p>Texte</p></main>`)).toEqual([]);
  });

  it("never reports the same element twice, however many relations point at it", () => {
    const items =
      SUBJECTS.additionalContent?.([doc(`<main><button aria-describedby="t" aria-controls="t">A</button><span id="t" role="tooltip">T</span></main>`)]) ?? [];
    const offsets = items.map((i) => i.at);
    expect(new Set(offsets).size).toBe(offsets.length);
  });
});

describe("…and the criteria are mapped onto it", () => {
  it("10.14, 12.11 and 1.4.13 all name it, and name it FIRST", () => {
    for (const id of ["10.14", "12.11"]) {
      expect(subjectsForPackCriterion("rgaa", id, [])[0], `RGAA ${id}`).toBe("additionalContent");
    }
  });
});

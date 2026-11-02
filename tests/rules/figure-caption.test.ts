import { describe, it, expect } from "vitest";
import { findOf } from "./helpers.js";

const RULE = "figure-caption-unassociated";

// RGAA 1.9.1: an image with a caption sits in a <figure> carrying role="figure"|"group" and an
// aria-label IDENTICAL to its <figcaption>. egapro#4921: three Matomo charts (role="img") in a
// <figure> with an sr-only <figcaption> and neither the role nor the label.
describe("figure-caption-unassociated (RGAA 1.9.1)", () => {
  it("non-conforming: neither role nor aria-label (the egapro#4921 pattern)", () => {
    const html = `<figure><figcaption class="fr-sr-only">Clics sur les liens d'aide.</figcaption><div role="img" aria-label="Clics sur les liens d'aide"></div></figure>`;
    const f = findOf(html, RULE);
    expect(f).toHaveLength(1);
    expect(f[0]!.criteriaId).toBe("1.1.1");
    expect(f[0]!.advisory).toBe(true); // WCAG asks none of this — the RGAA pack re-normativizes it
  });

  it("non-conforming: a role but no aria-label, or an aria-label that differs from the caption", () => {
    expect(findOf(`<figure role="group"><img src="a.png" alt="Courbe"><figcaption>Évolution 2025</figcaption></figure>`, RULE)).toHaveLength(1);
    expect(
      findOf(`<figure role="figure" aria-label="Évolution"><img src="a.png" alt="Courbe"><figcaption>Évolution 2025</figcaption></figure>`, RULE),
    ).toHaveLength(1);
    expect(
      findOf(`<figure role="img" aria-label="Évolution 2025"><img src="a.png" alt="Courbe"><figcaption>Évolution 2025</figcaption></figure>`, RULE),
    ).toHaveLength(1);
  });

  it("conforming: role figure or group and an aria-label identical to the caption (whitespace collapsed)", () => {
    expect(
      findOf(`<figure role="figure" aria-label="Évolution 2025"><img src="a.png" alt="Courbe"><figcaption>Évolution 2025</figcaption></figure>`, RULE),
    ).toHaveLength(0);
    expect(
      findOf(
        `<figure role="group" aria-label="Photo : soleil couchant"><input type="image" src="b.png" alt="Voir"><figcaption>  Photo :\n soleil couchant </figcaption></figure>`,
        RULE,
      ),
    ).toHaveLength(0);
  });

  it("not applicable or not decidable: no finding", () => {
    // no image: a quotation or a code listing in a <figure> is not an image légende
    expect(findOf(`<figure><blockquote>Citation</blockquote><figcaption>Auteur</figcaption></figure>`, RULE)).toHaveLength(0);
    // no caption
    expect(findOf(`<figure><img src="a.png" alt="Courbe"></figure>`, RULE)).toHaveLength(0);
    // dynamic caption, label or role (JSX)
    expect(findOf(`export const F = ({ c }) => <figure><img src="a.png" alt="x" /><figcaption>{c}</figcaption></figure>;`, RULE, "F.tsx")).toHaveLength(0);
    expect(
      findOf(
        `export const F = ({ c }) => <figure role="figure" aria-label={c}><img src="a.png" alt="x" /><figcaption>Titre</figcaption></figure>;`,
        RULE,
        "F.tsx",
      ),
    ).toHaveLength(0);
    // a spread may carry role and aria-label
    expect(findOf(`export const F = (p) => <figure {...p}><img src="a.png" alt="x" /><figcaption>Titre</figcaption></figure>;`, RULE, "F.tsx")).toHaveLength(0);
    // hidden figure
    expect(findOf(`<figure hidden><img src="a.png" alt="x"><figcaption>Titre</figcaption></figure>`, RULE)).toHaveLength(0);
  });
});

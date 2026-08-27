import { describe, it, expect } from "vitest";
import { findOf } from "./helpers.js";

describe("link-empty-name (6.2)", () => {
  it("conforming: link with text or aria-label", () => {
    expect(findOf(`<a href="/">Accueil</a>`, "link-empty-name")).toHaveLength(0);
    expect(findOf(`<a href="/" aria-label="Accueil"></a>`, "link-empty-name")).toHaveLength(0);
  });
  it("non-conforming: empty link (no icon)", () => {
    const f = findOf(`<a href="/"><span></span></a>`, "link-empty-name");
    expect(f).toHaveLength(1);
    expect(f[0]!.criteriaId).toBe("2.4.4");
  });
  it("defers icon-only links to icon-only-control-unnamed", () => {
    expect(findOf(`<a href="/"><svg></svg></a>`, "link-empty-name")).toHaveLength(0);
  });
});

describe("button-empty-name (7.1)", () => {
  it("conforming: button with text / submit with default", () => {
    expect(findOf(`<button>Envoyer</button>`, "button-empty-name")).toHaveLength(0);
    expect(findOf(`<input type="submit">`, "button-empty-name")).toHaveLength(0);
  });
  it("non-conforming: empty button", () => {
    const f = findOf(`<button></button>`, "button-empty-name");
    expect(f).toHaveLength(1);
    expect(f[0]!.criteriaId).toBe("4.1.2");
  });

  it("separates generic/script buttons from buttons owned by a form", () => {
    expect(findOf(`<button></button>`, "form-button-empty-name")).toHaveLength(0);
    expect(findOf(`<form><button></button></form>`, "button-empty-name")).toHaveLength(0);
    expect(findOf(`<form><button></button></form>`, "form-button-empty-name")).toHaveLength(1);
    expect(findOf(`<form id="checkout"></form><button form="checkout"></button>`, "button-empty-name")).toHaveLength(0);
    expect(findOf(`<form id="checkout"></form><button form="checkout"></button>`, "form-button-empty-name")).toHaveLength(1);
  });

  it("treats input[type=image] as a form button named by alt", () => {
    expect(findOf(`<form><input type="image" src="send.png"></form>`, "form-button-empty-name")).toHaveLength(1);
    expect(findOf(`<form><input type="image" src="send.png" alt="Envoyer"></form>`, "form-button-empty-name")).toHaveLength(0);
  });

  it("does not let hidden descendant text provide a name", () => {
    expect(findOf(`<button><span hidden>Invisible</span></button>`, "button-empty-name")).toHaveLength(1);
    expect(findOf(`<button><span aria-hidden="true">Decoration</span></button>`, "button-empty-name")).toHaveLength(1);
    expect(findOf(`<button><img hidden alt="Invisible" src="x.png"></button>`, "button-empty-name")).toHaveLength(1);
    expect(findOf(`<button><img aria-hidden="true" alt="Decoration" src="x.png"></button>`, "button-empty-name")).toHaveLength(1);
  });

  it("keeps conditionally hidden JSX descendant text as a possible name", () => {
    expect(findOf(`<button><span hidden={busy}>Save</span></button>`, "button-empty-name", "Button.tsx")).toHaveLength(0);
    expect(findOf(`<button><span hidden>Save</span></button>`, "button-empty-name", "Button.tsx")).toHaveLength(1);
  });

  it("keeps the full hidden subtree when its root is directly referenced", () => {
    expect(
      findOf(`<span id="name" hidden><span hidden>Referenced name</span></span><button aria-labelledby="name"></button>`, "button-empty-name"),
    ).toHaveLength(0);
  });
});

describe("label-in-name-mismatch (11.9)", () => {
  it("ignores hidden and aria-hidden descendant decoration in the visible label", () => {
    expect(findOf(`<button aria-label="Enregistrer"><span hidden>Supprimer</span>Enregistrer</button>`, "label-in-name-mismatch")).toHaveLength(0);
    expect(findOf(`<button aria-label="Rechercher"><span aria-hidden="true">search</span>Rechercher</button>`, "label-in-name-mismatch")).toHaveLength(0);
  });

  it("still reports a genuine literal mismatch", () => {
    expect(findOf(`<button aria-label="Envoyer">Enregistrer</button>`, "label-in-name-mismatch")).toHaveLength(1);
    expect(findOf(`<button aria-label="Supprimer"><svg><text>Enregistrer</text></svg></button>`, "label-in-name-mismatch")).toHaveLength(1);
    expect(findOf(`<input type="button" value="Enregistrer" aria-label="Supprimer">`, "label-in-name-mismatch")).toHaveLength(1);
    expect(findOf(`<input type="submit" value="Enregistrer" aria-label="Supprimer">`, "label-in-name-mismatch")).toHaveLength(1);
    expect(findOf(`<input type="reset" value="Effacer" aria-label="Annuler">`, "label-in-name-mismatch")).toHaveLength(1);
  });

  it("uses the form-specific rule only for controls with a real form owner", () => {
    expect(findOf(`<button aria-label="Envoyer">Enregistrer</button>`, "form-label-in-name-mismatch")).toHaveLength(0);
    expect(findOf(`<form><button aria-label="Envoyer">Enregistrer</button></form>`, "label-in-name-mismatch")).toHaveLength(0);
    expect(findOf(`<form><button aria-label="Envoyer">Enregistrer</button></form>`, "form-label-in-name-mismatch")).toHaveLength(1);
    expect(
      findOf(`<form id="checkout"></form><input form="checkout" type="submit" value="Enregistrer" aria-label="Envoyer">`, "form-label-in-name-mismatch"),
    ).toHaveLength(1);
  });

  it("does not treat radio, checkbox, or switch submission values as visible labels", () => {
    expect(findOf(`<input type="radio" role="button" value="Enregistrer" aria-label="Supprimer">`, "label-in-name-mismatch")).toHaveLength(0);
    expect(findOf(`<input type="checkbox" role="button" value="Enregistrer" aria-label="Supprimer">`, "label-in-name-mismatch")).toHaveLength(0);
    expect(findOf(`<input type="checkbox" role="switch" value="Enregistrer" aria-label="Supprimer">`, "label-in-name-mismatch")).toHaveLength(0);
  });
});

describe("icon-only-control-unnamed (6.2/7.1)", () => {
  it("conforming: icon button with aria-label", () => {
    expect(findOf(`<button aria-label="Fermer"><svg></svg></button>`, "icon-only-control-unnamed")).toHaveLength(0);
  });
  it("non-conforming: icon-only button → 7.1, icon-only link → 6.2", () => {
    const b = findOf(`<button><svg></svg></button>`, "icon-only-control-unnamed");
    expect(b).toHaveLength(1);
    expect(b[0]!.criteriaId).toBe("4.1.2");
    const a = findOf(`<a href="/"><img src="i" alt=""></a>`, "icon-only-control-unnamed");
    expect(a).toHaveLength(1);
    expect(a[0]!.criteriaId).toBe("2.4.4");
  });
});

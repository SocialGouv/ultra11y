// Language-neutral message catalog for rule findings (Phase 3 of the modular
// auditor/lang work). Every RuleFinding/CrossFinding (src/rules/*.ts) now carries a
// `msgId` (+ optional `params`) instead of a baked string; this catalog resolves it
// to fr/en prose at RENDER time — mirroring how src/wcag.ts resolves SC titles by
// lang. `toFinding()`/`crossToFinding()` (src/rules/rule.ts, cross-rule.ts) still
// BAKE the English resolution into `Finding.message`/`remediation` (canonical,
// AI-facing, back-compat with any consumer that only reads those fields) and
// additionally attach `msg: { id, params }` so a `--lang fr` render can resolve the
// authored French original instead.
//
// The fr strings below are the ORIGINAL author strings, moved here verbatim from the
// rule modules (not rewritten); the en strings are faithful technical translations
// written for this catalog. Params carry raw DATA (tag names, attribute values,
// counts, small enums) — never pre-rendered phrases — so each language's template
// controls its own wording/word order.
import type { Lang } from "./types.js";

export type MsgParams = Record<string, string | number>;
type Tpl = (p: MsgParams) => string;
interface MsgEntry {
  message: Record<Lang, Tpl>;
  remediation: Record<Lang, Tpl>;
}

export const MSG_CATALOG: Record<string, MsgEntry> = {
  "document-language-missing": {
    message: {
      fr: () => `La page n'a pas de langue par défaut sur <html> et au moins un texte visible n'hérite d'aucun attribut lang/xml:lang.`,
      en: () => `The page has no default language on <html>, and at least one visible text node inherits no lang/xml:lang attribute.`,
    },
    remediation: {
      fr: () => `Déclarez lang sur <html>, ou sur chaque texte (ou l'un de ses ancêtres) conformément au test RGAA 8.3.1.`,
      en: () => `Declare lang on <html>, or on every text node (or one of its ancestors) as allowed by RGAA test 8.3.1.`,
    },
  },
  "html-lang-xml-lang-mismatch": {
    message: {
      fr: (p) => `lang="${p.lang}" et xml:lang="${p.xmlLang}" se contredisent sur <html>.`,
      en: (p) => `lang="${p.lang}" and xml:lang="${p.xmlLang}" conflict on <html>.`,
    },
    remediation: {
      fr: () => `Utilisez le même code de langue valide et pertinent dans les deux attributs, ou conservez seulement lang en HTML5.`,
      en: () => `Use the same valid and relevant language tag in both attributes, or keep only lang in HTML5.`,
    },
  },
  "duplicate-attribute": {
    message: {
      fr: (p) => `L'attribut ${p.attr} est déclaré plusieurs fois sur la même balise — le code généré est invalide.`,
      en: (p) => `The ${p.attr} attribute is declared more than once on the same tag — the generated markup is invalid.`,
    },
    remediation: {
      fr: (p) => `Conservez une seule déclaration de ${p.attr}.`,
      en: (p) => `Keep a single ${p.attr} declaration.`,
    },
  },
  "presentational-children-focusable": {
    message: {
      fr: (p) => `Un descendant focalisable est placé dans role="${p.role}", dont les enfants sont présentatifs — l'arbre d'accessibilité est contradictoire.`,
      en: (p) => `A focusable descendant sits inside role="${p.role}", whose children are presentational — the accessibility tree conflicts.`,
    },
    remediation: {
      fr: () => `Placez l'élément interactif hors du composant, ou implémentez l'interaction sur le composant ARIA lui-même.`,
      en: () => `Move the interactive element outside the component, or implement the interaction on the ARIA component itself.`,
    },
  },
  "decorative-marked-exposed": {
    message: {
      fr: (p) => `Ce <${p.tag}> est explicitement décoratif mais reste exposé par son nom ou sa présence dans l'ordre de tabulation.`,
      en: (p) => `This <${p.tag}> is explicitly decorative but remains exposed by its name or sequential focusability.`,
    },
    remediation: {
      fr: () => `Retirez le nom et la focalisation de l'élément décoratif, ou retirez son marquage décoratif s'il porte réellement une fonction.`,
      en: () => `Remove the decorative element's name and focusability, or remove the decorative marking if it actually has a function.`,
    },
  },
  "menuitem-empty-name": {
    message: {
      fr: () => `Cet élément de menu n'a aucun nom accessible.`,
      en: () => `This menu item has no accessible name.`,
    },
    remediation: {
      fr: () => `Fournissez un texte visible ou un nom accessible pertinent à l'élément de menu.`,
      en: () => `Give the menu item visible text or a relevant accessible name.`,
    },
  },
  "text-spacing-important": {
    message: {
      fr: (p) => `${p.property}: ${p.value} !important empêche l'espacement RGAA requis (minimum ${p.minimum}).`,
      en: (p) => `${p.property}: ${p.value} !important prevents the required RGAA spacing override (minimum ${p.minimum}).`,
    },
    remediation: {
      fr: (p) => `Retirez !important de ${p.property}, ou utilisez une valeur au moins égale au seuil requis.`,
      en: (p) => `Remove !important from ${p.property}, or use a value at least equal to the required threshold.`,
    },
  },
  "table-scope-invalid": {
    message: {
      fr: (p) => `scope="${p.scope}" n'est pas une valeur d'association d'en-tête valide.`,
      en: (p) => `scope="${p.scope}" is not a valid header-association value.`,
    },
    remediation: {
      fr: () => `Utilisez scope="row", "col", "rowgroup" ou "colgroup" selon la portée réelle de l'en-tête.`,
      en: () => `Use scope="row", "col", "rowgroup", or "colgroup" according to the header's actual reach.`,
    },
  },
  // ---- Theme 1 — Images (src/rules/images.ts) ---------------------------------
  "img-alt-missing": {
    message: {
      fr: (p) => `<${p.tag}> sans attribut alt ni nom accessible — alternative textuelle manquante.`,
      en: (p) => `<${p.tag}> has no alt attribute or accessible name — missing text alternative.`,
    },
    remediation: {
      fr: () => `Ajoutez alt="…" (description si l'image porte de l'information, alt="" si elle est décorative).`,
      en: () => `Add alt="…" (a description if the image conveys information, alt="" if it is decorative).`,
    },
  },
  "autocomplete-token-invalid": {
    message: {
      fr: (p) => `autocomplete="${p.value}" n'appartient pas au vocabulaire HTML — la finalité du champ n'est pas identifiable.`,
      en: (p) => `autocomplete="${p.value}" is not in the HTML autofill vocabulary — the field's purpose is not identifiable.`,
    },
    remediation: {
      fr: () => `Utilisez un token de la liste WCAG « Input Purposes » (par ex. given-name, email, tel, postal-code, current-password).`,
      en: () => `Use a token from the WCAG "Input Purposes" list (e.g. given-name, email, tel, postal-code, current-password).`,
    },
  },
  "credential-entry-blocked.paste": {
    message: {
      fr: (p) => `Le collage est bloqué sur ce champ <input type="${p.type}"> — la saisie du secret devient un test de mémoire.`,
      en: (p) => `Paste is blocked on this <input type="${p.type}"> — entering the secret becomes a memory test.`,
    },
    remediation: {
      fr: () => `Retirez le gestionnaire qui annule l'événement paste : les gestionnaires de mots de passe doivent pouvoir remplir le champ.`,
      en: () => `Remove the handler cancelling the paste event: password managers must be able to fill the field.`,
    },
  },
  "credential-entry-blocked.autocomplete": {
    message: {
      fr: (p) => `autocomplete="off" sur un champ d'identification (<input type="${p.type}">) — le remplissage automatique est désactivé.`,
      en: (p) => `autocomplete="off" on a credential field (<input type="${p.type}">) — automatic filling is disabled.`,
    },
    remediation: {
      fr: () => `Déclarez la finalité réelle (autocomplete="username" / "current-password" / "one-time-code") au lieu de "off".`,
      en: () => `Declare the real purpose (autocomplete="username" / "current-password" / "one-time-code") instead of "off".`,
    },
  },
  "on-input-context-change": {
    message: {
      fr: (p) => `Changer la valeur de ce <${p.tag}> déclenche seul un changement de contexte (envoi/navigation).`,
      en: (p) => `Changing this <${p.tag}>'s value alone triggers a change of context (submit/navigation).`,
    },
    remediation: {
      fr: () => `Attendez une action explicite (bouton « Valider »), ou annoncez le changement avant qu'il ne survienne.`,
      en: () => `Wait for an explicit action (a "Submit" button), or announce the change before it happens.`,
    },
  },
  "label-in-name-mismatch": {
    message: {
      fr: (p) => `Le libellé visible « ${p.visible} » n'est pas contenu dans le nom accessible « ${p.name} » — la commande vocale échoue.`,
      en: (p) => `The visible label "${p.visible}" is not contained in the accessible name "${p.name}" — voice control fails.`,
    },
    remediation: {
      fr: (p) => `Faites commencer aria-label par le texte visible (« ${p.visible} … »), ou retirez aria-label et laissez le texte nommer le contrôle.`,
      en: (p) => `Start aria-label with the visible text ("${p.visible} …"), or drop aria-label and let the text name the control.`,
    },
  },
  "headers-attr-dangling": {
    message: {
      fr: (p) => `headers="${p.ids}" ne désigne aucune cellule d'en-tête de ce tableau — l'association n'existe pas.`,
      en: (p) => `headers="${p.ids}" points at no header cell of this table — the association does not exist.`,
    },
    remediation: {
      fr: () => `Faites pointer headers vers les id de <th> du MÊME tableau, ou utilisez scope="col"/"row".`,
      en: () => `Point headers at the ids of <th> cells in the SAME table, or use scope="col"/"row".`,
    },
  },
  "th-no-data-cells": {
    message: {
      fr: () => `Cet en-tête n'est référencé par aucune cellule de données alors que le tableau utilise headers — il n'en-tête rien.`,
      en: () => `This header is referenced by no data cell although the table uses headers — it heads nothing.`,
    },
    remediation: {
      fr: () => `Ajoutez son id au headers des cellules qu'il en-tête, ou retirez-le s'il ne sert qu'à la mise en forme.`,
      en: () => `Add its id to the headers of the cells it heads, or remove it if it is purely presentational.`,
    },
  },
  "dl-structure.foreign-child": {
    message: {
      fr: (p) => `<${p.tag}> comme enfant direct de <dl> — seuls <dt>, <dd> (et <div> les groupant) sont admis.`,
      en: (p) => `<${p.tag}> as a direct child of <dl> — only <dt>, <dd> (and a grouping <div>) are allowed.`,
    },
    remediation: {
      fr: () => `Déplacez le contenu dans un <dd>, ou sortez-le de la liste de définitions.`,
      en: () => `Move the content into a <dd>, or take it out of the description list.`,
    },
  },
  "dl-structure.orphan": {
    message: {
      fr: (p) => `<${p.tag}> hors de tout <dl> — la relation terme/description n'est pas exposée.`,
      en: (p) => `<${p.tag}> outside any <dl> — the term/description relationship is not exposed.`,
    },
    remediation: {
      fr: (p) => `Enveloppez les paires <dt>/<dd> dans un <dl> (le <${p.tag}> seul n'a aucune sémantique).`,
      en: (p) => `Wrap the <dt>/<dd> pairs in a <dl> (a lone <${p.tag}> carries no semantics).`,
    },
  },
  "invalid-aria-attr": {
    message: {
      fr: (p) => `Attribut ${p.attr} inconnu de WAI-ARIA — il est ignoré par les navigateurs et n'expose rien.`,
      en: (p) => `${p.attr} is not a WAI-ARIA attribute — browsers ignore it, so it exposes nothing.`,
    },
    remediation: {
      fr: (p) => `Corrigez l'orthographe de ${p.attr} (par ex. aria-labelledby, aria-describedby) ou retirez l'attribut.`,
      en: (p) => `Fix the spelling of ${p.attr} (e.g. aria-labelledby, aria-describedby) or remove the attribute.`,
    },
  },
  "invalid-aria-value": {
    message: {
      fr: (p) => `${p.attr}="${p.value}" n'est pas une valeur admise — l'état est traité comme absent.`,
      en: (p) => `${p.attr}="${p.value}" is not an allowed value — the state is treated as absent.`,
    },
    remediation: {
      fr: (p) => `Utilisez une valeur définie par WAI-ARIA pour ${p.attr} (par ex. true/false, ou un entier pour aria-level).`,
      en: (p) => `Use a value WAI-ARIA defines for ${p.attr} (e.g. true/false, or an integer for aria-level).`,
    },
  },
  "aria-required-attr": {
    message: {
      fr: (p) => `role="${p.role}" sans ${p.attrs} — l'état requis par ce rôle n'est pas exposé.`,
      en: (p) => `role="${p.role}" without ${p.attrs} — the state this role requires is not exposed.`,
    },
    remediation: {
      fr: (p) => `Ajoutez ${p.attrs} et tenez la valeur à jour, ou utilisez l'élément natif équivalent qui gère l'état seul.`,
      en: (p) => `Add ${p.attrs} and keep it in sync, or use the native element, which manages the state on its own.`,
    },
  },
  "aria-required-parent": {
    message: {
      fr: (p) => `role="${p.role}" hors de son conteneur requis (${p.parents}) — le rôle n'est pas exposé.`,
      en: (p) => `role="${p.role}" outside its required container (${p.parents}) — the role is not exposed.`,
    },
    remediation: {
      fr: (p) => `Placez l'élément dans un conteneur ${p.parents}, ou reliez-le via aria-owns.`,
      en: (p) => `Put the element inside a ${p.parents} container, or wire it up with aria-owns.`,
    },
  },
  "aria-prohibited-attr": {
    message: {
      fr: (p) => `role="${p.role}" interdit un nom d'auteur, mais ${p.attrs} en fournit un — restitution imprévisible.`,
      en: (p) => `role="${p.role}" prohibits an author-provided name, yet ${p.attrs} supplies one — restitution is unpredictable.`,
    },
    remediation: {
      fr: (p) => `Retirez ${p.attrs}, ou donnez à l'élément un rôle qui accepte d'être nommé.`,
      en: (p) => `Remove ${p.attrs}, or give the element a role that accepts a name.`,
    },
  },
  "img-alt-missing.title-only": {
    message: {
      fr: (p) => `<${p.tag}> sans alt : le nom accessible vient du seul title, restitué de façon peu fiable (survol uniquement).`,
      en: (p) => `<${p.tag}> has no alt: its accessible name comes from title alone, which is restituted unreliably (hover only).`,
    },
    remediation: {
      fr: () => `Recommandation : déplacez le texte du title vers alt="…" (alt="" si l'image est décorative).`,
      en: () => `Recommendation: move the title text into alt="…" (alt="" if the image is decorative).`,
    },
  },
  "decorative-alt-misuse.empty-but-named": {
    message: {
      fr: () => `Image décorative (alt="") mais nommée par aria-label/title — incohérence décoratif/informatif.`,
      en: () => `Decorative image (alt="") but named via aria-label/title — decorative/informative inconsistency.`,
    },
    remediation: {
      fr: () => `Si l'image est décorative, retirez aria-label/title ; sinon donnez un alt descriptif.`,
      en: () => `If the image is decorative, remove aria-label/title; otherwise give it a descriptive alt.`,
    },
  },
  "decorative-alt-misuse.role-but-alt": {
    message: {
      fr: (p) => `Image en role="${p.role}" mais porteuse d'un alt non vide — déclarée décorative pourtant nommée.`,
      en: (p) => `Image with role="${p.role}" but carrying a non-empty alt — declared decorative yet named.`,
    },
    remediation: {
      fr: (p) => `Retirez role="${p.role}" si l'image est informative, ou videz l'alt si elle est décorative.`,
      en: (p) => `Remove role="${p.role}" if the image is informative, or empty the alt if it is decorative.`,
    },
  },
  "canvas-fallback-missing": {
    message: {
      fr: () => `<canvas> sans contenu alternatif ni nom accessible.`,
      en: () => `<canvas> has no fallback content or accessible name.`,
    },
    remediation: {
      fr: () => `Placez un contenu de repli entre <canvas>…</canvas> ou ajoutez role="img" + aria-label.`,
      en: () => `Place fallback content between <canvas>…</canvas>, or add role="img" + aria-label.`,
    },
  },
  "input-image-alt-missing": {
    message: {
      fr: () => `<input type="image"> sans alt ni nom accessible — le bouton image n'a pas d'alternative textuelle.`,
      en: () => `<input type="image"> has no alt or accessible name — the image button has no text alternative.`,
    },
    remediation: {
      fr: () => `Ajoutez alt="…" décrivant l'action du bouton (ex. alt="Rechercher").`,
      en: () => `Add alt="…" describing the button's action (e.g. alt="Search").`,
    },
  },
  "object-embed-no-name": {
    message: {
      fr: (p) => `<${p.tag}> sans nom accessible ni contenu de repli — média embarqué sans alternative textuelle.`,
      en: (p) => `<${p.tag}> has no accessible name or fallback content — embedded media with no text alternative.`,
    },
    remediation: {
      fr: () => `Ajoutez aria-label/title décrivant le contenu (et un contenu de repli textuel dans <object>…</object>), ou aria-hidden="true" si décoratif.`,
      en: () => `Add aria-label/title describing the content (and text fallback content inside <object>…</object>), or aria-hidden="true" if decorative.`,
    },
  },
  "chart-no-accessible-name": {
    message: {
      fr: (p) => `Graphique (<${p.tag}> ${p.cls}) sans nom accessible — alternative textuelle manquante.`,
      en: (p) => `Chart (<${p.tag}> ${p.cls}) has no accessible name — missing text alternative.`,
    },
    remediation: {
      fr: () => `Enveloppez le graphique dans <div role="img" aria-label="…"> décrivant la tendance (ou ajoutez un <title>/aria-label).`,
      en: () => `Wrap the chart in <div role="img" aria-label="…"> describing the trend (or add a <title>/aria-label).`,
    },
  },

  // ---- Theme 2 — Frames (src/rules/frames.ts) ---------------------------------
  "iframe-title-missing": {
    message: {
      fr: () => `<iframe> sans attribut title — le cadre n'a pas de titre.`,
      en: () => `<iframe> has no title attribute — the frame has no title.`,
    },
    remediation: {
      fr: () => `Ajoutez un title décrivant le contenu du cadre, ex. title="Carte de localisation".`,
      en: () => `Add a title describing the frame's content, e.g. title="Location map".`,
    },
  },

  // ---- Theme 3 — Colours (src/rules/colors.ts) --------------------------------
  "contrast-literal": {
    message: {
      fr: (p) =>
        `Contraste insuffisant : ratio ${p.ratio}:1 entre le texte et son fond (minimum ${p.min}:1 pour du texte ${p.textSize === "large" ? "large" : "normal"}).`,
      en: (p) =>
        `Insufficient contrast: ${p.ratio}:1 ratio between the text and its background (minimum ${p.min}:1 for ${p.textSize === "large" ? "large" : "normal"} text).`,
    },
    remediation: {
      fr: (p) => `Assombrissez le texte ou éclaircissez le fond pour atteindre au moins ${p.min}:1 (contraste calculé sur des couleurs inline littérales).`,
      en: (p) => `Darken the text or lighten the background to reach at least ${p.min}:1 (contrast computed from literal inline colours).`,
    },
  },

  // ---- Rendered tier (src/rules/rendered.ts) — decided from a page snapshot's signals -----
  // These say WHERE the measurement came from, because that is what makes them auditable: a
  // computed style, or a region of the screenshot. An auditor can go and re-check either.
  "rendered-contrast": {
    message: {
      fr: (p) =>
        `Contraste insuffisant au rendu : ratio ${p.ratio}:1 entre le texte et son fond effectif (minimum ${p.min}:1 pour du texte ${p.textSize === "large" ? "large" : "normal"}).`,
      en: (p) =>
        `Insufficient contrast at render: ${p.ratio}:1 between the text and its effective background (minimum ${p.min}:1 for ${p.textSize === "large" ? "large" : "normal"} text).`,
    },
    remediation: {
      fr: (p) => `Assombrissez le texte ou éclaircissez le fond pour atteindre au moins ${p.min}:1 (mesuré sur les styles calculés de la page rendue).`,
      en: (p) => `Darken the text or lighten the background to reach at least ${p.min}:1 (measured from the rendered page's computed styles).`,
    },
  },
  "rendered-contrast-pixel": {
    message: {
      fr: (p) =>
        `Contraste insuffisant mesuré sur la capture d'écran : ratio ${p.ratio}:1 (minimum ${p.min}:1 pour du texte ${p.textSize === "large" ? "large" : "normal"}). Le fond vient d'une image ou d'un dégradé, invisible aux styles calculés.`,
      en: (p) =>
        `Insufficient contrast measured on the screenshot: ${p.ratio}:1 (minimum ${p.min}:1 for ${p.textSize === "large" ? "large" : "normal"} text). The background comes from an image or gradient, which computed styles cannot express.`,
    },
    remediation: {
      fr: (p) =>
        `Garantissez au moins ${p.min}:1 sur toute la zone : ajoutez un fond opaque sous le texte, un voile, ou une ombre portée. Le fond a été mesuré sur les pixels de la zone occupée par le texte.`,
      en: (p) =>
        `Guarantee at least ${p.min}:1 across the whole area: add an opaque backing behind the text, a scrim, or a text shadow. The background was measured on the pixels of the text's own box.`,
    },
  },
  "rendered-link-colour-only": {
    message: {
      fr: (p) =>
        `Lien dans un bloc de texte distingué par la COULEUR SEULE (écart de ${p.ratio}:1 avec le texte environnant, sans soulignement, bordure ni fond) — invisible pour qui ne perçoit pas cette différence de couleur.`,
      en: (p) =>
        `Link inside a text block distinguished by COLOUR ALONE (${p.ratio}:1 apart from the surrounding text, with no underline, border or background) — invisible to anyone who does not perceive that colour difference.`,
    },
    remediation: {
      fr: () =>
        `Ajoutez un indice non chromatique : text-decoration: underline (le plus simple), une bordure basse, ou une graisse nettement supérieure. À défaut, un contraste d'au moins 3:1 avec le texte environnant ET un indice au survol/focus.`,
      en: () =>
        `Add a non-colour cue: text-decoration: underline (simplest), a bottom border, or a distinctly heavier weight. Failing that, at least 3:1 contrast with the surrounding text AND a cue on hover/focus.`,
    },
  },

  "rendered-nontext-contrast": {
    message: {
      fr: (p) =>
        `Limite du composant <${p.control}> non perceptible : ni son fond (${p.ratio}:1 avec l'environnement) ni sa bordure n'atteignent 3:1 — rien n'indique visuellement où commence le champ.`,
      en: (p) =>
        `The <${p.control}> boundary is not perceivable: neither its fill (${p.ratio}:1 against its surroundings) nor its border reaches 3:1 — nothing shows visually where the control begins.`,
    },
    remediation: {
      fr: () =>
        `Donnez au composant une bordure visible contrastant à 3:1 avec le fond environnant, ou un fond distinct du fond environnant à 3:1. Un box-shadow ou un outline visible conviennent aussi.`,
      en: () =>
        `Give the control a visible border at 3:1 against the surrounding background, or a fill distinct from it at 3:1. A visible box-shadow or outline also qualifies.`,
    },
  },
  "rendered-focus-not-visible": {
    message: {
      fr: (p) =>
        `La feuille de styles supprime l'indicateur de focus (\`${p.selector}\`) et aucune règle \`:focus\` ne le remplace — un utilisateur au clavier ne peut plus savoir où il se trouve.`,
      en: (p) =>
        `The stylesheet removes the focus indicator (\`${p.selector}\`) and no \`:focus\` rule puts one back — a keyboard user can no longer tell where they are.`,
    },
    remediation: {
      fr: () =>
        `Ne supprimez jamais outline sans remplacement. Si le style par défaut ne convient pas, remplacez-le : \`:focus-visible { outline: 2px solid <couleur contrastée>; outline-offset: 2px }\`.`,
      en: () =>
        `Never remove outline without a replacement. If the default does not fit, replace it: \`:focus-visible { outline: 2px solid <contrasting colour>; outline-offset: 2px }\`.`,
    },
  },
  "rendered-orientation-lock": {
    message: {
      fr: (p) =>
        `Le contenu est verrouillé dans une seule orientation : \`@media ${p.media}\` applique \`transform: ${p.transform}\` au document — l'utilisateur ne peut pas consulter la page dans l'orientation de son choix.`,
      en: (p) =>
        `Content is locked to a single orientation: \`@media ${p.media}\` applies \`transform: ${p.transform}\` to the document — the user cannot view the page in the orientation they need.`,
    },
    remediation: {
      fr: () =>
        `Supprimez la rotation et rendez la mise en page responsive dans les deux orientations. Un verrouillage n'est admis que si l'orientation est essentielle (piano, chèque bancaire).`,
      en: () =>
        `Remove the rotation and make the layout work in both orientations. Locking is only acceptable where the orientation is essential (a piano keyboard, a bank cheque).`,
    },
  },

  // ---- Theme 5 — Data tables (src/rules/tables.ts) ----------------------------
  "data-table-no-headers.no-th": {
    message: {
      fr: () => `Tableau de données sans <th> — en-têtes de colonne/ligne non déclarés.`,
      en: () => `Data table with no <th> — column/row headers are not declared.`,
    },
    remediation: {
      fr: () => `Déclarez les en-têtes avec <th>, et associez-les via scope="col"/"row" (ou headers/id).`,
      en: () => `Declare headers with <th>, and associate them via scope="col"/"row" (or headers/id).`,
    },
  },
  "data-table-no-headers.no-assoc": {
    message: {
      fr: () => `Tableau de données avec <th> mais sans scope/headers — association cellule↔en-tête absente.`,
      en: () => `Data table with <th> but no scope/headers — the cell↔header association is missing.`,
    },
    remediation: {
      fr: () => `Ajoutez scope="col"/"row" sur les <th> (ou headers="…"/id sur cellules complexes).`,
      en: () => `Add scope="col"/"row" on the <th> elements (or headers="…"/id for complex cells).`,
    },
  },
  "table-caption-missing": {
    message: {
      fr: () => `Tableau de données sans <caption> ni nom accessible — titre du tableau absent.`,
      en: () => `Data table with no <caption> or accessible name — the table has no title.`,
    },
    remediation: {
      fr: () => `Ajoutez un <caption> en première position du <table> (ou aria-label/aria-labelledby).`,
      en: () => `Add a <caption> as the first child of the <table> (or aria-label/aria-labelledby).`,
    },
  },
  "layout-table-data-markup": {
    message: {
      fr: (p) => `Tableau de mise en forme (role="${p.role}") utilisant du balisage de données (th/caption/scope).`,
      en: (p) => `Layout table (role="${p.role}") using data markup (th/caption/scope).`,
    },
    remediation: {
      fr: () => `Retirez th/caption/scope/headers d'un tableau de présentation, ou faites-en un vrai tableau de données.`,
      en: () => `Remove th/caption/scope/headers from a presentation table, or turn it into a real data table.`,
    },
  },
  "sortable-header-no-aria-sort": {
    message: {
      fr: () => `En-tête de colonne triable sans aria-sort — l'état de tri (croissant/décroissant) n'est pas restitué.`,
      en: () => `Sortable column header with no aria-sort — the sort state (ascending/descending) is not conveyed.`,
    },
    remediation: {
      fr: () => `Ajoutez aria-sort="none|ascending|descending" sur le <th> trié, et masquez le glyphe de tri (aria-hidden="true").`,
      en: () => `Add aria-sort="none|ascending|descending" on the sorted <th>, and hide the sort glyph (aria-hidden="true").`,
    },
  },
  "table-empty-data-cell": {
    message: {
      fr: () => `Cellule de données vide (ou réduite à « - ») : restituée « vide » par les lecteurs d'écran.`,
      en: () => `Empty data cell (or reduced to "-"): announced as "blank" by screen readers.`,
    },
    remediation: {
      fr: () => `Ajoutez un texte masqué (classe sr-only) précisant l'absence de valeur, ex. « Non renseigné ».`,
      en: () => `Insert hidden text (an sr-only class) stating the absence of a value, e.g. "Not provided".`,
    },
  },

  // ---- Theme 6/7 — Links & buttons (src/rules/links.ts) -----------------------
  "link-empty-name": {
    message: {
      fr: () => `Lien sans intitulé — aucun nom accessible.`,
      en: () => `Link with no label — no accessible name.`,
    },
    remediation: {
      fr: () => `Donnez un intitulé textuel au lien (texte visible, ou aria-label si vraiment nécessaire).`,
      en: () => `Give the link a text label (visible text, or aria-label if truly necessary).`,
    },
  },
  "button-empty-name": {
    message: {
      fr: () => `Bouton sans intitulé — aucun nom accessible.`,
      en: () => `Button with no label — no accessible name.`,
    },
    remediation: {
      fr: () => `Donnez un intitulé au bouton (texte, value, ou aria-label).`,
      en: () => `Give the button a label (text, value, or aria-label).`,
    },
  },
  "icon-only-control-unnamed": {
    message: {
      fr: (p) => `${p.kind === "link" ? "Lien" : "Bouton"} avec une icône seule (img/svg/i) sans nom accessible.`,
      en: (p) => `${p.kind === "link" ? "Link" : "Button"} with an icon only (img/svg/i) and no accessible name.`,
    },
    remediation: {
      fr: () => `Ajoutez un alt/aria-label sur l'icône ou un texte masqué visuellement (classe visually-hidden).`,
      en: () => `Add an alt/aria-label on the icon, or a visually-hidden text (visually-hidden class).`,
    },
  },
  "control-name-title-only": {
    message: {
      fr: (p) =>
        `${p.kind === "link" ? "Lien" : p.kind === "field" ? "Champ de formulaire" : "Bouton"} dont le seul nom accessible vient de l'attribut title — title n'est pas restitué de façon fiable (survol uniquement).`,
      en: (p) =>
        `${p.kind === "link" ? "Link" : p.kind === "field" ? "Form field" : "Button"} whose only accessible name comes from the title attribute — title is not reliably conveyed (hover only).`,
    },
    remediation: {
      fr: () => `Donnez un intitulé via texte visible ou aria-label ; réservez title à une information complémentaire.`,
      en: () => `Give it a label via visible text or aria-label; reserve title for supplementary information.`,
    },
  },

  // ---- Theme 7 — Scripts / ARIA (src/rules/scripts-aria.ts) -------------------
  "invalid-aria-role": {
    message: {
      fr: (p) => `Rôle ARIA invalide : "${p.roles}" n'est pas un rôle WAI-ARIA valide.`,
      en: (p) => `Invalid ARIA role: "${p.roles}" is not a valid WAI-ARIA role.`,
    },
    remediation: {
      fr: () => `Utilisez un rôle ARIA valide ou un élément HTML natif équivalent.`,
      en: () => `Use a valid ARIA role, or an equivalent native HTML element.`,
    },
  },
  "aria-ref-missing-id": {
    message: {
      fr: (p) => `${p.attr} référence un id inexistant : ${p.ids}.`,
      en: (p) => `${p.attr} references a non-existent id: ${p.ids}.`,
    },
    remediation: {
      fr: () => `Corrigez la référence ou ajoutez l'élément cible avec l'id attendu.`,
      en: () => `Fix the reference, or add the target element with the expected id.`,
    },
  },
  "redundant-aria": {
    message: {
      fr: (p) => `role="${p.role}" est redondant : <${p.tag}> a déjà ce rôle implicite.`,
      en: (p) => `role="${p.role}" is redundant: <${p.tag}> already has this implicit role.`,
    },
    remediation: {
      fr: () => `Retirez l'attribut role redondant et laissez la sémantique native.`,
      en: () => `Remove the redundant role attribute and let the native semantics apply.`,
    },
  },
  "clickable-noninteractive": {
    message: {
      fr: (p) =>
        `<${p.tag}> avec onClick mais ${p.focusIssue === "no-tabindex" ? "non focalisable (tabindex absent)" : "sans rôle interactif"} — contrôle non accessible au clavier/AT.`,
      en: (p) =>
        `<${p.tag}> has onClick but ${p.focusIssue === "no-tabindex" ? "is not focusable (no tabindex)" : "has no interactive role"} — control not accessible via keyboard/AT.`,
    },
    remediation: {
      fr: () => `Utilisez <button>/<a> natif, ou ajoutez role + tabindex="0" + gestion clavier (Enter/Espace).`,
      en: () => `Use a native <button>/<a>, or add role + tabindex="0" + keyboard handling (Enter/Space).`,
    },
  },
  "aria-required-children": {
    message: {
      fr: (p) => `role="${p.role}" sans enfant requis (${p.req}) — structure ARIA incomplète.`,
      en: (p) => `role="${p.role}" with no required child (${p.req}) — incomplete ARIA structure.`,
    },
    remediation: {
      fr: () => `Ajoutez les éléments enfants au rôle approprié, ou utilisez les éléments HTML natifs.`,
      en: () => `Add child elements with the appropriate role, or use native HTML elements.`,
    },
  },
  "aria-hidden-focusable": {
    message: {
      fr: () => `aria-hidden="true" sur (ou contenant) un élément focalisable — piège pour les technologies d'assistance.`,
      en: () => `aria-hidden="true" on (or containing) a focusable element — a trap for assistive technology.`,
    },
    remediation: {
      fr: () => `Retirez aria-hidden, ou rendez l'élément non focalisable (tabindex="-1", disabled).`,
      en: () => `Remove aria-hidden, or make the element non-focusable (tabindex="-1", disabled).`,
    },
  },
  "nested-interactive": {
    message: {
      fr: (p) => `Élément interactif <${p.tag}> imbriqué dans un autre élément interactif — non restitué correctement.`,
      en: (p) => `Interactive element <${p.tag}> nested inside another interactive element — not conveyed correctly.`,
    },
    remediation: {
      fr: () => `Ne pas imbriquer des contrôles interactifs (lien/bouton) ; mettez-les côte à côte.`,
      en: () => `Do not nest interactive controls (link/button); place them side by side instead.`,
    },
  },
  "live-region-conflict.invalid-value": {
    message: {
      fr: (p) => `aria-live="${p.value}" invalide — seules les valeurs off, polite, assertive sont restituées.`,
      en: (p) => `aria-live="${p.value}" is invalid — only the values off, polite, assertive are honoured.`,
    },
    remediation: {
      fr: () => `Utilisez aria-live="polite" (associé à aria-atomic="true") — ou role="alert" pour une erreur ; toute autre valeur est ignorée.`,
      en: () => `Use aria-live="polite" (paired with aria-atomic="true") — or role="alert" for an error; any other value is ignored.`,
    },
  },
  "live-region-conflict.mismatch": {
    message: {
      fr: (p) => `role="${p.role}" implique aria-live="${p.want}" mais aria-live="${p.live}" — message de statut restitué de façon incohérente.`,
      en: (p) => `role="${p.role}" implies aria-live="${p.want}" but aria-live="${p.live}" — status message conveyed inconsistently.`,
    },
    remediation: {
      fr: (p) =>
        p.want === "assertive"
          ? `Laissez role="${p.role}" gérer la restitution (retirez aria-live) ou utilisez aria-live="assertive".`
          : `Alignez aria-live sur "${p.want}" (avec aria-atomic="true"), cohérent avec role="${p.role}", ou retirez-le.`,
      en: (p) =>
        p.want === "assertive"
          ? `Let role="${p.role}" drive the announcement (remove aria-live), or use aria-live="assertive".`
          : `Align aria-live with "${p.want}" (with aria-atomic="true"), consistent with role="${p.role}", or remove it.`,
    },
  },
  "status-message-not-assertive": {
    message: {
      fr: () => `Conteneur d'erreur/alerte en aria-live="polite" — un message d'erreur doit être restitué de façon assertive.`,
      en: () => `Error/alert container with aria-live="polite" — an error message must be conveyed assertively.`,
    },
    remediation: {
      fr: () =>
        `Utilisez role="alert" seul (restitution assertive immédiate) plutôt qu'aria-live="polite" ; ne déplacez pas aussi le focus vers ce conteneur — soit un mécanisme aria-live/role="alert", soit un déplacement du focus, jamais les deux.`,
      en: () =>
        `Use role="alert" alone (immediate assertive restitution) rather than aria-live="polite"; do not also move focus to that container — a live region OR a focus move, never both.`,
    },
  },

  // ---- Theme 8 — Mandatory elements (src/rules/mandatory.ts) ------------------
  "html-lang-missing": {
    message: {
      fr: () => `<html> sans attribut lang — la langue par défaut de la page n'est pas déclarée.`,
      en: () => `<html> has no lang attribute — the page's default language is not declared.`,
    },
    remediation: {
      fr: () => `Ajoutez lang sur <html>, ex. <html lang="fr">.`,
      en: () => `Add lang on <html>, e.g. <html lang="en">.`,
    },
  },
  "title-missing-empty": {
    message: {
      fr: (p) => (p.titleState === "empty" ? `<title> vide — le titre de la page est absent de contenu.` : `<title> absent — la page n'a pas de titre.`),
      en: (p) => (p.titleState === "empty" ? `<title> is empty — the page title has no content.` : `<title> is missing — the page has no title.`),
    },
    remediation: {
      fr: () => `Ajoutez un <title> non vide et pertinent dans <head>.`,
      en: () => `Add a non-empty, relevant <title> in <head>.`,
    },
  },
  "duplicate-id": {
    message: {
      fr: (p) => `id="${p.id}" dupliqué — un id doit être unique dans la page (HTML invalide).`,
      en: (p) => `id="${p.id}" duplicated — an id must be unique in the page (invalid HTML).`,
    },
    remediation: {
      fr: () => `Donnez un id unique à chaque élément ; ajustez les références (label[for], aria-*).`,
      en: () => `Give each element a unique id; adjust references accordingly (label[for], aria-*).`,
    },
  },
  "inline-lang-change-missing": {
    message: {
      fr: (p) => `Attribut lang vide sur <${p.tag}> — changement de langue mal indiqué.`,
      en: (p) => `Empty lang attribute on <${p.tag}> — the language change is not properly indicated.`,
    },
    remediation: {
      fr: () => `Renseignez un code de langue valide (ex. lang="en") ou retirez l'attribut.`,
      en: () => `Provide a valid language code (e.g. lang="en") or remove the attribute.`,
    },
  },
  "lang-invalid": {
    message: {
      fr: (p) => `Code de langue invalide lang="${p.lang}" sur <${p.tag}> — n'est pas un code BCP 47 valide.`,
      en: (p) => `Invalid language code lang="${p.lang}" on <${p.tag}> — not a valid BCP 47 code.`,
    },
    remediation: {
      fr: () => `Utilisez un code de langue valide (ex. "fr", "en", "fr-CA").`,
      en: () => `Use a valid language code (e.g. "en", "fr", "en-US").`,
    },
  },

  // ---- Theme 9 — Headings (src/rules/headings.ts) -----------------------------
  "heading-order-skip": {
    message: {
      fr: (p) => `Saut de niveau de titre : <h${p.level}> après <h${p.prev}> (niveau h${p.expected} attendu).`,
      en: (p) => `Heading level skip: <h${p.level}> after <h${p.prev}> (level h${p.expected} expected).`,
    },
    remediation: {
      fr: () => `Ne sautez pas de niveau : enchaînez les titres sans omettre de palier.`,
      en: () => `Do not skip a level: chain heading levels without omitting a step.`,
    },
  },
  // ADVISORY (non-normative): "start the page at h1" is not required by HTML, WCAG, or
  // SEO — a single, well-structured heading hierarchy (covered normatively by
  // heading-order-skip) is what matters. Worded as a recommendation, not a constat.
  "h1-missing": {
    message: {
      fr: () =>
        `Recommandation : la page ne commence par aucun <h1>. Un <h1> décrivant le contenu principal aide au repérage, mais démarrer à h1 n'est requis ni par HTML, ni par l'accessibilité, ni par le SEO.`,
      en: () =>
        `Recommendation: the page starts with no <h1>. An <h1> naming the main content aids orientation, but starting at h1 is not required by HTML, accessibility, or SEO.`,
    },
    remediation: {
      fr: () => `Envisagez d'ajouter un <h1> décrivant le contenu principal ; la hiérarchie des titres (sans saut de niveau) reste l'exigence normative.`,
      en: () => `Consider adding an <h1> describing the page's main content; a heading hierarchy with no level skip stays the normative requirement.`,
    },
  },
  // ADVISORY (non-normative): "a single h1 per page" is not a rule in HTML, accessibility,
  // or SEO. Multiple h1 are valid (HTML5 sectioning) — worded as a recommendation.
  "h1-multiple": {
    message: {
      fr: (p) =>
        `Recommandation : plusieurs <h1> dans la page (${p.count}). Un titre de niveau 1 unique clarifie souvent la structure, mais « un seul <h1> par page » n'est une règle ni en HTML, ni en accessibilité, ni en SEO.`,
      en: (p) =>
        `Recommendation: multiple <h1> in the page (${p.count}). A single level-1 heading often clarifies structure, but "one h1 per page" is not a rule in HTML, accessibility, or SEO.`,
    },
    remediation: {
      fr: () => `Envisagez de conserver un unique <h1> et de hiérarchiser le reste avec h2…h6 ; ce n'est pas une non-conformité.`,
      en: () => `Consider keeping a single <h1> and structuring the rest with h2…h6; this is not a non-conformity.`,
    },
  },
  "list-structure.invalid-child": {
    message: {
      fr: (p) => `<${p.childTag}> enfant direct de <${p.parentTag}> — une liste ne doit contenir que des <li>.`,
      en: (p) => `<${p.childTag}> is a direct child of <${p.parentTag}> — a list must only contain <li>.`,
    },
    remediation: {
      fr: (p) => `Enveloppez le contenu dans des <li>, ou utilisez un autre élément que <${p.parentTag}>.`,
      en: (p) => `Wrap the content in <li> elements, or use a different element than <${p.parentTag}>.`,
    },
  },
  "list-structure.li-outside-list": {
    message: {
      fr: (p) => `<li> hors d'une liste (<${p.parentTag}> parent) — structure de liste invalide.`,
      en: (p) => `<li> outside a list (<${p.parentTag}> parent) — invalid list structure.`,
    },
    remediation: {
      fr: () => `Placez chaque <li> directement dans un <ul>, <ol> ou <menu>.`,
      en: () => `Place each <li> directly inside a <ul>, <ol> or <menu>.`,
    },
  },
  "empty-heading": {
    message: {
      fr: (p) => `Titre <${p.tag}> de niveau ${p.level} vide — un titre sans intitulé désoriente la navigation au clavier/lecteur d'écran.`,
      en: (p) => `Empty level-${p.level} <${p.tag}> heading — a heading with no label disorients keyboard/screen-reader navigation.`,
    },
    remediation: {
      fr: () => `Donnez un intitulé textuel au titre, ou retirez-le s'il est purement décoratif.`,
      en: () => `Give the heading a text label, or remove it if it is purely decorative.`,
    },
  },

  // ---- Theme 10 — Presentation / zoom (src/rules/presentation.ts) -------------
  "meta-viewport-zoom-block": {
    message: {
      fr: (p) =>
        `<meta viewport> bloque le zoom (${p.blockedBy === "user-scalable" ? "user-scalable=no" : `maximum-scale=${p.maxScale}`}) — agrandissement à 200% empêché.`,
      en: (p) =>
        `<meta viewport> blocks zoom (${p.blockedBy === "user-scalable" ? "user-scalable=no" : `maximum-scale=${p.maxScale}`}) — 200% zoom is prevented.`,
    },
    remediation: {
      fr: () => `Retirez user-scalable=no et maximum-scale (ou maximum-scale ≥ 2) du content du viewport.`,
      en: () => `Remove user-scalable=no and maximum-scale (or set maximum-scale ≥ 2) from the viewport content.`,
    },
  },
  "presentational-element": {
    message: {
      fr: (p) => `<${p.tag}> est une balise de présentation — la mise en forme doit passer par CSS (test RGAA 10.1.1).`,
      en: (p) => `<${p.tag}> is a presentational element — styling belongs in CSS (RGAA test 10.1.1).`,
    },
    remediation: {
      fr: (p) => `Remplacez <${p.tag}> par un élément porteur de sens (ou un <span>/<div> neutre) et déplacez la mise en forme dans la feuille de styles.`,
      en: (p) => `Replace <${p.tag}> with a meaningful element (or a neutral <span>/<div>) and move the styling to the stylesheet.`,
    },
  },
  "presentational-attribute": {
    message: {
      fr: (p) => `Attribut de présentation ${p.attr} sur <${p.tag}> — la mise en forme doit passer par CSS (test RGAA 10.1.2).`,
      en: (p) => `Presentational attribute ${p.attr} on <${p.tag}> — styling belongs in CSS (RGAA test 10.1.2).`,
    },
    remediation: {
      fr: (p) => `Retirez ${p.attr} de <${p.tag}> et exprimez la même mise en forme dans la feuille de styles.`,
      en: (p) => `Remove ${p.attr} from <${p.tag}> and express the same styling in the stylesheet.`,
    },
  },
  "presentational-spacing": {
    message: {
      fr: (p) =>
        p.how === "spelled-out"
          ? `Mot dont les lettres sont séparées par des espaces — restitué lettre à lettre par un lecteur d'écran (test RGAA 10.1.3).`
          : `Suite d'espaces insécables utilisée comme mise en page (test RGAA 10.1.3).`,
      en: (p) =>
        p.how === "spelled-out"
          ? `A word whose letters are separated by spaces — a screen reader reads it out letter by letter (RGAA test 10.1.3).`
          : `A run of non-breaking spaces used as layout (RGAA test 10.1.3).`,
    },
    remediation: {
      fr: (p) =>
        p.how === "spelled-out"
          ? `Écrivez le mot normalement et obtenez l'espacement avec letter-spacing en CSS.`
          : `Remplacez les espaces insécables par une mise en page CSS (grille, colonnes, marges).`,
      en: (p) =>
        p.how === "spelled-out"
          ? `Write the word normally and get the spacing from CSS letter-spacing.`
          : `Replace the non-breaking spaces with CSS layout (grid, columns, margins).`,
    },
  },
  "css-generated-content-informative": {
    message: {
      fr: (p) => `Contenu généré en CSS porteur de texte (content: "${p.text}") : invisible pour les technologies d'assistance.`,
      en: (p) => `CSS generated content carrying text (content: "${p.text}"): invisible to assistive technologies.`,
    },
    remediation: {
      fr: () => `Déplacez ce texte informatif dans le DOM ; réservez content aux éléments purement décoratifs.`,
      en: () => `Move this informative text into the DOM; keep content for purely decorative elements.`,
    },
  },

  // ---- Theme 11 — Forms (src/rules/forms.ts) ----------------------------------
  "control-label-missing": {
    message: {
      fr: (p) => `Champ de formulaire <${p.tag}> sans étiquette — aucun label associé.`,
      en: (p) => `Form field <${p.tag}> has no label — no associated label.`,
    },
    remediation: {
      fr: () => `Associez un <label for="…"> (ou enveloppez le champ d'un <label>, ou aria-label/aria-labelledby).`,
      en: () => `Associate a <label for="…"> (or wrap the field in a <label>, or use aria-label/aria-labelledby).`,
    },
  },
  "placeholder-as-label": {
    message: {
      fr: (p) => `placeholder="${p.value}" utilisé comme seule étiquette — le placeholder n'est pas un label.`,
      en: (p) => `placeholder="${p.value}" used as the only label — a placeholder is not a label.`,
    },
    remediation: {
      fr: () => `Ajoutez un <label> réel ; le placeholder ne doit que compléter, pas remplacer l'étiquette.`,
      en: () => `Add a real <label>; the placeholder should only supplement, not replace, the label.`,
    },
  },
  "fieldset-legend-missing": {
    message: {
      fr: () => `<fieldset> sans <legend> (ou légende vide) — regroupement de champs sans légende.`,
      en: () => `<fieldset> has no <legend> (or an empty one) — a field group with no legend.`,
    },
    remediation: {
      fr: () => `Ajoutez un <legend> non vide en premier enfant du <fieldset>.`,
      en: () => `Add a non-empty <legend> as the first child of the <fieldset>.`,
    },
  },
  "form-field-multiple-labels": {
    message: {
      fr: (p) => `Champ <${p.tag}> référencé par ${p.count} <label for="${p.id}"> — étiquettes multiples ambiguës.`,
      en: (p) => `Field <${p.tag}> referenced by ${p.count} <label for="${p.id}"> — ambiguous multiple labels.`,
    },
    remediation: {
      fr: () => `Un seul <label> doit cibler le champ ; fusionnez ou retirez les étiquettes superflues.`,
      en: () => `A single <label> should target the field; merge or remove the superfluous labels.`,
    },
  },
  "select-has-option": {
    message: {
      fr: () => `<select> sans aucune <option> — liste de choix vide.`,
      en: () => `<select> has no <option> at all — empty choice list.`,
    },
    remediation: {
      fr: () => `Ajoutez des <option> (et un <optgroup>/option par défaut si pertinent).`,
      en: () => `Add <option> elements (and an <optgroup>/default option if relevant).`,
    },
  },
  "label-for-dangling": {
    message: {
      fr: (p) => `<label for="${p.id}"> ne cible aucun élément — aucun champ n'a id="${p.id}".`,
      en: (p) => `<label for="${p.id}"> targets no element — no field has id="${p.id}".`,
    },
    remediation: {
      fr: (p) => `Donnez au champ id="${p.id}", corrigez l'attribut for, ou enveloppez le champ dans le <label>.`,
      en: (p) => `Give the field id="${p.id}", fix the for attribute, or wrap the field inside the <label>.`,
    },
  },
  "aria-invalid-no-description": {
    message: {
      fr: (p) => `<${p.tag}> a aria-invalid="true" mais aucun aria-describedby/aria-errormessage — l'erreur est signalée sans être reliée à son message.`,
      en: (p) => `<${p.tag}> has aria-invalid="true" but no aria-describedby/aria-errormessage — the error is signalled without being linked to its message.`,
    },
    remediation: {
      fr: () => `Reliez le message d'erreur au champ via aria-describedby (ou aria-errormessage) pointant vers le texte d'erreur.`,
      en: () => `Link the error message to the field via aria-describedby (or aria-errormessage) pointing at the error text.`,
    },
  },
  "error-not-associated": {
    message: {
      fr: (p) => `Message d'erreur (id="${p.id}") relié à aucun champ — aucun aria-describedby/aria-errormessage ne le référence.`,
      en: (p) => `Error message (id="${p.id}") linked to no field — no aria-describedby/aria-errormessage references it.`,
    },
    remediation: {
      fr: (p) =>
        `Sur le champ concerné, ajoutez aria-describedby="${p.id}" (ou aria-errormessage) et aria-invalid="true" ; restituez l'erreur via role="alert" (pas aria-live="polite"), sans à la fois déplacer le focus et recourir à aria-live/role="alert".`,
      en: (p) =>
        `On the relevant field, add aria-describedby="${p.id}" (or aria-errormessage) and aria-invalid="true"; announce the error via role="alert" (not aria-live="polite"), without both moving focus and using a live region.`,
    },
  },
  "field-purpose-incomplete.autocomplete": {
    message: {
      fr: (p) =>
        `Champ d'identification (${p.type === "email" || p.type === "tel" ? `type="${p.type}"` : "name/id"}) sans autocomplete — objet du champ non exposé.`,
      en: (p) =>
        `Identification field (${p.type === "email" || p.type === "tel" ? `type="${p.type}"` : "name/id"}) with no autocomplete — the field's purpose is not exposed.`,
    },
    remediation: {
      // No trailing criterion reference: every rendering already states the criterion this
      // remediation belongs to, and under a country standard the hard-coded « WCAG 1.3.5 »
      // named a referential the rest of the deliverable no longer mentions.
      fr: () => `Ajoutez un autocomplete approprié (ex. email, tel, name, postal-code, street-address).`,
      en: () => `Add an appropriate autocomplete (e.g. email, tel, name, postal-code, street-address).`,
    },
  },
  "field-purpose-incomplete.aria-required": {
    message: {
      fr: (p) => `Widget personnalisé (role="${p.role}") requis sans aria-required — l'état requis n'est pas restitué.`,
      en: (p) => `Custom widget (role="${p.role}") is required but has no aria-required — the required state is not conveyed.`,
    },
    remediation: {
      fr: () => `Ajoutez aria-required="true" sur le widget personnalisé requis.`,
      en: () => `Add aria-required="true" on the required custom widget.`,
    },
  },
  "disabled-context-content.fieldset": {
    message: {
      fr: () => `<fieldset disabled> encapsulant des champs en lecture seule — le contenu risque d'être ignoré par les technologies d'assistance.`,
      en: () => `<fieldset disabled> wrapping read-only fields — the content may be ignored by assistive technologies.`,
    },
    remediation: {
      fr: () => `Remplacez le conteneur désactivé par un <div> (ou aria-disabled="true" + gestion clavier en JS) afin que le contenu reste restitué.`,
      en: () => `Replace the disabled container with a <div> (or aria-disabled="true" + JS keyboard handling) so the content stays exposed.`,
    },
  },
  "disabled-context-content.inert": {
    message: {
      fr: () => `Conteneur [inert] encapsulant des champs de formulaire — leur contenu est retiré de l'arbre d'accessibilité.`,
      en: () => `[inert] container wrapping form fields — their content is taken out of the accessibility tree.`,
    },
    remediation: {
      fr: () => `Retirez [inert] du conteneur en lecture seule (ou aria-disabled="true" + JS) pour que le contenu reste restitué.`,
      en: () => `Take [inert] off the read-only container (or use aria-disabled="true" + JS) so the content stays exposed.`,
    },
  },
  "radio-checkbox-group-ungrouped": {
    message: {
      fr: (p) => `${p.count} champs ${p.type} partageant name="${p.name}" hors de tout <fieldset>/role="radiogroup"/role="group" — regroupement absent.`,
      en: (p) => `${p.count} ${p.type} fields sharing name="${p.name}" outside any <fieldset>/role="radiogroup"/role="group" — grouping is missing.`,
    },
    remediation: {
      fr: () => `Regroupez ces champs de même nature dans un <fieldset> avec <legend> (ou un role="radiogroup"/role="group" nommé).`,
      en: () => `Group these same-nature fields in a <fieldset> with a <legend> (or a named role="radiogroup"/role="group").`,
    },
  },
  "date-fields-ungrouped": {
    message: {
      fr: (p) => `${p.count} champs de date adjacents hors de tout <fieldset>/role="group" — champs de même nature non regroupés.`,
      en: (p) => `${p.count} adjacent date fields outside any <fieldset>/role="group" — same-nature fields left ungrouped.`,
    },
    remediation: {
      fr: () => `Regroupez les champs de date (jour/mois/année, début/fin) dans un <fieldset> avec une <legend> décrivant la période.`,
      en: () => `Group the date fields (day/month/year, start/end) in a <fieldset> with a <legend> describing the period.`,
    },
  },

  // ---- Theme 12 — Navigation & landmarks (src/rules/navigation.ts) ------------
  "skip-link-target-missing": {
    message: {
      fr: (p) => `Lien interne href="${p.href}" — la cible #${p.id} n'existe pas dans la page (lien d'évitement/ancre cassé).`,
      en: (p) => `Internal link href="${p.href}" — target #${p.id} does not exist in the page (broken skip link/anchor).`,
    },
    remediation: {
      fr: (p) => `Ajoutez un élément avec id="${p.id}" (ex. <main id="${p.id}">) ou corrigez l'ancre.`,
      en: (p) => `Add an element with id="${p.id}" (e.g. <main id="${p.id}">) or fix the anchor.`,
    },
  },
  "positive-tabindex": {
    message: {
      fr: (p) => `tabindex="${p.value}" positif — force un ordre de tabulation incohérent avec l'ordre du DOM.`,
      en: (p) => `Positive tabindex="${p.value}" — forces a tab order inconsistent with DOM order.`,
    },
    remediation: {
      fr: () => `Utilisez tabindex="0" (ou pas de tabindex) et ordonnez via le DOM ; réservez les valeurs >0.`,
      en: () => `Use tabindex="0" (or no tabindex) and order via the DOM; reserve values >0.`,
    },
  },
  "missing-main-landmark": {
    message: {
      fr: () => `Aucun repère <main> dans la page — le contenu principal n'est pas identifié (et la cible d'un lien d'évitement manque).`,
      en: () => `No <main> landmark in the page — the main content is not identified (and a skip link's target is missing).`,
    },
    remediation: {
      fr: () => `Enveloppez le contenu principal dans un <main id="content"> (unique par page).`,
      en: () => `Wrap the main content in a <main id="content"> (unique per page).`,
    },
  },
  "multiple-main-landmark": {
    message: {
      fr: (p) => `Plusieurs repères <main> dans la page (${p.count}) — un seul contenu principal est autorisé.`,
      en: (p) => `Multiple <main> landmarks in the page (${p.count}) — only one main content area is allowed.`,
    },
    remediation: {
      fr: () => `Conservez un unique <main>/role="main" ; structurez le reste avec <section>/<aside>.`,
      en: () => `Keep a single <main>/role="main"; structure the rest with <section>/<aside>.`,
    },
  },
  "nav-landmark-missing": {
    message: {
      fr: (p) => `Groupe de ${p.count} liens de navigation dans <${p.region}> sans repère de navigation (<nav> ou role="navigation") dans la page.`,
      en: (p) => `A cluster of ${p.count} navigation links in <${p.region}> with no navigation landmark (<nav> or role="navigation") in the page.`,
    },
    remediation: {
      fr: () => `Encapsulez les liens de navigation dans un <nav> (ou role="navigation") pour exposer un repère de navigation.`,
      en: () => `Wrap the navigation links in a <nav> (or role="navigation") to expose a navigation landmark.`,
    },
  },
  "nav-landmark-unnamed": {
    message: {
      fr: () => `Plusieurs repères de navigation dans la page ; celui-ci n'a ni aria-label ni aria-labelledby pour le distinguer.`,
      en: () => `Several navigation landmarks in the page; this one has neither aria-label nor aria-labelledby to tell them apart.`,
    },
    remediation: {
      fr: () => `Donnez à chaque <nav> un aria-label (ou aria-labelledby) distinct, ex. « Menu principal » / « Fil d'Ariane ».`,
      en: () => `Give each <nav> a distinct aria-label (or aria-labelledby), e.g. "Primary" / "Breadcrumb".`,
    },
  },

  // ---- Theme 4/13 — Multimedia (src/rules/multimedia.ts) ----------------------
  "autoplay-media.muted-video": {
    message: {
      fr: () => `<video autoplay> démarre automatiquement — contenu en mouvement non contrôlé.`,
      en: () => `<video autoplay> starts automatically — uncontrolled moving content.`,
    },
    remediation: {
      fr: () => `Évitez l'autoplay ou fournissez un contrôle pause/stop accessible (et controls).`,
      en: () => `Avoid autoplay, or provide an accessible pause/stop control (and controls).`,
    },
  },
  "autoplay-media.audible": {
    message: {
      fr: (p) => `<${p.tag} autoplay> démarre automatiquement ${p.tag === "audio" ? "du son" : "une vidéo sonore"} — non contrôlable par l'utilisateur.`,
      en: (p) => `<${p.tag} autoplay> automatically starts ${p.tag === "audio" ? "sound" : "a video with sound"} — not controllable by the user.`,
    },
    remediation: {
      fr: () => `Retirez autoplay, ou ajoutez un contrôle de lecture (controls + pause/stop) facilement accessible.`,
      en: () => `Remove autoplay, or add an easily accessible playback control (controls + pause/stop).`,
    },
  },
  "media-no-track": {
    message: {
      fr: () => `<video> sans élément <track> — aucune piste de sous-titres/légendes synchronisées.`,
      en: () => `<video> has no <track> element — no synchronized captions/subtitles track.`,
    },
    remediation: {
      fr: () => `Ajoutez <track kind="captions" src="…" srclang="fr" label="Français"> (ou subtitles) pour le média synchronisé.`,
      en: () => `Add <track kind="captions" src="…" srclang="en" label="English"> (or subtitles) for the synchronized media.`,
    },
  },

  // ---- Theme 13 — Timing & moving content (src/rules/timing.ts) ---------------
  "meta-refresh-redirect": {
    message: {
      fr: (p) =>
        `<meta http-equiv="refresh" content="${p.content}"> impose un délai de ${p.seconds}s — rafraîchissement/redirection temporisé non contrôlable.`,
      en: (p) => `<meta http-equiv="refresh" content="${p.content}"> imposes a ${p.seconds}s delay — an uncontrollable timed refresh/redirect.`,
    },
    remediation: {
      fr: () => `Supprimez le meta refresh temporisé, ou laissez l'utilisateur contrôler/désactiver/prolonger le délai.`,
      en: () => `Remove the timed meta refresh, or let the user control/disable/extend the delay.`,
    },
  },
  "blink-marquee": {
    message: {
      fr: (p) => `<${p.tag}> — contenu en mouvement/clignotant automatique sans mécanisme de pause.`,
      en: (p) => `<${p.tag}> — automatic moving/blinking content with no pause mechanism.`,
    },
    remediation: {
      fr: (p) => `Remplacez <${p.tag}> par du contenu statique, ou fournissez un contrôle pause/stop/masquer.`,
      en: (p) => `Replace <${p.tag}> with static content, or provide a pause/stop/hide control.`,
    },
  },

  // ---- Cross-file rules (src/rules/cross-registry.ts) -------------------------
  "cross-icon-only-unnamed": {
    message: {
      fr: (p) => `<${p.tag}> rend un contrôle à icône seule mais est utilisé sans nom accessible (aucun aria-label/title/texte passé).`,
      en: (p) => `<${p.tag}> renders an icon-only control but is used with no accessible name (no aria-label/title/text passed).`,
    },
    remediation: {
      fr: (p) => `Passez un nom au composant à cet endroit, p. ex. <${p.tag} aria-label="…" /> (le composant ${p.defName} rend une icône sans texte).`,
      en: (p) => `Pass a name to the component at this usage, e.g. <${p.tag} aria-label="…" /> (the component ${p.defName} renders an icon with no text).`,
    },
  },
  "cross-prop-drilled-name-lost": {
    message: {
      fr: (p) => `<${p.tag} ${p.passed}="…"> mais ${p.defName} ne transmet pas ce nom au contrôle rendu — le nom accessible est perdu.`,
      en: (p) => `<${p.tag} ${p.passed}="…"> but ${p.defName} does not forward this name to the rendered control — the accessible name is lost.`,
    },
    remediation: {
      fr: (p) => `Dans ${p.defName}, transmettez ${p.passed} (ou {...props}) au <button>/<a> rendu, ou nommez le contrôle directement.`,
      en: (p) => `In ${p.defName}, forward ${p.passed} (or {...props}) to the rendered <button>/<a>, or name the control directly.`,
    },
  },

  // ---- Dynamic tier (src/scan.ts mergeDynamic) ---------------------------------
  // `scan --merge` folds axe-core/probe findings into a static AuditResult. Their
  // MESSAGE is either ultra11y's own authored prose (the 320px reflow check) or the
  // rendering engine's own text (axe-core's English violation help, or a probe's own
  // detail string) — never ultra11y prose in the latter case. Only the REMEDIATION
  // is always ultra11y-authored. Both entries below give these findings a `msg.id`
  // (set in mergeDynamic) so a LATER `report`/`prd --lang` re-render can still
  // resolve the OTHER language, instead of staying stuck in whatever language was
  // baked at merge/scan time.
  "dyn-reflow": {
    message: {
      fr: () => `Défilement horizontal à 320px de large — le contenu ne se redistribue pas (reflow).`,
      en: () => `Horizontal scrolling at 320px width — content does not reflow.`,
    },
    remediation: {
      fr: () => `Vérifié au rendu par axe-core ; corrigez l'élément cité.`,
      en: () => `Verified at render time by axe-core; fix the cited element.`,
    },
  },
  "dyn-remediation": {
    // Covers axe-core findings and the residual-criteria probes (focus-visible,
    // text-spacing, hover, reflow-zoom). Their message is authored by the engine
    // itself, not by ultra11y — it passes through UNCHANGED in both languages (never
    // translated; axe-core only ever speaks English), carried verbatim via `params.
    // message`. This is the documented "axe's own English messages stay as-is".
    message: {
      fr: (p) => String(p.message ?? ""),
      en: (p) => String(p.message ?? ""),
    },
    remediation: {
      fr: () => `Vérifié au rendu par axe-core ; corrigez l'élément cité.`,
      en: () => `Verified at render time by axe-core; fix the cited element.`,
    },
  },
};

// ---- Cross-file RelatedSite notes (src/rules/cross-registry.ts) -------------------
// Mirrors MSG_CATALOG's fr/en split, but for `Finding.related.note` — the short label
// describing the OTHER site (e.g. a component definition) a cross-file finding points
// at. Unlike message/remediation these carry no params, so entries are plain strings.
// The fr strings are the ORIGINAL author strings, moved here verbatim; the en strings
// are faithful technical translations written for this catalog.
export const NOTE_CATALOG: Record<string, Record<Lang, string>> = {
  "related.icon-component-def": {
    fr: "définition du composant à icône seule",
    en: "icon-only component definition",
  },
  "related.name-drop-def": {
    fr: "contrôle qui ne reçoit pas le nom passé",
    en: "control that does not receive the passed name",
  },
};

function entryFor(id: string | undefined): MsgEntry | undefined {
  return id === undefined ? undefined : MSG_CATALOG[id];
}

/** Resolve a finding's message by lang: the finding's own localized `i18n` pair first
 *  (declarative pack rules, which cannot register into the compiled catalog), then the
 *  catalog template when `f.msg` is present and known, else the baked `f.message`
 *  (back-compat with old JSON / unknown ids). */
export function resolveMessage(
  f: { message: string; msg?: { id: string; params?: MsgParams }; i18n?: { message: Partial<Record<Lang, string>> } },
  lang: Lang,
): string {
  const localized = f.i18n?.message?.[lang];
  if (localized) return localized;
  const entry = entryFor(f.msg?.id);
  return entry ? entry.message[lang](f.msg?.params ?? {}) : f.message;
}

/** Resolve a finding's remediation by lang — mirrors resolveMessage. */
export function resolveRemediation(
  f: { remediation: string; msg?: { id: string; params?: MsgParams }; i18n?: { remediation: Partial<Record<Lang, string>> } },
  lang: Lang,
): string {
  const localized = f.i18n?.remediation?.[lang];
  if (localized) return localized;
  const entry = entryFor(f.msg?.id);
  return entry ? entry.remediation[lang](f.msg?.params ?? {}) : f.remediation;
}

/** Resolve a cross-file RelatedSite's note by lang: NOTE_CATALOG entry when `noteId` is
 *  present and known, else the baked `note` (back-compat with old JSON / unknown ids). */
export function resolveNote(related: { note: string; noteId?: string }, lang: Lang): string {
  const entry = related.noteId ? NOTE_CATALOG[related.noteId] : undefined;
  return entry ? entry[lang] : related.note;
}

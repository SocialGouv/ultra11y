# Noms accessibles — comment ils sont calculés, et comment les obtenir correctement

L’essentiel de ce qu’un audit appelle « 4.1.2 » est un problème de nommage. Cette page est la
référence pour ce qu’EST un nom, afin qu’un verdict repose sur le calcul plutôt que sur
l’apparence du balisage.

## La chaîne de priorité (accname), de la plus haute à la plus basse

Le nom accessible d’un contrôle est la PREMIÈRE de ces sources qui produit un texte non vide :

| # | Source | Remarques |
|---|---|---|
| 1 | `aria-labelledby` | L’emporte sur tout, y compris le contenu visible. Concatène le texte de chaque id, dans l’ordre listé. Un id orphelin n’apporte rien — une liste entièrement orpheline laisse l’élément sans nom. |
| 2 | `aria-label` | Remplace entièrement le texte visible. C’est ce qui casse le 2.5.3 (voir plus bas). |
| 3 | Sémantique native de l’élément hôte | `<label for>` / `<label>` englobant pour les champs de formulaire, `alt` pour `<img>`, `<legend>` pour `<fieldset>`, `<caption>` pour `<table>`, `<figcaption>` pour `<figure>`, `value` pour `<input type="submit">`. |
| 4 | Contenu textuel | Pour les éléments dont le rôle autorise le « nom issu du contenu » : button, link, heading, menuitem, tab, option… PAS pour un `<div>` ni un `<input>`. |
| 5 | `title` | Dernier recours. Uniquement au survol : absent au tactile, restitué de façon inégale. Un nom qui existe, mais qui ne devrait pas être la solution prévue. |

Deux conséquences qui méritent d’être énoncées explicitement, car toutes deux produisent des
verdicts faux mais assurés :

- **Un nom qui existe n’est pas un nom qui fonctionne.** `aria-label="Button"` satisfait
  « a un nom » et n’aide personne. Jugez la pertinence, pas la présence.
- **La chaîne s’arrête au premier résultat.** `<button aria-label="Close">Save</button>` est
  nommé « Close ». Le mot visible « Save » n’entre jamais dans le calcul.

## 2.5.3 Étiquette dans le nom — la règle dont dépend la commande vocale

Quand un contrôle affiche un texte visible, ce texte doit être **contenu dans** le nom
accessible. Un utilisateur de saisie vocale prononce ce qu’il voit ; si le nom diffère, la
commande ne fait rien, sans le moindre signal.

```html
<!-- ✗ the spoken "click Send" matches nothing -->
<button aria-label="Submit form">Send</button>

<!-- ✓ the visible text is contained, and comes first -->
<button aria-label="Send message to support">Send</button>

<!-- ✓ best: no override at all — the text names the button -->
<button>Send</button>
```

Règle empirique : si vous vous surprenez à écrire `aria-label` sur un élément qui affiche déjà
du texte, vous êtes généralement sur le point de casser le 2.5.3. Préférez `aria-describedby`
pour le détail supplémentaire. Règle du moteur : `label-in-name-mismatch`.

## Texte masqué visuellement — le CSS qui fonctionne vraiment

Nommer un contrôle à icône avec un texte que seuls les lecteurs d’écran atteignent est la
réponse « natif d’abord ». `display:none` et `visibility:hidden` retirent aussi le texte de
l’arbre d’accessibilité ; `text-indent:-9999px` casse en RTL ; `font-size:0` n’est pas fiable.

```css
/* The only clipping recipe that survives every engine, and stays focusable. */
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
/* Skip links: visible again once focused. */
.visually-hidden:focus-visible {
  position: static;
  width: auto;
  height: auto;
  clip-path: none;
  white-space: normal;
}
```

## Nommer le contenu non textuel

```html
<!-- Informative image: describe the MEANING in context, not the picture -->
<img src="chart.png" alt="Sales up 25% in Q3 2025">

<!-- Decorative image: an explicit empty alt, never a missing one -->
<img src="divider.png" alt="">

<!-- Icon control: the name describes the ACTION, not the glyph -->
<button aria-label="Delete this comment"><svg aria-hidden="true" focusable="false">…</svg></button>

<!-- Inline SVG treated as an image -->
<svg role="img" aria-labelledby="logo-title"><title id="logo-title">Acme</title>…</svg>

<!-- Decorative SVG: hide it and make sure it is not a tab stop in IE-era engines -->
<svg aria-hidden="true" focusable="false">…</svg>

<!-- Figure: the caption is visible text AND the accessible name -->
<figure>
  <img src="plan.png" alt="Ground floor: reception, then three meeting rooms along a corridor">
  <figcaption>Ground floor plan</figcaption>
</figure>

<!-- Abbreviation: expand on first use in text; title alone is hover-only -->
<p>The <abbr title="World Wide Web Consortium">W3C</abbr> publishes WCAG.</p>
```

**Graphiques.** Un `alt` qui nomme le graphique (« Graphique des ventes ») n’est pas une
alternative — il nomme le conteneur et perd les données. Mettez soit les chiffres dans l’alt,
soit un renvoi vers un tableau équivalent à proximité. Règle du moteur :
`chart-no-accessible-name`.

## Ce que le moteur tranche, et ce qui vous revient

| Décidé par le moteur | À vous d’arbitrer |
|---|---|
| Nom **absent** (`img-alt-missing`, `button-empty-name`, `link-empty-name`, `control-label-missing`, `iframe-title-missing`, `icon-only-control-unnamed`) | Si le nom est **pertinent** (1.1.1, 2.4.4, 2.4.6) — le moteur ne peut pas lire le sens |
| Nom fourni uniquement par `title` (`control-name-title-only`, `img-alt-missing.title-only` en tant que recommandation) | Si une image `alt=""` est réellement décorative |
| Texte visible non contenu dans le nom (`label-in-name-mismatch`) | Si une police d’icônes rend le texte du DOM invisible (le 2.5.3 ne s’applique alors pas) |
| Noms interdits par le rôle (`aria-prohibited-attr`) | Si deux liens de même nom partagent une destination (2.4.4) |

Inter-fichiers : avec `--graph`, le moteur résout un nom passé en prop à un composant, et
signale celui qui se perd en chemin (`cross-prop-drilled-name-lost`). Voir
`references/cross-file.md`.

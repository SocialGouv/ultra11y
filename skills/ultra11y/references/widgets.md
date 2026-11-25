# Widgets composites — contrats clavier, états ARIA, gestion du focus

Le moteur voit la structure ; il ne peut pas appuyer sur Tab. Quand un composant n’est pas un
élément natif, son accessibilité EST son contrat clavier, et c’est ce contrat que vous
arbitrez au titre des 2.1.1, 2.4.3, 4.1.2 et 4.1.3. Cette page est la référence de ce que
chaque motif doit fournir, d’après l’ARIA Authoring Practices Guide (APG).

**La règle qui les précède toutes : utilisez l’élément natif.** `<button>`, `<select>`,
`<details>`, `<dialog>`, `<input type="checkbox">` fournissent gratuitement chacun des
comportements ci-dessous et ne peuvent pas se désynchroniser. Ne recourez à ARIA que lorsque
aucun élément natif ne convient.

## Contrats clavier

| Motif | Rôles | Touches à gérer | État à garder synchronisé |
|---|---|---|---|
| **Disclosure** (afficher/masquer) | `button` + région contrôlée | `Enter`, `Space` | `aria-expanded` sur le bouton, `aria-controls` → id de la région |
| **Accordéon** | `button` dans un titre, par panneau | `Enter`/`Space` ; `↑`/`↓` entre les en-têtes (facultatif) | `aria-expanded` par en-tête |
| **Onglets** | `tablist` > `tab`, plus `tabpanel` | `←`/`→` (ou `↑`/`↓` si vertical) passent d’un onglet à l’autre, `Home`/`End` ; `Tab` quitte la tablist | `aria-selected` sur l’onglet actif, `aria-controls` → panneau, `tabindex` itinérant |
| **Menu / barre de menus** | `menu`/`menubar` > `menuitem` | `↑`/`↓` à l’intérieur, `←`/`→` le long d’une barre de menus, `Enter` active, `Esc` ferme et rend le focus, `Home`/`End` | `aria-expanded` sur le déclencheur, `tabindex` itinérant |
| **Listbox** | `listbox` > `option` | `↑`/`↓`, `Home`/`End`, saisie anticipée ; `Space` bascule en sélection multiple | `aria-selected` par option, `aria-multiselectable` |
| **Combobox** | `combobox` + `listbox` en popup | `↓` ouvre et entre dans la liste, `Esc` ferme, `Enter` valide, `Alt+↓`/`Alt+↑` | `aria-expanded`, `aria-controls`, `aria-activedescendant` → l’option qui a le focus |
| **Dialogue / modale** | `dialog` (+ `aria-modal="true"`) | `Esc` ferme ; `Tab` circule À L’INTÉRIEUR du dialogue | Un nom (`aria-label`/`aria-labelledby`) ; arrière-plan rendu `inert` |
| **Infobulle** | `tooltip` | `Esc` la ferme sans déplacer le focus | `aria-describedby` sur le déclencheur ; affichée au focus ET au survol |
| **Arborescence** | `tree` > `treeitem` (+ `group`) | `↑`/`↓` entre les nœuds visibles, `→` déplie, `←` replie/remonte au parent | `aria-expanded` par branche, `aria-selected`, `tabindex` itinérant |
| **Curseur** | `slider` | `←`/`→`/`↑`/`↓` par pas, `Home`/`End`, `PageUp`/`PageDown` | `aria-valuenow`/`valuemin`/`valuemax`, `aria-valuetext` quand le nombre a besoin de mots |
| **Grille / grille de données** | `grid` > `row` > `gridcell` | Les flèches déplacent de cellule en cellule, `Home`/`End` par ligne, `Ctrl+Home`/`Ctrl+End` | `aria-rowcount`/`colcount` en cas de virtualisation, `aria-sort` sur les en-têtes triables |
| **Carrousel** | groupe de diapositives + contrôles | Contrôles atteignables avec `Tab` ; un contrôle de pause quand il défile automatiquement (2.2.2) | `aria-live="off"` pendant le défilement automatique, `polite` une fois en pause |

Le **tabindex itinérant** (roving tabindex) signifie qu’exactement un élément du widget est en
`tabindex="0"` et que les autres sont en `tabindex="-1"` ; les flèches déplacent à la fois le
focus du DOM et ce `0`. C’est ce qui fait d’un menu de 30 éléments un seul arrêt de `Tab` au
lieu de trente. L’alternative — `aria-activedescendant` — garde le focus du DOM sur le
conteneur et désigne l’enfant actif par son id ; utilisez-la pour combobox/listbox, où le
focus doit rester dans le champ de saisie.

## Recettes de gestion du focus

```js
// Dialog: move focus IN, trap it, and give it back on close.
function openDialog(dialog, trigger) {
  dialog.dataset.returnTo = trigger.id;            // remember who opened it
  document.getElementById('app').inert = true;      // everything behind is unreachable
  dialog.hidden = false;
  // First focusable, or the dialog itself (tabindex="-1") when it has none.
  (dialog.querySelector('[autofocus]') ?? dialog).focus();
}
function closeDialog(dialog) {
  document.getElementById('app').inert = false;
  dialog.hidden = true;
  document.getElementById(dialog.dataset.returnTo)?.focus();  // 2.4.3: focus never vanishes
}
```

`inert` est le bon outil pour « tout ce qui est derrière la modale » : il retire le sous-arbre
de l’ordre de focus ET de l’arbre d’accessibilité en un seul attribut. Masquer l’arrière-plan
avec `aria-hidden="true"` seul le laisse atteignable à la tabulation — précisément le défaut
que signale `aria-hidden-focusable`. Le `<dialog>.showModal()` natif fait tout cela pour vous.

**Ne laissez jamais le focus nulle part.** Supprimer l’élément qui a le focus (fermer un
panneau, supprimer une ligne) fait retomber le focus sur `<body>` et l’utilisateur perd sa
place. Déplacez le focus délibérément : vers la ligne suivante, ou vers le conteneur avec
`tabindex="-1"`.

## Changements de route en SPA — la classe de défauts qu’aucune règle statique ne voit

Une navigation côté client remplace le contenu sans chargement de page. Rien n’est annoncé,
le focus reste où il était, et le titre décrit encore la page précédente.

```js
router.afterEach((to) => {
  document.title = `${to.meta.title} — Acme`;        // 2.4.2, on every route
  const h1 = document.querySelector('main h1');
  if (h1) { h1.tabIndex = -1; h1.focus(); }          // 2.4.3, focus enters the new content
  announce(`${to.meta.title} loaded`);                // 4.1.3, for those who did not follow focus
});
```

Ne donnez pas le focus à `<body>` (n’annonce rien) et ne faites pas défiler sans déplacer le
focus (les utilisateurs voyants au clavier finissent par saisir dans l’ancienne page).

## Régions live — 4.1.3 Messages d’état

```html
<!-- Present in the DOM from the start, EMPTY. A region created together with its -->
<!-- content is not announced: the observer has nothing to observe.               -->
<div id="status" role="status" aria-live="polite" aria-atomic="true"></div>
<div id="errors" role="alert"></div>   <!-- assertive: interrupts, for blocking errors only -->
```

| Situation | Niveau de politesse |
|---|---|
| Nombre de résultats de recherche, « Enregistré », progression | `role="status"` / `aria-live="polite"` |
| Envoi de formulaire bloqué, session qui expire | `role="alert"` (implique assertive) |
| Un message qui prend aussi le focus (un dialogue) | Pas de région live — le focus l’annonce déjà |

Échecs courants : une région injectée avec son texte dans le même tick ; `aria-live` sur un
conteneur qui est remplacé en bloc plutôt que mis à jour ; `assertive` partout, ce qui
apprend aux utilisateurs à l’ignorer. Règles du moteur : `live-region-conflict`,
`status-message-not-assertive`.

## Arbitrer un widget

1. **Lisez le composant entier**, pas la ligne signalée — gestionnaires, effets, état.
2. Vérifiez le **rôle** au regard du tableau ci-dessus : correspond-il au comportement réel ?
3. Vérifiez le **contrat clavier**, touche par touche. Un `Esc` manquant est un vrai échec
   au 2.1.1.
4. Vérifiez la **synchronisation de l’état** : `aria-expanded` change-t-il quand le panneau
   s’ouvre, à chaque fois ?
5. Vérifiez le **focus** : où va-t-il à l’ouverture, à la fermeture, à la suppression ?
6. Ce qui nécessite la page rendue (focus visible, taille de cible) part vers `scan` — voir
   `references/dynamic.md`. Consignez chaque verdict ; ne laissez jamais un critère au vert
   en silence.

# Structure — titres, régions, listes, tableaux

1.3.1 est le critère qui échoue le plus souvent dans les audits réels, parce qu’il couvre tout
ce qu’un utilisateur voyant lit à partir de la seule mise en page. Le test est toujours le même :
**la relation que je vois est-elle aussi déterminable par programmation ?**

## Titres

Les titres sont la principale aide à la navigation pour les utilisateurs de lecteurs d’écran —
la plupart sautent de l’un à l’autre plutôt que de lire de façon linéaire. Jugez le PLAN, pas le
style.

```html
<h1>Quarterly report</h1>
  <h2>Revenue</h2>
    <h3>Europe</h3>
    <h3>Asia</h3>
  <h2>Costs</h2>
```

- Ne sautez jamais de niveau en descendant (`h2` → `h4`). Remonter ne pose pas de problème
  (`h3` → `h2`).
- Stylez avec le CSS, pas en choisissant un niveau. Un « petit titre » reste un `h2` s’il ouvre
  une section de deuxième niveau.
- Un `<div class="title">` stylé visuellement n’est pas un titre. Soit balisez-le, soit acceptez
  qu’il ne fasse pas partie du plan.
- Un seul `<h1>` par page est une convention, pas une règle — le moteur le signale comme une
  recommandation, jamais comme une non-conformité.

Règles du moteur : `heading-order-skip`, `empty-heading` ; `h1-missing`/`h1-multiple`
(indicatives). À vous : savoir si chaque titre **décrit** réellement sa section (2.4.6).

## Régions

```html
<header>            <!-- banner -->
  <nav aria-label="Main">…</nav>
</header>
<main id="content"> <!-- exactly one per page -->
  …
</main>
<aside aria-label="Related articles">…</aside>  <!-- complementary -->
<footer>…</footer>  <!-- contentinfo -->
```

- Tout contenu doit se trouver à l’intérieur d’une région ; un texte échoué entre elles est
  inatteignable par la navigation par régions.
- Nommez les régions répétées : deux `<nav>` ont besoin d’un `aria-label` pour être
  distinguées. Un seul `<nav>` n’a pas besoin d’intitulé — « Navigation navigation » est ce que
  produit un intitulé redondant.
- `<main>` est la cible du lien d’évitement, et a besoin de `tabindex="-1"` pour accepter le
  focus.

Règles du moteur : `missing-main-landmark`, `multiple-main-landmark`, `nav-landmark-missing`,
`nav-landmark-unnamed`, `skip-link-target-missing`.

## Listes

```html
<ul>                       <!-- unordered: order carries no meaning -->
  <li>Coffee</li>
</ul>
<ol>                       <!-- ordered: steps, rankings -->
  <li>Preheat the oven</li>
</ol>
<dl>                       <!-- name/value pairs: glossary, spec sheet, recap screens -->
  <dt>Weight</dt><dd>1.2 kg</dd>
  <div><dt>Colour</dt><dd>Black</dd></div>   <!-- a grouping <div> is allowed -->
</dl>
```

Les lecteurs d’écran annoncent « liste, 5 éléments » — ce nombre est l’information. Une suite de
`<div>` séparés par des `<br>` n’annonce rien. Seuls des `<li>` (et `<script>`/`<template>`)
peuvent être enfants directs de `<ul>`/`<ol>` ; seuls des `<dt>`/`<dd>` (éventuellement
enveloppés dans un `<div>`) peuvent l’être de `<dl>`.

**Le motif de l’écran récapitulatif** est celui qui est le plus souvent raté : un résumé « Vos
informations » construit à partir de paires `<div class="label">` / `<div class="value">` ne
transmet la relation que visuellement. Utilisez `<dl>`, ou associez la paire par programmation.
Règles du moteur : `list-structure`, `dl-structure`.

## Tableaux

Un tableau sert aux **données**. En utiliser un pour la mise en page n’est pas un échec en soi,
mais il doit alors être marqué `role="presentation"` et ne porter aucun balisage de données.

```html
<table>
  <caption>Rainfall by city, 2025</caption>   <!-- the table's accessible name -->
  <thead>
    <tr><th scope="col">City</th><th scope="col">January</th></tr>
  </thead>
  <tbody>
    <tr><th scope="row">Paris</th><td>52 mm</td></tr>
  </tbody>
</table>
```

- `scope` prend exactement `col`, `row`, `colgroup`, `rowgroup`. `scope="column"` est invalide
  et ne fait silencieusement rien (règle du moteur : `scope-value-invalid` est une lacune
  déclarée — vérifiez-le à l’œil jusqu’à ce qu’elle soit livrée).
- `<caption>` est le nom ; gardez-le COURT. Une longue explication a sa place dans un paragraphe
  associé via `aria-describedby`, pas dans la légende (RGAA 5.5).

**Les tableaux complexes** — en-têtes irréguliers, fusions de cellules, deux lignes d’en-tête —
demandent un câblage explicite, puisque `scope` ne peut plus exprimer la relation :

```html
<table>
  <caption>Opening hours</caption>
  <tr><td></td><th id="morning">Morning</th><th id="afternoon">Afternoon</th></tr>
  <tr><th id="mon">Monday</th>
      <td headers="mon morning">9–12</td>
      <td headers="mon afternoon">14–18</td></tr>
</table>
```

Chaque id de `headers` doit désigner une cellule d’en-tête **du même tableau** (règle du
moteur : `headers-attr-dangling`), et un en-tête qu’aucune cellule ne référence n’est l’en-tête
de rien (`th-no-data-cells`). Mélanger `scope` et `headers` dans un même tableau, c’est là que
les associations se perdent sans bruit — choisissez l’un des deux.

`colspan`/`rowspan` conviennent dans un tableau simple ; dès qu’ils rendent la structure des
en-têtes irrégulière, passez à `headers`/`id`. Règles du moteur : `data-table-no-headers`,
`table-caption-missing`, `layout-table-data-markup`, `sortable-header-no-aria-sort`.

## 1.3.2 Ordre séquentiel logique

L’ordre du DOM est l’ordre de lecture. Le CSS qui réordonne visuellement le contenu
(`order`, `flex-direction: row-reverse`, `position: absolute`, `grid-area`) fait diverger les
deux, et la divergence devient un échec lorsqu’elle change le sens.

Test : lisez le DOM de haut en bas. La séquence a-t-elle encore un sens ? Une barre latérale
déclarée entre deux paragraphes d’un article sera lue au milieu de l’article.

## Ce que le moteur tranche, et ce qui reste à vous

| Décidé par le moteur | À vous d’arbitrer |
|---|---|
| Sauts de niveau de titre, titres vides, listes et listes de description mal formées | Si un titre **décrit** sa section (2.4.6) |
| `<main>` manquant/en double, `<nav>` répétés sans nom, cible de lien d’évitement cassée | Si chaque zone de contenu se trouve dans une région |
| Tableau de données sans en-têtes, sans légende, `headers` pendants, `<th>` non référencés | Si un tableau est un tableau de données ou de mise en page, d’abord |
| — | Si une relation visuelle (écrans récapitulatifs, colonnes) existe par programmation (1.3.1) |
| — | Si l’ordre du DOM préserve le sens (1.3.2) |

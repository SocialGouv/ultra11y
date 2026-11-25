# Pièges connus de faux positifs — ce qu’il faut examiner avant de se fier à un constat

Le moteur statique lit la SOURCE, pas le DOM rendu. Sur du code à base de composants, cela crée
quelques classes prévisibles de faux positifs (FP). Le moteur **supprime désormais
automatiquement** la plupart d’entre eux ; cette page vous indique (à vous, l’agent) où il ne peut
toujours pas être sûr, afin que vous puissiez **confirmer ou réfuter** au lieu de faire
aveuglément confiance. Lancez la boucle de contre-vérification :
`verify --report <md> [--semantic]` → tranchez chaque élément au regard du `file:line` cité →
`verify --apply <verdicts.json>` (les entrées refuted/unsupported font échouer le garde-fou).

## Comment le moteur vous protège déjà

- **Les composants sont ignorés.** Une balise en PascalCase (`<Button>`, `<HistoryEntry>`) garde
  sa casse en JSX **et** dans les `.vue/.svelte/.astro` (analysés en conservant la casse). Les
  règles par fichier ne se déclenchent que sur les balises HTML intrinsèques, donc un composant
  enfant de `<ul>`, un `<Select>` ou une prop `role` sur `<UChatMessage>` n’est plus signalé à
  tort.
- **Le contenu injecté n’est pas « vide ».** Un `<slot>`, `{@render children()}`, `{children}`
  ou un composant enfant signifie que le nom/le contenu/les options peuvent être fournis à
  l’exécution — `empty-heading`, `button-empty-name`, `link-empty-name`, `select-has-option`,
  `list-structure`, `data-table-no-headers` et `h1-missing` renoncent tous au lieu d’affirmer.
- **Les liaisons/valeurs dynamiques comptent comme présentes, jamais comme invalides.**
  `:aria-label`, `v-bind:aria-label`, `bind:value`, `:alt`, `:scope` (Vue/Svelte/Alpine) sont lus
  comme « présent, valeur inconnue » ; un `role={…}` dynamique est ignoré (pas analysé comme un
  rôle bidon) ; une propagation `v-bind="…"` / `{...rest}` / `{shorthand}` supprime les
  nom/étiquette/alternative manquants.
- **Les références inter-fichiers se résolvent sous `--graph`.** Une cible
  `aria-controls`/`for`/de titre définie dans un autre fichier (y compris un
  `const X = "id"; id={X}`) est prouvée exister et le constat est supprimé ; un composant composé
  uniquement d’une icône dont la définition fournit son propre `aria-label` n’est pas signalé
  « sans nom ». **Lancez toujours le code de composants avec `--graph`.**
- **Les branches conditionnelles et les composants intercalés ne sont pas traversés.** Des titres
  situés dans des bras différents de `{cond ? … : …}` s’excluent mutuellement, et un composant
  enfant entre deux titres peut en injecter un intermédiaire — donc `heading-order-skip` ne
  compare pas à travers eux.
- **Les gabarits d’enveloppe des frameworks sont reconnus.** Une enveloppe de montage de SPA
  (`<div id="app"></div>`) ou un espace réservé de build (`%sveltekit.body%`/`%sveltekit.head%`,
  `{{ }}`, `<%= %>`) signifie que le vrai contenu/titre est injecté plus tard —
  `h1-missing`/`title-missing-empty` ne se déclenchent pas.
- **Le contenu requis projeté par un slot n’est pas « manquant ».** Un passe-plat
  `<slot>`/`{@render children()}` supprime `fieldset-legend-missing` et `aria-required-children` ;
  un `<th>` dans un `<thead>` porte une portée de colonne implicite.
- **Le balisage de test/story est hors périmètre par défaut.** `*.test.*`, `*.spec.*`,
  `*.stories.*` et `__tests__/` sont exclus (fixtures mauvaises à dessein). Réincluez-les avec
  `--no-default-excludes` ou en nommant le fichier.

## Là où l’agent IA doit encore arbitrer

Un `preliminary: true` sur un constat (dans `--json`) et une réserve `scope.sourceTemplate` /
`scope.rendered` dans le rapport signifient que **le verdict est provisoire** — l’agent IA le
confirme au regard de la sortie rendue (les critères de rendu vont vers `scan`), et consigne un
verdict dans un sens comme dans l’autre.

| Règle / situation | Pourquoi elle peut encore se tromper | Comment confirmer ou réfuter |
|---|---|---|
| Tout constat sur une SOURCE `.vue/.svelte/.astro` | Slots, snippets, `{#if}`, `v-for`, logique scopée et provide/inject sont invisibles pour le parseur de gabarits | Auditez le HTML **rendu** (sortie Storybook/build) ou faites un `scan` d’une page en ligne ; réfutez le constat sur la source si le DOM rendu est conforme |
| Tout constat sur du JSX rendu par une bibliothèque (DSFR/MUI…) | Le HTML produit par le composant vit dans `node_modules` | `render` → build/SSR → `audit` de la sortie, ou `scan` |
| `control-label-missing` dans un SFC | L’étiquette peut être reliée via provide/inject ou un composant `<Label>` voisin que le parseur ne sait pas lier | Lisez le composant de formulaire + son wrapper de champ ; réfutez si une étiquette programmatique existe au rendu |
| `heading-order-skip` via `{#if}`/`v-if` dans les SFC (pas d’AST) | Les conditions des SFC sont du texte opaque, donc les bras ne peuvent pas être séparés comme en JSX | Raisonnez sur chaque chemin de rendu ; ne signalez qu’un saut qui se produit dans un seul chemin |
| `contrast` (1.4.3), focus, zoom, redistribution | Nécessite les styles calculés | `scan` (niveau navigateur) — ne tranchez jamais à partir de la source |
| `aria-*` qui référence un id construit à l’exécution (`id={`\`x-${i}\``}`) | L’id est dynamique ; la résolution inter-fichiers ne gère que les ids de type chaîne `const` | Lisez le composant ; réfutez si l’id est généré et relié correctement |

## Faux positifs de normativité — un « problème » sans test normatif en échec

Un constat peut citer un élément réel sans pour autant être une **non-conformité**, parce
qu’aucun test du référentiel actif n’échoue réellement. Ce sont les corrections d’un auditeur
professionnel + de l’Ara officiel apportées à l’audit RGAA d’egapro réalisé par ultra11y
lui-même ; chacune est désormais traitée comme une **recommandation (non normative)** ou
supprimée purement et simplement — jamais comme une NC normative.

| Cas | Pourquoi ce n’est PAS une NC | Traitement actuel |
|---|---|---|
| Un **`<th>` vide** (cellule d’en-tête de mise en page/d’espacement) | Aucun test RGAA/WCAG ne dit que chaque `<th>` doit avoir un contenu ; une violation axe `empty-table-header` relevant uniquement des bonnes pratiques ne porte aucune étiquette `wcag*` | fusionnée comme **consultative**, rattachée à aucun critère comme NC |
| Un **lien de téléchargement** (`…report.pdf`) dont le texte n’indique pas le format/le poids | Bonne pratique (DSFR), mais aucun test normatif en échec sous 6.1/2.4.4 | la règle de pack RGAA `download-link-format` est **`advisory: true`** → « Recommandation (non normative) », ne fait jamais basculer le 6.1 |
| **Deux `<h1>`** sur une page / une page **qui commence à `<h2>`** | « un seul `<h1>` par page » n’est une règle ni en HTML, ni en accessibilité, ni en SEO ; aucun saut dans l’ordre des titres ne se produit | `h1-multiple` / `h1-missing` sont **consultatives** (pas de NC normative) |
| Une **infobulle en lorem ipsum** | Qualité du contenu (UX), pas accessibilité | n’émet **aucun constat** |

La distinction est la même que celle que vous appliquez dans la phase de jugement
(`references/judgment.md`) : une **NC a besoin d’un `normativeRef`** qui cite le test précis en
échec du référentiel actif ; une bonne pratique sans lui est une entrée de
`recommendations[]`, et une pure préoccupation UX n’est ni l’un ni l’autre. Quand vous arbitrez,
ne « promouvez » pas une recommandation en NC pour paraître exhaustif.

## La règle empirique

Le moteur soulève des **candidats confirmés**, jamais une conformité silencieuse. Quand un
constat est `preliminary`, ou porte sur une source de SFC/de bibliothèque, traitez-le selon le
principe « vérifier, ne pas faire confiance » : ouvrez le `file:line`, vérifiez si l’élément
manquant est injecté/rendu ailleurs, et consignez un verdict `supported`/`refuted` via
`verify --apply`. Un constat réfuté est abandonné — c’est le contrat anti-hallucination qui
fonctionne comme prévu.

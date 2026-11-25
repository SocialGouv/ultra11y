# Mettre les correctifs en place — `fix` (hybride, natif d’abord)

`fix` applique ce qui est **mécaniquement sûr**, prépare ce qui demande qu’un mot soit
renseigné, et **propose** ce qui relève du jugement — sans jamais inventer de contenu
(doctrine anti-hallucination). Par défaut, c’est un **dry-run** (diff) ; `--write` applique.

```
node scripts/ultra11y.mjs fix "src/**/*.html"            # dry-run: diff + list
node scripts/ultra11y.mjs fix "src/**/*.html" --write     # apply the safe fixes
node scripts/ultra11y.mjs fix --changed --write           # only the git diff
node scripts/ultra11y.mjs fix page.html --only positive-tabindex --write
```

## Trois classes de correctif

- **auto** — déterministe, sans jugement, écrit tel quel :
  `positive-tabindex` (→ `tabindex="0"`), `redundant-aria` (retire le `role` redondant),
  `meta-viewport-zoom-block` (retire le `user-scalable=no` / `maximum-scale` bloquant).
- **à compléter (placeholder)** — insère un attribut **valide** avec une sentinelle `TODO` que
  **vous** remplacez par une valeur pertinente, adaptée au contexte : `html-lang-missing`
  (`lang="TODO"`), `iframe-title-missing` (`title="TODO"`), `img-alt-missing` (`alt="TODO"` ou
  `aria-label="TODO"`), `control-label-missing` (`aria-label="TODO"`).
- **jugement (proposition)** — le moteur ne corrige jamais de lui-même : pertinence de l’alt
  (1.1.1), fonction du lien/bouton (2.4.4/4.1.2), contraste, structure des tableaux/fieldsets…
  l’agent IA rédige le contenu et arbitre le critère (`verify --manual`, sous garde-fou).

## Garanties

- **Édition par plage source** : les codemods relisent localement la balise ouvrante (le parseur
  ne fournit pas les positions des attributs) et appliquent les modifications **de la fin vers
  le début** ; les modifications qui se chevauchent sur un même élément sont abandonnées, jamais
  mal appliquées.
- **Garde-fou anti-régression** : après `--write`, le fichier est ré-audité ; si un correctif a
  **introduit** une nouvelle non-conformité, il n’est **pas** écrit.
- **JSX/TSX : codemods sûrs uniquement.** Les `.jsx`/`.tsx` sont analysés en un véritable AST
  dont les positions indexent le fichier d’origine, donc `fix --write` applique les codemods
  marqués **jsxSafe** (suppression d’attribut / insertion de props valides en React) — il ne
  réécrit jamais un nom d’attribut (`tabIndex={5}` n’est jamais transformé en `tabindex="0"`).
  Seul le rare repli **avec perte** (un fichier que le parseur AST n’a pas pu analyser du tout)
  reste en proposition uniquement.

## Ordre de correction (natif d’abord)

sémantique native → noms accessibles / intitulés → accès clavier → focus visible → information
non portée par la seule couleur → médias. Voir `references/authoring.md` et
`references/forbidden-patterns.md`. Après correction, ré-auditez ; l’agent IA arbitre les
critères de jugement (`verify --manual`, sous garde-fou) et les critères de rendu passent par
`scan` — jamais marqués conformes sans une justification enregistrée et passée au garde-fou.

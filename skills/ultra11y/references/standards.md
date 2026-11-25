# Le référentiel — RGAA 4.1.2, avec WCAG comme correspondance

ultra11y audite au regard du **RGAA 4.1.2**, le référentiel d’accessibilité de l’État français (13
thématiques, 106 critères, © DINUM, Licence Ouverte / Etalab 2.0). C’est le référentiel par
défaut et le seul : chaque rapport, grille, taux, ticket et PRD parle RGAA. `--standard rgaa` est
accepté pour les scripts qui le passent ; `--standard wcag` a été supprimé et sort avec le code 2.

## Modèle

- **Le RGAA est ce que voit le lecteur.** Chaque critère RGAA cite les critères de succès WCAG
  auxquels il correspond, et c’est le seul endroit où WCAG apparaît dans une sortie :
  « RGAA 1.1 (WCAG 1.1.1) ».
- **WCAG 2.2 AA est la tuyauterie interne.** Les règles du moteur sont indexées par critère de
  succès WCAG (55 critères de succès, niveaux A + AA, dérivés de la source du W3C),
  `adjudication.json` est indexé par WCAG, et `derivePackResults` projette ces résultats sur les
  critères RGAA avec la règle « NC l’emporte » et le périmètre `appliesTo` propre à chaque
  critère. Le JSON d’audit porte ce cœur sous `core`, là où aucun rendu ne regarde.
- **Les titres WCAG en français sont la traduction officielle AUTORISÉE du W3C**
  (https://www.w3.org/Translations/WCAG22-fr/, embarquée dans `scripts/vendor/wcag-2.2-fr.json`),
  si bien que même la correspondance cite une formulation normative, jamais une traduction
  automatique.
- **Les correspondances hors du cœur sont explicites.** Un critère RGAA dont la correspondance
  est entièrement hors du cœur AA est dérivé comme **hors du périmètre du moteur** — statut
  `manual` avec une justification dédiée, jamais un NA silencieux. Exemple livré : **RGAA 8.1**
  (doctype → le WCAG 4.1.1 supprimé).

## Consultation du référentiel

```
node scripts/ultra11y.mjs criteria --theme 1          # an RGAA thématique
node scripts/ultra11y.mjs criteria 8.3                # one RGAA criterion (shows its WCAG mapping)
node scripts/ultra11y.mjs criteria --glossary lien    # a term RGAA DEFINES (normative)
node scripts/ultra11y.mjs criteria 1.4.3              # a WCAG mapping target, with the RGAA criteria citing it
node scripts/ultra11y.mjs criteria --plan             # the work plan per evidence tier
```

`criteria --plan` donne, pour chaque niveau de preuve (source, inter-fichiers, page rendue,
navigateur, jugement, hors périmètre), le nombre de critères RGAA pour lesquels c’est le niveau
le moins coûteux pour prouver la conformité — lu depuis l’applicabilité des règles du moteur
lui-même, pas depuis la formulation. 104 critères sur 106 demandent plus que la source pour
obtenir C. `--json` donne le même plan sous forme de données.

## Vocabulaire de l’auditeur

Le **bloc auditeur** du `prd` et les **tickets** parlent avec les noms propres au RGAA :
Thématique, Critère, Test, Conforme (C), Non conforme (NC), Non applicable (NA), « Critère
d'accessibilité ». `--lang fr|en` choisit la locale ; la résolution se trouve dans
`src/standards/vocabulary.ts` et les termes RGAA sont définis dans
`scripts/build-pack-rgaa.mjs`.

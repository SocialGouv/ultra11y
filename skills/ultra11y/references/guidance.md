# Guide d’implémentation — règles concrètes avant/après rattachées aux critères

Un pack de référentiel dit *ce que* un critère exige ; le **guide** (guidance) dit *comment
l’implémenter*. C’est la couche des règles concrètes de mise en œuvre — les motifs de code
bon/mauvais RGAA de SocialGouv/etalab — indexée sur un critère du pack et sur les critères de
succès WCAG auxquels il correspond. Elle enrichit la sortie sans jamais changer le verdict.

## Où il apparaît

Le guide est recherché **au moment du rendu**, par critère / critère de succès WCAG, de sorte que
le JSON canonique d’`audit` reste intact (aucun changement de schéma, aucun nouveau constat). Il
apparaît dans :

- **`prd`** — chaque élément du backlog reçoit un exemple avant/après et une estimation de
  l’effort ; le PRD `--format doc` l’intègre aux user stories et aux critères d’acceptation.
- **le bloc auditeur** de `report`, `prd`, `tickets` et des fiches par page — l’exemple
  « Changement attendu ».

Comme le rattachement relève uniquement de la présentation, le guide ne marque jamais rien comme
conforme et n’invente jamais de non-conformité — c’est de l’illustration, pas de la détection.

## Forme du jeu de données

Un jeu de données de guide est du JSON : `{ pack, source, license, attribution, entries[] }`, où
chaque entrée est `{ id, criterionId, wcag[], title, summary, impact?, examples[], reference }`
et un exemple est `{ lang: "html"|"jsx"|"css", bad?, good?, note? }`. Deux sont livrés en
standard : `src/data/guidance/rgaa.json` (93 entrées, ids calqués sur les fichiers de règles de
SocialGouv) et `src/data/guidance/wcag.json` (l’ensemble indexé sur les WCAG, atteint par la
correspondance WCAG de chaque critère RGAA). Une liste `guidance` dans `.ultra11yrc.json` ajoute
un guide propre au projet ; le même garde-fou (`src/pack.ts`) valide que chaque entrée se résout
vers un vrai critère RGAA, correspond à des critères de succès WCAG reconnus, et que chaque
exemple s’analyse.

## Héritage — le guide via la correspondance WCAG

Chaque entrée déclare les critères de succès WCAG qu’elle met en œuvre, et une recherche parcourt
**chaque** jeu de données enregistré. Ainsi, un critère RGAA sans entrée RGAA propre reçoit tout
de même des exemples, via les critères WCAG auxquels il correspond.

Ordre de résolution (le premier l’emporte, dédoublonné par id d’entrée) :

1. l’entrée RGAA de ce critère → `via: "pack"`, `inherited: false`
2. chaque entrée indexée sur chacun des critères de succès WCAG auxquels le critère correspond,
   dans l’ordre des critères de succès propre au pack →
   `via: "wcag:<sc>"`, `inherited: true`

**Le marquage est l’essentiel.** Un exemple hérité n’est pas la doctrine propre du référentiel
national, et un rapport qui le présenterait comme tel avancerait une affirmation que personne n’a
écrite. Chaque surface porte `inherited` / `via`, et chaque entrée porte aussi
`languagesAvailable` — le jeu de données RGAA est d’abord en français, donc un appelant
anglophone doit être averti quand une entrée n’a pas de texte anglais, plutôt que de recevoir du
français en silence.

`src/data/guidance/wcag.json` couvre **les 55 critères de succès AA**, de sorte qu’aucun critère
n’est privé d’un guide accessible, quel que soit le pack — y compris les dix que le RGAA 4.1.2 n’a
jamais couverts, dont six ajoutés dans les WCAG 2.2 après le gel du RGAA (`wcagVersion: 2.1`).

**Il est généré, jamais écrit à la main** — `scripts/build-guidance-wcag.mjs`, à partir des
documents propres du W3C :

| Champ | Provient de |
|---|---|
| quelles techniques s’appliquent | `understanding/understanding.11tydata.js`, la table d’association lisible par machine du W3C |
| `summary` | le bloc "In brief" du document Understanding (Goal / What to do / Why), mot pour mot |
| `good` | le premier exemple de code HTML ou CSS d’une **technique suffisante** |
| `bad` | le premier d’un **échec** documenté |
| `note` | le titre et l’id propres de la technique, pour qu’un lecteur puisse remonter l’exemple à sa source |

La sélection suit une règle uniforme, pas un choix par critère : les technologies sont prises
dans un ordre fixe (html, css, aria, script, general) et, au sein d’une technologie, c’est l’ordre
de la liste du W3C qui décide. Préférer le HTML compte — pour le 1.1.1, la première technique
listée avec un exemple est ARIA6, dont l’exemple est un repère de navigation ; le `alt=""` de H2
sur un lien image illustre réellement une alternative textuelle.

Deux conséquences à connaître :

- **15 critères portent un résumé et aucun exemple de code.** 2.4.5 Accès multiples et 2.5.7
  Mouvements de glissement relèvent de la structure du site et du comportement, que le W3C
  documente en prose. Un extrait inventé à cet endroit se lirait comme un guide faisant autorité
  que personne n’a écrit.
- **Le résumé est uniquement en anglais.** Les titres sont bilingues (la traduction française
  autorisée les couvre) mais les documents Understanding ne sont pas traduits, et
  `languagesAvailable` le dit plutôt que de livrer une version française que personne n’a
  autorisée.

`pnpm run check:guidance:wcag` échoue si le jeu de données commité ne se reproduit pas à partir de
l’instantané vendorisé, et le workflow quotidien `standards-refresh` récupère à nouveau la source
du W3C, de sorte qu’il ne peut pas diverger des techniques qu’il prétend reproduire.

## Règle d’honnêteté — le guide n’est PAS un détecteur gratuit

Un motif ne mérite un **détecteur du cœur WCAG** que s’il est à la fois décidable statiquement
**et** correspond à un critère de succès présent dans le cœur **AA** des WCAG 2.2. Tout le reste
vit ici comme guide (et, quand le référentiel national le couvre, dans le pack), jamais comme un
« conforme » silencieux.

L’exemple phare : **l’ouverture d’une nouvelle fenêtre** (`target="_blank"` sans avertissement).
Son seul rattachement WCAG propre est le **3.2.5 Changement à la demande — qui est AAA, absent du
cœur AA** (le jeu de données saute de 3.2.4 à 3.2.6). ultra11y ne livre donc **pas** de détecteur
du cœur WCAG pour ce cas — aucune règle statique ne signale `target="_blank"`, quel que soit le
référentiel. Il est livré comme guide RGAA (critère 13.2 → WCAG 3.2.1) : consultez-le avec
`criteria 13.2`, et il se rattache à l’entrée `prd`/`report` concernée — il n’est jamais soulevé
comme non-conformité d’audit, et jamais rattaché de force à un mauvais critère AA. (`--standard`
est un flag de `report`/`prd`/`criteria`, pas d’`audit`.) Les règles qui dépendent du jugement et
du rendu (pertinence de l’alternative, contraste calculé, ordre de lecture) restent du guide
+ risque résiduel pour la même raison.

## Attribution

RGAA 4.1.2 © DINUM — Licence Ouverte / Etalab 2.0. Les motifs d’implémentation avant/après sont
adaptés de SocialGouv/skills (`rgaa-html-css`) et de la méthode RGAA officielle ; le jeu de
données stocke de courts résumés dérivés + des exemples minimaux, pas de la prose reprise mot
pour mot (voir `NOTICE`). Lors de l’ingestion d’une autre source, consignez sa licence et son
attribution dans l’en-tête du jeu de données et dans `NOTICE` avant de redistribuer le moindre
texte.

---
name: review-a11y
description: "À utiliser pour la REVUE d’accessibilité d’un code frontend modifié : fichiers indexés (staged), diff de travail, branche ou pull request ; des demandes comme « revue a11y », « est-ce accessible ? » ou « quelque chose à corriger avant le merge ? » ('review a11y', 'is this accessible?', 'anything to fix before merge?') ; et les constats d’un hook ou de la CI sur un changement. Lance le moteur embarqué sans installation avec analyse JSX/TSX inter-fichiers, ne rend que les pages qu’atteint le diff (Playwright + axe, ne bloquant que sur les non-conformités nouvelles par rapport à la base), puis arbitre les candidats et renvoie une revue RGAA 4.1.2 classée par sévérité (par critère RGAA, le WCAG seulement comme correspondance) avec correctifs file:line, risques résiduels de rendu et un verdict. Utiliser plutôt `ultra11y` pour les audits du dépôt entier, les rapports de conformité datés, les backlogs PRD ou l’écriture de balisage accessible."
license: MIT
metadata:
  version: 9.6.3
---

# review-a11y — revue d’accessibilité du code modifié

Le pendant « revue » de la skill `ultra11y` : là où `ultra11y` produit des audits complets et
des livrables de conformité, **cette skill relit exactement le code en cours de changement** —
un diff, une branche, une PR — et rend compte comme un relecteur de code. Même répartition du
travail : le moteur déterministe et sans installation embarqué avec cette skill fait le travail
*mécanique* (non-conformités RGAA 4.1.2 vérifiables par la machine, chacune rattachée à un
critère RGAA, avec son `file:line` cité), et **l’agent IA** *arbitre ce qui relève du jugement* —
réfuter les faux positifs, décider statiquement à partir du code la pertinence des alternatives,
l’intitulé des liens et la logique de focus, et envoyer à `scan` ce qui demande un DOM rendu. Un
humain n’est tout au plus qu’une supervision facultative.

Une revue se fait en **deux passages** : le moteur statique sur le diff (§1), puis — quand le
changement a un déploiement à examiner — un rendu Playwright + axe de **seulement les pages
qu’atteint le diff**, comparé à la branche de base pour que seules les non-conformités
**nouvelles** bloquent (§1b). Ce second garde-fou est mécanique : aucun modèle n’intervient pour
décider de ce qui bloque.

**Résolution du moteur :** chaque commande ci-dessous est `node scripts/ultra11y.mjs …` où
`scripts/ultra11y.mjs` se trouve **à côté de ce SKILL.md** (le moteur est livré dans la skill ;
pas d’installation, pas de clé). Lancez-le avec le projet relu comme répertoire de travail. Dans
le dépôt ultra11y lui-même, le `scripts/ultra11y.mjs` de la racine du dépôt est le même fichier.
Résolvez ce chemin selon le harness :
- **Claude Code** : `${CLAUDE_SKILL_DIR}/scripts/ultra11y.mjs`.
- **Codex** : le répertoire de la skill installée — la copie du plugin, ou
  `~/.codex/skills/review-a11y/scripts/ultra11y.mjs` (sous `$CODEX_HOME` s’il est défini) après
  `ultra11y install --codex`.
- **OpenCode** : `~/.config/opencode/skills/review-a11y/scripts/ultra11y.mjs` (sous
  `$XDG_CONFIG_HOME` s’il est défini) après `ultra11y install --opencode`, ou le
  `skills/review-a11y/` du paquet npm quand le plugin est épinglé dans `opencode.json`.
- **Partout ailleurs**, ou quand aucun répertoire de skill ne se résout : `npx -y ultra11y <command>`
  est le même moteur.

Écarts propres à chaque harness : `references/harnesses.md` dans la skill `ultra11y`.

> **Règles fondamentales** (partagées avec `ultra11y`) :
> 1. **N’inventez jamais une non-conformité** : ne signalez que ce que le moteur a trouvé ou ce
>    que vous pouvez voir et citer dans le code relu.
> 2. **Relisez le changement, pas le monde entier** : les constats hors du périmètre relu sont
>    notés en une ligne au plus (« préexistant, hors périmètre »), jamais mêlés au verdict.
> 3. **Le reliquat est explicite, jamais conforme en silence** : les critères *de rendu*
>    (contraste, visibilité du focus, zoom/reflow, contenu au survol) sont nommés comme risques
>    résiduels pour les composants modifiés — jamais affirmés à partir du source, tranchés dans la
>    page rendue (`scan`). Les critères *de jugement* (pertinence des alternatives, intitulé des
>    liens, ordre de lecture), l’agent IA les arbitre à partir du code lui-même, en consignant une
>    raison — aucun statut sans un verdict justifié.
> 4. **Langue** : rédigez la revue dans la langue de la conversation, mais les jetons techniques
>    restent en anglais même dans une prose française — `aria-live` reste `aria-live` (jamais
>    « région live »), de même pour `tabindex`, `alt`, `role="alert"` et les noms de rôles de
>    landmarks.

## 1. Périmètre — relire ce qui a changé

Prenez le PREMIER cas qui s’applique (ne demandez que si c’est réellement ambigu) :

```
node scripts/ultra11y.mjs audit <files the user named> --jsx --json     # explicit files
node scripts/ultra11y.mjs audit --staged --graph --json                 # staged snapshot (pre-commit review)
node scripts/ultra11y.mjs audit --changed --graph --json                # working diff
node scripts/ultra11y.mjs audit --since origin/main --graph --json     # the whole branch (PR review) — use the repo's default branch
```

- Passez toujours `--graph` pour le JSX/TSX (vrai AST + règles inter-fichiers : composant icône
  seule utilisé sans nom, cible d’ancre définie dans un autre fichier…) ; il supprime aussi une
  catégorie de faux positifs propres à l’analyse fichier par fichier.
- Passez `--lang` correspondant à la conversation pour que les messages et les textes de
  remédiation du moteur soient dans la langue de la revue (sans lui, la CLI détecte
  automatiquement : `<html lang>` du dépôt → la locale par défaut du référentiel actif →
  français — un repli, pas un substitut).
- La revue du dépôt entier est un **audit**, pas une revue — proposez plutôt la skill `ultra11y`.
- Le balisage de tests/stories (`*.test.*`, `*.stories.*`, `__tests__/`) est exclu par défaut ;
  nommez explicitement un tel fichier pour l’inclure, ou passez `--no-default-excludes`.

## 1b. Rendre les pages que touche le changement (revue de branche / de PR)

Quand la branche a un déploiement (une préversion de PR, un `next start` local) **et** que la
branche de base en a un aussi (production, recette, ou la même application construite depuis la
base), ne rendez que les pages que le diff peut atteindre et ne bloquez que sur ce qui est
nouveau :

```
node scripts/ultra11y.mjs affected --since origin/main --json                       # which pages, and why (read-only)
node scripts/ultra11y.mjs scan --since origin/main --base-url <base deployment> --no-snapshot --json > base-scan.json
node scripts/ultra11y.mjs scan --since origin/main --base-url <PR deployment> --baseline base-scan.json --no-snapshot --json
```

- **Quelles pages** : `affected` remonte le graphe d’imports inversé depuis chaque fichier
  modifié depuis la merge-base (`<base>...HEAD`, plus les fichiers non commités et non suivis)
  jusqu’aux fichiers de route — dans un projet Next.js uniquement (un `next.config.*` ou `next`
  dans package.json), `app/**/page.*` et `pages/**` à la racine du routeur (ou sous `src/`) ; un
  `layout`/`template` (ou `_app`) sélectionne toutes les pages en dessous de lui — et jusqu’aux
  fichiers que déclarent les `sample.pages[].sources` de `.ultra11yrc.json`. Les routes
  dynamiques (`[id]`, `[...slug]`) se résolvent d’après l’inventaire des routes
  (`.ultra11y/routes.json`, issu de `pages discover --routes-only`) et l’échantillon. L’URL de
  base est à fournir par l’utilisateur (demandez-la quand elle est inconnue) ; les deux scans
  rendent les **mêmes chemins**, puisque la sélection dépend du diff, pas de l’hôte.
- **Ce qui bloque** : avec `--baseline`, `scan` ne sort avec le code 1 que sur les constats rendus
  que la baseline ne contient pas (identité = règle axe, critère, chemin de route, sélecteur —
  indépendante de l’hôte). Une page absente de la baseline est nouvelle, en totalité. Les
  constats consultatifs (bonnes pratiques) ne bloquent jamais. `--fail-on` resserre le garde-fou
  (par défaut : toute sévérité). Une page atteinte qui ne peut pas être rendue (erreur HTTP,
  redirection vers une connexion, plantage du navigateur) n’a rien mesuré et **bloque** aussi,
  sauf si le même chemin était déjà impossible à rendre dans la baseline. Les tableaux `gate.new`
  et `gate.notMeasured` de la sortie `--json` sont la liste bloquante ; `gate.known` /
  `gate.knownNotMeasured` comptent les constats préexistants (règle fondamentale 2 : une ligne,
  hors du verdict).
- **Ce qu’il ne peut pas voir** : un fichier modifié qui n’atteint aucune page est listé comme
  non rattaché, une route dynamique qu’aucune URL connue ne résout comme non résolue — nommez les
  deux dans le rapport comme **non rendus**, jamais comme propres. Aucun déploiement disponible →
  sautez le §1b et gardez les critères de rendu comme risques résiduels (règle fondamentale 3).

## 2. Juger — les constats du moteur sont des candidats, pas des verdicts

Pour chaque constat (`--json` donne le `criteriaId` / `criteriaIds` RGAA, sa correspondance
`wcag`, `severity`, `file:line`, `message`, `remediation`) :

- **Confirmez l’occurrence** : ouvrez la ligne citée ; l’élément fautif doit réellement s’y
  trouver dans le changement relu.
- **Constats `preliminary: true`** (source `.vue`/`.svelte`/`.astro`, composants de
  bibliothèque) : le parseur de gabarits ne voit ni les slots, ni les conditions, ni le câblage
  provide/inject. Confirmez-les sur le DOM rendu si des captures existent (`.ultra11y/captures`,
  issues du moteur de rendu de la skill `ultra11y`, `render`), sinon signalez-les comme
  **provisoires** avec cette réserve — ou réfutez-les avec des preuves tirées du code.
- **JSX rendu par une bibliothèque (DSFR, MUI…)** : une revue propre du source peut quand même
  livrer du HTML cassé (faux négatifs) — dites-le explicitement quand le changement touche de tels
  composants, et recommandez une vérification sur le DOM rendu (`scan`, ou la chaîne de capture
  d’`ultra11y`).
- **Les critères de jugement sont à arbitrer par l’agent IA** : pertinence du texte des
  alternatives, intitulé des liens en contexte, étiquette visible vs nom accessible, logique
  clavier/focus du composant modifié (lisez le source complet du composant, pas seulement la
  ligne signalée), en consignant une raison pour chaque décision.
- Réfuter un constat exige une **preuve citée** (le code qui le dément) ; écarter des constats en
  silence est interdit.

## 3. Rapport — une revue, pas un document de conformité

Rédigez dans la langue de la conversation (règle fondamentale 4), groupé par sévérité, chaque
constat nommé par son **critère RGAA** — le WCAG seulement comme correspondance discrète entre
parenthèses, « RGAA 11.1 (WCAG 3.3.2) », jamais seul :

```
## Accessibility review — <scope, e.g. branch feat/x vs main, 12 files>

### 🔴 Blocking
- `src/components/Form.tsx:42` — **RGAA 11.1** (WCAG 3.3.2) — input has no
  label and placeholder is its only hint → associate a real <label for>, keep the
  placeholder as an example only.

### 🟠 Major / 🟡 Minor
- …same shape…

### 🖥️ Rendered — new on the pages this change reaches (scan --baseline)
- `/contact` — **RGAA 3.2** (WCAG 1.4.3) — `.btn-primary` contrast 3.1:1 → … (new vs the
  base deployment)
- not rendered: `/actualites/[id]` (no known URL), `src/components/Orphan.tsx` (reaches no page)

### Residual risks (rendering-dependent — resolve in the rendered page via scan)
- contrast of the new button variants (RGAA 3.2), focus visibility on the custom menu (RGAA 10.7)

### Verdict
1 blocking, 2 major to fix before merge; 2 provisional SFC findings to confirm on the
rendered DOM; residual risks listed above.
```

- Gardez le texte `remediation` du moteur comme base de chaque correctif — il est déjà localisé
  et fondé sur le critère.
- Les problèmes préexistants repérés au passage tiennent en UNE ligne finale, hors du verdict.

**Exécution en tant que sous-agent.** Cette skill est souvent lancée plutôt que tapée : par le
hook du plugin sur un `git commit` / `git push` / `gh pr create` en attente, ou par la skill
`ultra11y` une fois que son audit a produit des correctifs. Dans ce cas, le rapport ci-dessus
**est** la valeur de retour — il devient un résultat d’outil pour l’appelant, pas un message à un
humain. Renvoyez-le donc en entier et rien d’autre : pas de préambule, pas de « j’ai lancé le
moteur et trouvé… », pas de proposition de corriger. Un appelant qui reçoit un résumé doit
deviner les constats, ce qui est précisément la seule chose que cette skill existe pour
empêcher. Tout ce qui figure au §4 reste à la demande et appartient à l’appelant, pas à vous.

## 4. Après la revue (à la demande)

- **Correctifs mécaniques sûrs** : `fix --staged --write --safe` (applique automatiquement les
  codemods sûrs aux fichiers indexés et les remet dans l’index) ou
  `node scripts/ultra11y.mjs fix <files> --write` ; dry-run sans `--write`.
- **Livrables formels** (rapport daté, blocs de conformité d’auditeur, backlog PRD, issues
  GitHub, la grille RGAA complète) : c’est la skill `ultra11y` — même moteur,
  mêmes constats (`report`, `prd`, garde-fous `check`/`verify`).
- **Rendre cela automatique** : installé comme **plugin Claude Code, Codex ou OpenCode**, un hook
  sur l’outil shell arrête un `git commit` / `git push` / `gh pr create` en attente qui porte des
  constats et les transmet — un refus `PreToolUse` sur Claude Code et Codex, un appel shell en
  échec portant les constats sur OpenCode — et c’est ce qui invoque cette skill sans que personne
  ne le demande. Il ne se déclenche jamais deux fois pour les
  mêmes constats, donc une nouvelle tentative passe. Pour un garde-fou qui n’a pas du tout besoin
  d’agent, le `init --hook` de la skill `ultra11y` installe un passage pre-commit mécanique de ce
  même audit de l’index.

## À ne pas faire

- Inventer une non-conformité que le moteur n’a pas trouvée et que vous ne pouvez pas citer.
- Affirmer le contraste/focus/zoom à partir du source — ce sont des risques résiduels tant qu’ils
  ne sont pas rendus (tranchez via `scan`).
- Bloquer sur un constat rendu que la baseline contient déjà, ou déclarer propre une page que la
  sélection n’a pas rendue.
- Mêler des problèmes préexistants du dépôt au verdict sur le changement.
- Traduire les jetons techniques dans une prose française (`aria-live`, jamais « région live »).

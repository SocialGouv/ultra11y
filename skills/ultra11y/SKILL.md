---
name: ultra11y
description: "À utiliser pour AUDITER un site, un dépôt ou une page selon le RGAA 4.1.2, le référentiel d’accessibilité de l’État, seul référentiel des rapports (le WCAG n’apparaît que comme la correspondance que cite chaque critère RGAA) ; produire un rapport de conformité daté, une grille par critère, un backlog PRD ou des tickets ; ÉCRIRE du balisage accessible ; corriger l’accessibilité ; ou brancher un garde-fou de dépôt et une chaîne de capture du DOM rendu. Le moteur embarqué, sans installation, exécute 103 vérifications statiques rattachées aux critères RGAA, tandis que l’agent arbitre les critères qui demandent un jugement et envoie les critères de rendu aux scans navigateur ; check/verify rejettent les non-conformités inventées et ne déclarent jamais conforme ce qui n’a pas été vérifié. Utiliser plutôt `review-a11y` pour une revue limitée à un diff, une branche ou une pull request."
license: MIT
metadata:
  version: 9.6.2
---

# ultra11y — auditer selon le RGAA 4.1.2 et écrire du balisage accessible

En accessibilité, un outil automatique ne voit qu’une partie du problème. `ultra11y` l’assume
par une **répartition du travail** : le moteur déterministe et sans installation
(`node scripts/ultra11y.mjs <command>` — pas de `npm install`, pas de clé ; le parseur JSX/TSX
est embarqué dans le bundle) fait le travail *mécanique* — détecter les non-conformités
vérifiables par la machine et rattacher chacune au bon **critère RGAA** — et **l’agent de code
actif** *arbitre lui-même les critères qui demandent un jugement* — pertinence des alternatives,
intitulé des liens en contexte, ordre de lecture — statiquement, à partir des preuves que le
moteur récolte (`verify --manual`), chaque verdict passant par le contrôle de `verify`/`check`.
Seuls les critères qui relèvent vraiment du **DOM rendu** (contraste calculé, focus visible,
zoom/reflow, contenu au survol) reviennent au niveau `scan` (axe-core dans un vrai navigateur) ;
un humain n’est tout au plus qu’une supervision facultative. Les garde-fous empêchent toute
non-conformité hallucinée de survivre, et rien n’est jamais « conforme » en silence.

**Lancer le moteur.** Chaque commande de cette skill et de ses références s’écrit
`node scripts/ultra11y.mjs …`, où `scripts/ultra11y.mjs` se trouve **à côté de ce SKILL.md**.
Lancez-le avec le projet audité comme répertoire de travail, et résolvez le chemin selon le
harness :

- **Claude Code** : `${CLAUDE_SKILL_DIR}/scripts/ultra11y.mjs`.
- **Codex** : le `scripts/ultra11y.mjs` du répertoire de la skill installée — la copie du
  plugin, ou `~/.codex/skills/ultra11y/scripts/ultra11y.mjs` (sous `$CODEX_HOME` s’il est
  défini) après `ultra11y install --codex`.
- **OpenCode** : le `scripts/ultra11y.mjs` du répertoire de la skill installée —
  `~/.config/opencode/skills/ultra11y/scripts/ultra11y.mjs` (sous `$XDG_CONFIG_HOME` s’il est
  défini) après `ultra11y install --opencode`, ou le `skills/ultra11y/` du paquet npm quand le
  plugin est épinglé dans `opencode.json`.
- **Partout ailleurs**, ou quand aucun répertoire de skill ne se résout : `npx -y ultra11y <command>`
  est le même moteur. Dans le dépôt ultra11y lui-même, le `scripts/ultra11y.mjs` racine est le
  même fichier.

Écarts propres à chaque harness (hooks, installation, manière dont arrive un blocage) :
`references/harnesses.md`.

**Ne confondez pas règles et critères.** Le bundle livre 103 vérifications statiques et le RGAA
compte 106 critères. Plusieurs règles peuvent servir de preuve à un même critère, une règle peut
contribuer à plusieurs critères, et la plupart des critères restent ouverts jusqu’à un scan ou
un arbitrage. La seule couverture honnête à l’échelle d’un run est le décompte de provenance
réel de la grille (`moteur + scan + agent`, plus tout reliquat indécidable nommé), jamais une
promesse figée comme « 48 critères agent ». Les résumés GitHub affichent donc `decided/total`,
pas un pourcentage calculé sur le petit sous-ensemble décidé.

**Le RGAA 4.1.2 est le seul référentiel.** Chaque commande et chaque sortie — `audit` compris,
constats inclus — parle RGAA : critères, thématiques, taux, tickets, PRD. Le WCAG 2.2 AA reste
la clé interne du moteur (chaque critère RGAA cite les critères WCAG auxquels il correspond) et
n’atteint un lecteur que sous la forme de cette correspondance discrète : « RGAA 1.1 (WCAG 1.1.1) ».
`--standard rgaa` est la valeur par défaut ; `--standard wcag` a été supprimé et sort avec le
code 2. Voir `references/standards.md`, et `references/guidance.md` pour les exemples concrets
de bonnes et de mauvaises implémentations.

**L’essentiel du travail vous revient.** Sur les 106 critères RGAA, **104** demandent plus que
le source — une page rendue (`scan`) ou une décision de jugement que l’agent arbitre — pour
obtenir C (`criteria --plan`). Un run propre du moteur est donc un point de départ, jamais un
verdict — et `references/adjudication.md` est la page à partir de laquelle vous travaillez
vraiment.

> **Règles fondamentales :**
> 1. **N’inventez jamais une non-conformité** : chaque `NC` cite un élément réel et résolvable (`check` le vérifie).
> 2. **HTML natif d’abord, ARIA en dernier** ; ne dupliquez jamais une sémantique implicite.
> 3. **N’inventez pas non plus une conformité** : un `C` se cite exactement comme un `NC` — il
>    nomme dans `citations[]` les preuves récoltées qu’il a validées, chaque ancre étant
>    résolvable et tirée des preuves effectivement montrées pour ce critère. Un critère présenté
>    *sans* preuve ne peut pas du tout être `C` ; il reste `manual`. Pas davantage un critère dont
>    la lecture était INCOMPLÈTE (`evidenceComplete: false`) : un critère dont on vous a montré une
>    partie peut encore échouer sur ce que vous avez vu, mais ne peut jamais être validé sur ce
>    que vous n’avez pas vu. Et un `C` arbitré n’est jamais fusionné avec un `C` décidé par le
>    moteur : les rapports le listent à part et le tiennent hors du taux de réussite automatique.
> 3b. **Ce qu’on vous montre est la population entière, dite une fois par chose distincte.** Les
>    preuves sont un représentant par CLASSE DE CONTENU, portant `occurrences`, les autres ancres
>    dans `alsoAt`, et les `pages` où il apparaît — 887 liens sur 38 pages capturées font 97
>    paires (texte, href) distinctes. Statuer sur le représentant, c’est statuer sur tous, et
>    c’est ce qui rend un `C` honnête atteignable ; une citation qui nomme N’IMPORTE QUELLE
>    occurrence d’une classe que porte le critère est acceptée, alors citez celle que vous avez
>    réellement ouverte. La page ne fait pas partie de la classe : le même en-tête sur vingt
>    pages est UNE classe, et le brief liste chacune de ses pages en `sur <id>:<ligne>`. Un
>    verdict de page cite l’occurrence de CETTE page (`.ultra11y/pages/<id>/dom.html` à cette
>    ligne) — le garde-fou refuse l’occurrence d’une autre page.
> 4. **Le reliquat est explicite, jamais conforme en silence** : l’agent IA *arbitre* lui-même
>    chaque critère *de jugement* (`verify --manual`, sous contrôle), et les critères *de rendu*
>    vont à `scan`. **Un scan propre ne conclut jamais `C`** : le contrat d’automatisation du RGAA marque ces règles comme preuves *candidates* (RGAA 3.2, 3.3, 10.4,
>    10.11, 10.12, 12.9…), si bien que le scan peut prouver une non-conformité mais que son
>    silence ne produit que des signaux, et le critère reste « à évaluer » pour que vous
>    l’arbitriez — ou que vous le déclariez indécidable, avec sa raison, quand son brief ne porte
>    aucune preuve citable (un `C` sans rien à citer est refusé). Tout critère encore non prouvé
>    reste « à évaluer manuellement » — aucun statut sans un verdict enregistré et justifié. Pour
>    en faire un garde-fou plutôt qu’un espoir, `check --in <audit.json> --require-decided` échoue
>    tant que quelque chose reste à évaluer, et `--allow-undecided <file>` prend les critères que
>    vous ne pouvez réellement pas décider, chacun avec sa raison (une liste nommée, jamais un
>    seuil). `--require-decided=pages` impose la même exigence à la grille propre de CHAQUE
>    page : un critère en échec sur une route est tranché pour le run et peut pourtant n’être le
>    verdict de personne sur les routes où il ne s’est jamais déclenché, et c’est précisément
>    là-dessus qu’un livrable par page est jugé.
>    **La liste de travail émise fait foi.** Elle peut contenir délibérément un critère dont le
>    statut à l’échelle du run est déjà `NC`, parce que cet échec n’a pas décidé le critère sur
>    les autres pages. Un tel élément n’est pas redondant : renvoyez pour lui un verdict fondé
>    (ou une raison `manual` explicite), ne le laissez jamais vide parce que le décompte global
>    semble décidé.
> 5. **Consultez le critère ; ne le citez jamais de mémoire.** `criteria <id>` renvoie
>    la formulation propre du critère, ses **tests numérotés** et leur méthodologie, et
>    `criteria --glossary <term>` les définitions que ces tests citent. Le RGAA 8.3 n’est pas « la
>    page a besoin d’un attribut `lang` » ; c’est le test `8.3.1` avec deux conditions
>    alternatives, et le glossaire décide du sens de ses termes. Un bloc d’auditeur qui cite
>    `8.3.1` après l’avoir lu est fondé ; un bloc qui le cite de mémoire est une supposition
>    déguisée en référence. Avant d’auditer, lancez le plan (`criteria --plan`) : il vous dit
>    combien de critères demandent plus que le source — un arbitrage, une page rendue ou un
>    navigateur — pour obtenir C : **104 sur 106**. Voir `references/standards.md`.
> 6. **Le HTML sémantique FINAL rendu doit être correct.** Le moteur ne voit que le source ; une
>    bibliothèque de composants (DSFR/MUI…) ou un SFC `.vue`/`.svelte`/`.astro` cache le vrai
>    balisage, donc un audit du source au vert n’est pas une preuve. Vérifiez le HTML sémantique
>    produit — lancez le moteur de rendu d’ultra11y (`render`), qui rend chaque composant, page et
>    story avec le react-dom/server du projet dans `.ultra11y/captures` (sans jamais lire ses
>    tests), `audit --require-captures` servant de garde-fou sur les angles morts. Voir
>    `references/rendered.md`.
> 7. **Langue** : passez TOUJOURS `--lang` correspondant à la langue de votre conversation avec
>    l’utilisateur ; demandez-lui en cas d’ambiguïté. Sans le flag, la CLI détecte
>    automatiquement (`<html lang>` du dépôt → la locale par défaut du référentiel actif →
>    français) — un repli pour les scripts et la CI, pas un substitut au fait de passer `--lang`
>    vous-même.
> 8. **Les jetons techniques restent en anglais, même dans une prose française.** Dans tout
>    livrable en français que vous écrivez (commentaire de rapport, PRD, tickets de suivi,
>    verdicts de jugement), les noms d’attributs, d’éléments et de rôles et leurs valeurs sont du
>    code, pas de la prose — ne les traduisez jamais : `aria-live` reste `aria-live` (jamais
>    « région live »), de même pour `tabindex`, `alt`, `role="alert"` et les noms de rôles de
>    landmarks. Le catalogue fr du moteur suit cette règle ; alignez-vous dessus. Le vocabulaire
>    normatif du référentiel (formulations RGAA comme « lien d'évitement ») garde son français
>    officiel.

## La bibliothèque de références

Le savoir du domaine d’abord, puis l’outillage. Lisez celle qui correspond à la question posée.

| Savoir en accessibilité | |
|---|---|
| `references/adjudication.md` | Critère RGAA par critère RGAA : les tests citables, les notes de décision et le protocole hérité des critères de succès WCAG rattachés — la règle de décision, quand NA est légitime, les questions |
| `references/naming.md` | Calcul du nom accessible, 2.5.3 étiquette dans le nom, CSS de masquage visuel, nommer les images/SVG/figures |
| `references/widgets.md` | Motifs composites de l’ARIA APG, contrats clavier, gestion du focus, changements de route en SPA, régions live |
| `references/forms-and-errors.md` | Étiquettes et instructions, la liste des jetons `autocomplete`, identification/suggestion/prévention des erreurs, saisie redondante, authentification accessible |
| `references/structure.md` | Titres, landmarks, listes et `dl`, tableaux simples et complexes, ordre logique |
| `references/media-and-motion.md` | Sous-titres/audiodescription/transcriptions, gestes de pointeur, taille des cibles, orientation, reflow, réduction des animations |
| `references/forbidden-patterns.md` | 15 anti-motifs : mauvais → pourquoi → correctif natif → critère |
| `references/focus-and-logic.md` | Les critères de focus/clavier qui vous reviennent, et comment raisonner dessus |
| `references/criteria.md` | La table de correspondance WCAG : la classe d’automatisabilité de chaque critère WCAG, les règles du moteur et les critères RGAA qui le citent (générée) |
| `references/rgaa-automation.md` | RGAA 4.1.2 : matrice générée de 106 critères / 258 tests, règles décisives, signaux candidats et politique du silence |
| `references/rgaa-review.md` | RGAA 4.1.2 critère par critère : ce pour quoi on peut se fier au moteur, ce qui a été corrigé par rapport aux grilles de référence, et les limites connues |
| `references/act.md` | Ce que le moteur, mesures à l’appui, détecte — et ce qu’il ne détecte manifestement pas (générée) |

| Utiliser l’outil | |
|---|---|
| `references/runbook.md` | **Le run fiable** : l’unique recette, le transport à utiliser et pourquoi, et ce que coûte un passage. À lire avant de payer un arbitrage |
| `references/full-audit.md` | **L’audit complet, sur chaque harness** : périmètre rendu, arbitrage (direct ou réparti), vérification contradictoire, registre, Markdown + HTML + preuves par page, garde-fous `check` |
| `references/audit.md` | L’audit rapide (passage statique → rapport → `check`), l’échantillon de pages normatif et les documents PDF |
| `references/judgment.md` | Les listes de travail d’arbitrage + de contre-vérification, le vocabulaire des verdicts, le repli fail-closed |
| `references/verify.md` | Les garde-fous `check`/`verify` |
| `references/false-positives.md` | Où un constat peut encore être faux, et comment le réfuter |
| `references/rendered.md` · `references/automation.md` | Auditer le HTML produit, captures, hooks et CI |
| `references/harnesses.md` | Où cela tourne : Claude Code, Codex CLI, OpenCode 1.x et 2.x, et le repli AGENTS.md |
| `references/orchestrators.md` | Piloter le moteur depuis un moteur de workflow / une CI non GitHub : épinglage, le pipeline en six étapes, codes de sortie, le jeu de tickets en JSON pour n’importe quel outil de suivi |
| `references/ci.md` | CI : lancer le bot `rgaa-audit` d’iterion ; le contrat de CLI sur lequel il s’appuie |
| `references/pages.md` | Instantanés de page + la grille des critères par page (`pages`), ses règles d’honnêteté, et `serve` (le site des résultats, son historique, son export statique) |
| `references/e2e.md` | `ultra11y/playwright` · `ultra11y/cypress` : auditer une page pendant votre run E2E |
| `references/dynamic.md` | Le niveau `scan` : runtimes, sondes, pages authentifiées |
| `references/journeys.md` | Les parcours que vous écrivez (`.ultra11y/journeys/`), rejoués par `journey run` avec axe et des vérifications clavier |
| `references/scale.md` | Cibler un audit sur un gros dépôt |
| `references/fix.md` · `references/correction.md` | Appliquer les correctifs, par priorité, sans régression |
| `references/prd.md` | Le bloc d’auditeur sous forme de backlog (markdown) |
| `references/tickets.md` | Déposer ce backlog en tickets : GitHub, GitLab, Jira, et à quelle granularité |
| `references/standards.md` · `references/guidance.md` | Le RGAA et sa correspondance WCAG, recommandations d’implémentation |
| `references/methodology.md` | Statuts, taux de réussite, sévérités, format du rapport |
| `references/cross-file.md` | `--graph` : imports et règles inter-fichiers |
| `references/orchestration.md` | Répartir les phases de jugement entre des sous-agents |

## Choisir selon la situation

- **"Audit complet / détaillé", "rapport de conformité", "audit RGAA"** — quel que soit le
  harness (Claude Code, Codex, OpenCode ou un autre) → la session active est l’auditeur :
  cadrer le périmètre, scanner, arbitrer (directement, ou en répartissant sur des sous-agents),
  contester ses propres affirmations, les verser au registre, puis publier le rapport Markdown
  daté, le HTML imprimable et les dossiers par page avec preuves, et passer les garde-fous
  `check` (`--require-decided=pages` compris). Lisez **`references/full-audit.md`** et terminez
  avec son jeu complet de livrables. **En cas de doute entre ce parcours et le parcours rapide,
  prenez celui-ci.** En CI, le même audit est le bot `rgaa-audit` d’iterion (branche plus bas).
- **"Audit rapide / premier aperçu / ce que trouve le moteur"** → `node scripts/ultra11y.mjs
  audit … --json`, puis `report` (tableau de synthèse + un **bloc de conformité d’auditeur** par
  critère NC — le même bloc qu’utilisent `prd` et `tickets`), puis `check` ; lisez
  **`references/audit.md`**. Ne l’utilisez que lorsque l’utilisateur veut explicitement un
  passage rapide ou purement statique : il n’a ni registre, ni contre-vérification, ni dossiers
  par page, ni garde-fou de complétude, alors dites-le et ne le présentez jamais comme un
  rapport de conformité.
- **"Code rendu par une bibliothèque (DSFR, MUI…) ou un SFC `.vue`/`.svelte`/`.astro` / éviter
  les faux négatifs"** → auditez le **HTML produit**, pas le gabarit source. Lancez `render` :
  le moteur d’ultra11y rend chaque composant, page et story avec le react-dom/server du projet
  lui-même dans `.ultra11y/captures` (ingéré automatiquement, constats attribués au composant
  source ; chaque unité qu’il n’a pas pu rendre est listée avec la raison ; `render --coverage`
  et `audit --require-captures` suivent les angles morts). Il ne lit jamais les tests ni les
  snapshots du projet. Ou bien `render --detect` (recette build→audit) puis `audit` sur la
  sortie, et `scan` pour le rendu calculé. Les constats sur source SFC sont marqués
  `preliminary` (une réserve `scope.sourceTemplate`) ; lisez **`references/rendered.md`**.
- **"Un constat semble faux / faux positif sur un composant"** → le moteur supprime
  automatiquement la plupart des faux positifs de composants (noms injectés par slot/prop,
  enfants de composants, liaisons dynamiques, titres conditionnels) et marque `preliminary` les
  constats sur source SFC/bibliothèque ; confirmez ou réfutez le reste avec `verify --apply` ;
  lisez **`references/false-positives.md`**.
- **"Gros dépôt / auditer intelligemment"** → ciblez : `--changed` (git diff), priorisation
  des gabarits, déduplication, `--max-files` ; lisez **`references/scale.md`**.
- **"Analyse inter-fichiers (arbre + dépendances), JSX/TSX comme un vrai AST"** →
  `audit --graph` résout les imports et applique les règles inter-fichiers (un composant
  icône seule utilisé sans nom, une cible d’ancre dans un autre fichier…), sans navigateur ;
  lisez **`references/cross-file.md`**.
- **"Générer le markdown des correctifs / les PRD"** → `prd` (le MÊME bloc de conformité
  d’auditeur que rend la section NC de `report` — thématique/critère/test/correspondance WCAG/
  constat/attendu/vérification dans le vocabulaire du RGAA — sous forme de backlog) ;
  `--split criterion`, `--format doc` pour un document d’exigences produit). Il n’écrit que du
  markdown ; lisez
  **`references/prd.md`**.
- **"Ouvrir des tickets / issues pour ça (GitHub · GitLab · Jira)"** → `tickets`, une commande
  distincte qui lit l’audit et le dépose, sans écrire de markdown. `--grain` choisit ce que
  représente un ticket : par critère (par défaut), par page, par page+critère, par fichier, ou
  un seul consolidé. La déduplication se fait sur le titre exact, donc relancer ne crée jamais de
  doublon. Toujours `--dry-run` d’abord ; lisez **`references/tickets.md`**.
- **"Arbitrer les critères de jugement (phase de jugement)"** → `verify --manual --in audit.json`
  émet une liste de travail d’ARBITRAGE (`ADJUDICATE.todo.json` + `ADJUDICATE.md`), un élément
  par critère résiduel, préchargé avec les preuves récoltées par le moteur (chaque alt, texte de
  lien + contexte, paires de couleurs littérales, étiquettes de contrôles, plan des titres, état
  ARIA, tabindex, langue des passages) ; l’agent IA remplit chaque `verdict` — `C`/`NA` (avec
  une `justification`), `NC` (avec un constat fondé), ou `manual` (avec une `reason`) — puis
  `verify --apply … --in audit.json` les réintègre en FAIL-CLOSED (en cas de doute, refuser) ;
  lisez **`references/judgment.md`**.
- **"Beaucoup d’éléments à arbitrer/vérifier (répartir le jugement sur des sous-agents)"** →
  `orchestrate --run <dir>` émet, à partir des listes de travail ACTUELLES du run, pour chaque
  phase prête un `<phase>.batches.json` + un prompt autonome par lot (pour les sous-agents de
  n’importe quel harness) + le workflow Claude Code rendu à partir d’eux + les contrats de
  dispatch `agents/<role>.md` + un `RUNBOOK.md` séquentiel — le chemin d’exécution par défaut
  sur un harness capable de lancer des sous-agents ; voir **Orchestration — router selon le
  harness** plus bas.
- **"Focus, clavier et logique d’interaction (la partie logique d’interaction)"** → le moteur
  marque l’ordre, la visibilité et le piégeage du focus ainsi que les critères au focus / à la
  saisie comme risques résiduels ; l’agent IA lit le source complet du composant et arbitre le
  comportement clavier/focus (le focus visible et les autres critères de rendu vont à `scan`) ;
  lisez **`references/focus-and-logic.md`**.
- **"Mettre les correctifs en place"** → `fix` (dry-run par défaut, `--write` applique les
  codemods sûrs et propose le reste sans rien inventer) ; lisez **`references/fix.md`**.
- **"Corriger par priorité, sans régression (phase de correction)"** → `fix` (`--write`,
  `--iterate`) + le backlog `prd`, bloquant→majeur→mineur ; lisez **`references/correction.md`**.
- **"Garde-fou automatique du dépôt (hook / CI)"** → `init --hook` écrit un garde-fou git
  pre-commit sur le **snapshot strict de l’index** (il audite exactement les blobs de l’index,
  applique automatiquement les correctifs sûrs et les remet dans l’index, ne bloque que sur les
  problèmes de jugement) ; la CI est le bot `rgaa-audit` d’iterion (plus bas).
  Installé comme **plugin Claude Code, Codex ou OpenCode**, un troisième garde-fou lance la
  *skill* `review-a11y` (pas seulement le moteur) sur un commit/push/PR en attente — celui-là est
  livré par le plugin (ou `ultra11y install`), pas par `init`. Pour le code de bibliothèque/SFC,
  commitez les **captures** rendues (`render`) et ajoutez-les à l’index pour que ce soit le vrai
  HTML sémantique qui soit vérifié (`audit --require-captures`) ; lisez
  **`references/automation.md`**.
- **"Vérifier une page pendant nos tests E2E"** → les exports de paquet `ultra11y/playwright` et
  `ultra11y/cypress` auditent la page **dans l’état où votre test l’a laissée** (session
  connectée, formulaire rempli, modale ouverte) — un état qu’un run `scan` séparé n’a pas — et
  enregistrent chaque page vérifiée comme instantané de page. `failOn` fait échouer le test ;
  `failOn: false` enregistre sans échouer, c’est ainsi qu’on l’adopte sur un backlog existant ;
  lisez **`references/e2e.md`**.
- **"Auditer la vraie PAGE, pas le composant"** → un **instantané de page**
  (`.ultra11y/pages/<id>/`) est le document rendu complet plus les signaux propres au navigateur
  (styles calculés, boîtes, arbre d’accessibilité, capture d’écran), ingéré automatiquement par
  `audit`. Comme c’est un document COMPLET, les règles à portée de page s’y appliquent — c’est là
  que le RGAA 8.3 (langue), 8.5/8.6 (titre) et 12.6 deviennent tout simplement décidables ;
  lisez **`references/pages.md`**.
- **"Décider les critères de rendu sans navigateur en CI"** → dès qu’un instantané de page
  existe, le **niveau rendu** tourne dans l’`audit` ordinaire : contraste sur styles calculés
  (RGAA 3.2/10.5), contraste mesuré sur la capture d’écran pour le texte sur un dégradé ou une
  image (l’angle mort du CSSOM que partage axe-core), et identification des liens par la seule
  couleur (**RGAA 10.6**, auparavant indécidable). Chacun laisse le critère `manual` quand il ne
  peut pas mesurer — jamais une supposition ; lisez **`references/pages.md`**.
- **"Donne-moi la grille RGAA, page par page"** → `pages --in audits/audit-latest.json` (aussi intégré à `report`) : une ligne par critère, une colonne par **URL** de page, reconstruite à
  partir du seul audit.json commité. Deux règles tiennent : un constat n’est attribué à une page
  que lorsque quelque chose le DIT (sinon il est signalé comme non attribué, jamais réparti), et
  un `C` par silence n’est obtenu que par une page dont le vrai DOM a été audité — une page
  source seule garde ses critères non décidés « à évaluer » ; lisez **`references/pages.md`**.
- **"Je veux un rapport PAR PAGE, pas une matrice"** → `pages --in audits/audit-latest.json
  --format report --split page --out audits` : un dossier par page —
  identité, sa capture d’écran, son taux, CHAQUE critère du référentiel avec son statut sur
  cette page, puis chaque non-conformité sous forme du bloc d’auditeur ordinaire. Rien n’est
  redécidé (la même projection que la grille) et aucun format n’est inventé (le même bloc
  d’auditeur que le rapport), donc une fiche de page et le rapport de conformité ne peuvent pas
  se contredire. `check` la contrôle contre les critères inventés comme tout autre rapport ;
  lisez **`references/pages.md`**.
- **"Quelles pages dois-je seulement auditer ?"** → `pages discover --crawl http://localhost:3000
  --propose --write` (ou `--sitemap <url>`, ou `--from-snapshots`) écrit un bloc `sample.pages`
  **déterministe** : les types de pages obligatoires reconnus par mot-clé sur les URL et titres
  triés, la page de recherche avec une requête fixe, puis une page par groupe de gabarits, dans la
  limite de `--sample-size` (20 par défaut). Le même site donne le même échantillon quel que soit
  le modèle qui le lance, donc **ne choisissez pas les pages vous-même : lancez la proposition et
  gardez-la.** Ne la modifiez qu’avec une raison enregistrée — une page que vous ajoutez porte sa
  raison dans `notes`, un type obligatoire que vous retirez reçoit
  `sample.absent: [{ "kind", "reason" }]` ; `sample check` signale un type retiré sans raison.
  Les auth/storageState/sources/notes déjà déclarés sont conservés. Ensuite `sample check`
  vérifie la couverture et `scan --sample` scanne l’échantillon et en prend les instantanés.
  Une SPA rendue côté client n’expose aucune route dans son HTML servi — utilisez-y un sitemap ;
  lisez **`references/dynamic.md`**.
- **"Auditer en CI" / "auditer ces URL page par page, en CI"** → ultra11y ne livre aucune
  intégration CI propre : lancez le **bot `rgaa-audit`** d’iterion
  (https://github.com/SocialGouv/iterion/tree/main/bots/rgaa-audit). Il installe ce moteur
  épinglé, rend l’échantillon de pages, arbitre et réfute avec des agents en lecture seule,
  contrôle avec `check` et ouvre une issue par critère non conforme. Lisez
  **`references/ci.md`**.
- **"Rends ce code accessible / relis-le"** → auditez l’extrait
  (`audit - < component.html`) en privilégiant le natif ; lisez **`references/authoring.md`** et
  **`references/forbidden-patterns.md`**.
- **"Que signifie le critère X"** → `criteria` (par ex. `criteria 8.3` ; un identifiant WCAG
  comme `criteria 1.4.3` affiche cette cible de correspondance) ; voir
  **`references/criteria.md`**.
- **"Quelle confiance accorder à une vérification / qu’est-ce que le moteur ne détecte PAS"** →
  le moteur est évalué sur le **corpus de tests W3C ACT-Rules** (~1 100 exemples tiers) : quelles
  vérifications sont cohérentes, où le rappel est partiel, quels écarts sont délibérés, et quelles
  règles décidables statiquement manquent encore — lisez **`references/act.md`**. Servez-vous-en
  pour calibrer quelle part d’un critère le moteur tranche réellement avant d’arbitrer.
- **"Audit RGAA"** → voir **`references/standards.md`** et
  **`references/methodology.md`**. **PROPOSEZ le scan par
  défaut** : un audit RGAA est défini normativement sur un **échantillon** de pages déclaré, et
  un rapport non scanné est marqué **partiel** — dites-le plutôt que de laisser entendre une
  couverture complète. Le workflow d’échantillon (`sample check`, `scan --sample`, `--merge`) se
  trouve dans **`references/audit.md`**.
- **"Audit à haut niveau d’assurance"** → `verify --report … --semantic` ; voir
  **`references/verify.md`**.
- **"Vérifier le contraste / le rendu (niveau dynamique)"** → `scan <url> --merge …` lance
  axe-core dans un navigateur headless et, sur le runtime local, sonde la visibilité du focus,
  le zoom à 200 %, l’espacement du texte et le contenu au survol, avec des interactions à état
  bornées et des pages authentifiées ; lisez **`references/dynamic.md`**.
- **"Fermer les critères revenus en `needs-rendered-dom`"** → il ne leur fallait pas un meilleur
  modèle, il leur fallait un navigateur. `scan` enregistre CE QU’IL A MESURÉ à côté de chaque
  instantané (`probes.json`, `axe.json`). **Un scan propre ne les ferme pas** : 3.2/3.3/10.4/10.11/10.12 ne portent que des règles de scan *candidates*, donc un scan
  propre les laisse « à évaluer » — le scan peut encore lever leurs non-conformités, et 10.1/12.8
  deviennent arbitrables à partir du DOM capturé. Statuez sur eux dans `verify --manual` ; là où
  un brief ne montre aucune preuve récoltée, un `C` est refusé, donc enregistrez `manual`
  (`undecidable`) avec la raison et listez-le sous `--allow-undecided`. `verify --manual`
  avertit avant que vous ne dépensiez un passage, `check --require-rendered` refuse, et le crawl
  est **non borné par défaut** (`--max 0` / `--depth 0`), annonçant chaque page qu’il atteint.
  Lisez **`references/dynamic.md`** et **`references/pages.md`**.

## Orchestration — router selon le harness

Les phases de jugement se répartissent : `ADJUDICATE.todo.json` (un élément par critère
résiduel) et `VERIFY.todo.json` (une entrée par affirmation mise à l’épreuve — chaque
non-conformité, et chaque `C`/`NA` de l’agent) sont des listes de travail indépendantes élément
par élément, et
`orchestrate --run <dir>` émet des lots neutres vis-à-vis du harness (un fichier de prompt par
lot, transmis tel quel à un sous-agent Claude Code, Codex ou OpenCode), le workflow Claude Code
rendu à partir d’eux, des contrats de dispatch par rôle et un RUNBOOK séquentiel, à partir des
listes de travail qui existent à ce moment-là. La répartition est une optimisation,
jamais une exigence : les garde-fous sont indépendants du harness, chaque phase a un repli
séquentiel aux artefacts identiques, et le repli fail-closed `verify --apply` reste toujours de
votre ressort. Lisez **`references/orchestration.md`** pour la table de routage et les règles.

## Aide-mémoire des commandes

La surface complète est dans `--help` ; voici les lignes dont vous avez besoin.

```
node scripts/ultra11y.mjs audit "src/**/*.tsx" --graph --out audits --json   # the default audit (AST + cross-file, persisted)
node scripts/ultra11y.mjs audit - < component.html                           # a snippet via stdin
node scripts/ultra11y.mjs audit --changed --json                             # only the git diff (large repo)
node scripts/ultra11y.mjs audit --staged --fail-on blocking                  # gate EXACTLY the staged snapshot (pre-commit)
node scripts/ultra11y.mjs audit "dist/**/*.html"                             # the RENDERED HTML (reliable for DSFR/MUI…)
node scripts/ultra11y.mjs render .                                          # ultra11y's render engine (components, pages, stories → .ultra11y/captures)
node scripts/ultra11y.mjs audit --require-captures                           # gate the components with no rendered capture
node scripts/ultra11y.mjs scan http://localhost:3000 --cwd . --merge audits/audit-latest.json
node scripts/ultra11y.mjs check --in audits/audit-latest.json --require-rendered              # gate: a rendering criterion left open by a run that rendered nothing
node scripts/ultra11y.mjs pages --in audits/audit-latest.json --json --out audits  # the per-page grid, for a machine (audits/pages.json)
node scripts/ultra11y.mjs verify --report audits/rgaa-YYYY-MM-DD.md --in audits/audit-latest.json --manual --out audits
node scripts/ultra11y.mjs verify --apply audits/ADJUDICATE.todo.json --in audits/audit-latest.json --out audits
node scripts/ultra11y.mjs orchestrate --run audits                           # fan the judgment phases out (--eco for the sequential path)
node scripts/ultra11y.mjs orchestrate --run audits --manifest --json         # the same loop as data, for any other orchestrator
node scripts/ultra11y.mjs report --in audits/audit-latest.json --out audits  # → audits/rgaa-YYYY-MM-DD.md
node scripts/ultra11y.mjs prd     --in audits/audit-latest.json              # the same auditor block as a backlog
node scripts/ultra11y.mjs tickets --in audits/audit-latest.json --dry-run    # file it: GitHub/GitLab/Jira
node scripts/ultra11y.mjs check  --report audits/rgaa-YYYY-MM-DD.md          # integrity gate
node scripts/ultra11y.mjs serve                                              # browse audits/ and its history on http://127.0.0.1:4711/ (--static <dir> to export)
node scripts/ultra11y.mjs criteria 8.3                                       # one RGAA criterion (--theme N, or the theme list)
node scripts/ultra11y.mjs criteria --plan                                    # the work plan: what each evidence tier settles
node scripts/ultra11y.mjs fix "src/**/*.html" --write --iterate               # apply the safe codemods to a fixpoint
node scripts/ultra11y.mjs init --hook                                        # pre-commit gate over the staged snapshot
```
**Tout parle RGAA, par défaut.** `audit` affiche un résumé titré RGAA, tabulé par
thématique, avec des constats étiquetés `[8.4]`, en français sauf avec `--lang en` ; `--json` et
`--out` écrivent le document RGAA (106 critères, 13 thématiques — chaque constat porte sa
correspondance `wcag`) avec le noyau WCAG dans `core` pour le pipeline ; et le rapport, le PRD,
les tickets et les fiches par page nomment des critères RGAA, le WCAG seulement comme
correspondance. En interne, le moteur reste indexé sur les critères de succès, parce qu’un
critère RGAA est DÉFINI comme une projection de ceux-ci ; c’est de la plomberie.
`--standard rgaa` est accepté (le bot `rgaa-audit` d’iterion le passe) ; `--standard wcag` sort
avec le code 2. `--json` partout pour une sortie machine.
`--lang` suit la conversation (passez-le explicitement — règle fondamentale 7).

## La boucle : auditer → rendre → arbitrer → corriger → réauditer

Pour converger vers la conformité (et non faire un seul passage), enchaînez les étapes, en
laissant l’agent piloter les étapes de jugement et de contenu :

1. **Auditez** le source (`audit … --graph`) pour une première carte ; sur du code rendu par une
   bibliothèque, **auditez le rendu** (`render` → build/SSR → `audit`) pour des verdicts fiables
   (sinon la note de risque de périmètre vous le rappelle).
1b. **RENDEZ AVANT D’ARBITRER — cette étape n’est pas facultative quand un critère de rendu est
   ouvert.** `scan <url|file> --merge audits/audit-latest.json --out audits`
   (ou `scan --sample`) pilote un vrai navigateur, enregistre chaque page dans
   `.ultra11y/pages/<id>/` **avec ce qu’il a mesuré** (`probes.json`, `axe.json`), et l’intègre.
   La sauter ne laisse pas seulement ces critères ouverts — elle les rend *indécidables par
   quiconque* : aucune lecture du source ne tranche le contraste calculé, le zoom à 200 %, le
   reflow à 320 px ou l’espacement du texte, donc chaque passage d’arbitrage sur eux coûte un
   modèle et renvoie `needs-rendered-dom`. Mesuré sur un run RGAA sur un fixture de deux
   fichiers : **80 critères à arbitrer à partir du seul source, 41 dès qu’une seule page a été
   scannée**. Sous le RGAA, le scan ne ferme pas à lui seul un critère de rendu (ses règles y
   sont des preuves *candidates*, voir plus haut), mais sans lui vous n’avez aucun DOM rendu sur
   lequel statuer. `verify --manual` le dit désormais avant que vous ne dépensiez quoi que ce
   soit, et `check --in <audit.json> --require-rendered` en fait un garde-fou.
2. **Arbitrez et réfutez** avec `verify`, deux listes de travail. (a) `verify --manual --in audit.json`
   émet `ADJUDICATE.todo.json` — un élément par critère résiduel *de jugement*, préchargé avec
   les preuves récoltées par le moteur — sur lequel l’agent IA statue (`C`/`NC`/`NA`, ou `manual`
   avec une `reason` quand il relève vraiment de `needs-rendered-dom`), chaque verdict portant une
   `justification` ou un constat fondé ; `verify --apply … --in audit.json` les réintègre en
   FAIL-CLOSED (les NC de l’agent deviennent de vrais constats `agent:<sc>` qui réapparaissent au
   §2). (b) `verify --report … [--semantic]`
   construit `VERIFY.todo.json`, qui attaque **dans les deux sens**. Il réfute toute
   **non-conformité** `preliminary`/SFC/source de bibliothèque que le DOM rendu dément, et — par
   défaut — il met aussi à l’épreuve les
   **conformités et « non applicable »** arbitrées par l’agent dans l’audit de `--in` (sinon le
   registre), un élément par affirmation avec son jeu complet de citations, la question
   inversée : *ces preuves établissent-elles le critère, ou montrent-elles seulement que son
   sujet existe ?* Rien ne contestait auparavant un `C`, si bien qu’un critère validé parce que
   son sujet était PRÉSENT plutôt que CORRECT partait comme une affirmation de conformité. Mêmes
   verdicts (`supported`/`partial`/`refuted`/`unsupported`) ;
   `verify --apply` écarte les non-conformités réfutées/non étayées et renvoie le critère d’une
   conformité réfutée à « à évaluer » — jamais à NC, car réfuter une conformité ne prouve rien
   contre le critère ; avec `--prune`, il réécrit ce résultat dans l’audit, et une conformité sur
   laquelle le fichier de verdicts n’a jamais statué repart elle aussi « à évaluer ».
   `verify --summary --verdicts <file> --report <md> --in <audit> [--pruned <audit>]` écrit le
   bilan en lecture seule (`TRIAL.md`) : confirmées, retirées et appliquées, décisions du moteur
   contestées (non résolues), jamais mises à l’épreuve, étrangères, et le garde-fou sémantique
   à part de l’application.
   La moitié « conformités » n’est **jamais plafonnée par défaut** (`--max-verify` ne borne que les
   non-conformités, 40 par défaut) ; passez `--max-verify 0` pour mettre chaque affirmation à
   l’épreuve dans une seule liste de travail, et traitez tout avertissement « left out of the
   trial » comme un run incomplet.
   `--no-conformities` permet de s’en dispenser. Cela
   inclut la **logique de focus et d’interaction** (lire le source complet du composant :
   opérabilité au clavier, ordre/visibilité du focus, pièges, changements au focus / à la saisie ;
   voir `references/focus-and-logic.md`) et les pièges propres à chaque règle dans
   `references/false-positives.md`.
   Les deux listes de travail se répartissent (`orchestrate --run <dir> --phase adjudicate|verify-report` —
   voir **Orchestration — router selon le harness**) ; le repli `--apply` reste toujours de votre
   ressort.
   **Statuez sur chaque critère d’après SON PROPRE texte, pas d’après votre souvenir.**
   `verify --manual` écrit aussi un petit brief par critère (`adjudicate/<criteriaId>.md`) portant
   la formulation officielle du critère dans le RGAA, ses tests numérotés et sa
   **méthodologie de test** (le RGAA en publie une pour chacun de ses 258 tests), plus ses termes
   du glossaire, sa note technique et ses cas particuliers. Le contrat de verdict, commun à tous
   les critères, n’est écrit qu’une fois, dans `ADJUDICATE.contract.md` : chaque brief y renvoie,
   lisez-le avant le premier. Lisez ce brief ; c’est le RGAA
   qui décide, jamais le critère de succès WCAG qui est derrière. Chaque brief cite aussi la
   page officielle du critère : si une formulation reste ambiguë et que vous disposez d’un outil
   web, vous pouvez aller la lire — jamais pour contredire le texte embarqué, et une page web
   n’est jamais une `normativeRef` acceptable (`--no-web` retire cette proposition ; la CI la
   retire par défaut).
3. **Corrigez** par priorité : `fix --write --iterate` pour la partie mécanique (garde-fou
   anti-régression), puis appliquez à la main les correctifs de jugement/contenu (alt,
   étiquettes, structure) en suivant `references/correction.md`.
4. **Réauditez** (sur le rendu le cas échéant) et recommencez.
5. **Livrez le bloc d’auditeur.** `report` (document de conformité : synthèse + un bloc de
   conformité d’auditeur — thématique/critère/test/correspondance WCAG/constat/attendu/vérification —
   par critère NC) et `prd` (les mêmes blocs sous forme de backlog actionnable ; `tickets`
   ouvrant une issue GitHub par critère avec ce bloc identique) sont deux vues de
   l’UNIQUE brique de base, dans la langue de cette conversation (passez `--lang` explicitement —
   règle fondamentale 7).

6. **Passez le changement à `review-a11y`, dans un sous-agent.** Une fois le livrable publié,
   le code que vous venez de corriger doit encore être relu en tant que *changement*, et c’est le
   travail de l’autre skill — voir **Passer la main à `review-a11y`** plus bas.

**Arrêtez-vous** quand `check` et `verify --apply` sont de nouveau au vert et qu’il ne reste que
des risques résiduels explicitement nommés. (Pour automatiser la cadence externe, la commande
`/loop` du harness peut relancer ce cycle.)

## Passer la main à `review-a11y`

Cette skill fait l’analyse de bout en bout : auditer, rendre, arbitrer, corriger, réauditer,
livrer. Quand elle a produit des correctifs, **lancez `review-a11y` sur le code en cours de
changement dans un sous-agent**, et rapportez ce qu’il renvoie.

Utilisez la capacité native de l’hôte à lancer des sous-agents : Codex lance un sous-agent avec
le prompt ci-dessous, OpenCode son outil Task, Claude Code son outil Agent (`Agent(...)`). Si
l’hôte n’a pas de sous-agents, suivez la voie séquentielle ci-dessous.

```
Use the review-a11y skill on the working diff. Return its report verbatim.
```

Deux skills, deux périmètres, et la séparation n’est pas cosmétique :

| | périmètre | question |
|---|---|---|
| `ultra11y` (celle-ci) | le dépôt, un échantillon de pages, un référentiel | *ce produit est-il conforme, et où est la preuve ?* |
| `review-a11y` | exactement le code en cours de changement (index, diff, ou branche vs merge-base) | *ce changement peut-il être mergé sans risque ?* |

**Pourquoi un sous-agent plutôt qu’un passage en ligne.** Un audit complet remplit un contexte
avec la sortie d’un moteur de 3 Mo, des dizaines de fichiers de référence et un échantillon de
pages ; une revue doit lire le diff de près sans rien de tout cela en travers. Passer la main
garde le jugement de la revue indépendant de l’audit qui vient de tourner — pour la même raison
que `verify` réfute les constats au lieu de leur faire confiance. Si le harness n’a aucun outil de
sous-agent, invoquez directement `review-a11y` : la table de routage de
`references/orchestration.md` nomme les replis, et la revue est identique dans les deux cas.

**Ne paraphrasez pas son verdict.** Elle renvoie une revue classée par sévérité avec `file:line`
et un verdict en une ligne ; c’est cela le livrable, pas un résumé de celui-ci.

## Combiner moteur, jugement et risque résiduel

`audit` classe chaque critère `C`/`NC`/`NA` pour le sous-ensemble statique et `manual` pour le
reste, chacun portant une classe `automatability` qui dit POURQUOI il est manuel et comment le
fermer : **`static`** (le moteur décide), **`needs-rendering`** (`scan`), **`judgment`** (vous, à
partir des preuves récoltées et du protocole de décision). Les `NC` du moteur sont des candidats
confirmés avec un `file:line` cité ; un constat `preliminary: true` (source SFC/bibliothèque) est
provisoire — confirmez-le sur le rendu ou réfutez-le. Un critère n’est jamais marqué conforme en
silence : le rapport n’est complet que lorsque chaque critère applicable est un `C`/`NC`/`NA`
justifié et que chaque risque résiduel est nommé. Voir **`references/methodology.md`**.

**Les recommandations consultatives forment une classe à part.** Un signal de bonne pratique
SANS test normatif en échec s’affiche dans une section dédiée et ne peut jamais faire basculer un
critère en `NC` ni entrer dans `conformancePct`. Un `NC` exige une `normativeRef` ; une
recommandation non. Ne promouvez pas l’une en l’autre — voir **`references/false-positives.md`**.

## À ne pas faire

- Inventer une non-conformité que le moteur n’a pas trouvée et que vous ne pouvez pas voir (le
  contraste sur des **couleurs littérales en ligne** se décide statiquement ; le contraste
  **calculé** — CSS externe, variables — passe par `scan` (niveau navigateur) ou se vérifie sur le
  rendu avant d’être déclaré).
- Ajouter de l’ARIA qui duplique la sémantique native.
- Marquer un critère de rendu/jugement « conforme » sans justification enregistrée et contrôlée
  (arbitrage de l’agent via `verify --manual`, ou preuve issue de `scan`).
- Modifier à la main `references/criteria.md` (généré à partir du jeu de données WCAG via
  `criteria --generate`).

## Périmètre

Moteur statique : hors ligne, déterministe, sans installation ; les entrées sont du HTML + du
JSX/TSX (vrai AST, analyse inter-fichiers via `--graph`) + stdin. Les critères **de rendu**
(contraste calculé, reflow) sont couverts par le niveau facultatif `scan` (axe-core sur le
Playwright local).
Il **sonde** en outre la visibilité du focus (2.4.7), le zoom du texte à 200 % (1.4.4),
l’espacement du texte (1.4.12) et le contenu au survol (1.4.13) — observés dans la page rendue,
levés en NC seulement quand l’échec est constaté (une sonde propre laisse le critère de succès
`manual`, jamais conforme en silence) ; l’ordre de lecture et la pertinence des alternatives
relèvent du jugement de l’agent IA, arbitrés à partir des preuves récoltées et contrôlés
(`verify --manual`).
Données : WCAG 2.2 ©
W3C (W3C Document License) ; le pack RGAA est le RGAA 4.1.2 © DINUM, Licence Ouverte / Etalab
2.0 (voir `NOTICE`).

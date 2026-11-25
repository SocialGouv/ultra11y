# L’audit complet — une seule route sur chaque harness

Suivez cette route chaque fois que l’utilisateur demande un audit complet ou détaillé, un
rapport de conformité, ou un audit RGAA — sur Claude Code, Codex, OpenCode ou tout autre
harness. Chaque étape est un simple appel CLI au moteur, si bien que la même demande produit les
mêmes livrables partout. La session d’agent active est l’auditeur : elle lit les briefs de
critère et écrit elle-même les verdicts.

`node scripts/ultra11y.mjs` ci-dessous est le moteur livré dans cette skill (voir
**Lancer le moteur** dans `SKILL.md` pour son chemin sur chaque harness) ; `npx -y ultra11y`
est le même moteur là où aucun répertoire de skill n’est résolu.

`references/audit.md` est le chemin rapide — un audit statique, un rapport et le `check`
d’intégrité, sans registre, sans contre-vérification, sans dossiers par page et sans contrôle
d’exhaustivité. Ne l’utilisez que pour un premier aperçu ; ne livrez jamais sa sortie comme
livrable de conformité.

Le critère d’achèvement est un **livrable défendable**, pas simplement un scan statique propre :

- chaque page déclarée a été capturée, ou la page manquante est nommée ;
- chaque route découverte est capturée, scannée, ou listée comme non atteinte dans l’annexe ;
- chaque critère de chaque page capturée est `C`, `NC`, `NA`, ou explicitement indécidable ;
- chaque `NC` a une occurrence résolvable et chaque `C`/`NA` a une justification fondée ;
- le rapport de conformité et les dossiers par page passent `check` ;
- l’utilisateur reçoit les chemins du rapport Markdown, du point d’entrée HTML, du fichier
  unique imprimable, de l’index des pages et de la grille lisible par machine.

## 1. Établir le périmètre

Lisez `.ultra11yrc.json` s’il existe. Confirmez la langue et l’échantillon de pages (le
référentiel est toujours le RGAA 4.1.2). Préférez `sample check` plus `scan --sample` ; sinon
explorez (crawl) sans plafond caché (`--max 0`). Un rapport fondé sur les seules sources est
partiel et doit le dire. Le bloc `sample` de `.ultra11yrc.json` et les vérifications des
documents PDF sont décrits dans `references/audit.md`.

**Partez des routes de l’application, pas seulement de l’échantillon.** Enregistrez
l’inventaire des routes (`.ultra11y/routes.json`) à partir de toutes les sources dont dispose le
projet : le sitemap, une exploration (crawl), et les pages que la suite E2E a déjà capturées.

```sh
node scripts/ultra11y.mjs pages discover --sitemap <url> --routes-only   # or --crawl <url> --max 0
node scripts/ultra11y.mjs pages discover --from-snapshots --routes-only  # routes the E2E run reached
```

`--routes-only` laisse intact l’échantillon RGAA choisi ; `--write` fusionne en plus les routes
dans l’échantillon.

**Construisez ensuite l’échantillon RGAA à partir de la proposition, jamais à la main.** Deux
exécutions qui choisissent leurs pages à la main auditent des pages différentes, et leurs
verdicts ne peuvent pas être comparés :

```sh
node scripts/ultra11y.mjs pages discover --sitemap <url> --propose --write   # or --crawl <url> / --from-snapshots
node scripts/ultra11y.mjs sample check --standard rgaa
```

La proposition est déterministe : les types requis (accueil, contact, mentions légales,
accessibilité, plan du site, aide, authentification, recherche, documents) appariés par mot-clé
sur les URL et titres triés, la page de recherche avec la requête fixe `information`
(`--search-query` pour la changer), puis une page par groupe de gabarits — motif d’URL avec
identifiants, slugs et dates normalisés, ou squelette du DOM quand un instantané de page existe
— du plus grand au plus petit, les égalités départagées par l’URL, dans la limite de
`--sample-size` (20 par défaut). Chaque choix enregistre sa raison dans `notes` ; un type sans
page est écrit dans `sample.absent` avec la raison. **Conservez-la.** Ne la modifiez qu’avec
une raison enregistrée : une page que vous ajoutez porte ses `notes`, un type que vous retirez
reçoit une entrée `sample.absent`. `sample check` signale comme manquant un type retiré sans
raison.

Dès qu’un inventaire existe, chaque `audit` et chaque `scan --merge` liste chaque route dans
l’annexe (section F) : capturée par les tests E2E, scannée, code source seulement, ou non
atteinte. Aucune n’est omise. Une SPA rendue côté client n’expose aucun lien dans le HTML
servi : fournissez-lui un sitemap ou laissez ses captures E2E fournir les routes.

## 2. Auditer les sources et les pages rendues

Utilisez toutes les sources de rendu — chacune voit ce que les autres ne voient pas.
**Playwright passe en premier** pour les vraies pages : quand le projet a des tests Playwright,
branchez-y `ultra11y/playwright` (`checkA11y`, ou `sweepSample` pour l’échantillon,
`references/e2e.md`), ou réutilisez les captures `.ultra11y/pages` qu’ils ont déjà écrites,
avant de vous replier sur le crawler. Ces captures portent l’état construit par les tests (une
session, un formulaire rempli, une boîte de dialogue ouverte), et `scan --all-routes` ne
rescanne jamais une route qu’elles contiennent.

- **Pages** : captures E2E (`.ultra11y/pages/`, issues de `ultra11y/playwright`/`ultra11y/cypress`)
  — lancez la suite E2E pour les rafraîchir — puis la passe navigateur sur l’échantillon et le
  reste de l’inventaire (`scan --sample --all-routes`, ci-dessous).
- **Composants** : le moteur de rendu propre à ultra11y. Il trouve les composants exportés, les
  pages du framework et les stories Storybook, rend chacun avec le `react-dom/server` du projet
  dans un harness jetable, et écrit `.ultra11y/captures/` ainsi que le manifeste
  `.ultra11y/render.json` (`references/rendered.md`). Il ne lit ni n’exécute jamais les tests
  ou les snapshots du projet.

```sh
node scripts/ultra11y.mjs render .        # components, pages and stories → .ultra11y/captures
```

Ne lisez pas les fichiers de test du projet, ses `__snapshots__` ni ses snapshots inline pour
trouver du balisage : ils contiennent ce qu’un auteur de test a écrit, parfois cassé exprès, et
se périment. Lancez `render` avant `audit` : l’annexe (section G) liste alors chaque unité que
le moteur a rendue, ignorée (avec la raison : provider manquant, props, API propre au
navigateur, récupération de données, erreur de transpilation, délai dépassé) ou pas tentée. Un
composant qui prend des props est rendu via ses stories, ou pas du tout : couvrez ceux que
l’annexe liste par une story ou par la page qui les affiche. Les rendus de composants n’ont pas
de style calculé (`styles="none"`) : ils décident des critères de balisage sur les composants,
jamais des critères de niveau page ni des critères de rendu. Nommez dans l’annexe de couverture
toute source que vous n’avez pas pu exécuter, et pourquoi.

```sh
node scripts/ultra11y.mjs audit <paths> --graph --standard <standard> --lang <lang> --out audits --json
node scripts/ultra11y.mjs scan --sample --all-routes --cwd . \
  --standard <standard> --merge audits/audit-latest.json --out audits
```

`--all-routes` scanne l’échantillon, puis chaque route de l’inventaire que l’échantillon ne
contient pas, dans la limite de `--max-routes` (50 par défaut). Une route que la limite laisse
de côté est listée comme non atteinte, avec la raison. Utilisez plutôt `--crawl <url> --max 0`
quand le projet n’a ni échantillon ni inventaire. Un critère de rendu reste indécidable tant
qu’aucune mesure navigateur n’existe ; l’inspection des sources ne remplace pas le scan.

**Écrivez et rejouez ensuite les parcours.** Le scan ne se connecte jamais, ne soumet rien et
n’ouvre aucun tunnel. Lisez l’application (ses routes, ses formulaires et ses composants
interactifs) et écrivez dans `.ultra11y/journeys/` les parcours qui comptent :
l’authentification, le formulaire principal y compris une soumission invalide, la recherche,
chaque modale, menu ou bouton de divulgation, et le tunnel multi-étapes s’il y en a un. Le
format et des exemples sont dans `references/journeys.md`. Rejouez-les au clavier seul :

```sh
node scripts/ultra11y.mjs journey run --all --keyboard --base-url <url> \
  --standard <standard> --merge audits/audit-latest.json --out audits
```

Chaque étape devient un état de page audité. Le rejeu enregistre aussi l’accessibilité au
clavier et les pièges clavier, le focus à l’entrée et à la sortie des boîtes de dialogue, les
erreurs non reliées à leur champ et les messages de statut non annoncés. Une étape en échec
arrête son parcours avec la raison, et l’annexe H liste chaque étape. Corrigez le parcours et
relancez-le. Ne l’abandonnez pas.

Chaque page que `scan` ouvre et chaque état de parcours enregistre aussi son arbre
d’accessibilité et, à partir de lui, ce qu’un lecteur d’écran y annoncerait (`sr.json`) : la
preuve sur laquelle 7.1, 7.3, 7.5 et les critères de formulaire sont tranchés, état par état —
le bouton de divulgation « collapsed » avant le clic et « expanded » après, le champ
« invalid » une fois que le formulaire l’a refusé. `scan` enregistre l’inventaire des médias
et un court enregistrement du viewport mesuré pour les flashs (`media.json`), la preuve du
thème 4 et de 13.7. L’annexe I, la carte de l’application, met côte à côte les routes, les
états de page, les unités rendues et les critères que chaque source de preuve peut atteindre ;
`criteria --plan` affiche la même matrice, et aucun critère du référentiel n’est sans chemin.

`scan` et `ultra11y/playwright` exécutent le même axe : le `axe-core` épinglé propre à
ultra11y et ses tags de règles, quelle que soit la version installée par le projet. L’annexe
nomme la version qui a tourné. Si elle indique « copie du projet audité », la copie propre à
ultra11y n’a pas pu être résolue ; réinstallez ultra11y avec ses dépendances avant de publier.

**Un scan propre ne conclut jamais `C` sur un critère de rendu** : 3.2, 3.3, 10.4, 10.11,
10.12, 12.9 et les autres critères de rendu ne portent que des règles de scan *candidates*, si
bien que le scan peut lever leurs non-conformités mais qu’une exécution propre les laisse « à
évaluer » — ils vous reviennent à l’étape 3, et `check --require-decided` compte 0 « mesure
(scan) » pour eux. C’est attendu, ce n’est pas un scan raté.

Si le scan ne parvient pas à démarrer un navigateur, il se replie sur le build Chromium complet
de Playwright puis sur un Google Chrome installé ; quand aucun ne démarre, l’erreur nomme
l’installation de Playwright qui a été résolue et la commande qui installe son navigateur.

## 3. Arbitrer

Générez la liste de travail de jugement avec `verify --manual`, puis tranchez-la de l’une des
deux façons — les verdicts passent par le même repli « fail-closed » (en cas de doute, refuser)
quelle que soit celle que vous choisissez :

- **arbitrer directement** dans cette session (le choix par défaut pour une demande
  interactive) ;
- **répartir entre des sous-agents** quand la liste de travail est longue — `orchestrate --run
  audits --phase adjudicate` émet les lots et les contrats par rôle, et tout harness doté de
  sous-agents peut les dispatcher (l’outil Agent ou Workflow de Claude Code, les sous-agents de
  Codex, l’outil Task d’OpenCode) ; voir `references/orchestration.md`. Les sous-agents
  renvoient des verdicts ; c’est vous qui les repliez.

Quand personne n’est dans la boucle (CI), l’appelant est le bot `rgaa-audit` d’iterion, qui
tranche la même liste de travail à travers le même garde-fou ; voir `references/ci.md`.

Pour trancher directement : lisez chaque petit brief
`audits/adjudicate/<criterion>.md`, décidez au regard de ses tests officiels, remplissez les
verdicts dans **`audits/ADJUDICATE.todo.json`** — le seul fichier à écrire dans une session qui
a un shell (ses items portent les preuves et les emplacements `citations[]` ;
`ADJUDICATE.verdicts.json` est le jumeau sans preuves destiné à un arbitre sans shell, et
`verify --apply` accepte l’un ou l’autre, mais remplissez-en un, pas les deux) — puis repliez-le
avec `verify --apply … --ledger`. Le registre enregistre chaque verdict accepté, pour que la
contre-vérification de l’étape 4 puisse le réparer et qu’une exécution ultérieure puisse le
rejouer. Quelle que soit la façon dont les verdicts ont été produits, le repli final reste dans
la session parente.

```sh
node scripts/ultra11y.mjs report --in audits/audit-latest.json \
  --standard <standard> --lang <lang> --out audits
node scripts/ultra11y.mjs verify --report audits/<standard>-<date>.md \
  --in audits/audit-latest.json --manual --standard <standard> --out audits
node scripts/ultra11y.mjs verify --apply audits/ADJUDICATE.todo.json \
  --in audits/audit-latest.json --standard <standard> --out audits --ledger
```

Un critère de rendu dont le brief indique qu’aucune preuve n’a été récoltée ne peut pas être
`C` (le repli le refuse) : enregistrez `manual` avec la raison `undecidable` et une
justification qui dit ce que vous avez vérifié, et nommez-le dans le fichier `--allow-undecided`
de l’étape 6.

Le premier rapport est un brouillon, pas le livrable final. Suivez `references/judgment.md`
pour le schéma des verdicts (y compris la forme de `citations[]`) et le repli fail-closed.

## 4. Mettre les affirmations à l’épreuve

Rendez le rapport, générez le `VERIFY.todo.json` contradictoire, arbitrez chaque affirmation,
appliquez les verdicts avec `--prune --ledger`, puis rendez à nouveau. Cette
contre-vérification couvre à la fois les non-conformités alléguées et les conformités
déclarées par l’agent **et** les « non applicable » — sur un petit site, cela fait facilement
plus de 70 affirmations. Tranchez la contre-vérification des deux mêmes façons qu’à l’étape 3 :
directement, ou en répartissant (`orchestrate --run audits --phase verify-report`) — celui qui
réfute doit ouvrir les fichiers cités.

```sh
node scripts/ultra11y.mjs report --in audits/audit-latest.json \
  --standard <standard> --lang <lang> --out audits
node scripts/ultra11y.mjs verify --report audits/<standard>-<date>.md \
  --in audits/audit-latest.json --standard <standard> --semantic --max-verify 0 --out audits
node scripts/ultra11y.mjs verify --apply audits/VERIFY.todo.json \
  --report audits/<standard>-<date>.md --in audits/audit-latest.json \
  --standard <standard> --out audits --prune --ledger
```

`--max-verify 0` met toutes les affirmations dans une seule liste de travail. Sans lui, les
non-conformités sont plafonnées à 40 (la moitié « conformités » n’est jamais plafonnée sauf si
`--max-verify` est fixé) ; tout ce qu’un plafond laisse de côté est nommé sur stderr, fait
échouer l’application comme « missing », et sous `--prune` une conformité qui n’a jamais été
éprouvée retourne à « à évaluer » — une contre-vérification plafonnée vous coûte donc des verdicts, il
ne laisse jamais passer une affirmation non éprouvée. Si aucun registre n’existe encore,
`--prune --ledger` en crée un et le signale.

`VERIFY.todo.json` est un simple tableau JSON d’items (`n`, `criteriaId`, `kind`, `file`,
`line`, `selector`, `claim`, `verdict`, `note`, et `citations[]` sur une conformité), alors que
`ADJUDICATE.todo.json` est un objet dont les items sont sous `items` — remplissez `verdict` et
`note` sur place dans chaque entrée.

## 5. Publier le livrable détaillé

```sh
node scripts/ultra11y.mjs report --in audits/audit-latest.json \
  --standard <standard> --lang <lang> --html --evidence --out audits
node scripts/ultra11y.mjs pages --in audits/audit-latest.json \
  --standard <standard> --lang <lang> --json --out audits
node scripts/ultra11y.mjs pages --in audits/audit-latest.json \
  --standard <standard> --lang <lang> --format report --split page \
  --html --evidence --out audits/pages
```

Cela produit le rapport de conformité Markdown daté, `audits/index.html`, le rapport HTML
imprimable en un seul fichier, `audits/pages.json`, et les dossiers navigables par page en
Markdown/HTML avec captures d’écran et preuves annotées quand les instantanés de page le
permettent. C’est un livrable de conformité ; ne générez un PRD, un backlog de remédiation ou
des tickets que lorsque l’utilisateur demande des corrections.

## 6. Contrôler et remettre

```sh
node scripts/ultra11y.mjs check --report audits/<standard>-<date>.md \
  --in audits/audit-latest.json --standard <standard>
node scripts/ultra11y.mjs check --in audits/audit-latest.json \
  --standard <standard> --require-rendered
node scripts/ultra11y.mjs check --in audits/audit-latest.json \
  --standard <standard> --require-decided=pages
node scripts/ultra11y.mjs check --report audits/pages/index.md \
  --standard <standard>
```

N’ajoutez `--allow-undecided .ultra11y/undecidable-<standard>.json` au contrôle d’exhaustivité
que lorsque le projet enregistre des exceptions nommées avec leurs raisons. Indiquez le
périmètre, le nombre de pages, le nombre de critères, le décompte des provenances, les
exceptions nommées restantes et chaque chemin de livrable. Un contrôle en échec fait partie du
résultat et ne doit pas être résumé comme un rapport complet.

## L’exécution de référence

`tests/full-audit.e2e.test.ts` dans le dépôt ultra11y est cette route, exécutée telle
qu’écrite : chaque commande ci-dessus, dans cet ordre, sur `tests/fixtures/full-audit-app`
(onze routes servies, un répertoire de composants React, des PDF téléchargeables, deux parcours
rejoués avec `journey run --all --keyboard --merge` — un bouton de divulgation de menu et le
formulaire de contact envoyé avec une adresse invalide — et un test unitaire avec un snapshot
et une spec Playwright qui ne doivent jamais être lus). La seule chose qu’il n’exécute pas est
un modèle : un script commité remplit `ADJUDICATE.todo.json` et `VERIFY.todo.json`, en copiant
chaque citation depuis les preuves que le moteur a récoltées, si bien que l’exécution ne coûte
rien et donne le même livrable à chaque fois. Il vérifie que chaque livrable existe, que chaque
`check` ci-dessus passe (avec un fichier `--allow-undecided` nommant ce qu’un humain doit encore
trancher), que l’annexe liste chaque route, composant rendu et étape de parcours (sections F, G
et H), que chaque état de parcours est une page de la grille portant ses propres constats, que
des pages aux constats différents obtiennent des taux différents, et qu’aucun fichier de test
n’atteint la sortie. La CI l’exécute dans le job `browser-tier`. Quand cette page et ce test
divergent, l’un des deux a tort : changez les deux ensemble.

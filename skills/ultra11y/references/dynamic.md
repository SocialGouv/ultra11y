# Niveau dynamique (axe-core) — optionnel

Le moteur statique laisse certains critères « à évaluer » parce qu’ils demandent un **rendu** :
contraste calculé (1.4.3), visibilité du focus (2.4.7), focus non masqué (2.4.11),
redistribution/zoom (1.4.4/1.4.10), espacement du texte (1.4.12),
contenu au survol (1.4.13), taille de la cible (2.5.8). Le niveau dynamique les tranche en
exécutant **axe-core dans un vrai navigateur headless** (Playwright), sur un seul runtime :

- **Le Playwright local** : `scan` résout Playwright + `@axe-core/playwright` **à l’exécution**,
  d’abord depuis `--cwd` puis depuis l’installation propre d’ultra11y (aucune installation
  globale). Un projet qui épingle son propre Playwright le conserve, puisque `--cwd` est essayé
  en premier. Il ajoute les **sondes** des critères résiduels (ci-dessous). `--runtime local`
  (ou son alias `--local`) le nomme encore explicitement ; il n’existe pas d’autre runtime.
- **Un axe-core épinglé, le même partout.** Playwright est résolu d’abord dans le projet ; axe
  ne l’est pas. `scan` et `ultra11y/playwright` injectent l’`axe-core` propre d’ultra11y (une
  dépendance exacte du package, lue depuis `axe-core/axe.min.js` et passée en `axeSource`)
  avec les mêmes tags de règles (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`,
  `best-practice`), quelle que soit la version installée par le projet audité. La copie du
  projet n’est utilisée que lorsque celle d’ultra11y ne peut pas être résolue (le bundle
  autonome du skill sans `node_modules` à côté). Ce repli affiche une note. La version exécutée
  est consignée dans chaque résultat (`DynamicResult.axe`, le `axe.json` de chaque capture) et
  dans l’annexe du rapport. `status --browser` indique quelle copie serait exécutée.
- **`--browser-path <file>`** (ou `ULTRA11Y_BROWSER_PATH`) : lancer **cet** exécutable avec le
  runtime local au lieu du navigateur que résout Playwright — le Chromium d’une distribution
  (`/usr/bin/chromium` sur Debian, ce que livre l’image d’un runner en bac à sable), que ni la
  résolution propre de Playwright ni son repli sur Google Chrome ne trouvent jamais. C’est un
  choix explicite : le moteur lance ce fichier et rien d’autre, et
  `status --browser --browser-path <file>` répond à propos de ce fichier (`ok` + `executable`,
  ou une raison qui nomme le chemin).

## Prérequis

- **local** : un navigateur Chromium (`npx playwright install chromium`), plus les deux
  packages npm — et **l’endroit où ils doivent se trouver dépend de la façon dont vous lancez
  le moteur** :

  | Canal | `@playwright/test` + `@axe-core/playwright` |
  |---|---|
  | ultra11y comme dépendance npm (`ultra11y/playwright`, `pnpm exec ultra11y`) | **fournis avec lui** — ce sont ses propres `dependencies`. Rien à installer. |
  | le bundle autonome du skill (`node scripts/ultra11y.mjs` depuis un skill installé) | **doivent être dans le projet audité**, accessibles depuis `--cwd`. Un skill installé est un répertoire de fichiers sans `node_modules` à côté, donc le second point d’ancrage n’y trouve rien. |
  | le bot `rgaa-audit` d’iterion (CI) | le bot installe le package épinglé du moteur — dépendances comprises — et sonde le niveau avec `status --browser` avant de rendre. |

  Savoir dans lequel de ces cas vous êtes a une réponse : `status --browser [--cwd <dir>]`
  interroge la fonction même sur laquelle agit `scan`, et renvoie `ok` et, quand ce n’est pas
  le cas, QUEL package ou binaire manque. C’est là-dessus qu’un harness de CI se branche,
  plutôt que de le redéduire.

  Dans tous les cas, un projet qui les installe lui-même l’emporte : `--cwd` est essayé en
  premier, ce que veut un dépôt qui épingle son propre Playwright. Quand aucun des deux points
  d’ancrage ne résout, `scan` échoue et indique quel package il n’a pas trouvé.

Le reste du skill (audit statique) n’a besoin ni de l’un ni de l’autre.

## Utilisation

```
# resolving deps + browser from the current directory, then from ultra11y itself
node scripts/ultra11y.mjs scan https://example.com --json

# resolving deps + browser from a project first (e.g. a monorepo package)
node scripts/ultra11y.mjs scan http://localhost:3000 --cwd packages/app --json

# a browser already on the machine (a distribution's Chromium), never downloaded by Playwright
node scripts/ultra11y.mjs status --browser --cwd . --browser-path /usr/bin/chromium --json
node scripts/ultra11y.mjs scan http://localhost:3000 --cwd . --browser-path /usr/bin/chromium --json

# authenticated pages: pass a Playwright storageState JSON (cookies/localStorage)
node scripts/ultra11y.mjs scan http://localhost:3000/dashboard \
  --cwd packages/app --storage-state packages/app/test-results/.auth/user.json --json

# several explicit URLs at once (one browser, one context per page)
node scripts/ultra11y.mjs scan http://localhost:3000/ http://localhost:3000/login --cwd packages/app

# merge with a static audit: the "to assess" criteria turn C/NC
node scripts/ultra11y.mjs audit "src/**/*.tsx" --jsx --out audits --json > /dev/null
node scripts/ultra11y.mjs scan http://localhost:3000 --cwd packages/app --merge audits/audit-latest.json --out audits
node scripts/ultra11y.mjs report --in audits/audit-latest.json --out audits
```

Produisez le fichier `--storage-state` avec Playwright (p. ex. un setup d’authentification e2e
qui se connecte puis appelle `context.storageState({ path })`).

### Couvrir de nombreuses pages (crawl)

```
# every URL listed in a sitemap.xml
node scripts/ultra11y.mjs scan --sitemap https://example.com/sitemap.xml --json

# BFS of served same-origin links, from an entry page
node scripts/ultra11y.mjs scan --crawl https://example.com --depth 2 --max 50 --json
```

Chaque constat conserve la **page** d’où il provient (`--merge` rapporte cette URL comme
`file`). `--crawl` suit les liens du **HTML servi** (SSR/MPA) ; pour une SPA pure, utilisez
`--sitemap` ou passez les URL explicitement. La récupération du crawl n’est pas authentifiée —
pour les pages authentifiées, passez plutôt des URL explicites + `--storage-state`.

## Ce qu’apporte le niveau dynamique

- **Contraste réel (1.4.3)** — axe calcule les couleurs rendues (le gain principal).
- **Redistribution (1.4.10)** — aucun défilement horizontal à 320px de large.
- **Contre-vérification** — axe revalide les critères structurels (alt, étiquettes, ARIA,
  titres…) au rendu ; un constat de rendu **fait autorité** et fait passer le critère en NC.

Les constats axe sont associés aux critères de succès WCAG via une table établie à la main
(`axe-rule → SC`), complétée par les **tags WCAG natifs** d’axe (`wcag<abc>`). À la fusion
(`--merge`), un critère `manual` que le niveau tranche quitte les risques résiduels et devient
`C`/`NC` (ruleId `axe:<rule>` pour les constats axe).

### Sondes des critères résiduels

Au-delà d’axe, le scan exécute des sondes Playwright sur mesure pour les critères qu’axe seul
ne peut pas trancher. Chacune ne lève une **NC définitive que lorsque l’échec est observé**
dans la page rendue ; une sonde propre laisse le CS en `manual` (jamais conforme en silence).
Les constats fusionnés reçoivent un ruleId `dyn-<engine>`.

| Sonde | CS | Méthode |
|---|---|---|
| visibilité du focus | 2.4.7 | Tabuler à travers les éléments focalisables ; signaler tout élément dont le style calculé (outline/box-shadow/border/background) ne change pas au focus |
| focus non masqué | 2.4.11 | Sur le MÊME parcours de l’anneau de tabulation : échantillonner une grille sur le composant qui a le focus et le signaler quand AUCUN de ses points n’est au premier plan, sous un élément ayant un ancêtre `fixed`/`sticky`. Uniquement **entièrement** masqué — un composant partiellement recouvert satisfait 2.4.11 (cela relève de 2.4.12, AAA) — et un composant sorti du viewport par défilement ne relève pas du tout de ce critère |
| zoom à 200 % | 1.4.4 | Agrandir le texte à 200 % ; signaler un défilement horizontal au niveau de la page ou un texte rogné dans un conteneur `overflow:hidden` |
| espacement du texte | 1.4.12 | Injecter la surcharge d’espacement WCAG 1.4.12 ; signaler un texte rogné/tronqué |
| contenu au survol | 1.4.13 | Pour les déclencheurs `aria-describedby` dont la cible est masquée, survoler pour révéler puis vérifier que le contenu peut être masqué (Échap) |

Les éléments masqués visuellement (`clip`/1px sr-only) sont exclus de ces sondes. **La taille
de la cible (2.5.8)** est volontairement laissée à la règle `target-size` propre d’axe-core,
qui applique correctement les exceptions « en ligne » et d’espacement de 24px (une sonde faite
main était strictement plus bruyante sur de vraies pages).

Ces sondes sont heuristiques (sévérités prudentes : focus + zoom `majeur`, le reste `mineur`).
Vérifiez les constats des sondes de manière contradictoire (une passe `verify`) avant de les
enregistrer.

### Sondes d’interaction avec état (runtime local, interactions ACTIVÉES par défaut)

Les sondes en lecture seule ci-dessus mesurent une page **telle que servie**. Certaines
non-conformités n’apparaissent qu’une fois que l’utilisateur a *interagi* — un champ rempli qui
déborde de sa cellule, un message de statut qui n’atteint jamais une région live. Le runtime
local exécute donc aussi une passe **avec état** qui pilote la page, puis la restaure.
**Contrat de sécurité** : seules des actions qui NE naviguent PAS sont effectuées — remplir des
champs texte (une valeur longue et représentative, en respectant `maxlength`), basculer des
cases à cocher/boutons radio, cliquer sur `button[type="button"]`. **Jamais** un lien, un bouton
d’envoi ni une soumission de formulaire ; chaque interaction consigne d’abord `location.href` et
abandonne + restaure s’il a changé ; chaque boucle est bornée ; l’état d’origine est toujours
restauré.

| Sonde avec état | CS | Ce qu’elle ajoute |
|---|---|---|
| remplir les champs → remesurer | 1.4.4 / 1.4.10 / 1.4.12 | remplit les champs visibles de type texte avec un vrai contenu, puis relance les sondes de stress zoom/redistribution/espacement, afin d’attraper un débordement qui ne se produit *que lorsque le champ contient la valeur que l’auditeur doit saisir* |
| région live | 4.1.3 | déclenche des interactions sûres et vérifie que le message de statut qui en résulte arrive dans une région `aria-live`/`role="status"`/`role="alert"` (messages de statut) — le CS supplémentaire que `localTestedScs` ne rapporte que lorsque les interactions sont activées |

- **`--no-interact`** désactive toute la passe avec état (remplissage + région live), ne
  laissant que les sondes en lecture seule — à utiliser quand même une interaction bornée et
  sans navigation est malvenue.
- **Politique de clic des scans authentifiés.** Quand une session `--storage-state` est
  chargée, la sonde de région live ne clique **pas** sur les boutons par défaut (même un clic
  sur `type="button"` peut déclencher une mutation côté serveur que l’assertion sur
  `location.href` ne peut pas voir). Remplissage/bascule s’exécutent toujours.
  **`--interact-clicks`** réactive explicitement les clics ; les scans non authentifiés gardent
  les clics actifs. Défense en profondeur par-dessus : un bouton dont le nom accessible
  correspond à un verbe destructeur/d’envoi (delete, remove, send, submit, confirm, pay…) n’est
  **jamais** cliqué, dans aucun des deux modes.

## Construire l’échantillon à partir du site (`pages discover`)

Le crawler et le parseur de sitemap alimentaient un scan et rien d’autre : aucun artefact
n’était persisté, si bien que le contrat multipage restait un bloc `sample.pages` écrit à la
main — l’étape même qui empêche les gens d’auditer plus d’une page. `pages discover` l’écrit :

```
node scripts/ultra11y.mjs pages discover --crawl http://localhost:3000 --max 20      # print the proposal
node scripts/ultra11y.mjs pages discover --sitemap https://example.com/sitemap.xml --write
node scripts/ultra11y.mjs pages discover --from-snapshots --write                   # from what your tests already captured
```

`--from-snapshots` lit `.ultra11y/pages` au lieu du réseau, et c’est la seule voie qui puisse
voir une page **atteinte par un état** : une modale ou une étape de tunnel derrière une
transition côté client n’a pas d’URL vers laquelle explorer, mais un test Playwright qui
appelle `checkA11y` y est déjà passé.

Chaque page reçoit un id stable tiré de son chemin d’URL et un **nom lu dans le `<title>`
servi** — ce qu’un humain lit dans le rapport — avec repli sur un chemin rendu lisible quand le
document n’en a pas. Les réponses du crawl lui-même sont mémoïsées, donc les titres ne coûtent
aucune requête supplémentaire.

`--write` **fusionne** : une page déjà déclarée est conservée telle quelle, car `auth`,
`storageState` et `notes` sont du travail humain — quelqu’un a trouvé comment atteindre cette
page — et relancer la découverte ne doit jamais le détruire. Seules les URL réellement
nouvelles sont ajoutées, les ids reçoivent un suffixe plutôt que d’entrer en collision, et le
résultat est validé *avant* l’écriture du fichier (un bloc malformé casserait tous les
`scan --sample` ultérieurs sans le moindre indice sur la cause).

Une SPA rendue côté client n’expose pas ses routes dans le HTML servi ; utilisez-y un sitemap.

**L’inventaire des routes.** `--write` consigne aussi chaque URL découverte dans
`.ultra11y/routes.json` (union entre les exécutions, indexée par chemin, de sorte que l’hôte de
production du sitemap et le `localhost` de l’exécution E2E désignent la même route).
`--routes-only` consigne l’inventaire seul et laisse l’échantillon intact. Une fois
l’inventaire présent, `audit` et `scan --merge` renseignent `scope.routes`, et l’annexe liste
chaque route (section F) comme capturée (E2E), scannée, code source uniquement, ou non
atteinte.

## Scanner un échantillon de pages normatif (`scan --sample`)

Un vrai audit selon un référentiel national porte sur un **échantillon de pages** déclaré, pas
sur une seule URL. Déclarez-le à la main, ou laissez `pages discover` ci-dessus l’écrire.
Ensuite :

```
node scripts/ultra11y.mjs sample check                                   # lint the sample's coverage vs the standard's required kinds
node scripts/ultra11y.mjs scan --sample --cwd packages/app --merge audits/audit-latest.json --out audits
```

`scan --sample` parcourt chaque page configurée de l’échantillon (`--storage-state` par page
pris en charge pour les pages authentifiées), conserve comme provenance le **nom de page +
indicateur d’authentification** d’origine de chaque constat (repris dans les rubriques *Pages /
URLs impactées* et *Contexte de reproduction* du ticket de l’auditeur), et les fusionne
(`--merge`) dans l’audit. `sample check` est un lint **consultatif** — il signale les types de
pages requis qui manquent à l’échantillon (un bloc `sample` malformé est une erreur bloquante,
code de sortie 2 ; un bloc simplement incomplet est une indication, code de sortie 0). Voir
`references/audit.md` (notion d’échantillon) et `references/standards.md`.

**Il vérifie LES DEUX inventaires.** Un projet qui fait tourner le producteur E2E en tient
deux : `.ultra11yrc.json`, et les routes que ses tests capturent réellement en instantané. Ils
divergent — et un linter qui ne lisait que la liste déclarée a un jour déclaré un échantillon
« complet » pour une configuration qui omettait l’URL même sur laquelle un audit de
certification avait été mené. `sample check` affiche désormais d’abord le recensement, sans
condition :

```
17 déclarée(s) · 38 instantanée(s) · 22 instantanée(s) non déclarée(s) · 1 déclarée(s) jamais capturée(s)
```

Les types requis sont vérifiés sur l’**union**, et « Échantillon complet » n’est jamais affiché
seul tant que des pages capturées en instantané manquent dans l’échantillon déclaré — si bien
que le verdict ne peut pas se lire comme une affirmation sur un inventaire qu’il n’a pas vu.
`pages discover --from-snapshots --write` les y intègre.

L’issue à l’origine de ce point proposait aussi une recette `via` sur une page de
l’échantillon (profil d’authentification, chemin, étapes d’interaction nommées). Elle n’est
volontairement **pas** implémentée : rien dans le moteur ne pourrait l’exécuter — chaque chemin
navigateur ne fait que des `goto` — et un DSL d’étapes en JSON réimplémenterait, en moins bien,
ce que fait déjà une spec Playwright qui appelle `checkA11y`.

### L’échantillon, puis toutes les autres routes (`--all-routes`)

```
node scripts/ultra11y.mjs scan --sample --all-routes --max-routes 100 --merge audits/audit-latest.json --out audits
```

`--all-routes` lit l’inventaire et scanne, après l’échantillon, chaque route que l’échantillon
ne contient pas. Il ignore une route que l’exécution E2E a déjà capturée, car cette capture
contient l’état construit par les tests. Au plus `--max-routes` routes sont scannées (50 par
défaut). Sans `--sample`, il scanne l’inventaire seul. Les routes supplémentaires sont
consignées et auditées comme des pages, mais elles ne rejoignent pas l’échantillon déclaré.
Chacune est étiquetée « hors échantillon » dans l’annexe. Une route laissée de côté par la
borne, ou que le scan a refusée (redirection, erreur HTTP, échec du navigateur), est listée
comme non atteinte avec sa raison.

### Couvrir tout le site : le crawl n’est pas borné par défaut

`--max` et `--depth` bornent le crawl **quand vous le leur demandez** ; absents — ou à `0` —
il n’y a aucune borne. Un balayage qui s’arrêtait silencieusement à 50 pages produisait un
rapport simplement PLUS COURT que le site, et un livrable plus court se lit exactement comme un
livrable complet. L’arrêt ne dépend pas du plafond : la frontière ne quitte jamais l’origine et
chaque URL est dédoublonnée par sa forme canonique, si bien qu’un cycle (ou un site qui pointe à
la fois vers `/` et `/index.html`) n’est visité qu’une fois.

Chaque page atteinte est annoncée sur stderr avec son compteur courant, si bien qu’un crawl non
borné n’est jamais une tâche qui a simplement l’air bloquée — et `--json` sur stdout reste
lisible par une machine.

```
node scripts/ultra11y.mjs scan --crawl https://example.com --json          # the whole site
node scripts/ultra11y.mjs scan --crawl https://example.com --max 50        # bound it explicitly
```

Un crawl suit les liens du HTML servi, y compris ceux qui ne sont pas des pages : un listing de
répertoire qui pointe vers un fichier `.tsx` fait démarrer au navigateur un téléchargement au
lieu d’une navigation, et le scan s’arrête là. Pointez `--crawl` vers une vraie page d’entrée,
ou passez les URL.

## Chaque page scannée est aussi un SNAPSHOT

`scan` ne conserve pas seulement des constats : chaque page qu’il visite est persistée dans
`.ultra11y/pages/<id>/` (DOM + styles calculés + boîtes + feuilles de style + une capture
d’écran du viewport). Le navigateur est déjà sur la page, donc cela coûte un `evaluate`.
`--no-snapshot` le désactive ; `--root <dir>` déplace l’arborescence (par défaut : le
répertoire de travail — `--cwd` est l’endroit depuis lequel Playwright est résolu, pas celui
où arrivent les instantanés).

### …et les documents PDF vers lesquels pointent ces pages

Une fois les pages enregistrées, `scan` télécharge les **candidats documents de même origine**
de chaque page capturée (résolus par rapport à l’URL de la page et à son `<base>`) dans
`.ultra11y/documents/<sha256>.pdf`, à côté d’un fichier annexe `<sha256>.json`
(`kind: "ultra11y-document"`, `v: 1`, l’URL et **chaque page qui pointe vers lui** — le
lecteur ignore tout autre `.json`). Un lien est candidat quand :

- son chemin se termine par `.pdf`, ou il déclare `type="application/pdf"` ;
- c’est un `<a download>` ;
- son texte visible, son `aria-label` ou son `title` nomme le format (`PDF` comme un mot : « Télécharger (PDF) ») ;
- son chemin ou sa query le nomme comme un jeton (`/api/declaration-pdf?year=2026`, `?format=pdf` — pas `/pdfs/`).

Un candidat n’est un document qu’une fois que la réponse le prouve : `Content-Type: application/pdf`
ou un en-tête `%PDF-`. Tout le reste — une page de connexion, un CSV derrière `download` — est
signalé « not a PDF » avec le type de la réponse, jamais audité. Borné : au plus 20 documents
par exécution (`--max-pdf <n>`), 20 Mio chacun. Les liens tiers ne sont jamais demandés, et
**chaque saut de redirection est vérifié avant d’être suivi** — même origine, ou sa montée
http→https, 5 sauts au plus — si bien qu’une redirection vers un autre hôte (une adresse de
métadonnées, un intranet) est refusée sans être demandée. Les documents d’une page locale ne
sont lus que depuis son propre répertoire (un fichier ordinaire, liens symboliques résolus). Un
mauvais lien est un refus, jamais la fin du scan. `--no-pdf` le désactive. Chaque refus est
affiché avec sa raison.

**Derrière une connexion.** Avec `--storage-state <file>` (ou le `storageState` propre d’une
page de l’échantillon), les cookies de ce fichier de session qui correspondent à l’URL du
document — domaine (hôte seul ou `.domain`), chemin, `secure` (https, ou un hôte de bouclage),
expiration — accompagnent la requête, comme le navigateur les a envoyés pour la page. Ils ne
sont envoyés qu’à l’origine auditée et ne sont écrits nulle part. La fixture Playwright
télécharge plutôt via le contexte de requêtes propre au test (`references/e2e.md`).

L’audit des instantanés les lit ensuite avec le lecteur PDF sans dépendance propre au moteur
(`src/parse/pdf.ts`), et un `audit` ultérieur réingère `.ultra11y/documents/*.pdf` hors ligne.
Chaque constat sur un document est attribué aux pages qui pointent vers ce document — en RGAA,
une preuve candidate pour 13.3 sur ces pages (`references/rgaa-review.md`). Sans session, un
document authentifié renvoie sa page de connexion, est refusé « not a PDF », et reste à juger à
la main.

### …et ce qu’il a MESURÉ, pas seulement ce qu’il a vu

L’instantané porte aussi `probes.json` et `axe.json` : quels critères de succès les sondes en
direct ont réellement exécutés sur cette page, et la passe axe qui a tourné à côté. C’est la
moitié qui tranche quoi que ce soit, et elle était auparavant jetée au moment de l’écriture.

La conséquence était étroite et coûteuse. `renderedProvesOn` (`src/coverage.ts`) accorde un
verdict conforme à partir de `pageCoverage.scs` / `.axe`, tous deux dérivés de ces deux
fichiers, si bien qu’une page scannée pouvait rapporter une **violation** de rendu mais ne
pouvait jamais conclure à la **conformité** : 1.4.4, 1.4.10, 1.4.12 n’ont aucune règle hors
ligne, et le juge canonique de 1.4.3 est axe. Sur une vraie exécution RGAA, 3.2 / 10.4 / 10.11
/ 10.12 sont revenus « à évaluer » sur une page que les sondes avaient zoomée, redistribuée et
parcourue à la tabulation.

`probed` est le champ porteur et il est écrit honnêtement : une sonde qui a levé une
exception, un viewport qui n’a pas voulu se redimensionner, une surcharge d’espacement du texte
qui n’a pas voulu s’appliquer — aucun n’y arrive. Le redimensionnement à 320 px et la surcharge
d’espacement font partie de leur propre mesure, donc une sonde lue au mauvais viewport n’est
pas consignée (et ne lève jamais une non-conformité de redistribution mesurée à 1280 px).

Mesuré sur une fixture de deux fichiers : **80 critères à arbitrer à partir de la source
seule, 41 dès qu’une seule page a été scannée.**

Cet artefact n’est pas une commodité — c’est lui qui fait d’une URL un vrai verdict par page :

- **Sans lui, une page scannée ne peut jamais être conforme.** `src/pages.ts` n’accorde `C`
  par silence qu’à une page dont le vrai DOM a été soumis aux règles statiques
  (`basis: "snapshot"`) ; une page connue seulement par son URL reste `basis: "attributed"` et
  ses critères restent « à évaluer » pour toujours. Un audit piloté par sitemap a produit une
  grille presque vide.
- **Les règles à l’échelle de la page s’exécutent enfin.** Un instantané est un document
  complet, donc RGAA **8.3** (`lang`), **8.4**, **8.5/8.6** (`title`) et 12.6 (`main`)
  deviennent décidables — aucun d’eux ne peut être jugé à partir d’un rendu de composant, ni à
  partir de la source dès qu’un framework injecte la coquille du document.
- **Il capture ce que JavaScript a construit.** Un lien, un dialogue ou une nav injecté à
  l’exécution n’existe dans aucun fichier source ; il existe dans l’instantané, et les règles
  statiques ordinaires le voient.
- **Il se ré-audite hors ligne.** `audit` ingère `.ultra11y/pages` automatiquement, sans
  navigateur et sans serveur en marche — c’est ainsi que la CI tranche ces critères sans
  démarrer l’application.

La collecte a lieu sur la page **intacte** : avant qu’axe injecte sa source, avant qu’une sonde
remplisse un champ, redimensionne le viewport à 320px ou greffe la feuille de style
d’espacement du texte. Collecté plus tard, l’instantané enregistrerait notre propre
instrumentation au lieu du site.

Avec `--merge`, les instantanés fraîchement écrits sont audités et intégrés au résultat dans la
même exécution, et `scope.pages` est consigné — si bien que `pages` et `report` parlent page
par page immédiatement, pas au prochain `audit`.

## Rendre AVANT d’arbitrer

Un critère `needs-rendering` confié à un arbitre sur un audit à partir de la source seule n’a
qu’une seule réponse honnête, `needs-rendered-dom`, et l’obtenir coûte une passe de modèle.
Mesuré sur une cascade RGAA avec clé : trois passes, 311 tours et 24,90 $, pour finir avec sept
critères correctement signalés comme demandant un DOM rendu — sur un workflow qui n’avait
capturé aucun instantané.

Deux surfaces le disent désormais avant que l’argent soit dépensé, et aucune ne devine :

- **`verify --manual`** les nomme dans le journal et dans `ADJUDICATE.md` quand la liste de
  travail contient des critères de rendu et qu’aucun vrai DOM de page n’a été lu. Consultatif :
  un audit à partir de la source seule est une chose légitime à vouloir.
- **`check --in <audit.json> --require-rendered`** en fait un garde-fou, de la même famille que
  `--require-decided` (chaque critère a un verdict) et `--require-sample` (chaque page déclarée
  a été examinée). Il interroge l’INSTRUMENT, jamais la réponse : une exécution qui a rendu une
  page et n’a toujours pas pu trancher 1.4.5 passe — c’est le résidu honnête, et échouer
  là-dessus pousserait un projet à fabriquer un verdict. Il respecte `--allow-undecided`.

`orchestrate` reporte le même avertissement dans `RUNBOOK.md`, au-dessus du tableau des
phases, avec la commande de scan déjà écrite.

## Limites

Même avec les sondes locales, l’**ordre de lecture**, la **pertinence des alternatives** et les
autres critères qui demandent un jugement reviennent à l’agent IA, qui les arbitre (soumis au
garde-fou, `verify --manual`), et non au niveau dynamique. Les sondes réduisent — sans
l’éliminer — le résidu sur 2.4.7/1.4.4/1.4.12/1.4.13/2.5.8 : confirmez un échantillon à l’écran
(supervision humaine optionnelle). pa11y peut être ajouté comme seconde source si besoin.

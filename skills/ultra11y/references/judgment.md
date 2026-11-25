# Phase de jugement (les critères que l’agent IA arbitre)

Le moteur décide le sous-ensemble vérifiable par la machine ; l’**agent de code actif**
*arbitre lui-même le reste*, sous garde-fou : les critères de **jugement** (pertinence de l’alt,
fonction du lien dans son contexte, ordre de lecture), il les tranche **statiquement, à partir
des preuves que le moteur récolte** ; les critères de **rendu** (contraste calculé, focus
visible, zoom/reflow, contenu au survol), il les envoie au niveau `scan` (jamais aux sources) ;
et il vérifie de façon contradictoire les non-conformités détectées. Cette phase rend chaque
verdict défendable et enregistré, jamais inventé, jamais « conforme » en silence.

## Boucle d’arbitrage (les critères résiduels/manuels) — `verify --manual`

1. **Récoltez la liste de travail** depuis le cwd de l’audit (la récolte relit les fichiers
   sources audités) :
   ```
   node scripts/ultra11y.mjs verify --report audits/rgaa-YYYY-MM-DD.md --in audit.json --manual --out .
   ```
   écrit une **liste de travail d’ARBITRAGE** — `ADJUDICATE.todo.json` + `ADJUDICATE.md`, un item
   par critère résiduel (`manual`), chacun **pré-chargé avec les preuves récoltées** : l’`alt` de
   chaque image, le texte + le contexte de chaque lien, les paires de couleurs littérales, les
   étiquettes des contrôles, le plan des titres, l’état ARIA, `tabindex`, les changements de
   langue.
2. **Tranchez chaque item**, en remplissant son `verdict` dans `ADJUDICATE.todo.json` (la
   provenance `decidedBy: "agent"` est enregistrée). Avec un shell, c’est le seul fichier que
   vous écrivez — voir « Quand l’arbitre n’a pas de shell » pour son jumeau sans preuves :
   - `C` — conforme, avec une `justification` tirée des preuves **et** des `citations[]` nommant
     les preuves que vous avez validées (forme ci-dessous) ;
   - `NC` — non conforme, avec ≥1 constat **ancrable** (`file`/`line`/`message`/`snippet`)
     **ET un `normativeRef`** citant le test précis en échec du *référentiel actif* (une
     technique/un critère de succès WCAG, ou un numéro de test RGAA sous `--standard rgaa`). Le
     repli rejette un `normativeRef` absent, ou qui ne se résout pas vers un vrai test du
     référentiel actif (anti-fabrication) — une non-conformité doit toujours nommer la règle
     normative qu’elle enfreint ;
   - `NA` — non applicable, avec une `justification` (et des `citations[]` chaque fois que des
     preuves ont été présentées, pour dire quels items sortent du périmètre) ;
   - `manual` — indécidable à partir de ce qui est capturé, avec une `reason` :
     `"needs-rendered-dom"` (décider via `scan`) ou `"undecidable"`.
   - `recommendations[]` — une **bonne pratique sans test normatif en échec** (par ex.
     « indiquer le format/le poids d’un lien de téléchargement », « un seul `<h1>` par page »)
     n’est PAS une NC : enregistrez-la comme recommandation non normative (ancrable exactement
     comme une NC, mais **sans `normativeRef` requis**). Chaque entrée est un **objet**
     `{ file, line, message, selector?, snippet? }`
     dont `file`/`line`/`snippet` sont copiés depuis les preuves propres au critère — une phrase
     nue, ou un objet sans `file`, est refusée (le `requires.recommendations` du contrat). Elle est rendue sous « Recommandations (non normatives) » et ne fait jamais
     basculer le critère en NC. Une préoccupation purement UX n’est ni une NC ni une
     recommandation — laissez-la de côté.
   **`citations[]`** est un tableau d’ancres, une par élément de preuve récoltée sur lequel
   repose le verdict :
   ```jsonc
   "citations": [
     { "file": "site/index.html", "line": 42, "selector": "img.hero", "snippet": "<img class=\"hero\" src=\"hero.png\" alt=\"Un randonneur sur une crête\">" }
   ]
   ```
   Copiez `file`, `line`, `selector` et `snippet` **depuis l’entrée de preuve de ce critère**
   plutôt que de retaper l’élément : le repli n’accepte une ancre que si elle fait partie des
   ancres récoltées propres au critère (n’importe quelle occurrence d’une classe de contenu, y
   compris son `alsoAt`), et ancre le `snippet` dans la source. Un `C` sans citation, ou citant
   une preuve qui n’a jamais été montrée pour ce critère, est refusé ; un critère présenté
   **sans** preuve ne peut pas du tout être `C` — enregistrez `manual` (`undecidable`) avec ce
   que vous avez vérifié.
3. **Repliez en FAIL-CLOSED** (ajoutez `--ledger` pour enregistrer les verdicts acceptés, afin
   qu’un `verify --apply VERIFY.todo.json … --prune --ledger` ultérieur puisse les réparer et
   qu’une exécution ultérieure puisse les rejouer) :
   ```
   node scripts/ultra11y.mjs verify --apply ADJUDICATE.todo.json --in audit.json --out . --ledger
   ```
   rejette un verdict nul, un `C`/`NA` sans `justification`, un `NC` sans constat ancrable
   **ou sans `normativeRef` qui se résout**, un `manual` sans `reason`, ou tout critère résiduel
   non couvert. Les `NC` de l’agent deviennent de vrais constats `agent:<sc>` qui sont rendus à
   nouveau dans le §2 du rapport et réintègrent la liste de travail de verify ; `report`/`prd`
   sont rendus à nouveau avec les statuts arbitrés ; le §5 se réduit aux seuls items encore
   `manual`.

### Le protocole de décision

Chaque critère résiduel de `ADJUDICATE.md` est pré-chargé, à côté des preuves récoltées, avec
son **protocole de décision** (`src/data/adjudication.json`, dans les deux langues, couvrant LES
52 critères que le moteur ne peut pas décider) :

- **la règle de décision** — ce qui rend ce critère Conforme ou Non conforme. Pas un indice :
  la règle que vous appliquez. Un critère transmis sans règle énoncée, c’est là qu’un audit se
  transforme discrètement en opinion ;
- **quand `NA` est légitime** — pour que « non applicable » soit un verdict justifié plutôt
  qu’une échappatoire ;
- **les questions** qu’un auditeur se pose pour y arriver ;
- **les références citables** — les techniques et échecs W3C de ce critère, c’est-à-dire
  exactement l’ensemble dont un `normativeRef` peut provenir. `verify --apply` rejette une
  référence qui ne se résout pas, donc proposer les références valides est ce qui empêche une
  citation inventée.

Le même protocole est publié comme page autonome, `references/adjudication.md`, générée à
partir de ce jeu de données — lisez-la quand vous voulez la vue d’ensemble plutôt qu’un seul
item de la liste de travail.

**Il est indexé par critère de succès WCAG, et ce n’est pas l’instrument.** Un critère RGAA a
le sien — voir la section suivante. Il n’est hérité via la
table de correspondance que par un critère de pack qui n’en porte aucun, et le brief le dit
quand c’est le cas : un critère de succès pose couramment une question plus large que le
critère qui lui est rattaché.
Ce sont des invites, pas des verdicts : vous répondez toujours à partir des preuves et
enregistrez `C`/`NC`/`NA`/`manual` (+ une recommandation lorsqu’une bonne pratique n’a pas de
test normatif en échec).
4. **Rendu requis** : un item `manual` marqué `needs-rendered-dom` (contraste calculé, focus
   visible, zoom 200 %, reflow à 320px, contenu au survol) se décide sur le **rendu** (le niveau
   `scan`, ou l’inspection) — jamais à partir de la source.
5. **Code de bibliothèque (DSFR…)** : un `<Button>`/`<Card>` ne montre pas son HTML dans la
   source. Arbitrez sur le HTML **produit** (voir `render` / auditer le build), sinon le verdict
   est un faux négatif.

## Quand l’arbitre n’a pas de shell (CI)

`verify --manual` écrit la liste de travail **deux fois**, plus un brief par critère :

| fichier | pour |
|---|---|
| `ADJUDICATE.todo.json` · `ADJUDICATE.md` | une session **avec un shell** (Claude Code, Codex, OpenCode…) : preuves en ligne, remplissez `ADJUDICATE.todo.json` sur place, repliez vous-même |
| `ADJUDICATE.verdicts.json` | le **seul fichier à écrire** quand vous n’avez pas de shell — des verdicts, pas de preuves |

Remplissez exactement l’un des deux. `verify --apply` accepte l’un ou l’autre et exécute le même
repli, donc le choix dépend de ce qui convient à votre contexte, jamais de ce que vérifie le
garde-fou.
| `adjudicate/<criteriaId>.md` | un petit brief par critère : ses preuves, la formulation et les tests propres au critère (avec la méthodologie de test du référentiel), les termes de son glossaire et ses tests citables |
| `ADJUDICATE.contract.md` | le contrat de verdict commun à tous les briefs, écrit une seule fois : verdicts et champs exigés, règles de citation et d’absence, gravité, comment statuer page par page, ids des pages auditées. Chaque brief y renvoie au lieu de le répéter |

Pourquoi cette séparation existe, mesuré plutôt que supposé : sous le RGAA, jusqu’à 92 critères
portent des tests de jugement. Une liste de travail mesurée portait 1590 ancres récoltées —
**536 Ko** de JSON et **466 Ko** de Markdown. Un agent doté de
`Read/Grep/Glob/Edit/Write` ne peut pas travailler avec ça : lire l’un ou l’autre document
noie son contexte, et remplir 96 verdicts dans un demi-mégaoctet représente 96 éditions à
correspondance exacte. Une vraie exécution en CI a consommé 75 de ses 424 tours, s’est heurtée
à 17 refus de permission en essayant de lancer les commandes que le runbook prescrit, et a
rendu le fichier intact — le repli fail-closed a donc écarté les 96 verdicts et chaque critère
est resté « à évaluer », dans un job qui a signalé un succès. Le fichier de verdicts fait
**37 Ko** pour la même liste de travail, et chaque brief quelques Ko.

`verify --apply` accepte l’un ou l’autre fichier. Avec celui qui ne contient que les verdicts,
il **redérive les preuves à partir de l’audit** (la liste de travail est une fonction pure de
l’audit) puis exécute le même repli à l’identique : mêmes contrôles de couverture dans les deux
sens, même appariement des citations avec les ancres propres à *ce critère*, mêmes refus. La
surface réduite n’achète rien au garde-fou — un `C` qui cite une ancre qu’on ne lui a jamais
montrée est refusé exactement comme avant.

## Vérification contradictoire des affirmations — `verify --report`

`node scripts/ultra11y.mjs verify --report audits/rgaa-YYYY-MM-DD.md --in audit.json` écrit
`VERIFY.md` + `VERIFY.todo.json`, une entrée par non-conformité détectée, chacune ancrée dans la
**référence W3C Understanding du critère de succès WCAG** + ses techniques — et une par `C`/`NA`
affirmé par l’agent (`kind: "c"`, portant ses `citations[]`). `VERIFY.todo.json` est un simple
tableau JSON (alors que `ADJUDICATE.todo.json` est un objet avec `items`) ; remplissez `verdict`
et `note` dans chaque entrée. La moitié « conformités » n’est pas plafonnée sauf si vous passez
`--max-verify` ; passez `--max-verify 0` pour lever aussi le plafond de 40 items sur les
non-conformités. Passez le même `--in` (et le même `--standard`) à la génération et à
`--apply` : sans lui, et sans registre dans le répertoire, la liste ne voit jamais les
conformités arbitrées (la génération avertit ; `VERIFY.context.json` enregistre le contexte pour
que `--apply` puisse nommer une source discordante plutôt qu’un plafond). Tranchez chacune, en ouvrant le fichier à
la ligne citée :
- `supported` — la non-conformité est réelle et correctement rattachée ;
- `partial` — réelle mais le critère/la formulation est imprécis ;
- `refuted` — fausse (l’élément cité est en fait conforme) ;
- `unsupported` — l’élément cité ne suffit pas pour décider.

Ensuite `node scripts/ultra11y.mjs verify --apply VERIFY.todo.json --report <md> --in audit.json`
repasse au vert (échoue sur tout verdict `refuted`/`unsupported`/manquant). `--prune --out <dir>`
applique plutôt le résultat : les non-conformités réfutées sont supprimées, les conformités
réfutées ou jamais éprouvées renvoient leur critère à « à évaluer » (jamais à NC), et `--ledger`
répare le registre de la même façon — en le créant, avec un avis, s’il n’existe pas encore.
`--semantic` intègre le contrôle de support dans la même passe.

> Pour la grille de tests propre au RGAA, `criteria <id>` montre les tests RGAA
> derrière un critère de succès WCAG. La liste de contrôle avant achèvement vous empêche de
> conclure trop tôt. La règle qui ne plie jamais : aucun critère résiduel n’atteint `C` sans
> une justification enregistrée et passée par le garde-fou.

## Sous un référentiel national, la liste de travail parle ce référentiel

`verify --manual --standard rgaa` indexe la liste de travail par **critères RGAA**, et non par
critères de succès WCAG — c’est la granularité qui compte, puisque 97 des 106 critères du RGAA
portent des tests de jugement et peuvent encore demander un arbitrage pour obtenir C. Chaque
item porte, en ligne :

Au total, **104 des 106 critères du RGAA** demandent encore un arbitrage pour obtenir C. Parmi
eux, 92 portent des tests de jugement explicites ; 11 autres ont des détecteurs d’échec
déterministes mais pas de preuve positive complète.

- les **tests numérotés du critère, en entier** (`11.2.1` … `11.2.6`) — ce qui doit réellement
  être tranché ;
- sous chaque test, la **méthodologie de test officielle** du référentiel — la procédure qu’il
  publie pour ce test, étape par étape (le RGAA documente ses 258 tests). Le test énonce CE QUI
  est exigé ; elle énonce COMMENT c’est vérifié, dans les mots mêmes du référentiel. C’est la
  règle de décision sous un pack, et c’est pourquoi le protocole WCAG ci-dessus n’est pas
  emprunté ici ;
- un **⬤** sur les tests dont le MÉCANISME apparaît dans la source récoltée — la balise ou
  l’attribut que le test nomme lui-même, apparié au balisage que la récolte a réellement trouvé.
  Le RGAA 11.2 pose la même question sur six mécanismes d’étiquetage ; sur une page qui étiquette
  avec `<label>`, l’un des six est marqué. C’est **strictement additif** : un test non marqué
  n’affirme rien et reste à trancher par vous, et le brief le dit, parce qu’un arbitre qui saute
  un test qui s’applique bel et bien publie une fausse conformité qu’aucun garde-fou en aval ne
  peut rattraper ;
- sa **note technique** et ses **cas particuliers** ;
- ses **recommandations de mise en œuvre** (avant/après), auparavant réservées aux critères qui
  avaient déjà un constat ;
- les **définitions** des termes que citent ses propres tests, tirées du glossaire du
  référentiel.

**`normativeRef` doit citer l’un des tests PROPRES à l’item.** Ce n’est pas de la pédanterie :
un identifiant de test RGAA a la même forme `N.N.N` qu’un critère de succès WCAG, si bien qu’un
contrôle plus laxiste acceptait l’identifiant WCAG qu’un agent cite naturellement et le lisait
comme un test sans rapport — citer `1.4.3` (Contraste minimum) était validé comme le test RGAA
1.4.3, qui porte sur les images CAPTCHA. La liste de travail énumère désormais les références
acceptables pour chaque item, et tout le reste est rejeté.

Les verdicts se replient dans `packAdjudication`, pas sur les critères WCAG : une décision de
pack ne doit pas réécrire le verdict du cœur, et puisque le seul WCAG 1.1.1 se ramifie en 19
critères RGAA, replier par critère de succès laisserait ces critères s’écraser les uns les
autres.

Chaque brief cite aussi la **page officielle** de son critère
(`https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.2` pour le RGAA ; la
page W3C Understanding pour le cœur WCAG). L’URL est toujours imprimée — elle dit d’où vient le
texte embarqué. Que le brief vous *invite* aussi à aller la lire dépend du harness :
`verify --manual` le propose par défaut et le supprime sous CI, où l’arbitre dispose de
Read/Grep/Glob/Edit/Write et d’aucun réseau (`--web` / `--no-web` forcent l’un ou l’autre).

**Une recherche web ne peut lever qu’une ambiguïté de formulation.** Le texte embarqué est le
texte normatif et c’est lui qui décide ; une page que vous avez récupérée ne le contredit
jamais, n’élargit jamais un test, et n’est jamais un `normativeRef` acceptable — seules les
références que liste le brief le sont.

Cherchez un terme défini à part avec `criteria --glossary <term>`.

## Le repli, et qui tranche

Dans un agent de code, les critères de jugement sont arbitrés par l’agent : `verify --manual`
construit la liste de travail, l’agent tranche (directement, ou en répartissant entre des
sous-agents avec `orchestrate`, voir `references/orchestration.md`), et `verify --apply` replie
les verdicts à travers le garde-fou. Le moteur n’exécute aucun modèle qui lui soit propre :
quel que soit l’auteur d’un verdict, celui-ci atteint le même garde-fou `applyAdjudication`, et
un verdict ne peut pas affirmer une conformité que le garde-fou refuse :

| Il renvoie | Le garde-fou |
|---|---|
| `C`/`NA` sans justification | refuse CE critère |
| `NC` ne citant rien, ou un `file:line` qui ne se résout pas dans la vraie source | le refuse |
| `NC` citant un `normativeRef` appartenant à un autre critère | le refuse |
| `manual` sans raison | le refuse |
| un verdict pour un critère que personne n’a demandé | écarté avant d’atteindre le garde-fou |
| moins de verdicts que de critères (une passe partielle, un lot en échec) | les manquants restent « à évaluer » ; le reste est appliqué |
| tous `manual` avec raisons | **accepte** — c’est une réponse correcte, pas un échec |

**Le repli est fail-closed par VERDICT, pas par FICHIER.** Aucun verdict refusé n’est jamais
appliqué, et un refus coûte son propre critère et rien d’autre : ce critère reste « à évaluer »
en portant le refus comme raison, et chaque verdict qui a fait ses preuves est appliqué. Ce
n’est pas un assouplissement du garde-fou — chaque contrôle ci-dessus est inchangé — c’est un
changement du rayon d’impact, et il a été mesuré : une exécution en CI a rempli correctement 95
verdicts sur 96, un est revenu `null`, et l’ancien repli au niveau fichier a écarté les 96, si
bien qu’un arbitrage à 16 $ a publié « à évaluer » sur toute la grille dans un job qui a
signalé un succès.

Appliquer n’est pas réussir : un repli qui a refusé au moins un critère est **incomplet** et sort
en 1, l’audit partiel étant tout de même écrit. Seul un repli sans aucun refus sort en 0 — un appelant
qui ne lit que le code de sortie ne prend donc jamais 46 critères refusés pour un arbitrage abouti.
Les `manual` avec raison et les critères hors de la liste (`notInWorklist[]`) ne sont pas des refus.

`--strict` rétablit le repli tout-ou-rien pour un appelant qui le veut vraiment (un livrable
validé en une seule passe) ; dans ce cas, un arbitrage rejeté laisse `audit-latest.json` intact.

Tout ce qui est appliqué peut être ENREGISTRÉ avec `--ledger <path>` et rejoué lors d’une
exécution ultérieure sans modèle dans la boucle — voir `references/ci.md`.

Le référentiel est un choix de pipeline, pas une passe de comparaison supplémentaire. Avec
`--standard rgaa`, la liste de travail, les schémas, les identifiants de verdict et le repli
sont exclusivement RGAA ; WCAG reste une plomberie interne de correspondance et n’est pas
arbitré séparément.

**En CI.** Le bot `rgaa-audit` d’iterion transmet la liste de travail de `verify --manual` à des
agents en lecture seule, qui peuvent ouvrir les fichiers cités — la *fonction du lien dans son
contexte* a réellement besoin de la source environnante — puis replie leurs verdicts avec
`verify --apply`. Voir `references/ci.md`.

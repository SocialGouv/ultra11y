# CI : lancer le bot `rgaa-audit` d’iterion

ultra11y est une skill et un moteur. Il ne livre **aucune intégration CI qui lui soit propre** —
ni GitHub Action, ni template GitLab. Un audit d’accessibilité en CI passe par le
**bot `rgaa-audit`** de [SocialGouv/iterion](https://github.com/SocialGouv/iterion) :
[`bots/rgaa-audit`](https://github.com/SocialGouv/iterion/tree/main/bots/rgaa-audit).

Ce bot est le harness dont le moteur a besoin pour produire un vrai audit, pas une surcouche
autour de lui :

- il installe ce moteur depuis npm, **épinglé par version et par le sha256** de son fichier
  d’entrée, et refuse d’exécuter tout ce qui ne porte pas cette empreinte ;
- le moteur trouve : l’audit statique, l’échantillon de pages rendues, le rejeu du registre
  commité ;
- **des agents en lecture seule jugent** les critères qu’une passe statique ne peut pas décider
  — sous le RGAA, **104 sur 106** demandent encore un arbitrage pour obtenir C — un lot par
  thème, à partir des preuves que le moteur a récoltées ;
- un **second lecteur met chaque affirmation à l’épreuve**, conformités comprises, avant que le
  rapport soit écrit ; un contrôle humain optionnel approuve des critères ou les déclare
  indécidables ;
- le moteur refuse : son repli rejette un verdict non justifié, une conformité sans citation ou
  une non-conformité non ancrable, et `check` rejette un rapport qui cite ce qui ne se résout
  pas ;
- il ouvre une issue sur le tableau par critère non conforme, sans modèle dans la boucle.

La façon de le lancer, ses variables (`scope_globs`, `rendered`, `serve_command`,
`ledger_path`, `human_review`, `require_complete`, `post_to_board`…) et son budget sont
documentés dans le
[README du bot](https://github.com/SocialGouv/iterion/tree/main/bots/rgaa-audit#readme). Lisez
celui-ci, pas cette page, pour mettre en place la CI.

Une exécution nue du moteur dans un shell de CI n’est pas un audit : personne ne tranche les
critères de jugement, personne ne réfute, et la grille reste en grande partie « à évaluer ».
Dans un agent de code, la session est l’auditeur (`references/full-audit.md`) ; en CI, c’est le
bot.

## La CLI du moteur est le contrat stable

iterion pilote le moteur par sa CLI et rien d’autre, si bien que la CLI — ses commandes, ses
flags, ses codes de sortie et ses documents JSON — est le contrat qu’une release doit tenir. Le
bot s’appuie sur :

| Commande | Ce à quoi le bot l’utilise |
|---|---|
| `status --browser` | savoir si le niveau « rendu » se résout sur le runner |
| `audit --standard rgaa --json` (+ `--graph`, `--jsx`, `--exclude`, `--max-files`, `--staged` / `--changed` / `--since <ref>`) | L’ensemble des constats, écrit dans `audits/audit-latest.json` |
| `sample check` | vérifier l’échantillon de pages de `.ultra11yrc.json` au regard des types de pages requis par le référentiel |
| `scan --sample --merge <audit.json>` | rendre, capturer en instantané et replier l’échantillon de pages (`--storage-state` pour les pages derrière une connexion) |
| `verify --apply <ledger>` | rejouer le registre des verdicts commité (`.ultra11y/verdicts/<standard>.json`) — une re-vérification sur des preuves fraîches, jamais un simple hit de cache |
| `verify --manual` | la liste de travail d’arbitrage pour les critères encore « à évaluer » |
| `verify --apply <adjudication.json> --ledger <file>` | le repli fail-closed, qui enregistre les verdicts acceptés |
| `verify --report …` · `verify --apply <VERIFY.todo.json> --prune` | la contre-vérification : chaque affirmation écrite mise à l’épreuve, les réfutées retirées |
| `report` · `report --html` | le rapport de conformité daté, et son HTML imprimable |
| `check --report <md>` | le contrôle d’intégrité : chaque critère cité se résout, chaque NA est justifié |
| `check --in … --require-decided=pages [--allow-undecided <file>] [--require-rendered]` | les contrôles d’exhaustivité |
| `pages --in … --json --out <dir>` | la grille des critères par page (`pages.json`) |
| `tickets --in … --dry-run --transport rest` | le plan d’issues, une par critère non conforme |

Toute modification de l’une de ces commandes est un changement cassant pour le bot.
`orchestrate --manifest` décrit la même boucle sous forme de données pour n’importe quel
orchestrateur ; voir `references/orchestrators.md`.

Le moteur n’émet aucun rendu propre à la CI (pas de SARIF, pas d’annotations de workflow, pas
de commentaire de pull request) : le bot lit les documents JSON ci-dessus et publie ce qu’il
décide de publier.

## Comment ce dépôt se publie lui-même (npm trusted publishing)

Le workflow de release de ce dépôt ne détient **aucun token npm**. Il publie par OIDC : le job
demande à GitHub un id-token de courte durée (`permissions: id-token: write`) et l’échange
auprès de registry.npmjs.org contre un identifiant limité à ce paquet. Cela dépend d’un
**trusted publisher** configuré sur npmjs.com qui nomme ce dépôt et `release.yml`, et de **npm
>= 11.5.1** sur le runner (Node 24 livre une version 11.x plus ancienne, donc le workflow la
met à jour). Le paquet devait d’abord exister, si bien que la **première** publication a été
manuelle ; chaque release depuis se fait sans token. Si l’échange échoue,
`@semantic-release/npm` se rabat sur l’exigence d’un token — il ne publie jamais sans
authentification.

Chaque release est la version que le bot épingle : `ultra11y.pin` dans le répertoire du bot la
contient avec l’empreinte de son fichier d’entrée.

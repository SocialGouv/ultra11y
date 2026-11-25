# Tickets de tracker (`tickets`) — GitHub · GitLab · Jira

`tickets` lit un `AuditResult` et **le dépose dans un tracker**. Il n’écrit aucun Markdown.
`prd` et `report` écrivent du Markdown et ne déposent rien. Cette séparation est voulue :
auparavant, on ne pouvait pas pousser sans produire aussi un document, ni produire un
document sans risquer un push.

```
node scripts/ultra11y.mjs audit "src/**/*.tsx" --graph --out audit.json

node scripts/ultra11y.mjs tickets --in audit.json --dry-run                       # ALWAYS start here
node scripts/ultra11y.mjs tickets --in audit.json                                 # one ticket per criterion
node scripts/ultra11y.mjs tickets --in audit.json --grain page                    # one ticket per page
node scripts/ultra11y.mjs tickets --in audit.json --grain page-criterion          # one per page × criterion
node scripts/ultra11y.mjs tickets --in audit.json --grain single                  # one consolidated ticket
node scripts/ultra11y.mjs tickets --in audit.json --grain file                    # one ticket per source file
node scripts/ultra11y.mjs tickets --in audit.json --provider gitlab --standard rgaa --lang fr
node scripts/ultra11y.mjs tickets --in audit.json --provider jira --max-tickets 20
node scripts/ultra11y.mjs tickets --in audit.json --json                          # machine-readable plan + result
node scripts/ultra11y.mjs tickets --in audit.json --out ./run                     # the ticket SET as JSON, for any other board
```

## Déposer sur un tracker qu’ultra11y ne parle pas

`--out <dir>` écrit l’ensemble indépendant du tracker dans `<dir>/issues-<date>.json` — un
chemin stable qu’un moteur de workflow peut lire sans analyser une charge utile qui porte
aussi de la prose. Il fonctionne à tous les grains, porte `occurrences[]` pour qu’un tableau
avec ancres en ligne n’ait besoin de rien d’autre, et l’écrire **ne dépose rien**.
`schemaVersion` est ce qui permet à un consommateur de figer une version. Voir
`references/orchestrators.md`.

Le **corps** du ticket est le même bloc auditeur que celui que rendent le §2 de `report` et
le backlog `prd` (`src/auditor.ts`). Il n’y a qu’une seule vérité d’audit ; le tracker voit
exactement ce que dit le document.

## Granularité (`--grain`)

Ce qui compte comme UN ticket. Par défaut `criterion`.

| Grain | Un ticket correspond à | Titre |
|---|---|---|
| `criterion` | un critère, sur tout le périmètre | `[a11y] WCAG 1.1.1 — Non-text Content` |
| `single` | l’audit entier | `[a11y] WCAG — Accessibility audit` |
| `page` | une page et chaque non-conformité qu’elle porte | `[a11y] WCAG [page:accueil] — Accessibility audit` |
| `page-criterion` | un critère **sur** une page | `[a11y] WCAG [page:accueil] 1.1.1 — Non-text Content` |
| `file` | un fichier source | `[a11y] WCAG [file:src/Button.tsx] — Accessibility audit` |

`WCAG` devient le nom du pack avec `--standard` (`[a11y] RGAA 1.1 — …`). Une recommandation
non normative reçoit le suffixe ` (recommendation)` et l’étiquette `recommendation`, pour
qu’elle ne soit jamais triée comme une non-conformité.

Choisissez selon qui fait le travail : `criterion` convient à une personne qui corrige une
règle partout, `page`/`page-criterion` à une équipe propriétaire de pages, `file` au
propriétaire d’un composant, `single` à « un ticket de suivi, on travaillera à partir du
rapport ».

### Les grains par page conservent les règles d’honnêteté des pages

- Une page dont le vrai DOM rendu a été audité (`basis: snapshot`) peut être conforme. Une
  page assemblée uniquement par **attribution de source** (`basis: attributed`) ne le peut
  pas : son ticket porte l’avertissement que l’absence de constat n’est pas une conformité.
  Voir `references/pages.md`.
- Les constats qu’**aucune page ne peut revendiquer** (composants partagés, fichiers hors de
  toute route) reçoivent leur PROPRE ticket, `[a11y] WCAG [unattributed] — Accessibility audit`.
  Ils ne sont jamais abandonnés ni répartis entre les pages — les répartir inventerait des
  non-conformités.
- Sans **aucune page dans le périmètre**, `--grain page` sort en `1` et vous dit de capturer
  des instantanés de page (`ultra11y/playwright` · `ultra11y/cypress`) ou de scanner un
  échantillon (`scan --sample`). Il ne dépose jamais zéro ticket en silence.

Un ticket `file` ne porte aucun taux de conformité : un fichier n’est pas une page.

## Dédoublonnage — le titre EST la clé

Il n’y a ni marqueur caché, ni fichier d’état, ni table d’identifiants. Le **titre exact**
est l’identité, comparé côté client. C’est la seule clé qui survit aux trois trackers sans
rien persister, et cela signifie que relancer ne crée jamais de doublons.

Deux conséquences à connaître avant la première exécution :

- **Migrer depuis `--gh-issues` ne coûte rien.** Les titres `criterion` et `single` sont
  identiques à l’octet près à ceux d’avant la v3, donc les tickets déjà déposés sont reconnus
  et sautés.
- **`--lang` fait bifurquer le titre** pour les grains qui portent un intitulé de critère
  (`[a11y] WCAG 1.4.3 —
  Contrast (Minimum)` contre `— Contraste (minimum)`). Gardez `--lang` constant d’une
  exécution à l’autre sur un même tracker. Le CADRE n’est jamais localisé : "Accessibility
  audit" reste en anglais avec `--lang fr`, précisément pour qu’il ne puisse pas bifurquer.
- Renommer un répertoire d’instantanés change l’id de la page, donc le titre. Même réserve.

Si le tracker ne peut pas être listé (permissions, limite de débit), l’exécution se replie
sur la **création** plutôt que d’abandonner le backlog, et indique que le nombre de tickets
sautés n’est pas vérifié.

## Fournisseurs et transports

`--provider auto` (par défaut) lit `ULTRA11Y_TICKET_PROVIDER`, puis `.ultra11yrc.json`, puis
le remote git `origin`. **Jira n’est jamais détecté automatiquement** — il ne possède aucun
remote git — nommez-le donc.

`--transport auto` (par défaut) préfère la CLI, qui gère sa propre authentification pour
qu’ultra11y ne détienne jamais de token ; il se replie sur REST quand seul un token est
disponible, et dit ce qui manquait aux DEUX quand aucun ne fonctionne.

**REST ne fait pas doublon avec la CLI.** `gh` n’est fourni que sur les runners *hébergés*
par GitHub : les jobs en conteneur, les runners auto-hébergés et toute CI non GitHub ont un
token et pas de binaire. GHES fonctionne via `GITHUB_API_URL`, qu’Actions définit pour vous.

| | GitHub | GitLab | Jira |
|---|---|---|---|
| CLI | `gh` | `glab` | — (REST uniquement) |
| token | `GH_TOKEN` → `GITHUB_TOKEN` | `GITLAB_TOKEN` | `JIRA_EMAIL`+`JIRA_API_TOKEN` (Cloud) ou `JIRA_TOKEN` (Server/DC) |
| cible | `GITHUB_REPOSITORY` → `ULTRA11Y_GITHUB_REPO` → remote git | `CI_PROJECT_ID` → `ULTRA11Y_GITLAB_PROJECT` → remote git | `ULTRA11Y_JIRA_PROJECT` (la CLÉ du projet) |
| base de l’API | `GITHUB_API_URL` | `CI_API_V4_URL` | `ULTRA11Y_JIRA_URL` |

Également pour Jira : `ULTRA11Y_JIRA_ISSUE_TYPE` (par défaut `Task`) et `ULTRA11Y_JIRA_API`
(`2`|`3`).

**Les identifiants vivent uniquement dans l’environnement.** Une clé `token` / `apiToken` /
`password` / `secret` n’importe où dans le bloc `tickets` de la configuration est une erreur
bloquante (exit 2) — `.ultra11yrc.json` est commité, donc un token qui s’y trouve est un
token divulgué.

### Particularités de chaque tracker

- **GitHub** — l’endpoint des issues renvoie aussi les pull requests ; elles sont filtrées,
  si bien que le titre d’une PR ne peut jamais masquer un vrai ticket. Un `422` sur les
  étiquettes relance sans étiquettes plutôt que de perdre le ticket. Les corps sont tronqués
  à 65 536 caractères avec un renvoi vers le PRD.
- **GitLab** — `CI_JOB_TOKEN` **ne peut pas créer d’issues** ; quand c’est le token en jeu,
  l’échec le dit au lieu de renvoyer un simple 403. Les étiquettes manquantes sont créées
  automatiquement par GitLab.
- **Jira** — l’API v3 exige de l’ADF, pas du Markdown, donc le corps est rendu sous la forme
  d’un paragraphe ADF par ligne : le texte est fidèle, la mise en forme ne l’est pas.
  Définissez `ULTRA11Y_JIRA_API=2` pour l’endpoint v2 (chaîne simple) sur Server/DC. La
  sévérité correspond à la priorité (Highest/High/Low) ; un projet qui n’a pas configuré
  `priority` ou `labels` obtient une nouvelle tentative sans eux. Chaque ticket porte une
  étiquette constante `ultra11y` pour que la JQL de dédoublonnage puisse borner sa recherche
  — la JQL ne fait que restreindre les candidats, c’est toujours la correspondance exacte du
  titre qui décide.

## Garde-fous

- **`--max-tickets`** (200 par défaut) — `page-criterion` sur un gros audit RGAA monte à
  plusieurs centaines, et une création est difficile à annuler. Au-delà de la limite, la
  commande **refuse** et nomme l’échappatoire. Elle ne tronque jamais en silence.
- **`--dry-run`** — résout le transport, liste ce qui existe, affiche créer-ou-sauter, ne
  crée rien, sort en 0. Lancez-le d’abord, à chaque fois.
- **Codes de sortie** — `0` déposé/sauté/rien à déposer · `1` au moins une création a échoué,
  le fournisseur est inutilisable, ou `--grain page*` sans aucune page dans le périmètre ·
  `2` usage, configuration, ou le garde-fou `--max-tickets`.

Un fournisseur inutilisable sort en **1**, pas en 0. Une commande de push qui ne dépose rien
et rapporte du vert est un échec silencieux.

## Configuration

```jsonc
// .ultra11yrc.json — flags always win
{ "tickets": { "provider": "gitlab", "grain": "page", "maxTickets": 100 } }
```

## Migrer depuis `prd --gh-issues`

| Avant | Maintenant |
|---|---|
| `prd --in a.json --gh-issues` | `tickets --in a.json --provider github --grain criterion` |
| `prd --in a.json --gh-single` | `tickets --in a.json --provider github --grain single` |
| `prd --in a.json --out d --issues-json` | `tickets --in a.json --out d --grain criterion` |

Les trois anciens flags sortent désormais en `2` et affichent leur remplacement. `prd` écrit
toujours le même Markdown ; sa charge utile `--json` ne porte plus de clé `gh`.

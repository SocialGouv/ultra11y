# ultra11y — l’audit d’accessibilité RGAA 4.1.2

[![CI](https://github.com/SocialGouv/ultra11y/actions/workflows/ci.yml/badge.svg)](https://github.com/SocialGouv/ultra11y/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/ultra11y?logo=npm)](https://www.npmjs.com/package/ultra11y)
[![plugin](https://img.shields.io/badge/Claude_Code_·_Codex_·_OpenCode-plugin-6b46c1)](#installer)
[![node](https://img.shields.io/node/v/ultra11y)](https://nodejs.org)
[![licence](https://img.shields.io/npm/l/ultra11y)](LICENSE)

ultra11y audite un site selon le **RGAA 4.1.2**, le référentiel d’accessibilité de l’État.
C’est une *skill* pour votre agent de code (Claude Code, Codex, OpenCode) : vous demandez
un audit, l’agent le mène de bout en bout et vous remet un **rapport de conformité daté**.
**Il ne déclare jamais conforme ce qu’il n’a pas vérifié.**

Ce que vous obtenez :

- le rapport RGAA daté, en Markdown et en HTML imprimable ;
- la grille des **106 critères**, page par page, avec le taux de conformité de chaque page
  et le taux moyen de l’échantillon, les chiffres qu’attend une déclaration d’accessibilité ;
- un dossier par page, avec capture d’écran et chaque non-conformité illustrée ;
- sur demande, un backlog et des tickets GitHub, GitLab ou Jira.

Documentation complète : **[socialgouv.github.io/ultra11y](https://socialgouv.github.io/ultra11y/)**.

## Installer

| Agent | Installation |
|---|---|
| **Claude Code** | `/plugin marketplace add SocialGouv/ultra11y` puis `/plugin install ultra11y@ultra11y` |
| **Codex CLI** | `codex plugin marketplace add SocialGouv/ultra11y` puis `codex plugin add ultra11y@ultra11y` |
| **OpenCode** 1.x et 2.x | `npx ultra11y install --opencode` |
| **Autres agents** | `npx skills add SocialGouv/ultra11y` (les skills seules, sans hook) |

Le plugin apporte deux skills, `ultra11y` (l’audit complet) et `review-a11y` (la revue d’un
changement), et un **hook** : avant `git commit`, `git push` ou `gh pr create`, il audite le
diff et, s’il trouve un défaut, bloque la commande une fois pour que l’agent lance la revue.
Sur Codex, `npx ultra11y install --codex` active les hooks ; `npx ultra11y status` dit ce qui
est branché. Le couper : `SKIP_A11Y=1`, `ULTRA11Y_HOOK=off` ou `"hook": { "failOn": "off" }`
dans `.ultra11yrc.json`. Détails : [`references/harnesses.md`](skills/ultra11y/references/harnesses.md).

**La bibliothèque pour vos tests de bout en bout** (Node ≥ 22.18) : `npm i -D ultra11y`.

## Utiliser

**1. Demander un audit.** Dans l’agent : « audite ce site selon le RGAA ». La skill suit
[`references/full-audit.md`](skills/ultra11y/references/full-audit.md), le même parcours sur
tous les agents :

1. passage du moteur statique sur le code source ;
2. capture des pages rendues dans un vrai navigateur (axe-core, sondes de focus, zoom, survol),
   puis des parcours que l’agent écrit (connexion, formulaire, modale) et rejoue au clavier ;
3. arbitrage par l’agent des critères qui demandent un jugement, preuve à l’appui ;
4. contre-vérification de chaque NC, C et NA : une NC réfutée est retirée, un C ou un NA
   réfuté repart « à évaluer » ;
5. registre des verdicts, publication des livrables, puis contrôle par `check`.

**2. Capturer les pages depuis vos tests.** Le test audite la page dans l’état où il l’a
laissée (session connectée, formulaire rempli, modale ouverte). Chaque page est enregistrée
dans `.ultra11y/pages/<id>/` et sera réauditée hors ligne par l’audit complet.

```js
import { test } from "ultra11y/playwright";

test("accueil", async ({ page, ultra11y }) => {
  await page.goto("/");
  await ultra11y({ as: "accueil" });   // ou checkA11y(page, { as: "accueil" })
});
```

Cypress : `ultra11y(on)` dans `setupNodeEvents` (import depuis `ultra11y/cypress/plugin`),
`import "ultra11y/cypress"` dans le fichier de support, puis `cy.ultra11y({ as: "accueil" })`.
`sweepSample()` parcourt l’échantillon déclaré dans `.ultra11yrc.json`. Options :
[`references/e2e.md`](skills/ultra11y/references/e2e.md).

Composants : `npx ultra11y render .` rend chaque composant, page et story avec le
`react-dom/server` du projet, dans un harnais jetable, sans lire ni lancer ses tests. Les rendus
vont dans `.ultra11y/captures/` et `audit` les lit. Ce qui n’a pas pu être rendu (contexte
manquant, props, API du navigateur, chargement de données, délai) est listé avec la raison dans
l’annexe du rapport. Chaque rendu est ensuite ouvert dans Chromium, quand Playwright est
disponible : une capture d’écran et un passage d’axe-core, montrés dans le rapport
(`.ultra11y/render-snapshots/`). Ces rendus isolés illustrent le rapport sans jamais trancher
un critère ; `--no-snapshots` saute ce passage. Voir
[`references/rendered.md`](skills/ultra11y/references/rendered.md).

**3. Relire une pull request.** `npx ultra11y affected --since origin/main` liste les pages
qu’un changement peut atteindre, en remontant le graphe d’imports jusqu’aux routes.
`npx ultra11y scan --since origin/main --base-url <url> --baseline <scan.json>` ne rend que ces
pages et ne fait échouer la CI que sur les **nouvelles** non-conformités, absentes du `scan --json`
de la branche de base.

**4. En CI : le bot [`rgaa-audit` d’iterion](https://github.com/SocialGouv/iterion/tree/main/bots/rgaa-audit).**
Il installe le moteur à une version épinglée, rend l’échantillon de pages, fait arbitrer et
contre-vérifier les critères par des agents en lecture seule, contrôle le résultat avec `check`
et ouvre un ticket par critère non conforme. Voir [`references/ci.md`](skills/ultra11y/references/ci.md).

**Ce que le navigateur enregistre.** Sur chaque page mesurée et chaque étape de parcours, le
scan garde l’arbre d’accessibilité (`axtree.json`), ce qu’un lecteur d’écran annoncerait à
partir de cet arbre (`sr.json`), et l’inventaire des médias avec une mesure des flashs sur un
court enregistrement de la page (`media.json`). L’agent s’en sert comme preuves pour les
thématiques 4, 7, 11 et le critère 13.7. `npx ultra11y criteria --plan` donne le plan de
travail : pour chaque critère, la source de preuve qui le tranche (code, graphe entre
fichiers, page rendue, navigateur, jugement). Le rapport se termine par l’annexe I,
« Carte de l’application » : chaque route, et comment elle a été observée.

## Commandes

Le moteur en ligne de commande sert surtout à l’agent et au bot. Ce qu’une personne peut
lancer elle-même, avec `npx ultra11y <commande>` (tout le reste : `npx ultra11y --help`) :

| Commande | Rôle |
|---|---|
| `audit <chemins> --out audits --json` | passe le moteur statique sur le code |
| `render .` | rend les composants et les capture dans Chromium (`--no-snapshots` pour s’en passer) |
| `scan <url> --merge audits/audit-latest.json` | mesure une page dans un navigateur |
| `affected --since <ref>` | liste les pages qu’un changement atteint |
| `scan --since <ref> --base-url <url> --baseline <scan.json>` | ne rend que ces pages, échoue seulement sur les nouvelles non-conformités |
| `journey run --all --keyboard --merge audits/audit-latest.json` | rejoue au clavier les parcours écrits par l’agent ([`journeys.md`](skills/ultra11y/references/journeys.md)) |
| `report --in audits/audit-latest.json --html` | écrit le rapport daté |
| `pages --in audits/audit-latest.json --format report --split page` | un dossier par page |
| `serve` · `serve --static site` | consulte les résultats et leur historique en local, ou les exporte en pages statiques |
| `check --report <rapport.md>` | contrôle l’intégrité d’un rapport |
| `tickets --in audits/audit-latest.json --dry-run` | prépare les tickets GitHub, GitLab ou Jira |
| `criteria 8.3` | texte officiel d’un critère, ses tests, le glossaire |
| `criteria --plan` | le plan de travail : quelle source de preuve tranche chaque critère |
| `install --all` · `status` | branche le hook dans les agents, dit ce qui est actif |

### Thème DSFR des rapports HTML

`report --html`, `pages --html` et `serve` (y compris `--static`) ont une apparence neutre par
défaut. Un site en `.gouv.fr` qui utilise déjà le Système de design de l'État peut demander
`--theme dsfr` (ou `"html": { "theme": "dsfr" }` dans `.ultra11yrc.json`) :

```sh
npx ultra11y report --in audits/audit-latest.json --html --theme dsfr --root .
```

ultra11y **ne fournit pas le DSFR** : il lit `@gouvfr/dsfr` installé dans le projet audité
(résolu depuis `--root`), dont il intègre `dist/dsfr.min.css` et `dist/dsfr.print.min.css`
tels quels dans chaque page. Ses conditions d'utilisation réservent le DSFR aux sites en
`.gouv.fr` et le paquet demande de les accepter à l'installation (`.dsfr.yml`). Sans le paquet,
la commande s'arrête en code 2 et l'explique ; elle ne télécharge rien et ne revient pas au
thème neutre en silence. Le rapport n'affiche pas de bloc-marque : l'en-tête dit seulement
qu'il s'agit d'un audit généré par ultra11y. Détail dans `NOTICE`.

## Pourquoi s’y fier

- **Le silence ne vaut pas conformité.** Un critère que personne n’a vérifié reste « à
  évaluer ». Seuls 8.3 et 8.5 (langue et titre de la page) peuvent être déclarés conformes
  sur une mesure complète sans erreur :
  **104 critères sur 106 demandent un arbitrage pour obtenir `C`**.
- **Le moteur fait le travail mécanique** : 103 vérifications statiques, puis le rendu.
  Sur les 258 tests officiels, une règle tranche
  **32 tests `static` sur 23 critères** et **3 tests `rendered` sur 3 critères** ;
  les **223 tests `judgment` sur 92 critères** passent par l’agent.
- **Chaque verdict cite sa preuve.** `check` et `verify` rejettent un critère inventé, une
  non-conformité sans élément réel, un « conforme » sur des preuves incomplètes.
- **Mesuré sur un corpus qu’il n’a pas écrit** (W3C ACT). Chiffres et limites :
  [Couverture](https://socialgouv.github.io/ultra11y/couverture.html),
  [Fiabilité](https://socialgouv.github.io/ultra11y/fiabilite.html). Ce n’est pas une
  certification : avant une déclaration officielle, une personne compétente relit les verdicts.

## Référentiel

ultra11y audite selon le **RGAA 4.1.2**, et seulement lui : rapports, grilles, taux, tickets
et PRD parlent RGAA, par défaut (`--standard rgaa` reste accepté). Les WCAG 2.2 AA sont le
socle interne du moteur et n’apparaissent que comme la correspondance que cite chaque critère :
« RGAA 1.1 (WCAG 1.1.1) ». `--standard wcag` a été retiré et sort en code 2.

## Développement

```sh
pnpm install
pnpm test && pnpm run lint && pnpm run typecheck
pnpm run build            # moteur (scripts/ultra11y.mjs) et bibliothèque (dist/)
pnpm run check:build      # chaque artefact commité se reconstruit à l’identique
pnpm run build:site       # régénère les chiffres du site (site/)
pnpm run build:pack:rgaa  # reconstruit le paquet RGAA depuis la source DINUM
```

Les versions sont publiées par semantic-release à chaque push sur `main`, selon les
Conventional Commits : un commit sans préfixe `feat:` ou `fix:` ne déclenche aucune version.

## Données et licences

- Code d’ultra11y : **MIT** (voir `LICENSE`).
- Le **paquet RGAA** (`src/data/standards/rgaa.json`, `rgaa.glossary.json`) dérive du **RGAA 4.1.2**
  publié par la DINUM, sous **Licence Ouverte / Etalab 2.0**. Attribution : « RGAA 4.1.2 — DINUM ».
- Les critères **WCAG 2.2** (`src/data/wcag.json`) dérivent de la source officielle du W3C
  ([w3c/wcag](https://github.com/w3c/wcag)), © **W3C**, sous **W3C Document License**.
- Le format du rapport s’inspire des conventions d’audit de la DINUM et d’etalab-ia ; les règles
  d’écriture accessible sont adaptées de la skill SocialGouv. Aucun code source n’a été copié.
- Détail de chaque source et de chaque dépendance intégrée : `NOTICE`. Audit de maintenance et de sécurité des dépendances : [`docs/dependencies.md`](docs/dependencies.md).

# Audit des dépendances

Audit réalisé le **25 novembre 2026** (issue #213), sur ultra11y 9.0.2.
Objectif : ne garder que des bibliothèques très maintenues et sûres.

## Méthode

Pour chaque dépendance déclarée dans `package.json` (runtime et dev) :

| Mesure | Source |
| --- | --- |
| Téléchargements hebdomadaires | `curl https://api.npmjs.org/downloads/point/last-week/<pkg>` |
| Nombre de mainteneurs | `npm view <pkg> maintainers --json` |
| Dernière version et sa date | `npm view <pkg> dist-tags.latest` puis `npm view <pkg> time --json` |
| Version installée | `node_modules/<pkg>/package.json` (résolue par `pnpm-lock.yaml`) |
| Licence | `npm view <pkg> license` |
| Avis de sécurité (arbre complet) | `pnpm audit --json` et `pnpm audit --prod` |
| Avis de sécurité (paquet direct) | `gh api "/advisories?ecosystem=npm&affects=<pkg>&per_page=100"` |
| Usage dans le code | `grep -rn "<pkg>" src/` |

Une dépendance est jugée **faible** si elle cumule un seul mainteneur **et** aucune version
depuis plus de 18 mois, si elle porte un avis de sécurité non corrigé, ou si son usage est
minime et couvert par la bibliothèque standard de Node (`node:fs`, `node:util`…).

Les dépendances runtime sont toutes intégrées au bundle `scripts/ultra11y.mjs`
(`noExternal` dans `tsup.config.ts`), sauf `axe-core`, `@axe-core/playwright` et
`@playwright/test`, résolus à l'exécution depuis le projet audité ou depuis ultra11y.

## Dépendances runtime

| Paquet | Plage (avant → après) | Installée | Dernière (date) | Mainteneurs | Téléch./semaine | Licence | Avis | Usage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| axe-core | `4.13.0` (épinglée) | 4.13.0 | 4.14.1 (2026-11-16) | 4 | 120,7 M | MPL-2.0 | aucun | moteur navigateur, injecté dans la page (`src/axe-engine.ts`) |
| @axe-core/playwright | `^4.13.0` | 4.13.0 | 4.14.1 (2026-11-24) | 5 | 26,9 M | MPL-2.0 | aucun | `AxeBuilder` (`src/axe-engine.ts`, `src/scan-local.ts`) |
| @playwright/test | `^1.62.1` | 1.62.1 | 1.65.1 (2026-11-13) | 5 | 138,6 M | Apache-2.0 | aucun | navigateur du scan local et intégration Playwright (`src/scan-local.ts`, `src/integrations/playwright.ts`) |
| @babel/parser | `^8.0.0` | 8.0.0 | 8.1.3 (2026-11-20) | 4 | 391,7 M | MIT | aucun | AST JSX/TSX (`src/parse/jsx-ast.ts`) |
| htmlparser2 | `^12.0.0` | 12.0.0 | 12.0.0 (2026-03-20) | 1 | 146,7 M | MIT | aucun | parseur HTML (`src/parse/html.ts`) |
| domhandler | `^6.0.1` | 6.0.1 | 6.0.1 (2026-03-17) | 1 | 171,2 M | BSD-2-Clause | aucun | types du DOM de htmlparser2 (`src/parse/html.ts`, import de types seulement) |
| picomatch | `^4.0.4` → `^4.0.7` | 4.0.7 | 4.0.7 (2026-08-24) | 4 | 733,5 M | MIT | 2 corrigés en 4.0.4, 1 retiré (voir plus bas) | correspondance de globs (`src/glob.ts`) |
| fdir | `^6.5.0` | 6.5.0 | 6.5.0 (2025-08-14) | 1 | 303,7 M | MIT | aucun | parcours de l'arborescence (`src/walk.ts`) |
| ignore | `^7.0.16` | 7.0.16 | 7.0.17 (2026-11-25) | 1 | 451,6 M | MIT | aucun | règles `.gitignore` (`src/walk.ts`) |
| get-tsconfig | `^4.14.3` | 4.14.3 | 4.14.3 (2026-08-17) | 1 | 170,2 M | MIT | aucun | lecture de `tsconfig` et alias `paths` (`src/graph/spec-resolve.ts`, `src/render-engine.ts`) |

`pnpm audit --prod` : **aucune vulnérabilité connue**.

## Dépendances de développement

| Paquet | Plage (avant → après) | Installée | Dernière (date) | Mainteneurs | Téléch./semaine | Licence | Avis | Usage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| react | `^19.3.1` | 19.3.1 | 19.3.1 (2026-10-14) | 2 | 272,8 M | MIT | anciens seulement (< 0.14) | fixtures du rendu React (`tests/render-engine.test.ts`) ; côté runtime, ultra11y charge le React **du projet audité** |
| react-dom | `^19.3.1` | 19.3.1 | 19.3.1 (2026-10-14) | 2 | 257,5 M | MIT | anciens seulement (16.x) | idem, `react-dom/server` |
| @biomejs/biome | `^2.5.1` | 2.5.1 | 2.6.9 (2026-11-24) | 5 | 30,3 M | MIT OR Apache-2.0 | aucun | lint et format |
| typescript | `^6.0.3` | 6.0.3 | 7.0.2 (2026-07-08) | 7 | 447,8 M | Apache-2.0 | aucun | `pnpm typecheck` |
| @types/node | `^26.0.1` | 26.0.1 | 26.6.10 (2026-11-25) | 1 (compte DefinitelyTyped) | 670,7 M | MIT | aucun | types Node |
| @types/picomatch | `^4.0.3` | 4.0.3 | 4.0.3 (2026-04-03) | 1 (compte DefinitelyTyped) | 7,2 M | MIT | aucun | types picomatch |
| tsup | `^8.5.1` | 8.5.1 | 9.0.0 (2026-10-14) | 2 | 13,2 M | MIT | anciens seulement (≤ 8.3.4) | construction du bundle |
| vitest | `^4.1.9` → `^4.1.12` | 4.1.12 | 5.1.2 (2026-11-25) | 5 | 192,4 M | MIT | 4.1.9 touché par GHSA-82fw-gwwq-j7x9 et GHSA-qxg6-89mg-rqv8, corrigés en 4.1.12 | tests |
| @vitest/coverage-v8 | `^4.1.9` → `^4.1.12` | 4.1.12 | 5.1.2 (2026-11-25) | 5 | 67,1 M | MIT | aucun | couverture |
| jsdom | `^29.1.1` | 29.1.1 | 31.0.1 (2026-11-13) | 6 | 165,4 M | MIT | anciens seulement (≤ 16.4) | DOM des tests de sondes (`tests/probe-*.test.ts`) |
| yaml | `^2.9.0` → `^2.9.1` | 2.9.1 | 2.9.1 (2026-09-11) | 1 | 330,1 M | ISC | corrigés en 2.8.3 | lecture des workflows et du frontmatter dans les tests |
| semantic-release | `^25.0.8` | 25.0.8 | 26.0.1 (2026-11-16) | 4 | 4,4 M | MIT | anciens seulement (< 19.0.3) | publication |
| @semantic-release/changelog | `^6.0.3` | 6.0.3 | 7.0.0 (2026-07-21) | 3 | 2,4 M | MIT | aucun | publication |
| @semantic-release/exec | `^7.1.0` | 7.1.0 | 7.1.0 (2025-05-09) | 4 | 1,4 M | MIT | aucun | publication |
| @semantic-release/git | `^10.0.1` | 10.0.1 | 11.0.1 (2026-07-24) | 3 | 2,7 M | MIT | aucun | publication |
| @semantic-release/npm | `^13.1.5` | 13.1.5 | 13.2.0 (2026-09-21) | 3 | 4,4 M | MIT | aucun | publication |

### Avis dans l'arbre transitif (dev seulement)

Avant l'audit, `pnpm audit` remontait 54 avis (2 critiques, 19 élevés), **tous** dans l'arbre
de dépendances de développement : `undici` (via jsdom et @semantic-release/npm), `js-yaml` et
`handlebars` (via semantic-release), `postcss` et `nanoid` (via tsup), `vite` et
`@vitest/mocker` (via vitest), `source-map-js` (via @vitest/coverage-v8), `esbuild` (via tsup).
Le lockfile a été rafraîchi dans les plages semver existantes (`pnpm update --depth Infinity`,
`vite` 8.0.16 → 8.3.8). Il reste **un avis faible** :

- GHSA-g7r4-m6w7-qqqr, `esbuild` 0.27.7 via tsup 8 (lecture de fichiers par le serveur de
  développement d'esbuild sous Windows). ultra11y n'utilise jamais ce serveur ; le correctif
  (0.28.1) sort de la plage `^0.27` de tsup 8 et demande tsup 9 (voir les recommandations).

### Avis picomatch

- GHSA-3v7f-55p6-f55p et GHSA-c2c7-rcm5-vvqj : corrigés en 4.0.4, déjà notre plancher.
- GHSA-fc5q-39xc-vjpf (ReDoS par extglob, « ≤ 4.0.7 ») : **retiré** par GitHub, ce n'est pas
  une faille. ultra11y passe d'ailleurs `noextglob: true` (`src/glob.ts`).

## Verdict

**Aucune dépendance n'est faible** au sens des critères ci-dessus. Aucune n'est retirée ni
remplacée, aucun code de `src/` ne change.

- Les bibliothèques à un seul mainteneur (htmlparser2, domhandler, fdir, ignore, get-tsconfig,
  yaml) sont toutes publiées depuis moins de 18 mois, sans avis ouvert, et comptent chacune plus
  de 140 millions de téléchargements par semaine.
- **fdir est à surveiller** : un seul mainteneur et dernière version le 14 août 2025 (15 mois).
  Elle franchira le seuil des 18 mois en février 2027. Un remplacement par `node:fs` n'est pas
  équivalent aujourd'hui : `fs.readdirSync({ recursive: true })` et `fs.globSync` ne savent pas
  élaguer un dossier pendant le parcours (le `exclude` de `src/walk.ts` évite de descendre dans
  `node_modules` ou un dossier ignoré), et `fs.globSync` est encore expérimental en Node 22.
  À réévaluer au prochain audit : un parcours maison avec `fs.readdirSync(dir, { withFileTypes: true })`
  reste possible en une trentaine de lignes si fdir n'est plus publiée.
- Les autres usages ne sont pas couverts par la bibliothèque standard : pas de parseur HTML, ni
  d'AST JSX, ni de moteur de globs compatible gitignore, ni de lecteur de `tsconfig` dans Node.

## Montées de version faites

Uniquement des correctifs ou mineures sans changement de comportement :

- `picomatch` `^4.0.4` → `^4.0.7` (correctifs du scanner d'extglobs ; bundle reconstruit).
- `vitest` et `@vitest/coverage-v8` `^4.1.9` → `^4.1.12` (deux avis de sécurité corrigés).
- `yaml` `^2.9.0` → `^2.9.1`.
- Lockfile rafraîchi dans les plages existantes pour les dépendances transitives vulnérables.

`ignore` 7.0.17 est sortie le jour de l'audit : elle n'est pas prise, par prudence
(délai d'attente avant d'adopter une version fraîche), et sera reprise au prochain audit.

## Recommandations (non appliquées)

Montées qui changent le comportement ou sont majeures, à faire chacune dans sa propre PR :

- `axe-core` 4.13.0 → 4.14.x et `@axe-core/playwright` 4.13 → 4.14 : une mineure d'axe change
  les règles, donc les résultats d'audit. Monter les deux ensemble, en relançant
  `pnpm test:browser` et la matrice ACT.
- `@playwright/test` 1.62 → 1.65 : change la version de Chromium embarquée, donc potentiellement
  le rendu mesuré par le moteur navigateur.
- `@babel/parser` 8.0 → 8.1 : mineure, à vérifier sur le corpus JSX.
- Majeures : `typescript` 7, `vitest` et `@vitest/coverage-v8` 5, `tsup` 9 (lève l'avis
  esbuild), `jsdom` 31, `semantic-release` 26, `@semantic-release/changelog` 7,
  `@semantic-release/git` 11. `@biomejs/biome` 2.6 est une mineure mais ajoute des règles de lint.

## Contrôle continu

L'application GitHub **Socket Security** est installée sur le dépôt : chaque PR reçoit les
statuts « Socket Security: Project Report » et « Socket Security: Pull Request Alerts », qui
signalent une dépendance nouvelle ou modifiée à risque (script d'installation, typosquat,
mainteneur changé, malware). Ce contrôle n'est pas un workflow de `.github/workflows` et n'est
pas modifié par cet audit.

Refaire cet audit au moins tous les six mois, avec la méthode ci-dessus.

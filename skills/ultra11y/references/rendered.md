# Auditer le HTML RENDU (bibliothèques de composants : DSFR, MUI…)

Auditer les **sources JSX** d’une bibliothèque de composants produit des **faux négatifs** :
`<Button iconId="fr-icon-add-line" />` (DSFR) rend en réalité
`<button class="fr-btn fr-icon-add-line">` où l’icône est un pseudo-élément CSS
(décoratif) et où le **nom accessible ne provient que de `title`**. Ce HTML vit dans
`node_modules` à l’exécution — aucune analyse de source ne le voit. Pour ces composants,
**auditez donc ce que le JS produit**, pas la source.

## Honnête par défaut

Quand `audit` voit un fichier JSX/TSX qui rend des composants importés d’une **bibliothèque**
(un spécificateur de package, ex. `@codegouvfr/react-dsfr`), il n’invente pas de verdict : il
ajoute un **risque de périmètre** au rapport (« verdict source préliminaire — auditez le build
ou `scan` ») et nomme la ou les bibliothèques. Un verdict source n’est donc jamais
« complet » en silence.

**Les composants monofichiers `.vue`/`.svelte`/`.astro` sont le même cas.** Ils sont analysés
comme des templates SOURCE (le chemin HTML, avec la casse des composants préservée), donc
`<slot>`/`{@render}`, `v-for`/`{#each}`, les liaisons dynamiques (`:aria-label`) et les
composants enfants sont invisibles à l’analyse statique. Chaque constat relevé sur eux est
marqué **`preliminary: true`** et l’exécution ajoute une réserve **`scope.sourceTemplate`**
(« seul le template SOURCE a été audité — auditez la sortie rendue »). Traitez ces verdicts
comme provisoires : auditez le HTML rendu (un build statique) ou passez `scan` sur une page
en ligne avant de conclure, et réfutez tout constat source que le DOM rendu dément
(`verify --apply`). Voir `references/false-positives.md`.

## Le moteur de rendu d’ultra11y (`render`)

ultra11y rend les composants lui-même. Il ne lit ni n’exécute **pas** les tests du projet,
ses `__snapshots__` ou ses snapshots en ligne : ils contiennent ce qu’un auteur de test a
écrit, parfois cassé exprès, et ils se périment.

```
node scripts/ultra11y.mjs render .      # components, pages, stories → .ultra11y/captures + .ultra11y/render.json (+ render-snapshots/ when a browser is there)
node scripts/ultra11y.mjs audit .       # ingests .ultra11y/captures; findings name the source component
```

- **Découverte.** Chaque module `.tsx`/`.jsx` du projet : son export par défaut et ses
  exports en PascalCase qui sont des composants React. Les fichiers Next.js `app/**/page.tsx`
  et `pages/**` sont étiquetés avec leur route. Les stories Storybook (`*.stories.*`, CSF)
  sont rendues avec leurs `args`. Les fichiers de test, spec, mock, fixture et snapshot sont
  écartés sans être lus ; le manifeste les compte (`testFilesIgnored`). `--include`/`--exclude`
  délimitent le périmètre, `--no-stories` écarte les stories.
- **Rendu.** Chaque unité est rendue par le `react-dom/server` **du projet lui-même**
  (`renderToStaticMarkup`), dans un harness jetable qui appartient à ultra11y : un script
  d’exécution dans le répertoire temporaire de l’OS, un processus enfant par fichier source,
  le projet comme répertoire de travail. Le TSX/JSX est transpilé **en mémoire** avec le
  transpileur que le projet possède déjà — esbuild, sinon typescript, sinon sucrase
  (`--transpiler` en choisit un). Aucun fichier du projet n’est écrit et aucun build ne
  tourne. Le harness résout les alias `paths` du tsconfig, remplace par des bouchons les
  imports de styles (les modules CSS associent chaque classe à son nom), les ressources
  statiques (leur chemin public ; un SVG est aussi un composant), `next/font/*`,
  `server-only` et `client-only`. `fetch` est désactivé : la récupération de données est
  signalée, jamais effectuée. Chaque unité dispose de `--timeout` ms (10000 par défaut) ; une
  unité qui le dépasse est tuée et consignée, et le reste de son fichier est quand même rendu.
- **Props.** Un composant qui ne déclare aucune prop (ou seulement des props avec valeur par
  défaut) est rendu sans props — c’est ce qu’il rend. Un composant qui **prend des props**
  n’est pas rendu sans elles : il montrerait un état qu’aucun utilisateur ne rencontre (une
  étiquette vide, une image sans son alt). Il est rendu via ses stories quand il en a
  (`via-story`), sinon listé comme non tenté (`props`). Écrivez une story avec les args qu’un
  véritable écran lui passe pour le couvrir.
- **Captures.** Chaque rendu est écrit dans `.ultra11y/captures/<id>.html` avec le
  commentaire de provenance `<!-- ultra11y:capture v="1" source="src/Button.tsx" component="Button" name="…"
  renderer="react-dom/server 19.x" styles="none" -->`, de sorte qu’un constat qui le
  concerne est rapporté sur le composant SOURCE. Une story est attribuée au fichier de
  composant situé à côté d’elle. Une nouvelle exécution ne réécrit que les captures qui ont
  changé et supprime celles qu’elle ne rend plus.
- **Honnêteté.** `.ultra11y/render.json` liste chaque unité : `rendered`, `skipped` avec la
  raison (`provider` — un contexte que l’application monte ; `props` ; `browser-api` —
  `window`, `document`, `localStorage` au moment du rendu ; `data` — un composant serveur
  asynchrone, un fetch suspendu ; `transpile` ; `module` — un import non résolu ; `timeout` ;
  `empty` ; `error`), ou `not-attempted` (`props`, `via-story`, `unsupported-renderer` pour
  `.vue`/`.svelte`/`.astro`, `no-renderer`, `no-transpiler`). `audit` le lit dans
  `scope.renders`, et l’annexe du rapport (section G) liste chaque unité avec son statut et
  sa raison, même quand aucune capture n’a été écrite. Une unité qui lève une exception n’est
  jamais abandonnée, et une exécution qui ne rend aucune de ses unités sort en 1.
- **Ce qu’un rendu serveur ne peut pas décider.** Il ne calcule aucun style et ne met en page
  aucune boîte (`styles="none"`) : couleur, contraste, redistribution, visibilité du focus
  restent « à évaluer » sur ces captures. Une capture de composant est un fragment, donc les
  critères de niveau page (langue, titre) n’y sont pas décidés non plus. Les vraies pages
  passent par Playwright (`ultra11y/playwright`) et `scan`.
- **React uniquement.** Les composants Vue, Svelte et Astro sont listés comme non tentés ;
  auditez leur sortie rendue via un build statique ou `scan`.
- **Instantanés visuels.** Après le rendu, `render` ouvre chaque capture dans Chromium
  (Playwright, servie depuis un serveur en boucle locale, sans réseau) pour une capture
  d’écran et une passe axe, écrites dans `.ultra11y/render-snapshots/<id>.png` et
  `.ultra11y/render-snapshots/index.json` (la liste lisible par une machine). Il charge le CSS
  **global** du projet quand il le trouve : du `.css` simple importé par les points d’entrée
  racine (`app/layout`, `pages/_app`, `src/main`, `src/index` — en relatif, par alias
  tsconfig ou par package comme le DSFR), les feuilles de style liées depuis un document
  racine vers `public/`, et le CSS compilé d’un build (`.next/static/css`, `dist/assets`,
  `build/static/css`) uniquement pour remplacer une source Tailwind ou Sass non compilée
  qu’il a dû écarter. Les modules CSS ne sont jamais chargés. L’index indique
  `styles.status` : `project`, `partial` ou `none` — une capture d’écran sans CSS est
  étiquetée comme telle. Chaque observation est un **rendu de composant isolé**
  (`context: "isolated-component"`) : les règles axe portant sur la page entière (régions,
  ordre des titres, title, lang…) sont mises de côté, les règles dépendant du style
  (contraste, taille de cible…) aussi sauf si le CSS est `project`, et **aucune observation
  d’instantané ne décide un critère**, n’en crédite un comme conforme, ni ne rejoint la
  couverture axe de l’audit. `audit` reporte l’index dans `scope.renders.snapshots` ;
  l’annexe (sous la section G) et le composite HTML montrent les images. Sans Playwright ni
  navigateur, la passe écrit un index qui dit pourquoi et les captures statiques restent
  valables ; `--no-snapshots` (ou `ULTRA11Y_RENDER_SNAPSHOTS=off`) la saute,
  `--browser-path` choisit le navigateur.

`render --coverage` liste les composants qui ont une capture et ceux qui restent des angles
morts opaques, vus en source seulement ; `audit --require-captures` échoue tant qu’il en
reste un. Commitez `.ultra11y/captures` et `.ultra11y/render.json` quand le garde-fou de
pre-commit doit voir le balisage rendu : en mode limité au diff
(`--changed`/`--staged`/`--since`), l’audit intègre les captures dont la provenance pointe
vers un fichier source modifié. `fix` ne réécrit jamais les captures.

## Autres façons d’obtenir du HTML rendu

`node scripts/ultra11y.mjs render --detect [<dir>]` détecte le framework et affiche la
recette « build → audit » pour le projet (et signale les bibliothèques qu’il détecte).

1. **Sortie de build** : buildez le site ou les pages, puis auditez le HTML émis avec le
   moteur statique — c’est du vrai HTML, audité en pleine fidélité :
   ```
   npx astro build   # or next build (output:'export'), vite build…
   node scripts/ultra11y.mjs audit "dist/**/*.html"
   ```
   Un simple `storybook build` n’émet **PAS** un fichier HTML par story — `storybook-static/`
   est une coquille d’application monopage qui rend les stories côté client. Le moteur de
   rendu rend les stories lui-même ; du HTML par story produit autrement (ex.
   `@storybook/test-runner`) peut être attribué à son composant source avec
   `render --storybook [<storybook-static>]
   [--captures <html-dir>]`, qui ne rend rien lui-même et échoue (exit 1) quand du HTML
   candidat existait mais qu’aucun n’a pu être attribué.
2. **Navigateur headless** : `scan <url>` (niveau navigateur, axe-core) sur l’application en
   cours d’exécution — le plus fidèle, et requis pour les critères de **rendu** (contraste
   calculé 1.4.3, redistribution 1.4.10). `--merge` intègre le résultat dans un AuditResult
   statique. Pendant une exécution E2E, `ultra11y/playwright` enregistre chaque page dans
   l’état où votre test l’a laissée (`references/e2e.md`).

## Choisir

- Composants et design systems → `render`, puis `audit` (et `audit --require-captures` comme
  garde-fou).
- Pages complètes / SSG → sortie de build (`dist`/`out`), puis `audit` ; pages derrière un
  état → `ultra11y/playwright`.
- Critères de rendu (contraste, focus, zoom) → `scan` (navigateur).
- Dans tous les cas, ne concluez pas « conforme » sur un composant de bibliothèque à partir de
  la source : c’est ce que rappelle le risque de périmètre — résolvez-le sur le HTML produit
  (captures / `scan`), puis laissez l’agent IA arbitrer le critère (`verify --manual`, sous
  garde-fou).

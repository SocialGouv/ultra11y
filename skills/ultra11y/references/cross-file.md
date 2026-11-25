# Analyse inter-fichiers (`audit --graph`)

Par défaut, le moteur audite **chaque fichier isolément**. `--graph` (alias `--cross-file`)
ajoute une passe qui **résout les imports entre fichiers**, construit un graphe de dépendances +
de composants, et applique des règles que seul le contexte inter-fichiers rend visibles — **sans
navigateur** (pas de Playwright). Elle complète le moteur statique par fichier et le niveau
dynamique facultatif (`scan`) : tous trois alimentent le **même** `AuditResult`.

```
node scripts/ultra11y.mjs audit "src/**/*.tsx" --graph --json > audit.json
node scripts/ultra11y.mjs audit --changed --graph     # git diff, graph over the whole scope
```

## Comment ça marche (et pourquoi ça passe à l’échelle)

- **Vrai AST** : les `.jsx/.tsx` sont analysés par un vrai parseur JS/TS/JSX (`@babel/parser`,
  embarqué dans le bundle — toujours « sans installation »), pas par une normalisation à coups
  de regex. Les composants en `PascalCase` gardent leur casse (les règles par fichier les
  ignorent ; seules les règles inter-fichiers les résolvent) ; les éléments natifs restent en
  minuscules.
- **Deux passes, mémoire bornée** : passe 1 — lire chaque fichier, en extraire un petit *nœud de
  graphe* (imports, composants + signaux de rendu des contrôles, ids, `<html lang>`, un titre de
  métadonnées Next.js), puis **jeter** l’AST/le Doc. Passe 2 — la boucle d’audit habituelle, qui
  exécute aussi les règles inter-fichiers avec le graphe en main. Le dépôt entier n’est jamais
  tenu en mémoire : O(nombre de fichiers) petits nœuds.
- **`--changed --graph`** : le graphe indexe **tout** le périmètre (pour résoudre une référence
  vers une définition inchangée), mais seuls les fichiers du diff sont audités.
- **Les modules `.ts`/`.js` simples entrent dans le graphe, jamais dans l’audit.** La découverte
  propre au graphe s’élargit à `.ts`/`.js`/`.mjs`/`.cjs` en plus de la liste des fichiers de
  balisage autorisés : un **barrel** (`components/index.ts` qui réexporte `Button.tsx`) ou une
  définition de composant en JS simple est une vraie structure inter-fichiers à travers laquelle
  les imports se résolvent — les réexports en chaîne (`export { Button } from "./Button"`, des
  barrels de barrels) sont suivis jusqu’à la vraie définition. Ces fichiers fournissent des
  imports/réexports/définitions/ids au graphe mais n’entrent jamais dans la boucle d’audit
  (aucune règle de balisage ne s’exécute jamais sur eux).
- **Les SFC `.vue`/`.svelte`/`.astro` sont des nœuds de graphe à part entière.** Analysés en
  conservant la casse des composants (comme dans l’audit) ; le bloc `<script>` propre au
  fichier — ou le **frontmatter** `---…---` d’un fichier `.astro` — est analysé séparément comme
  AST de script pour ses imports ; et chaque SFC synthétise sa propre définition de composant
  (nom de base en PascalCase), de sorte qu’un `.tsx` qui importe `./Widget.vue` se résout entre
  fichiers et que le SFC compte dans la couverture des captures. Le frontmatter Astro est aussi
  retiré (en préservant les offsets) avant l’analyse du gabarit, si bien que le TypeScript du
  frontmatter (`Array<string>`) ne produit jamais d’éléments ni de constats fantômes.
- **Résolution des imports** : les spécificateurs relatifs (`./IconButton`), les **alias
  tsconfig-paths** (`@/components/Icon`, lus dans le `baseUrl`/`paths` du `tsconfig.json` le
  plus proche) et les **membres d’espace de noms** (`<UI.Button/>` issu de `import * as UI`) se
  résolvent tous vers un fichier découvert. *Limites (documentées, jamais un faux « conforme »
  silencieux) :* les spécificateurs `node_modules` nus (`react`) sont hors périmètre ; les bases
  d’alias sont résolues par rapport au répertoire de travail (lancez l’audit depuis la racine du
  projet) ; le flux de valeurs du **context** React et les `import()` dynamiques ne sont pas
  suivis.

## Les règles inter-fichiers

- **`cross-icon-only-unnamed`** (WCAG 2.4.4/4.1.2, *signalement*) : un composant qui rend un
  contrôle **composé uniquement d’une icône** et *peut* recevoir un nom (`{...props}` /
  `aria-label={…}` / `{children}`) est utilisé **sans nom**. Le signalement est placé **sur le
  site d’utilisation**, avec la **définition** du composant dans `related`.
- **`cross-prop-drilled-name-lost`** (WCAG 4.1.2, *signalement*) : une utilisation passe une
  prop de nom accessible (`aria-label`/`label`/…) à un composant qui rend un contrôle mais
  **ne propage pas `{...props}` et ne transmet pas non plus de nom** à ce contrôle → le nom est
  perdu en silence. Signalé sur l’utilisation, avec la **définition** du contrôle dans
  `related`.
- **`cross-aria-ref-cross-file`** (WCAG 4.1.2, *suppression*) : un `aria-labelledby`/
  `aria-describedby`/`aria-controls` dont l’id cible se trouve dans un **autre** fichier →
  supprime le faux `aria-ref-missing-id`. Supprimé seulement quand **chaque** id absent de la
  page se résout ailleurs, de sorte qu’une référence réellement pendante n’est jamais masquée.
- **`cross-aria-forwarding`** (WCAG 4.1.2, *suppression*) : un contrôle natif qui transmet
  `{...props}` peut être nommé par son parent → il **supprime** le faux
  `button-empty-name`/`icon-only-control-unnamed` sur la **définition**.
- **`cross-skip-link-target`** (WCAG 2.4.1, *suppression*) : une ancre `href="#id"` dont la
  cible se trouve dans un **autre** fichier (layout/composant importé) → supprime la fausse
  « ancre cassée ». Une cible absente partout reste un vrai positif.
- **`cross-page-lang`** (WCAG 3.1.1, *suppression*) : un `<html>` sans `lang` dont le
  layout/wrapper importé déclare la langue → supprime le faux positif.
- **`cross-next-metadata-title`** (WCAG 2.4.2, *suppression*) : un composant d’enveloppe dont le
  `<head>` n’a pas de `<title>`, rendu par des routes Next.js App Router (`app/**/layout|page`,
  directement ou à travers des composants et des barrels) qui reçoivent **toutes** un titre de
  l’API metadata (`metadata.title` / `generateMetadata`, dans la route ou dans un layout
  au-dessus) → supprime le faux `title-missing-empty`. Une enveloppe qu’aucune route ne rend, ou
  rendue par une route sans titre de métadonnées, garde son constat. Sans `--graph`, un layout à
  métadonnées dans le périmètre laisse le 2.4.2 ouvert (manuel, risque résiduel) pour une
  enveloppe sans titre hors de `app/` au lieu de le mettre en échec.
- **`cross-name-ref-cross-file`** (WCAG 1.3.1, *suppression*) : un `<label for="id">` ou un
  titre/`aria-labelledby` dont l’id cible est **défini dans un autre** fichier → supprime le
  faux `label-for-dangling` / titre vide. Supprimé seulement quand l’id se résout ailleurs.

## Bénéfice pour `fix`

Comme l’AST indexe le **vrai fichier** (offsets exacts, `Doc` non *lossy*), `fix` peut appliquer
ses codemods *sûrs* sur le JSX/TSX (retirer l’ARIA redondant, insérer `alt`/`lang`/`title`/
`aria-label`), toujours derrière le garde-fou anti-régression. Les codemods qui **réécrivent**
un nom d’attribut restent désactivés sur le JSX (ainsi `tabIndex={5}` n’est jamais transformé en
`tabindex="0"`).

> Les signalements inter-fichiers se fusionnent dans le même `AuditResult` : `report`, `prd`,
> `check` et `verify` les consomment sans changement.

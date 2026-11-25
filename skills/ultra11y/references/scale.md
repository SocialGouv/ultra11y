# Auditer à grande échelle — cibler intelligemment

On n’audite jamais « tout » d’un dépôt immense. Le moteur ne lit que le **balisage**
(HTML/JSX/Vue/Svelte/Astro), le traite en flux (mémoire bornée, un fichier à la fois, le `Doc`
est libéré après usage), et c’est vous qui le **ciblez**. Boucle recommandée :

## La boucle

1. **Cartographier sans tout charger.** Par défaut, le moteur ignore `node_modules`, `.git`,
   `dist`, `build`, `.next`, `out`, `coverage`, `audits`, et écarte le **balisage de
   test/spec/story** (`*.test.*`, `*.spec.*`, `*.stories.*`, `__tests__/`, `__mocks__/`,
   `.storybook/`) — des fixtures mauvaises à dessein, jamais une interface livrée (le nombre de
   fichiers écartés est journalisé). Passez `--no-default-excludes` pour les inclure, ou nommez
   un fichier / ajoutez-le directement avec `--include` pour le réadmettre. Pour restreindre
   davantage :
   ```
   node scripts/ultra11y.mjs audit "apps/web/**/*.{html,tsx}" --json > audit.json
   ```
2. **Choisir la tranche qui compte.** Trois leviers, du plus ciblé au plus large :
   - **Le diff** (hooks/CI, revue de pull request) : `--changed` (par rapport à `HEAD`) ou
     `--since <ref>` — n’audite que les fichiers de balisage modifiés (via `git diff`, sans
     parcours de l’arborescence).
   - **Les gabarits/composants partagés d’abord** : le moteur **priorise** les layouts, les
     gabarits, les pages d’entrée, puis `components/`, `shared/`, `ui/`, `design-system/`, puis
     les feuilles. Une exécution partielle couvre donc en premier le balisage au plus fort
     impact.
   - **Un plafond explicite** : `--max-files <n>` borne le nombre de fichiers audités (les plus
     prioritaires d’abord) ; la troncature est **toujours journalisée** (jamais d’abandon
     silencieux) et consignée dans le rapport.
3. **Dédupliquer ce qui se répète.** Un composant identique répété N fois n’est audité
   **qu’une fois** (`--dedup exact` par défaut ; `normalized` ignore les espaces entre balises ;
   `off` désactive). Le rapport cite le fichier canonique.
4. **Auditer → corriger → ré-auditer → élargir.** Sur la tranche choisie : lisez
   l’`AuditResult`, complétez le jugement, appliquez les correctifs (`references/fix.md`),
   ré-auditez pour prouver l’absence de régression, puis élargissez le périmètre.

## Pourquoi c’est sûr à grande échelle

- **Mémoire bornée** : flux fichier par fichier ; seul le nombre de constats (pas la taille des
  sources) reste en mémoire.
- **Déterministe** : ordre stable (priorité puis chemin) → audits reproductibles, choix stable
  du fichier canonique, `check:build` tient.
- **Incrémental** : `--changed`/`--since` rendent l’audit proportionnel au diff, pas au dépôt —
  ce qui rend les hooks/la CI viables (voir `references/automation.md`). Réserve honnête : les
  modes diff paient un **coût fixe de quelques appels `git`** avant d’auditer quoi que ce soit,
  donc sur un petit dépôt un scan complet peut en réalité être le plus rapide des deux. Le gain
  commence autour de quelques centaines de fichiers de balisage et croît à partir de là.
- **Un seul passage sur l’arborescence** : `--graph` découvre le balisage et les modules
  `.ts/.js` à travers lesquels il se résout, mais parcourt l’arborescence une seule fois et
  analyse chaque fichier de balisage une seule fois — le passage du graphe transmet ses
  documents analysés au passage d’audit au lieu que chaque fichier soit lu et analysé deux fois.

> En mode `--changed`, la déduplication est désactivée : un fichier modifié est toujours audité,
> jamais fusionné avec un fichier qui n’a pas été lu.

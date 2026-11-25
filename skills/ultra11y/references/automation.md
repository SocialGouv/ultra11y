# Automatiser dans le dépôt — `init` (hook)

ultra11y peut rester une skill **à la demande**, ou devenir un **garde-fou** qui s’exécute de
lui-même. `init` le branche (zéro dépendance, pas de husky) :

```
node scripts/ultra11y.mjs init --hook          # .git/hooks/pre-commit — strict STAGED gate (default)
node scripts/ultra11y.mjs init                 # same as --hook
node scripts/ultra11y.mjs init --fail-on major # the same gate, at another threshold
```

## Trois garde-fous, trois rôles différents

| | ce qui s’exécute | quand | qui tranche |
|---|---|---|---|
| `init --hook` | le moteur, mécaniquement | à chaque `git commit` | le `--fail-on` du moteur |
| le bot `rgaa-audit` d’iterion | le moteur + des agents en lecture seule, en CI | quand le workflow le lance | ses agents, qui arbitrent et réfutent, puis les garde-fous du moteur |
| le **hook du harness d’agent** | la **skill** `review-a11y` | un commit / push / pull request en attente, dans une session d’agent | l’agent IA, qui arbitre |

Le premier bloque sur ce qu’une machine peut trancher. Les deux autres existent parce que
l’essentiel des WCAG relève du *jugement* — cet `alt` est-il pertinent, la fonction de ce lien
est-elle claire — ce qu’aucun code de sortie ne règle. Voir ci-dessous.

`init` n’écrit aucun workflow de CI : l’audit arbitré et contre-vérifié en CI est
le [bot `rgaa-audit`](https://github.com/SocialGouv/iterion/tree/main/bots/rgaa-audit) d’iterion
(`references/ci.md`).

## Le hook du harness d’agent — la revue par l’agent, sans qu’on la demande

Livré par le plugin (`hooks/hooks.json` → `hooks/pre-tool-use.mjs` → `ultra11y hook
--claude-code`), pas par `init`. **Aucun** harness n’a d’événement git, donc il écoute
`PreToolUse` pour l’outil shell et reconnaît les commandes qui **publient** du travail —
`git commit` (limité à `--staged`), `git push` et `gh pr create` (limités à `--since <default branch>`).
Quand la modification porte des constats au niveau du seuil ou au-dessus, il renvoie
`permissionDecision:
"deny"` avec les constats joints, et l’agent invoque `review-a11y` pour les arbitrer.

Le même fichier sert Claude Code et Codex (Codex exporte `${CLAUDE_PLUGIN_ROOT}` et lit la même
enveloppe) ; OpenCode n’a pas de canal de décision, donc là le garde-fou lève une exception et
les constats arrivent comme erreur de l’outil. Installation par harness, différences et moyens
de désactivation : **`references/harnesses.md`**.

Deux invariants le rendent vivable :

- **Il ne se déclenche jamais deux fois pour les mêmes constats.** L’ensemble des constats
  reçoit une empreinte par session, donc la nouvelle tentative après une revue passe toujours —
  une revue qui réfute tout laisse quand même le commit aboutir.
- **Il ne casse jamais un flux git.** Le contournement `no-verify` propre à git, une exécution à
  blanc, un répertoire courant hors d’un dépôt, une référence de base introuvable, une erreur du
  moteur ou un dépassement de délai se résolvent tous en silence, jamais en une erreur que
  l’utilisateur doit contourner.

Seuil et moyens de désactivation : `ULTRA11Y_HOOK_FAIL_ON=blocking|major|minor|off` (variable
d’environnement, prioritaire), puis `"hook": { "failOn": … }` dans `.ultra11yrc.json`, sinon
`blocking`. `SKIP_A11Y=1` (le même contournement que pour le hook pre-commit) et
`ULTRA11Y_HOOK=off` le désactivent complètement.

Un hook **ne peut pas forcer** l’invocation d’une skill — il bloque et transmet la raison,
l’agent invoque. Et les hooks d’un plugin s’activent en activant le plugin, pas par la seule
installation.

## Par défaut : instantané indexé strict + correction automatique sûre

Le hook pre-commit par défaut opère sur **exactement ce qui est sur le point d’être commité** —
les **blobs de l’index (staged)**, lus avec `git show :./<path>`, *pas* la copie de l’arbre de
travail. Il exécute (correction d’abord, puis garde-fou — ainsi les corrections sûres sont
toujours appliquées, et seuls les problèmes de jugement restants peuvent bloquer) :

```
node scripts/ultra11y.mjs fix   --staged --write --safe            # auto-apply SAFE fixes to the staged snapshot, re-stage
node scripts/ultra11y.mjs audit --staged --fail-on blocking        # gate: block only if issues remain (need judgment)
```

Pourquoi corriger d’abord : chaque règle corrigeable automatiquement (`tabindex` positif,
`role` redondant, viewport qui bloque le zoom) est `major`/`minor`, alors que les constats
`blocking` (`alt` manquant, étiquette manquante) sont précisément ceux qu’un codemod ne doit
**pas** deviner. La passe sûre nettoie donc et réindexe ce qu’elle peut, et le garde-fou ne
bloque que sur le reliquat de jugement, que l’agent IA arbitre.

- **`--staged`** se limite aux ajouts/modifications indexés (pas les fichiers non suivis, pas
  les modifications seulement non indexées) et audite les octets exacts qu’un commit
  enregistrerait — y compris les filtres clean de `.gitattributes`. `--staged` l’emporte sur
  `--changed`/`--since`.
- **`--safe`** n’applique que les codemods réellement **automatiques**. Les insertions
  d’espaces réservés (`alt="TODO"`, `lang="und"`, `title="TODO"`) ne sont **pas** appliquées :
  un bouche-trou ferait disparaître le constat mécaniquement alors qu’une vraie valeur reste
  nécessaire, donc ceux-ci (et les propositions de jugement) sont laissés en place et
  maintiennent le blocage du garde-fou.
- **Correction automatique + réindexation** n’ont lieu que pour les fichiers **entièrement
  indexés** (arbre de travail == index). Un fichier **partiellement indexé** (modifications non
  indexées présentes) n’est pas touché — écrire par-dessus une sortie dérivée de l’index puis
  faire `git add` indexerait ces modifications en silence — donc ses constats maintiennent le
  blocage du garde-fou, avec un message invitant à l’indexer/le corriger à la main.
- Le commit ne passe que lorsqu’il ne reste plus aucun problème bloquant après la passe sûre.
  Contournement ponctuel : `SKIP_A11Y=1 git commit …`. Chemin du moteur à surcharger :
  `ULTRA11Y=/path/to/ultra11y.mjs`.

**Quand le hook bloque sur des problèmes de jugement** (pertinence de l’alternative, fonction du
lien, étiquettes, structure des titres), l’agent doit : ouvrir le code **indexé** cité, appliquer
la *vraie* correction (pas un espace réservé), faire `git add` sur le fichier, puis commiter à
nouveau — ou lancer `fix --staged
--write` pour poser des espaces réservés, puis les remplir.

## OBLIGATOIRE : le HTML sémantique FINAL, rendu, doit être correct

Le moteur statique ne voit que la **source**. Quand le balisage provient d’une **bibliothèque
de composants** (DSFR, MUI, Chakra…) ou d’un SFC `.vue`/`.svelte`/`.astro`, le vrai **HTML
sémantique** n’existe **qu’après le rendu** — le `<Button/>` de la source ne dit rien du
`<button>` (ou du `<div role>`) qu’il émet. Un garde-fou vert sur une source de composants
opaque n’est **pas** la preuve d’un résultat accessible.

**Faites donc du HTML sémantique produit l’objet du garde-fou — avec des CAPTURES rendues.** Une
capture est le DOM *rendu*, sérialisé en `.html` et commité, de sorte que le garde-fou audite le
vrai balisage, pas l’appel du composant. Le moteur de rendu d’ultra11y les produit, sans lire ni
exécuter vos tests (`references/rendered.md`) :

```
node scripts/ultra11y.mjs render .                    # every component, page and story → .ultra11y/captures/*.html (provenance-tagged)
node scripts/ultra11y.mjs audit --require-captures    # gate: every opaque/control component must have a capture
```

- **Attribution + couverture.** Un constat sur une capture est rapporté au composant SOURCE (via
  sa provenance `<!-- ultra11y:capture … -->`), pas au fichier de capture.
  `render --coverage` montre les composants couverts et les angles morts ; `--require-captures`
  transforme tout angle mort restant en échec. Les composants `.vue`/`.svelte`/`.astro` comptent
  désormais aussi dans cette couverture, donc un garde-fou jusque-là vert peut signaler de
  nouveaux angles morts dans un dépôt riche en SFC — c’est voulu (un angle mort nommé vaut mieux
  que l’invisibilité) ; capturez ces composants ou restreignez le périmètre du garde-fou.
- **Le garde-fou voit automatiquement les captures des composants du diff.** En mode
  `--changed`/`--staged`/`--since`, l’audit intègre les captures commitées dont la provenance
  pointe vers un fichier source du diff (une capture fait rarement elle-même partie du diff —
  c’est la SOURCE qui a changé, sa capture généralement pas), de sorte que le garde-fou
  pre-commit audite les vrais `<button>`/`<nav>`/structure de titres/étiquettes de chaque
  composant touché, et attrape les régressions que la source opaque cache. Après une
  modification de composant, relancez `render` pour rafraîchir sa capture, et indexez la capture
  rafraîchie avec la source. `fix` ne réécrit jamais les captures (sortie générée). Le HTML de
  Storybook ou de build fonctionne
  aussi — tout ce qui se trouve sous `.ultra11y/captures`, ou pointez `--captures <dir>`
  (`--no-captures` désactive entièrement).
- En CI, auditez la sortie **construite** (`audit "dist/**/*.html"`), et utilisez `scan` pour
  les critères de rendu calculés (contraste, focus, zoom). Voir `references/rendered.md`.

Traitez ceci comme une règle stricte : **ne validez pas une modification de composant/SFC sur la
seule base de l’audit de la source — vérifiez le HTML sémantique rendu, et préférez des captures
commitées pour que le garde-fou continue de le vérifier.**

> Le garde-fou pre-commit repose sur le moteur **statique**. Les critères de **rendu** (contraste,
> focus, zoom) vont vers `scan` et les critères de **jugement** sont arbitrés par l’agent IA
> (`verify --manual`, sous garde-fou) dans l’audit complet — le garde-fou arrête les régressions
> mécaniques, ce n’est pas l’audit complet (un humain n’est au plus qu’une supervision
> facultative).

# Où cela s’exécute — Claude Code, Codex CLI, OpenCode, et tout le reste

Les skills parlent en **actions** — lancer le moteur, invoquer la skill de revue, arbitrer les
constats. Sur chaque harness, elles se résolvent comme ci-dessous. Seules les **différences** sont
listées ; tout ce qui n’est pas mentionné ici est identique partout, parce que le moteur est un seul
bundle sans dépendance et que la CLI qu’il expose est la même sur tous.

Trois choses sont bonnes à savoir avant le tableau :

- **L’audit complet est le même partout.** Un audit complet ou détaillé demandé suit
  `references/full-audit.md` sur chaque harness : la session active est l’auditeur, statue directement
  sur les listes de travail (ou les distribue à des sous-agents là où le harness en dispose, voir
  `references/orchestration.md`), puis publie le Markdown, le HTML et les dossiers par page étayés de
  preuves, et passe les garde-fous `check`. Le moteur n’exécute aucun modèle qui lui soit propre ; en
  CI, l’appelant sans surveillance est le bot `rgaa-audit` d’iterion (`references/ci.md`). Seul le
  chemin du moteur diffère (ci-dessous).

- **Aucun harness n’a d’événement git.** Aucun ne peut se brancher sur « sur le point de commiter ».
  La revue automatique s’appuie donc sur l’*outil shell* de chacun d’eux, en reconnaissant les
  commandes qui publient du travail — `git commit`, `git push`, `gh pr create`. C’est une contrainte de
  conception délibérée, pas une bizarrerie de Claude Code.
- **Un hook ne peut pas forcer l’invocation d’une skill.** Il bloque la commande et transmet le motif
  et les constats ; c’est l’agent qui invoque `review-a11y`. En pratique, un blocage motivé suffit — ce
  n’est une garantie sur aucun harness.

## Claude Code

```
/plugin marketplace add SocialGouv/ultra11y
/plugin install ultra11y@ultra11y
```

Le plugin embarque les deux skills *et* le hook. `hooks/hooks.json` → `hooks/pre-tool-use.mjs`
→ `ultra11y hook --claude-code`. Le moteur se résout depuis `${CLAUDE_SKILL_DIR}/scripts/ultra11y.mjs`.
Les outils de distribution propres à Claude Code sont l’outil Agent et, là où il est disponible,
l’outil Workflow qui exécute les scripts `*.workflow.mjs` émis par `orchestrate` (Claude Code
uniquement). Chaque harness, Claude Code compris, peut à la place transmettre à ses propres
sous-agents les fichiers de prompt par lot qu’écrit `orchestrate` (`references/orchestration.md`).

La revue arrive sous la forme d’un `permissionDecision: "deny"` sur la commande en attente, avec les
constats dans `additionalContext`.

Skills seules, sans hook : `npx skills add SocialGouv/ultra11y`. Garde-fou seul, pour une installation
npm : `ultra11y install --claude-code`.

## OpenAI Codex CLI

```
codex plugin marketplace add SocialGouv/ultra11y
codex plugin add ultra11y@ultra11y
```

Le moteur de hooks de Codex est un quasi-clone de celui de Claude Code — mêmes événements, mêmes
champs de payload, même enveloppe `hookSpecificOutput` — et il exporte `${CLAUDE_PLUGIN_ROOT}` à côté
de son propre `${PLUGIN_ROOT}`, donc **`hooks/hooks.json` est partagé tel quel** entre les deux.

Les différences qui comptent vraiment :

- Son outil shell varie selon la version. Codex 0.172 propose au modèle `exec_command` et transmet au
  hook `tool_name: "Bash"` avec une `command` sous forme de chaîne, exactement comme Claude Code. Les
  versions plus anciennes utilisaient **`shell`** avec un **tableau argv**
  (`["bash","-lc","git commit -m x"]`). `commandOf` dans `src/hook.ts` extrait l’argument du script
  plutôt que de joindre le tableau, parce que la jointure placerait `git` hors d’une position de
  commande et que le garde-fou ne se déclencherait silencieusement jamais. Le matcher de
  `hooks/hooks.json` couvre chacun de ces noms.
- Sur `PreToolUse`, Codex n’accepte **que** `permissionDecision: "deny"`, avec un motif non vide.
  C’est exactement et uniquement ce qu’émet ce moteur, donc l’enveloppe n’a besoin d’aucune branche.
- `.codex-plugin/plugin.json` ne doit pas déclarer `hooks` — le validateur de manifeste de Codex
  rejette toute clé hors de sa liste autorisée. `hooks/hooks.json` est trouvé par convention à la
  racine du plugin.
- Les hooks sont derrière un feature flag : **`[features] hooks = true`** dans `~/.codex/config.toml`.
  Codex 0.172 liste `hooks` comme stable et activé par défaut (`codex features list`), et les versions
  plus anciennes ont toujours besoin de la ligne.
- Codex vous demande de **faire confiance** à une commande de hook la première fois qu’elle se
  déclenche. Acceptez-la, ou relisez-la avec `/hooks`. Un hook non approuvé ne s’exécute pas, et rien
  ne le signale : `codex exec` exécute la commande comme si aucun hook n’existait. L’automatisation
  headless qui contrôle déjà ses hooks passe `codex exec --dangerously-bypass-hook-trust`, ce que fait
  le job de CI `codex-smoke`.
- Une marketplace locale (`codex plugin marketplace add ./path`) est installée depuis le **HEAD git**
  de ce dépôt, pas depuis son arbre de travail. Commitez une modification de `hooks/` avant de la
  réinstaller pour l’essayer.

Garde-fou seul, sans la marketplace : `ultra11y install --codex` (il active le feature flag et copie
les deux skills dans `~/.codex/skills/`, ou `$CODEX_HOME/skills/`). Le moteur se résout alors depuis le
`scripts/ultra11y.mjs` du répertoire de skill installé — la copie du plugin, ou
`~/.codex/skills/ultra11y/scripts/ultra11y.mjs` après `install --codex`.

La CI vérifie les deux voies dans un vrai Codex (`tests/codex-smoke.e2e.test.ts`, `pnpm test:codex`).
Elle installe une Codex CLI épinglée dans un `CODEX_HOME` jetable, puis fait exécuter par `codex exec`
un `git commit` sur un constat bloquant indexé, contre un mock local de l’API Responses, sans
connexion ni modèle. Le test vérifie que le hook résout `${CLAUDE_PLUGIN_ROOT}` vers le plugin
installé, qu’il refuse le commit et qu’aucun commit n’atterrit. Il vérifie aussi que la nouvelle
tentative dans la même session (`codex exec resume`) passe.

### Le niveau navigateur sous le sandbox de Codex

`scan` lance Chromium et charge les pages qu’il audite. Voici ce qui a été mesuré avec Codex
CLI 0.172.0 sur macOS (Seatbelt), en scannant une page servie sur `127.0.0.1` :

| comment la commande a été lancée | résultat |
|---|---|
| `--sandbox workspace-write` (le défaut pour un agent qui peut modifier) | **échoue** : Chromium ne se lance pas |
| `--sandbox workspace-write -c sandbox_workspace_write.network_access=true` | **échoue**, de la même façon |
| `--sandbox danger-full-access` | fonctionne |

Activer l’accès réseau n’aide pas, parce que le sandbox arrête Chromium avant le chargement de toute
page. `codex sandbox --log-denials -- node …/ultra11y.mjs scan <url>` montre pourquoi : Seatbelt
refuse `mach-register org.chromium.Chromium.MachPortRendezvousServer.*` et les services macOS que le
navigateur recherche. Le moteur le rapporte comme un navigateur qu’il ne peut pas lancer (« …is not
installed, and no installed Google Chrome was found either »). Sous le sandbox, ce message ne signifie
**pas** que quoi que ce soit manque. Lancez donc le niveau navigateur **hors du sandbox** :

- démarrez la session qui scanne avec `codex --sandbox danger-full-access` (ou réglez
  `sandbox_mode = "danger-full-access"` dans `~/.codex/config.toml`) ; ou
- gardez `workspace-write`, démarrez avec `--ask-for-approval on-request`, et approuvez l’escalade
  quand Codex demande de relancer `scan` hors du sandbox ; ou
- lancez `scan` vous-même dans un terminal, puis transmettez à l’agent le `audit-latest.json` fusionné.

`[sandbox_workspace_write] network_access = true` reste ce dont une commande sandboxée a besoin pour
atteindre le réseau tout court, mais cela ne suffit pas pour Chromium. `render` et `report --evidence`
lancent le même Chromium ; seul `scan` a été mesuré. Le sandbox Linux de Codex (bubblewrap et
Landlock) n’a pas été mesuré. Considérez-le comme non vérifié, et utilisez le même contournement si
`scan` signale qu’il ne peut pas lancer de navigateur.

## OpenCode (1.x et 2.x)

```
ultra11y install --opencode                      # the major is asked of `opencode --version`
ultra11y install --opencode --opencode-version 2 # …or stated
```

OpenCode 2 a remplacé l’API de plugins, et les plugins V1 ne s’y exécutent pas. ultra11y livre **un
seul fichier de plugin que les deux versions majeures chargent** : OpenCode 2 lit les `{ id, setup }`
de son export par défaut, OpenCode 1 (≥ 1.18.28) appelle le `server()` de ce même objet, et les
versions V1 plus anciennes appellent l’export nommé `Ultra11yPlugin`. Le garde-fou s’exécute une fois
par appel shell sur chacune d’elles.

| | OpenCode 1 | OpenCode 2 |
|---|---|---|
| `install --opencode` écrit | `~/.config/opencode/plugin/ultra11y.js` | `~/.config/opencode/plugins/ultra11y.js` |
| …ou épinglez-le dans `opencode.json` | `"plugin": ["ultra11y@latest"]` | `"plugins": ["ultra11y@latest"]` |
| le garde-fou se branche sur | `tool.execute.before` sur `bash` | `ctx.tool.hook("execute.before")` sur `shell` |
| les deux skills sont enregistrées par | `config.skills.paths` | `ctx.skill.transform` |

Quand aucun `opencode` n’est sur le PATH, l’installateur écrit `plugin/`, que les deux versions
majeures lisent ; une copie antérieure du nôtre dans l’autre répertoire est supprimée pour que le
garde-fou ne se charge jamais deux fois. Un épinglage dans `opencode.json` et le fichier ensemble le
chargeraient deux fois — l’installateur le signale.

La différence : OpenCode n’a **aucun canal de décision de permission**. Son plugin bloque un appel
d’outil en levant une exception, donc la revue arrive sous la forme d’un **appel shell en échec dont
le message d’erreur porte les constats**. Même contenu, enveloppe différente — lisez l’erreur, ne
réessayez pas à l’aveugle.

Le moteur s’exécute sur le `node` du PATH (OpenCode lui-même est un binaire Bun) ; sans Node, le
garde-fou est silencieux plutôt que cassé. Les skills vivent aussi sous `~/.config/opencode/skills/`
(en respectant `$XDG_CONFIG_HOME`) une fois que `install --opencode` les y a copiées, et le moteur se
résout depuis le `scripts/ultra11y.mjs` de ce répertoire de skill — ou depuis le
`skills/ultra11y/` du paquet npm quand le plugin est épinglé dans `opencode.json`.

## Tout le reste (Cursor, Amp, Zed, Gemini CLI, Windsurf, aider…)

```
ultra11y install --agents-md
```

Écrit un bloc géré dans le `AGENTS.md` du dépôt. Soyez lucide sur ce que c’est : il n’y a pas d’API
de hooks, donc **rien n’est automatique**. Le bloc rend le moteur découvrable et transmet le protocole
d’arbitrage. Ce qui fait réellement respecter quoi que ce soit sur ces harness, c’est le garde-fou
propre au dépôt — `node scripts/ultra11y.mjs init --hook` (pre-commit git) — et, en CI, le bot `rgaa-audit` d’iterion.

Les critères eux-mêmes sont sur la CLI sur chaque harness : `criteria <id>` imprime les tests
numérotés d’un critère, `criteria --glossary <term>` les termes qu’il définit, et `criteria --plan` le
plan de travail — de sorte qu’un agent les lit au lieu de se les remémorer.

Sur un harness sans aucun système de skills, **lire `SKILL.md` directement avec l’outil de lecture de
fichiers est la voie officielle**, pas un contournement. Découvrez ce qui existe en listant
`skills/*/SKILL.md` et en lisant le frontmatter.

## La matrice

| | skills | revue automatique | comment il bloque | garde-fou du dépôt |
|---|---|---|---|---|
| Claude Code | plugin / `skills add` | oui | `permissionDecision: "deny"` | oui |
| Codex CLI | plugin / `skills add` | oui | `permissionDecision: "deny"` | oui |
| OpenCode 1.x · 2.x | plugin / `skills add` | oui | erreur d’outil levée | oui |
| Cursor, Amp, Zed, Gemini… | AGENTS.md | **non** | — | oui |

`ultra11y status` indique lesquels sont réellement branchés sur cette machine — y compris le seul
échec silencieux qui mérite d’être nommé, un hook Codex resté derrière un feature flag désactivé.

## Interrupteurs (identiques partout)

Ils vivent dans le moteur, pas dans un harness, donc une seule réponse les couvre tous :
`ULTRA11Y_HOOK_FAIL_ON=blocking|major|minor|off` (env, prioritaire), puis
`"hook": { "failOn": … }` dans `.ultra11yrc.json`, sinon `blocking`. `SKIP_A11Y=1` contourne une
fois ; `ULTRA11Y_HOOK=off` désactive le garde-fou pour la session.

# Orchestration — distribuer les phases de jugement

Les deux phases de jugement sont des listes de travail par item : `ADJUDICATE.todo.json` contient une
entrée par critère résiduel, `VERIFY.todo.json` une par non-conformité détectée. Aucune n’a de
dépendance entre items, donc toutes deux se distribuent proprement entre sous-agents — et toutes deux
fonctionnent exactement aussi bien en séquentiel. C’est une optimisation du temps écoulé, jamais une
exigence d’exactitude.

Un sous-agent qui arbitre a besoin des **deux** fichiers : `ADJUDICATE.todo.json` pour les preuves et
les emplacements où va son verdict, et `adjudicate/<criteriaId>.md` pour le critère lui-même — son
intitulé officiel, ses tests numérotés et, sous un référentiel national, la méthodologie de test propre
à ce référentiel. Le JSON ne porte aucun texte normatif, et les contrats émis le disent.

`orchestrate` émet l’orchestration à partir des listes de travail qui existent ACTUELLEMENT, avec les
chemins absolus et les vrais ids d’items intégrés :

```
node scripts/ultra11y.mjs orchestrate --run <dir> [--phase adjudicate|verify-report] [--eco] [--list]
```

`orchestrate --run <dir> --manifest --json` imprime la même boucle sous forme de données — pour chaque
étape, sa command/argv, ses entrées, ses sorties, son contrat de code de sortie et l’étape suivante —
pour un orchestrateur qui n’est pas une session d’agent de code, comme un moteur de workflows ou une CI
hors GitHub (voir `references/orchestrators.md`). Le RUNBOOK en est un rendu.

Les commandes `verify-report` qu’il émet — génération, fold, la ligne de fold du réfutateur et le
garde-fou sémantique — portent toutes **un seul contexte d’exécution** : l’audit de l’exécution
(`--in <RUN>/audit-latest.json`, ou le `--in` avec lequel la liste a été générée), son `--standard`, et
la source de conformités explicite à partir de laquelle la liste a été construite
(`--conformities <file>` / `--no-conformities`), relue depuis `<RUN>/VERIFY.context.json`. Sans
`--in`, un répertoire sans registre produit une liste qui met à l’épreuve les non-conformités du
rapport et ignore silencieusement chaque conformité que l’arbitrage a validée ; le fold les compte
alors « missing ». Gardez le même contexte des deux côtés — `--max-verify 0` ne peut pas réparer une
liste générée à partir d’une autre source d’affirmations, seule sa régénération le peut.

## Ce qu’écrit `orchestrate`

Pour chaque phase prête `<p>` (`adjudicate`, `verify-report`), sous `<RUN>/orchestration/` :

```
<p>.batches.json          the batches as data — the canonical, harness-neutral output
<p>/<batch-id>.md         one self-contained prompt per batch (batch ids: <p>-01, <p>-02, …)
out/<p>/                  where each batch's answer is saved: out/<p>/<batch-id>.json
<p>.workflow.mjs          the Claude Code Workflow-tool adapter, rendered from the same batches
agents/<role>.md          the dispatch contracts (adjudicator, refuter)
RUNBOOK.md                the sequential path, and where the batch files are
```

`<p>.batches.json` vaut `{ kind: "ultra11y-orchestration-batches", schemaVersion: 1, phase, role, run,
engine, worklist, items, batchSize, schema, fold, batches[] }`. Chaque lot porte son `id`, son
`role`, `ids` (ses `ITEMS=`), `items` (les entrées exactes de la liste de travail sur lesquelles il
statue), `contract`, `prompt`, `output`, `schema` (ce contre quoi sa réponse doit être validée) et
`fold` (la commande moteur que l’unique écrivain exécute une fois toutes les réponses arrivées). Le
fichier de prompt contient tout cela en prose : les items, les briefs de critères à lire, le contrat
du rôle en ligne, le schéma et le chemin de sortie. Transmettez-le à un sous-agent **tel quel** ; rien
d’autre n’a besoin d’être passé.

Les `BATCHES` du script de workflow et les `batches` / `batchIds` / `prompts` / `batchOutputs` du
manifeste proviennent du même enregistrement de lots, donc aucun adaptateur ne peut distribuer une
partition différente. `--eco` n’écrit ni lots ni workflow, et supprime ceux qui resteraient.

## Router selon le harness — un contrat, tous les harness

Chaque recette se termine de la même façon : **chaque sous-agent renvoie un objet JSON qui se valide
contre le `schema` de son lot ; ce JSON est enregistré à l’`output` du lot ; vous, l’agent principal et
l’unique écrivain, remplissez la liste de travail à partir de ces réponses et exécutez le `fold` du
lot** (`verify --apply` pour la phase). Les garde-fous ne savent pas quel harness a produit les
verdicts.

- **Claude Code.** `orchestrate --run <RUN> --phase <p>`, puis soit
  `Workflow({ scriptPath: "<RUN>/orchestration/<p>.workflow.mjs" })`, qui distribue chaque lot et
  renvoie les fragments, soit, là où l’outil Workflow n’est pas disponible, un sous-agent de l’outil
  Agent par `<RUN>/orchestration/<p>/<batch-id>.md`, chacun recevant ce fichier comme prompt.
  Enregistrez chaque fragment à l’`output` de son lot, puis lancez le fold.
- **Codex.** Même `orchestrate`. Lancez un sous-agent par fichier de prompt sous
  `<RUN>/orchestration/<p>/` et donnez-lui le contenu du fichier comme tâche. Enregistrez chaque JSON
  renvoyé à l’`output` du lot (ou laissez le sous-agent l’y écrire lui-même, le seul fichier que le
  prompt lui autorise), puis lancez le fold.
- **OpenCode.** Même `orchestrate`. Un appel de l’outil Task par fichier de prompt, le contenu du
  fichier servant de prompt de tâche. Enregistrez chaque JSON renvoyé à l’`output` du lot, puis lancez
  le fold.
- **Pas de sous-agents, ou eco.** Soit parcourez vous-même les fichiers de prompt, l’un après l’autre,
  en enregistrant chaque réponse à son `output` avant le fold, soit sautez complètement les lots :
  `orchestrate --run <RUN> --eco` et suivez `<RUN>/orchestration/RUNBOOK.md`, en remplissant la liste
  de travail sur place. Les deux sont identiques en exactitude à la distribution ; seul le temps écoulé
  diffère.

Les réponses enregistrées sous `out/<p>/` sont à vous de les replier ; `orchestrate` ne les supprime
jamais. Après le fold, videz-les avant la prochaine distribution sur une liste de travail régénérée.

## L’autre dispatch : la revue

Les phases de jugement ne sont pas la seule chose qui sort de cette skill. Une fois que l’audit a
produit des correctifs, la **skill `review-a11y`** relit le code modifié — distribuée de la même
façon, et lue dans le même tableau :

| Votre harness | Comment lancer la revue |
|---|---|
| Sous-agents (outil Workflow ou non) | Un sous-agent, un prompt : utiliser la skill `review-a11y` sur la modification, renvoyer son rapport tel quel. |
| Pas de sous-agents | Invoquer `review-a11y` directement, dans cette session. |

Elle diffère d’un lot de jugement sur un point qui compte : **la revue n’est pas une liste de
travail**. Rien n’est replié, aucun garde-fou ne la relit, et elle n’écrit rien — donc la règle de
l’unique écrivain ci-dessous est satisfaite trivialement, et il n’y a pas d’étape `--apply` à garder.
Ce qui revient est un rapport destiné à un humain.

## Les règles qui ne plient pas

- **Les sous-agents n’écrivent jamais la liste de travail.** Chaque contrat émis se termine par la
  règle de l’unique écrivain, et le fold `--apply` « fail-closed » (en cas de doute, refuser) reste
  toujours chez vous, l’orchestrateur. Le seul fichier qu’un sous-agent peut écrire est l’`output` de
  son propre lot, et seulement quand son harness ne peut pas renvoyer le JSON. Des écrivains parallèles
  sur une même liste de travail, c’est ainsi qu’un verdict disparaît silencieusement.
- **Les garde-fous sont indépendants du harness.** `check` et `verify --apply` se comportent à
  l’identique qu’un agent ou douze aient produit les verdicts, donc une distribution ne peut jamais
  obtenir un résultat plus vert que le chemin séquentiel.
- **Relancez `orchestrate` chaque fois qu’une liste de travail change.** L’émission est déterministe
  et idempotente, donc la relancer ne coûte rien et garde les lots alignés sur la réalité.
- `--phase <p>` avant que sa liste de travail n’existe échoue, et nomme la commande qui la produit.

## Découper le travail judicieusement

Un lot d’arbitrage devrait regrouper des critères qui partagent un contexte — les critères médias
ensemble, les critères de formulaires ensemble — pour que chaque sous-agent lise une partie de la base
de code plutôt que toute. Les contrats émis regroupent déjà ainsi ; si vous distribuez à la main,
gardez ce regroupement.

Un sous-agent qui arbitre un critère a besoin des trois mêmes choses que vous : les preuves collectées,
la règle de décision (`references/adjudication.md`), et le rappel qu’une non-conformité doit citer un
test normatif qui se résout. Pointez chaque contrat vers la référence de connaissance pertinente
plutôt que de la reformuler — une paraphrase dérive.

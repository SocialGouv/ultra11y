# Piloter le moteur depuis un orchestrateur

La skill suppose qu’une personne ou un harness de code est dans la boucle. Un
**orchestrateur** — un moteur de workflows d’agents comme le
[bot `rgaa-audit`](https://github.com/SocialGouv/iterion/tree/main/bots/rgaa-audit) d’iterion, un job de CI, un exécuteur cron —
est différent : rien ne lit une bannière, rien ne réessaie sur une intuition, et les seules choses qui
circulent entre les étapes sont des codes de sortie et du JSON. Cette page est le contrat pour cet appelant.

La forme qui compte : **le moteur trouve, l’agent arbitre, les garde-fous refusent.** Gardez
la détection déterministe et il n’y a aucun modèle entre « un défaut existe » et « un défaut est
compté » — c’est toute la raison de brancher le moteur plutôt que de demander un audit à un modèle.

## Résoudre le moteur

Épinglez la version. Sinon `npx` résout `latest`, et ce qui s’exécute peut changer sans aucun commit
nulle part.

```sh
npm_config_update_notifier=false npx -y ultra11y@5.43.0 --version   # → 5.43.0, exit 0
```

- **`npm_config_update_notifier=false` n’est pas optionnel.** Sans lui, npm imprime son
  avis « New major version available » dans la sortie qu’une étape s’apprête à analyser.
- **`ULTRA11Y_BIN`** pointe vers un moteur que vous avez déjà (un `ultra11y.mjs` vendorisé, une
  couche de conteneur). Pour toutes les commandes sauf `scan`, le moteur est un fichier autonome sans
  dépendance d’exécution, donc vendoriser est une voie prise en charge — c’est exactement ce que font
  les skills. `scan` résout `@playwright/test` et `@axe-core/playwright` d’abord depuis
  `--cwd`, puis depuis l’installation propre du moteur, donc un fichier vendorisé seul ne peut pas scanner.
- **Node ≥ 22.18.** Aucune autre dépendance système, aucune clé d’API. (`scan` a besoin d’un niveau
  navigateur — voir `references/dynamic.md`.)
- **Épinglez le fichier, pas seulement la version.** Un orchestrateur qui résout lui-même le moteur
  devrait vérifier le sha256 du fichier d’entrée avant de l’exécuter : `--version` est une bannière que
  n’importe quel fichier peut imprimer.
- **Vérifiez ce que vous avez résolu, et échouez si ce n’est pas ce que vous avez demandé.** Une étape
  qui laisse passer un moteur manquant rapporte zéro constat, ce qui se lit exactement comme un audit
  propre. C’est le seul mode d’échec sur lequel il vaut la peine d’être bruyant.

## Le pipeline

Six étapes. Quatre sont déterministes ; seule l’étape 3 fait intervenir un modèle.

```sh
ENGINE="npx -y ultra11y@5.43.0"        # or "node $ULTRA11Y_BIN"
RUN=/tmp/a11y-run                          # out-of-tree: voir « Où atterrit la sortie »

# 1. FIND — the static engine. No model. This is the finding set.
$ENGINE audit "<globs>" --graph --out "$RUN" --json --lang en > /dev/null
#    …or, on a pull request, exactly what the branch introduced:
$ENGINE audit --since "$BASE_REF" --graph --out "$RUN" --json --lang en > /dev/null

# 2. WORKLIST — the criteria a static pass cannot decide, one brief per criterion.
$ENGINE verify --manual --in "$RUN/audit-latest.json" --out "$RUN" --json
#    → { count, todoPath, verdictsPath, itemsDir, mdPath, items }. ADJUDICATE.todo.json carries
#    the evidence (it can reach hundreds of KB); ADJUDICATE.verdicts.json is the same worklist
#    without it — hand the agent that slim file plus the briefs in <itemsDir>/<criterion>.md.

# 3. ADJUDICATE — the agent fills every `verdict` (C/NC/NA/manual) in the verdicts file.
#    The file carries its own `contract` (see below) — the agent needs nothing else. The fold
#    re-hydrates the evidence from the audit, so a verdicts-only file is accepted. An agent
#    WITH a shell (a Claude Code, Codex or OpenCode session) fills ADJUDICATE.todo.json in place instead — one
#    file or the other, never both. Each `citations[]` entry is { file, line, selector,
#    snippet } copied from the criterion's own evidence (references/judgment.md).

# 4. FOLD — partial by default: every verdict the gate accepts lands, every refusal is named
#    in `rejectedCriteria[]` / `issues[]`, and a criterion absent from the file — a coverage
#    gap, not a refusal — is named apart in `notInWorklist[]` and stays to assess. A verdict for a criterion a previous fold already decided is refused too
#    (« not open for adjudication »), so re-applying a file on the written-back audit is safe.
#    Exit 0 only when the gate refused nothing. Any refusal exits 1: the accepted verdicts
#    are still written to audit-latest.json, the refused criteria stay to assess, and a
#    closing « Repli incomplet : N critère(s) refusé(s) » line says so. Nothing landed also
#    exits 1, with no audit written. `--strict` makes it all-or-nothing (exit 1 on any
#    refusal, audit left untouched). A `manual` verdict (undecidable) is not a refusal.
$ENGINE verify --apply "$RUN/ADJUDICATE.verdicts.json" --in "$RUN/audit-latest.json" --out "$RUN" --json

# 5. REPORT — deterministic rendering of the adjudicated audit.
$ENGINE report --in "$RUN/audit-latest.json" --out audits --standard rgaa --lang fr

# 6. GATE — integrity. Exit ≠ 0 on an invented criterion or unjustified NA.
$ENGINE check --report audits/rgaa-*.md --in "$RUN/audit-latest.json" --json
```

L’étape 4 est celle à comprendre : c’est un **garde-fou déterministe sur la sortie du modèle**. Un
verdict sans justification, une NC sans `normativeRef` résoluble, un critère absent de l’arbitrage —
chacun est refusé nommément, et l’exécution s’arrête. C’est ce qui rend le rapport final défendable.

**En CI, le bot `rgaa-audit` d’iterion exécute ce pipeline pour vous**, avec des agents en lecture
seule à l’étape 3 et une passe de contre-vérification après elle (voir `references/ci.md`). Dans tous
les cas, les étapes 1, 2, 4, 5 et 6 restent déterministes, et seule l’étape 3 fait intervenir un modèle.

## La boucle sous forme de données — `orchestrate --manifest`

Plutôt que de redériver le graphe d’étapes ci-dessus à partir de cette page, lisez-le depuis le moteur :

```sh
$ENGINE orchestrate --run "$RUN" --manifest --json
```

Il imprime (et n’écrit rien) `{ kind: "ultra11y-orchestration-manifest", schemaVersion: 1, run,
engine, standard?, placeholders[], phases[], steps[] }`. Chaque étape porte :

- `id`, `kind` (`engine` | `judgment`), `title` et `next` (l’id de l’étape suivante, `null`
  à la fin) ; l’étape `gate` ajoute `onFailure: "fix"`, et `fix` reboucle sur `audit` ;
- `inputs[]` / `outputs[]` — les fichiers absolus qu’elle lit et écrit, de sorte que ce qu’une étape
  écrit est littéralement ce que la suivante lit ;
- étapes moteur : `command` (une ligne shell) et `argv` (`["node", <engine>, …]`), plus `exit` —
  ce que `0`, `1` et `2` signifient pour cette étape (le tableau ci-dessous, par étape) ;
- étapes de jugement : `role` (`adjudicator` | `refuter`), `contract` (le contrat de dispatch
  qu’`orchestrate` écrit sous `orchestration/agents/`), `worklist`, `items`, `batches` (les ids d’items
  que traite chaque sous-agent) et `schema` (le fragment structuré qu’un lot renvoie quand il est
  distribué ; le chemin séquentiel remplit la liste de travail sur place) ; plus, pour les mêmes lots
  dans le même ordre, `batchFile` (`orchestration/<phase>.batches.json`), `batchIds`, `prompts` (un
  fichier de prompt autonome par lot) et `batchOutputs` (où la réponse de chaque lot est enregistrée).
  `orchestrate` sans `--eco` écrit ces fichiers ; le manifeste les nomme dans tous les cas (voir
  `references/orchestration.md`) ;
- `ready` — chaque entrée réelle existe maintenant (les placeholders sont à vous de substituer).

`placeholders[]` nomme les jetons qu’un appelant substitue : `<globs>` (ce qu’il faut auditer) et,
tant qu’une liste de travail de contre-vérification n’a pas été générée, `<report.md>` (le rapport
qu’écrit l’étape `report`). Chaque commande porte le contexte de l’exécution : `--in`, `--standard` et
la source de conformités avec laquelle la liste de contre-vérification a été construite. Le
`RUNBOOK.md` destiné à l’agent est rendu à partir de ce même manifeste, donc les deux ne peuvent pas
diverger.

## Le contrat d’arbitrage

`ADJUDICATE.todo.json` déclare ce qui peut y être écrit, afin que celui qui le remplit n’ait jamais à
lire le code source d’ultra11y :

```jsonc
{
  "contract": {
    "verdicts": ["C", "NC", "NA", "manual"],
    "manualReasons": ["needs-rendered-dom", "undecidable"],
    "requires": {
      "C":  "a non-empty justification AND citations[] naming the harvested evidence it cleared …",
      "NA": "a non-empty justification",
      "NC": "at least one groundable finding, each citing a normativeRef that resolves against the active standard",
      "manual": "a reason ∈ {needs-rendered-dom, undecidable}"
    }
  },
  "items": [ /* one per criterion the engine could not decide; fill `verdict` */ ]
}
```

Notez ce que coûte `C` : un verdict qui disculpe est contrôlé exactement comme un verdict qui accuse.
Il doit nommer dans `citations[]` les preuves qu’il a écartées, chaque ancre étant résoluble et tirée
des preuves collectées pour ce critère — et un critère présenté **sans** aucune preuve ne peut pas du
tout être `C`. C’est ce qui empêche « C partout avec une phrase plausible » de passer.

L’en-tête est **indicatif**. `verify --apply` valide contre ses propres constantes, donc modifier le
contrat dans le fichier n’élargit rien.

Les verdicts sont comparés **sans tenir compte de la casse** (`na` vaut `NA`, `MANUAL` vaut `manual`)
— un accident d’orthographe n’est pas un désaccord sur l’accessibilité. Un verdict hors du vocabulaire
est quand même refusé, et le message nomme les quatre valides.

`manual` est le verdict honnête pour tout ce qui a réellement besoin d’une page rendue. Il garde le
critère dans `residualRisks`, où le rapport le déclare comme risque résiduel. **Ne convertissez
jamais un critère non décidé en `C`** — c’est le seul moyen de transformer ce pipeline en ce qu’il
remplace.

## Déposer les constats sur un outil de suivi

`tickets` dépose directement dans **GitHub, GitLab ou Jira** (voir `references/tickets.md`). Pour
tout autre tableau — un kanban natif, un outil interne — prenez les mêmes items en JSON et déposez-les
vous-même :

```sh
$ENGINE tickets --in "$RUN/audit-latest.json" --out "$RUN" --lang en
# → $RUN/issues-<date>.json   (writing the set files nothing; add --dry-run to be explicit)
```

`--grain` décide de ce qu’est un item : `criterion` (par défaut), `page`, `page-criterion`,
`single` ou `file`. L’enveloppe et la forme d’un item sont les mêmes à chaque granularité.

```jsonc
{
  "tool": "ultra11y", "kind": "issues", "schemaVersion": 1,
  "standard": "wcag", "grain": "criterion", "date": "2026-08-12", "count": 4,
  "issues": [{
    "title": "[a11y] WCAG 1.1.1 — Non-text Content",   // the de-dupe grain: stable across runs
    "body": "…",                                       // the auditor block, rendered
    "labels": ["accessibility", "wcag", "bloquant"],
    "severity": "bloquant",
    "advisory": false,                                 // true ⇒ a good practice, NOT a non-conformity
    "scope": { "grain": "criterion", "criteriaId": "1.1.1" },
    "occurrences": [{ "file": "src/Page.tsx", "line": 4, "selector": "img", "message": "…" }]
  }]
}
```

À la granularité par défaut, une issue par critère, pas par occurrence — un `alt` manquant sur
quarante images est un seul item avec quarante `occurrences`, pas quarante tickets. **La
déduplication se fait sur `title`**, donc une nouvelle exécution ne dépose rien deux fois ; gardez
`--lang` stable d’une exécution à l’autre, puisque l’intitulé d’un critère fait partie de son titre.
`advisory: true` marque une recommandation non normative : elle ne doit pas être triée comme une
non-conformité, et elle n’entre jamais dans le taux de conformité.

## Où atterrit la sortie

`--out <dir>` contient entièrement ce qu’une commande écrit : dirigé hors du checkout, un audit laisse
le dépôt cible identique octet pour octet. Cela compte quand l’orchestrateur audite un dépôt qui ne
lui appartient pas — écrivez les intermédiaires de l’exécution hors de l’arborescence et ne laissez
atterrir dans le projet que le rapport final daté, si tant est qu’il y atterrisse.

`.ultra11y/pages/` n’est écrit que par les commandes d’instantané de page (`scan`, `snapshot`).
Toutes deux acceptent `--root` pour le déplacer — pour `scan`, c’est l’endroit où sont écrits les
instantanés qu’il collecte (`--cwd` reste l’endroit d’où Playwright est résolu), de sorte qu’un
orchestrateur peut s’exécuter depuis le checkout audité sans le salir. `audit`, `report`, `prd`,
`tickets`, `verify` et `check` n’y touchent jamais.

## Codes de sortie

| | 0 | 1 | 2 |
|---|---|---|---|
| `audit` | rapporté (sans `--fail-on`), ou propre | constats ≥ `--fail-on` | usage / entrée invalide |
| `verify --apply` | repli complet : le garde-fou n’a rien refusé (les `manual` et les `notInWorklist[]` ne sont pas des refus) | repli incomplet : au moins un refus (l’audit partiel est écrit, `auditPath` présent, refus dans `rejectedCriteria[]` / `issues[]`), ou rien n’a atterri, ou `--strict` et un refus (rien n’est écrit) | usage / entrée invalide |
| `check` | le rapport est sain | échec d’intégrité | rapport introuvable / entrée invalide |
| `prd` | écrit | — (il écrit du markdown et ne dépose rien) | usage / entrée invalide |
| `tickets` | déposé, ignoré, ou rien à déposer | une création a échoué, le fournisseur est inutilisable, ou aucune page dans le périmètre | usage / entrée invalide / au-delà de `--max-tickets` |

Lisez les codes de sortie depuis le processus, **pas** depuis un pipeline — `cmd --json | head`
rapporte le statut de `head`, et c’est ainsi qu’un garde-fou en échec se lit comme un succès.

## Ce que le JSON vous dit

- `audit --json` → l’`AuditResult` (également dans `<out>/audit-latest.json`) : `findings[]` avec
  `findingId` stable, `criteriaId`, `severity`, `file`, `line` ; `residualRisks[]` ;
  `conformancePct` — le **taux de réussite statique automatique**, pas un taux de conformité.
- `verify --apply --json` → `{ ok, auditPath, applied, stillManual, rejected, rejectedCriteria[], notInWorklist[],
  issues[], conformancePct, automaticPassRatePct, conformanceRatePct?, conformance?, findings, grounding }` ;
  `ok` suit le code de sortie : `false` dès que le garde-fou a refusé un critère (`rejected > 0`),
  y compris quand le reste a atterri — **`ok: false` ne signifie donc pas « rien n’a été écrit »** :
  la présence d’`auditPath` dit que l’audit partiel a été écrit ; seule la sortie d’un repli où rien
  n’a atterri (ou `--strict`) en est dépourvue. Chaque ligne de refus d’`issues[]` commence par
  `criterion <id>:` (ou `criterion <id>, page <id>:` pour un verdict de page). `conformancePct` est conservé tel quel — le taux de réussite
  statique **automatique** du cœur WCAG, qu’aucun jugement ne fait bouger — et `automaticPassRatePct`
  est le même nombre sous son vrai nom. Sous un référentiel de pack, `conformance` est le taux de
  conformité propre au référentiel avec ses opérandes (l’objet que porte `report --json`) et
  `conformanceRatePct` son pourcentage, `null` quand rien n’est applicable : c’est le taux qu’un
  arbitrage fait bouger. `rejected` ne compte que les verdicts que le garde-fou a refusés ; les critères
  ouverts que le fichier n’a jamais mentionnés (un lot, un balayage tronqué) sont dans
  `notInWorklist[]`. Le code de sortie dit si le repli est complet (0) ou non (1) ; pour savoir ce qui
  a atterri, comptez sur `applied + stillManual + rejected + notInWorklist.length`.
- Avec `--prune`, **`ok: false` ne signifie pas « rien n’a été appliqué »**. La CLI calcule d’abord les
  verdicts de couverture et d’ancrage, mais `applyPrune` écrit le `audit-latest.json` élagué et répare
  le fichier `--ledger` AVANT que `ok` ne soit dérivé — donc une contre-vérification qui échoue sur
  l’ancrage a quand même appliqué chaque réfutation qu’elle a décidée. Lisez `pruned` dans le JSON (ou
  le document d’audit lui-même) pour savoir ce que dit désormais l’audit ; ne rapportez jamais
  `ok: false` comme « contre-vérification non appliquée ».
- `grounding` rouvre chaque fichier cité d’un verdict retenu. Un `file` qui est une URL servie
  (`^[a-z][a-z0-9+.-]*://` — un constat rendu dont la page n’a aucune capture `.ultra11y/pages`
  rattachée à la source) n’a pas de source sur disque à rouvrir et est ignoré comme `stdin`, pas compté
  comme `failed`.
- Sous un référentiel de pack (`--standard rgaa`), `audit-latest.json` est un document `pack-audit` :
  son `conformancePct` racine est le taux de réussite automatique pour ce référentiel, `core` est
  l’audit WCAG, et `verify --apply --json` renvoie le taux du **cœur** comme `conformancePct` /
  `automaticPassRatePct`, à côté de la `conformance` du pack. `report --json` dit ce que dit le
  rapport : `conformancePct` est le taux de conformité propre au référentiel (validés ÷ validés
  + NC + à évaluer, NA exclus ; `null` quand rien n’est applicable), `conformance` ses opérandes
  (`validated`, `applicable`, `na`, `open`, `decided`, `total`), `automaticPct` / `automatic`
  le taux automatique de l’annexe, et `standard` la clé résolue (`--standard RGAA` → `rgaa`).
- `check --json` → `{ ok, issues[] }`.
- `scan --merge --json` → le document d’audit fusionné, ouvert par un résumé `pages` de premier niveau :
  `{ sample, recorded[], refused: [{id, reason}] }` — la taille de l’échantillon déclaré (`--sample`),
  les ids d’instantanés écrits sous `.ultra11y/pages/`, et les pages que le scan a refusées avec leur
  motif (les avertissements de refus vont aussi sur stderr). Rapportez la couche rendue à partir de
  lui — capturé contre refusé — au lieu de la redériver des mtimes des répertoires. Le document écrit
  dans `--out` garde le schéma d’audit simple ; le résumé ne circule que sur stdout.

## Règles d’honnêteté qu’un orchestrateur doit porter

Le moteur est explicite sur ce qu’il n’a pas décidé ; un wrapper qui aplatit cela produit exactement le
faux certificat de bonne santé que cette conception existe pour empêcher.

1. **Un moteur manquant est un échec, jamais un ensemble de constats vide.**
2. **Rapportez les critères résiduels.** Les critères de rendu (contraste, focus, zoom, reflow)
   restent non décidés tant que `scan` n’a pas tourné — et sous le RGAA ils restent non décidés après
   un scan propre, qui ne fournit que des signaux, jusqu’à ce que quelqu’un les arbitre. Dites-le ; ne
   laissez pas un résumé d’étape suggérer une couverture complète.
3. **`conformancePct` est le taux de réussite statique.** Étiquetez-le comme tel.
4. **Ne laissez jamais un modèle écrire les comptes.** Prenez-les dans le JSON — les nombres existent
   précisément pour que rien n’ait à être redérivé par un modèle qui risque de perdre un champ.

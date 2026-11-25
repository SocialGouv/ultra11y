# Les garde-fous `check` et `verify`

Deux niveaux d’assurance avant de livrer un rapport, plus la liste de travail d’arbitrage par l’agent.

## `check` — intégrité structurelle

```
node scripts/ultra11y.mjs check --report audits/rgaa-YYYY-MM-DD.md
```
Passez le rapport lui-même ; l’annexe technique vers laquelle il pointe (`annexe-technique-…md` /
`technical-annex-…md`, même répertoire) est lue avec lui, et une annexe manquante est refusée (exit 2).
Échoue (code non nul) si : l’une des 5 sections manque, un id de critère cité n’existe pas dans le
référentiel actif, un critère `NA` n’a pas de justification, ou le taux de réussite est absent. C’est
la protection de base contre les hallucinations. `--quiet` n’émet que le code de sortie ; `--json` la
liste structurée des problèmes. Pour le rapport d’un pack national, ajoutez `--standard <pack>` pour
que la bonne grammaire d’ids / le bon registre soit validé.

### Garde-fou sémantique — `check --report … --semantic`

```
node scripts/ultra11y.mjs check --report audits/rgaa-YYYY-MM-DD.md --semantic [--verdicts VERIFY.todo.json]
```
Échoue **fermé** s’il n’y a aucun artefact de verdicts arbitrés (jamais vert-mais-inactif), relance le
contrôle de couverture **sans plafond**, et ré-ancre chaque verdict retenu contre la source citée.
`--verdicts` pointe vers l’artefact (par défaut `VERIFY.todo.json` à côté du rapport). Un `file` qui
est une URL servie (un constat rendu dont la page n’a aucune capture `.ultra11y/pages` rattachée à la
source) n’est pas un chemin à rouvrir : il est ignoré comme `stdin`, jamais rapporté comme
« cited file not found ».

### Garde-fou d’applicabilité — `check --report … --standard rgaa --in audit.json`

```
node scripts/ultra11y.mjs check --report audits/rgaa-YYYY-MM-DD.md --standard rgaa --in audit.json
```
Redérive la vue du pack à partir de l’audit et échoue sur toute NC **sur- ou sous-projetée** — le
garde-fou d’applicabilité RGAA, pour qu’un rapport de pack ne puisse ni perdre ni inventer un critère
par rapport au cœur WCAG.

## `verify` — vérification contradictoire des non-conformités

```
node scripts/ultra11y.mjs verify --report audits/rgaa-YYYY-MM-DD.md --semantic
```
Génère une **liste de travail** `VERIFY.md` + `VERIFY.todo.json` : une entrée par non-conformité
(critère ↔ `file:line` ↔ affirmation citée), et — par défaut — une par conformité ou
« non applicable » revendiqué par l’agent (`kind: "c"`, avec ses `citations[]`). `--max-verify`
plafonne les non-conformités (40 par défaut) ; la moitié conformités n’est pas plafonnée sauf si
`--max-verify` est donné, parce qu’une contre-vérification écourtée laisse chaque affirmation
au-delà du plafond continuer à compter comme conforme. Tout ce qu’un plafond écarte est nommé sur
stderr et fait échouer `--apply` comme « missing » ; `--max-verify 0` supprime le plafond.
`VERIFY.todo.json` est un simple tableau JSON d’entrées (contrairement à `ADJUDICATE.todo.json`, un
objet avec `items`).

**Générez et appliquez avec le même contexte.** Les conformités revendiquées viennent de
`--in <audit.json>` (l’audit dont provient le rapport), sinon de `--conformities <file>`, sinon du
registre du référentiel dans le répertoire courant. Sans aucun d’eux, seules les non-conformités sont
mises à l’épreuve — la génération avertit, et un `--apply` vert dit qu’il n’a couvert que les
non-conformités. Le contexte de la liste est enregistré à côté d’elle dans `VERIFY.context.json`
(audit, référentiel, source de conformités, ce qu’un plafond a écarté), de sorte que lorsque `--apply`
trouve des affirmations « missing », il distingue un plafond (`--max-verify 0` le corrige) d’une liste
construite à partir d’une autre source d’affirmations (régénérez-la avec les
`--in`/`--standard`/`--conformities` de l’application ; lever un plafond qui ne s’est jamais appliqué
ne change rien). `--no-conformities` et `--max-verify` restent disponibles, et produisent une
contre-vérification partielle. Pour chaque entrée, ouvrez le code cité et attribuez un verdict dans
`VERIFY.todo.json` :

- `supported` — la non-conformité est réelle ;
- `partial` — réelle mais le critère / la formulation est imprécis ;
- `refuted` — fausse (l’élément cité est en réalité conforme) ;
- `unsupported` — l’élément cité ne suffit pas pour décider.

En mode `--semantic`, confirmez explicitement que l’extrait cité **étaye** la non-conformité. L’étape
de génération de la liste de travail accepte aussi `--json` (émet `{mdPath, todoPath, count, items}`
pour qu’un agent puisse remplir les verdicts en mémoire). **Traitez en priorité les constats
`preliminary`** (source SFC / bibliothèque, voir `references/false-positives.md`) : réfutez ceux que
le DOM rendu dément. Puis appliquez le garde-fou :
```
node scripts/ultra11y.mjs verify --apply VERIFY.todo.json --report audits/rgaa-YYYY-MM-DD.md --in audit.json
```
Le garde-fou échoue (code non nul) si une entrée est `refuted`, `unsupported` ou non arbitrée. Chaque
affirmation retenue est aussi ré-ancrée contre la source citée. Une conformité est ancrée comme le fold
l’a ancrée : une citation qui est l’une des ancres collectées pour son critère se rabat sur cette
ancre (le moteur a lu son extrait dans le fichier), donc une ressaisie que le fold a acceptée à
`verify --apply <adjudication>` n’est pas refusée à nouveau lors de la contre-vérification — passez
`--in <audit.json>` pour que la collecte puisse être redérivée ; une citation qui n’est PAS l’une des
ancres du critère doit toujours correspondre littéralement à la source. Objectif : aucune
non-conformité fabriquée ne survit jusqu’au rapport final, et aucune conformité acceptée n’est
re-réfutée un garde-fou plus loin.

**Le « non applicable » d’un agent passe aussi en contre-vérification.** Un NA valide un critère
(l’audit le replie en `C`, et le taux le compte comme conforme), donc la liste de travail le porte
comme n’importe quelle conformité revendiquée. Quand il ne cite rien — le cas habituel : rien n’a été
collecté pour le critère — l’item est marqué `uncited` et pose à la place la question au niveau du
périmètre : n’y a-t-il VRAIMENT rien, sur les pages auditées, qui relève du critère ? Une collecte vide
n’est pas une preuve : une page avec du contenu a toujours un ordre de lecture (RGAA 10.11, 10.12,
13.9), un ordre de tabulation (12.8) et un balisage à valider (8.2). Réfuté ou non étayé, le critère
revient à « à évaluer ». Le seul NA qui n’est PAS mis à l’épreuve est celui que le fold d’absence du
moteur prouve déjà — chaque sujet du critère est une espèce d’élément (`<img>`, `<table>`, un contrôle
de formulaire…) et aucune n’existe nulle part dans le périmètre.

### Le bilan de contre-vérification — `verify --summary`

```
node scripts/ultra11y.mjs verify --summary --verdicts VERIFY.filled.json --report audits/rgaa-YYYY-MM-DD.md \
  --in audit.json --standard rgaa [--pruned pruned/audit-latest.json] [--out <dir>] [--json]
```
Écrit `TRIAL.md` (ou les mêmes données en JSON sur stdout) : le bilan d’une contre-vérification, **en
lecture seule**. Il nomme l’audit, les verdicts, le rapport et l’audit élagué à partir desquels il a
été construit (chemin, date, sha256), puis sépare :

- **la couverture** — les affirmations attendues de ce rapport et de cet audit `--in`, couvertes,
  manquantes et *étrangères* (des verdicts pour des affirmations que cet audit ne fait pas : une liste
  tirée d’un autre audit) ;
- **les verdicts**, comptés en affirmations par type (non-conformité / conformité revendiquée) —
  `supported`, `partial`, `refuted`, `unsupported`, vides, invalides, manquants — avec les critères
  distincts à part ;
- **les constats confirmés** (`supported`/`partial`), chacun avec sa note ;
- **les retraits appliqués** — un jugement d’agent que `--prune` a retiré, montré comme appliqué
  seulement quand l’audit `--pruned` ne le porte plus ; sans `--pruned`, chaque retrait est listé comme
  *non constaté appliqué* ;
- **les décisions du moteur contestées — non résolues** (`skippedEngine`) : `--prune` les laisse
  volontairement dans l’audit et le rapport ; le bilan ne les transforme jamais en conformité ni en
  constat confirmé ;
- les affirmations **jamais mises à l’épreuve** ;
- **le garde-fou sémantique** (`check --semantic` sur ce rapport et ces verdicts) **séparément de**
  l’application des verdicts (`verify --apply … --prune` accepté ou refusé).

Le titre dit « counter-review run — audit NOT validated » tant que le garde-fou n’est pas vert sans
rien de manquant, d’étranger ou de contesté. Les trois entrées sont obligatoires — aucun registre ni
aucun `VERIFY.todo.json` à côté du rapport n’est jamais repris automatiquement — et la commande sort
avec 0 une fois le bilan écrit : c’est un rapport, `check --semantic` reste le garde-fou.

## `verify --manual` — arbitrer les critères résiduels (jugement / besoin de rendu)

L’**agent IA** décide lui-même des critères `manual`, sous garde-fou. Lancez depuis le cwd de l’audit
(la collecte relit les fichiers source audités) :
```
node scripts/ultra11y.mjs verify --report audits/rgaa-YYYY-MM-DD.md --in audit.json --manual --out .
```
Cela émet une **liste de travail d’ARBITRAGE** — `ADJUDICATE.todo.json` + `ADJUDICATE.md`, un item par
critère résiduel, préchargé avec les preuves collectées par le moteur (l’`alt` de chaque image, le
texte + contexte de chaque lien, les paires de couleurs littérales, les étiquettes des contrôles, le
plan des titres, l’état ARIA, `tabindex`, les changements de langue). Remplissez le `verdict` de chaque
item (provenance `decidedBy: "agent"` enregistrée) :

- `C` / `NA` — avec une `justification` tirée des preuves ;
- `NC` — avec ≥1 constat **ancrable** (`file`/`line`/`message`/`snippet`) ;
- `manual` — avec un `reason` : `"needs-rendered-dom"` (décider via `scan`) ou `"undecidable"`.

Repliez les verdicts en mode FAIL-CLOSED (en cas de doute, refuser) :
```
node scripts/ultra11y.mjs verify --apply ADJUDICATE.todo.json --in audit.json --out .
```
Il rejette un verdict nul, un `C`/`NA` sans `justification`, un `NC` sans constat ancrable, un
`manual` sans `reason`, ou tout critère résiduel non couvert. Un critère ouvert que le fichier ne
mentionne pas du tout n’est pas un refus — rien n’a été proposé — et il est nommé à part dans
`notInWorklist[]` (« hors de la liste ») : replier un lot de 11 critères sur 46 rapporte
`rejected: 0, notInWorklist: [35 ids]`, jamais « 35 rejetés ». Il reste « à évaluer » sans faire
échouer le repli (code 0) ; `--strict` refuse toujours sur lui. Un verdict pour un critère
qui n’est plus ouvert — un critère qu’un fold précédent a déjà décidé — est de même refusé nommément
(« not open for adjudication »), jamais réappliqué : replier à nouveau le même fichier sur l’audit
réécrit répond `ok: false` avec ce critère dans `rejectedCriteria[]`.

**Code de sortie.** 0 seulement quand le garde-fou n’a rien refusé. Dès qu’un critère est refusé,
le repli est **incomplet** et sort en 1 — même si le reste a atterri : l’audit partiel est écrit
(`auditPath`), les critères refusés restent « à évaluer », `ok: false`, et une dernière ligne
`✗ Repli incomplet : N critère(s) refusé(s) par la porte…` le dit. Un verdict `manual` (indécidable,
nommé plus tard sous `check --allow-undecided`) n’est pas un refus. Chaque ligne de refus commence
par `criterion <id>:` — `criterion <id>, page <id>:` pour un verdict de page —, y compris
« cited snippet not found in … ». 2 reste l’usage / entrée invalide. Les `NC` de l’agent deviennent de
vrais constats `agent:<sc>` qui se réaffichent dans le §2 du rapport et réintègrent la liste de travail
de vérification ; `report`/`prd` se réaffichent avec les statuts arbitrés ; le §5 se réduit aux seuls
items encore `manual`. Un verdict `manual` — ou un trou de couverture — sur un critère que le moteur
avait provisoirement clos faute de sujet reste uniquement dans le §5 : il n’est jamais compté dans la
colonne NA, qui reste un sous-ensemble des C du §3.

### Le verdict d’un auditeur humain — `decidedBy: "human"`

Un auditeur humain nommé arbitre via la **même liste de travail** : sur chaque item sur lequel il
statue, il définit `"decidedBy": "human"` et `"auditor": { "name": "Jeanne Dupont", "organisation": "Access42" }`
(`organisation` facultatif) à côté du verdict. Le fold applique le **même garde-fou** — un `C` humain
cite les preuves collectées, un `NC` humain porte des constats ancrables ; un nom n’est pas une
preuve — et refuse un verdict humain sans `auditor.name`, ou tout `decidedBy` autre que `agent` /
`human`. Un verdict qui atterrit est enregistré comme `decidedBy: "human"` avec son `auditor` dans
l’audit, le document du pack et le registre des verdicts (`--ledger` ; un rejeu restaure les deux), et :

- compte comme tout verdict décidé dans le taux de conformité, et reste hors du taux **automatique**
  (un jugement, pas une mesure) ;
- se lit « auditeur (Jeanne Dupont, Access42) » dans la colonne « Décidé par » du rapport (jamais
  « IA »), a sa propre liste dans le §3 et son propre compte dans la ligne de provenance de l’annexe,
  et est marqué `C†` (celui de l’agent est `C*`) dans la grille par page et les fiches de page ;
- n’est **pas** soumis à la contre-vérification automatique : la liste de travail de conformités de
  `verify --report` ne met à l’épreuve que les conformités de l’agent (un auditeur nommé est le second
  lecteur), et un réfutateur qui retire quand même un verdict humain voit ce verdict maintenu par
  `--prune`, qui le signale.

## Risque résiduel

Après l’arbitrage, seuls les critères que l’agent a marqués `manual` (`needs-rendered-dom` /
`undecidable`) restent dans la section « à évaluer manuellement » du rapport — ne les marquez jamais
conformes sans une justification enregistrée et contrôlée par un garde-fou (arbitrage par l’agent via
`verify --manual`, ou preuves `scan` pour les critères de rendu).

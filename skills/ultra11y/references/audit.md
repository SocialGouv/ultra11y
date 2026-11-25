# Audit rapide → rapport WCAG (et l’échantillon de pages)

**Ceci est le parcours rapide** : un audit statique, un rapport daté et le contrôle d’intégrité
`check` — une première cartographie d’une base de code. Il n’a ni registre des verdicts, ni
contre-vérification adverse, ni dossiers par page, ni garde-fou de complétude
`check --require-decided`. Quand l’utilisateur demande un audit complet ou détaillé, un rapport
de conformité ou un audit RGAA, suivez plutôt **`references/full-audit.md`** — sur tous les
harness. Cette page reste la référence pour l’échantillon de pages normatif et les contrôles
des documents PDF, sur lesquels l’audit complet s’appuie.

Objectif : un rapport WCAG 2.2 AA daté, issu de la passe statique. Le moteur tranche le
sous-ensemble automatisable ; l’**agent IA** arbitre les critères qui demandent un jugement
(`verify --manual`, sous garde-fou) et oriente les critères de rendu vers `scan` ; les
garde-fous arrêtent toute non-conformité hallucinée.

## La boucle

1. **Délimitez le périmètre.** Quels fichiers / composants ? Le HTML, le JSX/TSX et les
   composants Vue/Svelte/Astro (`.vue`/`.svelte`/`.astro`) sont parcourus par défaut ; ajoutez
   les gabarits serveur (Twig, ERB, Handlebars…) avec `--ext .twig,.erb`. **Le balisage de
   test/spec/story** (`*.test.*`, `*.spec.*`, `*.stories.*`, `__tests__/`) est exclu par
   défaut — il est mauvais à dessein et jamais livré ; passez `--no-default-excludes` (ou
   nommez le fichier) pour l’auditer quand même.
   **Les `.vue`/`.svelte`/`.astro` sont audités comme gabarits SOURCE** : slots, snippets et
   liaisons dynamiques sont invisibles, donc leurs constats sont marqués `preliminary` et
   l’exécution porte une réserve `scope.sourceTemplate` — auditez la sortie rendue pour
   confirmer (étape 3, et `references/rendered.md`).
2. **Lancez le moteur :**
   ```
   node scripts/ultra11y.mjs audit "src/**/*.html" --json > audit.json
   ```
   ou sur un extrait : `node scripts/ultra11y.mjs audit - < page.html --json`.
   L’`AuditResult` classe chaque critère de succès en `C` / `NC` / `NA` (statique) ou
   `manual` (rendu / jugement, listés dans `residualRisks`). Il enregistre aussi la ou les
   langues déclarées du dépôt dans `scope.langs` (les sous-étiquettes `<html lang>` principales
   rencontrées, les plus fréquentes d’abord, par exemple `["fr"]`) — le signal du dépôt à
   partir duquel `--lang auto` se résout en aval.
3. **Triez les résultats :**
   - `NC` du moteur = candidats confirmés (chaque constat cite `file:line`) ;
   - critères `manual` *needs-rendering* (contraste 1.4.3, focus visible 2.4.7, redistribution
     1.4.10…) → à orienter vers `scan`, **jamais** passés en `C` en silence. Remarque : le
     contraste sur les **couleurs littérales en ligne** est désormais tranché statiquement
     (1.4.3 passe en `NC` pour ce sous-ensemble) ; le contraste via une CSS externe ou des
     variables reste résiduel (→ niveau dynamique) ;
   - critères `manual` *judgment* (pertinence de l’alternative sous 1.1.1, fonction du lien
     2.4.4, ordre de lecture / de tabulation…) → l’agent IA les arbitre à partir du contexte
     via `verify --manual` (sous garde-fou).
4. **Tranchez chaque critère applicable** : `C`, `NC` ou `NA` (avec une justification). Pour
   le détail et les fondements d’un critère : `node scripts/ultra11y.mjs criteria 1.1.1`.
5. **Produisez le rapport :**
   ```
   node scripts/ultra11y.mjs report --in audit.json --out audits
   ```
   → `audits/rgaa-YYYY-MM-DD.md`, le rapport pour tous les lecteurs (niveau, quoi corriger,
   sur quelles pages et URL, puis 5 sections), et à côté `audits/annexe-technique-rgaa-YYYY-MM-DD.md`,
   l’annexe technique (méthode, occurrences `file:line`, commandes, grille exhaustive) — voir
   `references/methodology.md`. La section A de l’annexe produit un **bloc auditeur** compact
   par critère NC, regroupés par sévérité — construits à partir des MÊMES unités que celles
   qu’émettent `prd` et `tickets` (voir `references/prd.md`), de sorte que le rapport et le
   backlog ne divergent jamais. Gardez les deux fichiers ensemble : `check`/`verify --report`
   lisent l’annexe vers laquelle pointe le rapport. Pour un référentiel national, ajoutez
   `--standard rgaa` (voir `references/standards.md`). Passez `--lang` pour correspondre à
   votre conversation ; sans lui, `auto` résout `scope.langs` de l’audit → la locale par défaut
   du référentiel → l’anglais. Ajoutez `--json` à `report` pour obtenir un résumé machine
   (`{path, conformancePct, date, standard}`) au lieu du seul chemin.
6. **Vérifiez l’intégrité :**
   ```
   node scripts/ultra11y.mjs check --report audits/rgaa-YYYY-MM-DD.md
   ```
   Échoue si une section manque, si un critère cité n’existe pas, ou si un `NA` n’est pas
   justifié.
7. **Haute assurance (facultatif)** : `references/verify.md` — prouvez que chaque
   non-conformité est réelle avant de livrer.

## L’échantillon de pages normatif (échantillon) — audits selon un référentiel national

Un audit d’arborescence de fichiers répond à « ce balisage est-il conforme ? » ; un audit selon
un **référentiel national** (RGAA, Section 508…) est défini normativement sur un **échantillon
de pages représentatif**, pas sur l’ensemble du dépôt. Déclarez cet échantillon une fois dans
`.ultra11yrc.json` :

```json
{ "standard": "rgaa",
  "sample": {
    "pages": [
      { "id": "accueil", "name": "Page d'accueil", "url": "http://localhost:3000/" },
      { "id": "contact", "name": "Contact", "url": "http://localhost:3000/contact" },
      { "id": "compte", "name": "Mon compte", "url": "http://localhost:3000/compte", "auth": true, "storageState": ".auth/user.json", "notes": "connecté" }
    ],
    "transverse": ["header", "navigation principale", "pied de page"]
  } }
```

- `sample.pages[]` sont les URL auditées (chacune peut se trouver derrière `auth` avec un
  `storageState` par page) ; `transverse` nomme les éléments audités sur **chaque** page
  (en-tête, navigation, pied de page, modales…). Le **chemin** `storageState` est utilisé, mais
  son contenu n’est jamais lu dans aucune sortie.
- **Faites-le proposer, ne le choisissez pas à la main** : `pages discover --sitemap <url> | --crawl <url> |
  --from-snapshots --propose --write` écrit un échantillon déterministe — le même site donne les
  mêmes pages quel que soit le modèle qui l’exécute. Chaque choix porte sa raison dans `notes` ;
  un type requis sans page va dans `"absent": [{ "kind": "recherche", "reason": "…" }]`. Gardez
  la proposition ; une modification à la main consigne sa raison (les `notes` d’une page, ou une
  entrée `absent` pour un type retiré).
- **Contrôlez la couverture** : `node scripts/ultra11y.mjs sample check` signale quels **types
  de pages requis** le `sampleMethodology` du référentiel actif attend mais qui manquent à
  l’échantillon (RGAA : accueil, contact, mentions légales, déclaration d'accessibilité, plan du
  site, aide, authentification, recherche, documents téléchargeables, pages représentatives…).
  Un type listé dans `sample.absent` est signalé avec sa raison à la place ; un type retiré sans
  raison est manquant. Consultatif (code de sortie 0) sauf si le bloc `sample` est mal formé
  (code de sortie 2).
- **Scannez l’échantillon** : `scan --sample --merge audits/audit-latest.json` parcourt chaque
  page, conserve le nom de page et l’indicateur d’authentification de chaque constat comme
  provenance, et fusionne les verdicts rendus (voir `references/dynamic.md`).
- **Honnêteté de l’audit partiel** : un rapport `--standard rgaa` produit **sans** scan
  d’échantillon fusionné est marqué **partiel** — un avertissement de la CLI + une bannière dans
  le rapport nommant les critères needs-rendering qui n’ont pas été testés. Dites que l’audit est
  partiel plutôt que de laisser entendre une couverture complète.

## Documents PDF téléchargeables

`audit report.pdf` ou `audit "public/**/*.pdf"` lit les fichiers PDF avec le lecteur propre du
moteur (modules natifs de Node uniquement — `zlib` pour les flux d’objets et de xref ; xref
classiques et en flux, mises à jour incrémentales, un balayage de réparation quand les offsets
mentent). Une entrée de type répertoire n’embarque jamais les PDF qu’il contient : un PDF est
audité quand il est nommé, quand il correspond à un glob se terminant par `.pdf`, ou quand il est
téléchargé par `scan` ou par la fixture Playwright dans `.ultra11y/documents/` (réingéré
automatiquement ; `--no-pdf` désactive — voir `references/dynamic.md` pour savoir quels liens
comptent et comment une session les atteint).
Cinq contrôles de document
s’exécutent sur chaque fichier :

| Règle | Ce qu’elle observe | WCAG |
|---|---|---|
| `pdf-untagged` | pas de `/MarkInfo << /Marked true >>`, ou pas de `/StructTreeRoot` (PDF/UA-1 §7.1) | 1.3.1 |
| `pdf-lang-missing` | pas de `/Lang` sur le catalogue (PDF/UA-1 §7.2) | 3.1.1 |
| `pdf-title-missing` | pas de `/Title` (Info ou XMP `dc:title`), ou `/DisplayDocTitle` qui n’est pas à true (PDF18) | 2.4.2 |
| `pdf-no-text` | aucune ressource de police et aucun opérateur d’affichage de texte sur aucune page — un scan composé uniquement d’images | 1.1.1 |
| `pdf-structure-shallow` | consultatif : balisé, mais sans titre de section, ou un tableau sans `TH` | 1.3.1 |

Le JSON d’audit (un document `pack-audit`) liste chaque document sous **`core.documents`** —
l’audit WCAG que porte `core`, pas la racine — avec le résultat de chaque contrôle —
`fail`, `not-detected` ou `not-checked` — et le rapport les présente dans une section
« Documents téléchargeables », en Markdown comme en HTML (`report --html`), à partir d’un seul
modèle. **`not-detected` n’est pas une réussite** : ces contrôles prouvent l’absence des défauts
grossiers, jamais la conformité PDF/UA, qu’un validateur (veraPDF, PAC) établit. Un fichier
chiffré, mal formé, tronqué ou trop volumineux est signalé **illisible**, jamais comme conforme.
**Une entrée par contenu** : le même PDF nommé dans le glob (`public/documents/formulaire.pdf`) et
téléchargé par `scan` (`.ultra11y/documents/<sha256>.pdf`) est un seul document, repéré par son
`sha256` ; l’entrée cite le fichier du projet (`file`), garde l’autre chemin dans `copies`, l’URL
dans `url` et les pages qui pointent vers lui dans `pages`, et chaque défaut n’est compté qu’une
fois par page qui le lie.

Les constats sur documents vivent dans **`core.documentFindings`**, **en dehors** des critères
WCAG : le PDF n’est pas la page qui pointe vers lui, et une version alternative conforme peut
exister. Sous RGAA, ils sont orientés par identifiant de règle vers le **13.3** comme preuves candidates, et le
brief du 13.3 liste chaque document avec ses contrôles, citable à la ligne d’en-tête `%PDF-x.y`
du fichier — l’agent tranche, avec de quoi citer.

**Facultatif : veraPDF.** Quand `verapdf` est dans le `PATH` (ou `ULTRA11Y_VERAPDF=<path>`), le
brief d’un critère qui liste des PDF porte aussi le résultat PDF/UA-1 de veraPDF pour chaque
document, dans un bloc intitulé **external validator** : la parole d’un autre outil, pas une
preuve, non citable, ne tranchant rien — PDF/UA-1 n’est pas le RGAA 13.3 (une version
alternative accessible le satisfait quel que soit le PDF). Une exécution qui échoue est affichée
« not validated », jamais comme conforme. Rien n’est installé ni requis ; `ULTRA11Y_VERAPDF=off`
le désactive.

## Règles d’or

- **N’inventez jamais une non-conformité** : chaque `NC` doit citer un élément réel et résoluble
  (`check` le vérifie).
- **Le résiduel est explicite, jamais un `C` silencieux** : un critère *needs-rendering* non
  prouvé va vers `scan` ; un critère *judgment*, l’agent IA l’arbitre via `verify --manual`
  (sous garde-fou). Tout critère encore non tranché reste dans la section « à évaluer
  manuellement », avec une raison consignée.
- Le **taux de réussite des contrôles statiques automatiques** du rapport ne couvre que le
  sous-ensemble décidable par la machine ; la conformité WCAG complète exige votre revue manuelle
  (ce n’est pas un taux de conformité).

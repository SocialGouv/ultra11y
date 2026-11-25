# Backlog auditeur (`prd`)

`prd` transforme un `AuditResult` en un **backlog de conformité lisible par un auditeur**,
groupé par critère de succès WCAG (ou, avec `--standard <pack>`, par les critères d’un
référentiel national). C’est le pendant « action » de `report` (qui est le document de
conformité) — et ils ne sont pas seulement similaires, ils rendent littéralement le **même
bloc auditeur** (`src/auditor.ts` `renderAuditorUnit`, alimenté par les mêmes `prdUnits`) : la
section « Non-conformités (par priorité) » de `report` (§2) EST un de ces blocs par critère
NC, groupés par sévérité exactement comme le backlog `prd` et les corps de ticket que
`tickets` dépose (`references/tickets.md`). Modifiez le bloc une fois, les quatre livrables
changent ensemble — il n’existe pas de « formulation du rapport » séparée à garder
synchronisée.

`prd` écrit du MARKDOWN et ne dépose rien. Déposer des tickets, c’est `tickets`.

```
node scripts/ultra11y.mjs audit "src/**/*.tsx" --graph --json > audit.json
node scripts/ultra11y.mjs prd --in audit.json                      # auditor backlog (default)
node scripts/ultra11y.mjs prd --in audit.json --split criterion    # one file per criterion
node scripts/ultra11y.mjs prd --in audit.json --standard rgaa --lang fr   # rendered with the RGAA (fr) vocabulary
node scripts/ultra11y.mjs prd --in audit.json --format doc         # product-requirements doc (epics/stories/AC)
```

## Sortie

- **Par défaut (`--format audit`) — le bloc de conformité auditeur** : un document
  `audits/prd-YYYY-MM-DD.md`, découpé par priorité (🔴 bloquant → 🟠 majeur → 🟡 mineur).
  Chaque critère devient un **ticket** complet rendu **avec le vocabulaire du référentiel
  actif** (voir `references/standards.md` → *Auditor vocabulary*) :
  1. **Bloc auditeur** — **thématique** (RGAA *Thématique* / socle WCAG *Principle ·
     Guideline*), **critère** + son intitulé officiel, **test(s)** (numéros de test RGAA
     `11.6.1` / techniques WCAG), correspondance **WCAG** + niveau, **Priorité**, le
     **constat** (non-conformité, étiquetée avec le verdict *non conforme* du référentiel),
     l’état conforme **attendu**, une méthode de **vérification**, et la **liste de contrôle**
     des occurrences (`file:line`) avec le **site de définition** inter-fichiers (`related`)
     lorsqu’il est présent.
  2. **Partie technique / Technical details** — **fichiers impactés** (chemins source),
     **pages / URL impactées** (emplacements servis, chacun avec le **nom de page + indicateur
     d’authentification** de l’échantillon quand la provenance `scan --sample` est présente),
     la **modification attendue** + un **exemple de guidance** avant/après
     (`references/guidance.md`), les **Critères d'acceptation / Acceptance criteria** sous
     forme de liste de cases à cocher Given/When/Then, et la **Complexité / Complexity** (une
     taille de t-shirt déterministe + des story points).
  3. **Contexte de reproduction / Reproduction context** — émis uniquement quand ≥1
     occurrence cite une URL servie que l’ancrage statique n’a pas pu résoudre, ou une page
     d’échantillon derrière une authentification : l’URL, si l’authentification est requise,
     et l’état requis / les étapes de reproduction. C’est ce qui permet à un développeur de
     reproduire un constat de scan/`--sample`.

  Les sections 2–3 se désactivent avec **`--no-technical`** (une consommation purement
  auditeur supprime l’échafaudage de ticket et ne garde que le bloc auditeur). Tout est
  localisé par `--lang
  fr|en`. Les **issues GitHub** ci-dessous utilisent ce même bloc par défaut.
- **Les constats consultatifs sont rendus comme des recommandations, jamais comme des NC.**
  Une recommandation non normative (une règle consultative d’un pack, ou un verdict
  `recommendations[]` de l’agent) est rendue sous « Recommandations (non normatives) » /
  "Recommendations (non-normative)" avec un marqueur 💡 et l’étiquette « Recommandation (non
  normative) » — une liste distincte et non analysable, pour que `verify` ne la capture jamais
  comme une affirmation de NC. Un constat consultatif qui accompagne un critère par ailleurs
  NC est extrait sous « Recommandations associées ». Il n’entre jamais dans la liste de
  contrôle des occurrences, ne fait jamais basculer un critère en NC, et ne compte jamais dans
  `conformancePct`.
- **`--format doc` (document d’exigences produit)** : `audits/prd-doc-YYYY-MM-DD.md` — des
  epics groupés par thématique, une **user story** par critère, des critères d’acceptation
  **Given/When/Then** générés à partir du vrai titre et des vraies techniques du critère de
  succès (ancrés au texte du W3C), et la liste des tâches.
- **`--split criterion`** : un fichier `prd-<criterion>-YYYY-MM-DD.md` par critère (pratique
  pour traiter par lots).
- **`--json`** : émet un objet lisible par une machine au lieu des chemins de fichiers —
  `{paths, units}` où `units` est le backlog structuré par critère qu’un agent peut consommer.

## Langue de la prose (livrables en français)

Quand vous rédigez ou complétez de la prose de PRD ou d’issue en français (contexte
supplémentaire, critères d’acceptation, commentaires d’issue), gardez les jetons techniques
en anglais exactement comme le fait le catalogue fr du moteur : les noms d’attributs,
d’éléments et de rôles et leurs valeurs sont du code, pas de la prose — `aria-live` reste
`aria-live` (jamais « région live »), de même pour `tabindex`, `alt`, `role="alert"`. Le
vocabulaire normatif du référentiel (ex. RGAA « lien d'évitement ») garde son intitulé
officiel en français.

## Déposer ces blocs en tickets

Voir **`references/tickets.md`** : `tickets` dépose les mêmes blocs auditeur dans GitHub,
GitLab ou Jira, à la granularité de votre choix (par critère, par page, par fichier, ou un
seul consolidé).

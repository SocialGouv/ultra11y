# L’exécution fiable

Une recette, et les raisons pour lesquelles c’est celle-là. Tout ici est mesuré sur la
fixture propre à ce dépôt ; les chiffres sont donnés pour qu’on puisse les discuter.

## La recette

`node scripts/ultra11y.mjs` est le moteur livré avec la skill (voir « Lancer le moteur » dans
`SKILL.md`) ; hors skill, `npx -y ultra11y` est le même moteur.

```sh
# 1. The engine decides everything it can, for free.
node scripts/ultra11y.mjs audit <src> --standard rgaa --out audits

# 2. The browser closes the mechanical ones, also for free. DO NOT SKIP THIS.
node scripts/ultra11y.mjs scan --crawl <url> --max 0 --standard rgaa \
  --merge audits/audit-latest.json --out audits

# 3. Replay the committed ledger, then adjudicate only the residue — yourself, or fanned out.
#    On a first run there is no ledger yet: the replay says so and exits 0.
node scripts/ultra11y.mjs verify --apply .ultra11y/verdicts/rgaa.json \
  --in audits/audit-latest.json --standard rgaa --out audits
node scripts/ultra11y.mjs verify --in audits/audit-latest.json --standard rgaa --manual --out audits
node scripts/ultra11y.mjs orchestrate --run audits --phase adjudicate      # batches + prompts for subagents (optional)
#   … rule every item of audits/ADJUDICATE.todo.json (or merge the subagents' fragments) …
node scripts/ultra11y.mjs verify --apply audits/ADJUDICATE.todo.json --in audits/audit-latest.json \
  --standard rgaa --out audits --ledger
# Either fold exits 1 when the gate refused anything (« Repli incomplet ») — the partial audit is
# still written and the refused criteria stay to assess: re-run --manual, rule them, fold again.

# The worklist is authoritative. A run-wide NC may be present because other page cells remain
# open: every emitted item gets one grounded verdict, or an explicit manual reason.

# 4. A second reader puts those claims on trial, and the outcome is APPLIED.
node scripts/ultra11y.mjs report --in audits/audit-latest.json --standard rgaa --out audits
node scripts/ultra11y.mjs verify --report audits/<report>.md --in audits/audit-latest.json --out audits --max-verify 0
node scripts/ultra11y.mjs orchestrate --run audits --phase verify-report   # one read-only reader per batch (optional)
#   … give every claim of audits/VERIFY.todo.json a verdict …
node scripts/ultra11y.mjs verify --apply audits/VERIFY.todo.json --report audits/<report>.md \
  --in audits/audit-latest.json --out audits --prune --ledger

# 5. The gates. Neither is optional; one asks completeness, the other asks the instrument.
node scripts/ultra11y.mjs check --in audits/audit-latest.json --standard rgaa \
  --require-decided=pages --allow-undecided .ultra11y/undecidable-rgaa.json
node scripts/ultra11y.mjs check --in audits/audit-latest.json --standard rgaa --require-rendered
```

L’étape 5 affiche la ligne qui répond directement à « les 106 ont-ils tous été traités ? » :

```
✓ Complete grid: all 106 criteria carry a verdict.
  106 criteria — 55 engine, 12 measured (scan), 37 agent, 2 declared undecidable, 0 with no verdict.
```

## Qui arbitre

Il n’y a qu’un seul juge — `applyAdjudication` — et chaque verdict passe par lui, quel que
soit son auteur. Le moteur ne fait tourner aucun modèle à lui : dans un agent de code, la
session statue sur la liste de travail (`verify --manual`), directement ou en la répartissant
entre des sous-agents avec `orchestrate` (`references/orchestration.md`) ; en CI, le bot
`rgaa-audit` d’iterion remet la même liste de travail à ses agents en lecture seule
(`references/ci.md`).

| | pourquoi |
|---|---|
| `orchestrate --run <dir>` | Des lots de 8 critères amortissent le contexte normatif ; chaque prompt est autonome, et seul le résidu que l’intégration a refusé ou laissé sans réponse repart au passage suivant. `--eco` est le chemin séquentiel économe en tokens. |
| `--ledger` | Un verdict payé une fois devient une affirmation revérifiée à chaque exécution ultérieure (`verify --apply <ledger>`). |

Une exécution avec `--standard rgaa` construit et arbitre uniquement la grille des critères
RGAA ; elle ne lance pas une seconde passe de jugement WCAG.

## Pourquoi l’étape 2 n’est pas facultative

`criterionMeasuredOn` exige une couverture de pages. Sans capture, **aucun critère mécanique
ne peut être clos par la mesure** — ils restent « à évaluer » et vont gonfler la facture du
modèle au lieu d’être décidés gratuitement par le moteur. Sur la fixture de ce dépôt, la
liste de travail compte 81 critères sans scan. Chaque critère que le scan clôt est un critère
dont vous ne payez pas les ~2 000 tokens d’entrée pour le faire lire.

## Pourquoi l’étape 4 n’est pas facultative non plus

Un arbitre bon marché ne rate pas des choses — il **accuse à tort, en excès**. Mesuré sur une
passe RGAA complète avec un petit modèle (Haiku), face à un registre de référence arbitré par
un modèle plus puissant à travers le même garde-fou :

| | |
|---|---:|
| critères tranchés par les deux | 48 |
| sur lesquels ils étaient d’accord | 24 |
| sur lesquels ils divergeaient | 24 |
| …dont ceux où Haiku disait NC quand le registre disait C ou NA | 19 |

74 non-conformités contre 57. Le garde-fou ne peut pas l’attraper, et c’est structurel :
`normativeRefResolves` prouve que le test cité appartient au critère arbitré — et `11.2.1`
est bien un test du `11.2`. Il ne demande jamais si la lecture était juste, donc un arbitre
qui classe « ce champ n’a pas d’étiquette » (ce qui relève du 11.1) sous le 11.2 passe sans
encombre.

Le `48` ci-dessus est l’intersection des sorties de deux expériences mesurées, **pas** un
nombre fixe de critères RGAA confiés à l’agent. À chaque exécution réelle, lisez le décompte
final par provenance. Par exemple, `26 engine + 32 scan + 46 agent + 2 named undecidable = 106`
est complet ; appeler cela « 48 critères agent » masquerait à la fois les 46 verdicts
réellement rendus par le modèle et les deux exceptions explicites.

Trois choses se dressent désormais entre cela et un livrable, et seule la troisième est un
modèle :

1. **Le brief nomme le voisin.** Un critère indique lequel de ses voisins de thématique
   possède la question adjacente, déduit des données propres du pack — pour le 11.2, c’est le
   11.1, avec son intitulé simple à côté.
2. **L’intégration refuse la double imputation.** Une NC sur un critère qui n’a pas de règle
   moteur propre, sur l’ancre exacte où le moteur a déjà fait échouer un voisin mécanique, est
   refusée et le critère repasse à « à évaluer » en nommant ce voisin.
3. **Le procès.** Un lecteur, un élément, une question — *la preuve citée établit-elle ce qui
   a été affirmé ?* — avec la consigne de réfuter en cas de doute.

## Ce que ça coûte

Mesuré sur un audit complet réel — la fixture `tests/fixtures/full-audit-app` parcourue de bout
en bout par `tests/full-audit.e2e.test.ts` (scan de l’échantillon, toutes les routes et deux
parcours : 21 pages et états de page, 102 critères RGAA confiés au jugement). Le test écrit la
mesure à côté de la liste de travail, dans `audits/brief-budget.json` : la somme des caractères
des briefs `audits/adjudicate/*.md` et du contrat `audits/ADJUDICATE.contract.md`, divisée par
quatre pour l’ordre de grandeur en tokens.

| lecture de toute la liste de travail, brief par brief | caractères | tokens en entrée (≈ caractères / 4) |
|---|---:|---:|
| avant #222 | 1 607 526 | ≈402 000 |
| aujourd’hui (102 briefs + le contrat, lu une fois) | 1 114 838 + 7 275 | ≈280 500 |

Le chiffre de ≈117 000 tokens que cette page annonçait valait pour une liste de travail
SANS capture (81 critères, des preuves de source seulement) ; il ne décrivait pas un audit
complet, dont chaque critère porte les preuves de toutes les pages capturées. Les ≈30 % gagnés
viennent de trois corrections (#222) :

- **le contrat de verdict est écrit une fois**, dans `ADJUDICATE.contract.md`, au lieu d’être
  répété dans chaque brief (≈6,5 Ko × 102) : les verdicts et leurs champs, les règles de
  citation et d’absence, la gravité, l’inventaire des captures, l’avertissement du référentiel
  et les ids de toutes les pages. Chaque brief garde une ligne qui y renvoie, et ce qui lui est
  propre : ses preuves sont-elles ancrées dans une capture, lui manque-t-il un rendu ;
- **une preuve par classe de contenu, quelle que soit la page** : la page ne fait plus partie de
  la classe des blocs répétés, et un même signal candidat sur chaque page n’est plus qu’une
  classe. Sur cette fixture, 12.2 passe de 66 classes à 4, 12.4/12.5 de 70 à 8, 7.1 de 60 à 22.
  Chaque page d’une classe reste listée (`sur <id>:<ligne>`), pour qu’un verdict de page cite
  sa propre capture ;
- **les sujets hors critère sont retirés** : 1.3 ne reçoit plus que les images (15 → 2 classes),
  9.1 plus que les titres, sans les `<label>` (23 → 18).

Ce qui reste est surtout le texte normatif de chaque critère — tests, méthodologie officielle,
glossaire en entier (#182) — que rien ne coupe : c’est ce qu’on lit pour trancher. Une
orchestration en lots (`orchestrate --run`) partage ce contexte entre huit critères ; la
lecture brief par brief ci-dessus est le pire cas. `tests/adjudicate-context-budget.test.ts`
verrouille le brief par critère et `tests/full-audit.e2e.test.ts` la facture de l’audit complet
— c’est la facture, pas un micro-benchmark.

La passe de contre-vérification regroupe par défaut jusqu’à huit affirmations indépendantes
par appel au modèle, écrit chaque réponse numérotée séparément, et enregistre un point de
reprise après chaque lot. Régénérer une liste de travail dans le même répertoire ne conserve
que les affirmations terminées identiques à l’octet près ; les affirmations modifiées et
nouvelles repassent à `null`, si bien qu’une boucle de réparation ne paie que ce qui a
changé. Une conformité affirmée est un seul élément avec l’ensemble complet de ses citations,
pas un appel payé par ancre ; c’est indispensable pour les critères multi-pages dont la
preuve est l’ensemble. La liste de travail est plafonnée à 40 par défaut et le contrôle de
couverture est reconstruit SANS PLAFOND, si bien qu’une liste de travail bornée fait échouer
le garde-fou en `missing` au lieu de passer sur la moitié qu’elle a tentée — c’est pourquoi
l’étape 4 passe `--max-verify 0`. Abaissez-le délibérément si vous y êtes obligé, et dites
alors ce qui a été laissé de côté : un plafond silencieux se lit exactement comme une
couverture complète.

## Quand ça tourne mal

- **La passe n’a rien décidé.** Lisez les refus qu’elle a affichés. Un critère que le
  garde-fou a refusé porte sa raison dans sa propre justification ; c’est presque toujours un
  brief qui n’a jamais énoncé la règle, ou une collecte sans ancre sur le sujet du critère —
  pas un modèle qui a abandonné.
- **Le registre se rejoue comme périmé.** Son empreinte couvre les preuves que la collecte a
  LUES SUR LE DISQUE. `scan --merge` reporte désormais les entrées des instantanés de page
  dans cette collecte, et les chemins des instantanés ne dépendent pas du checkout. Une
  classe de contenu réellement modifiée fait toujours expirer son critère ; ne réarbitrez que
  le résidu nommé.
- **Le procès refuse un verdict du moteur.** Il est laissé intact et compté, exprès : un
  critère que le moteur décide est recalculé depuis la source à chaque exécution, et une
  règle qui produit un faux positif se corrige dans la règle.

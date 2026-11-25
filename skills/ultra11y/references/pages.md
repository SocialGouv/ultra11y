# Instantanés de page — auditer une vraie page, hors ligne

Une **capture** (`render`) est un *composant* rendu. Un **instantané** est une *page* rendue :
le document entier tel que le navigateur l’a construit, plus les signaux que seul un navigateur
possède (styles calculés, boîtes, arbre d’accessibilité, une capture d’écran), stockés sur disque
pour que le moteur statique puisse le ré-auditer plus tard **sans navigateur**.

Cette différence n’est pas cosmétique. C’est ce qui rend toute une classe de critères décidable.

```
.ultra11y/pages/<page-id>/
  meta.json     page identity: id, name, url, route?, auth?, viewport?, sources?
  dom.html      documentElement.outerHTML, prefixed with the usual capture comment
  styles.json   computed-style digest, joined to the DOM by document-order index
  boxes.json    bounding boxes, same join key
  css.json      the page's own stylesheets (rules + declarations), NOT element-indexed
  axtree.json   the accessibility tree Chromium computed (`scan`, `journey run`); no rule reads it
  sr.json       what a screen reader would announce, in reading order, derived from axtree.json:
                role, accessible name, value, description, states — a simulation from the tree,
                never a real reader; evidence for RGAA 7.1, 7.3, 7.5 and the form criteria
  media.json    the media of the page (video, audio, players, animated content) with their
                tracks as the browser loaded them and the captions, transcripts or descriptions
                found beside them; and, on a scanned page, the flash measure of a 1.5 s viewport
                recording (RGAA 13.7: `none`, `below-threshold`, `over-threshold`, or
                `undersampled` — which measured nothing)
  probes.json   what the LIVE probes measured here — and `probed`, which ones actually ran
  axe.json      the axe pass that ran beside them (`ran: true` is what makes its silence usable)
  scripts.json  what the page's SCRIPTS did during a short capture window: listeners (flagged
                when nothing makes the element keyboard-reachable), inline handlers, ARIA
                mutations, live regions, timers, moving content, scripts and stylesheets loaded
  screen.png    viewport screenshot (pixel tier)
```

Les deux derniers sont la moitié « mesure », et ce sont eux qui permettent à une page de
CONCLURE plutôt que de simplement signaler. `renderedProvesOn` lit `pageCoverage.scs` / `.axe`,
tous deux dérivés d’eux, si bien qu’une page sans `probes.json` peut lever une non-conformité de
rendu mais ne peut jamais obtenir une conformité de rendu — 1.4.4, 1.4.10 et 1.4.12 n’ont aucune
règle hors ligne, et le juge canonique de 1.4.3 est axe. `probed` n’est écrit que pour une sonde
qui a réellement tourné : une sonde qui a levé une exception, un viewport qui n’a pas voulu se
redimensionner, une surcharge qui n’a pas voulu s’appliquer — aucune d’elles n’y figure, parce
que leur silence n’est pas une mesure.

`scripts.json` est la moitié « comportement » (#190). Les critères de script — RGAA 7.1, 7.3,
7.5, 13.1, 13.8 ; WCAG 2.1.1, 2.2.1, 2.2.2, 4.1.2, 4.1.3 — se jugent sur ce que la page FAIT, ce
que le balisage ne montre pas : un `<div>` avec un écouteur de clic a un balisage identique à un
`<div>`. Une fois le DOM sérialisé, le producteur laisse la page tranquille pendant ~2 s (tout ce
qui change alors a changé de lui-même : un carrousel, un bandeau défilant), puis lance ses sondes
(un `aria-expanded` qu’un bouton bascule apparaît à ce moment-là). Les écouteurs sont lus via CDP
(`DOMDebugger.getEventListeners`) quand le producteur dispose d’une session — `scan` et
`ultra11y/playwright` sous Chromium — et à partir du DOM seul sinon (`ultra11y/cypress` :
gestionnaires `on*` en ligne et propriétés `on*`). Le fichier indique lequel dans `collected`
(`cdp` | `dom` | `none`), chaque liste est plafonnée (`caps`, `truncated`), et les éléments sont
indexés avec le même ordinal d’ordre du document que `styles.json`. Les briefs d’arbitrage de ces
critères le citent comme preuve, élément par élément, après une ligne de couverture qui dit
comment il a été collecté — ainsi une page dont le comportement n’a pas pu être lu n’est jamais
confondue avec une page où il n’y a rien à trouver. `ultra11y/playwright` et `ultra11y/cypress`
acceptent `behaviour: false` pour le sauter, ou `{ windowMs }` pour changer la fenêtre.

`audit` ingère `.ultra11y/pages` automatiquement, exactement comme il ingère
`.ultra11y/captures` (`--no-captures` désactive les deux). Rien de nouveau à lancer :

```
node scripts/ultra11y.mjs audit "src/**/*.tsx" --jsx     # snapshots folded in automatically
```

## Pourquoi un instantané décide plus qu’une capture

Une capture de composant est un **fragment** : pas de `<html>`, pas de `<head>`. Les règles
`scope: "page"` du moteur sont délibérément sautées sur les fragments (`isFullDocument`), parce
qu’un `<button>` n’a pas à déclarer une langue de page. Un instantané **est** un document complet,
donc ces règles tournent :

| Règle | WCAG | RGAA |
|---|---|---|
| `html-lang-missing` | 3.1.1 | **8.3** |
| `title-missing-empty` | 2.4.2 | **8.5 / 8.6** |
| `missing-main-landmark` | 1.3.1 | 12.6 |

Aucune d’elles ne peut être jugée à partir du rendu d’un composant, et plusieurs ne peuvent pas
non plus l’être à partir de la source dès qu’un framework injecte la coquille du document. C’est
dans l’instantané qu’elles deviennent réelles.

> Ne « corrigez » **pas** cela en enveloppant les captures de composants dans un document
> complet. Un composant rendu seul n’a ni `<html lang>` ni `<title>`, donc chaque capture de
> composant signalerait deux non-conformités bloquantes qui ne décrivent rien qu’un utilisateur
> puisse vivre. Les captures de composants restent des fragments, à dessein.

## Identité de la page

`dom.html` porte le commentaire de provenance ordinaire, avec deux champs supplémentaires :

```html
<!-- ultra11y:capture v="1" source="app/page.tsx" page="accueil" url="https://example.com/" -->
```

Chaque constat levé dessus est estampillé avec `page` (l’id stable) **et** `origin.sourceFile`
(la source qui l’a rendu). C’est sur cette paire que se fait la jointure de la grille des
critères par page, et c’est ce qui permet à un constat trouvé *au moment du rendu* d’être
rapporté *contre le code qui l’a causé*.

Les ids sont dérivés du chemin de l’URL (accents retirés, en minuscules) : `/nous-contacter` →
`nous-contacter`, `/` → `accueil`. Un producteur peut passer un id explicite à la place. Un id
doit correspondre à `[a-z0-9][a-z0-9-]*` — il devient un nom de répertoire, on ne peut donc pas
le laisser remonter l’arborescence.

## La clé de jointure, et pourquoi elle est vérifiée

`styles.json`, `boxes.json`, `axtree.json`, `sr.json` et `media.json` indexent les éléments par
**ordinal d’ordre du document** (document-order), pas par sélecteur CSS — un sélecteur devrait
survivre à la sérialisation et à la ré-analyse, un ordinal non. Chaque entrée répète son `tag`, et
la jointure (`alignedStyles`) vérifie chacune d’elles contre le DOM ré-analysé.

**À la moindre discordance, le condensé entier est refusé**, pas seulement l’entrée fautive. Un
index décalé en silence attribuerait la couleur d’un élément à un autre et fabriquerait une
non-conformité à partir de rien — exactement le mode d’échec que cet outil existe pour empêcher.
Un condensé refusé laisse simplement les critères de rendu à `manual`, ce qui est l’issue
honnête.

Le collecteur est borné (`COLLECT_MAX_ELEMENTS`) ; quand il tronque, `truncated: true` est
enregistré pour que la fin se lise comme *non mesurée*, jamais comme *propre*.

## Le niveau rendu — des critères auxquels seul un navigateur peut répondre, décidés hors ligne

Un instantané porte ce que sait un navigateur et que la source ignore. Six règles le lisent, et
elles tournent dans l’`audit` ordinaire — **sans navigateur, sans serveur lancé**, à partir d’un
artefact commité. C’est tout l’intérêt : la CI les décide sans démarrer l’application.

| Règle | WCAG | RGAA | Lit |
|---|---|---|---|
| `rendered-contrast` | 1.4.3 | **3.2 / 10.5** | la `color` calculée face à l’arrière-plan de l’ancêtre opaque le plus proche |
| `rendered-contrast-pixel` | 1.4.3 | **3.2 / 10.5** | la capture d’écran, là où le CSSOM ne peut pas répondre |
| `rendered-link-colour-only` | 1.4.1 | **10.6** | les styles calculés d’un lien à l’intérieur d’un texte courant |
| `rendered-nontext-contrast` | 1.4.11 | **3.3** | le remplissage calculé d’un contrôle et ses quatre bordures |
| `rendered-focus-not-visible` | 2.4.7 | **10.7** | les règles `:focus` de la feuille de style |
| `rendered-orientation-lock` | 1.3.4 | **13.9** | les règles `@media (orientation:…)` |

**`rendered-contrast` l’emporte sur la règle des littéraux en ligne** à côté de laquelle elle
se trouve : `contrast-literal` ne peut juger que les couleurs écrites en ligne dans le balisage,
elle ne dit donc rien d’une vraie feuille de style. La valeur calculée est la valeur que voit
l’utilisateur, et les seuils du texte de grande taille n’exigent aucune devinette sur les unités
parce que le navigateur a déjà tout résolu en px.

**`rendered-contrast-pixel` existe pour un seul cas** : du texte sur un dégradé, une image de
fond ou un empilement translucide. Là, `background-color` vaut `rgba(0,0,0,0)` et aucune analyse
de style ne retrouvera le vrai arrière-plan — un angle mort documenté de toute vérification
fondée sur le CSSOM, axe-core compris. La capture d’écran est le seul endroit où la réponse
existe. Elle est délibérément étroite : elle ne tourne **que** là où `rendered-contrast` s’est
abstenue, si bien qu’un défaut n’est jamais compté deux fois, et elle ne signale que lorsque la
zone mesurée a une couleur dominante unique. Le contraste face à une photographie n’est pas un
nombre unique, et prétendre le contraire serait un constat fabriqué.

**`rendered-link-colour-only` rend RGAA 10.6 décidable tout court** — il n’avait aucune règle
auparavant. Un lien coloré avec `text-decoration: none` dans un paragraphe est invisible pour
l’analyse de source (la règle vit dans une feuille de style) et pour axe-core. Elle est limitée
aux liens *avec du texte* *à l’intérieur d’un bloc de texte*, là où le critère s’applique ; un
lien de navigation ou stylé en bouton est hors périmètre par construction, et un soulignement,
une bordure inférieure, un arrière-plan ou une graisse nettement plus forte suffisent tous à le
lever.

**`rendered-nontext-contrast` donne à RGAA 3.3 sa première règle.** Un contrôle est
distinguable quand son remplissage contraste avec son environnement, **ou** quand une bordure
dessinée contraste avec l’un ou l’autre de ses côtés — trois façons indépendantes de passer,
délibérément généreuses. Ce qui reste est l’échec sans ambiguïté : un champ sans bordure de la
même couleur que la page. Elle s’abstient purement et simplement quand un `box-shadow` ou un
`outline` visible pourrait dessiner la limite à la place.

**Deux critères sont des propriétés de la FEUILLE DE STYLE, pas du style calculé d’un
élément**, et `css.json` est le seul endroit où ils existent. `rendered-focus-not-visible`
attrape la réinitialisation classique `*:focus { outline: none }` — signalée **seulement**
quand aucune règle `:focus` nulle part dans le document ne rétablit d’indicateur, si bien qu’une
réinitialisation ciblée qu’une règle sœur remplace n’est jamais signalée.
`rendered-orientation-lock` attrape une media query qui fait pivoter tout le document d’un quart
de tour ; un élément décoratif tourné en paysage est légitime et n’est pas signalé.

Les deux **s’abstiennent quand `unreadable > 0`** — une feuille de style d’une autre origine que
le navigateur ne nous laisserait pas lire. Le silence y signifie *« je n’ai pas pu regarder »*,
pas *« il n’y a rien »*, et la différence est tout l’enjeu.

RGAA 10.7 était déjà atteignable via la sonde en direct de `scan` (`dyn-focus-visible`), qui
nécessite un navigateur et une application lancée. La voie du CSSOM le décide **hors ligne**.

### Ce qui rend ce niveau digne de confiance

Il peut dire « non conforme » parce qu’il peut aussi dire **« je ne sais pas »**. Chacun de ces
cas laisse le critère non décidé plutôt que de deviner :

- aucun ancêtre ne déclare d’arrière-plan opaque, ou l’arrière-plan est une image → pas de
  verdict CSSOM ;
- la zone de la capture d’écran est réellement variée → pas de verdict pixel ;
- une feuille de style était d’une autre origine et illisible → pas de verdict de feuille de
  style ;
- un `box-shadow` ou un `outline` pourrait être la limite → pas de verdict de limite ;
- l’élément se trouve au-delà du plafond du collecteur (`truncated: true`) → pas de signaux, pas
  de verdict ;
- le condensé de styles ne se vérifie pas contre le DOM → le condensé **entier** est refusé.

Et sans `doc.signals` — c’est le cas de tout fichier source ordinaire — les règles ne se
déclenchent pas du tout, si bien que l’ajout de ce niveau ne peut changer aucun verdict
préexistant.

### Quelle part du RGAA le moteur peut étayer

`tests/rgaa-coverage.test.ts` fixe un plancher de **50 sur 106** critères rattachés à une règle
du moteur, contre 43 avant ce niveau — les règles de rendu plus deux règles déclaratives du pack
(`optgroup` sans `label`, une valeur `dir` invalide). Une refonte qui détache silencieusement un
critère fait échouer la CI au lieu de rétrécir l’audit sans bruit. Les critères que rien ne peut
décider restent à zéro, *visiblement* : RGAA 8.1 ne correspond qu’au WCAG 4.1.1 supprimé, et 13.3
dépend de documents bureautiques téléchargeables.

## La grille par page

Le RGAA est une norme **par page** : un audit porte sur un échantillon déclaré et chaque critère
reçoit un statut *sur chaque page*. Le verdict du moteur vaut pour tout le périmètre. `pages`
fait le pont entre les deux.

```
node scripts/ultra11y.mjs pages --in audits/audit-latest.json --standard rgaa
node scripts/ultra11y.mjs pages --in audits/audit-latest.json --standard rgaa --json
node scripts/ultra11y.mjs pages --in audits/audit-latest.json --standard rgaa --json --out audits
#   → also writes audits/pages.json — the same projection, for a machine
```

`--json --out <dir>` écrit `<dir>/pages.json` à côté des fiches dont il est le miroir. La grille,
les dossiers et le HTML sont des documents pour une personne ; celui-ci est l’unique fichier
qu’un job ultérieur, un badge ou un tableau de bord peut lire sans rien re-dériver, et la sortie
standard seule ne peut pas les servir — en CI, l’appelant est une étape d’orchestrateur, et une
matrice critère × page ne tient pas dans une sortie d’étape. Sa forme est `{ pages: [{ id, name, url, basis, kind?, journey?, criteria: [{ id, status, decidedBy }],
conformancePct, decided, total }], unattributed, averageRate }`. `kind` est absent pour une page
de l’échantillon, `journey-state` pour un état enregistré par un parcours rejoué (`journey`
donne alors `{ name, step }`), `out-of-sample` pour une route capturée que l’échantillon déclaré
ne liste pas. Ces deux dernières gardent leur fiche et leurs constats, qui comptent pour leur
critère, mais elles ne sont pas comptées comme pages auditées et n’entrent pas dans le taux moyen.
Un état de parcours est sa page dans un autre état : quand la page de même adresse est dans
l’échantillon (`parent`), ses non-conformités sont reportées sur la fiche et le taux de cette page
(listée avec ses `states`), chaque constat gardant le nom de l’état où il a été vu.

`averageRate` (sous un pack uniquement) est le **« taux moyen de conformité »** du RGAA — le
second chiffre que la méthode demande pour un échantillon, à côté du taux global : `{ pct, pages: [{ id, name, url,
pct, validated, applicable, open }], excluded, open, outside: { states, routes } }`. La moyenne
porte sur les seules pages de l’échantillon ; `outside` compte les états de parcours et les
routes hors échantillon laissés de côté, et le rapport le dit. Chaque page est notée avec la formule de
la page appliquée à cette seule page — conformes ÷ (conformes + non conformes), si bien que
l’`applicable` d’une page est l’ensemble de ses critères décidés, les non applicables exclus,
comme la méthode RGAA les compte — `pct` est la moyenne de ces ratios exacts arrondie une seule
fois, une page sans aucun critère décidé est listée dans `excluded` et laissée hors de la moyenne
(jamais comptée à 100 %), et `open` compte les critères encore à évaluer sur ces pages : tant
qu’il est supérieur à zéro, chaque taux — et donc la moyenne — est provisoire. La grille imprime
la même ligne sous son tableau, suivie du taux de chaque page tel que sa fiche l’imprime ;
`report` l’imprime sous son taux principal, dans sa synthèse et comme dernière colonne de « Taux
par page ».

Jusqu’à #156, le taux de page était la formule globale appliquée à la page (validés ÷ validés +
NC + à évaluer). Sur les pages jugées depuis la source, un critère non conforme sur une autre
page y est « à évaluer », et les verdicts valables pour toute l’exécution atterrissent sur chaque
page, si bien qu’un critère ouvert pesait exactement comme une non-conformité et que chaque page
imprimait le taux global. Le taux global garde cette formule : c’est un plancher sur tout
l’échantillon, et ses critères ouverts font partie de l’affirmation qu’il porte.

Une ligne par critère (ceux du pack sous `--standard`), une colonne par page :
`C` conforme · `NC` non conforme · `—` non applicable · `?` à évaluer. La même grille est
intégrée à `report` dès que des pages sont dans le périmètre.

Une colonne a pour en-tête l’**URL** de la page, pas son nom. Un nom n’est pas une adresse —
deux routes d’une même application s’appellent couramment toutes deux « Accueil », et un
`<title>` est écrit pour un onglet de navigateur plutôt que pour une colonne. Quand toutes les
pages du périmètre partagent une origine (ce que produit l’exploration (crawl) d’un seul site),
l’en-tête est le **chemin** et l’origine est indiquée une seule fois au-dessus du tableau, parce
que neuf colonnes de `https://example.fr/mentions-legales.html` forment un tableau que personne
ne lit ; une exécution aux origines mêlées garde les URL complètes, puisque là l’origine *fait*
partie de l’identité. Elle se reconstruit à partir d’un `audit.json` commité **seul** — sans
instantané sur disque, sans navigateur — parce que `scope.pages` enregistre les pages et que
chaque constat porte sa `page`.

Le statut par page n’est pas calculé une seconde fois : une *vue* par page de l’audit est
fournie à la même projection que celle qu’utilise le rapport (`derivePackResults`). La grille et
le rapport concordent donc par construction — les critères hors périmètre (RGAA 8.1), les
critères frères écartés du périmètre, les surcharges du pack et le traitement des
recommandations viennent tous d’une seule implémentation, pas d’une seconde qui dériverait.

## Le RAPPORT par page (`pages --format report`)

La grille répond à *« quels critères échouent, à travers les pages ? »* — la bonne forme pour un
diff, la mauvaise pour le responsable d’une page : avec 106 critères RGAA sur N pages, personne
ne lit une colonne. Le rapport répond à *« quel est l’état de CETTE page ? »*.

```
node scripts/ultra11y.mjs pages --in audits/audit-latest.json --standard rgaa --format report --out audits
#   → audits/pages-<date>.md — the index, then one section per page

node scripts/ultra11y.mjs pages --in audits/audit-latest.json --standard rgaa --format report --split page --out audits/pages
#   → audits/pages/index.md + audits/pages/page-<id>.md      (recommended past 3–4 pages)
```

La fiche de chaque page porte, dans l’ordre : son identité (nom, URL, badge d’authentification,
base instantané/source), **sa capture d’écran**, son taux et son décompte C/NC/NA/à évaluer,
**chaque critère du référentiel actif** avec son statut sur cette page, puis chaque
non-conformité sous la forme du **bloc de conformité de l’auditeur** ordinaire.

Deux choses qu’elle ne fait délibérément PAS :

- **Elle ne redécide rien.** Chaque statut vient de `derivePages` et, sous un pack, de
  `derivePackResults(pageView(…))` — la même projection que la grille et le rapport utilisent
  déjà. Une seconde implémentation dériverait, et le premier symptôme d’une dérive dans un
  rapport d’accessibilité est un critère déclaré conforme en silence.
- **Elle n’invente aucun format.** Les non-conformités sont rendues par `renderAuditorUnit`, si
  bien qu’une fiche de page, le rapport de conformité, le PRD et l’issue GitHub sont le même
  bloc — et les lignes d’occurrence restent analysables par `verify`.

La capture d’écran est **copiée à côté du rapport** quand vous passez `--out` : le
`.ultra11y/pages/<id>/screen.png` de chaque page atterrit dans `<out>/assets/<id>.png` et y est
lié de façon relative. C’est ce qui rend le répertoire de sortie autonome — la CI téléverse
`audits/` seul comme artefact, et une référence `../../.ultra11y/…` serait une image cassée dans
chaque fiche qu’ouvre le relecteur. Sans `--out` (flux vers la sortie standard), le chemin reste
relatif, puisqu’il n’y a aucun répertoire à garder intact. Une page sans capture d’écran le dit,
plutôt que de ne rien montrer.

Les fiches sont nommées `page-<id>.md` : une page dont l’id est `index` — l’id ordinaire pour une
cible `index.html` — serait sinon écrite par-dessus l’index lui-même.

`check` reconnaît ces fichiers (ils portent un marqueur `ultra11y:pages-report`) et lance les
contrôles qui ont un sens ici — avant tout **aucun critère inventé** — au lieu d’exiger la
structure §1–5 d’un document de conformité.

### Quatre règles d’honnêteté

**0. Une page n’est enregistrée que si le navigateur y est resté, et qu’elle a répondu.** L’`id`
et le `name` déclarés d’une page de l’échantillon sont l’identité dont parle le rapport, et ils
sont appliqués à ce qui se trouvait à l’écran. Une route qui redirige — une session expirée
renvoyée vers la connexion, une étape d’assistant que l’état de l’application n’ouvre pas —
serait donc classée sous le nom de la page demandée tout en montrant autre chose : une fiche, une
capture d’écran et un taux qui décrivent un autre écran, sans que rien dans le document ne semble
anormal.

`scan --sample` refuse de deux façons :

- **Elle a bougé.** L’adresse est comparée comme l’application route : le **chemin** toujours ;
  le **fragment** et la **requête** quand la demande en portait un, parce qu’une application à
  routeur par hash y place la route et que `#/admin` → `#/login` est exactement le renvoi pour
  lequel cette règle existe ; l’**hôte**, puisqu’un atterrissage au même chemin sur un fournisseur
  d’identité est la même mauvaise attribution (un schéma, un port ou un `www.` peuvent différer
  librement — c’est de la canonicalisation). La comparaison utilise l’URL capturée juste après que
  la navigation s’est stabilisée, avant qu’une sonde puisse cliquer sur quelque chose qui route.
  Une redirection qui ne fait que **canonicaliser** l’adresse — ajouter ou retirer la barre
  oblique finale (`/documents` → 301 → `/documents/`, ce que fait tout serveur statique pour un
  répertoire), changer le schéma, le port ou le `www.` — n’est pas un déplacement : elle est
  **suivie**, et c’est la page d’arrivée qui est auditée **et enregistrée à son adresse
  d’arrivée** (l’`url` de l’instantané). C’est cette adresse qui sert de base aux liens de la
  page : les documents liés se résolvent contre elle (et contre son `<base href>` s’il y en a
  un), jamais contre l’adresse demandée — sinon `formulaire.pdf` sur `/documents/` devient
  `/formulaire.pdf`, une 404. Le scan le signale (ℹ️) et vous invite à déclarer l’adresse
  canonique dans l’échantillon ; `pages discover` la déclare d’emblée.
- **Elle a répondu une erreur.** La propre page « introuvable » d’un framework est un document
  complet et valide servi à l’adresse demandée — `notFound()` dans Next est exactement cela — donc
  aucune comparaison d’adresses ne peut la voir. Le statut HTTP, lui, le peut : tout ce qui est
  ≥ 400 est refusé.

Une page refusée est **nommée dans le rapport**, avec ce qui a été demandé, ce qui a été atteint
et pourquoi, et elle est retirée de `scope.sample` — l’y laisser la remettrait dans la grille
avec la même base qu’une page réellement visitée, et le livrable prétendrait alors que nous
l’avons examinée. **Une seule page refusée suffit à faire sortir `scan --sample` avec le code
1** : un échantillon partiel n’est pas un succès. Le rapport est tout de même écrit sur les pages
mesurées, et la dernière ligne nomme les pages refusées (« échantillon partiel — 2 page(s) sur
11 non enregistrée(s) : … »). Une exécution où *toutes* les pages ont été refusées sort aussi
avec 1, avant tout rapport : ce n’est pas un résultat partiel, c’est un scan qui n’a rien
mesuré. Sous `--baseline`, c’est la porte de la référence qui tranche : une page déjà
impossible à rendre dans la référence ne bloque pas, une page nouvellement impossible à rendre
bloque.

**La découverte applique la même règle en amont.** `pages discover --sitemap|--crawl` interroge
chaque URL et écarte de l’échantillon, en la nommant, celle qui répond une erreur HTTP (une
page « Error response » n’est pas une page du site), qui redirige vers une autre page, ou qui
sert un listing de répertoire généré par le serveur (« Index of / », « Directory listing for
… »). L’inventaire `.ultra11y/routes.json` garde chaque route avec ce qu’elle a répondu
(`status`, `landed`, `refused`), et `sample check` refuse de dire « complet » un échantillon
dont une page déclarée est connue injoignable : il la nomme. Une page signalée
manquante est un bug dans l’échantillon ou dans l’état que vous avez préparé, et les deux se
corrigent ; une page signalée sous le mauvais nom est une fausse déclaration de conformité.

**1. Un constat n’est attribué à une page que lorsque quelque chose le dit.** Dans l’ordre : le
chemin de l’instantané sur lequel il a été levé (`.ultra11y/pages/<id>/dom.html` — l’id est *dans
le chemin*, ce qui permet à `pages` de réparer un audit produit avant que l’estampille ne
fonctionne, sans aucun `dom.html` restant sur disque), l’URL de la page scannée, le nom de page
de `scan --sample`, puis les `sources` enregistrées par la page elle-même. Tout le reste reste
**non attribué** et est rapporté sous forme de compte — jamais réparti sur toutes les pages, ce
qui inventerait des non-conformités. Un composant partagé est rattaché de façon déterministe à
la première page plutôt que dupliqué sur chacune. Le compte couvre les deux canaux : un constat
du pack qu’aucune page ne revendique est compté lui aussi.

**2. « Aucun constat ici » ne signifie conforme que pour une page dont le DOM réel a été
audité.** Quatre bases, et seule la première obtient `C` par le silence :

| `basis` | Ce que cela signifie | Le silence signifie |
|---|---|---|
| `snapshot` | cet audit a lu le DOM sérialisé de la page | conforme, pour les critères `static` |
| `attributed` | pas d’instantané — seuls des constats de source y ont été rattachés | rien ; les critères restent `manual` |
| `not-audited` | un instantané existe, mais **cet** audit ne l’a jamais lu | rien ; les critères restent `manual` |
| `loading` | l’instantané a été capturé alors que la page se déclarait encore en chargement (`meta.loading` : `aria-busy`, un indicateur de chargement, « Chargement… ») | rien ; ses constats comptent, mais aucune de ses mesures ne crédite de couverture |

Pour les trois dernières, **l’absence de preuve n’est pas la preuve de l’absence** : aucune
règle n’a tourné sur le document de cette page, donc ses critères non décidés restent `manual`
plutôt que d’obtenir un verdict par le silence. La grille indique laquelle est laquelle, et
avertit dès qu’une page n’est pas un instantané.

`not-audited` est un mot distinct à dessein. Un `audit` portant uniquement sur la source
enregistre chaque répertoire d’instantané sur disque comme une page du périmètre sans en lire
aucun, et appeler ces pages « source » dirait au lecteur qu’elles n’ont pas d’instantané — une
autre fausse déclaration, pas une moindre. La preuve est `scope.pagesAudited`, écrit à côté de
`scope.pages` dans chaque audit (sous la forme `[]` quand il n’y en a aucune : un garde-fou
absent chaque fois qu’il n’y a rien à signaler est un garde-fou qui se désactive lui-même
exactement quand il compte). Un audit écrit avant que ce champ n’existe le laisse indéfini, est
lu comme « inconnu », et garde la base qu’il avait enregistrée.

**Un taux calculé sur rien n’est pas un taux.** Le taux par page est la formule de page du RGAA,
conformes ÷ (conformes + non conformes) : un critère sans objet sur la page en sort, tout comme
un critère encore à évaluer — ceux-là sont comptés à côté du taux, qui est marqué provisoire
tant qu’il en reste : `96 % (70/73) · provisional, 9 to assess`. Il est **nul** quand rien n’a
été décidé — rendu `—`, jamais un nombre, et toujours à côté de son dénominateur : `— (0/106)`
sous le cœur, `— (0/0) · 12 to assess` sous un pack. Renvoyer 100 dans ce cas, c’est ainsi que
trente-huit fiches ont rapporté une page parfaite pour une application dans laquelle un auditeur
humain venait de trouver seize non-conformités : les critères étaient tous « à évaluer », donc
rien n’était décidé, donc le taux valait 100. La cellule de l’index porte le même crochet que la
ligne de taux de la fiche, issu d’un seul calcul partagé, si bien que l’artefact que l’on colle
dans une pull request ne peut plus dire quelque chose que sa propre fiche contredit.

**3. Le silence ne décide que ce que le moteur PEUT décider.** Un `NC` valable pour tout le
périmètre sur un critère qui demande un jugement signifie qu’un échec certain s’est déclenché
*quelque part* — pas que le moteur peut statuer sur ce critère. Sur une page où l’échec ne s’est
pas déclenché, le moteur sait « pas d’échec certain ici », ce qui n’est pas « conforme » : la
pertinence de l’alternative, la fonction du lien et l’ordre de lecture ne sont toujours le
verdict de personne. Seuls les critères dont la matrice au niveau des tests opte pour
`completeBySilence` obtiennent donc `C` à partir d’une exécution silencieuse entièrement mesurée
— sous le RGAA, ce sont **8.3 et 8.5, et ces deux-là seulement**. Une règle qui couvre un
sous-test, une précondition ou un mécanisme autorisé ne peut pas clore le reste du critère. Tout
le reste reste « à évaluer » jusqu’à ce que `scan`, le niveau instantané ou un arbitrage le
décide. Avant cette règle, une page sans images obtenait 100 % sur « chaque image a-t-elle une
alternative pertinente ? », un taux calculé sur des critères que personne n’avait évalués.

Ce en quoi un critère PEUT être décidé, sans rien de tout cela, est une autre question : depuis
que le moteur a appris à prouver l’applicabilité (`src/audit.ts` `SUBJECT_MATTER`), un critère
dont l’objet est absent de tout le périmètre se clôt en `NA` justifié — ainsi un dépôt sans
médias rapporte la thématique 4 du RGAA comme non applicable plutôt que comme « à évaluer ».

Une recommandation non normative ne fait jamais basculer un critère de page en `NC`, exactement
comme dans le cœur.

### Occurrences répétées, regroupées

L’attribution par page fait apparaître les défauts du design system à leur vraie multiplicité :
une seule règle de style de lien du DSFR peut représenter 472 constats sur 38 pages à partir de
7 sélecteurs distincts. Une fiche de page regroupe donc les occurrences par
`(file, ruleId, selectorHint)` sous un en-tête compté —
`` **`a.fr-link`** — lien identifié par la couleur seule · ×12 ``.

C’est un regroupement d’**affichage**. L’en-tête n’a délibérément pas la forme d’une case à
cocher, chaque occurrence garde sa propre ligne analysable indentée en dessous, et le bloc
annonce toujours le compte brut — si bien que `verify` construit exactement autant d’éléments
groupés que non groupés et qu’aucune non-conformité déclarée n’échappe à l’arbitrage en étant
rangée sous un en-tête. `ruleId` fait partie de la clé parce que WCAG 1.4.3 porte à la fois une
mesure CSSOM et une mesure sur capture d’écran, et les présenter comme un seul défaut serait un
mensonge. Il est désactivé partout ailleurs : le backlog, `prd --split criterion` et le corps de
chaque issue du tracker sont identiques octet pour octet à ce qu’ils étaient.

### Montrer le défaut, pas seulement le citer (`--evidence`)

`selectorHint` est avec perte par construction — première classe seulement, `href` tronqué — et
chaque constat du niveau rendu sur une page rendue côté client est ancré à `dom.html:2`,
l’élément `<html>`. Ce que reçoit un relecteur non technique est
`` `.ultra11y/pages/accueil/dom.html:412`
(`div.card`) ``, ce qui ne localise rien.

```sh
node scripts/ultra11y.mjs pages --in audits/audit-latest.json --format report \
  --split page --evidence --out audits/pages
```

Chaque occurrence gagne une sous-puce inerte avec un recadrage annoté de l’élément fautif, écrit
dans `assets/<page-id>/<hash>.png` :

```md
- [ ] `.ultra11y/pages/accueil/dom.html:412` (`div.card`) — <img> without an alt attribute…
  - ![Cropped capture of the img element on the accueil page, outlined](./assets/accueil/c90959b13aa2.png)
```

**Dérivé au moment du rendu, jamais estampillé sur le constat.** Un rectangle en pixels est une
propriété de l’image : une boîte écrite sur un `Finding` devient fausse en silence dès que
l’audit est rendu à nouveau contre une autre capture. La jointure va de `sourceStart` → ordinal
d’ordre du document → `boxes.json`, via le même `alignedBoxes` qu’utilise le niveau rendu — y
compris son refus d’aligner un condensé dont les balises ne concordent pas. `Finding` ne gagne
aucun champ.

Le marquage n’est pas monochrome : un halo blanc, un anneau rouge, des crochets d’angle dont la
forme dit « ici », et une ligne intérieure en pointillés qui survit à une impression en noir et
blanc. Cet outil signale des échecs 1.4.1 ; son propre livrable ne peut pas en commettre un.

**Rien n’est coupé en silence.** Treize motifs de refus, chacun avec sa propre phrase, comptés
par page et par critère dans la fiche elle-même :

| Motif | Ce qui s’est passé |
|---|---|
| `no-snapshot` | la capture que nomme le propre chemin de ce constat n’est pas sur ce disque |
| `no-screenshot` | le producteur n’a capturé aucune image pour cette page |
| `unreadable-image` · `no-boxes` · `truncated` | la capture ou le condensé des boîtes n’est pas fiable |
| `no-offsets` · `unjoinable` | le constat n’a pas de plage d’octets, ou elle ne se résout en aucun élément |
| `page-scope` | le constat porte sur le document, pas sur un élément que l’on peut encadrer |
| `zero-area` · `below-the-fold` | l’élément est invisible, ou hors d’une capture limitée au viewport |
| `unknown-scale` | le ratio de pixels de l’appareil n’a pas pu être dérivé — un recadrage tomberait à côté |
| `deduplicated` | le même défaut sur le même élément — l’image d’une autre occurrence le montre |
| `capped` | un défaut **distinct** n’a pas été dessiné : 6 par règle, 12 par page, `--evidence-max` par exécution |

Les deux derniers sont comptés à part à dessein. `deduplicated` ne coûte rien au lecteur — le
défaut est à l’écran, sous une autre occurrence. `capped` est un vrai manque, et c’est le seul
qu’un réglage peut combler.

Un constat levé sur la SOURCE ne figure dans aucune des deux colonnes : il n’a jamais eu de
pixels, ce n’est donc pas une occurrence qui n’a pas pu être illustrée, et un dépôt audité à
partir de la seule source ne reçoit aucune mention plutôt qu’une ligne par constat.

Une occurrence sans image ne doit jamais se lire comme une occurrence sans défaut, c’est pourquoi
la fiche dit combien n’ont pas été illustrées et pourquoi. Le document combiné, les fiches HTML
et le composite font de même — chaque surface qui peut montrer un recadrage peut dire ce qu’elle
n’a pas montré.

Sans `--evidence`, le Markdown est **identique octet pour octet** à ce qu’il était. La puce du
recadrage ne porte pas de `[ ]`, si bien que `verify` construit la même liste de travail avec ou
sans elle — l’indentation seule ne suffirait pas, puisque `AUDITOR_OCCURRENCE` est ancré
`^\s*-\s\[ \]` et tolère des espaces en tête.

### La même chose, sous forme de page (`--html`)

`--html` écrit `index.html` et un `page-<id>.html` par page à côté du Markdown dont ils sont le
miroir. Autonome : aucun script, aucune ressource externe, rien qui pointe hors du répertoire de
sortie.

**Le fichier unique imprimable vient de `report --html`, pas d’ici.** Un composite par
artefact : en émettre un depuis les deux commandes mettrait une seconde copie de chaque recadrage
intégré dans le même téléversement, donc `pages --html` n’en écrit délibérément aucun.

```sh
node scripts/ultra11y.mjs report --in audits/audit-latest.json --html --evidence --out audits
```

### Parcourir les résultats et leur historique (`serve`)

`serve` transforme le répertoire des audits en un petit site local, en lecture seule :

```sh
node scripts/ultra11y.mjs serve                              # http://127.0.0.1:4711/ (next free port when busy)
node scripts/ultra11y.mjs serve --in audits --port 8080      # another directory, another port
node scripts/ultra11y.mjs serve --static site                # the same pages as plain files, relative links only
```

- **L’historique, c’est le répertoire.** Chaque JSON d’audit courant sous `--in` (par défaut
  `audits`, jusqu’à trois niveaux de profondeur) est un audit : gardez des copies datées —
  `audits/2026-09-01/audit-latest.json` à côté du `audits/audit-latest.json` de l’exécution — et
  elles s’alignent selon leur `date`. Les copies identiques comptent une fois ; les autres JSON
  (pages.json, listes de travail, jeux de tickets) sont ignorés.
- **Par audit :** son tableau de bord (résumé, synthèse, la grille des 106 critères, le tableau
  des scores par page), l’index des pages avec le **taux moyen** du RGAA, une fiche par page avec
  sa capture d’écran, les parcours, les instantanés de composants
  (`.ultra11y/render-snapshots/index.json`) et ses fichiers — le rapport, l’annexe (avec
  l’annexe I, la carte de l’application, quand l’annexe en a une), le JSON.
- **Entre deux audits successifs :** l’évolution en points du taux de conformité et du taux
  moyen, les critères par statut avant et après, chaque critère dont le statut a changé (corrigé,
  régression, décidé, rouvert, requalifié) et l’évolution du taux de chaque page.
- **Rien n’est recalculé.** Les taux sont ceux du rapport lui-même (`conformanceRate`,
  `averageConformanceRate`, le taux de la fiche de page) ; les pages sont produites par les
  constructeurs du rapport HTML.
- **Les captures n’appartiennent qu’au dernier audit.** `.ultra11y/pages` et
  `.ultra11y/render-snapshots` contiennent l’état courant ; un audit plus ancien ne montre une
  capture d’écran que lorsqu’une a été copiée à côté de lui (`assets/<page>.png`, comme le fait
  `pages --format report`).
- **Sécurité :** `node:http` uniquement, lié à `127.0.0.1` sauf si `--host` dit autrement,
  `GET`/`HEAD` uniquement, un en-tête `Host` de boucle locale exigé. Les fichiers bruts sont
  servis depuis le répertoire des audits, `.ultra11y/pages` et `.ultra11y/render-snapshots`
  seulement, avec leur type de contenu ; un chemin qui en sort, un lien qui pointe hors d’eux, un
  fichier caché (commençant par un point) ou un répertoire est refusé.
- **`--static <dir>`** écrit chaque page et copie exactement les fichiers qu’elles montrent.
  Tous les liens sont relatifs, donc l’export fonctionne depuis n’importe quel sous-chemin
  (GitHub Pages, une publication iterion). La cible ne doit pas chevaucher le répertoire des
  audits.

### Thème des pages HTML (`--theme neutral|dsfr`)

`report --html`, `pages --html`, `serve` et `serve --static` acceptent `--theme`. Le flag
prime sur `"html": { "theme": … }` de `.ultra11yrc.json` (lu à la racine `--root`) ; sans l'un
ni l'autre, le thème est `neutral`, l'apparence habituelle.

```sh
node scripts/ultra11y.mjs report --in audits/audit-latest.json --html --theme dsfr --root .
node scripts/ultra11y.mjs serve --theme dsfr --root .
```

- **ultra11y ne fournit jamais le DSFR.** `--theme dsfr` résout `@gouvfr/dsfr/package.json`
  depuis la racine du projet audité (`--root`, sinon le répertoire courant), avec la résolution
  de Node (npm, pnpm, workspaces). Il intègre `dist/dsfr.min.css` et `dist/dsfr.print.min.css`
  **tels quels** dans un `<style>` de chaque page, y compris pour `serve` : la CSP du serveur
  n'autorise que les styles en ligne, et l'export statique reste ainsi autonome.
- **Paquet absent : code 2**, avec un message qui explique que le projet doit installer le DSFR
  lui-même (en acceptant ses conditions, `.dsfr.yml`) et qu'il est réservé aux sites en
  `.gouv.fr`. Aucun repli silencieux, aucun téléchargement. Rien n'est écrit avant ce contrôle.
- **Balisage DSFR** : `fr-skiplinks`, `fr-header` simple (sans bloc-marque : l'administration
  émettrice n'est pas connue ; l'en-tête dit « Audit d'accessibilité — Rapport généré par
  ultra11y »), navigation en `fr-tags-group`, contenu en `fr-container`, tableaux `fr-table`
  (cellules en variante multiligne), statuts en `fr-badge` (lettre conservée, sans icône),
  notes en `fr-callout` et avertissements en `fr-alert` (variante warning), `fr-footer` simple.
  Aucun JavaScript du DSFR : `<details>` reste natif.
- **Même structure accessible** dans les deux thèmes : `lang`, lien d'évitement vers `<main>`,
  un seul `h1`, tableaux avec `<caption>` et `scope`, statut jamais porté par la seule couleur.
  Les tests auditent les pages DSFR avec le moteur lui-même.
- **Limites** : les icônes et la police Marianne que la CSS du DSFR référence par chemin relatif
  ne sont pas copiées à côté du rapport ; la page retombe sur la police de repli du DSFR et
  n'affiche pas d'icône décorative. Le mode sombre du DSFR dépend de son JavaScript : le thème
  `dsfr` est clair.

## Produire des instantanés

Tout ce qui pilote un navigateur peut en écrire un — c’est le format qui fait contrat, pas le
producteur. Le moteur livre un collecteur côté navigateur (`COLLECT_SNAPSHOT`) qui renvoie le
DOM, le condensé de styles et les boîtes de la page courante en un seul `page.evaluate` ; un
producteur écrit cela accompagné d’un `meta.json`.

Deux producteurs sont livrés avec le moteur, et tous deux évaluent ce même collecteur :

| Producteur | Quand il tourne | Notes |
|---|---|---|
| `scan` | une URL, un sitemap, une exploration (crawl), ou l’échantillon déclaré | activé par défaut (`--no-snapshot` le désactive) ; collecté sur la page **intacte**, avant axe et avant toute sonde |
| les exports `ultra11y/playwright` · `ultra11y/cypress` | à l’intérieur de votre exécution Playwright/Cypress | la page dans l’état que votre test a construit (connecté, modale ouverte) |

`scan` est celui qui rend un **site servi** auditable page par page : sans instantané, une URL
scannée est en `basis: "attributed"` et, par la règle d’honnêteté 2 ci-dessus, ne peut jamais
obtenir un verdict conforme. Avec un instantané, les règles de portée page tournent, le DOM
injecté à l’exécution est audité, et la page se ré-audite hors ligne. `scan --merge` audite les
instantanés qu’il vient d’écrire et les intègre, si bien que la grille est remplie dans la même
exécution.

Un instantané malformé ou illisible est ignoré, jamais fatal : une seule exécution de producteur
défaillante ne doit pas aveugler tout le rapport. Un instantané dont le `meta.v` est plus récent
que ce que comprend le moteur est **refusé** plutôt qu’à moitié lu.

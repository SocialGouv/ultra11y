# Lancer l’audit pendant vos tests E2E (Playwright / Cypress)

`scan` lance son **propre** navigateur après coup. C’est une seconde exécution de votre
application, sans rien de l’état que vos tests viennent de construire : pas de connexion, pas de
formulaire rempli, pas de modale ouverte. L’intégration E2E inverse la logique — l’audit tourne
**à l’intérieur de l’exécution que vous avez déjà**, sur la page telle que votre test l’a
laissée.

Elle est livrée sous forme de **points d’entrée du package publié** — ajoutez `ultra11y` en
devDependency :

```js
import { test, checkA11y } from "ultra11y/playwright";
import ultra11y from "ultra11y/cypress/plugin";   // cypress.config.js
import "ultra11y/cypress";                         // cypress/support/e2e.js
```

Versionnés, typés, et ils résolvent le moteur livré dans le package même que vous avez
installé : un projet ne peut donc jamais envoyer ses pages à un autre build que celui dont il
dépend.

Ces exports enregistrent des **pages**. Les composants sont rendus par le moteur propre
d’ultra11y, `render`, qui ne lit ni n’exécute jamais vos tests (`references/rendered.md`).

## Balayer l’échantillon déclaré (`sweepSample`)

L’échantillon de `.ultra11yrc.json` dit déjà ce qu’est chaque page — id, nom, URL, si elle se
trouve derrière une connexion, les `sources` qui la rendent. Un dépôt qui écrit ensuite à la
main une table de routes pour piloter son balayage en garde une seconde copie, et les deux
finissent par diverger (drift) : une page renommée à un endroit conserve son ancienne identité
dans le rapport, ce qui est précisément l’échec que ce niveau existe pour empêcher.

Laissez donc l’échantillon le piloter :

```ts
import { sweepSample } from "ultra11y/playwright";

sweepSample({
  // Your framework's readiness. Without it a design system that boots asynchronously is
  // serialized half-mounted, and the audit reports markup no user ever meets.
  settle: async (page) => { await page.waitForLoadState("networkidle").catch(() => {}); },
  // Pages your own specs drive — a wizard step that needs state seeded first.
  only: (p) => !p.id.startsWith("declaration-etape-"),
});
```

Un test par page, chacune visitée, contrôlée par rapport à `expectPath` et à son statut HTTP,
et enregistrée sous son identité déclarée. Une page sur laquelle le navigateur n’est pas resté
est passée en `test.skip`, avec la raison.

`samplePagesFor()` et `sweepTarget()` sont la même logique sans le runner, pour un dépôt qui
veut déclarer ses propres tests.

### Le balayage lance les sondes par défaut

`checkA11y` laisse les sondes en direct optionnelles — il est appelé depuis un test qui possède
sa page et peut faire une assertion sur le focus ou le survol une ligne plus loin. Un balayage
n’est pas dans ce cas : il n’existe que pour enregistrer l’échantillon, et les sondes sont la
seule chose capable de trancher le zoom (1.4.4), la redistribution (1.4.10), l’espacement du
texte (1.4.12) et le contenu au survol (1.4.13) sur des écrans qu’un scanner à froid n’atteint
jamais. `sweepSample` les active donc.

C’est plus important qu’il n’y paraît, car la conformité sur ces critères est un ET sur toutes
les pages du périmètre. Mesuré sur un dépôt réel : 15 des 20 pages enregistrées venaient d’un
balayage qui n’avait jamais sondé, si bien que les quatre critères sont restés « à évaluer »
pour tout l’audit — y compris sur les cinq pages qui AVAIENT été sondées. Une seule page non
sondée ferme la porte pour toutes.

```ts
sweepSample({ check: { probes: false } });            // opt out entirely
sweepSample({ check: { probes: { budgetMs: 8_000 } } }); // …or just bound them
```

Les sondes sont bornées par construction : chaque interaction porte son propre délai
d’expiration, la passe porte un budget de temps réel, et tout ce que le budget interrompt est
enregistré comme `skipped` avec le critère et les millisecondes consommées — jamais abandonné,
car une mesure qui n’a pas eu lieu ne doit pas se lire comme une mesure qui n’a rien trouvé.
Les valeurs se trouvent dans `.ultra11yrc.json` sous `probes` (`budgetMs`, `actionTimeoutMs`,
`maxTriggers`, `maxFocusables`, `maxHits`, `reflowWidth`), là où doit se trouver un jugement
sur VOS pages.

## Une page sur laquelle le navigateur n’est pas resté (`expectPath`)

`as`/`name` est l’identité sous laquelle parle le rapport, et la fixture l’applique à ce qui
se trouve à l’écran. Ainsi une route que votre test n’a pas pu ouvrir — une étape protégée, une
session expirée — est classée sous le nom de la page demandée, et sa fiche, sa capture d’écran
et son taux décrivent tous un autre écran. Rien dans le document n’a l’air faux.

Passez le chemin vers lequel vous avez navigué et la fixture refuse à la place :

```js
await checkA11y(page, { as: "declaration-etape-4", expectPath: "/declaration/etape/4" });
// throws: /declaration/etape/4 landed on /declaration/etape/1 — not recording it as
// "declaration-etape-4". The state that opens this route is not the one the test built.
```

Optionnel, et limité au chemin : une query ou un fragment que l’application ajoute à sa propre
route désigne la même page. `scan --sample` applique la même règle sans qu’on le lui demande,
car là l’URL *est* l’instruction. Une page signalée manquante est un bug dans votre
préparation des données ; une page signalée sous le mauvais nom est une fausse déclaration de
conformité.

## Une page qui n’a pas fini de charger (`loadingTimeoutMs`)

Un test qui navigue et contrôle dans la foulée peut tomber sur l’espace réservé de la page —
« Chargement… » là où viendront les données. Avant la collecte, la fixture attend (10 s par
défaut, borné) que la page cesse de se déclarer en chargement : aucun `aria-busy="true"` rendu,
aucune barre de progression indéterminée (`role=progressbar` sans `aria-valuenow`, `<progress>`
sans `value`), aucun élément dont le texte entier est une formule de chargement
(« Chargement… », « Chargement en cours », « Veuillez patienter », « Loading… », « Please
wait »).

Une page encore en chargement quand la borne est atteinte est enregistrée quand même,
**marquée** : `meta.json` porte `loading` (les marqueurs qu’elle affichait encore), un
avertissement est affiché, et la base de la page est `loading` — « capture en état de
chargement » dans chaque rapport. Ses constats comptent ; son silence ne conclut rien.
`loadingTimeoutMs: 0` contrôle sans attendre. `scan` attend de la même façon ; Cypress
enregistre les marqueurs mais laisse l’attente au `should` du test lui-même.

## Une page capturée sans consentement aux cookies (`consent`)

Un navigateur de test, comme celui de `scan`, n’accepte jamais les cookies. Sur une page dont
la vidéo, la carte ou le widget social se trouve derrière un gestionnaire de consentement, ce
qui est capturé est l’**espace réservé**, comme le `.fr-consent-placeholder` du DSFR (« … est
désactivé »), la boîte d’activation de tarteaucitron, ou un bandeau Didomi, Axeptio ou EU
Cookie Compliance (`#sliding-popup`). Le collecteur les détecte (`src/consent.ts` : ces
éditeurs, plus les classes génériques `*consent*placeholder*` / `*consent*banner*`).
`meta.json` porte alors `consent: "none"` et `consentMarkers`, et chaque preuve récoltée à
l’intérieur de l’un d’eux est étiquetée « état sans consentement » dans les briefs
d’arbitrage, afin de ne pas être jugée comme le contenu propre de la page (pas un titre 9.1,
par exemple). Accepter ou refuser le consentement avant la capture
(`sample.consent: accept|refuse`) n’est pas encore implémenté : chaque gestionnaire de
consentement nomme ses boutons différemment, et un clic manqué capturerait le mauvais état
sous la bonne étiquette.

## Playwright

```js
import { test, checkA11y } from "ultra11y/playwright";

test("home page is accessible", async ({ page, ultra11y }) => {
  await page.goto("/");
  await ultra11y({ as: "accueil" });                 // via the fixture
});

// …or with no fixture, on any page object:
await checkA11y(page, { as: "contact", failOn: "major" });
```

**Branchez-le d’abord.** Quand le projet a des tests Playwright, c’est le principal niveau
rendu d’un audit complet (`references/full-audit.md`). Ajoutez `checkA11y` aux specs qui
atteignent une page dans un état donné (connecté, formulaire rempli, dialogue ouvert), et
`sweepSample` pour l’échantillon déclaré. Réutilisez les captures `.ultra11y/pages` que la
suite a déjà écrites avant de vous rabattre sur `scan`. Ensuite
`pages discover --from-snapshots --routes-only` ajoute à l’inventaire les routes atteintes par
la suite, et `scan --all-routes` ne les rescanne jamais.

**La passe axe est celle d’ultra11y**, pas celle du projet. La passe (`axe`, `auto` par
défaut) injecte l’`axe-core` épinglé livré avec ultra11y, avec les mêmes tags de règles que
`scan`, de sorte qu’une capture et un scan de la même page sont mesurés par le même moteur. La
version exécutée est écrite dans le `axe.json` de la capture (`engine`) et nommée dans l’annexe
du rapport. Le `@axe-core/playwright`/`axe-core` du projet n’est utilisé que lorsque celui
d’ultra11y ne peut pas être résolu, et une note le signale.

## Cypress

Le code de test Cypress s’exécute dans le **navigateur**, qui ne peut pas écrire sur le disque :
la page collectée fait donc un aller-retour par une tâche Node. Deux fichiers, deux points de
branchement :

```js
// cypress.config.js
import ultra11y from "ultra11y/cypress/plugin";
export default defineConfig({ e2e: { setupNodeEvents(on, config) { ultra11y(on); return config; } } });

// cypress/support/e2e.js  (the supportFile)
import "ultra11y/cypress";
```

```js
cy.visit("/");
cy.ultra11y({ as: "accueil" });
```

**Pas de passe axe sous Cypress.** `cy.ultra11y()` enregistre la page (DOM, styles, boîtes,
capture d’écran) et les règles statiques et rendues du moteur l’auditent, mais il n’injecte
aucun axe-core et ne lance aucune sonde en direct. Les critères que tranche axe (le contraste
calculé avant tout) restent donc « à évaluer » sur les pages vues uniquement par Cypress.
Atteignez-les avec `ultra11y/playwright` ou avec `scan` sur les mêmes routes.

## Options

| Option | Effet |
|---|---|
| `as` | l’**id** de la page (nom du répertoire). Par défaut, le chemin d’URL slugifié |
| `name` | nom lisible de la page pour le rapport. Par défaut, le titre du document |
| `failOn` | `"blocking"` (par défaut), `"major"`, `"minor"`, ou `false` pour enregistrer sans jamais échouer |
| `lang` | langue du message d’échec et du rapport par page : `"fr"` ou `"en"`. Par défaut, la langue que déclare la page (`<html lang>`), sinon le français |
| `auth` | marque la page comme se trouvant derrière une authentification |
| `sources` | fichiers sources qui l’ont rendue — les constats sont alors rapportés sur **votre code** |
| `notes` | notes de reproduction reportées dans le ticket de l’auditeur |
| `pdf` | Playwright : télécharge les documents PDF vers lesquels pointe la page (`true` par défaut ; `false` équivaut à `scan --no-pdf`) — voir plus bas |
| `maxPdf` | Playwright : nombre maximal de documents téléchargés par worker de test (20 par défaut, 20 Mio chacun) — `scan --max-pdf` |

`failOn: false` est l’option utile pour l’adoption : enregistrez d’abord toutes les pages,
regardez le vrai backlog, puis activez le garde-fou.

## Ce qu’il fait, exactement

Deux étapes par page contrôlée, et la fixture ne possède aucune des deux :

1. la page est collectée **dans le navigateur** avec le collecteur propre du moteur — DOM,
   condensé des styles calculés, boîtes englobantes ;
2. la charge utile est envoyée à `ultra11y snapshot write`, qui persiste
   `.ultra11y/pages/<id>/` **et** l’audite, en renvoyant l’`AuditResult`.

La fixture ne sait donc rien du format d’instantané, du commentaire de provenance ni de
l’audit — c’est un tuyau. Il n’y a pas de seconde implémentation susceptible de dériver
(drift) et de se désynchroniser, et tout autre producteur peut utiliser la même commande.

## Les deux runners alimentent désormais le niveau pixel

Playwright prend une **capture d’écran du viewport** et l’envoie avec la charge utile — c’est
ce qui alimente `rendered-contrast-pixel` (contraste sur un dégradé ou une image de fond, le
seul cas que les styles calculés ne peuvent pas exprimer). Quand la page est plus haute que le
viewport, il capture aussi la **page entière** (hauteur plafonnée à 8000 px) sous
`screen-full.png`, ce que les rapports montrent à un relecteur ; le niveau pixel garde la
capture du viewport, dont les coordonnées correspondent à `boxes.json`. `screenshot: false`
désactive les deux.

Cypress n’en avait aucune : `cy.screenshot()` écrit à un chemin que Cypress choisit et nomme,
si bien que le côté navigateur n’apprend jamais où le fichier est parti. L’événement
**`after:screenshot`** est le chaînon manquant — il transmet au plugin Node le chemin réel du
fichier que Cypress vient d’écrire, que celui-ci relit et joint. Une page collectée par Cypress
obtient donc elle aussi toutes les règles.

La capture d’écran est prise **avant** la collecte : `cy.screenshot()` bascule une classe sur
le document pendant la capture, et sérialiser en pleine capture enregistrerait cet état
transitoire comme s’il s’agissait de la page. Si l’événement ne se déclenche jamais, la page
est enregistrée sans capture d’écran — le critère reste non tranché, exactement comme avant, et
n’est jamais deviné.

Tout le reste — le DOM, les styles calculés, les boîtes et les feuilles de style — est
identique entre les deux.

## Les documents vers lesquels pointe la page (Playwright)

`checkA11y` — et donc chaque page de `sweepSample` — télécharge les **documents PDF de même
origine** vers lesquels pointe la page enregistrée, comme le fait `scan`, mais via le contexte
de requêtes de la page elle-même (`page.context().request`) : la session du test accompagne la
requête, si bien qu’un document généré derrière la connexion est atteint. Un lien est
**candidat** quand son chemin se termine par `.pdf`, qu’il déclare `type="application/pdf"` ou
`download`, que son texte / `aria-label` / `title` nomme PDF comme un mot, ou que son chemin ou
sa query le nomme comme un jeton (`/api/declaration-pdf?year=2026`, `?format=pdf`). Les liens
sont lus dans le navigateur, donc `a.href` est déjà résolu par rapport à la page et à son
`<base>`. Un candidat n’est conservé que si la réponse est `Content-Type: application/pdf` ou
commence par `%PDF-` ; tout le reste est affiché « not a PDF » avec le type de la réponse,
jamais audité. Chaque saut de redirection est vérifié avant d’être suivi (même origine, ou sa
montée http→https ; 5 au plus), si bien qu’aucune requête ne quitte l’origine auditée.

Ils arrivent dans `.ultra11y/documents/<sha256>.pdf` avec le même fichier annexe que celui
qu’écrit `scan` (`kind`, `v`, l’URL et **chaque page qui pointe vers lui** — un lien d’en-tête
présent sur chaque page est récupéré une fois par worker et son fichier annexe s’enrichit), et
`audit` / l’option `report: true` les relisent. Borné comme `scan` : au plus `maxPdf` (20 par
défaut) documents par worker de test, 20 Mio chacun. `pdf: false` le désactive. Un
téléchargement raté est un `console.warn`, jamais un test en échec. Cypress ne télécharge pas
de documents.

## Un rapport tout droit sorti de l’exécution des tests

`checkA11y(page, { report: true })` — et `cy.ultra11y({ report: true })` — écrit le rapport par
page une fois la page enregistrée — `audits/pages/index.md` plus une fiche par page, captures
d’écran comprises. Désactivé par défaut : un rapport par page contrôlée serait du gaspillage
dans une suite, activez-le donc dans un test final, ou lancez `pages --format report`
vous-même ensuite. Le code de test Cypress ne peut pas écrire de fichiers : l’option y est donc
déclarée dans le navigateur et honorée par le plugin Node — même option, même comportement, car
un runner qui l’ignorerait en silence serait pire qu’un runner qui en serait dépourvu.

## Pourquoi l’artefact compte plus que l’assertion

Une assertion en échec prévient un développeur, une fois. Le **snapshot** est la partie
durable :

- Il enregistre la page telle que le navigateur l’a réellement construite, si bien que la même
  page peut être ré-auditée **hors ligne, sans navigateur** — c’est ainsi que la CI tranche les
  critères de rendu sans démarrer l’application, et que le rapport parle page par page.
- Comme c’est un document complet (une capture de composant est un fragment), les règles à
  l’échelle de la page s’y appliquent : **RGAA 8.3** (`lang`), **8.5/8.6** (`title`), 12.6
  (`main`). Celles-ci ne sont pas décidables à partir d’un rendu de composant, ni à partir de la
  source dès qu’un framework injecte la coquille du document.
- Chaque constat porte `page` **et** `origin.sourceFile`, si bien qu’un défaut trouvé au rendu
  est rapporté sur le code qui l’a causé.

Commitez `.ultra11y/pages/` pour vous en servir comme garde-fou (`audit` ingère le répertoire
automatiquement). Ajoutez `sources` à vos options et le message d’échec nomme votre composant
au lieu de `dom.html`.

## Périmètre

`snapshot write` n’audite **que la page qu’on lui a passée** — jamais tout l’arbre des pages —
si bien qu’un test qui contrôle la page de contact n’échoue jamais à cause du backlog de la
page d’accueil. Les constats sont filtrés pour ne garder que les non-consultatifs avant le
garde-fou : une recommandation non normative ne fait jamais échouer un test.

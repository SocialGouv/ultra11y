# RGAA 4.1.2 — revue critère par critère du moteur (issue #65)

Ce à quoi chacun des 106 critères peut ou ne peut pas servir en confiance, après une revue du
pack au regard des tests officiels, de la méthodologie et du glossaire
(`src/data/standards/rgaa.json`). Chaque constat de cette revue a été **reproduit sur une page
minimale à travers le vrai moteur avant que quoi que ce soit ne soit modifié** ; ceux qui ne se
sont pas reproduits ont été écartés et sont listés comme tels.

La vérité de référence se trouve dans `tests/fixtures/rgaa-golden/` : une page non conforme
portant un défaut pour chaque critère qui peut échouer sur une seule page (avec une vraie image,
une vraie vidéo avec de la parole et du texte à l’écran, un vrai fichier audio), sa jumelle
conforme, et pour chacune le verdict attendu des 106 critères. `tests/rgaa-golden.test.ts`
audite les deux comme fichier source, comme capture et comme capture navigateur enregistrée, et
échoue si le moteur décide quoi que ce soit d’autre, efface une NC attendue, dit NA (même
provisoirement) là où la vérité n’est pas NA, ou transmet à l’arbitre un critère qui n’est pas
NA sans rien à citer. Sa liste de lacunes connues est **vide**.
`tests/rgaa-exhaustive.test.ts` vérifie que chaque critère a un niveau par test, des sujets de
récolte, une ligne de référence dans les deux grilles, et une graine de rappel pour chaque règle
décisive.

**Légende des statuts.** `OK` — revu, rien à changer. `fixed` — un défaut reproduit, corrigé
avec un test qui a d’abord échoué. `limit` — une limite connue, conservée exprès ou hors de
portée, avec la raison. Un critère peut en porter plusieurs.

## Correctifs transverses

| Mécanisme | Avant | Après |
|---|---|---|
| Sujets d’absence plus étroits que le glossaire | champs de formulaire = input/select/textarea ; pas de bouton ; listes = ul/ol/dl ; tableaux = `<table>` ; pas de `<input type=image>` ; pas de `role=link` ; documents bureautiques = pdf/doc/xls | rôles ARIA de champ, contenteditable, output/progress/meter ; un sujet `buttons` ; `role=list` et texte dessiné comme une liste ; `role=table/grid/treegrid` ; boutons image ; `role=link` ; odt/ods/odp/ppt(x)/rtf/csv/epub et tout lien `download` |
| Justification de NA | affirmait avoir cherché des champs ARIA, des rôles de liste, des boutons image… | dit ce qui a réellement été cherché |
| NA hérité par-dessus le sujet propre au critère | seuls les sujets d’existence pouvaient le bloquer | les sujets de présence seule (`pointerActions`, `cryptic`) le bloquent aussi |
| Critères de rendu avec une récolte vide | 3.2, 3.3, 7.3, 8.2, 10.1, 10.4, 10.5, 10.9–10.12, 10.14, 12.8, 12.9, 12.11, 13.9, 13.11 — seuls NA ou « indécidable » possibles | feuilles de style, déclarations, viewport, ordre de tabulation, balisage à valider, consignes — et, sur une capture, ce que le navigateur a mesuré (sonde exécutée / ignorée, règles de rendu exécutées, verdict axe par critère, paires de couleurs calculées) |
| NA de l’agent sur un critère auquel toute page est soumise | accepté quand la récolte était vide | refusé pour 8.1, 8.2, 8.3, 8.5, 10.1, 10.3, 10.4, 10.11, 10.12, 12.8, 13.9 |
| Prédicats sur des constructions de code (12.10, 13.1, 13.8, 13.10–13.12) | ne lisaient que la page ; un raccourci dans `app.js` prouvait « aucun raccourci » | un `<script src>` local est lu ; un script illisible (CDN, bundle de capture) laisse le critère ouvert |
| Sujets heuristiques | lisaient la prose comme du code (un titre RGAA dans une cellule de tableau était « un contenu en mouvement ») | ne correspondent qu’à l’intérieur des balises et de `<script>`/`<style>` |
| Taille de la liste de travail | chemins absolus répétés dans chaque `alsoAt` | chemins relatifs au répertoire de travail ; les citations se replient toujours |

## Par critère

| Critère | Statut | Notes |
|---|---|---|
| 1.1 | fixed | `<input type=image>` est récolté (il manquait — une page n’ayant que des boutons image fermait le thème 1 en NA) ; les notes montrent title, aria-labelledby, aria-hidden, figure. limit : pas encore de règle pour 1.1.4 (`ismap`) ni pour 1.1.5 (alternative de `<svg>` sans `role=img`). |
| 1.2 | fixed | sujet propre `images` (on lui transmettait tous les attributs ARIA de la page). limit : `axe:image-redundant-alt` reste ici un candidat bien que ce soit un signal de pertinence. |
| 1.3 | OK | limit : pas de règle candidate pour des alternatives comme `alt="image"` ou un nom de fichier. |
| 1.4 | limit | pas de sujet CAPTCHA : hérite de `images`, donc un CAPTCHA servi uniquement dans une iframe n’est pas vu. |
| 1.5 | limit | comme 1.4. |
| 1.6 | OK | `aria-describedby`/`longdesc` apparaissent désormais dans la récolte. |
| 1.7 | OK | |
| 1.8 | OK | jugement sur le contenu de l’image. |
| 1.9 | fixed | sujet propre `images` avec le contexte de la figure. limit : pas de règle statique pour une `<figure>` sans `role`/`aria-label`. |
| 2.1 | OK | `iframe-title-missing` accepte aussi `aria-label`/`aria-labelledby` : c’est seulement une sous-déclaration (2.1 ne se conclut pas par le silence). |
| 2.2 | OK | |
| 3.1 | OK | |
| 3.2 | fixed | preuves : paires texte/fond calculées avec leur ratio, déclarations de couleur des feuilles de style, les règles de rendu et le verdict axe par page. |
| 3.3 | fixed | preuves : déclarations de couleur, contrôles et boutons, `rendered:1.4.11`. |
| 4.1–4.6 | fixed | sujet `temporalMedia` (video/audio/object/embed et iframes de lecteur, avec leurs pistes) — une iframe YouTube n’était jamais montrée. limit : pas de règle pour 4.3.2 (`<track>` sans `kind="captions"`). |
| 4.7 | fixed | NA erroné : héritait `images` de 1.1.1 et se fermait sur une page avec une vidéo et sans image. Sujet propre `temporalMedia`. |
| 4.8, 4.9 | OK | héritent de `images`, qui contient object/embed/svg/canvas. |
| 4.10 | limit | l’applicabilité du WCAG 1.4.2 se limite à `<audio>`/`<video>` : `<bgsound>`, `<embed src=*.mp3>` et `new Audio()` ne sont pas vus. Provisoire (jugement), donc l’agent confirme quand même. |
| 4.11, 4.12 | OK | |
| 4.13 | fixed | montre les médias au lieu de l’ARIA de la page. |
| 5.1–5.6 | fixed | `tables` inclut `role=table/grid/treegrid` (un tableau de données uniquement ARIA fermait le thème 5 en NA) ; les notes donnent les décomptes de scope/id/headers et le nom du tableau. limit : `table-caption-missing` reste un candidat sur 5.4 (ne décide jamais). |
| 5.7 | fixed | comme ci-dessus. limit : `table-scope-invalid`/`headers-attr-dangling` n’ignorent pas les tableaux de mise en forme. |
| 5.8 | fixed | comme ci-dessus. limit : `layout-table-data-markup` ne vérifie pas `summary`, `<thead>`, `<tfoot>`, `role=rowheader/columnheader`. |
| 6.1 | fixed | l’étiquette dans le nom sur un lien relève du test 6.1.5 (`link-label-in-name-mismatch`, décisif) ; `role=link` récolté. limit : pas de candidat pour les intitulés de lien génériques. |
| 6.2 | fixed | fausse NC : un `<svg role="img" aria-label>` dans un lien était « sans nom » (décisif) — les noms viennent désormais d’un descendant qui se nomme lui-même, selon accname. Les liens composés d’une seule icône sans nom sont décisifs. `role=link` ne se ferme plus en NA. |
| 7.1 | fixed | l’étiquette dans le nom d’un lien ne rend plus 7.1 NC ; `invalid-aria-attr`, `invalid-aria-value`, `aria-required-attr`, `aria-prohibited-attr` et les vérifications axe `aria-*-name` l’atteignent désormais comme preuves. limit : `axe:button-name` sur un bouton de formulaire compte encore ici (attribution seulement : le bouton échoue aussi en 11.9) ; `aria-required-parent` remonte sous 1.3.1, auquel 7.1 n’est pas rattaché. |
| 7.2 | OK | |
| 7.3 | fixed | les preuves incluent les actions de pointeur sur les contrôles natifs et les écouteurs. limit : pas de règle pour `onfocus="this.blur()"` (7.3.2). |
| 7.4 | fixed | `on-input-context-change` (un `<select>` qui navigue) est routé comme candidat. |
| 7.5 | fixed | preuves : conteneurs de type statut n’importe où et scripts qui écrivent dans la page, plus la sonde de région live. |
| 8.1 | fixed | un fichier source sans doctype est récolté ; NA refusé. |
| 8.2 | fixed | fausse NC : un id réutilisé entre les branches `v-if`/`v-else`. `invalid-aria-attr`/`invalid-aria-value` décident 8.2.1. Preuves : le document à valider avec son doctype, les id en double, l’imbrication d’éléments interactifs. NA refusé. limit : pas de validation W3C Nu complète hors ligne. |
| 8.3 | fixed | C par le silence sur le seul `xml:lang` en HTML5 : la méthodologie ne l’accepte que pour XHTML 1.1 (ACT b5c3f8 est d’accord — désormais cohérent, 169/187). limit : une SPA dont le `lang` est défini à l’exécution se lit comme manquant dans la source. |
| 8.4 | OK | écarté : « `lang="zz"` passe » ne se reproduit pas (vérification dans le registre). |
| 8.5 | fixed | (#67) un `<svg><title>` comptait comme titre de la page. |
| 8.6 | OK | limit : pas de candidat pour les titres par défaut (« React App »). |
| 8.7 | OK | |
| 8.8 | limit | `lang-invalid` reste ici un candidat ; les étiquettes à usage privé du style `x-klingon` sont acceptées. |
| 8.9 | OK | |
| 8.10 | OK | écarté : `dir={x}` en JSX ne produit pas de fausse NC. limit : pas de détecteur pour du texte RTL sans `dir`. |
| 9.1 | fixed | `role=heading` est récolté. limit : un texte stylé comme un titre n’est pas récolté. |
| 9.2 | OK | |
| 9.3 | fixed | NA erroné : l’absence de `<ul>` valait « aucune liste » — `role=list` et les listes dessinées avec des puces/`<br>` sont récoltés, et 9.3 est marqué jugement (« regroupées visuellement »). Fausse NC : un `<transition-group>`/`<ng-container>` dans une liste. `dl-structure` routé comme candidat. |
| 9.4 | fixed | montre les citations (`<q>`, `<blockquote>`, texte entre guillemets) au lieu du plan. |
| 10.1 | fixed | fausse NC sur `<link rel=mask-icon color>` ; (#67) « Il y a à faire » lu comme des lettres espacées. Preuves : les feuilles de style. NA refusé. |
| 10.2 | OK | |
| 10.3 | OK | NA refusé. |
| 10.4 | fixed | preuves : viewport, hauteurs fixes/overflow, tailles de police en px, la sonde de zoom. NA refusé. |
| 10.5 | fixed | preuves : déclarations de couleur (c’était seulement les styles inline). |
| 10.6 | fixed | `axe:link-in-text-block` routé comme candidat. |
| 10.7 | fixed | fausse NC : `main:focus{outline:none}` sur une cible de lien d’évitement que Tab n’atteint jamais ; la sonde live manquait les indicateurs sur le conteneur (`:focus-within`) et sur l’élément frère suivant (`input:focus + label`). Preuves : les règles de focus. |
| 10.8 | OK | |
| 10.9, 10.10 | fixed | preuves : les consignes de la page, pas seulement celles qui utilisent déjà un mot sensoriel. |
| 10.11 | fixed | preuves : viewport, largeurs supérieures à 320px, `nowrap`, `pre`/tableaux, la sonde de reflow (c’était `readingOrder`). NA refusé. |
| 10.12 | fixed | preuves : déclarations d’espacement, hauteurs fixes, la sonde d’espacement du texte. NA refusé. |
| 10.13 | fixed | son sujet propre `additionalContent` avait été perdu ; la sonde de survol est montrée. |
| 10.14 | fixed | la sonde de survol est montrée. limit : pas de règle pour une révélation au `:hover` sans équivalent `:focus`. |
| 11.1–11.4 | fixed | NA erroné : un formulaire de widgets ARIA valait « aucun champ ». `axe:aria-input-field-name`/`aria-toggle-field-name` décident 11.1.1. |
| 11.5 | fixed | fausse NC : une case à cocher par ligne de tableau (`name="ids[]"`) est un choix par ligne, pas une question non regroupée. |
| 11.6 | fixed | fausse NC : un fieldset autour d’un seul champ. `axe:fieldset` retiré (cette règle axe n’existe pas — inerte). |
| 11.7 | OK | |
| 11.8 | OK | écarté : `<optgroup {...spread}>` ne produit pas de fausse NC. |
| 11.9 | fixed | NA erroné : un formulaire n’ayant que des boutons valait « aucun champ » ; il y a désormais un sujet `buttons`. |
| 11.10–11.12 | fixed | comme 11.1 (champs ARIA). |
| 11.13 | OK | |
| 12.1–12.4 | fixed | bruit : le lien de la marque vers `index.html` était présenté comme le plan du site. |
| 12.5 | fixed | montre le moteur de recherche (`navMechanisms`). |
| 12.6, 12.7 | OK | limit : `skip-link-target-missing` reste un candidat. |
| 12.8 | fixed | preuves : l’ordre de tabulation du DOM (c’était seulement tabindex). NA refusé. |
| 12.9 | fixed | la sonde de piège clavier est montrée. |
| 12.10 | fixed | un raccourci dans un script local est lu ; `accesskey` récolté. |
| 12.11 | fixed | la sonde de survol est montrée. |
| 13.1 | fixed | les minuteurs dans un script local sont lus. |
| 13.2 | limit | `window.open` dans un script externe ne fait pas partie de `newWindow`, qui peut donc encore fermer 13.2 par absence. |
| 13.3 | fixed | NA erroné sur les liens `.odt`/`.pptx`/de téléchargement. Issue #90 : le moteur LIT désormais les PDF — nommés comme entrées, ou téléchargés par `scan` depuis des liens de même origine dans `.ultra11y/documents` — et les cinq règles de document (`pdf-untagged`, `pdf-lang-missing`, `pdf-title-missing`, `pdf-no-text`, et `pdf-structure-shallow` à titre indicatif) atteignent 13.3 comme preuves **candidates**, routées par identifiant de règle (13.3 n’est pas rattaché à 2.4.2). Le brief liste chaque document avec chaque vérification, citable à sa ligne d’en-tête. limit : candidat seulement — « si nécessaire » admet une version alternative accessible qu’aucune vérification de document ne voit, et passer les vérifications n’est jamais une conformité PDF/UA (veraPDF/PAC) ; un fichier illisible (chiffré, malformé, tronqué) est listé comme tel et jugé à la main ; un document authentifié n’est téléchargé qu’avec la session (`scan --storage-state`, ou le contexte propre de la fixture Playwright — issue #111) ; les formats bureautiques autres que PDF ne sont pas ouverts. |
| 13.4 | fixed | NA erroné sur les liens `.odt`/`.pptx`/de téléchargement. limit : comparer un document avec son alternative revient à l’agent ; les documents lus pour 13.3 sont dans sa récolte. |
| 13.5, 13.6 | fixed | NA erroné : héritait de `images` ; un sujet `cryptic` (emoji, émoticônes, kaomoji, art ASCII). |
| 13.7 | fixed | bruit : de la prose sur les flashs valait « un mécanisme de flash ». |
| 13.8 | fixed | bruit comme ci-dessus ; les GIF animés sont récoltés. |
| 13.9 | fixed | preuves : media queries d’orientation, `screen.orientation.lock`, le viewport (c’était `readingOrder`). NA refusé. |
| 13.10, 13.12 | fixed | les écouteurs de gestes et de mouvement de l’appareil sont récoltés ; les scripts locaux sont lus. |
| 13.11 | fixed | NA provisoire erroné : le « aucun gestionnaire d’événement down » du WCAG 2.5.2 n’est pas « aucune action de pointeur ». |

## Constats de la revue qui ne se sont pas reproduits

- `dir={x}` en JSX et `<optgroup {...spread}>` ne produisent pas de fausses NC sur 8.10/11.8.
- `lang="zz"` est rejeté (8.4).
- « Les tests étiquetés statiques rendent définitif un NA erroné » ne vaut que là où l’absence
  elle-même n’est pas fiable : les niveaux sont dérivés des règles décisives, donc le correctif
  est dans les sujets (et dans le marquage jugement de 9.3), pas dans un réétiquetage des
  niveaux.

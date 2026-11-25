<!-- GÉNÉRÉ depuis le corpus W3C ACT embarqué par `pnpm run build:act` — ne pas modifier à la main. -->

# Conformité ACT — comment ce moteur se mesure à un corpus qu’il n’a pas écrit

La matrice de rappel de ce dépôt prouve que chaque règle se déclenche sur le défaut écrit POUR elle.
C’est circulaire. Le [W3C ACT-Rules Community Group](https://act-rules.github.io) publie des règles
avec des exemples `passed` / `failed` / `inapplicable` rédigés indépendamment de ce projet : faire
tourner le moteur dessus mesure ce qu’une fixture écrite maison ne peut pas mesurer.

**Comment lire ce document.** Un exemple ACT affirme quelque chose sur SA PROPRE règle et rien d’autre :
chaque cas n’est donc jugé qu’avec les règles du moteur rattachées à cette règle ACT — jamais avec tout
le moteur. Seuls les constats normatifs comptent (une recommandation `advisory` ne fait jamais basculer
un critère, elle ne peut donc pas non plus faire échouer un cas). Les règles qui exigent une page rendue
ou un jugement humain sont déclarées, pas notées — le dire vaut mieux que noter zéro en silence.

## Synthèse

| | |
|---|---|
| Corpus | 1134 exemples sur 91 règles ACT |
| Source | https://act-rules.github.io/testcases.json |
| Règles notées | **44** |
| Exemples en échec détectés | **169 / 187** |
| Exemples sains laissés intacts | **401 / 401** — aucun faux positif inexpliqué |
| Cohérentes | 27 |
| Divergentes (documentées, 9 cas) | 5 |
| Partiellement cohérentes | 12 |
| **Incohérentes** | **0** |
| Lacunes déclarées (statiques, non implémentées) | 0 |

*Partiellement cohérente* est le terme du format ACT Rules lui-même pour un outil qui ne signale jamais
de faux positif mais ne détecte pas tout — c’est un constat de couverture, pas une erreur. *Divergente*
signifie que chaque écart sur cette règle est listé plus bas avec l’argument qui le justifie.

## Règles notées

| Règle ACT | WCAG | Règles du moteur | Verdict | Détectés |
|---|---|---|---|---|
| [Document has heading for non-repeated content](https://act-rules.github.io/rules/047fe0) | — | `bypass-blocks-missing` | 🟨 partiellement cohérente | 3/4 |
| [Image has non-empty accessible name](https://act-rules.github.io/rules/23a2a8) | 1.1.1 | `img-alt-missing`, `img-alt-missing-decorative` | ✅ cohérente | 5/5 |
| [Letter spacing in style attributes is not !important](https://act-rules.github.io/rules/24afc2) | 1.4.12 | `letter-spacing-important` | 🟨 partiellement cohérente | 3/4 |
| [HTML page has non-empty title](https://act-rules.github.io/rules/2779a5) | 2.4.2 | `title-missing-empty` | ✅ cohérente | 5/5 |
| [Visible label is part of accessible name](https://act-rules.github.io/rules/2ee8b8) | 2.5.3 | `label-in-name-mismatch`, `link-label-in-name-mismatch` | 🟦 divergente (documentée) | 3/3 |
| [Element with presentational children has no focusable content](https://act-rules.github.io/rules/307n5z) | 4.1.2 | `presentational-children-focusable` | ✅ cohérente | 3/3 |
| [Id attribute value is unique](https://act-rules.github.io/rules/3ea0c8) | 4.1.1 | `duplicate-id` | ✅ cohérente | 3/3 |
| [Element marked as decorative is not exposed](https://act-rules.github.io/rules/46ca7f) | — | `decorative-marked-exposed` | ✅ cohérente | 3/3 |
| [Audio or video element that plays automatically has a control mechanism](https://act-rules.github.io/rules/4c31df) | — | `autoplay-media` | 🟦 divergente (documentée) | 5/5 |
| [Element with role attribute has required states and properties](https://act-rules.github.io/rules/4e8ab6) | 4.1.2 | `aria-required-attr` | ✅ cohérente | 2/2 |
| [Image button has non-empty accessible name](https://act-rules.github.io/rules/59796f) | 1.1.1, 4.1.2 | `input-image-alt-missing` | ✅ cohérente | 3/3 |
| [HTML page lang and xml:lang attributes have matching values](https://act-rules.github.io/rules/5b7ae0) | 3.1.1 | `html-lang-xml-lang-mismatch` | ✅ cohérente | 2/2 |
| [ARIA state or property is permitted](https://act-rules.github.io/rules/5c01ea) | — | `aria-prohibited-attr` | ✅ cohérente | 2/2 |
| [ARIA attribute is defined in WAI-ARIA](https://act-rules.github.io/rules/5f99a7) | — | `invalid-aria-attr` | ✅ cohérente | 2/2 |
| [Role attribute has valid value](https://act-rules.github.io/rules/674b10) | 1.3.1 | `invalid-aria-role` | ✅ cohérente | 2/2 |
| [ARIA state or property has valid value](https://act-rules.github.io/rules/6a7281) | — | `invalid-aria-value`, `live-region-conflict` | ✅ cohérente | 10/10 |
| [Element with aria-hidden has no content in sequential focus navigation](https://act-rules.github.io/rules/6cfa84) | 4.1.2 | `aria-hidden-focusable` | 🟦 divergente (documentée) | 6/6 |
| [Autocomplete attribute has valid value](https://act-rules.github.io/rules/73f2c2) | 1.3.5 | `autocomplete-token-invalid` | ✅ cohérente | 5/5 |
| [Line height in style attributes is not !important](https://act-rules.github.io/rules/78fd32) | 1.4.12 | `line-height-important` | 🟨 partiellement cohérente | 5/6 |
| [SVG element with explicit role has non-empty accessible name](https://act-rules.github.io/rules/7d6734) | 1.1.1 | `img-alt-missing` | ✅ cohérente | 4/4 |
| [Audio or video element avoids automatically playing audio](https://act-rules.github.io/rules/80f0bf) | 1.4.2 | `autoplay-media` | 🟦 divergente (documentée) | 2/2 |
| [Object element rendering non-text content has non-empty accessible name](https://act-rules.github.io/rules/8fc3b6) | 1.1.1 | `object-embed-no-name` | ✅ cohérente | 4/4 |
| [Button has non-empty accessible name](https://act-rules.github.io/rules/97a4e1) | 4.1.2 | `button-empty-name`, `icon-only-control-unnamed` | ✅ cohérente | 5/5 |
| [Word spacing in style attributes is not !important](https://act-rules.github.io/rules/9e45ec) | 1.4.12 | `word-spacing-important` | 🟨 partiellement cohérente | 3/4 |
| [Headers attribute specified on a cell refers to cells in the same table element](https://act-rules.github.io/rules/a25f45) | 1.3.1 | `headers-attr-dangling` | ✅ cohérente | 4/4 |
| [Document has a landmark with non-repeated content](https://act-rules.github.io/rules/b40fd1) | — | `bypass-blocks-missing` | 🟨 partiellement cohérente | 1/3 |
| [Meta viewport allows for zoom](https://act-rules.github.io/rules/b4f0c3) | 1.4.4 | `meta-viewport-zoom-block` | ✅ cohérente | 4/4 |
| [HTML page has lang attribute](https://act-rules.github.io/rules/b5c3f8) | 3.1.1 | `html-lang-missing` | ✅ cohérente | 4/4 |
| [ARIA required owned elements](https://act-rules.github.io/rules/bc4a75) | 1.3.1 | `aria-required-children` | ✅ cohérente | 7/7 |
| [Meta element has no refresh delay](https://act-rules.github.io/rules/bc659a) | 2.2.1, 2.2.4, 3.2.5 | `meta-refresh-redirect` | ✅ cohérente | 4/4 |
| [HTML page lang attribute has valid language tag](https://act-rules.github.io/rules/bf051a) | 3.1.1 | `lang-invalid` | 🟨 partiellement cohérente | 3/4 |
| [Meta element has no refresh delay (no exception)](https://act-rules.github.io/rules/bisz58) | 2.2.4, 3.2.5 | `meta-refresh-redirect` | 🟨 partiellement cohérente | 3/4 |
| [Link has non-empty accessible name](https://act-rules.github.io/rules/c487ae) | 2.4.4, 2.4.9, 4.1.2 | `link-empty-name`, `icon-only-control-unnamed` | ✅ cohérente | 11/11 |
| [Iframe element has non-empty accessible name](https://act-rules.github.io/rules/cae760) | 4.1.2 | `iframe-title-missing` | 🟦 divergente (documentée) | 4/4 |
| [Bypass Blocks of Repeated Content](https://act-rules.github.io/rules/cf77f2) | 2.4.1 | `bypass-blocks-missing` | 🟨 partiellement cohérente | 0/1 |
| [Table header cell has assigned cells](https://act-rules.github.io/rules/d0f69e) | 1.3.1 | `th-no-data-cells` | ✅ cohérente | 3/3 |
| [Element with lang attribute has valid language tag](https://act-rules.github.io/rules/de46e4) | 3.1.2 | `lang-invalid`, `inline-lang-change-missing` | 🟨 partiellement cohérente | 8/9 |
| [Form field has non-empty accessible name](https://act-rules.github.io/rules/e086e5) | 4.1.2 | `control-label-missing` | ✅ cohérente | 7/7 |
| [Attribute is not duplicated](https://act-rules.github.io/rules/e6952f) | 4.1.1 | `duplicate-attribute` | ✅ cohérente | 3/3 |
| [Video element auditory content has captions](https://act-rules.github.io/rules/f51b46) | — | `media-no-track` | 🟨 partiellement cohérente | 0/4 |
| [ARIA required context role](https://act-rules.github.io/rules/ff89c9) | 1.3.1 | `aria-required-parent` | 🟨 partiellement cohérente | 3/4 |
| [Heading has non-empty accessible name](https://act-rules.github.io/rules/ffd0e9) | 1.3.1 | `empty-heading` | ✅ cohérente | 8/8 |
| [Menuitem has non-empty accessible name](https://act-rules.github.io/rules/m6b1q3) | 4.1.2 | `menuitem-empty-name` | ✅ cohérente | 2/2 |
| [Document has an instrument to move focus to non-repeated content](https://act-rules.github.io/rules/ye5d6e) | — | `bypass-blocks-missing` | 🟨 partiellement cohérente | 0/3 |

### Notes et divergences documentées

- **Document has heading for non-repeated content** — tranché seulement quand un <nav> marque le bloc répété et qu’aucun titre, aucune région ni aucun lien d’évitement n’existe hors de lui (h1-missing est consultative, elle ne compte donc pas) ; un titre hors écran exige la page rendue
- **Letter spacing in style attributes is not !important** — valeurs auteur `!important` certainement sous le seuil ; les cas en unités calculées restent du ressort du rendu
- **Visible label is part of accessible name** · signale sur *Passed Example 6* : une POLICE d’icônes affiche le texte « search » sous forme de glyphe : l’étiquette visible n’est donc pas le texte du DOM — un fait que seule la page rendue porte
- **Audio or video element that plays automatically has a control mechanism** · signale sur *Inapplicable Example 2* : le source ne peut pas savoir que le média référencé n’a pas de piste audio
- **Audio or video element that plays automatically has a control mechanism** · signale sur *Passed Example 3* : le mécanisme de pause est un bouton personnalisé câblé en JavaScript, pas un attribut natif `controls`
- **ARIA state or property is permitted** — couvre les rôles qui interdisent un nom et un ensemble fermé de propriétés propres à un rôle (aria-sort, aria-orientation, aria-value*, aria-pressed, aria-modal…) sur des rôles que le source rend certains ; la matrice complète des attributs autorisés n’est pas encodée
- **Element with aria-hidden has no content in sequential focus navigation** · signale sur *Passed Example 4* : un lien sentinelle de focus dans un conteneur aria-hidden : il EST atteignable au Tab, et seul un gestionnaire de focus à l’exécution le renvoie — le même choix qu’axe-core
- **Line height in style attributes is not !important** — valeurs auteur `!important` certainement sous le seuil (em, sans unité, ou pourcentage de la taille de police propre) ; une valeur en `px` face à une taille de police de feuille de style exige la cascade et reste du ressort du rendu
- **SVG element with explicit role has non-empty accessible name** — role=img sur un <svg> est traité par la même règle
- **Audio or video element avoids automatically playing audio** · signale sur *Inapplicable Example 2* : le source ne peut pas savoir que le fichier média référencé est muet
- **Audio or video element avoids automatically playing audio** · signale sur *Passed Example 3* : le mécanisme de pause est un bouton personnalisé câblé en JavaScript, pas un attribut natif `controls`
- **Audio or video element avoids automatically playing audio** · signale sur *Passed Example 2* : un fragment média #t= qui ramène la lecture sous 3 s ne se résout pas depuis le source
- **Word spacing in style attributes is not !important** — valeurs auteur `!important` certainement sous le seuil ; les cas en unités calculées restent du ressort du rendu
- **Document has a landmark with non-repeated content** — tranché seulement quand un <nav> marque le bloc répété et qu’aucune région, aucun titre ni aucun lien d’évitement n’existe ; sinon, savoir quel bloc se répète relève d’un jugement inter-pages. `missing-main-landmark` n’est PAS rattachée : elle exige un <main>, exigence plus stricte que « une région quelconque » chez ACT
- **HTML page lang attribute has valid language tag** — au-delà de la syntaxe, la sous-étiquette principale est vérifiée contre le registre fermé des codes à deux lettres et les graphies ISO 639-2 des langues qui en ont une (`eng`, `fre`) ; les étiquettes héritées dépréciées `i-*` (`i-lux`) sont acceptées en connaissance de cause
- **Meta element has no refresh delay (no exception)** — cette variante supprime l’exception des plus de 20 h que le moteur respecte : les longs délais ne sont donc pas signalés, en connaissance de cause
- **Iframe element has non-empty accessible name** · signale sur *Inapplicable Example 3* : une iframe en tabindex=-1 reste exposée aux technologies d’assistance et doit toujours avoir un titre (le RGAA 2.1 l’exige sans condition)
- **Bypass Blocks of Repeated Content** — tranché seulement quand un <nav> marque le bloc répété ; la page en échec du corpus n’en a pas, l’identification de son bloc répété est donc laissée à l’agent
- **Table header cell has assigned cells** — tranché pour un tableau entièrement câblé par `headers` et pour une grille simple (sans fusion de lignes ou de colonnes, avec les lignes d’en-tête en tête, rien de généré par gabarit) ; les autres formes exigent un modèle de tableau complet
- **Element with lang attribute has valid language tag** — même vérification de registre que pour la langue de la page ; les étiquettes héritées dépréciées `i-*` sont acceptées en connaissance de cause
- **Element with lang attribute has valid language tag** · signale sur *Inapplicable Example 2* : lang="" sur un élément qui porte du texte ne déclare aucune langue pour ce texte ; ACT juge la règle non applicable, ce moteur le signale sous 3.1.2
- **Form field has non-empty accessible name** — `placeholder-as-label` n’est volontairement PAS rattachée : un placeholder contribue bien au nom accessible, donc ACT valide le cas — ultra11y le signale quand même, en règle maison plus stricte sous 3.3.2.
- **Video element auditory content has captions** — `media-no-track` est consultative par conception — les sous-titres peuvent être incrustés dans le fichier média et sa piste audio peut être muette, deux faits invisibles dans le source — elle ne compte donc jamais comme une détection ici ; l’existence et l’exactitude des sous-titres sont tranchées par l’agent face au média
- **ARIA required context role** — la parenté assemblée par script (une racine fantôme construite à l’exécution) n’est pas dans le source
- **Document has an instrument to move focus to non-repeated content** — tranché seulement quand la page n’a aucun lien interne ; savoir si un lien d’évitement existant mène au contenu non répété, ou ce qui se répète sans <nav> pour le marquer, relève du jugement

## Hors de portée du moteur statique — aiguillées, pas ignorées

| Règle ACT | WCAG | Tranchée par |
|---|---|---|
| [Text has enhanced contrast](https://act-rules.github.io/rules/09o5cg) | 1.4.6 | rendu (`scan`) — contraste renforcé AAA — hors du socle AA |
| [Scrollable element is keyboard accessible](https://act-rules.github.io/rules/0ssw9k) | 2.1.1, 2.1.3 | rendu (`scan`) |
| [HTML graphics contain no text](https://act-rules.github.io/rules/0va7u6) | 1.4.5, 1.4.9 | rendu (`scan`) — texte incrusté dans une image |
| [Audio and visuals of video element have transcript](https://act-rules.github.io/rules/1a02b0) | 1.2.8 | jugement (agent) |
| [Video element visual content has audio description](https://act-rules.github.io/rules/1ea59c) | — | jugement (agent) |
| [Video element visual content has strict accessible alternative](https://act-rules.github.io/rules/1ec09b) | 1.2.5 | jugement (agent) |
| [Audio element content has transcript](https://act-rules.github.io/rules/2eb176) | — | jugement (agent) |
| [Error message describes invalid form field value](https://act-rules.github.io/rules/36b590) | 3.3.1 | jugement (agent) |
| [Block of repeated content is collapsible](https://act-rules.github.io/rules/3e12e1) | — | rendu (`scan`) |
| [Iframe elements with identical accessible names have equivalent purpose](https://act-rules.github.io/rules/4b1c6c) | 4.1.2 | jugement (agent) |
| [Zoomed text node is not clipped with CSS overflow](https://act-rules.github.io/rules/59br37) | 1.4.4 | rendu (`scan`) — rognage sous zoom — sondé par scan --runtime local |
| [Link in context is descriptive](https://act-rules.github.io/rules/5effbb) | 2.4.4, 2.4.9 | jugement (agent) — fonction du lien en contexte (2.4.4) |
| [Device motion based changes to the content can also be created from the user interface](https://act-rules.github.io/rules/7677a9) | 2.5.4 | jugement (agent) |
| [Focusable element has no keyboard trap](https://act-rules.github.io/rules/80af7b) | 2.1.2 | rendu (`scan`) |
| [Content has alternative for visual reference](https://act-rules.github.io/rules/9bd38c) | 1.3.3 | jugement (agent) — caractéristiques sensorielles (1.3.3) |
| [DEPRECATED — Image filename is accessible name for image](https://act-rules.github.io/rules/9eb3f6) | 1.1.1 | retirée en amont |
| [Focusable element has no keyboard trap via standard navigation](https://act-rules.github.io/rules/a1b64e) | — | rendu (`scan`) |
| [Audio or video element that plays automatically has no audio that lasts more than 3 seconds](https://act-rules.github.io/rules/aaa1bf) | — | rendu (`scan`) — exige la durée du média |
| [Video element content is media alternative for text](https://act-rules.github.io/rules/ab4d13) | — | jugement (agent) |
| [DEPRECATED — Video element visual-only content has description track](https://act-rules.github.io/rules/ac7dc6) | — | retirée en amont |
| [Audio element content is media alternative for text](https://act-rules.github.io/rules/afb423) | — | jugement (agent) |
| [Text has minimum contrast](https://act-rules.github.io/rules/afw4f7) | 1.4.3, 1.4.6 | rendu (`scan`) — contraste calculé ; seules les paires de couleurs littérales en ligne sont tranchées statiquement (contrast-literal) |
| [Link is descriptive](https://act-rules.github.io/rules/aizyf1) | 2.4.9 | jugement (agent) |
| [Iframe with negative tabindex has no interactive elements](https://act-rules.github.io/rules/akn7bn) | 2.1.1 | rendu (`scan`) — exige le document propre de l’iframe |
| [Links with identical accessible names have equivalent purpose](https://act-rules.github.io/rules/b20e66) | 2.4.9 | jugement (agent) |
| [Orientation of the page is not restricted using CSS transform property](https://act-rules.github.io/rules/b33eff) | 1.3.4 | rendu (`scan`) — verrouillage de l’orientation par transformation CSS |
| [Heading is descriptive](https://act-rules.github.io/rules/b49b2e) | 2.4.6 | jugement (agent) — le titre est-il descriptif (2.4.6) |
| [Device motion based changes to the content can be disabled](https://act-rules.github.io/rules/c249d5) | 2.5.4 | jugement (agent) |
| [Video element visual-only content has accessible alternative](https://act-rules.github.io/rules/c3232f) | 1.2.1 | jugement (agent) |
| [HTML page title is descriptive](https://act-rules.github.io/rules/c4a8a4) | 2.4.2 | jugement (agent) |
| [Video element visual content has accessible alternative](https://act-rules.github.io/rules/c5a4ea) | 1.2.3, 1.2.5, 1.2.8 | jugement (agent) |
| [Form field label is descriptive](https://act-rules.github.io/rules/cc0f0a) | 2.4.6 | jugement (agent) |
| [Video element visual-only content has audio track alternative](https://act-rules.github.io/rules/d7ba54) | — | jugement (agent) |
| [Audio element content has text alternative](https://act-rules.github.io/rules/e7aa44) | 1.2.1 | jugement (agent) |
| [Image not in the accessibility tree is decorative](https://act-rules.github.io/rules/e88epe) | 1.1.1 | jugement (agent) — l’image est-elle réellement décorative |
| [Video element auditory content has accessible alternative](https://act-rules.github.io/rules/eac66b) | 1.2.2 | jugement (agent) |
| [Focusable element has no keyboard trap via non-standard navigation](https://act-rules.github.io/rules/ebe86a) | — | rendu (`scan`) |
| [Video element visual-only content has transcript](https://act-rules.github.io/rules/ee13b5) | — | jugement (agent) |
| [Text content that changes automatically can be paused, stopped or hidden](https://act-rules.github.io/rules/efbfc7) | 2.2.2 | rendu (`scan`) |
| [DEPRECATED — Video element visual content has description track](https://act-rules.github.io/rules/f196ce) | — | retirée en amont |
| [Video element visual-only content is media alternative for text](https://act-rules.github.io/rules/fd26cf) | — | jugement (agent) |
| [Links with identical accessible names and same context serve equivalent purpose](https://act-rules.github.io/rules/fd3a94) | 2.4.4, 2.4.9 | jugement (agent) |
| [No keyboard shortcut uses only printable characters](https://act-rules.github.io/rules/ffbc54) | 2.1.4 | jugement (agent) — les raccourcis à un seul caractère de 2.1.4 sont enregistrés et désactivés par script (un gestionnaire keydown, un réglage) ; savoir s’il en existe un et s’il peut être désactivé ou remappé se lit dans le comportement, pas dans le balisage |
| [HTML element language subtag matches language](https://act-rules.github.io/rules/off6ek) | 3.1.2 | jugement (agent) — la sous-étiquette correspond-elle à la langue réelle du texte |
| [Element in sequential focus order has visible focus](https://act-rules.github.io/rules/oj04fd) | 2.4.7 | rendu (`scan`) — focus visible (2.4.7) — sondé par scan --runtime local |
| [Image accessible name is descriptive](https://act-rules.github.io/rules/qt1vmo) | 1.1.1 | jugement (agent) — l’alternative est-elle pertinente (1.1.1) |
| [HTML page language subtag matches default language](https://act-rules.github.io/rules/ucwvc8) | 3.1.1 | jugement (agent) |

Le corpus est embarqué dans `scripts/vendor/act-testcases.json` (rafraîchi par
`pnpm run build:act:refresh`, et chaque jour par le workflow act-refresh) pour que la suite reste
hors ligne et déterministe.
Les cas de test de l’ACT-Rules Community Group sont © leurs contributeurs, sous la W3C Software and
Document License — voir `NOTICE`.

<!-- GÉNÉRÉ depuis src/data/wcag.json par `ultra11y criteria --generate` — ne pas modifier à la main. -->

# WCAG 2.2 niveau AA — référence des critères de succès

Les 55 critères de succès de niveau A + AA, répartis sur les 4 principes et les 13 règles, avec
pour chacun son niveau, la classe d’automatisabilité ultra11y (`static` : automatisable par le
moteur / `needs-rendering` : nécessite un rendu / `judgment` : jugement de l’agent), les règles
du moteur qui le couvrent et — une colonne par référentiel enregistré — les critères du
référentiel qui y renvoient. Identifiants et niveaux viennent de la source W3C
(https://github.com/w3c/wcag) ; les intitulés, de sa traduction française autorisée. WCAG 2.2 © W3C.

## 1.1 Équivalents textuels

| Critère | Intitulé | Niveau | Automatisabilité | Règles | RGAA |
|---|---|---|---|---|---|
| 1.1.1 | Contenu non textuel | A | judgment | img-alt-missing, img-alt-missing-decorative, canvas-fallback-missing, decorative-alt-misuse, decorative-marked-exposed, input-image-alt-missing, object-embed-no-name, chart-no-accessible-name, figure-caption-unassociated, pdf-no-text | 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.9, 4.7, 4.8, 4.9, 6.1, 6.2, 7.2, 10.2, 13.3, 13.4, 13.5, 13.6 |

## 1.2 Média temporel

| Critère | Intitulé | Niveau | Automatisabilité | Règles | RGAA |
|---|---|---|---|---|---|
| 1.2.1 | Contenus seulement audio et seulement vidéo (pré-enregistrés) | A | judgment | — | 4.1, 4.2 |
| 1.2.2 | Sous-titres (pré-enregistrés) | A | judgment | media-no-track | 4.3, 4.4 |
| 1.2.3 | Audio-description ou version de remplacement pour un média temporel (pré-enregistré) | A | judgment | — | 4.1, 4.2 |
| 1.2.4 | Sous-titres (en direct) | AA | judgment | — | — |
| 1.2.5 | Audio-description (pré-enregistrée) | AA | judgment | — | 4.5, 4.6 |

## 1.3 Adaptable

| Critère | Intitulé | Niveau | Automatisabilité | Règles | RGAA |
|---|---|---|---|---|---|
| 1.3.1 | Information et relations | A | judgment | fieldset-legend-missing, data-table-no-headers, table-caption-missing, layout-table-data-markup, heading-order-skip, h1-missing, h1-multiple, list-structure, dl-structure, empty-heading, label-for-dangling, missing-main-landmark, multiple-main-landmark, sortable-header-no-aria-sort, nav-landmark-missing, nav-landmark-unnamed, aria-required-parent, headers-attr-dangling, th-no-data-cells, table-scope-invalid, radio-checkbox-group-ungrouped, table-empty-data-cell, css-generated-content-informative, presentational-element, presentational-attribute, presentational-spacing, pdf-untagged, pdf-structure-shallow | 3.1, 5.1, 5.2, 5.4, 5.5, 5.6, 5.7, 5.8, 7.3, 8.9, 9.1, 9.2, 9.3, 9.4, 10.1, 10.2, 11.1, 11.5, 11.6, 11.7, 11.8, 12.6, 13.3, 13.4 |
| 1.3.2 | Ordre séquentiel logique | A | judgment | — | 5.3, 8.10, 10.1, 10.3, 10.8, 13.3, 13.4 |
| 1.3.3 | Caractéristiques sensorielles | A | judgment | — | 10.9, 10.10 |
| 1.3.4 | Orientation | AA | needs-rendering | rendered-orientation-lock | 13.9 |
| 1.3.5 | Identifier la finalité de la saisie | AA | judgment | field-purpose-incomplete, autocomplete-token-invalid | 11.13 |

## 1.4 Distinguable

| Critère | Intitulé | Niveau | Automatisabilité | Règles | RGAA |
|---|---|---|---|---|---|
| 1.4.1 | Utilisation de la couleur | A | needs-rendering | rendered-link-colour-only | 3.1, 10.6, 10.7, 10.9, 10.10 |
| 1.4.2 | Contrôle du son | A | static | autoplay-media | 4.10 |
| 1.4.3 | Contraste (minimum) | AA | needs-rendering | contrast-literal, rendered-contrast, rendered-contrast-pixel | 3.2, 10.5 |
| 1.4.4 | Redimensionnement du texte | AA | needs-rendering | meta-viewport-zoom-block | 10.4 |
| 1.4.5 | Texte sous forme d’image | AA | needs-rendering | — | 1.8 |
| 1.4.10 | Redistribution | AA | needs-rendering | — | 10.11 |
| 1.4.11 | Contraste du contenu non textuel | AA | needs-rendering | rendered-nontext-contrast | 3.3 |
| 1.4.12 | Espacement du texte | AA | needs-rendering | letter-spacing-important, word-spacing-important, line-height-important | 10.12 |
| 1.4.13 | Contenu au survol ou au focus | AA | needs-rendering | — | 10.13 |

## 2.1 Accessibilité au clavier

| Critère | Intitulé | Niveau | Automatisabilité | Règles | RGAA |
|---|---|---|---|---|---|
| 2.1.1 | Clavier | A | judgment | clickable-noninteractive | 4.11, 4.12, 7.3, 10.14, 12.9, 12.11 |
| 2.1.2 | Pas de piège au clavier | A | needs-rendering | — | 4.11, 4.12, 12.9 |
| 2.1.4 | Raccourcis clavier utilisant des caractères | A | judgment | — | 12.10 |

## 2.2 Délai suffisant

| Critère | Intitulé | Niveau | Automatisabilité | Règles | RGAA |
|---|---|---|---|---|---|
| 2.2.1 | Réglage du délai | A | judgment | meta-refresh-redirect | 13.1, 13.8 |
| 2.2.2 | Mettre en pause, arrêter, masquer | A | judgment | autoplay-media, blink-marquee | 13.1, 13.8 |

## 2.3 Crises et réactions physiques

| Critère | Intitulé | Niveau | Automatisabilité | Règles | RGAA |
|---|---|---|---|---|---|
| 2.3.1 | Pas plus de trois flashs ou sous le seuil critique | A | needs-rendering | — | 13.7 |

## 2.4 Navigable

| Critère | Intitulé | Niveau | Automatisabilité | Règles | RGAA |
|---|---|---|---|---|---|
| 2.4.1 | Contourner des blocs | A | judgment | skip-link-target-missing, bypass-blocks-missing | 9.1, 12.6, 12.7, 13.3, 13.4 |
| 2.4.2 | Titre de page | A | static | title-missing-empty, pdf-title-missing | 8.5, 8.6 |
| 2.4.3 | Parcours du focus | A | judgment | positive-tabindex | 10.3, 12.7, 12.8, 13.3, 13.4 |
| 2.4.4 | Fonction du lien (selon le contexte) | A | judgment | link-empty-name, icon-only-control-unnamed | 6.1, 6.2 |
| 2.4.5 | Accès multiples | AA | judgment | — | 12.1, 12.3, 12.4 |
| 2.4.6 | En-têtes et étiquettes | AA | judgment | — | 9.1, 11.1, 11.2 |
| 2.4.7 | Visibilité du focus | AA | needs-rendering | rendered-focus-not-visible | 7.3, 10.7 |
| 2.4.11 | Focus non masqué (minimum) | AA | needs-rendering | — | — |

## 2.5 Modalités d’entrée

| Critère | Intitulé | Niveau | Automatisabilité | Règles | RGAA |
|---|---|---|---|---|---|
| 2.5.1 | Gestes pour le contrôle du pointeur | A | judgment | — | 13.10 |
| 2.5.2 | Annulation de l’action du pointeur | A | judgment | — | 13.11 |
| 2.5.3 | Étiquette dans le nom | A | judgment | label-in-name-mismatch, form-label-in-name-mismatch, link-label-in-name-mismatch, field-label-in-name-mismatch | 6.1, 7.1, 11.2, 11.9 |
| 2.5.4 | Activation par le mouvement | A | judgment | — | 13.12 |
| 2.5.7 | Mouvements de glissement | AA | judgment | — | — |
| 2.5.8 | Taille de la cible (minimum) | AA | needs-rendering | — | — |

## 3.1 Lisible

| Critère | Intitulé | Niveau | Automatisabilité | Règles | RGAA |
|---|---|---|---|---|---|
| 3.1.1 | Langue de la page | A | static | html-lang-missing, document-language-missing, html-lang-xml-lang-mismatch, lang-invalid, pdf-lang-missing | 8.3, 8.4, 13.3, 13.4 |
| 3.1.2 | Langue d’un passage | AA | judgment | inline-lang-change-missing, lang-invalid | 8.7, 8.8 |

## 3.2 Prévisible

| Critère | Intitulé | Niveau | Automatisabilité | Règles | RGAA |
|---|---|---|---|---|---|
| 3.2.1 | Au focus | A | judgment | — | 7.4, 13.2 |
| 3.2.2 | À la saisie | A | judgment | on-input-context-change | 7.4 |
| 3.2.3 | Navigation cohérente | AA | judgment | — | 12.2, 12.4, 12.5, 12.7 |
| 3.2.4 | Identification cohérente | AA | judgment | — | 11.3 |
| 3.2.6 | Aide cohérente | A | judgment | — | — |

## 3.3 Assistance à la saisie

| Critère | Intitulé | Niveau | Automatisabilité | Règles | RGAA |
|---|---|---|---|---|---|
| 3.3.1 | Identification des erreurs | A | judgment | aria-invalid-no-description, error-not-associated | 11.10 |
| 3.3.2 | Étiquettes ou instructions | A | judgment | radio-checkbox-group-ungrouped, date-fields-ungrouped | 11.1, 11.2, 11.4, 11.5, 11.6, 11.7, 11.10 |
| 3.3.3 | Suggestion après une erreur | AA | judgment | — | 11.11 |
| 3.3.4 | Prévention des erreurs (juridiques, financières, de données) | AA | judgment | — | 11.12 |
| 3.3.7 | Saisie redondante | A | judgment | — | — |
| 3.3.8 | Authentification accessible (minimum) | AA | judgment | credential-entry-blocked | — |

## 4.1 Compatible

| Critère | Intitulé | Niveau | Automatisabilité | Règles | RGAA |
|---|---|---|---|---|---|
| 4.1.2 | Nom, rôle et valeur | A | judgment | iframe-title-missing, invalid-aria-role, aria-ref-missing-id, redundant-aria, clickable-noninteractive, aria-required-children, aria-hidden-focusable, nested-interactive, invalid-aria-attr, invalid-aria-value, aria-required-attr, aria-prohibited-attr, duplicate-id, duplicate-attribute, control-label-missing, placeholder-as-label, form-field-multiple-labels, select-has-option, button-empty-name, form-button-empty-name, icon-only-control-unnamed, control-name-title-only, field-purpose-incomplete, disabled-context-content, presentational-children-focusable, decorative-marked-exposed, menuitem-empty-name | 1.2, 1.3, 1.9, 2.1, 2.2, 4.13, 5.3, 7.1, 7.2, 8.2, 9.1, 10.8, 11.1, 11.9, 12.6, 13.3, 13.4 |
| 4.1.3 | Messages d’état | AA | judgment | live-region-conflict, status-message-not-assertive | 7.5 |

<!-- GÉNÉRÉ par `pnpm run build:pack:rgaa` depuis les données RGAA 4.1.2 embarquées et les contrats de règles relus — ne pas modifier à la main. -->

# Matrice d’automatisation du RGAA 4.1.2

Chacun des 258 tests officiels est classé. `static` et `rendered` signifient qu’une règle décisive explicitement rattachée peut prouver un échec ; `judgment` reste à l’arbitrage. Un signal candidat n’est qu’un indice et ne change jamais le verdict à lui seul. La conformité par silence n’est admise que là où elle est explicitement indiquée.

## Synthèse par critère

Les 106 lignes de critères ci-dessous sont la revue de l’aiguillage, critère par critère. « IA + signaux » signifie que des indices déterministes sont transmis sans changer le verdict ; « NC déterministe + résidu IA » signifie qu’un échec précis peut être tranché mécaniquement tandis que toute condition restante part encore à l’arbitrage.

| Critère | Tests (`static` / `rendered` / `judgment`) | Règles (décisives / candidates / consultatives) | C par silence | Aiguillage revu |
|---|---:|---:|:---:|---|
| 1.1 | 2 / 1 / 5 | 4 / 7 / 0 | non | NC déterministe + résidu IA |
| 1.2 | 1 / 0 / 5 | 1 / 3 / 0 | non | NC déterministe + résidu IA |
| 1.3 | 0 / 0 / 9 | 0 / 0 / 0 | non | IA |
| 1.4 | 0 / 0 / 7 | 0 / 0 / 0 | non | IA |
| 1.5 | 0 / 0 / 2 | 0 / 0 / 0 | non | IA |
| 1.6 | 0 / 0 / 10 | 0 / 0 / 0 | non | IA |
| 1.7 | 0 / 0 / 6 | 0 / 0 / 0 | non | IA |
| 1.8 | 0 / 0 / 6 | 0 / 0 / 0 | non | IA |
| 1.9 | 1 / 0 / 4 | 1 / 0 / 0 | non | NC déterministe + résidu IA |
| 2.1 | 1 / 0 / 0 | 2 / 1 / 0 | non | NC déterministe + résidu IA |
| 2.2 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 3.1 | 0 / 0 / 6 | 0 / 0 / 0 | non | IA |
| 3.2 | 0 / 0 / 5 | 0 / 5 / 0 | non | IA + signaux |
| 3.3 | 0 / 0 / 4 | 0 / 1 / 0 | non | IA + signaux |
| 4.1 | 0 / 0 / 3 | 0 / 0 / 0 | non | IA |
| 4.2 | 0 / 0 / 3 | 0 / 0 / 0 | non | IA |
| 4.3 | 0 / 0 / 2 | 0 / 3 / 0 | non | IA + signaux |
| 4.4 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 4.5 | 0 / 0 / 2 | 0 / 0 / 0 | non | IA |
| 4.6 | 0 / 0 / 2 | 0 / 0 / 0 | non | IA |
| 4.7 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 4.8 | 0 / 0 / 2 | 0 / 0 / 0 | non | IA |
| 4.9 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 4.10 | 0 / 0 / 1 | 0 / 2 / 0 | non | IA + signaux |
| 4.11 | 0 / 0 / 3 | 0 / 0 / 0 | non | IA |
| 4.12 | 0 / 0 / 2 | 0 / 0 / 0 | non | IA |
| 4.13 | 0 / 0 / 2 | 0 / 0 / 0 | non | IA |
| 5.1 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 5.2 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 5.3 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 5.4 | 0 / 0 / 1 | 0 / 1 / 0 | non | IA + signaux |
| 5.5 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 5.6 | 0 / 0 / 4 | 0 / 4 / 0 | non | IA + signaux |
| 5.7 | 3 / 0 / 2 | 2 / 3 / 0 | non | NC déterministe + résidu IA |
| 5.8 | 1 / 0 / 0 | 1 / 1 / 0 | non | NC déterministe + résidu IA |
| 6.1 | 1 / 0 / 4 | 1 / 0 / 1 | non | NC déterministe + résidu IA |
| 6.2 | 1 / 0 / 0 | 3 / 0 / 0 | non | NC déterministe + résidu IA |
| 7.1 | 2 / 0 / 1 | 5 / 29 / 0 | non | NC déterministe + résidu IA |
| 7.2 | 0 / 0 / 2 | 0 / 0 / 0 | non | IA |
| 7.3 | 0 / 0 / 2 | 0 / 2 / 0 | non | IA + signaux |
| 7.4 | 0 / 0 / 1 | 0 / 1 / 0 | non | IA + signaux |
| 7.5 | 0 / 0 / 3 | 0 / 3 / 0 | non | IA + signaux |
| 8.1 | 0 / 1 / 2 | 1 / 0 / 0 | non | NC déterministe + résidu IA |
| 8.2 | 1 / 0 / 0 | 7 / 0 / 0 | non | NC déterministe + résidu IA |
| 8.3 | 1 / 0 / 0 | 1 / 2 / 0 | oui | déterministe |
| 8.4 | 1 / 0 / 0 | 3 / 1 / 0 | non | NC déterministe + résidu IA |
| 8.5 | 1 / 0 / 0 | 2 / 0 / 0 | oui | déterministe |
| 8.6 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 8.7 | 0 / 0 / 1 | 0 / 1 / 0 | non | IA + signaux |
| 8.8 | 0 / 0 / 1 | 0 / 2 / 0 | non | IA + signaux |
| 8.9 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 8.10 | 1 / 0 / 1 | 1 / 0 / 0 | non | NC déterministe + résidu IA |
| 9.1 | 0 / 0 / 3 | 0 / 7 / 0 | non | IA + signaux |
| 9.2 | 0 / 0 / 1 | 0 / 3 / 0 | non | IA + signaux |
| 9.3 | 3 / 0 / 0 | 5 / 1 / 0 | non | NC déterministe + résidu IA |
| 9.4 | 0 / 0 / 2 | 0 / 0 / 0 | non | IA |
| 10.1 | 3 / 0 / 0 | 3 / 0 / 0 | non | NC déterministe + résidu IA |
| 10.2 | 0 / 0 / 1 | 0 / 1 / 0 | non | IA + signaux |
| 10.3 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 10.4 | 0 / 0 / 2 | 0 / 5 / 0 | non | IA + signaux |
| 10.5 | 0 / 0 / 3 | 0 / 0 / 0 | non | IA |
| 10.6 | 0 / 0 / 1 | 0 / 2 / 0 | non | IA + signaux |
| 10.7 | 0 / 1 / 0 | 1 / 1 / 0 | non | NC déterministe + résidu IA |
| 10.8 | 0 / 0 / 1 | 0 / 1 / 0 | non | IA + signaux |
| 10.9 | 0 / 0 / 4 | 0 / 0 / 0 | non | IA |
| 10.10 | 0 / 0 / 4 | 0 / 0 / 0 | non | IA |
| 10.11 | 0 / 0 / 2 | 0 / 2 / 0 | non | IA + signaux |
| 10.12 | 1 / 0 / 0 | 3 / 2 / 0 | non | NC déterministe + résidu IA |
| 10.13 | 0 / 0 / 3 | 0 / 1 / 0 | non | IA + signaux |
| 10.14 | 0 / 0 / 2 | 0 / 0 / 0 | non | IA |
| 11.1 | 1 / 0 / 2 | 5 / 8 / 0 | non | NC déterministe + résidu IA |
| 11.2 | 1 / 0 / 5 | 1 / 0 / 0 | non | NC déterministe + résidu IA |
| 11.3 | 0 / 0 / 2 | 0 / 0 / 0 | non | IA |
| 11.4 | 0 / 0 / 3 | 0 / 0 / 0 | non | IA |
| 11.5 | 1 / 0 / 0 | 1 / 1 / 0 | non | NC déterministe + résidu IA |
| 11.6 | 1 / 0 / 0 | 1 / 0 / 0 | non | NC déterministe + résidu IA |
| 11.7 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 11.8 | 1 / 0 / 2 | 1 / 0 / 0 | non | NC déterministe + résidu IA |
| 11.9 | 2 / 0 / 0 | 2 / 2 / 0 | non | NC déterministe + résidu IA |
| 11.10 | 0 / 0 / 7 | 0 / 3 / 0 | non | IA + signaux |
| 11.11 | 0 / 0 / 2 | 0 / 0 / 0 | non | IA |
| 11.12 | 0 / 0 / 2 | 0 / 0 / 0 | non | IA |
| 11.13 | 0 / 0 / 1 | 0 / 3 / 0 | non | IA + signaux |
| 12.1 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 12.2 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 12.3 | 0 / 0 / 3 | 0 / 0 / 0 | non | IA |
| 12.4 | 0 / 0 / 3 | 0 / 0 / 0 | non | IA |
| 12.5 | 0 / 0 / 3 | 0 / 0 / 0 | non | IA |
| 12.6 | 0 / 0 / 1 | 0 / 6 / 0 | non | IA + signaux |
| 12.7 | 0 / 0 / 2 | 0 / 4 / 0 | non | IA + signaux |
| 12.8 | 0 / 0 / 2 | 0 / 3 / 0 | non | IA + signaux |
| 12.9 | 0 / 0 / 1 | 0 / 1 / 0 | non | IA + signaux |
| 12.10 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 12.11 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 13.1 | 0 / 0 / 4 | 0 / 1 / 0 | non | IA + signaux |
| 13.2 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 13.3 | 0 / 0 / 1 | 0 / 5 / 0 | non | IA + signaux |
| 13.4 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 13.5 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 13.6 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 13.7 | 0 / 0 / 3 | 0 / 0 / 0 | non | IA |
| 13.8 | 0 / 0 / 2 | 0 / 3 / 0 | non | IA + signaux |
| 13.9 | 0 / 0 / 1 | 0 / 1 / 0 | non | IA + signaux |
| 13.10 | 0 / 0 / 2 | 0 / 0 / 0 | non | IA |
| 13.11 | 0 / 0 / 1 | 0 / 0 / 0 | non | IA |
| 13.12 | 0 / 0 / 3 | 0 / 0 / 0 | non | IA |

## Contrat test par test

| Test | Responsable | Règles décisives | Signaux candidats |
|---|---|---|---|
| 1.1.1 | static | `img-alt-missing` | `axe:image-alt`, `axe:role-img-alt`, `chart-no-accessible-name` |
| 1.1.2 | rendered | `axe:area-alt` | — |
| 1.1.3 | static | `axe:input-image-alt`, `input-image-alt-missing` | — |
| 1.1.4 | judgment | — | — |
| 1.1.5 | judgment | — | `axe:svg-img-alt`, `chart-no-accessible-name` |
| 1.1.6 | judgment | — | `axe:object-alt`, `object-embed-no-name` |
| 1.1.7 | judgment | — | `object-embed-no-name` |
| 1.1.8 | judgment | — | `canvas-fallback-missing`, `chart-no-accessible-name` |
| 1.2.1 | static | `img-alt-missing-decorative` | `axe:image-redundant-alt`, `decorative-alt-misuse`, `decorative-marked-exposed` |
| 1.2.2 | judgment | — | `axe:image-redundant-alt`, `decorative-alt-misuse`, `decorative-marked-exposed` |
| 1.2.3 | judgment | — | `axe:image-redundant-alt`, `decorative-alt-misuse`, `decorative-marked-exposed` |
| 1.2.4 | judgment | — | `axe:image-redundant-alt`, `decorative-alt-misuse`, `decorative-marked-exposed` |
| 1.2.5 | judgment | — | `axe:image-redundant-alt`, `decorative-alt-misuse`, `decorative-marked-exposed` |
| 1.2.6 | judgment | — | `axe:image-redundant-alt`, `decorative-alt-misuse`, `decorative-marked-exposed` |
| 1.3.1 | judgment | — | — |
| 1.3.2 | judgment | — | — |
| 1.3.3 | judgment | — | — |
| 1.3.4 | judgment | — | — |
| 1.3.5 | judgment | — | — |
| 1.3.6 | judgment | — | — |
| 1.3.7 | judgment | — | — |
| 1.3.8 | judgment | — | — |
| 1.3.9 | judgment | — | — |
| 1.4.1 | judgment | — | — |
| 1.4.2 | judgment | — | — |
| 1.4.3 | judgment | — | — |
| 1.4.4 | judgment | — | — |
| 1.4.5 | judgment | — | — |
| 1.4.6 | judgment | — | — |
| 1.4.7 | judgment | — | — |
| 1.5.1 | judgment | — | — |
| 1.5.2 | judgment | — | — |
| 1.6.1 | judgment | — | — |
| 1.6.2 | judgment | — | — |
| 1.6.3 | judgment | — | — |
| 1.6.4 | judgment | — | — |
| 1.6.5 | judgment | — | — |
| 1.6.6 | judgment | — | — |
| 1.6.7 | judgment | — | — |
| 1.6.8 | judgment | — | — |
| 1.6.9 | judgment | — | — |
| 1.6.10 | judgment | — | — |
| 1.7.1 | judgment | — | — |
| 1.7.2 | judgment | — | — |
| 1.7.3 | judgment | — | — |
| 1.7.4 | judgment | — | — |
| 1.7.5 | judgment | — | — |
| 1.7.6 | judgment | — | — |
| 1.8.1 | judgment | — | — |
| 1.8.2 | judgment | — | — |
| 1.8.3 | judgment | — | — |
| 1.8.4 | judgment | — | — |
| 1.8.5 | judgment | — | — |
| 1.8.6 | judgment | — | — |
| 1.9.1 | static | `figure-caption-unassociated` | — |
| 1.9.2 | judgment | — | — |
| 1.9.3 | judgment | — | — |
| 1.9.4 | judgment | — | — |
| 1.9.5 | judgment | — | — |
| 2.1.1 | static | `axe:frame-title`, `iframe-title-missing` | `axe:frame-title-unique` |
| 2.2.1 | judgment | — | — |
| 3.1.1 | judgment | — | — |
| 3.1.2 | judgment | — | — |
| 3.1.3 | judgment | — | — |
| 3.1.4 | judgment | — | — |
| 3.1.5 | judgment | — | — |
| 3.1.6 | judgment | — | — |
| 3.2.1 | judgment | — | `axe:color-contrast`, `axe:color-contrast-enhanced`, `contrast-literal`, `rendered-contrast`, `rendered-contrast-pixel` |
| 3.2.2 | judgment | — | `axe:color-contrast`, `axe:color-contrast-enhanced`, `contrast-literal`, `rendered-contrast`, `rendered-contrast-pixel` |
| 3.2.3 | judgment | — | `axe:color-contrast`, `axe:color-contrast-enhanced`, `contrast-literal`, `rendered-contrast`, `rendered-contrast-pixel` |
| 3.2.4 | judgment | — | `axe:color-contrast`, `axe:color-contrast-enhanced`, `contrast-literal`, `rendered-contrast`, `rendered-contrast-pixel` |
| 3.2.5 | judgment | — | `axe:color-contrast`, `axe:color-contrast-enhanced`, `contrast-literal`, `rendered-contrast`, `rendered-contrast-pixel` |
| 3.3.1 | judgment | — | `rendered-nontext-contrast` |
| 3.3.2 | judgment | — | `rendered-nontext-contrast` |
| 3.3.3 | judgment | — | `rendered-nontext-contrast` |
| 3.3.4 | judgment | — | `rendered-nontext-contrast` |
| 4.1.1 | judgment | — | — |
| 4.1.2 | judgment | — | — |
| 4.1.3 | judgment | — | — |
| 4.2.1 | judgment | — | — |
| 4.2.2 | judgment | — | — |
| 4.2.3 | judgment | — | — |
| 4.3.1 | judgment | — | `axe:audio-caption`, `axe:video-caption`, `media-no-track` |
| 4.3.2 | judgment | — | — |
| 4.4.1 | judgment | — | — |
| 4.5.1 | judgment | — | — |
| 4.5.2 | judgment | — | — |
| 4.6.1 | judgment | — | — |
| 4.6.2 | judgment | — | — |
| 4.7.1 | judgment | — | — |
| 4.8.1 | judgment | — | — |
| 4.8.2 | judgment | — | — |
| 4.9.1 | judgment | — | — |
| 4.10.1 | judgment | — | `autoplay-media`, `axe:no-autoplay-audio` |
| 4.11.1 | judgment | — | — |
| 4.11.2 | judgment | — | — |
| 4.11.3 | judgment | — | — |
| 4.12.1 | judgment | — | — |
| 4.12.2 | judgment | — | — |
| 4.13.1 | judgment | — | — |
| 4.13.2 | judgment | — | — |
| 5.1.1 | judgment | — | — |
| 5.2.1 | judgment | — | — |
| 5.3.1 | judgment | — | — |
| 5.4.1 | judgment | — | `table-caption-missing` |
| 5.5.1 | judgment | — | — |
| 5.6.1 | judgment | — | `axe:td-has-header`, `axe:th-has-data-cells`, `data-table-no-headers`, `th-no-data-cells` |
| 5.6.2 | judgment | — | `axe:td-has-header`, `axe:th-has-data-cells`, `data-table-no-headers`, `th-no-data-cells` |
| 5.6.3 | judgment | — | `axe:th-has-data-cells`, `data-table-no-headers`, `th-no-data-cells` |
| 5.6.4 | judgment | — | `th-no-data-cells` |
| 5.7.1 | judgment | — | `data-table-no-headers` |
| 5.7.2 | static | `table-scope-invalid` | `axe:scope-attr-valid`, `data-table-no-headers` |
| 5.7.3 | static | `table-scope-invalid` | `axe:scope-attr-valid`, `data-table-no-headers` |
| 5.7.4 | static | `headers-attr-dangling` | `axe:td-headers-attr`, `data-table-no-headers` |
| 5.7.5 | judgment | — | `data-table-no-headers` |
| 5.8.1 | static | `layout-table-data-markup` | `axe:table-fake-caption` |
| 6.1.1 | judgment | — | — |
| 6.1.2 | judgment | — | — |
| 6.1.3 | judgment | — | — |
| 6.1.4 | judgment | — | — |
| 6.1.5 | static | `link-label-in-name-mismatch` | — |
| 6.2.1 | static | `axe:link-name`, `icon-only-control-unnamed`, `link-empty-name` | — |
| 7.1.1 | static | `axe:button-name`, `axe:input-button-name`, `button-empty-name`, `menuitem-empty-name` | `aria-hidden-focusable`, `aria-prohibited-attr`, `aria-ref-missing-id`, `aria-required-attr`, `aria-required-children`, `axe:aria-allowed-attr`, `axe:aria-allowed-role`, `axe:aria-command-name`, `axe:aria-dialog-name`, `axe:aria-hidden-focus`, `axe:aria-meter-name`, `axe:aria-progressbar-name`, `axe:aria-required-attr`, `axe:aria-required-children`, `axe:aria-required-parent`, `axe:aria-roles`, `axe:aria-tooltip-name`, `axe:aria-valid-attr`, `axe:aria-valid-attr-value`, `axe:nested-interactive`, `axe:presentation-role-conflict`, `cross-prop-drilled-name-lost`, `disabled-context-content`, `invalid-aria-attr`, `invalid-aria-role`, `invalid-aria-value`, `nested-interactive`, `presentational-children-focusable`, `redundant-aria` |
| 7.1.2 | judgment | — | `aria-hidden-focusable`, `aria-prohibited-attr`, `aria-ref-missing-id`, `aria-required-attr`, `aria-required-children`, `axe:aria-allowed-attr`, `axe:aria-allowed-role`, `axe:aria-command-name`, `axe:aria-dialog-name`, `axe:aria-hidden-focus`, `axe:aria-meter-name`, `axe:aria-progressbar-name`, `axe:aria-required-attr`, `axe:aria-required-children`, `axe:aria-required-parent`, `axe:aria-roles`, `axe:aria-tooltip-name`, `axe:aria-valid-attr`, `axe:aria-valid-attr-value`, `axe:nested-interactive`, `axe:presentation-role-conflict`, `cross-prop-drilled-name-lost`, `disabled-context-content`, `invalid-aria-attr`, `invalid-aria-role`, `invalid-aria-value`, `nested-interactive`, `presentational-children-focusable`, `redundant-aria` |
| 7.1.3 | static | `label-in-name-mismatch` | `aria-hidden-focusable`, `aria-prohibited-attr`, `aria-ref-missing-id`, `aria-required-attr`, `aria-required-children`, `axe:aria-allowed-attr`, `axe:aria-allowed-role`, `axe:aria-command-name`, `axe:aria-dialog-name`, `axe:aria-hidden-focus`, `axe:aria-meter-name`, `axe:aria-progressbar-name`, `axe:aria-required-attr`, `axe:aria-required-children`, `axe:aria-required-parent`, `axe:aria-roles`, `axe:aria-tooltip-name`, `axe:aria-valid-attr`, `axe:aria-valid-attr-value`, `axe:nested-interactive`, `axe:presentation-role-conflict`, `cross-prop-drilled-name-lost`, `disabled-context-content`, `invalid-aria-attr`, `invalid-aria-role`, `invalid-aria-value`, `nested-interactive`, `redundant-aria` |
| 7.2.1 | judgment | — | — |
| 7.2.2 | judgment | — | — |
| 7.3.1 | judgment | — | `clickable-noninteractive`, `dyn-keyboard-unreachable` |
| 7.3.2 | judgment | — | `dyn-keyboard-unreachable` |
| 7.4.1 | judgment | — | `on-input-context-change` |
| 7.5.1 | judgment | — | `dyn-live-region`, `live-region-conflict`, `status-message-not-assertive` |
| 7.5.2 | judgment | — | `dyn-live-region`, `live-region-conflict`, `status-message-not-assertive` |
| 7.5.3 | judgment | — | `dyn-live-region`, `live-region-conflict`, `status-message-not-assertive` |
| 8.1.1 | rendered | `pack:rgaa:doctype-missing` | — |
| 8.1.2 | judgment | — | — |
| 8.1.3 | judgment | — | — |
| 8.2.1 | static | `axe:duplicate-id`, `axe:duplicate-id-active`, `axe:duplicate-id-aria`, `duplicate-attribute`, `duplicate-id`, `invalid-aria-attr`, `invalid-aria-value` | — |
| 8.3.1 | static | `document-language-missing` | `axe:html-has-lang`, `html-lang-missing` |
| 8.4.1 | static | `axe:html-lang-valid`, `html-lang-xml-lang-mismatch`, `lang-invalid` | `axe:html-xml-lang-mismatch` |
| 8.5.1 | static | `axe:document-title`, `title-missing-empty` | — |
| 8.6.1 | judgment | — | — |
| 8.7.1 | judgment | — | `inline-lang-change-missing` |
| 8.8.1 | judgment | — | `axe:valid-lang`, `lang-invalid` |
| 8.9.1 | judgment | — | — |
| 8.10.1 | judgment | — | — |
| 8.10.2 | static | `pack:rgaa:dir-value-invalid` | — |
| 9.1.1 | judgment | — | `axe:heading-order`, `axe:page-has-heading-one`, `h1-missing`, `h1-multiple`, `heading-order-skip` |
| 9.1.2 | judgment | — | `axe:empty-heading`, `empty-heading` |
| 9.1.3 | judgment | — | `axe:page-has-heading-one`, `h1-missing` |
| 9.2.1 | judgment | — | `missing-main-landmark`, `multiple-main-landmark`, `nav-landmark-missing` |
| 9.3.1 | static | `axe:list`, `axe:listitem`, `list-structure` | — |
| 9.3.2 | static | `axe:list`, `axe:listitem`, `list-structure` | — |
| 9.3.3 | static | `axe:definition-list`, `axe:dlitem`, `list-structure` | `dl-structure` |
| 9.4.1 | judgment | — | — |
| 9.4.2 | judgment | — | — |
| 10.1.1 | static | `presentational-element` | — |
| 10.1.2 | static | `presentational-attribute` | — |
| 10.1.3 | static | `presentational-spacing` | — |
| 10.2.1 | judgment | — | `css-generated-content-informative` |
| 10.3.1 | judgment | — | — |
| 10.4.1 | judgment | — | `dyn-input-overflow-zoom`, `dyn-reflow-zoom` |
| 10.4.2 | judgment | — | `axe:meta-viewport`, `axe:meta-viewport-large`, `meta-viewport-zoom-block` |
| 10.5.1 | judgment | — | — |
| 10.5.2 | judgment | — | — |
| 10.5.3 | judgment | — | — |
| 10.6.1 | judgment | — | `axe:link-in-text-block`, `rendered-link-colour-only` |
| 10.7.1 | rendered | `dyn-focus-visible` | `rendered-focus-not-visible` |
| 10.8.1 | judgment | — | `disabled-context-content` |
| 10.9.1 | judgment | — | — |
| 10.9.2 | judgment | — | — |
| 10.9.3 | judgment | — | — |
| 10.9.4 | judgment | — | — |
| 10.10.1 | judgment | — | — |
| 10.10.2 | judgment | — | — |
| 10.10.3 | judgment | — | — |
| 10.10.4 | judgment | — | — |
| 10.11.1 | judgment | — | `dyn-input-overflow-reflow`, `dyn-reflow` |
| 10.11.2 | judgment | — | — |
| 10.12.1 | static | `letter-spacing-important`, `line-height-important`, `word-spacing-important` | `dyn-input-overflow-spacing`, `dyn-text-spacing` |
| 10.13.1 | judgment | — | `dyn-hover` |
| 10.13.2 | judgment | — | `dyn-hover` |
| 10.13.3 | judgment | — | `dyn-hover` |
| 10.14.1 | judgment | — | — |
| 10.14.2 | judgment | — | — |
| 11.1.1 | static | `axe:aria-input-field-name`, `axe:aria-toggle-field-name`, `axe:label`, `axe:select-name`, `control-label-missing` | `axe:label-title-only`, `control-name-title-only`, `field-purpose-incomplete`, `placeholder-as-label`, `select-has-option` |
| 11.1.2 | judgment | — | `axe:form-field-multiple-labels`, `form-field-multiple-labels`, `label-for-dangling` |
| 11.1.3 | judgment | — | `axe:label-title-only`, `control-name-title-only`, `field-purpose-incomplete`, `placeholder-as-label` |
| 11.2.1 | judgment | — | — |
| 11.2.2 | judgment | — | — |
| 11.2.3 | judgment | — | — |
| 11.2.4 | judgment | — | — |
| 11.2.5 | static | `field-label-in-name-mismatch` | — |
| 11.2.6 | judgment | — | — |
| 11.3.1 | judgment | — | — |
| 11.3.2 | judgment | — | — |
| 11.4.1 | judgment | — | — |
| 11.4.2 | judgment | — | — |
| 11.4.3 | judgment | — | — |
| 11.5.1 | static | `radio-checkbox-group-ungrouped` | `date-fields-ungrouped` |
| 11.6.1 | static | `fieldset-legend-missing` | — |
| 11.7.1 | judgment | — | — |
| 11.8.1 | judgment | — | — |
| 11.8.2 | static | `pack:rgaa:optgroup-without-label` | — |
| 11.8.3 | judgment | — | — |
| 11.9.1 | static | `form-button-empty-name` | `cross-icon-only-unnamed`, `icon-only-control-unnamed` |
| 11.9.2 | static | `form-label-in-name-mismatch` | — |
| 11.10.1 | judgment | — | `dyn-error-unassociated` |
| 11.10.2 | judgment | — | `dyn-error-unassociated` |
| 11.10.3 | judgment | — | `aria-invalid-no-description`, `dyn-error-unassociated`, `error-not-associated` |
| 11.10.4 | judgment | — | `aria-invalid-no-description`, `dyn-error-unassociated`, `error-not-associated` |
| 11.10.5 | judgment | — | `dyn-error-unassociated` |
| 11.10.6 | judgment | — | `aria-invalid-no-description`, `dyn-error-unassociated`, `error-not-associated` |
| 11.10.7 | judgment | — | `aria-invalid-no-description`, `dyn-error-unassociated`, `error-not-associated` |
| 11.11.1 | judgment | — | — |
| 11.11.2 | judgment | — | — |
| 11.12.1 | judgment | — | — |
| 11.12.2 | judgment | — | — |
| 11.13.1 | judgment | — | `autocomplete-token-invalid`, `axe:autocomplete-valid`, `field-purpose-incomplete` |
| 12.1.1 | judgment | — | — |
| 12.2.1 | judgment | — | — |
| 12.3.1 | judgment | — | — |
| 12.3.2 | judgment | — | — |
| 12.3.3 | judgment | — | — |
| 12.4.1 | judgment | — | — |
| 12.4.2 | judgment | — | — |
| 12.4.3 | judgment | — | — |
| 12.5.1 | judgment | — | — |
| 12.5.2 | judgment | — | — |
| 12.5.3 | judgment | — | — |
| 12.6.1 | judgment | — | `axe:landmark-one-main`, `bypass-blocks-missing`, `missing-main-landmark`, `multiple-main-landmark`, `nav-landmark-missing`, `nav-landmark-unnamed` |
| 12.7.1 | judgment | — | `axe:bypass`, `bypass-blocks-missing` |
| 12.7.2 | judgment | — | `axe:skip-link`, `bypass-blocks-missing`, `skip-link-target-missing` |
| 12.8.1 | judgment | — | `axe:tabindex`, `dyn-dialog-focus`, `positive-tabindex` |
| 12.8.2 | judgment | — | `dyn-dialog-focus` |
| 12.9.1 | judgment | — | `dyn-keyboard-trap` |
| 12.10.1 | judgment | — | — |
| 12.11.1 | judgment | — | — |
| 13.1.1 | judgment | — | — |
| 13.1.2 | judgment | — | `meta-refresh-redirect` |
| 13.1.3 | judgment | — | — |
| 13.1.4 | judgment | — | — |
| 13.2.1 | judgment | — | — |
| 13.3.1 | judgment | — | `pdf-lang-missing`, `pdf-no-text`, `pdf-structure-shallow`, `pdf-title-missing`, `pdf-untagged` |
| 13.4.1 | judgment | — | — |
| 13.5.1 | judgment | — | — |
| 13.6.1 | judgment | — | — |
| 13.7.1 | judgment | — | — |
| 13.7.2 | judgment | — | — |
| 13.7.3 | judgment | — | — |
| 13.8.1 | judgment | — | `axe:marquee`, `blink-marquee` |
| 13.8.2 | judgment | — | `axe:blink`, `blink-marquee` |
| 13.9.1 | judgment | — | `rendered-orientation-lock` |
| 13.10.1 | judgment | — | — |
| 13.10.2 | judgment | — | — |
| 13.11.1 | judgment | — | — |
| 13.12.1 | judgment | — | — |
| 13.12.2 | judgment | — | — |
| 13.12.3 | judgment | — | — |

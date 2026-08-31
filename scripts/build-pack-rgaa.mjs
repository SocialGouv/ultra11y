#!/usr/bin/env node
// DEV-ONLY (not in `bin`). Builds the RGAA 4.1.2 STANDARDS PACK that ships at
// src/data/standards/rgaa.json (+ rgaa.glossary.json). RGAA is the first of many
// pluggable, in-repo country packs (see CONTRIBUTING.md): a pack carries a test-level
// automation contract, not executable engine code — it is a localized criterion set that
// maps each of its criteria onto WCAG success criteria (bare SC ids). The WCAG↔rule coverage
// lives in the core (scripts/build-standards.mjs). The RGAA content is Licence
// Ouverte / Etalab 2.0 — see NOTICE. The official source is vendored under
// scripts/vendor/rgaa/ (criteres.json, glossaire.json, methodologies.json) so the
// build is reproducible offline.
//   node scripts/build-pack-rgaa.mjs            # build from the vendored source
//   node scripts/build-pack-rgaa.mjs --offline  # alias (the source is always local)
//   node scripts/build-pack-rgaa.mjs --fetch     # refresh the vendored source from DINUM, then build
//   node scripts/build-pack-rgaa.mjs --check     # rebuild in memory and byte-compare vs the committed
//                                                 # pack; no writes; exit 1 on drift (CI gate)
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "src", "data", "standards");
const AUTOMATION_REF = join(root, "skills", "ultra11y", "references", "rgaa-automation.md");
const VENDOR = join(root, "scripts", "vendor", "rgaa");
const BIOME = join(root, "node_modules", ".bin", "biome");
const BASE = "https://raw.githubusercontent.com/DISIC/accessibilite.numerique.gouv.fr/main/RGAA";
const doFetch = process.argv.includes("--fetch");
const doCheck = process.argv.includes("--check");

// The committed pack JSON is biome-formatted (short arrays collapse onto one line —
// see biome.json's default `--expand=auto`), not raw `JSON.stringify` output. Route
// both the write path and the --check comparison through biome so the two can never
// disagree over whitespace alone; `relPath` (project-relative, e.g.
// "src/data/standards/rgaa.json") only picks the JSON formatter, no file is touched.
function biomeFormat(text, relPath) {
  return execFileSync(BIOME, ["format", `--stdin-file-path=${relPath}`], { input: text, encoding: "utf8" });
}

async function source(name) {
  if (doFetch) {
    const r = await fetch(`${BASE}/${name}`);
    if (!r.ok) throw new Error(`build-pack-rgaa: ${name} HTTP ${r.status}`);
    const text = await r.text();
    mkdirSync(VENDOR, { recursive: true });
    writeFileSync(join(VENDOR, name), text);
    return JSON.parse(text);
  }
  return JSON.parse(readFileSync(join(VENDOR, name), "utf8"));
}

// Slug used by the official site for glossary anchors.
const slug = (s) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// [term](#anchor) -> term
const plain = (s) => s.replace(/\[([^\]]+)\]\(#[^)]*\)/g, "$1");
// DINUM nests a bullet list inside a note as `{ ul: [...] }` (17 places across
// technicalNote / particularCases). A plain `String(v)` on those produced a literal
// "[object Object]" in the shipped pack, silently deleting the normative sub-conditions an
// auditor needs — e.g. every exception under RGAA 1.2's images-of-text rule. Flatten the
// node instead of stringifying it, and refuse anything still unrecognised rather than
// emitting placeholder text (see the assertion at the end of this file).
const flattenNode = (v) => {
  if (v == null) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(flattenNode);
  if (typeof v === "object") {
    const list = v.ul ?? v.ol ?? v.li ?? v.p ?? v.text;
    if (list !== undefined) return flattenNode(list);
  }
  return [];
};
const toArr = (v) => flattenNode(v);

// The official méthodologie de test for one criterion, keyed by the criterion's OWN test
// numbers so it renders directly under the test it explains: `{ "1": "1. Retrouver…", … }`.
// DINUM's file is flat and keyed by full test id ("11.2.1"), so this is the re-key.
//
// Returns undefined when the criterion has none, and the field is then absent from the pack
// rather than present-and-empty: `methodology` is optional on PackCriterion, and an empty
// object would make every consumer test for two shapes instead of one.
function methodologyOf(methodologies, id, tests) {
  const out = {};
  for (const k of Object.keys(tests || {})) {
    const text = methodologies[`${id}.${k}`];
    if (typeof text === "string" && text.trim()) out[k] = text.trim();
  }
  return Object.keys(out).length ? { methodology: out } : undefined;
}

// crude HTML -> plaintext for glossary bodies
const deHtml = (s) =>
  s
    .replace(/<\/(p|li|ul|ol|div|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;|&#8217;/g, "’")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// "1.1.1 Non-text Content (A)" -> "1.1.1"  (bare WCAG SC id; the WCAG core owns titles/levels)
const bareSc = (w) => String(w).trim().split(/\s+/)[0];

// ---- Applicability (R1 fix): which ENGINE RULE ids can make each RGAA criterion NC ----
// A single WCAG SC maps to many RGAA criteria (1.1.1 → 19 criteria: informative image,
// CAPTCHA, detailed description, layout tables, downloadable documents…). Without this,
// one `img-alt-missing` failure fanned out to ALL of them. This CURATED table names, per
// engine rule, the RGAA criterion(s) whose element/context that rule actually evidences;
// the inverse (criterion → ruleIds) is written to each criterion's `appliesTo`. Static
// engine rule ids are validated below (must exist + share a WCAG SC with the criterion);
// axe:*/dyn-* ids (dynamic tier) are namespaced and tolerated as-is.
//
// The WCAG SC(s) each STATIC rule can emit — used only to self-validate the table below
// (a listed (rule, criterion) pair must share an SC, else the entry would be inert).
const RULE_SC = {
  "aria-hidden-focusable": ["4.1.2"], "aria-invalid-no-description": ["3.3.1"], "aria-ref-missing-id": ["4.1.2"],
  "aria-required-children": ["4.1.2"], "autoplay-media": ["1.4.2", "2.2.2"], "blink-marquee": ["2.2.2"],
  "button-empty-name": ["4.1.2"], "canvas-fallback-missing": ["1.1.1"], "chart-no-accessible-name": ["1.1.1"],
  "clickable-noninteractive": ["4.1.2", "2.1.1"], "contrast-literal": ["1.4.3"], "control-label-missing": ["4.1.2"],
  "rendered-contrast": ["1.4.3"], "rendered-contrast-pixel": ["1.4.3"], "rendered-link-colour-only": ["1.4.1"],
  "rendered-nontext-contrast": ["1.4.11"], "rendered-focus-not-visible": ["2.4.7"], "rendered-orientation-lock": ["1.3.4"],
  "document-language-missing": ["3.1.1"], "html-lang-xml-lang-mismatch": ["3.1.1"], "duplicate-attribute": ["4.1.2"],
  "presentational-children-focusable": ["4.1.2"], "decorative-marked-exposed": ["1.1.1", "4.1.2"], "menuitem-empty-name": ["4.1.2"],
  "letter-spacing-important": ["1.4.12"], "word-spacing-important": ["1.4.12"], "line-height-important": ["1.4.12"],
  "table-scope-invalid": ["1.3.1"],
  "css-generated-content-informative": ["1.3.1"], "date-fields-ungrouped": ["3.3.2"], "disabled-context-content": ["4.1.2"],
  "control-name-title-only": ["4.1.2"], "cross-icon-only-unnamed": ["4.1.2"],
  "cross-prop-drilled-name-lost": ["4.1.2"], "data-table-no-headers": ["1.3.1"],
  "decorative-alt-misuse": ["1.1.1"], "duplicate-id": ["4.1.2"], "empty-heading": ["1.3.1"], "error-not-associated": ["3.3.1"],
  "field-purpose-incomplete": ["1.3.5", "4.1.2"], "fieldset-legend-missing": ["1.3.1"], "form-field-multiple-labels": ["4.1.2"],
  "h1-missing": ["1.3.1"], "h1-multiple": ["1.3.1"], "heading-order-skip": ["1.3.1"], "html-lang-missing": ["3.1.1"],
  "icon-only-control-unnamed": ["2.4.4", "4.1.2"], "iframe-title-missing": ["4.1.2"], "img-alt-missing": ["1.1.1"],
  "inline-lang-change-missing": ["3.1.2"], "input-image-alt-missing": ["1.1.1"], "invalid-aria-role": ["4.1.2"],
  "label-for-dangling": ["1.3.1"], "lang-invalid": ["3.1.1", "3.1.2"], "layout-table-data-markup": ["1.3.1"],
  "link-empty-name": ["2.4.4"], "list-structure": ["1.3.1"], "live-region-conflict": ["4.1.3"], "media-no-track": ["1.2.2"],
  "meta-refresh-redirect": ["2.2.1"], "meta-viewport-zoom-block": ["1.4.4"], "missing-main-landmark": ["1.3.1"],
  "multiple-main-landmark": ["1.3.1"], "nav-landmark-missing": ["1.3.1"], "nav-landmark-unnamed": ["1.3.1"],
  "nested-interactive": ["4.1.2"], "object-embed-no-name": ["1.1.1"], "radio-checkbox-group-ungrouped": ["1.3.1", "3.3.2"],
  "placeholder-as-label": ["4.1.2"], "positive-tabindex": ["2.4.3"], "redundant-aria": ["4.1.2"], "select-has-option": ["4.1.2"],
  "skip-link-target-missing": ["2.4.1"], "sortable-header-no-aria-sort": ["1.3.1"], "status-message-not-assertive": ["4.1.3"],
  "table-caption-missing": ["1.3.1"], "table-empty-data-cell": ["1.3.1"], "title-missing-empty": ["2.4.2"],
};

// ---- Judgment criteria: RGAA wordings that ask MORE than their WCAG mapping ----
// A criterion derives its status from the WCAG SCs DINUM's own crosswalk cites, and the
// projection returns `C` as soon as one mapped SC is `C`. That is right when the RGAA
// question and the SC ask the same thing (8.3 "is a default language present?" ↔ 3.1.1),
// and wrong when the RGAA wording adds a human judgment the SC never made: RGAA 8.6 asks
// whether the page title is PERTINENT, WCAG 2.4.2 only that a title exists — so a page
// titled "aaa" derived `C`. Worse, 13.3/13.4 (does each downloadable office document have
// an accessible version?) map to a bag of seven SCs including 3.1.1, so they derived `C`
// off a `lang` attribute, on pages carrying an unopened PDF — and on pages carrying no
// document at all.
//
// Only 3 WCAG SCs are `static` (1.4.2, 2.4.2, 3.1.1), so only 7 RGAA criteria can ever
// derive `C`; these are the ones among them whose question the engine has not answered.
// Flagged criteria can still be NC (a real rule fired) or NA (nothing applicable) — they
// simply never inherit a `C`, they go to the agent instead (src/standards/derive.ts).
const JUDGMENT_CRITERIA = {
  "4.10": "« contrôlable par l’utilisateur » — l’arrêt/le réglage du son se constate au rendu, 1.4.2 ne prouve que l’absence d’autoplay détectable.",
  "8.4": "« le code de langue est-il pertinent ? » — 3.1.1 ne vérifie que la présence et la validité syntaxique de `lang`, pas sa cohérence avec la langue réelle du contenu.",
  "8.6": "« ce titre est-il pertinent ? » — 2.4.2 ne vérifie que la présence d’un `<title>` non vide.",
  "13.3": "« version accessible du document en téléchargement » — aucune règle moteur ne peut ouvrir le document ; les CS mappés ne portent que sur la page.",
  "13.4": "« cette version offre-t-elle la même information ? » — comparaison de deux documents, hors de portée d’un audit de la page.",
};

// ruleId → RGAA criterion ids it evidences. Static rules + their axe:/dyn- equivalents so
// the dynamic-tier merge keeps the same mapping (an axe:color-contrast NC still lands on
// RGAA 3.2/10.5, not fanned out).
const RULE_TO_CRITERIA = {
  // Theme 1 — images (1.1 informative alt, 1.2 decorative)
  "img-alt-missing": ["1.1"], "input-image-alt-missing": ["1.1"], "object-embed-no-name": ["1.1"],
  "chart-no-accessible-name": ["1.1"], "canvas-fallback-missing": ["1.1"], "axe:image-alt": ["1.1"],
  "axe:input-image-alt": ["1.1"], "axe:area-alt": ["1.1"], "axe:role-img-alt": ["1.1"], "axe:svg-img-alt": ["1.1"],
  "axe:object-alt": ["1.1"], "decorative-alt-misuse": ["1.2"], "axe:image-redundant-alt": ["1.2"],
  "decorative-marked-exposed": ["1.2"],
  // Theme 2 — frames (2.1 frame title)
  "iframe-title-missing": ["2.1"], "axe:frame-title": ["2.1"], "axe:frame-title-unique": ["2.1"],
  // Theme 3 — colour contrast. RGAA 10.5 asks about paired CSS declarations, not the
  // resulting ratio, so contrast findings must not be presented as evidence for 10.5.
  "contrast-literal": ["3.2"], "axe:color-contrast": ["3.2"], "axe:color-contrast-enhanced": ["3.2"],
  // Rendered tier: contrast measured on the real page (computed styles) and on the
  // screenshot, for the gradient/background-image case the CSSOM cannot express.
  "rendered-contrast": ["3.2"], "rendered-contrast-pixel": ["3.2"],
  // 10.6 — a link in running text identified by colour alone. Deliberately NOT also
  // mapped to 3.1 (the general "information by colour alone"): 10.6 is RGAA's specific
  // criterion for links, and claiming both would count one defect twice.
  "rendered-link-colour-only": ["10.6"],
  // 3.3 — the boundary of a form control, measured on the computed borders/fill. The
  // only WCAG SC RGAA 3.3 maps to (1.4.11) had no rule at all before.
  "rendered-nontext-contrast": ["3.3"],
  // 10.7 — a focus indicator removed by the stylesheet with nothing put back. The live
  // `scan` probe (dyn-focus-visible) already evidenced this; the CSSOM route decides it
  // OFFLINE, with no browser and no running app.
  "rendered-focus-not-visible": ["10.7"],
  // 13.9 — orientation lock. Its SC (1.3.4) had no rule.
  "rendered-orientation-lock": ["13.9"],
  // Theme 4 — multimedia (4.3 captions)
  "media-no-track": ["4.3"], "axe:audio-caption": ["4.3"], "axe:video-caption": ["4.3"],
  // Theme 5 — tables (5.4 title, 5.6/5.7 headers, 5.8 layout-table markup)
  "table-caption-missing": ["5.4"], "data-table-no-headers": ["5.6", "5.7"],
  "layout-table-data-markup": ["5.8"], "axe:td-headers-attr": ["5.7"], "axe:th-has-data-cells": ["5.6"],
  "headers-attr-dangling": ["5.7"], "table-scope-invalid": ["5.7"], "th-no-data-cells": ["5.6"],
  "axe:scope-attr-valid": ["5.7"], "axe:td-has-header": ["5.6"], "axe:table-fake-caption": ["5.8"],
  // Theme 6 — links (6.2 link label)
  "link-empty-name": ["6.2"], "icon-only-control-unnamed": ["6.2", "11.9"], "cross-icon-only-unnamed": ["11.9"],
  "axe:link-name": ["6.2"],
  // Theme 7 — scripts/ARIA (7.1 AT-compat, 7.3 keyboard, 7.5 status messages)
  "invalid-aria-role": ["7.1"], "aria-ref-missing-id": ["7.1"], "aria-required-children": ["7.1"],
  "aria-hidden-focusable": ["7.1"], "redundant-aria": ["7.1"], "nested-interactive": ["7.1"],
  "cross-prop-drilled-name-lost": ["7.1"],
  "presentational-children-focusable": ["7.1"], "menuitem-empty-name": ["7.1"],
  "button-empty-name": ["7.1"], "label-in-name-mismatch": ["7.1"],
  "clickable-noninteractive": ["7.3"], "live-region-conflict": ["7.5"], "status-message-not-assertive": ["7.5"],
  // Dynamic tier (scan --local): the live-region probe projects onto WCAG 4.1.3 → RGAA 7.5
  // (status messages) — the WCAG-faithful home. Ara ALSO classifies the source finding under
  // RGAA 7.4 (change of context, WCAG 3.2.1/3.2.2); that deviation from the 4.1.3 crosswalk
  // ships as an opt-in `secondaryMappings` entry below (dyn-live-region → 7.4, DISABLED by
  // default), never hardcoded here, so the out-of-box projection stays WCAG-faithful (7.5).
  "dyn-live-region": ["7.5"],
  "disabled-context-content": ["7.1", "10.8"],
  "axe:aria-allowed-attr": ["7.1"], "axe:aria-allowed-role": ["7.1"], "axe:aria-roles": ["7.1"],
  "axe:aria-required-attr": ["7.1"], "axe:aria-required-children": ["7.1"], "axe:aria-required-parent": ["7.1"],
  "axe:aria-valid-attr": ["7.1"], "axe:aria-valid-attr-value": ["7.1"], "axe:nested-interactive": ["7.1"],
  "axe:aria-hidden-focus": ["7.1"], "axe:presentation-role-conflict": ["7.1"],
  "axe:button-name": ["7.1"], "axe:input-button-name": ["7.1"],
  // Theme 8 — document (8.2 valid code, 8.3 default lang, 8.4 lang relevant, 8.5 title, 8.7/8.8 lang changes)
  "duplicate-id": ["8.2"], "axe:duplicate-id": ["8.2"], "axe:duplicate-id-aria": ["8.2"], "axe:duplicate-id-active": ["8.2"],
  "html-lang-missing": ["8.3"], "axe:html-has-lang": ["8.3"],
  "document-language-missing": ["8.3"],
  "lang-invalid": ["8.4", "8.8"], "axe:html-lang-valid": ["8.4"], "axe:html-xml-lang-mismatch": ["8.4"], "axe:valid-lang": ["8.8"],
  "html-lang-xml-lang-mismatch": ["8.4"], "duplicate-attribute": ["8.2"],
  "title-missing-empty": ["8.5"], "axe:document-title": ["8.5"], "inline-lang-change-missing": ["8.7"],
  // Theme 9 — structure (9.1 headings, 9.2 doc structure, 9.3 lists)
  "h1-missing": ["9.1"], "h1-multiple": ["9.1"], "heading-order-skip": ["9.1"], "empty-heading": ["9.1"],
  "axe:heading-order": ["9.1"], "axe:empty-heading": ["9.1"], "axe:page-has-heading-one": ["9.1"],
  "missing-main-landmark": ["9.2", "12.6"], "multiple-main-landmark": ["9.2", "12.6"], "axe:landmark-one-main": ["12.6"],
  "nav-landmark-missing": ["9.2", "12.6"], "nav-landmark-unnamed": ["12.6"],
  "list-structure": ["9.3"], "axe:list": ["9.3"], "axe:listitem": ["9.3"], "axe:definition-list": ["9.3"], "axe:dlitem": ["9.3"],
  // Theme 10 — presentation (10.2 CSS-off content, 10.4 zoom, 10.7 focus, 10.11 reflow, 10.12 text-spacing)
  "css-generated-content-informative": ["10.2"],
  "meta-viewport-zoom-block": ["10.4"], "axe:meta-viewport": ["10.4"], "axe:meta-viewport-large": ["10.4"],
  "dyn-reflow": ["10.11"], "dyn-reflow-zoom": ["10.4"], "dyn-focus-visible": ["10.7"], "dyn-text-spacing": ["10.12"], "dyn-hover": ["10.13"],
  "letter-spacing-important": ["10.12"], "word-spacing-important": ["10.12"], "line-height-important": ["10.12"],
  // Stateful input-overflow probes — a filled input clipped under each stress, same RGAA
  // theme as the corresponding reflow/zoom/text-spacing residual probe above.
  "dyn-input-overflow-reflow": ["10.11"], "dyn-input-overflow-zoom": ["10.4"], "dyn-input-overflow-spacing": ["10.12"],
  // Theme 11 — forms (11.1 field label, 11.5 field grouping, 11.6 fieldset legend, 11.9 button label, 11.10 input control, 11.13 autocomplete)
  "control-label-missing": ["11.1"], "label-for-dangling": ["11.1"], "placeholder-as-label": ["11.1"],
  "form-field-multiple-labels": ["11.1"], "select-has-option": ["11.1"], "control-name-title-only": ["11.1"],
  "radio-checkbox-group-ungrouped": ["11.5"], "date-fields-ungrouped": ["11.5"],
  "field-purpose-incomplete": ["11.1", "11.13"], "fieldset-legend-missing": ["11.6"], "form-button-empty-name": ["11.9"],
  "autocomplete-token-invalid": ["11.13"], "form-label-in-name-mismatch": ["11.9"],
  "error-not-associated": ["11.10"], "aria-invalid-no-description": ["11.10"],
  "axe:label": ["11.1"], "axe:form-field-multiple-labels": ["11.1"], "axe:select-name": ["11.1"], "axe:label-title-only": ["11.1"],
  "axe:autocomplete-valid": ["11.13"], "axe:fieldset": ["11.6"],
  // Theme 12 — navigation (12.7 skip link, 12.8 tab order, 12.9 keyboard trap)
  "skip-link-target-missing": ["12.7"], "axe:skip-link": ["12.7"], "axe:bypass": ["12.7"],
  "positive-tabindex": ["12.8"], "axe:tabindex": ["12.8"],
  // 12.9 « la navigation ne doit pas contenir de piège au clavier ». The probe that answers it
  // has existed since `probeKeyboardTrap` landed, and it was mapped to WCAG 2.1.2 alone — so a
  // trap the browser had just walked into raised a blocking WCAG non-conformity and left RGAA
  // 12.9 « à évaluer », to be bought from a paid adjudicator on every run. The evidence was
  // measured and then never delivered to the criterion it answers. No axe rule joins it: axe
  // has none for keyboard traps, which is why the probe was written in the first place.
  "dyn-keyboard-trap": ["12.9"],
  // Theme 13 — consultation (13.1 time limits, 13.8 moving/blinking)
  "meta-refresh-redirect": ["13.1"], "blink-marquee": ["13.8"], "autoplay-media": ["4.10"],
  "axe:no-autoplay-audio": ["4.10"], "axe:blink": ["13.8"], "axe:marquee": ["13.8"],
};

// A rule firing is NOT automatically a complete RGAA failure. Most engine rules are useful
// evidence for a narrower precondition while the official test still asks about relevance,
// an allowed alternative, or a particular case. Those rules are routed to adjudication as
// `candidate` below. This deliberately small table contains only failures whose observation
// itself exhausts the cited numbered test.
const DECISIVE_RULE_TESTS = {
  "1.1|axe:area-alt": ["2"],
  "1.1|axe:input-image-alt": ["3"],
  "1.1|input-image-alt-missing": ["3"],
  "2.1|axe:frame-title": ["1"],
  "2.1|iframe-title-missing": ["1"],
  "6.2|link-empty-name": ["1"],
  "6.2|axe:link-name": ["1"],
  "8.2|duplicate-id": ["1"],
  "8.2|axe:duplicate-id": ["1"],
  "8.2|axe:duplicate-id-aria": ["1"],
  "8.2|axe:duplicate-id-active": ["1"],
  "8.2|duplicate-attribute": ["1"],
  "8.3|document-language-missing": ["1"],
  "8.4|axe:html-lang-valid": ["1"],
  "8.4|lang-invalid": ["1"],
  "8.4|html-lang-xml-lang-mismatch": ["1"],
  "8.5|title-missing-empty": ["1"],
  "8.5|axe:document-title": ["1"],
  "9.3|list-structure": ["1", "2", "3"],
  "9.3|axe:list": ["1", "2"],
  "9.3|axe:listitem": ["1", "2"],
  "9.3|axe:definition-list": ["3"],
  "9.3|axe:dlitem": ["3"],
  "10.7|dyn-focus-visible": ["1"],
  "10.12|letter-spacing-important": ["1"],
  "10.12|word-spacing-important": ["1"],
  "10.12|line-height-important": ["1"],
  "11.1|axe:label": ["1"],
  "11.1|axe:select-name": ["1"],
  "11.1|control-label-missing": ["1"],
  "11.6|axe:fieldset": ["1"],
  "11.6|fieldset-legend-missing": ["1"],
  "11.9|form-button-empty-name": ["1"],
  "11.9|form-label-in-name-mismatch": ["2"],
  "11.5|radio-checkbox-group-ungrouped": ["1"],
  "5.7|headers-attr-dangling": ["4"],
  "5.7|table-scope-invalid": ["2", "3"],
  "5.8|layout-table-data-markup": ["1"],
  // An absent accessible name fails the prerequisite name/role/value test (7.1.1).
  // Test 7.1.3 asks whether an already-accessible name/role is pertinent; it cannot be the
  // attachment for a component that has no name at all.
  "7.1|menuitem-empty-name": ["1"],
  "7.1|button-empty-name": ["1"],
  "7.1|axe:button-name": ["1"],
  "7.1|axe:input-button-name": ["1"],
  "7.1|label-in-name-mismatch": ["3"],
};

// Candidate evidence is test-scoped too. The fallback remains all tests only when one rule id
// genuinely cannot distinguish the mechanism it observed; the entries below prevent a signal
// for one numbered test from being presented to the adjudicator as evidence for its siblings.
const CANDIDATE_RULE_TESTS = {
  "1.1|axe:image-alt": ["1"],
  "1.1|axe:role-img-alt": ["1"],
  "1.1|img-alt-missing": ["1"],
  "1.1|axe:svg-img-alt": ["5"],
  "1.1|axe:object-alt": ["6"],
  "1.1|object-embed-no-name": ["6", "7"],
  "1.1|canvas-fallback-missing": ["8"],
  "1.1|chart-no-accessible-name": ["1", "5", "8"],
  "1.2|decorative-marked-exposed": ["1", "2", "3", "4", "5", "6"],
  "4.3|axe:audio-caption": ["1"],
  "4.3|axe:video-caption": ["1"],
  "4.3|media-no-track": ["1"],
  "5.6|axe:td-has-header": ["1", "2"],
  "5.6|axe:th-has-data-cells": ["1", "2", "3"],
  "5.6|data-table-no-headers": ["1", "2", "3"],
  "5.7|axe:scope-attr-valid": ["2", "3"],
  "5.7|axe:td-headers-attr": ["4"],
  "7.3|clickable-noninteractive": ["1"],
  "7.1|presentational-children-focusable": ["1", "2"],
  "8.4|axe:html-xml-lang-mismatch": ["1"],
  "9.1|axe:empty-heading": ["2"],
  "9.1|empty-heading": ["2"],
  "9.1|axe:heading-order": ["1"],
  "9.1|heading-order-skip": ["1"],
  "9.1|axe:page-has-heading-one": ["1", "3"],
  "9.1|h1-missing": ["1", "3"],
  "9.1|h1-multiple": ["1"],
  "10.4|axe:meta-viewport": ["2"],
  "10.4|axe:meta-viewport-large": ["2"],
  "10.4|meta-viewport-zoom-block": ["2"],
  "10.4|dyn-input-overflow-zoom": ["1"],
  "10.4|dyn-reflow-zoom": ["1"],
  "10.11|dyn-input-overflow-reflow": ["1"],
  "10.11|dyn-reflow": ["1"],
  "11.1|axe:form-field-multiple-labels": ["2"],
  "11.1|form-field-multiple-labels": ["2"],
  "11.1|label-for-dangling": ["2"],
  "11.1|axe:label-title-only": ["1", "3"],
  "11.1|control-name-title-only": ["1", "3"],
  "11.1|placeholder-as-label": ["1", "3"],
  "11.1|field-purpose-incomplete": ["1", "3"],
  "11.1|select-has-option": ["1"],
  "11.13|autocomplete-token-invalid": ["1"],
  "11.9|cross-icon-only-unnamed": ["1"],
  "11.9|icon-only-control-unnamed": ["1"],
  "11.10|aria-invalid-no-description": ["3", "4", "6", "7"],
  "11.10|error-not-associated": ["3", "4", "6", "7"],
  "12.7|axe:bypass": ["1"],
  "12.7|axe:skip-link": ["2"],
  "12.7|skip-link-target-missing": ["2"],
  "12.8|axe:tabindex": ["1"],
  "12.8|positive-tabindex": ["1"],
  "13.1|meta-refresh-redirect": ["2"],
  "13.8|axe:blink": ["2"],
  "13.8|axe:marquee": ["1"],
};

// WHICH CRITERIA MAY BE CONCLUDED FROM A CLEAN ENGINE PASS — the shortest list in this file,
// and the one that decides whether silence is evidence.
//
// 10.1 LEFT IT, and the correction goes the expensive way round: this criterion now reaches an
// adjudicator on every run it did not reach before. It is there because the rule behind it
// (src/rules/presentation.ts) is deliberately NARROWER than the criterion it serves, and each
// narrowing was the right call on its own:
//
//   • `<u>` is excluded wholesale, because the RGAA forbids it only outside HTML5 and flagging
//     it would manufacture a non-conformity on conforming markup;
//   • `width`/`height` are tolerated on nine tags where the glossary names five, because
//     `<video width>` and `<iframe width>` are conforming HTML5 and red-flagging them would
//     fail ordinary accessible markup;
//   • test 10.1.3 — presentation built out of spaces — is TWO heuristics (a word spelled one
//     letter at a time, three or more non-breaking spaces), chosen because they are
//     distinctive enough not to guess.
//
// Every one of those is a deliberate under-report, which is the safe direction for a FINDING
// and the wrong one for a CONFORMITY. « This rule found nothing » and « this criterion is
// satisfied » are not the same claim when the rule was written to look at less than the
// criterion asks about.
//
// Nothing was added to this list to compensate. The budget lever is the verdict ledger
// (src/ledger.ts), not a wider definition of what silence proves.
const COMPLETE_BY_SILENCE = new Set(["8.3", "8.5"]);
const renderedTier = (ruleId) =>
  ruleId.startsWith("rendered-") || ruleId.startsWith("dyn-") || ruleId.startsWith("axe:") ? "rendered" : "static";
const mergeTestTier = (current, next) => (current === "static" || next === "static" ? "static" : next);

async function main() {
  const criteres = await source("criteres.json");
  const glossaire = await source("glossaire.json");
  // THE OFFICIAL TEST METHODOLOGY — the third file DINUM publishes beside the other two,
  // keyed by TEST id ("11.2.1"), and the one thing an adjudicator was never given. The
  // criterion's wording says WHAT is required; this says HOW it is tested, step by step, in
  // the referential's own words. Vendored like the rest so it reaches CI, an offline run and
  // a model prompt without a network call — see `methodology` in src/standards/types.ts.
  const methodologies = await source("methodologies.json");

  const glossary = {};
  for (const e of glossaire.glossary) glossary[slug(e.title)] = { title: e.title, body: deHtml(e.body) };

  const themes = [];
  const criteria = [];
  for (const topic of criteres.topics) {
    let count = 0;
    for (const { criterium } of topic.criteria) {
      const id = `${topic.number}.${criterium.number}`;
      const wcag = new Set();
      const techniques = new Set();
      for (const ref of criterium.references || []) {
        for (const w of ref.wcag || []) wcag.add(bareSc(w));
        for (const t of ref.techniques || []) techniques.add(String(t));
      }
      criteria.push({
        id,
        theme: topic.number,
        title: { fr: criterium.title },
        titlePlain: { fr: plain(criterium.title) },
        tests: criterium.tests || {},
        ...(methodologyOf(methodologies, id, criterium.tests) ?? {}),
        techniques: [...techniques],
        ...(criterium.technicalNote ? { technicalNote: toArr(criterium.technicalNote) } : {}),
        ...(criterium.particularCases ? { particularCases: toArr(criterium.particularCases) } : {}),
        wcag: [...wcag],
      });
      count++;
    }
    themes.push({ number: topic.number, name: { fr: topic.topic }, count });
  }

  // ---- Applicability: invert RULE_TO_CRITERIA and attach an explicit `appliesTo` to EVERY
  // criterion (empty when no engine rule can evidence it, so an SC-sibling can never leak a
  // foreign finding). Self-validate that each STATIC rule shares a WCAG SC with the criteria
  // it's listed under (an inert entry is almost always a curation mistake). ----
  const wcagById = new Map(criteria.map((c) => [c.id, new Set(c.wcag)]));
  const critRules = {};
  for (const [ruleId, critIds] of Object.entries(RULE_TO_CRITERIA)) {
    const scs = RULE_SC[ruleId]; // undefined for axe:/dyn- (namespaced, not statically validated)
    for (const cid of critIds) {
      if (!wcagById.has(cid)) throw new Error(`RULE_TO_CRITERIA: rule "${ruleId}" → unknown RGAA criterion "${cid}"`);
      if (scs && !scs.some((sc) => wcagById.get(cid).has(sc))) {
        throw new Error(`RULE_TO_CRITERIA: "${ruleId}" (SC ${scs.join(",")}) under RGAA ${cid} (WCAG ${[...wcagById.get(cid)].join(",")}) — no shared SC, entry is inert`);
      }
      (critRules[cid] ||= new Set()).add(ruleId);
    }
  }
  for (const c of criteria) c.appliesTo = { ruleIds: [...(critRules[c.id] ?? [])].sort() };

  // ---- Judgment flag: attach it, and refuse to ship a stale table. A flag naming a
  // criterion that could never derive `C` anyway would be silently inert, and the whole
  // point is that this list stays auditable. ----
  for (const id of Object.keys(JUDGMENT_CRITERIA)) {
    if (!wcagById.has(id)) throw new Error(`JUDGMENT_CRITERIA: unknown RGAA criterion "${id}"`);
  }
  for (const c of criteria) if (JUDGMENT_CRITERIA[c.id]) c.judgment = true;

  // ---- Declarative pack RULE (usage proof): an RGAA-only ADVISORY recommendation, run by
  // the bounded interpreter (src/standards/pack-rules.ts) AFTER the core engine rules. It
  // flags a download link (`a[href$=".pdf"]` & co) whose VISIBLE TEXT states neither the
  // file format nor its weight — the DSFR/RGAA auditor recommendation under criterion 6.1
  // (link explicitness, WCAG 2.4.4). ADVISORY: it surfaces as a recommendation in the RGAA
  // projection and NEVER makes 6.1 non-conformant. This proves a pack ships its OWN
  // detection without forking the engine (see skills/ultra11y/references/packs.md).
  // Kept in step with the engine instead of retyped: two hand-maintained copies of a rule-id
// list are two chances for the pack to claim an instrument the engine does not ship.
const PRESENTATIONAL_RULE_IDS = ["presentational-element", "presentational-attribute", "presentational-spacing"];
const DOWNLOAD_EXT = "pdf|docx?|pptx?|xlsx?|odt|ods|odp|rtf|csv|zip|rar|7z|gz|epub|mp3|mp4|avi|mov";
  const rules = [
    {
      id: "download-link-format",
      criterion: "6.1",
      wcag: ["2.4.4"],
      severity: "mineur",
      advisory: true,
      match: {
        tag: "a",
        attrs: [{ name: "href", op: "matches", value: `\\.(${DOWNLOAD_EXT})(\\?|#|$)` }],
        text: { op: "lacks", value: `(${DOWNLOAD_EXT}|\\d+\\s*(ko|mo|go|kb|mb|gb|octets?|bytes?))` },
      },
      message: {
        en: "Download link whose visible text states neither the file format nor its size.",
        fr: "Lien de téléchargement dont l’intitulé ne précise ni le format ni le poids du fichier.",
      },
      remediation: {
        en: "State the file format and size in the link text, e.g. “Annual report (PDF, 2 MB)”.",
        fr: "Indiquez le format et le poids du fichier dans l’intitulé du lien, par exemple « Rapport annuel (PDF, 2 Mo) ».",
      },
    },
    // RGAA 11.8.2 — "Dans chaque balise <select>, chaque balise <optgroup> possède-t-elle un
    // attribut label ?" Fully mechanical, and the criterion had no rule at all. Its siblings
    // 11.8.1 ("si nécessaire") and 11.8.3 ("le label est-il pertinent ?") stay the agent's:
    // this rule decides the one test of the three that is decidable from markup, which is
    // exactly what the DSL is for. NORMATIVE — a missing `label` is a plain failure.
    {
      id: "optgroup-without-label",
      criterion: "11.8",
      wcag: ["1.3.1"],
      severity: "majeur",
      match: { tag: "optgroup", attrs: [{ name: "label", op: "absent" }] },
      message: {
        en: "<optgroup> without a label attribute — the group of options is unnamed (RGAA test 11.8.2).",
        fr: "<optgroup> sans attribut label — le regroupement d’options n’est pas nommé (test RGAA 11.8.2).",
      },
      remediation: {
        en: 'Add label="…" naming what the options in this group have in common, e.g. <optgroup label="Europe">.',
        fr: 'Ajoutez label="…" nommant ce que les options du groupe ont en commun, par ex. <optgroup label="Europe">.',
      },
    },
    // RGAA 8.10.2 — the FIRST of its two sub-conditions: "La valeur de l'attribut dir est
    // conforme (rtl ou ltr)". Mechanical. The second ("la valeur est pertinente") and 8.10.1
    // (is a reading-direction change signalled at all?) need language detection and stay
    // manual. RGAA 4.1.2 closes the accepted set to `rtl` and `ltr`: HTML's `auto` value is
    // valid markup but does not satisfy this test, so it is intentionally reported here.
    {
      id: "dir-value-invalid",
      criterion: "8.10",
      wcag: ["1.3.2"],
      severity: "majeur",
      match: {
        attrs: [
          { name: "dir", op: "present" },
          { name: "dir", op: "matches", value: "^(?!(rtl|ltr)$).+$" },
        ],
      },
      message: {
        en: "dir attribute with a value other than rtl or ltr — the reading direction change fails RGAA test 8.10.2.",
        fr: "Attribut dir dont la valeur n’est ni rtl ni ltr — le changement de sens de lecture échoue au test RGAA 8.10.2.",
      },
      remediation: {
        en: 'Use dir="rtl" or dir="ltr", matching the reading direction of the text it carries.',
        fr: 'Utilisez dir="rtl" ou dir="ltr", en accord avec le sens de lecture du texte porté.',
      },
    },
    // RGAA 8.1 — « chaque page web est-elle définie par un type de document ? » THE criterion
    // no engine could reach: it maps only onto WCAG 4.1.1, which WCAG 2.2 REMOVED, so
    // `derivePackResults` classed it out of scope and left it « à évaluer » on every page of
    // every run — the one criterion of the 106 that no measurement could ever close and only a
    // model could. Measured on a real RGAA deliverable: a grid that sat at 105/106.
    //
    // Its subject is not an element, which is why no element rule could express it: the
    // doctype is not part of `documentElement.outerHTML`. The collector records it beside the
    // DOM (SnapshotMeta.doctype), and this DOCUMENT-level rule reads it there.
    //
    // WHAT IT DECIDES, AND WHAT IT DOES NOT. The signal exhausts test 8.1.1 only: no parsed
    // doctype means the required declaration is absent. It does not retain enough source
    // syntax to validate every accepted declaration (8.1.2) or independently prove its source
    // position (8.1.3). Those two tests remain with the adjudicator, and 8.1 cannot earn C from
    // this rule's silence. Inventing either conclusion would manufacture conformity.
    //
    // NORMATIVE, and signal-gated: it fires only where a capture recorded the field, so a
    // source file and a pre-field capture are both silence rather than a failure.
    {
      id: "doctype-missing",
      criterion: "8.1",
      wcag: ["4.1.1"],
      severity: "majeur",
      doc: { signal: "doctype", op: "absent" },
      message: {
        en: "The captured page declares no document type — the browser parsed no <!DOCTYPE> ahead of <html> (RGAA test 8.1.1).",
        fr: "La page capturée ne déclare aucun type de document — le navigateur n’a analysé aucun <!DOCTYPE> avant <html> (test RGAA 8.1.1).",
      },
      remediation: {
        en: "Emit <!DOCTYPE html> as the first line of the document, before <html>. A doctype placed after <html>, or malformed, is ignored by the parser and counts as absent.",
        fr: "Émettez <!DOCTYPE html> en première ligne du document, avant <html>. Un doctype placé après <html>, ou malformé, est ignoré par l’analyseur et compte comme absent.",
      },
    },
  ];
  // Wire each rule's namespaced id (`pack:rgaa:<id>`) into the criterion it reports under,
  // so derivePackResults routes its finding onto that criterion through the same
  // appliesTo/ruleMatches machinery as engine findings (6.1 evidences no engine rule).
  for (const rule of rules) {
    const c = criteria.find((x) => x.id === rule.criterion);
    if (!c) throw new Error(`build-pack-rgaa: rule "${rule.id}" reports under unknown criterion "${rule.criterion}"`);
    c.appliesTo = { ruleIds: [...new Set([...c.appliesTo.ruleIds, `pack:rgaa:${rule.id}`])].sort() };
  }

  // ---- RGAA 10.1 — the engine's presentational-markup rules, and their normativity ----
  //
  // 10.1's three tests are « these must be absent », over lists the RGAA closes itself: the
  // glossary entry « Présentation de l'information » names the forbidden elements and
  // attributes. The engine ships the instruments (src/rules/presentation.ts); the pack says
  // they decide THIS criterion, and re-normativizes them.
  //
  // They ship ADVISORY because `<center>` is obsolete HTML rather than a WCAG failure —
  // nothing about it breaks assistive technology, and reporting a WCAG 1.3.1 non-conformity
  // for it would be wrong. Under the RGAA it is a plain failure of test 10.1.1, so the pack
  // flips it here. This is what `overrides` is for, and it is the first use of it.
  //
  // Before this, 10.1 had NO instrument and inherited `readingOrder` through WCAG 1.3.2 — a
  // subject that answers a different question — so it reached the adjudicator with an empty
  // harvest. Measured on run 32508717451 (Sonnet, RGAA, 3 passes): the model ruled `C` three
  // times, the gate refused all three for citing nothing, and 10.1 was the ONE criterion of
  // the 106 left « à évaluer », on the run and on every page.
  const presentational = criteria.find((x) => x.id === "10.1");
  if (!presentational) throw new Error("build-pack-rgaa: RGAA 10.1 is missing from the referential");
  presentational.appliesTo = { ruleIds: [...new Set([...presentational.appliesTo.ruleIds, ...PRESENTATIONAL_RULE_IDS])].sort() };
  const overrides = Object.fromEntries(PRESENTATIONAL_RULE_IDS.map((id) => [id, { advisory: false, severity: "majeur" }]));

  // ---- Test-level automation matrix -------------------------------------------------
  // Start fail-closed: every one of DINUM's 258 tests is a judgment until a rule is
  // explicitly tied to it below. Every applicable rule is also classified. Unlisted rules
  // become candidates, never normative failures by accident.
  const packRuleById = new Map(rules.map((rule) => [`pack:rgaa:${rule.id}`, rule]));
  const packDecisive = {
    "8.1|pack:rgaa:doctype-missing": ["1"],
    "8.10|pack:rgaa:dir-value-invalid": ["2"],
    "11.8|pack:rgaa:optgroup-without-label": ["2"],
    "10.1|presentational-element": ["1"],
    "10.1|presentational-attribute": ["2"],
    "10.1|presentational-spacing": ["3"],
  };
  for (const [key, tests] of Object.entries(CANDIDATE_RULE_TESTS)) {
    const split = key.indexOf("|");
    const criterionId = key.slice(0, split);
    const ruleId = key.slice(split + 1);
    const criterion = criteria.find((entry) => entry.id === criterionId);
    if (!criterion) throw new Error(`CANDIDATE_RULE_TESTS: unknown criterion "${criterionId}"`);
    if (!criterion.appliesTo.ruleIds.includes(ruleId))
      throw new Error(`CANDIDATE_RULE_TESTS: "${ruleId}" is not applicable to RGAA ${criterionId}`);
    for (const test of tests) if (!(test in criterion.tests)) throw new Error(`CANDIDATE_RULE_TESTS: unknown test ${criterionId}.${test}`);
  }
  for (const c of criteria) {
    const testKeys = Object.keys(c.tests ?? {});
    const testTiers = Object.fromEntries(testKeys.map((key) => [key, "judgment"]));
    const ruleContracts = c.appliesTo.ruleIds.map((id) => {
      const decisiveTests = DECISIVE_RULE_TESTS[`${c.id}|${id}`] ?? packDecisive[`${c.id}|${id}`];
      const advisory = packRuleById.get(id)?.advisory === true;
      // Fail closed: a rule is decisive only when the exact RGAA numbered test is curated
      // above. The old fallback made every unlisted rule decisive and then spread it over
      // every test of the criterion — precisely the false-NC path this contract exists to
      // prevent.
      const effect = advisory ? "advisory" : decisiveTests ? "decisive-nc" : "candidate";
      const touched = decisiveTests ?? CANDIDATE_RULE_TESTS[`${c.id}|${id}`] ?? testKeys;
      if (effect === "decisive-nc") {
        const tier = id === "pack:rgaa:doctype-missing" ? "rendered" : renderedTier(id);
        for (const test of touched) testTiers[test] = mergeTestTier(testTiers[test], tier);
      }
      return {
        id,
        tests: touched,
        effect,
        rationale:
          effect === "decisive-nc"
            ? "The observed failure exhausts the cited RGAA test."
            : effect === "candidate"
              ? "Useful engine evidence, but the RGAA test still has an alternative, applicability condition, relevance judgment, or particular case to adjudicate."
              : "Non-normative recommendation; it cannot affect the criterion verdict.",
      };
    });
    c.automation = {
      tests: testTiers,
      rules: ruleContracts,
      ...(COMPLETE_BY_SILENCE.has(c.id) ? { completeBySilence: true } : {}),
    };
    // The matrix supersedes the five historical exceptions: any criterion not explicitly
    // complete by silence must not inherit C from a broader WCAG projection.
  }

  const pack = {
    key: "rgaa",
    name: "RGAA",
    fullName: "Référentiel général d’amélioration de l’accessibilité",
    org: "DINUM",
    country: "FR",
    baseVersion: "4.1.2",
    wcagVersion: String(criteres.wcag.version),
    locales: ["fr"],
    defaultLocale: "fr",
    license: "Licence Ouverte / Etalab 2.0",
    source: "https://github.com/DISIC/accessibilite.numerique.gouv.fr",
    attribution: "RGAA 4.1.2 © DINUM (Direction interministérielle du numérique) — Licence Ouverte / Etalab 2.0",
    idPattern: "^\\d+\\.\\d+$",
    // Where DINUM publishes each criterion. Cited by the adjudication brief so a reader can
    // reach the normative page — the vendored text above stays the authority either way.
    criterionUrl: "https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#{id}",
    // Auditor-display vocabulary (FR): the nouns an RGAA auditor reads. Rendered by the
    // `prd` auditor block + GitHub issues; see src/standards/vocabulary.ts.
    vocabulary: {
      theme: { fr: "Thématique" },
      criterion: { fr: "Critère" },
      test: { fr: "Test" },
      conformant: { fr: "Conforme (C)" },
      nonConformant: { fr: "Non conforme (NC)" },
      notApplicable: { fr: "Non applicable (NA)" },
      auditorHeading: { fr: "Critère d’accessibilité" },
    },
    // Normative page-sample methodology (RGAA): the REQUIRED page KINDS a real audit must
    // cover — its representative sample. Standard-agnostic sample MECHANICS live in the core
    // (src/sample.ts + Ultra11yConfig.sample); this carries only RGAA's own required-kinds
    // list. Drives the advisory `sample check` / `scan --sample` lint (fuzzy match on a
    // page's name/notes/url — short keywords match whole words only), never a hard gate.
    // Keywords are accent-insensitive, fr + en. Ambiguous single words are deliberately NOT
    // keywords ("plan" alone credited "Plan de formation" to plan-du-site; "support"
    // credited "Support RH" to aide) — the multi-word canonical phrases carry those kinds.
    sampleMethodology: {
      requiredKinds: [
        { id: "accueil", label: { fr: "Page d’accueil" }, keywords: ["accueil", "home", "index", "racine", "homepage"] },
        { id: "contact", label: { fr: "Contact" }, keywords: ["contact", "nous contacter", "nous ecrire", "coordonnees"] },
        { id: "mentions-legales", label: { fr: "Mentions légales" }, keywords: ["mentions legales", "mentions", "legal notice", "legal"] },
        {
          id: "declaration-accessibilite",
          label: { fr: "Déclaration d’accessibilité" },
          keywords: ["declaration d accessibilite", "declaration accessibilite", "accessibilite", "accessibility statement", "accessibility"],
        },
        { id: "plan-du-site", label: { fr: "Plan du site" }, keywords: ["plan du site", "sitemap", "site map"] },
        { id: "aide", label: { fr: "Aide" }, keywords: ["aide", "help", "faq", "assistance"] },
        {
          id: "authentification",
          label: { fr: "Authentification" },
          keywords: ["authentification", "authentication", "connexion", "identification", "login", "log in", "sign in", "se connecter", "auth"],
        },
        {
          id: "pages-representatives",
          label: { fr: "Pages représentatives" },
          keywords: ["representative", "representatif", "representatives", "gabarit", "template", "modele", "formulaire", "recherche", "resultats"],
        },
        {
          id: "elements-transverses",
          label: { fr: "Éléments transverses" },
          keywords: ["transverse", "transversaux", "en-tete", "entete", "header", "navigation", "menu", "pied de page", "footer"],
        },
      ],
    },
    // Opt-in SECONDARY crosswalk mapping (Task 13): the live-region probe keys on WCAG 4.1.3,
    // whose WCAG-faithful RGAA home is 7.5 (status messages). Ara additionally classifies the
    // same finding under 7.4 (change of context). That is a DELIBERATE deviation from the SC
    // crosswalk, so it ships DISABLED — the default projection stays WCAG-faithful (7.5 only).
    // Enable per-project via `.ultra11yrc.json`:
    //   { "secondaryMappings": [{ "standard": "rgaa", "ruleId": "dyn-live-region", "criterion": "7.4" }] }
    // (see src/standards/types.ts SecondaryMapping + src/config.ts). EXACT-ruleId match means
    // the other 4.1.3 rules (status-message-not-assertive, live-region-conflict) never cross over.
    secondaryMappings: [
      {
        ruleId: "dyn-live-region",
        criterion: "7.4",
        note: {
          fr: "Relève aussi de 7.4 (changement de contexte) selon le classement Ara ; projection WCAG-fidèle = 7.5.",
          en: "Also classified under 7.4 (change of context) per Ara; the WCAG-faithful projection is 7.5.",
        },
        enabled: false,
      },
    ],
    rules,
    overrides,
    themes,
    criteria,
  };

  const packText = biomeFormat(JSON.stringify(pack, null, 2) + "\n", "src/data/standards/rgaa.json");
  const glossaryText = biomeFormat(JSON.stringify(glossary, null, 2) + "\n", "src/data/standards/rgaa.glossary.json");
  const automationLines = [
    "<!-- GENERATED by `pnpm run build:pack:rgaa` from the vendored RGAA 4.1.2 data and the curated rule contracts. -->",
    "",
    "# RGAA 4.1.2 automation matrix",
    "",
    "Every one of the 258 official tests is classified. `static` and `rendered` mean that an explicitly mapped decisive rule can prove a failure; `judgment` remains for adjudication. A candidate signal is evidence only and never changes the verdict by itself. Conformity by silence is allowed only where explicitly shown.",
    "",
    "## Summary by criterion",
    "",
    "The 106 criterion rows below are the one-by-one routing review. “AI + signals” means deterministic evidence is forwarded without changing the verdict; “deterministic NC + AI residual” means a precise failure can be decided mechanically while every remaining condition still goes to adjudication.",
    "",
    "| Criterion | Tests (static / rendered / judgment) | Rules (decisive / candidate / advisory) | C by silence | Reviewed routing |",
    "|---|---:|---:|:---:|---|",
  ];
  for (const c of criteria) {
    const tiers = Object.values(c.automation.tests);
    const effects = c.automation.rules.map((rule) => rule.effect);
    const count = (values, value) => values.filter((entry) => entry === value).length;
    automationLines.push(
      `| ${c.id} | ${count(tiers, "static")} / ${count(tiers, "rendered")} / ${count(tiers, "judgment")} | ${count(effects, "decisive-nc")} / ${count(effects, "candidate")} / ${count(effects, "advisory")} | ${c.automation.completeBySilence ? "yes" : "no"} | ${
        c.automation.completeBySilence
          ? "deterministic"
          : effects.includes("decisive-nc")
            ? "deterministic NC + AI residual"
            : effects.includes("candidate")
              ? "AI + signals"
              : "AI"
      } |`,
    );
  }
  automationLines.push("", "## Test-by-test contract", "");
  automationLines.push("| Test | Owner | Decisive rules | Candidate signals |", "|---|---|---|---|");
  for (const c of criteria) {
    for (const [test, tier] of Object.entries(c.automation.tests)) {
      const contracts = c.automation.rules.filter((rule) => rule.tests.includes(test));
      const decisive = contracts.filter((rule) => rule.effect === "decisive-nc").map((rule) => `\`${rule.id}\``);
      const candidates = contracts.filter((rule) => rule.effect === "candidate").map((rule) => `\`${rule.id}\``);
      automationLines.push(`| ${c.id}.${test} | ${tier} | ${decisive.join(", ") || "—"} | ${candidates.join(", ") || "—"} |`);
    }
  }
  automationLines.push("");
  const automationText = automationLines.join("\n");

  if (doCheck) {
    const packPath = join(OUT, "rgaa.json");
    const glossaryPath = join(OUT, "rgaa.glossary.json");
    const drift = [];
    if (!existsSync(packPath) || readFileSync(packPath, "utf8") !== packText) drift.push("src/data/standards/rgaa.json");
    if (!existsSync(glossaryPath) || readFileSync(glossaryPath, "utf8") !== glossaryText)
      drift.push("src/data/standards/rgaa.glossary.json");
    if (!existsSync(AUTOMATION_REF) || readFileSync(AUTOMATION_REF, "utf8") !== automationText)
      drift.push("skills/ultra11y/references/rgaa-automation.md");
    if (drift.length > 0) {
      console.error(`build-pack-rgaa --check: OUT OF DATE vs vendored source — re-run \`pnpm run build:pack:rgaa\`: ${drift.join(", ")}`);
      process.exit(1);
    }
    console.log("build-pack-rgaa --check: src/data/standards/rgaa.json and rgaa.glossary.json match the vendored source.");
    return;
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "rgaa.json"), packText);
  writeFileSync(join(OUT, "rgaa.glossary.json"), glossaryText);
  writeFileSync(AUTOMATION_REF, automationText);

  // A normative sentence that stringified to "[object Object]" is a DELETED sub-condition an
  // auditor would have had to apply. Fail the build rather than ship placeholder text.
  const stringified = [];
  for (const c of criteria) {
    for (const field of ["technicalNote", "particularCases"]) {
      for (const line of c[field] ?? []) if (String(line).includes("[object Object]")) stringified.push(`${c.id}.${field}`);
    }
    for (const [k, lines] of Object.entries(c.tests ?? {})) {
      for (const line of lines) if (String(line).includes("[object Object]")) stringified.push(`${c.id} test ${k}`);
    }
  }
  if (stringified.length) {
    throw new Error(`build-pack-rgaa: ${stringified.length} normative text(s) stringified to "[object Object]" — extend flattenNode: ${stringified.join(", ")}`);
  }

  // THE METHODOLOGY TABLE MUST NOT GO STALE EITHER. A methodology whose test id does not
  // exist in the referential is a curation mistake upstream OR a re-key bug here, and it
  // would ship as dead weight in every bundle. A test with no methodology is legitimate
  // (DINUM does not document every one), so that is counted, not refused.
  const testIds = new Set();
  for (const c of criteria) for (const k of Object.keys(c.tests ?? {})) testIds.add(`${c.id}.${k}`);
  const orphans = Object.keys(methodologies).filter((k) => !testIds.has(k));
  if (orphans.length) {
    throw new Error(`build-pack-rgaa: ${orphans.length} methodology(ies) name a test the referential does not have: ${orphans.join(", ")}`);
  }
  const documented = criteria.reduce((n, c) => n + Object.keys(c.methodology ?? {}).length, 0);

  const noWcag = criteria.filter((c) => c.wcag.length === 0).map((c) => c.id);
  console.log(`build-pack-rgaa: ${themes.length} themes, ${criteria.length} criteria → src/data/standards/rgaa.json`);
  console.log(`build-pack-rgaa: glossary ${Object.keys(glossary).length} entries → src/data/standards/rgaa.glossary.json`);
  console.log(`build-pack-rgaa: official test methodology on ${documented}/${testIds.size} tests`);
  console.log(`build-pack-rgaa: criteria with no WCAG mapping (pack-local): ${noWcag.length ? noWcag.join(", ") : "none"} (${noWcag.length})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

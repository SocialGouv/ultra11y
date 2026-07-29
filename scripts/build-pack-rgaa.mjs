#!/usr/bin/env node
// DEV-ONLY (not in `bin`). Builds the RGAA 4.1.2 STANDARDS PACK that ships at
// src/data/standards/rgaa.json (+ rgaa.glossary.json). RGAA is the first of many
// pluggable, in-repo country packs (see CONTRIBUTING.md): a pack does NOT carry the
// engine's rules or automatability — it is a localized criterion set that maps each
// of its criteria onto WCAG success criteria (bare SC ids). The WCAG↔rule coverage
// lives in the core (scripts/build-standards.mjs). The RGAA content is Licence
// Ouverte / Etalab 2.0 — see NOTICE. The official source is vendored under
// scripts/vendor/rgaa/ so the build is reproducible offline.
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

// ruleId → RGAA criterion ids it evidences. Static rules + their axe:/dyn- equivalents so
// the dynamic-tier merge keeps the same mapping (an axe:color-contrast NC still lands on
// RGAA 3.2/10.5, not fanned out).
const RULE_TO_CRITERIA = {
  // Theme 1 — images (1.1 informative alt, 1.2 decorative)
  "img-alt-missing": ["1.1"], "input-image-alt-missing": ["1.1"], "object-embed-no-name": ["1.1"],
  "chart-no-accessible-name": ["1.1"], "canvas-fallback-missing": ["1.1"], "axe:image-alt": ["1.1"],
  "axe:input-image-alt": ["1.1"], "axe:area-alt": ["1.1"], "axe:role-img-alt": ["1.1"], "axe:svg-img-alt": ["1.1"],
  "axe:object-alt": ["1.1"], "decorative-alt-misuse": ["1.2"], "axe:image-redundant-alt": ["1.2"],
  // Theme 2 — frames (2.1 frame title)
  "iframe-title-missing": ["2.1"], "axe:frame-title": ["2.1"], "axe:frame-title-unique": ["2.1"],
  // Theme 3 / 10.5 — colour contrast (3.2 text/bg, 10.5 CSS declarations)
  "contrast-literal": ["3.2", "10.5"], "axe:color-contrast": ["3.2", "10.5"], "axe:color-contrast-enhanced": ["3.2", "10.5"],
  // Rendered tier: contrast measured on the real page (computed styles) and on the
  // screenshot, for the gradient/background-image case the CSSOM cannot express.
  "rendered-contrast": ["3.2", "10.5"], "rendered-contrast-pixel": ["3.2", "10.5"],
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
  "table-caption-missing": ["5.4"], "data-table-no-headers": ["5.6", "5.7"], "sortable-header-no-aria-sort": ["5.7"],
  "table-empty-data-cell": ["5.7"],
  "layout-table-data-markup": ["5.8"], "axe:td-headers-attr": ["5.7"], "axe:th-has-data-cells": ["5.6"],
  "axe:scope-attr-valid": ["5.7"], "axe:td-has-header": ["5.6"], "axe:empty-table-header": ["5.6"], "axe:table-fake-caption": ["5.8"],
  // Theme 6 — links (6.2 link label)
  "link-empty-name": ["6.2"], "icon-only-control-unnamed": ["6.2", "11.9"], "cross-icon-only-unnamed": ["11.9"],
  "axe:link-name": ["6.2"],
  // Theme 7 — scripts/ARIA (7.1 AT-compat, 7.3 keyboard, 7.5 status messages)
  "invalid-aria-role": ["7.1"], "aria-ref-missing-id": ["7.1"], "aria-required-children": ["7.1"],
  "aria-hidden-focusable": ["7.1"], "redundant-aria": ["7.1"], "nested-interactive": ["7.1"],
  "cross-prop-drilled-name-lost": ["7.1"],
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
  // Theme 8 — document (8.2 valid code, 8.3 default lang, 8.4 lang relevant, 8.5 title, 8.7/8.8 lang changes)
  "duplicate-id": ["8.2"], "axe:duplicate-id": ["8.2"], "axe:duplicate-id-aria": ["8.2"], "axe:duplicate-id-active": ["8.2"],
  "html-lang-missing": ["8.3"], "axe:html-has-lang": ["8.3"], "axe:html-xml-lang-mismatch": ["8.3"],
  "lang-invalid": ["8.4", "8.8"], "axe:html-lang-valid": ["8.4"], "axe:valid-lang": ["8.8"],
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
  // Stateful input-overflow probes — a filled input clipped under each stress, same RGAA
  // theme as the corresponding reflow/zoom/text-spacing residual probe above.
  "dyn-input-overflow-reflow": ["10.11"], "dyn-input-overflow-zoom": ["10.4"], "dyn-input-overflow-spacing": ["10.12"],
  // Theme 11 — forms (11.1 field label, 11.5 field grouping, 11.6 fieldset legend, 11.9 button label, 11.10 input control, 11.13 autocomplete)
  "control-label-missing": ["11.1"], "label-for-dangling": ["11.1"], "placeholder-as-label": ["11.1"],
  "form-field-multiple-labels": ["11.1"], "select-has-option": ["11.1"], "control-name-title-only": ["11.1"],
  "radio-checkbox-group-ungrouped": ["11.5"], "date-fields-ungrouped": ["11.5"],
  "field-purpose-incomplete": ["11.1", "11.13"], "fieldset-legend-missing": ["11.6"], "button-empty-name": ["11.9"],
  "error-not-associated": ["11.10"], "aria-invalid-no-description": ["11.10"],
  "axe:label": ["11.1"], "axe:form-field-multiple-labels": ["11.1"], "axe:select-name": ["11.1"], "axe:label-title-only": ["11.1"],
  "axe:autocomplete-valid": ["11.13"], "axe:fieldset": ["11.6"], "axe:input-button-name": ["11.9"], "axe:button-name": ["11.9"],
  // Theme 12 — navigation (12.7 skip link, 12.8 tab order)
  "skip-link-target-missing": ["12.7"], "axe:skip-link": ["12.7"], "axe:bypass": ["12.7"],
  "positive-tabindex": ["12.8"], "axe:tabindex": ["12.8"],
  // Theme 13 — consultation (13.1 time limits, 13.8 moving/blinking)
  "meta-refresh-redirect": ["13.1"], "blink-marquee": ["13.8"], "autoplay-media": ["4.10", "13.8"],
  "axe:no-autoplay-audio": ["4.10"], "axe:blink": ["13.8"], "axe:marquee": ["13.8"],
};

async function main() {
  const criteres = await source("criteres.json");
  const glossaire = await source("glossaire.json");

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

  // ---- Declarative pack RULE (usage proof): an RGAA-only ADVISORY recommendation, run by
  // the bounded interpreter (src/standards/pack-rules.ts) AFTER the core engine rules. It
  // flags a download link (`a[href$=".pdf"]` & co) whose VISIBLE TEXT states neither the
  // file format nor its weight — the DSFR/RGAA auditor recommendation under criterion 6.1
  // (link explicitness, WCAG 2.4.4). ADVISORY: it surfaces as a recommendation in the RGAA
  // projection and NEVER makes 6.1 non-conformant. This proves a pack ships its OWN
  // detection without forking the engine (see skills/ultra11y/references/packs.md).
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
  ];
  // Wire each rule's namespaced id (`pack:rgaa:<id>`) into the criterion it reports under,
  // so derivePackResults routes its finding onto that criterion through the same
  // appliesTo/ruleMatches machinery as engine findings (6.1 evidences no engine rule).
  for (const rule of rules) {
    const c = criteria.find((x) => x.id === rule.criterion);
    if (!c) throw new Error(`build-pack-rgaa: rule "${rule.id}" reports under unknown criterion "${rule.criterion}"`);
    c.appliesTo = { ruleIds: [...new Set([...c.appliesTo.ruleIds, `pack:rgaa:${rule.id}`])].sort() };
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
    themes,
    criteria,
  };

  const packText = biomeFormat(JSON.stringify(pack, null, 2) + "\n", "src/data/standards/rgaa.json");
  const glossaryText = biomeFormat(JSON.stringify(glossary, null, 2) + "\n", "src/data/standards/rgaa.glossary.json");

  if (doCheck) {
    const packPath = join(OUT, "rgaa.json");
    const glossaryPath = join(OUT, "rgaa.glossary.json");
    const drift = [];
    if (!existsSync(packPath) || readFileSync(packPath, "utf8") !== packText) drift.push("src/data/standards/rgaa.json");
    if (!existsSync(glossaryPath) || readFileSync(glossaryPath, "utf8") !== glossaryText)
      drift.push("src/data/standards/rgaa.glossary.json");
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

  const noWcag = criteria.filter((c) => c.wcag.length === 0).map((c) => c.id);
  console.log(`build-pack-rgaa: ${themes.length} themes, ${criteria.length} criteria → src/data/standards/rgaa.json`);
  console.log(`build-pack-rgaa: glossary ${Object.keys(glossary).length} entries → src/data/standards/rgaa.glossary.json`);
  console.log(`build-pack-rgaa: criteria with no WCAG mapping (pack-local): ${noWcag.length ? noWcag.join(", ") : "none"} (${noWcag.length})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

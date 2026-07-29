#!/usr/bin/env node
// DEV-ONLY (not in `bin`). Builds the canonical WCAG 2.2 Level AA dataset that the
// engine ships at src/data/wcag.json. The success-criterion list (id/title/level/
// version-added/principle/guideline) is DERIVED PROGRAMMATICALLY from the official
// W3C source (https://github.com/w3c/wcag) — never hand-typed — by positional
// numbering of guidelines/index.html, then decorated with the engine-specific
// fields (rule coverage, automatability, and manual-test seeds rolled up from any
// shipped standards pack). WCAG 2.2 © W3C, reused under the W3C Document License;
// only SC ids/titles/levels are reproduced. See NOTICE.
//
// Usage:
//   node scripts/build-standards.mjs                 # emit src/data/wcag.json + wcag-universe.json from the vendored snapshots
//   node scripts/build-standards.mjs --offline       # same (alias; the snapshots are always local)
//   node scripts/build-standards.mjs --refresh <dir> # re-derive the vendored AA snapshot from a w3c/wcag checkout
//   node scripts/build-standards.mjs --refresh-universe # re-fetch (network) the vendored FULL SC universe (all levels + removed 4.1.1)
//   node scripts/build-standards.mjs --refresh-fr    # re-fetch (network) the vendored French SC/guideline/principle titles
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(root, "src", "data");
const VENDOR = join(root, "scripts", "vendor", "wcag-2.2-sc.json");
const VENDOR_UNIVERSE = join(root, "scripts", "vendor", "wcag-2.2-sc-universe.json");
const VENDOR_FR = join(root, "scripts", "vendor", "wcag-2.2-fr.json");
const PACKS_DIR = join(DATA, "standards");
const BIOME = join(root, "node_modules", ".bin", "biome");

const VER_DIR = { 20: "2.0", 21: "2.1", 22: "2.2" };

// The committed src/data/*.json datasets are biome-formatted (short arrays collapse onto
// one line — see biome.json's default `--expand=auto`), not raw `JSON.stringify` output
// (see scripts/build-pack-rgaa.mjs, which solves the same problem for the RGAA pack).
// Route every write through biome so a bare rebuild is byte-stable vs the committed
// files; `relPath` (project-relative, e.g. "src/data/wcag.json") only picks the JSON
// formatter, no file is touched.
function biomeFormat(text, relPath) {
  return execFileSync(BIOME, ["format", `--stdin-file-path=${relPath}`], { input: text, encoding: "utf8" });
}

// ---------------------------------------------------------------------------
// Refresh mode: parse a w3c/wcag checkout into the vendored SC snapshot.
// SC numbers are positional within guidelines/index.html (principle → guideline →
// success-criterion include order) — exactly how the W3C Eleventy build numbers
// them. The obsolete 4.1.1 Parsing is still physically listed (so it must be
// counted to keep 4.1.2 correct) but has no conformance level and is dropped below.
// ---------------------------------------------------------------------------
function deriveSnapshot(srcDir) {
  const idx = readFileSync(join(srcDir, "guidelines", "index.html"), "utf8");
  const tok =
    /<section class="(principle|guideline)" id="([^"]+)">|<h([23])>\s*([\s\S]*?)\s*<\/h\3>|data-include="sc\/(\d+)\/([^"]+)\.html"/g;
  let p = 0,
    g = 0,
    s = 0,
    curP = null,
    curG = null,
    awaitP = false,
    awaitG = false;
  const principles = [];
  const guidelines = [];
  const criteria = [];
  let m;
  while ((m = tok.exec(idx))) {
    if (m[1] === "principle") {
      p++;
      g = 0;
      curP = { number: p, id: m[2], title: "" };
      principles.push(curP);
      awaitP = true;
    } else if (m[1] === "guideline") {
      g++;
      s = 0;
      curG = { number: `${p}.${g}`, id: m[2], title: "" };
      guidelines.push(curG);
      awaitG = true;
    } else if (m[3] === "2" && awaitP) {
      curP.title = m[4].replace(/\s+/g, " ").trim();
      awaitP = false;
    } else if (m[3] === "3" && awaitG) {
      curG.title = m[4].replace(/\s+/g, " ").trim();
      awaitG = false;
    } else if (m[5]) {
      s++;
      const version = Number(m[5]);
      const slug = m[6];
      const frag = readFileSync(join(srcDir, "guidelines", "sc", m[5], `${slug}.html`), "utf8");
      const title = (frag.match(/<h4>\s*([\s\S]*?)\s*<\/h4>/) || [])[1]?.replace(/\s+/g, " ").trim() ?? "";
      const level = (frag.match(/<p class="conformance-level">\s*([A]{1,3})\s*<\/p>/) || [])[1] ?? "";
      criteria.push({ sc: `${p}.${g}.${s}`, slug, title, level, addedIn: VER_DIR[version], principle: p, guideline: curG.number });
    }
  }
  const aa = criteria.filter((c) => (c.level === "A" || c.level === "AA") && c.sc !== "4.1.1");
  const usedGuidelines = new Set(aa.map((c) => c.guideline));
  const snapshot = {
    wcagVersion: "2.2",
    source: "https://www.w3.org/TR/WCAG22/",
    criteriaSource: "https://github.com/w3c/wcag",
    principles: principles.map((x) => ({ number: x.number, title: x.title })),
    guidelines: guidelines.filter((x) => usedGuidelines.has(x.number)).map((x) => ({ number: x.number, title: x.title })),
    criteria: aa,
  };
  mkdirSync(dirname(VENDOR), { recursive: true });
  writeFileSync(VENDOR, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`build-standards --refresh: ${aa.length} A/AA criteria derived from ${srcDir} → ${VENDOR}`);
  return snapshot;
}

// ---------------------------------------------------------------------------
// Universe mode: the COMPLETE WCAG 2.x success-criterion list — every level (A/AA/AAA)
// PLUS the obsolete/removed 4.1.1 Parsing — vendored so a pack's out-of-core SC mapping
// (e.g. an EN 301 549 criterion citing an AAA success criterion, or RGAA citing the
// removed 4.1.1) can be checked against the REAL W3C universe instead of a single
// hardcoded exception. deriveSnapshot() above already reads this same W3C numbering from
// a *local* w3c/wcag checkout, but only persists the shipped AA slice; this fetches
// (network, dev-only, mirrors scripts/build-pack-rgaa.mjs's own `--fetch` source
// vendoring) the same guidelines/index.html + every sc/<version>/<slug>.html fragment via
// raw.githubusercontent.com and vendors the UNFILTERED result — nothing invented, only
// the minimum extra data (id/title/level) needed to classify what falls outside the core.
// Re-run only when the W3C source changes (a WCAG erratum or new version):
//   node scripts/build-standards.mjs --refresh-universe
// ---------------------------------------------------------------------------
const RAW_BASE = "https://raw.githubusercontent.com/w3c/wcag/main";

async function fetchText(path) {
  const r = await fetch(`${RAW_BASE}/${path}`);
  if (!r.ok) throw new Error(`build-standards --refresh-universe: GET ${path} → HTTP ${r.status}`);
  return r.text();
}

async function deriveUniverse() {
  const idx = await fetchText("guidelines/index.html");
  const tok =
    /<section class="(principle|guideline)" id="([^"]+)">|<h([23])>\s*([\s\S]*?)\s*<\/h\3>|data-include="sc\/(\d+)\/([^"]+)\.html"/g;
  let p = 0,
    g = 0,
    s = 0,
    curP = null,
    curG = null,
    awaitP = false,
    awaitG = false;
  const principles = [];
  const guidelines = [];
  const stubs = []; // { sc, slug, version, principle, guideline } — title/level fetched next
  let m;
  while ((m = tok.exec(idx))) {
    if (m[1] === "principle") {
      p++;
      g = 0;
      curP = { number: p, title: "" };
      principles.push(curP);
      awaitP = true;
    } else if (m[1] === "guideline") {
      g++;
      s = 0;
      curG = { number: `${p}.${g}`, title: "" };
      guidelines.push(curG);
      awaitG = true;
    } else if (m[3] === "2" && awaitP) {
      curP.title = m[4].replace(/\s+/g, " ").trim();
      awaitP = false;
    } else if (m[3] === "3" && awaitG) {
      curG.title = m[4].replace(/\s+/g, " ").trim();
      awaitG = false;
    } else if (m[5]) {
      s++;
      stubs.push({ sc: `${p}.${g}.${s}`, slug: m[6], version: Number(m[5]), principle: p, guideline: curG.number });
    }
  }

  const criteria = [];
  for (const stub of stubs) {
    const frag = await fetchText(`guidelines/sc/${stub.version}/${stub.slug}.html`);
    const title = (frag.match(/<h4>\s*([\s\S]*?)\s*<\/h4>/) || [])[1]?.replace(/\s+/g, " ").trim() ?? "";
    // No <p class="conformance-level"> at all ⇒ the SC has no current level — the
    // (so far unique) case is the obsolete/removed 4.1.1 Parsing.
    const level = (frag.match(/<p class="conformance-level">\s*([A]{1,3})\s*<\/p>/) || [])[1] ?? "";
    const status = !level ? "removed" : level === "AAA" ? "out-of-core" : "core-AA";
    criteria.push({
      sc: stub.sc,
      slug: stub.slug,
      title,
      level,
      addedIn: VER_DIR[stub.version],
      principle: stub.principle,
      guideline: stub.guideline,
      status,
    });
  }

  const universe = {
    wcagVersion: "2.2",
    source: "https://www.w3.org/TR/WCAG22/",
    criteriaSource: "https://github.com/w3c/wcag",
    provenance:
      `Full WCAG 2.x SC universe (all levels incl. AAA, and the removed 4.1.1 Parsing) fetched from ` +
      `raw.githubusercontent.com/w3c/wcag@main on ${new Date().toISOString().slice(0, 10)} via ` +
      "`node scripts/build-standards.mjs --refresh-universe`. Classification: core-AA = ships in " +
      "src/data/wcag.json (the shipped WCAG 2.2 AA core); out-of-core = WCAG AAA; removed = obsolete (4.1.1).",
    principles,
    guidelines,
    criteria,
  };
  mkdirSync(dirname(VENDOR_UNIVERSE), { recursive: true });
  writeFileSync(VENDOR_UNIVERSE, JSON.stringify(universe, null, 2) + "\n");
  console.log(`build-standards --refresh-universe: ${criteria.length} SCs (all levels) derived → ${VENDOR_UNIVERSE}`);
  return universe;
}

// ---------------------------------------------------------------------------
// French-titles mode: fetch the W3C AUTHORIZED French translation of WCAG 2.2
// (https://www.w3.org/Translations/WCAG22-fr/ — a single-page document, unlike the
// split w3c/wcag English source) and vendor ONLY the principle/guideline/SC TITLES for
// the shipped AA core (nothing invented, no paraphrase — every title is lifted verbatim
// from this page). The fr page numbers every heading exactly like the English source
// (<bdi class="secno">1.4.3 </bdi>) — h2 = principle ("1. "), h3 = guideline ("Règle
// 1.1 "), h4 = success criterion ("Critère de succès 1.1.1 ") — so titles are read
// directly off the dotted id, no positional counting needed. Re-run only when the W3C
// translation changes: node scripts/build-standards.mjs --refresh-fr
// ---------------------------------------------------------------------------
const FR_SOURCE = "https://www.w3.org/Translations/WCAG22-fr/";

// Minimal HTML → plaintext (mirrors scripts/build-pack-rgaa.mjs's `deHtml`): the fr
// titles are plain text, so this only needs to strip stray tags/entities, not full markup.
function deHtmlFr(s) {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;|&#8217;/g, "’")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function deriveFr() {
  if (!existsSync(VENDOR)) {
    console.error(`build-standards --refresh-fr: missing vendored English snapshot ${VENDOR}. Run: node scripts/build-standards.mjs --refresh <w3c/wcag checkout> first.`);
    process.exit(1);
  }
  const snap = JSON.parse(readFileSync(VENDOR, "utf8"));
  const r = await fetch(FR_SOURCE);
  if (!r.ok) throw new Error(`build-standards --refresh-fr: GET ${FR_SOURCE} → HTTP ${r.status}`);
  const html = await r.text();

  // <h2|h3|h4><bdi class="secno">[prefix ]<id>[.] </bdi>Title</hN> — id is the bare
  // dotted number ("1" for a principle, "1.1" for a guideline, "1.1.1" for an SC); the
  // "Règle "/"Critère de succès " word prefixes and level are NOT captured, only the id.
  const tok = /<h([234])[^>]*>\s*<bdi class="secno">([^<]*)<\/bdi>\s*([\s\S]*?)<\/h\1>/g;
  const rawPrinciples = {};
  const rawGuidelines = {};
  const rawCriteria = {};
  let m;
  while ((m = tok.exec(html))) {
    const idMatch = m[2].match(/(\d+(?:\.\d+)*)/);
    if (!idMatch) continue;
    const id = idMatch[1];
    const title = deHtmlFr(m[3]);
    if (m[1] === "2") {
      if (/^[1-4]$/.test(id)) rawPrinciples[id] = title; // "5./6./7." are Conformance/Glossary/Input-purposes, not WCAG principles
    } else if (m[1] === "3") rawGuidelines[id] = title;
    else if (m[1] === "4") rawCriteria[id] = title;
  }

  // Only vendor what the shipped AA core actually needs — cross-referenced against the
  // English snapshot's own principle/guideline/SC id lists, never a blind full-page dump.
  const principles = {};
  const guidelines = {};
  const criteria = {};
  const missing = [];
  for (const p of snap.principles) {
    const t = rawPrinciples[String(p.number)];
    if (t) principles[String(p.number)] = t;
    else missing.push(`principle ${p.number}`);
  }
  for (const g of snap.guidelines) {
    const t = rawGuidelines[g.number];
    if (t) guidelines[g.number] = t;
    else missing.push(`guideline ${g.number}`);
  }
  for (const c of snap.criteria) {
    const t = rawCriteria[c.sc];
    if (t) criteria[c.sc] = t;
    else missing.push(`SC ${c.sc}`);
  }
  if (missing.length) {
    console.error(`build-standards --refresh-fr: no French title found on ${FR_SOURCE} for: ${missing.join(", ")}. Nothing invented — refusing to vendor a partial/paraphrased dataset.`);
    process.exit(1);
  }

  const out = {
    source: FR_SOURCE,
    fetchedAt: new Date().toISOString().slice(0, 10),
    principles,
    guidelines,
    criteria,
  };
  mkdirSync(dirname(VENDOR_FR), { recursive: true });
  writeFileSync(VENDOR_FR, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `build-standards --refresh-fr: ${Object.keys(criteria).length} SC + ${Object.keys(guidelines).length} guideline + ${Object.keys(principles).length} principle French titles → ${VENDOR_FR}`,
  );
  return out;
}

// ---------------------------------------------------------------------------
// Engine-specific decoration (the only hand-maintained part: which SCs the static
// engine can fully decide, which need a rendered DOM, and the per-SC rule coverage).
// ---------------------------------------------------------------------------

// An SC is `static` (absence of a finding can be reported Conforming) ONLY when the
// engine both detects every failure AND can judge applicability. WCAG SCs are coarser
// than the rules, so this set is deliberately tiny — every other mapped SC raises
// DEFINITE non-conformities on a finding and stays `manual` (residual risk) otherwise,
// never silently Conforming.
const STATIC = new Set(["1.4.2", "2.4.2", "3.1.1"]);

// SCs that fundamentally need a rendered DOM (computed colour/layout/focus/zoom).
// They may still carry rules that raise definite NCs; no finding ⇒ `manual`.
const NEEDS_RENDERING = new Set([
  "1.3.4", "1.4.1", "1.4.3", "1.4.4", "1.4.5", "1.4.10", "1.4.11", "1.4.12", "1.4.13",
  "2.1.2", "2.3.1", "2.4.7", "2.4.11", "2.5.8",
]);

// SC → engine rule ids. Inverse of the per-finding rule→SC map. Rules whose findings
// branch across SCs (clickable-noninteractive, lang-invalid, autoplay-media,
// icon-only-control-unnamed) appear under BOTH their SCs so registry's bidirectional
// rule↔dataset cross-check holds.
const RULE_SC_COVERAGE = {
  "1.1.1": ["img-alt-missing", "canvas-fallback-missing", "decorative-alt-misuse", "input-image-alt-missing", "object-embed-no-name", "chart-no-accessible-name"],
  "1.2.2": ["media-no-track"],
  "1.3.1": [
    "fieldset-legend-missing", "data-table-no-headers", "table-caption-missing",
    "layout-table-data-markup", "heading-order-skip", "h1-missing", "h1-multiple", "list-structure", "dl-structure",
    "empty-heading", "label-for-dangling", "missing-main-landmark", "multiple-main-landmark",
    "sortable-header-no-aria-sort", "nav-landmark-missing", "nav-landmark-unnamed", "aria-required-parent",
    "headers-attr-dangling", "th-no-data-cells",
    "radio-checkbox-group-ungrouped", "table-empty-data-cell", "css-generated-content-informative",
  ],
  "1.3.5": ["field-purpose-incomplete", "autocomplete-token-invalid"],
  "1.4.2": ["autoplay-media"],
  "1.3.4": ["rendered-orientation-lock"],
  "1.4.1": ["rendered-link-colour-only"],
  "1.4.3": ["contrast-literal", "rendered-contrast", "rendered-contrast-pixel"],
  "1.4.11": ["rendered-nontext-contrast"],
  "1.4.4": ["meta-viewport-zoom-block"],
  "2.1.1": ["clickable-noninteractive"],
  "2.2.1": ["meta-refresh-redirect"],
  "2.2.2": ["autoplay-media", "blink-marquee"],
  "2.4.1": ["skip-link-target-missing"],
  "2.4.2": ["title-missing-empty"],
  "2.4.3": ["positive-tabindex"],
  "2.4.7": ["rendered-focus-not-visible"],
  "2.4.4": ["link-empty-name", "icon-only-control-unnamed"],
  "2.5.3": ["label-in-name-mismatch"],
  "3.2.2": ["on-input-context-change"],
  "3.3.8": ["credential-entry-blocked"],
  "3.1.1": ["html-lang-missing", "lang-invalid"],
  "3.1.2": ["inline-lang-change-missing", "lang-invalid"],
  "3.3.1": ["aria-invalid-no-description", "error-not-associated"],
  "3.3.2": ["radio-checkbox-group-ungrouped", "date-fields-ungrouped"],
  "4.1.2": [
    "iframe-title-missing", "invalid-aria-role", "aria-ref-missing-id", "redundant-aria",
    "clickable-noninteractive", "aria-required-children", "aria-hidden-focusable", "nested-interactive", "invalid-aria-attr", "invalid-aria-value", "aria-required-attr", "aria-prohibited-attr",
    "duplicate-id", "control-label-missing", "placeholder-as-label", "form-field-multiple-labels",
    "select-has-option", "button-empty-name", "icon-only-control-unnamed", "control-name-title-only",
    "field-purpose-incomplete", "disabled-context-content",
  ],
  "4.1.3": ["live-region-conflict", "status-message-not-assertive"],
};

function automatabilityOf(sc) {
  if (STATIC.has(sc)) return "static";
  if (NEEDS_RENDERING.has(sc)) return "needs-rendering";
  return "judgment";
}

// Best-effort, language-NEUTRAL technique seeds: roll up every shipped standards pack's
// criteria onto the WCAG SCs they map to. Only the W3C technique CODES (e.g. "H36",
// "ARIA6") are carried — they are language-neutral, so the WCAG core stays
// English-clean. Localized test PROSE stays in the packs; the WCAG `verify` worklist
// grounds on these codes + each SC's W3C Understanding URL instead.
function seedFromPacks() {
  const techniques = {}; // sc -> string[]
  const sources = [];
  if (existsSync(PACKS_DIR)) {
    for (const f of readdirSync(PACKS_DIR)) if (f.endsWith(".json") && !f.endsWith(".glossary.json")) sources.push(join(PACKS_DIR, f));
  }
  for (const path of sources) {
    let pack;
    try {
      pack = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    for (const c of pack.criteria || []) {
      // Packs map to bare SC ids, e.g. "1.1.1".
      const scs = (c.wcag || []).map((w) => String(w).trim().split(/\s+/)[0]);
      for (const sc of scs) if (Array.isArray(c.techniques)) (techniques[sc] ??= []).push(...c.techniques);
    }
  }
  const dedup = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...new Set(v)].sort()]));
  return { techniques: dedup(techniques), sources };
}

// Emit src/data/wcag-universe.json — the classification dataset src/wcag.ts
// `knownScStatus()` loads — from the vendored full universe. `shipped` is the AA
// criteria list `build()` just wrote to wcag.json: the guard below fails loudly if the
// two independently-vendored snapshots ever disagree on what's in the core.
function buildUniverse(shipped) {
  if (!existsSync(VENDOR_UNIVERSE)) {
    console.error(`build-standards: missing vendored universe snapshot ${VENDOR_UNIVERSE}. Run: node scripts/build-standards.mjs --refresh-universe`);
    process.exit(1);
  }
  const univ = JSON.parse(readFileSync(VENDOR_UNIVERSE, "utf8"));
  const criteria = univ.criteria.map((c) => ({ id: c.sc, title: c.title, level: c.level, status: c.status }));
  const out = {
    wcagVersion: univ.wcagVersion,
    source: univ.source,
    criteriaSource: univ.criteriaSource,
    provenance: univ.provenance,
    criteria,
  };
  mkdirSync(DATA, { recursive: true });
  writeFileSync(join(DATA, "wcag-universe.json"), biomeFormat(JSON.stringify(out, null, 2) + "\n", "src/data/wcag-universe.json"));

  const coreIds = new Set(criteria.filter((c) => c.status === "core-AA").map((c) => c.id));
  const shippedIds = new Set(shipped.map((c) => c.sc));
  const missingFromUniverse = [...shippedIds].filter((id) => !coreIds.has(id));
  const extraInUniverse = [...coreIds].filter((id) => !shippedIds.has(id));
  if (missingFromUniverse.length || extraInUniverse.length) {
    console.error(
      `build-standards: wcag-universe.json's core-AA set disagrees with src/data/wcag.json — ` +
        `missing: ${missingFromUniverse.join(", ") || "none"}; extra: ${extraInUniverse.join(", ") || "none"}`,
    );
    process.exit(1);
  }
  const tally = { "core-AA": 0, "out-of-core": 0, removed: 0 };
  for (const c of criteria) tally[c.status]++;
  console.log(
    `build-standards: ${criteria.length} WCAG 2.x SCs classified — core-AA ${tally["core-AA"]}, out-of-core ${tally["out-of-core"]}, removed ${tally.removed} → src/data/wcag-universe.json`,
  );
}

function build() {
  if (!existsSync(VENDOR)) {
    console.error(`build-standards: missing vendored snapshot ${VENDOR}. Run: node scripts/build-standards.mjs --refresh <w3c/wcag checkout>`);
    process.exit(1);
  }
  if (!existsSync(VENDOR_FR)) {
    console.error(`build-standards: missing vendored French titles ${VENDOR_FR}. Run: node scripts/build-standards.mjs --refresh-fr`);
    process.exit(1);
  }
  const snap = JSON.parse(readFileSync(VENDOR, "utf8"));
  const fr = JSON.parse(readFileSync(VENDOR_FR, "utf8"));
  const { techniques, sources } = seedFromPacks();

  // Completeness guard: every shipped core-AA SC/guideline/principle MUST carry a French
  // title from the vendored W3C authorized translation — never a silent English-only
  // fallback in the shipped dataset (src/wcag.ts still falls back at read time for older
  // snapshots, but a freshly-built one is never allowed to be incomplete).
  // `?? {}` guards a corrupted/partial vendor file (e.g. missing a top-level
  // principles/guidelines/criteria key) so it is reported through the clean
  // "missing a French title for: …" gate below, not a raw TypeError.
  const frPrinciples = fr.principles ?? {};
  const frGuidelines = fr.guidelines ?? {};
  const frCriteria = fr.criteria ?? {};
  const missingFr = [
    ...snap.principles.filter((p) => !frPrinciples[String(p.number)]).map((p) => `principle ${p.number}`),
    ...snap.guidelines.filter((g) => !frGuidelines[g.number]).map((g) => `guideline ${g.number}`),
    ...snap.criteria.filter((c) => !frCriteria[c.sc]).map((c) => `SC ${c.sc}`),
  ];
  if (missingFr.length) {
    console.error(`build-standards: ${VENDOR_FR} is missing a French title for: ${missingFr.join(", ")}. Re-run: node scripts/build-standards.mjs --refresh-fr`);
    process.exit(1);
  }

  const principles = snap.principles.map((p) => ({ number: p.number, title: p.title, titleFr: frPrinciples[String(p.number)] }));
  const guidelines = snap.guidelines.map((g) => ({ number: g.number, title: g.title, titleFr: frGuidelines[g.number] }));

  const criteria = snap.criteria.map((c) => {
    const sc = {
      sc: c.sc,
      principle: c.principle,
      guideline: c.guideline,
      title: c.title,
      titleFr: frCriteria[c.sc],
      level: c.level,
      addedIn: c.addedIn,
      automatability: automatabilityOf(c.sc),
      ruleIds: RULE_SC_COVERAGE[c.sc] || [],
      understanding: `https://www.w3.org/WAI/WCAG22/Understanding/${c.slug}.html`,
    };
    if (techniques[c.sc]?.length) sc.techniques = techniques[c.sc];
    return sc;
  });

  const out = {
    wcagVersion: snap.wcagVersion,
    level: "AA",
    source: snap.source,
    license: "W3C Document License",
    criteriaSource: snap.criteriaSource,
    principles,
    guidelines,
    criteria,
  };
  mkdirSync(DATA, { recursive: true });
  writeFileSync(join(DATA, "wcag.json"), biomeFormat(JSON.stringify(out, null, 2) + "\n", "src/data/wcag.json"));

  // --- guards
  const all = new Set(criteria.map((c) => c.sc));
  const missingForRules = Object.keys(RULE_SC_COVERAGE).filter((sc) => !all.has(sc));
  if (missingForRules.length) {
    console.error(`build-standards: RULE_SC_COVERAGE references SCs absent from the dataset: ${missingForRules.join(", ")}`);
    process.exit(1);
  }
  // Any pack referencing an SC not in the core is a dangling ref (e.g. dropped 4.1.1).
  for (const path of sources) {
    const pack = JSON.parse(readFileSync(path, "utf8"));
    if (!pack.criteria) continue;
    const dangling = new Set();
    for (const c of pack.criteria) for (const w of c.wcag || []) {
      const id = String(w).trim().split(/\s+/)[0];
      if (!all.has(id)) dangling.add(id);
    }
    if (dangling.size) console.warn(`build-standards: ${path} maps to SCs absent from WCAG 2.2 AA core: ${[...dangling].sort().join(", ")} (expected for out-of-core SCs — WCAG AAA or removed/obsolete)`);
  }

  const tally = { static: 0, "needs-rendering": 0, judgment: 0 };
  for (const c of criteria) tally[c.automatability]++;
  console.log(`build-standards: ${criteria.length} WCAG 2.2 A/AA criteria → src/data/wcag.json`);
  console.log(`build-standards: automatability — static ${tally.static}, needs-rendering ${tally["needs-rendering"]}, judgment ${tally.judgment}`);
  console.log(`build-standards: seeded techniques from ${sources.length ? sources.map((s) => s.replace(root + "/", "")).join(", ") : "(no pack found — empty)"}`);

  buildUniverse(criteria);
}

async function main() {
  const refreshIdx = process.argv.indexOf("--refresh");
  if (refreshIdx !== -1) deriveSnapshot(process.argv[refreshIdx + 1]);
  if (process.argv.includes("--refresh-universe")) await deriveUniverse();
  if (process.argv.includes("--refresh-fr")) await deriveFr();
  build();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

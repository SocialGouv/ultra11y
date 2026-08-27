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
//   node scripts/build-standards.mjs --refresh-core # re-derive the shipped AA snapshot from that universe (no checkout, no network)
//   node scripts/build-standards.mjs --refresh-fr    # re-fetch (network) the vendored French SC/guideline/principle titles
//   node scripts/build-standards.mjs --refresh-text  # re-fetch (network) the vendored NORMATIVE SC text + the WCAG glossary
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(root, "src", "data");
const VENDOR = join(root, "scripts", "vendor", "wcag-2.2-sc.json");
const VENDOR_UNIVERSE = join(root, "scripts", "vendor", "wcag-2.2-sc-universe.json");
const VENDOR_FR = join(root, "scripts", "vendor", "wcag-2.2-fr.json");
const VENDOR_TEXT = join(root, "scripts", "vendor", "wcag-2.2-text.json");
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

// CHECK MODE — the gate this generator was the only one of the three to lack.
//
// scripts/build-pack-rgaa.mjs and scripts/build-guidance-wcag.mjs both compare their
// generated text to the committed file and exit 1 on drift; this one only ever wrote. So a
// hand edit to src/data/wcag.json passed every gate and was found by the NIGHTLY refresh
// instead — on main, a day later, in a workflow nobody watches. Measured: SC 1.3.1 carried
// three presentational-* rules that RULE_SC_COVERAGE below never cited, and
// standards-refresh went red every night for two days before anyone read the log.
//
// Every write goes through `emit` so the check compares EXACTLY what a build would write —
// a check that recomputed the text a second way could agree with itself and still be wrong.
const CHECK = process.argv.includes("--check");
const drift = [];
function emit(relPath, text) {
  const abs = join(root, relPath);
  if (CHECK) {
    if (!existsSync(abs) || readFileSync(abs, "utf8") !== text) drift.push(relPath);
    return;
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
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

// The French page's own chrome, normalized to the shapes `deHtmlText` already knows.
//
// The single-page translation wraps a note or an example in
// `<div class="note"><div role="heading">…Note 1…</div><p>…</p></div>`, where the English
// fragments use a flat `<p class="note">`. Collapsing the heading AND the paragraph opener
// that follows keeps the label on the same line as the text it labels — "Note : …", not a
// bare "Note :" followed by an orphaned sentence.
function deHtmlFrBody(html, opts) {
  let s = html;
  s = s.replace(/<a class="self-link"[\s\S]*?<\/a>/gi, "");
  s = s.replace(/<div class="doclinks">[\s\S]*?<\/div>/gi, "");
  s = s.replace(/<div class="(note|example)"[^>]*>\s*<div role="heading"[^>]*>([\s\S]*?)<\/div>\s*(?:<p[^>]*>)?/gi, (_, _kind, heading) => {
    // "Note 1" / "Note 2" are numbered per document; the number is noise in a lookup.
    const label = heading
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s*\d+$/, "");
    return ` ${label} : `;
  });
  return deHtmlText(s, opts);
}

/** The criterion bodies and the glossary, off the French single-page translation. */
function deriveFrBodies(html, snap) {
  // Every numbered heading, in document order: an SC's body is what sits between its own
  // heading and the next one. The page numbers headings exactly like the English source.
  const HEAD = /<h([234])[^>]*>\s*<bdi class="secno">([^<]*)<\/bdi>([\s\S]*?)<\/h\1>/g;
  const heads = [];
  let m;
  while ((m = HEAD.exec(html))) {
    const id = (m[2].match(/(\d+(?:\.\d+)*)/) || [])[1];
    heads.push({ level: Number(m[1]), id, end: m.index + m[0].length, start: m.index });
  }

  const criteriaText = {};
  const criteriaTerms = {};
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    if (h.level !== 4 || !h.id || h.id.split(".").length !== 3) continue;
    const slice = html.slice(h.end, heads[i + 1]?.start ?? html.length);
    const body = deHtmlFrBody(slice);
    if (body) criteriaText[h.id] = body;
    // The FR page names its definitions with its OWN slugs — often the plural
    // ("user-agents" where the English source file is "user-agent"), sometimes a different
    // phrase entirely ("purpose-of-each-link" for "link-purpose"). Mapping one onto the
    // other would be a guess, so each language keeps its own term list and its own
    // glossary keys, and neither has to know about the other.
    const cited = [...new Set([...slice.matchAll(/href="#dfn-([a-z0-9-]+)"/g)].map((x) => x[1]))];
    if (cited.length) criteriaTerms[h.id] = cited;
  }

  // The glossary: `<dfn id="dfn-<slug>">title</dfn></dt>` then the definition up to the
  // next term. The slugs are the SAME as the English source's file names, so the two
  // languages key identically and a criterion's term links resolve in either.
  // Attribute order is not guaranteed: the FR page writes `data-lt` before `id`.
  const DFN = /<dfn\b[^>]*\bid="dfn-([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/dfn>/g;
  const glossary = {};
  while ((m = DFN.exec(html))) {
    const title = m[2]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const after = html.slice(m.index + m[0].length);
    const stop = after.search(/<dt[\s>]|<\/dl>/i);
    const body = deHtmlFrBody(after.slice(0, stop === -1 ? 8000 : stop));
    if (title && body) glossary[m[1]] = { title, body };
  }

  // Same completeness rule as the titles: every SHIPPED criterion carries its French body
  // or the build refuses. A half-translated reference is worse than a known-absent one,
  // because the reader cannot tell which criteria they are missing.
  const missing = snap.criteria.filter((c) => !criteriaText[c.sc]).map((c) => c.sc);
  if (missing.length) {
    console.error(
      `build-standards --refresh-fr: no French body found on ${FR_SOURCE} for SC: ${missing.join(", ")}. Nothing invented — refusing to vendor a partial set.`,
    );
    process.exit(1);
  }
  return { criteriaText, criteriaTerms, glossary };
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

  // The same page carries each criterion's NORMATIVE BODY and the glossary, not just the
  // titles. Vendoring only the titles left `--lang fr` rendering a French heading over
  // English requirement prose — the jarring half-translation an RGAA auditor reads first.
  const { criteriaText, criteriaTerms, glossary } = deriveFrBodies(html, snap);

  const out = {
    source: FR_SOURCE,
    fetchedAt: new Date().toISOString().slice(0, 10),
    principles,
    guidelines,
    criteria,
    criteriaText,
    criteriaTerms,
    glossary,
  };
  mkdirSync(dirname(VENDOR_FR), { recursive: true });
  writeFileSync(VENDOR_FR, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `build-standards --refresh-fr: ${Object.keys(criteria).length} SC + ${Object.keys(guidelines).length} guideline + ${Object.keys(principles).length} principle French titles, ` +
      `${Object.keys(criteriaText).length} SC bodies, ${Object.keys(glossary).length} glossary terms → ${VENDOR_FR}`,
  );
  return out;
}

// ---------------------------------------------------------------------------
// Core mode: the shipped AA snapshot, derived from the vendored UNIVERSE.
//
// `deriveSnapshot` above reads a local w3c/wcag checkout, which is why it was the one
// vendored source the daily refresh could not touch — a new or renamed success criterion
// would land in the universe and never reach the shipped core.
//
// It needs no checkout and no extra network: `--refresh-universe` already fetches the same
// numbering and titles for EVERY criterion, and records which are `core-AA`. The AA slice
// is that filter. Byte-identical to what the checkout produces (tests/wcag-core-sync).
//
//   node scripts/build-standards.mjs --refresh-core
// ---------------------------------------------------------------------------
function deriveCoreFromUniverse() {
  if (!existsSync(VENDOR_UNIVERSE)) {
    console.error(`build-standards --refresh-core: missing ${VENDOR_UNIVERSE}. Run: node scripts/build-standards.mjs --refresh-universe`);
    process.exit(1);
  }
  const universe = JSON.parse(readFileSync(VENDOR_UNIVERSE, "utf8"));
  const aa = universe.criteria.filter((c) => c.status === "core-AA").map(({ status, ...rest }) => rest);
  if (!aa.length) {
    console.error(`build-standards --refresh-core: ${VENDOR_UNIVERSE} classifies no criterion as core-AA — refusing to write an empty core.`);
    process.exit(1);
  }
  const used = new Set(aa.map((c) => c.guideline));
  const snapshot = {
    wcagVersion: universe.wcagVersion,
    source: universe.source,
    criteriaSource: universe.criteriaSource,
    principles: universe.principles.map((p) => ({ number: p.number, title: p.title })),
    guidelines: universe.guidelines.filter((g) => used.has(g.number)).map((g) => ({ number: g.number, title: g.title })),
    criteria: aa,
  };
  return JSON.stringify(snapshot, null, 2) + "\n";
}

function refreshCore() {
  const text = deriveCoreFromUniverse();
  mkdirSync(dirname(VENDOR), { recursive: true });
  writeFileSync(VENDOR, text);
  console.log(`build-standards --refresh-core: ${JSON.parse(text).criteria.length} A/AA criteria derived from the vendored universe → ${VENDOR}`);
}

// ---------------------------------------------------------------------------
// Text mode: the NORMATIVE WORDING of every shipped success criterion, plus the terms
// WCAG itself defines.
//
// The dataset used to carry only ids, titles and an Understanding URL — so an offline
// agent could name a criterion but not read it, and had to recall the requirement from
// memory. That is exactly how invented non-conformities get written. The RGAA pack ships
// its full criterion text and a 119-entry glossary; the worldwide core shipped neither.
//
// Nothing new is fetched: `deriveUniverse` already downloads these very fragments and
// keeps only the <h4> and the conformance level. WCAG 2.2 © W3C, reused under the W3C
// Document License; see NOTICE.
//
//   node scripts/build-standards.mjs --refresh-text
// ---------------------------------------------------------------------------
const ENTITIES = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
  "&times;": "×",
};

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m] ?? m);
}

// W3C fragment → normative plaintext. Structure that CHANGES THE READING is kept as its
// own labelled line — an exception's name ("Large Text:") decides whether the exception
// applies, and a note is not normative the way the sentence above it is. Everything else
// is flattened, because the source wraps mid-sentence.
function deHtmlText(html, { dropDfn = false } = {}) {
  const SEP = " ";
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  // The fragment's own chrome: title, conformance level, the 2.2 "New"/"Updated" marker.
  s = s.replace(/<h4>[\s\S]*?<\/h4>/gi, "");
  s = s.replace(/<p class="conformance-level">[\s\S]*?<\/p>/gi, "");
  s = s.replace(/<p class="change">[\s\S]*?<\/p>/gi, "");
  if (dropDfn) s = s.replace(/<dt>[\s\S]*?<\/dt>/i, "");
  s = s.replace(/<p class="note">/gi, `${SEP}Note: `);
  s = s.replace(/<aside class="example">/gi, `${SEP}Example: `);
  s = s.replace(/<dt>([\s\S]*?)<\/dt>\s*<dd>/gi, (_, t) => `${SEP}${t.replace(/<[^>]+>/g, "").trim()}: `);
  s = s.replace(/<li>/gi, `${SEP}• `);
  s = s.replace(/<\/(p|dd|li|dl|ul|ol|aside|section|div|blockquote)>/gi, SEP);
  s = s.replace(/<(p|dd|aside|div|blockquote)\b[^>]*>/gi, SEP);
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s
    .split(SEP)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const VER_OF = { "2.0": "20", "2.1": "21", "2.2": "22" };

async function fetchJson(url) {
  const r = await fetch(url, { headers: { accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error(`build-standards --refresh-text: GET ${url} → HTTP ${r.status}`);
  return r.json();
}

async function deriveText() {
  if (!existsSync(VENDOR)) {
    console.error(`build-standards --refresh-text: missing vendored snapshot ${VENDOR}. Run --refresh first.`);
    process.exit(1);
  }
  const snap = JSON.parse(readFileSync(VENDOR, "utf8"));

  // The terms WCAG defines, across all three version directories. Built FIRST, because a
  // criterion's wording links to them and those links are what makes the definitions
  // findable from the criterion.
  const glossary = {};
  const bySurface = new Map();
  const fold = (s) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  for (const ver of ["20", "21", "22"]) {
    const listing = await fetchJson(`https://api.github.com/repos/w3c/wcag/contents/guidelines/terms/${ver}`);
    for (const file of listing) {
      if (file.type !== "file" || !file.name.endsWith(".html")) continue;
      const html = await fetchText(`guidelines/terms/${ver}/${file.name}`);
      const dfn = html.match(/<dfn([^>]*)>([\s\S]*?)<\/dfn>/);
      const title = dfn?.[2]?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      const body = deHtmlText(html, { dropDfn: true });
      if (!title || !body) {
        console.error(`build-standards --refresh-text: terms/${ver}/${file.name} has no <dfn> title or no body — refusing to vendor a partial glossary.`);
        process.exit(1);
      }
      // Keyed by the W3C's own dfn slug, so a criterion's prose can point at it.
      const slug = file.name.replace(/\.html$/, "");
      glossary[slug] = { title, body };
      // `data-lt` lists the other surface forms the spec links this term by ("accessibility
      // support" → accessibility-supported), so a link in a criterion resolves either way.
      const lt = (dfn?.[1]?.match(/data-lt="([^"]*)"/) || [])[1];
      for (const surface of [title, ...(lt ? lt.split("|") : [])]) bySurface.set(fold(surface), slug);
    }
  }

  const criteria = {};
  const terms = {};
  for (const c of snap.criteria) {
    const ver = VER_OF[c.addedIn];
    if (!ver) throw new Error(`build-standards --refresh-text: unknown addedIn "${c.addedIn}" for SC ${c.sc}`);
    const html = await fetchText(`guidelines/sc/${ver}/${c.slug}.html`);
    const text = deHtmlText(html);
    if (!text) throw new Error(`build-standards --refresh-text: empty normative text for SC ${c.sc} (${c.slug})`);
    criteria[c.sc] = text;
    // A bare `<a>` with no href IS a glossary reference in the W3C source — that is how the
    // spec marks a defined term. Resolved here rather than by matching prose, so a term is
    // attached because the criterion cites it, never because a word happened to appear.
    const cited = new Set();
    for (const m of html.matchAll(/<a>([\s\S]*?)<\/a>/g)) {
      const slug = bySurface.get(fold(m[1].replace(/<[^>]+>/g, "")));
      if (slug) cited.add(slug);
    }
    if (cited.size) terms[c.sc] = [...cited];
  }

  const out = {
    source: "https://github.com/w3c/wcag",
    license: "W3C Document License",
    fetchedAt: new Date().toISOString().slice(0, 10),
    criteria,
    terms,
    glossary,
  };
  mkdirSync(dirname(VENDOR_TEXT), { recursive: true });
  writeFileSync(VENDOR_TEXT, JSON.stringify(out, null, 2) + "\n");
  console.log(`build-standards --refresh-text: ${Object.keys(criteria).length} SC texts + ${Object.keys(glossary).length} glossary terms → ${VENDOR_TEXT}`);
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
  "1.1.1": ["img-alt-missing", "canvas-fallback-missing", "decorative-alt-misuse", "decorative-marked-exposed", "input-image-alt-missing", "object-embed-no-name", "chart-no-accessible-name"],
  "1.2.2": ["media-no-track"],
  "1.3.1": [
    "fieldset-legend-missing", "data-table-no-headers", "table-caption-missing",
    "layout-table-data-markup", "heading-order-skip", "h1-missing", "h1-multiple", "list-structure", "dl-structure",
    "empty-heading", "label-for-dangling", "missing-main-landmark", "multiple-main-landmark",
    "sortable-header-no-aria-sort", "nav-landmark-missing", "nav-landmark-unnamed", "aria-required-parent",
    "headers-attr-dangling", "th-no-data-cells", "table-scope-invalid",
    "radio-checkbox-group-ungrouped", "table-empty-data-cell", "css-generated-content-informative",
    "presentational-element", "presentational-attribute", "presentational-spacing",
  ],
  "1.3.5": ["field-purpose-incomplete", "autocomplete-token-invalid"],
  "1.4.2": ["autoplay-media"],
  "1.3.4": ["rendered-orientation-lock"],
  "1.4.1": ["rendered-link-colour-only"],
  "1.4.3": ["contrast-literal", "rendered-contrast", "rendered-contrast-pixel"],
  "1.4.11": ["rendered-nontext-contrast"],
  "1.4.12": ["letter-spacing-important", "word-spacing-important", "line-height-important"],
  "1.4.4": ["meta-viewport-zoom-block"],
  "2.1.1": ["clickable-noninteractive"],
  "2.2.1": ["meta-refresh-redirect"],
  "2.2.2": ["autoplay-media", "blink-marquee"],
  "2.4.1": ["skip-link-target-missing"],
  "2.4.2": ["title-missing-empty"],
  "2.4.3": ["positive-tabindex"],
  "2.4.7": ["rendered-focus-not-visible"],
  "2.4.4": ["link-empty-name", "icon-only-control-unnamed"],
  "2.5.3": ["label-in-name-mismatch", "form-label-in-name-mismatch"],
  "3.2.2": ["on-input-context-change"],
  "3.3.8": ["credential-entry-blocked"],
  "3.1.1": ["html-lang-missing", "document-language-missing", "html-lang-xml-lang-mismatch", "lang-invalid"],
  "3.1.2": ["inline-lang-change-missing", "lang-invalid"],
  "3.3.1": ["aria-invalid-no-description", "error-not-associated"],
  "3.3.2": ["radio-checkbox-group-ungrouped", "date-fields-ungrouped"],
  "4.1.2": [
    "iframe-title-missing", "invalid-aria-role", "aria-ref-missing-id", "redundant-aria",
    "clickable-noninteractive", "aria-required-children", "aria-hidden-focusable", "nested-interactive", "invalid-aria-attr", "invalid-aria-value", "aria-required-attr", "aria-prohibited-attr",
    "duplicate-id", "duplicate-attribute", "control-label-missing", "placeholder-as-label", "form-field-multiple-labels",
    "select-has-option", "button-empty-name", "form-button-empty-name", "icon-only-control-unnamed", "control-name-title-only",
    "field-purpose-incomplete", "disabled-context-content", "presentational-children-focusable",
    "decorative-marked-exposed", "menuitem-empty-name",
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
  emit("src/data/wcag-universe.json", biomeFormat(JSON.stringify(out, null, 2) + "\n", "src/data/wcag-universe.json"));

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
  if (CHECK) return;
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
  if (!existsSync(VENDOR_TEXT)) {
    console.error(`build-standards: missing vendored normative text ${VENDOR_TEXT}. Run: node scripts/build-standards.mjs --refresh-text`);
    process.exit(1);
  }
  const snap = JSON.parse(readFileSync(VENDOR, "utf8"));
  const fr = JSON.parse(readFileSync(VENDOR_FR, "utf8"));
  const text = JSON.parse(readFileSync(VENDOR_TEXT, "utf8"));
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
  const frText = fr.criteriaText ?? {};
  const frTerms = fr.criteriaTerms ?? {};
  const frGlossary = fr.glossary ?? {};
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
    if (text.criteria?.[c.sc]) sc.text = text.criteria[c.sc];
    if (frText[c.sc]) sc.textFr = frText[c.sc];
    if (frTerms[c.sc]?.length) sc.termsFr = frTerms[c.sc];
    if (text.terms?.[c.sc]?.length) sc.terms = text.terms[c.sc];
    return sc;
  });

  // Same completeness rule as the French titles: a shipped criterion either carries its
  // normative wording or the build fails. Half a reference is worse than a known-absent
  // one, because a reader cannot tell which criteria they are missing.
  const missingText = snap.criteria.filter((c) => !text.criteria?.[c.sc]).map((c) => `SC ${c.sc}`);
  if (missingText.length) {
    console.error(`build-standards: ${VENDOR_TEXT} is missing the normative text for: ${missingText.join(", ")}. Re-run: node scripts/build-standards.mjs --refresh-text`);
    process.exit(1);
  }
  // The French body is held to the same rule as the French title: complete, or the build
  // fails. `--lang fr` must never fall back to English prose under a French heading.
  const missingFrText = snap.criteria.filter((c) => !frText[c.sc]).map((c) => `SC ${c.sc}`);
  if (missingFrText.length) {
    console.error(`build-standards: ${VENDOR_FR} is missing the French body for: ${missingFrText.join(", ")}. Re-run: node scripts/build-standards.mjs --refresh-fr`);
    process.exit(1);
  }

  // Every term a criterion CITES must resolve in the glossary of its own language — the
  // two pages use different slugs, so a cross-language mix-up would silently drop
  // definitions rather than fail. Caught here instead.
  for (const c of criteria) {
    for (const [slug, set, which] of [
      ...(c.terms ?? []).map((t) => [t, text.glossary ?? {}, "en"]),
      ...(c.termsFr ?? []).map((t) => [t, frGlossary, "fr"]),
    ]) {
      if (!set[slug]) {
        console.error(`build-standards: SC ${c.sc} cites the ${which} term "${slug}", which that language's glossary does not define.`);
        process.exit(1);
      }
    }
  }

  const out = {
    wcagVersion: snap.wcagVersion,
    level: "AA",
    source: snap.source,
    license: "W3C Document License",
    criteriaSource: snap.criteriaSource,
    principles,
    guidelines,
    criteria,
    glossary: text.glossary ?? {},
    // Keyed by the SAME dfn slugs as the English glossary, so a criterion's term links
    // resolve in either language off one list.
    glossaryFr: frGlossary,
  };
  emit("src/data/wcag.json", biomeFormat(JSON.stringify(out, null, 2) + "\n", "src/data/wcag.json"));

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
  if (CHECK) return void buildUniverse(criteria);
  console.log(`build-standards: ${criteria.length} WCAG 2.2 A/AA criteria → src/data/wcag.json`);
  console.log(`build-standards: automatability — static ${tally.static}, needs-rendering ${tally["needs-rendering"]}, judgment ${tally.judgment}`);
  console.log(`build-standards: seeded techniques from ${sources.length ? sources.map((s) => s.replace(root + "/", "")).join(", ") : "(no pack found — empty)"}`);

  buildUniverse(criteria);
}

async function main() {
  const refreshIdx = process.argv.indexOf("--refresh");
  // A check that first goes and fetches is not a check: it would compare the committed
  // dataset against a source that moved under it, and call an upstream change a local drift.
  // `--check` reads the vendored snapshots and nothing else.
  const refreshing = refreshIdx !== -1 || process.argv.some((a) => a.startsWith("--refresh-"));
  if (CHECK && refreshing) {
    console.error("build-standards --check: --check is offline by construction; it cannot be combined with a --refresh flag.");
    process.exit(1);
  }
  if (refreshIdx !== -1) deriveSnapshot(process.argv[refreshIdx + 1]);
  if (process.argv.includes("--refresh-universe")) await deriveUniverse();
  if (process.argv.includes("--refresh-core")) refreshCore();
  if (process.argv.includes("--refresh-fr")) await deriveFr();
  if (process.argv.includes("--refresh-text")) await deriveText();
  build();
  if (!CHECK) return;
  if (drift.length) {
    console.error(`build-standards --check: OUT OF DATE vs the vendored source — re-run \`pnpm run build:wcag\`: ${drift.join(", ")}`);
    process.exit(1);
  }
  console.log("build-standards --check: src/data/wcag.json and src/data/wcag-universe.json match the vendored source.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

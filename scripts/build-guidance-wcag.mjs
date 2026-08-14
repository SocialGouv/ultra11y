#!/usr/bin/env node
// DEV-ONLY (not in `bin`). Builds src/data/guidance/wcag.json — the WCAG-keyed
// implementation guidance — from the W3C's own Techniques and Understanding documents.
//
// Nothing here is hand-written. The RGAA guidance is derived from an upstream rule source
// and rebuilt by a script; this one had been authored by hand, which made it the only
// dataset in the repo whose content nobody could re-derive or check against a source. Now
// it is generated the same way everything else is:
//
//   · WHICH techniques implement a criterion — understanding/understanding.11tydata.js,
//     the W3C's own machine-readable association map (sufficient / advisory / failure).
//   · WHAT the criterion asks — the "In brief" block of understanding/<ver>/<slug>.html
//     (Goal / What to do / Why it's important), written by the WCAG working group.
//   · The GOOD example — the first sufficient technique carrying an HTML or CSS code
//     sample, in the W3C's own listing order.
//   · The BAD example — the first documented FAILURE carrying one.
//
// The selection is positional, never editorial: "the first one that has a code sample",
// in the order W3C lists them. A criterion whose techniques carry no HTML/CSS sample gets
// an entry with the official summary and no example, rather than an invented one.
//
// WCAG 2.2 © W3C, reused under the W3C Document License; the code samples are Code
// Components under the W3C Software License. See NOTICE.
//
// Usage:
//   node scripts/build-guidance-wcag.mjs --refresh   # re-fetch (network) the vendored snapshot
//   node scripts/build-guidance-wcag.mjs             # emit the dataset from the snapshot
//   node scripts/build-guidance-wcag.mjs --check     # verify the committed dataset matches
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = join(root, "scripts", "vendor", "wcag-2.2-techniques.json");
const SNAPSHOT = join(root, "scripts", "vendor", "wcag-2.2-sc.json");
const OUT = join(root, "src", "data", "guidance", "wcag.json");
const BIOME = join(root, "node_modules", ".bin", "biome");
const RAW = "https://raw.githubusercontent.com/w3c/wcag/main";
const VER_OF = { "2.0": "20", "2.1": "21", "2.2": "22" };

// Technique id → the directory it lives in. The W3C names these by technology, and the
// prefix is the technology — no directory listing needed, and no id ever special-cased.
const TECH_DIR = {
  ARIA: "aria",
  C: "css",
  F: "failures",
  FLASH: "flash",
  G: "general",
  H: "html",
  PDF: "pdf",
  SCR: "client-side-script",
  SL: "silverlight",
  SM: "smil",
  SVR: "server-side-script",
  T: "text",
};

function techDir(id) {
  const prefix = (id.match(/^[A-Z]+/) || [])[0];
  return TECH_DIR[prefix];
}

function biomeFormat(text, relPath) {
  return execFileSync(BIOME, ["format", `--stdin-file-path=${relPath}`], { input: text, encoding: "utf8" });
}

async function fetchText(path) {
  const r = await fetch(`${RAW}/${path}`);
  if (!r.ok) return null; // a technique listed but not present is data, not a crash
  return r.text();
}

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
};
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m] ?? m);
}

/** Tags out, entities in, whitespace collapsed — for prose, never for code. */
function plain(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The W3C's own association map, read by EVALUATING the module rather than regexing it.
 *
 * It is an ES module exporting a function of 11ty's data cascade; calling it with a stub
 * yields the map exactly as the W3C's own site build sees it. Parsing this shape with a
 * regex would be guesswork, and it is dev-only code from the same repo this project already
 * derives its entire WCAG dataset from.
 */
async function fetchAssociations() {
  const src = await fetchText("understanding/understanding.11tydata.js");
  if (!src) throw new Error("build-guidance-wcag: understanding.11tydata.js not found upstream");
  const tmp = join(tmpdir(), `u11y-assoc-${process.pid}.mjs`);
  writeFileSync(tmp, src);
  try {
    const mod = await import(`file://${tmp}`);
    return mod.default({ understandingUrl: "" }).associatedTechniques ?? {};
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Every technique id an entry mentions, flattened, in the W3C's own listing order. */
function flattenTechniques(node, out = []) {
  if (node === null || node === undefined) return out;
  if (typeof node === "string") {
    // Ids only: the map also carries free prose ("Providing a descriptive label").
    if (/^[A-Z]+\d+$/.test(node)) out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const n of node) flattenTechniques(n, out);
    return out;
  }
  if (typeof node === "object") {
    // { and: [...] } / { title, techniques, groups } — order matters, so walk explicitly.
    for (const key of ["and", "techniques", "groups", "using"]) {
      if (node[key]) flattenTechniques(node[key], out);
    }
    return out;
  }
  return out;
}

/** The first HTML or CSS code sample in a technique document, with the prose above it. */
function firstCodeExample(html) {
  const EX = /<section class="example">([\s\S]*?)<\/section>/g;
  let m;
  while ((m = EX.exec(html))) {
    const block = m[1];
    const code = /<pre><code class="language-(html|css)">([\s\S]*?)<\/code><\/pre>/.exec(block);
    if (!code) continue;
    const snippet = decodeEntities(code[2]).trim();
    if (!snippet) continue;
    const before = block.slice(0, code.index);
    return { lang: code[1], code: snippet, note: plain(before) };
  }
  return null;
}

function techniqueTitle(html) {
  const h1 = /<h1>([\s\S]*?)<\/h1>/.exec(html);
  return h1 ? plain(h1[1]) : "";
}

/** The "In brief" block: the working group's own Goal / What to do / Why. */
function briefOf(html) {
  const sec = /<section id="brief">([\s\S]*?)<\/section>/.exec(html);
  if (!sec) return null;
  const out = {};
  const DL = /<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g;
  let m;
  while ((m = DL.exec(sec[1]))) out[plain(m[1]).toLowerCase().replace(/[^a-z]+/g, "")] = plain(m[2]);
  return Object.keys(out).length ? out : null;
}

async function refresh() {
  if (!existsSync(SNAPSHOT)) {
    console.error(`build-guidance-wcag --refresh: missing ${SNAPSHOT}. Run: node scripts/build-standards.mjs --refresh <w3c/wcag checkout>`);
    process.exit(1);
  }
  const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  const assoc = await fetchAssociations();

  const cache = new Map();
  const techniqueDoc = async (id) => {
    if (cache.has(id)) return cache.get(id);
    const dir = techDir(id);
    const doc = dir ? await fetchText(`techniques/${dir}/${id}.html`) : null;
    cache.set(id, doc);
    return doc;
  };

  const criteria = {};
  for (const c of snap.criteria) {
    const a = assoc[c.slug];
    const understanding = await fetchText(`understanding/${VER_OF[c.addedIn]}/${c.slug}.html`);
    const brief = understanding ? briefOf(understanding) : null;

    // Selection: the first technique that carries a code sample, taking the technologies in
    // a fixed order rather than purely positionally.
    //
    // Order matters because the W3C lists techniques by conformance strategy, not by how
    // well they READ as an example. For 1.1.1 the first listed with a sample is ARIA6,
    // whose own example is a navigation landmark — true to the technique, useless as an
    // illustration of a text alternative. Preferring HTML picks H37 (`alt` on `img`)
    // instead. This is one uniform rule applied to every criterion, not a per-criterion
    // choice: within a technology the W3C's own order still decides.
    const TECH_ORDER = ["html", "css", "aria", "client-side-script", "general", "text"];
    const pick = async (ids) => {
      const byTech = new Map();
      for (const id of ids) {
        const dir = techDir(id);
        if (!dir) continue;
        if (!byTech.has(dir)) byTech.set(dir, []);
        byTech.get(dir).push(id);
      }
      const ordered = [...TECH_ORDER.flatMap((t) => byTech.get(t) ?? []), ...ids.filter((id) => !TECH_ORDER.includes(techDir(id)))];
      for (const id of ordered) {
        const doc = await techniqueDoc(id);
        if (!doc) continue;
        const ex = firstCodeExample(doc);
        if (ex) return { id, title: techniqueTitle(doc), ...ex };
      }
      return null;
    };

    const good = a ? await pick(flattenTechniques(a.sufficient)) : null;
    const bad = a ? await pick(flattenTechniques(a.failure)) : null;

    criteria[c.sc] = {
      slug: c.slug,
      ...(brief ? { brief } : {}),
      ...(good ? { good } : {}),
      ...(bad ? { bad } : {}),
    };
  }

  const out = {
    source: "https://github.com/w3c/wcag",
    understanding: "https://www.w3.org/WAI/WCAG22/Understanding/",
    license: "W3C Document License (code samples: W3C Software License)",
    fetchedAt: new Date().toISOString().slice(0, 10),
    criteria,
  };
  mkdirSync(dirname(VENDOR), { recursive: true });
  writeFileSync(VENDOR, JSON.stringify(out, null, 2) + "\n");
  const withGood = Object.values(criteria).filter((x) => x.good).length;
  const withBad = Object.values(criteria).filter((x) => x.bad).length;
  const withBrief = Object.values(criteria).filter((x) => x.brief).length;
  console.log(`build-guidance-wcag --refresh: ${Object.keys(criteria).length} SCs — ${withBrief} briefs, ${withGood} good samples, ${withBad} failure samples → ${VENDOR}`);
  return out;
}

/** The dataset, from the vendored snapshot. Offline and deterministic. */
function build() {
  if (!existsSync(VENDOR)) {
    console.error(`build-guidance-wcag: missing ${VENDOR}. Run: node scripts/build-guidance-wcag.mjs --refresh`);
    process.exit(1);
  }
  const snap = JSON.parse(readFileSync(VENDOR, "utf8"));
  const core = JSON.parse(readFileSync(join(root, "src", "data", "wcag.json"), "utf8"));
  const titleOf = new Map(core.criteria.map((c) => [c.sc, c]));

  const entries = [];
  for (const [sc, d] of Object.entries(snap.criteria)) {
    const meta = titleOf.get(sc);
    if (!meta) continue; // not in the shipped AA core
    const summary = d.brief
      ? [d.brief.whattodo, d.brief.goal, d.brief.whyitsimportant].filter(Boolean).join(" ")
      : undefined;
    // A `bad`/`good` pair shares ONE `lang`, so the two halves may only be paired when they
    // are the same technology. A CSS failure beside an HTML fix, labelled `html`, would be
    // a snippet the reader cannot trust — so they are emitted separately instead.
    const label = (t) => ({ en: `${t.kind}: ${t.title} (${t.id}).` });
    const examples = [];
    if (d.good && d.bad && d.good.lang === d.bad.lang) {
      examples.push({
        lang: d.good.lang,
        bad: d.bad.code,
        good: d.good.code,
        note: { en: `Good: ${d.good.title} (${d.good.id}). Bad: ${d.bad.title} (${d.bad.id}).` },
      });
    } else {
      if (d.good) examples.push({ lang: d.good.lang, good: d.good.code, note: label({ kind: "Good", ...d.good }) });
      if (d.bad) examples.push({ lang: d.bad.lang, bad: d.bad.code, note: label({ kind: "Bad", ...d.bad }) });
    }
    entries.push({
      id: `wcag-${d.slug}`,
      criterionId: sc,
      wcag: [sc],
      title: { en: meta.title, ...(meta.titleFr ? { fr: meta.titleFr } : {}) },
      ...(summary ? { summary: { en: summary } } : { summary: {} }),
      examples,
      reference: `https://www.w3.org/WAI/WCAG22/Understanding/${d.slug}.html`,
    });
  }
  entries.sort((a, b) => a.criterionId.localeCompare(b.criterionId, "en", { numeric: true }));

  const out = {
    pack: "wcag",
    source: snap.understanding,
    license: snap.license,
    attribution:
      "Derived from the W3C Techniques for WCAG 2.2 and the Understanding documents (https://github.com/w3c/wcag). WCAG 2.2 © W3C. " +
      "Summaries are the working group's own 'In brief' text; code samples are the techniques' own examples. Generated by scripts/build-guidance-wcag.mjs — never hand-edited.",
    entries,
  };
  return biomeFormat(JSON.stringify(out, null, 2) + "\n", "src/data/guidance/wcag.json");
}

async function main() {
  if (process.argv.includes("--refresh")) await refresh();
  const text = build();
  if (process.argv.includes("--check")) {
    const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    if (current !== text) {
      console.error("build-guidance-wcag --check: src/data/guidance/wcag.json does not match the vendored W3C source. Re-run: node scripts/build-guidance-wcag.mjs");
      process.exit(1);
    }
    console.log("build-guidance-wcag --check: src/data/guidance/wcag.json matches the vendored source.");
    return;
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
  const n = JSON.parse(text).entries.length;
  console.log(`build-guidance-wcag: ${n} entries → src/data/guidance/wcag.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

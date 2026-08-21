#!/usr/bin/env node
// DEV-ONLY (not in `bin`, not bundled, never run by tests — needs network). Proves that
// the vendored RGAA source (scripts/vendor/rgaa/criteres.json + glossaire.json +
// methodologies.json), which scripts/build-pack-rgaa.mjs derives the shipped pack from, is
// still faithful to the
// official DINUM source (github.com/DISIC/accessibilite.numerique.gouv.fr, RGAA 4.1.2,
// same raw path as build-pack-rgaa.mjs's BASE). Does a DEEP, per-criterion /
// per-glossary-entry / per-test diff (not just a whole-file hash) so drift reads as
// "critère 4.2: tests differs" rather than an opaque "files differ". Refreshes scripts/vendor/rgaa/SOURCE.json with a
// provenance record on every run (clean or drifted) so the last verification is traceable.
//   node scripts/verify-rgaa-source.mjs
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = join(root, "scripts", "vendor", "rgaa");
const OWNER = "DISIC";
const REPO = "accessibilite.numerique.gouv.fr";
const BRANCH = "main";
const UPSTREAM_DIR = "RGAA"; // same path as build-pack-rgaa.mjs's BASE
const RAW_BASE = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${UPSTREAM_DIR}`;
const FILES = ["criteres.json", "glossaire.json", "methodologies.json"];

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

async function fetchText(name) {
  const url = `${RAW_BASE}/${name}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`verify-rgaa-source: GET ${url} → HTTP ${r.status}`);
  return r.text();
}

async function fetchUpstreamCommit() {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/commits/${BRANCH}`;
  const r = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error(`verify-rgaa-source: GET ${url} → HTTP ${r.status}`);
  const json = await r.json();
  return json.sha;
}

function criteriaById(criteres) {
  const byId = new Map();
  for (const topic of criteres.topics) {
    for (const { criterium } of topic.criteria) byId.set(`${topic.number}.${criterium.number}`, criterium);
  }
  return byId;
}

// Deep, per-criterion diff over the fields the pack derives from: title, tests,
// WCAG/technique references, particular cases, technical notes.
function diffCriteria(upstream, vendored) {
  const drift = [];
  const up = criteriaById(upstream);
  const ven = criteriaById(vendored);
  const FIELDS = ["title", "tests", "references", "technicalNote", "particularCases"];
  for (const id of new Set([...up.keys(), ...ven.keys()])) {
    const u = up.get(id);
    const v = ven.get(id);
    if (!u) {
      drift.push(`critère ${id}: présent dans le vendored, absent en amont`);
      continue;
    }
    if (!v) {
      drift.push(`critère ${id}: présent en amont, absent du vendored`);
      continue;
    }
    for (const field of FIELDS) {
      const a = JSON.stringify(u[field] ?? null);
      const b = JSON.stringify(v[field] ?? null);
      if (a !== b) drift.push(`critère ${id}: ${field} diffère`);
    }
  }
  return drift.sort();
}

// Per-entry diff over the glossary (keyed by term title, the glossary's natural key).
function diffGlossary(upstream, vendored) {
  const drift = [];
  const up = new Map(upstream.glossary.map((e) => [e.title, e.body]));
  const ven = new Map(vendored.glossary.map((e) => [e.title, e.body]));
  for (const title of new Set([...up.keys(), ...ven.keys()])) {
    const a = up.get(title);
    const b = ven.get(title);
    if (a === undefined) drift.push(`glossaire « ${title} » : présent dans le vendored, absent en amont`);
    else if (b === undefined) drift.push(`glossaire « ${title} » : présent en amont, absent du vendored`);
    else if (a !== b) drift.push(`glossaire « ${title} » : corps différent`);
  }
  return drift.sort();
}

// Per-test diff over the official méthodologie de test (keyed by full test id, "11.2.1").
// The pack re-keys these under their criterion, so a silent upstream edit here changes what
// an adjudicator is told to DO without changing a single criterion's wording.
function diffMethodologies(upstream, vendored) {
  const drift = [];
  for (const id of new Set([...Object.keys(upstream), ...Object.keys(vendored)])) {
    const a = upstream[id];
    const b = vendored[id];
    if (a === undefined) drift.push(`méthodologie ${id} : présente dans le vendored, absente en amont`);
    else if (b === undefined) drift.push(`méthodologie ${id} : présente en amont, absente du vendored`);
    else if (a !== b) drift.push(`méthodologie ${id} : texte différent`);
  }
  return drift.sort();
}

async function main() {
  const upstreamText = {};
  for (const name of FILES) upstreamText[name] = await fetchText(name);

  const vendoredText = Object.fromEntries(FILES.map((name) => [name, readFileSync(join(VENDOR, name), "utf8")]));

  const drift = [
    ...diffCriteria(JSON.parse(upstreamText["criteres.json"]), JSON.parse(vendoredText["criteres.json"])),
    ...diffGlossary(JSON.parse(upstreamText["glossaire.json"]), JSON.parse(vendoredText["glossaire.json"])),
    ...diffMethodologies(JSON.parse(upstreamText["methodologies.json"]), JSON.parse(vendoredText["methodologies.json"])),
  ];

  const upstreamCommit = await fetchUpstreamCommit();
  const files = {};
  for (const name of FILES) files[name] = sha256(vendoredText[name]);
  writeFileSync(
    join(VENDOR, "SOURCE.json"),
    `${JSON.stringify({ fetchedAt: new Date().toISOString(), upstreamCommit, files }, null, 2)}\n`,
  );

  if (drift.length === 0) {
    console.log(
      `verify-rgaa-source: scripts/vendor/rgaa/*.json is identical to ${OWNER}/${REPO}@${upstreamCommit} (${UPSTREAM_DIR}/).`,
    );
    return;
  }

  console.log(`verify-rgaa-source: ${drift.length} drift(s) vs ${OWNER}/${REPO}@${upstreamCommit} (${UPSTREAM_DIR}/):`);
  for (const d of drift) console.log(`  - ${d}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

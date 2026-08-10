#!/usr/bin/env node
// Recall guard for regenerated ENGINE-OUTPUT artifacts.
//
// The problem this exists to solve, in one sentence: some committed artifacts
// are this repo's own product and must never move on an engine bump, and some
// ARE the engine's output and legitimately move on every one. Treating the
// second kind as a hard red is how an engine pin rots — ultrasec's sat seven
// releases behind because twelve goldens moved and every nightly re-pin died on
// them. Treating it as free is worse: an engine that quietly stopped finding a
// class of bugs would be committed as the new "expected" and pushed to main.
//
// So the re-pin regenerates them, and this compares the regenerated artifacts to
// the committed ones and fails only on LOSS. Enrichment — more findings, more
// fields, new files — passes. Losing something is a human decision, never an
// automatic push.
//
// What "loss" means, per file type:
//   *.json  every array in the structure, keyed by its path; a shorter array is
//           a loss. `["a","b"] -> ["a"]` fails, `-> ["a","b","c"]` passes.
//   *.snap  every object key appearing in the text; fewer occurrences of
//           `"ruleId":` means fewer findings, fewer `"related":` means a
//           cross-file link was dropped. Text, because a vitest snapshot is not
//           JSON and hand-parsing it would break on the next vitest release.
//   other   line count. Blunt on purpose: a prose report that got shorter is
//           worth a human look, and a file with no finer structure gives
//           nothing better to measure.
//
// Keys under FEWER_IS_BETTER are exempt: a shrinking `warnings` or `todo` array
// is the fix landing, not recall being lost.
//
// Usage: node scripts/check-artifact-recall.mjs [--ref HEAD] [--verbose]
// Exit 0 = nothing lost · 1 = something was lost · 2 = usage/runtime error.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// The per-repo table. The ONLY part of this file that differs between repos:
// which committed paths are engine output. Anything not listed here keeps
// whatever gate it already had — an `orchestrate` snapshot holds the RUNBOOK
// this skill generates itself, which no engine bump has any business moving.
const TRACKED = [
  // The graph snapshot is `audit --graph` over the golden fixture: the rules are
  // this repo's, but the cross-file links they fire on come from codeindex, so a
  // newer engine resolves more of them. The `orchestrate` snapshot beside it is
  // the RUNBOOK this skill writes itself — deliberately NOT listed, so it stays
  // a hard red.
  "tests/__snapshots__/golden-graph.test.ts.snap",
];

// Arrays whose shrinking is an improvement, not a regression. Matched as a
// SUFFIX on the last path segment, case-insensitively: a repo calls them
// `knownGaps`, `parseErrors` or `unresolvedRefs`, and a guard that only knew the
// bare words would report every closed gap as a loss — a red on good news is a
// red people learn to ignore.
const FEWER_IS_BETTER = ["warning", "error", "todo", "unresolved", "skipped", "failure", "gap", "miss"];

const refIdx = process.argv.indexOf("--ref");
const ref = refIdx === -1 ? "HEAD" : (process.argv[refIdx + 1] ?? "HEAD");
const verbose = process.argv.includes("--verbose");

/** The committed bytes of a path, or null when it is new in this tree. */
function committed(rel) {
  try {
    return execFileSync("git", ["show", `${ref}:${rel}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null; // not in the ref: brand new, nothing to lose yet
  }
}

/** Every file under the tracked paths, repo-relative, sorted. */
function expand(paths) {
  const out = [];
  const walk = (rel) => {
    const abs = join(root, rel);
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) {
      for (const name of execFileSync("git", ["ls-files", rel], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean)) {
        out.push(name);
      }
      return;
    }
    out.push(relative(root, abs));
  };
  for (const p of paths) walk(p);
  return [...new Set(out)].sort();
}

// ---------------------------------------------------------------------------
// Measurements. Each returns a Map of "what" -> count.

function measureJson(text) {
  const m = new Map();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null; // unparseable: fall back to lines rather than guess
  }
  // ADD, never set: every element of an array shares one path (`cases[].sites`),
  // so overwriting would keep only the last sibling's length and go blind to a
  // loss in any of the others. Summing makes the key mean "sites across all
  // cases", which is the number that must not go down.
  const add = (path, n) => m.set(path, (m.get(path) ?? 0) + n);
  const visit = (node, path) => {
    if (Array.isArray(node)) {
      add(path, node.length);
      node.forEach((v) => visit(v, `${path}[]`));
      return;
    }
    if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) visit(v, path ? `${path}.${k}` : k);
  };
  visit(data, "");
  return m;
}

function measureSnapshot(text) {
  const m = new Map();
  for (const [, key] of text.matchAll(/^\s*"([^"]+)":/gm)) m.set(key, (m.get(key) ?? 0) + 1);
  // Keys alone are blind to keyless array elements: a dependency cycle is
  // `["src/a.ts", "src/b.ts"]`, so dropping a whole cycle changes no key count
  // at all. Count bare scalar elements as their own bucket — that is where a
  // path, a cycle or a call site actually lives.
  const bare = [...text.matchAll(/^\s*(?:"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null),?\s*$/gm)].length;
  if (bare) m.set("«scalar elements»", bare);
  return m;
}

const measure = (rel, text) => {
  if (rel.endsWith(".json")) return measureJson(text) ?? new Map([["lines", text.split("\n").length]]);
  if (rel.endsWith(".snap")) return measureSnapshot(text);
  return new Map([["lines", text.split("\n").length]]);
};

const exempt = (what) => {
  const last = (what.split(/[.[]/).filter(Boolean).pop() ?? what).toLowerCase().replace(/s$/, "");
  return FEWER_IS_BETTER.some((w) => last.endsWith(w));
};

// ---------------------------------------------------------------------------

const files = expand(TRACKED);
if (files.length === 0) {
  console.error(`check-artifact-recall: none of the tracked paths exist (${TRACKED.join(", ")})`);
  process.exit(2);
}

const lost = [];
let gained = 0;
let added = 0;
let unchanged = 0;

for (const rel of files) {
  const before = committed(rel);
  if (before === null) {
    added++;
    continue;
  }
  let after;
  try {
    after = readFileSync(join(root, rel), "utf8");
  } catch {
    // A tracked artifact that vanished during regeneration is the loudest
    // possible loss: report it as one rather than skipping the file.
    lost.push({ rel, what: "(the file itself)", before: 1, after: 0 });
    continue;
  }
  if (before === after) {
    unchanged++;
    continue;
  }
  const b = measure(rel, before);
  const a = measure(rel, after);
  for (const [what, n] of b) {
    if (exempt(what)) continue;
    const now = a.get(what) ?? 0;
    if (now < n) lost.push({ rel, what, before: n, after: now });
    else if (now > n) gained++;
  }
  for (const [what, n] of a) if (!b.has(what) && n > 0) gained++;
}

const summary = `${files.length} tracked · ${unchanged} unchanged · ${added} new · ${gained} enriched`;

if (lost.length) {
  console.error(`check-artifact-recall: RECALL LOST — ${summary}`);
  for (const l of lost) console.error(`  ${l.rel}: ${l.what} ${l.before} -> ${l.after}`);
  console.error("");
  console.error("A regenerated artifact that finds LESS than the committed one is a behaviour");
  console.error("change, not a re-pin. Nothing was pushed. Review it by hand and commit it");
  console.error("deliberately if the loss is correct.");
  process.exit(1);
}

if (verbose) for (const rel of files) console.log(`  ok ${rel}`);
console.log(`check-artifact-recall: no recall lost — ${summary}`);

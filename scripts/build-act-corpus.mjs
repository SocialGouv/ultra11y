#!/usr/bin/env node
// DEV-ONLY (not in `bin`). Vendors the OFFICIAL W3C ACT-Rules Community Group test
// corpus so the engine can be measured against third-party HTML nobody here wrote.
//
// Why this matters: the engine's own recall suite seeds one fixture per rule that
// EXISTS, so it can only ever prove "the rules we wrote fire on the defects we wrote".
// The ACT corpus is written by the ACT-Rules Community Group against the ACT Rules
// Format, independently of this project — it is the only external yardstick available
// for both recall (does a `failed` example get caught?) and precision (does a `passed`
// or `inapplicable` example stay clean?).
//
// The snapshot is COMMITTED (scripts/vendor/act-testcases.json) so the test suite stays
// offline and deterministic, exactly like the vendored WCAG/RGAA sources.
//
// Usage:
//   node scripts/build-act-corpus.mjs                 # verify the vendored snapshot parses + summarize
//   node scripts/build-act-corpus.mjs --refresh       # re-fetch metadata AND every test case's HTML (network)
//   node scripts/build-act-corpus.mjs --check         # exit 1 if the snapshot is missing/!well-formed
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_DIR = join(root, "scripts", "vendor");
const SNAPSHOT = join(VENDOR_DIR, "act-testcases.json");
const INDEX_URL = "https://act-rules.github.io/testcases.json";
const CONCURRENCY = 12;

const argv = process.argv.slice(2);
const REFRESH = argv.includes("--refresh");
const CHECK = argv.includes("--check");

/** Fetch with a small retry — a transient failure must not silently shrink the corpus. */
async function fetchText(url, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`${url}: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

/** Run `jobs` with a bounded number in flight (politeness + memory). */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

async function refresh() {
  process.stderr.write(`fetching ${INDEX_URL}\n`);
  const index = JSON.parse(await fetchText(INDEX_URL));
  const cases = index.testcases ?? [];
  if (!cases.length) throw new Error("the ACT index returned no test cases — refusing to write an empty snapshot");
  process.stderr.write(`fetching ${cases.length} test case documents (concurrency ${CONCURRENCY})…\n`);
  let done = 0;
  const html = await pool(cases, CONCURRENCY, async (tc) => {
    const body = await fetchText(tc.url);
    if (++done % 100 === 0) process.stderr.write(`  ${done}/${cases.length}\n`);
    return body;
  });

  // Keep only what a conformance run needs, in a stable order, so the snapshot diffs
  // readably and a re-fetch of unchanged upstream data is a no-op.
  const testcases = cases
    .map((tc, i) => ({
      ruleId: tc.ruleId,
      ruleName: tc.ruleName,
      testcaseId: tc.testcaseId,
      title: tc.testcaseTitle,
      expected: tc.expected,
      // Which WCAG success criteria the rule is a test for — lets the corpus be
      // cross-referenced with the engine's own criterion mapping.
      wcag: Object.keys(tc.ruleAccessibilityRequirements ?? {})
        .filter((k) => /^wcag\d*:\d/.test(k))
        .map((k) => k.split(":")[1])
        .sort(),
      html: html[i],
    }))
    .sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.testcaseId.localeCompare(b.testcaseId));

  const snapshot = {
    source: INDEX_URL,
    name: index.name,
    website: index.website,
    license: index.license,
    fetchedCount: testcases.length,
    rules: [...new Set(testcases.map((t) => t.ruleId))].length,
    testcases,
  };
  mkdirSync(VENDOR_DIR, { recursive: true });
  writeFileSync(SNAPSHOT, `${JSON.stringify(snapshot, null, 2)}\n`);
  process.stderr.write(`wrote ${SNAPSHOT} — ${snapshot.rules} rules, ${snapshot.fetchedCount} cases\n`);
  return snapshot;
}

function load() {
  if (!existsSync(SNAPSHOT)) {
    process.stderr.write(`missing ${SNAPSHOT} — run: node scripts/build-act-corpus.mjs --refresh\n`);
    process.exitCode = 1;
    return null;
  }
  const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  if (!Array.isArray(snap.testcases) || !snap.testcases.length) {
    process.stderr.write(`${SNAPSHOT} holds no test cases\n`);
    process.exitCode = 1;
    return null;
  }
  for (const tc of snap.testcases) {
    if (!tc.ruleId || !tc.expected || typeof tc.html !== "string") {
      process.stderr.write(`${SNAPSHOT}: malformed test case ${tc.testcaseId ?? "?"}\n`);
      process.exitCode = 1;
      return null;
    }
  }
  return snap;
}

const snap = REFRESH ? await refresh() : load();
if (snap && !CHECK) {
  const byExpected = {};
  for (const t of snap.testcases) byExpected[t.expected] = (byExpected[t.expected] ?? 0) + 1;
  process.stdout.write(
    `ACT corpus: ${snap.rules} rules, ${snap.testcases.length} cases ` +
      `(${Object.entries(byExpected)
        .map(([k, v]) => `${v} ${k}`)
        .join(", ")})\n`,
  );
}

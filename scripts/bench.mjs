#!/usr/bin/env node
// DEV-ONLY (not in `bin`). Perf harness for the shipped bundle.
//
// Absolute timings are machine-specific, so this is NOT a CI gate — the automatic,
// machine-independent regression guard is tests/perf-shape.test.ts, which asserts the
// SHAPE of the cost curve (quadratic work fails, linear work passes). This script is
// the human-facing counterpart: it builds a deterministic synthetic repository whose
// proportions mirror a real front-end codebase, runs the real CLI over it as a
// subprocess, and prints wall times you can compare across two revisions.
//
// Usage:
//   node scripts/bench.mjs                       # default corpus, table output
//   node scripts/bench.mjs --scale 3             # 3x the file counts
//   node scripts/bench.mjs --json                # machine-readable
//   node scripts/bench.mjs --engine <path.mjs>   # bench another bundle (e.g. a git-restored one)
//   node scripts/bench.mjs --compare <old.mjs>   # run BOTH and print the delta per scenario
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ENGINE = join(ROOT, "scripts", "ultra11y.mjs");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const SCALE = Number(flag("--scale", "1")) || 1;
const AS_JSON = argv.includes("--json");
const ENGINE = flag("--engine", DEFAULT_ENGINE);
const COMPARE = flag("--compare", null);
const RUNS = Number(flag("--runs", "3")) || 3;

// Proportions of a mid-size front-end repo: many components, a smaller shared
// TS/JS layer the graph must resolve through, a handful of full HTML pages.
const COUNTS = { modules: Math.round(300 * SCALE), components: Math.round(400 * SCALE), pages: Math.round(120 * SCALE) };

/** A shared TS module: no markup, but real graph structure (exports the graph resolves). */
function tsModule(i) {
  const body = Array.from(
    { length: 12 },
    (_, k) => `export function helper${i}_${k}(items: string[], opts: Record<string, number> = {}): string {\n` + `  return items.map((s) => s.trim()).join(String(opts.sep ?? ${k}));\n}`,
  ).join("\n\n");
  return `export const ANCHOR_${i} = "anchor-${i}";\nexport const LABEL_${i} = "Label ${i}";\n\n${body}\n`;
}

/** A realistic ~130-line TSX component carrying a handful of genuine defects. */
function component(i, moduleCount) {
  const dep = i % moduleCount;
  const rows = Array.from({ length: 10 }, (_, k) => `        <tr><td>{row.a${k}}</td><td>{row.b${k}}</td></tr>`).join("\n");
  const fields = Array.from(
    { length: 8 },
    (_, k) => `      <div className="field">\n        <label htmlFor="f${i}_${k}">Field ${k}</label>\n        <input id="f${i}_${k}" type="text" name="n${i}_${k}" />\n      </div>`,
  ).join("\n");
  return `import { ANCHOR_${dep}, LABEL_${dep} } from "../lib/mod${dep}";
import type { ReactNode } from "react";

interface Props {
  label: string;
  rows: { a0: string; b0: string }[];
  children?: ReactNode;
}

export function C${i}({ label, rows, children }: Props) {
  const title = label || LABEL_${dep};
  return (
    <section className="card" id={ANCHOR_${dep}}>
      <header>
        <h2>{title}</h2>
        <img src="/thumb${i}.png" />
        <button></button>
        <a href="/detail/${i}"></a>
      </header>
${fields}
      <table>
        <tbody>
${rows}
        </tbody>
      </table>
      <footer>{children}</footer>
    </section>
  );
}

export default C${i};
`;
}

/** A full HTML page — the page-scoped rules (title, lang, landmarks) only fire on these. */
function page(i) {
  const cells = Array.from({ length: 12 }, (_, k) => `<tr><td>${k}</td><td>value ${k}</td></tr>`).join("");
  return `<!doctype html><html><head></head><body><main><img src="hero${i}.png"><a href="#missing${i}">Skip</a><table>${cells}</table><form><input type="text" name="q"><button></button></form></main></body></html>`;
}

function buildCorpus() {
  const root = mkdtempSync(join(tmpdir(), "ultra11y-bench-"));
  mkdirSync(join(root, "src", "lib"), { recursive: true });
  mkdirSync(join(root, "src", "components"), { recursive: true });
  mkdirSync(join(root, "src", "pages"), { recursive: true });
  let bytes = 0;
  const write = (p, s) => {
    writeFileSync(p, s);
    bytes += Buffer.byteLength(s);
  };
  for (let i = 0; i < COUNTS.modules; i++) write(join(root, "src", "lib", `mod${i}.ts`), tsModule(i));
  for (let i = 0; i < COUNTS.components; i++) write(join(root, "src", "components", `C${i}.tsx`), component(i, COUNTS.modules));
  for (let i = 0; i < COUNTS.pages; i++) write(join(root, "src", "pages", `p${i}.html`), page(i));
  return { root, bytes };
}

function time(engine, args, cwd) {
  const samples = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const r = spawnSync(process.execPath, [engine, ...args], { cwd, stdio: "ignore", maxBuffer: 512 * 1024 * 1024 });
    if (r.error) throw r.error;
    samples.push(performance.now() - t0);
  }
  return Math.min(...samples); // best-of: the least noisy estimate of the real cost
}

const SCENARIOS = [
  { id: "audit", args: ["audit", "src", "--json"] },
  { id: "audit --graph", args: ["audit", "src", "--graph", "--json"] },
  { id: "audit --max-files 50", args: ["audit", "src", "--max-files", "50", "--json"] },
  { id: "fix (dry-run)", args: ["fix", "src", "--json"] },
];

const { root, bytes } = buildCorpus();
try {
  const files = COUNTS.modules + COUNTS.components + COUNTS.pages;
  const results = SCENARIOS.map((s) => {
    const ms = time(ENGINE, s.args, root);
    return COMPARE ? { ...s, ms, baseMs: time(COMPARE, s.args, root) } : { ...s, ms };
  });
  if (AS_JSON) {
    console.log(JSON.stringify({ corpus: { ...COUNTS, files, bytes }, engine: ENGINE, runs: RUNS, results }, null, 2));
  } else {
    console.log(`corpus: ${files} files (${COUNTS.modules} .ts, ${COUNTS.components} .tsx, ${COUNTS.pages} .html), ${(bytes / 1024 / 1024).toFixed(1)} MiB`);
    console.log(`engine: ${ENGINE}${COMPARE ? `\nbaseline: ${COMPARE}` : ""}\nbest of ${RUNS} runs\n`);
    for (const r of results) {
      const base = r.baseMs === undefined ? "" : `   baseline ${r.baseMs.toFixed(0).padStart(6)} ms   ${(((r.ms - r.baseMs) / r.baseMs) * 100).toFixed(1).padStart(6)} %`;
      console.log(`${r.id.padEnd(22)} ${r.ms.toFixed(0).padStart(6)} ms${base}`);
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

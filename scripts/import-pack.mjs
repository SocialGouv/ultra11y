#!/usr/bin/env node
// DEV-ONLY (not in `bin`). The deterministic FAST-PATH scaffolder for the AI-assisted
// guidance ingestion workflow (see skills/ultra11y/references/guidance.md). It reads a directory
// of SocialGouv-style RGAA rule markdown files (frontmatter `title/impact/tags` + a
// non-compliant ```html block + a compliant ```html block + a reference link to the
// official criterion) and emits a DRAFT guidance dataset (src/data/guidance/<key>.json):
// every machine-extractable field filled, and `criterionId` resolved from the rule's
// reference link where unambiguous, else left null. It NEVER finalizes — the agent
// resolves the remaining nulls / summaries, then the guidance gate (`runPackCheck` in
// src/pack.ts, run by `pnpm test`) gates the result
// (a null criterionId or a fabricated SC fails). This keeps the AI honest: it drafts, the
// deterministic gate refuses fabrication.
//
//   node scripts/import-pack.mjs --from <dir-of-rules.md> [--pack rgaa] [--out src/data/guidance/rgaa.json]
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const fromDir = arg("from", null);
const packKey = arg("pack", "rgaa");
const outPath = arg("out", join(root, "src", "data", "guidance", `${packKey}.json`));

if (!fromDir || !existsSync(fromDir)) {
  console.error("import-pack: --from <dir-of-rule-markdown> is required (e.g. a clone of SocialGouv/skills/skills/rgaa-html-css/rules).");
  process.exit(1);
}

// Load the standards pack so we can map a resolved criterion id → its WCAG SCs.
const packPath = join(root, "src", "data", "standards", `${packKey}.json`);
if (!existsSync(packPath)) {
  console.error(`import-pack: standards pack not found: ${packPath}. Build it first (e.g. build:pack:${packKey}).`);
  process.exit(1);
}
const pack = JSON.parse(readFileSync(packPath, "utf8"));
const wcagByCriterion = new Map(pack.criteria.map((c) => [c.id, c.wcag]));

// --- tiny markdown parsers (no deps) -------------------------------------------------
function frontmatter(md) {
  const m = /^---\n([\s\S]*?)\n---/.exec(md);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim());
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return fm;
}

// First two fenced code blocks → { bad, good } (convention: non-compliant first).
function codeBlocks(md) {
  const blocks = [];
  const re = /```[a-zA-Z]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(md)) && blocks.length < 4) blocks.push(m[1].replace(/\n$/, ""));
  return { bad: blocks[0], good: blocks[1] };
}

// Resolve an RGAA criterion id from a reference link or "Critère X.Y" mention.
function criterionId(md) {
  const hash = /criteres?-et-tests[^)\s]*#(\d+\.\d+)\b/i.exec(md) || /#(\d+\.\d+)\b/.exec(md);
  if (hash && wcagByCriterion.has(hash[1])) return hash[1];
  const crit = /crit[eè]re\s+(\d+\.\d+)\b/i.exec(md);
  if (crit && wcagByCriterion.has(crit[1])) return crit[1];
  return null;
}

const files = readdirSync(fromDir).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
const entries = [];
let unresolved = 0;
for (const f of files.sort()) {
  const md = readFileSync(join(fromDir, f), "utf8");
  const fm = frontmatter(md);
  const { bad, good } = codeBlocks(md);
  const id = criterionId(md);
  if (!id) unresolved++;
  const impact = (fm.impact || "").toLowerCase();
  entries.push({
    id: basename(f, ".md"),
    criterionId: id, // null ⇒ the agent must resolve it; `pack check` fails until then
    wcag: id ? wcagByCriterion.get(id) : [],
    title: { fr: fm.title || basename(f, ".md") },
    summary: { fr: fm.impactDescription || fm.title || "" },
    ...(["high", "medium", "low"].includes(impact) ? { impact } : {}),
    examples: bad || good ? [{ lang: "html", ...(bad ? { bad } : {}), ...(good ? { good } : {}) }] : [],
    reference: (md.match(/https?:\/\/[^)\s]*criteres?-et-tests[^)\s]*/i) || [])[0] || "",
  });
}

const dataset = {
  pack: packKey,
  source: `imported from ${fromDir}`,
  license: pack.license,
  attribution: pack.attribution,
  entries,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(dataset, null, 2) + "\n");
console.log(`import-pack: ${entries.length} draft entries → ${outPath}`);
console.log(`import-pack: ${unresolved} entr${unresolved === 1 ? "y" : "ies"} have an unresolved criterionId (null) — resolve them, then run:`);
console.log(`  pnpm test   # the guidance gate (src/pack.ts runPackCheck) over ${packPath} + ${outPath}`);

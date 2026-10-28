#!/usr/bin/env node
// DEV-ONLY (not in `bin`). Generates the numbers of the documentation site (site/, published
// on GitHub Pages by .github/workflows/pages.yml) from the code itself: site/data.json, plus
// every `data-gen` value and `<!-- gen:… -->` block of site/*.html.
//
// The logic lives in src/site-data.ts so the test suite can import it directly
// (tests/site-data.test.ts fails when the committed site drifts). This script bundles that
// module with tsup — the same bundler as the engine — because plain `node` cannot resolve
// the `.js` → `.ts` imports of the source tree.
//
// Usage:
//   node scripts/build-site.mjs           # rewrite site/data.json and the generated regions
//   node scripts/build-site.mjs --check   # exit 1 when the committed site is stale
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "tsup";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = join(root, "site");
const CHECK = process.argv.includes("--check");

const tmp = mkdtempSync(join(tmpdir(), "ultra11y-site-"));
try {
  await build({
    entry: { site: join(root, "src", "site-data.ts") },
    outDir: tmp,
    format: ["esm"],
    outExtension: () => ({ js: ".mjs" }),
    platform: "node",
    target: "node22",
    bundle: true,
    noExternal: [/.*/],
    config: false,
    silent: true,
    dts: false,
    sourcemap: false,
  });
  const { buildSiteData, renderData, renderPage, SITE_PAGES } = await import(pathToFileURL(join(tmp, "site.mjs")).href);
  const data = buildSiteData(root);
  const outputs = [["data.json", renderData(data)]];
  for (const file of SITE_PAGES) outputs.push([file, renderPage(readFileSync(join(SITE, file), "utf8"), file, data)]);

  const stale = outputs.filter(([file, text]) => {
    try {
      return readFileSync(join(SITE, file), "utf8") !== text;
    } catch {
      return true;
    }
  });
  if (CHECK) {
    if (stale.length) {
      console.error(`site is stale: ${stale.map(([f]) => f).join(", ")} — run \`pnpm run build:site\``);
      process.exit(1);
    }
    console.log("site is up to date");
  } else {
    for (const [file, text] of stale) writeFileSync(join(SITE, file), text);
    const l = data.rgaa.levels;
    console.log(
      `site: ${stale.length} file(s) written · RGAA ${data.rgaa.criteria} criteria: ${l.det} deterministic / ${l.nc} NC proven / ${l.hint} signals / ${l.llm} judgment only · ACT ${data.act.caught}/${data.act.failedScored} on ${data.act.scoredRules} rules`,
    );
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

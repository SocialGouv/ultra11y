import { defineConfig } from "tsup";

// TWO artefacts, deliberately separate.
//
// 1. The ENGINE (scripts/ultra11y.mjs) — the TypeScript engine bundled into a single,
//    dependency-free ESM script that any agent sandbox can run with `node`, no
//    `npm install` at skill-use time. `scripts/copy-bundle.mjs` then mirrors the byte-exact
//    bundle into each skill dir so it installs standalone.
//
// 2. The TEST-RUNNER PLUGINS (dist/) — `ultra11y/playwright`, `ultra11y/cypress` and
//    `ultra11y/cypress/plugin`, imported by a project that has ultra11y as a devDependency.
//    They are NOT part of the engine bundle: a Cypress support file must not pull 2.4 MB of
//    audit engine into the browser. They stay tiny because they only pipe a collected page
//    to the engine, which they spawn.
//
// Both committed bundles are verified reproducible in CI via `pnpm run check:build`.
export default defineConfig([
  {
    entry: { ultra11y: "src/cli.ts" },
    outDir: "scripts",
    format: ["esm"],
    outExtension: () => ({ js: ".mjs" }),
    target: "node22",
    platform: "node",
    bundle: true,
    // tsup externalises packages listed in `dependencies` by default; force them
    // into the bundle so the shipped .mjs is truly standalone (no node_modules at
    // skill-use time). domhandler is type-only but listed for safety.
    noExternal: ["htmlparser2", "domhandler", "@babel/parser"],
    clean: false,
    minify: false,
    splitting: false,
    sourcemap: false,
    banner: { js: "#!/usr/bin/env node" },
  },
  {
    entry: {
      playwright: "src/integrations/playwright.ts",
      cypress: "src/integrations/cypress.ts",
      "cypress-plugin": "src/integrations/cypress-plugin.ts",
    },
    outDir: "dist",
    format: ["esm"],
    outExtension: () => ({ js: ".mjs" }),
    target: "node22",
    platform: "node",
    bundle: true,
    dts: true,
    clean: false,
    minify: false,
    // Each entry is self-contained: shared chunks would need a fourth published path and
    // buy nothing at this size.
    splitting: false,
    sourcemap: false,
  },
]);

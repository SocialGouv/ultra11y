import { defineConfig } from "tsup";

// TWO artefacts, deliberately separate.
//
// 1. The ENGINE (scripts/ultra11y.mjs) — the TypeScript engine bundled into a single,
//    dependency-free ESM script that any agent sandbox can run with `node`, no
//    `npm install` at skill-use time. `scripts/copy-bundle.mjs` then mirrors the byte-exact
//    bundle into each skill dir so it installs standalone.
//
// 2. The TEST-RUNNER PLUGINS (dist/) — `ultra11y/playwright`, `ultra11y/cypress`,
//    `ultra11y/cypress/plugin`, `ultra11y/vitest` and `ultra11y/jest`, imported by a project
//    that has ultra11y as a devDependency.
//    They are NOT part of the engine bundle: a Cypress support file must not pull 2.4 MB of
//    audit engine into the browser. They stay tiny because they only pipe a collected page
//    to the engine, which they spawn.
//
// 3. `ultra11y/jest` AGAIN, as CommonJS (dist/jest.cjs). Jest `require`s its dependencies unless
//    the project runs it in ESM mode, and an `.mjs` cannot be required — so the one runner that
//    needs it gets a CJS twin, built from the same source, its types shared with the ESM build.
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
    noExternal: ["htmlparser2", "domhandler", "@babel/parser", "fdir", "picomatch", "ignore", "get-tsconfig"],
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
      vitest: "src/integrations/vitest.ts",
      jest: "src/integrations/jest.ts",
    },
    outDir: "dist",
    format: ["esm"],
    outExtension: () => ({ js: ".mjs" }),
    target: "node22",
    platform: "node",
    bundle: true,
    dts: true,
    // CLEAN, unlike the engine entry above — and the asymmetry is the point. `scripts/` holds
    // hand-written scripts beside the generated bundle, so wiping it would be destructive;
    // `dist/` holds nothing but build output. Left uncleaned, a `dts` chunk whose content hash
    // changes leaves its predecessor behind, and the stale one is then COMMITTED and PUBLISHED:
    // `check:build` compares what changed, never what is left over, so only
    // tests/integrations.test.ts caught it.
    //
    // Except the CJS twin below: the three configs build in parallel, so this clean must not
    // delete what the next one writes.
    clean: ["!jest.cjs"],
    minify: false,
    // Each entry is self-contained: shared chunks would need a fourth published path and
    // buy nothing at this size.
    splitting: false,
    sourcemap: false,
  },
  {
    entry: { jest: "src/integrations/jest.ts" },
    outDir: "dist",
    format: ["cjs"],
    outExtension: () => ({ js: ".cjs" }),
    target: "node22",
    platform: "node",
    bundle: true,
    // `import.meta.url` (the engine path, src/integrations/core.ts) has no CJS meaning: shimmed.
    shims: true,
    dts: false,
    clean: false,
    minify: false,
    splitting: false,
    sourcemap: false,
  },
]);

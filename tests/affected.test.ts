// #144 — `affected`: the sample pages a diff can change. The lite gate captures nothing else, so a
// page this misses is a regression that ships; every case below is a way a page is reached.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildAffectedGraph, extractSpecifiers, nextWrappers, parseModule, selectAffected } from "../src/affected.js";
import { main } from "../src/cli.js";
import { validateSample } from "../src/sample.js";

const PAGES = [{ id: "home", sources: ["src/app/page.tsx"] }, { id: "about", sources: ["./src/app/about/page.tsx"] }, { id: "lonely" }];
const GLOBAL = ["src/styles/global.scss"];

const FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "fixture", dependencies: { react: "19.0.0", next: "16.0.0" } }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "~/*": ["./src/*"] } } }),
  ".ultra11yrc.json": JSON.stringify({ sample: { pages: PAGES.map((p) => ({ ...p, name: p.id, url: `http://localhost/${p.id}` })), global: GLOBAL } }),
  "src/app/layout.tsx": `import "~/styles/global.scss";\nexport default function L({ children }) { return <html lang="fr"><body>{children}</body></html>; }\n`,
  "src/app/page.tsx": [
    `import React from "react";`,
    `import dynamic from "next/dynamic";`,
    `import { Hero } from "~/modules/home/Hero";`,
    `import type { Props } from "~/types";`,
    `import { Shape } from "~/types";`,
    `// import { Orphan } from "~/modules/shared/Orphan";`,
    `const Lazy = dynamic(() => import("~/modules/home/Lazy"));`,
    `export default function Page() { return <main><Hero /><Lazy /></main>; }`,
  ].join("\n"),
  "src/app/about/layout.tsx": `export default function AboutLayout({ children }) { return <section>{children}</section>; }\n`,
  "src/app/about/page.tsx": `import Card from "../../modules/shared/Card";\nimport { helper } from "~/modules/shared";\nexport default function About() { return <Card n={helper} />; }\n`,
  "src/modules/home/Hero.tsx": `import {\n  Button,\n} from "~/modules/shared";\nimport styles from "./Hero.module.scss";\nexport function Hero() { return <div className={styles.hero}><Button /></div>; }\n`,
  "src/modules/home/Hero.module.scss": `@use "../../styles/tokens";\n.hero { color: tokens.$ink; }\n`,
  "src/modules/home/Lazy.tsx": `export default function Lazy() { return <p>lazy</p>; }\n`,
  "src/modules/home/Hero.test.tsx": `import { Hero } from "./Hero";\n`,
  "src/styles/_tokens.scss": `$ink: #000;\n`,
  "src/styles/global.scss": `body { margin: 0; }\n`,
  "src/modules/shared/Button.tsx": `export function Button() { return <button>ok</button>; }\n`,
  "src/modules/shared/Card.tsx": `export default function Card() { return <article />; }\n`,
  "src/modules/shared/Orphan.tsx": `export function Orphan() { return <aside />; }\n`,
  "src/types.ts": `export interface Props { a: string }\nexport type Shape = "a" | "b";\nexport const LIMIT = 3;\n`,
  "src/modules/shared/index.ts": `export { Button } from "./Button";\nexport { default as Card } from "./Card";\nexport { Orphan } from "./Orphan";\nexport * from "./more";\nexport type { Props } from "../../types";\n`,
  "src/modules/shared/more.ts": `export const helper = 1;\n`,
};

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "u11y-affected-"));
  for (const [rel, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const select = (changed: string[]) => selectAffected({ root, pages: PAGES, global: GLOBAL, changed });

describe("affected — selection by the sources and what they import", () => {
  it("selects the page whose declared source changed", () => {
    expect(select(["src/app/about/page.tsx"]).pages).toEqual(["about"]);
  });

  it("follows tsconfig aliases transitively, three imports below the page", () => {
    const r = select(["src/modules/shared/Button.tsx"]);
    expect(r.pages).toEqual(["home"]);
    expect(r.reasons.home).toEqual(["src/modules/shared/Button.tsx"]);
  });

  it("follows relative imports, and dynamic `import()`", () => {
    expect(select(["src/modules/shared/Card.tsx"]).pages).toEqual(["about"]);
    expect(select(["src/modules/home/Lazy.tsx"]).pages).toEqual(["home"]);
  });

  it("follows a stylesheet import and a Sass `@use` of a partial", () => {
    expect(select(["src/modules/home/Hero.module.scss"]).pages).toEqual(["home"]);
    expect(select(["src/styles/_tokens.scss"]).pages).toEqual(["home"]);
  });

  it("wraps an App Router page in every layout above it", () => {
    expect(select(["src/app/about/layout.tsx"]).pages).toEqual(["about"]);
    expect(select(["src/app/layout.tsx"]).pages).toEqual(["home", "about"]);
  });

  it("follows a barrel by the names imported through it, not by the whole module", () => {
    expect(select(["src/modules/shared/Button.tsx"]).pages).toEqual(["home"]);
    expect(select(["src/modules/shared/more.ts"]).pages, "through `export *`").toEqual(["about"]);
    // Orphan is re-exported by the barrel Hero imports from, and imported by no page.
    expect(select(["src/modules/shared/Orphan.tsx"]).pages).toEqual([]);
    expect(select(["src/modules/shared/index.ts"]).pages, "the barrel itself is on both paths").toEqual(["home", "about"]);
  });

  it("ignores a type-only import and an import that only a comment mentions", () => {
    expect(select(["src/types.ts"]).none).toBe(true);
    const orphan = select(["src/modules/shared/Orphan.tsx"]);
    expect(orphan.none).toBe(true);
    expect(orphan.unmapped).toEqual(["src/modules/shared/Orphan.tsx"]);
  });

  it("still counts a declared source the diff deleted", () => {
    expect(select(["src/app/gone/page.tsx", "src/app/page.tsx"]).pages).toEqual(["home"]);
    expect(selectAffected({ root, pages: [{ id: "x", sources: ["src/app/gone/page.tsx"] }], changed: ["src/app/gone/page.tsx"] }).pages).toEqual(["x"]);
  });
});

describe("affected — global files, nothing touched, and what it warns about", () => {
  it("selects every page, the unsourced one included, when a `global` file changed", () => {
    const r = select(["src/styles/global.scss", "src/modules/shared/Card.tsx"]);
    expect(r.all).toBe(true);
    expect(r.none).toBe(false);
    expect(r.pages).toEqual(["home", "about", "lonely"]);
    expect(r.global).toEqual(["src/styles/global.scss"]);
  });

  it("takes a global glob outside the root, for what no import reaches — a lockfile, a patched dependency", () => {
    const r = selectAffected({ root, pages: PAGES, global: ["../../pnpm-lock.yaml", "../../patches/**"], changed: ["../../patches/recharts.patch"] });
    expect(r.all).toBe(true);
  });

  it("treats the config itself as global", () => {
    expect(select([".ultra11yrc.json"]).all).toBe(true);
  });

  it("returns `none` when nothing changed, or nothing a page renders", () => {
    const empty = select([]);
    expect(empty).toMatchObject({ pages: [], all: false, none: true, unmapped: [], changed: 0 });
    expect(select(["README.md", "../other-package/x.tsx"])).toMatchObject({ none: true, unmapped: [] });
  });

  it("names the pages that declare no sources", () => {
    expect(select(["src/app/page.tsx"]).unsourced).toEqual(["lonely"]);
  });

  it("never reports a test file as unmapped markup", () => {
    expect(select(["src/modules/home/Hero.test.tsx"])).toMatchObject({ none: true, unmapped: [] });
  });

  it("reads only the files the pages reach", () => {
    const graph = buildAffectedGraph(root);
    const read = vi.spyOn(graph, "moduleOf");
    selectAffected({ root, pages: PAGES, global: GLOBAL, changed: ["src/modules/shared/Card.tsx"] }, graph);
    const opened = new Set(read.mock.calls.map((c) => c[0]));
    expect(opened.has("src/modules/shared/Orphan.tsx")).toBe(false);
    expect(opened.has("src/modules/home/Hero.test.tsx")).toBe(false);
  });
});

describe("affected — the pieces", () => {
  it("reads what a module imports by name, and what it exports", () => {
    const m = parseModule(
      [
        `import React, { useState, type FC } from "react";`,
        `import * as ns from "./ns";`,
        `export { a, b as c } from "./ab";`,
        `export * from "./star";`,
        `export * as all from "./all";`,
        `export type { T } from "./t";`,
        `export interface I {}`,
        `export const local = 1;`,
        `export default function Page() {}`,
      ].join("\n"),
      "x.tsx",
    );
    expect(m.imports).toEqual([
      { target: "react", names: ["default", "useState"] },
      { target: "./ns", names: "*" },
    ]);
    expect(m.reexports).toEqual([
      { target: "./ab", as: "a", from: "a" },
      { target: "./ab", as: "c", from: "b" },
      { target: "./all", as: "all", from: "*" },
    ]);
    expect(m.stars).toEqual(["./star"]);
    expect([...m.locals].sort()).toEqual(["Page", "default", "local"]);
    expect([...m.types].sort()).toEqual(["I", "T"]);
  });

  it("extracts value imports and skips the erased ones", () => {
    const specs = extractSpecifiers(
      [
        `import a from "./a";`,
        `import type { B } from "./b";`,
        `export type * from "./c";`,
        `import { type D, e } from "./de";`,
        `export { f } from "./f";`,
        `import "./side.css";`,
        `const g = require("./g");`,
        `/* import h from "./h"; */`,
      ].join("\n"),
      "x.tsx",
    );
    expect(specs.sort()).toEqual(["./a", "./de", "./f", "./g", "./side.css"]);
    expect(extractSpecifiers(`@use "sass:math";\n@import 'a';\n@forward "c";`, "x.scss").sort()).toEqual(["a", "c", "sass:math"]);
  });

  it("finds the wrappers of an App Router page, nearest first, and none for anything else", () => {
    const known = new Set(["src/app/layout.tsx", "src/app/(group)/template.tsx", "src/app/(group)/a/page.tsx"]);
    expect(nextWrappers("src/app/(group)/a/page.tsx", known)).toEqual(["src/app/(group)/template.tsx", "src/app/layout.tsx"]);
    expect(nextWrappers("src/modules/page.tsx", known)).toEqual([]);
  });

  it("validates `sample.global` as a list of globs", () => {
    const page = { id: "a", name: "A", url: "http://x/" };
    expect(validateSample({ pages: [page], global: ["src/app/layout.tsx"] }).sample?.global).toEqual(["src/app/layout.tsx"]);
    expect(validateSample({ pages: [page], global: "src/app/layout.tsx" }).ok).toBe(false);
    expect(validateSample({ pages: [page], global: [""] }).ok).toBe(false);
  });
});

describe("affected — the command, against a real merge-base", () => {
  // A throwaway repository: isolated from the machine's git configuration so the fixture commits
  // behave the same everywhere.
  const env = { ...process.env, GIT_CONFIG_GLOBAL: join(tmpdir(), "u11y-affected-none.gitconfig"), GIT_CONFIG_NOSYSTEM: "1" };
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env, stdio: "ignore" });

  it("diffs from the merge-base, so a commit on the base branch selects nothing", async () => {
    writeFileSync(env.GIT_CONFIG_GLOBAL, "");
    const repo = mkdtempSync(join(tmpdir(), "u11y-affected-git-"));
    try {
      const app = join(repo, "app");
      for (const [rel, content] of Object.entries(FILES)) {
        mkdirSync(dirname(join(app, rel)), { recursive: true });
        writeFileSync(join(app, rel), content);
      }
      git(repo, "init", "-q", "-b", "main");
      git(repo, "-c", "user.email=t@example.org", "-c", "user.name=t", "add", ".");
      git(repo, "-c", "user.email=t@example.org", "-c", "user.name=t", "commit", "-q", "-m", "base");
      git(repo, "checkout", "-q", "-b", "feature");
      writeFileSync(join(app, "src/modules/shared/Button.tsx"), `export function Button() { return <button>changed</button>; }\n`);
      git(repo, "-c", "user.email=t@example.org", "-c", "user.name=t", "commit", "-q", "-am", "feature");
      git(repo, "checkout", "-q", "main");
      writeFileSync(join(app, "src/modules/shared/Card.tsx"), `export default function Card() { return <article>main</article>; }\n`);
      git(repo, "-c", "user.email=t@example.org", "-c", "user.name=t", "commit", "-q", "-am", "main moved on");
      git(repo, "checkout", "-q", "feature");

      const out: string[] = [];
      const log = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
      const code = await main(["affected", "--since", "main", "--root", app, "--json"]);
      log.mockRestore();
      expect(code).toBe(0);
      const r = JSON.parse(out.join("\n"));
      expect(r.pages).toEqual(["home"]);
      expect(r.mergeBase).toMatch(/^[0-9a-f]{40}$/);

      const err: string[] = [];
      const le = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
      expect(await main(["affected", "--since", "no-such-ref", "--root", app])).toBe(2);
      expect(await main(["affected", "--root", app])).toBe(2);
      le.mockRestore();
      expect(err.join("\n")).toContain("fetch-depth: 0");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

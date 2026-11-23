// makeSpecResolver (src/graph/spec-resolve.ts) against real tsconfig files: aliases declared
// anywhere in the `extends` chain, `paths` relative to the config declaring them, `baseUrl`,
// per-directory config scoping, and the ESM ".js"-for-".ts" probe.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toPosix } from "../src/glob.js";
import { makeSpecResolver } from "../src/graph/spec-resolve.js";
import { readTsAliases } from "../src/graph/tsconfig.js";

let root: string;
const SOURCES = [
  "src/a.ts",
  "src/c/index.ts",
  "src/root.ts",
  "shared/s.ts",
  "ui/Button.tsx",
  "ui2/Card.tsx",
  "packages/app/src/main.ts",
  "packages/app/src/util.ts",
  "packages/app/src/page.mdx",
  "packages/lib/src/l.ts",
  "packages/lib/src/shared/s.ts",
  "packages/kit/src/k.ts",
  "other/o.ts",
];
/** cwd-relative posix path of a fixture file, the convention the graph uses. */
const p = (rel: string): string => toPosix(relative(process.cwd(), join(root, rel)));
const put = (rel: string, body: string): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};
function resolverFrom(startRel: string) {
  const known = new Set(SOURCES.map(p));
  const startDir = p(startRel);
  return makeSpecResolver(known, readTsAliases(startDir), startDir);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "u11y-spec-"));
  put("tsconfig.json", JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"], "#root": ["src/root.ts"] } } }));
  // JSONC on purpose: comments and trailing commas.
  put("tsconfig.base.json", '{\n  // shared aliases\n  "compilerOptions": { "paths": { "~/*": ["./shared/*"], "@ui/*": ["./ui/*", "./ui2/*"], }, },\n}\n');
  put("packages/app/tsconfig.json", JSON.stringify({ extends: ["../../tsconfig.base.json", "../../tsconfig.json"] }));
  put("packages/kit/tsconfig.json", JSON.stringify({ extends: "../../tsconfig.base.json" }));
  put("packages/lib/tsconfig.json", JSON.stringify({ extends: "../../tsconfig.base.json", compilerOptions: { baseUrl: "src" } }));
  for (const f of SOURCES) put(f, "export const x = 1;\n");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("makeSpecResolver — tsconfig paths through the extends chain", () => {
  it("resolves aliases inherited through `extends`, relative to the config declaring them", () => {
    const resolve = resolverFrom("packages/kit/src");
    const kit = p("packages/kit/src/k.ts");
    expect(resolve(kit, "~/s")).toBe(p("shared/s.ts"));
    // Every target of a pattern is tried in order.
    expect(resolve(kit, "@ui/Button")).toBe(p("ui/Button.tsx"));
    expect(resolve(kit, "@ui/Card")).toBe(p("ui2/Card.tsx"));
  });

  it("takes `paths` from the LAST config of an array `extends` that declares them", () => {
    const resolve = resolverFrom("packages/app/src");
    const main = p("packages/app/src/main.ts");
    expect(resolve(main, "@/a")).toBe(p("src/a.ts"));
    expect(resolve(main, "@/c")).toBe(p("src/c/index.ts"));
    expect(resolve(main, "#root")).toBe(p("src/root.ts"));
  });

  it("resolves inherited paths against the inheriting config's baseUrl", () => {
    const resolve = resolverFrom("packages/lib/src");
    expect(resolve(p("packages/lib/src/l.ts"), "~/s")).toBe(p("packages/lib/src/shared/s.ts"));
  });

  it("applies a config only to importers inside its directory, and leaves bare packages unresolved", () => {
    const resolve = resolverFrom("packages/app/src");
    // The chain's root tsconfig.json is a candidate of its own, scoped to the whole tree.
    expect(resolve(p("other/o.ts"), "@/a")).toBe(p("src/a.ts"));
    expect(resolve(p("packages/app/src/main.ts"), "react")).toBeNull();
  });

  it("maps an ESM '.js' specifier onto its '.ts' source, relative and aliased", () => {
    const resolve = resolverFrom("packages/app/src");
    const main = p("packages/app/src/main.ts");
    expect(resolve(main, "./util.js")).toBe(p("packages/app/src/util.ts"));
    expect(resolve(main, "@/a.js")).toBe(p("src/a.ts"));
  });

  it("treats an asset specifier as external", () => {
    const resolve = resolverFrom("packages/app/src");
    expect(resolve(p("packages/app/src/main.ts"), "./logo.svg")).toBeNull();
  });
});

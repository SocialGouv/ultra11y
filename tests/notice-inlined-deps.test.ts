// WHAT SHIPS INSIDE THE BUNDLE IS NAMED IN THE NOTICE.
//
// tsup inlines a handful of packages into scripts/ultra11y.mjs so the engine installs
// standalone. Three of them are BSD-2-Clause, whose binary-redistribution clause requires the
// copyright notice to travel with the distribution — and the NOTICE named none of them, nor
// the vendored codeindex engine. The list below is not typed by hand: it is read from the
// bundle itself (esbuild's module path comments), so a newly inlined package that nobody
// added to the NOTICE fails here before it ships.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const notice = readFileSync(new URL("../NOTICE", import.meta.url), "utf8");
const bundle = readFileSync(new URL("../scripts/ultra11y.mjs", import.meta.url), "utf8");

/** Package names of every module the bundle inlines from node_modules — `@scope/name` kept. */
function inlinedPackages(src: string): string[] {
  const names = new Set<string>();
  for (const m of src.matchAll(/^\/\/ \S*node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/@\n]+)/gm)) names.add(m[1]!);
  return [...names].sort();
}

describe("NOTICE names every package inlined into the engine bundle", () => {
  const inlined = inlinedPackages(bundle);

  it("reads the inlined set from the bundle, not from a list in this file", () => {
    // The guard only means something if the bundle carries the comments it is read from.
    expect(inlined, "esbuild module path comments are present in the committed bundle").toContain("htmlparser2");
    expect(inlined.length).toBeGreaterThanOrEqual(5);
  });

  it.each(["domhandler", "domelementtype", "entities", "htmlparser2", "@babel/parser"])("%s is inlined and carried by the NOTICE with its licence", (pkg) => {
    expect(inlined).toContain(pkg);
    const line = notice.split("\n").find((l) => l.trim().startsWith(pkg));
    expect(line, `${pkg} has a line in NOTICE`).toBeDefined();
    expect(line).toMatch(/MIT|BSD-2-Clause/);
  });

  it("names every inlined package, whatever tsup pulls in tomorrow", () => {
    const missing = inlined.filter((pkg) => !notice.split("\n").some((l) => l.trim().startsWith(pkg)));
    expect(missing, "inlined into scripts/ultra11y.mjs but absent from NOTICE").toEqual([]);
  });

  it("reproduces the BSD-2-Clause conditions, which a binary redistribution must carry", () => {
    expect(notice).toMatch(/Redistributions in binary form must reproduce the above copyright\s+notice/);
    expect(notice).toMatch(/Copyright \(c\) Felix Böhm/);
  });

  it("names the vendored codeindex engine and its licence", () => {
    expect(notice).toMatch(/src\/vendor\/codeindex-engine\.mjs/);
    expect(notice).toMatch(/@maxgfr\/codeindex \(MIT/);
  });
});

// A standards pack is PROJECT configuration, and a long-lived MCP server serves many
// projects. So the packs a tool call can see are the ones the project named by `cwd`
// declares — not a list frozen into the server, and not another project's.
//
// This is the file that proves the headline behaviour: a country pack loaded at runtime is
// a first-class standard over MCP, and two projects that each define a different pack under
// the SAME key do not see each other's.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { callTool } from "../src/mcp/handlers.js";
import { createServer } from "../src/mcp/server.js";
import { listStandards, loadPack, resetScopes } from "../src/standards/index.js";

const temps: string[] = [];

/** A minimal valid pack: one theme, one criterion, mapped onto a real AA success criterion. */
function pack(key: string, name: string, criterionTitle: string): unknown {
  return {
    key,
    name,
    fullName: `${name} — a test standard`,
    org: "Test",
    country: "XX",
    baseVersion: "1.0",
    wcagVersion: "2.2",
    locales: ["en"],
    defaultLocale: "en",
    license: "CC0",
    source: "https://example.org",
    attribution: "test fixture",
    idPattern: "^\\d+\\.\\d+$",
    themes: [{ number: 1, name: { en: "Theme one" }, count: 1 }],
    criteria: [{ id: "1.1", theme: 1, title: { en: criterionTitle }, titlePlain: { en: criterionTitle }, wcag: ["1.1.1"] }],
  };
}

/** A project root whose `.ultra11yrc.json` declares `packObj`. */
function projectWith(packObj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "u11y-scope-"));
  temps.push(dir);
  mkdirSync(join(dir, "packs"), { recursive: true });
  writeFileSync(join(dir, "packs", "std.json"), JSON.stringify(packObj));
  writeFileSync(join(dir, ".ultra11yrc.json"), JSON.stringify({ packs: ["./packs/std.json"] }));
  writeFileSync(join(dir, "index.html"), '<!doctype html><html lang="en"><head><title>T</title></head><body><p>x</p></body></html>');
  return dir;
}

async function criteria(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  return JSON.parse((await callTool("ultra11y_criteria", args)).text) as Record<string, unknown>;
}

let ALPHA: string;
let BETA: string;
let PLAIN: string;

beforeAll(() => {
  // Same pack KEY, different content. This is the case a process-wide registry gets wrong.
  ALPHA = projectWith(pack("xx101", "Alpha", "Alpha's only criterion"));
  BETA = projectWith(pack("xx101", "Beta", "Beta's only criterion"));
  PLAIN = projectWith(pack("xx999", "Solo", "Solo criterion"));
});

afterEach(() => {
  resetScopes();
});

afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

describe("a project's standards packs are visible over MCP", () => {
  it("registers a runtime pack and reports it as a standard", async () => {
    const res = await criteria({ cwd: PLAIN });
    expect(res.standard).toBe("wcag");
    // The pack is registered for this project, so asking for it by key now works — the
    // behaviour that used to be rejected twice, at the schema and again at the handler.
    const solo = await criteria({ cwd: PLAIN, standard: "xx999" });
    expect(solo.standard).toBe("xx999");
  });

  it("refuses a standard the project did not declare, naming what it has", async () => {
    await expect(criteria({ cwd: PLAIN, standard: "xx101" })).rejects.toThrow(/unknown standard "xx101"/);
  });

  it("keeps two projects' same-key packs apart", async () => {
    const a = (await criteria({ cwd: ALPHA, standard: "xx101", sc: "1.1" })).text as string;
    const b = (await criteria({ cwd: BETA, standard: "xx101", sc: "1.1" })).text as string;
    expect(a).toContain("Alpha's only criterion");
    expect(a).not.toContain("Beta");
    expect(b).toContain("Beta's only criterion");
    expect(b).not.toContain("Alpha");
  });

  it("leaves the global registry untouched by any project's packs", async () => {
    await criteria({ cwd: ALPHA, standard: "xx101" });
    // Outside every scope, only the core and the built-ins exist. A project's pack leaking
    // here would make it resolvable for projects that never declared it.
    expect(listStandards()).toEqual(["wcag", "rgaa"]);
  });

  it("still serves the built-in standards inside a project scope", async () => {
    const res = await criteria({ cwd: ALPHA, standard: "rgaa", sc: "8.3" });
    expect(res.standard).toBe("rgaa");
  });
});

describe("a broken pack fails loudly", () => {
  it("refuses to serve the project rather than falling back to WCAG", async () => {
    const dir = mkdtempSync(join(tmpdir(), "u11y-scope-bad-"));
    temps.push(dir);
    mkdirSync(join(dir, "packs"), { recursive: true });
    // 9.9.9 is well-formed but never existed — the validator rejects a fabricated SC.
    const bad = pack("xxbad", "Bad", "Bad criterion") as { criteria: { wcag: string[] }[] };
    bad.criteria[0]!.wcag = ["9.9.9"];
    writeFileSync(join(dir, "packs", "std.json"), JSON.stringify(bad));
    writeFileSync(join(dir, ".ultra11yrc.json"), JSON.stringify({ packs: ["./packs/std.json"] }));

    // Silently serving WCAG here would be the false conformance claim this tool exists to
    // prevent: the caller asked for one standard and would be answered about another.
    await expect(criteria({ cwd: dir, standard: "wcag" })).rejects.toThrow(/9\.9\.9|invalid pack/);
  });
});

describe("secondaryMappings do not leak between projects", () => {
  it("clones a built-in before a project re-keys it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "u11y-scope-sm-"));
    temps.push(dir);
    writeFileSync(join(dir, ".ultra11yrc.json"), JSON.stringify({ secondaryMappings: [{ standard: "rgaa", ruleId: "dyn-live-region", criterion: "7.4" }] }));
    await criteria({ cwd: dir, standard: "rgaa" });

    // The shared built-in must be exactly as it shipped: one mapping, still disabled. Read
    // outside every scope — mutating it in place would re-key RGAA for every other project
    // this server serves.
    const shared = loadPack("rgaa");
    expect(shared.secondaryMappings?.find((m) => m.ruleId === "dyn-live-region")?.enabled).toBe(false);
  });
});

describe("the resource layer sees the same standards the tools do", () => {
  it("serves a project's own pack under std:// when the server is dedicated to it", async () => {
    // `resources/read` carries no `cwd`, so it resolves against the server's project root.
    // Without this a dedicated server would serve a pack as a tool and deny it as a
    // resource — the same standard, two answers.
    const server = createServer({ defaultCwd: PLAIN });
    const reply = await new Promise<any>((resolve) => {
      void server.handle({ jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "std://xx999/criteria" } } as any, resolve);
    });
    expect(reply.error).toBeUndefined();
    expect(JSON.parse(reply.result.contents[0].text).standard).toBe("xx999");
  });

  it("lists that pack's resources too", async () => {
    const server = createServer({ defaultCwd: PLAIN });
    const reply = await new Promise<any>((resolve) => {
      void server.handle({ jsonrpc: "2.0", id: 2, method: "resources/list" } as any, resolve);
    });
    const uris = reply.result.resources.map((r: { uri: string }) => r.uri);
    expect(uris).toContain("std://xx999/criteria");
    expect(uris).toContain("std://xx999/method");
  });
});

// The standard, served as a resource.
//
// In MCP the documentation a method refers to is a RESOURCE, not a tool call. A client
// should be able to fetch what criterion 8.3 requires the way it fetches a file — without
// spending a tool call, and without the model having to decide to make one.
import { describe, expect, it } from "vitest";
import { createServer, type JsonRpcMessage } from "../src/mcp/server.js";
import { callTool } from "../src/mcp/handlers.js";

const server = createServer({});
let nextId = 0;

async function rpc(method: string, params?: Record<string, unknown>): Promise<any> {
  return new Promise((resolve) => {
    void server.handle({ jsonrpc: "2.0", id: ++nextId, method, ...(params ? { params } : {}) } as JsonRpcMessage, resolve as (m: JsonRpcMessage) => void);
  });
}

async function read(uri: string): Promise<any> {
  const r = await rpc("resources/read", { uri });
  if (r.error) throw new Error(`${r.error.code} ${r.error.message}`);
  return JSON.parse(r.result.contents[0].text);
}

describe("resources/list stays bounded", () => {
  it("indexes each standard without enumerating its criteria", async () => {
    const r = await rpc("resources/list");
    const std = r.result.resources.filter((x: { uri: string }) => x.uri.startsWith("std://"));
    const uris = std.map((x: { uri: string }) => x.uri);
    expect(uris).toContain("std://wcag/criteria");
    expect(uris).toContain("std://rgaa/criteria");
    expect(uris).toContain("std://rgaa/method");
    expect(uris).toContain("std://rgaa/glossary");
    expect(uris).toContain("std://rgaa/pack.json");
    // RGAA alone has 106 criteria and 119 glossary terms. Enumerating them would bloat
    // every client's list and go stale as soon as a project's own pack registers.
    expect(std.length).toBeLessThan(20);
    for (const x of std) expect(x.mimeType).toBe("application/json");
  });

  it("offers a glossary resource for every standard that defines terms", async () => {
    const r = await rpc("resources/list");
    const uris = r.result.resources.map((x: { uri: string }) => x.uri);
    // The core defines its own terms, so it gets the same treatment a country pack does.
    // The listing is computed from what a standard actually ships, never assumed.
    expect(uris).toContain("std://wcag/glossary");
    expect(uris).toContain("std://rgaa/glossary");
  });

  it("keeps serving the skill's own documentation", async () => {
    const r = await rpc("resources/list");
    const uris = r.result.resources.map((x: { uri: string }) => x.uri);
    expect(uris).toContain("skill://SKILL.md");
  });
});

describe("resources/templates/list carries the per-item URIs", () => {
  it("declares the four templates", async () => {
    const r = await rpc("resources/templates/list");
    const templates = r.result.resourceTemplates.map((t: { uriTemplate: string }) => t.uriTemplate);
    expect(templates).toEqual([
      "std://{standard}/criteria/{id}",
      "std://{standard}/themes/{number}",
      "std://{standard}/glossary/{term}",
      "std://{standard}/guidance/{criterion}",
    ]);
  });
});

describe("resources/read", () => {
  it("returns a country criterion in full", async () => {
    const c = await read("std://rgaa/criteria/8.3");
    expect(c.criterion.id).toBe("8.3");
    expect(c.criterion.tests[0].id).toBe("8.3.1");
  });

  it("agrees exactly with the tool that answers the same question", async () => {
    // One implementation, two transports. A resource and its tool must never disagree
    // about what a criterion says.
    const viaResource = await read("std://rgaa/criteria/8.3");
    const viaTool = JSON.parse((await callTool("ultra11y_criteria", { standard: "rgaa", sc: "8.3", include_guidance: true })).text);
    expect(viaResource).toEqual(viaTool);
  });

  it("serves a theme, a glossary term, guidance, the index and the plan", async () => {
    expect((await read("std://rgaa/themes/8")).kind).toBe("theme");
    expect((await read("std://rgaa/glossary/lien")).anchor).toBe("lien");
    expect((await read("std://rgaa/guidance/13.2")).entries.length).toBeGreaterThan(0);
    expect((await read("std://rgaa/criteria")).kind).toBe("index");
    expect((await read("std://wcag/method")).total).toBe(55);
    expect((await read("std://rgaa/pack.json")).key).toBe("rgaa");
  });

  it("refuses an unknown standard, naming the ones it has", async () => {
    const r = await rpc("resources/read", { uri: "std://nope/criteria" });
    expect(r.error.code).toBe(-32602);
    expect(r.error.message).toMatch(/unknown standard "nope"/);
  });

  it("refuses an unknown criterion rather than returning an empty document", async () => {
    const r = await rpc("resources/read", { uri: "std://rgaa/criteria/99.9" });
    expect(r.error.code).toBe(-32602);
  });

  it("never reaches the filesystem from a std:// path", async () => {
    // It does not touch disk today. Asserted so a later refactor that routes std:// through
    // the file reader cannot quietly introduce a traversal.
    const r = await rpc("resources/read", { uri: "std://../../etc/passwd" });
    expect(r.error.code).toBe(-32602);
    expect(r.error.message).toMatch(/unknown standard/);
  });

  it("leaves the skill:// scheme and its containment check alone", async () => {
    const ok = await rpc("resources/read", { uri: "skill://SKILL.md" });
    expect(ok.result.contents[0].mimeType).toBe("text/markdown");
    const traversal = await rpc("resources/read", { uri: "skill://../../../etc/passwd" });
    expect(traversal.error.code).toBe(-32602);
  });
});

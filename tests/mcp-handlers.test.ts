import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type JsonRpcMessage } from "../src/mcp/server.js";
import { callTool, ToolError } from "../src/mcp/handlers.js";

// The handlers driven through the JSON-RPC core, in-process, against a real
// project with real accessibility problems in it. Nothing here mocks the
// engine: the point is that a tool name reaches the same library call the CLI
// makes.

let PROJECT: string;
const temps: string[] = [];

// Deliberately broken markup: an image with no alt, a link whose purpose is
// opaque, an unlabelled input, and a button with no accessible name.
const PAGE = `<!doctype html>
<html lang="en">
<head><title>Shop</title></head>
<body>
  <img src="hero.png">
  <a href="/details">click here</a>
  <input type="text">
  <button></button>
</body>
</html>
`;

beforeAll(() => {
  PROJECT = mkdtempSync(join(tmpdir(), "u11y-mcp-"));
  temps.push(PROJECT);
  mkdirSync(join(PROJECT, "src"), { recursive: true });
  writeFileSync(join(PROJECT, "index.html"), PAGE);
});

afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const server = createServer();

async function rpc(msg: Omit<JsonRpcMessage, "jsonrpc">): Promise<JsonRpcMessage | undefined> {
  let out: JsonRpcMessage | undefined;
  await server.handle({ jsonrpc: "2.0", ...msg }, (m) => {
    out = m;
  });
  return out;
}

async function call(name: string, args: Record<string, unknown>): Promise<JsonRpcMessage> {
  return (await rpc({ id: 1, method: "tools/call", params: { name, arguments: args } }))!;
}

async function ok(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await call(name, args);
  const result = res.result as { content: { text: string }[]; isError?: boolean } | undefined;
  expect(res.error, `unexpected JSON-RPC error: ${JSON.stringify(res.error)}`).toBeUndefined();
  expect(result?.isError, `unexpected isError: ${result?.content?.[0]?.text}`).toBeFalsy();
  return JSON.parse(result!.content[0]!.text);
}

async function errorText(name: string, args: Record<string, unknown>): Promise<string> {
  const res = await call(name, args);
  const result = res.result as { content: { text: string }[]; isError?: boolean } | undefined;
  expect(result?.isError, "expected an isError tool result").toBe(true);
  return result!.content[0]!.text;
}

describe("lifecycle methods", () => {
  it("negotiates a protocol version and advertises all three primitives", async () => {
    const res = await rpc({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    const r = res!.result as { serverInfo: { name: string }; capabilities: unknown };
    expect(r.serverInfo.name).toBe("ultra11y");
    expect(r.capabilities).toEqual({
      tools: { listChanged: false },
      resources: { subscribe: false, listChanged: false },
      prompts: { listChanged: false },
    });
  });

  it("rejects an unknown method, an unknown tool and bad arguments as protocol errors", async () => {
    expect((await rpc({ id: 1, method: "resources/subscribe" }))!.error).toMatchObject({ code: -32601 });
    expect((await call("ultra11y_nope", {})).error).toMatchObject({ code: -32602 });
    expect((await call("ultra11y_read", { cwd: PROJECT })).error).toMatchObject({ code: -32602 });
  });
});

describe("audit", () => {
  it("finds the real problems in the page", async () => {
    const res = await ok("ultra11y_audit", { cwd: PROJECT });
    expect(res.tool).toBe("ultra11y");
    expect(Array.isArray(res.findings)).toBe(true);
    expect((res.findings as unknown[]).length).toBeGreaterThan(0);
  });

  it("tells the caller what static analysis did NOT decide", async () => {
    // Without this, a clean-looking audit reads as a clean audit.
    const res = await ok("ultra11y_audit", { cwd: PROJECT });
    expect(String(res.next)).toMatch(/untested, not conformant/);
    expect(String(res.next)).toContain("ultra11y_adjudicate");
  });

  it("audits the project root without being told what to glob", async () => {
    // A tool call with no globs means "this project", not "nothing".
    const res = await ok("ultra11y_audit", { cwd: PROJECT });
    expect((res.findings as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("adjudicate", () => {
  it("emits the criteria the engine cannot decide", async () => {
    const res = await ok("ultra11y_adjudicate", { cwd: PROJECT });
    expect(res.count).toBeTypeOf("number");
    expect(Number(res.count)).toBeGreaterThan(0);
    expect(String(res.next)).toMatch(/cannot decide/);
  });
});

describe("criteria", () => {
  it("returns one success criterion, with no project at all", async () => {
    const res = await ok("ultra11y_criteria", { sc: "1.1.1" });
    expect(res.sc).toBe("1.1.1");
    expect(String(res.text)).toMatch(/Non-text Content/);
  });

  it("lists them all when asked for none", async () => {
    const res = await ok("ultra11y_criteria", {});
    expect((res.criteria as unknown[]).length).toBeGreaterThan(30);
  });

  it("refuses a criterion that does not exist, rather than inventing one", async () => {
    // Looking a criterion up instead of recalling it is the whole point.
    expect(await errorText("ultra11y_criteria", { sc: "9.9.9" })).toMatch(/no such success criterion/);
  });
});

describe("read", () => {
  it("returns a line window and reports the real total", async () => {
    const res = await ok("ultra11y_read", { cwd: PROJECT, path: "index.html", start_line: 1, end_line: 3 });
    expect(res.start_line).toBe(1);
    expect(String(res.content).split("\n").length).toBeLessThanOrEqual(3);
  });

  it("refuses a path outside the project", async () => {
    // Containment is the whole point: this server can be reached over HTTP.
    expect(await errorText("ultra11y_read", { cwd: PROJECT, path: "/etc/passwd" })).toMatch(/outside the project/);
  });
});

describe("guardrails", () => {
  it("refuses a write tool unless the server allows writes", async () => {
    await expect(callTool("ultra11y_fix", { cwd: PROJECT })).rejects.toThrow(ToolError);
    await expect(callTool("ultra11y_init", { cwd: PROJECT })).rejects.toThrow(/--allow-write/);
  });

  it("says plainly that scan is not available over MCP, and what to run instead", async () => {
    // A browser subprocess is not a lifecycle a long-lived server should own.
    // Saying so beats failing obscurely. Reached through a write-enabled server,
    // since it is hidden from tools/list otherwise.
    await expect(callTool("ultra11y_scan", { cwd: PROJECT, target: "https://example.com" }, { allowWrite: true })).rejects.toThrow(/not available over MCP/);
    await expect(callTool("ultra11y_scan", { cwd: PROJECT, target: "https://example.com" }, { allowWrite: true })).rejects.toThrow(/ultra11y scan/);
  });

  it("reports a project root that does not exist", async () => {
    expect(await errorText("ultra11y_audit", { cwd: "/nope/not/here" })).toMatch(/project root not found/);
  });

  it("rejects an unsupported lang at the schema, before any work starts", async () => {
    // The declared enum catches this, so it comes back as a protocol error rather than a
    // tool result — which is right: the client sent something the schema it was given
    // forbids, and the UI frame really is closed at two values.
    expect((await call("ultra11y_report", { cwd: PROJECT, lang: "de" })).error).toMatchObject({ code: -32602 });
  });

  it("rejects an unknown standard at the handler, naming the ones it does know", async () => {
    // NOT a schema rejection. Which standards exist depends on the project — a country pack
    // arrives with a `--pack` flag or an `.ultra11yrc.json` — so an enum pinned at
    // tools/list time would refuse packs that are perfectly valid. The registry rules.
    const msg = await errorText("ultra11y_report", { cwd: PROJECT, standard: "en301549" });
    expect(msg).toMatch(/unknown standard "en301549"/);
    expect(msg).toMatch(/known: wcag, rgaa/);
  });

  it("refuses report_text and report_file together", async () => {
    expect(await errorText("ultra11y_check", { cwd: PROJECT, report_text: "x", report_file: "/tmp/r.md" })).toMatch(/not both/);
  });

  it("uses the server's default project when the caller omits one", async () => {
    const withDefault = createServer({ defaultCwd: PROJECT });
    let out: JsonRpcMessage | undefined;
    await withDefault.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ultra11y_audit", arguments: {} } }, (m) => {
      out = m;
    });
    const result = out!.result as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text).tool).toBe("ultra11y");
  });

  it("restores the working directory even when an audit throws", async () => {
    // The handlers chdir into the project so globs resolve as the CLI resolves
    // them. process.cwd() is per-process: leaking it would corrupt every later
    // call in the session.
    const before = process.cwd();
    await errorText("ultra11y_audit", { cwd: "/nope/not/here" });
    await ok("ultra11y_audit", { cwd: PROJECT });
    expect(process.cwd()).toBe(before);
  });
});

// THE PLUGIN, IN A REAL OPENCODE — BOTH MAJORS.
//
// tests/opencode-plugin.test.ts drives both entry points with fake hosts. A fake host proves
// the plumbing; only the real one proves the contract — and the real ones disagreed with
// every assumption once: OpenCode 1.19.5 refused the old plugin outright ("Plugin export is
// not a function", for its marker-string exports), OpenCode 2 ignored it (no default
// `{ id, setup }`), and inside both `process.execPath` is the Bun-compiled opencode binary,
// not node — so the engine spawn printed OpenCode's own --help, which the gate then threw
// at the agent as a "finding".
//
// So this boots each installed OpenCode as a server, in a throwaway HOME/XDG tree (never the
// user's own config), against a throwaway git repository whose next push carries a blocking
// finding, with a local OpenAI-compatible MOCK as the model: no credentials, no paid model.
// The mock answers each prompt `CMD: <command>` with a call to the shell tool, so the tool
// hook fires for real, and the test reads the tool part back from the session:
//
//   - the plugin loads (V2: plugin.list says active; V1: no "failed to load plugin" line);
//   - its two skills are registered;
//   - `git push origin main` is BLOCKED with the engine's own text, and the engine ran once;
//   - the retry in the same session goes through (the anti-loop marker, rule 2);
//   - `ls -la` runs, and the engine is never spawned for it;
//   - the npm-pin route: a package directory resolves through package.json `exports`.
//
// It SKIPS when no OpenCode is installed. `pnpm test:opencode` runs it; point it at binaries
// with OPENCODE_V1_BIN / OPENCODE_V2_BIN, otherwise the `opencode` on PATH is used for
// whichever major it is. V1 is `npx -y opencode-ai@1.19.5` away; its first run downloads the
// `@ai-sdk/openai-compatible` provider package the mock is spoken to through.
import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PASSWORD = "ultra11y-smoke";

function majorOf(bin: string): number | null {
  try {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 20_000 });
    const m = /\bv?(\d+)\.\d+\.\d+/.exec(r.stdout ?? "");
    return r.status === 0 && m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function binFor(major: 1 | 2): string | null {
  const explicit = process.env[`OPENCODE_V${major}_BIN`];
  if (explicit) return majorOf(explicit) === major ? explicit : null;
  return majorOf("opencode") === major ? "opencode" : null;
}

// ---------------------------------------------------------------------------------------
// The mock model: turn 1 asks for the shell tool, turn 2 (a tool result came back) says done.
// ---------------------------------------------------------------------------------------
type Msg = { role: string; content: unknown };
const textOf = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p as { text?: string }).text ?? "").join("") : "");

function startMock(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => {
      body += d;
    });
    req.on("end", () => {
      let j: { messages?: Msg[]; tools?: Array<{ function?: { name?: string; parameters?: { properties?: object } } }>; stream?: boolean; model?: string } = {};
      try {
        j = JSON.parse(body || "{}");
      } catch {
        /* an empty body is a probe */
      }
      const messages = j.messages ?? [];
      const last = messages[messages.length - 1];
      const tool = (j.tools ?? []).find((t) => /^(bash|shell)$/i.test(t.function?.name ?? ""));
      // The LAST user message carries the command, so a session can run several.
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const cmd = /CMD: (.+)/.exec(textOf(lastUser?.content))?.[1]?.trim();
      // OpenCode also asks the model for a session title, offering no tools: that gets text.
      const wantTool = !!(tool && cmd && last?.role !== "tool");
      const args: Record<string, string> = { command: cmd ?? "" };
      if (tool?.function?.parameters?.properties && "description" in tool.function.parameters.properties) args.description = "run it";
      const delta = wantTool
        ? {
            role: "assistant",
            tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: "function", function: { name: tool?.function?.name, arguments: JSON.stringify(args) } }],
          }
        : { role: "assistant", content: "done" };
      const finish = wantTool ? "tool_calls" : "stop";
      const base = { id: `chatcmpl-${Date.now()}`, created: Math.floor(Date.now() / 1000), model: j.model };
      const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
      if (j.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
        res.write(
          `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: finish }], usage })}\n\n`,
        );
        res.end("data: [DONE]\n\n");
        return;
      }
      const message = wantTool ? { role: "assistant", content: null, tool_calls: delta.tool_calls?.map(({ index: _i, ...t }) => t) } : delta;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, message, finish_reason: finish }], usage }));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1` })),
  );
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 90_000): Promise<T> {
  const end = Date.now() + ms;
  let lastError: unknown;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      lastError = e;
    }
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${what}${lastError ? ` (${String(lastError)})` : ""}`);
}

// ---------------------------------------------------------------------------------------
// One isolated OpenCode, one fixture repository.
// ---------------------------------------------------------------------------------------
interface Sandbox {
  root: string;
  proj: string;
  env: NodeJS.ProcessEnv;
  engineRuns: () => number;
}

function git(cwd: string, ...args: string[]) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/** A throwaway HOME/XDG tree and a repository whose next `git push` carries a blocking
 *  finding. `layout: "project"` drops the plugin into the project's .opencode/plugins/;
 *  `layout: "package"` builds an npm-shaped package directory for an explicit pin. */
function sandbox(major: 1 | 2, mockUrl: string): Sandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `u11y-oc-smoke-v${major}-`)));
  for (const d of ["home", "cfg/opencode", "data", "state", "cache"]) mkdirSync(join(root, d), { recursive: true });

  // The engine, wrapped so the test can count its runs.
  const counter = join(root, "engine-runs");
  const wrapper = join(root, "engine-wrapper.mjs");
  writeFileSync(
    wrapper,
    `import { appendFileSync } from "node:fs";\nimport { main } from ${JSON.stringify(join(repoRoot, "scripts", "ultra11y.mjs"))};\nappendFileSync(${JSON.stringify(counter)}, "x");\nprocess.exitCode = await main(process.argv.slice(2));\n`,
  );

  const proj = join(root, "proj");
  mkdirSync(proj);
  git(proj, "init", "-q", "-b", "main");
  git(proj, "config", "user.email", "smoke@example.invalid");
  git(proj, "config", "user.name", "smoke");
  // A fixture repository, the same as tests/e2e/helpers.ts: nothing here is ever published.
  git(proj, "config", "commit.gpgsign", "false");
  writeFileSync(join(proj, ".gitignore"), ".opencode\nskills\n");
  git(proj, "add", ".gitignore");
  git(proj, "commit", "-qm", "init");
  const origin = join(root, "origin.git");
  git(root, "init", "-q", "--bare", origin);
  git(proj, "remote", "add", "origin", origin);
  git(proj, "push", "-q", "-u", "origin", "main");
  // An <img> with no alt — a blocking 1.1.1 finding, the fixture hook.test.ts uses.
  writeFileSync(join(proj, "page.html"), '<!doctype html><html lang="en"><head><title>t</title></head><body><img src="a.png"></body></html>\n');
  git(proj, "add", "page.html");
  git(proj, "commit", "-qm", "page");

  const config =
    major === 2
      ? {
          providers: {
            mock: {
              name: "Mock",
              env: ["MOCK_API_KEY"],
              package: "@opencode/ai/providers/openai-compatible",
              settings: { baseURL: mockUrl },
              models: { m: { name: "Mock" } },
            },
          },
          model: "mock/m",
        }
      : {
          provider: { mock: { npm: "@ai-sdk/openai-compatible", name: "Mock", options: { baseURL: mockUrl, apiKey: "x" }, models: { m: { name: "Mock" } } } },
          model: "mock/m",
          permission: { bash: "allow" },
        };
  writeFileSync(join(root, "cfg", "opencode", "opencode.json"), `${JSON.stringify(config, null, 2)}\n`);

  // Nothing of the caller's OpenCode setup may leak in.
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("OPENCODE") && !k.startsWith("ULTRA11Y") && k !== "SKIP_A11Y") env[k] = v;
  Object.assign(env, {
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "cfg"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
    XDG_CACHE_HOME: join(root, "cache"),
    OPENCODE_SERVER_PASSWORD: PASSWORD,
    MOCK_API_KEY: "x",
    ULTRA11Y_BIN: wrapper,
  });
  return { root, proj, env, engineRuns: () => (existsSync(counter) ? readFileSync(counter, "utf8").length : 0) };
}

function installProjectPlugin(sb: Sandbox) {
  mkdirSync(join(sb.proj, ".opencode", "plugins"), { recursive: true });
  cpSync(join(repoRoot, ".opencode", "plugins", "ultra11y.js"), join(sb.proj, ".opencode", "plugins", "ultra11y.js"));
  // The skills sit where the npm package keeps them: <root>/skills beside .opencode/.
  cpSync(join(repoRoot, "skills"), join(sb.proj, "skills"), { recursive: true });
}

/** The published package's shape — package.json, the plugin, the skills — pinned by path,
 *  which both majors resolve exactly as they resolve an npm package: through `exports`. */
function pinPackage(sb: Sandbox, major: 1 | 2) {
  const pkg = join(sb.root, "pkg", "ultra11y");
  mkdirSync(join(pkg, ".opencode", "plugins"), { recursive: true });
  cpSync(join(repoRoot, "package.json"), join(pkg, "package.json"));
  cpSync(join(repoRoot, ".opencode", "plugins", "ultra11y.js"), join(pkg, ".opencode", "plugins", "ultra11y.js"));
  cpSync(join(repoRoot, "skills"), join(pkg, "skills"), { recursive: true });
  const cfgPath = join(sb.root, "cfg", "opencode", "opencode.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  cfg[major === 2 ? "plugins" : "plugin"] = [pkg];
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
}

interface Running {
  child: ChildProcess;
  log: () => string;
  call: (method: string, path: string, body?: unknown) => Promise<unknown>;
  stop: () => Promise<void>;
}

async function serve(bin: string, major: 1 | 2, sb: Sandbox): Promise<Running> {
  const port = await freePort();
  const child = spawn(bin, ["serve", "--port", String(port), "--hostname", "127.0.0.1", "--print-logs", "--log-level", major === 2 ? "debug" : "DEBUG"], {
    cwd: sb.proj,
    env: sb.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout?.on("data", (d) => {
    out += d;
  });
  child.stderr?.on("data", (d) => {
    out += d;
  });
  const auth = `Basic ${Buffer.from(`opencode:${PASSWORD}`).toString("base64")}`;
  const where = major === 2 ? `location%5Bdirectory%5D=${encodeURIComponent(sb.proj)}` : `directory=${encodeURIComponent(sb.proj)}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}${path.includes("?") ? "&" : "?"}${where}`, {
      method,
      headers: { authorization: auth, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${method} ${path}: HTTP ${r.status} ${await r.text()}`);
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  };
  await until("the server to answer", async () => (await call("GET", major === 2 ? "/api/skill" : "/skill")) !== undefined, 60_000);
  return {
    child,
    log: () => out,
    call,
    stop: async () => {
      child.kill("SIGTERM");
      await Promise.race([new Promise((r) => child.once("exit", r)), sleep(5_000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}

/** V2 wraps every answer in `{ location, data }`; V1 answers bare. */
const data = (r: unknown) => (r && typeof r === "object" && !Array.isArray(r) && "data" in r ? (r as { data: unknown }).data : r);

async function skillIds(srv: Running, major: 1 | 2): Promise<string[]> {
  const list = data(await srv.call("GET", major === 2 ? "/api/skill" : "/skill")) as Array<{ id?: string; name?: string }>;
  return list.map((s) => s.id ?? s.name ?? "");
}

interface ToolOutcome {
  status: string;
  message: string;
}

/** Prompt `CMD: <command>` in a session and return the shell tool part it produced. */
async function runCommand(srv: Running, major: 1 | 2, command: string, sessionID?: string): Promise<ToolOutcome & { sessionID: string }> {
  if (major === 2) {
    const id = sessionID ?? ((data(await srv.call("POST", "/api/session", {})) as { id: string }).id as string);
    const before = await toolParts2(srv, id);
    await srv.call("POST", `/api/session/${id}/prompt`, { text: `CMD: ${command}` });
    const part = await until(`the shell call for ${command}`, async () => {
      const parts = await toolParts2(srv, id);
      return parts.length > before.length && ["completed", "error"].includes(parts[0]?.status ?? "") ? parts[0] : null;
    });
    return { ...part, sessionID: id };
  }
  const id = sessionID ?? ((await srv.call("POST", "/session", {})) as { id: string }).id;
  const before = await toolParts1(srv, id);
  await srv.call("POST", `/session/${id}/message`, { model: { providerID: "mock", modelID: "m" }, parts: [{ type: "text", text: `CMD: ${command}` }] });
  const part = await until(`the bash call for ${command}`, async () => {
    const parts = await toolParts1(srv, id);
    const last = parts[parts.length - 1];
    return parts.length > before.length && ["completed", "error"].includes(last?.status ?? "") ? last : null;
  });
  return { ...part, sessionID: id };
}

/** V2 lists messages newest first; a tool part's error or text content is the outcome. */
async function toolParts2(srv: Running, id: string): Promise<ToolOutcome[]> {
  const msgs = data(await srv.call("GET", `/api/session/${id}/message`)) as Array<{ content?: Array<Record<string, unknown>> }>;
  const out: ToolOutcome[] = [];
  for (const m of msgs) {
    for (const p of m.content ?? []) {
      if (p.type !== "tool") continue;
      const state = p.state as { status: string; error?: { message?: string }; content?: Array<{ text?: string }> };
      out.push({ status: state.status, message: state.error?.message ?? (state.content ?? []).map((c) => c.text ?? "").join("") });
    }
  }
  return out;
}

/** V1 lists messages oldest first, as { info, parts }. */
async function toolParts1(srv: Running, id: string): Promise<ToolOutcome[]> {
  const msgs = (await srv.call("GET", `/session/${id}/message`)) as Array<{ parts?: Array<Record<string, unknown>> }>;
  const out: ToolOutcome[] = [];
  for (const m of msgs) {
    for (const p of m.parts ?? []) {
      if (p.type !== "tool") continue;
      const state = p.state as { status: string; error?: string; output?: string };
      out.push({ status: state.status, message: state.error ?? state.output ?? "" });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------

for (const major of [1, 2] as const) {
  const bin = binFor(major);
  describe.skipIf(!bin)(`OpenCode ${major} (${bin ?? "not installed"}) — the real binary`, () => {
    let mock: { server: Server; url: string };
    const roots: string[] = [];

    beforeAll(async () => {
      mock = await startMock();
    });
    afterAll(async () => {
      await new Promise((r) => mock?.server.close(r));
      for (const r of roots) rmSync(r, { recursive: true, force: true });
    });

    it("loads the project plugin, registers both skills, blocks a push once and lets the retry and `ls` through", async () => {
      const sb = sandbox(major, mock.url);
      roots.push(sb.root);
      installProjectPlugin(sb);
      const srv = await serve(bin as string, major, sb);
      try {
        // Loaded: both skills appear, and only our plugin adds them.
        const ids = await until("the bundled skills", async () => {
          const s = await skillIds(srv, major);
          return s.includes("ultra11y") && s.includes("review-a11y") ? s : null;
        });
        expect(ids).toEqual(expect.arrayContaining(["ultra11y", "review-a11y"]));
        if (major === 2) {
          // OpenCode 2 marks a plugin active once setup() has RETURNED, after the skills it
          // registers already show — so the status is polled, never read once (#138).
          const status = await until("the plugin to report active", async () => {
            const plugins = data(await srv.call("GET", "/api/plugin")) as Array<{ id: string; state: { status: string } }>;
            const s = plugins.find((p) => p.id === "ultra11y")?.state.status;
            return s === "active" ? s : null;
          });
          expect(status).toBe("active");
        }
        expect(srv.log()).not.toMatch(/failed to load plugin/i);

        // The gate: blocked, with the engine's own text, the engine run exactly once.
        const push = await runCommand(srv, major, "git push origin main");
        expect(push.status, push.message).toBe("error");
        expect(push.message).toMatch(/^ultra11y: 1 accessibility finding\(s\) \(1 blocking\) in the code about to be pushed\./);
        expect(push.message).toContain("review-a11y");
        expect(sb.engineRuns()).toBe(1);

        // Rule 2: the same session's retry goes through — the push really happens.
        const retry = await runCommand(srv, major, "git push origin main", push.sessionID);
        expect(retry.status, retry.message).toBe("completed");
        expect(sb.engineRuns()).toBe(2);

        // A command that publishes nothing: runs, and the engine is never spawned.
        const ls = await runCommand(srv, major, "ls -la");
        expect(ls.status, ls.message).toBe("completed");
        expect(ls.message).toContain("page.html");
        expect(sb.engineRuns()).toBe(2);
      } finally {
        await srv.stop();
      }
    });

    it(`resolves the npm-pin route — "${major === 2 ? "plugins" : "plugin"}": [<package>] — through package.json`, async () => {
      const sb = sandbox(major, mock.url);
      roots.push(sb.root);
      pinPackage(sb, major);
      const srv = await serve(bin as string, major, sb);
      try {
        await until("the bundled skills from the pinned package", async () => {
          const s = await skillIds(srv, major);
          return s.includes("ultra11y") && s.includes("review-a11y");
        });
        if (major === 2) {
          // OpenCode 2 marks a plugin active once setup() has RETURNED, after the skills it
          // registers already show — so the status is polled, never read once (#138).
          const status = await until("the plugin to report active", async () => {
            const plugins = data(await srv.call("GET", "/api/plugin")) as Array<{ id: string; state: { status: string } }>;
            const s = plugins.find((p) => p.id === "ultra11y")?.state.status;
            return s === "active" ? s : null;
          });
          expect(status).toBe("active");
        }
        expect(srv.log()).not.toMatch(/failed to load plugin/i);
      } finally {
        await srv.stop();
      }
    });
  });
}

it.skipIf(!!binFor(1) || !!binFor(2))("no OpenCode installed — the real-binary smoke is skipped", () => {
  expect(binFor(1) ?? binFor(2)).toBeNull();
});

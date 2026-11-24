// THE GUARD HOOK, IN A REAL CODEX.
//
// tests/hook.test.ts and the install-bundle CI job feed hooks/pre-tool-use.mjs a Codex-SHAPED
// payload. That proves the engine reads the shape; it proves nothing about Codex itself: that
// `codex plugin add` installs what the plugin needs, that Codex picks hooks/hooks.json up by
// convention, that it exports ${CLAUDE_PLUGIN_ROOT} to the command line written there, that its
// shell tool matches the matcher, and that it honours a `deny`.
//
// So this installs the plugin from the checkout into a throwaway CODEX_HOME (never the user's
// own), and drives `codex exec` against a local MOCK of the Responses API: no credentials, no
// paid model. The mock answers each prompt `CMD: <command>` with a call to whichever shell tool
// Codex offered, so the PreToolUse hook fires for real, and the test reads back the tool output
// Codex returned to the model:
//
//   - `codex plugin marketplace add <checkout>` + `codex plugin add` lay down the hook, its
//     guard, both skills and the engine;
//   - `git commit` on a staged blocking finding is BLOCKED by the hook, and no commit lands;
//   - the retry, in the same session (`codex exec resume`), goes through (rule 2, the
//     anti-loop marker keyed on the session id);
//   - `ls -la` runs untouched;
//   - the npm route, `ultra11y install --codex`, blocks the same commit with no plugin at all.
//
// Codex asks a human to trust a hook before it first runs it. Headless, `codex exec` takes
// `--dangerously-bypass-hook-trust` for exactly this ("automation that already vets hook
// sources"); the hook here is the checkout's own. The commands run with
// `--sandbox danger-full-access` on purpose: a hook that failed to fire would then let the
// commit through, instead of the sandbox failing it for an unrelated reason (workspace-write
// keeps .git read-only) and the test passing by accident.
//
// It SKIPS when no Codex is installed. `pnpm test:codex` runs it; point it at a binary with
// CODEX_BIN, otherwise the `codex` on PATH is used. ULTRA11Y_REQUIRE_CODEX=1 (set in CI)
// turns the skip into a failure.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = (JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string }).version;
const BAD_PAGE = '<!doctype html><html lang="en"><head><title>t</title></head><body><img src="a.png"></body></html>\n';
const BLOCKED = /blocked by PreToolUse hook: ultra11y: 1 accessibility finding\(s\) \(1 blocking\) in the code about to be committed\./;

function codexBin(): string | null {
  const bin = process.env.CODEX_BIN || "codex";
  try {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 20_000 });
    return r.status === 0 && /codex-cli \d+\.\d+\.\d+/.test(r.stdout ?? "") ? bin : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------
// The mock model: a Responses API stream. Turn 1 calls the shell tool with the command of the
// LAST user message; once a tool result came back, it says done.

type Item = { type?: string; role?: string; content?: unknown; output?: unknown };
const textOf = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p as { text?: string }).text ?? "").join("") : "");

interface Mock {
  server: Server;
  url: string;
  /** Every tool output Codex sent back to the model, in order. */
  outputs: string[];
}

function startMock(): Promise<Mock> {
  const outputs: string[] = [];
  let n = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => {
      body += d;
    });
    req.on("end", () => {
      if (!req.url?.includes("/responses")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end("{}");
        return;
      }
      let j: { input?: Item[]; tools?: Array<{ name?: string }> } = {};
      try {
        j = JSON.parse(body || "{}");
      } catch {
        /* an empty body is a probe */
      }
      const input = j.input ?? [];
      const last = input[input.length - 1];
      if (last?.type === "function_call_output") outputs.push(textOf(last.output));
      const lastUser = [...input].reverse().find((i) => i.type === "message" && i.role === "user");
      const cmd = /CMD: (.+)/.exec(textOf(lastUser?.content))?.[1]?.trim();
      const tools = (j.tools ?? []).map((t) => t.name ?? "");
      // `exec_command` (unified exec, a string `cmd`) on current Codex; `shell` (an argv array)
      // on older builds. Both are in hooks/hooks.json's matcher.
      const tool = tools.includes("exec_command") ? "exec_command" : tools.includes("shell") ? "shell" : null;
      const wantTool = !!(tool && cmd && last?.type !== "function_call_output");
      const id = `resp_${++n}`;
      const item = wantTool
        ? {
            type: "function_call",
            id: `fc_${n}`,
            call_id: `call_${n}`,
            name: tool,
            arguments: JSON.stringify(tool === "exec_command" ? { cmd } : { command: ["bash", "-lc", cmd] }),
          }
        : { type: "message", role: "assistant", id: `msg_${n}`, content: [{ type: "output_text", text: "done" }] };
      const usage = { input_tokens: 1, input_tokens_details: null, output_tokens: 1, output_tokens_details: null, total_tokens: 2 };
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const ev of [
        { type: "response.created", response: { id } },
        { type: "response.output_item.done", item },
        { type: "response.completed", response: { id, usage } },
      ]) {
        res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
      }
      res.end();
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, outputs })),
  );
}

// ---------------------------------------------------------------------------------------
// One isolated Codex home, one fixture repository.

interface Sandbox {
  root: string;
  proj: string;
  codexHome: string;
  env: NodeJS.ProcessEnv;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
}

/** A throwaway HOME/CODEX_HOME and a repository whose next commit carries a blocking finding. */
function sandbox(): Sandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "u11y-codex-smoke-")));
  const codexHome = join(root, "codex");
  for (const d of ["home", "codex"]) mkdirSync(join(root, d), { recursive: true });
  const proj = join(root, "proj");
  mkdirSync(proj);
  git(proj, "init", "-q", "-b", "main");
  git(proj, "config", "user.email", "smoke@example.invalid");
  git(proj, "config", "user.name", "smoke");
  // A fixture repository, the same as tests/e2e/helpers.ts: nothing here is ever published.
  git(proj, "config", "commit.gpgsign", "false");
  // An <img> with no alt — a blocking 1.1.1 finding, the fixture hook.test.ts uses.
  writeFileSync(join(proj, "page.html"), BAD_PAGE);
  git(proj, "add", "page.html");

  // Nothing of the caller's Codex or ultra11y setup may leak in — nor any credential.
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("CODEX") || k.startsWith("OPENAI") || k.startsWith("ULTRA11Y") || k === "SKIP_A11Y") continue;
    env[k] = v;
  }
  Object.assign(env, { HOME: join(root, "home"), CODEX_HOME: codexHome });
  return { root, proj, codexHome, env };
}

function codex(bin: string, sb: Sandbox, args: string[]): string {
  const r = spawnSync(bin, args, { cwd: sb.proj, env: sb.env, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) throw new Error(`codex ${args.join(" ")} exited ${r.status}:\n${r.stdout}\n${r.stderr}`);
  return `${r.stdout}${r.stderr}`;
}

/** `codex exec` (or `exec resume <id>`) one `CMD:` prompt against the mock; returns the
 *  session id and the tool output Codex handed back to the model for it. */
function exec(bin: string, sb: Sandbox, mock: Mock, command: string, sessionID?: string): Promise<{ sessionID: string; output: string }> {
  const before = mock.outputs.length;
  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--dangerously-bypass-hook-trust",
    "-c",
    'sandbox_mode="danger-full-access"',
    "-c",
    'approval_policy="never"',
    "-c",
    'model="mock"',
    "-c",
    'model_provider="mock"',
    "-c",
    `model_providers.mock={ name = "mock", base_url = "${mock.url}", wire_api = "responses" }`,
    ...(sessionID ? ["resume", sessionID] : []),
    `CMD: ${command}`,
  ];
  // Async on purpose: the mock lives in THIS process, so a blocking spawn would starve it.
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: sb.proj, env: sb.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      out += d;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`codex exec exited ${code}:\n${out}`));
      const id = sessionID ?? /"thread_id":"([^"]+)"/.exec(out)?.[1];
      if (!id) return reject(new Error(`codex exec printed no thread id:\n${out}`));
      const output = mock.outputs.slice(before).join("\n");
      if (!output) return reject(new Error(`codex never ran the shell tool for \`${command}\`:\n${out}`));
      resolve({ sessionID: id, output });
    });
  });
}

const headCommit = (proj: string): string | null => {
  const r = spawnSync("git", ["rev-parse", "--verify", "-q", "HEAD"], { cwd: proj, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};

// ---------------------------------------------------------------------------------------

const bin = codexBin();

if (process.env.ULTRA11Y_REQUIRE_CODEX === "1" && !bin) {
  throw new Error(
    `ultra11y: ULTRA11Y_REQUIRE_CODEX=1 but no Codex CLI answered \`${process.env.CODEX_BIN || "codex"} --version\` — the Codex smoke did not run.`,
  );
}

describe.skipIf(!bin)(`Codex (${bin ?? "not installed"}) — the real binary`, () => {
  let mock: Mock;
  const roots: string[] = [];

  beforeAll(async () => {
    mock = await startMock();
  });
  afterAll(async () => {
    await new Promise((r) => mock?.server.close(r));
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  it("installs the plugin from the checkout, blocks a commit once, lets the retry and `ls` through", async () => {
    const sb = sandbox();
    roots.push(sb.root);
    codex(bin as string, sb, ["plugin", "marketplace", "add", repoRoot]);
    codex(bin as string, sb, ["plugin", "add", "ultra11y@ultra11y"]);

    // What Codex laid down: the hook (found by convention, never declared in the manifest),
    // its guard, both skills, and the engine the guard spawns.
    const installed = join(sb.codexHome, "plugins", "cache", "ultra11y", "ultra11y", version);
    for (const f of [
      ".codex-plugin/plugin.json",
      "hooks/hooks.json",
      "hooks/pre-tool-use.mjs",
      "skills/ultra11y/SKILL.md",
      "skills/review-a11y/SKILL.md",
      "skills/review-a11y/scripts/ultra11y.mjs",
    ]) {
      expect(existsSync(join(installed, f)), f).toBe(true);
    }
    // Codex materialises a local marketplace from its git HEAD, not from the working tree: what
    // is installed is the last COMMIT. In CI that is the commit under test; locally, an
    // uncommitted hooks.json fails here rather than passing on stale bytes.
    expect(readFileSync(join(installed, "hooks/hooks.json"), "utf8"), "the installed hooks.json is the checkout's (commit your hooks/ changes first)").toBe(
      readFileSync(join(repoRoot, "hooks/hooks.json"), "utf8"),
    );
    expect(readFileSync(join(sb.codexHome, "config.toml"), "utf8")).toMatch(/\[plugins\."ultra11y@ultra11y"\]\s*\nenabled = true/);

    // The gate: the hook's command line is `node "${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use.mjs"`.
    // Were that variable not exported, the guard would not exist at that path, stay silent,
    // and the commit would land.
    const commit = await exec(bin as string, sb, mock, "git commit -m wip");
    expect(commit.output).toMatch(BLOCKED);
    expect(headCommit(sb.proj)).toBeNull();

    // Rule 2: the same session's retry goes through — the commit really lands.
    const retry = await exec(bin as string, sb, mock, "git commit -m wip", commit.sessionID);
    expect(retry.output).not.toMatch(/blocked by PreToolUse hook/);
    expect(headCommit(sb.proj)).not.toBeNull();

    // A command that publishes nothing runs untouched.
    const ls = await exec(bin as string, sb, mock, "ls -la");
    expect(ls.output).not.toMatch(/blocked by PreToolUse hook/);
    expect(ls.output).toContain("page.html");
  });

  it("blocks the same commit through `ultra11y install --codex`, with no plugin installed", async () => {
    const sb = sandbox();
    roots.push(sb.root);
    execFileSync(process.execPath, [join(repoRoot, "scripts", "ultra11y.mjs"), "install", "--codex"], { cwd: sb.proj, env: sb.env, stdio: "pipe" });

    const hooks = JSON.parse(readFileSync(join(sb.codexHome, "hooks.json"), "utf8")) as {
      hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> };
    };
    expect(hooks.hooks.PreToolUse.flatMap((g) => g.hooks.map((h) => h.command)).some((c) => c.includes("hook --codex"))).toBe(true);
    expect(readFileSync(join(sb.codexHome, "config.toml"), "utf8")).toMatch(/^\[features\]\nhooks = true$/m);
    expect(existsSync(join(sb.codexHome, "skills", "ultra11y", "SKILL.md"))).toBe(true);

    const commit = await exec(bin as string, sb, mock, "git commit -m wip");
    expect(commit.output).toMatch(BLOCKED);
    expect(headCommit(sb.proj)).toBeNull();
  });
});

it.skipIf(!!bin)("no Codex installed — the real-binary smoke is skipped", () => {
  expect(bin).toBeNull();
});

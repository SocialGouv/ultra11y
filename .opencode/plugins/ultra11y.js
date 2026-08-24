// The OpenCode plugin — what makes the `review-a11y` skill fire on its own before a
// commit, push or pull request.
//
// This is hooks/pre-tool-use.mjs in a different costume, and deliberately so. OpenCode has
// no permission-decision channel: a plugin blocks a tool call by THROWING, and the message
// is what the agent sees. So the shape is the same two-stage split — this file pays only
// the cost of a string test on each shell call, and the 2.5 MB engine is spawned only once
// something could possibly be a publishing command.
//
// TWO RULES, the same two that govern src/hook.ts.
//
//  1. NEVER break a session. Every unexpected condition — no engine, spawn failure,
//     timeout, unreadable output — is a silent no-op. The single `throw` below is our own
//     decision and nothing else; note that the try/catch closes BEFORE it, so a bug in here
//     can never surface to the user as a blocked `git push`.
//  2. NEVER loop. The anti-loop marker lives in the engine (loopKey/firstSighting in
//     src/hook.ts) and keys on the session id, so passing OpenCode's sessionID through is
//     all that is required: one review per state of the change, exactly as on Claude Code.
//
// Zero dependencies, `node:` builtins only — it is loaded straight from disk by OpenCode.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Ownership marker: `ultra11y install --opencode` refuses to overwrite a plugin file that
// does not carry it, so a user's own ultra11y.js is never clobbered.
const ULTRA11Y_OPENCODE_PLUGIN = "ULTRA11Y_OPENCODE_PLUGIN";
const ULTRA11Y_PLUGIN_VERSION = "5.30.0";

const here = dirname(fileURLToPath(import.meta.url));

/** The engine bundle, or null. Never `require.resolve` — this module is ESM and OpenCode's
 *  loader is not guaranteed to have the package resolvable from here. */
function resolveEngine() {
  const candidates = [
    process.env.ULTRA11Y_BIN, //                      explicit override (and what the tests set)
    join(here, "ultra11y.mjs"), //                     a copy dropped beside the plugin
    join(here, "..", "..", "scripts", "ultra11y.mjs"), // the npm-pin route: <pkgroot>/.opencode/plugins/
    join(homedir(), ".ultra11y", "bin", "ultra11y.mjs"), // the pin written by `install --opencode`
  ];
  for (const c of candidates) if (c && existsSync(c)) return c;
  return null;
}

/** Same literal as hooks/pre-tool-use.mjs — tests/harness-sync.test.ts asserts they match,
 *  because two prefilters that disagree mean one harness silently reviews less. */
const PREFILTER = /\bgit\b|\bgh\b/;

export const Ultra11yPlugin = async (ctx) => {
  const skillsDir = join(here, "..", "..", "skills");

  return {
    /** Register the two bundled skills so `review-a11y` is invocable by name once the gate
     *  names it. Wrapped: if OpenCode's config shape differs, this is a harmless no-op and
     *  the user still has the skills via `ultra11y install --opencode`. */
    config: async (config) => {
      try {
        if (!existsSync(skillsDir)) return;
        config.skills ??= {};
        config.skills.paths ??= [];
        if (!config.skills.paths.includes(skillsDir)) config.skills.paths.push(skillsDir);
      } catch {
        /* not fatal — the skills can also be installed into ~/.config/opencode/skills/ */
      }
    },

    "tool.execute.before": async (input, output) => {
      let text;
      try {
        if (String(input?.tool ?? "").toLowerCase() !== "bash") return;
        const command = output?.args?.command;
        if (typeof command !== "string" || !PREFILTER.test(command)) return;
        if (process.env.SKIP_A11Y || process.env.ULTRA11Y_HOOK === "off") return;

        const engine = resolveEngine();
        if (!engine) return;

        const payload = {
          tool_name: "Bash",
          tool_input: { command },
          cwd: ctx?.directory ?? ctx?.worktree ?? process.cwd(),
          session_id: input?.sessionID ?? `opencode-${process.pid}`,
        };
        const run = spawnSync(process.execPath, [engine, "hook", "--opencode"], {
          input: JSON.stringify(payload),
          encoding: "utf8",
          timeout: 20_000,
          maxBuffer: 8 * 1024 * 1024,
        });
        text = (run.stdout ?? "").trim();
      } catch {
        return; // unreadable input, spawn failure, timeout — say nothing
      }
      // Outside the try on purpose: this is the ONLY error allowed to reach the agent.
      if (text) throw new Error(text);
    },
  };
};

export { ULTRA11Y_OPENCODE_PLUGIN, ULTRA11Y_PLUGIN_VERSION };

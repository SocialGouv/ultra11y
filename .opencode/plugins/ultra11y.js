// The OpenCode plugin — what makes the `review-a11y` skill fire on its own before a
// commit, push or pull request.
//
// This is hooks/pre-tool-use.mjs in a different costume, and deliberately so. OpenCode has
// no permission-decision channel: a plugin blocks a tool call by THROWING, and the message
// is what the agent sees. So the shape is the same two-stage split — this file pays only
// the cost of a string test on each shell call, and the 2.5 MB engine is spawned only once
// something could possibly be a publishing command.
//
// ONE FILE, BOTH MAJORS. OpenCode 1 and OpenCode 2 read different things from this module:
//
//  - OpenCode 2 reads the default export's `{ id, setup(ctx) }` and nothing else. `setup`
//    registers the gate with `ctx.tool.hook("execute.before")` and the two skills with
//    `ctx.skill.transform`.
//  - OpenCode 1 ≥ 1.18.28 sees a default object carrying `server()` and calls ONLY that —
//    the named exports are then ignored, so the gate is registered once.
//  - Older OpenCode 1 calls every export that is a function (or an object's `server`), so
//    it reaches the same `Ultra11yPlugin` twice. `oncePerCall` below makes the second
//    registration a no-op on the same tool call, so the engine still runs once per call.
//
// The module therefore exports FUNCTIONS ONLY besides `default`: an old V1 loader throws
// "Plugin export is not a function" on any other value, and that kills the whole plugin.
//
// TWO RULES, the same two that govern src/hook.ts.
//
//  1. NEVER break a session. Every unexpected condition — no engine, spawn failure,
//     timeout, unreadable output, a host API that is missing or shaped differently — is a
//     silent no-op. The single `throw` in each entry point is our own decision and nothing
//     else; the try/catch closes BEFORE it, so a bug in here can never surface to the user
//     as a blocked `git push`.
//  2. NEVER loop. The anti-loop marker lives in the engine (loopKey/firstSighting in
//     src/hook.ts) and keys on the session id, so passing OpenCode's sessionID through is
//     all that is required: one review per state of the change, exactly as on Claude Code.
//
// Zero dependencies, `node:` builtins only — it is loaded straight from disk by OpenCode,
// and OpenCode 2 refuses to resolve `@opencode/plugin` from a plugin's own node_modules.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

// Ownership marker: `ultra11y install --opencode` refuses to overwrite a plugin file that
// does not carry it, so a user's own ultra11y.js is never clobbered. Kept as text, not as
// an export (see above).
const ULTRA11Y_OPENCODE_PLUGIN = "ULTRA11Y_OPENCODE_PLUGIN";
const ULTRA11Y_PLUGIN_VERSION = "5.57.5";
const PLUGIN_ID = "ultra11y";
const SKILL_NAMES = ["ultra11y", "review-a11y"];

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

/** The directory holding the two skills, or null: the package's own `skills/` on the
 *  npm/checkout route, or `<configDir>/skills/` where `install --opencode` copies them. */
function resolveSkillsDir() {
  for (const d of [join(here, "..", "..", "skills"), join(here, "..", "skills")]) {
    if (SKILL_NAMES.every((n) => existsSync(join(d, n, "SKILL.md")))) return d;
  }
  return null;
}

/** The Node to run the engine with. Inside OpenCode `process.execPath` is NOT node: both
 *  majors ship as a Bun-compiled binary, and `<opencode> engine.mjs hook` prints
 *  OpenCode's own CLI help — which would then be thrown at the agent as a "finding". So
 *  under Bun the engine runs on the `node` from PATH; a missing node is a spawn error,
 *  and a spawn error is silence (rule 1). */
function nodeRuntime() {
  if (process.env.ULTRA11Y_NODE) return process.env.ULTRA11Y_NODE;
  return process.versions?.bun ? "node" : process.execPath;
}

/** Every block the engine emits starts with this (src/hook.ts). Anything else on stdout is
 *  not a decision of ours, and blocking a `git push` with it would break the session. */
const DECISION_PREFIX = "ultra11y:";

/** Same literal as hooks/pre-tool-use.mjs — tests/harness-sync.test.ts asserts they match,
 *  because two prefilters that disagree mean one harness silently reviews less. */
const PREFILTER = /\bgit\b|\bgh\b/;

/** `bash` on both majors; `shell` is accepted too, should a release rename it. */
const isShell = (tool) => /^(?:bash|shell)$/i.test(String(tool ?? ""));

/**
 * The decision, shared by both entry points: the text to block with, or "" to let the call
 * through. NEVER throws — rule 1 — whatever the host hands in.
 */
function review({ tool, args, directory, sessionID }) {
  try {
    if (!isShell(tool)) return "";
    const command = args?.command;
    if (typeof command !== "string" || !PREFILTER.test(command)) return "";
    if (process.env.SKIP_A11Y || process.env.ULTRA11Y_HOOK === "off") return "";

    const engine = resolveEngine();
    if (!engine) return "";

    // A `workdir` argument is where the command really runs; otherwise the plugin's own
    // location is the best answer the host gives.
    const workdir = typeof args?.workdir === "string" && isAbsolute(args.workdir) ? args.workdir : null;
    const payload = {
      tool_name: "Bash",
      tool_input: { command },
      cwd: workdir ?? (typeof directory === "string" && directory ? directory : process.cwd()),
      session_id: typeof sessionID === "string" && sessionID ? sessionID : `opencode-${process.pid}`,
    };
    const run = spawnSync(nodeRuntime(), [engine, "hook", "--opencode"], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (run.error || run.status !== 0) return "";
    const text = (run.stdout ?? "").trim();
    return text.startsWith(DECISION_PREFIX) ? text : "";
  } catch {
    return ""; // unreadable input, spawn failure, timeout — say nothing
  }
}

/** Tool-call ids already reviewed. An old OpenCode 1 can register this plugin twice from
 *  one module (named export + default `server`); the second hook must not run the engine
 *  again on the same call. Bounded, and best-effort: no id means no de-duplication. */
const seenCalls = new Set();
function oncePerCall(callID) {
  if (typeof callID !== "string" || !callID) return true;
  if (seenCalls.has(callID)) return false;
  seenCalls.add(callID);
  if (seenCalls.size > 512) seenCalls.delete(seenCalls.values().next().value);
  return true;
}

/** Read one bundled SKILL.md into the shape OpenCode 2's skill editor takes. The ids and
 *  names are branded strings in @opencode/schema, but the brand is type-only — a plain
 *  string is what the host stores. Null on anything unexpected. */
function readSkill(dir, name) {
  try {
    const path = join(dir, name, "SKILL.md");
    const text = readFileSync(path, "utf8");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    if (!fm) return null;
    const field = (key) => {
      const m = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(fm[1]);
      if (!m) return undefined;
      const raw = m[1].trim();
      if (raw.startsWith('"')) {
        try {
          return JSON.parse(raw);
        } catch {
          return raw.slice(1, -1);
        }
      }
      return raw;
    };
    const id = field("name") || name;
    return { id, name: id, description: field("description"), path, content: text.slice(fm[0].length).trim() };
  } catch {
    return null;
  }
}

/** OpenCode 1 — the plugin function. Also what `server()` returns for V1 ≥ 1.18.28. */
export const Ultra11yPlugin = async (ctx) => {
  const directory = ctx?.directory ?? ctx?.worktree;

  return {
    /** Register the two bundled skills so `review-a11y` is invocable by name once the gate
     *  names it. Wrapped: if OpenCode's config shape differs, this is a harmless no-op and
     *  the user still has the skills via `ultra11y install --opencode`. */
    config: async (config) => {
      try {
        const skillsDir = resolveSkillsDir();
        if (!skillsDir) return;
        config.skills ??= {};
        config.skills.paths ??= [];
        if (!config.skills.paths.includes(skillsDir)) config.skills.paths.push(skillsDir);
      } catch {
        /* not fatal — the skills can also be installed into ~/.config/opencode/skills/ */
      }
    },

    "tool.execute.before": async (input, output) => {
      let text = "";
      try {
        if (!isShell(input?.tool) || !oncePerCall(input?.callID)) return;
        text = review({ tool: input?.tool, args: output?.args, directory, sessionID: input?.sessionID });
      } catch {
        return;
      }
      // Outside the try on purpose: this is the ONLY error allowed to reach the agent.
      if (text) throw new Error(text);
    },
  };
};

/** OpenCode 2 — `setup(ctx)`. Each registration is independent and individually wrapped:
 *  a host without `ctx.skill` still gets the gate, and the reverse. The registrations are
 *  disposed with the plugin's scope; the returned cleanup only makes that explicit. */
async function setup(ctx) {
  const registrations = [];
  const keep = (r) => {
    if (r && typeof r.dispose === "function") registrations.push(r);
  };
  const directory = ctx?.location?.directory ?? ctx?.location?.project?.directory;

  try {
    const skillsDir = resolveSkillsDir();
    const skills = skillsDir ? SKILL_NAMES.map((n) => readSkill(skillsDir, n)).filter(Boolean) : [];
    // Read once here: transform callbacks must be synchronous and replayable.
    if (skills.length > 0 && typeof ctx?.skill?.transform === "function") {
      keep(
        await ctx.skill.transform((editor) => {
          try {
            // A copy the user installed under ~/.config/opencode/skills/ wins over ours.
            for (const s of skills) if (!editor.get(s.id)) editor.add({ ...s });
          } catch {
            /* a registry that rejects us leaves the session as it was */
          }
        }),
      );
    }
  } catch {
    /* the skills are a convenience; never fail the plugin over them */
  }

  try {
    if (typeof ctx?.tool?.hook === "function") {
      keep(
        await ctx.tool.hook("execute.before", async (event) => {
          let text = "";
          try {
            text = review({ tool: event?.tool, args: event?.input, directory, sessionID: event?.sessionID });
          } catch {
            return;
          }
          // Outside the try on purpose: this is the ONLY error allowed to reach the agent.
          if (text) throw new Error(text);
        }),
      );
    }
  } catch {
    /* no gate is better than a broken session */
  }

  return async () => {
    for (const r of registrations.splice(0)) {
      try {
        await r.dispose();
      } catch {
        /* already gone */
      }
    }
  };
}

/** The entry both majors read: `setup` for OpenCode 2, `server` for OpenCode 1 ≥ 1.18.28. */
export default { id: PLUGIN_ID, setup, server: Ultra11yPlugin };

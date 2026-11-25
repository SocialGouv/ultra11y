// How the running engine was invoked, so the commands its hints print can be pasted back.
//
// A hint that says « run `ultra11y scan` » is wrong for most of its readers (#233): the skill
// ships the engine as `scripts/ultra11y.mjs` and runs it with `node`, `npx` caches it under a
// path no shell resolves, and `ultra11y` is on PATH only after a global install. The engine
// therefore derives the invocation from `process.argv[1]` — the script node actually ran — and
// rewrites the `ultra11y <cmd>` spans of the lines it prints to that invocation.
import { basename, isAbsolute, relative, sep } from "node:path";

/** The bare name: what a global install puts on PATH, and what the messages are written with. */
export const BARE = "ultra11y";

const quote = (p: string): string => (/[\s"'$`\\]/.test(p) && !p.includes('"') ? `"${p}"` : p);

/** The command prefix that re-runs this engine, from the script node ran and the working dir.
 *  - the skill bundle or any `ultra11y.mjs` run with node → `node <path>` (relative when the
 *    script sits under the working directory, absolute otherwise);
 *  - npx's cache (`…/_npx/…`) → `npx -y ultra11y`; a project's `node_modules` → `npx ultra11y`;
 *  - a global bin, or anything unrecognised (a test runner) → `ultra11y`. */
export function invocationFor(argv1: string | undefined, cwd: string): string {
  if (!argv1) return BARE;
  const p = argv1.split("\\").join("/");
  if (p.includes("/_npx/")) return "npx -y ultra11y";
  if (p.includes("/node_modules/.bin/") || p.includes("/node_modules/ultra11y/")) return "npx ultra11y";
  if (basename(p) !== "ultra11y.mjs") return BARE;
  const rel = isAbsolute(argv1) ? relative(cwd, argv1) : argv1;
  const shown = rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.split(sep).join("/") : argv1;
  return `node ${quote(shown)}`;
}

/** Rewrite every `` `ultra11y <cmd>`` code span of `text` to start with `invocation` instead.
 *  Only code spans: « ultra11y verify : … » as a message prefix is a label, not a command. A
 *  JSON payload is left alone — it is data, and a path could break its escaping. */
export function rewriteInvocation(text: string, invocation: string): string {
  if (invocation === BARE || !text.includes("`ultra11y ")) return text;
  const head = text.trimStart()[0];
  if (head === "{" || head === "[") return text;
  return text.replace(/`ultra11y (?=[a-z-])/g, () => `\`${invocation} `);
}

/** Route console.log / console.error through `rewriteInvocation`, once per process. Called by
 *  the CLI entry point only — never on import, so the tests read the messages as written. */
export function installInvocationRewrite(invocation: string): void {
  if (invocation === BARE) return;
  for (const name of ["log", "error", "warn"] as const) {
    const original = console[name].bind(console);
    console[name] = (...args: unknown[]) => original(...args.map((a) => (typeof a === "string" ? rewriteInvocation(a, invocation) : a)));
  }
}

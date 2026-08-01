// Wiring the gate into the OpenAI Codex CLI.
//
// Codex's hook engine is a near-clone of Claude Code's: the same event names, the same
// payload fields, the same `hookSpecificOutput` envelope, and it exports ${CLAUDE_PLUGIN_ROOT}
// alongside its own ${PLUGIN_ROOT}. On PreToolUse it accepts exactly ONE decision — `deny`,
// with a non-empty reason — which is precisely and only what this engine emits. So the
// decision half needs no Codex-specific branch; `hook --codex` is the same code path.
//
// Two things ARE Codex-specific and are why this file exists:
//   1. hooks are behind a feature flag: `[features] hooks = true` in config.toml;
//   2. Codex asks the user to trust a hook command before running it, recording the answer
//      as a sha256 in `[hooks.state]`. That hash is NOT forged here — see below.
//
// The native route (`codex plugin marketplace add maxgfr/ultra11y` then `codex plugin add`)
// is better where the user wants it: it carries the skills and the hook together. This
// exists for an npm install, and for users who do not want a marketplace.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type EditReport, editJsonFile, readJsonSafe, writeTextWithBackup } from "./json-edit.js";
import { copySkillsInto } from "./paths.js";

/** Present in every command we write, and in nothing else. */
export const CODEX_MARKER = "hook --codex";

/** Codex's shell tool is `shell`; the alternation also covers its variants and Claude
 *  Code's `Bash`, so one entry is right whichever name a given Codex build uses. */
const MATCHER = "Bash|bash|shell|local_shell|exec_command|run_command|exec";

interface HookGroup {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string; timeout?: number; statusMessage?: string }>;
}

function withoutOurs(groups: unknown): HookGroup[] {
  if (!Array.isArray(groups)) return [];
  return (groups as HookGroup[])
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !String(h.command ?? "").includes(CODEX_MARKER)) }))
    .filter((g) => (g.hooks ?? []).length > 0);
}

/** Turn on `[features] hooks = true`, whatever shape the user's config.toml is already in.
 *
 *  Hand-rolled rather than a TOML library because the whole job is one key, and because a
 *  round-trip through a parser would reformat a file full of the user's own comments and
 *  ordering. Three cases: the key is already there (possibly `false`), the `[features]`
 *  table exists without it, or neither exists. */
export function enableHooksFeature(content: string): { content: string; changed: boolean } {
  if (HOOKS_ON.test(featuresBody(content))) return { content, changed: false };

  const body = featuresBody(content);
  if (HOOKS_ANY.test(body)) {
    // Flip it in place, without disturbing anything else in the table.
    return { content: content.replace(body, body.replace(HOOKS_ANY, "hooks = true")), changed: true };
  }
  if (FEATURES_HEADER.test(content)) {
    return { content: content.replace(FEATURES_HEADER, "$&\nhooks = true"), changed: true };
  }
  // No [features] table at all. Prepend it: a top-level table has to precede any other
  // table header, or its keys would be swallowed by whichever table came before.
  const prefix = content.trim() === "" ? "" : "\n";
  return { content: `[features]\nhooks = true\n${prefix}${content}`, changed: true };
}

/** Remove the key we added, leaving an empty `[features]` table rather than guessing
 *  whether the user wanted it. */
export function disableHooksFeature(content: string): { content: string; changed: boolean } {
  const body = featuresBody(content);
  if (!HOOKS_ON.test(body)) return { content, changed: false };
  return { content: content.replace(body, body.replace(HOOKS_ON_LINE, "")), changed: true };
}

// Every whitespace class here is HORIZONTAL ONLY (`[ \t]`, never `\s`). A TOML key lives on
// its own line, and `\s*` at either end of the pattern happily swallows the surrounding
// newlines — which collapses `[features]\nhooks = false\n` into `[features]hooks = true`,
// silently corrupting the user's config into a file Codex can no longer read.
const HOOKS_ON = /^[ \t]*hooks[ \t]*=[ \t]*true[ \t]*$/m;
const HOOKS_ON_LINE = /^[ \t]*hooks[ \t]*=[ \t]*true[ \t]*\n?/m;
const HOOKS_ANY = /^[ \t]*hooks[ \t]*=[ \t]*(?:false|true)[ \t]*$/m;
const FEATURES_HEADER = /^[ \t]*\[features\][ \t]*$/m;
const ANY_TABLE_HEADER = /^[ \t]*\[/m;

/** The text between `[features]` and the next table header — the only region where a bare
 *  `hooks = true` means what we want. Without this, a `hooks = true` under some other table
 *  would be mistaken for ours. */
function featuresBody(content: string): string {
  const m = FEATURES_HEADER.exec(content);
  if (!m) return "";
  const rest = content.slice(m.index + m[0].length);
  const next = ANY_TABLE_HEADER.exec(rest);
  return rest.slice(0, next ? next.index : undefined);
}

export interface CodexInstall {
  codexDir: string;
  command: string;
  /** Copy the two skills into ~/.codex/skills/ as well. */
  skillsSource?: string | null;
}

export function installCodex({ codexDir, command, skillsSource }: CodexInstall): { reports: EditReport[]; guidance: string[] } {
  const reports: EditReport[] = [];

  reports.push(
    editJsonFile(join(codexDir, "hooks.json"), (root) => {
      const hooks = (root.hooks ??= {}) as Record<string, unknown>;
      hooks.PreToolUse = [
        ...withoutOurs(hooks.PreToolUse),
        { matcher: MATCHER, hooks: [{ type: "command", command: `${command} ${CODEX_MARKER}`, timeout: 30, statusMessage: "ultra11y" }] },
      ];
    }),
  );

  const configPath = join(codexDir, "config.toml");
  const current = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const edit = enableHooksFeature(current);
  if (edit.changed) reports.push(writeTextWithBackup(configPath, edit.content));

  if (skillsSource) reports.push(...copySkillsInto(skillsSource, join(codexDir, "skills")));

  return {
    reports,
    guidance: [
      // Deliberately NOT forging the trusted_hash. Reproducing Codex's canonicalisation
      // exactly is a bet that breaks silently, in the user's home directory, the next time
      // Codex changes it — and the failure mode of a wrong hash is a gate that never fires.
      "codex: Codex will ask you to trust this hook the first time it fires — accept it, or review it with /hooks.",
      "codex: restart the session — hooks load at startup.",
      "codex: `codex plugin marketplace add maxgfr/ultra11y` then `codex plugin add ultra11y@ultra11y` is the native route; it ships the skills and the hook together.",
    ],
  };
}

export function uninstallCodex({ codexDir }: { codexDir: string }): { reports: EditReport[]; guidance: string[] } {
  const reports: EditReport[] = [];
  const hooksPath = join(codexDir, "hooks.json");
  if (existsSync(hooksPath)) {
    reports.push(
      editJsonFile(hooksPath, (root) => {
        const hooks = root.hooks as Record<string, unknown> | undefined;
        if (!hooks || typeof hooks !== "object") return;
        const kept = withoutOurs(hooks.PreToolUse);
        if (kept.length > 0) hooks.PreToolUse = kept;
        else delete hooks.PreToolUse;
        if (Object.keys(hooks).length === 0) delete root.hooks;
      }),
    );
  }
  // `[features] hooks = true` is deliberately LEFT ALONE: other tools (and the user) may
  // rely on it, and turning it off would silently disable their hooks too.
  return { reports, guidance: ["codex: `[features] hooks = true` was left enabled — other hooks may depend on it."] };
}

/** How many of our hook entries this Codex home carries. */
export function codexWired(codexDir: string): number {
  const root = readJsonSafe(join(codexDir, "hooks.json"));
  const groups = (root?.hooks as Record<string, unknown> | undefined)?.PreToolUse;
  if (!Array.isArray(groups)) return 0;
  return (groups as HookGroup[]).reduce((n, g) => n + (g.hooks ?? []).filter((h) => String(h.command ?? "").includes(CODEX_MARKER)).length, 0);
}

/** True when Codex would actually run hooks at all. A wired hook behind a disabled feature
 *  flag is the silent failure this exists to surface. */
export function codexHooksEnabled(codexDir: string): boolean {
  const p = join(codexDir, "config.toml");
  return existsSync(p) && HOOKS_ON.test(featuresBody(readFileSync(p, "utf8")));
}

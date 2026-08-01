// Wiring the gate into Claude Code's settings.json.
//
// This is NOT the recommended route — `/plugin install ultra11y@ultra11y` is, because a
// plugin carries the skills and the hook together and updates as one thing. This exists for
// the case the plugin cannot serve: ultra11y installed from npm as a dev dependency, where
// the user wants the automatic review without adopting a marketplace.
//
// Ownership is tracked by the MARKER inside the command string, so uninstall removes
// exactly the hook entries this wrote and leaves a user's own PreToolUse hooks untouched.
import { type EditReport, editJsonFile, readJsonSafe } from "./json-edit.js";

/** Present in every command we write, and in nothing else. */
export const CLAUDE_MARKER = "hook --claude-code";

/** The tool names the gate must see. Same set as hooks/hooks.json — Claude Code names its
 *  shell `Bash`; the rest are here so one settings entry also covers a harness that reuses
 *  this file format with a differently-named shell. */
const MATCHER = "Bash|bash|shell|local_shell|exec_command|run_command|exec";

interface HookGroup {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string; timeout?: number }>;
}

/** Drop every group whose hooks are all ours, and prune ours out of mixed groups. Written
 *  so a user who added their own PreToolUse hook next to ours keeps it. */
function withoutOurs(groups: unknown): HookGroup[] {
  if (!Array.isArray(groups)) return [];
  return (groups as HookGroup[])
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !String(h.command ?? "").includes(CLAUDE_MARKER)) }))
    .filter((g) => (g.hooks ?? []).length > 0);
}

export function installClaudeCode({ settingsPath, command }: { settingsPath: string; command: string }): EditReport {
  return editJsonFile(settingsPath, (root) => {
    const hooks = (root.hooks ??= {}) as Record<string, unknown>;
    hooks.PreToolUse = [
      ...withoutOurs(hooks.PreToolUse),
      { matcher: MATCHER, hooks: [{ type: "command", command: `${command} ${CLAUDE_MARKER}`, timeout: 30 }] },
    ];
  });
}

export function uninstallClaudeCode({ settingsPath }: { settingsPath: string }): EditReport {
  return editJsonFile(settingsPath, (root) => {
    const hooks = root.hooks as Record<string, unknown> | undefined;
    if (!hooks || typeof hooks !== "object") return;
    const kept = withoutOurs(hooks.PreToolUse);
    if (kept.length > 0) hooks.PreToolUse = kept;
    else delete hooks.PreToolUse;
    if (Object.keys(hooks).length === 0) delete root.hooks;
  });
}

/** How many of our hook entries this settings file carries. */
export function claudeCodeWired(settingsPath: string): number {
  const root = readJsonSafe(settingsPath);
  const groups = (root?.hooks as Record<string, unknown> | undefined)?.PreToolUse;
  if (!Array.isArray(groups)) return 0;
  return (groups as HookGroup[]).reduce((n, g) => n + (g.hooks ?? []).filter((h) => String(h.command ?? "").includes(CLAUDE_MARKER)).length, 0);
}

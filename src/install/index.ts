// `install` / `uninstall` / `status` — wiring the automatic review into an agent.
//
// Every function here is pure of console and process.exit: they take explicit paths and
// return report objects. That is what lets the whole surface be driven from vitest against
// a temporary HOME without spawning a process, and it is why the CLI layer above owns all
// the printing.
import { claudeCodeWired, installClaudeCode, uninstallClaudeCode } from "./claude-code.js";
import { agentsMdPath, agentsMdWired, installAgentsMd, uninstallAgentsMd } from "./agents-md.js";
import { codexHooksEnabled, codexWired, installCodex, uninstallCodex } from "./codex.js";
import { installOpencode, opencodeWired, uninstallOpencode } from "./opencode.js";
import {
  bundledOpencodePlugin,
  bundledSkillsDir,
  claudeSettingsPath,
  codexHome,
  installedCliCommand,
  opencodeConfigDir,
  packageRoot,
  pinnedEnginePath,
} from "./paths.js";
import { type EditReport, SettingsParseError } from "./json-edit.js";
import { repoRoot } from "../init.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type Target = "claude-code" | "codex" | "opencode" | "agents-md";

/** The harnesses `--all` covers.
 *
 *  `agents-md` is deliberately NOT in this list. It is the only target that writes a
 *  TRACKED FILE INTO THE USER'S REPOSITORY; every other one edits a dotfile under their
 *  home. `--all` must never hand someone an unexpected new file to review in `git status`,
 *  so AGENTS.md is always an explicit ask. */
export const ALL_TARGETS: readonly Target[] = ["claude-code", "codex", "opencode"];

export interface TargetResult {
  target: Target;
  /** What was written, when anything was. */
  reports: EditReport[];
  /** Things the user has to know: a restart, a trust prompt, a limitation. */
  guidance: string[];
  error?: string;
}

export interface InstallOptions {
  targets: readonly Target[];
  /** Scope the install to the current project instead of the user's home, where supported. */
  project?: boolean;
  cwd?: string;
  /** Render what would be written and touch nothing. */
  dryRun?: boolean;
  /** Copy the bundled skills into the harness's skills directory too (default: yes). */
  skills?: boolean;
}

/** Parse `--claude-code --codex --opencode --agents-md --all` into a target list.
 *  Returns `null` when nothing was selected, which the CLI turns into a usage error. */
export function parseTargets(flags: Record<string, unknown>): Target[] | null {
  const picked = new Set<Target>();
  if (flags.all === true) for (const t of ALL_TARGETS) picked.add(t);
  if (flags["claude-code"] === true) picked.add("claude-code");
  if (flags.codex === true) picked.add("codex");
  if (flags.opencode === true) picked.add("opencode");
  if (flags["agents-md"] === true) picked.add("agents-md");
  return picked.size ? [...picked] : null;
}

/** The repository the project-scoped targets act on. */
function projectRoot(cwd: string): string {
  return repoRoot() ?? cwd;
}

export function installForTargets(opts: InstallOptions): TargetResult[] {
  const cwd = opts.cwd ?? process.cwd();
  const out: TargetResult[] = [];
  // Resolved once: it may pin a copy of the engine, which should happen at most once per run.
  let command: string | null = null;
  const cmd = () => (command ??= installedCliCommand());

  for (const target of opts.targets) {
    const r: TargetResult = { target, reports: [], guidance: [] };
    try {
      switch (target) {
        case "claude-code": {
          const settingsPath = claudeSettingsPath(opts.project === true, cwd);
          if (!opts.dryRun) r.reports.push(installClaudeCode({ settingsPath, command: cmd() }));
          else r.reports.push({ path: settingsPath, changed: false });
          r.guidance.push(
            "claude-code: the plugin route (`/plugin marketplace add maxgfr/ultra11y` then `/plugin install ultra11y@ultra11y`) ships the skills too — this settings hook only wires the gate.",
            "claude-code: restart the session — hooks load at startup.",
          );
          break;
        }
        case "codex": {
          // Codex reads hooks only from its own home; there is no project scope to honour.
          if (opts.project === true) r.guidance.push("codex: --project is not supported (Codex reads hooks from its home only) — wiring the user scope.");
          if (!opts.dryRun) {
            const out = installCodex({ codexDir: codexHome(), command: cmd(), skillsSource: opts.skills === false ? null : bundledSkillsDir() });
            r.reports.push(...out.reports);
            r.guidance.push(...out.guidance);
          } else r.reports.push({ path: join(codexHome(), "hooks.json"), changed: false });
          break;
        }
        case "opencode": {
          const source = bundledOpencodePlugin();
          if (!source) {
            r.error = "opencode: this engine was not run from a package carrying .opencode/plugins/ultra11y.js — install ultra11y from npm and retry.";
            break;
          }
          const configDir = opts.project === true ? join(cwd, ".opencode") : opencodeConfigDir();
          if (!opts.dryRun) {
            const engine = existsSync(pinnedEnginePath()) ? pinnedEnginePath() : join(packageRoot() ?? "", "scripts", "ultra11y.mjs");
            const out = installOpencode({
              configDir,
              pluginSource: source,
              skillsSource: opts.skills === false ? null : bundledSkillsDir(),
              enginePath: existsSync(engine) ? engine : null,
            });
            r.reports.push(...out.reports);
            r.guidance.push(...out.guidance);
          } else r.reports.push({ path: join(configDir, "plugin", "ultra11y.js"), changed: false });
          break;
        }
        case "agents-md": {
          const root = projectRoot(cwd);
          if (!opts.dryRun) r.reports.push(installAgentsMd(root));
          else r.reports.push({ path: agentsMdPath(root), changed: false });
          r.guidance.push(
            "agents-md: this is a tracked file in your repository — review it and commit it.",
            "agents-md: it cannot make anything automatic (no hook API); `ultra11y init --hook` is what actually enforces the gate there.",
          );
          break;
        }
      }
    } catch (e) {
      r.error = e instanceof SettingsParseError ? e.message : `${target}: ${(e as Error).message}`;
    }
    out.push(r);
  }
  return out;
}

export function uninstallForTargets(opts: InstallOptions): TargetResult[] {
  const cwd = opts.cwd ?? process.cwd();
  const out: TargetResult[] = [];
  for (const target of opts.targets) {
    const r: TargetResult = { target, reports: [], guidance: [] };
    try {
      switch (target) {
        case "claude-code":
          r.reports.push(uninstallClaudeCode({ settingsPath: claudeSettingsPath(opts.project === true, cwd) }));
          break;
        case "codex": {
          const out = uninstallCodex({ codexDir: codexHome() });
          r.reports.push(...out.reports);
          r.guidance.push(...out.guidance);
          break;
        }
        case "opencode": {
          const out = uninstallOpencode({ configDir: opts.project === true ? join(cwd, ".opencode") : opencodeConfigDir() });
          r.reports.push(...out.reports);
          r.guidance.push(...out.guidance);
          break;
        }
        case "agents-md":
          r.reports.push(uninstallAgentsMd(projectRoot(cwd)));
          break;
      }
    } catch (e) {
      r.error = e instanceof SettingsParseError ? e.message : `${target}: ${(e as Error).message}`;
    }
    out.push(r);
  }
  return out;
}

export interface StatusRow {
  target: Target;
  wired: boolean;
  path: string;
  note?: string;
}

/** The doctor. Never throws — a broken settings file is a row to report, not a crash. */
export function statusReport(opts: { project?: boolean; cwd?: string } = {}): StatusRow[] {
  const cwd = opts.cwd ?? process.cwd();
  const claudePath = claudeSettingsPath(opts.project === true, cwd);
  const root = projectRoot(cwd);
  const codexDir = codexHome();
  const ocDir = opts.project === true ? join(cwd, ".opencode") : opencodeConfigDir();
  const codexOn = codexWired(codexDir) > 0;
  return [
    { target: "claude-code", wired: claudeCodeWired(claudePath) > 0, path: claudePath, note: "the plugin route wires this separately and does not show here" },
    {
      target: "codex",
      wired: codexOn,
      path: join(codexDir, "hooks.json"),
      // A wired hook behind a disabled feature flag never fires and looks fine. Say so.
      note: codexOn && !codexHooksEnabled(codexDir) ? "WIRED BUT INERT: `[features] hooks = true` is not set in config.toml" : undefined,
    },
    { target: "opencode", wired: opencodeWired(ocDir), path: join(ocDir, "plugin", "ultra11y.js") },
    { target: "agents-md", wired: agentsMdWired(root), path: agentsMdPath(root) },
  ];
}

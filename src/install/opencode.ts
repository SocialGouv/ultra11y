// Wiring the gate into OpenCode.
//
// OpenCode loads plugins as JS modules, so unlike the hook-based harnesses there is no
// config to edit: the install IS the file at ~/.config/opencode/plugin/ultra11y.js. The
// alternative route — pinning `"plugin": ["ultra11y@latest"]` in opencode.json — resolves
// the npm package's `main`, which points at the same source file. Both end up running
// .opencode/plugins/ultra11y.js; this one just copies it somewhere OpenCode already looks.
//
// The copy is refused if a file is already there without our ownership marker: a user's own
// ultra11y.js is theirs, and silently replacing it would be data loss.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type EditReport, editJsonFile, writeTextWithBackup } from "./json-edit.js";
import { copySkillsInto } from "./paths.js";

export const OPENCODE_MARKER = "ULTRA11Y_OPENCODE_PLUGIN";

export interface OpencodeInstall {
  configDir: string;
  /** The plugin source to copy (.opencode/plugins/ultra11y.js in this package). */
  pluginSource: string;
  /** Copy the two skills into ~/.config/opencode/skills/ as well. */
  skillsSource?: string | null;
  /** The engine the copied plugin should resolve. Written beside it so the plugin's
   *  `<here>/ultra11y.mjs` candidate hits — the copy sits far from any package root, so
   *  its npm-pin candidate cannot resolve. */
  enginePath?: string | null;
}

function pluginTarget(configDir: string): string {
  return join(configDir, "plugin", "ultra11y.js");
}

export function installOpencode({ configDir, pluginSource, skillsSource, enginePath }: OpencodeInstall): { reports: EditReport[]; guidance: string[] } {
  const target = pluginTarget(configDir);
  if (existsSync(target) && !readFileSync(target, "utf8").includes(OPENCODE_MARKER)) {
    throw new Error(`refusing to overwrite ${target}: it is not a file ultra11y wrote. Remove it manually if you want the plugin here.`);
  }
  const reports: EditReport[] = [writeTextWithBackup(target, readFileSync(pluginSource, "utf8"))];

  // The plugin's own resolution order looks here first after $ULTRA11Y_BIN.
  if (enginePath && existsSync(enginePath)) {
    reports.push(writeTextWithBackup(join(configDir, "plugin", "ultra11y.mjs"), readFileSync(enginePath, "utf8")));
  }
  if (skillsSource) reports.push(...copySkillsInto(skillsSource, join(configDir, "skills")));

  return {
    reports,
    guidance: [
      "opencode: restart the session — plugins load at startup.",
      'opencode: the alternative is an npm pin — add "plugin": ["ultra11y@latest"] to ~/.config/opencode/opencode.json and drop this file.',
      "opencode: the gate surfaces as a blocked tool call whose error message carries the findings (OpenCode has no permission-decision channel).",
    ],
  };
}

export function uninstallOpencode({ configDir }: { configDir: string }): { reports: EditReport[]; guidance: string[] } {
  const reports: EditReport[] = [];
  const target = pluginTarget(configDir);
  if (existsSync(target) && readFileSync(target, "utf8").includes(OPENCODE_MARKER)) {
    rmSync(target, { force: true });
    rmSync(join(configDir, "plugin", "ultra11y.mjs"), { force: true });
    reports.push({ path: target, changed: true });
  }
  // Also drop an npm pin, if the user wired it that way instead.
  const configPath = join(configDir, "opencode.json");
  if (existsSync(configPath)) {
    reports.push(
      editJsonFile(configPath, (root) => {
        if (!Array.isArray(root.plugin)) return;
        const kept = (root.plugin as unknown[]).filter((p) => !/^ultra11y(@|$)/.test(String(p)));
        if (kept.length > 0) root.plugin = kept;
        else delete root.plugin;
      }),
    );
  }
  return { reports, guidance: [] };
}

export function opencodeWired(configDir: string): boolean {
  const target = pluginTarget(configDir);
  if (existsSync(target) && readFileSync(target, "utf8").includes(OPENCODE_MARKER)) return true;
  // The npm-pin route leaves no file of ours, so check the config too.
  try {
    const cfg = JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf8"));
    return Array.isArray(cfg.plugin) && cfg.plugin.some((p: unknown) => /^ultra11y(@|$)/.test(String(p)));
  } catch {
    return false;
  }
}

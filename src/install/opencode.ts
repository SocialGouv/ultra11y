// Wiring the gate into OpenCode — both majors.
//
// OpenCode loads plugins as JS modules, so unlike the hook-based harnesses there is no
// config to edit: the install IS the file. One file serves OpenCode 1 and OpenCode 2 (see
// the header of .opencode/plugins/ultra11y.js); what differs per major is WHERE it goes and
// which config key the npm-pin alternative uses:
//
//   OpenCode 1   <configDir>/plugin/ultra11y.js    "plugin":  ["ultra11y@latest"]
//   OpenCode 2   <configDir>/plugins/ultra11y.js   "plugins": ["ultra11y@latest"]
//
// Both majors scan both directories today, so an unknown major gets plugin/ — the one every
// V1 release has read. A copy of ours left in the other directory is removed, or the gate
// would load twice.
//
// The copy is refused if a file is already there without our ownership marker: a user's own
// ultra11y.js is theirs, and silently replacing it would be data loss.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type EditReport, editJsonFile, writeTextWithBackup } from "./json-edit.js";
import { copySkillsInto } from "./paths.js";

export const OPENCODE_MARKER = "ULTRA11Y_OPENCODE_PLUGIN";

export type OpencodeMajor = 1 | 2;

export interface OpencodeInstall {
  configDir: string;
  /** The plugin source to copy (.opencode/plugins/ultra11y.js in this package). */
  pluginSource: string;
  /** Copy the two skills into <configDir>/skills/ as well. */
  skillsSource?: string | null;
  /** The engine the copied plugin should resolve. Written beside it so the plugin's
   *  `<here>/ultra11y.mjs` candidate hits — the copy sits far from any package root, so
   *  its npm-pin candidate cannot resolve. Neither major loads a `.mjs` from the plugin
   *  directory as a plugin (V1 globs `*.{ts,js}`; V2 was checked on 2.2.5). */
  enginePath?: string | null;
  /** The OpenCode major to wire for; null when it could not be told. */
  major?: OpencodeMajor | null;
}

const PLUGIN_DIRS = ["plugin", "plugins"] as const;
type PluginDir = (typeof PLUGIN_DIRS)[number];

function dirFor(major: OpencodeMajor | null | undefined): PluginDir {
  return major === 2 ? "plugins" : "plugin";
}

/** The config key an npm pin goes under, per major. */
export function opencodePinKey(major: OpencodeMajor | null | undefined): "plugin" | "plugins" {
  return major === 2 ? "plugins" : "plugin";
}

const pluginFile = (configDir: string, dir: PluginDir) => join(configDir, dir, "ultra11y.js");
const ours = (path: string) => existsSync(path) && readFileSync(path, "utf8").includes(OPENCODE_MARKER);

/** `opencode --version` → its major. V1 prints `1.19.5`, V2 `opencode v2.2.5`. A later
 *  major is taken to speak V2's plugin API until there is reason to think otherwise. */
export function parseOpencodeVersion(text: string): OpencodeMajor | null {
  const m = /\bv?(\d+)\.\d+\.\d+/.exec(text);
  if (!m) return null;
  const major = Number(m[1]);
  if (major === 1) return 1;
  return major >= 2 ? 2 : null;
}

type VersionRunner = () => { status: number | null; stdout: string; error?: Error };

const runOpencodeVersion: VersionRunner = () => {
  const r = spawnSync("opencode", ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
    // npm's global shim on Windows is opencode.cmd, which only a shell resolves.
    shell: process.platform === "win32",
  });
  return { status: r.status, stdout: r.stdout ?? "", error: r.error };
};

/** The major of the `opencode` on PATH, or null (none, or an answer we cannot read). */
export function detectOpencodeMajor(run: VersionRunner = runOpencodeVersion): OpencodeMajor | null {
  try {
    const r = run();
    if (r.error || r.status !== 0) return null;
    return parseOpencodeVersion(r.stdout);
  } catch {
    return null;
  }
}

/** `--opencode-version 1|2` (a leading `v` is tolerated). */
export function parseOpencodeMajorFlag(value: unknown): { major?: OpencodeMajor; error?: string } {
  if (value === undefined) return {};
  const v = typeof value === "string" ? value.trim().replace(/^v/i, "") : "";
  if (v === "1" || v === "2") return { major: Number(v) as OpencodeMajor };
  return { error: `--opencode-version takes 1 or 2 (got ${typeof value === "string" ? JSON.stringify(value) : "no value"}).` };
}

/** True for an ultra11y entry in a `plugin`/`plugins` array, in any of the three forms:
 *  a string, V1's `[spec, options]` tuple, or V2's `{ package, options }` object. */
function isUltra11yPin(entry: unknown): boolean {
  const spec = typeof entry === "string" ? entry : Array.isArray(entry) ? entry[0] : (entry as { package?: unknown } | null)?.package;
  return typeof spec === "string" && /^ultra11y(@|$)/.test(spec);
}

function pinnedKeys(configDir: string): Array<"plugin" | "plugins"> {
  try {
    const cfg = JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf8"));
    return (["plugin", "plugins"] as const).filter((k) => Array.isArray(cfg?.[k]) && cfg[k].some(isUltra11yPin));
  } catch {
    return [];
  }
}

export function installOpencode({ configDir, pluginSource, skillsSource, enginePath, major = null }: OpencodeInstall): {
  reports: EditReport[];
  guidance: string[];
} {
  const dir = dirFor(major);
  const target = pluginFile(configDir, dir);
  if (existsSync(target) && !ours(target)) {
    throw new Error(`refusing to overwrite ${target}: it is not a file ultra11y wrote. Remove it manually if you want the plugin here.`);
  }
  const reports: EditReport[] = [writeTextWithBackup(target, readFileSync(pluginSource, "utf8"))];
  const guidance: string[] = [];

  // The plugin's own resolution order looks here first after $ULTRA11Y_BIN.
  if (enginePath && existsSync(enginePath)) {
    reports.push(writeTextWithBackup(join(configDir, dir, "ultra11y.mjs"), readFileSync(enginePath, "utf8")));
  }
  if (skillsSource) reports.push(...copySkillsInto(skillsSource, join(configDir, "skills")));

  // Our copy in the OTHER directory (an install for the other major) would load the gate a
  // second time: both majors scan both. A foreign file there is left alone.
  for (const other of PLUGIN_DIRS) {
    if (other === dir) continue;
    const stale = pluginFile(configDir, other);
    if (!ours(stale)) continue;
    rmSync(stale, { force: true });
    rmSync(join(configDir, other, "ultra11y.mjs"), { force: true });
    guidance.push(`opencode: moved the plugin from ${other}/ to ${dir}/ — it is loaded from one place only.`);
  }

  const key = opencodePinKey(major);
  guidance.push(
    major === null
      ? "opencode: no `opencode` on PATH to ask its version — wired plugin/, which OpenCode 1 and 2 both read (pass --opencode-version 1|2 to choose)."
      : `opencode: wired for OpenCode ${major}.`,
    "opencode: restart the session — plugins load at startup.",
    `opencode: the alternative is an npm pin — add "${key}": ["ultra11y@latest"] to ${join(configDir, "opencode.json")} and drop this file.`,
    "opencode: the gate surfaces as a blocked tool call whose error message carries the findings (OpenCode has no permission-decision channel).",
  );
  const pins = pinnedKeys(configDir);
  if (pins.length > 0) {
    guidance.push(`opencode: opencode.json also pins ultra11y under "${pins.join('", "')}" — remove the pin or this file, or the gate runs twice.`);
  }

  return { reports, guidance };
}

export function uninstallOpencode({ configDir }: { configDir: string }): { reports: EditReport[]; guidance: string[] } {
  const reports: EditReport[] = [];
  for (const dir of PLUGIN_DIRS) {
    const target = pluginFile(configDir, dir);
    if (!ours(target)) continue;
    rmSync(target, { force: true });
    rmSync(join(configDir, dir, "ultra11y.mjs"), { force: true });
    reports.push({ path: target, changed: true });
  }
  // Also drop an npm pin, if the user wired it that way instead — under either major's key.
  const configPath = join(configDir, "opencode.json");
  if (existsSync(configPath)) {
    reports.push(
      editJsonFile(configPath, (root) => {
        for (const key of ["plugin", "plugins"] as const) {
          if (!Array.isArray(root[key])) continue;
          const kept = (root[key] as unknown[]).filter((p) => !isUltra11yPin(p));
          if (kept.length > 0) root[key] = kept;
          else delete root[key];
        }
      }),
    );
  }
  return { reports, guidance: [] };
}

/** The plugin file of ours that is in place, or null. */
export function opencodePluginPath(configDir: string): string | null {
  for (const dir of PLUGIN_DIRS) if (ours(pluginFile(configDir, dir))) return pluginFile(configDir, dir);
  return null;
}

/** Where `install --opencode` writes for a given major. */
export function opencodePluginTarget(configDir: string, major: OpencodeMajor | null | undefined): string {
  return pluginFile(configDir, dirFor(major));
}

export function opencodeWired(configDir: string): boolean {
  // The npm-pin route leaves no file of ours, so check the config too.
  return opencodePluginPath(configDir) !== null || pinnedKeys(configDir).length > 0;
}

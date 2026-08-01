// Where each harness keeps its configuration, and where the engine should be invoked from.
//
// Every path is computed from the environment rather than hard-coded, so the whole install
// surface can be driven against a temporary HOME in tests without spawning anything.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** `~/.codex`, or `$CODEX_HOME` when set. */
export function codexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
}

/** `~/.config/opencode`, honouring `$XDG_CONFIG_HOME`. */
export function opencodeConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg && xdg !== "" ? xdg : join(homedir(), ".config"), "opencode");
}

/** Claude Code's settings file: the user's, or the project's under `--project`. */
export function claudeSettingsPath(project: boolean, cwd = process.cwd()): string {
  return project ? join(cwd, ".claude", "settings.json") : join(homedir(), ".claude", "settings.json");
}

/** Where the pinned copy of the engine lives once installed. */
export function pinnedEnginePath(): string {
  return join(homedir(), ".ultra11y", "bin", "ultra11y.mjs");
}

/** The `node <path>` command to bake into a harness's hook config.
 *
 *  A hook command has to keep working long after `install` returned, from a process whose
 *  cwd is the user's repo and whose PATH we do not control. That rules out two tempting
 *  options: a relative path (wrong cwd) and `npx -y ultra11y` (an npx resolution on every
 *  shell call, inside a PreToolUse hook, is a tax nobody would accept).
 *
 *  So: use the running bundle where it is stable, and otherwise pin a copy under
 *  `~/.ultra11y/bin/`. The pin is what makes `npx ultra11y install` work at all — its own
 *  argv[1] lives in a temp directory npm will delete. */
export function installedCliCommand(): string {
  const override = process.env.ULTRA11Y_BIN;
  if (override) return `node ${JSON.stringify(override)}`;

  const argv1 = process.argv[1];
  let source: string | null = null;
  try {
    if (argv1) source = realpathSync(argv1);
  } catch {
    /* argv[1] is gone or unreadable — fall through to the pin */
  }
  // An npx cache path is temporary by construction; anything under it must be copied out.
  const ephemeral = !source || /[/\\](?:_npx|\.npm[/\\]_npx|npm-cache|Temp|tmp)[/\\]/.test(source);
  if (source && !ephemeral) return `node ${JSON.stringify(source)}`;

  const pin = pinnedEnginePath();
  if (source) {
    mkdirSync(join(pin, ".."), { recursive: true });
    copyFileSync(source, pin);
  }
  return `node ${JSON.stringify(pin)}`;
}

/** True when a pinned engine is already in place. */
export function hasPinnedEngine(): boolean {
  return existsSync(pinnedEnginePath());
}

/** The root of the ultra11y package this engine was run from — where `skills/` and
 *  `.opencode/plugins/` live. Found by walking up from the running bundle looking for the
 *  marker directories rather than from `import.meta.url`, because the bundle is a single
 *  file that may sit at the package root (`scripts/ultra11y.mjs`) or inside a skill
 *  (`skills/review-a11y/scripts/ultra11y.mjs`). Returns null when nothing looks right,
 *  which the callers turn into "skip the optional copies" rather than an error. */
export function packageRoot(): string | null {
  let dir: string;
  try {
    dir = dirname(realpathSync(process.argv[1] ?? ""));
  } catch {
    return null;
  }
  for (let i = 0; i < 6 && dir && dir !== "/"; i++) {
    if (existsSync(join(dir, "skills", "review-a11y", "SKILL.md"))) return dir;
    dir = dirname(dir);
  }
  return null;
}

/** The two skills, as a directory to copy from — or null when this engine was not run from
 *  a package that carries them (a bare `scripts/ultra11y.mjs` downloaded on its own). */
export function bundledSkillsDir(): string | null {
  const root = packageRoot();
  const p = root ? join(root, "skills") : null;
  return p && existsSync(p) ? p : null;
}

/** The OpenCode plugin source shipped in this package. */
export function bundledOpencodePlugin(): string | null {
  const root = packageRoot();
  const p = root ? join(root, ".opencode", "plugins", "ultra11y.js") : null;
  return p && existsSync(p) ? p : null;
}

/** Copy each skill directory into `dest`, reporting a change only when there actually was
 *  one — so a second `install` says "already wired" instead of claiming work it did not do.
 *
 *  Freshness is decided on SKILL.md and the embedded engine: the engine is what goes stale
 *  on an upgrade, and SKILL.md is what goes stale on a re-word. Copying is `cpSync` rather
 *  than a symlink so the skill survives the source being moved or an npx cache pruned. */
export function copySkillsInto(source: string, dest: string): Array<{ path: string; changed: boolean }> {
  const out: Array<{ path: string; changed: boolean }> = [];
  for (const name of ["ultra11y", "review-a11y"]) {
    const from = join(source, name);
    if (!existsSync(from)) continue;
    const to = join(dest, name);
    const same = ["SKILL.md", join("scripts", "ultra11y.mjs")].every((f) => {
      const a = join(from, f);
      const b = join(to, f);
      try {
        return existsSync(b) && statSync(a).size === statSync(b).size && readFileSync(a).equals(readFileSync(b));
      } catch {
        return false;
      }
    });
    if (same) {
      out.push({ path: to, changed: false });
      continue;
    }
    cpSync(from, to, { recursive: true });
    out.push({ path: to, changed: true });
  }
  return out;
}

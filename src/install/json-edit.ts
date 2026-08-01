// Editing files that belong to the USER — their ~/.claude/settings.json, their
// ~/.codex/hooks.json, their AGENTS.md. Three rules govern everything here, and they are
// the reason this module exists instead of a few writeFileSync calls:
//
//  1. NEVER lose data. Anything pre-existing is backed up under a timestamped name before
//     it is touched, and writes are atomic (tmp + rename) so an interrupted install cannot
//     leave a half-written settings file that breaks the user's agent on next launch.
//  2. NEVER surprise. A no-op edit writes nothing and takes no backup, so running `install`
//     twice does not litter the directory with copies of an unchanged file.
//  3. NEVER guess. A settings file that does not parse is reported, not overwritten — the
//     user has hand-edited JSON in there and silently replacing it would be data loss.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** What an edit did. `changed: false` means the file already said what we wanted. */
export interface EditReport {
  path: string;
  changed: boolean;
  /** Path of the backup taken before overwriting, when one was needed. */
  backup?: string;
}

/** A user file we refuse to touch because we cannot read it. Carries the path so the CLI
 *  can tell the user exactly what to fix rather than "install failed". */
export class SettingsParseError extends Error {
  constructor(
    readonly path: string,
    cause: string,
  ) {
    super(`${path} is not valid JSON (${cause}) — fix or move it, then run install again. It has NOT been modified.`);
    this.name = "SettingsParseError";
  }
}

/** A timestamp safe for a filename on every platform. */
function stamp(): string {
  return new Date().toISOString().replaceAll(/[:.]/g, "-");
}

/** Write `content` to `path` atomically, backing up any existing file first. The tmp file
 *  is created in the SAME directory so the rename is a same-filesystem move (an atomic
 *  operation) rather than a copy that can be observed half-done. */
export function writeTextWithBackup(path: string, content: string, marker = "ultra11y"): EditReport {
  if (existsSync(path) && readFileSync(path, "utf8") === content) return { path, changed: false };
  mkdirSync(dirname(path), { recursive: true });
  let backup: string | undefined;
  if (existsSync(path)) {
    backup = `${path}.${marker}-backup-${stamp()}`;
    copyFileSync(path, backup);
  }
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, content, { mode: 0o644 });
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return { path, changed: true, backup };
}

/** Read a JSON object, let `mutate` change it in place, write it back only if that
 *  actually changed something. A missing file starts from `{}`; a malformed one throws
 *  SettingsParseError rather than being clobbered. */
export function editJsonFile(path: string, mutate: (root: Record<string, unknown>) => void): EditReport {
  let root: Record<string, unknown> = {};
  if (existsSync(path)) {
    const raw = readFileSync(path, "utf8");
    if (raw.trim()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        throw new SettingsParseError(path, (e as Error).message);
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new SettingsParseError(path, "the top level is not an object");
      }
      root = parsed as Record<string, unknown>;
    }
  }
  const before = JSON.stringify(root);
  mutate(root);
  if (JSON.stringify(root) === before && existsSync(path)) return { path, changed: false };
  return writeTextWithBackup(path, `${JSON.stringify(root, null, 2)}\n`);
}

/** Read a JSON object, or `null` when it is missing or unreadable. For `status`, which must
 *  report on a broken file rather than throw on it. */
export function readJsonSafe(path: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

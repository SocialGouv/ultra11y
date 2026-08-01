// Managed blocks in files the user also writes in — their AGENTS.md, their config.toml.
//
// The contract is the marker pair, not the content: whatever sits between the markers is
// ours to rewrite, and everything outside them is theirs and is never touched. That is what
// lets `install` be idempotent against a file a human keeps editing, and what lets
// `uninstall` remove exactly what was added rather than the whole file.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { type EditReport, writeTextWithBackup } from "./json-edit.js";

export const BLOCK_BEGIN = "<!-- BEGIN ultra11y (managed by `ultra11y install --agents-md`; edit outside this block) -->";
export const BLOCK_END = "<!-- END ultra11y -->";

/** Everything from the begin marker to the end marker, inclusive. Non-greedy so a file that
 *  somehow carries two blocks loses only the first, rather than everything between them. */
const blockRe = () => new RegExp(`${escapeRe(BLOCK_BEGIN)}[\\s\\S]*?${escapeRe(BLOCK_END)}\\n?`);

function escapeRe(s: string): string {
  return s.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Put `body` in the file's managed block: replace it if the markers are there, append it
 *  after a blank line otherwise, create the file if it is missing. The user's own prose is
 *  never rewritten — only the region between the markers. */
export function upsertManagedBlock(path: string, body: string): EditReport {
  const block = `${BLOCK_BEGIN}\n${body.trim()}\n${BLOCK_END}\n`;
  if (!existsSync(path)) return writeTextWithBackup(path, block);
  const current = readFileSync(path, "utf8");
  if (blockRe().test(current)) return writeTextWithBackup(path, current.replace(blockRe(), block));
  // Appending, not rewriting: whatever the user wrote stays byte-identical above.
  const sep = current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  return writeTextWithBackup(path, `${current}${sep}${block}`);
}

/** Remove the managed block. Deletes the file only when nothing but whitespace is left —
 *  i.e. when the block was all it ever held. */
export function removeManagedBlock(path: string): EditReport {
  if (!existsSync(path)) return { path, changed: false };
  const current = readFileSync(path, "utf8");
  if (!blockRe().test(current)) return { path, changed: false };
  const rest = current.replace(blockRe(), "");
  if (rest.trim() === "") {
    rmSync(path, { force: true });
    return { path, changed: true };
  }
  // Collapse the trailing run of newlines to exactly one, so removing a block that was
  // APPENDED (and therefore carries the blank-line separator we inserted) restores the
  // user's file byte-for-byte rather than leaving it slowly growing blank lines.
  return writeTextWithBackup(path, rest.replace(/\n+$/, "\n"));
}

/** True when the file currently carries our block. */
export function hasManagedBlock(path: string): boolean {
  return existsSync(path) && blockRe().test(readFileSync(path, "utf8"));
}

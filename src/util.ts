// Small shared utilities. Runtime-only Node APIs (Date, fs) are fine here — the
// "no Date" rule applies to workflow scripts, not the CLI bundle.
import { readFileSync } from "node:fs";
import { extname } from "node:path";

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Today as YYYY-MM-DD (local-agnostic, ISO date). */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function readText(path: string): string {
  return readFileSync(path, "utf8");
}

export function ext(path: string): string {
  return extname(path).toLowerCase();
}

export function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/** Is this finding `file` a served URL rather than a path in the tree? A merged dynamic
 *  result keeps its page URL when the host-anchor resolver could not map it back to source. */
export function isUrlPath(file: string): boolean {
  return /^https?:\/\//i.test(file);
}

/** A POSIX, repo-relative path for CI consumers (SARIF artifact URIs, GitHub annotations).
 *  GitHub anchors on paths relative to the checkout, so an absolute path — the user passed
 *  one on the command line — would silently fail to annotate. Relativise it when it sits
 *  under `baseDir`; leave it as-is when it does not, rather than inventing a path that
 *  resolves nowhere. */
export function repoRelative(file: string, baseDir: string): string {
  const posix = file.split("\\").join("/").replace(/^\.\//, "");
  const base = baseDir.split("\\").join("/").replace(/\/+$/, "");
  if (base && posix.startsWith(`${base}/`)) return posix.slice(base.length + 1);
  return posix;
}

/** Read all of stdin as text (for `audit -`). */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

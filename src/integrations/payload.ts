// THE PURE HALF of the e2e integration — no Node builtins, no engine.
//
// This exists because `ultra11y/cypress` is imported into a Cypress SUPPORT FILE, which the
// project's bundler loads INTO THE BROWSER. Anything it transitively imports has to survive
// that: one `node:child_process` in the chain and the support file fails to build. So the
// payload shape, the severity tables and the slug rule live here, and the spawning lives in
// core.ts next door, which only the Node halves import.

/** Severity order, most severe first. The engine's own French tokens. */
export const RANK: Record<string, number> = { bloquant: 0, majeur: 1, mineur: 2 };

/** `failOn` threshold → the least severe rank that still fails. Both spellings are
 *  accepted because the option is written in English while findings carry French tokens. */
export const THRESHOLD: Record<string, number> = { blocking: 0, bloquant: 0, major: 1, majeur: 1, minor: 2, mineur: 2 };

export interface FindingLike {
  ruleId: string;
  criteriaId: string;
  file: string;
  line: number;
  severity: string;
  message: string;
  advisory?: boolean;
  origin?: { sourceFile?: string; sourceLine?: number };
}

export interface AuditLike {
  findings?: FindingLike[];
}

/** Findings at or above the threshold, ignoring non-normative recommendations — a
 *  recommendation must never fail a test. */
export function failingFindings(result: AuditLike, failOn: string): FindingLike[] {
  const max = THRESHOLD[failOn];
  if (max === undefined) throw new Error(`ultra11y: failOn must be blocking|major|minor (got "${failOn}")`);
  return (result.findings ?? []).filter((f) => !f.advisory && (RANK[f.severity] ?? 99) <= max);
}

export function formatFailure(pageName: string, failing: FindingLike[]): string {
  const lines = [`ultra11y: ${failing.length} accessibility non-conformity(ies) on "${pageName}":`];
  for (const f of failing.slice(0, 20)) {
    lines.push(`  [${f.severity}] ${f.ruleId} (WCAG ${f.criteriaId}) — ${f.origin?.sourceFile ?? f.file} — ${f.message}`);
  }
  if (failing.length > 20) lines.push(`  … and ${failing.length - 20} more.`);
  lines.push("Full detail: .ultra11y/pages/ — re-audit offline with `ultra11y audit`.");
  return lines.join("\n");
}

export interface SnapshotPayload {
  meta: Record<string, unknown>;
  dom: string;
  styles?: unknown;
  boxes?: unknown;
  css?: unknown;
  screenshot?: string;
}

/** Same slug rule as the engine (src/snapshot.ts slugifyPageId): accent-folded URL path. */
export function slugify(url: string): string {
  let path = url;
  try {
    // Percent-decode first: `new URL()` encodes non-ASCII, so `/Accès` would otherwise
    // slugify to `acc-c3-a8s` — the raw UTF-8 bytes spelled out as a directory name.
    path = new URL(url).pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      /* malformed percent-escape — fold what we have */
    }
  } catch {
    /* not a URL — slugify the raw string */
  }
  const slug = path
    .normalize("NFD")
    // The same class the engine uses (src/snapshot.ts slugifyPageId). Written as the Unicode
    // property, never as a literal combining-mark range: a range typed literally is invisible
    // in a diff and survives a mangled encoding, and the symptom is two different page ids
    // for one page — `/Accès` recorded once as `acces` and once as something else.
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || (path === "/" || path === "" ? "accueil" : "page");
}

export interface CheckOptions {
  /** The page id (directory name). Defaults to the slugified URL path. */
  as?: string;
  /** Human page name for the report. Defaults to the document title. */
  name?: string;
  /** Severity at which the check fails, or `false` to record without ever failing. */
  failOn?: "blocking" | "major" | "minor" | false;
  /** Mark the page as sitting behind authentication. */
  auth?: boolean;
  /** Source files that rendered it — findings are then reported against YOUR code. */
  sources?: string[];
  /** Reproduction notes carried into the auditor ticket. */
  notes?: string;
  /** Capture a viewport screenshot for the pixel tier (Playwright: on by default). */
  screenshot?: boolean;
  /** The path you NAVIGATED to. Given it, the fixture refuses to record a page the browser
   *  did not stay on — a guarded route that redirected, a session that expired — instead of
   *  filing that other screen under this page's `as`/`name`. Nothing about such a snapshot
   *  looks wrong, which is what makes it the worst thing an accessibility report can carry.
   *  Compared by path (a query or fragment the app appends to its own route is the same
   *  page); a full URL works too. `scan --sample` applies the same rule. */
  expectPath?: string;
}

/** Did the browser stay on the page the caller asked for? Path-only, trailing slash folded;
 *  anything unparseable passes — this catches a redirect, it does not invent one. */
export function stayedOnPage(expected: string, actual: string): boolean {
  if (!expected || !actual) return true;
  const path = (u: string): string | undefined => {
    try {
      return new URL(u, "http://x.invalid").pathname.replace(/\/+$/, "");
    } catch {
      return undefined;
    }
  };
  const a = path(expected);
  const b = path(actual);
  if (a === undefined || b === undefined) return true;
  return a === b;
}

/** Build the snapshot payload from a collected page. Shared so every runner stamps the
 *  same metadata — a page recorded by Cypress and the same page recorded by Playwright must
 *  land on one identity, or the per-page grid grows a phantom column. */
export function buildPayload(
  collected: { dom: string; styles?: unknown; boxes?: unknown; css?: unknown; title?: string; url?: string; viewport?: unknown },
  url: string,
  runner: string,
  opts: CheckOptions,
  screenshot?: string,
): SnapshotPayload {
  const id = opts.as || slugify(url);
  return {
    meta: {
      v: 1,
      id,
      name: opts.name || collected.title || id,
      url,
      runner,
      viewport: collected.viewport,
      capturedAt: new Date().toISOString(),
      ...(opts.auth !== undefined ? { auth: opts.auth } : {}),
      ...(opts.sources ? { sources: opts.sources } : {}),
      ...(opts.notes ? { notes: opts.notes } : {}),
    },
    dom: collected.dom,
    styles: collected.styles,
    boxes: collected.boxes,
    css: collected.css,
    ...(screenshot ? { screenshot } : {}),
  };
}

/** Apply the gate to an audited page: throws with the auditor-shaped message, or returns. */
export function gate(result: AuditLike, pageName: string, failOn: CheckOptions["failOn"]): void {
  const threshold = failOn === undefined ? "blocking" : failOn;
  if (threshold === false) return;
  const failing = failingFindings(result, threshold);
  if (failing.length) throw new Error(formatFailure(pageName, failing));
}

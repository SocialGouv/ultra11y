// Content-level grounding — re-open the CITED source and confirm the citation's content
// is actually there, instead of trusting that a `file:line` merely parses. This is the
// family-wide "resolvable-but-not-actually-supported" hole: a verdict that says
// `supported` while pointing at a line whose content changed (or never existed) must
// fail the gate, not sail through. Snippet match is whitespace-normalized; a snippet
// found in the file but OUTSIDE the cited-line window is accepted but reported as
// `moved` (the escape hatch for code that drifted since the audit).
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface GroundingInput {
  file: string;
  line: number;
  snippet?: string;
  selector?: string;
}

export interface GroundingVerdict {
  ok: boolean;
  moved: boolean;
  issue?: string;
}

export interface GroundingSummary {
  grounded: number;
  moved: number;
  failed: number;
  issues: string[];
}

/** Lines on each side of the cited line the snippet may sit in and still count as "at
 *  the citation" (report line ↔ element line drift across renderers is expected). */
const WINDOW = 10;

/** Compare content, not serializer typography. Browser snapshots may wrap an element's text
 * over several lines and models commonly preserve straight rather than typographic quotes.
 * Attribute names, values and letter case remain strict: `minWidth` cannot masquerade as
 * `min-width`. */
const norm = (s: string) =>
  s.normalize("NFKC").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").replace(/>\s+/g, ">").replace(/\s+</g, "<").trim();

/** Streams/aggregates have no on-disk source to re-open. */
const isUnresolvable = (file: string) => !file || file === "-" || file === "<stdin>" || file === "stdin";

/** A markup token a selector implies. `ci` = case-INSENSITIVE (HTML tag & attribute
 *  names, which the HTML spec treats case-insensitively — `<IMG>` ≡ `<img>`); `cs` =
 *  case-SENSITIVE (CSS ids & classes, which ARE case-sensitive). `text` is already
 *  lowercased for ci probes so they match a lowercased haystack. */
interface Probe {
  text: string;
  ci: boolean;
}

/** Evidence harvesters sometimes use a semantic label where no stable DOM selector exists.
 * These tokens describe the evidence kind; treating them as tag selectors would require a
 * fictitious `<handler>` element and reject an otherwise valid file+line citation. Keep this
 * allow-list narrow so a misspelled real selector still fails closed. */
const SEMANTIC_SELECTORS: ReadonlySet<string> = new Set(["handler"]);

/** Tokens a CSS selector implies about the markup: tags probe as `<tag` (case-insensitive),
 *  attribute names as bare names (case-insensitive), ids/classes as bare names (case-SENSITIVE).
 *  Combinators and pseudo-classes are ignored — this is a fuzzy anchor, not a DOM query. */
function selectorProbes(selector: string): Probe[] {
  if (SEMANTIC_SELECTORS.has(selector.trim().toLowerCase())) return [];
  const probes: Probe[] = [];
  for (const simple of selector.split(/[\s>+~,]+/)) {
    if (!simple || simple === "—") continue;
    const tag = /^([a-zA-Z][\w-]*)/.exec(simple);
    if (tag) probes.push({ text: `<${tag[1]!.toLowerCase()}`, ci: true }); // HTML tag name
    for (const m of simple.matchAll(/[#.]([\w-]+)/g)) probes.push({ text: m[1]!, ci: false }); // CSS id/class — case-sensitive
    for (const m of simple.matchAll(/\[([\w-]+)/g)) probes.push({ text: m[1]!.toLowerCase(), ci: true }); // HTML attribute name
  }
  return probes;
}

export function groundFinding(g: GroundingInput, opts: { cwd?: string } = {}): GroundingVerdict {
  if (isUnresolvable(g.file)) return { ok: true, moved: false };
  const path = resolve(opts.cwd ?? process.cwd(), g.file);
  if (!existsSync(path)) return { ok: false, moved: false, issue: `cited file not found: ${g.file}` };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { ok: false, moved: false, issue: `cited file unreadable: ${g.file}` };
  }
  const lines = text.split("\n");
  if (g.line > lines.length) return { ok: false, moved: false, issue: `cited line out of range: ${g.file}:${g.line} (${lines.length} lines)` };

  // line < 1 = "no line anchor" (e.g. a dynamic finding not yet resolved to source):
  // the whole file is the window, so a hit can never be classified as `moved`.
  const hasLine = g.line >= 1;
  const lo = hasLine ? Math.max(0, g.line - 1 - WINDOW) : 0;
  const hi = hasLine ? Math.min(lines.length, g.line + WINDOW) : lines.length;
  const windowText = norm(lines.slice(lo, hi).join("\n"));
  const fileText = hasLine ? norm(text) : windowText;

  const snippet = g.snippet ? norm(g.snippet) : "";
  if (snippet) {
    if (windowText.includes(snippet)) return { ok: true, moved: false };
    if (fileText.includes(snippet)) return { ok: true, moved: true };
    return { ok: false, moved: false, issue: `cited snippet not found in ${g.file}:${g.line}` };
  }

  const probes = selectorProbes(g.selector ?? "");
  if (!probes.length) return { ok: true, moved: false }; // nothing beyond file+line is checkable
  // ci probes (HTML tag/attribute names) test a lowercased haystack — `<img` matches `<IMG`
  // — while cs probes (CSS ids/classes) test the verbatim haystack, so a wrong-case id
  // (`#Foo` vs source `#foo`) is NOT loosened into a false match.
  const hit = (hay: string) => {
    const hayLc = hay.toLowerCase();
    return probes.some((p) => (p.ci ? hayLc : hay).includes(p.text));
  };
  if (hit(windowText)) return { ok: true, moved: false };
  if (hit(fileText)) return { ok: true, moved: true };
  return { ok: false, moved: false, issue: `cited selector "${g.selector}" not found in ${g.file}:${g.line}` };
}

export function groundItems(items: GroundingInput[], opts: { cwd?: string } = {}): GroundingSummary {
  const s: GroundingSummary = { grounded: 0, moved: 0, failed: 0, issues: [] };
  for (const it of items) {
    const r = groundFinding(it, opts);
    if (r.ok) {
      s.grounded++;
      if (r.moved) s.moved++;
    } else {
      s.failed++;
      if (r.issue) s.issues.push(r.issue);
    }
  }
  return s;
}

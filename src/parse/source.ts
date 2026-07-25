// Detect the input kind and normalise it into a position-aware Doc the engine
// walks. HTML is parsed directly. JSX/TSX is parsed into a real Babel AST and
// lowered to the same Doc model (accurate offsets, not lossy); only if that hard
// fails do we fall back to the best-effort lossy regex transform, so an audit
// always produces a result.
import { parseHtml, type Doc } from "./html.js";
import { jsxToHtml } from "./jsx.js";
import { parseJsxAst, type AstFile } from "./jsx-ast.js";
import { jsxAstToDoc } from "./jsx-bridge.js";
import { parseCaptureProvenance } from "../capture.js";

export type SourceKind = "html" | "jsx" | "sfc";

export function detectKind(file: string, forceJsx = false): SourceKind {
  if (forceJsx) return "jsx";
  if (/\.(jsx|tsx)$/i.test(file)) return "jsx";
  // Single-file components: parsed via the HTML path but with component case
  // preserved (so PascalCase components keep their identity and rules skip them).
  if (/\.(vue|svelte|astro)$/i.test(file)) return "sfc";
  return "html"; // .html/.htm/.xhtml, stdin, and unknown extensions default to HTML
}

const ASTRO_FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Astro's `---\n…\n---` code fence at the top of the file (component script:
 *  imports, props, data prep) — NOT markup. Returns the frontmatter's own source
 *  (for the graph to parse as a script AST, see graph/build.ts) and a `blanked`
 *  variant of the full file with every frontmatter character except newlines
 *  replaced by a space: same length, same line count, same byte offsets as the
 *  original — so `parseHtml` never mistakes frontmatter TS syntax for markup
 *  (`Array<string>` reads as a `<string>` tag unstripped) while every finding's
 *  line number AND byte offset (`fix`'s range-based codemods) stay exact. Absent
 *  frontmatter (no leading `---` fence) returns the source unchanged. */
export function splitAstroFrontmatter(source: string): { frontmatter: string; blanked: string } {
  const m = ASTRO_FRONTMATTER_RE.exec(source);
  if (!m) return { frontmatter: "", blanked: source };
  const fence = m[0];
  const frontmatter = fence.replace(/^---\r?\n/, "").replace(/\r?\n---\r?\n?$/, "");
  const blanked = fence.replace(/[^\n\r]/g, " ") + source.slice(fence.length);
  return { frontmatter, blanked };
}

export function parseSource(source: string, file: string, opts: { forceJsx?: boolean } = {}): Doc {
  return parseSourceWithAst(source, file, opts).doc;
}

/** `parseSource` plus the Babel AST it built on the way (null for HTML/SFC templates,
 *  and for a JSX file that only survived the lossy fallback). The dependency-graph pass
 *  needs BOTH — the Doc to extract markup facts and the AST to extract imports/exports —
 *  and going through this one function is what lets the graph hand its already-parsed
 *  Docs to the audit loop instead of every markup file being read and parsed twice. */
export function parseSourceWithAst(source: string, file: string, opts: { forceJsx?: boolean } = {}): { doc: Doc; ast: AstFile | null } {
  const kind = detectKind(file, opts.forceJsx);
  if (kind === "jsx") {
    const ast = parseJsxAst(source);
    if (ast) return { doc: jsxAstToDoc(ast, source, file), ast };
    // Catastrophic parse failure → lossy fallback (flagged lossy in the Doc).
    return { doc: parseHtml(jsxToHtml(source), file, true), ast: null };
  }
  // .astro's frontmatter fence is stripped (blanked) before HTML parsing — see
  // splitAstroFrontmatter. .vue/.svelte have no such fence (their <script> block
  // parses cleanly as an ordinary — if foreign-cased — element).
  const isAstro = kind === "sfc" && /\.astro$/i.test(file);
  const htmlSource = isAstro ? splitAstroFrontmatter(source).blanked : source;
  // SFC templates parse as HTML but keep component case (preserveCase) and a
  // distinct kind so the injected-content guards treat them like JSX, not HTML.
  const doc = parseHtml(htmlSource, file, false, kind === "sfc");
  // A rendered capture is real HTML (kind "html"): attach its provenance so findings
  // are re-attributed to the source component. SFC/JSX are source, never captures.
  if (kind === "html") {
    const capture = parseCaptureProvenance(source);
    if (capture) doc.capture = capture;
  }
  return { doc, ast: null };
}

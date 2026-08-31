// A DOM-lite over htmlparser2: parse HTML into a flat, position-aware element
// tree that the rules walk. Zero runtime deps beyond htmlparser2 (bundled).
import { parseDocument } from "htmlparser2";
import type { Document, ChildNode, Element as DhElement } from "domhandler";
import type { RenderSignals } from "../types.js";

export interface El {
  type: "element";
  tag: string; // lowercased intrinsic, or original-cased JSX component name
  attribs: Record<string, string>;
  children: HNode[];
  parent: El | null;
  line: number; // 1-based
  col: number; // 1-based
  start: number; // source offset
  end: number;
  // JSX only: the element carries a {...spread} attribute (props could inject a
  // name/aria). Undefined for HTML. Used by the cross-file rules.
  spread?: boolean;
  // JSX only: source-order metadata for ordinary/spread attributes. Missing on the HTML/SFC
  // parser, where a dynamic spread is conservatively treated as able to override anything.
  jsxAttributes?: { name?: string; spread?: true; start: number }[];
  // JSX only: identity of the conditional arm this element was lowered from
  // (`{cond ? <A/> : <B/>}` / `{cond && <A/>}`). Elements in different arms of the same
  // conditional are mutually exclusive at runtime, so order-sensitive rules
  // (heading-order-skip) must not compare across arms. Undefined = unconditional.
  branchArm?: string;
}
export interface Txt {
  type: "text";
  data: string;
  parent: El | null;
}
export type HNode = El | Txt;

export interface Doc {
  file: string;
  source: string;
  lossy: boolean;
  // How the Doc was produced: a real HTML parse, a real JSX/TSX AST (offsets index
  // the original file — fix-safe), the best-effort lossy JSX→HTML fallback, or a
  // single-file component (.vue/.svelte/.astro) template — parsed as HTML but with
  // component case PRESERVED (so PascalCase components are skipped like in JSX).
  // Optional/additive so existing AuditResult JSON and direct parseHtml callers stay valid.
  kind?: "html" | "jsx-ast" | "jsx-lossy" | "sfc";
  // JSX only: import specifiers of component-LIBRARY components rendered in this
  // file (e.g. "@codegouvfr/react-dsfr/Button"). Their real HTML output lives in
  // node_modules and is invisible to source analysis — a source verdict is
  // therefore incomplete for them (surfaced as a scope caveat, never silent).
  opaqueComponents?: string[];
  // Set when this Doc is a RENDERED capture file (real DOM serialized from a test/
  // build) carrying a `<!-- ultra11y:capture … -->` provenance comment. Its findings
  // are ground truth (not preliminary) and re-attributed to the source component via
  // `Finding.origin`. Optional/additive; absent for ordinary source/HTML files.
  capture?: CaptureProvenance;
  // Set when this Doc is a PAGE SNAPSHOT's dom.html and its sibling signal files verified
  // against it: computed styles, laid-out boxes, the accessibility tree, a screenshot. What a
  // browser knows and source cannot. Absent for every ordinary file — which is why the
  // rendered rules (src/rules/rendered.ts) simply do not fire there, and adding that tier
  // cannot change any pre-existing verdict.
  signals?: RenderSignals;
  roots: HNode[];
  elements: El[];
  byId: Map<string, El>;
  lineStarts: number[];
}

// Provenance recorded in a rendered capture's leading HTML comment, linking the
// serialized DOM back to the source component that produced it. All fields but the
// format version are best-effort (the harvester derives them heuristically).
export interface CaptureProvenance {
  v: number; // provenance format version (starts at 1)
  sourceFile?: string; // repo-relative source, e.g. "src/Button.tsx"
  component?: string; // best-effort component name, e.g. "Button"
  test?: string; // originating test file, e.g. "src/Button.test.tsx"
  name?: string; // originating test title
  // Set when the capture is a PAGE SNAPSHOT (src/snapshot.ts) rather than a component
  // render: the page's stable id and the URL it was captured from. This is what carries
  // page identity into `Finding.page`, and with it the per-page criterion grid.
  page?: string;
  url?: string;
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

// Exported so the JSX-AST bridge (parse/jsx-bridge.ts) reuses the exact same
// line/col arithmetic over the original source as the HTML path.
export function lineStartsOf(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

export function lineColAt(lineStarts: number[], offset: number): { line: number; col: number } {
  // binary search for the greatest lineStart <= offset
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: offset - lineStarts[lo]! + 1 };
}

export function parseHtml(source: string, file: string, lossy = false, sfc = false): Doc {
  const dom: Document = parseDocument(source, {
    withStartIndices: true,
    withEndIndices: true,
    // SFC: keep tag case so PascalCase components stay non-intrinsic (rules skip
    // them). Attribute names stay lowercased (HTML attrs are case-insensitive, and
    // the dynamic-binding prefixes `:`/`v-bind:`/`bind:` are already lowercase).
    lowerCaseTags: !sfc,
    lowerCaseAttributeNames: true,
    recognizeSelfClosing: true,
  });
  const lineStarts = lineStartsOf(source);
  const elements: El[] = [];
  const byId = new Map<string, El>();

  const convert = (node: ChildNode, parent: El | null): HNode | null => {
    if (node.type === "text") {
      return { type: "text", data: (node as { data: string }).data, parent };
    }
    if (node.type === "tag" || node.type === "script" || node.type === "style") {
      const dh = node as DhElement;
      const start = dh.startIndex ?? 0;
      const { line, col } = lineColAt(lineStarts, start);
      const el: El = {
        type: "element",
        tag: sfc ? dh.name : dh.name.toLowerCase(),
        attribs: { ...dh.attribs },
        children: [],
        parent,
        line,
        col,
        start,
        end: dh.endIndex ?? start,
      };
      elements.push(el);
      const id = el.attribs.id;
      if (id && !byId.has(id)) byId.set(id, el);
      for (const child of dh.children) {
        const c = convert(child, el);
        if (c) el.children.push(c);
      }
      return el;
    }
    return null; // comments, directives, etc. are ignored
  };

  const roots: HNode[] = [];
  for (const node of dom.children) {
    const c = convert(node, null);
    if (c) roots.push(c);
  }
  return { file, source, lossy, kind: sfc ? "sfc" : lossy ? "jsx-lossy" : "html", roots, elements, byId, lineStarts };
}

// ---- helpers used by rules

export function attr(el: El, name: string): string | undefined {
  return el.attribs[name.toLowerCase()];
}

export function hasAttr(el: El, name: string): boolean {
  return name.toLowerCase() in el.attribs;
}

// Framework dynamic-binding prefixes: Vue `:x`/`v-bind:x`, Alpine `x-bind:x`,
// Svelte `bind:x`. The HTML parser keeps these as literal attribute keys.
const BIND_PREFIXES = ["", ":", "v-bind:", "x-bind:", "bind:"];

/** Like `attr`, but also matches a dynamically-bound spelling (`:name`, `v-bind:name`,
 *  …). Returns the (possibly expression) value; the caller treats it as "present but
 *  value-unknown" so a missing-name/alt finding is suppressed rather than hallucinated. */
export function boundAttr(el: El, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const p of BIND_PREFIXES) {
    const k = p + lower;
    if (k in el.attribs) return el.attribs[k];
  }
  return undefined;
}

export function hasBoundAttr(el: El, name: string): boolean {
  return boundAttr(el, name) !== undefined;
}

/** The element carries a spread/shorthand that can inject arbitrary attributes at
 *  runtime — React `{...props}`, Vue `v-bind="…"`, Svelte `{...rest}` / `{shorthand}`.
 *  A "missing attribute/name" finding on such an element is unprovable, so rules skip it. */
export function hasDynamicSpread(el: El): boolean {
  if (el.spread) return true;
  for (const k in el.attribs) if (k === "v-bind" || k.startsWith("{")) return true;
  return false;
}

/** Whether a dynamic spread can still supply one of several equivalent attributes.
 *
 * JSX carries source-order metadata, so later explicit props close that spelling. HTML/SFC
 * parsing does not, and therefore stays conservative: a detected spread remains effective. */
export function dynamicSpreadMayProvide(el: El, names: string[]): boolean {
  if (!hasDynamicSpread(el)) return false;
  if (!el.jsxAttributes) return true;
  const spreads = el.jsxAttributes.filter((attribute) => attribute.spread);
  if (!spreads.length) return true;
  const lastSpread = Math.max(...spreads.map((attribute) => attribute.start));
  return !names.every((name) => el.jsxAttributes!.some((attribute) => attribute.name === name && attribute.start > lastSpread));
}

export function isVoid(tag: string): boolean {
  return VOID.has(tag);
}

export function textContent(node: HNode): string {
  if (node.type === "text") return node.data;
  let out = "";
  for (const c of node.children) out += textContent(c);
  return out;
}

/** Visible text content, whitespace-collapsed and trimmed. */
export function visibleText(el: El): string {
  return textContent(el).replace(/\s+/g, " ").trim();
}

export function descendants(el: El): El[] {
  const out: El[] = [];
  const stack = [...el.children];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === "element") {
      out.push(n);
      stack.push(...n.children);
    }
  }
  return out;
}

export function ancestors(el: El): El[] {
  const out: El[] = [];
  let p = el.parent;
  while (p) {
    out.push(p);
    p = p.parent;
  }
  return out;
}

export function closest(el: El, pred: (e: El) => boolean): El | undefined {
  let p: El | null = el;
  while (p) {
    if (pred(p)) return p;
    p = p.parent;
  }
  return undefined;
}

export function elementsByTag(doc: Doc, ...tags: string[]): El[] {
  const want = new Set(tags.map((t) => t.toLowerCase()));
  return doc.elements.filter((e) => want.has(e.tag));
}

export function getById(doc: Doc, id: string): El | undefined {
  return doc.byId.get(id);
}

/** All ids in the document, with duplicates preserved (for duplicate-id). */
export function allIds(doc: Doc): { id: string; el: El }[] {
  const out: { id: string; el: El }[] = [];
  for (const el of doc.elements) {
    const id = el.attribs.id;
    if (id) out.push({ id, el });
  }
  return out;
}

/** The source line(s) the element starts on, trimmed and truncated. */
/** The source text that SHOWS this element, bounded to `max`.
 *
 *  Anchored at the element's own offset, not at the start of its line. On hand-written source
 *  the two are the same thing once indentation is trimmed — but a serialized DOM capture is a
 *  SINGLE LINE, so anchoring on the line handed back the document head for every element in
 *  the page, identical for all of them. Measured on a real capture: every one of 128 form
 *  controls carried `<html data-fr-scheme="system" lang="fr">…` as its snippet, which tells a
 *  reader nothing and gives the grounding check nothing to match on.
 *
 *  The line still bounds the slice, so a multi-line element shows its opening tag rather than
 *  its whole subtree. */
export function snippet(doc: Doc, el: El, max = 120): string {
  const lineStart = doc.lineStarts[el.line - 1] ?? 0;
  // `lineStarts` already indexes the next line. Searching for `\n` from this line's start for
  // EVERY finding rescanned an entire minified one-line document each time: 8k dangling-label
  // findings × a 650 kB line turned an otherwise-linear audit quadratic. The next recorded
  // offset gives the same boundary in O(1); on the last/only line the document end is it.
  const nextLineStart = doc.lineStarts[el.line];
  const end = nextLineStart === undefined ? doc.source.length : Math.max(lineStart, nextLineStart - 1);
  const from = Math.min(Math.max(el.start, lineStart), end);
  // A JSX element usually opens on one line and carries its attributes on the next ones, so
  // stopping at the line break showed "<a" and nothing else. Read to the end of the OPENING
  // TAG instead — that is what identifies the element — and collapse the whitespace, which
  // grounding normalises on both sides anyway (src/grounding.ts).
  //
  // The opening tag and not the element: a snippet longer than `max` gets an ellipsis, and an
  // ellipsis is not in the source, so `includes` stops matching and grounding refuses a
  // citation that was perfectly real. Keeping the slice short keeps it verbatim.
  const tagEnd = doc.source.indexOf(">", from);
  const to = Math.min(from + max, Math.max(Math.min(end, from + max), tagEnd === -1 ? end : tagEnd + 1));
  const raw = doc.source.slice(from, Math.min(to, doc.source.length)).replace(/\s+/g, " ").trim();
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
}

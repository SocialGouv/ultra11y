// Pass 1 of `audit --graph`: stream every discovered file, parse it, extract a
// compact FileGraphNode, and DISCARD the AST/Doc — so only O(file count) small
// records are ever held, never whole-repo source. Then assemble the DepGraph.
import { readText, ext } from "../util.js";
import { GRAPH_ONLY_EXT } from "../glob.js";
import { detectKind, splitAstroFrontmatter, parseSource, parseSourceWithAst } from "../parse/source.js";
import { parseJsxAst } from "../parse/jsx-ast.js";
import type { Doc } from "../parse/html.js";
import { dirname } from "node:path";
import { extractGraphNode, type FileGraphNode } from "./imports.js";
import { buildGraph, type DepGraph } from "./graph.js";
import { readTsAliases } from "./tsconfig.js";

const GRAPH_ONLY = new Set(GRAPH_ONLY_EXT);

// A plain TS/JS module has no markup — an empty Doc keeps extractGraphNode from
// reading nothing but its (non-existent) elements, while still handing the real
// source's AST to the import/export extraction below. Never fed through `parseHtml`
// on the real TS/JS text: generics like `Array<string>` would look like tags to it.
function emptyDoc(file: string, source: string): Doc {
  return { file, source, lossy: false, kind: "html", roots: [], elements: [], byId: new Map(), lineStarts: [0] };
}

// .vue/.svelte's own <script>/<script setup>…</script> block — the only part of an
// SFC that's real JS/TS. Astro's frontmatter fence is handled separately (it isn't
// a <script> tag) via splitAstroFrontmatter.
const SCRIPT_BLOCK_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;

// The graph-relevant script source of an SFC: Astro's `---…---` frontmatter, or a
// .vue/.svelte file's <script> block(s). A Vue SFC commonly has BOTH `<script>` and
// `<script setup>` — concatenate ALL blocks so imports/exports from either are seen.
// "" when there is none to parse (template-only SFC) — extractGraphNode still
// synthesizes the self component def either way.
function sfcScriptSource(content: string, file: string): string {
  if (/\.astro$/i.test(file)) return splitAstroFrontmatter(content).frontmatter;
  return [...content.matchAll(SCRIPT_BLOCK_RE)].map((m) => m[1] ?? "").join("\n");
}

// How much of the graph pass's parse work may be carried over to the audit loop.
// The graph pass already reads and parses every markup file; without a hand-off the
// audit loop reads and parses each of them a SECOND time. Handing the Docs over is a
// pure win — they are the very same objects `parseSource` would rebuild — but holding
// them all would break the streaming design's bounded-memory promise on a huge repo.
// So the hand-off is budgeted: files are cached in discovery order (deterministic)
// until either ceiling is hit, after which the audit loop simply re-parses as before.
const CARRY_MAX_BYTES = 12 * 1024 * 1024;
const CARRY_MAX_ELEMENTS = 300_000;

export interface GraphBuild {
  graph: DepGraph;
  /** Markup Docs already parsed by this pass, for the audit loop to reuse. Bounded —
   *  a miss is not an error, it just means "parse it yourself". Never holds the
   *  synthetic empty Docs of plain .ts/.js modules (no markup to audit). */
  docs: Map<string, Doc>;
}

/** The graph alone — the shape every caller but the audit loop wants. */
export function buildGraphStreaming(files: string[]): DepGraph {
  return buildGraphAndDocs(files).graph;
}

export function buildGraphAndDocs(files: string[], opts: { carryDocs?: boolean; carryBudget?: { bytes: number; elements: number } } = {}): GraphBuild {
  const budget = opts.carryBudget ?? { bytes: CARRY_MAX_BYTES, elements: CARRY_MAX_ELEMENTS };
  const nodes: FileGraphNode[] = [];
  const docs = new Map<string, Doc>();
  let carriedBytes = 0;
  let carriedElements = 0;
  for (const file of files) {
    let content: string;
    try {
      content = readText(file);
    } catch {
      continue; // unreadable / vanished — skip, like the audit loop does
    }
    let ast = null;
    let doc: Doc;
    let sfc = false;
    let auditable = false;
    if (GRAPH_ONLY.has(ext(file))) {
      // Plain .ts/.js/.mjs/.cjs: never an audit target (see GRAPH_ONLY_EXT), but real
      // cross-file structure (barrel re-exports, plain-JS component definitions) the
      // graph needs. Babel's typescript+jsx plugins parse pure TS/JS fine.
      ast = parseJsxAst(content);
      doc = emptyDoc(file, content);
    } else if (detectKind(file) === "sfc") {
      // The script/frontmatter AST is parsed SEPARATELY from the template doc (see
      // sfcScriptSource) purely for imports/re-exports; extractGraphNode also
      // synthesizes a self component def (opts.sfc) so cross-file resolution and
      // capture coverage see the SFC itself.
      sfc = true;
      auditable = true;
      doc = parseSource(content, file);
      const scriptSrc = sfcScriptSource(content, file);
      if (scriptSrc) ast = parseJsxAst(scriptSrc);
    } else {
      // HTML and JSX/TSX go through the audit's OWN parser, so the Doc handed to the
      // audit loop below is byte-for-byte the one it would have built itself.
      auditable = true;
      ({ doc, ast } = parseSourceWithAst(content, file));
    }
    if (opts.carryDocs && auditable && carriedBytes + content.length <= budget.bytes && carriedElements + doc.elements.length <= budget.elements) {
      docs.set(file, doc);
      carriedBytes += content.length;
      carriedElements += doc.elements.length;
    }
    nodes.push(extractGraphNode(ast, doc, file, { sfc }));
  }
  // tsconfig-paths anchoring, walking up from the first file's dir as before. The
  // engine resolver reads the tsconfig chain itself (via `startDir`); the parsed
  // cwd-relative alias map only feeds the fallback resolver. Empty when there is
  // no tsconfig.
  const startDir = files[0] ? dirname(files[0]) : process.cwd();
  return { graph: buildGraph(nodes, readTsAliases(startDir), startDir), docs };
}

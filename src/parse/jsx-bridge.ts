// Lower a real JSX/TSX Babel AST into the engine's existing Doc/El model so all
// static rules run unchanged on accurate trees. Casing routes the work for free:
// intrinsic elements (div, img, input) are lowercased — existing tag-literal
// rules apply; component elements (Button, IconButton) keep their original case —
// existing rules skip them, only cross-file rules (which resolve the component to
// its definition) look at them. Offsets index the ORIGINAL source, so the Doc is
// not lossy and `fix` can edit by range.
import type { AstNode, AstFile } from "./jsx-ast.js";
import type { Doc, El, HNode } from "./html.js";
import { lineStartsOf } from "./html.js";

// React → HTML attribute spellings the rules look for (matches parse/jsx.ts).
// Applied AFTER lowercasing, so e.g. tabIndex→tabindex falls out of lowercasing
// and only className/htmlFor need an explicit remap.
const RENAME: Record<string, string> = { classname: "class", htmlfor: "for", xmllang: "xml:lang" };

function asNode(v: unknown): AstNode | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as AstNode) : undefined;
}
function asNodes(v: unknown): AstNode[] {
  return Array.isArray(v) ? (v as AstNode[]) : [];
}

export function jsxName(name: AstNode | undefined): string {
  if (!name) return "unknown";
  if (name.type === "JSXIdentifier") return typeof name.name === "string" ? name.name : "unknown";
  if (name.type === "JSXNamespacedName") {
    const ns = asNode(name.namespace);
    const nm = asNode(name.name);
    return `${ns?.name ?? ""}:${nm?.name ?? ""}`;
  }
  if (name.type === "JSXMemberExpression") {
    const parts: string[] = [];
    let n: AstNode | undefined = name;
    while (n && n.type === "JSXMemberExpression") {
      const prop = asNode(n.property);
      if (prop && typeof prop.name === "string") parts.unshift(prop.name);
      n = asNode(n.object);
    }
    if (n && typeof n.name === "string") parts.unshift(n.name);
    return parts.join(".");
  }
  return "unknown";
}

// Intrinsic (HTML) names start lowercase; components are Capitalized; for member
// expressions (motion.div, S.Button) the head decides.
export function isIntrinsic(tag: string): boolean {
  const head = tag.split(".")[0] ?? tag;
  const first = head[0] ?? "";
  return first === first.toLowerCase();
}

export function normAttrName(raw: string): string {
  const lower = raw.toLowerCase();
  return RENAME[lower] ?? lower;
}

function attribsOf(opening: AstNode, source: string): Record<string, string> {
  const attribs: Record<string, string> = {};
  for (const a of asNodes(opening.attributes)) {
    if (a.type === "JSXSpreadAttribute") continue; // {...props} — tracked by the graph, not an attr
    if (a.type !== "JSXAttribute") continue;
    const name = normAttrName(jsxName(asNode(a.name)));
    if (name in attribs) continue; // first wins, like htmlparser2
    const value = asNode(a.value);
    if (!value) {
      attribs[name] = ""; // boolean attribute (present)
    } else if (value.type === "StringLiteral") {
      attribs[name] = typeof value.value === "string" ? value.value : "";
    } else if (value.type === "JSXExpressionContainer") {
      // A container wrapping a LITERAL (tabIndex={5}, aria-label={"Save"}, {-1}) carries a
      // known value — unwrap it (no braces) so value-based rules read "5"/"Save", not "{5}".
      // Anything else (identifiers, calls, ternaries) stays the raw `{…}` slice = dynamic.
      const expr = asNode(value.expression);
      if (expr && (expr.type === "NumericLiteral" || (expr.type === "UnaryExpression" && asNode(expr.argument)?.type === "NumericLiteral"))) {
        attribs[name] = source.slice(expr.start ?? 0, expr.end ?? 0); // "5" / "-1"
      } else if (expr && expr.type === "StringLiteral") {
        attribs[name] = typeof expr.value === "string" ? expr.value : "";
      } else {
        attribs[name] = source.slice(value.start ?? 0, value.end ?? 0); // dynamic expression — keep raw {…}
      }
    } else {
      // <jsx/> value or other → keep the raw source slice ("present / non-empty name").
      attribs[name] = source.slice(value.start ?? 0, value.end ?? 0);
    }
  }
  return attribs;
}

// A JSX node collected from inside an expression, tagged with the conditional arm it
// belongs to (mutually-exclusive arms get distinct tags; "" = unconditional).
interface Collected {
  node: AstNode;
  arm: string;
}

// Collect JSXElement/JSXFragment nodes nested inside an arbitrary expression
// (e.g. {cond && <img/>} or {items.map(i => <li/>)}) without descending into the
// matched node (convert() handles its subtree). Ternary consequent/alternate and the
// right operand of `&&`/`||` are tagged as distinct arms so order-sensitive rules can
// tell two elements are mutually exclusive (never both rendered). `seq` mints unique
// conditional ids across the whole doc so arms from different conditionals never collide.
function collectJsx(node: unknown, out: Collected[], arm: string, seq: { n: number }): void {
  if (Array.isArray(node)) {
    for (const item of node) collectJsx(item, out, arm, seq);
    return;
  }
  const n = asNode(node);
  if (!n || typeof n.type !== "string") return;
  if (n.type === "JSXElement" || n.type === "JSXFragment") {
    out.push({ node: n, arm });
    return;
  }
  if (n.type === "ConditionalExpression") {
    const id = seq.n++;
    collectJsx(n.test, out, arm, seq);
    collectJsx(n.consequent, out, `${arm}/c${id}T`, seq);
    collectJsx(n.alternate, out, `${arm}/c${id}F`, seq);
    return;
  }
  if (n.type === "LogicalExpression") {
    const id = seq.n++;
    collectJsx(n.left, out, arm, seq);
    collectJsx(n.right, out, `${arm}/c${id}R`, seq);
    return;
  }
  for (const key in n) {
    if (key === "loc" || key === "start" || key === "end" || key === "range" || key === "type") continue;
    collectJsx(n[key], out, arm, seq);
  }
}

export function jsxAstToDoc(ast: AstFile, source: string, file: string): Doc {
  const lineStarts = lineStartsOf(source);
  const elements: El[] = [];
  const byId = new Map<string, El>();
  const roots: HNode[] = [];
  const seq = { n: 0 }; // doc-wide counter for unique conditional-arm ids

  const convert = (node: AstNode, parent: El | null, arm = ""): El => {
    let tag = "#fragment";
    let attribs: Record<string, string> = {};
    let spread = false;
    let jsxAttributes: El["jsxAttributes"];
    if (node.type === "JSXElement") {
      const opening = asNode(node.openingElement);
      const raw = jsxName(opening ? asNode(opening.name) : undefined);
      tag = isIntrinsic(raw) ? raw.toLowerCase() : raw;
      if (opening) {
        attribs = attribsOf(opening, source);
        jsxAttributes = asNodes(opening.attributes)
          .filter((a) => a.type === "JSXSpreadAttribute" || a.type === "JSXAttribute")
          .map((a) =>
            a.type === "JSXSpreadAttribute"
              ? { spread: true as const, start: a.start ?? 0 }
              : { name: normAttrName(jsxName(asNode(a.name))), start: a.start ?? 0 },
          );
        spread = jsxAttributes.some((attribute) => attribute.spread);
      }
    }
    const el: El = {
      type: "element",
      tag,
      attribs,
      children: [],
      parent,
      line: node.loc?.start.line ?? 1,
      col: (node.loc?.start.column ?? 0) + 1,
      start: node.start ?? 0,
      end: node.end ?? 0,
      ...(spread ? { spread: true } : {}),
      ...(jsxAttributes?.length ? { jsxAttributes } : {}),
      ...(arm ? { branchArm: arm } : {}),
    };
    elements.push(el);
    const id = attribs.id;
    if (id && !byId.has(id)) byId.set(id, el);

    for (const c of asNodes(node.children)) {
      if (c.type === "JSXText") {
        const data = typeof c.value === "string" ? c.value : "";
        if (data.trim() !== "") el.children.push({ type: "text", data, parent: el });
      } else if (c.type === "JSXElement" || c.type === "JSXFragment") {
        el.children.push(convert(c, el, arm));
      } else if (c.type === "JSXExpressionContainer" || c.type === "JSXSpreadChild") {
        // Keep the raw `{…}` as text (non-empty content for name/empty rules)…
        el.children.push({ type: "text", data: source.slice(c.start ?? 0, c.end ?? 0), parent: el });
        // …and surface any JSX rendered inside the expression as real children, tagged
        // with the conditional arm they came from (so heading-order won't cross arms).
        const nested: Collected[] = [];
        collectJsx(c.expression ?? c, nested, arm, seq);
        for (const j of nested) el.children.push(convert(j.node, el, j.arm));
      }
    }
    return el;
  };

  // Walk the whole program. The first time a JSX node is reached it becomes a
  // root and convert() consumes its whole subtree; visit() then returns without
  // descending, so nested JSX is never re-rooted (the AST is a tree).
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const n = asNode(node);
    if (!n || typeof n.type !== "string") return;
    if (n.type === "JSXElement" || n.type === "JSXFragment") {
      roots.push(convert(n, null));
      return;
    }
    for (const key in n) {
      if (key === "loc" || key === "start" || key === "end" || key === "range" || key === "type") continue;
      visit(n[key]);
    }
  };
  visit(ast.program);

  const opaqueComponents = opaqueLibrarySpecifiers(ast, elements);
  return { file, source, lossy: false, kind: "jsx-ast", roots, elements, byId, lineStarts, ...(opaqueComponents.length ? { opaqueComponents } : {}) };
}

// A specifier resolved from node_modules (a real package), not a relative path or
// a project path-alias (./x, ../x, /x, @/x, ~/x).
function isLibrarySpecifier(spec: string): boolean {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@/") || spec.startsWith("~")) return false;
  if (/^@[a-zA-Z][^/]*\/.+/.test(spec)) return true; // scoped package: @scope/name
  return /^[a-zA-Z]/.test(spec); // bare package: react, lodash…
}

// The library specifiers whose components are actually rendered in this file. Maps
// each used component's head binding (Button, motion in motion.div…) to its import
// source and keeps the bare/library ones.
function opaqueLibrarySpecifiers(ast: AstFile, elements: El[]): string[] {
  const importSrc = new Map<string, string>();
  const body = asNodes((asNode(ast.program) ?? ast).body);
  for (const stmt of body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const source = asNode(stmt.source);
    const spec = source && typeof source.value === "string" ? source.value : "";
    if (!spec) continue;
    for (const s of asNodes(stmt.specifiers)) {
      const local = asNode(s.local);
      if (local && typeof local.name === "string") importSrc.set(local.name, spec);
    }
  }
  const opaque = new Set<string>();
  for (const el of elements) {
    if (isIntrinsic(el.tag) || el.tag === "#fragment") continue;
    const head = el.tag.split(".")[0] ?? el.tag;
    const spec = importSrc.get(head);
    if (spec && isLibrarySpecifier(spec)) opaque.add(spec);
  }
  return [...opaque].sort();
}

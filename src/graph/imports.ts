// Extract a compact, bounded per-file record for the cross-file dependency graph.
// We keep ONLY what cross-file rules need — import bindings, the components a file
// defines and the accessibility-relevant signals of the control each renders, the
// ids it defines, and whether it declares <html lang>. The parsed AST/Doc are
// discarded after extraction, so memory stays O(file count), never whole-repo.
import { type AstNode, type AstFile, asNode, asNodes, walkAst } from "../parse/jsx-ast.js";
import { jsxName, isIntrinsic, normAttrName } from "../parse/jsx-bridge.js";
import type { Doc } from "../parse/html.js";
import { hasAttr, attr } from "../parse/html.js";
import { toPosix } from "../glob.js";

export interface ImportRec {
  source: string; // raw specifier, e.g. "./IconButton"
  local: string; // local binding name
  imported: string; // "default" | "*" | the named export
}

export interface ComponentDef {
  name: string; // declared/export name ("default" for the default export)
  file: string; // posix path of the defining file
  line: number; // 1-based position of the control (or the component) in the file
  col: number;
  // Signals about the primary control (<button>/<a href>) the component renders.
  hasControl: boolean; // the component renders a nameable control (<button>/<a href>)
  rendersIconOnlyControl: boolean; // icon child, no literal text, no literal aria-name
  acceptsName: boolean; // a name could be injected from props (spread / aria expr / {children})
  controlHasName: boolean; // control already bears a literal name (text or literal aria-label) — a passed name prop is dead, not lost
  spreadsProps: boolean; // control has {...props}
  forwardsAria: boolean; // control has aria-label/labelledby set to an expression
}

export interface FileGraphNode {
  file: string; // posix
  imports: ImportRec[];
  components: Map<string, ComponentDef>; // by local/export name, plus a "default" alias
  definesIds: string[]; // literal id="…" anywhere in the file
  providesHtmlLang: boolean; // an <html> with a lang attribute (literal or expression)
  starReexports: string[]; // `export * from "./x"` sources — a name may be defined in any of them
  // Component-LIBRARY specifiers this file renders (e.g. "@codegouvfr/react-dsfr/Button").
  // A non-empty list marks the file as a rendered-output BLIND SPOT for coverage: the
  // real HTML lives in node_modules, so its components need a rendered capture to audit.
  opaqueComponents: string[];
}

const NAME_PROPS = new Set(["aria-label", "aria-labelledby", "title", "label", "alt"]);
const ICON_TAGS = new Set(["svg", "path", "use", "img", "i"]);

function opening(jsxEl: AstNode): AstNode | undefined {
  return asNode(jsxEl.openingElement);
}

function attrName(a: AstNode): string {
  return normAttrName(jsxName(asNode(a.name)));
}

function attrIsExpr(a: AstNode): boolean {
  return asNode(a.value)?.type === "JSXExpressionContainer";
}

function attrIsLiteral(a: AstNode): boolean {
  return asNode(a.value)?.type === "StringLiteral";
}

function controlAttrs(jsxEl: AstNode): AstNode[] {
  const op = opening(jsxEl);
  return op ? asNodes(op.attributes).filter((a) => a.type === "JSXAttribute") : [];
}

function hasSpread(jsxEl: AstNode): boolean {
  const op = opening(jsxEl);
  return op ? asNodes(op.attributes).some((a) => a.type === "JSXSpreadAttribute") : false;
}

function tagOf(jsxEl: AstNode): string {
  const op = opening(jsxEl);
  return op ? jsxName(asNode(op.name)) : "";
}

// Does this JSX element subtree contain a non-whitespace literal text node?
function hasLiteralText(jsxEl: AstNode): boolean {
  let found = false;
  walkAst(jsxEl, (n) => {
    if (n.type === "JSXText" && typeof n.value === "string" && n.value.trim() !== "") found = true;
  });
  return found;
}

// Does the subtree render an icon-ish element (svg/img/i/… or a *Icon component)?
function hasIconChild(jsxEl: AstNode): boolean {
  let found = false;
  walkAst(jsxEl, (n) => {
    if (n.type !== "JSXElement" || n === jsxEl) return;
    const name = tagOf(n);
    const low = name.toLowerCase();
    if (ICON_TAGS.has(low) || /icon|glyph/i.test(name)) found = true;
  });
  return found;
}

// A direct expression child like {children}/{label}/{title} that could carry a name.
function rendersNameExpr(jsxEl: AstNode): boolean {
  for (const c of asNodes(jsxEl.children)) {
    if (c.type !== "JSXExpressionContainer") continue;
    const expr = asNode(c.expression);
    const id = expr && (expr.type === "Identifier" || expr.type === "JSXIdentifier") ? String(expr.name ?? "") : "";
    if (/children|label|title|text|name/i.test(id)) return true;
  }
  return false;
}

// Find the component's primary control: the first intrinsic <button> or <a href>
// anywhere in the function body's JSX.
function findControl(fnNode: AstNode): AstNode | undefined {
  let control: AstNode | undefined;
  walkAst(fnNode, (n) => {
    if (control || n.type !== "JSXElement") return;
    const tag = tagOf(n);
    if (!isIntrinsic(tag)) return;
    const low = tag.toLowerCase();
    if (low === "button") control = n;
    else if (low === "a" && controlAttrs(n).some((a) => attrName(a) === "href")) control = n;
  });
  return control;
}

function posOf(node: AstNode): { line: number; col: number } {
  return { line: node.loc?.start.line ?? 1, col: (node.loc?.start.column ?? 0) + 1 };
}

function analyzeComponent(name: string, file: string, fnNode: AstNode): ComponentDef {
  const control = findControl(fnNode);
  if (!control) {
    const { line, col } = posOf(fnNode);
    return {
      name,
      file,
      line,
      col,
      hasControl: false,
      rendersIconOnlyControl: false,
      acceptsName: false,
      controlHasName: false,
      spreadsProps: false,
      forwardsAria: false,
    };
  }
  const { line, col } = posOf(control);
  const attrs = controlAttrs(control);
  const spreadsProps = hasSpread(control);
  const forwardsAria = attrs.some((a) => (attrName(a) === "aria-label" || attrName(a) === "aria-labelledby") && attrIsExpr(a));
  const literalAriaName = attrs.some((a) => NAME_PROPS.has(attrName(a)) && attrIsLiteral(a));
  const acceptsNameViaChildren = rendersNameExpr(control);
  const acceptsName = spreadsProps || forwardsAria || acceptsNameViaChildren;
  // forwardsAria = the control carries aria-label/aria-labelledby={expr}; literalAriaName =
  // a literal name. Either way the control IS named (the value may be dynamic but is
  // present), so it is NOT an unnamed icon-only control — avoids flagging a self-named
  // icon button like `aria-label={isPlus ? "…" : "…"}`.
  const controlHasName = literalAriaName || forwardsAria || hasLiteralText(control);
  const rendersIconOnlyControl = hasIconChild(control) && !hasLiteralText(control) && !literalAriaName && !forwardsAria;
  return { name, file, line, col, hasControl: true, rendersIconOnlyControl, acceptsName, controlHasName, spreadsProps, forwardsAria };
}

// A .vue/.svelte/.astro SFC has no top-level JS function to declare "the component"
// the way JSX does — the file itself IS the component. Basename → PascalCase, so
// `Comp.vue`/`my-button.svelte` register as `Comp`/`MyButton`, matching how it would
// be imported (`import Comp from "./Comp.vue"`).
function pascalCaseBasename(posix: string): string {
  const base = (posix.split("/").pop() ?? posix).replace(/\.[^.]+$/, "");
  const name = base
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((seg) => seg[0]!.toUpperCase() + seg.slice(1))
    .join("");
  return name || "Component";
}

function isCapitalized(name: string): boolean {
  const head = name.split(".")[0] ?? name;
  const first = head[0] ?? "";
  return first !== "" && first === first.toUpperCase() && first !== first.toLowerCase();
}

function isComponentFn(init: AstNode | undefined): boolean {
  return !!init && (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression" || init.type === "FunctionDeclaration");
}

// Collect component definitions from a top-level declaration node (already unwrapped
// from export wrappers). Returns the entries to register.
function declComponents(decl: AstNode, file: string): ComponentDef[] {
  const out: ComponentDef[] = [];
  if (decl.type === "FunctionDeclaration") {
    const id = asNode(decl.id);
    const name = id && typeof id.name === "string" ? id.name : "";
    if (name && isCapitalized(name)) out.push(analyzeComponent(name, file, decl));
  } else if (decl.type === "VariableDeclaration") {
    for (const d of asNodes(decl.declarations)) {
      const id = asNode(d.id);
      const init = asNode(d.init);
      const name = id && typeof id.name === "string" ? id.name : "";
      if (name && isCapitalized(name) && isComponentFn(init)) out.push(analyzeComponent(name, file, init as AstNode));
    }
  }
  return out;
}

export interface ExtractOpts {
  // .vue/.svelte/.astro: `ast` (when supplied) is the file's <script>/frontmatter
  // block only, parsed just for its imports/re-exports — never a component
  // definition (SFCs don't declare themselves as a JS function). Synthesizes ONE
  // self component def (PascalCase basename) so cross-file resolution AND capture
  // coverage see the SFC, same as a JSX component would be seen.
  sfc?: boolean;
}

export function extractGraphNode(ast: AstFile | null, doc: Doc, file: string, opts: ExtractOpts = {}): FileGraphNode {
  const posix = toPosix(file);
  const imports: ImportRec[] = [];
  const starReexports: string[] = [];
  const components = new Map<string, ComponentDef>();

  // Top-level `const X = "literal"` string bindings, so a dynamic id={X} (common for
  // shared modal/dialog ids) can be resolved to its literal and counted as a defined id
  // — otherwise a cross-file aria-controls="X" reference looks dangling (false NC).
  const constStrings = new Map<string, string>();
  if (ast) {
    for (const stmt of asNodes((asNode(ast.program) ?? ast).body)) {
      const vd = stmt.type === "VariableDeclaration" ? stmt : stmt.type === "ExportNamedDeclaration" ? asNode(stmt.declaration) : undefined;
      if (vd?.type !== "VariableDeclaration") continue;
      for (const d of asNodes(vd.declarations)) {
        const idn = asNode(d.id);
        const init = asNode(d.init);
        if (idn?.type === "Identifier" && typeof idn.name === "string" && init?.type === "StringLiteral" && typeof init.value === "string") {
          constStrings.set(idn.name, init.value);
        }
      }
    }
  }

  // ids + html-lang come from the Doc (works for HTML and JSX alike).
  const definesIds: string[] = [];
  let providesHtmlLang = false;
  for (const el of doc.elements) {
    const id = el.attribs.id;
    if (id && !id.startsWith("{")) definesIds.push(id);
    else if (id) {
      // id={X} → resolve X via a top-level const string binding (conservative).
      const m = /^\{\s*([A-Za-z_$][\w$]*)\s*\}$/.exec(id);
      const resolved = m ? constStrings.get(m[1] as string) : undefined;
      if (resolved) definesIds.push(resolved);
    }
    if (el.tag === "html" && hasAttr(el, "lang") && (attr(el, "lang") ?? "") !== "") providesHtmlLang = true;
  }

  const opaqueComponents = doc.opaqueComponents ?? [];
  const finish = (): FileGraphNode => {
    if (opts.sfc) {
      // The SFC IS the component (no self-declaring JS function to find). `hasControl:
      // true` puts it in the capture-coverage universe unconditionally: its template is
      // never source-analysed for a real control (that would need a Vue/Svelte/Astro
      // template parser, out of scope here), so — like every other preliminary
      // SFC-source verdict — it stays a claimed blind spot until a rendered capture
      // proves otherwise, rather than silently invisible to coverage.
      const name = pascalCaseBasename(posix);
      if (!components.has(name)) {
        const def: ComponentDef = {
          name,
          file: posix,
          line: 1,
          col: 1,
          hasControl: true,
          rendersIconOnlyControl: false,
          acceptsName: false,
          controlHasName: false,
          spreadsProps: false,
          forwardsAria: false,
        };
        components.set(name, def);
        if (!components.has("default")) components.set("default", def);
      }
    }
    return { file: posix, imports, components, definesIds, providesHtmlLang, starReexports, opaqueComponents };
  };
  if (!ast) return finish();

  const body = asNodes((asNode(ast.program) ?? ast).body);
  const register = (def: ComponentDef): void => {
    if (!components.has(def.name)) components.set(def.name, def);
  };

  for (const stmt of body) {
    if (stmt.type === "ImportDeclaration") {
      const source = asNode(stmt.source);
      const spec = source && typeof source.value === "string" ? source.value : "";
      for (const s of asNodes(stmt.specifiers)) {
        const local = asNode(s.local);
        const localName = local && typeof local.name === "string" ? local.name : "";
        if (!localName) continue;
        if (s.type === "ImportDefaultSpecifier") imports.push({ source: spec, local: localName, imported: "default" });
        else if (s.type === "ImportNamespaceSpecifier") imports.push({ source: spec, local: localName, imported: "*" });
        else if (s.type === "ImportSpecifier") {
          const imp = asNode(s.imported);
          const impName = imp && typeof imp.name === "string" ? imp.name : localName;
          imports.push({ source: spec, local: localName, imported: impName });
        }
      }
    } else if (stmt.type === "FunctionDeclaration" || stmt.type === "VariableDeclaration") {
      for (const def of declComponents(stmt, posix)) register(def);
    } else if (stmt.type === "ExportNamedDeclaration") {
      const decl = asNode(stmt.declaration);
      if (decl) for (const def of declComponents(decl, posix)) register(def);
      const src = asNode(stmt.source);
      const reExportSpec = src && typeof src.value === "string" ? src.value : undefined;
      for (const s of asNodes(stmt.specifiers)) {
        const localN = asNode(s.local);
        const exportedN = asNode(s.exported);
        const localName = localN && typeof localN.name === "string" ? localN.name : "";
        const exportedName = exportedN && typeof exportedN.name === "string" ? exportedN.name : "";
        if (reExportSpec) {
          // Barrel re-export: `export { Button } from "./Button"` (optionally aliased).
          // Modeled as an import-like binding under the EXPORTED name — the same shape
          // `resolveUsage` already follows for a real import — so a barrel consumer's
          // `import { Button } from "./components"` resolves one more hop to the real
          // definition, however deep the barrel chain (see resolveUsage's recursion).
          if (exportedName) imports.push({ source: reExportSpec, local: exportedName, imported: localName || exportedName });
          continue;
        }
        // export { Foo as default } / export { Foo } — alias names to existing defs.
        const def = components.get(localName);
        if (def && exportedName && !components.has(exportedName)) components.set(exportedName, def);
      }
    } else if (stmt.type === "ExportAllDeclaration") {
      // `export * from "./x"` — a wildcard barrel. We can't enumerate the re-exported names
      // statically, so record the source; resolveUsage follows each star source when a name
      // is not bound directly (see graph.ts). `export * as NS from …` is a namespace re-export,
      // not a flat wildcard, so it is skipped here.
      const src = asNode(stmt.source);
      const spec = src && typeof src.value === "string" ? src.value : "";
      if (spec && !asNode(stmt.exported)) starReexports.push(spec);
    } else if (stmt.type === "ExportDefaultDeclaration") {
      const decl = asNode(stmt.declaration);
      if (!decl) continue;
      if (decl.type === "FunctionDeclaration") {
        const id = asNode(decl.id);
        const name = id && typeof id.name === "string" ? id.name : "default";
        const def = analyzeComponent(name === "default" ? "default" : name, posix, decl);
        register(def);
        if (!components.has("default")) components.set("default", def);
      } else if (decl.type === "ArrowFunctionExpression" || decl.type === "FunctionExpression") {
        const def = analyzeComponent("default", posix, decl);
        if (!components.has("default")) components.set("default", def);
      } else if (decl.type === "Identifier") {
        const ref = typeof decl.name === "string" ? components.get(decl.name) : undefined;
        if (ref && !components.has("default")) components.set("default", ref);
      }
    }
  }

  return finish();
}

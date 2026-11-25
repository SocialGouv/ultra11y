// SCREEN-READER SIMULATION — what assistive technology is handed, page state by page state.
//
// RGAA themes 7 (scripts) and 11 (forms) ask questions a source reading cannot settle: is the
// disclosure button announced « expanded » once it opened, does the email field come out with a
// name and « invalid » once the form refused it, is the error a status a reader hears. The
// browser already answers them — its accessibility tree is exactly what a screen reader reads —
// so `scan` and `journey run` record that tree beside every capture (`axtree.json`) and derive
// from it, here, the list of announcements a reader would meet in reading order (`sr.json`).
//
// WHAT THIS IS NOT. It is a simulation from the tree the browser computed, never a run of a real
// screen reader: it says what is EXPOSED (role, accessible name, value, description, states),
// not how NVDA or VoiceOver voices it, and it cannot see a reader's own heuristics. So it is
// evidence for the adjudicator and nothing more — no rule reads it, and nothing here can make a
// criterion conformant. A page with no `axtree.json` has no `sr.json`, and its criteria keep
// whatever the rest of the evidence says.
//
// THE JOIN. Every node the tree keeps for a DOM element carries that element's document-order
// ordinal and tag (`i`, `tag`), the same key `styles.json` and `boxes.json` use, computed by
// walking the DOM exactly as ELEMENT_WALK does (src/collector.ts). The reader verifies the tag
// before trusting the ordinal, so a walk that drifted (a `<noscript>` holding markup) costs the
// anchor its element, never attributes one element's announcement to another.
import type { AxNode, SrDigest, SrEntry } from "./types.js";

type Any = any;

/** The most nodes `axtree.json` keeps, and the most announcements `sr.json` lists. Bounded so a
 *  page with an endless feed cannot write a tree nobody can open; each says when it stopped. */
export const AX_MAX_NODES = 6000;
export const SR_MAX_ENTRIES = 2000;

/** Names longer than this are cut: an announcement is a line, not the page's text. */
const NAME_MAX = 200;

/** The raw-text elements ELEMENT_WALK does not descend into — the same set, so the ordinals match. */
const RAW_TEXT = new Set(["script", "style", "title", "textarea", "xmp", "iframe", "noembed", "noframes"]);

interface CdpDomNode {
  nodeType: number;
  nodeName?: string;
  localName?: string;
  backendNodeId: number;
  children?: CdpDomNode[];
  templateContent?: CdpDomNode;
}

interface CdpAxValue {
  type?: string;
  value?: unknown;
}

interface CdpAxNode {
  nodeId: string;
  ignored?: boolean;
  role?: CdpAxValue;
  name?: CdpAxValue;
  description?: CdpAxValue;
  value?: CdpAxValue;
  properties?: { name: string; value?: CdpAxValue }[];
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

/** backendNodeId → { ordinal, tag }, by the ELEMENT_WALK order. Undefined when the walk met a
 *  `<noscript>` whose text the browser holds as markup: ELEMENT_WALK re-parses that text, CDP
 *  cannot, and every ordinal after it would be off — so none is given. */
export function ordinalsOf(root: CdpDomNode): Map<number, { i: number; tag: string }> | undefined {
  const out = new Map<number, { i: number; tag: string }>();
  let i = 0;
  let drift = false;
  const walk = (parent: CdpDomNode): void => {
    for (const child of parent.children ?? []) {
      if (drift) return;
      if (child.nodeType !== 1) continue;
      const tag = (child.localName || child.nodeName || "").toLowerCase();
      out.set(child.backendNodeId, { i: i++, tag });
      if (RAW_TEXT.has(tag)) continue;
      if (tag === "noscript") {
        const hasElement = (child.children ?? []).some((c) => c.nodeType === 1);
        const text = (child.children ?? []).some((c) => c.nodeType === 3 && /</.test(String((c as { nodeValue?: string }).nodeValue ?? "")));
        if (!hasElement && text) {
          drift = true;
          return;
        }
      }
      walk(tag === "template" && child.templateContent ? child.templateContent : child);
    }
  };
  walk(root);
  return drift ? undefined : out;
}

const str = (v: CdpAxValue | undefined): string => (v?.value === undefined || v.value === null ? "" : String(v.value));
const clip = (s: string): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > NAME_MAX ? `${t.slice(0, NAME_MAX - 1)}…` : t;
};

/** The states a node exposes, as announcement tokens. `focused` is left out on purpose: it is
 *  where the capture's own focus happened to be, not a property of the page. */
function statesOf(props: CdpAxNode["properties"]): { states: string[]; level?: number; disabled?: boolean; focusable?: boolean } {
  const states: string[] = [];
  let level: number | undefined;
  let disabled: boolean | undefined;
  let focusable: boolean | undefined;
  for (const p of props ?? []) {
    const v = p.value?.value;
    switch (p.name) {
      case "level":
        if (typeof v === "number") level = v;
        break;
      case "disabled":
        if (v === true) {
          disabled = true;
          states.push("disabled");
        }
        break;
      case "focusable":
        if (v === true) focusable = true;
        break;
      case "checked":
        states.push(v === "mixed" ? "mixed" : v === "true" || v === true ? "checked" : "not checked");
        break;
      case "pressed":
        states.push(v === "mixed" ? "mixed" : v === "true" || v === true ? "pressed" : "not pressed");
        break;
      case "expanded":
        states.push(v === true || v === "true" ? "expanded" : "collapsed");
        break;
      case "selected":
        if (v === true || v === "true") states.push("selected");
        break;
      case "invalid":
        if (v !== "false" && v !== false && v !== undefined) states.push(v === "true" || v === true ? "invalid" : `invalid=${String(v)}`);
        break;
      case "required":
      case "readonly":
      case "multiselectable":
      case "modal":
      case "busy":
      case "atomic":
        if (v === true || v === "true") states.push(p.name);
        break;
      case "haspopup":
      case "live":
      case "autocomplete":
      case "orientation":
      case "roledescription":
      case "current":
        if (v !== undefined && v !== "" && v !== "false" && v !== false && v !== "off") states.push(`${p.name}=${String(v)}`);
        break;
      default:
        break;
    }
  }
  return { states, ...(level !== undefined ? { level } : {}), ...(disabled ? { disabled } : {}), ...(focusable ? { focusable } : {}) };
}

/** Nodes the tree keeps no node for: their children are hoisted into the parent. */
const DROPPED_ROLES = new Set(["InlineTextBox", "LineBreak"]);
/** Containers that say nothing of their own: hoisted when they carry no name and no state. */
const SILENT_ROLES = new Set(["generic", "none", "presentation", "LayoutTable", "LayoutTableRow", "LayoutTableCell", "Section", "Ignored"]);

/** Build the compact tree `axtree.json` holds from CDP's flat node list. Ignored nodes and silent
 *  containers are hoisted out; every kept node for an element carries its ordinal. */
export function buildAxTree(nodes: CdpAxNode[], ordinals?: Map<number, { i: number; tag: string }>): AxNode | undefined {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const root = nodes.find((n) => n.parentId === undefined) ?? nodes[0];
  if (!root) return undefined;
  let kept = 0;
  const seen = new Set<string>();
  const convert = (n: CdpAxNode): AxNode[] => {
    if (seen.has(n.nodeId)) return [];
    seen.add(n.nodeId);
    const kids = (): AxNode[] => (n.childIds ?? []).flatMap((id) => (byId.has(id) && kept < AX_MAX_NODES ? convert(byId.get(id)!) : []));
    const role = str(n.role);
    if (n.ignored || DROPPED_ROLES.has(role)) return kids();
    const { states, level, disabled, focusable } = statesOf(n.properties);
    const name = clip(str(n.name));
    if (SILENT_ROLES.has(role) && !name && !states.length) return kids();
    if (kept >= AX_MAX_NODES) return [];
    kept++;
    const join = n.backendDOMNodeId !== undefined ? ordinals?.get(n.backendDOMNodeId) : undefined;
    const value = clip(str(n.value));
    const description = clip(str(n.description));
    const children = kids();
    return [
      {
        role,
        ...(name ? { name } : {}),
        ...(value ? { value } : {}),
        ...(description ? { description } : {}),
        ...(level !== undefined ? { level } : {}),
        ...(disabled ? { disabled } : {}),
        ...(focusable ? { focusable } : {}),
        ...(states.length ? { states } : {}),
        ...(join ? { i: join.i, tag: join.tag } : {}),
        ...(children.length ? { children } : {}),
      },
    ];
  };
  const out = convert(root);
  return out[0];
}

/** Read the page's accessibility tree from Chromium, joined to the DOM ordinals. Undefined when
 *  the browser offers no CDP session (not Chromium) or the read failed — the capture then simply
 *  carries no `axtree.json`, which is a statement of its own: nothing was announced, because
 *  nothing was read. */
export async function captureAxTree(page: Any): Promise<AxNode | undefined> {
  let client: Any;
  try {
    client = await page.context().newCDPSession(page);
  } catch {
    return undefined;
  }
  try {
    const { nodes } = (await client.send("Accessibility.getFullAXTree")) as { nodes: CdpAxNode[] };
    let ordinals: Map<number, { i: number; tag: string }> | undefined;
    try {
      const { root } = (await client.send("DOM.getDocument", { depth: -1, pierce: false })) as { root: CdpDomNode };
      ordinals = ordinalsOf(root);
    } catch {
      /* the announcements stand without their elements */
    }
    return buildAxTree(nodes, ordinals);
  } catch {
    return undefined;
  } finally {
    await client.detach().catch(() => {});
  }
}

/** Roles whose accessible name is computed from their content: the text inside them is already
 *  in their announcement, so it is not listed again under them. */
const NAME_FROM_CONTENT = new Set([
  "link",
  "button",
  "heading",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "option",
  "treeitem",
  "checkbox",
  "radio",
  "switch",
  "cell",
  "gridcell",
  "columnheader",
  "rowheader",
  "tooltip",
  "LabelText",
  "legend",
  "caption",
  "figcaption",
  "term",
  "code",
]);

/** Text roles a reader speaks as text, without a role word. */
const TEXT_ROLES = new Set(["StaticText", "text"]);

/** Containers a reader passes through silently in browse mode. */
const QUIET = new Set(["RootWebArea", "WebArea", "generic", "none", "presentation", "paragraph", "LabelText", "Section", "div"]);

function line(n: AxNode): string {
  const role = n.role ?? "";
  const name = n.name ?? "";
  if (TEXT_ROLES.has(role)) return `"${name}"`;
  const head = role === "heading" && n.level !== undefined ? `heading level ${n.level}` : role;
  const parts = [`${head}${name ? ` "${name}"` : ""}`];
  if (n.value) parts[0] += ` = "${n.value}"`;
  parts.push(...(n.states ?? []));
  return `${parts.join(", ")}${n.description ? ` — "${n.description}"` : ""}`;
}

/** What a screen reader would announce, in reading order, from a captured tree alone. */
export function announce(tree: AxNode | undefined): SrDigest {
  const entries: SrEntry[] = [];
  let truncated = false;
  const visit = (n: AxNode, inNamed: boolean): void => {
    if (entries.length >= SR_MAX_ENTRIES) {
      truncated = true;
      return;
    }
    const role = n.role ?? "";
    const name = n.name ?? "";
    const isText = TEXT_ROLES.has(role);
    const speak = isText ? !inNamed && name !== "" : !QUIET.has(role) || (n.states?.length ?? 0) > 0;
    if (speak)
      entries.push({
        role: isText ? "text" : role,
        name,
        ...(n.value ? { value: n.value } : {}),
        ...(n.description ? { description: n.description } : {}),
        states: [...(n.states ?? [])],
        text: line(n),
        ...(n.i !== undefined && n.tag ? { i: n.i, tag: n.tag } : {}),
      });
    // A field speaks its own value: the text inside a textarea or a contenteditable box is not
    // read a second time under it.
    const named = inNamed || (NAME_FROM_CONTENT.has(role) && name !== "") || SR_FIELD_ROLES.has(role);
    for (const c of n.children ?? []) visit(c, named);
  };
  if (tree) visit(tree, false);
  return { v: 1, entries, ...(truncated ? { truncated } : {}) };
}

/** Roles of a form field, as the accessibility tree names them. */
export const SR_FIELD_ROLES = new Set(["textbox", "searchbox", "combobox", "listbox", "checkbox", "radio", "switch", "slider", "spinbutton", "TextField"]);
/** Roles of a scripted widget a reader operates (RGAA 7.1, 7.3). */
export const SR_WIDGET_ROLES = new Set([
  "button",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "tablist",
  "tabpanel",
  "tree",
  "treeitem",
  "dialog",
  "alertdialog",
  "grid",
  "toolbar",
  "disclosure-triangle",
  "DisclosureTriangle",
]);
/** Roles and states a reader hears without moving to them (RGAA 7.5). */
export const SR_LIVE_ROLES = new Set(["status", "alert", "log", "marquee", "timer", "progressbar"]);
/** States that only a script keeps in step with what the page shows. */
export const SR_SCRIPTED_STATES = /^(?:expanded|collapsed|pressed|not pressed|checked|not checked|mixed|selected|haspopup=|current=|busy)/;

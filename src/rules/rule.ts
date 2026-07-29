// Rule contract + helpers shared by every rule module and the registry.
// Kept dependency-light (no value import of the registry) to avoid cycles.
import type { Doc, El } from "../parse/html.js";
import type { Finding, Severity } from "../types.js";
import { snippet, textContent, elementsByTag } from "../parse/html.js";
import { MSG_CATALOG, type MsgParams } from "../messages.js";

// A build-time / runtime content-injection placeholder left in a framework SHELL
// template (SvelteKit `%sveltekit.body%`, Mustache/Vue `{{ }}`, EJS/ERB `<% %>`,
// Jinja/Liquid `{% %}`, Razor `@RenderBody()`). Their real markup is injected later.
const INJECT_MARKER = /%[a-zA-Z][\w.]*%|\{\{[\s\S]*?\}\}|<%[-=]?[\s\S]*?%>|\{%[\s\S]*?%\}|@RenderBody\b/;
// SPA mount-point ids: an EMPTY element with one of these ids is a shell, not content.
const MOUNT_IDS = new Set(["app", "root", "__next", "__nuxt", "svelte", "q-app", "app-root", "___gatsby"]);

/** The document body is a framework shell whose real content (incl. any <h1>) is
 *  injected at build/runtime — a placeholder marker, or an empty SPA mount point. */
export function shellBodyInjected(doc: Doc): boolean {
  const region = elementsByTag(doc, "body")[0] ?? elementsByTag(doc, "html")[0];
  if (!region) return false;
  if (INJECT_MARKER.test(textContent(region))) return true;
  return doc.elements.some(
    (el) => MOUNT_IDS.has((el.attribs.id ?? "").toLowerCase()) && !el.children.some((c) => (c.type === "element" ? c.tag !== "script" : c.data.trim() !== "")),
  );
}

/** The document <head> injects its <title> via a framework placeholder
 *  (e.g. SvelteKit `%sveltekit.head%`, `<%= title %>`, `{{ title }}`). */
export function shellHeadInjected(doc: Doc): boolean {
  const head = elementsByTag(doc, "head")[0];
  return !!head && INJECT_MARKER.test(textContent(head));
}

export interface RuleFinding {
  /** the specific WCAG success criterion this finding evidences (e.g. "1.4.3") */
  criteriaId: string;
  /** element the finding is anchored to (for line/col/snippet/selector) */
  el: El;
  /** catalog key into MSG_CATALOG (src/messages.ts) — a rule id, or "<ruleId>.<variant>"
   *  when the rule has more than one distinct message shape. */
  msgId: string;
  /** language-neutral data interpolated into the catalog templates (tag names, attribute
   *  values, counts, ids, small enums…) — never a pre-rendered phrase. */
  params?: MsgParams;
  severity?: Severity; // override the rule default
  selectorHint?: string; // override the derived selector
  preliminary?: boolean; // provisional finding (target/name may resolve at composition/runtime)
  // Per-finding override of the rule-level `advisory` flag (finding-level wins). A rule
  // may be normative overall yet mark an individual finding as a non-normative
  // recommendation, or vice-versa. Absent ⇒ inherit the rule's `advisory`.
  advisory?: boolean;
}

export interface Rule {
  id: string;
  /** every WCAG success criterion this rule may contribute to (registry cross-check) */
  criteria: string[];
  severity: Severity; // default severity for findings
  /** "page" rules only run on a full document (skip fragments/components) */
  scope?: "page" | "any";
  // When true, EVERY finding this rule raises is a non-normative recommendation
  // (Finding.advisory) unless a RuleFinding overrides it — it can never flip a criterion
  // to NC. Absent ⇒ normative. See src/rules/headings.ts (h1-missing / h1-multiple).
  advisory?: boolean;
  run(doc: Doc): RuleFinding[];
}

/** A full document has an <html> element; fragments/JSX components do not. */
export function isFullDocument(doc: Doc): boolean {
  return doc.elements.some((e) => e.tag === "html");
}

/** A short, human CSS-ish selector to locate the element in source. */
export function selectorOf(el: El): string {
  const id = el.attribs.id;
  if (id) return `${el.tag}#${id}`;
  const type = el.attribs.type;
  if (type && (el.tag === "input" || el.tag === "button")) return `${el.tag}[type=${type}]`;
  const cls = el.attribs.class;
  if (cls) return `${el.tag}.${cls.trim().split(/\s+/)[0]}`;
  if (el.tag === "a" && el.attribs.href) {
    const h = el.attribs.href!;
    return `a[href=${h.length > 30 ? h.slice(0, 30) + "…" : h}]`;
  }
  return el.tag;
}

export function toFinding(doc: Doc, ruleId: string, def: Severity, rf: RuleFinding, ruleAdvisory?: boolean): Finding {
  const entry = MSG_CATALOG[rf.msgId];
  if (!entry) {
    throw new Error(`toFinding: msgId "${rf.msgId}" (rule "${ruleId}") is not in MSG_CATALOG — add it to src/messages.ts.`);
  }
  const params = rf.params ?? {};
  return {
    ruleId,
    criteriaId: rf.criteriaId,
    file: doc.file,
    line: rf.el.line,
    col: rf.el.col,
    selectorHint: rf.selectorHint ?? selectorOf(rf.el),
    severity: rf.severity ?? def,
    message: entry.message.en(params),
    remediation: entry.remediation.en(params),
    msg: rf.params ? { id: rf.msgId, params: rf.params } : { id: rf.msgId },
    snippet: snippet(doc, rf.el),
    // Only carry source offsets when they index into the *real* file. For lossy
    // JSX/TSX the offsets are into the transformed HTML string, so `fix` must not
    // edit by range and baseline diffing falls back to line/selector identity.
    ...(doc.lossy ? {} : { sourceStart: rf.el.start, sourceEnd: rf.el.end }),
    // SFC-source findings are preliminary (slot/dynamic content unseen); lossy-JSX findings
    // are too (regex fallback — offsets into transformed HTML, may be fabricated from string
    // literals) — flag both for AI/human verification. A rule may also mark an individual
    // finding preliminary (e.g. a skip-link whose target lives in another component).
    ...(doc.kind === "sfc" || doc.kind === "jsx-lossy" || rf.preliminary ? { preliminary: true } : {}),
    // Capture findings are rendered ground truth (NOT preliminary): re-attribute them
    // to the source component recorded in the capture's provenance.
    ...(doc.capture ? { origin: { capture: doc.file, sourceFile: doc.capture.sourceFile, component: doc.capture.component } } : {}),
    // A PAGE snapshot's capture carries which page it is; stamp it so the per-page grid can
    // key on the finding directly (src/pages.ts). Component captures carry no page.
    ...(doc.capture?.page ? { page: doc.capture.page } : {}),
    // Non-normative recommendation: the per-finding override (rf.advisory) wins over the
    // rule-level default (ruleAdvisory); only stamp the flag when it is actually true, so
    // a normative finding stays byte-identical (no `advisory: false` noise in the JSON).
    ...((rf.advisory ?? ruleAdvisory) ? { advisory: true } : {}),
  };
}

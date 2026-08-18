// WHAT THE ADJUDICATOR IS SHOWN — the subjects, and the content classes they collapse to.
//
// A criterion the engine cannot decide is handed to an agent with the evidence it must rule
// against. Two properties decide whether that verdict is worth anything, and this module owns
// both.
//
// 1. AIM. Evidence used to be the union of the harvesters of a criterion's mapped success
//    criteria, taken in `pc.wcag` order and then cut to a fixed cap. Measured on a real audit:
//    RGAA 11.1 (are form fields labelled?) maps [1.3.1, 2.4.6, 3.3.2, 4.1.2], the 1.3.1
//    harvest filled every slot with headings and lists, and the control harvest — the actual
//    SUBJECT of 11.1 — never appeared. 9.2 (landmarks) and 5.8 (layout tables) received the
//    very same thirty headings. Those three are exactly the criteria a real run had refused
//    for a "fabricated" citation: the agent had opened the right file and cited the right
//    element, and the evidence set simply did not contain the subject. So a criterion names
//    its SUBJECTS, and a pack criterion may name its own (`PACK_SUBJECTS`) rather than
//    inherit a union that is aimed elsewhere.
//
// 2. COMPLETENESS. A cap over raw anchors is a sample, and a `C` over a sample is a claim
//    about a population nobody looked at — measured, 30 of 2652 anchors for 11.1, and not one
//    of them from a rendered page. But a population is only large when counted as
//    occurrences: 887 links across 38 captured pages are 97 distinct (text, href) pairs, and
//    47 images are 8 distinct (alt, src) pairs. So every subject declares the CONTENT CLASS
//    an anchor belongs to, the harvest collapses to one representative per class, and the
//    occurrence count travels with it. What the agent reads is then the whole population,
//    expressed once per distinct thing.
import { type Doc, type El, ancestors, attr, elementsByTag, snippet as elSnippet, textContent } from "./parse/html.js";
import { parseInlineStyle } from "./color.js";
import type { Evidence } from "./adjudicate.js";

/** One harvested anchor, plus the content class it belongs to. Two anchors sharing a class
 *  are the same thing rendered twice — a header link on 38 pages, not 38 link problems. */
export interface Harvested {
  ev: Evidence;
  cls: string;
  /** Source offset of the anchor. Identity, not output: `file:line:selector` is NOT unique —
   *  forty links minified onto one line share all three — so de-duplicating on it silently
   *  collapsed distinct elements into one and undercounted every population that came from a
   *  single-line document. */
  at: number;
}

export type Subject = (docs: Doc[]) => Harvested[];

const selectorFor = (el: El): string => {
  const id = el.attribs.id ? `#${el.attribs.id}` : "";
  const cls = el.attribs.class ? `.${el.attribs.class.trim().split(/\s+/)[0]}` : "";
  return `${el.tag}${id}${cls}`;
};

/** An anchor on an element. `cls` is the content identity; when omitted the note is used,
 *  which is right for every subject whose note already spells out what makes it distinct. */
function h(doc: Doc, el: El, note: string, cls?: string): Harvested {
  return {
    ev: { file: doc.file, line: el.line, selector: selectorFor(el), snippet: elSnippet(doc, el, 160), note },
    cls: cls ?? `${el.tag}|${note}`,
    at: el.start,
  };
}

/** A document-level anchor, for signals that have no element to hang on (a source import, a
 *  stylesheet rule, a doctype). Anchored at a real line so grounding can still resolve it. */
function hAt(doc: Doc, line: number, selector: string, note: string, cls: string): Harvested {
  return {
    ev: { file: doc.file, line, selector, snippet: (doc.source.split("\n")[line - 1] ?? "").trim().slice(0, 160), note },
    cls,
    at: line,
  };
}

/** A stylesheet rule's declarations as one readable line — the agent judges the rule, so it
 *  must see what the rule actually says. */
const declsText = (decls: Record<string, string>): string =>
  Object.entries(decls)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ")
    .slice(0, 100);

const t = (el: El, n = 60): string => textContent(el).trim().replace(/\s+/g, " ").slice(0, n);

/** Nearest preceding heading text — the context a link/control is read in. */
function nearestHeading(doc: Doc, el: El): string | undefined {
  const headings = elementsByTag(doc, "h1", "h2", "h3", "h4", "h5", "h6").filter((x) => x.start < el.start);
  const last = headings[headings.length - 1];
  return last ? t(last, 80) : undefined;
}

/** First source line matching `re`, or undefined. Used by the source-signal subjects, whose
 *  subject matter is an API call rather than an element. */
function lineOf(doc: Doc, re: RegExp): number | undefined {
  const m = re.exec(doc.source);
  return m ? doc.source.slice(0, m.index).split("\n").length : undefined;
}

/** Every source line matching `re` (global), capped so one minified bundle cannot flood a
 *  worklist. The cap is on ANCHORS, never on classes — see the module header. */
function linesOf(doc: Doc, re: RegExp, cap = 200): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = g.exec(doc.source)) && out.length < cap) {
    const line = doc.source.slice(0, m.index).split("\n").length;
    out.push({ line, text: (doc.source.split("\n")[line - 1] ?? "").trim().slice(0, 120) });
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  return out;
}

// Key/value display patterns (RGAA 8.9 div-presented fields / 9.3 <dl> semantics).
const LABEL_LIKE = /(^|[-_ ])(field-label|field-key|label|key|term)([-_ ]|$)/i;
const VALUE_LIKE = /(^|[-_ ])(field-value|field-data|value|data)([-_ ]|$)/i;
function keyValuePairs(doc: Doc): { key: El; label: string; value: string }[] {
  const out: { key: El; label: string; value: string }[] = [];
  for (const el of doc.elements) {
    const isDt = el.tag === "dt";
    const isLabelDiv = el.tag !== "label" && el.tag !== "dt" && LABEL_LIKE.test(attr(el, "class") ?? "");
    if (!isDt && !isLabelDiv) continue;
    const parent = el.parent;
    if (!parent) continue;
    const sibs = parent.children.filter((c): c is El => c.type === "element");
    const next = sibs[sibs.indexOf(el) + 1];
    if (!next) continue;
    const paired = isDt ? next.tag === "dd" : VALUE_LIKE.test(attr(next, "class") ?? "");
    if (!paired) continue;
    out.push({ key: el, label: t(el, 40), value: t(next, 40) });
  }
  return out;
}

const DOWNLOAD_HREF = /\.(pdf|docx?|xlsx?)(?:[?#]|$)/i;
const STATUS_CLASS = /(error|status|message|alert|notif|toast|feedback|live)/i;
const ROUTER_IMPORT =
  /['"](?:react-router(?:-dom)?|next\/(?:router|navigation)|vue-router|@remix-run\/[\w-]+|@tanstack\/[\w-]*router|@sveltejs\/kit|\$app\/(?:navigation|stores))['"]/;

// Words that MIGHT signal a passage in another language on a French-language interface. A
// lead for the agent, never a finding: the decision protocol exempts proper nouns, technical
// terms and borrowings in common use, and half of these are all three.
const FOREIGN_LEXICON =
  /\b(?:the|and|with|your|about|please|download|settings|welcome|dashboard|overview|read more|learn more|sign in|sign up|log in|get started|coming soon|powered by)\b/i;

const CONTROL_TAGS = ["input", "select", "textarea"] as const;
const INTERACTIVE_TAGS = ["a", "button", "input", "select", "textarea", "summary", "details", "label"];

function labelFor(doc: Doc, el: El): string {
  const id = attr(el, "id");
  const lbl = id ? elementsByTag(doc, "label").find((l) => attr(l, "for") === id) : undefined;
  if (lbl) return t(lbl, 40);
  const wrapping = ancestors(el).find((a) => a.tag === "label");
  return wrapping ? t(wrapping, 40) : "";
}

/** The page a snapshot document belongs to (`.ultra11y/pages/<id>/dom.html`), else undefined
 *  for a source file. Carried on the evidence so a class can say WHERE it appears. */
export function pageOfDoc(file: string): string | undefined {
  const m = /(?:^|\/)\.ultra11y\/pages\/([^/]+)\//.exec(file.replace(/\\/g, "/"));
  return m ? m[1] : undefined;
}

export const isSnapshotFile = (file: string): boolean => pageOfDoc(file) !== undefined;

// ---- the subjects -------------------------------------------------------------------------

export const SUBJECTS: Record<string, Subject> = {
  // Every image-like element and the alternative it carries. Class = (alt, src): the same
  // logo on 38 pages is one decision, not 38.
  images: (docs) =>
    docs.flatMap((d) =>
      elementsByTag(d, "img", "svg", "area", "object", "embed", "canvas")
        .concat(d.elements.filter((e) => attr(e, "role") === "img"))
        .filter((e, i, a) => a.indexOf(e) === i)
        .map((e) =>
          h(
            d,
            e,
            `<${e.tag}> alt="${attr(e, "alt") ?? ""}" aria-label="${attr(e, "aria-label") ?? ""}" src="${(attr(e, "src") ?? "").slice(0, 80)}"`,
            `image|${e.tag}|${attr(e, "alt") ?? ""}|${attr(e, "aria-label") ?? ""}|${attr(e, "src") ?? ""}`,
          ),
        ),
    ),

  // Links: text + destination + the heading they are read under. Class = (text, href).
  links: (docs) =>
    docs.flatMap((d) =>
      elementsByTag(d, "a")
        .filter((e) => attr(e, "href") !== undefined)
        .map((e) => {
          const href = attr(e, "href") ?? "";
          const dl = DOWNLOAD_HREF.exec(href);
          const note = dl ? ` download-format=${dl[1]!.toLowerCase()} (naming the format, e.g. "(PDF)", is a recommendation — not an NC)` : "";
          return h(d, e, `text="${t(e)}" href="${href}" under="${nearestHeading(d, e) ?? ""}"${note}`, `link|${t(e)}|${href}`);
        }),
    ),

  // Literal inline colour pairs — the statically visible subset of contrast.
  colourPairs: (docs) =>
    docs.flatMap((d) =>
      d.elements
        .filter((e) => {
          const st = parseInlineStyle(attr(e, "style") ?? "");
          return st.has("color") || st.has("background-color") || st.has("background");
        })
        .map((e) => {
          const st = parseInlineStyle(attr(e, "style") ?? "");
          const fg = st.get("color") ?? "?";
          const bg = st.get("background-color") ?? st.get("background") ?? "?";
          return h(d, e, `color=${fg} background=${bg}`, `colour|${fg}|${bg}`);
        }),
    ),

  // Headings, labels, legends and captions — the text judged for descriptiveness.
  headings: (docs) =>
    docs.flatMap((d) =>
      elementsByTag(d, "h1", "h2", "h3", "h4", "h5", "h6", "label", "legend", "caption").map((e) =>
        h(d, e, `<${e.tag}> text="${t(e)}"`, `heading|${e.tag}|${t(e)}`),
      ),
    ),

  // Form controls and the label/placeholder/instruction attached to them.
  controls: (docs) =>
    docs.flatMap((d) =>
      elementsByTag(d, ...CONTROL_TAGS).map((e) =>
        h(
          d,
          e,
          `<${e.tag}${attr(e, "type") ? ` type="${attr(e, "type")}"` : ""}> label="${labelFor(d, e)}" placeholder="${attr(e, "placeholder") ?? ""}" aria-label="${attr(e, "aria-label") ?? ""}" required=${attr(e, "required") !== undefined} describedby="${attr(e, "aria-describedby") ?? ""}"`,
          `control|${e.tag}|${attr(e, "type") ?? ""}|${labelFor(d, e)}|${attr(e, "name") ?? ""}`,
        ),
      ),
    ),

  // The `autocomplete` token a field carries — the subject of "identify input purpose".
  autocomplete: (docs) =>
    docs.flatMap((d) =>
      elementsByTag(d, ...CONTROL_TAGS).map((e) =>
        h(
          d,
          e,
          `<${e.tag} type="${attr(e, "type") ?? ""}" name="${attr(e, "name") ?? ""}"> autocomplete="${attr(e, "autocomplete") ?? ""}" — does this field collect data ABOUT THE USER?`,
          `autocomplete|${attr(e, "type") ?? ""}|${attr(e, "name") ?? ""}|${attr(e, "autocomplete") ?? ""}`,
        ),
      ),
    ),

  // Error messaging and its association with the offending field.
  errors: (docs) =>
    docs.flatMap((d) => [
      ...d.elements
        .filter((e) => attr(e, "aria-invalid") !== undefined || attr(e, "aria-errormessage") !== undefined)
        .map((e) =>
          h(
            d,
            e,
            `aria-invalid="${attr(e, "aria-invalid") ?? ""}" aria-errormessage="${attr(e, "aria-errormessage") ?? ""}" aria-describedby="${attr(e, "aria-describedby") ?? ""}"`,
            `errorstate|${attr(e, "aria-invalid") ?? ""}|${attr(e, "aria-errormessage") ?? ""}`,
          ),
        ),
      ...d.elements
        .filter((e) => STATUS_CLASS.test(attr(e, "class") ?? "") && ancestors(e).some((a) => a.tag === "form"))
        .map((e) => h(d, e, `error/status text in a form: "${t(e, 60)}"`, `errortext|${t(e, 60)}`)),
    ]),

  // Structure conveyed by markup: the outline, tables, lists, and div-presented pairs.
  structure: (docs) =>
    docs.flatMap((d) => [
      ...elementsByTag(d, "h1", "h2", "h3", "h4", "h5", "h6", "table", "ul", "ol", "dl").map((e) =>
        h(d, e, `<${e.tag}> "${t(e, 50)}"`, `structure|${e.tag}|${t(e, 50)}`),
      ),
      ...keyValuePairs(d).map((p) =>
        h(
          d,
          p.key,
          `key/value pair — label="${p.label}" value="${p.value}" (div-presented field? verify the relationship isn't only visual — RGAA 8.9/9.3)`,
          `kv|${p.label}|${p.value}`,
        ),
      ),
    ]),

  // Tables, with the parts that decide whether they are data or layout.
  tables: (docs) =>
    docs.flatMap((d) =>
      elementsByTag(d, "table").map((e) => {
        const caption = elementsByTag(d, "caption").find((c) => ancestors(c)[0] === e);
        const ths = elementsByTag(d, "th").filter((x) => ancestors(x).includes(e));
        return h(
          d,
          e,
          `<table> caption="${caption ? t(caption, 40) : ""}" role="${attr(e, "role") ?? ""}" th=${ths.length} summary="${attr(e, "summary") ?? ""}" — data table or layout?`,
          `table|${caption ? t(caption, 40) : ""}|${ths.length}|${attr(e, "role") ?? ""}`,
        );
      }),
    ),

  // Lists and definition lists, for the technique-consistency question.
  lists: (docs) =>
    docs.flatMap((d) =>
      elementsByTag(d, "ul", "ol", "dl").map((e) => {
        const items = e.children.filter((c): c is El => c.type === "element").length;
        return h(d, e, `<${e.tag}> items=${items} first="${t(e, 40)}"`, `list|${e.tag}|${items}|${t(e, 40)}`);
      }),
    ),

  // Landmarks and the navigation structure that lets a user bypass repeated blocks.
  landmarks: (docs) =>
    docs.flatMap((d) => [
      ...elementsByTag(d, "header", "nav", "main", "footer", "aside", "form", "section")
        .concat(d.elements.filter((e) => ["banner", "navigation", "main", "contentinfo", "complementary", "search", "region"].includes(attr(e, "role") ?? "")))
        .filter((e, i, a) => a.indexOf(e) === i)
        .map((e) =>
          h(
            d,
            e,
            `<${e.tag}> role="${attr(e, "role") ?? ""}" aria-label="${attr(e, "aria-label") ?? ""}" aria-labelledby="${attr(e, "aria-labelledby") ?? ""}"`,
            `landmark|${e.tag}|${attr(e, "role") ?? ""}|${attr(e, "aria-label") ?? ""}`,
          ),
        ),
      ...elementsByTag(d, "a")
        .filter((e) => (attr(e, "href") ?? "").startsWith("#"))
        .map((e) => h(d, e, `in-page link (skip link?) text="${t(e, 40)}" href="${attr(e, "href")}"`, `skiplink|${t(e, 40)}|${attr(e, "href")}`)),
    ]),

  // Every mechanism that leads to a page — the subject of "multiple ways".
  navMechanisms: (docs) =>
    docs.flatMap((d) => [
      ...elementsByTag(d, "nav").map((e) =>
        h(
          d,
          e,
          `<nav> aria-label="${attr(e, "aria-label") ?? ""}" links=${elementsByTag(d, "a").filter((a) => ancestors(a).includes(e)).length}`,
          `nav|${attr(e, "aria-label") ?? ""}`,
        ),
      ),
      ...elementsByTag(d, ...CONTROL_TAGS)
        .filter(
          (e) => (attr(e, "type") ?? "") === "search" || /search|recherch/i.test(`${attr(e, "name") ?? ""} ${attr(e, "id") ?? ""} ${attr(e, "class") ?? ""}`),
        )
        .map((e) => h(d, e, `search field — one of the "multiple ways" mechanisms`, `search|${attr(e, "name") ?? ""}`)),
      ...elementsByTag(d, "a")
        .filter((e) => /plan-du-site|sitemap|site-map|index/i.test(attr(e, "href") ?? ""))
        .map((e) => h(d, e, `site map / index link text="${t(e, 40)}" href="${attr(e, "href")}"`, `sitemap|${attr(e, "href")}`)),
    ]),

  // The repeated blocks whose ORDER must not change from page to page. One class per page so
  // "same relative order everywhere" is answerable from the evidence itself.
  repeatedBlocks: (docs) =>
    docs.flatMap((d) => {
      const page = pageOfDoc(d.file) ?? "source";
      return elementsByTag(d, "header", "nav", "footer").map((e) => {
        const order = elementsByTag(d, "a")
          .filter((a) => ancestors(a).includes(e))
          .map((a) => t(a, 24))
          .slice(0, 20)
          .join(" › ");
        return h(d, e, `page="${page}" <${e.tag}> order: ${order}`, `repeated|${page}|${e.tag}`);
      });
    }),

  // Elements whose ARIA name, role or state is authored rather than native.
  aria: (docs) =>
    docs.flatMap((d) =>
      d.elements
        .filter((e) => attr(e, "role") !== undefined || Object.keys(e.attribs).some((k) => k.startsWith("aria-")))
        .map((e) => {
          const ariaKeys = Object.keys(e.attribs)
            .filter((k) => k.startsWith("aria-"))
            .sort()
            .join(",");
          return h(d, e, `<${e.tag}> role="${attr(e, "role") ?? ""}" ${ariaKeys}`, `aria|${e.tag}|${attr(e, "role") ?? ""}|${ariaKeys}`);
        }),
    ),

  // Live regions and the async feedback that must reach them.
  liveRegions: (docs) =>
    docs.flatMap((d) => {
      const isRegion = (e: El) => attr(e, "aria-live") !== undefined || ["status", "alert", "log"].includes((attr(e, "role") ?? "").trim().toLowerCase());
      return [
        ...d.elements
          .filter(isRegion)
          .map((e) =>
            h(d, e, `aria-live="${attr(e, "aria-live") ?? ""}" role="${attr(e, "role") ?? ""}"`, `live|${attr(e, "aria-live") ?? ""}|${attr(e, "role") ?? ""}`),
          ),
        ...d.elements
          .filter((e) => !isRegion(e) && STATUS_CLASS.test(attr(e, "class") ?? "") && ancestors(e).some((a) => a.tag === "form"))
          .map((e) =>
            h(
              d,
              e,
              `status-like class="${(attr(e, "class") ?? "").slice(0, 40)}" in a form — verify async feedback is announced (role=status/alert or aria-live)`,
              `statusclass|${(attr(e, "class") ?? "").slice(0, 40)}`,
            ),
          ),
      ];
    }),

  // Explicit tab order, dialogs, and the SPA signals that decide focus restitution.
  focusOrder: (docs) =>
    docs.flatMap((d) => {
      const out: Harvested[] = [
        ...d.elements
          .filter((e) => attr(e, "tabindex") !== undefined)
          .map((e) => h(d, e, `tabindex="${attr(e, "tabindex")}"`, `tabindex|${attr(e, "tabindex")}`)),
        ...elementsByTag(d, "dialog")
          .concat(d.elements.filter((e) => attr(e, "role") === "dialog"))
          .filter((e, i, a) => a.indexOf(e) === i)
          .map((e) =>
            h(d, e, `<${e.tag} role="${attr(e, "role") ?? ""}"> — verify focus moves in on open and is restored to the trigger on close`, `dialog|${e.tag}`),
          ),
      ];
      const rl = lineOf(d, ROUTER_IMPORT);
      if (rl !== undefined)
        out.push(hAt(d, rl, "import", "client-router import — verify page title + focus are restored on partial (SPA) navigation", "router"));
      return out;
    }),

  // Focusable inventory plus the handlers that can hold focus — the keyboard-trap subject.
  focusables: (docs) =>
    docs.flatMap((d) => [
      ...elementsByTag(d, "iframe", "object", "embed").map((e) =>
        h(
          d,
          e,
          `<${e.tag}> title="${attr(e, "title") ?? ""}" src="${(attr(e, "src") ?? "").slice(0, 60)}" — can focus LEAVE this embedded content with the keyboard alone?`,
          `embed|${e.tag}|${attr(e, "src") ?? ""}`,
        ),
      ),
      ...elementsByTag(d, "dialog")
        .concat(d.elements.filter((e) => attr(e, "role") === "dialog" || attr(e, "aria-modal") === "true"))
        .filter((e, i, a) => a.indexOf(e) === i)
        .map((e) => h(d, e, `modal container <${e.tag}> aria-modal="${attr(e, "aria-modal") ?? ""}" — does Escape hand control back?`, `modal|${e.tag}`)),
      ...linesOf(d, /preventDefault\(\)/).map((l) => hAt(d, l.line, "handler", `preventDefault in a handler: ${l.text}`, `preventDefault|${l.text}`)),
    ]),

  // Language changes inside a page.
  //
  // The absence of a `lang` attribute proves NOTHING here, which is why this criterion has no
  // applicability predicate: a page with no `lang` anywhere is either a page with no change of
  // language (conforming) or a page whose foreign passages are all unmarked (failing), and
  // those are opposite verdicts. So the harvest cannot just list `lang` attributes — it has to
  // hand over the CANDIDATES too, or the agent is asked to rule on an empty set.
  //
  // Three things go in: the language each page declares, every element-level override, and
  // every text run carrying a word from a foreign lexicon. The lexicon is a lead, never a
  // verdict — "email", "test" and "sprint" are French usage now, and the decision protocol
  // already exempts proper nouns, technical terms and words that entered the vernacular.
  langParts: (docs) =>
    docs.flatMap((d) => [
      ...elementsByTag(d, "html").map((e) =>
        h(
          d,
          e,
          `page="${pageOfDoc(d.file) ?? "source"}" declares lang="${attr(e, "lang") ?? ""}" — passages in another language must override it`,
          `declaredlang|${attr(e, "lang") ?? ""}`,
        ),
      ),
      ...d.elements
        .filter((e) => e.tag !== "html" && attr(e, "lang") !== undefined)
        .map((e) => h(d, e, `lang="${attr(e, "lang")}" text="${t(e, 40)}"`, `lang|${attr(e, "lang")}|${t(e, 40)}`)),
      ...d.elements
        .filter((e) => e.children.some((c) => c.type === "text") && FOREIGN_LEXICON.test(textContent(e)) && attr(e, "lang") === undefined)
        .map((e) =>
          h(
            d,
            e,
            `candidate foreign passage, NOT marked with lang: "${t(e, 60)}" — a proper noun, a technical term or a word in common use is exempt`,
            `foreign|${t(e, 60)}`,
          ),
        ),
    ]),

  // The document's own language declaration.
  docLang: (docs) =>
    docs.flatMap((d) =>
      elementsByTag(d, "html").map((e) =>
        h(d, e, `<html lang="${attr(e, "lang") ?? ""}"> — is it present, valid, and the language of the content?`, `doclang|${attr(e, "lang") ?? ""}`),
      ),
    ),

  // The document's title, with the page it belongs to, so "is it pertinent?" is answerable.
  docTitle: (docs) =>
    docs.flatMap((d) =>
      elementsByTag(d, "title").map((e) => h(d, e, `page="${pageOfDoc(d.file) ?? "source"}" <title>${t(e, 80)}</title>`, `doctitle|${t(e, 80)}`)),
    ),

  // The doctype — the subject of RGAA 8.1, which maps onto no WCAG 2.2 criterion, so the pack
  // is the only place it can be named.
  //
  // Three states, deliberately kept apart. A capture's `dom.html` is documentElement.outerHTML
  // and never contains a doctype, so reading the DOM for one would report "absent" on every
  // page in the world. The capture records it beside the DOM (SnapshotMeta.doctype): present
  // is the declaration, empty is a page that genuinely had none, and ABSENT is a capture taken
  // before the field existed — which is not evidence of anything and must not read as one.
  doctype: (docs) =>
    docs.flatMap((d) => {
      const page = pageOfDoc(d.file);
      if (page !== undefined) {
        const dt = d.signals?.doctype;
        if (dt === undefined) {
          return [
            hAt(
              d,
              1,
              "doctype",
              `page="${page}" — this capture predates doctype recording, so the declaration was NOT captured. That is not evidence the page lacks one: re-record the snapshots to decide this criterion.`,
              `doctype|unrecorded`,
            ),
          ];
        }
        return [hAt(d, 1, "doctype", `page="${page}" doctype=${dt === "" ? "(none on the page)" : dt}`, `doctype|${dt}`)];
      }
      const line = lineOf(d, /<!DOCTYPE/i);
      if (line === undefined) return [];
      const decl = (d.source.split("\n")[line - 1] ?? "").trim().slice(0, 80);
      return [hAt(d, line, "doctype", `source file ${decl}`, `doctype|${decl}`)];
    }),

  // A visible text label alongside an accessible name that replaces it.
  nameVsAccName: (docs) =>
    docs.flatMap((d) =>
      d.elements
        .filter((e) => INTERACTIVE_TAGS.includes(e.tag) && attr(e, "aria-label") !== undefined && t(e, 40).length > 0)
        .map((e) =>
          h(
            d,
            e,
            `visible="${t(e, 40)}" aria-label="${attr(e, "aria-label")}" — is the visible text CONTAINED in the accessible name?`,
            `namevs|${t(e, 40)}|${attr(e, "aria-label")}`,
          ),
        ),
    ),

  // Pointer, touch, gesture and drag handlers — everything a keyboard may not reach.
  pointerHandlers: (docs) =>
    docs.flatMap((d) => [
      ...d.elements
        .filter(
          (e) =>
            !INTERACTIVE_TAGS.includes(e.tag) && Object.keys(e.attribs).some((k) => /^on(click|mousedown|mouseup|mouseenter|pointerdown|touchstart)$/i.test(k)),
        )
        .map((e) => h(d, e, `<${e.tag}> carries a pointer handler but is not natively interactive — keyboard equivalent?`, `clickable|${e.tag}|${t(e, 40)}`)),
      ...linesOf(d, /\bon(?:MouseDown|PointerDown|TouchStart)\s*=/).map((l) =>
        hAt(d, l.line, "handler", `down-event handler (action must not fire on DOWN, or must be abortable): ${l.text}`, `downevent|${l.text}`),
      ),
      ...linesOf(d, /\b(?:draggable|onDragStart|useDrag|DndContext|react-beautiful-dnd|@dnd-kit)\b/).map((l) =>
        hAt(d, l.line, "drag", `drag interaction: ${l.text}`, `drag|${l.text}`),
      ),
      ...linesOf(d, /\bon(?:TouchMove|GestureStart)\s*=|\b(?:pinch|swipe|hammerjs)\b/i).map((l) =>
        hAt(d, l.line, "gesture", `gesture interaction: ${l.text}`, `gesture|${l.text}`),
      ),
    ]),

  // Single-character keyboard shortcuts.
  shortcuts: (docs) =>
    docs.flatMap((d) =>
      linesOf(d, /\b(?:key|code|charCode)\s*===?\s*["'][a-zA-Z0-9]["']/).map((l) =>
        hAt(d, l.line, "shortcut", `single-character key comparison: ${l.text}`, `shortcut|${l.text}`),
      ),
    ),

  // Instructions that lean on a sensory characteristic alone.
  sensoryText: (docs) =>
    docs.flatMap((d) =>
      linesOf(
        d,
        /\b(?:ci-dessus|ci-dessous|à droite|a droite|à gauche|a gauche|bouton (?:vert|rouge|bleu)|en rouge|en vert|le carré|la case de droite|above|below|to the right|to the left|green button|red button|round button)\b/i,
      ).map((l) => hAt(d, l.line, "text", `sensory-sounding instruction: ${l.text}`, `sensory|${l.text}`)),
    ),

  // Time limits: session expiry, meta refresh, timed redirects.
  timers: (docs) =>
    docs.flatMap((d) => [
      ...d.elements
        .filter((e) => e.tag === "meta" && (attr(e, "http-equiv") ?? "").toLowerCase() === "refresh")
        .map((e) => h(d, e, `<meta http-equiv="refresh" content="${attr(e, "content") ?? ""}">`, `metarefresh|${attr(e, "content") ?? ""}`)),
      ...linesOf(d, /\b(?:setTimeout|setInterval)\s*\(/).map((l) => hAt(d, l.line, "timer", `timer: ${l.text}`, `timer|${l.text}`)),
      ...linesOf(d, /\b(?:sessionTimeout|maxAge|expiresIn|session_max|idleTimeout)\b/i).map((l) =>
        hAt(d, l.line, "session", `session/expiry config: ${l.text}`, `session|${l.text}`),
      ),
    ]),

  // Moving, blinking or auto-updating content, and how it can be stopped.
  motion: (docs) =>
    docs.flatMap((d) => [
      ...elementsByTag(d, "marquee", "blink").map((e) => h(d, e, `<${e.tag}> — moving content with no native control`, `marquee|${e.tag}`)),
      ...d.elements
        .filter((e) => /animation|transition/.test(attr(e, "style") ?? ""))
        .map((e) => h(d, e, `inline animation: ${(attr(e, "style") ?? "").slice(0, 80)}`, `inlineanim|${(attr(e, "style") ?? "").slice(0, 80)}`)),
      ...linesOf(d, /\b(?:carousel|slider|autoplay|animation-iteration-count\s*:\s*infinite|requestAnimationFrame)\b/i).map((l) =>
        hAt(d, l.line, "motion", `moving/auto-updating content: ${l.text}`, `motion|${l.text}`),
      ),
      ...elementsByTag(d, "video", "audio").map((e) =>
        h(d, e, `<${e.tag} autoplay=${attr(e, "autoplay") !== undefined} controls=${attr(e, "controls") !== undefined}>`, `media|${e.tag}`),
      ),
    ]),

  // A change of context triggered by focus or by changing a value.
  contextChange: (docs) =>
    docs.flatMap((d) => [
      ...linesOf(d, /\bon(?:Focus|Blur)\s*=/).map((l) =>
        hAt(d, l.line, "handler", `focus handler — does it change context (navigate, submit, move focus)? ${l.text}`, `onfocus|${l.text}`),
      ),
      ...linesOf(d, /\bonChange\s*=/).map((l) =>
        hAt(d, l.line, "handler", `change handler — does changing the value itself change context? ${l.text}`, `onchange|${l.text}`),
      ),
    ]),

  // Reading order: anything that moves meaning-bearing content away from DOM order.
  readingOrder: (docs) =>
    docs.flatMap((d) => [
      ...d.elements
        .filter((e) => /(?:^|;)\s*order\s*:|flex-direction\s*:\s*\w+-reverse|position\s*:\s*absolute/.test(attr(e, "style") ?? ""))
        .map((e) =>
          h(
            d,
            e,
            `inline layout override: ${(attr(e, "style") ?? "").slice(0, 80)} — does it move meaning?`,
            `orderinline|${(attr(e, "style") ?? "").slice(0, 80)}`,
          ),
        ),
      ...(d.signals?.css?.rules ?? [])
        .filter((r) => r.decls.order !== undefined || /-reverse/.test(r.decls.flexDirection ?? "") || /reverse/.test(r.decls.flexFlow ?? ""))
        .slice(0, 60)
        .map((r) =>
          hAt(
            d,
            1,
            `css:${r.selector}`,
            `stylesheet reorders layout: ${r.selector.slice(0, 60)} { ${declsText(r.decls)} } — does it move meaning-bearing content?`,
            `ordercss|${r.selector}`,
          ),
        ),
    ]),

  // Office documents offered for download — the subject of "is there an accessible version?".
  downloadDocs: (docs) =>
    docs.flatMap((d) =>
      elementsByTag(d, "a")
        .filter((e) => DOWNLOAD_HREF.test(attr(e, "href") ?? ""))
        .map((e) =>
          h(
            d,
            e,
            `downloadable document: text="${t(e, 50)}" href="${attr(e, "href")}" — is an accessible version offered, and is it pertinent?`,
            `download|${t(e, 50)}|${attr(e, "href")}`,
          ),
        ),
    ),

  // Content deliberately hidden from one rendering or the other — the subject of "is what is
  // hidden from assistive technology genuinely meant to be ignored?".
  hiddenContent: (docs) =>
    docs.flatMap((d) =>
      d.elements
        .filter(
          (e) =>
            attr(e, "aria-hidden") !== undefined ||
            attr(e, "hidden") !== undefined ||
            /(?:^|[-_ ])(sr-only|visually-hidden|screen-reader|fr-sr-only)(?:[-_ ]|$)/i.test(attr(e, "class") ?? ""),
        )
        .map((e) =>
          h(
            d,
            e,
            `<${e.tag}> aria-hidden="${attr(e, "aria-hidden") ?? ""}" hidden=${attr(e, "hidden") !== undefined} class="${(attr(e, "class") ?? "").slice(0, 40)}" text="${t(e, 40)}"`,
            `hidden|${e.tag}|${attr(e, "aria-hidden") ?? ""}|${t(e, 40)}`,
          ),
        ),
    ),

  // Content pinned over the page — what can obscure a focused element.
  stickies: (docs) =>
    docs.flatMap((d) => [
      ...d.elements
        .filter((e) => /position\s*:\s*(?:fixed|sticky)/.test(attr(e, "style") ?? ""))
        .map((e) => h(d, e, `pinned element (inline): ${(attr(e, "style") ?? "").slice(0, 60)} — can it cover a focused element?`, `sticky|${selectorFor(e)}`)),
      ...(d.signals?.css?.rules ?? [])
        .filter((r) => /^(?:fixed|sticky)$/.test((r.decls.position ?? "").trim()))
        .slice(0, 60)
        .map((r) =>
          hAt(
            d,
            1,
            `css:${r.selector}`,
            `pinned by stylesheet: ${r.selector.slice(0, 60)} { position: ${r.decls.position} } — can it cover a focused element?`,
            `stickycss|${r.selector}`,
          ),
        ),
    ]),
};

// ---- which subjects serve which criterion ------------------------------------------------
//
// EVERY success criterion the static engine cannot decide names its subjects. The integrity
// test (tests/harvest-coverage.test.ts) fails if one is missing, for the same reason the
// adjudication protocol has one: a criterion handed to the agent with nothing to look at is
// where an audit quietly becomes an opinion.

export const SC_SUBJECTS: Record<string, string[]> = {
  "1.1.1": ["images"],
  "1.2.1": ["motion"],
  "1.2.2": ["motion"],
  "1.2.3": ["motion"],
  "1.2.4": ["motion"],
  "1.2.5": ["motion"],
  "1.3.1": ["structure", "tables", "lists", "headings"],
  "1.3.2": ["readingOrder", "structure"],
  "1.3.3": ["sensoryText"],
  "1.3.4": ["readingOrder"],
  "1.3.5": ["autocomplete"],
  "1.4.1": ["colourPairs", "links"],
  "1.4.3": ["colourPairs"],
  "1.4.4": ["readingOrder"],
  "1.4.5": ["images"],
  "1.4.10": ["readingOrder"],
  "1.4.11": ["colourPairs"],
  "1.4.12": ["readingOrder"],
  "1.4.13": ["aria", "stickies"],
  "2.1.1": ["pointerHandlers", "focusables"],
  "2.1.2": ["focusables", "pointerHandlers"],
  "2.1.4": ["shortcuts"],
  "2.2.1": ["timers"],
  "2.2.2": ["motion", "timers"],
  "2.3.1": ["motion"],
  "2.4.1": ["landmarks"],
  "2.4.3": ["focusOrder"],
  "2.4.4": ["links"],
  "2.4.5": ["navMechanisms", "links"],
  "2.4.6": ["headings"],
  "2.4.7": ["colourPairs"],
  "2.4.11": ["stickies"],
  "2.5.1": ["pointerHandlers"],
  "2.5.2": ["pointerHandlers"],
  "2.5.3": ["nameVsAccName"],
  "2.5.4": ["pointerHandlers"],
  "2.5.7": ["pointerHandlers"],
  "2.5.8": ["stickies", "links"],
  "3.1.2": ["langParts"],
  "3.2.1": ["contextChange"],
  "3.2.2": ["contextChange"],
  "3.2.3": ["repeatedBlocks"],
  "3.2.4": ["repeatedBlocks", "nameVsAccName"],
  "3.2.6": ["repeatedBlocks", "links"],
  "3.3.1": ["errors", "controls"],
  "3.3.2": ["controls"],
  "3.3.3": ["errors", "controls"],
  "3.3.4": ["controls", "errors"],
  "3.3.7": ["controls"],
  "3.3.8": ["controls"],
  "4.1.2": ["aria"],
  "4.1.3": ["liveRegions"],
};

/** Pack criteria whose subject is NARROWER than the union of their mapped success criteria.
 *
 *  This table is why it exists: RGAA 11.1 asks whether each form field is labelled, and maps
 *  onto [1.3.1, 2.4.6, 3.3.2, 4.1.2]. Inheriting that union hands it the whole heading
 *  outline before it ever reaches a control. A pack criterion that names its own subjects
 *  gets exactly them. Absent from this table ⇒ the union, which is right for the majority. */
export const PACK_SUBJECTS: Record<string, Record<string, string[]>> = {
  rgaa: {
    // Theme 5 — tables. The question is about the table, never about the page outline.
    "5.1": ["tables"],
    "5.2": ["tables"],
    "5.3": ["tables"],
    "5.4": ["tables"],
    "5.5": ["tables"],
    "5.6": ["tables"],
    "5.7": ["tables"],
    "5.8": ["tables"],
    // Theme 6 — links.
    "6.1": ["links"],
    "6.2": ["links"],
    // Theme 8 — the document itself. 8.1 maps onto no WCAG 2.2 criterion at all, so the pack
    // is the ONLY place its subject can be named.
    "8.1": ["doctype"],
    "8.3": ["docLang"],
    "8.4": ["docLang"],
    "8.5": ["docTitle"],
    "8.6": ["docTitle"],
    "8.7": ["langParts"],
    "8.8": ["langParts"],
    "8.9": ["structure"],
    "8.10": ["readingOrder", "langParts"],
    // Theme 9 — structure.
    "9.1": ["headings"],
    "9.2": ["landmarks"],
    "9.3": ["lists"],
    "9.4": ["structure"],
    // Theme 11 — forms.
    "11.1": ["controls"],
    "11.2": ["controls"],
    "11.3": ["controls", "nameVsAccName"],
    "11.4": ["controls"],
    "11.5": ["controls"],
    "11.6": ["controls", "landmarks"],
    "11.7": ["controls", "landmarks"],
    "11.8": ["controls"],
    "11.9": ["controls"],
    "11.10": ["controls", "errors"],
    "11.11": ["errors", "controls"],
    "11.12": ["controls", "errors"],
    "11.13": ["autocomplete"],
    // Theme 12 — navigation.
    "12.1": ["navMechanisms"],
    "12.2": ["repeatedBlocks"],
    "12.3": ["navMechanisms"],
    "12.4": ["repeatedBlocks", "navMechanisms"],
    "12.5": ["repeatedBlocks"],
    "12.6": ["landmarks"],
    "12.7": ["landmarks"],
    "12.8": ["focusOrder"],
    "12.9": ["focusables", "pointerHandlers"],
    "12.10": ["shortcuts"],
    "12.11": ["pointerHandlers", "focusables"],
    // Theme 4 — multimedia. 4.10 (is automatically-triggered sound controllable?) maps onto
    // WCAG 1.4.2, which is `static` and therefore has no subject of its own — but the pack
    // flags 4.10 `judgment`, so judgmentGuard reopens it and it would arrive with nothing.
    "4.10": ["motion"],
    // Theme 3 — colour. The question is about what colour alone conveys, not the outline.
    "3.1": ["colourPairs", "links"],
    "3.2": ["colourPairs"],
    "3.3": ["colourPairs"],
    // Theme 7 — scripts. "Is each script operable by keyboard AND pointer?" is about the
    // handlers and the focusable surface, never about the page's headings and lists.
    "7.1": ["aria", "pointerHandlers"],
    "7.3": ["pointerHandlers", "focusables"],
    "7.4": ["contextChange"],
    "7.5": ["liveRegions"],
    // Theme 10 — presentation. These ask what survives when CSS is off, what the stylesheet
    // reorders, and what is hidden on purpose.
    "10.1": ["readingOrder"],
    "10.2": ["hiddenContent", "structure"],
    "10.3": ["readingOrder", "structure"],
    "10.4": ["readingOrder"],
    "10.8": ["hiddenContent", "aria"],
    "10.9": ["sensoryText"],
    "10.10": ["sensoryText"],
    "10.11": ["readingOrder"],
    "10.12": ["readingOrder"],
    "10.13": ["aria", "stickies"],
    "10.14": ["focusables", "pointerHandlers"],
    // Theme 13 — consultation.
    "13.1": ["timers"],
    "13.3": ["downloadDocs"],
    "13.4": ["downloadDocs"],
    "13.7": ["motion"],
    "13.8": ["motion", "timers"],
    "13.9": ["readingOrder"],
    "13.10": ["pointerHandlers"],
    "13.11": ["pointerHandlers"],
  },
};

/** The union of the named subjects, de-duplicated by anchor. Order is the subject order, so a
 *  criterion's own subject always comes before anything it merely inherits. */
export function harvestSubjects(ids: string[], docs: Doc[]): Harvested[] {
  const out: Harvested[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    for (const item of SUBJECTS[id]?.(docs) ?? []) {
      // Keyed on the anchor's OFFSET and its class, not on `file:line:selector`: the latter
      // is shared by every element on a line, so it deduplicated forty distinct links into
      // one. Two subjects reporting the same element with the same class is the real
      // duplicate this guards against.
      const key = `${item.ev.file}:${item.at}:${item.cls}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

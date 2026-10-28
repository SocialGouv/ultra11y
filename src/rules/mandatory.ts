// Theme 8 — Mandatory elements (the statically-checkable slice).
import type { Doc, El, HNode } from "../parse/html.js";
import { attr, hasAttr, dynamicSpreadMayProvide, visibleText, allIds, elementsByTag, ancestors } from "../parse/html.js";
import { isDisplayHidden } from "../name.js";
import { type Rule, type RuleFinding, shellHeadInjected } from "./rule.js";

// Next.js App Router sets the document <title> via `export const metadata = { title }`
// or `generateMetadata`, not a literal <title> in JSX — invisible to source analysis.
// When that API is present in a JSX/TSX file, the title is managed by the framework, so
// title-missing-empty must not assert a (false) non-conformity.
const NEXT_METADATA = /export\s+(const\s+metadata\b|(async\s+)?function\s+generateMetadata\b)/;
function titleSetByFramework(doc: Doc): boolean {
  if (doc.kind === "html") return false;
  return NEXT_METADATA.test(doc.source) && /\btitle\s*:/.test(doc.source);
}

function declaredLanguage(el: El): string {
  return (attr(el, "lang") ?? "").trim() || (attr(el, "xml:lang") ?? "").trim();
}

/** A JSX spread can provide either language spelling unless later explicit attributes
 * override both. HTML/SFC parsing carries no source-order metadata, so it stays conservative. */
function spreadMayDeclareLanguage(el: El): boolean {
  return dynamicSpreadMayProvide(el, ["lang", "xml:lang"]);
}

const htmlLangMissing: Rule = {
  id: "html-lang-missing",
  criteria: ["3.1.1"],
  severity: "bloquant",
  scope: "page",
  run(doc: Doc): RuleFinding[] {
    const html = elementsByTag(doc, "html")[0];
    if (!html) return [];
    const lang = declaredLanguage(html);
    if (lang) return [];
    if (spreadMayDeclareLanguage(html)) return [];
    return [
      {
        criteriaId: "3.1.1",
        el: html,
        msgId: "html-lang-missing",
      },
    ];
  },
};

/** RGAA 8.3 is broader than WCAG's usual `<html lang>` shortcut: a page also passes when
 * every rendered text node inherits a language from one of its ancestors. This rule only
 * fires when BOTH routes fail. It is therefore safe to use as a decisive RGAA 8.3.1 rule,
 * while `html-lang-missing` remains a narrower candidate signal. */
const documentLanguageMissing: Rule = {
  id: "document-language-missing",
  criteria: ["3.1.1"],
  severity: "bloquant",
  scope: "page",
  run(doc: Doc): RuleFinding[] {
    const html = elementsByTag(doc, "html")[0];
    if (!html) return [];
    if (declaredLanguage(html)) return [];
    if (spreadMayDeclareLanguage(html)) return [];
    const ignored = new Set(["script", "style", "title", "noscript", "template", "svg"]);
    const uncovered = doc.elements.find((el) => {
      if (ignored.has(el.tag) || isDisplayHidden(el)) return false;
      const hasDirectText = el.children.some((child) => child.type === "text" && child.data.trim() !== "");
      if (!hasDirectText) return false;
      return ![el, ...ancestors(el)].some((node) => declaredLanguage(node) !== "");
    });
    if (!uncovered) return [];
    return [{ criteriaId: "3.1.1", el: uncovered, msgId: "document-language-missing" }];
  },
};

/** Two simultaneous default-language declarations cannot both be pertinent when their
 * normalized values differ. This is the missing ACT rule 5b7ae0. */
const htmlLangXmlLangMismatch: Rule = {
  id: "html-lang-xml-lang-mismatch",
  criteria: ["3.1.1"],
  severity: "majeur",
  scope: "page",
  run(doc: Doc): RuleFinding[] {
    const html = elementsByTag(doc, "html")[0];
    if (!html) return [];
    const lang = (attr(html, "lang") ?? "").trim();
    const xmlLang = (attr(html, "xml:lang") ?? "").trim();
    const primary = (value: string) => value.toLowerCase().split("-")[0];
    if (!lang || !xmlLang || primary(lang) === primary(xmlLang)) return [];
    return [{ criteriaId: "3.1.1", el: html, msgId: "html-lang-xml-lang-mismatch", params: { lang, xmlLang } }];
  },
};

/** Raw-source duplicate attributes are collapsed by the HTML parser, so they must be found
 * before looking at `el.attribs`. Restricted to real HTML: JSX/SFC bindings have a different
 * grammar and are validated by their compiler. */
const duplicateAttribute: Rule = {
  id: "duplicate-attribute",
  criteria: ["4.1.2"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    if (doc.kind !== "html" || doc.lossy) return [];
    const out: RuleFinding[] = [];
    const tag = /<([A-Za-z][\w:-]*)(\s[^<>]*?)\/?\s*>/gs;
    const attribute = /([^\s"'<>/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
    let match: RegExpExecArray | null;
    while ((match = tag.exec(doc.source))) {
      const body = match[2] ?? "";
      const seen = new Set<string>();
      let duplicate = "";
      attribute.lastIndex = 0;
      let a: RegExpExecArray | null;
      while ((a = attribute.exec(body))) {
        const name = (a[1] ?? "").toLowerCase();
        if (!name) continue;
        if (seen.has(name)) {
          duplicate = name;
          break;
        }
        seen.add(name);
      }
      if (!duplicate) continue;
      const el = doc.elements.find((candidate) => candidate.start === match!.index);
      if (el) out.push({ criteriaId: "4.1.2", el, msgId: "duplicate-attribute", params: { attr: duplicate } });
    }
    return out;
  },
};

const titleMissingEmpty: Rule = {
  id: "title-missing-empty",
  criteria: ["2.4.2"],
  severity: "bloquant",
  scope: "page",
  run(doc: Doc): RuleFinding[] {
    // An <svg>/<math> <title> names a graphic, never the document.
    const titles = elementsByTag(doc, "title").filter((t) => !ancestors(t).some((a) => a.tag === "svg" || a.tag === "math"));
    // In a plain HTML page the document's title is the FIRST <title> in tree order — a
    // stray non-empty one further down (say, in <body>) does not rescue an empty one in
    // <head>. JSX/SFC may render alternatives in exclusive branches, so any one counts there.
    const hasNonEmpty = doc.kind === "html" ? !!titles[0] && visibleText(titles[0]).length > 0 : titles.some((t) => visibleText(t).length > 0);
    if (hasNonEmpty) return [];
    // <title> injected by the Next.js metadata API, or by a framework shell placeholder
    // in <head> (e.g. SvelteKit `%sveltekit.head%`, `<%= title %>`).
    if (titleSetByFramework(doc) || shellHeadInjected(doc)) return [];
    const anchor: El | undefined = elementsByTag(doc, "head")[0] ?? elementsByTag(doc, "html")[0] ?? doc.elements[0];
    if (!anchor) return [];
    return [
      {
        criteriaId: "2.4.2",
        el: anchor,
        msgId: "title-missing-empty",
        params: { titleState: titles.length ? "empty" : "absent" },
      },
    ];
  },
};

// Two elements are mutually exclusive at runtime when their JSX conditional-arm paths
// (tagged by the parser: "/c0T" vs "/c0F" for a ternary's two arms, "/c1R" for the
// right operand of an && / ||) first diverge INSIDE THE SAME conditional — only one of
// the two arms is ever rendered. Independent conditionals ("/c0R" vs "/c1R") and any
// unconditional element (no arm) can co-render, so they are NOT exclusive. HTML/SFC docs
// never set branchArm, so this always returns false there (behaviour unchanged).
function armsExclusive(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const sa = a.split("/").filter(Boolean);
  const sb = b.split("/").filter(Boolean);
  const n = Math.min(sa.length, sb.length);
  for (let i = 0; i < n; i++) {
    if (sa[i] === sb[i]) continue;
    const ca = /^c(\d+)/.exec(sa[i]!)?.[1];
    const cb = /^c(\d+)/.exec(sb[i]!)?.[1];
    return ca !== undefined && ca === cb; // same conditional, different arm → exclusive
  }
  return false; // one path is a prefix of the other → they can co-render
}

const duplicateId: Rule = {
  id: "duplicate-id",
  criteria: ["4.1.2"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    const byId = new Map<string, El[]>();
    for (const { id, el } of allIds(doc)) {
      if (id.includes("{")) continue; // dynamic id (id={`x-${i}`}/id="x-{id}") — unique per instance at runtime
      const prior = byId.get(id);
      if (!prior) {
        byId.set(id, [el]);
        continue;
      }
      // A real collision only when this element can co-render with an earlier one of the
      // same id. Ids reused across mutually-exclusive JSX conditional arms never coexist.
      if (prior.some((p) => !armsExclusive(p.branchArm, el.branchArm))) {
        out.push({ criteriaId: "4.1.2", el, msgId: "duplicate-id", params: { id } });
      }
      prior.push(el);
    }
    return out;
  },
};

const inlineLangChangeMissing: Rule = {
  id: "inline-lang-change-missing",
  criteria: ["3.1.2"],
  severity: "mineur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (el.tag === "html") continue;
      if (!hasAttr(el, "lang")) continue;
      if ((attr(el, "lang") ?? "").trim() === "") {
        out.push({
          criteriaId: "3.1.2",
          el,
          msgId: "inline-lang-change-missing",
          params: { tag: el.tag },
        });
      }
    }
    return out;
  },
};

// BCP47 primary subtag + optional subtags (syntactic validity only). The primary
// subtag is a 2-3 alpha language code, OR the `x`/`i` singleton that starts a
// private-use (`x-klingon`) or grandfathered (`i-navajo`) tag — those legitimate
// singletons must not be flagged invalid (the old /^[A-Za-z]{2,3}…/ rejected them).
const BCP47 = /^([A-Za-z]{2,3}|[xXiI])(-[A-Za-z0-9]{1,8})*$/;

// The IANA Language Subtag Registry is closed over two-letter primary subtags: they are
// exactly the ISO 639-1 codes (plus the deprecated in/iw/ji/jw/mo and the sh macrolanguage).
// Any other two-letter primary subtag (`em`) names no language at all.
const TWO_LETTER_SUBTAGS = new Set(
  (
    "aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu " +
    "fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn " +
    "ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os " +
    "pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw " +
    "ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu in iw ji jw mo sh"
  ).split(" "),
);
// RFC 5646 §2.2.1: a language that HAS an ISO 639-1 code is registered under that code only,
// so its ISO 639-2 three-letter spellings (`eng`, `fra`/`fre`, `deu`/`ger`…) are not valid
// subtags. Only codes whose two-letter twin is certain are listed — a three-letter subtag
// missing from this list is simply not judged, never guessed at.
const THREE_LETTER_SHADOWED = new Set(
  (
    "eng fra fre deu ger spa ita por nld dut rus zho chi jpn kor ara pol swe nob nno dan fin ces cze ell gre tur heb hin hun " +
    "ron rum ukr cat eus baq glg ltz gle gla cym wel isl ice lit lav est slk slo slv hrv srp bul mkd mac sqi alb hye arm kat geo " +
    "fas per urd ben tam tel vie tha ind bre cos epo lat afr bel bos mlt"
  ).split(" "),
);

/** Is the tag's primary language subtag provably absent from the IANA registry? Only the
 *  two closed cases above are decided; anything else is left to the syntax check. */
function primarySubtagUnregistered(lang: string): boolean {
  const primary = (lang.split("-")[0] ?? "").toLowerCase();
  if (primary.length === 2) return !TWO_LETTER_SUBTAGS.has(primary);
  if (primary.length === 3) return THREE_LETTER_SHADOWED.has(primary);
  return false;
}

/** Does this element govern any rendered text of its own — text that is neither hidden nor
 *  re-declared by a descendant's own `lang`? */
function governsText(el: El): boolean {
  const walk = (n: HNode): boolean => {
    if (n.type === "text") return n.data.trim() !== "";
    if (hasAttr(n, "lang")) return false; // the descendant declares its own language
    if (isDisplayHidden(n)) return false;
    // An image's text alternative is text in this element's language as much as a text node.
    if (n.tag === "img") return (attr(n, "alt") ?? "").trim() !== "" && attr(n, "aria-hidden") !== "true";
    return n.children.some(walk);
  };
  return el.children.some(walk);
}

const langInvalid: Rule = {
  id: "lang-invalid",
  criteria: ["3.1.1", "3.1.2"],
  severity: "mineur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      const lang = (attr(el, "lang") ?? "").trim();
      if (!lang) continue; // empty handled by inline-lang-change-missing / html-lang-missing
      if (BCP47.test(lang) && !primarySubtagUnregistered(lang)) continue;
      // A malformed `lang` only misdeclares something if it actually GOVERNS text. On
      // <html> that is the whole document; elsewhere, text sitting under a descendant with
      // its own `lang`, or inside a hidden subtree, is not governed by this attribute — and
      // an element governing no text at all declares a language for nobody.
      if (el.tag !== "html" && !governsText(el)) continue;
      out.push({
        criteriaId: el.tag === "html" ? "3.1.1" : "3.1.2",
        el,
        msgId: "lang-invalid",
        params: { lang, tag: el.tag },
      });
    }
    return out;
  },
};

export const mandatoryRules: Rule[] = [
  htmlLangMissing,
  documentLanguageMissing,
  htmlLangXmlLangMismatch,
  titleMissingEmpty,
  duplicateId,
  duplicateAttribute,
  inlineLangChangeMissing,
  langInvalid,
];

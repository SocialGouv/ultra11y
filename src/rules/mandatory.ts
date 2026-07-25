// Theme 8 — Mandatory elements (the statically-checkable slice).
import type { Doc, El, HNode } from "../parse/html.js";
import { attr, hasAttr, visibleText, allIds, elementsByTag } from "../parse/html.js";
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

const htmlLangMissing: Rule = {
  id: "html-lang-missing",
  criteria: ["3.1.1"],
  severity: "bloquant",
  scope: "page",
  run(doc: Doc): RuleFinding[] {
    const html = elementsByTag(doc, "html")[0];
    if (!html) return [];
    const lang = (attr(html, "lang") ?? attr(html, "xml:lang") ?? "").trim();
    if (lang) return [];
    return [
      {
        criteriaId: "3.1.1",
        el: html,
        msgId: "html-lang-missing",
      },
    ];
  },
};

const titleMissingEmpty: Rule = {
  id: "title-missing-empty",
  criteria: ["2.4.2"],
  severity: "bloquant",
  scope: "page",
  run(doc: Doc): RuleFinding[] {
    const titles = elementsByTag(doc, "title");
    const hasNonEmpty = titles.some((t) => visibleText(t).length > 0);
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

/** Does this element govern any rendered text of its own — text that is neither hidden nor
 *  re-declared by a descendant's own `lang`? */
function governsText(el: El): boolean {
  const walk = (n: HNode): boolean => {
    if (n.type === "text") return n.data.trim() !== "";
    if (hasAttr(n, "lang")) return false; // the descendant declares its own language
    if (isDisplayHidden(n)) return false;
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
      if (BCP47.test(lang)) continue;
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

export const mandatoryRules: Rule[] = [htmlLangMissing, titleMissingEmpty, duplicateId, inlineLangChangeMissing, langInvalid];

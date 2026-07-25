// Theme 9 — Information structure (headings).
import type { Doc, El, HNode } from "../parse/html.js";
import { attr, elementsByTag } from "../parse/html.js";
import { isIntrinsic } from "../parse/jsx-bridge.js";
import { accessibleName, mayInjectContent } from "../name.js";
import { type Rule, type RuleFinding, shellBodyInjected } from "./rule.js";
import { ancestors } from "../parse/html.js";

// JSX/SFC only: true when a required element/content may be injected at runtime in a
// way static source analysis cannot see — a child component (non-intrinsic tag, which
// can render anything), a <slot>, or a {…}/{@render} expression child. Rules that
// assert "the page is missing X" must bail on these so a residual risk is never turned
// into a false non-conformity (e.g. a Next.js layout supplies its <h1> via {children}).
function contentMaybeInjected(doc: Doc): boolean {
  if (doc.kind === "html") return false; // plain HTML has no slots/components/expressions
  for (const el of doc.elements) {
    if (el.tag === "slot") return true;
    if (el.tag !== "#fragment" && !isIntrinsic(el.tag)) return true;
  }
  const stack: HNode[] = [...doc.roots];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === "text") {
      if (n.data.includes("{")) return true; // {children}/{expr} — injected markup
    } else stack.push(...n.children);
  }
  return false;
}

function headingLevel(el: El): number | null {
  const m = /^h([1-6])$/.exec(el.tag);
  if (m) return Number(m[1]);
  if ((attr(el, "role") ?? "") === "heading") {
    const lvl = Number(attr(el, "aria-level"));
    if (Number.isInteger(lvl) && lvl >= 1) return lvl;
  }
  return null;
}

function headings(doc: Doc): { el: El; level: number }[] {
  const out: { el: El; level: number }[] = [];
  for (const el of doc.elements) {
    const lvl = headingLevel(el);
    if (lvl !== null) out.push({ el, level: lvl });
  }
  return out;
}

const headingOrderSkip: Rule = {
  id: "heading-order-skip",
  criteria: ["1.3.1"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    let prev = 0;
    let prevArm: string | undefined;
    let prevHeading: El | null = null;
    let componentBetween = false;
    // Walk elements in source order so interleaved child components are visible: a
    // component rendered BETWEEN two headings may itself render an intermediate heading
    // (invisible to source) — so a "skip" across it is not a definite order violation.
    for (const el of doc.elements) {
      const level = headingLevel(el);
      if (level === null) {
        if (el.tag !== "#fragment" && !isIntrinsic(el.tag) && (!prevHeading || !ancestors(el).includes(prevHeading))) componentBetween = true;
        continue;
      }
      // Compare only headings in the SAME branch context (different JSX conditional arms
      // are mutually exclusive) with no component injected between them.
      if (prev !== 0 && el.branchArm === prevArm && !componentBetween && level - prev > 1) {
        out.push({
          criteriaId: "1.3.1",
          el,
          msgId: "heading-order-skip",
          params: { level, prev, expected: prev + 1 },
        });
      }
      prev = level;
      prevArm = el.branchArm;
      prevHeading = el;
      componentBetween = false;
    }
    return out;
  },
};

// h1-missing / h1-multiple are ADVISORY (non-normative): neither "start at h1" nor "a
// single h1 per page" is a requirement in HTML, accessibility, or SEO. A human RGAA
// auditor rejected them as non-conformities — no normative test backs them. Heading
// HIERARCHY stays covered by `heading-order-skip` (normative: RGAA 9.1.3 makes a level
// skip testable). These fire as « Recommandation (non normative) », never an NC.
const h1Missing: Rule = {
  id: "h1-missing",
  criteria: ["1.3.1"],
  severity: "mineur",
  scope: "page",
  advisory: true,
  run(doc: Doc): RuleFinding[] {
    const hasH1 = headings(doc).some((h) => h.level === 1);
    if (hasH1) return [];
    // The h1 may be supplied by {children}/a child component (JSX/SFC) or injected into
    // a framework shell template (SPA mount point / `%sveltekit.body%`) at build/runtime.
    if (contentMaybeInjected(doc) || shellBodyInjected(doc)) return [];
    const anchor = elementsByTag(doc, "body")[0] ?? elementsByTag(doc, "html")[0];
    if (!anchor) return [];
    return [
      {
        criteriaId: "1.3.1",
        el: anchor,
        msgId: "h1-missing",
      },
    ];
  },
};

const h1Multiple: Rule = {
  id: "h1-multiple",
  criteria: ["1.3.1"],
  severity: "mineur",
  scope: "page",
  advisory: true,
  run(doc: Doc): RuleFinding[] {
    const h1s = elementsByTag(doc, "h1");
    if (h1s.length <= 1) return [];
    return h1s.slice(1).map((el) => ({
      criteriaId: "1.3.1",
      el,
      msgId: "h1-multiple",
      params: { count: h1s.length },
    }));
  },
};

// <slot> is allowed: it projects slotted <li>s (web components / SFC templates).
const ALLOWED_IN_LIST = new Set(["li", "script", "template", "slot"]);

const listStructure: Rule = {
  id: "list-structure",
  criteria: ["1.3.1"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (el.tag === "ul" || el.tag === "ol") {
        // Only intrinsic (HTML) children are a definite violation; a PascalCase
        // component child may itself render an <li>, so it is left to the cross-file
        // graph / human, never asserted here.
        const bad = el.children.find((c) => c.type === "element" && isIntrinsic(c.tag) && !ALLOWED_IN_LIST.has(c.tag));
        if (bad && bad.type === "element") {
          out.push({
            criteriaId: "1.3.1",
            el: bad,
            msgId: "list-structure.invalid-child",
            params: { childTag: bad.tag, parentTag: el.tag },
          });
        }
      } else if (el.tag === "li") {
        const parent = el.parent;
        if (!parent || ["ul", "ol", "menu"].includes(parent.tag)) continue;
        // A <li> inside a <template> (named-slot definition) or a component subtree is
        // projected into a parent component's <ul> at render — its real parent is unknown
        // to static analysis, so this is not a definite violation.
        if (parent.tag === "template" || ancestors(el).some((a) => a.tag === "template" || (a.tag !== "#fragment" && !isIntrinsic(a.tag)))) continue;
        out.push({
          criteriaId: "1.3.1",
          el,
          msgId: "list-structure.li-outside-list",
          params: { parentTag: parent.tag },
        });
      }
    }
    return out;
  },
};

const emptyHeading: Rule = {
  id: "empty-heading",
  criteria: ["1.3.1"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const { el, level } of headings(doc)) {
      if (attr(el, "aria-hidden") === "true") continue;
      if (accessibleName(el, doc)) continue;
      if (mayInjectContent(el)) continue; // text supplied by a <slot>/child component
      out.push({
        criteriaId: "1.3.1",
        el,
        msgId: "empty-heading",
        params: { tag: el.tag, level },
      });
    }
    return out;
  },
};


// A description list only conveys its term/description pairing when the markup is
// well-formed: <dl> takes <dt>/<dd> (optionally wrapped in <div>), and <dt>/<dd> mean
// nothing outside a <dl>. Broken either way, the relationship is purely visual.
const DL_ALLOWED = new Set(["dt", "dd", "div", "script", "template", "slot", "#fragment"]);

const dlStructure: Rule = {
  id: "dl-structure",
  criteria: ["1.3.1"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (el.tag === "dl") {
        if (mayInjectContent(el)) continue; // children projected by a slot/component
        for (const child of el.children) {
          if (child.type !== "element" || !isIntrinsic(child.tag)) continue;
          if (DL_ALLOWED.has(child.tag)) continue;
          out.push({ criteriaId: "1.3.1", el: child, msgId: "dl-structure.foreign-child", params: { tag: child.tag } });
        }
        continue;
      }
      if (el.tag !== "dt" && el.tag !== "dd") continue;
      const chain = ancestors(el);
      if (chain.some((a) => a.tag === "dl" || !isIntrinsic(a.tag))) continue; // inside a dl, or a component may supply one
      out.push({ criteriaId: "1.3.1", el, msgId: "dl-structure.orphan", params: { tag: el.tag } });
    }
    return out;
  },
};

export const headingsRules: Rule[] = [headingOrderSkip, h1Missing, h1Multiple, listStructure, emptyHeading, dlStructure];

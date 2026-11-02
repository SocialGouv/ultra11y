// The cross-file rule set + runner. Two raise findings the graph makes visible,
// two suppress single-file findings the graph proves are false positives. Findings
// fold into the same AuditResult; suppressions are applied (by ruleId + line) to
// the same Doc's single-file findings in audit.ts.
import type { Doc, El } from "../parse/html.js";
import type { Finding } from "../types.js";
import { attr, hasAttr, visibleText } from "../parse/html.js";
import { isIntrinsic } from "../parse/jsx-bridge.js";
import { isFullDocument } from "./rule.js";
import { type CrossRule, type Suppression, crossToFinding } from "./cross-rule.js";
import { type DepGraph, resolveUsage, idDefinedAnywhere, htmlLangProvidedFor } from "../graph/graph.js";
import { NOTE_CATALOG } from "../messages.js";

const SEVERITY_ORDER: Record<string, number> = { bloquant: 0, majeur: 1, mineur: 2 };
const NAME_PROPS = ["aria-label", "aria-labelledby", "title", "label", "alt"];

// A JSX component usage (PascalCase / namespaced); excludes intrinsic tags and #fragment.
function isComponentUsage(el: El): boolean {
  return !isIntrinsic(el.tag) && el.tag !== "#fragment";
}

// Could this component usage already be carrying an accessible name?
function usageHasName(el: El): boolean {
  if (el.spread) return true; // {...props} may inject a name — stay conservative
  if (visibleText(el) !== "") return true;
  return NAME_PROPS.some((p) => (attr(el, p) ?? "").trim() !== "");
}

function isNameableControl(el: El): boolean {
  if (el.tag === "button" || el.tag === "select" || el.tag === "textarea") return true;
  if (el.tag === "a" && hasAttr(el, "href")) return true;
  if (el.tag === "input" || el.tag === "img") return true;
  return false;
}

// 1) An icon-only component that CAN be named (spread/aria-prop/{children}) but is
//    used without a name → flag at the usage, point at the definition.
const crossIconOnlyUnnamed: CrossRule = {
  id: "cross-icon-only-unnamed",
  criteria: ["4.1.2"],
  severity: "bloquant",
  run(doc, graph) {
    const findings = [];
    for (const el of doc.elements) {
      if (!isComponentUsage(el)) continue;
      const def = resolveUsage(graph, doc.file, el.tag);
      if (!def?.rendersIconOnlyControl || !def.acceptsName) continue;
      if (usageHasName(el)) continue;
      findings.push({
        criteriaId: "4.1.2",
        el,
        msgId: "cross-icon-only-unnamed",
        params: { tag: el.tag, defName: def.name },
        related: {
          file: def.file,
          line: def.line,
          col: def.col,
          selectorHint: def.name,
          note: NOTE_CATALOG["related.icon-component-def"]!.en,
          noteId: "related.icon-component-def",
        },
      });
    }
    return { findings, suppress: [] };
  },
};

// 2) A document whose <html> has no lang, but a wrapper/layout it imports declares
//    one → suppress the missing-lang false positive.
const crossPageLang: CrossRule = {
  id: "cross-page-lang",
  criteria: ["3.1.1"],
  severity: "bloquant",
  run(doc, graph) {
    const suppress: Suppression[] = [];
    const html = doc.elements.find((e) => e.tag === "html");
    if (html && (attr(html, "lang") ?? "") === "" && htmlLangProvidedFor(graph, doc.file)) {
      suppress.push({ ruleId: "html-lang-missing", line: html.line, reason: "lang fourni par un layout/wrapper importé" });
    }
    return { findings: [], suppress };
  },
};

// 3) An intrinsic control/img that spreads {...props} can be named by its parent →
//    suppress single-file name-missing findings on it (the component def site).
const SUPPRESSIBLE_BY_SPREAD = ["icon-only-control-unnamed", "button-empty-name", "link-empty-name", "control-label-missing", "img-alt-missing"];
const crossAriaForwarding: CrossRule = {
  id: "cross-aria-forwarding",
  criteria: ["4.1.2"],
  severity: "bloquant",
  run(doc) {
    const suppress: Suppression[] = [];
    for (const el of doc.elements) {
      if (!el.spread || !isNameableControl(el)) continue;
      for (const ruleId of SUPPRESSIBLE_BY_SPREAD) suppress.push({ ruleId, line: el.line, reason: "nommable via {...props} au point d'utilisation" });
    }
    return { findings: [], suppress };
  },
};

// 4) A skip-link target that lives in another file (imported layout/component) →
//    suppress the in-page "broken anchor" false positive. Only on full documents
//    (mirrors skip-link-target-missing's page scope). A target defined NOWHERE is
//    left to the single-file rule (true positive).
const crossSkipLinkTarget: CrossRule = {
  id: "cross-skip-link-target",
  criteria: ["2.4.1"],
  severity: "majeur",
  run(doc, graph) {
    const suppress: Suppression[] = [];
    if (!isFullDocument(doc)) return { findings: [], suppress };
    const sameDocHas = (id: string): boolean => doc.byId.has(id) || doc.elements.some((e) => attr(e, "name") === id);
    for (const el of doc.elements) {
      if (el.tag !== "a") continue;
      const href = attr(el, "href") ?? "";
      if (!href.startsWith("#") || href === "#") continue;
      let id = href.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        /* keep raw */
      }
      if (sameDocHas(id)) continue; // single-file rule won't fire anyway
      if (idDefinedAnywhere(graph, id))
        suppress.push({ ruleId: "skip-link-target-missing", line: el.line, reason: `cible #${id} définie dans un autre fichier du graphe` });
    }
    return { findings: [], suppress };
  },
};

// 5) A component usage passes a name-bearing prop, but the resolved component renders a
//    control that neither spreads {...props} nor forwards a name to it → the prop-drilled
//    accessible name is lost across the boundary. Raise at the usage, point at the control.
const NAME_PROPS_PASSED = ["aria-label", "aria-labelledby", "title", "label"];
const crossPropDrilledNameLost: CrossRule = {
  id: "cross-prop-drilled-name-lost",
  criteria: ["4.1.2"],
  severity: "majeur",
  run(doc, graph) {
    const findings = [];
    for (const el of doc.elements) {
      if (!isComponentUsage(el)) continue;
      const given = NAME_PROPS_PASSED.filter((p) => (attr(el, p) ?? "").trim() !== "");
      if (!given.length) continue;
      const def = resolveUsage(graph, doc.file, el.tag);
      // Fire only when the control would otherwise be NAMELESS: it must render a control,
      // not accept a name from props, AND not already carry a literal name (else the passed
      // prop is dead code, not a real 4.1.2 non-conformity).
      if (!def?.hasControl || def.acceptsName || def.controlHasName) continue;
      // …and only for a name prop the component provably never reads. One it reads went
      // somewhere — egapro's SelectedFilesTable renders its `title` as the <caption> (#133);
      // when what it reads cannot be told, nothing is proven lost.
      const reads = def.readsProps;
      if (!reads) continue;
      const passed = given.find((p) => !reads.includes(p));
      if (!passed) continue;
      findings.push({
        criteriaId: "4.1.2",
        el,
        msgId: "cross-prop-drilled-name-lost",
        params: { tag: el.tag, passed, defName: def.name },
        related: {
          file: def.file,
          line: def.line,
          col: def.col,
          selectorHint: def.name,
          note: NOTE_CATALOG["related.name-drop-def"]!.en,
          noteId: "related.name-drop-def",
        },
      });
    }
    return { findings, suppress: [] };
  },
};

// 6) An aria-*by / aria-controls reference whose target id is defined in ANOTHER file of
//    the graph → suppress the single-file aria-ref-missing-id false positive. Conservative:
//    suppress only when EVERY in-page-missing id on the element resolves elsewhere, so a
//    genuinely-dangling reference is never hidden.
const ARIA_IDREFS = [
  "aria-labelledby",
  "aria-describedby",
  "aria-controls",
  "aria-owns",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "aria-activedescendant",
];
const crossAriaRefCrossFile: CrossRule = {
  id: "cross-aria-ref-cross-file",
  criteria: ["4.1.2"],
  severity: "majeur",
  run(doc, graph) {
    const suppress: Suppression[] = [];
    for (const el of doc.elements) {
      const missing: string[] = [];
      for (const a of ARIA_IDREFS) {
        const v = (attr(el, a) ?? "").trim();
        if (!v || v.includes("{")) continue; // dynamic JSX expression — not a literal id list
        for (const id of v.split(/\s+/).filter(Boolean)) if (!doc.byId.has(id)) missing.push(id);
      }
      if (!missing.length) continue; // the single-file rule won't fire on this element
      if (missing.every((id) => idDefinedAnywhere(graph, id)))
        suppress.push({ ruleId: "aria-ref-missing-id", line: el.line, reason: "cible(s) définie(s) dans un autre fichier du graphe" });
    }
    return { findings: [], suppress };
  },
};

// 7) A <label for="x"> or an empty heading named via aria-labelledby whose target id lives
//    in ANOTHER file of the graph → suppress the single-file label-for-dangling /
//    empty-heading false positive (the field / label is rendered by an imported component).
//    Mirrors cross-aria-ref-cross-file's conservatism: only when the id resolves elsewhere.
const HEADING_TAG = /^h[1-6]$/;
const crossNameRefCrossFile: CrossRule = {
  id: "cross-name-ref-cross-file",
  criteria: ["1.3.1"],
  severity: "majeur",
  run(doc, graph) {
    const suppress: Suppression[] = [];
    for (const el of doc.elements) {
      if (el.tag === "label") {
        const f = (attr(el, "for") ?? "").trim();
        if (f && !f.includes("{") && !doc.byId.has(f) && idDefinedAnywhere(graph, f))
          suppress.push({ ruleId: "label-for-dangling", line: el.line, reason: `cible #${f} définie dans un autre fichier du graphe` });
      }
      const isHeading = HEADING_TAG.test(el.tag) || (attr(el, "role") ?? "") === "heading";
      if (isHeading) {
        const lb = (attr(el, "aria-labelledby") ?? "").trim();
        const ids = lb.includes("{") ? [] : lb.split(/\s+/).filter(Boolean);
        if (ids.length && ids.every((id) => !doc.byId.has(id) && idDefinedAnywhere(graph, id)))
          suppress.push({ ruleId: "empty-heading", line: el.line, reason: "intitulé fourni par un aria-labelledby défini dans un autre fichier" });
      }
    }
    return { findings: [], suppress };
  },
};

export const CROSS_RULES: CrossRule[] = [
  crossIconOnlyUnnamed,
  crossPageLang,
  crossAriaForwarding,
  crossSkipLinkTarget,
  crossPropDrilledNameLost,
  crossAriaRefCrossFile,
  crossNameRefCrossFile,
];

/** Rule ids that can raise a finding (for dataset/registry cross-checks). Suppressors
 *  raise none and are intentionally excluded. */
export function crossRuleIds(): string[] {
  return ["cross-icon-only-unnamed", "cross-prop-drilled-name-lost"];
}

export interface CrossRunResult {
  findings: Finding[];
  suppress: Suppression[];
}

export function runCrossRules(doc: Doc, graph: DepGraph): CrossRunResult {
  const findings: Finding[] = [];
  const suppress: Suppression[] = [];
  for (const rule of CROSS_RULES) {
    const r = rule.run(doc, graph);
    for (const cf of r.findings) findings.push(crossToFinding(doc, rule.id, rule.severity, cf));
    suppress.push(...r.suppress);
  }
  findings.sort((a, b) => a.line - b.line || a.col - b.col || SEVERITY_ORDER[a.severity]! - SEVERITY_ORDER[b.severity]!);
  return { findings, suppress };
}

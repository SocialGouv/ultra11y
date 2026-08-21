// The bounded interpreter for a pack's declarative RULES (src/standards/types.ts
// `PackRule`). It runs AFTER the core engine rules in the audit pipeline (src/audit.ts
// foldDoc) over the SAME parsed Doc, and turns each matching element into a namespaced
// `pack:<packKey>:<id>` Finding. There is NO code path here that executes pack-supplied
// code — a rule is pure data (tag / attribute / visible-text predicates + bounded
// descendant conditions), so a `--pack`-loaded pack stays fully validatable (see
// validatePack) and can never run arbitrary logic.
import type { El, Doc } from "../parse/html.js";
import { descendants, visibleText, snippet as sourceSnippet } from "../parse/html.js";
import { isFullDocument, selectorOf } from "../rules/rule.js";
import type { Finding } from "../types.js";
import type { StandardPack, PackRule, MatchDoc, MatchNode, MatchAttr, MatchText } from "./types.js";

// Mirrors the validator's depth cap (src/standards/validate.ts MAX_MATCH_DEPTH): a
// registered pack is already validated, so the interpreter never sees over-deep nesting —
// this is a defensive belt only.
const MAX_MATCH_DEPTH = 3;

// Compile the (already ReDoS-validated) regexes case-insensitively, memoized per pattern
// so a rule's regex is built once, not once per element.
const regexCache = new Map<string, RegExp>();
function compile(pattern: string): RegExp {
  let re = regexCache.get(pattern);
  if (!re) {
    re = new RegExp(pattern, "i");
    regexCache.set(pattern, re);
  }
  return re;
}

function matchAttr(el: El, a: MatchAttr): boolean {
  const v = el.attribs[a.name.toLowerCase()];
  switch (a.op) {
    case "present":
      return v !== undefined;
    case "absent":
      return v === undefined;
    case "equals":
      return v !== undefined && v === a.value;
    case "matches":
      return v !== undefined && a.value !== undefined && compile(a.value).test(v);
    default:
      return false;
  }
}

function matchText(el: El, t: MatchText): boolean {
  const text = visibleText(el);
  const hit = compile(t.value).test(text);
  return t.op === "matches" ? hit : !hit;
}

function matchNode(el: El, node: MatchNode, depth: number): boolean {
  if (depth > MAX_MATCH_DEPTH) return false;
  if (node.tag && el.tag.toLowerCase() !== node.tag.toLowerCase()) return false;
  if (node.attrs && !node.attrs.every((a) => matchAttr(el, a))) return false;
  if (node.text && !matchText(el, node.text)) return false;
  // `has`: every listed sub-condition must match SOME descendant.
  if (node.has || node.lacks) {
    const desc = descendants(el);
    if (node.has && !node.has.every((sub) => desc.some((d) => matchNode(d, sub, depth + 1)))) return false;
    // `lacks`: NO listed sub-condition may match ANY descendant.
    if (node.lacks && node.lacks.some((sub) => desc.some((d) => matchNode(d, sub, depth + 1)))) return false;
  }
  return true;
}

function toFinding(doc: Doc, el: El, rule: PackRule, packKey: string): Finding {
  // Canonical English bake per the Finding contract (message = AI-facing English); the
  // validator guarantees both en + fr are present. The localized {en,fr} pair also rides
  // on `i18n` so a renderer at `--lang fr` resolves the French text (src/messages.ts
  // resolveMessage), rather than falling back to this English bake.
  const message = rule.message.en ?? rule.message.fr ?? rule.id;
  const remediation = rule.remediation.en ?? rule.remediation.fr ?? "";
  return {
    ruleId: `pack:${packKey}:${rule.id}`,
    criteriaId: rule.wcag[0]!,
    file: doc.file,
    line: el.line,
    col: el.col,
    selectorHint: selectorOf(el),
    severity: rule.severity,
    message,
    remediation,
    snippet: sourceSnippet(doc, el),
    sourceStart: el.start,
    sourceEnd: el.end,
    i18n: {
      message: { en: rule.message.en, fr: rule.message.fr },
      remediation: { en: rule.remediation.en, fr: rule.remediation.fr },
    },
    // Capture provenance, exactly as src/rules/rule.ts does it — keep the three constructors in
    // step. A pack finding that skips this stays unattributed, so `pageView`'s
    // `packFindings.filter(f => f.page === page.id)` (src/pages.ts) yields nothing and a pack rule
    // can be NC in the report while reaching no cell of the per-page grid.
    ...(doc.capture ? { origin: { capture: doc.file, sourceFile: doc.capture.sourceFile, component: doc.capture.component } } : {}),
    ...(doc.capture?.page ? { page: doc.capture.page } : {}),
    ...(rule.advisory ? { advisory: true } : {}),
  };
}

/** The value a document-level signal holds on this doc, or `undefined` when the doc does not
 *  carry it at all — a source file, or a capture written before the field existed.
 *
 *  `undefined` is the load-bearing return. It is NOT the empty string: « the collector looked
 *  and the page had none » and « nobody ever looked » are different claims, and only the first
 *  is evidence. Everything downstream — whether the rule fires, and whether it may claim to
 *  have measured this page — hangs off that distinction. */
function docSignal(doc: Doc, signal: MatchDoc["signal"]): string | undefined {
  switch (signal) {
    case "doctype":
      return doc.signals?.doctype;
    default:
      return undefined;
  }
}

/** Did this document-level rule RUN here? Only when the signal it reads is present. Exported
 *  because the audit fold records it as page coverage (src/audit.ts), and `measuredRescue`
 *  then reads that coverage to decide whether silence means conformity — so a rule that
 *  declined must never be credited. */
export function docRuleRan(doc: Doc, rule: PackRule): boolean {
  return rule.doc !== undefined && docSignal(doc, rule.doc.signal) !== undefined;
}

function matchDoc(value: string, d: MatchDoc): boolean {
  switch (d.op) {
    // The recorded empty string: the collector looked, and the page declared nothing.
    case "absent":
      return value === "";
    case "matches":
      return d.value !== undefined && compile(d.value).test(value);
    case "lacks":
      return d.value !== undefined && !compile(d.value).test(value);
    default:
      return false;
  }
}

/** Run every declarative rule of `pack` over `doc`, returning the namespaced findings
 *  (empty when the pack ships no rules). Standard-agnostic: the audit pass runs this for
 *  every registered pack; each pack's findings surface only in ITS OWN projection. */
export function runPackRules(doc: Doc, pack: StandardPack): Finding[] {
  const rules = pack.rules;
  if (!rules || rules.length === 0) return [];
  const out: Finding[] = [];
  const fullDoc = isFullDocument(doc);
  for (const rule of rules) {
    // A DOCUMENT-level rule: no element to select, so it is asked once and anchors its finding
    // on the root. It declines outright on a doc that does not carry its signal.
    if (rule.doc) {
      const value = docSignal(doc, rule.doc.signal);
      if (value === undefined) continue;
      const root = doc.elements[0];
      if (root && matchDoc(value, rule.doc)) out.push(toFinding(doc, root, rule, pack.key));
      continue;
    }
    if (!rule.match) continue;
    if (rule.match.scope === "page" && !fullDoc) continue;
    for (const el of doc.elements) {
      if (matchNode(el, rule.match, 1)) out.push(toFinding(doc, el, rule, pack.key));
    }
  }
  return out;
}

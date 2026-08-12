// Contract for cross-file rules. Unlike a single-file Rule (which sees one Doc),
// a CrossRule also sees the dependency graph, and can BOTH raise findings (anchored
// at a usage site, with the related definition site attached) AND suppress
// single-file findings that the graph proves are false positives (e.g. a skip-link
// target that lives in an imported layout). Cross findings fold into the same
// Finding/AuditResult as everything else.
import type { Doc, El } from "../parse/html.js";
import type { Finding, Severity } from "../types.js";
import { snippet } from "../parse/html.js";
import { selectorOf } from "./rule.js";
import { MSG_CATALOG, type MsgParams } from "../messages.js";
import type { DepGraph } from "../graph/graph.js";

export interface RelatedSite {
  file: string;
  line: number;
  col: number;
  selectorHint: string;
  // Canonical baked ENGLISH prose (mirrors Finding.message/remediation); `noteId` is an
  // optional key into src/messages.ts's NOTE_CATALOG, resolved at render time by
  // `resolveNote` — see types.ts `Finding.related` for the full contract.
  note: string;
  noteId?: string;
}

export interface CrossFinding {
  criteriaId: string;
  el: El; // anchor (the usage site) for line/col/snippet/selector
  /** catalog key into MSG_CATALOG (src/messages.ts) — mirrors RuleFinding.msgId. */
  msgId: string;
  params?: MsgParams;
  severity?: Severity;
  selectorHint?: string;
  related?: RelatedSite; // the OTHER site (definition) that explains the finding
}

// Drop a single-file finding the graph proves is a false positive. Matched on the
// same Doc by ruleId + anchor line.
export interface Suppression {
  ruleId: string;
  line: number;
  reason: string;
}

export interface CrossRuleResult {
  findings: CrossFinding[];
  suppress: Suppression[];
}

export interface CrossRule {
  id: string;
  criteria: string[];
  severity: Severity;
  run(doc: Doc, graph: DepGraph): CrossRuleResult;
}

/** Normalise a CrossFinding into a Finding (mirrors rule.ts toFinding, plus related). */
export function crossToFinding(doc: Doc, ruleId: string, def: Severity, cf: CrossFinding): Finding {
  const entry = MSG_CATALOG[cf.msgId];
  if (!entry) {
    throw new Error(`crossToFinding: msgId "${cf.msgId}" (rule "${ruleId}") is not in MSG_CATALOG — add it to src/messages.ts.`);
  }
  const params = cf.params ?? {};
  return {
    ruleId,
    criteriaId: cf.criteriaId,
    file: doc.file,
    line: cf.el.line,
    col: cf.el.col,
    selectorHint: cf.selectorHint ?? selectorOf(cf.el),
    severity: cf.severity ?? def,
    message: entry.message.en(params),
    remediation: entry.remediation.en(params),
    msg: cf.params ? { id: cf.msgId, params: cf.params } : { id: cf.msgId },
    snippet: snippet(doc, cf.el),
    ...(doc.lossy ? {} : { sourceStart: cf.el.start, sourceEnd: cf.el.end }),
    // Mirror toFinding: an SFC/lossy-JSX source is less trustworthy (slots/dynamic content /
    // regex transform), so its cross-file findings are provisional too — otherwise a cross
    // finding reads as definitive while the per-doc findings in the same file are preliminary.
    ...(doc.kind === "sfc" || doc.kind === "jsx-lossy" ? { preliminary: true } : {}),
    // Capture provenance, exactly as src/rules/rule.ts does it. No cross rule can reach a page
    // snapshot today (the two that raise findings resolve through the component graph, and a
    // serialized DOM has no node in it), so this changes no current output — it is here so the
    // three Finding constructors stay in step, and a cross rule that later does become reachable
    // on a full document is attributed like everything else instead of silently orphaned.
    ...(doc.capture ? { origin: { capture: doc.file, sourceFile: doc.capture.sourceFile, component: doc.capture.component } } : {}),
    ...(doc.capture?.page ? { page: doc.capture.page } : {}),
    ...(cf.related ? { related: cf.related } : {}),
  };
}

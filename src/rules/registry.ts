// The rule registry: the complete static surface of the engine. runRules walks
// every applicable rule over a parsed Doc and returns normalised Findings,
// sorted by source position. Page-scoped rules skip fragments/components.
import type { Doc } from "../parse/html.js";
import type { Finding } from "../types.js";
import { type Rule, toFinding, isFullDocument } from "./rule.js";
import { imagesRules } from "./images.js";
import { framesRules } from "./frames.js";
import { scriptsAriaRules } from "./scripts-aria.js";
import { mandatoryRules } from "./mandatory.js";
import { headingsRules } from "./headings.js";
import { tablesRules } from "./tables.js";
import { linksRules } from "./links.js";
import { formsRules } from "./forms.js";
import { navigationRules } from "./navigation.js";
import { multimediaRules } from "./multimedia.js";
import { presentationRules } from "./presentation.js";
import { colorsRules } from "./colors.js";
import { renderedRules } from "./rendered.js";
import { timingRules } from "./timing.js";

export const ALL_RULES: Rule[] = [
  ...colorsRules,
  ...renderedRules,
  ...imagesRules,
  ...framesRules,
  ...scriptsAriaRules,
  ...mandatoryRules,
  ...headingsRules,
  ...tablesRules,
  ...linksRules,
  ...formsRules,
  ...navigationRules,
  ...multimediaRules,
  ...presentationRules,
  ...timingRules,
];

const SEVERITY_ORDER: Record<string, number> = { bloquant: 0, majeur: 1, mineur: 2 };

export function ruleById(id: string): Rule | undefined {
  return ALL_RULES.find((r) => r.id === id);
}

export function ruleIds(): string[] {
  return ALL_RULES.map((r) => r.id);
}

export function runRules(doc: Doc, only?: Set<string>): Finding[] {
  const out: Finding[] = [];
  const fullDoc = isFullDocument(doc);
  for (const rule of ALL_RULES) {
    if (only && !only.has(rule.id)) continue;
    if (rule.scope === "page" && !fullDoc) continue;
    for (const rf of rule.run(doc)) out.push(toFinding(doc, rule.id, rule.severity, rf, rule.advisory));
  }
  out.sort((a, b) => a.line - b.line || a.col - b.col || SEVERITY_ORDER[a.severity]! - SEVERITY_ORDER[b.severity]!);
  return out;
}

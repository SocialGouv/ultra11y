// The SC-keyed adjudication protocol, on its own.
//
// `src/data/adjudication.json` (built by scripts/build-adjudication.mjs) states, for every
// criterion the static engine cannot settle, the rule that decides Conforming vs
// Non-conforming, when NA is legitimate, and the questions that get you there. It is the
// substitute for W3C's Understanding prose, which this repo deliberately does not vendor.
//
// It used to be reachable only through src/adjudicate.ts — which imports the discovery
// walker, the HTML parser and the PRD renderer. A criterion LOOKUP needs the protocol and
// none of that, so the dataset and its accessor live here and adjudicate.ts imports them.
import adjudicationJson from "./data/adjudication.json";
import type { Lang } from "./types.js";

export type LocaleText = { fr: string; en: string };

export interface AdjudicationProtocol {
  decide: LocaleText;
  na?: LocaleText;
  questions: LocaleText[];
}

export const ADJUDICATION = adjudicationJson as Record<string, AdjudicationProtocol>;

/** The protocol for a WCAG success criterion, or undefined when the engine settles it. */
export function adjudicationFor(sc: string): AdjudicationProtocol | undefined {
  return ADJUDICATION[sc];
}

/** The protocol in one language — the shape a reference lookup hands back. */
export function adjudicationText(sc: string, lang: Lang): { decide: string; na?: string; questions: string[] } | undefined {
  const p = ADJUDICATION[sc];
  if (!p) return undefined;
  return {
    decide: p.decide[lang],
    ...(p.na ? { na: p.na[lang] } : {}),
    questions: p.questions.map((q) => q[lang]),
  };
}

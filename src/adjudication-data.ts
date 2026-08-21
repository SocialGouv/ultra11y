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

export interface InheritedProtocol {
  /** The WCAG success criterion the protocol belongs to. Never dropped: a country
   *  standard's criterion is not the SC it maps onto, and a rule borrowed through the
   *  crosswalk has to say where it came from. */
  sc: string;
  decide: string;
  na?: string;
  questions: string[];
}

/** The protocols of the WCAG success criteria a PACK criterion maps onto, in mapping order.
 *
 *  `ADJUDICATION` is keyed by success criterion — three segments — and a country standard's
 *  ids have two, so a direct lookup on a pack criterion can only ever miss. This is the
 *  crosswalk, and it exists in one place because two surfaces need it and they must not
 *  disagree: the criterion lookup (src/criteria-view.ts) and the adjudication brief
 *  (src/adjudicate.ts).
 *
 *  It is a FALLBACK, never a substitute. An SC often asks a broader question than the pack
 *  criterion mapped onto it, so whoever renders this must present it as inherited — see
 *  `resolveGuidance` in src/guidance/resolve.ts, which carries the same discipline for
 *  implementation examples. */
export function adjudicationForWcagRefs(scs: readonly string[], lang: Lang): InheritedProtocol[] {
  const out: InheritedProtocol[] = [];
  for (const sc of scs) {
    const p = adjudicationText(sc, lang);
    if (p) out.push({ sc, ...p });
  }
  return out;
}

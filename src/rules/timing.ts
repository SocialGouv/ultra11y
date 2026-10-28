// Theme 13 — Timing & moving content (the statically-checkable slice): timed meta
// refresh/redirect (WCAG 2.2.1) and the legacy <blink>/<marquee> auto-motion (2.2.2).
import type { Doc } from "../parse/html.js";
import { attr } from "../parse/html.js";
import type { Rule, RuleFinding } from "./rule.js";

// HTML "shared declarative refresh steps": optional whitespace, digits (or a leading dot),
// any further digits/dots, then end of input or `;` `,` whitespace. Anything else aborts.
const SPEC_PARSEABLE_REFRESH = /^[\t\n\f\r ]*(?:\d|\.)[\d.]*(?:[\t\n\f\r ;,]|$)/;

const metaRefreshRedirect: Rule = {
  id: "meta-refresh-redirect",
  criteria: ["2.2.1"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    // Only the FIRST `http-equiv="refresh"` the browser can PARSE takes effect; any later one
    // never runs, so reporting it would be a defect that cannot happen. An unparseable one
    // (`content="0: https://…"`) is skipped by the HTML refresh steps without claiming the
    // document, so the next one still runs. "Parseable" is the spec's lenient reading (a
    // run of digits/dots, then a separator) — wider than what this rule REPORTS on below,
    // so a directive the browser would honour is never skipped over.
    const first = doc.elements.find(
      (e) => e.tag === "meta" && (attr(e, "http-equiv") ?? "").toLowerCase() === "refresh" && SPEC_PARSEABLE_REFRESH.test(attr(e, "content") ?? ""),
    );
    for (const el of first ? [first] : []) {
      const content = (attr(el, "content") ?? "").trim();
      // The delay must be a bare non-negative integer. `+5`, `-5` and `5.5` are invalid
      // per the HTML parsing rules, so the browser ignores the directive entirely —
      // Number.parseInt would happily read "+5" as 5 and invent a time limit.
      if (!/^\d+\s*(?:[;,]|$)/.test(content)) continue;
      const seconds = Number.parseInt(content, 10);
      if (!Number.isFinite(seconds) || seconds <= 0) continue; // non-numeric / instant (0s) handled elsewhere
      if (seconds > 72000) continue; // WCAG 2.2.1 exception: a time limit longer than 20 hours is exempt
      out.push({
        criteriaId: "2.2.1",
        el,
        msgId: "meta-refresh-redirect",
        params: { content, seconds },
      });
    }
    return out;
  },
};

const blinkMarquee: Rule = {
  id: "blink-marquee",
  criteria: ["2.2.2"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (el.tag !== "blink" && el.tag !== "marquee") continue;
      out.push({
        criteriaId: "2.2.2",
        el,
        msgId: "blink-marquee",
        params: { tag: el.tag },
      });
    }
    return out;
  },
};

export const timingRules: Rule[] = [metaRefreshRedirect, blinkMarquee];

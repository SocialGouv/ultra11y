// Theme 2 — Frames.
import type { Doc, El } from "../parse/html.js";
import { attr, hasBoundAttr } from "../parse/html.js";
import { isNameExempt } from "../name.js";
import type { Rule, RuleFinding } from "./rule.js";

const iframeTitleMissing: Rule = {
  id: "iframe-title-missing",
  criteria: ["4.1.2"],
  severity: "bloquant",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (el.tag !== "iframe") continue;
      if (isNameExempt(el)) continue; // not exposed, or explicitly presentational
      const title = (attr(el, "title") ?? "").trim();
      const aria = (attr(el, "aria-label") ?? "").trim();
      // aria-labelledby is the highest-precedence accname source. A present value names the
      // frame; whether its ids resolve is aria-ref-missing-id's job, not a second "no title".
      const labelledby = (attr(el, "aria-labelledby") ?? "").trim();
      if (title || aria || labelledby) continue;
      if (hasBoundAttr(el, "aria-labelledby")) continue; // dynamic :aria-labelledby / aria-labelledby={x}
      out.push({
        criteriaId: "4.1.2",
        el: el as El,
        msgId: "iframe-title-missing",
      });
    }
    return out;
  },
};

export const framesRules: Rule[] = [iframeTitleMissing];

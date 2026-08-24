// THE RULING RULES, IN ONE PLACE — the clauses every adjudicator is held to, whichever
// harness it runs in.
//
// They used to exist twice, and the two copies had drifted in BOTH directions:
//
//   • `VERDICT_RULES` (the orchestrate contracts) carried « an NC shaped like an absence is
//     still anchored » and « the rendered page may be on disk ». The Messages-API `SYSTEM`
//     did not. Those are the two rules measured to cost criteria on real runs — 12.1 and
//     12.5 came back `NC` with no `file`, and rendering criteria came back
//     `needs-rendered-dom` over captures that were sitting on disk.
//   • `SYSTEM` carried « rule only on the criteria presented, never introduce another ». The
//     contracts did not, and a surplus verdict is refused by the fold.
//
// So neither was the better copy: each was missing something the other had, and nothing made
// them meet. They are one source now, and `tests/verdict-rules-sync.test.ts` fails if a
// surface stops carrying a clause.
//
// The clauses are held as SEPARATE strings rather than one blob because the two surfaces
// number them differently — the contracts embed them after a « read the brief » step, the
// system prompt starts at one.

/** The four verdict kinds and the field each one REQUIRES to fold. */
export const VERDICT_KINDS = `Rule it (the apply gate is FAIL-CLOSED — a verdict missing its required field does not fold, and its criterion goes back to « to assess » carrying the refusal):
   - \`C\` (conforming) — REQUIRES \`justification\` explaining why the evidence satisfies the criterion, AND \`citations[]\` naming the evidence you cleared (\`file\`/\`line\` copied VERBATIM from this criterion's own evidence; an anchor that is not in that list is treated as fabricated). A criterion presented with NO evidence at all cannot be \`C\` — it is \`manual\` (\`undecidable\`), or \`NA\` if nothing in scope is concerned.
   - \`NC\` (non-conforming) — REQUIRES \`findings\`: at least one groundable \`{ file, line, selector?, message, snippet?, severity?, normativeRef }\` pointing at REAL source. The fold re-grounds every finding; an invented file:line is rejected, and so is a finding with no \`file\` at all. \`normativeRef\` MUST cite the precise failed test — under a country standard, one of the criterion's OWN numbered tests, listed in its brief under « tests to rule on ». A WCAG id looks alike, denotes an unrelated test, and is rejected.
   - \`NA\` (not applicable) — REQUIRES \`justification\`, AND \`citations[]\` whenever evidence WAS presented, to say which of those items fall outside the criterion's scope.
   - \`manual\` (still undecidable) — REQUIRES \`reason\`: \`needs-rendered-dom\` (only a rendered DOM can decide it, and no capture in this run carries its subject) or \`undecidable\` (the evidence cannot settle it either way).`;

/** An absence is observed somewhere. Measured: 12.1 and 12.5 lost to this on one run. */
export const ABSENCE_RULE = `AN NC SHAPED LIKE AN ABSENCE IS STILL ANCHORED. « No second navigation system », « no search engine », « no error message suggests the expected format » — an absence is OBSERVED somewhere: cite the element and the page you observed it on. And when the criterion's subject exists nowhere in the audited scope, the verdict is \`NA\` with its justification, never \`NC\`.`;

/** `needs-rendered-dom` is a claim about the RUN, not a way out of a hard criterion. */
export const CAPTURE_RULE = `THE RENDERED PAGE MAY BE ON DISK. When a criterion's evidence is anchored under \`.ultra11y/pages/<id>/\`, the browser already ran: \`dom.html\`, \`styles.json\`, \`boxes.json\`, \`axtree.json\` and \`screen.png\` are there to read. \`needs-rendered-dom\` is refused on such a criterion — decide it from those files, or answer \`undecidable\` and say what the capture does not settle.`;

/** An honest `manual` outranks a verdict the gate throws away. */
export const NEVER_GUESS_RULE = `Never guess. A criterion you cannot decide from real evidence stays \`manual\` with its reason — that is a valid, honest verdict, and it is worth more than a verdict the gate throws away.`;

/** A surplus verdict overwrites something the engine already decided, so the fold refuses it. */
export const SCOPE_RULE = `Rule ONLY on the criteria presented. Never introduce another — a verdict for a criterion nobody asked about is dropped, and under the fold it would otherwise overwrite what the deterministic engine already decided.`;

/** The clauses in the order every surface states them, after the verdict kinds. */
const TAIL = [ABSENCE_RULE, CAPTURE_RULE, NEVER_GUESS_RULE, SCOPE_RULE];

/** Render the rules as a numbered Markdown list starting at `startAt`.
 *
 *  The contracts embed them after a « read the brief in full » step, so they start at 2; a
 *  system prompt starts at 1. The numbering is the ONLY thing that varies between surfaces —
 *  keep it that way. */
export function verdictRulesMd(startAt: number): string {
  const lines = [`${startAt}. ${VERDICT_KINDS}`];
  TAIL.forEach((rule, i) => lines.push(`${startAt + 1 + i}. ${rule}`));
  return lines.join("\n");
}

/** The system prompt the model-facing backends send. Same clauses, own framing.
 *
 *  The framing sentence is what a system prompt has and a contract document does not: it says
 *  WHO the model is and what the criteria in front of it are. Everything normative below it
 *  comes from the shared clauses. */
export function verdictSystemPrompt(): string {
  return `You are an accessibility auditor ruling on the criteria a static engine could not decide.

NEVER assert conformity you did not verify. \`manual\` with a reason is always available and is always a correct answer.

Rules, in order of importance:
${verdictRulesMd(1)}`;
}

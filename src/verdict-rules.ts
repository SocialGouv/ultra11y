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

/** The worklist, not the run-level tally, is the source of truth for what remains to rule.
 *
 *  Measured on the realworld fixture: the agent left 17 items blank because their decisive
 *  failures already made the run-wide grid NC. Those items were deliberately present because
 *  other page cells were still open; the run finished 106/106 globally and failed every page. */
export const WORKLIST_RULE = `THE WORKLIST IS THE RESIDUAL. Return exactly one verdict for EVERY criterion presented — never omit an item because the engine already reported a run-wide \`NC\`. The strict page gate deliberately puts such a criterion back on the worklist when page-level cells remain open. It is not surplus and it is not already resolved for this task: inspect the complete evidence and rule it. If the evidence cannot settle it, return \`manual\` with a reason; never leave its verdict blank.`;

/** An absence is observed somewhere. Measured: 12.1 and 12.5 lost to this on one run. */
export const ABSENCE_RULE = `AN NC SHAPED LIKE AN ABSENCE IS STILL ANCHORED. « No second navigation system », « no search engine », « no error message suggests the expected format » — an absence is OBSERVED somewhere: cite the element and the page you observed it on. And when the criterion's subject exists nowhere in the audited scope, the verdict is \`NA\` with its justification, never \`NC\`.

AND CITE FROM THIS CRITERION'S OWN ANCHORS, NOT THE THING YOU ARE RULING OUT. An absence pulls you toward the element you are arguing ABOUT — the search form that is not a site search engine, the menu that is not a second navigation system — and that element is, precisely because it is off-topic, absent from what this criterion was harvested. A citation on one of the criterion's own anchors is vouched for by the harvest; one outside it has its snippet verified LITERALLY, character for character, and a retyping then fails. Cite the region you inspected — the \`header\`, the \`nav\`, the \`footer\` the brief listed — and say in the justification what you did not find in it.`;

/** `needs-rendered-dom` is a claim about the RUN, not a way out of a hard criterion. */
export const CAPTURE_RULE = `THE RENDERED PAGE MAY BE ON DISK. When a criterion's evidence is anchored under \`.ultra11y/pages/<id>/\`, the browser already ran: \`dom.html\`, \`styles.json\`, \`boxes.json\`, \`axtree.json\` and \`screen.png\` are there to read. \`needs-rendered-dom\` is refused on such a criterion — decide it from those files, or answer \`undecidable\` and say what the capture does not settle.`;

/** An honest `manual` outranks a verdict the gate throws away. */
export const NEVER_GUESS_RULE = `Never guess. A criterion you cannot decide from real evidence stays \`manual\` with its reason — that is a valid, honest verdict, and it is worth more than a verdict the gate throws away.`;

/** A surplus verdict overwrites something the engine already decided, so the fold refuses it. */
export const SCOPE_RULE = `Rule ONLY on the criteria presented. Never introduce another — a verdict for a criterion nobody asked about is dropped, and under the fold it would otherwise overwrite what the deterministic engine already decided.`;

/** A `C` is now attacked too, and the adjudicator has to know the standard it will be held to.
 *
 *  Until conformities entered the verify worklist, nothing ever challenged one: a criterion
 *  cleared because its subject was PRESENT rather than because it was RIGHT sailed through, and
 *  shipped as an accessibility claim. Saying so up front is cheaper than refuting it later —
 *  and it is the same bar the criterion's own wording sets. */
export const CONFORMITY_RULE = `A \`C\` WILL BE ATTACKED, exactly as an \`NC\` is. Every conformity you record goes into an adversarial worklist where a second reader opens your citations and asks whether they ESTABLISH the criterion or merely show that its subject exists — a present \`alt\` is not a relevant \`alt\`, a present \`<title>\` is not a title that describes the page. Cite the evidence that answers the criterion's own question, and when the evidence only proves presence, the honest verdict is \`manual\`.`;

/** The clauses in the order every surface states them, after the verdict kinds. */
const TAIL = [WORKLIST_RULE, ABSENCE_RULE, CAPTURE_RULE, NEVER_GUESS_RULE, SCOPE_RULE, CONFORMITY_RULE];

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

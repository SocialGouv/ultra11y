import { TOOLS, WRITE_TOOLS } from "./tools.js";

// The workflows, as MCP prompts.
//
// Tools are the half of this skill a client can discover on its own. The other
// half is the coverage arithmetic: of the 55 WCAG 2.2 AA success criteria, the
// static engine decides a handful, a real browser decides fourteen, and the
// remaining thirty-eight are judgment calls only the model can make. A client
// handed the audit tool and no protocol runs it, sees no errors, and reports
// the page as accessible — which is a false conformance claim, the one output
// an accessibility tool must never produce.
//
// Each prompt says three things, in this order: the contract, the exact tool
// sequence, and what the gate does on failure.

export interface PromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface PromptDecl {
  name: string;
  title?: string;
  description: string;
  arguments: PromptArgument[];
}

export interface PromptMessage {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
}

export interface PromptResult {
  description: string;
  messages: PromptMessage[];
}

export class PromptError extends Error {}

const cwdArg: PromptArgument = { name: "cwd", description: "Absolute path to the project root.", required: true };

export const PROMPTS: PromptDecl[] = [
  {
    name: "audit_wcag",
    title: "Audit a project against WCAG 2.2 AA",
    description:
      "The full conformance workflow: run the static engine, adjudicate the criteria it cannot decide, name the ones only a browser can settle, and produce " +
      "a dated report whose coverage is stated rather than implied.",
    arguments: [
      cwdArg,
      { name: "globs", description: "What to audit, comma-separated (default: the project's markup).", required: false },
      { name: "standard", description: "wcag (default) or rgaa.", required: false },
    ],
  },
  {
    name: "adjudicate_criteria",
    title: "Decide the criteria the engine cannot",
    description:
      "The judgment workflow: work the adjudication queue — alt-text relevance, link purpose in context, heading structure, reading order — by reading the " +
      "real markup, not by pattern-matching the element.",
    arguments: [cwdArg, { name: "standard", description: "wcag (default) or rgaa.", required: false }],
  },
  {
    name: "review_diff_a11y",
    title: "Review a diff for accessibility",
    description:
      "The review workflow: audit exactly the code under change, refute the false positives, and report what this diff introduces — not the project's whole " +
      "accessibility backlog.",
    arguments: [cwdArg, { name: "since", description: "The git ref to diff against (default: the staged changes).", required: false }],
  },
];

export function getPrompt(name: string, args: Record<string, unknown> = {}): PromptResult {
  const decl = PROMPTS.find((p) => p.name === name);
  if (!decl) throw new PromptError(`unknown prompt: ${name || "(none given)"}`);

  for (const arg of decl.arguments) {
    if (arg.required && !str(args[arg.name])) throw new PromptError(`\`${arg.name}\` is required for prompt "${name}"`);
  }

  const text = name === "audit_wcag" ? auditWcag(args) : name === "adjudicate_criteria" ? adjudicateCriteria(args) : reviewDiff(args);
  return { description: decl.description, messages: [{ role: "user", content: { type: "text", text } }] };
}

// The rule every workflow here rests on. Stated once, quoted into each prompt,
// so the two can never drift apart.
const CORE_RULE = `A criterion nobody tested is UNTESTED, never conformant. The static engine decides only a handful of the 55 WCAG 2.2 AA criteria; fourteen need a real browser and thirty-eight need your judgment. Never write that a criterion passes because the tool did not flag it, and never invent a non-conformity the evidence does not show.`;

const GATE = `\`ultra11y_check\` returning \`ok: false\` is a VERDICT, not a tool failure. It means the report claims more than the evidence carries — usually a criterion asserted conformant that was never actually tested. Fix the claim, not the gate.`;

function auditWcag(args: Record<string, unknown>): string {
  const cwd = str(args.cwd)!;
  const globs = str(args.globs);
  const standard = str(args.standard);

  return `Audit \`${cwd}\` against ${standard === "rgaa" ? "RGAA" : "WCAG 2.2 AA"}${globs ? `, over \`${globs}\`` : ""}.

${CORE_RULE}

**Sequence:**

1. \`ultra11y_audit\`${globs ? ` with \`globs: ["${globs}"]\`` : ""} — the static pass. Add \`graph: true\` for a component codebase, where a label is routinely defined in a different file from the input it names.
2. \`ultra11y_adjudicate\` — the queue of criteria the engine cannot decide. This is most of WCAG, and skipping it is what turns an audit into a lint run.
3. For each item: \`ultra11y_read\` the real markup around it and rule on it. \`ultra11y_criteria\` when you need the criterion's exact wording — look it up rather than recalling it, which is how invented non-conformities get written.
4. \`ultra11y_report\`${standard ? ` with \`standard: "${standard}"\`` : ""} for the dated conformance report.
5. \`ultra11y_check\` on what you wrote.

**Say what you did not test.** The rendering criteria — contrast, focus visibility, zoom, reflow, hover, target size — cannot be decided from source. They need \`ultra11y scan\` in a real browser, from the CLI. A report that omits them silently reads as a clean bill of health for the very criteria most likely to fail.

**Then \`ultra11y_prd\`** to turn the non-conformities into work a team can pick up, with the fix and the effort per unit.

${GATE}`;
}

function adjudicateCriteria(args: Record<string, unknown>): string {
  const cwd = str(args.cwd)!;
  const standard = str(args.standard);

  return `Work the adjudication queue for \`${cwd}\`${standard ? ` against ${standard}` : ""}.

${CORE_RULE}

**Sequence:**

1. \`ultra11y_adjudicate\` — the items, each naming the criterion and the element it turns on.
2. For each: \`ultra11y_read\` the file around that element. You are deciding what the markup MEANS in context, and context is exactly what an excerpt drops.
3. \`ultra11y_criteria\` for the criterion's exact test, whenever you are about to rule from memory.
4. Rule on each item, then \`ultra11y_check\` your write-up.

**What these criteria actually ask.**

- **Alt text** — does it convey what the image contributes HERE? A correct-looking alt on a decorative image is a failure; so is "chart" on a chart carrying the paragraph's only data.
- **Link purpose in context** — could a user reading links out of context tell where this one goes? "Read more" fails unless its context is programmatically associated.
- **Heading structure** — do the headings describe the real outline of the page, or the visual size someone wanted?
- **Reading order** — does the DOM order match the meaning, independent of CSS placement?
- **Label in name** — does the accessible name start with the visible label, so a speech user can say what they see?

**When the evidence does not settle it, say so.** "Needs a human with the design context" is a legitimate verdict and a useful one. A confident wrong ruling is neither.`;
}

function reviewDiff(args: Record<string, unknown>): string {
  const cwd = str(args.cwd)!;
  const since = str(args.since);

  return `Review the ${since ? `changes since \`${since}\`` : "staged changes"} in \`${cwd}\` for accessibility.

${CORE_RULE}

**Sequence:**

1. \`ultra11y_audit\` with ${since ? `\`since: "${since}"\`` : "`staged: true`"} and \`graph: true\` — scoped to exactly the code under change, but able to see across files.
2. \`ultra11y_read\` each flagged element in its real context before writing anything about it.
3. \`ultra11y_criteria\` for any criterion you are about to cite.
4. Report, ranked: blocking → major → minor.

**Review the diff, not the project.** A pre-existing non-conformity in a file this branch merely touched is not this branch's finding — mention it once as context, never as a blocker.

**Refute the false positives yourself.** Findings inside library source, generated output, or a single-file component the engine could not fully resolve are PRELIMINARY. Check each against the real markup and drop the ones that do not survive; a review that forwards the engine's output unfiltered wastes the author's time and teaches them to ignore the next one.

**Name the residual risks.** Contrast, focus visibility and zoom cannot be judged from source — say that they were not assessed rather than letting silence imply they passed.`;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

// Every tool a prompt tells the model to call must actually be declared —
// otherwise a prompt survives a tool rename as a set of instructions that
// cannot be followed. Exported so the test can assert it.
const DECLARED = new Set([...TOOLS, ...WRITE_TOOLS].map((t) => t.name));

export function toolNamesReferencedBy(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/ultra11y_[a-z_]+/g)) if (DECLARED.has(m[0])) found.add(m[0]);
  return [...found].sort();
}

export function unknownToolNamesIn(text: string): string[] {
  const bad = new Set<string>();
  for (const m of text.matchAll(/ultra11y_[a-z_]+/g)) if (!DECLARED.has(m[0])) bad.add(m[0]);
  return [...bad].sort();
}

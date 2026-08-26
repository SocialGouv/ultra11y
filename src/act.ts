// ACT conformance — measuring this engine against a corpus nobody here wrote.
//
// The engine's own recall suite seeds one fixture per rule that EXISTS, so it can only
// ever prove "our rules fire on the defects we wrote for them". The W3C ACT-Rules
// Community Group publishes ~90 rules with ~1100 `passed` / `failed` / `inapplicable`
// examples, authored independently of this project against the ACT Rules Format. Running
// the engine over them is the only external yardstick available here, and it measures the
// two things that matter in opposite directions:
//
//   • recall    — a `failed` example must produce a finding from a rule that claims it;
//   • precision — a `passed` / `inapplicable` example must produce NONE.
//
// Honest scoping matters more than a big number:
//   1. An ACT example asserts something about ITS OWN rule and nothing else. An example
//      for "image has an accessible name" says nothing about `<main>` or `<title>`, so a
//      test case is only ever judged with the engine rules MAPPED to that ACT rule
//      (`ACT_RULES` below) — never with the whole engine.
//   2. Only NORMATIVE findings count. ultra11y's `advisory` findings deliberately never
//      flip a criterion, so they cannot make a case "fail" either.
//   3. A rule this engine cannot decide from source (computed contrast, keyboard traps,
//      whether a transcript is accurate) is declared `rendered` or `judgment` and is NOT
//      scored — it is routed to the `scan` tier or to the agent's adjudication. Declaring
//      it beats quietly scoring 0.
//   4. `gap: true` marks a rule that IS statically decidable and simply is not implemented
//      yet. Those are the honest to-do list, not hidden behind an "out of scope" label.
//
// Verdicts follow the ACT Rules Format's own vocabulary: a tool that never reports a false
// positive but does not catch everything is *partially consistent*, not wrong.
import { parseSource } from "./parse/source.js";
import { runRules } from "./rules/registry.js";

/** Why an ACT rule is or is not scored against the static engine. */
export type ActScope =
  | "static" // decidable from source — scored
  | "rendered" // needs a browser: computed style, focus, media playback → the `scan` tier
  | "judgment" // needs a human/AI call: is this text descriptive, is that transcript accurate
  | "deprecated"; // withdrawn upstream — scoring it would be noise

export interface ActMapping {
  /** Engine rules that test the SAME thing as this ACT rule. Deliberately conservative:
   *  a loosely-related rule would manufacture false "inconsistent" verdicts. */
  engineRules: string[];
  scope: ActScope;
  /** In-scope and statically decidable, but not implemented yet. */
  gap?: boolean;
  /** Why the mapping is what it is — divergences are documented, never silent. */
  note?: string;
  /** Test cases where this engine KNOWINGLY reports while ACT does not, keyed by test-case
   *  id with the reason. Every entry is a deliberate, argued position — typically "the fact
   *  that clears this example is not in the source" (a silent media file, a custom control
   *  wired in JS) or "this project holds a stricter line than the ACT rule". Listing them
   *  is what keeps the precision gate meaningful: an unexplained false positive still fails,
   *  a reasoned divergence is on the record. */
  divergences?: Record<string, string>;
}

// Keyed by ACT rule id. Every rule in the vendored corpus must appear here
// (tests/act-official.test.ts fails on drift), so a new upstream rule cannot slip in
// unclassified.
export const ACT_RULES: Record<string, ActMapping> = {
  // ---- covered: the engine implements an equivalent check -------------------------
  "23a2a8": { engineRules: ["img-alt-missing"], scope: "static" },
  "59796f": { engineRules: ["input-image-alt-missing"], scope: "static" },
  "8fc3b6": { engineRules: ["object-embed-no-name"], scope: "static" },
  "7d6734": { engineRules: ["img-alt-missing"], scope: "static", note: "role=img on <svg> is handled by the same rule" },
  "97a4e1": { engineRules: ["button-empty-name", "icon-only-control-unnamed"], scope: "static" },
  c487ae: { engineRules: ["link-empty-name", "icon-only-control-unnamed"], scope: "static" },
  cae760: {
    engineRules: ["iframe-title-missing"],
    scope: "static",
    divergences: {
      "394132219ba385a90dda40efe822ab8db0cc9483":
        "a tabindex=-1 iframe is still exposed to assistive tech and still needs a title (RGAA 2.1 requires one unconditionally)",
    },
  },
  e086e5: {
    engineRules: ["control-label-missing"],
    scope: "static",
    note: "`placeholder-as-label` is deliberately NOT mapped: a placeholder does contribute to the accessible name, so ACT passes it — ultra11y still reports it, as a stricter house rule under 3.3.2.",
  },
  ffd0e9: { engineRules: ["empty-heading"], scope: "static" },
  b5c3f8: { engineRules: ["html-lang-missing"], scope: "static" },
  bf051a: { engineRules: ["lang-invalid"], scope: "static" },
  de46e4: {
    engineRules: ["lang-invalid", "inline-lang-change-missing"],
    scope: "static",
    divergences: {
      "949f41987201e52f8404c1246d1229eec06dea08":
        'lang="" on an element carrying text declares no language for that text; ACT deems the rule inapplicable, this engine reports it under 3.1.2',
    },
  },
  "2779a5": { engineRules: ["title-missing-empty"], scope: "static" },
  "3ea0c8": { engineRules: ["duplicate-id"], scope: "static" },
  "674b10": { engineRules: ["invalid-aria-role"], scope: "static" },
  bc4a75: { engineRules: ["aria-required-children"], scope: "static" },
  "6cfa84": {
    engineRules: ["aria-hidden-focusable"],
    scope: "static",
    divergences: {
      "4cfb71fcbfb617bb32540826847a8d6af7890fd4":
        "a focus-sentinel link inside an aria-hidden wrapper: it IS reachable by Tab, and only a runtime focus handler bounces it back — the same call axe-core makes",
    },
  },
  "6a7281": { engineRules: ["invalid-aria-value", "live-region-conflict"], scope: "static" },
  b40fd1: {
    engineRules: [],
    scope: "static",
    gap: true,
    note: "ACT asks that the non-repeated content sit in SOME landmark — a weaker claim than `missing-main-landmark`, which requires a <main>, so the two are not equivalent",
  },
  "80f0bf": {
    engineRules: ["autoplay-media"],
    scope: "static",
    divergences: {
      "6a0fc31d6bea6ceced58d1ef97713935e4fd2717": "the source cannot tell that the referenced media file is silent",
      cc5c2900c8d128d3ca25d8443f1f3e0a0e5f58e6: "a #t= media fragment shortening playback below 3s is not resolvable from source",
      "85c01775d802057e6f43c2248b8a5eb916c50c74": "the pause mechanism is a custom button wired in JavaScript, not a native `controls` attribute",
    },
  },
  "4c31df": {
    engineRules: ["autoplay-media"],
    scope: "static",
    divergences: {
      b13d65523ad27d9c763caca8bcc0fcce4b5ca5fb: "the source cannot tell that the referenced media has no audio track",
      cf4bc23e70caa9b42a6f82739a8492cb51393dbc: "the pause mechanism is a custom button wired in JavaScript, not a native `controls` attribute",
    },
  },
  bc659a: { engineRules: ["meta-refresh-redirect"], scope: "static" },
  bisz58: {
    engineRules: ["meta-refresh-redirect"],
    scope: "static",
    note: "this variant drops the >20h exception the engine honours, so long delays are knowingly not reported",
  },
  b4f0c3: { engineRules: ["meta-viewport-zoom-block"], scope: "static" },
  f51b46: { engineRules: ["media-no-track"], scope: "static", note: "presence of a caption track; whether the captions are accurate is a judgment call" },

  // ---- gaps: statically decidable, not implemented yet ----------------------------
  "2ee8b8": {
    engineRules: ["label-in-name-mismatch"],
    scope: "static",
    divergences: {
      "65be0004543e57d44dd4a53d9f582c482503727c":
        "an icon FONT renders the text 'search' as a glyph, so the visible label is not the text in the DOM — a fact only the rendered page carries",
    },
  },
  "73f2c2": { engineRules: ["autocomplete-token-invalid"], scope: "static" },
  "5f99a7": { engineRules: ["invalid-aria-attr"], scope: "static" },
  "5c01ea": {
    engineRules: ["aria-prohibited-attr"],
    scope: "static",
    note: "covers the name-prohibited roles; the full per-role permitted-attribute matrix is not encoded",
  },
  "4e8ab6": { engineRules: ["aria-required-attr"], scope: "static" },
  ff89c9: { engineRules: ["aria-required-parent"], scope: "static" },
  "307n5z": { engineRules: ["presentational-children-focusable"], scope: "static" },
  a25f45: { engineRules: ["headers-attr-dangling"], scope: "static" },
  d0f69e: {
    engineRules: ["th-no-data-cells"],
    scope: "static",
    note: "only the explicit `headers`-wired shape is decided; scope-based assignment needs a full table model",
  },
  e6952f: { engineRules: ["duplicate-attribute"], scope: "static" },
  "5b7ae0": { engineRules: ["html-lang-xml-lang-mismatch"], scope: "static" },
  m6b1q3: { engineRules: ["menuitem-empty-name"], scope: "static" },
  ffbc54: { engineRules: [], scope: "static", gap: true, note: "2.1.4 single-character keyboard shortcuts" },
  ye5d6e: { engineRules: [], scope: "static", gap: true, note: "presence of a bypass instrument" },
  cf77f2: { engineRules: [], scope: "static", gap: true, note: "presence of a bypass mechanism (landmark or skip link)" },
  "047fe0": { engineRules: [], scope: "static", gap: true, note: "a heading for the non-repeated content (h1-missing is advisory, so it does not count)" },
  "24afc2": {
    engineRules: ["letter-spacing-important"],
    scope: "static",
    note: "definite below-threshold author-important values; computed-unit cases remain rendered",
  },
  "78fd32": {
    engineRules: ["line-height-important"],
    scope: "static",
    note: "definite below-threshold author-important values; computed-unit cases remain rendered",
  },
  "9e45ec": {
    engineRules: ["word-spacing-important"],
    scope: "static",
    note: "definite below-threshold author-important values; computed-unit cases remain rendered",
  },
  "46ca7f": { engineRules: ["decorative-marked-exposed"], scope: "static" },

  // ---- needs a rendered page: routed to the `scan` tier ---------------------------
  afw4f7: { engineRules: [], scope: "rendered", note: "computed contrast; only inline literal colour pairs are decided statically (contrast-literal)" },
  "09o5cg": { engineRules: [], scope: "rendered", note: "AAA enhanced contrast — outside the AA core" },
  oj04fd: { engineRules: [], scope: "rendered", note: "visible focus (2.4.7) — probed by scan --runtime local" },
  "80af7b": { engineRules: [], scope: "rendered" },
  a1b64e: { engineRules: [], scope: "rendered" },
  ebe86a: { engineRules: [], scope: "rendered" },
  "0ssw9k": { engineRules: [], scope: "rendered" },
  "59br37": { engineRules: [], scope: "rendered", note: "clipping under zoom — probed by scan --runtime local" },
  b33eff: { engineRules: [], scope: "rendered", note: "orientation lock via CSS transform" },
  "3e12e1": { engineRules: [], scope: "rendered" },
  efbfc7: { engineRules: [], scope: "rendered" },
  akn7bn: { engineRules: [], scope: "rendered", note: "needs the iframe's own document" },
  aaa1bf: { engineRules: [], scope: "rendered", note: "needs the media's duration" },
  "0va7u6": { engineRules: [], scope: "rendered", note: "text baked into a graphic" },

  // ---- needs a human/AI judgment: routed to the adjudication phase ----------------
  qt1vmo: { engineRules: [], scope: "judgment", note: "is the alt relevant (1.1.1)" },
  e88epe: { engineRules: [], scope: "judgment", note: "is the image genuinely decorative" },
  "5effbb": { engineRules: [], scope: "judgment", note: "link purpose in context (2.4.4)" },
  aizyf1: { engineRules: [], scope: "judgment" },
  b20e66: { engineRules: [], scope: "judgment" },
  fd3a94: { engineRules: [], scope: "judgment" },
  "4b1c6c": { engineRules: [], scope: "judgment" },
  b49b2e: { engineRules: [], scope: "judgment", note: "is the heading descriptive (2.4.6)" },
  cc0f0a: { engineRules: [], scope: "judgment" },
  c4a8a4: { engineRules: [], scope: "judgment" },
  "36b590": { engineRules: [], scope: "judgment" },
  "9bd38c": { engineRules: [], scope: "judgment", note: "sensory characteristics (1.3.3)" },
  off6ek: { engineRules: [], scope: "judgment", note: "does the subtag match the actual text language" },
  ucwvc8: { engineRules: [], scope: "judgment" },
  "7677a9": { engineRules: [], scope: "judgment" },
  c249d5: { engineRules: [], scope: "judgment" },
  "1a02b0": { engineRules: [], scope: "judgment" },
  e7aa44: { engineRules: [], scope: "judgment" },
  "2eb176": { engineRules: [], scope: "judgment" },
  afb423: { engineRules: [], scope: "judgment" },
  eac66b: { engineRules: [], scope: "judgment" },
  ab4d13: { engineRules: [], scope: "judgment" },
  c5a4ea: { engineRules: [], scope: "judgment" },
  "1ea59c": { engineRules: [], scope: "judgment" },
  "1ec09b": { engineRules: [], scope: "judgment" },
  c3232f: { engineRules: [], scope: "judgment" },
  d7ba54: { engineRules: [], scope: "judgment" },
  ee13b5: { engineRules: [], scope: "judgment" },
  fd26cf: { engineRules: [], scope: "judgment" },

  // ---- withdrawn upstream --------------------------------------------------------
  "9eb3f6": { engineRules: [], scope: "deprecated" },
  f196ce: { engineRules: [], scope: "deprecated" },
  ac7dc6: { engineRules: [], scope: "deprecated" },
};

export interface ActTestcase {
  ruleId: string;
  ruleName: string;
  testcaseId: string;
  title: string;
  expected: "passed" | "failed" | "inapplicable";
  wcag: string[];
  html: string;
}

/** ACT Rules Format consistency, as measured here. */
export type ActVerdict =
  | "consistent" // every `failed` caught, zero finding on `passed`/`inapplicable`
  | "partially-consistent" // zero unexplained false positive, but some `failed` not caught
  | "divergent" // every `failed` caught; the only reports on clean cases are argued below
  | "inconsistent" // at least one UNEXPLAINED `passed`/`inapplicable` reported as failing
  | "not-scored"; // rendered / judgment / deprecated / not implemented

export interface ActRuleResult {
  ruleId: string;
  ruleName: string;
  wcag: string[];
  mapping: ActMapping;
  verdict: ActVerdict;
  failed: number;
  caught: number;
  clean: number; // passed + inapplicable
  falsePositives: { testcaseId: string; title: string; ruleIds: string[] }[];
  /** Clean cases this engine reports on DELIBERATELY, each with its recorded reason. */
  divergences: { testcaseId: string; title: string; ruleIds: string[]; reason: string }[];
  missed: { testcaseId: string; title: string }[];
}

/** Normative findings from the mapped engine rules only — see the header for why. */
function mappedFindings(html: string, testcaseId: string, engineRules: string[]): string[] {
  if (!engineRules.length) return [];
  const only = new Set(engineRules);
  return [
    ...new Set(
      runRules(parseSource(html, `${testcaseId}.html`), only)
        .filter((f) => !f.advisory)
        .map((f) => f.ruleId),
    ),
  ].sort();
}

const VERDICT_LABEL: Record<ActVerdict, string> = {
  consistent: "✅ consistent",
  divergent: "🟦 divergent (documented)",
  "partially-consistent": "🟨 partially consistent",
  inconsistent: "❌ inconsistent",
  "not-scored": "—",
};

const SCOPE_LABEL: Record<ActScope, string> = {
  static: "source",
  rendered: "rendered (`scan`)",
  judgment: "judgment (agent)",
  deprecated: "withdrawn upstream",
};

/** Render the published conformance matrix (skills/ultra11y/references/act.md). Generated,
 *  never hand-written: `tests/act-matrix-sync.test.ts` fails if the committed file drifts
 *  from what the current engine actually scores. */
export function renderActMatrix(testcases: ActTestcase[], source: string): string {
  const rs = evaluateAct(testcases);
  const scored = rs.filter((r) => r.verdict !== "not-scored");
  const caught = scored.reduce((n, r) => n + r.caught, 0);
  const failed = scored.reduce((n, r) => n + r.failed, 0);
  const clean = scored.reduce((n, r) => n + r.clean, 0);
  const divergences = rs.reduce((n, r) => n + r.divergences.length, 0);
  const count = (v: ActVerdict): number => rs.filter((r) => r.verdict === v).length;

  const out: string[] = [];
  out.push(`<!-- GENERATED from the vendored W3C ACT corpus by \`pnpm run build:act\` — do not edit by hand. -->`, "");
  out.push("# ACT conformance — how this engine scores against a corpus it did not write", "");
  out.push(
    "The recall matrix in this repository proves that each rule fires on the defect written FOR it.",
    "That is circular. The [W3C ACT-Rules Community Group](https://act-rules.github.io) publishes rules",
    "with `passed` / `failed` / `inapplicable` examples authored independently of this project, so running",
    "the engine over them measures something a self-authored fixture cannot.",
    "",
    "**How to read this.** An ACT example asserts something about ITS OWN rule and nothing else, so each",
    "case is judged only with the engine rules mapped to that ACT rule — never with the whole engine.",
    "Only normative findings count (an `advisory` recommendation never flips a criterion, so it cannot",
    "fail a case either). Rules needing a rendered page or a human call are declared, not scored — saying",
    "so beats quietly scoring zero.",
    "",
  );
  out.push("## Summary", "");
  out.push(`| | |`, `|---|---|`);
  out.push(`| Corpus | ${testcases.length} examples across ${new Set(testcases.map((t) => t.ruleId)).size} ACT rules |`);
  out.push(`| Source | ${source} |`);
  out.push(`| Rules scored | **${scored.length}** |`);
  out.push(`| Failed examples caught | **${caught} / ${failed}** |`);
  out.push(`| Clean examples left alone | **${clean} / ${clean}** — no unexplained false positive |`);
  out.push(`| Consistent | ${count("consistent")} |`);
  out.push(`| Divergent (documented, ${divergences} case${divergences === 1 ? "" : "s"}) | ${count("divergent")} |`);
  out.push(`| Partially consistent | ${count("partially-consistent")} |`);
  out.push(`| **Inconsistent** | **${count("inconsistent")}** |`);
  out.push(`| Declared gaps (static, not implemented) | ${rs.filter((r) => r.mapping.gap).length} |`);
  out.push("");
  out.push(
    "*Partially consistent* is the ACT Rules Format's own term for a tool that never reports a false",
    "positive but does not catch everything — it is a coverage statement, not an error. *Divergent* means",
    "every deviation on that rule is listed below with the argument for it.",
    "",
  );

  if (scored.length) {
    out.push("## Scored rules", "");
    out.push("| ACT rule | WCAG | Engine rules | Verdict | Caught |", "|---|---|---|---|---|");
    for (const r of scored) {
      out.push(
        `| [${r.ruleName}](https://act-rules.github.io/rules/${r.ruleId}) | ${r.wcag.join(", ") || "—"} | ` +
          `${r.mapping.engineRules.map((x) => `\`${x}\``).join(", ") || "—"} | ${VERDICT_LABEL[r.verdict]} | ${r.caught}/${r.failed} |`,
      );
    }
    out.push("");
    const notes: string[] = [];
    for (const r of scored) {
      if (r.mapping.note) notes.push(`- **${r.ruleName}** — ${r.mapping.note}`);
      for (const d of r.divergences) notes.push(`- **${r.ruleName}** · reports on *${d.title}*: ${d.reason}`);
    }
    if (notes.length) out.push("### Notes and documented divergences", "", ...notes, "");
  }

  const gaps = rs.filter((r) => r.mapping.gap);
  if (gaps.length) {
    out.push("## Declared gaps — statically decidable, not implemented yet", "");
    out.push("| ACT rule | WCAG | Why it is not covered |", "|---|---|---|");
    for (const r of gaps)
      out.push(`| [${r.ruleName}](https://act-rules.github.io/rules/${r.ruleId}) | ${r.wcag.join(", ") || "—"} | ${r.mapping.note ?? ""} |`);
    out.push("");
  }

  const outOfScope = rs.filter((r) => !r.mapping.gap && r.verdict === "not-scored");
  if (outOfScope.length) {
    out.push("## Out of the static engine's reach — routed, not ignored", "");
    out.push("| ACT rule | WCAG | Decided by |", "|---|---|---|");
    for (const r of outOfScope) {
      out.push(
        `| [${r.ruleName}](https://act-rules.github.io/rules/${r.ruleId}) | ${r.wcag.join(", ") || "—"} | ${SCOPE_LABEL[r.mapping.scope]}${r.mapping.note ? ` — ${r.mapping.note}` : ""} |`,
      );
    }
    out.push("");
  }
  out.push(
    "The corpus is vendored at `scripts/vendor/act-testcases.json` (refreshed by",
    "`pnpm run build:act:refresh`, and daily by the act-refresh workflow) so the suite stays",
    "offline and deterministic.",
    "ACT-Rules Community Group test cases are © their contributors under the W3C Software and",
    "Document License — see `NOTICE`.",
    "",
  );
  return out.join("\n");
}

export function evaluateAct(testcases: ActTestcase[], map: Record<string, ActMapping> = ACT_RULES): ActRuleResult[] {
  const byRule = new Map<string, ActTestcase[]>();
  for (const tc of testcases) {
    const list = byRule.get(tc.ruleId);
    if (list) list.push(tc);
    else byRule.set(tc.ruleId, [tc]);
  }
  const out: ActRuleResult[] = [];
  for (const [ruleId, cases] of [...byRule].sort((a, b) => a[0].localeCompare(b[0]))) {
    const mapping = map[ruleId] ?? { engineRules: [], scope: "static" as ActScope, gap: true, note: "unclassified — new upstream rule" };
    const failedCases = cases.filter((c) => c.expected === "failed");
    const cleanCases = cases.filter((c) => c.expected !== "failed");
    const scored = mapping.scope === "static" && mapping.engineRules.length > 0;

    const falsePositives: ActRuleResult["falsePositives"] = [];
    const divergences: ActRuleResult["divergences"] = [];
    const missed: ActRuleResult["missed"] = [];
    let caught = 0;
    if (scored) {
      for (const c of failedCases) {
        const ids = mappedFindings(c.html, c.testcaseId, mapping.engineRules);
        if (ids.length) caught++;
        else missed.push({ testcaseId: c.testcaseId, title: c.title });
      }
      for (const c of cleanCases) {
        const ids = mappedFindings(c.html, c.testcaseId, mapping.engineRules);
        if (!ids.length) continue;
        const reason = mapping.divergences?.[c.testcaseId];
        if (reason) divergences.push({ testcaseId: c.testcaseId, title: c.title, ruleIds: ids, reason });
        else falsePositives.push({ testcaseId: c.testcaseId, title: c.title, ruleIds: ids });
      }
    }
    const verdict: ActVerdict = !scored
      ? "not-scored"
      : falsePositives.length > 0
        ? "inconsistent"
        : caught < failedCases.length
          ? "partially-consistent"
          : divergences.length > 0
            ? "divergent"
            : "consistent";
    out.push({
      ruleId,
      ruleName: cases[0]!.ruleName,
      wcag: cases[0]!.wcag,
      mapping,
      verdict,
      failed: failedCases.length,
      caught,
      clean: cleanCases.length,
      falsePositives,
      divergences,
      missed,
    });
  }
  return out;
}

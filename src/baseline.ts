// Finding identity and severity gating. A finding's identity is (ruleId,
// criteriaId, file, source-range) — NOT line/col (drifts on every edit) and NOT
// selectorHint (ambiguous), so two runs agree on which finding is which (the scan
// merge de-duplicates on it, the ledger and the evidence crops key on it).
import { routePath } from "./routes.js";
import type { DynamicFinding, DynamicResult, Finding, Severity } from "./types.js";

const RANK: Record<Severity, number> = { bloquant: 0, majeur: 1, mineur: 2 };

/** Stable identity surviving line drift: prefer source byte range, else fall back
 *  to line/col + selector (JSX/stdin findings, which carry no offsets). */
export function findingId(f: Finding): string {
  const pos = f.sourceStart !== undefined ? `b${f.sourceStart}-${f.sourceEnd}` : `l${f.line}:${f.col}:${f.selectorHint}`;
  return `${f.ruleId}|${f.criteriaId}|${f.file}|${pos}`;
}

// Accept English aliases (blocking|major|minor) on input — the tool is English-first —
// while the internal Severity union stays fr (bloquant|majeur|mineur). STRICT: an
// unrecognized value returns null (the caller reports and exits) rather than silently
// degrading to "bloquant" — a `--fail-on majr` typo must not weaken the gate.
export function parseFailOn(v: string | boolean | undefined): Severity | null {
  if (v === undefined || v === true) return "bloquant"; // flag absent, or present with no value → default
  if (v === "bloquant" || v === "blocking") return "bloquant";
  if (v === "majeur" || v === "major") return "majeur";
  if (v === "mineur" || v === "minor") return "mineur";
  return null; // unrecognized token
}

/** Findings at or above a severity threshold — the `audit --fail-on` gate. */
export function findingsAtOrAbove<T extends { severity: Severity }>(findings: T[], failOn: Severity): T[] {
  return findings.filter((f) => RANK[f.severity] <= RANK[failOn]);
}

/** Identity of a RENDERED finding, host-free: the same page on the base deployment and on the
 *  pull request's preview must agree on which finding is which. The page is keyed on its route
 *  path (src/routes.ts `routePath`), the element on its selector; the message and the snippet
 *  are left out, they carry text the change may legitimately edit. */
export function dynamicFindingId(f: Pick<DynamicFinding, "axeRule" | "criteriaId" | "selector" | "page">, target = ""): string {
  return `${f.axeRule}|${f.criteriaId}|${routePath(f.page ?? target)}|${f.selector}`;
}

/** The rendered findings of `current` that `baseline` does not hold — the only ones a pull
 *  request's rendered gate blocks on. Advisory findings (best practice, no criterion) never
 *  block. A page absent from the baseline is new, so every finding on it is new too. */
export function newDynamicFindings(current: DynamicResult, baseline: Pick<DynamicResult, "findings" | "target">): DynamicFinding[] {
  const known = new Set(baseline.findings.map((f) => dynamicFindingId(f, baseline.target)));
  return current.findings.filter((f) => !f.advisory && !known.has(dynamicFindingId(f, current.target)));
}

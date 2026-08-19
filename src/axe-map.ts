// Curated axe-core rule → WCAG 2.2 success-criterion mapping. axe emits native
// `wcag<abc>` tags per rule, so this curated map only carries deliberate choices
// (e.g. color-contrast → 1.4.3, the needs-rendering SC the static engine can't
// decide); everything else falls back to axe's own wcag tags, then to 4.1.2.
import type { DynamicEngine, Severity } from "./types.js";
import { hasSC } from "./wcag.js";

// The local runtime's bespoke probes (scan --local) → the WCAG SC each evidences.
// These are the needs-rendering criteria axe-core does not decide on its own; the
// probe raises a definite NC only when it OBSERVES the failure in the rendered page
// (a clean probe leaves the SC `manual`, never silently Conforming).
export const PROBE_WCAG: Record<Exclude<DynamicEngine, "axe" | "reflow">, string> = {
  "focus-visible": "2.4.7", // Focus Visible — focusing a control produces no visible change
  "reflow-zoom": "1.4.4", // Resize Text / 200% zoom — content clipped/lost when enlarged
  "text-spacing": "1.4.12", // Text Spacing — clipping/overlap under the WCAG spacing override
  hover: "1.4.13", // Content on Hover or Focus — not dismissible/hoverable/persistent
  // Stateful input-overflow probes — a FILLED input whose typed value is clipped/unreadable
  // under a stress. Same defect, one SC per stress (so each folds onto the SC that stress
  // actually evidences), so they stay unambiguous cross-standard (RGAA 10.11/10.4/10.12).
  "input-overflow-reflow": "1.4.10", // typed value clipped at 320px width
  "input-overflow-zoom": "1.4.4", // typed value clipped at 200% zoom
  "input-overflow-spacing": "1.4.12", // typed value clipped under the WCAG text-spacing override
  "live-region": "4.1.3", // Status Messages — content updated by an interaction outside any live region
};

// Probe severities are deliberately conservative: focus + zoom are real blockers
// (majeur); spacing/hover are heuristic, so minor by default (tunable).
export const PROBE_SEVERITY: Record<Exclude<DynamicEngine, "axe" | "reflow">, Severity> = {
  "focus-visible": "majeur",
  "reflow-zoom": "majeur",
  "text-spacing": "mineur",
  hover: "mineur",
  // Input-overflow is a directly OBSERVED loss of content (the value the user typed is no
  // longer visible), not a heuristic — the human auditor confirmed the real instance class
  // — so it is majeur on every stress (incl. text-spacing, unlike the generic text-spacing
  // probe which stays mineur). live-region is an honest heuristic → mineur.
  "input-overflow-reflow": "majeur",
  "input-overflow-zoom": "majeur",
  "input-overflow-spacing": "majeur",
  "live-region": "mineur",
};

export const AXE_WCAG: Record<string, string> = {
  // images
  "image-alt": "1.1.1",
  "input-image-alt": "1.1.1",
  "area-alt": "1.1.1",
  "role-img-alt": "1.1.1",
  "image-redundant-alt": "1.1.1",
  "svg-img-alt": "1.1.1",
  // frames
  "frame-title": "4.1.2",
  "frame-title-unique": "4.1.2",
  // colour (the headline dynamic win)
  "color-contrast": "1.4.3",
  "color-contrast-enhanced": "1.4.3",
  "link-in-text-block": "1.4.1",
  // tables / structure
  "td-headers-attr": "1.3.1",
  "th-has-data-cells": "1.3.1",
  "scope-attr-valid": "1.3.1",
  "table-fake-caption": "1.3.1",
  "td-has-header": "1.3.1",
  "empty-table-header": "1.3.1",
  // links & buttons
  "link-name": "2.4.4",
  "button-name": "4.1.2",
  "input-button-name": "4.1.2",
  // scripts / ARIA
  "aria-allowed-attr": "4.1.2",
  "aria-allowed-role": "4.1.2",
  "aria-command-name": "4.1.2",
  "aria-hidden-body": "4.1.2",
  "aria-hidden-focus": "4.1.2",
  "aria-input-field-name": "4.1.2",
  "aria-required-attr": "4.1.2",
  "aria-required-children": "4.1.2",
  "aria-required-parent": "4.1.2",
  "aria-roles": "4.1.2",
  "aria-toggle-field-name": "4.1.2",
  "aria-valid-attr": "4.1.2",
  "aria-valid-attr-value": "4.1.2",
  "nested-interactive": "4.1.2",
  "aria-tooltip-name": "4.1.2",
  "aria-meter-name": "4.1.2",
  "aria-progressbar-name": "4.1.2",
  "aria-dialog-name": "4.1.2",
  "presentation-role-conflict": "4.1.2",
  "duplicate-id-aria": "4.1.2",
  // mandatory elements / language
  "duplicate-id": "4.1.2",
  "duplicate-id-active": "4.1.2",
  "html-has-lang": "3.1.1",
  "html-xml-lang-mismatch": "3.1.1",
  "html-lang-valid": "3.1.1",
  "valid-lang": "3.1.2",
  "document-title": "2.4.2",
  // structure
  "heading-order": "1.3.1",
  "empty-heading": "1.3.1",
  "page-has-heading-one": "1.3.1",
  list: "1.3.1",
  listitem: "1.3.1",
  "definition-list": "1.3.1",
  dlitem: "1.3.1",
  "landmark-one-main": "1.3.1",
  region: "1.3.1",
  // presentation / zoom
  "meta-viewport": "1.4.4",
  "meta-viewport-large": "1.4.4",
  // forms
  label: "4.1.2",
  "form-field-multiple-labels": "4.1.2",
  "select-name": "4.1.2",
  "label-title-only": "4.1.2",
  "autocomplete-valid": "1.3.5",
  fieldset: "1.3.1",
  // multimedia
  "audio-caption": "1.2.2",
  "video-caption": "1.2.2",
  "no-autoplay-audio": "1.4.2",
  blink: "2.2.2",
  marquee: "2.2.2",
  // navigation
  tabindex: "2.4.3",
  "skip-link": "2.4.1",
  bypass: "2.4.1",
  accesskeys: "2.1.1",
};

/** THE SUCCESS CRITERIA AN AXE PASS THAT FOUND NOTHING IS ALLOWED TO CLOSE.
 *
 *  Deliberately tiny, and deliberately a list rather than a rule. axe REPORTS on dozens of
 *  success criteria (that is what AXE_WCAG above is for), but reporting on one is not the same
 *  as being its canonical decider: `color-contrast` computes the very ratio 1.4.3 is written
 *  in, while axe's ARIA rules cover a slice of 4.1.2 that no clean run can close. Reading the
 *  second as the first is how a grid fills up with conformities nobody verified.
 *
 *  The guardrail around it is in src/audit.ts and is the same one the probes get: the pass must
 *  have run on EVERY page in scope. A criterion measured on some pages is not a criterion
 *  measured.
 *
 *  Entries are added one at a time, each with the rule that carries it and a reason to trust
 *  it — never in bulk from axe's tag list. */
export const AXE_DECIDES: Record<string, readonly string[]> = {
  // Text contrast. `color-contrast` is on by default, runs on every text node, and computes
  // the ratio the criterion states — the one criterion where the automated answer IS the
  // answer, which is why the local scan tier has always mapped it here.
  "1.4.3": ["color-contrast"],
};

export const FALLBACK_SC = "4.1.2";

/** Read a WCAG SC from axe's native rule tags. axe tags each rule with `wcag<abc>`
 *  (e.g. "wcag111" → 1.1.1, "wcag1410" → 1.4.10) plus level umbrellas ("wcag2aa",
 *  "wcag22aa", "best-practice") that carry no SC and are skipped. Returns the first
 *  tag that resolves to a real SC in the WCAG 2.2 AA core (so AAA tags are ignored). */
export function scFromWcagTags(tags: string[] | undefined): string | null {
  if (!tags) return null;
  for (const t of tags) {
    const m = /^wcag(\d)(\d)(\d+)$/.exec(t);
    if (m) {
      const sc = `${m[1]}.${m[2]}.${m[3]}`;
      if (hasSC(sc)) return sc;
    }
  }
  return null;
}

/** Map an axe impact to an ultra11y severity. */
export function severityFromImpact(impact: string | null | undefined): Severity {
  switch (impact) {
    case "critical":
    case "serious":
      return "bloquant";
    case "moderate":
      return "majeur";
    default:
      return "mineur";
  }
}

export function scForAxeRule(ruleId: string): string {
  return AXE_WCAG[ruleId] ?? FALLBACK_SC;
}

// Curated overrides of the tag-based advisory decision, keyed by axe rule id. Forces a
// rule to (non-)advisory regardless of its tags — a deliberate escape hatch for the rare
// case where axe's tagging disagrees with the normativity we want. `true` ⇒ always
// advisory, `false` ⇒ always normative.
//
// CROSS-CHANNEL NORMATIVITY CONSISTENCY: the tag-based `axeAdvisory` heuristic treats
// any axe rule with no `wcag<digits>` tag as best-practice-only (advisory). But this
// engine ALSO has a static counterpart for several of these rules (src/rules/*.ts) that
// we ship as NORMATIVE — the same defect must not be a definite NC when found statically
// (`audit`) yet a mere recommendation when found dynamically (`scan`/axe). The pin is a
// statement of INTENT, not a snapshot of axe's tagging: this defect has a normative
// static twin, so it must stay normative cross-channel REGARDLESS of how axe currently
// tags the rule. That drift-proofs the decision — the docker runner installs axe-core
// from a caret range ("^4.10.0"), so the tag set a user's build ships can change with no
// repo change; a pin can't be silently downgraded by such a re-tag, whereas relying on
// the tags could. The twin ids are documented inline and cross-checked by
// tests/axe-map.test.ts against the live registry; that guard is two-directional for
// EXACT-id matches (an AXE_WCAG key that is also a registered normative static rule id
// MUST be pinned). Near-twins whose ids differ (heading-order vs heading-order-skip…)
// are still curated by hand — a future differently-named twin is caught at review time,
// not by the test.
//   - heading-order        → static twin heading-order-skip        (src/rules/headings.ts)
//   - tabindex              → static twin positive-tabindex          (src/rules/navigation.ts)
//   - skip-link             → static twin skip-link-target-missing   (src/rules/navigation.ts)
//   - label-title-only      → static twin control-name-title-only    (src/rules/links.ts)
//   - landmark-one-main     → static twins missing-main-landmark /
//                             multiple-main-landmark                 (src/rules/navigation.ts)
//   - empty-heading         → static twin empty-heading              (src/rules/headings.ts,
//                             identical rule id; the axe rule is best-practice-only tagged)
//   - duplicate-id          → static twin duplicate-id               (src/rules/mandatory.ts,
//                             identical rule id; deprecated by axe-core ≥ 4.10 — harmless
//                             pin if the installed axe never fires it)
//   - nested-interactive    → static twin nested-interactive         (src/rules/scripts-aria.ts,
//                             identical rule id)
//   - form-field-multiple-labels → static twin of the same id        (src/rules/forms.ts)
//   - aria-required-children → static twin of the same id            (src/rules/scripts-aria.ts)
//   - aria-required-attr    → static twin of the same id             (src/rules/scripts-aria.ts)
//   - aria-valid-attr       → static twin invalid-aria-attr           (src/rules/scripts-aria.ts)
//   - aria-valid-attr-value → static twin invalid-aria-value          (src/rules/scripts-aria.ts)
//   - aria-required-parent  → static twin of the same id              (src/rules/scripts-aria.ts)
//   - autocomplete-valid    → static twin autocomplete-token-invalid  (src/rules/forms.ts)
//   - label-content-name-mismatch → static twin label-in-name-mismatch (src/rules/links.ts)
//   - td-headers-attr       → static twin headers-attr-dangling       (src/rules/tables.ts)
//   - th-has-data-cells     → static twin th-no-data-cells            (src/rules/tables.ts)
//   - definition-list / dlitem → static twin dl-structure             (src/rules/headings.ts)
// Deliberately NOT pinned (stay advisory, tag-based decision applies): empty-table-header,
// page-has-heading-one (consistent with h1-missing/h1-multiple now being advisory — see
// src/rules/headings.ts), region, accesskeys, image-redundant-alt — none of these has a
// normative static twin in this engine. Near-twins judged DIFFERENT defects (also not
// pinned): td-has-header / table-fake-caption vs the static data-table-no-headers /
// table-caption-missing — a data cell missing its per-cell header association vs a table
// with no headers at all, and a caption faked with styled markup vs a caption missing
// entirely.
export const AXE_ADVISORY_EXCEPTIONS: Record<string, boolean> = {
  "heading-order": false,
  tabindex: false,
  "skip-link": false,
  "label-title-only": false,
  "landmark-one-main": false,
  "empty-heading": false,
  "duplicate-id": false,
  "nested-interactive": false,
  "form-field-multiple-labels": false,
  "aria-required-children": false,
  "aria-required-attr": false,
  "aria-required-parent": false,
  "aria-valid-attr": false,
  "aria-valid-attr-value": false,
  "autocomplete-valid": false,
  "label-content-name-mismatch": false,
  "td-headers-attr": false,
  "th-has-data-cells": false,
  "definition-list": false,
  dlitem: false,
};

// Data companion to AXE_ADVISORY_EXCEPTIONS: which static rule id(s) (src/rules/*.ts,
// registered in src/rules/registry.ts) evidence the "same defect" as each pinned axe
// rule above. Kept as data (not just prose) so tests/axe-map.test.ts can DERIVE the
// consistency check — assert every twin is actually registered and normative — instead
// of hand-duplicating (and risking drift from) this table.
export const AXE_STATIC_TWIN: Record<string, string[]> = {
  "heading-order": ["heading-order-skip"],
  tabindex: ["positive-tabindex"],
  "skip-link": ["skip-link-target-missing"],
  "label-title-only": ["control-name-title-only"],
  "landmark-one-main": ["missing-main-landmark", "multiple-main-landmark"],
  "empty-heading": ["empty-heading"],
  "duplicate-id": ["duplicate-id"],
  "aria-required-attr": ["aria-required-attr"],
  "aria-required-parent": ["aria-required-parent"],
  "aria-valid-attr": ["invalid-aria-attr"],
  "aria-valid-attr-value": ["invalid-aria-value"],
  "autocomplete-valid": ["autocomplete-token-invalid"],
  "label-content-name-mismatch": ["label-in-name-mismatch"],
  "td-headers-attr": ["headers-attr-dangling"],
  "th-has-data-cells": ["th-no-data-cells"],
  "definition-list": ["dl-structure"],
  dlitem: ["dl-structure"],
  "nested-interactive": ["nested-interactive"],
  "form-field-multiple-labels": ["form-field-multiple-labels"],
  "aria-required-children": ["aria-required-children"],
};

/** A best-practice-only axe violation carries tags but NO `wcag<digits>` SC tag (only
 *  umbrellas like `wcag2aa`/`best-practice`/`cat.*`) — it evidences no testable WCAG
 *  success criterion, so it must fold as an ADVISORY recommendation, never a criterion NC.
 *  Covers `empty-table-header`, `page-has-heading-one`, `landmark-one-main`, `region`, …
 *  The `\d+` requires an ALL-DIGIT suffix, so umbrella tags ("wcag2aa", "wcag22aa") never
 *  count as a real SC tag. A TAG-LESS violation (no evidence either way — real axe always
 *  tags, so this is only a hand-built input) stays NORMATIVE: we never silently downgrade
 *  a finding to advisory without positive best-practice evidence. */
export function axeAdvisory(tags: string[] | undefined): boolean {
  const t = tags ?? [];
  if (t.length === 0) return false;
  return !t.some((tag) => /^wcag\d+$/.test(tag));
}

/** Resolve whether an axe violation is advisory: the curated exception wins, else the
 *  tag-based `axeAdvisory` decides. This is what src/scan.ts stamps onto its findings. */
export function isAxeAdvisory(ruleId: string, tags: string[] | undefined): boolean {
  return AXE_ADVISORY_EXCEPTIONS[ruleId] ?? axeAdvisory(tags);
}

/** Resolve an axe rule to a WCAG SC: the curated map first (deliberate, e.g.
 *  color-contrast → 1.4.3), then axe's own wcag tags, then the 4.1.2 fallback. */
export function scForAxe(ruleId: string, tags?: string[]): string {
  return AXE_WCAG[ruleId] ?? scFromWcagTags(tags) ?? FALLBACK_SC;
}

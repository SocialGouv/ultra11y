// AXE, RUN INSIDE THE CALLER'S OWN TEST.
//
// `scan` has driven axe-core since the beginning; the E2E integration never did — and the E2E
// integration is the only tier that reaches a page behind a login and a state machine. So on a
// real application the criteria axe decides best (computed contrast above all) were left « à
// évaluer » run after run, on the very pages that mattered, while the same rule engine sat
// installed in the repo (`@axe-core/playwright`) for the scanner that could not get past the
// login screen.
//
// What this tier owes the audit is two things, and they are separable:
//   1. a violation axe reports becomes a finding on the page it was reported on, mapped
//      through the SAME table `scan` uses (src/axe-map.ts) — one hit, one meaning, whichever
//      tier surfaced it;
//   2. the fact that axe RAN is recorded, because that is what makes its silence usable. An
//      empty violation list from a pass that never started is not a clean page.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { PAGES_DIR } from "../src/snapshot.js";

const DOM = `<!doctype html><html lang="fr"><head><title>Accueil</title></head><body><main><h1>Egapro</h1><p>Bonjour</p></main></body></html>`;

/** A page snapshot carrying an axe pass, exactly as `checkA11y` persists one. */
function pageWithAxe(axe: unknown): ReturnType<typeof runAudit> {
  const root = mkdtempSync(join(tmpdir(), "u11y-axe-"));
  const dir = join(root, PAGES_DIR, "accueil");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ v: 1, id: "accueil", name: "Accueil", url: "https://exemple.fr/" }));
  writeFileSync(join(dir, "dom.html"), `<!-- ultra11y:capture v=1 page=accueil url=https://exemple.fr/ -->\n${DOM}\n`);
  if (axe !== undefined) writeFileSync(join(dir, "axe.json"), JSON.stringify(axe));
  return runAudit({ inputs: [join(dir, "dom.html")] });
}

const violation = (over: Record<string, unknown> = {}) => ({
  id: "color-contrast",
  impact: "serious",
  help: "Elements must meet minimum color contrast ratio thresholds",
  tags: ["wcag2aa", "wcag143"],
  nodes: [{ target: ["p.intro"], html: '<p class="intro">Bonjour</p>' }],
  ...over,
});

describe("an axe pass recorded beside a snapshot", () => {
  it("becomes a finding on the page it was reported on", () => {
    const r = pageWithAxe({ ran: true, violations: [violation()] });
    const f = r.findings.find((x) => x.ruleId === "axe:color-contrast");
    expect(f, "the axe violation never reached the audit").toBeTruthy();
    expect(f?.page).toBe("accueil");
    expect(f?.selectorHint).toBe("p.intro");
    expect(f?.message).toMatch(/axe: color-contrast/);
  });

  it("lands on the criterion axe's own mapping names, not on a catch-all", () => {
    const r = pageWithAxe({ ran: true, violations: [violation()] });
    expect(r.findings.find((x) => x.ruleId === "axe:color-contrast")?.criteriaId).toBe("1.4.3");
    expect(r.criteria.find((c) => c.id === "1.4.3")?.status).toBe("NC");
  });

  it("folds a best-practice rule as a recommendation, never as a non-conformity", () => {
    // Same rule as `scan`: a violation with no `wcag<digits>` tag evidences no testable
    // criterion, so it is advice. Reporting it as a non-conformity is how a backlog fills up
    // with work the standard never asked for.
    const r = pageWithAxe({ ran: true, violations: [violation({ id: "region", tags: ["best-practice"], nodes: [{ target: ["div"], html: "<div>" }] })] });
    const f = r.findings.find((x) => x.ruleId === "axe:region");
    expect(f?.advisory).toBe(true);
  });

  it("records nothing at all when no axe pass ran", () => {
    // The distinction the whole tier rests on: no file means nobody ran axe, which is not the
    // same claim as "axe ran and found nothing".
    const r = pageWithAxe(undefined);
    expect(r.findings.some((x) => x.ruleId.startsWith("axe:"))).toBe(false);
  });

  it("ignores a pass that did not run, even if it carries violations", () => {
    const r = pageWithAxe({ ran: false, violations: [violation()] });
    expect(r.findings.some((x) => x.ruleId.startsWith("axe:"))).toBe(false);
  });
});

// ---- what an axe pass that found NOTHING is allowed to conclude ---------------------------
//
// This is the half that closes criteria rather than opening them, and the half that must be
// wrong in only one direction. Silence from a rule engine that RAN on every page in scope is a
// measurement; silence from one that ran on some of them, or never started, is not — and
// reading the second as the first is how a grid fills with conformities nobody verified.
//
// The list of criteria axe may decide is deliberately tiny (src/axe-map.ts AXE_DECIDES) and
// deliberately explicit. axe reports on dozens of success criteria, but reporting on one is not
// the same as being its canonical decider: `color-contrast` computes the ratio the criterion is
// written in, while axe's ARIA rules cover a slice of 4.1.2 that no clean run can close.
describe("an axe pass that found nothing", () => {
  const clean = { ran: true, violations: [] as unknown[] };

  it("decides the criterion it is the canonical decider of, when it ran on every page", () => {
    const r = pageWithAxe(clean);
    const c = r.criteria.find((x) => x.id === "1.4.3");
    expect(c?.status).toBe("C");
    expect(c?.decidedBy).toBe("scan");
    expect(c?.justification ?? "").toMatch(/axe/i);
  });

  it("decides nothing when no axe pass ran", () => {
    expect(pageWithAxe(undefined).criteria.find((x) => x.id === "1.4.3")?.status).toBe("manual");
  });

  it("decides nothing it is not the canonical decider of, however clean the run", () => {
    // 4.1.2 is a judgment criterion: axe checks a slice of it (roles, names on widgets it
    // recognises) and a clean pass says nothing about the rest.
    expect(pageWithAxe(clean).criteria.find((x) => x.id === "4.1.2")?.status).toBe("manual");
  });

  it("reports the criteria it covered, so the partial-audit banner stops naming them", () => {
    expect(pageWithAxe(clean).scope.scan?.testedScs ?? []).toContain("1.4.3");
  });
});

// `check --require-decided` — the gate that turns "100% decided" from a hope into a check.
//
// It exists because a job can be green while deciding almost nothing. Measured on a real pull
// request: the page tier ran, adjudicated nothing, published 94 of 106 criteria as « à
// évaluer », and reported success — `fail-on` governs non-conformities, and an adjudication
// that lands nothing only warns. Anyone trusting the green tick was reading a grid nobody
// had filled in.
import { describe, expect, it } from "vitest";

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkDecided, isUndecidedFile } from "../src/check.js";
import { buildAdjudicationWorklist } from "../src/adjudicate.js";
import { unreadableCaptures } from "../src/ledger.js";
import { derivePackResults, getCriterion, isProvisionalJudgmentInapplicable, loadPack } from "../src/standards/index.js";
import { runAudit } from "../src/audit.js";
import { derivePages, pageView } from "../src/pages.js";
import type { AuditResult, CriterionResult, Finding } from "../src/types.js";
import { INAPPLICABLE_STATUS } from "../src/types.js";

const audit = (criteria: Pick<CriterionResult, "id" | "status">[]): AuditResult =>
  ({
    tool: "ultra11y",
    standard: "wcag",
    version: "0",
    schemaVersion: 2,
    date: "2026-08-18",
    scope: { inputs: ["src"], files: 1 },
    criteria: criteria.map((c) => ({ ...c, guideline: c.id.split(".").slice(0, 2).join("."), findings: [] })),
    guidelines: [],
    findings: [],
    residualRisks: [],
    conformancePct: 100,
  }) as unknown as AuditResult;

describe("check --require-decided", () => {
  it("passes when every criterion carries a verdict", () => {
    const r = checkDecided(
      audit([
        { id: "1.1.1", status: "C" },
        { id: "1.4.3", status: "NC" },
        { id: "1.2.1", status: "NA" },
      ]),
    );
    expect(r.ok).toBe(true);
    expect(r.undecided).toEqual([]);
  });

  it("fails and NAMES the criteria still to assess", () => {
    const r = checkDecided(
      audit([
        { id: "1.1.1", status: "C" },
        { id: "2.4.4", status: "manual" },
        { id: "1.3.1", status: "manual" },
      ]),
    );
    expect(r.ok).toBe(false);
    expect(r.undecided).toEqual(["1.3.1", "2.4.4"]);
    expect(r.issues.join(" ")).toMatch(/1\.3\.1, 2\.4\.4/);
  });

  it("accepts a criterion that is DECLARED undecidable, with its reason", () => {
    const r = checkDecided(audit([{ id: "2.4.4", status: "manual" }]), "wcag", "en", {
      allow: { entries: [{ criteriaId: "2.4.4", reason: "no page in scope carries a link to judge" }] },
    });
    expect(r.ok).toBe(true);
    expect(r.allowed).toHaveLength(1);
    expect(r.undecided).toEqual([]);
  });

  it("refuses a declaration with no reason — 'documented' has to mean something", () => {
    const r = checkDecided(audit([{ id: "2.4.4", status: "manual" }]), "wcag", "en", {
      allow: { entries: [{ criteriaId: "2.4.4", reason: "  " }] },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join(" ")).toMatch(/no reason/);
  });

  it("refuses a STALE declaration, so an exception cannot outlive what it excused", () => {
    const r = checkDecided(audit([{ id: "2.4.4", status: "C" }]), "wcag", "en", {
      allow: { entries: [{ criteriaId: "2.4.4", reason: "was undecidable last quarter" }] },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.join(" ")).toMatch(/now carries a verdict/);
  });

  it("lets an explicit refresh accept a new verdict that supersedes yesterday's exception", () => {
    const r = checkDecided(audit([{ id: "2.4.4", status: "C" }]), "wcag", "en", {
      allow: { entries: [{ criteriaId: "2.4.4", reason: "was undecidable before this refresh" }] },
      allowStale: true,
    });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("recognises an allowance file by its entries array, and nothing else", () => {
    expect(isUndecidedFile({ entries: [] })).toBe(true);
    expect(isUndecidedFile({ criteria: [] })).toBe(false);
    expect(isUndecidedFile(null)).toBe(false);
  });

  it("counts every provisional judgment NA that verify keeps open", () => {
    const fixture = new URL("./fixtures/conforming/good.html", import.meta.url).pathname;
    const a = runAudit({ inputs: [fixture] });
    const pack = loadPack("rgaa");
    const provisional = derivePackResults(a, "rgaa")
      .filter((row) => isProvisionalJudgmentInapplicable(row, getCriterion(pack, row.id)))
      .map((row) => row.id);
    const verifyOpen = buildAdjudicationWorklist(a, { standard: "rgaa" })
      .map((row) => row.criteriaId)
      .sort();
    const gate = checkDecided(a, "rgaa", "en");

    expect(provisional.length).toBeGreaterThan(0); // proves the regression shape engaged
    expect(gate.undecided).toHaveLength(verifyOpen.length);
    expect(gate.undecided).toEqual(expect.arrayContaining(verifyOpen));
    expect(gate.undecided).toEqual(expect.arrayContaining(provisional));
    expect(gate.provenance.undecided).toBe(verifyOpen.length);
  });
});

describe("a not-applicable verdict is not a conformity, and is not gated like one", () => {
  it("accepts an NA with a justification and no citations", async () => {
    // The engine's OWN NA carries a justification naming what it searched for, and no
    // citations (src/audit.ts subjectMatterReason). Demanding citations from the agent was
    // holding it to a stricter standard than the engine — and a contradictory one: an NA says
    // "none of this is what the criterion is about", so citing the elements it just ruled out
    // of scope makes no sense. Measured on a real run, six criteria were refused for this
    // alone, every one of them an honest NA.
    const { applyAdjudication, buildAdjudicationWorklist } = await import("../src/adjudicate.js");
    const { runAudit } = await import("../src/audit.js");
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = mkdtempSync(join(tmpdir(), "u11y-na-"));
    const f = join(dir, "p.html");
    writeFileSync(f, `<!doctype html><html lang="fr"><head><title>T</title></head><body><main><h1>H</h1><a href="/x">Voir la page x</a></main></body></html>`);
    const audit = runAudit({ inputs: [f] });
    const items = buildAdjudicationWorklist(audit).map((it) =>
      it.criteriaId === "2.4.4"
        ? { ...it, verdict: "NA" as const, justification: "Aucun lien de ce type n'est concerné dans le périmètre audité." }
        : { ...it, verdict: "manual" as const, reason: "undecidable" },
    );
    const r = applyAdjudication(audit, { tool: "ultra11y", kind: "adjudication", schemaVersion: 2, standard: "wcag", auditDate: audit.date, items });

    expect(r.issues.join("\n")).not.toMatch(/must cite at least one/);
    expect(r.audit.criteria.find((c) => c.id === "2.4.4")?.status).toBe(INAPPLICABLE_STATUS);
  });
});

// THE PAGE DIMENSION — a strictly higher bar, and the one a per-page deliverable is judged on.
//
// The run's grid can be complete while a page's is not. A criterion non-conforming somewhere is
// SETTLED for the run; on a page the failure never fired on it may still be nobody's verdict.
// Measured on egapro: 104 of 106 decided for the run, and 8 to 11 open on each of its 37 pages
// — a green completeness gate over a deliverable that was 90 % filled in.
describe("check --require-decided=pages", () => {
  const F = (over: Partial<Finding> = {}): Finding =>
    ({
      ruleId: "img-alt-missing",
      criteriaId: "1.1.1",
      file: "src/a.html",
      line: 1,
      col: 1,
      selectorHint: "img",
      severity: "bloquant",
      message: "x",
      remediation: "y",
      snippet: "",
      ...over,
    }) as Finding;

  const withPages = (criteria: Pick<CriterionResult, "id" | "status">[]): AuditResult => {
    const a = audit(criteria);
    a.scope.pages = [
      { id: "accueil", name: "Accueil", url: "https://x/", basis: "snapshot" },
      { id: "contact", name: "Contact", url: "https://x/contact", basis: "snapshot" },
    ];
    a.scope.pagesAudited = ["accueil", "contact"];
    return a;
  };

  it("passes the run and FAILS the page, when a criterion is decided only run-wide", () => {
    // 1.1.1 is NC for the run — a definite failure fired on `contact`. Nothing fired on
    // `accueil`, and 1.1.1 is not a criterion the engine decides by silence, so there it is
    // nobody's verdict yet. 2.4.2 is static, so silence on a snapshot page does decide it.
    const a = withPages([
      { id: "1.1.1", status: "NC" },
      { id: "2.4.2", status: "C" },
    ]);
    expect(checkDecided(a).ok).toBe(true);
    const perPage = checkDecided(a, "wcag", "en", { pages: true });
    expect(perPage.ok).toBe(false);
    expect(perPage.pages?.map((p) => p.name)).toEqual(["Accueil", "Contact"]);
    expect(perPage.pages?.every((p) => p.undecided.includes("1.1.1"))).toBe(true);
  });

  it("keeps provisional judgment NA open on every affected page", () => {
    const a = withPages([{ id: "2.4.2", status: "C" }]);
    a.scope.subjectsSeen = [];
    a.scope.pageSubjects = { accueil: [], contact: [] };
    const pack = loadPack("rgaa");
    const pages = derivePages(a, a.scope.pages!);
    const provisionalByPage = new Map(
      pages.map((page) => [
        page.id,
        derivePackResults(pageView(a, page), "rgaa", page.id)
          .filter((row) => isProvisionalJudgmentInapplicable(row, getCriterion(pack, row.id)))
          .map((row) => row.id),
      ]),
    );
    const gate = checkDecided(a, "rgaa", "en", { pages: true });

    expect([...provisionalByPage.values()].every((ids) => ids.length > 0)).toBe(true);
    expect(gate.pages?.map((page) => page.id)).toEqual(["accueil", "contact"]);
    for (const page of gate.pages ?? []) {
      expect(page.undecided).toEqual(expect.arrayContaining(provisionalByPage.get(page.id)!));
    }
  });

  it("states what is open EVERYWHERE once, and what is specific to a page on that page", () => {
    // Under a per-page norm the usual shape is a criterion nobody can decide anywhere, so the
    // naive rendering is one identical line per page — a wall that hides the page with a
    // problem of its own. Here 1.1.1 is open on both, and 1.3.1 only on `accueil` (a definite
    // failure on `contact` settles it there).
    const only = F({ page: "contact", criteriaId: "1.3.1" });
    const a = withPages([
      { id: "1.1.1", status: "NC" },
      { id: "1.3.1", status: "NC" },
      { id: "2.4.2", status: "C" },
    ]);
    a.criteria[1]!.findings = [only];
    a.findings = [only];
    const r = checkDecided(a, "wcag", "en", { pages: true });
    expect(r.issues.join("\n")).toMatch(/On all 2 affected page\(s\).*1\.1\.1/);
    expect(r.issues.join("\n")).toMatch(/Page “Accueil”.*1\.3\.1/);
    expect(r.issues.join("\n")).not.toMatch(/Page “Contact”/);
  });

  it("passes, and says it looked, when no page is in scope", () => {
    // `[]` means "checked, nothing open"; `undefined` means "nobody looked". A gate whose
    // result cannot tell those apart is one you cannot audit.
    const r = checkDecided(audit([{ id: "1.1.1", status: "C" }]), "wcag", "en", { pages: true });
    expect(r.ok).toBe(true);
    expect(r.pages).toEqual([]);
    expect(checkDecided(audit([{ id: "1.1.1", status: "C" }])).pages).toBeUndefined();
  });

  it("honours the declared-undecidable list on a page too", () => {
    const a = withPages([
      { id: "1.1.1", status: "NC" },
      { id: "2.4.2", status: "C" },
    ]);
    const allow = { entries: [{ criteriaId: "1.1.1", reason: "no image in the design system yet" }] };
    // Declared at the run level, the same criterion must not come back through the page door —
    // an exception a reader signed off once should not have to be signed off per route.
    expect(checkDecided(a, "wcag", "en", { pages: true, allow }).ok).toBe(true);
  });
});

// A LEDGER WRITTEN WITHOUT THE CAPTURES IS STALE ON ARRIVAL.
//
// The fingerprint is over the evidence the harvest READ FROM DISK. Recording a verdict where
// the audit's page captures are absent fingerprints a strictly smaller set than the one CI
// rebuilds, so the replay drops it as stale — every run, silently. Measured on a real
// repository: RGAA 12.3 recorded over 13 evidence items where the run harvests 22. The entry
// looked well-formed, the fold accepted it, it was committed and reviewed, and it never once
// replayed. `unreadableCaptures` is what lets the caller be told.
describe("unreadableCaptures", () => {
  const withPagesAudited = (ids: string[]): AuditResult => ({ scope: { inputs: ["src"], files: 1, pagesAudited: ids } }) as unknown as AuditResult;

  it("names the pages the audit read whose capture is not on disk", () => {
    expect(unreadableCaptures(withPagesAudited(["accueil", "aide"]), mkdtempSync(join(tmpdir(), "u11y-blind-")))).toEqual(["accueil", "aide"]);
  });

  it("says nothing for a source-only audit — it has no capture to miss", () => {
    expect(unreadableCaptures(withPagesAudited([]))).toEqual([]);
    expect(unreadableCaptures({ scope: { inputs: ["src"], files: 1 } } as unknown as AuditResult)).toEqual([]);
  });

  it("says nothing when the captures ARE on disk", () => {
    const root = mkdtempSync(join(tmpdir(), "u11y-seeing-"));
    mkdirSync(join(root, ".ultra11y", "pages", "accueil"), { recursive: true });
    writeFileSync(join(root, ".ultra11y", "pages", "accueil", "dom.html"), '<!doctype html><html lang="fr"></html>');
    expect(unreadableCaptures(withPagesAudited(["accueil"]), root)).toEqual([]);
  });
});

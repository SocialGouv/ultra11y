// A CONFORMITY THAT CANNOT BE ATTACKED IS NOT A CONFORMITY, IT IS AN ASSERTION.
//
// `verify --report` puts claimed conformities on trial, one item per citation the agent
// cleared (`buildConformityWorklist`). It read those citations from the verdict LEDGER, and
// the ledger is opt-in — so a run recorded without `--ledger` produced an audit whose every
// `C` was unattackable, because the fold had dropped `citations[]` on the way in. With a cheap
// adjudicator that is precisely the pass that has to run: the gate proves a citation resolves,
// never that clearing the criterion on it was right.
//
// So the audit document itself carries what it was cleared on. The ledger stays the
// cross-run replay optimisation it always was, instead of being the price of a second reader.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import { buildAdjudicationWorklist, applyAdjudication, type AdjudicationFile, type AdjudicationItem } from "../src/adjudicate.js";
import { buildConformityWorklist, conformityClaimsFromAudit } from "../src/verify.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-cite-carry-"));
const PAGE = join(dir, "page.html");
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Boutique</title></head><body><main>
<h1>Bienvenue</h1>
<img src="hero.png" alt="Un randonneur sur une crête">
<label for="email">Email</label><input id="email" type="email">
<a href="/aide">Contacter le support</a>
</main></body></html>`,
);

const audit = () => runAudit({ inputs: [PAGE] });

const adjFile = (items: AdjudicationItem[], standard: string): AdjudicationFile => ({
  tool: "ultra11y",
  kind: "adjudication",
  schemaVersion: 2,
  standard,
  auditDate: "2026-08-24",
  items,
});

/** Every criterion cleared on its own first harvested anchor; evidence-less ones stay manual. */
const clear = (it: AdjudicationItem): AdjudicationItem =>
  it.evidence.length
    ? { ...it, verdict: "C" as const, justification: "vérifié sur la page", citations: [it.evidence[0]!] }
    : { ...it, verdict: "manual" as const, reason: "undecidable" };

const foldAll = (standard: string, mutate: (it: AdjudicationItem) => AdjudicationItem = clear) => {
  const items = buildAdjudicationWorklist(audit(), { standard });
  return applyAdjudication(audit(), adjFile(items.map(mutate), standard), { cwd: dir });
};

describe("the fold carries the evidence a verdict was cleared on — pack branch", () => {
  const r = foldAll("rgaa");
  const cleared = () => r.audit.packAdjudication?.criteria.filter((c) => c.status === "C" && c.decidedBy === "agent") ?? [];

  it("landed some agent conformities at all", () => {
    expect(r.rejectedCriteria, r.issues.join("\n")).toEqual([]);
    expect(cleared().length).toBeGreaterThan(0);
  });

  it("records the citations on every one of them", () => {
    for (const c of cleared()) expect(c.citations?.length, `${c.id} was cleared on nothing`).toBeGreaterThan(0);
  });

  it("keeps the anchor a refuter needs to open the file", () => {
    const c = cleared()[0]!;
    expect(c.citations?.[0]).toMatchObject({ file: expect.any(String), line: expect.any(Number) });
  });

  it("carries them on a `NA` too — it also names what it ruled out of scope", () => {
    const na = foldAll("rgaa", (it) =>
      it.evidence.length
        ? { ...it, verdict: "NA" as const, justification: "hors périmètre ici", citations: [it.evidence[0]!] }
        : { ...it, verdict: "manual" as const, reason: "undecidable" },
    );
    const decided = na.audit.packAdjudication?.criteria.filter((c) => c.status === "NA") ?? [];
    expect(decided.length).toBeGreaterThan(0);
    for (const c of decided) expect(c.citations?.length, `${c.id}`).toBeGreaterThan(0);
  });

  it("attaches none to a non-conformity — an NC is anchored by its findings, not by citations", () => {
    for (const c of r.audit.packAdjudication?.criteria.filter((x) => x.status === "NC") ?? []) {
      expect(c.citations ?? []).toEqual([]);
    }
  });
});

describe("the fold carries them on the WCAG core too", () => {
  it("records the citations on an agent-decided success criterion", () => {
    const r = foldAll("wcag");
    expect(r.rejectedCriteria, r.issues.join("\n")).toEqual([]);
    const cleared = r.audit.criteria.filter((c) => c.decidedBy === "agent" && c.status === "C");
    expect(cleared.length).toBeGreaterThan(0);
    for (const c of cleared) expect(c.citations?.length, `${c.id} was cleared on nothing`).toBeGreaterThan(0);
  });
});

describe("a run with no ledger can still put its conformities on trial", () => {
  it("reads the claims straight out of the audit document — pack", () => {
    const r = foldAll("rgaa");
    const claims = conformityClaimsFromAudit(r.audit, "rgaa");
    expect(claims.length).toBeGreaterThan(0);
    expect(buildConformityWorklist(claims).length).toBeGreaterThan(0);
    for (const c of claims) expect(c.verdict).toBe("C");
  });

  it("reads them out of the core audit too", () => {
    const r = foldAll("wcag");
    expect(buildConformityWorklist(conformityClaimsFromAudit(r.audit, "wcag")).length).toBeGreaterThan(0);
  });

  it("leaves the ENGINE's conformities alone — a criterion recomputed every run needs no second reader", () => {
    const plain = audit();
    expect(conformityClaimsFromAudit(plain, "rgaa")).toEqual([]);
    expect(conformityClaimsFromAudit(plain, "wcag")).toEqual([]);
  });

  it("does not read a pack adjudication recorded under a DIFFERENT standard", () => {
    const r = foldAll("rgaa");
    expect(conformityClaimsFromAudit(r.audit, "wcag")).toEqual([]);
  });

  it("carries the justification, because that is the claim on trial", () => {
    const r = foldAll("rgaa");
    for (const c of conformityClaimsFromAudit(r.audit, "rgaa")) expect(c.justification).toBeTruthy();
  });
});

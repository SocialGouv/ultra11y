// A NAMED HUMAN AUDITOR'S VERDICT — `decidedBy: "human"`.
//
// A legally meaningful RGAA audit (the « déclaration d'accessibilité ») names a human auditor.
// The fold used to stamp `decidedBy: "agent"` on every verdict whatever its origin, so a person
// who adjudicated through the same worklist was published as an AI.
//
// The semantics, settled before the code:
//   • the SAME gate: a human `C` cites harvested evidence, a human `NC` carries groundable
//     findings — a name is not a substitute for evidence;
//   • the auditor is NAMED: `decidedBy: "human"` without `auditor.name` is refused;
//   • NOT on automatic trial: the refutation pass (`verify --report`) puts the AGENT's
//     conformities on trial; a named auditor is the second reader, so theirs are not tried;
//   • counted like any decided verdict in the conformity rate, kept out of the AUTOMATIC rate
//     (it is a judgement, not a measurement), and shown as « auditeur (name) », never « IA ».
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { type AdjudicationFile, type AdjudicationItem, applyAdjudication, buildAdjudicationWorklist } from "../src/adjudicate.js";
import { runAudit } from "../src/audit.js";
import { checkDecided, checkReport } from "../src/check.js";
import { entriesFrom, mergeLedger, replayLedger } from "../src/ledger.js";
import { renderPackReport, renderReport } from "../src/report.js";
import { derivePackResults, loadPack } from "../src/standards/index.js";
import { renderPageGrid } from "../src/pages.js";
import { renderPageReport } from "../src/pages-report.js";
import { derivePages } from "../src/pages.js";
import { pruneRefuted } from "../src/refute.js";
import { buildConformityWorklist, conformityClaimsFromAudit } from "../src/verify.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-adj-human-"));
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

const AUDITOR = { name: "Jeanne Dupont", organisation: "Access42" };
const audit = () => runAudit({ inputs: [PAGE] });

const adjFile = (items: AdjudicationItem[], standard = "rgaa"): AdjudicationFile => ({
  tool: "ultra11y",
  kind: "adjudication",
  schemaVersion: 2,
  standard,
  auditDate: "2026-11-02",
  items,
});

const clear = (it: AdjudicationItem): AdjudicationItem =>
  it.evidence.length
    ? { ...it, verdict: "C" as const, justification: "vérifié sur la page", citations: [it.evidence[0]!] }
    : { ...it, verdict: "manual" as const, reason: "undecidable" };

/** Every open criterion cleared by the agent, except `id`, which the human rules. */
function filled(standard: "rgaa" | "wcag", id: string, human: Partial<AdjudicationItem>): AdjudicationFile {
  const items = buildAdjudicationWorklist(audit(), { standard }).map((it) =>
    it.criteriaId === id ? ({ ...clear(it), ...human } as AdjudicationItem) : clear(it),
  );
  return adjFile(items, standard);
}

const HUMAN = { decidedBy: "human" as const, auditor: AUDITOR };

describe("the fold records a human verdict as the human's", () => {
  it("under a pack: decidedBy human, the auditor named, the rest still the agent's", () => {
    const r = applyAdjudication(audit(), filled("rgaa", "11.2", HUMAN));
    expect(r.issues).toEqual([]);
    const entry = r.audit.packAdjudication!.criteria.find((c) => c.id === "11.2")!;
    expect(entry).toMatchObject({ status: "C", decidedBy: "human", auditor: AUDITOR });
    const other = r.audit.packAdjudication!.criteria.find((c) => c.id !== "11.2" && c.status === "C")!;
    expect(other.decidedBy).toBe("agent");
    expect(other.auditor).toBeUndefined();
    // …and the projection every report reads carries it.
    const derived = derivePackResults(r.audit, "rgaa").find((d) => d.id === "11.2")!;
    expect(derived).toMatchObject({ status: "C", decidedBy: "human", auditor: AUDITOR });
  });

  it("under the core: the WCAG criterion carries it", () => {
    const id = buildAdjudicationWorklist(audit()).find((it) => it.evidence.length)!.criteriaId;
    const r = applyAdjudication(audit(), filled("wcag", id, HUMAN));
    expect(r.issues).toEqual([]);
    expect(r.audit.criteria.find((c) => c.id === id)).toMatchObject({ status: "C", decidedBy: "human", auditor: AUDITOR });
  });
});

describe("the same gate, plus a name", () => {
  it("refuses a human verdict that names no auditor", () => {
    const r = applyAdjudication(audit(), filled("rgaa", "11.2", { decidedBy: "human" }));
    expect(r.rejectedCriteria).toEqual(["11.2"]);
    expect(r.issues.join("\n")).toMatch(/auditor/);
  });

  it("refuses an uncited human C exactly like an uncited agent C", () => {
    const r = applyAdjudication(audit(), filled("rgaa", "11.2", { ...HUMAN, citations: [] }));
    expect(r.rejectedCriteria).toEqual(["11.2"]);
  });

  it("refuses a decidedBy the adjudication may not claim", () => {
    const r = applyAdjudication(audit(), filled("rgaa", "11.2", { decidedBy: "engine" as never }));
    expect(r.rejectedCriteria).toEqual(["11.2"]);
    expect(r.issues.join("\n")).toMatch(/decidedBy/);
  });
});

describe("the ledger keeps who ruled, and a replay restores it", () => {
  it("records decidedBy human and the auditor, and replays both", () => {
    const adj = filled("rgaa", "11.2", HUMAN);
    const folded = applyAdjudication(audit(), adj);
    const accepted = new Set(adj.items.map((it) => it.criteriaId).filter((id) => !folded.rejectedCriteria.includes(id)));
    const entries = entriesFrom(adj, accepted, "2026-11-02");
    expect(entries.find((e) => e.criteriaId === "11.2")).toMatchObject({ decidedBy: "human", auditor: AUDITOR });
    expect(entries.find((e) => e.criteriaId !== "11.2")!.decidedBy).toBe("agent");

    const replay = replayLedger(audit(), mergeLedger(undefined, "rgaa", entries), { standard: "rgaa" });
    expect(replay.adj.items.find((it) => it.criteriaId === "11.2")).toMatchObject({ decidedBy: "human", auditor: AUDITOR });
    const again = applyAdjudication(audit(), replay.adj);
    expect(again.audit.packAdjudication!.criteria.find((c) => c.id === "11.2")).toMatchObject({ decidedBy: "human", auditor: AUDITOR });
  });
});

describe("a named auditor is the second reader — no automatic trial", () => {
  it("puts the agent's conformities on trial and not the human's", () => {
    const r = applyAdjudication(audit(), filled("rgaa", "11.2", HUMAN));
    const tried = conformityClaimsFromAudit(r.audit, "rgaa").map((c) => c.criteriaId);
    expect(tried).not.toContain("11.2");
    expect(tried.length).toBeGreaterThan(0);
  });
});

describe("…and if a refuter withdraws it anyway, the prune leaves it standing", () => {
  it("counts it apart from the engine's and keeps the verdict", () => {
    const folded = applyAdjudication(audit(), filled("rgaa", "11.2", HUMAN)).audit;
    const entry = folded.packAdjudication!.criteria.find((c) => c.id === "11.2")!;
    const items = buildConformityWorklist([{ criteriaId: "11.2", verdict: "C", justification: entry.justification, citations: entry.citations }]).map((it) => ({
      ...it,
      verdict: "refuted" as const,
    }));
    const pruned = pruneRefuted(folded, "rgaa", items);
    expect(pruned.skippedHuman).toBe(1);
    expect(pruned.skippedHumanClaims.map((c) => c.criteriaId)).toEqual(["11.2"]);
    expect(pruned.skippedEngineClaims).toEqual([]);
    expect(pruned.skippedEngine).toBe(0);
    expect(pruned.audit.packAdjudication!.criteria.find((c) => c.id === "11.2")).toMatchObject({ status: "C", decidedBy: "human" });
  });
});

describe("the page grid and the page sheet mark it `C†`, apart from the agent's `C*`", () => {
  const folded = applyAdjudication(audit(), filled("rgaa", "11.2", HUMAN)).audit;
  folded.scope.pages = [{ id: "accueil", name: "Accueil", url: "https://exemple.fr/", sources: [PAGE], basis: "attributed" as const }];

  it("in the grid", () => {
    const grid = renderPageGrid(folded, folded.scope.pages!, "rgaa", "fr");
    expect(grid).toMatch(/^\| 11\.2 \| C† \|$/m);
    expect(grid).toContain("`C†` : conformité tranchée par un auditeur humain nommé");
  });

  it("in the page sheet", () => {
    const [page] = derivePages(folded, folded.scope.pages!);
    const sheet = renderPageReport(folded, page!, { standard: "rgaa", lang: "fr" });
    expect(sheet).toMatch(/\| C† \|$/m);
    expect(sheet).toMatch(/\| C\* \|$/m);
    expect(sheet).toContain("`C†`");
  });
});

describe("the reports say « auditeur », never « IA »", () => {
  const folded = applyAdjudication(audit(), filled("rgaa", "11.2", HUMAN)).audit;
  const md = renderPackReport(folded, loadPack("rgaa"), "fr");

  it("names the auditor in the exhaustive grid's « Décidé par » column", () => {
    const row = md.split("\n").find((l) => l.startsWith("| RGAA 11.2 ") || l.startsWith("| 11.2 "));
    expect(row).toMatch(/\| auditeur \(Jeanne Dupont, Access42\) \|$/);
    expect(row).not.toMatch(/\| IA \|$/);
  });

  it("counts the human verdicts on their own in the provenance", () => {
    expect(md).toMatch(/Provenance des décisions\*\* : \d+ moteur · \d+ navigateur · \d+ adjudication · 1 auditeur humain/);
  });

  it("lists the human's conformities apart from the agent's", () => {
    expect(md).toMatch(/### Conformes par décision de l'auditeur/);
  });

  it("keeps every gate passing — the automatic rate leaves the human's C out, like the agent's", () => {
    expect(checkReport(md, "rgaa", "fr", { audit: folded }).issues).toEqual([]);
  });

  it("counts it in `check --require-decided`'s provenance", () => {
    expect(checkDecided(folded, "rgaa", "fr").provenance.human).toBe(1);
  });

  it("in English: « auditor »", () => {
    const en = renderPackReport(folded, loadPack("rgaa"), "en");
    expect(en).toMatch(/\| auditor \(Jeanne Dupont, Access42\) \|/);
  });

  it("the core report too", () => {
    const id = buildAdjudicationWorklist(audit()).find((it) => it.evidence.length)!.criteriaId;
    const core = applyAdjudication(audit(), filled("wcag", id, HUMAN)).audit;
    const out = renderReport(core, "fr");
    expect(out).toMatch(/\| auditeur \(Jeanne Dupont, Access42\) \|/);
    expect(checkReport(out, "wcag", "fr", { audit: core }).issues).toEqual([]);
  });
});

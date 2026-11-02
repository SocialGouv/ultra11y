// `ultra11y_fold` — the MCP counterpart of `verify --apply`.
//
// `ultra11y_adjudicate` hands an MCP client a worklist; until this tool, the client had to leave
// the server and run the CLI to land the verdicts it wrote. The fold here is the CLI's fold:
// the same hydration of a verdicts-only file, the same gate (cited `C`, groundable `NC`), the
// same partial-by-default behaviour with every refusal listed, and the same ledger write.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AdjudicationItem } from "../src/adjudicate.js";
import { ledgerPath } from "../src/ledger.js";
import { callTool, ToolError } from "../src/mcp/handlers.js";
import { unwrapAudit } from "../src/standards/document.js";
import type { AuditResult } from "../src/types.js";

const PAGE = `<!doctype html><html lang="fr"><head><title>Boutique</title></head><body><main>
<h1>Bienvenue</h1>
<img src="hero.png" alt="Un randonneur sur une crête">
<label for="email">Email</label><input id="email" type="email">
<a href="/aide">Contacter le support</a>
</main></body></html>
`;

let PROJECT = "";
beforeAll(() => {
  PROJECT = mkdtempSync(join(tmpdir(), "u11y-mcp-fold-"));
  writeFileSync(join(PROJECT, "index.html"), PAGE);
});
afterAll(() => rmSync(PROJECT, { recursive: true, force: true }));

const W = { allowWrite: true };
const json = async (name: string, args: Record<string, unknown>) => JSON.parse((await callTool(name, args, W)).text);

/** What an agent sends back: the decisions only, no evidence — the server re-derives it. */
async function verdicts(refuse?: string): Promise<{ adjudication: Record<string, unknown>; items: AdjudicationItem[]; ruled: string }> {
  const { items } = (await json("ultra11y_adjudicate", { cwd: PROJECT, standard: "rgaa" })) as { items: AdjudicationItem[] };
  const ruled = items.find((it) => it.evidence.length)!.criteriaId;
  const decided = items.map((it) =>
    it.criteriaId === refuse
      ? { criteriaId: it.criteriaId, verdict: "C", justification: "trust me" } // uncited: the gate refuses it
      : it.evidence.length
        ? { criteriaId: it.criteriaId, verdict: "C", justification: "vérifié sur la page", citations: [it.evidence[0]] }
        : { criteriaId: it.criteriaId, verdict: "manual", reason: "undecidable" },
  );
  return {
    adjudication: { tool: "ultra11y", kind: "adjudication", schemaVersion: 2, standard: "rgaa", auditDate: "2026-11-02", items: decided },
    items,
    ruled,
  };
}

describe("ultra11y_fold", () => {
  it("is a write tool: refused unless the server runs with --allow-write", async () => {
    const { adjudication } = await verdicts();
    await expect(callTool("ultra11y_fold", { cwd: PROJECT, adjudication })).rejects.toThrow(/--allow-write/);
  });

  it("dry-runs by default: the gate's verdict, nothing written", async () => {
    const { adjudication } = await verdicts();
    const r = await json("ultra11y_fold", { cwd: PROJECT, adjudication });
    expect(r).toMatchObject({ ok: true, written: false, rejected: 0, standard: "rgaa" });
    expect(r.applied).toBeGreaterThan(0);
    expect(existsSync(join(PROJECT, "audit-latest.json"))).toBe(false);
    expect(existsSync(ledgerPath("rgaa", PROJECT))).toBe(false);
  });

  it("folds partially, listing every refusal by criterion", async () => {
    const first = await verdicts();
    const { adjudication } = await verdicts(first.ruled);
    const r = await json("ultra11y_fold", { cwd: PROJECT, adjudication });
    expect(r.ok).toBe(false);
    expect(r.rejectedCriteria).toEqual([first.ruled]);
    // The rest still landed: the other verdicts are kept, only the refused one stays open.
    expect(r.applied + r.stillManual).toBeGreaterThan(0);
    expect((r.issues as string[]).some((i) => i.includes(first.ruled))).toBe(true);
  });

  it("strict: one refusal and nothing lands, even with write", async () => {
    const first = await verdicts();
    const { adjudication } = await verdicts(first.ruled);
    const r = await json("ultra11y_fold", { cwd: PROJECT, adjudication, strict: true, write: true, ledger: true });
    expect(r).toMatchObject({ ok: false, written: false, applied: 0 });
    expect(existsSync(join(PROJECT, "audit-latest.json"))).toBe(false);
  });

  it("with write: the folded audit, and with ledger: the accepted verdicts only", async () => {
    const first = await verdicts();
    const { adjudication } = await verdicts(first.ruled);
    const r = await json("ultra11y_fold", { cwd: PROJECT, adjudication, write: true, ledger: true, out: "audits" });
    expect(r.written).toBe(true);
    expect(r.auditPath).toBe(join(PROJECT, "audits", "audit-latest.json"));
    // Written in the standard's own shape, as `verify --apply` writes it; the core inside it
    // carries the fold.
    const folded = unwrapAudit(JSON.parse(readFileSync(r.auditPath, "utf8"))) as AuditResult;
    expect(folded.adjudicated?.applied).toBe(r.applied);
    expect(folded.packAdjudication?.criteria.find((c) => c.id === first.ruled)?.status).toBe("manual");

    expect(r.ledger).toMatchObject({ path: ledgerPath("rgaa", PROJECT) });
    const ledger = JSON.parse(readFileSync(r.ledger.path, "utf8"));
    const ids = ledger.entries.map((e: { criteriaId: string }) => e.criteriaId);
    expect(ids).not.toContain(first.ruled);
    expect(ids.length).toBe(r.ledger.recorded);
    expect(r.ledger.recorded).toBeGreaterThan(0);
  });

  it("lands a named human auditor's verdict as theirs (decidedBy: human)", async () => {
    const { adjudication, ruled } = await verdicts();
    const items = (adjudication.items as Record<string, unknown>[]).map((it) =>
      it.criteriaId === ruled ? { ...it, decidedBy: "human", auditor: { name: "Jeanne Dupont" } } : it,
    );
    const out = join(PROJECT, "human");
    const r = await json("ultra11y_fold", { cwd: PROJECT, adjudication: { ...adjudication, items }, write: true, out: "human" });
    expect(r).toMatchObject({ ok: true, written: true, auditPath: join(out, "audit-latest.json") });
    const folded = unwrapAudit(JSON.parse(readFileSync(r.auditPath, "utf8"))) as AuditResult;
    expect(folded.packAdjudication?.criteria.find((c) => c.id === ruled)).toMatchObject({ decidedBy: "human", auditor: { name: "Jeanne Dupont" } });
  });

  it("reads the adjudication from a file too", async () => {
    const { adjudication } = await verdicts();
    const file = join(PROJECT, "ADJUDICATE.verdicts.json");
    writeFileSync(file, JSON.stringify(adjudication));
    const r = await json("ultra11y_fold", { cwd: PROJECT, adjudication_file: file });
    expect(r).toMatchObject({ ok: true, written: false });
  });

  it("refuses what is not an adjudication, and a standard that contradicts it", async () => {
    await expect(callTool("ultra11y_fold", { cwd: PROJECT, adjudication: { kind: "verdict-ledger" } }, W)).rejects.toBeInstanceOf(ToolError);
    const { adjudication } = await verdicts();
    await expect(callTool("ultra11y_fold", { cwd: PROJECT, adjudication, standard: "wcag" }, W)).rejects.toThrow(/standard/);
    await expect(callTool("ultra11y_fold", { cwd: PROJECT }, W)).rejects.toThrow(/adjudication/);
  });
});

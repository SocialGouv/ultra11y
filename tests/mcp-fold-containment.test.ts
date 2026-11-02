// #116 — `ultra11y_fold` reads `audit_file` and `adjudication_file` and writes under `out`. Like
// `ultra11y_read`, it must stay inside the project root it was called on: this server can be
// reached over HTTP, and a fold that writes `audit-latest.json` wherever it is told is a write
// primitive on the whole filesystem.
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AdjudicationItem } from "../src/adjudicate.js";
import { callTool } from "../src/mcp/handlers.js";

const PAGE = `<!doctype html><html lang="fr"><head><title>Boutique</title></head><body><main>
<h1>Bienvenue</h1><img src="hero.png" alt="Un randonneur sur une crête"><a href="/aide">Contacter le support</a>
</main></body></html>
`;

let PROJECT = "";
let OUTSIDE = "";
beforeAll(() => {
  PROJECT = mkdtempSync(join(tmpdir(), "u11y-fold-root-"));
  OUTSIDE = mkdtempSync(join(tmpdir(), "u11y-fold-outside-"));
  writeFileSync(join(PROJECT, "index.html"), PAGE);
  symlinkSync(OUTSIDE, join(PROJECT, "escape"));
});
afterAll(() => {
  rmSync(PROJECT, { recursive: true, force: true });
  rmSync(OUTSIDE, { recursive: true, force: true });
});

const W = { allowWrite: true };
const json = async (name: string, args: Record<string, unknown>) => JSON.parse((await callTool(name, args, W)).text);

async function adjudication(): Promise<Record<string, unknown>> {
  const { items } = (await json("ultra11y_adjudicate", { cwd: PROJECT, standard: "rgaa" })) as { items: AdjudicationItem[] };
  const decided = items.map((it) =>
    it.evidence.length
      ? { criteriaId: it.criteriaId, verdict: "C", justification: "vérifié sur la page", citations: [it.evidence[0]] }
      : { criteriaId: it.criteriaId, verdict: "manual", reason: "undecidable" },
  );
  return { tool: "ultra11y", kind: "adjudication", schemaVersion: 2, standard: "rgaa", auditDate: "2026-11-02", items: decided };
}

describe("ultra11y_fold stays inside the project (#116)", () => {
  it("refuses an `out` that climbs out of the project, and writes nothing there", async () => {
    const adj = await adjudication();
    const away = join(OUTSIDE, "climbed");
    await expect(callTool("ultra11y_fold", { cwd: PROJECT, adjudication: adj, write: true, out: away }, W)).rejects.toThrow(/outside the project/);
    await expect(callTool("ultra11y_fold", { cwd: PROJECT, adjudication: adj, write: true, out: "../x" }, W)).rejects.toThrow(/outside the project/);
    expect(existsSync(away)).toBe(false);
    expect(existsSync(join(PROJECT, "..", "x"))).toBe(false);
  });

  it("refuses an `out` that escapes through a symlink inside the project", async () => {
    const adj = await adjudication();
    await expect(callTool("ultra11y_fold", { cwd: PROJECT, adjudication: adj, write: true, out: "escape/reports" }, W)).rejects.toThrow(/outside the project/);
    expect(existsSync(join(OUTSIDE, "reports"))).toBe(false);
    expect(existsSync(join(OUTSIDE, "audit-latest.json"))).toBe(false);
  });

  it("refuses an `audit_file` and an `adjudication_file` outside the project, even when they exist", async () => {
    const adj = await adjudication();
    const audit = await json("ultra11y_audit", { cwd: PROJECT });
    writeFileSync(join(OUTSIDE, "audit.json"), JSON.stringify(audit));
    writeFileSync(join(OUTSIDE, "adj.json"), JSON.stringify(adj));
    await expect(callTool("ultra11y_fold", { cwd: PROJECT, adjudication: adj, audit_file: join(OUTSIDE, "audit.json") }, W)).rejects.toThrow(
      /outside the project/,
    );
    await expect(callTool("ultra11y_fold", { cwd: PROJECT, adjudication: adj, audit_file: "escape/audit.json" }, W)).rejects.toThrow(/outside the project/);
    await expect(callTool("ultra11y_fold", { cwd: PROJECT, adjudication_file: join(OUTSIDE, "adj.json") }, W)).rejects.toThrow(/outside the project/);
    await expect(callTool("ultra11y_fold", { cwd: PROJECT, adjudication_file: join(PROJECT, "escape", "adj.json") }, W)).rejects.toThrow(/outside the project/);
  });

  it("still folds files and writes an `out` that stay inside the project", async () => {
    const adj = await adjudication();
    mkdirSync(join(PROJECT, "work"), { recursive: true });
    writeFileSync(join(PROJECT, "work", "adj.json"), JSON.stringify(adj));
    writeFileSync(join(PROJECT, "work", "audit.json"), JSON.stringify(await json("ultra11y_audit", { cwd: PROJECT })));
    const r = await json("ultra11y_fold", {
      cwd: PROJECT,
      adjudication_file: join(PROJECT, "work", "adj.json"),
      audit_file: "work/audit.json",
      write: true,
      out: "reports/rgaa",
    });
    expect(r).toMatchObject({ ok: true, written: true });
    expect(existsSync(join(PROJECT, "reports", "rgaa", "audit-latest.json"))).toBe(true);
  });
});

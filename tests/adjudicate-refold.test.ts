// RE-FOLDING A VERDICT THE PREVIOUS FOLD DECIDED MUST REFUSE, NEVER CRASH.
//
// An orchestrator that adjudicates in rounds re-applies its file on the audit the last fold
// wrote back. That audit no longer carries the criterion in its worklist — it is decided — so
// `hydrateAdjudication` leaves the item un-restored, and the per-item gate read `it.evidence`
// on an undefined and died with `TypeError: Cannot read properties of undefined (reading
// 'length')`: exit 1, NOTHING on stdout although `--json` was given, indistinguishable from a
// refusal unless the caller also parses stderr.
//
// The contract it must fold to instead is the one the coverage check already had: the verdict
// is refused BY NAME as « not open for adjudication », and under `--json` the refusal is a JSON
// answer on stdout.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { runAudit } from "../src/audit.js";
import { buildAdjudicationWorklist } from "../src/adjudicate.js";
import { main } from "../src/cli.js";
import { derivePackResults } from "../src/standards/index.js";
import type { AuditResult } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-refold-"));
const PAGE = join(dir, "page.html");
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Aide</title></head><body><main><h1>Aide</h1><img src="/a.svg" alt="Schéma"><a href="/c">Contact</a></main></body></html>`,
);

const out = join(dir, "R");
const inAudit = join(out, "audit-latest.json");

async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const o: string[] = [];
  const e: string[] = [];
  const lo = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void o.push(a.join(" ")));
  const le = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void e.push(a.join(" ")));
  try {
    const code = await main(argv);
    return { code, out: o.join("\n"), err: e.join("\n") };
  } finally {
    lo.mockRestore();
    le.mockRestore();
  }
}

/** The adjudication an orchestrator writes: ONE cited C, and no `evidence` field — the shape
 *  `hydrateAdjudication` is meant to put the evidence back into at fold time. */
function oneCitedC(): string {
  const worklist = buildAdjudicationWorklist(runAudit({ inputs: [PAGE] }), { standard: "rgaa", cwd: dir });
  const src = worklist.find((i) => i.criteriaId === "1.1");
  if (!src?.evidence.length) throw new Error("RGAA 1.1 must be open with evidence on this fixture");
  const e = src.evidence[0]!;
  const adj = {
    tool: "ultra11y",
    kind: "adjudication",
    schemaVersion: 2,
    standard: "rgaa",
    auditDate: runAudit({ inputs: [PAGE] }).date,
    items: [
      {
        criteriaId: "1.1",
        verdict: "C",
        justification: "vérifié sur la page",
        citations: [{ file: e.file, line: e.line, ...(e.selector ? { selector: e.selector } : {}), ...(e.snippet ? { snippet: e.snippet } : {}) }],
      },
    ],
  };
  const path = join(dir, "adj.json");
  writeFileSync(path, JSON.stringify(adj, null, 2));
  return path;
}

describe("re-folding a criterion the previous fold decided", () => {
  it("refuses it by name as already decided, with JSON on stdout — never a bare TypeError", async () => {
    await run(["audit", PAGE, "--standard", "rgaa", "--out", out]);
    const adjPath = oneCitedC();
    const apply = ["verify", "--apply", adjPath, "--in", inAudit, "--out", out, "--json"];

    // Fold 1 lands: the criterion is open, the citation grounds, the fold applies.
    const first = await run(apply);
    expect(first.code, first.err).toBe(0);
    const firstJson = JSON.parse(first.out) as { ok: boolean; applied: number };
    expect(firstJson.ok).toBe(true);
    expect(firstJson.applied).toBe(1);

    // Fold 2 — the same adjudication on the WRITTEN-BACK audit — must answer, not crash.
    const second = await run(apply);
    expect(second.out, "a refusal the caller cannot parse is the bug: --json must always print JSON").not.toBe("");
    const r = JSON.parse(second.out) as { ok: boolean; applied: number; rejectedCriteria: string[]; issues: string[] };
    expect(second.code).toBe(1); // nothing landed, so the whole file is a refusal
    expect(r.ok).toBe(false);
    expect(r.applied).toBe(0);
    expect(r.rejectedCriteria).toContain("1.1");
    expect(r.issues.join("\n")).toMatch(/not open for adjudication/);

    // And the refusal must not undo what pass 1 decided: the written-back audit still carries
    // the criterion as conforming, not re-opened, not blanked.
    const after = JSON.parse(readFileSync(inAudit, "utf8")) as AuditResult;
    expect(derivePackResults(after, "rgaa").find((c) => c.id === "1.1")?.status).toBe("C");
  });
});

// A LOT IS NOT A PILE OF REFUSALS (#132).
//
// An adjudication split in lots folds each lot on its own: `verify --apply <lot>.verdicts.json`
// on a worklist holding 11 of egapro's 46 open criteria answered `{ ok: true, rejected: 35 }`,
// and the human output listed the 35 under « refused by the gate ». They were only the criteria
// absent from that lot — no verdict was offered for them, so none was refused. They are named
// apart (`notInWorklist`, « hors de la liste »), and `rejected` counts the gate's refusals only.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { runAudit } from "../src/audit.js";
import { buildAdjudicationWorklist } from "../src/adjudicate.js";
import { main } from "../src/cli.js";
import type { AuditResult } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-lot-"));
const PAGE = join(dir, "page.html");
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Aide</title></head><body><main><h1>Aide</h1><img src="/a.svg" alt="Schéma"><a href="/c">Contact</a></main></body></html>`,
);

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

/** A lot: the first `n` open RGAA criteria, ruled `manual`/`undecidable` (a verdict that needs no
 *  citation, so only the lot boundary is under test), optionally with one verdict left null. */
function writeLot(name: string, n: number, opts: { nullFirst?: boolean } = {}): { path: string; inLot: string[]; open: string[] } {
  const worklist = buildAdjudicationWorklist(runAudit({ inputs: [PAGE] }), { standard: "rgaa", cwd: dir });
  const lot = worklist.slice(0, n).map((it, i) => ({
    criteriaId: it.criteriaId,
    verdict: opts.nullFirst && i === 0 ? null : "manual",
    reason: "undecidable",
    justification: "",
  }));
  const path = join(dir, name);
  writeFileSync(
    path,
    JSON.stringify({ tool: "ultra11y", kind: "adjudication", schemaVersion: 2, standard: "rgaa", auditDate: runAudit({ inputs: [PAGE] }).date, items: lot }),
  );
  return { path, inLot: lot.map((i) => i.criteriaId), open: worklist.map((i) => i.criteriaId) };
}

type ApplyJson = { ok: boolean; applied: number; stillManual: number; rejected: number; rejectedCriteria: string[]; notInWorklist: string[]; issues: string[] };

describe("verify --apply on a partial worklist (#132)", () => {
  it("reports the criteria outside the lot as notInWorklist, with rejected: 0", async () => {
    const out = join(dir, "R1");
    await run(["audit", PAGE, "--standard", "rgaa", "--out", out]);
    const { path, inLot, open } = writeLot("lot1.json", 3);
    expect(open.length).toBeGreaterThan(inLot.length);

    const r = await run(["verify", "--apply", path, "--in", join(out, "audit-latest.json"), "--out", out, "--json"]);
    expect(r.code, r.err).toBe(0);
    const j = JSON.parse(r.out) as ApplyJson;
    expect(j.stillManual).toBe(3);
    expect(j.rejected).toBe(0);
    expect(j.rejectedCriteria).toEqual([]);
    expect(j.issues).toEqual([]);
    expect(j.notInWorklist).toEqual(open.filter((id) => !inLot.includes(id)));
    // The written-back audit does not record gaps as refusals either.
    const after = JSON.parse(readFileSync(join(out, "audit-latest.json"), "utf8")) as { core?: AuditResult } & AuditResult;
    expect((after.core ?? after).adjudicated?.rejected).toBeUndefined();
  });

  it("says so in the human output, apart from any refusal", async () => {
    const out = join(dir, "R2");
    await run(["audit", PAGE, "--standard", "rgaa", "--out", out]);
    const { path, inLot, open } = writeLot("lot2.json", 3);
    const gaps = open.length - inLot.length;

    const r = await run(["verify", "--apply", path, "--in", join(out, "audit-latest.json"), "--out", out]);
    expect(r.code, r.err).toBe(0);
    expect(r.err).not.toMatch(/refused by the gate/);
    expect(r.err).toContain(`${gaps} criterion(ia) not in this worklist`);
    expect(r.out).toContain(`${gaps} not in this worklist`);
    expect(r.out).not.toMatch(/refused/);

    const fr = await run(["verify", "--apply", path, "--in", join(out, "audit-latest.json"), "--out", join(dir, "R2fr"), "--lang", "fr"]);
    expect(fr.err).toContain("hors de la liste");
    expect(fr.err).not.toMatch(/refusé\(s\) par la porte/);
  });

  it("still counts a verdict refused inside the lot — and only that one", async () => {
    const out = join(dir, "R3");
    await run(["audit", PAGE, "--standard", "rgaa", "--out", out]);
    const { path, inLot, open } = writeLot("lot3.json", 3, { nullFirst: true });

    const r = await run(["verify", "--apply", path, "--in", join(out, "audit-latest.json"), "--out", out, "--json"]);
    expect(r.code, r.err).toBe(0);
    const j = JSON.parse(r.out) as ApplyJson;
    expect(j.rejected).toBe(1);
    expect(j.rejectedCriteria).toEqual([inLot[0]]);
    expect(j.issues.join("\n")).not.toMatch(/coverage gap/);
    expect(j.notInWorklist).toEqual(open.filter((id) => !inLot.includes(id)));

    const human = await run(["verify", "--apply", path, "--in", join(out, "audit-latest.json"), "--out", join(dir, "R3h")]);
    expect(human.err).toMatch(/1 criterion\(ia\) refused by the gate/);
  });
});

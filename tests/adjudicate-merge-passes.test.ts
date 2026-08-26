// A SECOND FOLD MUST NOT UNDO THE FIRST.
//
// `verify --apply` wrote `packAdjudication` from the file it was given and nothing else. That is
// fine for one fold and wrong for two: a criterion decided in pass 1 and absent from pass 2's
// worklist — because it was decided, and the worklist only ever carries what is still open —
// was dropped, and reverted to « à évaluer ».
//
// Measured on the first three-pass run: 47 criteria to adjudicate, 5 refused → 41 left; pass 2
// ruled those, 4 refused → and pass 3 opened with 47 again. The residue went UP. Each pass was
// undoing the one before it, so the whole tier could never converge.
//
// A fold now MERGES: what the file rules wins for its own criteria, and everything already
// decided stays decided.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { applyAdjudication, buildAdjudicationWorklist, type AdjudicationFile, type AdjudicationItem } from "../src/adjudicate.js";
import { derivePackResults } from "../src/standards/index.js";
import type { AuditResult } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-merge-"));
const PAGE = join(dir, "page.html");
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Aide</title></head><body><main><h1>Aide</h1><img src="/a.svg" alt="Schéma"><a href="/c">Contact</a><table><caption>T</caption><tr><th>a</th></tr></table></main></body></html>`,
);

const file = (items: AdjudicationItem[]): AdjudicationFile => ({
  tool: "ultra11y",
  kind: "adjudication",
  schemaVersion: 2,
  standard: "rgaa",
  auditDate: "2026-08-18",
  items,
});

/** Rule ONE criterion, leaving every other item out of the file entirely — which is exactly
 *  what a re-derived worklist looks like on a later pass. */
function rule(audit: AuditResult, criteriaId: string): AuditResult {
  const worklist = buildAdjudicationWorklist(audit, { standard: "rgaa" });
  const src = worklist.find((i) => i.criteriaId === criteriaId);
  if (!src) throw new Error(`${criteriaId} is not open`);
  const item: AdjudicationItem = src.evidence.length
    ? { ...src, verdict: "C", justification: "vérifié sur la page", citations: [src.evidence[0]!] }
    : { ...src, verdict: "NA", justification: "aucun élément concerné dans le périmètre" };
  const residualReasons = Object.fromEntries(
    worklist.filter((candidate) => candidate.criteriaId !== criteriaId).map((candidate) => [candidate.criteriaId, "later pass"]),
  );
  const r = applyAdjudication(audit, file([item]), { cwd: dir, residualReasons });
  expect(
    r.issues.filter((x) => x.includes(criteriaId)),
    r.issues.join("\n"),
  ).toEqual([]);
  return r.audit;
}

const statusOf = (audit: AuditResult, id: string) => derivePackResults(audit, "rgaa").find((c) => c.id === id)?.status;
const openIds = (audit: AuditResult) => buildAdjudicationWorklist(audit, { standard: "rgaa" }).map((i) => i.criteriaId);

describe("folding a later pass keeps what the earlier ones decided", () => {
  it("does not revert a criterion the new file never mentions", () => {
    const base = runAudit({ inputs: [PAGE] });
    const first = openIds(base)[0]!;
    const afterOne = rule(base, first);
    expect(statusOf(afterOne, first)).not.toBe("manual");

    // A second fold over a DIFFERENT criterion — the shape of every later pass.
    const second = openIds(afterOne).find((id) => id !== first)!;
    const afterTwo = rule(afterOne, second);

    expect(statusOf(afterTwo, second)).not.toBe("manual");
    expect(statusOf(afterTwo, first), `${first} was decided in pass 1 and lost in pass 2`).not.toBe("manual");
  });

  it("shrinks the worklist monotonically, pass after pass", () => {
    // The property that makes multi-pass converge at all: what is still open can only ever get
    // smaller. It went 47 → 41 → 47 on a real run before this.
    const base = runAudit({ inputs: [PAGE] });
    const n0 = openIds(base).length;
    const a = rule(base, openIds(base)[0]!);
    const n1 = openIds(a).length;
    const b = rule(a, openIds(a)[0]!);
    const n2 = openIds(b).length;
    expect(n1).toBeLessThan(n0);
    expect(n2).toBeLessThan(n1);
  });

  it("refuses to re-open a criterion that is already decided, and says so", () => {
    // The other half of the merge, and it predates it: a criterion is adjudicated because the
    // engine could not decide it. Once something HAS decided it, a later file must not be able
    // to talk it back open — that is how a verdict would get laundered by re-submission. The
    // real flow never tries: a re-derived worklist carries only what is still open.
    const base = runAudit({ inputs: [PAGE] });
    const id = openIds(base)[0]!;
    const afterOne = rule(base, id);
    const src = buildAdjudicationWorklist(base, { standard: "rgaa" }).find((i) => i.criteriaId === id)!;
    const redo = applyAdjudication(afterOne, file([{ ...src, verdict: "manual", reason: "undecidable" } as AdjudicationItem]), { cwd: dir });
    expect(redo.issues.join("\n")).toMatch(/not open for adjudication/);
    expect(derivePackResults(redo.audit, "rgaa").find((c) => c.id === id)?.status).not.toBe("manual");
  });
});

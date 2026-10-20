// A FOLD THAT LEAVES ENGINE-FLAGGED "NO SUBJECT" CRITERIA OPEN MUST NOT PUBLISH THEM AS NA.
//
// An orchestrator folds in rounds: one adjudication batch at a time, every open criterion it
// does not mention recorded as a coverage gap — a `manual` record, an abstention. On the
// criteria the engine had provisionally closed for want of a subject (RGAA 4.1–4.6 on a page
// with no media…), that abstention used to be spread over the derived `inapplicable`: the row
// stayed « à évaluer » AND carried `inapplicable: true`, so the report counted it twice — in
// the NA column (« conforme faute de sujet ») and « à évaluer » — and `check --report` refused
// the engine's own report (« NA dépasse C, alors que NA est un sous-ensemble de C »). An agent
// `manual` verdict on one of them ended the same way.
//
// The contract this pins: a criterion whose status stays `manual` never carries `inapplicable`
// after write-back, and NA is counted only within C. Deciding every flagged criterion makes
// the report consistent either way; this test is the day-watch the issue asked for.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../src/cli.js";
import { unwrapAudit } from "../src/standards/document.js";
import { derivePackResults } from "../src/standards/index.js";
import type { AuditResult, PackAuditResult } from "../src/types.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "u11y-na-subset-"));
});
afterEach(() => {
  process.chdir("/");
  rmSync(root, { recursive: true, force: true });
});

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const lo = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  const le = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
  return {
    out,
    err,
    restore: () => {
      lo.mockRestore();
      le.mockRestore();
    },
  };
}
async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const c = capture();
  const code = await main(argv);
  c.restore();
  return { code, out: c.out.join("\n"), err: c.err.join("\n") };
}

/** Two small pages, offline: images, links, headings — and NO media, NO table, NO form, so
 *  the engine's subject harvest provisionally closes the judgment criteria whose subject does
 *  not exist anywhere in scope (4.x, 5.x, 13.x…). That is the set a partial fold must leave
 *  open without ever publishing it as NA. */
async function auditFixture(): Promise<{ R: string; flagged: string[] }> {
  writeFileSync(
    join(root, "index.html"),
    `<!doctype html><html lang="fr"><head><title>Accueil</title></head><body>
<header><p>Egapro</p></header>
<main><h1>Accueil</h1><img src="hero.png" alt="Un randonneur sur une crête"><p><a href="/cgu">Conditions</a></p>
<ul><li>un</li><li>deux</li></ul></main>
<footer><p>Ministère</p></footer>
</body></html>`,
  );
  writeFileSync(
    join(root, "mentions.html"),
    `<!doctype html><html lang="fr"><head><title>Mentions légales</title></head><body>
<main><h1>Mentions légales</h1><p>Éditeur : la direction générale du travail.</p></main>
</body></html>`,
  );
  process.chdir(root);
  const R = join(root, "R");
  mkdirSync(R, { recursive: true });
  const a = await run(["audit", ".", "--standard", "rgaa", "--out", "R", "--json"]);
  expect(a.code).toBe(0);
  const fresh = unwrapAudit(JSON.parse(readFileSync(join(R, "audit-latest.json"), "utf8")));
  // The engine-flagged set: judgment criteria the subject harvest provisionally closed.
  const flagged = derivePackResults(fresh, "rgaa")
    .filter((r) => r.status === "C" && r.inapplicable === true && r.judgment === true)
    .map((r) => r.id);
  expect(flagged.length).toBeGreaterThan(0);
  return { R, flagged };
}

/** Step 1 of the issue's sequence, unchanged: report + check --report are ok on the FRESH
 *  audit — the fold is what used to corrupt the synthesis. */
async function reportAndCheck(R: string): Promise<number> {
  const rep = await run(["report", "--in", join(R, "audit-latest.json"), "--standard", "rgaa", "--out", R, "--lang", "en"]);
  expect(rep.code).toBe(0);
  const md = readdirSync(R).find((f) => f.startsWith("rgaa-") && f.endsWith(".md"))!;
  const chk = await run(["check", "--report", join(R, md), "--standard", "rgaa", "--lang", "en"]);
  return chk.code;
}

/** `verify --manual` → fill `decide` (criteriaId → the verdict fields to set) → `verify --apply`.
 *  Everything the file does not mention is left as a coverage gap, the issue's partial fold. */
async function fold(R: string, decide: Record<string, "C" | "manual">) {
  const man = await run(["verify", "--manual", "--in", join(R, "audit-latest.json"), "--out", R, "--standard", "rgaa", "--json"]);
  expect(man.code).toBe(0);
  const wl = JSON.parse(man.out) as {
    todoPath: string;
    count: number;
    items: { criteriaId: string; evidence: { file: string; line: number; selector: string; snippet: string }[] }[];
  };
  expect(wl.count).toBeGreaterThan(1);
  const todo = JSON.parse(readFileSync(wl.todoPath, "utf8")) as {
    items: ({ criteriaId: string; verdict: string | null; justification: string; citations?: unknown[] } & Record<string, unknown>)[];
  };
  for (const it of todo.items) {
    const verdict = decide[it.criteriaId];
    if (!verdict) continue; // coverage gap
    if (verdict === "C") {
      const evidence = wl.items.find((i) => i.criteriaId === it.criteriaId)!.evidence;
      expect(evidence.length).toBeGreaterThan(0); // a cited C grounds against harvested evidence
      it.verdict = "C";
      it.justification = "Vérifié sur la page : l'élément cité porte l'alternative attendue.";
      it.citations = [evidence[0]];
    } else {
      it.verdict = "manual";
      it.reason = "undecidable";
    }
  }
  const filled = join(R, "filled.json");
  writeFileSync(filled, JSON.stringify(todo));
  const app = await run(["verify", "--apply", filled, "--in", join(R, "audit-latest.json"), "--out", R, "--json"]);
  expect(app.code).toBe(0); // a partial fold is exit 0: the refused stay to assess, carrying why
  const res = JSON.parse(app.out) as { applied: number; stillManual: number; rejected: number; rejectedCriteria: string[] };
  return res;
}

/** The two invariants the report's own arithmetic states: no open criterion carries the
 *  absence flag, and NA never exceeds C in the document's theme tallies. */
function expectConsistent(doc: PackAuditResult) {
  const bad = doc.criteria.filter((c) => c.status === "manual" && c.inapplicable === true);
  expect(bad.map((c) => c.id)).toEqual([]); // « à évaluer » and « faute de sujet » are disjoint
  for (const t of doc.themes) expect(t.na, `theme ${t.number}`).toBeLessThanOrEqual(t.c);
  // The derive-level contract behind both: NA is a subset of C, never a fourth bucket.
  const rows = derivePackResults(unwrapAudit(doc) as AuditResult, "rgaa");
  expect(rows.some((r) => r.status === "manual" && r.inapplicable === true)).toBe(false);
}

describe("a partial fold keeps NA ⊆ C in the report it feeds", () => {
  it("check --report accepts the engine's report after a fold that leaves the flagged criteria open", async () => {
    const { R } = await auditFixture();
    expect(await reportAndCheck(R)).toBe(0); // step 1: the fresh audit passes its own gate
    const res = await fold(R, { "1.1": "C" }); // one cited C, everything else a coverage gap
    expect(res.applied).toBe(1);
    expect(res.rejectedCriteria.length).toBeGreaterThan(10);
    const doc = JSON.parse(readFileSync(join(R, "audit-latest.json"), "utf8")) as PackAuditResult;
    expectConsistent(doc);
    expect(await reportAndCheck(R)).toBe(0); // step 4: the gate accepts the engine's own report
  });

  it("an agent manual verdict on an engine-flagged criterion counts « à évaluer », never « faute de sujet »", async () => {
    const { R, flagged } = await auditFixture();
    const open = flagged.find((id) => id === "4.1") ?? flagged[0]!; // a no-subject criterion, evidenced or not
    const res = await fold(R, { "1.1": "C", [open]: "manual" });
    expect(res.applied).toBe(1);
    expect(res.stillManual).toBe(1);
    const doc = JSON.parse(readFileSync(join(R, "audit-latest.json"), "utf8")) as PackAuditResult;
    const entry = doc.criteria.find((c) => c.id === open)!;
    expect(entry.status).toBe("manual");
    expect(entry.decidedBy).toBe("agent");
    expect(entry.inapplicable).toBeUndefined(); // an abstention is not a conformity for want of a subject
    expectConsistent(doc);
    expect(await reportAndCheck(R)).toBe(0);
  });
});

// THE WORKLIST PRINTS PATHS RELATIVE TO WHERE IT WAS PRODUCED (issue #65, documentation site).
//
// Measured on 7 small pages: ADJUDICATE.todo.json at 1.9 MB and ADJUDICATE.md at 1.8 MB, most of
// it the same absolute `/private/tmp/…/.ultra11y/pages/<id>/dom.html` repeated in every
// `alsoAt`. Unreadable in an agent's context without a script. The worklist now writes paths
// relative to the current directory — and a verdict citing that relative path still folds
// against an audit that recorded the absolute one.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { type AdjudicationFile, applyAdjudication, buildAdjudicationWorklist, writeAdjudication } from "../src/adjudicate.js";
import { runAudit } from "../src/audit.js";

mkdirSync(join(process.cwd(), "tmp"), { recursive: true });
const root = mkdtempSync(join(process.cwd(), "tmp", "u11y-paths-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const PAGE = join(root, "page.html");
writeFileSync(
  PAGE,
  '<!doctype html><html lang="fr"><head><title>Contact — Mairie</title></head><body><main><h1>Contact</h1><p><a href="/a">Plan d’accès</a></p><p><a href="/b">Horaires</a></p></main></body></html>',
);

describe("the adjudication worklist", () => {
  const audit = runAudit({ inputs: [PAGE] });
  const items = buildAdjudicationWorklist(audit, { standard: "rgaa", cwd: process.cwd() });
  const out = join(root, "out");
  writeAdjudication(items, out, { standard: "rgaa", auditDate: "2026-10-28" });
  const todo = JSON.parse(readFileSync(join(out, "ADJUDICATE.todo.json"), "utf8")) as AdjudicationFile;

  it("prints paths relative to the directory it was produced from", () => {
    const raw = readFileSync(join(out, "ADJUDICATE.todo.json"), "utf8");
    expect(raw).not.toContain(root);
    const files = todo.items.flatMap((i) => i.evidence.map((e) => e.file));
    expect(files.length).toBeGreaterThan(0);
    expect(new Set(files)).toEqual(new Set([relative(process.cwd(), PAGE)]));
    expect(readFileSync(join(out, "ADJUDICATE.md"), "utf8")).not.toContain(root);
  });

  it("folds a verdict that cites the relative path against the audit that recorded the absolute one", () => {
    const links = todo.items.find((i) => i.criteriaId === "6.1")!;
    const file: AdjudicationFile = {
      ...todo,
      items: [{ ...links, verdict: "C", justification: "Chaque intitulé de lien est explicite.", citations: links.evidence.slice(0, 1) }],
    };
    const r = applyAdjudication(audit, file, { cwd: process.cwd() });
    expect(r.issues.filter((i) => i.startsWith("criterion 6.1"))).toEqual([]);
  });
});

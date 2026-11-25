// LE BRIEF QUE LA CI LIT VRAIMENT DOIT PORTER LE CONTRAT.
//
// `writeAdjudication` émet trois surfaces : le gros `ADJUDICATE.md` (une session avec un shell),
// le `ADJUDICATE.verdicts.json` mince (ce que l'adjudicateur ÉCRIT) et un petit
// `adjudicate/<criteriaId>.md` par critère (ce qu'il LIT). Le prompt CI de l'ancienne GitHub Action lui
// ordonnait de ne lire que le troisième — et celui-ci était rendu avec `preamble: false`, ce qui
// retirait le vocabulaire des verdicts, la règle de citation, l'avertissement du référentiel et
// la note « la page rendue est sur le disque ».
//
// Mesuré sur le run 32385981037 (Haiku, RGAA, 3 passes) : 12.1 et 12.5 sont revenus `NC` sans
// `file`, 11.11 et 11.12 `needs-rendered-dom` sur des évidences ancrées dans une capture. Quatre
// refus du gate, quatre règles que le brief ne portait pas. L'adjudicateur n'ignorait pas le
// contrat : on ne le lui avait jamais montré.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { ADJUDICATION_CONTRACT_FILE, buildAdjudicationWorklist, formatAdjudication, writeAdjudication } from "../src/adjudicate.js";
import { PAGES_DIR, SNAPSHOT_VERSION, writeSnapshot } from "../src/snapshot.js";

const DOM = `<!doctype html><html lang="fr"><head><title>Accueil</title></head><body><header><nav aria-label="Principale"><ul><li><a href="/a">A</a></li></ul></nav></header><main><h1>Accueil</h1><form action="/n"><label for="e">E-mail</label><input id="e" name="e" type="email" required></form></main></body></html>`;

function sourceOnly(): string {
  const dir = mkdtempSync(join(tmpdir(), "u11y-brief-src-"));
  const f = join(dir, "index.html");
  writeFileSync(f, DOM);
  return f;
}

function withSnapshots(): string {
  const root = mkdtempSync(join(tmpdir(), "u11y-brief-snap-"));
  writeSnapshot(root, { meta: { v: SNAPSHOT_VERSION, id: "accueil", name: "Accueil", url: "https://x/" }, dom: DOM } as Parameters<typeof writeSnapshot>[1]);
  // The digests the assertion below names: a brief lists only the capture files that exist (#131).
  for (const f of ["styles.json", "boxes.json"]) writeFileSync(join(root, PAGES_DIR, "accueil", f), '{"v":1,"entries":[]}\n');
  return join(root, PAGES_DIR);
}

const worklist = (input: string) => buildAdjudicationWorklist(runAudit({ inputs: [input] }), { standard: "rgaa" });
const briefFor = (input: string, id: string, lang: "fr" | "en" = "fr") => {
  const items = worklist(input).filter((it) => it.criteriaId === id);
  expect(items, `criterion ${id} is not in the worklist`).toHaveLength(1);
  return formatAdjudication(items, lang, "rgaa", { preamble: false });
};

describe("the per-criterion brief carries the verdict contract", () => {
  it("names all four verdicts and what each one requires", () => {
    const md = briefFor(sourceOnly(), "12.1");
    for (const v of ["`C`", "`NC`", "`NA`", "`manual`"]) expect(md).toContain(v);
    expect(md).toMatch(/citations/);
    expect(md).toMatch(/findings/);
    expect(md).toMatch(/normativeRef/);
    expect(md).toMatch(/reason/);
  });

  it("states the absence rule — the one that lost 12.1 and 12.5", () => {
    const md = briefFor(sourceOnly(), "12.1");
    expect(md).toMatch(/ABSENCE/);
    // The two halves of it: anchor what you observed, or rule NA when the subject is not there.
    expect(md).toMatch(/`file`/);
    expect(md).toMatch(/`NA`/);
  });

  it("warns that a normativeRef is a RGAA test id, not a WCAG one", () => {
    expect(briefFor(sourceOnly(), "12.1")).toMatch(/RGAA/);
    expect(briefFor(sourceOnly(), "12.1", "en")).toMatch(/WCAG id looks alike|un id WCAG/i);
  });

  it("says the rendered page is on disk when THIS criterion's evidence is anchored in a capture", () => {
    const md = briefFor(withSnapshots(), "12.1");
    expect(md).toMatch(/RENDU DISPONIBLE|rendu de la page est/i);
    for (const f of ["dom.html", "styles.json", "boxes.json"]) expect(md).toContain(f);
  });

  it("…and stays silent about it on a source-only audit, where needs-rendered-dom is honest", () => {
    expect(briefFor(sourceOnly(), "12.1")).not.toMatch(/RENDU DISPONIBLE|styles\.json/);
  });

  it("still drops the two harness-specific lines: the todo file to edit and the shell fold", () => {
    // These are what `preamble: false` existed for, and they are still wrong on this sheet:
    // the CI adjudicator has no shell and is told not to open the todo file.
    const md = briefFor(sourceOnly(), "12.1");
    expect(md).not.toContain("ADJUDICATE.todo.json");
    expect(md).not.toContain("verify --apply");
  });
});

// THE CONTRACT ON DISK IS WRITTEN ONCE (#222). Inline in each of the 102 briefs of a full RGAA
// run, the run-wide blocks were ~6.5 KB a brief, ~38 % of what the briefs weighed. Every brief now
// names the one file that carries them — the adjudicator is never left without the rules, it reads
// them once instead of 102 times.
describe("writeAdjudication writes the contract once and points every sheet to it", () => {
  it("every brief on disk names the contract file, and the contract file carries every clause", () => {
    const out = mkdtempSync(join(tmpdir(), "u11y-brief-out-"));
    const items = worklist(withSnapshots());
    const pages = [{ id: "accueil", name: "Accueil", url: "https://x/" }];
    const w = writeAdjudication(items, out, { standard: "rgaa", auditDate: "2026-08-20", lang: "fr", pages });
    expect(w.count).toBeGreaterThan(0);
    expect(w.contractPath).toBe(join(out, ADJUDICATION_CONTRACT_FILE));
    const contract = readFileSync(w.contractPath, "utf8");
    for (const v of ["`C`", "`NC`", "`NA`", "`manual`", "`pages`"]) expect(contract).toContain(v);
    expect(contract).toMatch(/ABSENCE/);
    expect(contract).toMatch(/normativeRef/);
    expect(contract).toMatch(/GRAVITÉ/);
    expect(contract).toMatch(/Référentiel actif : \*\*RGAA\*\*/);
    expect(contract).toMatch(/RENDU DISPONIBLE/);
    expect(contract).toMatch(/STATUER PAGE PAR PAGE/);
    expect(contract).toContain("accueil — Accueil");
    for (const it of items) {
      const md = readFileSync(join(w.itemsDir, `${it.criteriaId}.md`), "utf8");
      expect(md, `brief ${it.criteriaId}`).toMatch(/CONTRAT DE VERDICT/);
      expect(md, `brief ${it.criteriaId}`).toContain(ADJUDICATION_CONTRACT_FILE);
      // …and does not restate it.
      expect(md, `brief ${it.criteriaId}`).not.toMatch(/UNE NC EN FORME D'ABSENCE/);
      expect(md, `brief ${it.criteriaId}`).not.toMatch(/^- `NC` — non conforme/m);
    }
  });

  it("keeps on each brief what is that criterion's own: its capture-anchored evidence", () => {
    const out = mkdtempSync(join(tmpdir(), "u11y-brief-own-"));
    const w = writeAdjudication(worklist(withSnapshots()), out, { standard: "rgaa", auditDate: "2026-08-20", lang: "fr" });
    expect(readFileSync(join(w.itemsDir, "12.1.md"), "utf8")).toMatch(/RENDU DISPONIBLE pour ce critère/);
    const src = mkdtempSync(join(tmpdir(), "u11y-brief-own-src-"));
    const ws = writeAdjudication(worklist(sourceOnly()), src, { standard: "rgaa", auditDate: "2026-08-20", lang: "fr" });
    expect(readFileSync(join(ws.itemsDir, "12.1.md"), "utf8")).not.toMatch(/RENDU DISPONIBLE/);
    expect(readFileSync(ws.contractPath, "utf8")).not.toMatch(/RENDU DISPONIBLE/);
  });

  it("hands a criterion its OWN unrendered warning, and no other criterion's", () => {
    const out = mkdtempSync(join(tmpdir(), "u11y-brief-unrend-"));
    const items = worklist(sourceOnly());
    const target = items[0]?.criteriaId;
    const other = items.find((it) => it.criteriaId !== target)?.criteriaId;
    if (!target || !other) throw new Error("the fixture must yield at least two criteria for this test to mean anything");
    const w = writeAdjudication(items, out, { standard: "rgaa", auditDate: "2026-08-20", lang: "fr", unrendered: [target] });
    expect(readFileSync(join(w.itemsDir, `${target}.md`), "utf8")).toMatch(/AUCUN RENDU/);
    expect(readFileSync(join(w.itemsDir, `${other}.md`), "utf8")).not.toMatch(/AUCUN RENDU/);
  });
});

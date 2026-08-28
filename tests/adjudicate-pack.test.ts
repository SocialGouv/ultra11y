// Adjudicating under a COUNTRY STANDARD. Most RGAA criteria still need adjudication to earn C and derive
// `manual`, so this path carries ~93% of an RGAA audit — and it used to be 100% WCAG-keyed:
// `--standard` was accepted and then never read.
//
// The sharpest bug it hid: RGAA test ids share the `N.N.N` shape with WCAG SC ids, so the
// anti-fabrication gate silently accepted a WCAG citation as an unrelated RGAA test. Keying
// the worklist by RGAA criterion is what closes it — a citation is now checked against the
// item's OWN test list.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import {
  buildAdjudicationWorklist,
  applyAdjudication,
  formatAdjudication,
  testMarkupTokens,
  type AdjudicationFile,
  type AdjudicationItem,
} from "../src/adjudicate.js";
import { derivePackResults, getCriterion, loadPack } from "../src/standards/index.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-adj-pack-"));
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
const rgaaItems = () => buildAdjudicationWorklist(audit(), { standard: "rgaa" });

const adjFile = (items: AdjudicationItem[], standard = "rgaa"): AdjudicationFile => ({
  tool: "ultra11y",
  kind: "adjudication",
  schemaVersion: 2,
  standard,
  auditDate: "2026-07-29",
  items,
});

/** Clear every item so only the item under test can fail the run. A C is evidence-bound
 *  (it must cite the harvested evidence it cleared), and a criterion the harvester found
 *  nothing for cannot be cleared at all — it honestly stays manual. */
const clear = (it: AdjudicationItem): AdjudicationItem =>
  it.evidence.length
    ? { ...it, verdict: "C" as const, justification: "vérifié sur la page", citations: [it.evidence[0]!] }
    : { ...it, verdict: "manual" as const, reason: "undecidable" };

const allConforming = (items: AdjudicationItem[], override?: Partial<AdjudicationItem> & { criteriaId: string }): AdjudicationItem[] =>
  items.map((it) => (it.criteriaId === override?.criteriaId ? ({ ...it, ...override } as AdjudicationItem) : clear(it)));

describe("the worklist is keyed by the standard actually in play", () => {
  it("emits RGAA criteria, not WCAG success criteria", () => {
    const ids = rgaaItems().map((i) => i.criteriaId);
    expect(ids.length).toBeGreaterThan(50); // a source-only run leaves most of the grid to assess
    // RGAA ids have two segments; WCAG SC ids have three.
    for (const id of ids) expect(id, `"${id}" is not an RGAA criterion id`).toMatch(/^\d+\.\d+$/);
    expect(ids).toContain("11.2"); // « Chaque étiquette … est-elle pertinente ? »
  });

  it("still emits WCAG success criteria for the core", () => {
    const ids = buildAdjudicationWorklist(audit()).map((i) => i.criteriaId);
    for (const id of ids) expect(id).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("covers every manual row and every provisionally-inapplicable judgment row", () => {
    const pack = loadPack("rgaa");
    const expected = new Set(
      derivePackResults(audit(), "rgaa")
        .filter((row) => {
          if (row.status === "manual") return true;
          const criterion = getCriterion(pack, row.id);
          return row.inapplicable === true && Object.values(criterion?.automation?.tests ?? {}).includes("judgment");
        })
        .map((row) => row.id),
    );
    expect(new Set(rgaaItems().map((i) => i.criteriaId))).toEqual(expected);
  });

  it("titles each item with the RGAA criterion, not the WCAG one", () => {
    const it112 = rgaaItems().find((i) => i.criteriaId === "11.2");
    expect(it112?.title).toMatch(/étiquette/i);
    expect(it112?.title).not.toMatch(/Labels or Instructions/);
  });

  it("carries evidence harvested for the WCAG criteria the RGAA criterion maps onto", () => {
    // RGAA 1.1 maps to WCAG 1.1.1, whose harvester collects every image.
    const it11 = rgaaItems().find((i) => i.criteriaId === "1.1");
    expect(it11?.evidence.some((e) => e.snippet.includes("hero.png"))).toBe(true);
  });

  it("uses a candidate rule as evidence when a document-wide criterion has no subject harvest", () => {
    const a = audit();
    const core = a.criteria.find((criterion) => criterion.id === "1.4.10")!;
    const finding = {
      ruleId: "dyn-reflow",
      criteriaId: "1.4.10",
      file: PAGE,
      line: 1,
      col: 1,
      selectorHint: "document",
      severity: "majeur" as const,
      message: "Horizontal scrolling at 320px width.",
      remediation: "Fix the reflow.",
      snippet: "",
      page: "page",
    };
    core.status = "NC";
    core.findings.push(finding);
    a.findings.push(finding);

    const item = buildAdjudicationWorklist(a, { standard: "rgaa" }).find((candidate) => candidate.criteriaId === "10.11");
    expect(item?.signals?.some((signal) => signal.ruleId === "dyn-reflow")).toBe(true);
    expect(item?.evidence).toContainEqual(expect.objectContaining({ file: PAGE, line: 1, note: "Horizontal scrolling at 320px width." }));

    const folded = applyAdjudication(
      a,
      adjFile([
        {
          ...item!,
          verdict: "NC",
          findings: [
            {
              file: PAGE,
              line: 1,
              message: "The page requires horizontal scrolling at 320px.",
              snippet: "Horizontal scrolling at 320px width.",
              normativeRef: "10.11.1",
            },
          ],
        },
      ]),
    );
    expect(folded.issues.join("\n")).not.toMatch(/cited snippet not found/);
    expect(folded.audit.packAdjudication?.criteria.find((criterion) => criterion.id === "10.11")?.status).toBe("NC");
  });

  it("does not duplicate evidence when several mapped SCs harvest the same element", () => {
    for (const item of rgaaItems()) {
      const keys = item.evidence.map((e) => `${e.file}:${e.line}:${e.selector}`);
      expect(new Set(keys).size, `${item.criteriaId} has duplicate evidence`).toBe(keys.length);
    }
  });
});

describe("the citation gate, under a pack", () => {
  const nc = (criteriaId: string, normativeRef: string): Partial<AdjudicationItem> & { criteriaId: string } => ({
    criteriaId,
    verdict: "NC",
    justification: "",
    findings: [{ file: PAGE, line: 3, message: "étiquette non pertinente", normativeRef, snippet: "<label" }],
  });

  it("accepts a test id belonging to the criterion under adjudication", () => {
    const r = applyAdjudication(audit(), adjFile(allConforming(rgaaItems(), nc("11.2", "11.2.1"))));
    expect(r.ok, r.issues.join(" | ")).toBe(true);
  });

  it("REJECTS a WCAG success-criterion id that merely collides with an RGAA test id", () => {
    // The bug this file exists for: "1.4.3" is WCAG Contrast Minimum, but also parses as
    // RGAA test 1.4.3 — a CAPTCHA-image test — and used to be accepted silently.
    const r = applyAdjudication(audit(), adjFile(allConforming(rgaaItems(), nc("11.2", "1.4.3"))));
    expect(r.ok).toBe(false);
    expect(r.issues.join(" ")).toMatch(/1\.4\.3/);
  });

  it("REJECTS a real RGAA test that belongs to a DIFFERENT criterion", () => {
    const r = applyAdjudication(audit(), adjFile(allConforming(rgaaItems(), nc("11.2", "1.1.1"))));
    expect(r.ok).toBe(false);
  });

  it("REJECTS a W3C technique code — the gate never accepted those under a pack", () => {
    const r = applyAdjudication(audit(), adjFile(allConforming(rgaaItems(), nc("11.2", "ARIA6"))));
    expect(r.ok).toBe(false);
  });

  it("REJECTS a fabricated test number on the right criterion", () => {
    const r = applyAdjudication(audit(), adjFile(allConforming(rgaaItems(), nc("11.2", "11.2.99"))));
    expect(r.ok).toBe(false);
  });

  it("still requires a normativeRef at all", () => {
    const items = allConforming(rgaaItems(), {
      criteriaId: "11.2",
      verdict: "NC",
      justification: "",
      findings: [{ file: PAGE, line: 3, message: "x", snippet: "<label" }],
    });
    expect(applyAdjudication(audit(), adjFile(items)).ok).toBe(false);
  });
});

describe("folding a pack adjudication back", () => {
  const folded = () => applyAdjudication(audit(), adjFile(allConforming(rgaaItems())));

  it("succeeds and records the verdicts under the pack, not on the WCAG criteria", () => {
    const r = folded();
    expect(r.ok, r.issues.join(" | ")).toBe(true);
    expect(r.audit.packAdjudication?.standard).toBe("rgaa");
    expect(r.audit.packAdjudication?.criteria.length).toBeGreaterThan(50);
  });

  it("leaves the WCAG core verdict untouched — a pack is a projection, never a second source", () => {
    const before = audit();
    const after = folded().audit;
    expect(after.criteria.map((c) => `${c.id}:${c.status}`)).toEqual(before.criteria.map((c) => `${c.id}:${c.status}`));
    expect(after.conformancePct).toBe(before.conformancePct);
  });

  it("makes the pack projection reflect the adjudication", () => {
    const after = folded().audit;
    const derived = derivePackResults(after, "rgaa");
    expect(derived.find((c) => c.id === "11.2")?.status).toBe("C");
    expect(derived.find((c) => c.id === "11.2")?.decidedBy).toBe("agent");
    // Every criterion the agent CLEARED is now C in the projection — and the ones still
    // manual are exactly the ones it could not clear (no harvested evidence to cite),
    // which is the honest outcome, not a coverage failure.
    const cleared = new Set(
      allConforming(rgaaItems())
        .filter((i) => i.verdict === "C")
        .map((i) => i.criteriaId),
    );
    expect(cleared.size).toBeGreaterThan(0);
    for (const id of cleared) expect(derived.find((c) => c.id === id)?.status, id).toBe("C");
    for (const c of derived.filter((c) => c.status === "manual")) expect(cleared.has(c.id), c.id).toBe(false);
  });

  it("fails closed on an unadjudicated criterion (coverage gap)", () => {
    const items = rgaaItems().map((it, i) => (i === 0 ? it : clear(it)));
    const r = applyAdjudication(audit(), adjFile(items));
    expect(r.ok).toBe(false);
    expect(r.issues.join(" ")).toMatch(/unadjudicated|verdict is null/i);
  });

  it("keeps a still-manual verdict manual, with its reason", () => {
    const items = allConforming(rgaaItems(), { criteriaId: "3.2", verdict: "manual", justification: "", reason: "needs-rendered-dom" });
    const r = applyAdjudication(audit(), adjFile(items));
    expect(r.ok, r.issues.join(" | ")).toBe(true);
    expect(derivePackResults(r.audit, "rgaa").find((c) => c.id === "3.2")?.status).toBe("manual");
  });
});

describe("the rendered worklist is self-sufficient", () => {
  const md = () => formatAdjudication(rgaaItems(), "fr", "rgaa");
  /** One criterion's brief — the shape `adjudicate/<criteriaId>.md` carries, and the one a CI
   *  adjudicator actually reads. */
  const onlyBrief = (id: string) =>
    formatAdjudication(
      rgaaItems().filter((i) => i.criteriaId === id),
      "fr",
      "rgaa",
    );

  it("shows the criterion's own numbered tests, in full", () => {
    const t = md();
    expect(t).toContain("11.2.1");
    expect(t).toMatch(/fonction exacte/); // real test wording, not a summary
  });

  // WHICH TESTS THE HARVEST TOUCHES. The fixture labels every field with a `<label>` element:
  // no `title`, no `aria-label`, no `aria-labelledby`, no adjacent button. So of RGAA 11.2's
  // six labelling mechanisms exactly one is present in scope, and the brief used to show all
  // six identically.
  it("marks the tests whose mechanism is actually present in the harvested source", () => {
    const t = onlyBrief("11.2");
    const marked = t
      .split("\n")
      .map((l) => /^- `(11\.2\.\d)`/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1]!, m.input.includes("⬤")] as const);
    expect(Object.fromEntries(marked)).toEqual({
      "11.2.1": true, // « Chaque balise `<label>` … » — the fixture's mechanism
      "11.2.2": false, // `title`
      "11.2.3": false, // `aria-label`
      "11.2.4": false, // `aria-labelledby`
      "11.2.5": true, // its conditions name `<label>` among others
      "11.2.6": false, // an adjacent button — prose, and absent
    });
  });

  // RGAA 1.1 asks the same question of eight image species. The fixture has one of them, so
  // seven of its tests are about markup that exists nowhere in scope.
  it("splits RGAA 1.1's image species: img is present, area/svg/object/embed/canvas are not", () => {
    const t = onlyBrief("1.1");
    expect(t).toMatch(/^- `1\.1\.1` ⬤/m);
    for (const k of [2, 5, 6, 7, 8]) expect(t, `1.1.${k}`).not.toMatch(new RegExp(`^- \`1\\.1\\.${k}\` ⬤`, "m"));
  });

  // THE SAFETY PROPERTY, and the reason this marker can exist at all. An adjudicator that
  // skips a test because it looked inapplicable publishes a false conformity in a legal
  // deliverable — an error no gate downstream can catch. So the marker is additive: it says
  // where a mechanism WAS found and never that one was not, and the legend says so in the
  // brief rather than only here.
  it("never tells the adjudicator a test does not apply", () => {
    const t = onlyBrief("11.2");
    expect(t).toMatch(/l'absence de marque n'affirme rien/);
    // Scoped to the tests block: « NA — non applicable » is the verdict vocabulary the
    // contract has always carried, and it is about the CRITERION. What must never appear is
    // the marker pronouncing on a TEST.
    const block = t.slice(t.indexOf("Tests RGAA 11.2"), t.indexOf("Cas particuliers"));
    expect(block).not.toMatch(/non applicable|ne s'applique pas|à ignorer|inapplicable|sans objet/i);
  });

  it("stays silent altogether on a criterion whose harvest touches none of its tests", () => {
    // No marker anywhere ⇒ no legend either: a legend explaining a symbol that never appears
    // is noise on a document read by a model paying for its context.
    const t = onlyBrief("13.2");
    expect(t).not.toContain("⬤");
    expect(t).not.toMatch(/signale les tests dont le MÉCANISME/);
  });

  it("reads the mechanism off the test's OWN wording, so no curated table can go stale", () => {
    // Three shapes, and prose yields nothing rather than a guess.
    expect(testMarkupTokens(["Chaque balise `<label>` …"])).toEqual(["label"]);
    expect(testMarkupTokens(['… avec l’attribut `type="image"`'])).toEqual(["type", "type=image"]);
    expect(testMarkupTokens(["… l’attribut WAI-ARIA `aria-labelledby` …"])).toEqual(["aria-labelledby"]);
    expect(testMarkupTokens(['… (balise `<object>` avec l’attribut `type="image/…"`)'])).toEqual(["object", "type"]);
    expect(testMarkupTokens(["Chaque bouton adjacent au champ de formulaire …"])).toEqual([]);
  });

  // THE INSTRUMENT, and the reason the WCAG protocol is not borrowed here. `ADJUDICATION` is
  // keyed by success criterion — 52 keys, every one of them three segments — so a lookup on
  // an RGAA id (two segments) could only ever miss, and for a long time the pack brief
  // carried the numbered tests with nothing that said how to read them.
  it("renders the standard's OWN test methodology under each test", () => {
    const t = md();
    expect(t).toContain("Méthodologie de test officielle");
    // 11.2.1's real procedure, verbatim from DINUM's methodologies.json.
    expect(t).toMatch(/Retrouver dans le document les champs de formulaire dont l’étiquette est fournie par un élément/);
  });

  it("does NOT borrow a WCAG decision rule for a criterion that has its own methodology", () => {
    // Every RGAA criterion documents every one of its tests (258/258), so the crosswalk
    // fallback never fires here — and a borrowed rule must never pass for the standard's own.
    expect(md()).not.toContain("Règle de décision (héritée");
  });

  it("labels the borrowed rule as inherited when a criterion has no methodology of its own", () => {
    // A pack that ships no methodology (a freshly authored Section 508 / EN 301 549) still
    // gets an instrument — announced as the WCAG success criterion's, never as its own.
    const crit = getCriterion(loadPack("rgaa"), "11.2")!;
    const saved = crit.methodology;
    delete (crit as { methodology?: unknown }).methodology;
    try {
      const t = formatAdjudication(
        rgaaItems().filter((i) => i.criteriaId === "11.2"),
        "fr",
        "rgaa",
      );
      expect(t).toMatch(/Règle de décision \(héritée du critère de succès WCAG (2\.4\.6|2\.5\.3|3\.3\.2)/);
    } finally {
      (crit as { methodology?: unknown }).methodology = saved;
    }
  });

  it("cites the criterion's official page, and says a web page is never a normativeRef", () => {
    const withWeb = formatAdjudication(rgaaItems(), "fr", "rgaa", { web: true });
    expect(withWeb).toContain("https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.2");
    expect(withWeb).toMatch(/n'est jamais un `normativeRef`/);
  });

  // The URL is a FACT (where the vendored text came from) and always renders; the invitation
  // to go read it is an INSTRUCTION, and it is only true where a web tool exists. In CI the
  // adjudicator holds Read/Grep/Glob/Edit/Write, and offering it a tool it cannot call spends
  // turns it needs for the 96 criteria in front of it.
  it("keeps the URL but drops the web invitation when the harness has no web tool", () => {
    const noWeb = md();
    expect(noWeb).toContain("https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#11.2");
    expect(noWeb).not.toMatch(/vous POUVEZ consulter la page officielle/);
    // …and that is the ONLY difference between the two briefs.
    const kept = new Set(noWeb.split("\n"));
    const extra = formatAdjudication(rgaaItems(), "fr", "rgaa", { web: true })
      .split("\n")
      .filter((l) => l !== "" && !kept.has(l));
    expect(extra.every((l) => l.includes("normativeRef"))).toBe(true);
  });

  // WITH NO WEB TOOL, THE BRIEF IS STILL COMPLETE. This is the load-bearing property of the
  // whole design: the standard travels vendored — criteria, numbered tests, official test
  // methodology, glossary, technical notes, particular cases — so an adjudicator that cannot
  // reach the network rules from the referential's own text and not from recollection. The
  // URL is an aid to a reader, never a dependency of the decision.
  it("carries everything needed to rule OFFLINE, with no web tool at all", () => {
    const t = formatAdjudication(
      rgaaItems().filter((i) => i.criteriaId === "11.2"),
      "fr",
      "rgaa",
    );
    // The criterion, in the standard's own words.
    expect(t).toContain("Chaque étiquette associée à un champ de formulaire est-elle pertinente");
    // Every one of its numbered tests…
    for (const k of [1, 2, 3, 4, 5, 6]) expect(t, `test 11.2.${k}`).toContain(`11.2.${k}`);
    // …each with the official procedure for running it.
    expect(t.match(/Méthodologie de test officielle/g)?.length).toBe(6);
    // The normatively-defined terms those tests are written in.
    expect(t).toContain("Intitulé visible");
    // The exceptions the standard itself attaches to them.
    expect(t).toContain("Cas particuliers");
    // And the references a verdict may cite — the criterion's own tests, nothing else.
    expect(t).toMatch(/les tests RGAA de ce critère, et eux seuls/);
    // Nothing in the ruling material is behind a link.
    expect(t).not.toMatch(/consultez|voir la page|see the page/i);
  });

  it("proposes ONLY citable references the gate will accept", () => {
    const t = md();
    // W3C technique codes are what the old worklist proposed — and what the gate refuses.
    expect(t).not.toMatch(/\bARIA\d+\b/);
    expect(t).not.toMatch(/\bH\d{2}\b/);
  });

  it("renders only RGAA criterion headings", () => {
    const criterionHeadings = md()
      .split("\n")
      .filter((line) => line.startsWith("## "));
    expect(criterionHeadings.length).toBeGreaterThan(0);
    expect(criterionHeadings.every((line) => line.startsWith("## RGAA "))).toBe(true);
    expect(md()).not.toMatch(/^## WCAG /m);
  });

  it("still renders the WCAG core worklist unchanged", () => {
    const core = formatAdjudication(buildAdjudicationWorklist(audit()), "en");
    expect(core).toMatch(/1\.1\.1/);
  });
});

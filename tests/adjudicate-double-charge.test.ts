// THE SAME DEFECT, CHARGED TWICE.
//
// A form field with no label at all is one non-conformity, and it is RGAA 11.1's — « chaque
// champ de formulaire a-t-il une étiquette ? ». The static engine finds it without a model in
// the loop. 11.2 asks a different question about the same field — « cette étiquette est-elle
// pertinente ? » — and every one of its six tests opens on a label that EXISTS. On a field
// that has none, 11.2 is not failed; it has no subject.
//
// A cheap adjudicator charges it anyway, and the anti-fabrication gate waves it through:
// `normativeRefResolves` proves 11.2.1 is a test of 11.2, the citation grounds against real
// source, and both are true. What it never asks is whether the neighbour already owns this
// exact anchor.
//
// So the fold asks. Narrowly, and only where the question is well posed: the criterion under
// verdict carries no engine rule of its own (nothing mechanical could ever have failed it),
// the engine has already ruled a NEIGHBOURING criterion non-conformant (same theme, shared
// success criterion, opposite side of the mechanical/judgment line), and the anchor is
// literally the same file, line and selector. Refused per verdict, as everything else here is
// — the criterion goes back to « to assess » carrying the reason, so a second pass can rule it
// correctly rather than losing it.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import { buildAdjudicationWorklist, applyAdjudication, type AdjudicationFile, type AdjudicationItem } from "../src/adjudicate.js";
import { derivePackResults } from "../src/standards/index.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-double-charge-"));
const PAGE = join(dir, "page.html");
// `courriel` carries no label of any kind; `nom` is labelled properly.
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Inscription</title></head><body><main>
<h1>Inscription</h1>
<form action="/go">
<label for="nom">Nom</label><input id="nom" type="text">
<input id="courriel" type="email">
<button type="submit">Envoyer</button>
</form>
</main></body></html>`,
);

// A SECOND FORM, where two DIFFERENT defects land on one control. The radio group carries no
// `fieldset`, which is RGAA 11.5's non-conformity and the engine finds it; each `<label>` is
// also written BEFORE its radio, which is RGAA 11.4's (test 11.4.3 wants the label below or to
// the right of a radio). Same file, same line, same selector — and two findings, not one
// charged twice. 11.5 is not a question 11.4 presupposes: an ungrouped radio still has a
// label, and that label is still placed well or badly.
const RADIOS = join(dir, "radios.html");
writeFileSync(
  RADIOS,
  `<!doctype html><html lang="fr"><head><title>Contact</title></head><body><main>
<h1>Contact</h1>
<form action="/go">
<label for="nom">Nom</label><input id="nom" type="text">
<label for="oui">Oui</label><input id="oui" type="radio" name="rappel">
<label for="non">Non</label><input id="non" type="radio" name="rappel">
<button type="submit">Envoyer</button>
</form>
</main></body></html>`,
);

const auditOf = (page: string) => runAudit({ inputs: [page] });
const audit = () => auditOf(PAGE);

const adjFile = (items: AdjudicationItem[]): AdjudicationFile => ({
  tool: "ultra11y",
  kind: "adjudication",
  schemaVersion: 2,
  standard: "rgaa",
  auditDate: "2026-08-24",
  items,
});

const clear = (it: AdjudicationItem): AdjudicationItem =>
  it.evidence.length
    ? { ...it, verdict: "C" as const, justification: "vérifié sur la page", citations: [it.evidence[0]!] }
    : { ...it, verdict: "manual" as const, reason: "undecidable" };

/** The anchor the ENGINE raised its non-conformity on, for a criterion it decides itself. */
function engineAnchor(criterion: string, page: string = PAGE) {
  const pc = derivePackResults(auditOf(page), "rgaa").find((c) => c.id === criterion);
  const f = pc?.findings.find((x) => !x.advisory && !x.ruleId.startsWith("agent:"));
  return f ? { file: f.file, line: f.line, selector: f.selectorHint, snippet: f.snippet } : undefined;
}

/** Rule `id` non-conformant on a given anchor, clearing every other criterion. */
function ncOn(id: string, anchor: { file: string; line: number; selector: string; snippet: string }, normativeRef: string, page: string = PAGE) {
  const items = buildAdjudicationWorklist(auditOf(page), { standard: "rgaa" });
  expect(
    items.map((i) => i.criteriaId),
    `${id} is not open for adjudication`,
  ).toContain(id);
  return applyAdjudication(
    auditOf(page),
    adjFile(
      items.map((it) =>
        it.criteriaId === id ? ({ ...it, verdict: "NC" as const, findings: [{ ...anchor, message: "constat", normativeRef }] } as AdjudicationItem) : clear(it),
      ),
    ),
    { cwd: dir },
  );
}

describe("the fixture states the premise", () => {
  it("the engine rules 11.1 non-conformant on the unlabelled field", () => {
    expect(derivePackResults(audit(), "rgaa").find((c) => c.id === "11.1")?.status).toBe("NC");
    expect(engineAnchor("11.1")).toBeDefined();
  });

  it("11.2 carries no engine rule, so it is still open for the agent", () => {
    expect(derivePackResults(audit(), "rgaa").find((c) => c.id === "11.2")?.status).toBe("manual");
  });
});

describe("an NC that re-charges the neighbour's own anchor is refused", () => {
  const r = () => ncOn("11.2", engineAnchor("11.1")!, "11.2.1");

  it("refuses the verdict", () => {
    expect(r().rejectedCriteria).toContain("11.2");
  });

  it("names the neighbour that already owns it, so the next pass can be right", () => {
    expect(r().issues.join("\n")).toMatch(/11\.2[\s\S]*11\.1/);
  });

  it("leaves the criterion to assess — it is not silently turned into a conformity", () => {
    const crit = r().audit.packAdjudication?.criteria.find((c) => c.id === "11.2");
    expect(crit?.status).toBe("manual");
    expect(crit?.decidedBy).toBeUndefined();
  });

  it("condemns only its own criterion", () => {
    expect(r().rejectedCriteria).toEqual(["11.2"]);
  });
});

describe("the refusal stays narrow", () => {
  it("accepts an NC on a DIFFERENT anchor — the labelled field is 11.2's to rule on", () => {
    const items = buildAdjudicationWorklist(audit(), { standard: "rgaa" });
    const ev = items.find((i) => i.criteriaId === "11.2")!.evidence;
    const bad = engineAnchor("11.1")!;
    const other = ev.find((e) => !(e.file === bad.file && e.line === bad.line && e.selector === bad.selector));
    expect(other, "11.2 harvested only the anchor the engine already owns").toBeDefined();
    const r = ncOn("11.2", { file: other!.file, line: other!.line, selector: other!.selector, snippet: other!.snippet }, "11.2.1");
    expect(r.rejectedCriteria, r.issues.join("\n")).not.toContain("11.2");
  });

  it("cannot fire on a mechanical criterion, because the engine's own are never open at all", () => {
    // The check reads `siblingCriteria(...).filter(role === "mechanical")`, which is empty for
    // a criterion that IS mechanical — so it is structurally unable to refuse one. The
    // anti-surplus gate makes the point moot from the other side, and pinning it here says why
    // the narrowing costs nothing: a criterion the engine ruled on never reaches adjudication.
    const open = new Set(buildAdjudicationWorklist(audit(), { standard: "rgaa" }).map((i) => i.criteriaId));
    for (const pc of derivePackResults(audit(), "rgaa").filter((c) => c.status === "NC")) {
      expect(open.has(pc.id), `${pc.id} should not be open — the engine decided it`).toBe(false);
    }
  });
});

// TWO DEFECTS ON ONE CONTROL ARE NOT ONE DEFECT CHARGED TWICE.
//
// The guard above reads a NEIGHBOURHOOD — same theme, shared success criterion, opposite side
// of the mechanical/judgment line — and treats every member of it as a question the criterion
// under verdict presupposes. That holds for the pair it was built on (11.2 has no subject on a
// field 11.1 says has no label) and for nothing else automatically. RGAA 11.4 neighbours 11.1,
// 11.5 AND 11.6, each exactly one success criterion away, and only the first owns its subject:
// a radio group the engine ruled ungrouped under 11.5 still HAS labels, and 11.4 still asks
// whether they are placed correctly.
//
// It cost a true finding, on this repository's own gate: the committed RGAA ledger rules 11.4
// non-conformant on four radios of the fixture site (label to the LEFT of the control, test
// 11.4.3), the engine owns those same anchors under 11.5, the replay refused the verdict, and
// `ledger-gate` went red reporting 11.4 « still to assess » — 105 criteria decided out of 106.
//
// So the refusal now needs the pack to single ONE neighbour out, strictly closer than every
// other. A tie is the pack declining to say which question comes first, and refusing on a tie
// is a guess made against a finding that may well be true.
describe("a neighbour the pack does not single out refuses nothing", () => {
  it("states the premise: the engine owns the radio under 11.5, and 11.4 is left to the agent", () => {
    const pcs = derivePackResults(auditOf(RADIOS), "rgaa");
    expect(pcs.find((c) => c.id === "11.5")?.status).toBe("NC");
    expect(engineAnchor("11.5", RADIOS)).toMatchObject({ selector: "input#oui" });
    expect(pcs.find((c) => c.id === "11.4")?.status).toBe("manual");
  });

  it("accepts 11.4 on the very anchor the engine ruled 11.5 non-conformant", () => {
    const r = ncOn("11.4", engineAnchor("11.5", RADIOS)!, "11.4.3", RADIOS);
    expect(r.rejectedCriteria, r.issues.join("\n")).not.toContain("11.4");
  });

  it("still refuses the pair it was built for — 11.2 on 11.1's own anchor", () => {
    expect(ncOn("11.2", engineAnchor("11.1")!, "11.2.1").rejectedCriteria).toContain("11.2");
  });
});

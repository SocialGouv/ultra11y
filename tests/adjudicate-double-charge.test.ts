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

const audit = () => runAudit({ inputs: [PAGE] });

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

/** The anchor the ENGINE raised its 11.1 non-conformity on. */
function engineAnchor(criterion: string) {
  const pc = derivePackResults(audit(), "rgaa").find((c) => c.id === criterion);
  const f = pc?.findings.find((x) => !x.advisory && !x.ruleId.startsWith("agent:"));
  return f ? { file: f.file, line: f.line, selector: f.selectorHint, snippet: f.snippet } : undefined;
}

/** Rule `id` non-conformant on a given anchor, clearing every other criterion. */
function ncOn(id: string, anchor: { file: string; line: number; selector: string; snippet: string }, normativeRef: string) {
  const items = buildAdjudicationWorklist(audit(), { standard: "rgaa" });
  expect(
    items.map((i) => i.criteriaId),
    `${id} is not open for adjudication`,
  ).toContain(id);
  return applyAdjudication(
    audit(),
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

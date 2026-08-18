// « À évaluer » is a claim about the auditor, not about the code: it says nobody has decided
// yet. A criterion whose SUBJECT does not exist anywhere in scope is not undecided — there was
// never anything to look at, and « non applicable » is the normative verdict for that.
//
// The engine already proved this for time-based media (SUBJECT_MATTER in src/audit.ts). The
// adjudication harvest knows the same thing about far more criteria: it declares, per
// criterion, exactly which elements decide it. When those come back empty across the WHOLE
// scope, the criterion is not applicable — and saying so is what stops a reader working
// through 106 rows to discover that thirteen of them concerned a `<video>` the site does not
// have. Measured on a real 300-file audit: 96 of 106 criteria « à évaluer », whole themes
// among them applicable to nothing in scope.
//
// The guardrails from that doctrine hold here, because a wrong NA is a non-conformity hidden
// inside a report someone signs:
//
//   1. Only subjects whose EMPTINESS PROVES ABSENCE qualify. "No <table> in scope" is a fact
//      about the code; "no heading outline harvested" only means no full document was parsed.
//      A criterion with even one non-existence subject stays « à évaluer ».
//   2. Absence is folded across the whole scope, never per file.
//   3. Nothing flips on an empty scope — a run that read no file has proved nothing.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { derivePackResults } from "../src/standards/index.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "u11y-absence-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A complete, blameless page: real structure, and nothing else. No table, no form control,
 *  no link, no image, no media, no timer, no pointer handler. */
const BARE = `<!doctype html><html lang="fr"><head><title>Mentions légales</title></head><body>
<header><p>Egapro</p></header>
<main><h1>Mentions légales</h1><p>Éditeur du site : la direction générale du travail.</p></main>
<footer><p>Ministère du travail</p></footer>
</body></html>`;

function audit(html: string, name = "page.html") {
  const f = join(root, name);
  writeFileSync(f, html);
  return runAudit({ inputs: [f] });
}

const sc = (r: ReturnType<typeof runAudit>, id: string) => r.criteria.find((c) => c.id === id);
const rgaa = (r: ReturnType<typeof runAudit>, id: string) => derivePackResults(r, "rgaa").find((c) => c.id === id);

describe("a criterion whose subject is absent from the whole scope is NOT APPLICABLE", () => {
  it("closes the success criteria whose subject the page does not contain", () => {
    const r = audit(BARE);
    // Non-text content and images of text (no image anywhere), link purpose (no link).
    for (const id of ["1.1.1", "1.4.5", "2.4.4"]) {
      expect(sc(r, id)?.status, `${id} should be NA on a page that contains none of its subject`).toBe("NA");
    }
  });

  it("says WHAT it looked for and did not find, so a reader can falsify it", () => {
    const j = sc(audit(BARE), "2.4.4")?.justification ?? "";
    expect(j).toMatch(/2\.4\.4/);
    expect(j).toMatch(/no link/i);
    expect(j).toMatch(/file\(s\) audited/);
    // An NA is a statement about the SUBJECT, never about conformity — the text has to say so,
    // because a reader skimming a grid reads "NA" as "fine here".
    expect(j).toMatch(/never says the criterion is met/i);
  });

  it("keeps the criterion open the moment its subject appears", () => {
    const withLink = audit(BARE.replace("<p>Éditeur", '<p><a href="/cgu">Conditions</a> — Éditeur'));
    expect(sc(withLink, "2.4.4")?.status).not.toBe("NA");
    const withImage = audit(BARE.replace("<p>Éditeur", '<img src="/logo.png" alt="Egapro"><p>Éditeur'));
    expect(sc(withImage, "1.1.1")?.status).not.toBe("NA");
  });

  it("refuses to conclude from a subject whose emptiness proves nothing", () => {
    // `langParts` harvests marked-up language changes. Finding none is exactly what a page
    // that FAILS 3.1.2 looks like, so absence here must never read as "not applicable".
    // Same for live regions (4.1.3): an unmarked status message is the non-conformity. And
    // `sensoryText` matches a vocabulary — « ci-dessous », « to the right » — so a page saying
    // « cliquez sur l'icône en forme de loupe » harvests nothing while failing 1.3.3 outright.
    const r = audit(BARE);
    expect(sc(r, "3.1.2")?.status).not.toBe("NA");
    expect(sc(r, "4.1.3")?.status).not.toBe("NA");
    expect(sc(r, "1.3.3")?.status).not.toBe("NA");
  });

  it("never overrules a hand-written applicability predicate", () => {
    // 1.2.x, 1.3.5, 2.1.4, 2.2.x, 2.3.1 and 2.5.x already answer for themselves in
    // src/audit.ts, and those predicates know things a harvest subject does not — that a stray
    // <track>, an <object> of unknown type or a mention of `devicemotion` keeps the family
    // open. One criterion, one authority: the finer instrument wins, even when it is the one
    // saying « still applicable ».
    const withTrack = audit(BARE.replace("<p>Éditeur", '<video><track kind="captions"></video><p>Éditeur'));
    expect(sc(withTrack, "1.2.2")?.status).not.toBe("NA");
  });

  it("proves nothing from an empty scope", () => {
    // A run that read no file has looked at nothing, so it may conclude nothing. Asserted on
    // the criteria THIS layer owns: the older per-criterion predicates already answered for
    // their own family before this existed, and their behaviour is not what is under test.
    const r = runAudit({ inputs: [join(root, "does-not-exist.html")] });
    expect(r.scope.files).toBe(0);
    expect(r.scope.subjectsSeen).toBeUndefined();
    expect(sc(r, "1.1.1")?.status).not.toBe("NA");
    expect(sc(r, "2.4.4")?.status).not.toBe("NA");
    expect(derivePackResults(r, "rgaa").find((c) => c.id === "5.1")?.status).not.toBe("NA");
  });
});

describe("the country standard inherits it — that is where a reader actually counts rows", () => {
  it("closes a whole theme the page has nothing for", () => {
    const r = audit(BARE);
    // Theme 5 is tables, end to end. A page with no <table> has nothing to answer.
    for (const id of ["5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "5.8"]) {
      expect(rgaa(r, id)?.status, `RGAA ${id} should be NA on a page with no table`).toBe("NA");
    }
    // Theme 6 is links; theme 1 is images.
    expect(rgaa(r, "6.1")?.status).toBe("NA");
    expect(rgaa(r, "1.1")?.status).toBe("NA");
  });

  it("reopens the theme as soon as the page carries one", () => {
    const withTable = audit(BARE.replace("<p>Éditeur", "<table><tr><td>1</td></tr></table><p>Éditeur"));
    expect(rgaa(withTable, "5.1")?.status).not.toBe("NA");
  });

  it("leaves a criterion open when only SOME of its subjects are absent", () => {
    // RGAA 1.1 is images; RGAA 9.1 is headings, whose emptiness proves nothing about
    // applicability. A page with no image closes the first and not the second.
    const r = audit(BARE);
    expect(rgaa(r, "1.1")?.status).toBe("NA");
    expect(rgaa(r, "9.1")?.status).not.toBe("NA");
  });
});

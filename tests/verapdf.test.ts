// veraPDF IN THE 13.3 BRIEF — OPTIONAL, EXTERNAL, LABELLED AS SUCH (#131).
//
// When veraPDF is installed, the 13.3 brief carries its PDF/UA-1 result beside the engine's own
// document checks. Absent, nothing changes. Present, it is another tool's word: labelled as
// external, never evidence, never a verdict — and a run that failed never reads as « compliant ».
//
// The suite runs with ULTRA11Y_VERAPDF=off (vitest.config.ts), so a brief renders the same on
// every machine; these tests point it at a stub that answers like veraPDF does, and — only where
// the real one is installed — at the real one.
import { chmodSync, copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { buildAdjudicationWorklist, formatAdjudication } from "../src/adjudicate.js";
import { parseVeraPdfJson, runVeraPdf, veraPdfCommand } from "../src/verapdf.js";

const FIX = join(import.meta.dirname, "fixtures", "pdf");
const root = mkdtempSync(join(tmpdir(), "u11y-vera-"));
const page = join(root, "index.html");
writeFileSync(
  page,
  `<!doctype html><html lang="fr"><head><title>Docs</title></head><body><main><h1>Docs</h1><a href="ok.pdf">Rapport (PDF)</a><a href="bad.pdf">Annexe (PDF)</a></main></body></html>`,
);
copyFileSync(join(FIX, "tagged-ua1.pdf"), join(root, "ok.pdf"));
copyFileSync(join(FIX, "untagged.pdf"), join(root, "bad.pdf"));

/** A stand-in for the veraPDF CLI: the same JSON shape (`--format json`), the same habit of
 *  exiting 1 on a non-compliant file. `ok.pdf` passes, anything else fails two rules. */
const STUB = join(root, "verapdf-stub");
writeFileSync(
  STUB,
  `#!/usr/bin/env node
if (process.env.STUB_BROKEN) { process.stderr.write("Error: Could not find or load main class\\n"); process.exit(3); }
const files = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !(all[i - 1] || "").startsWith("--"));
const jobs = files.map((name) => {
  const ok = name.endsWith("ok.pdf");
  return { itemDetails: { name, size: 1 }, validationResult: [{ details: { passedRules: ok ? 106 : 104, failedRules: ok ? 0 : 2,
    ruleSummaries: ok ? [] : [
      { ruleStatus: "FAILED", clause: "7.1", testNumber: 3, status: "failed", failedChecks: 1, description: "Content shall be marked as Artifact or tagged as real content" },
      { ruleStatus: "FAILED", clause: "7.2", testNumber: 34, status: "failed", failedChecks: 1, description: "Natural language for text in page content shall be determined" } ] },
    jobEndStatus: "normal", profileName: "PDF/UA-1 validation profile", compliant: ok }] };
});
process.stdout.write(JSON.stringify({ report: { buildInformation: { releaseDetails: [{ id: "apps", version: "9.9.9" }] }, jobs } }));
process.exit(jobs.every((j) => j.validationResult[0].compliant) ? 0 : 1);
`,
);
chmodSync(STUB, 0o755);

const brief313 = (lang: "fr" | "en" = "fr"): string => {
  const items = buildAdjudicationWorklist(runAudit({ inputs: [page, join(root, "ok.pdf"), join(root, "bad.pdf")] }), { standard: "rgaa" }).filter(
    (i) => i.criteriaId === "13.3",
  );
  expect(items).toHaveLength(1);
  return formatAdjudication(items, lang, "rgaa", { preamble: false });
};

const saved = process.env.ULTRA11Y_VERAPDF;
afterEach(() => {
  if (saved === undefined) delete process.env.ULTRA11Y_VERAPDF;
  else process.env.ULTRA11Y_VERAPDF = saved;
});

describe.skipIf(process.platform === "win32")("the 13.3 brief and an installed veraPDF", () => {
  it("prints nothing of veraPDF when none is available — the brief is what it always was", () => {
    process.env.ULTRA11Y_VERAPDF = "off";
    const md = brief313();
    expect(md).not.toMatch(/Validateur externe|External validator/);
    // The engine's own document checks are still there.
    expect(md).toContain("ok.pdf");
    expect(md).toContain("never PDF/UA conformance");
  });

  it("carries its PDF/UA-1 result per document, labelled as an external tool's, never as evidence", () => {
    process.env.ULTRA11Y_VERAPDF = STUB;
    const md = brief313();
    expect(md).toContain("**Validateur externe — veraPDF 9.9.9, profil PDF/UA-1**");
    expect(md).toMatch(/outil EXTERNE/);
    expect(md).toMatch(/ne se cite pas \(ce n'est pas une évidence\) et ne tranche rien/);
    expect(md).toMatch(/PDF\/UA-1 n'est pas le RGAA 13\.3/);
    expect(md).toMatch(/ok\.pdf` — conforme au profil PDF\/UA-1 selon veraPDF/);
    expect(md).toMatch(/bad\.pdf` — NON conforme au profil PDF\/UA-1 selon veraPDF : 2 règle\(s\) en échec — `7\.1-3`/);
    // Beside the engine's checks, not in their place: the evidence section is unchanged.
    const evidence = md.slice(md.indexOf("Évidences"), md.indexOf("Validateur externe"));
    expect(evidence).toContain("ok.pdf");
    expect(evidence).not.toContain("veraPDF 9.9.9");

    const en = brief313("en");
    expect(en).toContain("**External validator — veraPDF 9.9.9, PDF/UA-1 profile**");
    expect(en).toMatch(/not citable \(it is not evidence\) and decides nothing/);
    expect(en).toMatch(/bad\.pdf` — NOT compliant with the PDF\/UA-1 profile according to veraPDF: 2 failed rule\(s\)/);
  });

  it("says a failed run failed — it never reads as compliant", () => {
    // An executable that is not there…
    const gone = runVeraPdf([join(root, "ok.pdf")], { env: { ULTRA11Y_VERAPDF: join(root, "missing-verapdf") } });
    expect(gone?.results[0]?.compliant).toBeUndefined();
    expect(gone?.results[0]?.error).toMatch(/^veraPDF did not run/);
    // …and one that runs, prints no report and exits non-zero (a broken Java install).
    copyFileSync(join(root, "ok.pdf"), join(root, "ok-again.pdf"));
    const broken = runVeraPdf([join(root, "ok-again.pdf")], { env: { ULTRA11Y_VERAPDF: STUB, STUB_BROKEN: "1", PATH: process.env.PATH ?? "" } });
    expect(broken?.results[0]?.compliant).toBeUndefined();
    expect(broken?.results[0]?.error).toMatch(/veraPDF did not run: Error: Could not find or load main class/);
  });

  it("rides with the engine's document checks — on the criteria that list PDFs, and only those", () => {
    process.env.ULTRA11Y_VERAPDF = STUB;
    const items = buildAdjudicationWorklist(runAudit({ inputs: [page, join(root, "ok.pdf")] }), { standard: "rgaa" });
    const listsPdf = items.filter((i) => i.evidence.some((e) => e.file.endsWith(".pdf"))).map((i) => i.criteriaId);
    expect(listsPdf).toContain("13.3");
    const touched = items.filter((i) => /Validateur externe/.test(formatAdjudication([i], "fr", "rgaa", { preamble: false }))).map((i) => i.criteriaId);
    expect(touched).toEqual(listsPdf);
  });
});

describe("veraPdfCommand", () => {
  it("is disabled by off / 0 / false, pinned by a path, else looked up on PATH", () => {
    for (const v of ["off", "0", "false", "OFF"]) expect(veraPdfCommand({ ULTRA11Y_VERAPDF: v, PATH: root })).toBeUndefined();
    expect(veraPdfCommand({ ULTRA11Y_VERAPDF: "/opt/verapdf/verapdf" })).toBe("/opt/verapdf/verapdf");
    const bin = mkdtempSync(join(tmpdir(), "u11y-vera-bin-"));
    expect(veraPdfCommand({ PATH: bin })).toBeUndefined();
    if (process.platform !== "win32") {
      writeFileSync(join(bin, "verapdf"), "#!/bin/sh\n");
      expect(veraPdfCommand({ PATH: `${join(bin, "nope")}:${bin}` })).toBe(join(bin, "verapdf"));
    }
  });
});

describe("parseVeraPdfJson", () => {
  const abs = ["/x/a.pdf", "/x/b.pdf"];
  it("reports a job veraPDF could not validate as such, and a missing job as missing", () => {
    const out = JSON.stringify({ report: { jobs: [{ itemDetails: { name: "/x/a.pdf" }, taskResult: [{ exceptionMessage: "Couldn't parse stream" }] }] } });
    const r = parseVeraPdfJson(out, ["a.pdf", "b.pdf"], abs);
    expect(r.results[0]).toEqual({ file: "a.pdf", failedRules: [], error: "Couldn't parse stream" });
    expect(r.results[1]?.compliant).toBeUndefined();
    expect(r.results[1]?.error).toMatch(/absent/);
  });
  it("reads nothing into output that is not a report", () => {
    const r = parseVeraPdfJson("<html>oops</html>", ["a.pdf"], ["/x/a.pdf"]);
    expect(r.results[0]?.compliant).toBeUndefined();
    expect(r.results[0]?.error).toMatch(/no readable report/);
  });
});

// The real thing, where it is installed — the fixtures are the ones veraPDF ruled on
// (tests/fixtures/pdf/make-pdf.mjs): tagged-ua1.pdf passes PDF/UA-1, untagged.pdf does not.
const real = veraPdfCommand({ PATH: process.env.PATH ?? "" });
describe.skipIf(!real)("an installed veraPDF", () => {
  it("passes tagged-ua1.pdf and fails untagged.pdf", () => {
    const r = runVeraPdf(["tagged-ua1.pdf", "untagged.pdf"], { cwd: FIX, env: { PATH: process.env.PATH ?? "" } });
    expect(r?.results[0]?.compliant, r?.results[0]?.error).toBe(true);
    expect(r?.results[1]?.compliant, r?.results[1]?.error).toBe(false);
    expect(r?.results[1]?.failedRules.length).toBeGreaterThan(0);
    expect(r?.version).toMatch(/^\d+\.\d+/);
  }, 120_000);
});

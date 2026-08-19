// THE COVERAGE GATE — did the run actually look at every page it says it audits?
//
// `check --require-decided` asks whether every CRITERION carries a verdict. This asks the
// question one level below it, and it is the one that went unasked: a sweep that loses pages
// produces a report that is simply SHORTER, and a shorter deliverable reads exactly like a
// complete one. Measured on a real run: a hung hover probe killed two specs, a serial group
// took fifteen more with them, and the RGAA report went out with 20 of the 35 declared pages —
// green, with nothing anywhere saying which fifteen were missing or that any were.
//
// A declared page with no capture is not a page that passed. It is a page nobody looked at.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { checkSampleCaptured } from "../src/check.js";
import { PAGES_DIR } from "../src/snapshot.js";

const SAMPLE = {
  standard: "rgaa",
  sample: {
    pages: [
      { id: "accueil", name: "Accueil", url: "https://exemple.fr/" },
      { id: "contact", name: "Nous contacter", url: "https://exemple.fr/contact" },
      { id: "aide", name: "Aide", url: "https://exemple.fr/aide" },
    ],
  },
};

/** A repository whose declared sample is SAMPLE, with `captured` of its pages recorded. */
function repo(captured: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "u11y-cover-"));
  writeFileSync(join(root, ".ultra11yrc.json"), JSON.stringify(SAMPLE));
  for (const id of captured) {
    const dir = join(root, PAGES_DIR, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "meta.json"), JSON.stringify({ v: 1, id, name: id, url: `https://exemple.fr/${id}` }));
    writeFileSync(
      join(dir, "dom.html"),
      `<!-- ultra11y:capture v=1 page=${id} url=https://exemple.fr/${id} -->\n<html lang="fr"><head><title>t</title></head><body></body></html>\n`,
    );
  }
  return root;
}

describe("checkSampleCaptured", () => {
  it("passes when every declared page produced a capture", () => {
    const r = checkSampleCaptured(repo(["accueil", "contact", "aide"]), "fr");
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.declared).toBe(3);
  });

  it("NAMES the pages nobody looked at, rather than reporting a shorter run", () => {
    const r = checkSampleCaptured(repo(["accueil"]), "fr");
    expect(r.ok).toBe(false);
    expect(r.missing.map((m) => m.id).sort()).toEqual(["aide", "contact"]);
    // The name too: an id is what the tool calls the page, a name is what a reader recognises.
    expect(r.issues.join(" ")).toMatch(/Nous contacter/);
    // The ratio a reader needs is what was LOOKED AT over what was promised.
    expect(r.issues.join(" ")).toMatch(/1\/3/);
  });

  it("says the sweep produced nothing at all, instead of passing on an empty set", () => {
    // The worst case and the easiest to miss: zero captures is zero missing pages if you only
    // compare what you have against what you have.
    const r = checkSampleCaptured(repo([]), "fr");
    expect(r.ok).toBe(false);
    expect(r.missing).toHaveLength(3);
  });

  it("has nothing to check when the repository declares no sample", () => {
    // Not every project declares one, and a gate that fails on its absence is a gate that gets
    // turned off. Absent ⇒ this question does not apply.
    const root = mkdtempSync(join(tmpdir(), "u11y-cover-none-"));
    writeFileSync(join(root, ".ultra11yrc.json"), JSON.stringify({ standard: "rgaa" }));
    const r = checkSampleCaptured(root, "fr");
    expect(r.ok).toBe(true);
    expect(r.declared).toBe(0);
  });

  it("ignores a capture the sample never declared — that is coverage, not a defect", () => {
    const r = checkSampleCaptured(repo(["accueil", "contact", "aide", "un-extra"]), "fr");
    expect(r.ok).toBe(true);
  });
});

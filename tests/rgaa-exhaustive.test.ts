// NO RGAA CRITERION WITHOUT ITS FOUR GUARANTEES (issue #65).
//
// For each of the 106 criteria, and for each rule that can decide one:
//   1. every official test has a declared tier (static / rendered / judgment);
//   2. the criterion names harvest subjects, every one of which exists — a criterion handed to
//      the adjudicator with nothing to look at is where an audit quietly becomes an opinion;
//   3. both golden grids give it an expected verdict (tests/rgaa-golden.test.ts holds the
//      engine to them);
//   4. every DECISIVE rule — the ones that make a criterion non-conforming with no adjudicator
//      in the loop — has a recall seed proving it fires: a registered static rule is seeded by
//      tests/recall-matrix.test.ts (which refuses an unseeded one); a pack rule, an axe rule or a
//      live probe is seeded by the golden non-conforming page, in the shape that runs it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SUBJECTS, subjectsForPackCriterion } from "../src/adjudicate-subjects.js";
import { runAudit } from "../src/audit.js";
import { ALL_RULES } from "../src/rules/registry.js";
import { PAGES_DIR, SNAPSHOT_VERSION, writeSnapshot } from "../src/snapshot.js";
import { loadPack } from "../src/standards/index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const pack = loadPack("rgaa");
const DIR = join(import.meta.dirname, "fixtures", "rgaa-golden");
const grid = (name: string) => (JSON.parse(readFileSync(join(DIR, `${name}.expected.json`), "utf8")) as { criteria: Record<string, unknown> }).criteria;

// Decisive rules no golden page exercises, each with the reason. A new decisive rule must
// either fire on the golden non-conforming page or be listed here — never silently neither.
const UNSEEDED: Record<string, string> = {
  "axe:duplicate-id": "deprecated in axe-core (tag wcag2a-obsolete, WCAG 4.1.1 removed): the scan's tag set does not run it",
  "axe:duplicate-id-active": "deprecated in axe-core (tag wcag2a-obsolete, WCAG 4.1.1 removed): the scan's tag set does not run it",
  "axe:duplicate-id-aria":
    "the static twin `duplicate-id` decides 8.2.1 on the same pages; the golden page's duplicated id is not one axe reports through an ARIA reference",
  "axe:document-title": "the golden non-conforming page has a title (8.5 is C there); its static twin `title-missing-empty` is seeded by the recall matrix",
};

describe("every RGAA criterion has its four guarantees", () => {
  it("1 — every official test has a declared tier", () => {
    for (const c of pack.criteria) {
      expect(Object.keys(c.automation?.tests ?? {}).sort(), c.id).toEqual(Object.keys(c.tests ?? {}).sort());
      for (const tier of Object.values(c.automation!.tests)) expect(["static", "rendered", "judgment"], c.id).toContain(tier);
    }
  });

  it("2 — every criterion names harvest subjects, and each one exists", () => {
    const missing = pack.criteria.filter((c) => subjectsForPackCriterion("rgaa", c.id, c.wcag).length === 0).map((c) => c.id);
    expect(missing).toEqual([]);
    const unknown = pack.criteria.flatMap((c) =>
      subjectsForPackCriterion("rgaa", c.id, c.wcag)
        .filter((s) => !SUBJECTS[s])
        .map((s) => `${c.id}:${s}`),
    );
    expect(unknown).toEqual([]);
  });

  it("3 — both golden grids carry every criterion", () => {
    for (const name of ["non-conforme", "conforme"]) expect(Object.keys(grid(name)).sort(), name).toEqual(pack.criteria.map((c) => c.id).sort());
  });

  it("4 — every decisive rule has a recall seed", () => {
    const decisive = new Set(pack.criteria.flatMap((c) => c.automation!.rules.filter((r) => r.effect === "decisive-nc").map((r) => r.id)));
    const registered = new Set(ALL_RULES.map((r) => r.id));

    // The golden non-conforming page, in every shape that runs a rule: the source file, a
    // capture (the doctype rule reads the recorded doctype), and the browser's recording (axe,
    // the live probes).
    const root = mkdtempSync(join(tmpdir(), "u11y-exhaustive-"));
    try {
      const src = readFileSync(join(DIR, "non-conforme.html"), "utf8");
      writeSnapshot(root, { meta: { v: SNAPSHOT_VERSION, id: "nc", name: "nc", url: "https://villeneuve.test/nc", doctype: "" }, dom: src });
      const fired = new Set(
        [
          runAudit({ inputs: [join(DIR, "non-conforme.html")] }),
          runAudit({ inputs: [join(root, PAGES_DIR)] }),
          runAudit({ inputs: [join(DIR, "rendered", PAGES_DIR, "non-conforme-html")] }),
        ].flatMap((a) => [...a.findings, ...(a.packFindings ?? [])].map((f) => f.ruleId)),
      );
      const unseeded = [...decisive].filter((id) => !registered.has(id) && !fired.has(id) && !UNSEEDED[id]).sort();
      expect(unseeded, "a decisive rule fires on no seed: add its defect to the golden non-conforming page, or say why in UNSEEDED").toEqual([]);
      // …and the exemption list only ever names rules that really are decisive and really are unseeded.
      expect(Object.keys(UNSEEDED).filter((id) => !decisive.has(id) || fired.has(id))).toEqual([]);
      // A registered decisive rule is seeded by the recall matrix; it must also be one the engine ships.
      for (const id of decisive) if (!id.includes(":") && !id.startsWith("dyn-")) expect(registered.has(id), id).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

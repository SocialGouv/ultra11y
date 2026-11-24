// Journeys (#189), browser-free: the file format's strict validator, the run manifest and the
// coverage scope, the annex table, the snapshot meta, the criterion mapping, and the syntax of
// every browser-side string the replay evaluates. The replay itself is tests/journey.e2e.test.ts.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PROBE_SEVERITY, PROBE_WCAG } from "../src/axe-map.js";
import { main } from "../src/cli.js";
import {
  duplicateJourneyNames,
  JOURNEYS_DIR,
  journeyScopeFor,
  listJourneyFiles,
  readJourneyRuns,
  stepLabel,
  stepPageId,
  validateJourney,
  writeJourneyRuns,
} from "../src/journey.js";
import { journeySources } from "../src/journey-run.js";
import { renderJourneys } from "../src/report.js";
import { routeCoverage, routesToScan } from "../src/routes.js";
import { toDynamicResult } from "../src/scan.js";
import { validateSnapshotMeta } from "../src/snapshot.js";
import { loadPack } from "../src/standards/index.js";
import type { JourneyRecord } from "../src/types.js";

const ok = {
  name: "connexion",
  startUrl: "/connexion",
  steps: [
    { action: "fill", target: { label: "Identifiant" }, value: "alice" },
    { action: "click", target: { role: "button", name: "Se connecter" } },
    { action: "expect", target: { role: "heading", name: "Tableau de bord" } },
  ],
};
const issuesOf = (raw: unknown) => validateJourney(raw).issues.map((i) => `${i.path}: ${i.message}`);

describe("validateJourney — a strict validator with paths", () => {
  it("accepts a well-formed journey and drops the $schema key", () => {
    const v = validateJourney({ $schema: "x", ...ok, keyboardOnly: true });
    expect(v.ok).toBe(true);
    expect(v.journey).toEqual({ ...ok, keyboardOnly: true });
  });

  it("accepts every action with what it needs", () => {
    const v = validateJourney({
      name: "tout",
      startUrl: "https://example.test/",
      storageState: ".auth/session.json",
      steps: [
        { action: "goto", url: "/recherche" },
        { action: "fill", target: { role: "searchbox", name: "Rechercher" }, value: "information" },
        { action: "press", key: "Enter" },
        { action: "press", key: "ArrowDown", target: { role: "listbox" } },
        { action: "select", target: { label: "Tri", exact: true }, value: "date" },
        { action: "check", target: { label: "Archives" } },
        { action: "waitFor", target: { text: "Résultats" }, timeoutMs: 10000 },
        { action: "expect", target: { css: "#resultats" }, state: "visible", note: "liste" },
      ],
    });
    expect(v.issues).toEqual([]);
  });

  it("refuses what is not an object or has no steps", () => {
    expect(issuesOf(null)).toEqual([": a journey must be a JSON object { name, startUrl, steps: [...] }"]);
    expect(issuesOf({ name: "a", startUrl: "/", steps: [] })).toEqual(["steps: steps must be a non-empty array"]);
  });

  it("refuses an unknown key at every level — a typo must not replay another journey", () => {
    const issues = issuesOf({ ...ok, startURL: "/", steps: [{ action: "click", targt: { role: "button" } }] });
    expect(issues).toContain('startURL: unknown key "startURL" (allowed: $schema, name, description, startUrl, storageState, keyboardOnly, steps)');
    expect(issues.some((i) => i.startsWith('steps[0].targt: unknown key "targt"'))).toBe(true);
    expect(issues).toContain("steps[0].target: a click step needs a target");
  });

  it("names the step and field of every problem", () => {
    const issues = issuesOf({
      name: "Mauvais Nom",
      startUrl: "",
      steps: [
        { action: "tap" },
        { action: "fill", target: { label: "Nom" } },
        { action: "goto" },
        { action: "press" },
        { action: "click", target: { role: "button", label: "x" } },
        { action: "click", target: {} },
        { action: "expect", target: { text: "ok" }, state: "shown" },
        { action: "click", target: { css: "#a" }, value: "x", timeoutMs: 0 },
      ],
    });
    expect(issues).toEqual([
      expect.stringMatching(/^name: name "Mauvais Nom" must match/),
      expect.stringMatching(/^startUrl: startUrl must be a non-empty string/),
      'steps[0].action: action must be one of goto, click, fill, select, check, press, waitFor, expect (got "tap")',
      "steps[1].value: a fill step needs a string value",
      "steps[2].url: a goto step needs a url",
      'steps[3].key: a press step needs a key (e.g. "Escape", "Enter", "ArrowDown")',
      "steps[4].target: target must name exactly one of role, label, text or css (got role + label)",
      "steps[5].target: target must name exactly one of role, label, text or css (got none)",
      "steps[6].state: state must be one of visible, hidden, attached, detached",
      "steps[7].value: value belongs to a fill or select step, not a click step",
      "steps[7].timeoutMs: timeoutMs must be an integer between 1 and 60000",
    ]);
  });

  it("refuses a key that belongs to another kind of target", () => {
    expect(issuesOf({ ...ok, steps: [{ action: "click", target: { css: "#a", exact: true } }] })).toEqual([
      'steps[0].target.exact: unknown key "exact" for a css target (allowed: css)',
    ]);
  });
});

describe("step labels and page ids", () => {
  it("words a step the way the annex shows it", () => {
    expect(stepLabel({ action: "click", target: { role: "button", name: "Envoyer" } })).toBe('click button "Envoyer"');
    expect(stepLabel({ action: "fill", target: { label: "Courriel" }, value: "a@b.fr" })).toBe('fill label "Courriel" = "a@b.fr"');
    expect(stepLabel({ action: "press", key: "Escape" })).toBe("press Escape");
    expect(stepLabel({ action: "waitFor", target: { css: ".spinner" }, state: "hidden" })).toBe("waitFor css .spinner (hidden)");
  });

  it("ids a step <journey>-<nn>-<slug>, accent-folded, never after a host or port", () => {
    expect(stepPageId("contact", 3, { action: "click", target: { role: "button", name: "Été évité" } })).toBe("contact-03-click-button-ete-evite");
    expect(stepPageId("contact", 0, { action: "goto", url: "http://127.0.0.1:4567/contact" })).toBe("contact-00-start");
    expect(stepPageId("contact", 2, { action: "goto", url: "http://127.0.0.1:4567/aide#faq" })).toBe("contact-02-goto-aide-faq");
  });
});

const record = (over: Partial<JourneyRecord> = {}): JourneyRecord => ({
  name: "connexion",
  file: `${JOURNEYS_DIR}/connexion.json`,
  keyboard: true,
  status: "failed",
  reason: 'step 2 (click button "Se connecter"): no element matches button "Se connecter" within 5000 ms (locator not found)',
  steps: [
    { n: 0, action: "goto", label: "goto /connexion", status: "done", page: "connexion-00-start" },
    { n: 1, action: "fill", label: 'fill label "Identifiant" = "alice"', status: "done", page: "connexion-01-fill", keyboard: "focus" },
    { n: 2, action: "click", label: 'click button "Se connecter"', status: "failed", reason: "locator not found" },
    { n: 3, action: "expect", label: 'expect heading "Tableau de bord"', status: "not-run" },
  ],
  ...over,
});

describe("the run manifest and scope.journeys", () => {
  it("lists every journey file, replayed or not, an invalid one with its issues, and keeps the others' last run", () => {
    const root = mkdtempSync(join(tmpdir(), "u11y-journeys-"));
    mkdirSync(join(root, JOURNEYS_DIR), { recursive: true });
    writeFileSync(join(root, JOURNEYS_DIR, "connexion.json"), JSON.stringify(ok));
    writeFileSync(join(root, JOURNEYS_DIR, "recherche.json"), JSON.stringify({ ...ok, name: "recherche" }));
    writeFileSync(join(root, JOURNEYS_DIR, "casse.json"), "{ not json");
    expect(listJourneyFiles(root).map((f) => [f.base, f.validation.ok])).toEqual([
      ["casse", false],
      ["connexion", true],
      ["recherche", true],
    ]);
    writeJourneyRuns(root, [record()]);
    writeJourneyRuns(root, [record({ name: "ancien", file: `${JOURNEYS_DIR}/ancien.json` })]);
    expect(readJourneyRuns(root)?.journeys.map((j) => j.name)).toEqual(["ancien", "connexion"]);
    const scope = journeyScopeFor(root)!;
    expect(scope.journeys.map((j) => [j.name, j.status])).toEqual([
      ["ancien", "failed"],
      ["casse", "not-run"],
      ["connexion", "failed"],
      ["recherche", "not-run"],
    ]);
    expect(scope.journeys[1]!.reason).toMatch(/^invalid journey file: not valid JSON/);
    expect(scope.journeys[3]!.steps.map((s) => s.status)).toEqual(["not-run", "not-run", "not-run"]);
  });

  it("is undefined for a project with no journey, so its audit is unchanged", () => {
    expect(journeyScopeFor(mkdtempSync(join(tmpdir(), "u11y-none-")))).toBeUndefined();
  });
});

describe("the annex table (section H)", () => {
  it("lists the journey, then every step with its status, page and reason", () => {
    const md = renderJourneys({ manifest: ".ultra11y/journey-runs.json", journeys: [record()] }, "en").join("\n");
    expect(md).toContain("## H. User journeys — coverage");
    expect(md).toContain("0 done, 1 failed with the reason, 0 not run");
    expect(md).toContain("| **connexion** (keyboard only) | — | `.ultra11y/journeys/connexion.json` | failed |");
    expect(md).toContain('| connexion | 1 | fill label "Identifiant" = "alice" | done | `connexion-01-fill` |  |');
    expect(md).toContain('| connexion | 2 | click button "Se connecter" | failed | — | locator not found |');
    expect(md).toContain('| connexion | 3 | expect heading "Tableau de bord" | not run | — |  |');
    expect(md).toContain("> 1 journey(s) not completed.");
  });

  it("says when a step was played with the pointer because the keyboard could not", () => {
    const r = record({ status: "done", reason: undefined });
    r.steps[2] = { n: 2, action: "click", label: 'click button "Se connecter"', status: "done", keyboard: "unreachable", observed: ["keyboard-unreachable"] };
    const md = renderJourneys({ manifest: "m", journeys: [r] }, "fr").join("\n");
    expect(md).toContain("non atteignable au clavier — jouée au pointeur — keyboard-unreachable");
  });
});

describe("what a journey observes maps onto the criteria", () => {
  it("WCAG and severity", () => {
    expect([PROBE_WCAG["keyboard-unreachable"], PROBE_SEVERITY["keyboard-unreachable"]]).toEqual(["2.1.1", "bloquant"]);
    expect([PROBE_WCAG["dialog-focus"], PROBE_SEVERITY["dialog-focus"]]).toEqual(["2.4.3", "majeur"]);
    expect([PROBE_WCAG["error-unassociated"], PROBE_SEVERITY["error-unassociated"]]).toEqual(["3.3.1", "majeur"]);
  });

  it("RGAA: 7.3 (scripts operable by keyboard), 12.8 (tab order), 11.10 (input errors), 12.9 (trap)", () => {
    const pack = loadPack("rgaa");
    const routed = (c: string) => pack.criteria.find((x) => x.id === c)!.appliesTo!.ruleIds;
    expect(routed("7.3")).toContain("dyn-keyboard-unreachable");
    expect(routed("12.8")).toContain("dyn-dialog-focus");
    expect(routed("11.10")).toContain("dyn-error-unassociated");
    expect(routed("12.9")).toContain("dyn-keyboard-trap");
  });

  it("a runner output carrying them folds into findings, one per hit", () => {
    const hit = { selector: "#x", html: "<div id=x>", detail: "d" };
    const r = toDynamicResult(
      {
        url: "https://example.test/",
        violations: [],
        reflow: { horizontalScroll: false },
        keyboardUnreachable: [hit],
        dialogFocus: [hit],
        errorUnassociated: [hit],
      },
      "https://example.test/",
    );
    expect(r.findings.map((f) => [f.engine, f.criteriaId])).toEqual([
      ["keyboard-unreachable", "2.1.1"],
      ["dialog-focus", "2.4.3"],
      ["error-unassociated", "3.3.1"],
    ]);
  });
});

describe("snapshot meta records the journey step", () => {
  const meta = { v: 1, id: "contact-02-click", name: "contact — 2", url: "https://example.test/" };
  it("keeps a well-formed journey field through the whitelist", () => {
    const v = validateSnapshotMeta({ ...meta, journey: { name: "contact", step: 2, action: "click", keyboard: true } });
    expect(v.meta?.journey).toEqual({ name: "contact", step: 2, action: "click", keyboard: true });
  });
  it("refuses a malformed one", () => {
    expect(validateSnapshotMeta({ ...meta, journey: { name: "contact", step: "2" } }).ok).toBe(false);
  });
});

describe("routes: a journey state is ultra11y's browser, not the project's E2E run", () => {
  it("labels it scanned, and never makes `scan --all-routes` skip the route", () => {
    const rows = routeCoverage({ pages: [{ id: "contact-00-start", url: "https://example.test/contact", runner: "journey" }] });
    expect(rows[0]!.observed).toBe("scanned");
    const plan = routesToScan(
      { v: 1, routes: [{ url: "https://example.test/contact", via: ["sitemap"] }] },
      { captured: [{ url: "https://example.test/contact", runner: "journey" }] },
    );
    expect(plan.scan).toEqual(["https://example.test/contact"]);
  });
});

describe("journey names are unique", () => {
  const root = mkdtempSync(join(tmpdir(), "u11y-dupes-"));
  mkdirSync(join(root, JOURNEYS_DIR), { recursive: true });
  writeFileSync(join(root, JOURNEYS_DIR, "connexion.json"), JSON.stringify(ok));
  writeFileSync(join(root, JOURNEYS_DIR, "connexion-copie.json"), JSON.stringify(ok));
  writeFileSync(join(root, JOURNEYS_DIR, "autre.json"), JSON.stringify({ ...ok, name: "autre" }));
  const quiet = async (argv: string[]) => {
    const out: string[] = [];
    const log = console.log;
    const err = console.error;
    console.log = (m: unknown) => out.push(String(m));
    console.error = (m: unknown) => out.push(String(m));
    try {
      return { code: await main(argv), out: out.join("\n") };
    } finally {
      console.log = log;
      console.error = err;
    }
  };

  it("finds the files that share a name", () => {
    expect([...duplicateJourneyNames(listJourneyFiles(root))]).toEqual([
      ["connexion", [`${JOURNEYS_DIR}/connexion-copie.json`, `${JOURNEYS_DIR}/connexion.json`]],
    ]);
  });

  it("`journey run` refuses them, naming both files, before any browser starts", async () => {
    for (const argv of [["--all"], ["connexion-copie"]]) {
      const { code, out } = await quiet(["journey", "run", ...argv, "--root", root, "--lang", "en"]);
      expect(code).toBe(2);
      expect(out).toContain(`the journey name "connexion" is declared by several files (${JOURNEYS_DIR}/connexion-copie.json, ${JOURNEYS_DIR}/connexion.json)`);
    }
  });

  it("`journey list` flags them", async () => {
    const { code, out } = await quiet(["journey", "list", "--root", root, "--json"]);
    expect(code).toBe(1);
    const rows = JSON.parse(out) as { name: string; file: string; valid: boolean }[];
    expect(rows.map((r) => [r.file, r.valid])).toEqual([
      [`${JOURNEYS_DIR}/autre.json`, true],
      [`${JOURNEYS_DIR}/connexion-copie.json`, false],
      [`${JOURNEYS_DIR}/connexion.json`, false],
    ]);
  });
});

describe("journey-run browser strings — every one parses (browser-free)", () => {
  it.each(Object.entries(journeySources()))("%s compiles", (_name, src) => {
    expect(() => new Function(`return ${src};`)).not.toThrow();
  });
});

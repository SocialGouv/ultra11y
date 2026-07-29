import { describe, it, expect } from "vitest";
import { parse } from "@babel/parser";
import { detectE2eRunner, playwrightFixture, cypressPlugin, cypressCommands, e2eSetupPlan } from "../src/e2e.js";

const has =
  (...files: string[]) =>
  (f: string) =>
    files.includes(f);

describe("E2E runner detection", () => {
  it("finds Playwright from the dependency or its config", () => {
    expect(detectE2eRunner({ "@playwright/test": "1" }, has())).toEqual(["playwright"]);
    expect(detectE2eRunner({}, has("playwright.config.ts"))).toEqual(["playwright"]);
  });

  it("finds Cypress from the dependency or its config", () => {
    expect(detectE2eRunner({ cypress: "13" }, has())).toEqual(["cypress"]);
    expect(detectE2eRunner({}, has("cypress.config.js"))).toEqual(["cypress"]);
  });

  it("reports both when a repo runs both", () => {
    expect(detectE2eRunner({ cypress: "13", "@playwright/test": "1" }, has())).toEqual(["playwright", "cypress"]);
  });

  it("reports none rather than guessing", () => {
    expect(detectE2eRunner({ vitest: "4" }, has("vitest.config.ts"))).toEqual([]);
  });
});

describe("the generated fixtures are valid, dependency-free modules", () => {
  const sources = { playwright: playwrightFixture("bin/u11y.mjs"), plugin: cypressPlugin("bin/u11y.mjs"), commands: cypressCommands() };

  for (const [name, src] of Object.entries(sources)) {
    it(`${name} parses as an ES module`, () => {
      // Parsed, never executed — a syntax slip in a generated file must fail CI, not the
      // user's test run at 2am.
      expect(() => parse(src, { sourceType: "module", plugins: [] })).not.toThrow();
    });

    it(`${name} statically imports nothing outside node: builtins`, () => {
      // Comment examples name project paths, so anchor on real import statements only.
      const specs = [...src.matchAll(/^import\s[^\n]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
      // The browser-side command file legitimately imports nothing; the Node-side ones must.
      if (name !== "commands") expect(specs.length).toBeGreaterThan(0);
      for (const spec of specs) expect(spec?.startsWith("node:")).toBe(true);
    });
  }

  it("never uses require() in an ESM fixture — it does not exist there", () => {
    for (const src of Object.values(sources)) expect(src).not.toMatch(/(^|[^.\w])require\s*\(/m);
  });

  it("bakes the engine path but lets ULTRA11Y override it", () => {
    expect(playwrightFixture("bin/u11y.mjs")).toContain("bin/u11y.mjs");
    expect(playwrightFixture("bin/u11y.mjs")).toContain("ULTRA11Y");
    expect(cypressPlugin("bin/u11y.mjs")).toContain("ULTRA11Y");
  });

  it("drives the snapshot through the engine rather than re-implementing the format", () => {
    for (const src of [playwrightFixture("e.mjs"), cypressPlugin("e.mjs")]) {
      expect(src).toContain("snapshot");
      expect(src).toContain("write");
      // No local re-implementation of the provenance comment: that would drift.
      expect(src).not.toContain("ultra11y:capture");
    }
  });

  it("collects the page with the engine's own collector, not a hand-rolled copy", () => {
    expect(playwrightFixture("e.mjs")).toContain("querySelectorAll");
    expect(cypressCommands()).toContain("querySelectorAll");
  });
});

describe("Playwright fixture surface", () => {
  const src = playwrightFixture("e.mjs");

  it("exports a checkA11y helper and a test fixture", () => {
    expect(src).toContain("export async function checkA11y");
    expect(src).toContain("export const test");
  });

  it("defaults to failing on blocking findings, and lets the caller change it", () => {
    expect(src).toContain("failOn");
    expect(src).toMatch(/blocking/);
  });

  it("names the page from the option, falling back to the URL", () => {
    expect(src).toContain("opts.as");
  });
});

describe("Cypress surface", () => {
  it("registers a Node task, because only Node can write to disk", () => {
    expect(cypressPlugin("e.mjs")).toContain('on("task"');
    expect(cypressPlugin("e.mjs")).toContain("ultra11ySnapshot");
  });

  it("adds a cy.ultra11y() command that round-trips through that task", () => {
    expect(cypressCommands()).toContain("Cypress.Commands.add");
    expect(cypressCommands()).toContain("ultra11y");
    expect(cypressCommands()).toContain("cy.task");
  });
});

describe("setup plan", () => {
  it("tells a Playwright user the exact import to write", () => {
    const plan = e2eSetupPlan(["playwright"], { playwright: ".ultra11y/e2e/playwright.mjs" }, "en");
    expect(plan).toContain(".ultra11y/e2e/playwright.mjs");
    expect(plan).toMatch(/import/);
  });

  it("tells a Cypress user to wire both the plugin and the commands", () => {
    const plan = e2eSetupPlan(["cypress"], { cypressPlugin: ".ultra11y/e2e/cypress-plugin.mjs", cypressCommands: ".ultra11y/e2e/cypress-commands.mjs" }, "en");
    expect(plan).toContain("setupNodeEvents");
    expect(plan).toContain("supportFile");
  });

  it("says what to do when no runner was detected, instead of staying silent", () => {
    expect(e2eSetupPlan([], {}, "en")).toMatch(/no .*runner|not detect/i);
  });
});

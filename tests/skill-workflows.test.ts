import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REFS = join(dirname(fileURLToPath(import.meta.url)), "..", "skills/ultra11y/references");
const read = (f: string): string => readFileSync(join(REFS, f), "utf8");

describe("audit.md teaches the audit → report → check loop", () => {
  const t = read("audit.md");
  it("walks audit, report and check, and names residual risk", () => {
    expect(t).toMatch(/ultra11y\.mjs audit/);
    expect(t).toMatch(/ultra11y\.mjs report/);
    expect(t).toMatch(/ultra11y\.mjs check/);
    expect(t).toMatch(/residual|résidu/i);
  });
});

describe("authoring.md teaches native-first / ARIA-last", () => {
  const t = read("authoring.md");
  it("states the doctrine", () => {
    expect(t).toMatch(/natif|native/i);
    expect(t).toContain("ARIA");
  });
});

describe("forbidden-patterns.md covers the 15 anti-patterns", () => {
  const t = read("forbidden-patterns.md");
  it("has 15 entries", () => {
    expect((t.match(/^### /gm) ?? []).length).toBe(15);
  });
});

describe("methodology.md states the formula and the static/rendering/judgment split", () => {
  const t = read("methodology.md");
  it("gives the conformance formula", () => {
    expect(t).toContain("÷");
  });
  it("names the three automatability tiers", () => {
    expect(t).toMatch(/static|statique/i);
    expect(t).toMatch(/rendering|rendu/i);
    expect(t).toMatch(/judgment|jugement/i);
  });
});

describe("cross-file.md teaches audit --graph", () => {
  const t = read("cross-file.md");
  it("covers --graph, the two-pass model and the cross-file rules", () => {
    expect(t).toMatch(/ultra11y\.mjs audit/);
    expect(t).toContain("--graph");
    expect(t).toContain("cross-icon-only-unnamed");
    expect(t).toMatch(/import/i);
  });
});

describe("prd.md teaches the fix backlog + GitHub issues", () => {
  const t = read("prd.md");
  it("covers the prd command, --split criterion and --gh-issues", () => {
    expect(t).toMatch(/ultra11y\.mjs prd/);
    expect(t).toContain("--split criterion");
    expect(t).toContain("--gh-issues");
  });
});

describe("rendered.md teaches auditing rendered output", () => {
  const t = read("rendered.md");
  it("covers the render command, build-output, SSR snapshot and scan", () => {
    expect(t).toMatch(/ultra11y\.mjs render/);
    expect(t).toMatch(/ultra11y\.mjs audit/);
    expect(t).toContain("--scaffold");
    expect(t).toMatch(/DSFR/);
    expect(t).toMatch(/scan/);
  });
});

describe("judgment.md teaches the judgment phase", () => {
  const t = read("judgment.md");
  it("covers verify, the RGAA grid and the verdict tokens", () => {
    expect(t).toMatch(/ultra11y\.mjs verify/);
    expect(t).toMatch(/supported/);
    expect(t).toMatch(/refuted/);
    expect(t).toMatch(/WCAG|RGAA/);
  });
});

describe("correction.md teaches the correction phase", () => {
  const t = read("correction.md");
  it("covers fix (write/iterate), priority order and the anti-regression gate", () => {
    expect(t).toMatch(/ultra11y\.mjs fix/);
    expect(t).toContain("--write");
    expect(t).toContain("--iterate");
    expect(t).toMatch(/blocking|bloquant/i);
  });
});

describe("e2e.md teaches the Playwright/Cypress integration", () => {
  const t = read("e2e.md");
  it("covers the command, both runners and their wiring points", () => {
    expect(t).toContain("render --e2e");
    expect(t).toContain("checkA11y");
    expect(t).toContain("cy.ultra11y");
    expect(t).toContain("setupNodeEvents");
  });
  it("documents failOn, including the record-without-failing mode", () => {
    expect(t).toContain("failOn");
    expect(t).toMatch(/failOn:\s*false/);
  });
  it("explains that the fixture pipes through the engine rather than reimplementing it", () => {
    expect(t).toContain("snapshot write");
    expect(t).toMatch(/drift/i);
  });
});

describe("pages.md teaches page snapshots", () => {
  const t = read("pages.md");
  it("describes the on-disk shape and the automatic ingestion", () => {
    expect(t).toContain(".ultra11y/pages");
    expect(t).toContain("dom.html");
    expect(t).toContain("styles.json");
    expect(t).toMatch(/ultra11y\.mjs audit/);
  });
  it("states why a snapshot decides more than a component capture", () => {
    expect(t).toContain("html-lang-missing");
    expect(t).toContain("8.3");
    expect(t).toMatch(/fragment/i);
  });
  it("states the verified join and its fail-closed refusal", () => {
    expect(t).toMatch(/document-order/i);
    expect(t).toMatch(/refused/i);
  });
  it("teaches the per-page grid and its two honesty rules", () => {
    expect(t).toMatch(/ultra11y\.mjs pages/);
    expect(t).toContain("--standard rgaa");
    expect(t).toMatch(/unattributed/i);
    expect(t).toMatch(/absence of evidence/i);
  });
});

describe("ci.md teaches the CI output formats", () => {
  const t = read("ci.md");
  it("covers both formats, the upload step and the pack-keyed route", () => {
    expect(t).toContain("--format sarif");
    expect(t).toContain("--format github");
    expect(t).toContain("upload-sarif");
    expect(t).toContain("GITHUB_STEP_SUMMARY");
    expect(t).toMatch(/--standard rgaa/);
  });
  it("states the two honesty guarantees: advisory is never an error, URL findings get no location", () => {
    expect(t).toMatch(/advisory/i);
    expect(t).toMatch(/no\s+\*\*?physical\*\*?\s*location|no\*\*? physical location|\*\*no\*\* physical location/i);
  });
});

describe("verify.md teaches the verify gate", () => {
  const t = read("verify.md");
  it("covers the command, --semantic and the verdict tokens", () => {
    expect(t).toMatch(/ultra11y\.mjs verify/);
    expect(t).toContain("--semantic");
    expect(t).toMatch(/supported/);
    expect(t).toMatch(/refuted/);
    expect(t).toMatch(/unsupported/);
  });
});

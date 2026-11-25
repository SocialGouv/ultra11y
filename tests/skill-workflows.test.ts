import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { standardCoverage } from "../src/standards/coverage.js";

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

describe("prd.md teaches the fix backlog", () => {
  const t = read("prd.md");
  it("covers the prd command and --split criterion, and routes filing to tickets.md", () => {
    expect(t).toMatch(/ultra11y\.mjs prd/);
    expect(t).toContain("--split criterion");
    expect(t).toContain("references/tickets.md");
  });
});

describe("tickets.md teaches filing into a tracker", () => {
  const t = read("tickets.md");
  it("covers the command, every grain and all three providers", () => {
    expect(t).toMatch(/ultra11y\.mjs tickets/);
    for (const grain of ["criterion", "page-criterion", "single", "file"]) expect(t, `grain ${grain}`).toContain(grain);
    for (const provider of ["github", "gitlab", "jira"]) expect(t, `provider ${provider}`).toContain(provider);
  });

  it("teaches the guards that stop a run from flooding a tracker", () => {
    expect(t).toContain("--dry-run");
    expect(t).toContain("--max-tickets");
  });

  // De-dupe is by exact title and nothing else; a reader who misses this files duplicates.
  it("states that the title is the de-dupe key, and warns about --lang", () => {
    expect(t).toMatch(/titre.{0,20}(EST|est) la clé/i);
    expect(t).toContain("--lang");
  });

  it("carries the migration table off the removed flags", () => {
    expect(t).toContain("--gh-issues");
    expect(t).toContain("--grain single");
  });
});

describe("rendered.md teaches auditing rendered output", () => {
  const t = read("rendered.md");
  it("covers the render engine, build-output and scan", () => {
    expect(t).toMatch(/ultra11y\.mjs render/);
    expect(t).toMatch(/ultra11y\.mjs audit/);
    expect(t).toContain("react-dom/server");
    expect(t).toContain(".ultra11y/render.json");
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
  it("covers the package exports, both runners and their wiring points", () => {
    expect(t).toContain("ultra11y/playwright");
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
    expect(t).toMatch(/refusé/i);
  });
  it("teaches the rendered tier, its three rules and why it can be trusted", () => {
    expect(t).toContain("rendered-contrast");
    expect(t).toContain("rendered-link-colour-only");
    expect(t).toContain("10.6");
    expect(t).toMatch(/je ne sais pas/i);
    expect(t).toMatch(/50 sur 106/);
    expect(t).toContain("rendered-nontext-contrast");
    expect(t).toMatch(/je n’ai pas pu regarder/i);
  });
  it("teaches the per-page grid and its two honesty rules", () => {
    expect(t).toMatch(/ultra11y\.mjs pages/);
    expect(t).toContain("--standard rgaa");
    expect(t).toMatch(/unattributed/i);
    expect(t).toMatch(/l’absence de preuve/i);
  });
});

describe("ci.md sends CI to iterion and pins the CLI contract", () => {
  const t = read("ci.md");
  it("sends CI to iterion's rgaa-audit bot and ships no integration of its own", () => {
    expect(t).toContain("https://github.com/SocialGouv/iterion/tree/main/bots/rgaa-audit");
    expect(t).not.toMatch(/uses:\s*SocialGouv\/ultra11y@/);
    expect(t).not.toMatch(/gitlab-ci|GitLab CI/);
  });
  it("names the CLI commands the bot relies on as the stable contract", () => {
    for (const command of [
      "status --browser",
      "scan --sample",
      "verify --manual",
      "verify --apply",
      "check --report",
      "--require-decided=pages",
      "pages --in",
      "tickets --in",
    ]) {
      expect(t, command).toContain(command);
    }
  });

  it("documents the authenticated scan, since most page samples sit behind a login", () => {
    expect(t).toContain("storage-state");
  });
  it("documents how the repo publishes itself, tokenlessly", () => {
    expect(t).toContain("id-token: write");
    expect(t).toMatch(/trusted publish/i);
    expect(t).toMatch(/11\.5\.1/);
    expect(t).toMatch(/first.*publish is manual|manual/i);
  });
});

describe("judgment.md teaches adjudicating under a country standard", () => {
  const t = read("judgment.md");
  it("says the worklist is keyed by the standard's own criteria", () => {
    expect(t).toContain("--standard rgaa");
    expect(t).toMatch(/critères RGAA/);
    // DERIVED, not hardcoded: this used to pin "99 of", a figure the pack never supported — so
    // the test held a wrong number in place instead of catching it. The cross-document check
    // lives in tests/standards-coverage.test.ts.
    const judgment = [...standardCoverage("rgaa").values()].filter((c) => c.tier === "judgment").length;
    expect(t).toMatch(new RegExp(`${judgment} des 106 critères du RGAA`));
  });
  it("states the citation rule and WHY it exists", () => {
    expect(t).toContain("normativeRef");
    expect(t).toMatch(/tests PROPRES|propres tests/i);
    expect(t).toContain("1.4.3");
  });
  it("points at the glossary lookup", () => {
    expect(t).toContain("--glossary");
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

// The composite action is gone (#165): no doc may still tell a reader to `uses:` it, since a
// pin would resolve to a release that no longer carries one — or to nothing at all.
describe("no doc still points at the removed action", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  for (const doc of ["README.md", "skills/ultra11y/references/ci.md", "site/audit.html", "site/installation.html"]) {
    it(`has no \`uses: SocialGouv/ultra11y@\` in ${doc}`, () => {
      expect(readFileSync(join(ROOT, doc), "utf8")).not.toMatch(/SocialGouv\/ultra11y@/);
    });
  }
});

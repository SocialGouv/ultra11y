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
    expect(t).toMatch(/title.{0,20}(IS|is) the key/i);
    expect(t).toContain("--lang");
  });

  it("carries the migration table off the removed flags", () => {
    expect(t).toContain("--gh-issues");
    expect(t).toContain("--grain single");
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
  it("teaches the rendered tier, its three rules and why it can be trusted", () => {
    expect(t).toContain("rendered-contrast");
    expect(t).toContain("rendered-link-colour-only");
    expect(t).toContain("10.6");
    expect(t).toMatch(/I don't know|I don’t know/i);
    expect(t).toMatch(/48 of 106/);
    expect(t).toContain("rendered-nontext-contrast");
    expect(t).toMatch(/could not look/i);
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
  it("documents the shipped action, its permissions and the gate-runs-last ordering", () => {
    expect(t).toContain("maxgfr/ultra11y@");
    // A moving branch would change under the reader with no version to blame.
    expect(t).not.toMatch(/maxgfr\/ultra11y@(main|master|HEAD)\b/);
    expect(t).toContain("security-events: write");
    expect(t).toMatch(/gate\*\* runs last|gate runs last/i);
    expect(t).toContain("fail-on");
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
  it("documents the sticky PR comment and its best-effort posture", () => {
    expect(t).toContain("ULTRA11Y_PR_COMMENT");
    expect(t).toMatch(/edits it in place|sticky/i);
    expect(t).toMatch(/best-effort/i);
  });
});

describe("judgment.md teaches adjudicating under a country standard", () => {
  const t = read("judgment.md");
  it("says the worklist is keyed by the standard's own criteria", () => {
    expect(t).toContain("--standard rgaa");
    expect(t).toMatch(/RGAA criteria/);
    expect(t).toMatch(/99 of/);
  });
  it("states the citation rule and WHY it exists", () => {
    expect(t).toContain("normativeRef");
    expect(t).toMatch(/own tests/i);
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

describe("devtools.md teaches the dev side-car", () => {
  const t = read("devtools.md");
  it("covers both commands and the one-line wiring", () => {
    expect(t).toMatch(/ultra11y\.mjs dev/);
    expect(t).toContain("--next");
    expect(t).toContain("Ultra11yOverlay");
    expect(t).toContain("127.0.0.1:4111");
  });
  it("states the two safety properties: self-detachment and the loopback bind", () => {
    expect(t).toMatch(/removes itself/i);
    expect(t).toContain("loopback");
    expect(t).toContain("0.0.0.0");
  });
  it("says what it does NOT decide, so a clean panel is not read as a pass", () => {
    expect(t).toMatch(/does not adjudicate|never "this page is accessible"/i);
  });
});

// Six hand-written `@v3` pins survived two majors, because nothing compared them to the
// version being shipped. A reader who copies one gets an action frozen two majors back and
// no error to explain it — the alias resolves, it is simply the wrong one. The generated
// workflow (src/init.ts) derives its pin from VERSION and never drifted; only prose did, so
// prose is what this gates.
describe("the documented action pin tracks the version being shipped", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const MAJOR = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version.split(".")[0];
  const DOCS = ["README.md", "skills/ultra11y/references/ci.md"];

  for (const doc of DOCS) {
    it(`pins only @v${MAJOR} in ${doc}`, () => {
      const text = readFileSync(join(ROOT, doc), "utf8");
      // Trailing punctuation belongs to the prose around the pin, not to the ref.
      const pins = [...text.matchAll(/maxgfr\/ultra11y@(\S+)/g)].map((m) => (m[1] ?? "").replace(/[.,`)]+$/, ""));
      expect(pins.length, `${doc} documents no action pin at all`).toBeGreaterThan(0);
      for (const pin of pins) {
        // An exact `vX.Y.Z` is fine too — `init --ci` writes one — as long as it is this major.
        expect(pin, `${doc} pins ${pin}, but this repo ships ${MAJOR}.x`).toMatch(new RegExp(`^v${MAJOR}(\\.\\d+\\.\\d+)?$`));
      }
    });
  }
});

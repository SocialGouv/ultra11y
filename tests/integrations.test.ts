import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RANK, THRESHOLD, failingFindings, formatFailure, buildPayload, slugify, gate, type FindingLike } from "../src/integrations/payload.js";
import { playwrightFixture, cypressPlugin, cypressCommands } from "../src/e2e.js";
import { COLLECT_SNAPSHOT } from "../src/collector.js";
import { slugifyPageId } from "../src/snapshot.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  exports: Record<string, unknown>;
  main: string;
  files: string[];
};

// The e2e integration ships TWICE: as published entry points (`ultra11y/playwright`,
// `ultra11y/cypress`) for a project that depends on ultra11y, and as install-free generated
// fixtures (`render --e2e`) for one that does not. Two shipping shapes, one behaviour — the
// tests below pin the shared tables and the packaging that makes both resolvable.

describe("severity gating", () => {
  const f = (severity: string, advisory?: boolean): FindingLike => ({
    ruleId: "r",
    criteriaId: "1.1.1",
    file: "a.html",
    line: 1,
    severity,
    message: "m",
    ...(advisory ? { advisory: true } : {}),
  });

  it("fails on findings at or above the threshold", () => {
    const result = { findings: [f("bloquant"), f("majeur"), f("mineur")] };
    expect(failingFindings(result, "blocking")).toHaveLength(1);
    expect(failingFindings(result, "major")).toHaveLength(2);
    expect(failingFindings(result, "minor")).toHaveLength(3);
  });

  it("never fails a test on a non-normative recommendation", () => {
    expect(failingFindings({ findings: [f("bloquant", true)] }, "blocking")).toEqual([]);
  });

  it("accepts the English option spelling and the engine's French tokens", () => {
    for (const k of ["blocking", "bloquant", "major", "majeur", "minor", "mineur"]) {
      expect(() => failingFindings({ findings: [] }, k)).not.toThrow();
    }
  });

  it("refuses an unknown threshold rather than silently gating on nothing", () => {
    expect(() => failingFindings({ findings: [f("bloquant")] }, "warn")).toThrow(/failOn must be/);
  });

  it("ignores a severity the engine never emits instead of treating it as blocking", () => {
    expect(failingFindings({ findings: [f("catastrophic")] }, "minor")).toEqual([]);
  });

  it("gate() records without failing when failOn is false", () => {
    expect(() => gate({ findings: [f("bloquant")] }, "Accueil", false)).not.toThrow();
    expect(() => gate({ findings: [f("bloquant")] }, "Accueil", undefined)).toThrow(/Accueil/);
  });

  it("names the source file rather than the snapshot in the failure message", () => {
    const msg = formatFailure("Contact", [{ ...f("bloquant"), origin: { sourceFile: "src/Form.tsx" } }]);
    expect(msg).toContain("src/Form.tsx");
    expect(msg).toContain(".ultra11y/pages/");
  });

  it("truncates a long failure list rather than printing hundreds of lines", () => {
    const msg = formatFailure(
      "X",
      Array.from({ length: 25 }, () => f("bloquant")),
    );
    expect(msg).toContain("… and 5 more.");
  });
});

describe("buildPayload", () => {
  const collected = { dom: "<html></html>", title: "Nous contacter", url: "https://exemple.fr/contact", viewport: { width: 1280, height: 900 } };

  it("derives the page id from the URL and the name from the document title", () => {
    const p = buildPayload(collected, "https://exemple.fr/contact", "playwright", {});
    expect(p.meta.id).toBe("contact");
    expect(p.meta.name).toBe("Nous contacter");
    expect(p.meta.runner).toBe("playwright");
  });

  it("lets the caller override both", () => {
    const p = buildPayload(collected, "https://exemple.fr/contact", "cypress", { as: "contact-fr", name: "Contact FR", auth: true, notes: "login" });
    expect(p.meta.id).toBe("contact-fr");
    expect(p.meta.name).toBe("Contact FR");
    expect(p.meta.auth).toBe(true);
    expect(p.meta.notes).toBe("login");
  });

  it("stamps ONE identity whatever the runner — a page recorded twice must not grow a phantom column", () => {
    const a = buildPayload(collected, "https://exemple.fr/contact", "playwright", {});
    const b = buildPayload(collected, "https://exemple.fr/contact", "cypress", {});
    expect(a.meta.id).toBe(b.meta.id);
    expect(a.meta.name).toBe(b.meta.name);
  });

  it("matches the engine's own slug rule, character for character", () => {
    // Four copies of this rule ship (engine, published plugin, two generated fixtures, dev
    // overlay). They disagreeing means one page recorded under two ids — two columns in the
    // grid for one page. Accented routes are the case that used to break: `new URL()`
    // percent-encodes, so `/Accès` slugified to `acc-c3-a8s`, the UTF-8 bytes spelled out.
    for (const url of [
      "https://exemple.fr/",
      "https://exemple.fr/nous-contacter",
      "https://exemple.fr/Accès",
      "https://exemple.fr/à-propos",
      "https://exemple.fr/Acc%C3%A8s",
      "https://exemple.fr/a%ZZb", // malformed escape: fold what we have, never throw
      "/Accès",
    ]) {
      expect(slugify(url), url).toBe(slugifyPageId(url));
    }
    expect(slugify("https://exemple.fr/")).toBe("accueil");
    expect(slugify("https://exemple.fr/Accès")).toBe("acces");
  });
});

describe("the generated fixtures cannot drift from the published plugins", () => {
  const pw = playwrightFixture("/abs/ultra11y.mjs");
  const cyPlugin = cypressPlugin("/abs/ultra11y.mjs");
  const cyCommands = cypressCommands();

  it("interpolates the severity tables instead of restating them", () => {
    // A fixture gating differently from the published plugin would fail two projects
    // differently while claiming to be the same tool.
    expect(pw).toContain(`const RANK = ${JSON.stringify(RANK)};`);
    expect(pw).toContain(`const THRESHOLD = ${JSON.stringify(THRESHOLD)};`);
    expect(cyPlugin).toContain(`const THRESHOLD = ${JSON.stringify(THRESHOLD)};`);
  });

  it("embeds the engine's own collector, never a copy of it", () => {
    expect(pw).toContain(JSON.stringify(COLLECT_SNAPSHOT));
    expect(cyCommands).toContain(JSON.stringify(COLLECT_SNAPSHOT));
  });

  it("gates identically to the published implementation on the same findings", () => {
    // Evaluate the fixture's own failingFindings and compare verdicts, rather than trusting
    // that two look-alike sources behave the same.
    const src = pw.slice(pw.indexOf("const RANK"), pw.indexOf("export function formatFailure"));
    const fixtureFailing = new Function(`${src.replace(/export /g, "")}; return failingFindings;`)() as typeof failingFindings;
    const findings: FindingLike[] = [
      { ruleId: "a", criteriaId: "1.1.1", file: "f", line: 1, severity: "bloquant", message: "m" },
      { ruleId: "b", criteriaId: "1.1.1", file: "f", line: 1, severity: "majeur", message: "m" },
      { ruleId: "c", criteriaId: "1.1.1", file: "f", line: 1, severity: "mineur", message: "m", advisory: true },
    ];
    for (const t of ["blocking", "major", "minor"]) {
      expect(fixtureFailing({ findings }, t).length).toBe(failingFindings({ findings }, t).length);
    }
  });
});

describe("packaging", () => {
  it("keeps `.` on the OpenCode plugin — an exports map without it breaks the plugin", () => {
    expect(pkg.exports["."]).toBe(`./${pkg.main}`);
    expect(existsSync(join(ROOT, pkg.main))).toBe(true);
  });

  it("declares every plugin subpath, with a default condition a bundler can resolve", () => {
    // Cypress bundles the support file with webpack, which asks for `default`; an
    // import-only entry fails with "Package path ./cypress is not exported".
    for (const sub of ["./playwright", "./cypress", "./cypress/plugin"]) {
      const e = pkg.exports[sub] as Record<string, string>;
      expect(e, sub).toBeTruthy();
      expect(e.default, sub).toBeTruthy();
      expect(e.import, sub).toBeTruthy();
      expect(e.types, sub).toBeTruthy();
    }
  });

  it("exposes the engine path the plugins resolve at run time", () => {
    expect(pkg.exports["./scripts/ultra11y.mjs"]).toBe("./scripts/ultra11y.mjs");
  });

  it("ships dist/ in the published tarball", () => {
    expect(pkg.files).toContain("dist");
  });

  it("has a built artefact behind every declared subpath", () => {
    for (const sub of ["./playwright", "./cypress", "./cypress/plugin"]) {
      const e = pkg.exports[sub] as Record<string, string>;
      for (const key of ["default", "types"]) expect(existsSync(join(ROOT, e[key]!)), `${sub} ${key}`).toBe(true);
    }
  });

  it("keeps the browser-side entry free of the engine — a support file must not ship the parser", () => {
    // `ultra11y/cypress` is bundled INTO THE BROWSER by the consumer's webpack/vite.
    // Importing the collector from snapshot.ts once pulled htmlparser2 and made this 600 KB.
    const bytes = readFileSync(join(ROOT, "dist/cypress.mjs")).byteLength;
    expect(bytes).toBeLessThan(64 * 1024);
    expect(readFileSync(join(ROOT, "dist/cypress.mjs"), "utf8")).not.toContain("node:child_process");
  });
});

describe("the two runners offer the same options", () => {
  // The ask was a plugin for Cypress AND Playwright that produces a report. An option that
  // exists on one runner and is silently ignored on the other is worse than one that is
  // missing: the test passes, the file never appears, and nobody looks.
  it("both declare `report`, and Cypress forwards it to the half that can write files", () => {
    const cy = readFileSync(join(ROOT, "src/integrations/cypress.ts"), "utf8");
    const cyPlugin = readFileSync(join(ROOT, "src/integrations/cypress-plugin.ts"), "utf8");
    const pw = readFileSync(join(ROOT, "src/integrations/playwright.ts"), "utf8");
    expect(pw).toContain("writePagesReport");
    expect(cy).toMatch(/report\?:/); // declared on the browser side…
    expect(cy).toContain("opts.report"); // …forwarded in the payload…
    expect(cyPlugin).toContain("writePagesReport"); // …and honoured by the Node side.
  });
});

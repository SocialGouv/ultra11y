// `ultra11y/vitest` and `ultra11y/jest` (#169): audit a component a unit test rendered, in the
// test's own state, with the test's own DOM (jsdom here) — no browser, no framework import.
// Each check is piped to the engine (`capture write`, the committed bundle) like the Playwright
// fixture pipes `snapshot write`, so these tests run the real engine end to end.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { checkA11y, toBeAccessible } from "../src/integrations/vitest.js";
import * as jestEntry from "../src/integrations/jest.js";
import { capturePayload, serializeRender } from "../src/integrations/unit.js";
import { parseCaptureProvenance } from "../src/capture.js";
import { runAudit } from "../src/audit.js";

// jsdom ships no type declarations and the repo deliberately has no @types/jsdom (see
// tests/probe-syntax.test.ts) — loaded untyped, its document used structurally.
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string) => { window: { document: any } } };

expect.extend({ toBeAccessible });

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ultra11y-unit-"));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const render = (html: string) => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`);
  const container = dom.window.document.createElement("div");
  container.innerHTML = html;
  dom.window.document.body.replaceChildren(container);
  return { container, document: dom.window.document };
};

const capture = (id: string) => join(root, ".ultra11y/captures", `${id}.html`);

describe("checkA11y on a jsdom render", () => {
  it("records the render as a component capture and audits it", async () => {
    const { container } = render('<button type="button" class="fr-btn fr-icon-close-line"></button>');
    await expect(checkA11y(container, { as: "close-button", root })).rejects.toThrow(/button-empty-name/);
    const file = capture("close-button");
    expect(existsSync(file)).toBe(true);
    const content = readFileSync(file, "utf8");
    expect(content).toContain('<div><button type="button" class="fr-btn fr-icon-close-line"></button></div>');
  });

  it("marks the capture honestly: who rendered it, and that no style or layout was measured", () => {
    const prov = parseCaptureProvenance(readFileSync(capture("close-button"), "utf8"));
    expect(prov).toMatchObject({ runner: "vitest", env: "jsdom", styles: "none" });
    // The test that ran it, repo-relative, and its title as the capture's name.
    expect(prov?.test).toBe("tests/unit-integration.test.ts");
    expect(prov?.name).toBe("checkA11y on a jsdom render > records the render as a component capture and audits it");
  });

  it("is audited as a component: page-scoped rules off, rendering criteria left to assess", () => {
    const r = runAudit({ inputs: [capture("close-button")], captureDir: join(root, ".ultra11y/captures") });
    expect(r.findings.map((f) => f.ruleId)).toEqual(["button-empty-name"]);
    expect(r.scope.captures?.files).toBe(1);
    // Nothing measured contrast: 1.4.3 is not decided conforming by this capture.
    expect(r.criteria.find((c) => c.id === "1.4.3")?.status).toBe("manual");
    expect(r.scope.scan?.testedScs ?? []).not.toContain("1.4.3");
  });

  it("gates on failOn: a major finding passes a blocking gate and fails a major one", async () => {
    const { container } = render('<input type="search" placeholder="Rechercher">');
    const r = await checkA11y(container, { as: "search-field", root });
    expect(r.findings?.some((f) => f.severity === "majeur")).toBe(true);
    await expect(checkA11y(container, { as: "search-field", root, failOn: "major" })).rejects.toThrow(/majeur.*placeholder-as-label/s);
  });

  it("records without failing when failOn is false", async () => {
    const { container } = render('<img src="/logo.svg">');
    const r = await checkA11y(container, { as: "logo", root, failOn: false });
    expect(r.findings?.some((f) => f.ruleId === "img-alt-missing")).toBe(true);
  });

  it("names a capture after its test", async () => {
    const { container } = render("<p>Bonjour</p>");
    await checkA11y(container, { root });
    await checkA11y(container, { root });
    const files = readdirSync(join(root, ".ultra11y/captures")).filter((f) => f.startsWith("unit-integration-"));
    // Test file stem + title, slugged; two checks in one test are two captures.
    expect(files.sort()).toEqual([
      "unit-integration-checka11y-on-a-jsdom-render-names-a-capture-after-its-test-2.html",
      "unit-integration-checka11y-on-a-jsdom-render-names-a-capture-after-its-test.html",
    ]);
  });

  it("keeps a long title a bounded file name, distinct from its siblings", () => {
    const long = "a very long describe chain that goes on and on > and a test title that also keeps going";
    const a = capturePayload("<p>a</p>", { root }, "vitest", { currentTestName: `${long} 1` }).meta.id;
    const b = capturePayload("<p>a</p>", { root }, "vitest", { currentTestName: `${long} 2` }).meta.id;
    expect(a.length).toBeLessThanOrEqual(80);
    expect(a).not.toBe(b);
  });

  it("fails with a message that names the rule, the severity and where the capture lives", async () => {
    const { container } = render('<a href="/"><img src="/logo.svg"></a>');
    const err = await checkA11y(container, { as: "brand", root }).catch((e: Error) => e);
    expect(String(err)).toMatch(/\[bloquant\] img-alt-missing/);
    expect(String(err)).toContain(".ultra11y/captures/");
  });
});

describe("toBeAccessible", () => {
  it("passes on an accessible render and fails on an inaccessible one", () => {
    expect(render('<button type="button">Enregistrer</button>').container).toBeAccessible({ as: "save-button", root });
    expect(() => expect(render("<button></button>").container).toBeAccessible({ as: "empty-button", root })).toThrow(/button-empty-name/);
    expect(render("<button></button>").container).not.toBeAccessible({ as: "empty-button", root });
  });
});

describe("what can be checked", () => {
  it("serializes an element, a fragment, a render result, a document's body and a string", () => {
    const { container, document } = render("<p>a</p>");
    expect(serializeRender(container)).toBe("<div><p>a</p></div>");
    expect(serializeRender({ container })).toBe("<div><p>a</p></div>");
    const frag = document.createDocumentFragment();
    frag.append(document.createElement("hr"), document.createTextNode("x < y"));
    expect(serializeRender(frag)).toBe("<hr>x &lt; y");
    // The test document's <html>/<head> are jsdom's empty shell, never the component's.
    expect(serializeRender(document)).toBe("<div><p>a</p></div>");
    expect(serializeRender("<p>raw</p>")).toBe("<p>raw</p>");
    expect(() => serializeRender(42 as never)).toThrow(/expects an Element/);
  });

  it("builds the payload the engine expects, without touching the disk", () => {
    const { container } = render("<p>a</p>");
    const p = capturePayload(container, { as: "x", source: "src/X.tsx" }, "jest", {
      testPath: join(process.cwd(), "src/X.test.tsx"),
      currentTestName: "X renders",
    });
    expect(p).toEqual({
      meta: { id: "x", name: "X renders", source: "src/X.tsx", test: "src/X.test.tsx", runner: "jest", env: "jsdom" },
      html: "<div><p>a</p></div>",
    });
  });
});

it("ultra11y/jest is the same implementation under its own runner name", () => {
  expect(typeof jestEntry.checkA11y).toBe("function");
  expect(typeof jestEntry.toBeAccessible).toBe("function");
  const { container } = render("<p>a</p>");
  expect(capturePayload(container, { as: "j" }, "jest", {}).meta.runner).toBe("jest");
});

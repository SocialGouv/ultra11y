import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { captureSetup, captureSetupPlan, detectTestRunner } from "../src/render.js";
import { parseCaptureProvenance } from "../src/capture.js";

describe("captureSetup — harvester content", () => {
  const src = captureSetup();
  it("is a zero-dep DOM harvester that guards afterEach and the DOM", () => {
    expect(src).toContain("ultra11y:capture");
    expect(src).toContain("globalThis.afterEach");
    expect(src).toContain("document.body.innerHTML");
    expect(src).toContain("ULTRA11Y_CAPTURES");
    expect(src).toContain("globals: true"); // documents the Vitest requirement
  });
});

describe("detectTestRunner", () => {
  it("detects vitest / jest by dep or config, and the DOM impl", () => {
    expect(detectTestRunner({ vitest: "1" }, () => false)).toEqual({ runner: "vitest", dom: null });
    expect(detectTestRunner({ jest: "1", jsdom: "1" }, () => false)).toEqual({ runner: "jest", dom: "jsdom" });
    expect(detectTestRunner({}, (f) => f === "vitest.config.ts")).toEqual({ runner: "vitest", dom: null });
    expect(detectTestRunner({ "happy-dom": "1" }, () => false).dom).toBe("happy-dom");
    expect(detectTestRunner({}, () => false).runner).toBeNull();
  });
});

describe("captureSetupPlan", () => {
  it("prints Jest setupFilesAfterEnv (not setupFiles) for a jest project", () => {
    const plan = captureSetupPlan({ runner: "jest", dom: "jsdom" }, ".ultra11y/capture-setup.mjs", "en");
    expect(plan).toContain("setupFilesAfterEnv");
    expect(plan).not.toContain("setupFiles:");
  });
  it("warns about globals for vitest and about a missing DOM impl", () => {
    const plan = captureSetupPlan({ runner: "vitest", dom: null }, ".ultra11y/capture-setup.mjs", "en");
    expect(plan).toContain("globals: true");
    expect(plan).toContain("No jsdom/happy-dom");
  });
});

describe("captureSetup — executed against a fake DOM", () => {
  it("serializes the rendered body to a provenance-tagged capture the parser round-trips", async () => {
    const dir = mkdtempSync(join(tmpdir(), "u11y-harv-"));
    const setupFile = join(dir, "capture-setup.mjs");
    writeFileSync(setupFile, captureSetup());
    const capDir = join(dir, "caps");

    // `any`: intentionally poking globals to drive the harvester.
    const g = globalThis as any;
    const saved = { afterEach: g.afterEach, document: g.document, expect: g.expect, env: process.env.ULTRA11Y_CAPTURES };
    let cb: (() => void) | undefined;
    g.afterEach = (fn: () => void) => {
      cb = fn;
    };
    g.document = { body: { innerHTML: '<button class="fr-btn"></button>' } };
    g.expect = { getState: () => ({ testPath: join(process.cwd(), "src/Button.test.tsx"), currentTestName: 'renders "add" -- button' }) };
    process.env.ULTRA11Y_CAPTURES = capDir;
    try {
      await import(pathToFileURL(setupFile).href);
      expect(typeof cb).toBe("function");
      cb?.();
      const files = readdirSync(capDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^Button__[a-z0-9]+\.html$/); // deterministic, component-keyed
      const html = readFileSync(join(capDir, files[0] as string), "utf8");
      expect(html).toContain('<button class="fr-btn"></button>');
      const prov = parseCaptureProvenance(html);
      expect(prov?.sourceFile).toBe("src/Button.tsx"); // .test.tsx → .tsx
      expect(prov?.component).toBe("Button");
      expect(prov?.name).toBe('renders "add" -- button'); // quote + -- escaping round-trips
      // deterministic filename + content dedup → a second identical run writes nothing new
      cb?.();
      expect(readdirSync(capDir)).toHaveLength(1);
      // captureAs override → next capture is attributed to the given component/source
      g.ultra11yCaptureAs("CustomBtn", "src/custom/Path.tsx");
      cb?.();
      const custom = readdirSync(capDir).find((x: string) => x.startsWith("CustomBtn__"));
      expect(custom, "expected a CustomBtn__* capture from captureAs").toBeTruthy();
      const chtml = readFileSync(join(capDir, custom as string), "utf8");
      expect(chtml).toContain('component="CustomBtn"');
      expect(chtml).toContain('source="src/custom/Path.tsx"');
    } finally {
      g.afterEach = saved.afterEach;
      g.document = saved.document;
      g.expect = saved.expect;
      if (saved.env === undefined) delete process.env.ULTRA11Y_CAPTURES;
      else process.env.ULTRA11Y_CAPTURES = saved.env;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

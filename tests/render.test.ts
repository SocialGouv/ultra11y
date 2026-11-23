import { describe, it, expect } from "vitest";
import { detectFrameworks, renderPlan } from "../src/render.js";

describe("detectFrameworks", () => {
  const noFiles = () => false;

  it("detects a framework from a dependency", () => {
    const d = detectFrameworks({ next: "14.0.0" }, noFiles);
    expect(d.frameworks.map((f) => f.name)).toContain("Next.js");
    expect(d.frameworks.find((f) => f.name === "Next.js")?.outDir).toBe("out");
  });

  it("detects a framework from a config file when the dep is absent", () => {
    const d = detectFrameworks({}, (f) => f === "vite.config.ts");
    expect(d.frameworks.map((f) => f.name)).toContain("Vite");
  });

  it("detects Storybook from a scoped dependency", () => {
    const d = detectFrameworks({ "@storybook/react": "8.0.0" }, noFiles);
    expect(d.frameworks.map((f) => f.name)).toContain("Storybook");
    expect(d.frameworks.find((f) => f.name === "Storybook")?.outDir).toBe("storybook-static");
  });

  it("flags known component libraries whose rendered output source-audit can't see", () => {
    const d = detectFrameworks({ vite: "5", "@codegouvfr/react-dsfr": "1.0.0" }, noFiles);
    expect(d.componentLibraries.some((l) => /DSFR/.test(l))).toBe(true);
  });
});

describe("renderPlan", () => {
  it("gives a build→audit recipe and flags component libraries", () => {
    const plan = renderPlan(
      detectFrameworks({ astro: "4", "@codegouvfr/react-dsfr": "1" }, () => false),
      "fr",
    );
    expect(plan).toContain("astro build");
    expect(plan).toContain('audit "dist/**/*.html"');
    expect(plan).toContain("🧩");
    expect(plan).toMatch(/scan/);
  });

  it("handles no detected framework", () => {
    expect(renderPlan({ frameworks: [], componentLibraries: [] }, "en")).toMatch(/No framework detected/);
  });
});

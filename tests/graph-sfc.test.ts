import { describe, it, expect } from "vitest";
import { buildGraphStreaming } from "../src/graph/build.js";
import { resolveUsage } from "../src/graph/graph.js";
import { computeCaptureCoverage } from "../src/capture.js";
import { discover } from "../src/discover.js";
import { GRAPH_ONLY_EXT, toPosix } from "../src/glob.js";
import { makeSpecResolver } from "../src/graph/engine-resolve.js";
import { runAudit } from "../src/audit.js";

const FIX = new URL("./fixtures/graph-sfc/", import.meta.url).pathname;

function graph() {
  return buildGraphStreaming(discover([FIX], { ext: GRAPH_ONLY_EXT }).files);
}

describe("graph — SFC (.vue/.svelte/.astro) synthesizes a self component def", () => {
  it("resolves a .tsx default import of a .vue SFC to a synthesized component def", () => {
    const g = graph();
    const consumerFile = [...g.nodes.keys()].find((f) => f.endsWith("Consumer.tsx"))!;
    const def = resolveUsage(g, consumerFile, "Widget");
    expect(def?.file.endsWith("Widget.vue")).toBe(true);
    expect(def?.name).toBe("Widget");
  });

  it("resolves the SFC's own <script> imports (Widget.vue imports ./helper)", () => {
    const g = graph();
    const widgetFile = [...g.nodes.keys()].find((f) => f.endsWith("Widget.vue"))!;
    const node = g.nodes.get(widgetFile)!;
    expect(node.imports.some((i) => i.local === "helper" && i.source === "./helper")).toBe(true);
  });

  it("reads BOTH <script> and <script setup> blocks (imports from either are seen)", () => {
    const g = graph();
    const widgetFile = [...g.nodes.keys()].find((f) => f.endsWith("Widget.vue"))!;
    const node = g.nodes.get(widgetFile)!;
    expect(node.imports.some((i) => i.local === "helper" && i.source === "./helper")).toBe(true); // <script>
    expect(node.imports.some((i) => i.local === "helper2" && i.source === "./helper2")).toBe(true); // <script setup>
  });

  it("puts the SFC in the capture-coverage universe (hasControl) so it shows as a blind spot without a capture", () => {
    const g = graph();
    const cov = computeCaptureCoverage(g, []);
    expect(cov.blindSpots.some((k) => k.endsWith("Widget.vue#Widget"))).toBe(true);
  });
});

// Vendored codeindex regression coverage (v2.10.0+): the engine's own candidate
// probe (JS_EXT_PROBES) resolves an EXTENSIONLESS specifier to a .vue/.svelte/.astro/
// .html/.htm target (see src/graph/engine-resolve.ts). The .vue case is pinned by
// tests/fixtures/golden-graph (extensionless import of Widget.vue). .svelte and .astro
// had NO fixture pinning it before this — ConsumerExt.tsx below closes that gap the
// same way, and ties into the same self-component-synthesis path the .vue tests above
// already exercise (opts.sfc in src/graph/imports.ts).
describe("graph — extensionless .svelte/.astro SFC resolution (engine candidate probe)", () => {
  it("resolves a .tsx EXTENSIONLESS default import of a .svelte SFC to a synthesized component def", () => {
    const g = graph();
    const consumerFile = [...g.nodes.keys()].find((f) => f.endsWith("ConsumerExt.tsx"))!;
    const def = resolveUsage(g, consumerFile, "Sprocket");
    expect(def?.file.endsWith("Sprocket.svelte")).toBe(true);
    expect(def?.name).toBe("Sprocket");
  });

  it("resolves a .tsx EXTENSIONLESS default import of an .astro SFC to a synthesized component def", () => {
    const g = graph();
    const consumerFile = [...g.nodes.keys()].find((f) => f.endsWith("ConsumerExt.tsx"))!;
    const def = resolveUsage(g, consumerFile, "Gadget");
    expect(def?.file.endsWith("Gadget.astro")).toBe(true);
    expect(def?.name).toBe("Gadget");
  });

  it("resolves the .svelte SFC's own <script> imports (Sprocket.svelte imports ./helper3)", () => {
    const g = graph();
    const f = [...g.nodes.keys()].find((k) => k.endsWith("Sprocket.svelte"))!;
    const node = g.nodes.get(f)!;
    expect(node.imports.some((i) => i.local === "helper3" && i.source === "./helper3")).toBe(true);
  });

  it("resolves the .astro SFC's own frontmatter imports (Gadget.astro imports ./helper4)", () => {
    const g = graph();
    const f = [...g.nodes.keys()].find((k) => k.endsWith("Gadget.astro"))!;
    const node = g.nodes.get(f)!;
    expect(node.imports.some((i) => i.local === "helper4" && i.source === "./helper4")).toBe(true);
  });
});

// .html never synthesizes a self component (detectKind only treats .vue/.svelte/.astro
// as "sfc" — see src/parse/source.ts and src/graph/build.ts), so it can't be pinned via
// resolveUsage like the SFC kinds above. What IS specifically claimed for .html (same
// engine-resolve.ts comment) is that the engine's candidate probe (JS_EXT_PROBES) also
// tries ".html"/".htm" for an extensionless specifier — pin that directly at the
// resolver level, over the same fixture directory.
describe("graph — engine resolveImport target-probing covers .html (extensionless import target)", () => {
  it("resolves an extensionless specifier from a .tsx importer to a .html target file", () => {
    const consumer = `${FIX}ConsumerExt.tsx`;
    const fragment = `${FIX}Fragment.html`;
    const known = new Set([toPosix(consumer), toPosix(fragment)]);
    const resolve = makeSpecResolver(known);
    expect(resolve(consumer, "./Fragment")).toBe(toPosix(fragment));
  });
});

// "extraction non vide": each fixture also carries at least one element ultra11y's own
// rule engine actually audits (not just graph plumbing) — a direct (non-graph) audit run
// over each file alone must produce a real finding.
describe("audit — .svelte/.astro/.html fixtures are real audit targets (non-empty extraction)", () => {
  it(".svelte icon-only button is flagged (icon-only-control-unnamed) on a direct audit", () => {
    const findings = runAudit({ inputs: [`${FIX}Sprocket.svelte`] }).findings;
    expect(findings.some((f) => f.ruleId === "icon-only-control-unnamed")).toBe(true);
  });

  it(".astro <img> without alt is flagged (img-alt-missing) on a direct audit", () => {
    const findings = runAudit({ inputs: [`${FIX}Gadget.astro`] }).findings;
    expect(findings.some((f) => f.ruleId === "img-alt-missing")).toBe(true);
  });

  it(".html <img> without alt is flagged (img-alt-missing) on a direct audit", () => {
    const findings = runAudit({ inputs: [`${FIX}Fragment.html`] }).findings;
    expect(findings.some((f) => f.ruleId === "img-alt-missing")).toBe(true);
  });
});

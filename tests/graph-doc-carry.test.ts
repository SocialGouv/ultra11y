// The graph pass hands its already-parsed markup Docs to the audit loop so `--graph`
// stops reading and parsing every markup file a SECOND time. These tests pin the
// contract that makes that hand-off safe:
//   1. a carried Doc is byte-for-byte what `parseSource` would have produced;
//   2. plain .ts/.js modules are never carried (they have no markup to audit);
//   3. the carry is budgeted, so a huge repo cannot blow the streaming design's
//      bounded-memory promise, and the graph is identical once the budget is spent.
// (`--graph`'s own output is pinned byte-for-byte by tests/golden-graph.test.ts.)
import { describe, it, expect } from "vitest";
import { buildGraphAndDocs } from "../src/graph/build.js";
import { parseSource } from "../src/parse/source.js";
import { discover } from "../src/discover.js";
import { GRAPH_ONLY_EXT } from "../src/glob.js";
import { runAudit } from "../src/audit.js";
import { readFileSync } from "node:fs";

const FIX = new URL("./fixtures/cross-file/", import.meta.url).pathname;
const files = () => discover([FIX], { ext: GRAPH_ONLY_EXT }).files;

describe("graph — parsed-Doc hand-off to the audit loop", () => {
  it("carries the markup Docs and none of the plain .ts/.js modules", () => {
    const { docs } = buildGraphAndDocs(files(), { carryDocs: true });
    expect(docs.size).toBeGreaterThan(0);
    for (const file of docs.keys()) expect(file, "a plain module has no markup to audit").not.toMatch(/\.(ts|js|mjs|cjs)$/);
  });

  it("carries nothing when the caller does not ask for it", () => {
    expect(buildGraphAndDocs(files()).docs.size).toBe(0);
  });

  it("a carried Doc equals the one parseSource would build (same elements, same lines)", () => {
    const { docs } = buildGraphAndDocs(files(), { carryDocs: true });
    for (const [file, carried] of docs) {
      const fresh = parseSource(readFileSync(file, "utf8"), file);
      expect(carried.kind, file).toBe(fresh.kind);
      expect(carried.lossy, file).toBe(fresh.lossy);
      expect(carried.source, file).toBe(fresh.source);
      expect(
        carried.elements.map((e) => `${e.tag}@${e.line}`),
        file,
      ).toEqual(fresh.elements.map((e) => `${e.tag}@${e.line}`));
      expect([...carried.byId.keys()].sort(), file).toEqual([...fresh.byId.keys()].sort());
    }
  });

  it("stops carrying once the budget is spent, and the graph is unaffected", () => {
    const list = files();
    const full = buildGraphAndDocs(list, { carryDocs: true });
    const starved = buildGraphAndDocs(list, { carryDocs: true, carryBudget: { bytes: 0, elements: 0 } });
    expect(starved.docs.size, "a spent budget must carry nothing").toBe(0);
    // The hand-off is an optimisation: the graph itself must not depend on it.
    expect([...starved.graph.nodes.keys()].sort()).toEqual([...full.graph.nodes.keys()].sort());
  });

  // The audit path is what actually consumes the hand-off; `--graph`'s own output is
  // pinned byte-for-byte by tests/golden-graph.test.ts, so here we only assert the
  // audit still runs end to end and attributes findings to the carried files.
  it("audit --graph reports findings against the carried files", () => {
    const r = runAudit({ inputs: [FIX], graph: true });
    expect(r.findings.length).toBeGreaterThan(0);
    for (const f of r.findings) expect(f.file.startsWith(FIX) || f.file === "<stdin>").toBe(true);
  });
});

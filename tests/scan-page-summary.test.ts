// `scan --merge --json` prints the merged document with a top-level `pages` summary — which
// snapshot ids the run recorded and which pages it refused, with why. Before, that accounting
// lived only on stderr (the refusal warnings) and in the `.ultra11y/pages` mtimes, so an
// orchestrator reporting the rendered layer (« N pages capturées, M refusées ») had to
// re-derive it. Mocks the Docker tier so the real CLI merge path runs without a browser
// (same shape as tests/scan-merge-lang.test.ts).
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanPageSummary } from "../src/scan.js";
import type { DynamicResult } from "../src/types.js";

const FIX = new URL("./fixtures/", import.meta.url).pathname;

const dynamicResult: DynamicResult = {
  tool: "ultra11y",
  engine: "axe-core@playwright (docker)",
  target: "https://exemple.fr",
  date: "2026-07-06",
  findings: [],
  snapshots: ["accueil", "contact"],
  redirected: [{ id: "compte", name: "Mon compte", requested: "https://exemple.fr/compte", landed: "https://exemple.fr/connexion", reason: "redirect" }],
};

vi.mock("../src/scan.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/scan.js")>();
  return {
    ...actual,
    dockerAvailable: () => true,
    runScan: () => dynamicResult,
  };
});

const { main } = await import("../src/cli.js");

describe("scanPageSummary — the recorded/refused accounting of one scan", () => {
  it("lists the recorded snapshot ids and the refused pages with their reason", () => {
    expect(scanPageSummary(dynamicResult)).toEqual({
      recorded: ["accueil", "contact"],
      refused: [{ id: "compte", reason: "redirect" }],
    });
  });

  it("carries the declared sample's size on a --sample run, and drops the field otherwise", () => {
    expect(scanPageSummary(dynamicResult, 3)).toEqual({
      sample: 3,
      recorded: ["accueil", "contact"],
      refused: [{ id: "compte", reason: "redirect" }],
    });
    expect(scanPageSummary(dynamicResult)).not.toHaveProperty("sample");
  });

  it("a scan with no snapshots and no refusals records and refuses nothing", () => {
    const empty: DynamicResult = { tool: "ultra11y", engine: "axe-core@playwright (docker)", target: "https://exemple.fr", date: "2026-07-06", findings: [] };
    expect(scanPageSummary(empty)).toEqual({ recorded: [], refused: [] });
    expect(scanPageSummary(empty)).not.toHaveProperty("sample");
  });
});

describe("scan --merge --json — the printed document opens with the pages summary", () => {
  it("stdout carries `pages` beside the intact audit document; the --out file stays schema-pure", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "u11y-scan-page-summary-"));
    try {
      await main(["audit", `${FIX}conforming/good.html`, "--out", tmp, "--json"]); // static base to merge into
      const auditPath = join(tmp, "audit-latest.json");
      const err = vi.spyOn(console, "error").mockImplementation(() => {}); // the refusal warnings
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      let code: number;
      let printed: { pages: unknown; tool: string; findings: unknown[] };
      try {
        code = await main(["scan", "https://exemple.fr", "--runtime", "docker", "--merge", auditPath, "--out", tmp, "--json"]);
        printed = JSON.parse(log.mock.calls[0]![0] as string);
      } finally {
        log.mockRestore();
        err.mockRestore();
      }
      expect(code).toBe(0);
      // The summary, exactly the shape the rendered layer is reported from.
      expect(printed.pages).toEqual({ recorded: ["accueil", "contact"], refused: [{ id: "compte", reason: "redirect" }] });
      // The document itself is still at the top level — pipe stdout into report/verify as before.
      expect(printed.tool).toBe("ultra11y");
      expect(Array.isArray(printed.findings)).toBe(true);
      // The summary is a print-side envelope: the file keeps the plain audit schema.
      expect("pages" in JSON.parse(readFileSync(join(tmp, "audit-latest.json"), "utf8"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, parseArgs, scanSnapshotRoot } from "../src/cli.js";
import { runScanLocal } from "../src/scan-local.js";
import type { DynamicResult } from "../src/types.js";

// `scan` used to hardcode its snapshot root to process.cwd(): an orchestrator running from
// the audited checkout got `.ultra11y/pages/` written INTO it — the one intermediate of a
// run nothing could move, since `--out` took the reports and `--cwd` only said where
// Playwright resolves from. `snapshot write`, `dev` and `pages discover --from-snapshots`
// all take `--root`; scan now honours it too. These tests pin the resolution WITHOUT a
// browser: the runtime is mocked at the runScanLocal seam, exactly where cmdScan hands the
// root over.

vi.mock("../src/scan-local.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/scan-local.js")>()),
  runScanLocal: vi.fn(),
}));

const dynamic = (): DynamicResult =>
  ({ tool: "ultra11y", engine: "axe-core@playwright (local)", target: "https://exemple.fr/", date: "2026-01-01", findings: [] }) as DynamicResult;

const capture = () => {
  const out: string[] = [];
  const err: string[] = [];
  const lo = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  const le = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
  return {
    out,
    err,
    restore: () => {
      lo.mockRestore();
      le.mockRestore();
    },
  };
};

const tmp = (): string => mkdtempSync(join(tmpdir(), "ultra11y-scan-root-"));

describe("scanSnapshotRoot", () => {
  it("resolves --root: the project root that holds .ultra11y/pages", () => {
    expect(scanSnapshotRoot(parseArgs(["scan", "https://exemple.fr/", "--root", "/srv/orchestrator"]).flags)).toBe("/srv/orchestrator");
  });

  it("defaults to the working directory — the historical behaviour", () => {
    expect(scanSnapshotRoot(parseArgs(["scan", "https://exemple.fr/"]).flags)).toBe(process.cwd());
  });

  it("resolves a relative --root against the working directory", () => {
    expect(scanSnapshotRoot(parseArgs(["scan", "https://exemple.fr/", "--root", "runs/r1"]).flags)).toBe(join(process.cwd(), "runs/r1"));
  });

  it("is undefined under --no-snapshot, --root or not", () => {
    expect(scanSnapshotRoot(parseArgs(["scan", "https://exemple.fr/", "--no-snapshot"]).flags)).toBeUndefined();
    expect(scanSnapshotRoot(parseArgs(["scan", "https://exemple.fr/", "--no-snapshot", "--root", "/srv/x"]).flags)).toBeUndefined();
  });
});

describe("scan --root wiring", () => {
  beforeEach(() => vi.mocked(runScanLocal).mockClear());
  afterEach(() => vi.restoreAllMocks());

  it("hands --root to the runtime as snapshotRoot, --cwd keeping its meaning", async () => {
    const pagesRoot = tmp();
    const playwrightHome = tmp();
    vi.mocked(runScanLocal).mockResolvedValue(dynamic());
    const c = capture();
    const code = await main(["scan", "https://exemple.fr/", "--runtime", "local", "--cwd", playwrightHome, "--root", pagesRoot]);
    c.restore();
    expect(code).toBe(0);
    expect(runScanLocal).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runScanLocal).mock.calls[0]![0]).toMatchObject({ cwd: playwrightHome, snapshotRoot: pagesRoot });
  });

  it("without --root, snapshots still land under the working directory", async () => {
    vi.mocked(runScanLocal).mockResolvedValue(dynamic());
    const c = capture();
    const code = await main(["scan", "https://exemple.fr/", "--runtime", "local", "--cwd", tmp()]);
    c.restore();
    expect(code).toBe(0);
    expect(vi.mocked(runScanLocal).mock.calls[0]![0]).toMatchObject({ snapshotRoot: process.cwd() });
  });
});

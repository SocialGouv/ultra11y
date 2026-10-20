// A RENDERED FINDING'S `file` IS THE PAGE URL, NOT A PATH IN THE TREE.
//
// Measured on a dogfood audit run with the rendered layer on (`scan --sample --merge`): the
// nine "cited file not found: http://…" grounding issues were the engine's own rendered
// findings, ruled `supported` by the trial. `groundFinding` skipped only `-` / `stdin`, so it
// resolved the URL against the cwd as a relative path and reported it missing — every trial
// of a rendered audit failed its own findings as soon as one was `supported`.
import { describe, it, expect, vi, afterEach } from "vitest";
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.js";
import { groundFinding, groundItems } from "../src/grounding.js";

const URL_FILE = "http://127.0.0.1:4899/studio/whats-next";

afterEach(() => vi.restoreAllMocks());

describe("groundFinding — a URL `file` is unresolvable, not a missing path", () => {
  it("grounds a finding whose file is the page URL", () => {
    const r = groundFinding({ file: URL_FILE, line: 3, selector: "img" });
    expect(r.ok).toBe(true);
    expect(r.issue).toBeUndefined();
  });

  it("grounds any scheme, not only http(s)", () => {
    expect(groundFinding({ file: "https://example.fr/page", line: 0, snippet: "<p>x</p>" }).ok).toBe(true);
  });

  it("still fails a Windows drive path — the `://` keeps it out of the URL rule", () => {
    const r = groundFinding({ file: "C:\\no\\such\\page.html", line: 1, snippet: "<p>x</p>" });
    expect(r.ok).toBe(false);
    expect(r.issue).toContain("cited file not found");
  });

  it("counts URL-cited findings as grounded in the summary, never failed", () => {
    const s = groundItems([{ file: URL_FILE, line: 3, selector: "img" }]);
    expect(s.grounded).toBe(1);
    expect(s.failed).toBe(0);
    expect(s.issues).toEqual([]);
  });
});

describe("verify --apply --prune — a trial of a rendered audit accepts its own findings", () => {
  const dir = mkdtempSync(join(tmpdir(), "u11y-url-ground-"));
  const page = join(dir, "page.html");
  writeFileSync(page, '<!doctype html><html lang="en"><body><main><h1>Studio</h1></main></body></html>');
  // The draft report's NC cites the SERVED PAGE, as a rendered finding does when no
  // `.ultra11y/pages` capture mapped it back to source.
  const report = join(dir, "report.md");
  writeFileSync(
    report,
    `# Report\n- **Rate** : 10%\n## 1. s\n## 2. NC\n- **1.1.1 — Non-text Content** — \`${URL_FILE}:3\` (\`img\`)\n  - image without a text alternative\n## 3. x\n## 4. NA\n## 5. manual\n`,
  );

  it("grounds the retained claim and exits 0", async () => {
    const a = await run(["audit", page, "--out", dir, "--json"]);
    expect(a.code).toBe(0);
    const g = await run(["verify", "--report", report, "--out", dir, "--max-verify", "0"]);
    expect(g.code).toBe(0);
    const todo = JSON.parse(readFileSync(join(dir, "VERIFY.todo.json"), "utf8")) as { verdict: string | null }[];
    expect(todo.length).toBeGreaterThan(0);
    for (const it of todo) it.verdict = "supported";
    const filled = join(dir, "VERIFY.filled.json");
    writeFileSync(filled, JSON.stringify(todo));

    const r = await run(["verify", "--apply", filled, "--report", report, "--in", join(dir, "audit-latest.json"), "--out", dir, "--prune", "--json"]);
    expect(r.err).not.toContain("cited file not found");
    const parsed = JSON.parse(r.out) as { ok: boolean; grounding: { failed: number; grounded: number; issues: string[] } };
    expect(parsed.grounding.issues).toEqual([]);
    expect(parsed.grounding.failed).toBe(0);
    expect(parsed.grounding.grounded).toBeGreaterThan(0);
    expect(parsed.ok).toBe(true);
    expect(r.code).toBe(0);
  });

  async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
    const out: string[] = [];
    const err: string[] = [];
    const lo = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
    const le = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
    const code = await main(argv);
    lo.mockRestore();
    le.mockRestore();
    return { code, out: out.join("\n"), err: err.join("\n") };
  }
});

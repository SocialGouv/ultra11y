// The pull request's rendered gate: `scan --since <ref> --base-url <preview> --baseline <scan.json>`
// renders only the pages the diff reaches, and fails only on non-conformities the baseline does
// not hold. The browser is mocked out — what is under test is the selection and the decision,
// neither of which involves a browser or a model.
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DynamicFinding, DynamicResult, ScanRedirect } from "../src/types.js";
import { dynamicFindingId, newDynamicFindings, newUnrendered } from "../src/baseline.js";

const rendered: string[][] = [];
let page: (url: string) => DynamicFinding[] = () => [];
// A URL the mocked browser cannot render, the way runScanManyLocal records it: refused, not scanned.
let broken: (url: string) => ScanRedirect | undefined = () => undefined;

vi.mock("../src/scan-local.js", async (orig) => ({
  ...(await orig<typeof import("../src/scan-local.js")>()),
  runScanManyLocal: vi.fn(async (urls: string[]): Promise<DynamicResult> => {
    rendered.push(urls);
    const redirected = urls.flatMap((u) => broken(u) ?? []);
    const ok = urls.filter((u) => !broken(u));
    return {
      tool: "ultra11y",
      engine: "mock",
      target: `${urls.length} page(s)`,
      date: "2026-01-01",
      findings: ok.flatMap(page),
      ...(ok.length ? { scanned: ok } : {}),
      ...(redirected.length ? { redirected } : {}),
    };
  }),
}));
const http500 = (url: string): ScanRedirect => ({ id: "x", name: url, requested: url, landed: url, reason: "http-status", status: 500 });

const { main } = await import("../src/cli.js");

const ROOT = new URL("./fixtures/affected-app/", import.meta.url).pathname.replace(/\/$/, "");

const F = (over: Partial<DynamicFinding>): DynamicFinding => ({
  criteriaId: "1.4.3",
  axeRule: "color-contrast",
  impact: "serious",
  severity: "majeur",
  message: "contrast too low",
  selector: ".btn",
  snippet: "<button>",
  engine: "axe",
  ...over,
});

describe("rendered finding identity", () => {
  it("is host-free: the base deployment and the preview agree on the same finding", () => {
    expect(dynamicFindingId(F({ page: "https://prod.example.fr/contact" }))).toBe(dynamicFindingId(F({ page: "http://localhost:3000/contact/" })));
  });

  it("ignores the message and the snippet, which the change may edit", () => {
    expect(dynamicFindingId(F({ message: "a", snippet: "<b>" }))).toBe(dynamicFindingId(F({ message: "b", snippet: "<i>" })));
  });

  it("tells pages, rules and elements apart", () => {
    const base = dynamicFindingId(F({ page: "https://x/a" }));
    expect(dynamicFindingId(F({ page: "https://x/b" }))).not.toBe(base);
    expect(dynamicFindingId(F({ page: "https://x/a", selector: "#y" }))).not.toBe(base);
    expect(dynamicFindingId(F({ page: "https://x/a", axeRule: "link-name" }))).not.toBe(base);
  });
});

describe("newDynamicFindings", () => {
  const run = (findings: DynamicFinding[]): DynamicResult => ({ tool: "ultra11y", engine: "e", target: "t", date: "d", findings });

  it("keeps only what the baseline does not hold", () => {
    const old = F({ page: "https://prod/a" });
    const fresh = F({ page: "https://pr/a", selector: "#new" });
    expect(newDynamicFindings(run([F({ page: "https://pr/a" }), fresh]), run([old]))).toEqual([fresh]);
  });

  it("a page the baseline never rendered is new, all of it", () => {
    const onNewPage = F({ page: "https://pr/nouvelle-page" });
    expect(newDynamicFindings(run([onNewPage]), run([F({ page: "https://prod/a" })]))).toEqual([onNewPage]);
  });

  it("an advisory (best-practice) finding never blocks", () => {
    expect(newDynamicFindings(run([F({ page: "https://pr/a", advisory: true })]), run([]))).toEqual([]);
  });
});

describe("newUnrendered", () => {
  it("keeps the refused pages whose path the baseline did not already refuse, across hosts", () => {
    const pr = http500("https://pr/contact");
    expect(newUnrendered({ redirected: [pr, http500("https://pr/aide")] }, { redirected: [http500("https://prod/aide/")] })).toEqual([pr]);
    expect(newUnrendered({ redirected: [pr] }, {})).toEqual([pr]);
    expect(newUnrendered({}, { redirected: [pr] })).toEqual([]);
  });
});

describe("scan --since --base-url --baseline", () => {
  let dir: string;
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  async function scan(extra: string[]): Promise<{ code: number; out: string; err: string }> {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
    const code = await main([
      "scan",
      "--since",
      "main",
      "--base-url",
      "https://pr-7.preview.example",
      "--root",
      dir,
      "--no-snapshot",
      "--no-pdf",
      "--lang",
      "fr",
      ...extra,
    ]);
    vi.restoreAllMocks();
    return { code, out: out.join("\n"), err: err.join("\n") };
  }
  const baseline = (findings: DynamicFinding[], redirected?: ScanRedirect[]): string => {
    const file = join(dir, "baseline.json");
    writeFileSync(file, JSON.stringify({ tool: "ultra11y", engine: "e", target: "2 page(s)", date: "d", findings, ...(redirected ? { redirected } : {}) }));
    return file;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "u11y-gate-"));
    cpSync(ROOT, dir, { recursive: true });
    git("init", "-q", "-b", "main");
    // A throwaway repository under the OS temp dir: no identity or signing key is assumed.
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    git("checkout", "-q", "-b", "feature");
    appendFileSync(join(dir, "src/components/Button.tsx"), "// restyled\n");
    git("commit", "-q", "-am", "restyle the button");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  afterEach(() => {
    rendered.length = 0;
    page = () => [];
    broken = () => undefined;
  });

  // R2278fa: a reached page that cannot be rendered measured nothing, so it cannot pass.
  it("a reached page the PR breaks (HTTP 500) blocks, even when every other page is clean", async () => {
    broken = (url) => (url.endsWith("/contact") ? http500(url) : undefined);
    const r = await scan(["--baseline", baseline([])]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("1 page(s) touchée(s) non rendue(s)");
    expect(r.out).toContain("[non mesurée] https://pr-7.preview.example/contact — HTTP 500");
  });

  it("a page redirected elsewhere (a login wall) blocks too, and --json lists it as not measured", async () => {
    broken = (url) =>
      url.endsWith("/contact") ? { id: "contact", name: url, requested: url, landed: "https://pr-7.preview.example/login", reason: "redirect" } : undefined;
    const r = await scan(["--baseline", baseline([]), "--json"]);
    expect(r.code).toBe(1);
    const doc = JSON.parse(r.out) as { gate: { new: unknown[]; notMeasured: { url: string; reason: string; landed?: string }[]; knownNotMeasured: number } };
    expect(doc.gate.new).toEqual([]);
    expect(doc.gate.notMeasured).toEqual([{ url: "https://pr-7.preview.example/contact", reason: "redirect", landed: "https://pr-7.preview.example/login" }]);
    expect(doc.gate.knownNotMeasured).toBe(0);
  });

  it("a page that was already unrenderable in the baseline is pre-existing, and does not block", async () => {
    broken = (url) => (url.endsWith("/contact") ? http500(url) : undefined);
    const r = await scan(["--baseline", baseline([], [http500("https://prod.example.fr/contact")])]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("non mesurée");
  });

  it("every reached page unrenderable, all already so in the baseline, still fails: nothing was measured", async () => {
    broken = (url) => http500(url);
    const r = await scan(["--baseline", baseline([], [http500("https://prod.example.fr/"), http500("https://prod.example.fr/contact")])]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("rien n'a été mesuré");
  });

  it("renders only the pages the diff reaches, on the preview", async () => {
    const r = await scan([]);
    expect(r.code).toBe(0);
    expect(rendered).toEqual([["https://pr-7.preview.example/", "https://pr-7.preview.example/contact"]]);
    expect(r.err).toContain("2 page(s) touchée(s)");
  });

  it("a non-conformity the baseline already holds does not block", async () => {
    page = (url) => (url.endsWith("/contact") ? [F({ page: url })] : []);
    const r = await scan(["--baseline", baseline([F({ page: "https://prod.example.fr/contact" })])]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("0 nouvelle(s) non-conformité(s), 1 déjà présente(s)");
  });

  it("only a NEW non-conformity blocks, and it is the only one named", async () => {
    page = (url) =>
      url.endsWith("/contact") ? [F({ page: url }), F({ page: url, selector: "#email", axeRule: "label", criteriaId: "4.1.2", message: "no label" })] : [];
    const r = await scan(["--baseline", baseline([F({ page: "https://prod.example.fr/contact" })])]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("1 nouvelle(s) non-conformité(s), 1 déjà présente(s)");
    expect(r.out).toContain("#email — no label");
    expect(r.out).not.toContain(".btn");
  });

  it("--fail-on narrows the gate to the new findings at or above the severity", async () => {
    page = (url) => (url.endsWith("/contact") ? [F({ page: url, selector: "#new", severity: "majeur" })] : []);
    expect((await scan(["--baseline", baseline([]), "--fail-on", "blocking"])).code).toBe(0);
    expect((await scan(["--baseline", baseline([]), "--fail-on", "major"])).code).toBe(1);
  });

  it("--json carries the gate beside the scan result", async () => {
    page = (url) => (url.endsWith("/") ? [F({ page: url, selector: "#hero" })] : []);
    const r = await scan(["--baseline", baseline([]), "--json"]);
    expect(r.code).toBe(1);
    const doc = JSON.parse(r.out) as DynamicResult & { gate: { new: DynamicFinding[]; known: number } };
    expect(doc.gate.new.map((f) => f.selector)).toEqual(["#hero"]);
    expect(doc.gate.known).toBe(0);
  });

  it("a baseline that is not a scan result is refused, before anything is rendered", async () => {
    const file = join(dir, "not-a-scan.json");
    writeFileSync(file, JSON.stringify({ findings: [{ ruleId: "x" }] }));
    const r = await scan(["--baseline", file]);
    expect(r.code).toBe(2);
    expect(rendered).toEqual([]);
  });

  it("--since without --base-url is refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await main(["scan", "--since", "main", "--root", dir]);
    vi.restoreAllMocks();
    expect(code).toBe(2);
  });
});

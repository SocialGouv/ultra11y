// `ultra11y tickets` end to end through main(), against a temp audit.json. The provider
// layer is stubbed at the network boundary, so nothing here can reach a real tracker.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.js";
import type { AuditResult, CriterionResult, Finding } from "../src/types.js";

const F = (over: Partial<Finding> = {}): Finding => ({
  ruleId: "img-alt-missing",
  criteriaId: "1.1.1",
  file: "src/a.html",
  line: 1,
  col: 1,
  selectorHint: "img",
  severity: "bloquant",
  message: "image sans alternative",
  remediation: "Ajoutez un alt",
  snippet: "",
  ...over,
});

const C = (id: string, status: CriterionResult["status"], findings: Finding[] = []): CriterionResult => ({
  id,
  guideline: id.split(".").slice(0, 2).join("."),
  status,
  findings,
});

function auditFile(dir: string, over: Partial<AuditResult> = {}): string {
  const r = {
    tool: "ultra11y",
    standard: "wcag",
    version: "3.0.0",
    schemaVersion: 2,
    date: "2026-08-12",
    scope: { inputs: ["."], files: 1 },
    criteria: [C("1.1.1", "NC", [F()])],
    guidelines: [],
    findings: [F()],
    residualRisks: [],
    conformancePct: 50,
    ...over,
  };
  const p = join(dir, "audit.json");
  writeFileSync(p, JSON.stringify(r));
  return p;
}

let dir: string;
let out: string[];
let err: string[];
const ENV = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "u11y-tickets-"));
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((m?: unknown) => void out.push(String(m)));
  vi.spyOn(console, "error").mockImplementation((m?: unknown) => void err.push(String(m)));
  process.env.ULTRA11Y_TICKET_PROVIDER = "github";
  process.env.GITHUB_TOKEN = "t";
  process.env.GITHUB_REPOSITORY = "acme/app";
  // NO SUBPROCESS, NO NETWORK — and this is not a nicety. `auto` transport resolution probes
  // the REAL `gh` binary (`gh auth status`, which calls github.com) BEFORE it looks at the
  // token, so which transport these tests exercise was decided by whatever `gh` the machine
  // happened to have. Unauthenticated here → REST → green; authenticated on a GitHub-hosted
  // runner → the CLI transport, `fetch` stubbed for nothing, and three tests red for a whole
  // release while passing on every developer's laptop. An empty PATH turns the probe into an
  // immediate ENOENT: the same answer on every machine, and one fewer round trip per test.
  // Auto-resolution itself is tested where it is injectable — tests/tickets-github.test.ts
  // drives `cliAvailable` directly, which is the only honest way to assert a probe's outcome.
  process.env.PATH = join(dir, "no-such-bin");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.env = { ...ENV };
});

/** Stub global fetch so a "real" push in these tests still touches nothing. */
function stubFetch(responses: Array<{ ok?: boolean; status?: number; body?: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = responses.shift() ?? { ok: true, body: [] };
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      headers: new Headers(),
      text: async () => JSON.stringify(r.body ?? {}),
    } as unknown as Response;
  });
  return calls;
}

describe("usage errors exit 2", () => {
  it("requires --in", async () => {
    expect(await main(["tickets"])).toBe(2);
    expect(err.join()).toContain("--in <audit.json> is required");
  });

  it("rejects input that is not an AuditResult", async () => {
    const p = join(dir, "x.json");
    writeFileSync(p, JSON.stringify({ hello: "world" }));
    expect(await main(["tickets", "--in", p])).toBe(2);
  });

  it("rejects an unknown grain by name", async () => {
    expect(await main(["tickets", "--in", auditFile(dir), "--grain", "nope"])).toBe(2);
    expect(err.join()).toContain("--grain must be one of");
  });

  it("rejects an unknown provider by name", async () => {
    expect(await main(["tickets", "--in", auditFile(dir), "--provider", "trello"])).toBe(2);
  });

  it("refuses Jira over the CLI transport instead of silently using REST", async () => {
    process.env.ULTRA11Y_JIRA_URL = "https://x.atlassian.net";
    process.env.ULTRA11Y_JIRA_PROJECT = "A";
    process.env.JIRA_TOKEN = "t";
    expect(await main(["tickets", "--in", auditFile(dir), "--provider", "jira", "--transport", "cli"])).toBe(1);
    expect(err.join()).toContain("no CLI transport");
  });

  it("refuses a credential committed in .ultra11yrc.json", async () => {
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      writeFileSync(join(dir, ".ultra11yrc.json"), JSON.stringify({ tickets: { provider: "github", token: "leaked" } }));
      expect(await main(["tickets", "--in", auditFile(dir)])).toBe(2);
      expect(err.join()).toContain("credentials belong in the environment");
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("the --max-tickets guard", () => {
  it("refuses rather than flooding a tracker, and names the escape hatch", async () => {
    const findings = Array.from({ length: 4 }, (_, i) => F({ criteriaId: ["1.1.1", "1.3.1", "2.4.4", "4.1.2"][i] as string }));
    const p = auditFile(dir, { findings, criteria: findings.map((f) => C(f.criteriaId, "NC", [f])) });
    expect(await main(["tickets", "--in", p, "--max-tickets", "2"])).toBe(2);
    expect(err.join()).toContain("past the limit of 2");
    expect(err.join()).toContain("--max-tickets 4");
  });

  it("does not truncate silently: under the limit everything is planned", async () => {
    stubFetch([{ body: [] }]);
    expect(await main(["tickets", "--in", auditFile(dir), "--dry-run", "--max-tickets", "50"])).toBe(0);
  });
});

describe("--dry-run", () => {
  it("creates nothing and exits 0", async () => {
    const calls = stubFetch([{ body: [] }]);
    expect(await main(["tickets", "--in", auditFile(dir), "--dry-run"])).toBe(0);
    expect(calls.every((c) => (c.init.method ?? "GET") === "GET")).toBe(true);
    expect(out.join("\n")).toContain("+ [a11y] WCAG 1.1.1");
  });

  it("emits a machine-readable plan under --json, with the body included", async () => {
    stubFetch([{ body: [] }]);
    expect(await main(["tickets", "--in", auditFile(dir), "--dry-run", "--json"])).toBe(0);
    const payload = JSON.parse(out.join("\n"));
    expect(payload).toMatchObject({ provider: "github", transport: "rest", grain: "criterion", dryRun: true });
    expect(payload.tickets[0]).toMatchObject({ action: "create", severity: "bloquant", advisory: false });
    expect(typeof payload.tickets[0].body).toBe("string");
  });

  it("omits the body from a real push payload", async () => {
    stubFetch([{ body: [] }, { body: { number: 1, html_url: "u" } }]);
    expect(await main(["tickets", "--in", auditFile(dir), "--json"])).toBe(0);
    expect(JSON.parse(out.join("\n")).tickets[0].body).toBeUndefined();
  });
});

// The contract `prd --issues-json` established, moved onto `tickets`: a workflow engine
// reads ONE stable path instead of parsing a payload that also carries prose.
describe("--out writes the tracker-agnostic set", () => {
  it("writes issues-<date>.json with a pinnable envelope, and files nothing", async () => {
    const calls = stubFetch([{ body: [] }]);
    expect(await main(["tickets", "--in", auditFile(dir), "--out", dir, "--dry-run"])).toBe(0);
    const p = join(dir, "issues-2026-08-12.json");
    expect(existsSync(p)).toBe(true);
    const set = JSON.parse(readFileSync(p, "utf8"));
    expect(set).toMatchObject({ tool: "ultra11y", kind: "issues", schemaVersion: 1, standard: "wcag", grain: "criterion", count: 1 });
    expect(calls.every((c) => (c.init.method ?? "GET") === "GET")).toBe(true);
  });

  it("carries the occurrences, so a board with inline anchors needs nothing else", async () => {
    stubFetch([{ body: [] }]);
    await main(["tickets", "--in", auditFile(dir), "--out", dir, "--dry-run"]);
    const set = JSON.parse(readFileSync(join(dir, "issues-2026-08-12.json"), "utf8"));
    expect(set.issues[0].occurrences).toEqual([{ file: "src/a.html", line: 1, selector: "img", message: "image sans alternative" }]);
  });

  it("keeps the envelope shape at every grain", async () => {
    stubFetch([{ body: [] }, { body: [] }]);
    await main(["tickets", "--in", auditFile(dir), "--out", dir, "--grain", "single", "--dry-run"]);
    expect(JSON.parse(readFileSync(join(dir, "issues-2026-08-12.json"), "utf8")).grain).toBe("single");
  });

  it("reports the path in the --json payload", async () => {
    stubFetch([{ body: [] }]);
    await main(["tickets", "--in", auditFile(dir), "--out", dir, "--dry-run", "--json"]);
    expect(JSON.parse(out.join("\n")).setPath).toContain("issues-2026-08-12.json");
  });
});

describe("pushing", () => {
  it("creates and reports the url", async () => {
    stubFetch([{ body: [] }, { body: { number: 3, html_url: "https://github.com/acme/app/issues/3" } }]);
    expect(await main(["tickets", "--in", auditFile(dir)])).toBe(0);
    expect(out.join("\n")).toContain("1 created");
    expect(out.join("\n")).toContain("issues/3");
  });

  it("skips a ticket whose exact title already exists", async () => {
    stubFetch([{ body: [{ title: "[a11y] WCAG 1.1.1 — Non-text Content", number: 1 }] }]);
    expect(await main(["tickets", "--in", auditFile(dir), "--lang", "en"])).toBe(0);
    expect(out.join("\n")).toContain("1 already there");
  });

  it("exits 1 when every creation fails", async () => {
    stubFetch([{ body: [] }, { ok: false, status: 403, body: { message: "Resource not accessible by integration" } }]);
    expect(await main(["tickets", "--in", auditFile(dir)])).toBe(1);
    expect(err.join()).toContain("Resource not accessible");
  });

  // Unlike the old `prd --gh-issues`, whose push was an optional extra on a document, a push
  // command that files nothing and reports green is a silent failure.
  it("exits 1 when the provider is unusable", async () => {
    process.env.GITHUB_TOKEN = "";
    process.env.GH_TOKEN = "";
    process.env.GITHUB_REPOSITORY = "";
    expect(await main(["tickets", "--in", auditFile(dir), "--transport", "rest"])).toBe(1);
    expect(err.join()).toContain("not usable here");
  });

  it("exits 0 with nothing to file when the audit is clean", async () => {
    const p = auditFile(dir, { findings: [], criteria: [C("1.1.1", "C")] });
    expect(await main(["tickets", "--in", p])).toBe(0);
    expect(out.join("\n")).toContain("nothing to file");
  });

  it("exits 1 on --grain page with no page in scope, naming the remedy", async () => {
    expect(await main(["tickets", "--in", auditFile(dir), "--grain", "page"])).toBe(1);
    expect(err.join()).toContain("no page in scope");
    expect(err.join()).toContain("scan --sample");
  });
});

describe("the removed flags fail loudly", () => {
  // Falling through to "unknown flag (ignored)" would leave a scripted CI green while
  // filing nothing at all.
  it("exits 2 on prd --gh-issues and names the replacement", async () => {
    expect(await main(["prd", "--in", auditFile(dir), "--out", dir, "--gh-issues"])).toBe(2);
    expect(err.join()).toContain("was removed in v3");
    expect(err.join()).toContain("tickets --in <audit.json> --provider github --grain criterion");
  });

  it("exits 2 on prd --gh-single", async () => {
    expect(await main(["prd", "--in", auditFile(dir), "--out", dir, "--gh-single"])).toBe(2);
    expect(err.join()).toContain("--grain single");
  });
});

describe("prd no longer pushes anything", () => {
  it("writes markdown and drops the gh key from its --json payload", async () => {
    expect(await main(["prd", "--in", auditFile(dir), "--out", dir, "--json"])).toBe(0);
    const payload = JSON.parse(out.join("\n"));
    expect(payload.paths.length).toBeGreaterThan(0);
    expect(payload.gh).toBeUndefined();
  });
});

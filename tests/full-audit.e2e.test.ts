// THE REFERENCE RUN OF THE FULL AUDIT (#171).
//
// skills/ultra11y/references/full-audit.md prescribes one chain of engine calls, and every
// harness is told to run it as written. This file runs that chain for real, command by
// command, on a small but complete application (tests/fixtures/full-audit-app): eleven served
// routes, a React component directory, downloadable PDFs, two journeys (a menu disclosure and
// the contact form sent with an invalid address), a unit test with a snapshot and a
// Playwright spec. The only thing it does not run is a model: the auditor is a committed
// script (tests/fixtures/full-audit-verdicts.json) that fills the worklist the engine wrote,
// copying each citation from the evidence the engine harvested, so the same run gives the
// same deliverable every time and costs nothing.
//
// What it guards is the chain itself — the hand-offs between steps that no unit test sees:
// the sample the proposal writes is the one the scan reads, the worklist the fold accepts is
// the one `verify --manual` wrote, the trial prunes what the fold recorded, and the
// deliverables pass the gates the skill tells the user they pass.
//
// It needs Chromium (scan), so it lives in the browser tier (vitest.browser.config.ts, the
// `browser-tier` CI job, where ULTRA11Y_REQUIRE_BROWSER turns a skip into a failure).
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO, "scripts", "ultra11y.mjs");
const FIXTURE = join(REPO, "tests", "fixtures", "full-audit-app");
const AUDITOR = JSON.parse(readFileSync(join(REPO, "tests", "fixtures", "full-audit-verdicts.json"), "utf8")) as AuditorScript;
const STEP_TIMEOUT_MS = 240_000;

interface Anchor {
  file: string;
  line: number;
  selector?: string;
  snippet?: string;
  note?: string;
  alsoAt?: string[];
}
interface Match {
  file?: string;
  selector?: string;
  snippetIncludes?: string;
  noteIncludes?: string;
}
interface ScriptedVerdict {
  verdict: "C" | "NC" | "NA" | "manual";
  justification?: string;
  reason?: string;
  cite?: "all";
  except?: Match[];
  findings?: { at: Match; from?: string; message: string; normativeRef: string; severity: string }[];
}
interface AuditorScript {
  verdicts: Record<string, ScriptedVerdict>;
  trial: { note: string; refuted: Record<string, string> };
  undecidable: { entries: { criteriaId: string; reason: string }[] };
}

let chromium: typeof import("@playwright/test").chromium | undefined;
try {
  ({ chromium } = await import("@playwright/test"));
} catch {
  /* not installed: the run skips */
}
let browserAvailable = false;
const require = createRequire(import.meta.url);
const reactResolvable = (() => {
  try {
    require.resolve("react-dom/server");
    return true;
  } catch {
    return false;
  }
})();

let project = "";
let origin = "";
let server: Server | undefined;
const log: string[] = [];

/** One engine call, from the audited project, with stdin closed: the chain must never wait on it. */
function ultra11y(args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: project, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (out += d.toString("utf8")));
    const timer = setTimeout(() => child.kill("SIGKILL"), STEP_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      log.push(`$ ultra11y ${args.join(" ")}  → exit ${code}\n${out.trim()}`);
      resolve({ code, out });
    });
  });
}

/** A step of the chain that has to succeed; its output is in the failure message when it does not. */
async function step(args: string[]): Promise<string> {
  const r = await ultra11y(args);
  expect(r.code, `ultra11y ${args.join(" ")}\n${r.out}`).toBe(0);
  return r.out;
}

const read = (rel: string): string => readFileSync(join(project, rel), "utf8");
const readJson = <T>(rel: string): T => JSON.parse(read(rel)) as T;

/** Every file under a directory of the project, project-relative. */
function walk(rel: string): string[] {
  const abs = join(project, rel);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((name) => {
    const child = join(rel, name);
    return statSync(join(project, child)).isDirectory() ? walk(child) : [child];
  });
}

// ── The scripted auditor ────────────────────────────────────────────────────────────────

const matches = (e: Anchor, m: Match): boolean =>
  (m.file === undefined || e.file === m.file || (e.alsoAt ?? []).some((a) => a.replace(/:\d+$/, "") === m.file)) &&
  (m.selector === undefined || e.selector === m.selector) &&
  (m.snippetIncludes === undefined || (e.snippet ?? "").includes(m.snippetIncludes)) &&
  (m.noteIncludes === undefined || (e.note ?? "").includes(m.noteIncludes));
const anchorOf = (e: Anchor) => ({ file: e.file, line: e.line, ...(e.selector ? { selector: e.selector } : {}), ...(e.snippet ? { snippet: e.snippet } : {}) });

/** Fill ADJUDICATE.todo.json in place, the way the skill tells an agent to: a verdict per
 *  item, each citation copied from that item's own evidence. */
function adjudicate(todoRel: string): void {
  const todo = readJson<{ items: (Record<string, unknown> & { criteriaId: string; evidence?: Anchor[] })[] }>(todoRel);
  const unscripted = todo.items.map((i) => i.criteriaId).filter((id) => !AUDITOR.verdicts[id]);
  expect(unscripted, "the worklist asks for criteria the scripted auditor has no verdict for").toEqual([]);
  for (const item of todo.items) {
    const v = AUDITOR.verdicts[item.criteriaId]!;
    const evidence = item.evidence ?? [];
    item.verdict = v.verdict;
    if (v.justification) item.justification = v.justification;
    if (v.reason) item.reason = v.reason;
    if (v.cite === "all") {
      const kept = evidence.filter((e) => !(v.except ?? []).some((m) => matches(e, m)));
      if (kept.length) item.citations = kept.map(anchorOf);
    }
    if (v.findings) {
      item.findings = v.findings.map((f) => {
        // `from`: the anchor sits in another criterion's evidence (the error message the 11.10
        // harvest shows, cited under 7.5).
        const pool = f.from ? (todo.items.find((x) => x.criteriaId === f.from)?.evidence ?? []) : evidence;
        const e = pool.find((x) => matches(x, f.at));
        expect(e, `${item.criteriaId}: no harvested evidence matches ${JSON.stringify(f.at)}`).toBeDefined();
        return { ...anchorOf(e!), message: f.message, normativeRef: f.normativeRef, severity: f.severity };
      });
    }
  }
  writeFileSync(join(project, todoRel), JSON.stringify(todo, null, 2));
}

/** Rule the adversarial trial (VERIFY.todo.json, a bare array). */
function rule(trialRel: string): void {
  const items = readJson<{ criteriaId: string; verdict: string | null; note: string }[]>(trialRel);
  for (const item of items) {
    const refuted = AUDITOR.trial.refuted[item.criteriaId];
    item.verdict = refuted ? "refuted" : "supported";
    item.note = refuted ?? AUDITOR.trial.note;
  }
  writeFileSync(join(project, trialRel), JSON.stringify(items, null, 2));
}

// ── The served application ──────────────────────────────────────────────────────────────

function serve(root: string): Promise<string> {
  server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname.replace(/\/+$/, "") || "/index";
    const file = extname(path) ? join(root, path) : join(root, `${path === "/" ? "/index" : path}.html`);
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end('<!doctype html><html lang="fr"><head><title>Introuvable</title></head><body><h1>404</h1></body></html>');
      return;
    }
    res.writeHead(200, { "content-type": extname(file) === ".pdf" ? "application/pdf" : "text/html; charset=utf-8" });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) =>
    server!.listen(0, "127.0.0.1", () => {
      const addr = server!.address();
      resolve(typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "");
    }),
  );
}

beforeAll(async () => {
  if (chromium) {
    try {
      const browser = await chromium.launch();
      await browser.close();
      browserAvailable = true;
    } catch {
      /* no browser binary: skip */
    }
  }
  if (process.env.ULTRA11Y_REQUIRE_BROWSER === "1" && !browserAvailable) {
    throw new Error("ultra11y: ULTRA11Y_REQUIRE_BROWSER=1 but no Chromium could be launched — the full-audit reference run did not run.");
  }
  if (!browserAvailable) return;
  project = mkdtempSync(join(tmpdir(), "u11y-full-audit-"));
  cpSync(FIXTURE, project, { recursive: true });
  // The project's own react / react-dom / typescript, as an installed app would have them.
  symlinkSync(join(REPO, "node_modules"), join(project, "node_modules"), "dir");
  origin = await serve(join(project, "public"));
}, 180_000);

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

// ── The chain, as references/full-audit.md writes it ────────────────────────────────────

let report = "";
let annex = "";

describe("the full RGAA audit, end to end on a fixture application (references/full-audit.md)", () => {
  it(
    "runs every step of the chain and passes every gate",
    async () => {
      if (!browserAvailable) return;
      try {
        // 1. Scope: the route inventory and the deterministic RGAA sample.
        await step(["pages", "discover", "--crawl", origin, "--max", "0", "--propose", "--write"]);
        await step(["sample", "check", "--standard", "rgaa"]);

        // 2. Components through ultra11y's render engine, then the static audit, then the browser.
        if (reactResolvable) await step(["render", "."]);
        await step(["audit", ".", "--graph", "--standard", "rgaa", "--lang", "fr", "--out", "audits", "--json"]);
        await step(["scan", "--sample", "--all-routes", "--cwd", ".", "--standard", "rgaa", "--merge", "audits/audit-latest.json", "--out", "audits"]);
        // The journeys the scan cannot walk: the home menu disclosure, and the contact form sent
        // with an invalid address. Keyboard only; each step becomes a page state of the grid.
        const journeys = await step(["journey", "run", "--all", "--keyboard", "--base-url", origin, "--merge", "audits/audit-latest.json", "--out", "audits"]);
        expect(journeys).toMatch(/Parcours fusionnés/);

        // 3. Adjudicate: the worklist, the scripted verdicts, the fail-closed fold.
        await step(["report", "--in", "audits/audit-latest.json", "--standard", "rgaa", "--lang", "fr", "--out", "audits"]);
        report = readdirSync(join(project, "audits")).find((f) => /^rgaa-\d{4}-\d{2}-\d{2}\.md$/.test(f)) ?? "";
        expect(report, "the dated report").not.toBe("");
        report = `audits/${report}`;
        await step(["verify", "--report", report, "--in", "audits/audit-latest.json", "--manual", "--standard", "rgaa", "--out", "audits"]);
        adjudicate("audits/ADJUDICATE.todo.json");
        const fold = await step([
          "verify",
          "--apply",
          "audits/ADJUDICATE.todo.json",
          "--in",
          "audits/audit-latest.json",
          "--standard",
          "rgaa",
          "--out",
          "audits",
          "--ledger",
        ]);
        expect(fold).toMatch(/verdict\(s\) recorded in the ledger/);
        expect(fold).not.toMatch(/✗/);

        // 4. Challenge the claims: the adversarial trial, applied with --prune.
        await step(["report", "--in", "audits/audit-latest.json", "--standard", "rgaa", "--lang", "fr", "--out", "audits"]);
        await step([
          "verify",
          "--report",
          report,
          "--in",
          "audits/audit-latest.json",
          "--standard",
          "rgaa",
          "--semantic",
          "--max-verify",
          "0",
          "--out",
          "audits",
        ]);
        rule("audits/VERIFY.todo.json");
        const trial = await step([
          "verify",
          "--apply",
          "audits/VERIFY.todo.json",
          "--report",
          report,
          "--in",
          "audits/audit-latest.json",
          "--standard",
          "rgaa",
          "--out",
          "audits",
          "--prune",
          "--ledger",
        ]);
        for (const id of Object.keys(AUDITOR.trial.refuted)) expect(trial).toContain(id);

        // 5. The detailed deliverable.
        await step(["report", "--in", "audits/audit-latest.json", "--standard", "rgaa", "--lang", "fr", "--html", "--evidence", "--out", "audits"]);
        await step(["pages", "--in", "audits/audit-latest.json", "--standard", "rgaa", "--lang", "fr", "--json", "--out", "audits"]);
        await step([
          "pages",
          "--in",
          "audits/audit-latest.json",
          "--standard",
          "rgaa",
          "--lang",
          "fr",
          "--format",
          "report",
          "--split",
          "page",
          "--html",
          "--evidence",
          "--out",
          "audits/pages",
        ]);

        // 6. The gates.
        writeFileSync(join(project, ".ultra11y", "undecidable-rgaa.json"), JSON.stringify({ entries: AUDITOR.undecidable.entries }, null, 2));
        await step(["check", "--report", report, "--in", "audits/audit-latest.json", "--standard", "rgaa"]);
        await step(["check", "--in", "audits/audit-latest.json", "--standard", "rgaa", "--require-rendered"]);
        const decided = await step([
          "check",
          "--in",
          "audits/audit-latest.json",
          "--standard",
          "rgaa",
          "--require-decided=pages",
          "--allow-undecided",
          ".ultra11y/undecidable-rgaa.json",
        ]);
        expect(decided).toMatch(/106 critères portent un verdict/);
        await step(["check", "--report", "audits/pages/index.md", "--standard", "rgaa"]);
        annex = read(report.replace("/rgaa-", "/annexe-technique-rgaa-"));
      } catch (e) {
        // The whole transcript, so a red run says which hand-off broke without a rerun.
        console.error(log.join("\n\n"));
        throw e;
      }
    },
    STEP_TIMEOUT_MS * 4,
  );

  it("replays every journey, lists every step in annex H, and puts its states in the grid", () => {
    if (!browserAvailable) return;
    expect(annex).toMatch(/^## H\. /m);
    expect(annex).toMatch(/2 parcours .* 2 terminé\(s\), 0 en échec/);
    for (const j of ["contact", "rubriques"]) expect(annex).toContain(`| **${j}** (clavier seul) | — | \`.ultra11y/journeys/${j}.json\` | terminée |`);
    expect(annex).toMatch(
      /\| contact \| 4 \| click button "Envoyer le message" \| terminée \| `contact-04-click-button-envoyer-le-message` \| error-unassociated/,
    );
    expect(annex).not.toMatch(/non jouée/);
    const pages = readJson<{ pages: { id: string; criteria: { id: string; status: string }[] }[] }>("audits/pages.json");
    const cell = (page: string, criterion: string) => pages.pages.find((p) => p.id === page)?.criteria.find((c) => c.id === criterion)?.status;
    const states = pages.pages.map((p) => p.id).filter((id) => /^(contact|rubriques)-\d{2}-/.test(id));
    expect(states.length).toBe(9);
    // The error the invalid submit revealed is a non-conformity of THAT state only.
    expect(cell("contact-04-click-button-envoyer-le-message", "11.10")).toBe("NC");
    expect(cell("contact-04-click-button-envoyer-le-message", "7.5")).toBe("NC");
    expect(cell("contact-00-start", "11.10")).not.toBe("NC");
    expect(cell("rubriques-01-click-button-rubriques", "7.5")).not.toBe("NC");
    for (const id of states) expect(existsSync(join(project, "audits", "pages", `page-${id}.md`)), id).toBe(true);
  });

  it("writes every deliverable the skill hands over", () => {
    if (!browserAvailable) return;
    const day = report.match(/rgaa-(\d{4}-\d{2}-\d{2})\.md$/)![1];
    for (const rel of [
      report,
      `audits/annexe-technique-rgaa-${day}.md`,
      "audits/index.html",
      `audits/ultra11y-rgaa-${day}.html`,
      "audits/pages.json",
      "audits/pages/index.md",
      "audits/pages/index.html",
      "audits/audit-latest.json",
      ".ultra11y/verdicts/rgaa.json",
      ".ultra11y/routes.json",
      ".ultra11y/render.json",
    ]) {
      expect(existsSync(join(project, rel)), rel).toBe(true);
    }
    // One dossier per sample page, in Markdown and HTML.
    const sample = readJson<{ sample: { pages: { id: string }[] } }>(".ultra11yrc.json").sample.pages;
    expect(sample.length).toBeGreaterThanOrEqual(10);
    for (const p of sample) {
      expect(existsSync(join(project, "audits", "pages", `page-${p.id}.md`)), p.id).toBe(true);
      expect(existsSync(join(project, "audits", "pages", `page-${p.id}.html`)), p.id).toBe(true);
    }
  });

  it("names every route, every rendered component and the browser in the annex", () => {
    if (!browserAvailable) return;
    // The axe that ran is ultra11y's own pinned copy, never the audited project's.
    expect(annex).toMatch(/\*\*Moteur axe-core\*\* : `axe-core@[\d.]+` \(copie épinglée d'ultra11y/);
    expect(annex).toMatch(/^## F\. /m);
    for (const route of ["/", "/contact", "/documents", "/actualites/101", "/actualites/102"]) expect(annex).toContain(`| \`${route}\` |`);
    // /actualites/102 is outside the sample: the inventory still reaches it through --all-routes.
    expect(annex).toMatch(/\| `\/actualites\/102` \| hors échantillon \| scannée/);
    expect(annex).not.toMatch(/non atteinte/);
    if (reactResolvable) {
      expect(annex).toMatch(/^## G\. /m);
      for (const unit of ["Button", "Notice", "SiteLogo"]) expect(annex).toContain(`\`src/components/${unit}.tsx\``);
    }
  });

  it("gives pages with different findings different rates, and keeps each defect on its own page", () => {
    if (!browserAvailable) return;
    const pages = readJson<{ pages: { id: string; criteria: { id: string; status: string }[] }[]; averageRate: { pages: { id: string; pct: number }[] } }>(
      "audits/pages.json",
    );
    const pct = new Map(pages.averageRate.pages.map((p) => [p.id, p.pct]));
    expect(new Set(pct.values()).size).toBeGreaterThan(1);
    for (const flawed of ["contact", "documents", "actualites-101"]) expect(pct.get(flawed)!, flawed).toBeLessThan(pct.get("aide")!);
    const cell = (page: string, criterion: string) => pages.pages.find((p) => p.id === page)?.criteria.find((c) => c.id === criterion)?.status;
    // The engine's own proof (an unlabelled field) survives the agent's « C » for the rest of the site.
    expect(cell("contact", "11.1")).toBe("NC");
    expect(cell("connexion", "11.1")).toBe("C");
    // The agent's non-conformities stay where they were observed.
    expect(cell("actualites-101", "1.1")).toBe("NC");
    expect(cell("documents", "13.3")).toBe("NC");
    expect(cell("aide", "1.1")).not.toBe("NC");
  });

  it("never reads the project's tests, snapshots or Playwright specs", () => {
    if (!browserAvailable) return;
    const outputs = [...walk("audits"), ...walk(".ultra11y")].filter((f) => /\.(md|html|json|txt)$/.test(f));
    expect(outputs.length).toBeGreaterThan(20);
    for (const rel of outputs) {
      const text = read(rel);
      expect(text, rel).not.toContain("TEST-SNAPSHOT-DECOY");
      expect(text, rel).not.toContain("PLAYWRIGHT-TEST-DECOY");
    }
    const audit = readJson<{ findings: { file: string }[] }>("audits/audit-latest.json");
    const files = audit.findings.map((f) => relative(project, join(project, f.file)));
    expect(files.filter((f) => /(__snapshots__|\.test\.|\.spec\.|^e2e\/)/.test(f))).toEqual([]);
    if (reactResolvable) expect(readJson<{ testFilesIgnored: number }>(".ultra11y/render.json").testFilesIgnored).toBeGreaterThanOrEqual(1);
  });
});

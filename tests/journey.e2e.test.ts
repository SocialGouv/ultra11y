// `journey run` over a real browser (#189): the journeys in tests/fixtures/journeys replayed
// with the keyboard alone over the fixture SPA, each carrying one defect a journey alone can see.
//
// Runs in the browser tier (`pnpm test:browser`, vitest.browser.config.ts) and SKIPS where no
// Chromium can launch — unless ULTRA11Y_REQUIRE_BROWSER=1, where a skip would be a green lie.
import { createServer, type Server } from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildAdjudicationWorklist } from "../src/adjudicate.js";
import { runAudit } from "../src/audit.js";
import { main } from "../src/cli.js";
import { journeyScopeFor, listJourneyFiles, writeJourneyRuns } from "../src/journey.js";
import { type JourneyRunResult, runJourneys } from "../src/journey-run.js";
import { pageScopesFrom } from "../src/pages.js";
import { renderJourneys } from "../src/report.js";
import { PAGES_DIR, readSnapshots } from "../src/snapshot.js";
import type { JourneyRecord, ScriptsDigest } from "../src/types.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "journeys");

let chromium: typeof import("@playwright/test").chromium | undefined;
try {
  ({ chromium } = await import("@playwright/test"));
} catch {
  /* not installed — every test below skips */
}
let browserAvailable = false;
let server: Server | undefined;
let origin = "";
let root = "";
let run: JourneyRunResult | undefined;

beforeAll(async () => {
  if (chromium) {
    try {
      const b = await chromium.launch();
      await b.close();
      browserAvailable = true;
    } catch {
      /* no browser binary — skip */
    }
  }
  if (process.env.ULTRA11Y_REQUIRE_BROWSER === "1" && !browserAvailable) {
    throw new Error("ultra11y: ULTRA11Y_REQUIRE_BROWSER=1 but no Chromium could be launched — the journey tier did not run.");
  }
  if (!browserAvailable) return;
  const html = readFileSync(join(FIXTURE, "app", "index.html"));
  // Served, not file://: axe-core refuses a file URL. Every path answers the SPA shell.
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  origin = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
  root = mkdtempSync(join(tmpdir(), "u11y-journey-"));
  cpSync(join(FIXTURE, ".ultra11y"), join(root, ".ultra11y"), { recursive: true });
  const entries = listJourneyFiles(root).map((f) => ({ journey: f.validation.journey!, file: f.file }));
  run = await runJourneys(entries, { root, cwd: process.cwd(), lang: "fr", keyboard: true, baseUrl: origin });
  writeJourneyRuns(root, run.records);
}, 600_000);

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

/** A test that needs the browser: skipped (never silently passed) where none launched. */
const bit = (name: string, fn: () => unknown) =>
  it(name, async (ctx) => {
    if (!browserAvailable) ctx.skip();
    await fn();
  }, 180_000);

const rec = (name: string): JourneyRecord => run!.records.find((r) => r.name === name)!;
/** The findings recorded at one step's page state. */
const at = (name: string, n: number) => {
  const page = rec(name).steps.find((s) => s.n === n)!.page!;
  return run!.findings.filter((f) => f.sample?.id === page);
};
const engines = (name: string) => run!.findings.filter((f) => f.sample?.id.startsWith(`${name}-`)).map((f) => f.engine);

describe("journey run — keyboard replay over the fixture SPA", () => {
  bit("completes every well-formed journey and records a snapshot per step", () => {
    for (const name of ["menu", "modales", "formulaire", "editeur", "rapport", "boutons"]) {
      const r = rec(name);
      expect(r.status, `${name}: ${r.reason}`).toBe("done");
      expect(r.keyboard).toBe(true);
      for (const st of r.steps) {
        expect(st.status).toBe("done");
        expect(st.page, `${name} step ${st.n}`).toMatch(new RegExp(`^${name}-${String(st.n).padStart(2, "0")}`));
        const dir = join(root, PAGES_DIR, st.page!);
        for (const f of ["meta.json", "dom.html", "axe.json", "probes.json", "screen.png"]) expect(existsSync(join(dir, f)), `${st.page}/${f}`).toBe(true);
        const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
        expect(meta.runner).toBe("journey");
        expect(meta.journey).toEqual({ name, step: st.n, action: st.action, keyboard: true });
        // The recorded DOM is the application's, not the replay's tagging.
        expect(readFileSync(join(dir, "dom.html"), "utf8")).not.toContain("data-u11y-");
      }
    }
  });

  bit("records the focus order Tab walked to reach a control", () => {
    const st = rec("menu").steps[1]!;
    expect(st.keyboard).toBe("focus");
    expect(st.focus?.at(-1)).toBe('button "Rubriques"');
    expect(st.focus).toContain('link "Menu"');
  });

  bit("a correct disclosure menu raises no journey observation", () => {
    const own = engines("menu").filter((e) => ["keyboard-trap", "keyboard-unreachable", "dialog-focus", "error-unassociated", "live-region"].includes(e));
    expect(own).toEqual([]);
  });

  bit("detects the keyboard trap — 2.1.2, bloquant — and goes on with the pointer", () => {
    const st = rec("editeur").steps[1]!;
    expect(st.keyboard).toBe("trap");
    const trap = at("editeur", 1).filter((f) => f.engine === "keyboard-trap");
    expect(trap.length).toBeGreaterThan(0);
    expect(trap[0]!.criteriaId).toBe("2.1.2");
    expect(trap[0]!.severity).toBe("bloquant");
    expect(trap.some((f) => /Piège clavier/.test(f.message))).toBe(true);
  });

  // #190 — each step's state carries the page's JS behaviour, read through CDP like `scan`, and
  // it reaches the brief of the criterion it informs.
  bit("records the page's behaviour at each step: the div-button's click listener, flagged, reaches 7.1", () => {
    for (const st of rec("rapport").steps) {
      const s = JSON.parse(readFileSync(join(root, PAGES_DIR, st.page!, "scripts.json"), "utf8")) as ScriptsDigest;
      expect(s.collected, `${st.page}: ${s.why}`).toBe("cdp");
      expect(s.timers?.source).toBe("init");
      const div = s.listeners?.find((l) => l.selector === "div#download");
      expect(div, `${st.page}: ${JSON.stringify(s.listeners)}`).toMatchObject({ tag: "div", events: ["click"], native: false, flagged: true });
    }
    const page = rec("rapport").steps[0]!.page!;
    const audit = runAudit({ inputs: [join(root, PAGES_DIR, page, "dom.html")] });
    const ev = (buildAdjudicationWorklist(audit, { standard: "rgaa" }).find((i) => i.criteriaId === "7.1")?.evidence ?? []).map(
      (e) => `${e.selector} :: ${e.note ?? ""}`,
    );
    expect(ev.some((e) => e.startsWith("div#download") && /neither role nor tabindex/.test(e))).toBe(true);
  });

  bit("detects a div-button Tab never reaches — 2.1.1 — and still completes the journey", () => {
    const st = rec("rapport").steps[1]!;
    expect(st.keyboard).toBe("unreachable");
    const hit = at("rapport", 1).filter((f) => f.engine === "keyboard-unreachable");
    expect(hit).toHaveLength(1);
    expect(hit[0]!.criteriaId).toBe("2.1.1");
    expect(hit[0]!.selector).toBe("div#download");
    // The pointer fallback really clicked it: the next step's expectation held.
    expect(rec("rapport").steps[2]!.status).toBe("done");
  });

  bit("detects the dialog that does not return focus, and only that one — 2.4.3", () => {
    expect(at("modales", 1).filter((f) => f.engine === "dialog-focus")).toEqual([]);
    expect(at("modales", 2).filter((f) => f.engine === "dialog-focus")).toEqual([]);
    expect(at("modales", 3).filter((f) => f.engine === "dialog-focus")).toEqual([]);
    const lost = at("modales", 4).filter((f) => f.engine === "dialog-focus");
    expect(lost).toHaveLength(1);
    expect(lost[0]!.criteriaId).toBe("2.4.3");
    expect(lost[0]!.message).toMatch(/n'est pas revenu sur button "Aide en ligne"/);
  });

  bit("detects the error tied to no field after the invalid submit — 3.3.1", () => {
    const errs = at("formulaire", 2).filter((f) => f.engine === "error-unassociated");
    expect(errs).toHaveLength(1);
    expect(errs[0]!.criteriaId).toBe("3.3.1");
    expect(errs[0]!.message).toMatch(/Adresse invalide/);
    expect(errs[0]!.message).toMatch(/textbox "Courriel"/);
    // The error is not double-counted as a status message.
    expect(at("formulaire", 2).filter((f) => f.engine === "live-region")).toEqual([]);
  });

  bit("detects the status message outside any live region — 4.1.3", () => {
    const st = at("formulaire", 3).filter((f) => f.engine === "live-region");
    expect(st).toHaveLength(1);
    expect(st[0]!.message).toMatch(/Brouillon enregistré/);
  });

  bit("a text locator on a button's inner <span> resolves to the button: no false 2.1.1, 2.4.3 or 4.1.3", () => {
    const r = rec("boutons");
    for (const st of r.steps.slice(1)) expect(st.keyboard, st.label).toBe("focus");
    expect(r.steps[1]!.focus?.at(-1)).toBe('button "Afficher les détails"');
    const own = run!.findings.filter((f) => f.sample?.id.startsWith("boutons-") && ["2.1.1", "2.4.3", "4.1.3"].includes(f.criteriaId));
    expect(own).toEqual([]);
  });

  bit("a journey that fails before its first step leaves no state of its previous replay", async () => {
    const stale = join(root, PAGES_DIR, "vieux-01-click-button-x");
    mkdirSync(stale, { recursive: true });
    writeFileSync(
      join(stale, "meta.json"),
      JSON.stringify({
        v: 1,
        id: "vieux-01-click-button-x",
        name: "vieux",
        url: "http://x/",
        runner: "journey",
        journey: { name: "vieux", step: 1, action: "click", keyboard: true },
      }),
    );
    const r = await runJourneys(
      [{ journey: { name: "vieux", startUrl: "/relatif", steps: [{ action: "press", key: "Tab" }] }, file: ".ultra11y/journeys/vieux.json" }],
      { root, cwd: process.cwd(), lang: "en", keyboard: true },
    );
    expect(r.records[0]!.status).toBe("failed");
    expect(r.records[0]!.steps[0]!.reason).toMatch(/--base-url/);
    expect(existsSync(stale)).toBe(false);
  });

  bit("a locator that matches nothing stops its journey, with the reason, and the rest is not run", () => {
    const r = rec("broken");
    expect(r.status).toBe("failed");
    expect(r.steps[0]!.status).toBe("done");
    expect(r.steps[1]!.status).toBe("failed");
    expect(r.steps[1]!.reason).toMatch(/locator not found/);
    expect(r.steps[1]!.page).toBeUndefined();
    expect(r.steps[2]!.status).toBe("not-run");
    expect(r.reason).toMatch(/^step 1 \(click button "Bouton inexistant"\)/);
  });

  bit("the states are audited pages of the grid, and the annex lists every journey and step", () => {
    const audit = runAudit({ inputs: [join(root, PAGES_DIR)] });
    const ids = pageScopesFrom(readSnapshots(root)).map((p) => p.id);
    for (const r of run!.records) for (const st of r.steps) if (st.page) expect(ids).toContain(st.page);
    // The journey observations are folded from the snapshots themselves, offline.
    const rules = new Set(audit.findings.map((f) => f.ruleId));
    for (const id of ["dyn-keyboard-trap", "dyn-keyboard-unreachable", "dyn-dialog-focus", "dyn-error-unassociated", "dyn-live-region"])
      expect(rules).toContain(id);
    expect(audit.findings.find((f) => f.ruleId === "dyn-dialog-focus")?.criteriaId).toBe("2.4.3");

    // A journey file that was never replayed is listed too, every step « not run ».
    writeFileSync(
      join(root, ".ultra11y", "journeys", "jamais.json"),
      JSON.stringify({ name: "jamais", startUrl: "/", steps: [{ action: "press", key: "Tab" }] }),
    );
    const scope = journeyScopeFor(root)!;
    const md = renderJourneys(scope, "fr").join("\n");
    expect(md).toContain("## H. Parcours utilisateur — couverture");
    expect(md).toMatch(/\| broken \| 1 \| click button "Bouton inexistant" \| en échec \| — \| no element matches/);
    expect(md).toMatch(/\| broken \| 2 \| click button "Rubriques" \| non jouée \|/);
    expect(md).toMatch(/\| rapport \| 1 \| click text "Télécharger le rapport" \| terminée \| `rapport-01-[^`]+` \| non atteignable au clavier/);
    expect(md).toMatch(/\| \*\*jamais\*\* \(pointeur\) \| — \| `\.ultra11y\/journeys\/jamais\.json` \| non jouée \|/);
    expect(md).toMatch(/\| jamais \| 1 \| press Tab \| non jouée \|/);
    expect(md).toContain("parcours non terminé(s)");
  });

  bit("`journey run --merge` folds the states into the audit, with the annex scope", async () => {
    const base = join(root, "base.json");
    const out = join(root, "out");
    const audit = runAudit({ inputs: [join(FIXTURE, "app", "index.html")] });
    writeFileSync(base, JSON.stringify(audit));
    const cwd = process.cwd();
    const log = console.log;
    const err = console.error;
    let printed = "";
    console.log = (m: unknown) => {
      printed += String(m);
    };
    console.error = () => {};
    let code: number;
    try {
      code = await main([
        "journey",
        "run",
        "menu",
        "--keyboard",
        "--base-url",
        origin,
        "--root",
        root,
        "--cwd",
        cwd,
        "--merge",
        base,
        "--out",
        out,
        "--json",
        "--lang",
        "en",
      ]);
    } finally {
      console.log = log;
      console.error = err;
    }
    expect(code).toBe(0);
    const doc = JSON.parse(printed);
    expect(doc.journeys.map((j: JourneyRecord) => j.name)).toEqual(["menu"]);
    const merged = JSON.parse(readFileSync(join(out, "audit-latest.json"), "utf8"));
    expect(merged.scope.journeys.journeys.map((j: JourneyRecord) => j.name)).toEqual(expect.arrayContaining(["broken", "menu", "rapport"]));
    expect(merged.scope.pages.map((p: { id: string }) => p.id)).toContain("menu-01-click-button-rubriques");
  });
});

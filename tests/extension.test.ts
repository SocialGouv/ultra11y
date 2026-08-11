import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startDevServer, projectPages } from "../src/dev.js";
import { COLLECT_SNAPSHOT, PAGES_DIR } from "../src/snapshot.js";
import { VERSION } from "../src/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT = join(ROOT, "extension");

// The extension is committed JavaScript no type-checker covers, loaded straight from disk by
// Chrome, and it is the only surface where a user's API key is in play. So what is worth
// proving is the boundary: it holds no copy of the engine, it can only reach loopback, and
// the server it talks to refuses a bad adjudication exactly as the CLI does.

describe("the extension is a client, not a second engine", () => {
  const files = ["manifest.json", "background.js", "popup.html", "popup.js", "options.html", "options.js"];
  const sources = Object.fromEntries(files.map((f) => [f, readFileSync(join(EXT, f), "utf8")]));
  const manifest = JSON.parse(sources["manifest.json"]!) as {
    manifest_version: number;
    permissions: string[];
    host_permissions: string[];
    background: { service_worker: string; type: string };
    icons: Record<string, string>;
    action: { default_icon: Record<string, string> };
  };

  it("ships every file its manifest points at", () => {
    for (const f of files) expect(existsSync(join(EXT, f)), f).toBe(true);
    expect(existsSync(join(EXT, manifest.background.service_worker))).toBe(true);
    // Chrome refuses to load a manifest whose declared icon is missing.
    for (const path of [...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]) {
      expect(existsSync(join(EXT, path)), path).toBe(true);
    }
  });

  it("declares every icon size Chrome asks for, in both places", () => {
    for (const set of [manifest.icons, manifest.action.default_icon]) {
      expect(Object.keys(set).sort()).toEqual(["128", "16", "32", "48"]);
    }
  });

  it("keeps the icons reproducible from their source, like every other committed artefact", () => {
    // An icon is the one asset a reviewer cannot diff, so it is generated rather than drawn:
    // `--check` proves the committed PNGs are exactly what the script produces.
    expect(() => execFileSync(process.execPath, [join(ROOT, "scripts/build-extension-icons.mjs"), "--check"])).not.toThrow();
  });

  it("parses as JavaScript — a syntax error here only surfaces inside Chrome", () => {
    for (const f of ["background.js", "popup.js", "options.js"]) {
      expect(() => execFileSync(process.execPath, ["--check", join(EXT, f)]), f).not.toThrow();
    }
  });

  it("is Manifest V3", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.type).toBe("module");
  });

  it("can reach LOOPBACK and nothing else — the page's DOM cannot leave the machine", () => {
    // This is the privacy claim the options page makes to the user, so it is a test, not a
    // comment: the extension is structurally incapable of posting elsewhere.
    expect(manifest.host_permissions).toEqual(["http://127.0.0.1/*", "http://localhost/*"]);
    for (const h of manifest.host_permissions) expect(h).toMatch(/^http:\/\/(127\.0\.0\.1|localhost)\//);
  });

  it("asks for no permission it does not use", () => {
    expect(new Set(manifest.permissions)).toEqual(new Set(["activeTab", "scripting", "storage"]));
  });

  it("holds NO copy of the collector — it fetches the engine's own", () => {
    // A second implementation of the snapshot format living in an extension is how the two
    // drift, and a drifted digest is refused wholesale by the join check.
    for (const [name, src] of Object.entries(sources)) {
      expect(src.includes("documentElement.outerHTML"), name).toBe(false);
      expect(src.includes("getComputedStyle"), name).toBe(false);
    }
    expect(sources["background.js"]).toContain("/collector.js");
  });

  it("keeps the API key out of the audited page, and out of any log", () => {
    // The key is read in the service worker and sent as a request header. It must never be
    // injected into the page (executeScript args are visible to the page's own code).
    expect(sources["background.js"]).toContain("x-anthropic-key");
    expect(sources["background.js"]).not.toMatch(/executeScript[\s\S]{0,400}apiKey/);
    for (const [name, src] of Object.entries(sources)) expect(src.includes("console.log(cfg"), name).toBe(false);
  });

  it("tells the user what to do when the server is down, rather than failing silently", () => {
    expect(sources["popup.js"]).toContain("ultra11y dev");
  });

  it("says out loud that a clean popup is not a conformant page", () => {
    expect(sources["popup.js"]).toMatch(/judgment criteria are not decided here/i);
  });
});

describe("the endpoints the extension depends on", () => {
  const root = mkdtempSync(join(tmpdir(), "ultra11y-ext-"));
  const dir = join(root, PAGES_DIR, "accueil");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "dom.html"),
    '<!-- ultra11y:capture v="1" page="accueil" url="https://exemple.fr/" -->\n<html lang="fr"><head><title>A</title></head><body><main>x</main></body></html>\n',
  );
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ v: 1, id: "accueil", name: "Accueil", url: "https://exemple.fr/" }));

  const withServer = async (fn: (base: string) => Promise<void>): Promise<void> => {
    const srv = await startDevServer({ root, port: 0, standard: "rgaa", lang: "fr" });
    try {
      await fn(`http://127.0.0.1:${srv.port}`);
    } finally {
      await srv.close();
    }
  };

  it("GET /health answers so a client can say « run ultra11y dev » instead of hanging", async () => {
    await withServer(async (base) => {
      const j = (await (await fetch(`${base}/health`)).json()) as Record<string, unknown>;
      expect(j.ok).toBe(true);
      expect(j.version).toBe(VERSION);
      expect(j.standard).toBe("rgaa");
      expect(j.pages).toBe(1);
    });
  });

  it("GET /collector.js serves the engine's own collector verbatim", async () => {
    await withServer(async (base) => {
      const src = await (await fetch(`${base}/collector.js`)).text();
      const m = /^window\.__ULTRA11Y_COLLECT__\s*=\s*([\s\S]*);\s*$/.exec(src);
      expect(m).not.toBeNull();
      // Byte-for-byte the same string the E2E plugins and `scan` evaluate.
      expect(JSON.parse(m![1]!)).toBe(COLLECT_SNAPSHOT);
    });
  });

  it("POST /judge without a key explains itself instead of quietly doing nothing", async () => {
    const prior = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "";
    try {
      await withServer(async (base) => {
        const res = await fetch(`${base}/judge`, { method: "POST" });
        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: string }).error).toMatch(/No API key/);
      });
    } finally {
      if (prior === undefined) process.env.ANTHROPIC_API_KEY = undefined as unknown as string;
      else process.env.ANTHROPIC_API_KEY = prior;
    }
  });

  it("an unknown path is a 404, not a file read", async () => {
    await withServer(async (base) => {
      expect((await fetch(`${base}/../../etc/passwd`)).status).toBe(404);
    });
  });
});

describe("a recorded adjudication survives a fresh measurement", () => {
  // Without this the dashboard would silently undo every `judge` run on the next page load,
  // and the grid would disagree with the report generated from the same directory.
  const root = mkdtempSync(join(tmpdir(), "ultra11y-fold-"));
  const dir = join(root, PAGES_DIR, "accueil");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "dom.html"),
    '<!-- ultra11y:capture v="1" page="accueil" url="https://exemple.fr/" -->\n<html lang="fr"><head><title>A</title></head><body><main>x</main></body></html>\n',
  );
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ v: 1, id: "accueil", name: "Accueil", url: "https://exemple.fr/" }));

  it("carries the agent's rulings, and lets a live measurement win over a stale one", () => {
    const before = projectPages(root).result!;
    const manual = before.criteria.find((c) => c.status === "manual")!;
    const decided = before.criteria.find((c) => c.status === "C")!;

    mkdirSync(join(root, "audits"), { recursive: true });
    writeFileSync(
      join(root, "audits", "audit-latest.json"),
      JSON.stringify({
        ...before,
        packAdjudication: { standard: "rgaa", criteria: [{ id: "8.9", status: "C", justification: "j" }] },
        criteria: before.criteria.map((c) =>
          c.id === manual.id
            ? { ...c, status: "C", decidedBy: "agent", justification: "ruled by the agent" }
            : // A stale ruling on a criterion the engine decides must NOT override this run.
              c.id === decided.id
              ? { ...c, status: "NC", decidedBy: "agent", justification: "stale" }
              : c,
        ),
      }),
    );

    const after = projectPages(root).result!;
    expect(after.criteria.find((c) => c.id === manual.id)?.status).toBe("C");
    expect(after.criteria.find((c) => c.id === manual.id)?.decidedBy).toBe("agent");
    expect(after.criteria.find((c) => c.id === decided.id)?.status).toBe("C"); // the live one wins
    expect(after.packAdjudication?.criteria).toHaveLength(1);
    expect(after.residualRisks.some((r) => r.criteriaId === manual.id)).toBe(false);
  });
});

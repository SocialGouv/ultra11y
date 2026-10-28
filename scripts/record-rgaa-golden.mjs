#!/usr/bin/env node
// Re-record the RENDERED captures of the RGAA golden pages (tests/fixtures/rgaa-golden).
//
// tests/rgaa-golden.test.ts audits each golden page three ways: as a source file, as a bare
// capture, and as the capture a real browser produced — computed styles, boxes, axe results and
// the live probes (focus walk, keyboard trap, reflow, text spacing…). That last one cannot be
// produced inside the test without a browser, so it is recorded here, once, and committed. The
// test refuses a recording whose source page has changed since (meta.notes carries its hash).
//
//   node scripts/record-rgaa-golden.mjs        (needs the local Playwright browser: `ultra11y status --browser`)
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(repo, "tests", "fixtures", "rgaa-golden");
const PAGES = ["non-conforme", "conforme"];
// The origin every recording is rewritten to, so a re-record does not churn on the port.
const ORIGIN = "http://villeneuve.test";
const TYPES = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".vtt": "text/vtt" };

const server = createServer((req, res) => {
  const path = join(dir, decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
  if (!path.startsWith(dir)) return res.writeHead(403).end();
  try {
    const body = readFileSync(path);
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = `http://127.0.0.1:${server.address().port}`;
const root = mkdtempSync(join(tmpdir(), "u11y-golden-rec-"));
try {
  const code = await new Promise((ok) => {
    const child = spawn(
      process.execPath,
      [join(repo, "scripts", "ultra11y.mjs"), "scan", ...PAGES.map((p) => `${origin}/${p}.html`), "--runtime", "local", "--root", root, "--out", join(root, "out")],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    child.on("exit", ok);
  });
  if (code !== 0) throw new Error(`scan exited ${code}`);
  for (const page of PAGES) {
    const id = `${page}-html`;
    const from = join(root, ".ultra11y", "pages", id);
    const to = join(dir, "rendered", ".ultra11y", "pages", id);
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to, { recursive: true });
    // The screenshot only feeds a pixel fallback for contrast; it is the bulk of the bytes and
    // decides nothing the golden grid asserts.
    rmSync(join(to, "screen.png"), { force: true });
    for (const f of readdirSync(to)) {
      const p = join(to, f);
      writeFileSync(p, readFileSync(p, "utf8").replaceAll(origin, ORIGIN));
    }
    const meta = JSON.parse(readFileSync(join(to, "meta.json"), "utf8"));
    meta.notes = `source sha256 ${createHash("sha256").update(readFileSync(join(dir, `${page}.html`))).digest("hex")}`;
    writeFileSync(join(to, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
    console.log(`recorded ${id}`);
  }
} finally {
  server.close();
  rmSync(root, { recursive: true, force: true });
}

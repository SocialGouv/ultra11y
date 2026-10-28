// A PAGE'S SCRIPTS ARE PART OF ITS SOURCE (issue #65).
//
// The applicability predicates for code constructs — a single-key shortcut (2.1.4 → RGAA
// 12.10), a timer (2.2.1 → 13.1), a gesture (2.5.1 → 13.10), a down-event action (2.5.2 →
// 13.11), device motion (2.5.4 → 13.12), a drag (2.5.7) — read `doc.source`, and a plain `.js`
// is never an audit target. A page whose shortcut lived in `app.js` closed 12.10 « non
// applicable » over the very code it is about.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { derivePackResults } from "../src/standards/index.js";

const root = mkdtempSync(join(tmpdir(), "u11y-scripts-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
function na(head: string, ids: string[], js?: string): Record<string, boolean> {
  const dir = join(root, `s${n++}`);
  mkdirSync(dir);
  if (js !== undefined) writeFileSync(join(dir, "app.js"), js);
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><html lang="fr"><head><title>T</title>${head}</head><body><main><h1>T</h1><p>Texte</p></main></body></html>`,
  );
  const rows = derivePackResults(runAudit({ inputs: [join(dir, "index.html")] }), "rgaa");
  return Object.fromEntries(ids.map((id) => [id, rows.find((r) => r.id === id)!.inapplicable === true]));
}

describe("code-construct criteria read the scripts a page loads", () => {
  it("a shortcut and a timer in a local app.js keep 12.10 and 13.1 open", () => {
    const r = na(
      '<script src="app.js"></script>',
      ["12.10", "13.1", "13.10"],
      'document.addEventListener("keydown", (e) => { if (e.key === "k") toggle(); });\nsetTimeout(() => location.reload(), 60000);\n',
    );
    expect(r["12.10"]).toBe(false);
    expect(r["13.1"]).toBe(false);
    // …and a construct app.js does NOT contain is still proved absent.
    expect(r["13.10"]).toBe(true);
  });

  it("a script nobody can read (a CDN) leaves the construct unknown, so open", () => {
    const r = na('<script src="https://cdn.example.com/widget.js"></script>', ["12.10", "13.1", "13.10", "13.11", "13.12"]);
    expect(Object.entries(r).filter(([, closed]) => closed)).toEqual([]);
  });

  it("a page with no script at all still closes them", () => {
    const r = na("", ["12.10", "13.10", "13.12"]);
    expect(r).toEqual({ "12.10": true, "13.10": true, "13.12": true });
  });
});

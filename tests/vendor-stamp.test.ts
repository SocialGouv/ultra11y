// A VENDORED SOURCE IS RE-STAMPED ONLY WHEN IT CHANGED.
//
// The daily `standards-refresh` cron re-fetched the W3C and DINUM sources, found the same bytes,
// and still committed eight files — the four vendored datasets and the three 3.7 MB engine
// bundles that embed them — because every writer stamped `fetchedAt` with TODAY. One line of
// diff a day, three new 3.7 MB blobs a day, and a history in which nothing can be told apart
// from a real upstream change. The stamp follows the data: same bytes, same stamp.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { sameButForTheDate, withPreviousStamp } from "../scripts/vendor-stamp.mjs";

const file = (body: unknown): string => {
  const p = join(mkdtempSync(join(tmpdir(), "u11y-stamp-")), "vendored.json");
  writeFileSync(p, `${JSON.stringify(body, null, 2)}\n`);
  return p;
};

describe("withPreviousStamp", () => {
  it("keeps the committed fetchedAt when the data is unchanged", () => {
    const p = file({ source: "s", fetchedAt: "2026-10-01", criteria: { "1.1.1": "text" } });
    const out = withPreviousStamp(p, { source: "s", fetchedAt: "2026-10-28", criteria: { "1.1.1": "text" } });
    expect(out.fetchedAt).toBe("2026-10-01");
    expect(out.criteria).toEqual({ "1.1.1": "text" });
  });

  it("re-stamps with today when any of the data changed", () => {
    const p = file({ source: "s", fetchedAt: "2026-10-01", criteria: { "1.1.1": "text" } });
    const out = withPreviousStamp(p, { source: "s", fetchedAt: "2026-10-28", criteria: { "1.1.1": "text", "1.1.2": "new" } });
    expect(out.fetchedAt).toBe("2026-10-28");
  });

  it("writes the first stamp as given when there is no committed file yet", () => {
    const out = withPreviousStamp(join(tmpdir(), "u11y-stamp-none", "missing.json"), { fetchedAt: "2026-10-28", criteria: {} });
    expect(out.fetchedAt).toBe("2026-10-28");
  });

  it("is byte-stable end to end: refresh twice, commit once", () => {
    // The property the cron needs: writing the carried object back produces the committed
    // bytes, so `git status --porcelain` stays empty and no release-sized blob is born.
    const body = { source: "s", fetchedAt: "2026-10-01", criteria: { a: 1 } };
    const p = file(body);
    const before = readFileSync(p, "utf8");
    const again = withPreviousStamp(p, { ...body, fetchedAt: "2026-10-28" });
    expect(`${JSON.stringify(again, null, 2)}\n`).toBe(before);
  });

  it("keeps a dated provenance sentence when only its date would move", () => {
    const prev = { wcagVersion: "2.2", provenance: "Fetched from w3c/wcag@main on 2026-10-01 via the refresh script.", criteria: [1, 2] };
    const p = file(prev);
    const next = { ...prev, provenance: "Fetched from w3c/wcag@main on 2026-10-28 via the refresh script." };
    expect(withPreviousStamp(p, next, { stamp: "provenance", sameStamp: sameButForTheDate }).provenance).toBe(prev.provenance);
    // A reworded sentence is a real change, not a re-dating.
    const reworded = { ...prev, provenance: "Fetched from w3c/wcag@main on 2026-10-28 via `--refresh-universe`." };
    expect(withPreviousStamp(p, reworded, { stamp: "provenance", sameStamp: sameButForTheDate }).provenance).toBe(reworded.provenance);
  });

  it("never carries a stamp across a data change hidden behind the same stamp key order", () => {
    const p = file({ fetchedAt: "2026-10-01", a: 1, b: 2 });
    expect(withPreviousStamp(p, { fetchedAt: "2026-10-28", a: 1, b: 3 }).fetchedAt).toBe("2026-10-28");
  });
});

describe("every vendored-source writer carries its stamp through withPreviousStamp", () => {
  // The writers are scripts with no seam to call them offline (each `--refresh-*` reaches the
  // network), so the wiring is held by the source text: a writer that stamps `new Date()`
  // straight into its JSON is the regression this guards against.
  // The four stamped datasets, by the constant each writer names them with. The core snapshot
  // (`VENDOR` in build-standards) carries no date and is out of scope on purpose.
  const stamped = [
    ["scripts/build-standards.mjs", "VENDOR_UNIVERSE"],
    ["scripts/build-standards.mjs", "VENDOR_FR"],
    ["scripts/build-standards.mjs", "VENDOR_TEXT"],
    ["scripts/build-guidance-wcag.mjs", "VENDOR"],
  ] as const;
  it.each(stamped)("%s writes %s through the helper", (script, name) => {
    const src = readFileSync(new URL(`../${script}`, import.meta.url), "utf8");
    expect(src).toMatch(/from "\.\/vendor-stamp\.mjs"/);
    const writes = src.match(new RegExp(`writeFileSync\\(${name}, [^\n]*`, "g")) ?? [];
    expect(writes.length, `${script} writes ${name} exactly once`).toBe(1);
    expect(writes[0]).toMatch(new RegExp(`JSON\\.stringify\\(withPreviousStamp\\(${name}, `));
  });
});

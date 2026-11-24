// Phase 3 — language-neutral message catalog (src/messages.ts). Verifies: (a) every
// msgId a rule module actually emits resolves in the catalog; (c) no catalog entry
// sits orphaned (never emitted); (b) every entry has fr+en for both message and
// remediation; (d) params interpolate cleanly (no leaked "undefined"); (e) an
// anti-mixing heuristic — the en templates don't read as French and vice versa.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MSG_CATALOG, NOTE_CATALOG, resolveMessage, resolveRemediation, resolveNote, type MsgParams } from "../src/messages.js";
import { parseSource } from "../src/parse/source.js";
import { toFinding } from "../src/rules/rule.js";
import { crossToFinding } from "../src/rules/cross-rule.js";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const RULES_DIR = join(SRC_DIR, "rules");
// rule.ts/cross-rule.ts only *resolve* msgIds (toFinding/crossToFinding); registry.ts
// just wires rules together — none of the three ever emits a literal msgId.
const NON_EMITTING = new Set(["rule.ts", "cross-rule.ts", "registry.ts"]);

/** Every literal `msgId: "…"` in a rule module — a static mirror of the sweep, so this
 *  test fails the moment a rule references a catalog key that doesn't exist (or a
 *  catalog key stops being referenced by any rule). Also covers src/scan.ts's
 *  `mergeDynamic`, the one non-rule emitter (`scan --merge`'s dyn-* findings, built by
 *  hand rather than through toFinding/crossToFinding — see src/messages.ts's
 *  "Dynamic tier" section), whose `Finding.msg` is `{ id: "…" }` (not `msgId:`). */
function emittedMsgIds(): Set<string> {
  const ids = new Set<string>();
  for (const f of readdirSync(RULES_DIR)) {
    if (!f.endsWith(".ts") || NON_EMITTING.has(f)) continue;
    const src = readFileSync(join(RULES_DIR, f), "utf8");
    for (const m of src.matchAll(/msgId:\s*"([^"]+)"/g)) ids.add(m[1]!);
  }
  const scanSrc = readFileSync(join(SRC_DIR, "scan.ts"), "utf8");
  for (const m of scanSrc.matchAll(/\bid:\s*"([^"]+)"/g)) ids.add(m[1]!);
  // The journey replay words its observations through the catalog: `say("journey-…", …)`.
  const journeySrc = readFileSync(join(SRC_DIR, "journey-run.ts"), "utf8");
  for (const m of journeySrc.matchAll(/\bsay\(\s*"([^"]+)"/g)) ids.add(m[1]!);
  return ids;
}

// A Proxy returning a distinct, always-DEFINED placeholder for any property access —
// so a template that reads a param the "fixture" didn't think to set prints a visible
// `<theParam>` token rather than silently interpolating a real `undefined`. This lets
// the "no leaked undefined" check work without hardcoding each entry's param names.
function fakeParams(): MsgParams {
  return new Proxy({}, { get: (_t, prop) => `<${String(prop)}>` }) as MsgParams;
}

const FR_TELLS = [
  /\bAjoutez\b/,
  /\bRenseignez\b/,
  /\bdoit\b/,
  /contraste insuffisant/i,
  /\bDonnez\b/,
  /\bUtilisez\b/,
  /\bRetirez\b/,
  /\bCorrigez\b/,
  /\bPlacez\b/,
  /\bVérifiez\b/,
];
const EN_TELLS = [/\bmust\b/i, /\bshould\b/i, /\bmissing\b/i, /\badd\b/i, /\bremove\b/i, /\bprovide\b/i, /insufficient contrast/i];

// Technical HTML/ARIA tokens stay in English even in French prose (Core rule 6). The
// FR_TELLS/EN_TELLS above catch language MIXING; this catches OVER-translation of code
// tokens into French — the leak the fr catalog must never produce.
const BANNED_FR_TRANSLATIONS = [
  /région live/i,
  /zone live/i,
  /région dynamique/i,
  /index de tabulation/i, // tabindex
  /rôle d'atterrissage/i, // landmark
  /rôle de repère/i, // landmark
  /étiquette aria/i, // aria-label
  /attribut alternatif/i, // alt
];

describe("MSG_CATALOG completeness", () => {
  const catalogIds = new Set(Object.keys(MSG_CATALOG));
  const emitted = emittedMsgIds();

  it("has a catalog entry for every msgId a rule module emits", () => {
    const missing = [...emitted].filter((id) => !catalogIds.has(id));
    expect(missing).toEqual([]);
  });

  it("has no orphan entry (a catalog key no rule module ever emits)", () => {
    const orphans = [...catalogIds].filter((id) => !emitted.has(id));
    expect(orphans).toEqual([]);
  });

  it("the static scan isn't vacuous (sanity floor on the emitted-id count)", () => {
    expect(emitted.size).toBeGreaterThan(50);
    expect(catalogIds.size).toBe(emitted.size);
  });
});

describe.each(Object.entries(MSG_CATALOG))("MSG_CATALOG entry %s", (_id, entry) => {
  it("has fr + en templates for both message and remediation", () => {
    expect(typeof entry.message.fr).toBe("function");
    expect(typeof entry.message.en).toBe("function");
    expect(typeof entry.remediation.fr).toBe("function");
    expect(typeof entry.remediation.en).toBe("function");
  });

  it("interpolates params without leaking a literal 'undefined'", () => {
    const p = fakeParams();
    expect(entry.message.fr(p)).not.toMatch(/undefined/);
    expect(entry.message.en(p)).not.toMatch(/undefined/);
    expect(entry.remediation.fr(p)).not.toMatch(/undefined/);
    expect(entry.remediation.en(p)).not.toMatch(/undefined/);
  });

  it("keeps fr and en apart (anti-mixing heuristic)", () => {
    const p = fakeParams();
    const en = `${entry.message.en(p)} ${entry.remediation.en(p)}`;
    const fr = `${entry.message.fr(p)} ${entry.remediation.fr(p)}`;
    for (const tell of FR_TELLS) expect(en).not.toMatch(tell);
    for (const tell of EN_TELLS) expect(fr).not.toMatch(tell);
  });

  it("does not over-translate technical tokens in French (aria-live stays aria-live, not « région live »)", () => {
    const p = fakeParams();
    const fr = `${entry.message.fr(p)} ${entry.remediation.fr(p)}`;
    for (const banned of BANNED_FR_TRANSLATIONS) expect(fr, `over-translated technical token: ${banned}`).not.toMatch(banned);
  });
});

describe("resolveMessage / resolveRemediation", () => {
  it("resolves through the catalog when `msg` is present and known", () => {
    const f = { message: "STALE", remediation: "STALE", msg: { id: "img-alt-missing", params: { tag: "img" } } };
    expect(resolveMessage(f, "en")).toBe("<img> has no alt attribute or accessible name — missing text alternative.");
    expect(resolveMessage(f, "fr")).toContain("sans attribut alt");
    expect(resolveRemediation(f, "en")).toContain("Add alt=");
    expect(resolveRemediation(f, "fr")).toContain("Ajoutez alt=");
  });

  it("falls back to the baked message/remediation when `msg` is absent (old JSON)", () => {
    const f = { message: "an old baked message", remediation: "an old baked fix" };
    expect(resolveMessage(f, "en")).toBe("an old baked message");
    expect(resolveMessage(f, "fr")).toBe("an old baked message");
    expect(resolveRemediation(f, "fr")).toBe("an old baked fix");
  });

  it("falls back when `msg.id` is unknown (e.g. a renamed/removed rule in old JSON)", () => {
    const f = { message: "baked", remediation: "baked fix", msg: { id: "no-such-rule-anymore" } };
    expect(resolveMessage(f, "fr")).toBe("baked");
    expect(resolveRemediation(f, "en")).toBe("baked fix");
  });
});

describe("NOTE_CATALOG (cross-file RelatedSite.note)", () => {
  const ids = Object.keys(NOTE_CATALOG);

  it("is not empty and has fr + en strings for every entry", () => {
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(typeof NOTE_CATALOG[id]!.fr).toBe("string");
      expect(typeof NOTE_CATALOG[id]!.en).toBe("string");
      expect(NOTE_CATALOG[id]!.fr.length).toBeGreaterThan(0);
      expect(NOTE_CATALOG[id]!.en.length).toBeGreaterThan(0);
    }
  });

  it("keeps fr and en apart (anti-mixing heuristic)", () => {
    for (const id of ids) {
      for (const tell of FR_TELLS) expect(NOTE_CATALOG[id]!.en).not.toMatch(tell);
      for (const tell of EN_TELLS) expect(NOTE_CATALOG[id]!.fr).not.toMatch(tell);
    }
  });
});

describe("resolveNote", () => {
  it("resolves through NOTE_CATALOG when noteId is present and known", () => {
    const related = { note: "STALE", noteId: "related.icon-component-def" };
    expect(resolveNote(related, "en")).toBe("icon-only component definition");
    expect(resolveNote(related, "fr")).toBe("définition du composant à icône seule");
  });

  it("falls back to the baked note when noteId is absent (old JSON)", () => {
    const related = { note: "an old baked note" };
    expect(resolveNote(related, "en")).toBe("an old baked note");
    expect(resolveNote(related, "fr")).toBe("an old baked note");
  });

  it("falls back when noteId is unknown (e.g. a renamed/removed cross rule in old JSON)", () => {
    const related = { note: "baked note", noteId: "no-such-note-anymore" };
    expect(resolveNote(related, "fr")).toBe("baked note");
    expect(resolveNote(related, "en")).toBe("baked note");
  });
});

describe("toFinding / crossToFinding fail loudly on an unknown msgId", () => {
  it("toFinding throws a clear, actionable error", () => {
    const doc = parseSource("<div></div>", "t.html");
    const el = doc.elements[0]!;
    expect(() => toFinding(doc, "some-rule", "majeur", { criteriaId: "1.1.1", el, msgId: "not-a-real-msg-id" })).toThrow(/not in MSG_CATALOG/);
  });

  it("crossToFinding throws a clear, actionable error", () => {
    const doc = parseSource("<div></div>", "t.html");
    const el = doc.elements[0]!;
    expect(() => crossToFinding(doc, "some-cross-rule", "majeur", { criteriaId: "4.1.2", el, msgId: "not-a-real-msg-id" })).toThrow(/not in MSG_CATALOG/);
  });
});

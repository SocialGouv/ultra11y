import { describe, it, expect } from "vitest";
import { validatePack, classifySc } from "../src/standards/validate.js";
import { neutralizeCaptureGroups } from "../src/standards/pack.js";

// A minimal, valid StandardPack to mutate per-case.
function base(): Record<string, unknown> {
  return {
    key: "mypack",
    name: "MyPack",
    org: "Org",
    country: "XX",
    baseVersion: "1.0",
    wcagVersion: "2.2",
    locales: ["en"],
    defaultLocale: "en",
    license: "x",
    source: "https://x",
    attribution: "x",
    idPattern: "^\\d+\\.\\d+$",
    themes: [{ number: 1, name: { en: "Images" }, count: 1 }],
    criteria: [{ id: "1.1", theme: 1, title: { en: "Alt" }, titlePlain: { en: "Alt" }, wcag: ["1.1.1"] }],
  };
}
const errs = (r: ReturnType<typeof validatePack>) => r.issues.filter((i) => i.severity === "error");
const warns = (r: ReturnType<typeof validatePack>) => r.issues.filter((i) => i.severity === "warn");

describe("validatePack", () => {
  it("accepts a clean pack and lower-cases the key", () => {
    const r = validatePack({ ...base(), key: "MyPack" });
    expect(r.ok).toBe(true);
    expect(r.pack?.key).toBe("mypack");
  });

  it("rejects the reserved core key", () => {
    expect(validatePack({ ...base(), key: "wcag" }).ok).toBe(false);
  });

  it("errors on a known-key collision unless allowOverride", () => {
    const known = new Set(["mypack"]);
    expect(validatePack(base(), { knownKeys: known }).ok).toBe(false);
    const overridden = validatePack(base(), { knownKeys: known, allowOverride: true });
    expect(overridden.ok).toBe(true);
    expect(warns(overridden).some((w) => /override/.test(w.message))).toBe(true);
  });

  it("rejects a non-compiling idPattern", () => {
    expect(validatePack({ ...base(), idPattern: "[" }).ok).toBe(false);
  });

  it("rejects an idPattern with a nested quantifier (ReDoS shape)", () => {
    // Classic single-quantified-atom groups, an alternation-under-quantifier (overlapping
    // branches), and a nested-quantifier-over-group — all catastrophic-backtracking shapes.
    for (const bad of ["^(a+)+$", "^(a*)*$", "^(\\d+)+$", "(.*)+", "(a|a)*$", "(ab+)+$"]) {
      const r = validatePack({ ...base(), idPattern: bad });
      expect(r.ok, bad).toBe(false);
      expect(errs(r).some((e) => e.message.toLowerCase().includes("redos") || e.message.toLowerCase().includes("nested quantifier"))).toBe(true);
    }
    // a normal criterion-id grammar (star-height 2, but each iteration anchored by the
    // escaped literal `\.`) is still accepted
    expect(validatePack({ ...base(), idPattern: "^E?\\d+(\\.\\d+)*$" }).ok).toBe(true);
  });

  it("still accepts the non-quantified download-extension alternations in a pack-rule regex", () => {
    // The RGAA download-link rule uses (pdf|docx?|…) alternations whose group is NOT
    // quantified — the ReDoS alternation guard must not over-reject them.
    const okRule = {
      id: "download-link-format",
      criterion: "1.1",
      wcag: ["1.1.1"],
      severity: "mineur",
      advisory: true,
      match: {
        tag: "a",
        attrs: [{ name: "href", op: "matches", value: "\\.(pdf|docx?|pptx?|xlsx?|odt|ods|odp|rtf|csv|zip)(\\?|#|$)" }],
        text: { op: "lacks", value: "(pdf|docx?|\\d+\\s*(ko|mo|go|kb|mb|gb|octets?|bytes?))" },
      },
      message: { en: "m", fr: "m" },
      remediation: { en: "x", fr: "x" },
    };
    expect(validatePack({ ...base(), rules: [okRule] }).ok).toBe(true);
  });

  it("rejects a fabricated SC but only warns on the removed 4.1.1", () => {
    const fabricated = validatePack({ ...base(), criteria: [{ id: "1.1", theme: 1, title: { en: "x" }, titlePlain: { en: "x" }, wcag: ["9.9.9"] }] });
    expect(fabricated.ok).toBe(false);
    const legacy = validatePack({ ...base(), criteria: [{ id: "1.1", theme: 1, title: { en: "x" }, titlePlain: { en: "x" }, wcag: ["4.1.1"] }] });
    expect(legacy.ok).toBe(true);
    expect(warns(legacy).some((w) => w.message.includes("4.1.1"))).toBe(true);
  });

  it("also warns (never errors) on a real WCAG AAA success criterion — not just the removed 4.1.1", () => {
    // 1.4.6 Contrast (Enhanced) is a REAL WCAG AAA criterion, outside the shipped 2.2 AA
    // core: a second pack (EN 301 549, Section 508…) legitimately mapping to it must not
    // be rejected as fabricated — this is the whole point of the SC-universe classifier.
    const r = validatePack({ ...base(), criteria: [{ id: "1.1", theme: 1, title: { en: "x" }, titlePlain: { en: "x" }, wcag: ["1.4.6"] }] });
    expect(r.ok).toBe(true);
    expect(warns(r).some((w) => w.message.includes("1.4.6"))).toBe(true);
  });

  it("errors on a theme count that disagrees with the criteria", () => {
    expect(validatePack({ ...base(), themes: [{ number: 1, name: { en: "Images" }, count: 7 }] }).ok).toBe(false);
  });

  it("errors on duplicate criterion ids and a missing required field", () => {
    const dup = base();
    (dup.criteria as unknown[]).push({ id: "1.1", theme: 1, title: { en: "y" }, titlePlain: { en: "y" }, wcag: ["1.1.1"] });
    (dup.themes as Array<{ count: number }>)[0]!.count = 2;
    expect(errs(validatePack(dup)).some((e) => /duplicate/.test(e.message))).toBe(true);
    const { name: _drop, ...noName } = base();
    expect(validatePack(noName).ok).toBe(false);
  });

  it("accepts an arbitrary idPattern grammar (e.g. Section 508 E205.4) with no gate-compatibility warning", () => {
    // check.ts/verify.ts now build their citation regex FROM the pack's own idPattern
    // (see src/standards/pack.ts idCaptureSource) — any grammar is gate-compatible, so
    // this is no longer a warning-worthy shape.
    const r = validatePack({
      ...base(),
      idPattern: "^E?\\d+(\\.\\d+)*$",
      criteria: [{ id: "E205.4", theme: 1, title: { en: "x" }, titlePlain: { en: "x" }, wcag: ["1.1.1"] }],
    });
    expect(r.ok).toBe(true);
    expect(warns(r)).toHaveLength(0);
  });

  it("warns (not errors) when a pack carries neither fr nor en, and accepts a de-only pack", () => {
    const deOnly = {
      ...base(),
      locales: ["de"],
      defaultLocale: "de",
      themes: [{ number: 1, name: { de: "Bilder" }, count: 1 }],
      criteria: [{ id: "1.1", theme: 1, title: { de: "Alt" }, titlePlain: { de: "Alt" }, wcag: ["1.1.1"] }],
    };
    const r = validatePack(deOnly);
    expect(r.ok).toBe(true);
    expect(warns(r).some((w) => /fr.*en|neither/i.test(w.message))).toBe(true);
  });

  it("errors on a malformed locale tag but accepts any well-formed BCP-47-ish tag", () => {
    const bad = validatePack({ ...base(), locales: ["ENGLISH"], defaultLocale: "ENGLISH" });
    expect(errs(bad).some((e) => e.path === "locales")).toBe(true);
    const good = validatePack({ ...base(), locales: ["pt-BR", "en"], defaultLocale: "en" });
    expect(errs(good).some((e) => e.path === "locales")).toBe(false);
  });

  it("fail-closes malformed or incomplete test-level automation contracts", () => {
    const criterion = {
      id: "1.1",
      theme: 1,
      title: { en: "Alt" },
      titlePlain: { en: "Alt" },
      tests: { "1": ["test one"], "2": ["test two"] },
      wcag: ["1.1.1"],
      appliesTo: { ruleIds: ["img-alt-missing"] },
      automation: {
        tests: { "1": "static" },
        rules: [{ id: "img-alt-missing", tests: ["1"], effect: "decisive-nc" }],
        completeBySilence: true,
      },
    };
    const result = validatePack({ ...base(), criteria: [criterion] });
    expect(result.ok).toBe(false);
    expect(
      errs(result)
        .map((issue) => issue.message)
        .join("\n"),
    ).toMatch(/classify exactly|cannot close by silence/);
  });
});

describe("neutralizeCaptureGroups (idCaptureSource's capturing-group neutralizer)", () => {
  // check.ts/verify.ts embed idCaptureSource(pack) as ONE outer capture group inside a
  // larger positional-capture regex (title/file/line/selector read by index). A pack
  // idPattern that itself contains capturing groups (legal, and validatePack accepts it —
  // see the "arbitrary idPattern grammar" test above) would otherwise shift every
  // downstream index. The neutralizer must strip the pack pattern's OWN capturing groups
  // to non-capturing, while leaving its matching semantics byte-identical.
  const netGroupCount = (source: string, sample: string): number => {
    const m = new RegExp(source).exec(sample);
    return m ? m.length - 1 : -1; // -1 = did not match at all
  };

  it("neutralizes unescaped capturing groups to non-capturing, without changing what the pattern matches", () => {
    const cases: { pattern: string; matches: string[]; rejects: string[] }[] = [
      { pattern: "^E(\\d+)\\.(\\d+)$", matches: ["E205.4", "E12.34"], rejects: ["E205", "F205.4"] },
      { pattern: "^E?\\d+(\\.\\d+)*$", matches: ["205", "E205.4", "205.4.6"], rejects: ["E", "205.", "x1"] },
      { pattern: "\\(literal\\)", matches: ["(literal)", "prefix (literal) suffix"], rejects: ["literal"] },
      { pattern: "^(?:a|b)\\d$", matches: ["a5", "b9"], rejects: ["c5", "a"] },
    ];
    for (const { pattern, matches, rejects } of cases) {
      const neutralized = neutralizeCaptureGroups(pattern);
      for (const s of matches) expect(netGroupCount(neutralized, s)).toBe(0); // zero net capturing groups
      for (const s of [...matches, ...rejects]) expect(new RegExp(neutralized).test(s)).toBe(new RegExp(pattern).test(s)); // same match/reject
    }
  });

  it("leaves a pattern with no capturing groups byte-identical", () => {
    expect(neutralizeCaptureGroups("^\\d+\\.\\d+$")).toBe("^\\d+\\.\\d+$");
    expect(neutralizeCaptureGroups("^E?\\d+$")).toBe("^E?\\d+$");
  });
});

describe("classifySc", () => {
  it("classifies core / out-of-core / removed / unknown / malformed", () => {
    expect(classifySc("1.1.1")).toBe("core");
    expect(classifySc("4.1.1")).toBe("removed");
    expect(classifySc("1.4.6")).toBe("out-of-core"); // Contrast (Enhanced), a real WCAG AAA SC
    expect(classifySc("9.9.9")).toBe("unknown");
    expect(classifySc("1.1")).toBe("malformed");
  });
});

describe("validatePack — declarative rules", () => {
  const okRule = () => ({
    id: "download-link-format",
    criterion: "1.1",
    wcag: ["1.1.1"],
    severity: "mineur",
    advisory: true,
    match: { tag: "a", attrs: [{ name: "href", op: "matches", value: "\\.pdf$" }], text: { op: "lacks", value: "pdf" } },
    message: { en: "m", fr: "m" },
    remediation: { en: "x", fr: "x" },
  });
  const withRule = (over: Record<string, unknown>) => ({ ...base(), rules: [{ ...okRule(), ...over }] });

  it("accepts a well-formed rule", () => {
    expect(validatePack({ ...base(), rules: [okRule()] }).ok).toBe(true);
  });

  it("errors when the reporting criterion does not exist in the pack", () => {
    const r = validatePack(withRule({ criterion: "9.9" }));
    expect(r.ok).toBe(false);
    expect(errs(r).some((e) => /does not exist/.test(e.message))).toBe(true);
  });

  it("errors on a fabricated SC, warns on out-of-core/removed", () => {
    expect(validatePack(withRule({ wcag: ["9.9.9"] })).ok).toBe(false);
    const aaa = validatePack(withRule({ wcag: ["1.4.6"] })); // real AAA — accepted with a warning
    expect(aaa.ok).toBe(true);
    expect(warns(aaa).some((w) => w.message.includes("1.4.6"))).toBe(true);
  });

  it("errors on a ReDoS-shaped or non-compiling regex in attrs.matches and in text", () => {
    expect(validatePack(withRule({ match: { tag: "a", attrs: [{ name: "href", op: "matches", value: "(a+)+" }] } })).ok).toBe(false);
    expect(validatePack(withRule({ match: { tag: "a", text: { op: "matches", value: "(.*)*" } } })).ok).toBe(false);
    expect(validatePack(withRule({ match: { tag: "a", attrs: [{ name: "href", op: "matches", value: "[" }] } })).ok).toBe(false);
  });

  it("errors when a message/remediation language is missing (needs both en and fr)", () => {
    expect(validatePack(withRule({ message: { en: "m" } })).ok).toBe(false);
    expect(validatePack(withRule({ remediation: { fr: "x" } })).ok).toBe(false);
  });

  it("errors when has/lacks nesting exceeds the max depth (3)", () => {
    const tooDeep = { tag: "a", has: [{ tag: "b", has: [{ tag: "c", has: [{ tag: "d" }] }] }] };
    const r = validatePack(withRule({ match: tooDeep }));
    expect(r.ok).toBe(false);
    expect(errs(r).some((e) => /depth/.test(e.message))).toBe(true);
    // exactly the bound (3 levels) is accepted
    const okDepth = { tag: "a", has: [{ tag: "b", has: [{ tag: "c" }] }] };
    expect(validatePack(withRule({ match: okDepth })).ok).toBe(true);
  });

  it("errors on a bad severity, a bad attr op, and a missing value for equals/matches", () => {
    expect(validatePack(withRule({ severity: "critical" })).ok).toBe(false);
    expect(validatePack(withRule({ match: { tag: "a", attrs: [{ name: "href", op: "startsWith", value: "x" }] } })).ok).toBe(false);
    expect(validatePack(withRule({ match: { tag: "a", attrs: [{ name: "href", op: "equals" }] } })).ok).toBe(false);
  });

  it("errors on a non-slug or duplicate rule id", () => {
    expect(validatePack(withRule({ id: "Bad_Id" })).ok).toBe(false);
    const dup = { ...base(), rules: [okRule(), okRule()] };
    expect(errs(validatePack(dup)).some((e) => /duplicate/.test(e.message))).toBe(true);
  });

  it("rejects an empty match (would fire on every element)", () => {
    const r = validatePack(withRule({ match: {} }));
    expect(r.ok).toBe(false);
    expect(errs(r).some((e) => /at least one condition|empty match/.test(e.message))).toBe(true);
  });

  it("rejects a scope-only match (scope is not a condition)", () => {
    const r = validatePack(withRule({ match: { scope: "page" } }));
    expect(r.ok).toBe(false);
    expect(errs(r).some((e) => /at least one condition|empty match/.test(e.message))).toBe(true);
  });

  it("rejects a match with only empty condition arrays", () => {
    expect(validatePack(withRule({ match: { attrs: [] } })).ok).toBe(false);
    expect(validatePack(withRule({ match: { has: [] } })).ok).toBe(false);
  });

  it("rejects an unknown top-level match key (e.g. a typo)", () => {
    const r = validatePack(withRule({ match: { tag: "a", tgo: "x" } }));
    expect(r.ok).toBe(false);
    expect(errs(r).some((e) => /unknown match key/.test(e.message) && /tgo/.test(e.message))).toBe(true);
  });

  it("rejects an unknown key inside a nested has/lacks node", () => {
    const r = validatePack(withRule({ match: { tag: "a", has: [{ tag: "b", bogus: 1 }] } }));
    expect(r.ok).toBe(false);
    expect(errs(r).some((e) => /unknown match key/.test(e.message) && /bogus/.test(e.message))).toBe(true);
  });

  it("accepts a minimal one-condition match (tag only) and the scope modifier alongside a condition", () => {
    expect(validatePack(withRule({ match: { tag: "a" } })).ok).toBe(true);
    expect(validatePack(withRule({ match: { tag: "a", scope: "page" } })).ok).toBe(true);
  });
});

describe("validatePack — normativity/severity overrides", () => {
  const withOverrides = (overrides: unknown) => ({ ...base(), overrides });
  it("accepts a well-formed override", () => {
    expect(validatePack(withOverrides({ "img-alt-missing": { advisory: true, severity: "mineur" } })).ok).toBe(true);
  });
  it("errors on a bad severity or a non-boolean advisory", () => {
    expect(validatePack(withOverrides({ "img-alt-missing": { severity: "critical" } })).ok).toBe(false);
    expect(validatePack(withOverrides({ "img-alt-missing": { advisory: "yes" } })).ok).toBe(false);
  });
  it("errors when overrides is not an object", () => {
    expect(validatePack(withOverrides([])).ok).toBe(false);
  });
  it("warns on an empty override (no effect)", () => {
    const r = validatePack(withOverrides({ "img-alt-missing": {} }));
    expect(r.ok).toBe(true);
    expect(warns(r).some((w) => /no effect/.test(w.message))).toBe(true);
  });
});

describe("validatePack — secondary crosswalk mappings", () => {
  const withSecondary = (secondaryMappings: unknown) => ({ ...base(), secondaryMappings });

  it("accepts a well-formed mapping onto an existing criterion, WITH the intentional-deviation warn", () => {
    const r = validatePack(withSecondary([{ ruleId: "dyn-live-region", criterion: "1.1", note: { en: "also 1.1" }, enabled: false }]));
    expect(r.ok).toBe(true);
    // The deviation is documented (it bypasses the SC crosswalk on purpose).
    expect(warns(r).some((w) => /bypasses the SC crosswalk|intentional deviation/.test(w.message))).toBe(true);
  });

  it("errors when the target criterion does not exist in the pack", () => {
    const r = validatePack(withSecondary([{ ruleId: "dyn-live-region", criterion: "9.9" }]));
    expect(r.ok).toBe(false);
    expect(errs(r).some((e) => /does not exist/.test(e.message))).toBe(true);
  });

  it("errors on a bad shape: non-array, non-object entry, empty ruleId, non-boolean enabled, non-object note", () => {
    expect(validatePack(withSecondary({})).ok).toBe(false);
    expect(validatePack(withSecondary(["nope"])).ok).toBe(false);
    expect(validatePack(withSecondary([{ ruleId: "", criterion: "1.1" }])).ok).toBe(false);
    expect(validatePack(withSecondary([{ ruleId: "r", criterion: "1.1", enabled: "yes" }])).ok).toBe(false);
    expect(validatePack(withSecondary([{ ruleId: "r", criterion: "1.1", note: "flat" }])).ok).toBe(false);
  });

  it("does NOT require the ruleId's SC to be in the criterion's wcag mapping (that bypass is the whole point)", () => {
    // dyn-live-region keys on WCAG 4.1.3; criterion 1.1 maps to 1.1.1 — no shared SC, yet valid.
    const r = validatePack(withSecondary([{ ruleId: "dyn-live-region", criterion: "1.1", enabled: true }]));
    expect(r.ok).toBe(true);
  });
});

describe("validatePack — appliesTo (per-criterion applicability)", () => {
  const withApplies = (appliesTo: unknown) => {
    const b = base();
    (b.criteria as Record<string, unknown>[])[0]!.appliesTo = appliesTo;
    return b;
  };
  it("accepts a well-formed appliesTo", () => {
    expect(validatePack(withApplies({ ruleIds: ["img-alt-missing", "axe:image-alt"] })).ok).toBe(true);
  });
  it("accepts an empty ruleIds list (a criterion no engine rule can evidence)", () => {
    expect(validatePack(withApplies({ ruleIds: [] })).ok).toBe(true);
  });
  it("errors when appliesTo is not an object or ruleIds is not a string array", () => {
    expect(validatePack(withApplies({ ruleIds: "img-alt-missing" })).ok).toBe(false);
    expect(validatePack(withApplies({ ruleIds: [1, 2] })).ok).toBe(false);
    expect(validatePack(withApplies([])).ok).toBe(false);
  });
  it("errors on an empty-string ruleId", () => {
    expect(errs(validatePack(withApplies({ ruleIds: [""] }))).length).toBeGreaterThan(0);
  });
});

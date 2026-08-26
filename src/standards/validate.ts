// Runtime validator for a StandardPack — the deterministic guardrail shared by the
// runtime `--pack` loader (src/config.ts), the `pack check` command (src/pack.ts), and
// the AI-assisted ingestion gate. It promotes the invariants previously only asserted in
// tests/packs.test.ts into one reusable, fail-loud function so an AI-produced (or
// hand-authored) pack cannot fabricate a criterion→SC mapping and slip through. No new
// dependency: pure TS over the bundled types + the WCAG core (`hasSC`).
import type { StandardPack } from "./types.js";
import { hasSC, knownScStatus } from "../wcag.js";

// Mirrors CORE_KEY in registry.ts; inlined to avoid an import cycle (the registry
// imports this validator for registerRuntimePack).
const RESERVED_CORE_KEY = "wcag";
// A pack locale is a BCP-47-ish tag ("fr", "en", "pt-BR", "nl-BE"…) — NOT constrained to
// the UI frame's `Lang` ("fr"|"en"): a pack may legitimately be authored in any language
// (see src/standards/types.ts `LocaleString`).
const LOCALE_SHAPE = /^[a-z]{2,3}(-[a-zA-Z]{2,4})?$/;
const SC_SHAPE = /^\d+\.\d+\.\d+$/; // a WCAG success-criterion id, e.g. "1.4.3"
const RULE_ID_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/; // a declarative pack-rule slug, e.g. "download-link-format"
const SEVERITIES = new Set(["bloquant", "majeur", "mineur"]);
// Depth cap on a declarative rule's has/lacks nesting — the top-level `match` is depth 1;
// each nested has/lacks node adds one. Mirrored by the interpreter (src/standards/pack-rules.ts).
const MAX_MATCH_DEPTH = 3;
const MATCH_OPS = new Set(["present", "absent", "equals", "matches"]);
const TEXT_OPS = new Set(["matches", "lacks"]);
const DOC_OPS = new Set(["absent", "matches", "lacks"]);
// The recognized CONDITION keys of a match node (each constrains which elements fire); a
// node must carry ≥1 so it can never fire on EVERY element. `scope` (top-node only) is an
// applicability modifier, not a condition — a scope-only match is still empty.
const MATCH_CONDITION_KEYS = ["tag", "attrs", "text", "has", "lacks"] as const;
const MATCH_NODE_KEYS = new Set<string>(MATCH_CONDITION_KEYS);

// Catastrophic-backtracking (ReDoS) SHAPES rejected in ANY pack-supplied regex (an
// `idPattern`, an attr `matches`, or a `text` predicate). Untrusted packs are validated at
// load, so we reject conservatively via three complementary red flags — none of which the
// legitimate criterion-id grammar `(\.\d+)*` or the non-quantified download-extension
// alternations `(pdf|docx?|…)` trip:
//
//  1. SINGLE quantified atom, itself quantified — (a+)+ / (a*)* / (\d+)+ / (.*)+ . The
//     classic evil regex; the inner and outer quantifiers match overlapping input.
//  2. An ALTERNATION under a quantifier — (a|a)* / (a|b|c)+ . Overlapping branches let a
//     single input char be matched N ways per iteration → exponential. A NON-quantified
//     alternation (the (pdf|docx?|…) download list, whose group is followed by `(`/end,
//     not by `*`/`+`) is untouched.
//  3. A NESTED quantifier over a GROUP that is itself quantified — (ab+)+ . Defensive:
//     star-height ≥ 2 over a group is a red flag even when a specific instance is linear.
//     The one legitimate star-height-2 shape — the dotted criterion grammar (\.\d+)*, where
//     the escaped-literal prefix anchors every outer iteration so there is no blow-up — is
//     carved out via the leading-backslash negative lookahead.
// Shared by `idPattern` and every declarative pack-rule regex (attrs `matches`, `text`).
const REDOS_SINGLE_ATOM = /\((?:\\.|\[[^\]]*\]|[^()\\])[*+]\)[*+]/;
const REDOS_ALT_QUANTIFIED = /\([^()]*\|[^()]*\)[*+]/;
const REDOS_NESTED_QUANT_GROUP = /\((?![\\])[^()|]*[*+][^()|]*\)[*+]/;

/** True iff a regex STRING trips any catastrophic-backtracking red flag. Reused by both the
 *  `idPattern` guard and the pack-rule regex guard (single shared helper). */
function isRedosShape(pattern: string): boolean {
  return REDOS_SINGLE_ATOM.test(pattern) || REDOS_ALT_QUANTIFIED.test(pattern) || REDOS_NESTED_QUANT_GROUP.test(pattern);
}

/** Validate a regex STRING for a pack: reject the ReDoS shapes and non-compiling patterns.
 *  Returns a human message (to append to a field-specific prefix) or null when safe. */
function regexIssue(pattern: string): string | null {
  if (isRedosShape(pattern))
    return "has a nested quantifier or an ambiguous alternation (e.g. (a+)+, (a|a)*, (ab+)+) — a catastrophic-backtracking (ReDoS) shape; simplify it";
  try {
    new RegExp(pattern);
  } catch (e) {
    return `is not a valid regex: ${(e as Error).message}`;
  }
  return null;
}

/** Classify a WCAG SC id for pack/guidance validation, against the REAL WCAG 2.x
 *  universe (src/wcag.ts `knownScStatus`) — never a single hardcoded tolerated id, so a
 *  second pack (Section 508, EN 301 549…) can legitimately cite an AAA success criterion
 *  or the removed 4.1.1 without the gate having to special-case it. */
export function classifySc(sc: string): "core" | "out-of-core" | "removed" | "malformed" | "unknown" {
  if (!SC_SHAPE.test(sc)) return "malformed";
  if (hasSC(sc)) return "core";
  const status = knownScStatus(sc);
  if (status === "out-of-core" || status === "removed") return status;
  return "unknown";
}
const REQUIRED_STRING_FIELDS = ["key", "name", "org", "country", "baseVersion", "wcagVersion", "license", "source", "attribution", "idPattern"] as const;

export interface PackIssue {
  path: string; // dotted path into the pack, e.g. "criteria[3].wcag[0]" ("" = whole pack)
  message: string;
  severity: "error" | "warn";
}

export interface PackValidation {
  ok: boolean; // false iff there is at least one error-severity issue
  issues: PackIssue[];
  pack?: StandardPack; // the normalized pack (key lower-cased), present only when ok
}

export interface ValidateOpts {
  knownKeys?: ReadonlySet<string>; // built-in + already-registered keys (collision check)
  allowOverride?: boolean; // permit a pack to replace a known key (warns instead of errors)
}

/** Validate an untrusted pack object. Errors block registration; warnings are advisory. */
export function validatePack(raw: unknown, opts: ValidateOpts = {}): PackValidation {
  const issues: PackIssue[] = [];
  const err = (path: string, message: string) => issues.push({ path, message, severity: "error" });
  const warn = (path: string, message: string) => issues.push({ path, message, severity: "warn" });
  const done = (): PackValidation => {
    const ok = !issues.some((x) => x.severity === "error");
    return { ok, issues, pack: ok ? normalize(raw as Record<string, unknown>) : undefined };
  };

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    err("", "pack must be a JSON object");
    return { ok: false, issues };
  }
  const p = raw as Record<string, unknown>;

  for (const f of REQUIRED_STRING_FIELDS) {
    const v = p[f];
    if (typeof v !== "string" || v.trim() === "") err(f, `"${f}" must be a non-empty string`);
  }

  const key = typeof p.key === "string" ? p.key.toLowerCase() : "";
  if (key === RESERVED_CORE_KEY) err("key", `pack key "${RESERVED_CORE_KEY}" is reserved for the WCAG core`);
  if (key && opts.knownKeys?.has(key)) {
    if (opts.allowOverride) warn("key", `pack key "${key}" overrides a built-in/loaded standard`);
    else err("key", `pack key "${key}" collides with a built-in/loaded standard (use --override to replace it)`);
  }

  const locales = Array.isArray(p.locales) ? p.locales : [];
  if (locales.length === 0) err("locales", "locales must be a non-empty array");
  for (const l of locales) {
    if (typeof l !== "string" || !LOCALE_SHAPE.test(l)) err("locales", `malformed locale "${String(l)}" (expected a BCP-47-ish tag, e.g. "en", "fr", "pt-BR")`);
  }
  // A pack need not carry fr/en at all (a "de"-only standard is legitimate — the UI frame
  // falls back to its own generic terms), but it's worth flagging: WARNING, not an error.
  if (locales.length && !locales.some((l) => l === "fr" || l === "en")) {
    warn("locales", 'pack carries neither "fr" nor "en" — the UI frame will fall back to its own generic auditor-display terms');
  }
  const defaultLocale = p.defaultLocale;
  if (typeof defaultLocale !== "string" || !locales.includes(defaultLocale)) {
    err("defaultLocale", "defaultLocale must be one of locales");
  }
  const loc = typeof defaultLocale === "string" ? defaultLocale : ((locales[0] as string | undefined) ?? "en");

  let idRe: RegExp | null = null;
  if (typeof p.idPattern === "string") {
    const bad = regexIssue(p.idPattern);
    if (bad) err("idPattern", `idPattern ${bad}`);
    else idRe = new RegExp(p.idPattern);
  }

  // Optional `criterionUrl` template (src/standards/types.ts StandardPack.criterionUrl).
  // Must be an https URL carrying exactly one `{id}` placeholder: the brief renders the
  // result as a link an adjudicator may follow, so a pack must not be able to point one at
  // an arbitrary scheme, and a template with no placeholder would send every criterion to
  // the same page.
  if (p.criterionUrl !== undefined) {
    const t = p.criterionUrl;
    if (typeof t !== "string" || t.trim() === "") err("criterionUrl", "criterionUrl must be a non-empty string template");
    else if (!t.startsWith("https://")) err("criterionUrl", "criterionUrl must be an https:// URL template");
    else if (!t.includes("{id}")) err("criterionUrl", "criterionUrl must contain the `{id}` placeholder");
  }

  const themes = Array.isArray(p.themes) ? (p.themes as Record<string, unknown>[]) : null;
  if (!themes) err("themes", "themes must be an array");
  const themeNumbers = new Set<number>();
  themes?.forEach((t, i) => {
    const n = t?.number;
    if (typeof n !== "number") {
      err(`themes[${i}].number`, "theme number must be a number");
      return;
    }
    if (themeNumbers.has(n)) err(`themes[${i}].number`, `duplicate theme number ${n}`);
    themeNumbers.add(n);
    const name = t?.name as Record<string, unknown> | undefined;
    if (!name || typeof name[loc] !== "string") err(`themes[${i}].name`, `theme ${n} missing name[${loc}]`);
  });

  const criteria = Array.isArray(p.criteria) ? (p.criteria as Record<string, unknown>[]) : null;
  if (!criteria) err("criteria", "criteria must be an array");
  const ids = new Set<string>();
  const countByTheme = new Map<number, number>();
  criteria?.forEach((c, i) => {
    const id = c?.id;
    if (typeof id !== "string" || id === "") {
      err(`criteria[${i}].id`, "criterion id must be a non-empty string");
    } else {
      if (ids.has(id)) err(`criteria[${i}].id`, `duplicate criterion id "${id}"`);
      ids.add(id);
      if (idRe && !idRe.test(id)) err(`criteria[${i}].id`, `id "${id}" does not match idPattern ${String(p.idPattern)}`);
    }
    const theme = c?.theme;
    if (typeof theme !== "number") {
      err(`criteria[${i}].theme`, "criterion theme must be a number");
    } else {
      if (themes && !themeNumbers.has(theme)) err(`criteria[${i}].theme`, `criterion "${String(id)}" references unknown theme ${theme}`);
      countByTheme.set(theme, (countByTheme.get(theme) ?? 0) + 1);
    }
    const title = c?.title as Record<string, unknown> | undefined;
    if (!title || typeof title[loc] !== "string") err(`criteria[${i}].title`, `criterion "${String(id)}" missing title[${loc}]`);
    const titlePlain = c?.titlePlain as Record<string, unknown> | undefined;
    if (!titlePlain || typeof titlePlain[loc] !== "string") err(`criteria[${i}].titlePlain`, `criterion "${String(id)}" missing titlePlain[${loc}]`);
    // Optional per-criterion applicability (src/standards/types.ts PackCriterion.appliesTo).
    // Present → must be { ruleIds: string[] } of non-empty strings; an empty list is legal
    // (a criterion no engine rule can evidence). Registry-existence of the ruleIds is an
    // advisory `pack check` WARNING (src/pack.ts), not a hard error here.
    if (c?.appliesTo !== undefined) {
      const a = c.appliesTo as Record<string, unknown> | undefined;
      const ruleIds = a && typeof a === "object" && !Array.isArray(a) ? a.ruleIds : undefined;
      if (!a || typeof a !== "object" || Array.isArray(a) || !Array.isArray(ruleIds)) {
        err(`criteria[${i}].appliesTo`, `criterion "${String(id)}" appliesTo must be an object { ruleIds: string[] }`);
      } else {
        (ruleIds as unknown[]).forEach((r, k) => {
          if (typeof r !== "string" || r.trim() === "")
            err(`criteria[${i}].appliesTo.ruleIds[${k}]`, `criterion "${String(id)}" appliesTo.ruleIds must be non-empty strings`);
        });
      }
    }
    // Optional official TEST METHODOLOGY (src/standards/types.ts PackCriterion.methodology).
    // Present → must be a flat { [testKey]: string } whose keys are test numbers this
    // criterion actually declares: a methodology keyed to a test that does not exist would
    // render under nothing, and is either a re-key bug or a fabricated procedure.
    if (c?.methodology !== undefined) {
      const m = c.methodology;
      if (!m || typeof m !== "object" || Array.isArray(m)) {
        err(`criteria[${i}].methodology`, `criterion "${String(id)}" methodology must be an object { [testKey]: string }`);
      } else {
        const tests = c?.tests && typeof c.tests === "object" && !Array.isArray(c.tests) ? (c.tests as Record<string, unknown>) : {};
        for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
          if (typeof v !== "string" || v.trim() === "")
            err(`criteria[${i}].methodology.${k}`, `criterion "${String(id)}" methodology.${k} must be a non-empty string`);
          if (!Object.hasOwn(tests, k))
            err(`criteria[${i}].methodology.${k}`, `criterion "${String(id)}" has a methodology for test ${k}, which it does not declare`);
        }
      }
    }
    // Optional TEST-level automation contract. When present it is total and fail-closed:
    // every declared test is classified exactly once, every applicable rule is described,
    // and silence may prove C only when every test has a decisive instrument.
    if (c?.automation !== undefined) {
      const a = c.automation as Record<string, unknown> | undefined;
      const testDefs = c?.tests && typeof c.tests === "object" && !Array.isArray(c.tests) ? (c.tests as Record<string, unknown>) : {};
      const tiers = a && typeof a === "object" && !Array.isArray(a) ? a.tests : undefined;
      const rules = a && typeof a === "object" && !Array.isArray(a) ? a.rules : undefined;
      if (!a || typeof a !== "object" || Array.isArray(a) || !tiers || typeof tiers !== "object" || Array.isArray(tiers) || !Array.isArray(rules)) {
        err(`criteria[${i}].automation`, `criterion "${String(id)}" automation must contain { tests: object, rules: array }`);
      } else {
        const tierMap = tiers as Record<string, unknown>;
        const declaredTests = Object.keys(testDefs).sort();
        const classifiedTests = Object.keys(tierMap).sort();
        if (declaredTests.join("\0") !== classifiedTests.join("\0"))
          err(`criteria[${i}].automation.tests`, `criterion "${String(id)}" must classify exactly its declared tests (${declaredTests.join(", ")})`);
        for (const [test, tier] of Object.entries(tierMap))
          if (!(["static", "rendered", "judgment"] as unknown[]).includes(tier))
            err(`criteria[${i}].automation.tests.${test}`, `criterion "${String(id)}" has unknown automation tier "${String(tier)}"`);

        const applicable = new Set(
          c?.appliesTo && typeof c.appliesTo === "object" && !Array.isArray(c.appliesTo) && Array.isArray((c.appliesTo as Record<string, unknown>).ruleIds)
            ? ((c.appliesTo as Record<string, unknown>).ruleIds as unknown[]).filter((value): value is string => typeof value === "string")
            : [],
        );
        const described = new Set<string>();
        const decisiveByTest = new Set<string>();
        (rules as unknown[]).forEach((entry, k) => {
          const rule = entry as Record<string, unknown> | undefined;
          const rid = rule?.id;
          const refs = rule?.tests;
          const effect = rule?.effect;
          if (
            !rule ||
            typeof rule !== "object" ||
            Array.isArray(rule) ||
            typeof rid !== "string" ||
            !Array.isArray(refs) ||
            !["decisive-nc", "candidate", "advisory"].includes(String(effect))
          ) {
            err(`criteria[${i}].automation.rules[${k}]`, `criterion "${String(id)}" automation rule is malformed`);
            return;
          }
          if (described.has(rid)) err(`criteria[${i}].automation.rules[${k}].id`, `criterion "${String(id)}" describes rule "${rid}" twice`);
          described.add(rid);
          if (!applicable.has(rid)) err(`criteria[${i}].automation.rules[${k}].id`, `criterion "${String(id)}" describes non-applicable rule "${rid}"`);
          for (const ref of refs) {
            if (typeof ref !== "string" || !Object.hasOwn(testDefs, ref))
              err(`criteria[${i}].automation.rules[${k}].tests`, `criterion "${String(id)}" rule "${rid}" cites unknown test "${String(ref)}"`);
            else if (effect === "decisive-nc") decisiveByTest.add(ref);
          }
        });
        for (const rid of applicable)
          if (!described.has(rid)) err(`criteria[${i}].automation.rules`, `criterion "${String(id)}" does not classify applicable rule "${rid}"`);
        for (const test of declaredTests) {
          const tier = tierMap[test];
          if ((tier === "static" || tier === "rendered") && !decisiveByTest.has(test)) {
            err(
              `criteria[${i}].automation.tests.${test}`,
              `criterion "${String(id)}" classifies test ${test} as ${String(tier)} without an explicitly mapped decisive-nc rule`,
            );
          }
          if (tier === "judgment" && decisiveByTest.has(test)) {
            err(
              `criteria[${i}].automation.tests.${test}`,
              `criterion "${String(id)}" classifies test ${test} as judgment even though a decisive-nc rule targets it`,
            );
          }
        }
        if (a.completeBySilence === true) {
          const missing = declaredTests.filter((test) => tierMap[test] === "judgment" || !decisiveByTest.has(test));
          if (missing.length)
            err(
              `criteria[${i}].automation.completeBySilence`,
              `criterion "${String(id)}" cannot close by silence; tests without decisive coverage: ${missing.join(", ")}`,
            );
        } else if (a.completeBySilence !== undefined && typeof a.completeBySilence !== "boolean") {
          err(`criteria[${i}].automation.completeBySilence`, `criterion "${String(id)}" completeBySilence must be boolean`);
        }
      }
    }
    const wcag = Array.isArray(c?.wcag) ? (c.wcag as unknown[]) : null;
    if (!wcag || wcag.length === 0) {
      err(`criteria[${i}].wcag`, `criterion "${String(id)}" must map to at least one WCAG SC`);
    } else {
      wcag.forEach((sc, j) => {
        const where = `criteria[${i}].wcag[${j}]`;
        if (typeof sc !== "string") {
          err(where, `malformed SC id "${String(sc)}" (expected N.N.N)`);
          return;
        }
        switch (classifySc(sc)) {
          case "malformed":
            err(where, `malformed SC id "${sc}" (expected N.N.N)`);
            break;
          case "unknown":
            err(
              where,
              `SC "${sc}" is not a recognized WCAG success criterion (not in the WCAG 2.2 AA core, and not a real WCAG AAA or removed SC) — fabricated?`,
            );
            break;
          case "out-of-core":
            warn(
              where,
              `SC "${sc}" is a real WCAG AAA success criterion, outside the WCAG 2.2 AA core — kept as a pack-local mapping (out of engine scope; derive as manual)`,
            );
            break;
          case "removed":
            warn(
              where,
              `SC "${sc}" is a real but removed WCAG success criterion (obsolete) — kept as a pack-local mapping (out of engine scope; derive as manual)`,
            );
            break;
        }
      });
    }
  });

  themes?.forEach((t, i) => {
    const n = t?.number;
    if (typeof n !== "number") return;
    const declared = t?.count;
    const actual = countByTheme.get(n) ?? 0;
    if (typeof declared === "number" && declared !== actual) {
      err(`themes[${i}].count`, `theme ${n} declares count ${declared} but has ${actual} criteria`);
    }
  });

  // Optional auditor-display vocabulary. Absent → the generic/core defaults apply (never an
  // error). Present → each supplied term must be a LocaleString carrying at least the default
  // locale; a partial/unknown/malformed term is a WARNING (the default is used), never a hard
  // failure — a pack should not be blocked over presentation strings.
  if (p.vocabulary !== undefined) {
    if (typeof p.vocabulary !== "object" || p.vocabulary === null || Array.isArray(p.vocabulary)) {
      warn("vocabulary", "vocabulary must be an object of localized terms — ignored");
    } else {
      const VOC_KEYS = ["theme", "criterion", "test", "conformant", "nonConformant", "notApplicable", "auditorHeading", "normativeNote"];
      const voc = p.vocabulary as Record<string, unknown>;
      for (const k of Object.keys(voc)) {
        if (!VOC_KEYS.includes(k)) {
          warn(`vocabulary.${k}`, `unknown vocabulary term "${k}" (ignored)`);
          continue;
        }
        const term = voc[k] as Record<string, unknown> | undefined;
        if (typeof term !== "object" || term === null || Array.isArray(term)) {
          warn(`vocabulary.${k}`, `term "${k}" must be a localized object (e.g. { "${loc}": "…" }) — default used`);
        } else if (typeof term[loc] !== "string") {
          warn(`vocabulary.${k}`, `term "${k}" has no string for the default locale "${loc}" — default used`);
        }
      }
    }
  }

  // Optional normative page-sample methodology (src/standards/types.ts SampleMethodology).
  // Purely ADVISORY (drives `sample check` / `scan --sample` lint), so a malformation is a
  // WARNING and the field is ignored — never a hard failure that blocks the pack from
  // deriving reports. Mirrors the vocabulary block's tolerance above.
  if (p.sampleMethodology !== undefined) {
    const m = p.sampleMethodology as Record<string, unknown> | null;
    const kinds = m && typeof m === "object" && !Array.isArray(m) ? m.requiredKinds : undefined;
    if (!m || typeof m !== "object" || Array.isArray(m) || !Array.isArray(kinds)) {
      warn("sampleMethodology", "sampleMethodology must be an object { requiredKinds: [...] } — ignored");
    } else {
      (kinds as unknown[]).forEach((k, i) => {
        const kk = k as Record<string, unknown> | null;
        if (!kk || typeof kk !== "object" || Array.isArray(kk)) {
          warn(`sampleMethodology.requiredKinds[${i}]`, "each required kind must be an object { id, label, keywords } — ignored");
          return;
        }
        if (typeof kk.id !== "string" || kk.id.trim() === "") warn(`sampleMethodology.requiredKinds[${i}].id`, "required kind id should be a non-empty string");
        const label = kk.label as Record<string, unknown> | undefined;
        if (!label || typeof label !== "object" || Array.isArray(label) || typeof label[loc] !== "string")
          warn(`sampleMethodology.requiredKinds[${i}].label`, `required kind should carry label[${loc}]`);
        if (!Array.isArray(kk.keywords) || (kk.keywords as unknown[]).some((w) => typeof w !== "string"))
          warn(`sampleMethodology.requiredKinds[${i}].keywords`, "required kind keywords should be an array of strings");
      });
    }
  }

  // ---- Declarative pack RULES (src/standards/types.ts PackRule). Optional; when present,
  // each rule is bounded, self-contained data (NO code): a slug id, a criterion that must
  // exist in THIS pack, WCAG SC(s) in the core universe, a matcher whose regexes are
  // ReDoS-guarded and whose has/lacks nesting is depth-capped, and en+fr message/remediation.
  if (p.rules !== undefined) {
    if (!Array.isArray(p.rules)) {
      err("rules", "rules must be an array");
    } else {
      const ruleIds = new Set<string>();
      (p.rules as unknown[]).forEach((raw, i) => {
        const at = `rules[${i}]`;
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
          err(at, "each rule must be an object");
          return;
        }
        const r = raw as Record<string, unknown>;
        const rid = r.id;
        if (typeof rid !== "string" || !RULE_ID_SHAPE.test(rid)) {
          err(`${at}.id`, 'rule id must be a lower-kebab slug (e.g. "download-link-format")');
        } else {
          if (ruleIds.has(rid)) err(`${at}.id`, `duplicate rule id "${rid}"`);
          ruleIds.add(rid);
        }
        if (typeof r.criterion !== "string" || r.criterion === "") {
          err(`${at}.criterion`, "rule criterion must be a non-empty string");
        } else if (!ids.has(r.criterion)) {
          err(`${at}.criterion`, `rule reports under criterion "${r.criterion}" which does not exist in this pack`);
        }
        if (typeof r.severity !== "string" || !SEVERITIES.has(r.severity)) {
          err(`${at}.severity`, "rule severity must be one of bloquant|majeur|mineur");
        }
        if (r.advisory !== undefined && typeof r.advisory !== "boolean") err(`${at}.advisory`, "rule advisory must be a boolean");
        const wcag = Array.isArray(r.wcag) ? (r.wcag as unknown[]) : null;
        if (!wcag || wcag.length === 0) {
          err(`${at}.wcag`, "rule must map to at least one WCAG SC");
        } else {
          wcag.forEach((sc, j) => {
            const where = `${at}.wcag[${j}]`;
            if (typeof sc !== "string") {
              err(where, `malformed SC id "${String(sc)}" (expected N.N.N)`);
              return;
            }
            switch (classifySc(sc)) {
              case "malformed":
                err(where, `malformed SC id "${sc}" (expected N.N.N)`);
                break;
              case "unknown":
                err(where, `SC "${sc}" is not a recognized WCAG success criterion — fabricated?`);
                break;
              case "out-of-core":
                warn(where, `SC "${sc}" is a real WCAG AAA success criterion, outside the WCAG 2.2 AA core (out of engine scope)`);
                break;
              case "removed":
                warn(where, `SC "${sc}" is a real but removed WCAG success criterion (obsolete)`);
                break;
            }
          });
          // The declared SC must be one the reporting criterion maps to, else the finding
          // can never project onto it (inert) — advisory, mirrors the guidance check.
          if (typeof r.criterion === "string") {
            const crit = criteria?.find((c) => c.id === r.criterion) as Record<string, unknown> | undefined;
            const critWcag = Array.isArray(crit?.wcag) ? (crit!.wcag as unknown[]) : [];
            if (critWcag.length && !wcag.some((sc) => critWcag.includes(sc)))
              warn(`${at}.wcag`, `none of the rule's SC(s) are in criterion ${String(r.criterion)}'s WCAG mapping — the finding will not project`);
          }
        }
        // A rule answers a question about an ELEMENT or one about the DOCUMENT, never both:
        // `doc` has no element to select and anchors on the root, so a `match` beside it would
        // silently decide nothing. Refusing the pair keeps the two paths from ever overlapping.
        if (r.doc !== undefined && r.match !== undefined)
          err(at, "rule carries both match and doc — a rule selects elements, or reads a document signal, not both");
        if (r.doc !== undefined) validateDocMatch(r.doc, `${at}.doc`, err);
        else validateMatch(r.match, `${at}.match`, 1, err, true);
        validateLocaleText(r.message, `${at}.message`, err);
        validateLocaleText(r.remediation, `${at}.remediation`, err);
      });
    }
  }

  // ---- Per-pack normativity/severity OVERRIDES (src/standards/types.ts PackOverride).
  // Optional map keyed by a finding ruleId; each value flips advisory and/or re-grades
  // severity within the pack projection only. Shape-checked here; ruleId existence is an
  // advisory `pack check` concern (a pack may target a future/renamed rule).
  if (p.overrides !== undefined) {
    if (typeof p.overrides !== "object" || p.overrides === null || Array.isArray(p.overrides)) {
      err("overrides", "overrides must be an object keyed by ruleId");
    } else {
      for (const [ruleId, raw] of Object.entries(p.overrides as Record<string, unknown>)) {
        const at = `overrides["${ruleId}"]`;
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
          err(at, "each override must be an object { advisory?, severity? }");
          continue;
        }
        const o = raw as Record<string, unknown>;
        if (o.advisory !== undefined && typeof o.advisory !== "boolean") err(`${at}.advisory`, "override advisory must be a boolean");
        if (o.severity !== undefined && (typeof o.severity !== "string" || !SEVERITIES.has(o.severity)))
          err(`${at}.severity`, "override severity must be one of bloquant|majeur|mineur");
        if (o.advisory === undefined && o.severity === undefined) warn(at, "override has neither advisory nor severity — no effect");
      }
    }
  }

  // ---- Secondary crosswalk MAPPINGS (src/standards/types.ts SecondaryMapping). Optional
  // array; each entry projects a ruleId onto an ADDITIONAL pack criterion whose WCAG
  // crosswalk does NOT contain the finding's SC — a DELIBERATE, opt-in deviation. Shape:
  // non-empty `ruleId`; a `criterion` that MUST exist in this pack (like a declarative
  // rule's reporting criterion); an optional localized `note`; an optional boolean
  // `enabled`. We DELIBERATELY do NOT require the finding's SC to be in the criterion's
  // `wcag` — that bypass is the whole point — so every well-formed entry gets a `warn`
  // documenting the intentional deviation. Runs for built-in AND runtime packs.
  if (p.secondaryMappings !== undefined) {
    if (!Array.isArray(p.secondaryMappings)) {
      err("secondaryMappings", "secondaryMappings must be an array");
    } else {
      (p.secondaryMappings as unknown[]).forEach((raw, i) => {
        const at = `secondaryMappings[${i}]`;
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
          err(at, "each secondary mapping must be an object { ruleId, criterion, note?, enabled? }");
          return;
        }
        const m = raw as Record<string, unknown>;
        if (typeof m.ruleId !== "string" || m.ruleId.trim() === "") err(`${at}.ruleId`, "secondary mapping ruleId must be a non-empty string");
        if (typeof m.criterion !== "string" || m.criterion === "") {
          err(`${at}.criterion`, "secondary mapping criterion must be a non-empty string");
        } else if (!ids.has(m.criterion)) {
          err(`${at}.criterion`, `secondary mapping projects onto criterion "${m.criterion}" which does not exist in this pack`);
        }
        if (m.enabled !== undefined && typeof m.enabled !== "boolean") err(`${at}.enabled`, "secondary mapping enabled must be a boolean");
        if (m.note !== undefined) {
          if (typeof m.note !== "object" || m.note === null || Array.isArray(m.note)) {
            err(`${at}.note`, `secondary mapping note must be a localized object (e.g. { "${loc}": "…" })`);
          } else if (typeof (m.note as Record<string, unknown>)[loc] !== "string") {
            warn(`${at}.note`, `secondary mapping note has no string for the default locale "${loc}"`);
          }
        }
        // Only a well-formed entry (ruleId present, criterion exists) documents the deviation.
        if (typeof m.ruleId === "string" && m.ruleId.trim() !== "" && typeof m.criterion === "string" && ids.has(m.criterion)) {
          warn(at, `secondary mapping bypasses the SC crosswalk — intentional deviation (ruleId "${m.ruleId}" → criterion "${m.criterion}")`);
        }
      });
    }
  }

  return done();
}

type Emit = (path: string, message: string) => void;

/** Validate a DOCUMENT-LEVEL signal predicate (src/standards/types.ts MatchDoc). Small on
 *  purpose: the signal names are a closed set, because each one has to be plumbed through the
 *  audit fold and the page-coverage record before a rule may read it. An unknown name is an
 *  error rather than an inert rule — a pack whose rule silently never runs is worse than one
 *  that refuses to load. */
function validateDocMatch(raw: unknown, path: string, err: Emit): void {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    err(path, "doc must be an object");
    return;
  }
  const d = raw as Record<string, unknown>;
  for (const k of Object.keys(d)) {
    if (k !== "signal" && k !== "op" && k !== "value") err(`${path}.${k}`, `unknown doc key "${k}" (allowed: op, signal, value)`);
  }
  if (d.signal !== "doctype") err(`${path}.signal`, `unknown document signal "${String(d.signal)}" (allowed: doctype)`);
  if (typeof d.op !== "string" || !DOC_OPS.has(d.op)) err(`${path}.op`, "doc op must be one of absent|matches|lacks");
  if (d.op === "matches" || d.op === "lacks") {
    if (typeof d.value !== "string" || d.value === "") err(`${path}.value`, `doc op "${String(d.op)}" requires a regex string value`);
    else {
      const bad = regexIssue(d.value);
      if (bad) err(`${path}.value`, `doc regex ${bad}`);
    }
  } else if (d.value !== undefined) {
    err(`${path}.value`, 'doc op "absent" takes no value');
  }
}

/** Recursively validate a declarative rule's match node: bounded depth, known ops,
 *  ReDoS-safe regexes. `top` marks the outermost node (which may carry `scope`). */
function validateMatch(node: unknown, path: string, depth: number, err: Emit, top: boolean): void {
  if (top && node === undefined) {
    err(path, "rule must carry a match");
    return;
  }
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    err(path, "match must be an object");
    return;
  }
  if (depth > MAX_MATCH_DEPTH) {
    err(path, `match nesting exceeds the maximum depth of ${MAX_MATCH_DEPTH}`);
    return;
  }
  const n = node as Record<string, unknown>;
  // Reject unknown keys — a typo like { tgo: "a" } would otherwise be silently ignored and
  // the (now condition-less) match would fire on every element.
  const allowedKeys = top ? new Set([...MATCH_NODE_KEYS, "scope"]) : MATCH_NODE_KEYS;
  for (const k of Object.keys(n)) {
    if (!allowedKeys.has(k)) err(`${path}.${k}`, `unknown match key "${k}" (allowed: ${[...allowedKeys].sort().join(", ")})`);
  }
  // Require ≥1 EFFECTIVE condition (an empty match — or one with only empty arrays / a bare
  // scope — fires on every element, a footgun).
  const hasCondition = MATCH_CONDITION_KEYS.some((k) => {
    const v = n[k];
    if (k === "tag") return typeof v === "string" && v !== "";
    if (k === "text") return v !== undefined && v !== null;
    return Array.isArray(v) && v.length > 0; // attrs / has / lacks
  });
  if (!hasCondition) err(path, "match must carry at least one condition (tag, attrs, text, has, or lacks) — an empty match fires on every element");
  if (n.tag !== undefined && (typeof n.tag !== "string" || n.tag === "")) err(`${path}.tag`, "match tag must be a non-empty string");
  if (top && n.scope !== undefined && n.scope !== "page" && n.scope !== "fragment") err(`${path}.scope`, 'match scope must be "page" or "fragment"');
  if (n.attrs !== undefined) {
    if (!Array.isArray(n.attrs)) err(`${path}.attrs`, "match attrs must be an array");
    else
      (n.attrs as unknown[]).forEach((raw, i) => {
        const a = raw as Record<string, unknown> | null;
        const at = `${path}.attrs[${i}]`;
        if (!a || typeof a !== "object" || Array.isArray(a)) {
          err(at, "each attr condition must be an object { name, op, value? }");
          return;
        }
        if (typeof a.name !== "string" || a.name === "") err(`${at}.name`, "attr name must be a non-empty string");
        if (typeof a.op !== "string" || !MATCH_OPS.has(a.op)) err(`${at}.op`, "attr op must be one of present|absent|equals|matches");
        if ((a.op === "equals" || a.op === "matches") && typeof a.value !== "string") err(`${at}.value`, `attr op "${String(a.op)}" requires a string value`);
        if (a.op === "matches" && typeof a.value === "string") {
          const bad = regexIssue(a.value);
          if (bad) err(`${at}.value`, `attr matches regex ${bad}`);
        }
      });
  }
  if (n.text !== undefined) {
    const t = n.text as Record<string, unknown> | null;
    if (!t || typeof t !== "object" || Array.isArray(t)) {
      err(`${path}.text`, "match text must be an object { op, value }");
    } else {
      if (typeof t.op !== "string" || !TEXT_OPS.has(t.op)) err(`${path}.text.op`, "text op must be one of matches|lacks");
      if (typeof t.value !== "string" || t.value === "") err(`${path}.text.value`, "text value must be a non-empty regex string");
      else {
        const bad = regexIssue(t.value);
        if (bad) err(`${path}.text.value`, `text regex ${bad}`);
      }
    }
  }
  for (const key of ["has", "lacks"] as const) {
    const v = n[key];
    if (v === undefined) continue;
    if (!Array.isArray(v)) err(`${path}.${key}`, `match ${key} must be an array of match nodes`);
    else (v as unknown[]).forEach((child, i) => validateMatch(child, `${path}.${key}[${i}]`, depth + 1, err, false));
  }
}

/** A rule's message/remediation must carry BOTH en and fr (findings render in the UI
 *  frame's Lang, which is fr|en) — stricter than a pack's own free-form LocaleString. */
function validateLocaleText(v: unknown, path: string, err: Emit): void {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    err(path, "must be a localized object carrying both en and fr");
    return;
  }
  const t = v as Record<string, unknown>;
  for (const lang of ["en", "fr"] as const) {
    if (typeof t[lang] !== "string" || t[lang] === "") err(`${path}.${lang}`, `missing ${lang} text`);
  }
}

function normalize(p: Record<string, unknown>): StandardPack {
  return { ...p, key: String(p.key).toLowerCase() } as unknown as StandardPack;
}

/** Format issues for CLI output (one line each, errors first). */
export function formatIssues(issues: PackIssue[]): string[] {
  const order = (s: PackIssue["severity"]) => (s === "error" ? 0 : 1);
  return [...issues]
    .sort((a, b) => order(a.severity) - order(b.severity))
    .map((x) => `  ${x.severity === "error" ? "✗" : "⚠"} ${x.path ? `${x.path}: ` : ""}${x.message}`);
}

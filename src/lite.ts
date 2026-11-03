// THE LITE GATE: rendered regressions on a pull request, for the price of the engine alone.
//
// `findingId` (src/baseline.ts) keys a finding on its source byte range. That is the right
// identity for a source file and the wrong one for a rendered snapshot: a page's serialized DOM
// moves every time anything above an element changes — a banner, a menu entry, a hydration
// marker — and every finding below it gets a new byte range. A baseline keyed on it reads an
// unchanged page as a page full of NEW non-conformities, and a gate that cries wolf on every pull
// request is a gate somebody turns off.
//
// So the regression gate keys on what a reviewer would call "the same defect": the page it is on,
// the rule, the criterion, and the element's selector with its generated parts folded away. That
// key is deliberately COARSE — two `img` without alt on one page share it — so the baseline is a
// MULTISET: a page that had two and now has three has one new finding, whichever it is.
//
// It lives beside `findingId`, never instead of it. The verdict ledger, SARIF fingerprints of the
// full run and the legacy `--baseline` all depend on `findingId` and stay untouched.
import { snapshotPageId } from "./snapshot.js";
import { findingsForStandard } from "./standards/derive.js";
import { unwrapAudit } from "./standards/document.js";
import type { AuditResult, Finding, Lang, Severity } from "./types.js";
import { VERSION } from "./types.js";

export const RENDER_BASELINE_KIND = "ultra11y-render-baseline";
const RANK: Record<Severity, number> = { bloquant: 0, majeur: 1, mineur: 2 };

/** A page's findings, folded to `regressionKey → occurrences`. */
export type PageCounts = Record<string, number>;

export interface RenderBaseline {
  tool: "ultra11y";
  kind: typeof RENDER_BASELINE_KIND;
  schemaVersion: 1;
  /** The engine that wrote it. A different engine raises different findings on the same page,
   *  so a mismatch turns the comparison into a warning (see `diffRenderBaseline`). */
  version: string;
  date: string;
  standard: string;
  /** Every page this baseline AUDITED, clean ones included (`{}`): a page absent from this map was
   *  never measured, which is a different statement from a page with nothing wrong on it. */
  pages: Record<string, PageCounts>;
}

// Generated identifiers a framework puts in ids and class names. They differ between two renders
// of the same component, so a selector carrying one is not an identity.
const REACT_ID = [/:r[0-9a-z]+:/g, /«r[0-9a-z]+»/g, /_r_[0-9a-z]+_/g];

/** The selector with its generated parts folded away: React `useId` values, hash-like tokens
 *  (`css-1q2w3e`), and every run of digits (`nth-child(3)`, `/entreprise/123`). The tag name is
 *  kept verbatim — `h1` and `h2` are not the same element. */
export function normalizeSelector(selector: string): string {
  const s = selector.trim().toLowerCase();
  const cut = s.search(/[#.[:\s>]/);
  const tag = cut === -1 ? s : s.slice(0, cut);
  let rest = cut === -1 ? "" : s.slice(cut);
  for (const re of REACT_ID) rest = rest.replace(re, ":r:");
  rest = rest.replace(/[a-z0-9]+/g, (t) => (t.length >= 5 && /\d/.test(t) && /[a-z]/.test(t) ? "~" : t.replace(/\d+/g, "0")));
  return tag + rest;
}

/** The page a rendered finding belongs to: the snapshot provenance, else the snapshot path. */
export function findingPage(f: Finding): string {
  return f.page ?? snapshotPageId(f.file) ?? f.file.split("\\").join("/");
}

/** `page|rule|criterion|normalized selector` — the identity of a rendered defect. */
export function regressionKey(f: Finding): string {
  return `${findingPage(f)}|${f.ruleId}|${f.criteriaId}|${normalizeSelector(f.selectorHint)}`;
}

/** Only normative findings take part: an advisory recommendation can never flip a criterion to
 *  non-conforming, so it has nothing to regress. */
export function gatedFindings(findings: Finding[]): Finding[] {
  return findings.filter((f) => !f.advisory);
}

function countByKey(findings: Finding[]): Map<string, Finding[]> {
  const out = new Map<string, Finding[]>();
  for (const f of findings) {
    const k = regressionKey(f);
    const list = out.get(k);
    if (list) list.push(f);
    else out.set(k, [f]);
  }
  return out;
}

export function buildRenderBaseline(findings: Finding[], pages: string[], standard: string, date = new Date().toISOString().slice(0, 10)): RenderBaseline {
  const out: Record<string, PageCounts> = {};
  for (const id of [...pages].sort()) out[id] = {};
  for (const [key, list] of [...countByKey(gatedFindings(findings))].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const page = key.slice(0, key.indexOf("|"));
    (out[page] ??= {})[key] = list.length;
  }
  return { tool: "ultra11y", kind: RENDER_BASELINE_KIND, schemaVersion: 1, version: VERSION, date, standard, pages: out };
}

/** Read a render baseline. An AUDIT document is accepted too — its findings are folded onto the
 *  stable key — so a full run's `audit-latest.json` can seed the lite gate. `null` when neither. */
export function parseRenderBaseline(raw: unknown, standard = "wcag"): RenderBaseline | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === RENDER_BASELINE_KIND && typeof r.pages === "object" && r.pages !== null) {
    const pages: Record<string, PageCounts> = {};
    for (const [id, counts] of Object.entries(r.pages as Record<string, unknown>)) {
      if (typeof counts !== "object" || counts === null) continue;
      const c: PageCounts = {};
      for (const [k, n] of Object.entries(counts as Record<string, unknown>)) if (typeof n === "number" && n > 0) c[k] = n;
      pages[id] = c;
    }
    return {
      tool: "ultra11y",
      kind: RENDER_BASELINE_KIND,
      schemaVersion: 1,
      version: typeof r.version === "string" ? r.version : "unknown",
      date: typeof r.date === "string" ? r.date : "",
      standard: typeof r.standard === "string" ? r.standard : standard,
      pages,
    };
  }
  const doc = unwrapAudit(raw) as unknown as Record<string, unknown>;
  if (doc.tool === "ultra11y" && Array.isArray(doc.findings)) {
    const findings = findingsForStandard(doc as unknown as AuditResult, standard);
    const scope = (doc.scope ?? {}) as { pagesAudited?: unknown };
    const audited = Array.isArray(scope.pagesAudited) ? (scope.pagesAudited as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const pages = [...new Set([...audited, ...findings.map(findingPage)])];
    const b = buildRenderBaseline(findings, pages, standard, typeof doc.date === "string" ? doc.date : "");
    return { ...b, version: typeof doc.version === "string" ? doc.version : "unknown" };
  }
  return null;
}

export interface RenderDiff {
  /** Pages this run audited. */
  pages: string[];
  failOn: Severity;
  /** Occurrences the baseline does not account for, on pages the baseline measured. */
  newFindings: Finding[];
  /** The part of `newFindings` at or above `failOn` — what fails the gate. */
  blocking: Finding[];
  /** Occurrences the baseline had and this run no longer finds, on the pages it audited. */
  fixed: number;
  /** Audited pages absent from a baseline that is a valid REFERENCE (same engine, the merge-base's
   *  own, at least one page): the baseline measured every sample page, so these were introduced by
   *  the change. Their findings are all new and gate — the page is judged with no reference. */
  newPages: string[];
  /** Audited pages the baseline cannot speak for (no baseline, another engine, an approximate
   *  baseline): their findings cannot be told new from old. */
  pagesWithoutBaseline: string[];
  /** Findings on those pages, reported as warnings and never failing. */
  unbaselined: Finding[];
  /** Set when the baseline is not the merge-base's own (the closest cache entry by prefix). */
  approximate: boolean;
  /** Set when the baseline was written by another engine version. */
  versionMismatch?: { baseline: string; current: string };
  /** No baseline at all — first run, or a cache miss. */
  noBaseline: boolean;
  ok: boolean;
}

export function diffRenderBaseline(
  findings: Finding[],
  pages: string[],
  baseline: RenderBaseline | null,
  failOn: Severity = "bloquant",
  version: string = VERSION,
  opts: { approximate?: boolean } = {},
): RenderDiff {
  const current = countByKey(gatedFindings(findings));
  const newFindings: Finding[] = [];
  const unbaselined: Finding[] = [];
  const without = new Set<string>();
  const fresh = new Set<string>();
  let fixed = 0;
  const audited = new Set(pages);
  const versionMismatch = baseline && baseline.version !== version ? { baseline: baseline.version, current: version } : undefined;
  // The push that writes a baseline audits EVERY sample page and records the clean ones too, so a
  // page a same-engine baseline does not know was not there: the change under review added it.
  // Only an exact baseline can say so — the closest entry by prefix may predate pages that are
  // not this change's, and another engine's or an empty one speaks for nothing.
  const reference = baseline !== null && !versionMismatch && !opts.approximate && Object.keys(baseline.pages).length > 0;
  const absent = (page: string): void => void (reference ? fresh : without).add(page);
  for (const id of pages) if (!baseline?.pages[id]) absent(id);
  for (const [key, list] of current) {
    const page = key.slice(0, key.indexOf("|"));
    const base = baseline?.pages[page];
    if (!base) {
      absent(page);
      if (reference) newFindings.push(...list);
      else unbaselined.push(...list);
      continue;
    }
    const had = base[key] ?? 0;
    // Which occurrence is the new one cannot be told on a coarse key; the LAST ones in document
    // order are named, which is where an added element usually lands.
    if (list.length > had) newFindings.push(...list.slice(had));
  }
  for (const id of audited) {
    const base = baseline?.pages[id];
    if (!base) continue;
    for (const [key, had] of Object.entries(base)) fixed += Math.max(0, had - (current.get(key)?.length ?? 0));
  }
  const blocking = newFindings.filter((f) => RANK[f.severity] <= RANK[failOn]);
  return {
    pages: [...pages].sort(),
    failOn,
    newFindings,
    blocking,
    fixed,
    newPages: [...fresh].sort(),
    pagesWithoutBaseline: [...without].sort(),
    unbaselined,
    approximate: opts.approximate === true,
    ...(versionMismatch ? { versionMismatch } : {}),
    noBaseline: baseline === null,
    ok: blocking.length === 0 || versionMismatch !== undefined,
  };
}

/** The warnings a diff carries, one line each, in the order a reader should meet them. */
export function renderDiffWarnings(diff: RenderDiff, lang: Lang = "en"): string[] {
  const fr = lang === "fr";
  const out: string[] = [];
  if (diff.noBaseline)
    out.push(
      fr
        ? "aucune baseline : aucun constat ne peut être dit nouveau. Elle s'écrit sur un push vers la branche par défaut."
        : "no baseline: no finding can be told new. It is written on a push to the default branch.",
    );
  else if (diff.pagesWithoutBaseline.length)
    out.push(
      diff.approximate
        ? fr
          ? `baseline approchée (pas celle du merge-base) : les pages qu'elle ne connaît pas sont signalées sans bloquer : ${diff.pagesWithoutBaseline.join(", ")}.`
          : `approximate baseline (not the merge-base's own): pages it does not know are reported without gating: ${diff.pagesWithoutBaseline.join(", ")}.`
        : fr
          ? `page(s) absente(s) de la baseline, ses constats ne bloquent pas : ${diff.pagesWithoutBaseline.join(", ")}.`
          : `page(s) the baseline never measured, their findings do not gate: ${diff.pagesWithoutBaseline.join(", ")}.`,
    );
  if (diff.versionMismatch)
    out.push(
      fr
        ? `baseline écrite par ultra11y ${diff.versionMismatch.baseline}, run en ${diff.versionMismatch.current} : un moteur différent lève des constats différents, les nouveaux sont signalés sans bloquer.`
        : `baseline written by ultra11y ${diff.versionMismatch.baseline}, this run is ${diff.versionMismatch.current}: another engine raises other findings, so new ones are reported without gating.`,
    );
  return out;
}

const SEV: Record<Severity, { fr: string; en: string }> = {
  bloquant: { fr: "bloquant", en: "blocking" },
  majeur: { fr: "majeur", en: "major" },
  mineur: { fr: "mineur", en: "minor" },
};

const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** The Markdown the job summary carries. Short on purpose: a reader opens it to learn whether the
 *  pull request broke a page, and which element. */
export function renderDiffMarkdown(diff: RenderDiff, lang: Lang = "en", max = 50): string {
  const fr = lang === "fr";
  const out: string[] = [];
  out.push(fr ? "## ultra11y lite — régressions au rendu" : "## ultra11y lite — rendered regressions", "");
  const sev = SEV[diff.failOn][fr ? "fr" : "en"];
  const head = diff.ok
    ? diff.blocking.length
      ? fr
        ? `⚠️ ${diff.blocking.length} nouvelle(s) non-conformité(s) ≥ ${sev}, non bloquante(s) (versions différentes).`
        : `⚠️ ${diff.blocking.length} new non-conformity(ies) ≥ ${sev}, not gating (engine versions differ).`
      : fr
        ? `✅ Aucune nouvelle non-conformité ≥ ${sev}.`
        : `✅ No new non-conformity ≥ ${sev}.`
    : fr
      ? `❌ ${diff.blocking.length} nouvelle(s) non-conformité(s) ≥ ${sev}.`
      : `❌ ${diff.blocking.length} new non-conformity(ies) ≥ ${sev}.`;
  out.push(head, "");
  out.push(
    fr
      ? `${diff.pages.length} page(s) auditée(s) · ${diff.newFindings.length} nouveau(x) constat(s) · ${diff.fixed} corrigé(s)`
      : `${diff.pages.length} page(s) audited · ${diff.newFindings.length} new finding(s) · ${diff.fixed} fixed`,
    "",
  );
  for (const w of renderDiffWarnings(diff, lang)) out.push(`> ⚠️ ${w}`, "");
  if (diff.newPages.length)
    out.push(
      fr
        ? `🆕 Nouvelle(s) page(s), absente(s) de la baseline : jugée(s) sans référence, chacun de ses constats ≥ ${sev} bloque — ${diff.newPages.join(", ")}.`
        : `🆕 New page(s), absent from the baseline: judged with no reference, every finding ≥ ${sev} on it gates — ${diff.newPages.join(", ")}.`,
      "",
    );
  if (diff.newFindings.length) {
    out.push(fr ? "| Page | Critère | Règle | Sévérité | Élément |" : "| Page | Criterion | Rule | Severity | Element |", "|---|---|---|---|---|");
    for (const f of diff.newFindings.slice(0, max))
      out.push(
        `| ${cell(findingPage(f))} | ${cell(f.criteriaId)} | \`${cell(f.ruleId)}\` | ${SEV[f.severity][fr ? "fr" : "en"]} | \`${cell(f.selectorHint)}\` |`,
      );
    if (diff.newFindings.length > max) out.push("", fr ? `… et ${diff.newFindings.length - max} autre(s).` : `… and ${diff.newFindings.length - max} more.`);
    out.push("");
  }
  return out.join("\n");
}

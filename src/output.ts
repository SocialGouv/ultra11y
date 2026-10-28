// Output helpers: a tiny fr/en string table and the human-readable `audit`
// summary (the --json path prints the AuditResult verbatim instead).
import type { AuditResult, Lang, Severity } from "./types.js";
import type { CaptureCoverage } from "./capture.js";
import { guidelineTitle } from "./wcag.js";
import { resolveMessage } from "./messages.js";
import { CORE, type StandardId } from "./standards/index.js";
import { isCore } from "./standards/registry.js";
import { packAuditDocument } from "./standards/document.js";

type Key =
  | "summaryTitle"
  | "files"
  | "decided"
  | "toAdjudicate"
  | "guideline"
  | "theme"
  | "naSubset"
  | "findingsTitle"
  | "noFindings"
  | "residualTitle"
  | "manualNote"
  | "renderedNote"
  | "sfcNote"
  | "capturesNote";

/** The pack summary's title is assembled rather than tabled: only the standard's LABEL
 *  varies, and a per-pack entry in the string table would have to be written again for every
 *  country standard someone plugs in. */
const auditWord = (lang: Lang) => (lang === "fr" ? "Audit" : "Audit:");
const engineWord = (lang: Lang) => (lang === "fr" ? "moteur statique ultra11y" : "ultra11y static engine");

const STR: Record<Lang, Record<Key, string>> = {
  fr: {
    summaryTitle: "Audit WCAG 2.2 AA (moteur statique ultra11y)",
    files: "fichiers analysés",
    decided: "critères décidés",
    toAdjudicate: "à adjuger",
    guideline: "Règle WCAG",
    theme: "Thématique",
    naSubset: "(Les NA sont comptés dans C — un critère sans sujet est conforme : C + NC + ⏳ = le nombre de critères.)",
    findingsTitle: "Non-conformités détectées",
    noFindings: "Aucune non-conformité détectée par le moteur statique.",
    residualTitle: "À adjuger (jugement / rendu)",
    manualNote: "critères non décidés par le moteur — à adjuger par l'agent IA (`verify --manual`, gaté), rendu via `scan`.",
    renderedNote: "fichier(s) rendent des composants de bibliothèque non analysés en source — auditez le build (render) ou scan",
    sfcNote:
      "composant(s) .vue/.svelte/.astro audité(s) en SOURCE (template) — slots et liaisons dynamiques invisibles : verdict préliminaire, auditez le rendu (render/scan)",
    capturesNote: "fichier(s) de capture rendus audités à pleine fidélité (DOM réel) — le vrai HTML produit",
  },
  en: {
    summaryTitle: "WCAG 2.2 AA audit (ultra11y static engine)",
    files: "files analysed",
    decided: "criteria decided",
    toAdjudicate: "to adjudicate",
    guideline: "WCAG guideline",
    theme: "Theme",
    naSubset: "(NA are counted within C — a criterion with no subject conforms: C + NC + ⏳ is the criterion count.)",
    findingsTitle: "Non-conformities detected",
    noFindings: "No non-conformity detected by the static engine.",
    residualTitle: "To adjudicate (judgment / rendering)",
    manualNote: "criteria the engine cannot decide — adjudicated by the AI agent (`verify --manual`, gated), rendering via `scan`.",
    renderedNote: "file(s) render component-library output not analysed from source — audit the build (render) or scan",
    sfcNote:
      ".vue/.svelte/.astro file(s) audited as SOURCE (template) — slots and dynamic bindings are invisible: preliminary verdict, audit the rendered output (render/scan)",
    capturesNote: "rendered capture file(s) audited at full fidelity (real DOM) — the true produced HTML",
  },
};

export function t(lang: Lang, key: Key): string {
  return STR[lang][key];
}

const ICON: Record<Severity, string> = { bloquant: "🔴", majeur: "🟠", mineur: "🟡" };

/**
 * The `audit` console summary, in the ACTIVE STANDARD's own vocabulary.
 *
 * Under the core it is unchanged: WCAG title, guideline rows, bare success-criterion tags.
 * Under a pack it is the pack's — « Audit RGAA 4.1.2 », one row per thématique, findings
 * tagged `[8.4]` rather than `[3.1.1]` — because a project that selected RGAA and is then
 * shown WCAG has to translate the output itself before it can act on it.
 *
 * The criterion count, the tallies and the residual list all come from the pack projection,
 * not from the core, so this table and `report --standard <pack>` describe one grid.
 */
export function auditSummary(r: AuditResult, lang: Lang, standard: StandardId = CORE): string {
  const pack = isCore(standard) ? null : packAuditDocument(r, standard, lang);
  const lines: string[] = [];
  lines.push(`${pack ? `${auditWord(lang)} ${pack.standardLabel} (${engineWord(lang)})` : t(lang, "summaryTitle")} — ${r.date}`);
  const rows: { name: string; c: number; nc: number; na: number; manual: number }[] = pack
    ? pack.themes.map((th) => ({ name: `${th.number}. ${th.title}`, c: th.c, nc: th.nc, na: th.na, manual: th.manual }))
    : // `g.title` is the baked-in English title (JSON back-compat); resolve by key + lang.
      r.guidelines.map((g) => ({ name: `${g.key} ${guidelineTitle(g.key, lang) ?? g.title}`, c: g.c, nc: g.nc, na: g.na, manual: g.manual }));
  // DECIDED OUT OF TOTAL, NOT A PERCENTAGE. The pass rate is C ÷ (C + NC) over what the engine
  // decided, so a fresh RGAA audit read « 100% » with 101 of 106 criteria still to judge —
  // a number that sounds like a verdict on the site. The count says what was settled.
  const sum = (k: "c" | "nc" | "manual") => rows.reduce((n, row) => n + row[k], 0);
  const total = sum("c") + sum("nc") + sum("manual");
  lines.push(
    `${r.scope.files} ${t(lang, "files")} · ${total - sum("manual")}/${total} ${t(lang, "decided")} (C ${sum("c")} · NC ${sum("nc")}) · ${sum("manual")} ${t(lang, "toAdjudicate")}`,
  );
  lines.push("");
  // Columns sized to the widest cell, never truncated: « 9. Structuration de l'inform » was
  // the theme name a reader got, under a header that did not line up with its numbers.
  const head = pack ? t(lang, "theme") : t(lang, "guideline");
  const nameW = Math.max(head.length, ...rows.map((row) => row.name.length));
  // Display widths, not string lengths: « ⏳ » is one UTF-16 unit drawn two columns wide.
  const cols = [
    ["C", 1],
    ["NC", 2],
    ["NA", 2],
    ["⏳", 2],
  ] as const;
  const numW = cols.map(([, w], i) => Math.max(w, ...rows.map((row) => String([row.c, row.nc, row.na, row.manual][i]).length)));
  lines.push(`${head.padEnd(nameW)}  ${cols.map(([label, w], i) => " ".repeat(numW[i]! - w) + label).join("  ")}`);
  for (const row of rows) {
    lines.push(`${row.name.padEnd(nameW)}  ${[row.c, row.nc, row.na, row.manual].map((n, i) => String(n).padStart(numW[i]!)).join("  ")}`);
  }
  // `NA` is a SUBSET of `C` — a criterion conforming for want of a subject reads C and the NA
  // column only says how many of them there were. Said out loud because the four columns
  // otherwise read as a partition and a reader adding them overshoots the criterion count.
  lines.push(`  ${t(lang, "naSubset")}`);
  lines.push("");
  const findings = pack ? pack.findings : r.findings;
  if (findings.length === 0) {
    lines.push(t(lang, "noFindings"));
  } else {
    lines.push(`${t(lang, "findingsTitle")} (${findings.length}) :`);
    for (const f of findings.slice(0, 20)) {
      const tag = "criteriaIds" in f ? (f.criteriaIds as string[]).join(", ") : f.criteriaId;
      lines.push(`  ${ICON[f.severity]} [${tag}] ${f.file}:${f.line}  ${resolveMessage(f, lang)}`);
    }
    if (findings.length > 20) lines.push(`  … (+${findings.length - 20})`);
  }
  lines.push("");
  lines.push(`${t(lang, "residualTitle")} : ${(pack ?? r).residualRisks.length} ${t(lang, "manualNote")}`);
  if (r.scope.rendered) lines.push(`🧩 ${r.scope.rendered.files} ${t(lang, "renderedNote")} (${r.scope.rendered.opaqueLibraries.join(", ")}).`);
  if (r.scope.sourceTemplate) lines.push(`🧩 ${r.scope.sourceTemplate.files} ${t(lang, "sfcNote")} (${r.scope.sourceTemplate.extensions.join(", ")}).`);
  if (r.scope.captures) lines.push(`✅ ${r.scope.captures.files} ${t(lang, "capturesNote")}.`);
  return lines.join("\n");
}

/** Human-readable rendered-capture coverage: covered vs opaque-source-only blind spots.
 *  Reused by `audit --require-captures` (as a gate note) and `render --coverage`. */
export function captureCoverageSummary(cov: CaptureCoverage, lang: Lang): string {
  const fr = lang === "fr";
  const lines: string[] = [];
  if (cov.total === 0) {
    lines.push(fr ? "Couverture captures : aucun composant à couvrir dans le périmètre." : "Capture coverage: no components to cover in scope.");
  } else {
    lines.push(
      fr
        ? `Couverture captures : ${cov.covered.length}/${cov.total} composant(s) couvert(s) par un rendu.`
        : `Capture coverage: ${cov.covered.length}/${cov.total} component(s) covered by a render.`,
    );
    if (cov.blindSpots.length) {
      lines.push(fr ? "Angles morts (audités sur source opaque uniquement) :" : "Blind spots (audited from opaque source only):");
      for (const k of cov.blindSpots) lines.push(`  · ${k}`);
    }
  }
  if (cov.unattributed)
    lines.push(fr ? `${cov.unattributed} capture(s) sans provenance (non rattachée·s).` : `${cov.unattributed} capture(s) without provenance (unattributed).`);
  return lines.join("\n");
}

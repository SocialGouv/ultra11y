// TITLE GRAMMAR AND BODY ASSEMBLY.
//
// Bodies delegate 100% of their audit content to src/auditor.ts (`renderAuditorUnit` /
// `renderAuditorBacklog`) — the SAME block the report and the PRD render. There is exactly
// one audit truth in this codebase and this file is not allowed to grow a second one. What
// lives here is the frame: the title, the page/file preamble, and the length clamp.
import type { Lang, PageResult, Severity } from "../types.js";
import type { PrdUnit } from "../prd.js";
import { type StandardId, isCore, loadPack } from "../standards/index.js";
import { renderAuditorUnit } from "../auditor.js";
import { resolveMessage, resolveRemediation } from "../messages.js";
import { UNATTRIBUTED_ID } from "./types.js";

/** Stable, language-neutral suffix marking a non-normative recommendation apart from a
 *  non-conformity. Part of the de-dupe grain, so it must never drift. */
export const RECOMMENDATION_SUFFIX = " (recommendation)";

/** The English frame of every non-criterion title. NEVER localized: a title that changes
 *  with `--lang` files a duplicate. Only the criterion INTITULÉ varies by language, which is
 *  the caveat `references/tickets.md` documents. */
const AUDIT_FRAME = "Accessibility audit";

/** Display label + issue tag for the active standard ("WCAG"/"wcag" or a pack's). */
export function standardTag(standard: StandardId): { label: string; tag: string } {
  return isCore(standard)
    ? { label: "WCAG", tag: "wcag" }
    : (() => {
        const p = loadPack(standard);
        return { label: p.name, tag: p.key };
      })();
}

// ---- titles ------------------------------------------------------------------------------
// The `criterion` and `single` grammars are byte-identical to the pre-v3 `--gh-issues` /
// `--gh-single` ones. That is a HARD requirement, not a nicety: de-dupe matches on the exact
// title, so one changed byte re-files every ticket in every repo that already ran them.

export function criterionTitle(unit: PrdUnit, label = "WCAG"): string {
  return `[a11y] ${label} ${unit.criteriaId} — ${unit.title}${unit.advisory ? RECOMMENDATION_SUFFIX : ""}`;
}

export function singleTitle(label = "WCAG"): string {
  return `[a11y] ${label} — ${AUDIT_FRAME}`;
}

export function pageTitle(pageId: string, label = "WCAG"): string {
  return `[a11y] ${label} [page:${pageId}] — ${AUDIT_FRAME}`;
}

export function pageCriterionTitle(pageId: string, unit: PrdUnit, label = "WCAG"): string {
  return `[a11y] ${label} [page:${pageId}] ${unit.criteriaId} — ${unit.title}${unit.advisory ? RECOMMENDATION_SUFFIX : ""}`;
}

export function fileTitle(file: string, label = "WCAG"): string {
  return `[a11y] ${label} [file:${file}] — ${AUDIT_FRAME}`;
}

export function unattributedTitle(label = "WCAG"): string {
  return `[a11y] ${label} [${UNATTRIBUTED_ID}] — ${AUDIT_FRAME}`;
}

// ---- labels ------------------------------------------------------------------------------

/** Unchanged from the pre-v3 GitHub issue labels. Advisory units get `recommendation` so
 *  they can be triaged apart from real non-conformities (which they are not). */
export function labelsFor(severity: Severity, advisory: boolean, tag: string): string[] {
  return advisory ? ["accessibility", tag, "recommendation", severity] : ["accessibility", tag, severity];
}

// ---- bodies ------------------------------------------------------------------------------

const L = {
  fr: {
    fix: "Correction",
    occ: "Occurrence(s)",
    def: "↳ définition",
    page: "Page",
    url: "URL",
    auth: "Authentification requise",
    yes: "oui",
    file: "Fichier",
    fileNote:
      "Ticket regroupé par fichier source. Un fichier n'est pas une page : il ne porte aucun taux de conformité — seul le périmètre global et la grille par page en portent un.",
    truncated: (path: string) => `_… corps tronqué : le ticket dépassait la limite du tracker. Le détail complet est dans \`${path}\`._`,
    prdPath: "audits/prd-<date>.md",
  },
  en: {
    fix: "Fix",
    occ: "Occurrence(s)",
    def: "↳ definition",
    page: "Page",
    url: "URL",
    auth: "Authentication required",
    yes: "yes",
    file: "File",
    fileNote: "Ticket grouped by source file. A file is not a page: it carries no conformance rate — only the overall scope and the per-page grid do.",
    truncated: (path: string) => `_… body truncated: the ticket exceeded the tracker's limit. The full detail is in \`${path}\`._`,
    prdPath: "audits/prd-<date>.md",
  },
} as const;

/** The legacy dev body (`--format remediation`): WCAG refs / Fix / Occurrences. Moved
 *  verbatim from the pre-v3 `issueBody`, so `--format remediation` output is unchanged. */
export function renderRemediationBody(unit: PrdUnit, lang: Lang): string {
  const t = L[lang];
  const lines: string[] = [];
  if (unit.refs.length) lines.push(`**WCAG** : ${unit.refs.join(", ")}`, "");
  for (const fx of [...new Set(unit.findings.map((f) => resolveRemediation(f, lang)))]) lines.push(`**${t.fix}** : ${fx}`);
  lines.push("", `**${t.occ} (${unit.findings.length})**`, "");
  for (const f of unit.findings) {
    lines.push(`- [ ] \`${f.file}:${f.line}\` (\`${f.selectorHint}\`) — ${resolveMessage(f, lang)}`);
    if (f.related) lines.push(`  - ${t.def} : \`${f.related.file}:${f.related.line}\` (\`${f.related.selectorHint}\`)`);
  }
  return lines.join("\n");
}

/** One criterion's body — the shared auditor block, exactly as the report and the PRD emit it. */
export function renderCriterionBody(
  unit: PrdUnit,
  standard: StandardId,
  lang: Lang,
  opts: { format?: "audit" | "remediation"; technical?: boolean } = {},
): string {
  if (opts.format === "remediation") return renderRemediationBody(unit, lang);
  return renderAuditorUnit(unit, standard, lang, { ...(opts.technical !== undefined ? { technical: opts.technical } : {}) })
    .join("\n")
    .trimEnd();
}

/** The page identity block that opens every page-grain body. The `attributed`-basis warning
 *  is NOT written here — it comes from `pageBasisWarning` in src/pages.ts, so the grid, the
 *  per-page report and the ticket all say the same sentence. */
export function pagePreamble(page: Pick<PageResult, "name" | "url" | "auth">, lang: Lang, basisWarning?: string): string[] {
  const t = L[lang];
  const out = [`**${t.page}** : ${page.name}`, `**${t.url}** : ${page.url}`];
  if (page.auth) out.push(`**${t.auth}** : ${t.yes}`);
  out.push("");
  if (basisWarning) out.push(`> ⚠️ ${basisWarning}`, "");
  return out;
}

export function filePreamble(file: string, lang: Lang): string[] {
  const t = L[lang];
  return [`**${t.file}** : \`${file}\``, "", `> ${t.fileNote}`, ""];
}

/** Clamp a body to the provider's limit, cutting on a `##` heading boundary so a ticket never
 *  ends mid-criterion, and pointing at the PRD for the full detail. Without this, a large
 *  `single`-grain audit exceeds GitHub's 65536-character issue body and 422s. */
export function clampBody(body: string, limit: number, lang: Lang): string {
  if (body.length <= limit) return body;
  const notice = `\n\n${L[lang].truncated(L[lang].prdPath)}`;
  const budget = limit - notice.length;
  const head = body.slice(0, Math.max(0, budget));
  const cut = head.lastIndexOf("\n## ");
  return `${(cut > 0 ? head.slice(0, cut) : head).trimEnd()}${notice}`;
}

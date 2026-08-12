// `adjudicate` — the AI-adjudication workflow for the criteria the static engine cannot
// decide. Where the engine leaves a judgment/needs-rendering success criterion as a
// `manual` residual risk, this turns it into a WORKLIST: one entry per manual criterion,
// pre-loaded with the concrete evidence the engine already captured (every image's alt,
// every link's text + context, literal colour pairs, control labels…). The AI agent reads
// the evidence and records a verdict — C / NC / NA / manual — with a justification (for C
// and NA), a groundable finding (for NC), or a reason (for a still-`manual` residual that
// truly needs a rendered DOM via `scan`, or is genuinely undecidable). `applyAdjudication`
// folds the verdicts back into the audit, FAIL-CLOSED: no null verdict, no unjustified
// C/NA, no ungroundable NC, no reasonless manual, full coverage of the residual set. The
// decisions are the AGENT's, statically, gated — not a deferral to a human.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditResult, Automatability, Finding, Lang, PackCriterionAdjudication, ResidualRisk, Severity, Status } from "./types.js";
import { SCHEMA_VERSION } from "./types.js";
import { discover } from "./discover.js";
import { readText } from "./util.js";
import { parseSource } from "./parse/source.js";
import { type Doc, type El, elementsByTag, attr, textContent, ancestors, snippet as elSnippet } from "./parse/html.js";
import { parseInlineStyle } from "./color.js";
import adjudicationJson from "./data/adjudication.json";
import { scTitle, getSC, hasSC, techniquesFor, allSC, guidelineTitle } from "./wcag.js";
import { groundItems, type GroundingSummary } from "./grounding.js";
import {
  type StandardId,
  CORE,
  isCore,
  loadPack,
  hasId,
  getCriterion,
  derivePackResults,
  resolveGlossary,
  titlePlain as packTitlePlain,
  type StandardPack,
  type PackCriterion,
} from "./standards/index.js";
import { guidanceForCriterion } from "./guidance/index.js";
import { guidanceExampleBlock } from "./prd.js";

/** Cap on evidence items harvested per criterion — bounded so a huge page can't produce an
 *  unreadable worklist; the honest overflow count is recorded in `evidenceTruncated`. */
export const ADJUDICATE_MAX_EVIDENCE = 30;

export interface Evidence {
  file: string;
  line: number;
  selector: string;
  snippet: string;
  note?: string; // extra context the harvester surfaced (e.g. a link's nearest heading)
}

export type CriterionVerdict = "C" | "NC" | "NA" | "manual" | null;

/** An agent-declared non-conformity — same shape a `Finding` needs to render + re-gate. */
export interface AgentFinding {
  file: string;
  line: number;
  selector?: string;
  message: string;
  snippet?: string;
  severity?: Severity;
  // The precise normative test the agent cites for an NC verdict — a WCAG SC id for the
  // core (e.g. "1.1.1"), or a pack criterion / test id when adjudicating a pack standard
  // (e.g. "1.1" or "1.1.1"). REQUIRED for any NC finding: `applyAdjudication` fail-closes
  // when it is absent or does not resolve against the active standard. A recommendation
  // (advisory) needs none — a good practice has no normative test by definition.
  normativeRef?: string;
}

export interface AdjudicationItem {
  criteriaId: string;
  automatability: Automatability;
  title?: string;
  evidence: Evidence[];
  evidenceTruncated?: { shown: number; total: number };
  verdict: CriterionVerdict; // the agent fills this
  justification: string; // REQUIRED for C and NA
  reason: string | null; // REQUIRED for a still-`manual` verdict ("needs-rendered-dom" | "undecidable")
  findings: AgentFinding[]; // REQUIRED (≥1, groundable, each with a normativeRef) for NC
  // What the agent CLEARED, for a C (or ruled out of scope, for an NA). The mirror image of
  // `findings`, and required for the same reason: without a slot to cite in, a conforming
  // verdict was pure prose, and the gate could only ever check that the prose was non-empty
  // — so a model answering "C" to everything with the justification "x" passed, and the
  // report published 91 conformant criteria nobody had assessed.
  //
  // Each citation must ground (the file/line/snippet must resolve, exactly like an NC
  // finding) AND match one of this item's own `evidence` anchors by file+line — that pairing
  // is what turns "cite something real" into "cite the evidence you were shown". When the
  // harvester found no evidence at all there is nothing to clear, and the honest verdicts
  // are `manual` or `NA`, never `C`.
  citations?: Evidence[];
  // Non-normative good practices the agent noted on this criterion — folded back into the
  // audit as ADVISORY findings (grounded exactly like an NC finding, but never affecting
  // status: they cannot flip the criterion to NC nor enter conformancePct). Optional.
  recommendations?: AgentFinding[];
  decidedBy: "agent";
}

export interface AdjudicationFile {
  tool: "ultra11y";
  kind: "adjudication";
  schemaVersion: number;
  standard: StandardId;
  auditDate: string;
  items: AdjudicationItem[];
}

// ---- evidence harvesters ----
// Each harvester answers "for this SC, what did the engine see that the agent needs to
// rule?" — bounded, source-anchored, language-neutral. A criterion with no harvester gets
// an empty-evidence item (the agent decides from source, or leaves it manual with a reason).

const selectorFor = (el: El): string => {
  const id = el.attribs.id ? `#${el.attribs.id}` : "";
  const cls = el.attribs.class ? `.${el.attribs.class.trim().split(/\s+/)[0]}` : "";
  return `${el.tag}${id}${cls}`;
};

const ev = (doc: Doc, el: El, note?: string): Evidence => ({
  file: doc.file,
  line: el.line,
  selector: selectorFor(el),
  snippet: elSnippet(doc, el, 160),
  ...(note ? { note } : {}),
});

/** Nearest preceding heading text — the context a link/control is read in. */
function nearestHeading(doc: Doc, el: El): string | undefined {
  const headings = elementsByTag(doc, "h1", "h2", "h3", "h4", "h5", "h6").filter((h) => h.start < el.start);
  const h = headings[headings.length - 1];
  return h ? textContent(h).trim().slice(0, 80) : undefined;
}

// Key/value display patterns (RGAA 8.9 div-presented fields / 9.3 <dl> semantics): a
// <dt>→<dd> pair, or a "label"-classed element immediately followed by a "value"-classed
// sibling (the "Mon profil" recap pattern). Surfaced so the agent can judge whether the
// relationship is only visual — never asserted an NC statically.
const LABEL_LIKE = /(^|[-_ ])(field-label|field-key|label|key|term)([-_ ]|$)/i;
const VALUE_LIKE = /(^|[-_ ])(field-value|field-data|value|data)([-_ ]|$)/i;
function keyValuePairs(doc: Doc): { key: El; label: string; value: string }[] {
  const out: { key: El; label: string; value: string }[] = [];
  for (const el of doc.elements) {
    const isDt = el.tag === "dt";
    const isLabelDiv = el.tag !== "label" && el.tag !== "dt" && LABEL_LIKE.test(attr(el, "class") ?? "");
    if (!isDt && !isLabelDiv) continue;
    const parent = el.parent;
    if (!parent) continue;
    const sibs = parent.children.filter((c): c is El => c.type === "element");
    const next = sibs[sibs.indexOf(el) + 1];
    if (!next) continue;
    const paired = isDt ? next.tag === "dd" : VALUE_LIKE.test(attr(next, "class") ?? "");
    if (!paired) continue;
    out.push({ key: el, label: textContent(el).trim().slice(0, 40), value: textContent(next).trim().slice(0, 40) });
  }
  return out;
}

// Download links whose destination is a document (RGAA 6.1): naming the format "(PDF)" is
// a RECOMMENDATION, not an NC — the harvester note says so explicitly.
const DOWNLOAD_HREF = /\.(pdf|docx?|xlsx?)(?:[?#]|$)/i;

// SPA signals feeding the RGAA 12.8 questions (page title / focus restitution on partial
// reload): a client-router import in the source. One synthetic evidence per doc, at the
// import line (no El to anchor on — these are source-level signals).
const ROUTER_IMPORT =
  /['"](?:react-router(?:-dom)?|next\/(?:router|navigation)|vue-router|@remix-run\/[\w-]+|@tanstack\/[\w-]*router|@sveltejs\/kit|\$app\/(?:navigation|stores))['"]/;
function routerImportEvidence(doc: Doc): Evidence[] {
  const m = ROUTER_IMPORT.exec(doc.source);
  if (!m) return [];
  const line = doc.source.slice(0, m.index).split("\n").length;
  return [
    {
      file: doc.file,
      line,
      selector: "import",
      snippet: (doc.source.split("\n")[line - 1] ?? "").trim().slice(0, 120),
      note: "client-router import — verify page title + focus are restored on partial (SPA) navigation",
    },
  ];
}

// Status-message signal near a form: a status-ish class inside a <form> (dynamic feedback
// text feeding the RGAA 7.5 / WCAG 4.1.3 question).
const STATUS_CLASS = /(error|status|message|alert|notif|toast|feedback|live)/i;

type Harvester = (docs: Doc[]) => Evidence[];

const HARVESTERS: Record<string, Harvester> = {
  // 1.1.1 Non-text Content — every image-like element's text alternative
  "1.1.1": (docs) =>
    docs.flatMap((d) =>
      elementsByTag(d, "img", "svg", "area", "object", "embed", "canvas")
        .concat(d.elements.filter((e) => attr(e, "role") === "img"))
        .filter((e, i, a) => a.indexOf(e) === i)
        .map((e) => ev(d, e, `alt="${attr(e, "alt") ?? ""}" aria-label="${attr(e, "aria-label") ?? ""}"`)),
    ),
  // 2.4.4 Link Purpose (In Context) — link text + destination + nearest heading. A
  // document-download link's format mention "(PDF)" (RGAA 6.1) is a RECOMMENDATION, not an
  // NC — the note says so, so the agent never files an NC for a missing format hint.
  "2.4.4": (docs) =>
    docs.flatMap((d) =>
      elementsByTag(d, "a")
        .filter((e) => attr(e, "href") !== undefined)
        .map((e) => {
          const href = attr(e, "href") ?? "";
          const dl = DOWNLOAD_HREF.exec(href);
          const note = dl ? ` download-format=${dl[1]!.toLowerCase()} (naming the format, e.g. "(PDF)", is a recommendation — not an NC)` : "";
          return ev(d, e, `text="${textContent(e).trim().slice(0, 60)}" href="${href}" under="${nearestHeading(d, e) ?? ""}"${note}`);
        }),
    ),
  // 1.4.3 Contrast (Minimum) — literal inline colour pairs (the ones statically visible)
  "1.4.3": (docs) =>
    docs.flatMap((d) =>
      d.elements
        .filter((e) => {
          const st = parseInlineStyle(attr(e, "style") ?? "");
          return st.has("color") || st.has("background-color") || st.has("background");
        })
        .map((e) => {
          const st = parseInlineStyle(attr(e, "style") ?? "");
          return ev(d, e, `color=${st.get("color") ?? "?"} background=${st.get("background-color") ?? st.get("background") ?? "?"}`);
        }),
    ),
  // 2.4.6 Headings and Labels — heading + label + <caption> text to judge for
  // descriptiveness/concision (captions feed the RGAA 5.5 title-concision question).
  "2.4.6": (docs) =>
    docs.flatMap((d) =>
      elementsByTag(d, "h1", "h2", "h3", "h4", "h5", "h6", "label", "legend", "caption").map((e) =>
        ev(d, e, `<${e.tag}> text="${textContent(e).trim().slice(0, 60)}"`),
      ),
    ),
  // 3.3.2 Labels or Instructions — controls + their associated labels/placeholders
  "3.3.2": (docs) =>
    docs.flatMap((d) =>
      elementsByTag(d, "input", "select", "textarea").map((e) => {
        const id = attr(e, "id");
        const lbl = id ? elementsByTag(d, "label").find((l) => attr(l, "for") === id) : undefined;
        return ev(
          d,
          e,
          `label="${lbl ? textContent(lbl).trim().slice(0, 40) : ""}" placeholder="${attr(e, "placeholder") ?? ""}" aria-label="${attr(e, "aria-label") ?? ""}"`,
        );
      }),
    ),
  // 1.3.1 Info and Relationships — heading outline + tables/lists (structure to judge for
  // technique consistency), PLUS div-presented key/value pairs (RGAA 8.9 read-only fields /
  // 9.3 <dl> semantics) so the "Mon profil" recap pattern is never silently conforming.
  "1.3.1": (docs) =>
    docs.flatMap((d) => [
      ...elementsByTag(d, "h1", "h2", "h3", "h4", "h5", "h6", "table", "ul", "ol", "dl").map((e) =>
        ev(d, e, `<${e.tag}> "${textContent(e).trim().slice(0, 50)}"`),
      ),
      ...keyValuePairs(d).map((p) =>
        ev(d, p.key, `key/value pair — label="${p.label}" value="${p.value}" (div-presented field? verify the relationship isn't only visual — RGAA 8.9/9.3)`),
      ),
    ]),
  // 4.1.3 Status Messages (RGAA 7.4/7.5) — live regions + status-ish text near a form
  "4.1.3": (docs) =>
    docs.flatMap((d) => {
      const isRegion = (e: El) => attr(e, "aria-live") !== undefined || ["status", "alert", "log"].includes((attr(e, "role") ?? "").trim().toLowerCase());
      const regions = d.elements.filter(isRegion);
      const nearForm = d.elements.filter((e) => !isRegion(e) && STATUS_CLASS.test(attr(e, "class") ?? "") && ancestors(e).some((a) => a.tag === "form"));
      return [
        ...regions.map((e) => ev(d, e, `aria-live="${attr(e, "aria-live") ?? ""}" role="${attr(e, "role") ?? ""}"`)),
        ...nearForm.map((e) =>
          ev(
            d,
            e,
            `status-like class="${(attr(e, "class") ?? "").slice(0, 40)}" in a form — verify async feedback is announced (role=status/alert or aria-live)`,
          ),
        ),
      ];
    }),
  // 4.1.2 Name, Role, Value — elements carrying a role or ARIA state
  "4.1.2": (docs) =>
    docs.flatMap((d) =>
      d.elements
        .filter((e) => attr(e, "role") !== undefined || Object.keys(e.attribs).some((k) => k.startsWith("aria-")))
        .map((e) => ev(d, e, `role="${attr(e, "role") ?? ""}"`)),
    ),
  // 2.4.3 Focus Order — explicit tabindex values in DOM order, PLUS SPA focus signals
  // (RGAA 12.8): <dialog> usage and client-router imports (verify focus is moved on route
  // change / dialog open, and a mobile menu's target receives focus).
  "2.4.3": (docs) =>
    docs.flatMap((d) => [
      ...d.elements.filter((e) => attr(e, "tabindex") !== undefined).map((e) => ev(d, e, `tabindex="${attr(e, "tabindex")}"`)),
      ...elementsByTag(d, "dialog").map((e) => ev(d, e, `<dialog> — verify focus moves in on open and is restored to the trigger on close`)),
      ...routerImportEvidence(d),
    ]),
  // 3.1.2 Language of Parts — element-level lang overrides (not the root <html lang>)
  "3.1.2": (docs) =>
    docs.flatMap((d) => d.elements.filter((e) => e.tag !== "html" && attr(e, "lang") !== undefined).map((e) => ev(d, e, `lang="${attr(e, "lang")}"`))),
};

/** Resolve the audit's scope inputs back to parsed docs (harvesting reads the same files
 *  the audit did — run `verify --manual` from the audit's cwd). Best-effort: unreadable /
 *  vanished files are skipped, exactly like the audit's own read loop. */
function docsForAudit(audit: AuditResult, cwd?: string): Doc[] {
  const inputs = audit.scope.inputs.filter((i) => i !== "-" && i !== "<stdin>");
  if (!inputs.length) return [];
  const { files } = discover(inputs, {});
  const docs: Doc[] = [];
  for (const f of files) {
    try {
      docs.push(parseSource(readText(cwd ? join(cwd, f) : f), f));
    } catch {
      /* unreadable — skip, mirrors runAudit */
    }
  }
  return docs;
}

function blankItem(criteriaId: string, automatability: Automatability, title: string | undefined, harvested: Evidence[]): AdjudicationItem {
  const evidence = harvested.slice(0, ADJUDICATE_MAX_EVIDENCE);
  return {
    criteriaId,
    automatability,
    ...(title ? { title } : {}),
    evidence,
    ...(harvested.length > ADJUDICATE_MAX_EVIDENCE ? { evidenceTruncated: { shown: evidence.length, total: harvested.length } } : {}),
    verdict: null,
    justification: "",
    reason: null,
    findings: [],
    recommendations: [],
    decidedBy: "agent" as const,
  };
}

/** Evidence for a PACK criterion: the union of the harvesters of every success criterion it
 *  maps onto, de-duplicated. A pack criterion is finer than a WCAG SC (1.1.1 fans out to 19
 *  RGAA criteria), so the same element would otherwise be listed once per mapped SC. */
function packEvidence(scs: string[], docs: Doc[]): Evidence[] {
  const out: Evidence[] = [];
  const seen = new Set<string>();
  for (const sc of scs) {
    for (const e of HARVESTERS[sc]?.(docs) ?? []) {
      const key = `${e.file}:${e.line}:${e.selector}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
  }
  return out;
}

/** Build the adjudication worklist.
 *
 *  For the WCAG core: one item per residual-risk (manual) success criterion.
 *
 *  For a COUNTRY STANDARD: one item per PACK criterion that derives `manual` — which is where
 *  almost the whole standard lives (99 of RGAA's 106 criteria can only ever derive `manual`).
 *  Keying by the pack's own criteria is not cosmetic: it is what lets an item carry the
 *  criterion's numbered tests, and therefore what lets `normativeRefResolves` check a citation
 *  against THIS criterion's tests instead of accepting any id of the right shape. */
export function buildAdjudicationWorklist(audit: AuditResult, opts: { cwd?: string; standard?: StandardId } = {}): AdjudicationItem[] {
  const docs = docsForAudit(audit, opts.cwd);
  const standard = opts.standard;

  if (standard !== undefined && !isCore(standard)) {
    const pack = loadPack(standard);
    return derivePackResults(audit, standard)
      .filter((pc) => pc.status === "manual")
      .map((pc) => {
        const crit = getCriterion(pack, pc.id);
        const scs = crit?.wcag ?? pc.scs;
        // The worst automatability among the mapped SCs: a criterion needing a rendered DOM
        // for any of them needs one, full stop. A criterion whose SCs are all outside the
        // core (RGAA 8.1 → the removed 4.1.1) is still the agent's to decide from source.
        const autos = scs.map((sc) => getSC(sc)?.automatability).filter((a): a is Automatability => !!a);
        const automatability: Automatability = autos.includes("needs-rendering") ? "needs-rendering" : "judgment";
        return blankItem(pc.id, automatability, crit ? packTitlePlain(pack, crit, "fr") : undefined, packEvidence(scs, docs));
      });
  }

  return audit.residualRisks.map((r: ResidualRisk) =>
    blankItem(r.criteriaId, r.automatability, scTitle(r.criteriaId) ?? undefined, HARVESTERS[r.criteriaId]?.(docs) ?? []),
  );
}

export interface ApplyAdjudicationResult {
  ok: boolean;
  audit: AuditResult;
  issues: string[];
  applied: number;
  stillManual: number;
  grounding: GroundingSummary;
}

const NC_SEVERITY_DEFAULT: Severity = "majeur";
const MANUAL_REASONS = new Set(["needs-rendered-dom", "undecidable"]);

/** Does an NC finding's `normativeRef` resolve against the ACTIVE standard?
 *
 *  Core: a real success-criterion id (reuses `hasSC`).
 *
 *  Pack: the criterion the ref names must be `itemCriterionId` ITSELF — either cited bare
 *  ("11.2") or as one of its own tests ("11.2.1").
 *
 *  That last constraint is load-bearing, not pedantry. A pack test id has the same `N.N.N`
 *  shape as a WCAG success criterion, so a laxer check accepted the WCAG id an agent would
 *  naturally reach for and silently read it as an unrelated pack test: citing "1.4.3"
 *  (Contrast Minimum) resolved as RGAA test 1.4.3, which is about CAPTCHA images. Binding the
 *  citation to the item's own criterion removes the collision entirely.
 *
 *  Fail-closed: an absent/blank/unresolvable ref fails the whole adjudication (mirrors
 *  verify.ts). */
function normativeRefResolves(ref: string | undefined, standard: StandardId, itemCriterionId?: string): boolean {
  const r = (ref ?? "").trim();
  if (!r) return false;
  if (isCore(standard)) return hasSC(r);
  const pack = loadPack(standard);
  // Which criterion does the ref name? Either the criterion itself, or "<criterion>.<test>".
  let critId = hasId(pack, r) ? r : undefined;
  let testKey: string | undefined;
  if (critId === undefined) {
    const dot = r.lastIndexOf(".");
    if (dot <= 0) return false;
    const head = r.slice(0, dot);
    if (!hasId(pack, head)) return false;
    critId = head;
    testKey = r.slice(dot + 1);
  }
  const crit = getCriterion(pack, critId);
  if (!crit) return false;
  if (testKey !== undefined && !(crit.tests && Object.hasOwn(crit.tests, testKey))) return false;
  // The citation must belong to the criterion being adjudicated.
  return itemCriterionId === undefined || critId === itemCriterionId;
}

/** Fold an adjudication file back into the audit. FAIL-CLOSED (see module header). Returns
 *  a NEW AuditResult with the decided statuses, agent findings, recomputed conformancePct,
 *  a shrunk residual set, and the `adjudicated` marker. */
export function applyAdjudication(audit: AuditResult, adj: AdjudicationFile, opts: { cwd?: string } = {}): ApplyAdjudicationResult {
  const issues: string[] = [];
  const byId = new Map(adj.items.map((it) => [it.criteriaId, it]));

  // Coverage. Under the core that means every residual success criterion; under a pack it
  // means every pack criterion that derives `manual` — the pack's own granularity, which is
  // what the worklist was built at.
  const packMode = !isCore(adj.standard);
  const open = new Set<string>();
  if (packMode) {
    for (const pc of derivePackResults(audit, adj.standard)) {
      if (pc.status !== "manual") continue;
      open.add(pc.id);
      if (!byId.has(pc.id)) issues.push(`criterion ${pc.id}: missing from the adjudication (coverage gap)`);
    }
  } else {
    for (const r of audit.residualRisks) {
      open.add(r.criteriaId);
      if (!byId.has(r.criteriaId)) issues.push(`criterion ${r.criteriaId}: missing from the adjudication (coverage gap)`);
    }
  }

  // …and the other direction. The coverage check above only proves every open criterion was
  // ruled on; it says nothing about a SURPLUS item. That mattered: the fold resolved a
  // criterion by id against the whole audit, so an extra `{criteriaId: "3.1.1", verdict:
  // "C"}` overwrote a non-conformity the deterministic engine had decided — no finding, no
  // citation, no normativeRef. Adjudication may only ever decide what the engine left open.
  for (const it of adj.items) {
    if (!open.has(it.criteriaId)) {
      issues.push(`criterion ${it.criteriaId}: not open for adjudication — the engine already decided it, or it is not part of ${adj.standard}`);
    }
  }

  // Per-item fail-closed validation.
  const groundInputs: { file: string; line: number; selector?: string; snippet?: string }[] = [];
  for (const it of adj.items) {
    const v = it.verdict;
    if (v === null) {
      issues.push(`criterion ${it.criteriaId}: unadjudicated (verdict is null)`);
    } else if (v === "C" || v === "NA") {
      if (!it.justification || !it.justification.trim()) issues.push(`criterion ${it.criteriaId}: a ${v} verdict requires a justification`);
      // A clearing verdict is gated exactly like an accusing one. Before this, the only
      // check was "the justification is a non-empty string", so `"x"` cleared a criterion —
      // and a model answering C to everything published a conformance nobody had assessed.
      const cites = it.citations ?? [];
      if (it.evidence.length === 0) {
        // Nothing was harvested for this criterion, so there is nothing the agent could have
        // read to clear it. `NA` is still legitimate (the honest "no element in scope is
        // concerned"); `C` is not — it must stay `manual` and be ruled on against the
        // criterion's own tests, from a rendered capture or by hand.
        if (v === "C") {
          issues.push(
            `criterion ${it.criteriaId}: a C verdict needs evidence to cite, and none was harvested for this criterion — record "manual" (reason "undecidable"), or "NA" if nothing in scope is concerned`,
          );
        }
      } else if (cites.length === 0) {
        issues.push(
          `criterion ${it.criteriaId}: a ${v} verdict must cite at least one of the ${it.evidence.length} evidence item(s) it was shown (citations: [{file, line, …}])`,
        );
      } else {
        // Each citation must name evidence THIS item carried. Grounding alone would only
        // prove the anchor exists somewhere in the tree; the pairing proves the agent ruled
        // on what it was actually given.
        const anchors = new Set(it.evidence.map((e) => `${e.file}:${e.line}`));
        for (const c of cites) {
          if (!anchors.has(`${c.file}:${c.line}`)) {
            issues.push(`criterion ${it.criteriaId}: citation ${c.file}:${c.line} is not among this criterion's harvested evidence (fabricated?)`);
          }
          groundInputs.push({ file: c.file, line: c.line, selector: c.selector, snippet: c.snippet });
        }
      }
    } else if (v === "NC") {
      if (!it.findings || it.findings.length === 0) issues.push(`criterion ${it.criteriaId}: an NC verdict requires at least one groundable finding`);
      for (const f of it.findings ?? []) {
        // FAIL-CLOSED: every NC finding must cite a precise, resolvable test of the active
        // standard. A good practice with no normative test is a recommendation, not an NC.
        if (!f.normativeRef || !f.normativeRef.trim()) {
          issues.push(`criterion ${it.criteriaId}: an NC finding requires a normativeRef citing the failed test of the active standard`);
        } else if (!normativeRefResolves(f.normativeRef, adj.standard, isCore(adj.standard) ? undefined : it.criteriaId)) {
          issues.push(
            isCore(adj.standard)
              ? `criterion ${it.criteriaId}: normativeRef "${f.normativeRef}" does not resolve to a test of ${adj.standard} (fabricated?)`
              : `criterion ${it.criteriaId}: normativeRef "${f.normativeRef}" is not a test of ${adj.standard} ${it.criteriaId} — cite one of its own tests (e.g. "${it.criteriaId}.1"); a WCAG id looks alike but denotes an unrelated test`,
          );
        }
        groundInputs.push({ file: f.file, line: f.line, selector: f.selector, snippet: f.snippet });
      }
    } else if (v === "manual") {
      if (!it.reason || !MANUAL_REASONS.has(it.reason))
        issues.push(`criterion ${it.criteriaId}: a manual verdict requires reason ∈ {needs-rendered-dom, undecidable}`);
    } else {
      issues.push(`criterion ${it.criteriaId}: unknown verdict "${String(v)}"`);
    }
    // Recommendations are independent of the verdict (a C criterion may still carry a good
    // practice) and are grounded exactly like an NC finding — no normativeRef required, as
    // a recommendation has no normative test by definition.
    for (const rec of it.recommendations ?? []) groundInputs.push({ file: rec.file, line: rec.line, selector: rec.selector, snippet: rec.snippet });
  }

  // Content-level grounding of every agent NC finding, every C/NA citation, and every
  // recommendation — the same check, whichever direction the verdict points.
  const grounding = groundItems(groundInputs, { cwd: opts.cwd });
  for (const gi of grounding.issues) issues.push(gi);

  if (issues.length) {
    return { ok: false, audit, issues, applied: 0, stillManual: 0, grounding };
  }

  // Apply: clone the audit, update the decided criteria + append agent findings.
  const next: AuditResult = structuredClone(audit);
  const critById = new Map(next.criteria.map((c) => [c.id, c]));
  const newFindings: Finding[] = [];
  let applied = 0;
  let stillManual = 0;

  // PACK MODE. The items are the pack's own criteria, which have no counterpart in
  // `next.criteria` (a WCAG-keyed list). Recording them there would be wrong twice over: it
  // would let a pack decision rewrite the WCAG core verdict, and — since 1.1.1 alone fans out
  // to 19 RGAA criteria — it would let those criteria overwrite one another on a shared
  // success criterion. They get their own layer, which `derivePackResults` then prefers.
  if (packMode) {
    const decided: PackCriterionAdjudication[] = [];
    for (const it of adj.items) {
      if (it.verdict === "manual") {
        stillManual++;
        decided.push({
          id: it.criteriaId,
          status: "manual",
          reason: it.reason === "needs-rendered-dom" ? "needs-rendered-dom" : "undecidable",
          justification: it.reason === "needs-rendered-dom" ? residualScanReason() : residualUndecidableReason(),
          findings: [],
          decidedBy: "agent",
        });
        continue;
      }
      applied++;
      const fs = it.verdict === "NC" ? it.findings.map((f) => agentFinding(it.criteriaId, f)) : [];
      const recs = (it.recommendations ?? []).map((rec) => agentFinding(it.criteriaId, rec, true));
      newFindings.push(...fs, ...recs);
      decided.push({
        id: it.criteriaId,
        status: it.verdict as Status,
        ...(it.verdict === "C" || it.verdict === "NA" ? { justification: it.justification.trim() } : {}),
        findings: [...fs, ...recs],
        decidedBy: "agent",
      });
    }
    next.packAdjudication = { standard: adj.standard, criteria: decided };
    // The agent's findings still join the flat list so grounding, `check` and the reports can
    // resolve them — but they never touch a WCAG criterion's status.
    next.findings = [...next.findings, ...newFindings];
    next.adjudicated = { date: adj.auditDate, applied, stillManual };
    return { ok: true, audit: next, issues, applied, stillManual, grounding };
  }

  for (const it of adj.items) {
    const c = critById.get(it.criteriaId);
    if (!c) continue; // an item for a non-residual criterion — ignore (coverage already gated)
    if (it.verdict === "manual") {
      c.status = "manual";
      c.decidedBy = "agent";
      c.justification = it.reason === "needs-rendered-dom" ? residualScanReason() : residualUndecidableReason();
      stillManual++;
      continue;
    }
    applied++;
    c.status = it.verdict as Status;
    c.decidedBy = "agent";
    if (it.verdict === "C" || it.verdict === "NA") c.justification = it.justification.trim();
    if (it.verdict === "NC") {
      const fs: Finding[] = it.findings.map((f) => agentFinding(it.criteriaId, f));
      c.findings = fs;
      newFindings.push(...fs);
      delete c.justification;
    }
  }

  // Fold recommendations as ADVISORY findings on their criterion — status-neutral (they
  // ride alongside whatever verdict was applied, incl. C/NA/manual) and never enter NC or
  // conformancePct. A separate pass so a `manual` item (which `continue`s above) still
  // gets its recommendations, and an NC item's reset `c.findings` keeps them appended last.
  for (const it of adj.items) {
    const c = critById.get(it.criteriaId);
    if (!c) continue;
    for (const rec of it.recommendations ?? []) {
      const f = agentFinding(it.criteriaId, rec, true);
      c.findings.push(f);
      newFindings.push(f);
    }
  }

  next.findings = [...next.findings, ...newFindings];
  // Residual set now holds only the still-manual criteria.
  next.residualRisks = next.residualRisks.filter((r) => byId.get(r.criteriaId)?.verdict === "manual");
  recomputeTallies(next);
  next.adjudicated = { date: adj.auditDate, applied, stillManual };
  return { ok: true, audit: next, issues: [], applied, stillManual, grounding };
}

function agentFinding(criteriaId: string, f: AgentFinding, advisory = false): Finding {
  return {
    ruleId: `agent:${criteriaId}`,
    criteriaId,
    file: f.file,
    line: f.line,
    col: 1,
    selectorHint: f.selector ?? "",
    severity: f.severity ?? (advisory ? "mineur" : NC_SEVERITY_DEFAULT),
    message: f.message,
    remediation: getSC(criteriaId)?.understanding ? `See WCAG ${criteriaId}.` : "Address the reported non-conformity.",
    snippet: f.snippet ?? "",
    ...(advisory ? { advisory: true } : {}),
  };
}

/** Recompute guideline tallies + conformancePct after statuses changed. Mirrors the
 *  finalize() logic in src/audit.ts so an adjudicated audit is internally consistent. */
function recomputeTallies(a: AuditResult): void {
  for (const g of a.guidelines) {
    const inG = a.criteria.filter((c) => c.guideline === g.key);
    g.c = inG.filter((c) => c.status === "C").length;
    g.nc = inG.filter((c) => c.status === "NC").length;
    g.na = inG.filter((c) => c.status === "NA").length;
    g.manual = inG.filter((c) => c.status === "manual").length;
  }
  // `conformancePct` is labelled everywhere as the AUTOMATIC static-check pass rate, so an
  // agent's C must not enter it — otherwise one adjudication pass turns a judgement into a
  // machine-verified number, which is exactly the claim the label denies. An agent NC does
  // count: a non-conformity is evidenced (grounded finding + normativeRef) and reporting
  // it lowers the rate, which is the safe direction.
  const decided = a.criteria.filter((c) => c.status === "NC" || (c.status === "C" && c.decidedBy !== "agent"));
  const conform = decided.filter((c) => c.status === "C").length;
  a.conformancePct = decided.length === 0 ? 100 : Math.round((conform / decided.length) * 100);
}

const residualScanReason = () => "Rendering criterion — decide on the rendered DOM (`scan`).";
const residualUndecidableReason = () => "Left as an explicit residual risk (not decidable from the available evidence).";

// ---- worklist file rendering ----
const T = {
  fr: {
    title: "# Adjudication des critères à évaluer (ultra11y)",
    intro:
      "Pour CHAQUE critère, lisez les évidences ci-dessous (extraites de la source auditée) et attribuez un verdict dans `ADJUDICATE.todo.json` (champ `verdict`) :",
    verdicts: [
      "- `C` — conforme (renseignez `justification` ET `citations[]` : les évidences que vous avez levées, `file`/`line` recopiés depuis la liste du critère) ;",
      "- `NC` — non conforme (ajoutez au moins un `findings[]` : file/line/message, avec un `snippet` groundable ET un `normativeRef` citant le test précis échoué) ;",
      "- `NA` — non applicable (renseignez `justification` ; si des évidences sont présentées, citez-les aussi dans `citations[]` pour dire lesquelles sortent du périmètre) ;",
      "- `manual` — indécidable statiquement (renseignez `reason` : `needs-rendered-dom` → `scan`, ou `undecidable`).",
    ],
    rule: "> Ne signalez une NC que si un test précis du référentiel actif échoue — citez-le (`normativeRef`). Une bonne pratique sans test normatif est une recommandation (`recommendations[]`, non normative). Une simple préoccupation UX n'est ni l'un ni l'autre.\n>\n> Symétriquement, un `C` se cite comme une NC : il faut nommer dans `citations[]` les évidences levées. **Un critère présenté sans aucune évidence ne peut pas être `C`** — c'est `manual` (`undecidable`), ou `NA` si rien n'est concerné.",
    then: "Puis : `ultra11y verify --apply ADJUDICATE.todo.json --in <audit.json> --out <dir>` (échoue si un verdict manque sa justification, ses citations, son finding ou sa raison).",
    evidence: "Évidences",
    none: "(aucune évidence automatique — décidez depuis la source, ou laissez `manual` avec une raison)",
    questions: "À vérifier manuellement",
    decide: "Règle de décision",
    na: "Non applicable si",
    refs: "Références normatives mobilisables (techniques/échecs W3C de ce critère)",
    packIntro: (name: string) =>
      `Référentiel actif : **${name}**. Les items ci-dessous sont des critères ${name}, pas des critères de succès WCAG. Un \`normativeRef\` DOIT citer un test du critère de l'item (par ex. \`11.2.1\`) — un id WCAG y ressemble mais désigne un tout autre test et sera rejeté.`,
    packTests: (name: string, id: string) => `Tests ${name} ${id} à trancher`,
    technicalNote: "Note technique",
    particularCases: "Cas particuliers",
    glossary: "Termes définis par le référentiel",
  },
  en: {
    title: "# Criteria adjudication (ultra11y)",
    intro: "For EACH criterion, read the evidence below (harvested from the audited source) and set a verdict in `ADJUDICATE.todo.json` (field `verdict`):",
    verdicts: [
      "- `C` — conformant (fill `justification` AND `citations[]`: the evidence you cleared, `file`/`line` copied from the criterion's own list);",
      "- `NC` — non-conformant (add at least one `findings[]`: file/line/message, with a groundable `snippet` AND a `normativeRef` citing the precise failed test);",
      "- `NA` — not applicable (fill `justification`; when evidence is presented, cite it too in `citations[]` to say which items are out of scope);",
      "- `manual` — not statically decidable (fill `reason`: `needs-rendered-dom` → `scan`, or `undecidable`).",
    ],
    rule: "> Report NC only if a precise test of the active standard fails — cite it (`normativeRef`). A good practice without a normative test is a recommendation (`recommendations[]`, non-normative). A purely UX concern is neither.\n>\n> A `C` is cited the same way an NC is: name the evidence you cleared in `citations[]`. **A criterion presented with no evidence at all cannot be `C`** — record `manual` (`undecidable`), or `NA` if nothing in scope is concerned.",
    then: "Then: `ultra11y verify --apply ADJUDICATE.todo.json --in <audit.json> --out <dir>` (fails if any verdict lacks its justification, citations, finding or reason).",
    evidence: "Evidence",
    none: "(no automatic evidence — decide from source, or leave `manual` with a reason)",
    questions: "To verify manually",
    decide: "Decision rule",
    na: "Not applicable when",
    refs: "Normative references you may cite (this criterion's W3C techniques/failures)",
    packIntro: (name: string) =>
      `Active standard: **${name}**. The items below are ${name} criteria, not WCAG success criteria. A \`normativeRef\` MUST cite a test OF THE ITEM'S CRITERION (e.g. \`11.2.1\`) — a WCAG id looks alike but denotes an unrelated test and will be rejected.`,
    packTests: (name: string, id: string) => `${name} ${id} tests to rule on`,
    technicalNote: "Technical note",
    particularCases: "Particular cases",
    glossary: "Terms the standard defines",
  },
} as const;

// SC-keyed adjudication protocol (src/data/adjudication.json, built by
// scripts/build-adjudication.mjs): for every criterion the static engine cannot settle, the
// rule that decides Conforming vs Non-conforming, when NA is legitimate, and the concrete
// questions that get you there. Rendered per residual item in both languages — a criterion
// handed to the agent with no stated decision rule is where an audit turns into an opinion.
type LocaleText = { fr: string; en: string };
const ADJUDICATION = adjudicationJson as Record<string, { decide: LocaleText; na?: LocaleText; questions: LocaleText[] }>;

/** Cap on techniques listed per criterion: 1.1.1 alone carries 52, which would bury the
 *  decision rule under a wall of ids. The full list stays in `criteria <sc>`. */
const MAX_REFS = 12;

/** Render the per-criterion decision protocol as a standalone reference
 *  (skills/ultra11y/references/adjudication.md). Generated from the same dataset the
 *  worklist uses, so the page an agent reads and the prompt it answers can never drift. */
export function renderAdjudicationReference(lang: Lang = "en"): string {
  const out: string[] = [];
  out.push("<!-- GENERATED from src/data/adjudication.json by `pnpm run build:adjudication` — do not edit by hand. -->", "");
  out.push("# Deciding the criteria the engine hands you", "");
  out.push(
    "The static engine decides 3 of the 55 WCAG 2.2 AA success criteria outright. The other 52",
    "come back as residual risks: 14 need a rendered page (the `scan` tier), 38 are judgment",
    "calls. This page is the decision rule for each of them — what makes it Conforming, when",
    "`NA` is legitimate, and the questions that get you there.",
    "",
    "It is the same dataset `verify --manual` loads into `ADJUDICATE.md`, so the worklist and",
    "this page can never disagree. Two rules govern every verdict below:",
    "",
    "- **A non-conformity must cite a normative test that resolves.** The worklist proposes the",
    "  criterion's W3C techniques; `verify --apply` rejects a `normativeRef` that does not exist.",
    "- **A good practice with no failing test is a recommendation**, not a non-conformity — it",
    "  never flips a criterion, never enters the conformance rate.",
    "",
  );
  const byGuideline = new Map<string, string[]>();
  for (const sc of allSC()) {
    const protocol = ADJUDICATION[sc.sc];
    if (!protocol) continue;
    const lines = byGuideline.get(sc.guideline) ?? [];
    lines.push(`### ${sc.sc} — ${scTitle(sc.sc, lang) ?? sc.title}  ·  ${sc.level}  ·  _${sc.automatability}_`, "", `**Decide.** ${protocol.decide[lang]}`, "");
    if (protocol.na) lines.push(`**Not applicable when.** ${protocol.na[lang]}`, "");
    if (protocol.questions.length) {
      lines.push("**Ask.**", "");
      for (const q of protocol.questions) lines.push(`- ${q[lang]}`);
      lines.push("");
    }
    const refs = techniquesFor(sc.sc);
    if (refs.length)
      lines.push(`**Citable references.** ${refs.slice(0, MAX_REFS).join(", ")}${refs.length > MAX_REFS ? ` … (\`criteria ${sc.sc}\`)` : ""}`, "");
    byGuideline.set(sc.guideline, lines);
  }
  for (const [guideline, lines] of byGuideline) {
    out.push(`## ${guideline} ${guidelineTitle(guideline, lang) ?? ""}`.trimEnd(), "");
    out.push(...lines);
  }
  return out.join("\n");
}

// A criterion's tests refer constantly to normatively-defined terms
// (`[alternative textuelle](#alternative-textuelle-image)`). The definitions live in the
// pack's glossary — 119 entries for RGAA — which nothing used to read. Attaching the ones
// THIS criterion's tests actually cite makes the item self-sufficient: the agent no longer
// has to guess what the standard means by "image porteuse d'information".
const GLOSSARY_REF = /\[[^\]]+\]\(#([^)]+)\)/g;
const MAX_GLOSSARY_TERMS = 8;
const MAX_GLOSSARY_CHARS = 600;

/** The glossary anchors a criterion's tests / notes / particular cases refer to, in order. */
export function glossaryAnchorsOf(crit: { tests?: Record<string, string[]>; technicalNote?: string[]; particularCases?: string[] } | undefined): string[] {
  if (!crit) return [];
  const texts = [...Object.values(crit.tests ?? {}).flat(), ...(crit.technicalNote ?? []), ...(crit.particularCases ?? [])];
  const seen = new Set<string>();
  for (const t of texts) {
    GLOSSARY_REF.lastIndex = 0;
    for (let m = GLOSSARY_REF.exec(t); m; m = GLOSSARY_REF.exec(t)) if (m[1]) seen.add(m[1]);
  }
  return [...seen];
}

function glossaryBlock(pack: StandardPack, crit: PackCriterion | undefined, lang: Lang): string[] {
  const anchors = glossaryAnchorsOf(crit).slice(0, MAX_GLOSSARY_TERMS);
  if (!anchors.length) return [];
  const s = T[lang];
  const out: string[] = [`> **${s.glossary}**`, ""];
  let any = false;
  for (const a of anchors) {
    const entry = resolveGlossary(pack.key, a);
    if (!entry) continue;
    any = true;
    const body = entry.body.replace(/\s+/g, " ").trim();
    out.push(`- **${entry.title}** — ${body.length > MAX_GLOSSARY_CHARS ? `${body.slice(0, MAX_GLOSSARY_CHARS)}…` : body}`);
  }
  out.push("");
  return any ? out : [];
}

/** The pack's own implementation guidance for this criterion (before/after examples). Used by
 *  `prd`/`auditor` for NC units only — a `manual` criterion never reached it, which is exactly
 *  the criterion an adjudicator is looking at. */
function packGuidanceBlock(standard: StandardId, criterionId: string, lang: Lang): string[] {
  const entries = guidanceForCriterion(standard, criterionId);
  if (!entries.length) return [];
  return guidanceExampleBlock(entries, lang);
}

/** Strip a test's glossary cross-references down to their visible label:
 *  `[alternative textuelle](#alternative-textuelle-image)` → `alternative textuelle`. The
 *  definitions themselves are attached separately (see `glossaryBlock`). */
function plainTest(s: string): string {
  return s.replace(/\[([^\]]+)\]\(#[^)]*\)/g, "$1");
}

export function formatAdjudication(items: AdjudicationItem[], lang: Lang = "en", standard: StandardId = CORE): string {
  const s = T[lang];
  const pack = isCore(standard) ? undefined : loadPack(standard);
  const out: string[] = [s.title, "", s.intro, "", ...s.verdicts, "", s.rule, "", s.then, ""];
  if (pack) out.push(`> ${s.packIntro(pack.name)}`, "");
  for (const it of items) {
    out.push(`## ${pack ? `${pack.name} ` : ""}${it.criteriaId}${it.title ? ` — ${it.title}` : ""}  _(${it.automatability})_`);
    out.push("", `> ${s.evidence} (${it.evidence.length}${it.evidenceTruncated ? ` / ${it.evidenceTruncated.total}` : ""}):`, "");
    if (!it.evidence.length) out.push(s.none, "");
    else {
      for (const e of it.evidence) out.push(`- \`${e.file}:${e.line}\` (\`${e.selector}\`)${e.note ? ` — ${e.note}` : ""}`);
      out.push("");
    }
    const protocol = ADJUDICATION[it.criteriaId];
    if (protocol) {
      out.push(`> **${s.decide}** — ${protocol.decide[lang]}`, "");
      if (protocol.na) out.push(`> **${s.na}** — ${protocol.na[lang]}`, "");
      if (protocol.questions.length) {
        out.push(`> ${s.questions}:`, "");
        for (const q of protocol.questions) out.push(`- ${q[lang]}`);
        out.push("");
      }
    }
    // The references a NC on this criterion may legitimately cite. `verify --apply` rejects
    // a normativeRef that does not resolve, so what is proposed here MUST be what the gate
    // accepts — under a pack that is the criterion's own numbered tests, never a W3C
    // technique code (which the pack gate has always refused).
    if (pack) {
      const crit = getCriterion(pack, it.criteriaId);
      const tests = crit?.tests ?? {};
      const keys = Object.keys(tests);
      if (keys.length) {
        out.push(`> **${s.packTests(pack.name, it.criteriaId)}**`, "");
        for (const k of keys) {
          const lines = tests[k] ?? [];
          // A RGAA test can carry sub-conditions ("… vérifie-t-il ces conditions ?" followed
          // by the list). Number the test once and indent its conditions, rather than
          // repeating the id and reading like N separate tests.
          out.push(`- \`${it.criteriaId}.${k}\` ${plainTest(lines[0] ?? "")}`);
          for (const line of lines.slice(1)) out.push(`  - ${plainTest(line)}`);
        }
        out.push("");
      }
      if (crit?.technicalNote?.length) out.push(`> **${s.technicalNote}** — ${crit.technicalNote.map(plainTest).join(" ")}`, "");
      if (crit?.particularCases?.length) out.push(`> **${s.particularCases}** — ${crit.particularCases.map(plainTest).join(" ")}`, "");
      out.push(...glossaryBlock(pack, crit, lang));
      out.push(...packGuidanceBlock(standard, it.criteriaId, lang));
      if (keys.length) out.push(`> ${s.refs}: ${keys.map((k) => `\`${it.criteriaId}.${k}\``).join(", ")}`, "");
    } else {
      const refs = techniquesFor(it.criteriaId);
      if (refs.length) {
        out.push(`> ${s.refs}: ${refs.slice(0, MAX_REFS).join(", ")}${refs.length > MAX_REFS ? ` … (\`criteria ${it.criteriaId}\`)` : ""}`, "");
      }
    }
  }
  return out.join("\n");
}

export interface WriteAdjudicationResult {
  todoPath: string;
  mdPath: string;
  count: number;
}

export function writeAdjudication(
  items: AdjudicationItem[],
  outDir: string,
  opts: { standard: StandardId; auditDate: string; lang?: Lang },
): WriteAdjudicationResult {
  mkdirSync(outDir, { recursive: true });
  const todoPath = join(outDir, "ADJUDICATE.todo.json");
  const mdPath = join(outDir, "ADJUDICATE.md");
  const file: AdjudicationFile = {
    tool: "ultra11y",
    kind: "adjudication",
    schemaVersion: SCHEMA_VERSION,
    standard: opts.standard,
    auditDate: opts.auditDate,
    items,
  };
  writeFileSync(todoPath, JSON.stringify(file, null, 2) + "\n");
  writeFileSync(mdPath, formatAdjudication(items, opts.lang ?? "en", opts.standard));
  return { todoPath, mdPath, count: items.length };
}

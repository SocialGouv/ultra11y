// `verify` — the high-assurance gate above `check`. Turns a report's
// non-conformities into a claim↔criterion↔element worklist for adversarial
// support-checking, then (--apply) reduces a filled worklist to pass/fail:
// any refuted/unsupported (or unadjudicated) claim fails the gate. Guards against
// fabricated non-conformities surviving into the final report.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditResult, CriterionCitation, Lang } from "./types.js";
import { getSC, scTitle } from "./wcag.js";
import { type StandardId, isCore, loadPack, getCriterion as getPackCriterion, idCaptureSource } from "./standards/index.js";

export const VERIFY_MAX = 40;

export type Verdict = "supported" | "partial" | "refuted" | "unsupported" | null;

/** WHAT A WORKLIST ITEM PUTS ON TRIAL.
 *
 *  `nc` — a claimed non-conformity. The original and, for a long time, the only one:
 *  the gate existed to stop a fabricated failure reaching a deliverable.
 *
 *  `c` — a claimed CONFORMITY, and the asymmetry it closes. `verify` attacked only
 *  non-conformities, so a cheap adjudicator's `C` was never challenged by anything: a
 *  criterion could be cleared on a citation that merely showed the element EXISTED —
 *  an `<img>` with some alt text, a page with some `<title>` — and nothing downstream
 *  ever asked whether that established the criterion. Wrong in the expensive direction,
 *  too: an invented non-conformity costs a reviewer an argument, an invented conformity
 *  ships as an accessibility claim about a site nobody checked.
 *
 *  The verdict vocabulary is deliberately the same on both, because the QUESTION is the
 *  same — does the cited evidence support the claim? — and only the claim differs. */
export type VerifyKind = "nc" | "c";

export interface VerifyItem {
  n: number;
  criteriaId: string;
  file: string;
  line: number;
  selector: string;
  claim: string;
  verdict: Verdict;
  note: string;
  /** Absent ⇒ `nc`, so every worklist written before conformities were verified reads
   *  unchanged and every stored verdicts file still applies. */
  kind?: VerifyKind;
  /** A claimed conformity is established by its evidence SET, especially for cross-page
   * criteria. The primary file/line fields remain for compatibility and display. */
  citations?: CriterionCitation[];
}

const plain = (s: string) => s.replace(/\[([^\]]+)\]\(#[^)]*\)/g, "$1");

// ---- CURRENT shape (Phase 4): report.ts §2 renders one auditor block per NC
// criterion (src/auditor.ts `renderAuditorUnit`) — a "#### <icon> <label>" heading,
// a "**<criterion term>** : <id>[ — <title>]" line, then a checklist of
// "- [ ] `file:line` (`sel`) — message" occurrences (one per finding). The id is
// stated ONCE per criterion (not per occurrence, unlike the legacy shape below), so
// parsing tracks the "current criterion" as it walks the lines. ----

/** The auditor block's criterion line. Deliberately does NOT anchor on the label
 *  TEXT ("Critère"/"Success criterion"/"Critère de succès"/…) — that's the active
 *  standard's vocabulary (src/standards/vocabulary.ts) and varies per pack/lang.
 *  Matches ANY bold label, keying only on the id + the em-dash grammar, end-of-line
 *  anchored so a pack's (possibly shorter) id pattern can never partial-match inside
 *  a longer line, e.g. "**WCAG** : 2.4.7 (A)" (no trailing em-dash there). */
function auditorCriterionLine(standard: StandardId): RegExp {
  const id = isCore(standard) ? "\\d{1,2}(?:\\.\\d{1,2}){2}" : idCaptureSource(loadPack(standard));
  return new RegExp(`^\\*\\*[^*:]+\\*\\*\\s*:\\s*(${id})(?:\\s*—.*)?\\s*$`);
}

// One checklist occurrence line under a criterion block. Exported so tests can pin the
// shared renderer (src/auditor.ts `occurrenceLine`) to this parser directly, rather than
// re-deriving the grammar — the two must never drift apart.
// Leading whitespace is allowed so an occurrence may sit INDENTED under a group header (the
// per-page sheet folds repeated occurrences of one rule+selector — src/auditor.ts `collapse`).
// The fold is visual only: every occurrence keeps a parseable line, so the worklist this builds
// holds exactly as many items grouped as ungrouped, and no claimed non-conformity escapes
// adjudication by being tucked under a heading.
export const AUDITOR_OCCURRENCE = /^\s*-\s\[ \]\s+`([^`]+):(\d+)`\s+\(`([^`]*)`\)\s+—\s+(.*)$/;
// Any markdown heading (##/###/####) — leaving one resets the "current criterion" so
// an occurrence-shaped line elsewhere in the document can never be mis-attributed.
const HEADING_LINE = /^#{2,4}\s/;

function buildWorklistFromAuditorBlocks(reportMd: string, standard: StandardId, max: number): VerifyItem[] {
  const items: VerifyItem[] = [];
  const critLine = auditorCriterionLine(standard);
  const lines = reportMd.split("\n");
  let currentId: string | null = null;
  for (let i = 0; i < lines.length && items.length < max; i++) {
    const line = lines[i]!;
    const c = critLine.exec(line);
    if (c) {
      currentId = c[1]!;
      continue;
    }
    if (HEADING_LINE.test(line)) {
      currentId = null;
      continue;
    }
    if (!currentId) continue;
    const occ = AUDITOR_OCCURRENCE.exec(line);
    if (!occ) continue;
    items.push({ n: items.length + 1, criteriaId: currentId, file: occ[1]!, line: Number(occ[2]), selector: occ[3]!, claim: occ[4]!, verdict: null, note: "" });
  }
  return items;
}

// ---- LEGACY shape (pre-Phase-4 reports): report.ts §2 used to render one FLAT
// bullet per finding, "- **<id> — <title>** — `file:line` (`sel`)" followed by a
// plain-message sub-bullet. Kept as a fallback ONLY — a report produced by an older
// ultra11y version (or re-rendered from an old on-disk report.md) must still verify,
// never silently produce a 0-item (un-gated) worklist. ----
function legacyNcHeader(standard: StandardId): RegExp {
  const id = isCore(standard) ? "\\d{1,2}(?:\\.\\d{1,2}){2}" : idCaptureSource(loadPack(standard));
  return new RegExp(`^- \\*\\*(?:[A-Za-z]+ )?(${id}) — (.*?)\\*\\* — \`([^\`]+):(\\d+)\` \\(\`([^\`]*)\`\\)`);
}

function buildWorklistLegacy(reportMd: string, standard: StandardId, max: number): VerifyItem[] {
  const items: VerifyItem[] = [];
  const header = legacyNcHeader(standard);
  const lines = reportMd.split("\n");
  for (let i = 0; i < lines.length && items.length < max; i++) {
    const h = header.exec(lines[i]!);
    if (!h) continue;
    let claim = h[2] ?? "";
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const sub = /^\s+-\s+(.*)$/.exec(lines[j]!);
      if (sub && !sub[1]!.startsWith("_")) {
        claim = sub[1]!;
        break;
      }
    }
    items.push({ n: items.length + 1, criteriaId: h[1]!, file: h[3]!, line: Number(h[4]), selector: h[5]!, claim, verdict: null, note: "" });
  }
  return items;
}

/** Turn a report's non-conformities into a claim↔criterion↔element worklist for
 *  adversarial support-checking. Parses the CURRENT auditor-block NC shape first
 *  (see `buildWorklistFromAuditorBlocks`); if that finds nothing, falls back to the
 *  LEGACY flat-bullet shape (`buildWorklistLegacy`) so an older report still verifies.
 *  The two shapes are structurally disjoint (legacy bullets start with "- **", the
 *  new checklist items with "- [ ] "), so there is no ambiguity about which parsed. */
export function buildWorklist(reportMd: string, standard: StandardId = "wcag", max = VERIFY_MAX): VerifyItem[] {
  const items = buildWorklistFromAuditorBlocks(reportMd, standard, max);
  if (items.length) return items;
  return buildWorklistLegacy(reportMd, standard, max);
}

/** One adjudicated conformity, as the ledger and the adjudication file both store it. Kept
 *  structural rather than importing either type: this reads the two fields it needs from
 *  whichever artefact the caller resolved, and neither owns the other. */
export interface ConformityClaim {
  criteriaId: string;
  verdict?: string;
  justification?: string;
  citations?: { file: string; line?: number; selector?: string; snippet?: string }[];
}

/**
 * The adversarial worklist over CLAIMED CONFORMITIES — one item per claim, carrying the full
 * citation set the agent cleared it on.
 *
 * The source is the ledger (or an adjudication file), not the report, and that is not an
 * implementation convenience: a report's conforming section is a LIST of criteria, with no
 * anchors to attack. A `C` verdict, on the other hand, is required to name the evidence it
 * cleared — `file`, `line`, `selector`, `snippet` — which is exactly the shape an item needs.
 * Refuting a conformity means opening those anchors and asking whether they establish the
 * criterion or merely show that its subject exists.
 *
 * Engine conformities are NOT included, and the distinction matters. A criterion the
 * deterministic engine decided is recomputed from source on every run; a criterion an AGENT
 * decided is a judgement recorded once, and the judgement is what needs a second reader.
 */
/**
 * The claimed conformities an AUDIT DOCUMENT carries — the third source, and the one that
 * needs no opt-in.
 *
 * The ledger and the adjudication file both hold these, and both are optional artefacts: a
 * `judge --apply` without `--ledger`, run in a directory nobody kept, left an audit whose every
 * `C` was beyond reach of a second reader. Since the fold now persists `citations[]` on the
 * criterion itself, the audit under `--in` answers the question directly.
 *
 * ONLY AGENT VERDICTS, for the reason `buildConformityWorklist` gives: a criterion the
 * deterministic engine decided is recomputed from source on every run, so putting it on trial
 * would be attacking this run's own arithmetic. A judgement recorded once is what needs a
 * second reader. A pack adjudication recorded under a DIFFERENT standard is likewise ignored —
 * RGAA "11.2" and a WCAG SC id share a shape, and reading one as the other is the exact
 * confusion the anti-fabrication gate exists to prevent.
 */
/** The refutation verdict vocabulary, as a JSON schema the CLI validates its own output
 *  against. `n` is pinned to the items actually handed over, for the reason the adjudication
 *  schema pins `criteriaId`: a verdict that matches no item is silently dropped, and a paid-for
 *  answer thrown away without a word is worse than a refusal. */
export function refuteSchema(items: VerifyItem[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["verdicts"],
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["n", "verdict", "note"],
          properties: {
            n: { type: "integer", enum: items.map((it) => it.n), description: "The item number EXACTLY as given." },
            verdict: { type: "string", enum: ["supported", "partial", "refuted", "unsupported"] },
            note: { type: "string", description: "One sentence: what you opened, and what it showed." },
          },
        },
      },
    },
  };
}

/** The system prompt for the refutation pass.
 *
 *  ADVERSARIAL BY CONSTRUCTION, and that is the whole reason this pass exists: an adjudicator
 *  asked « is this criterion met? » and a reviewer asked « does the cited evidence establish
 *  what was claimed? » fail in different directions, and only the second catches an
 *  over-accusing first. The instruction to prefer refutation when the evidence is thin is
 *  deliberate — an unfounded claim withdrawn costs a criterion a second look, an unfounded
 *  claim kept ships as a conformance statement about a site nobody checked. */
export function refuteSystemPrompt(lang: Lang = "en"): string {
  const s = T[lang];
  const setRule =
    lang === "fr"
      ? "Pour une conformité qui porte `citations`, ouvrez et jugez le faisceau COMPLET : un critère transversal n'a pas à être prouvé par chaque ancre isolément."
      : "For a conformity carrying `citations`, open and judge the COMPLETE evidence set: a cross-cutting criterion need not be proved by each anchor in isolation.";
  return [s.refuteRole, "", s.supported, s.partial, s.refuted, s.unsupported, "", s.refuteInverted, setRule, s.refuteAttach, s.refuteDoubt, s.refuteNever].join(
    "\n",
  );
}

export function conformityClaimsFromAudit(audit: AuditResult, standard: StandardId): ConformityClaim[] {
  const claim = (c: { id: string; justification?: string; citations?: CriterionCitation[] }): ConformityClaim => ({
    criteriaId: c.id,
    verdict: "C",
    justification: c.justification,
    citations: c.citations,
  });
  if (!isCore(standard)) {
    const pa = audit.packAdjudication;
    if (!pa || pa.standard !== standard) return [];
    return pa.criteria.filter((c) => c.decidedBy === "agent" && c.status === "C").map(claim);
  }
  return audit.criteria.filter((c) => c.decidedBy === "agent" && c.status === "C").map(claim);
}

export function buildConformityWorklist(claims: ConformityClaim[], startAt = 0, max = VERIFY_MAX): VerifyItem[] {
  const items: VerifyItem[] = [];
  for (const c of claims) {
    if (c.verdict !== "C") continue;
    const citations: CriterionCitation[] = (c.citations ?? []).map((cite) => ({
      file: cite.file,
      line: cite.line ?? 1,
      selector: cite.selector ?? "",
      snippet: cite.snippet ?? "",
    }));
    const primary = citations[0];
    if (!primary) continue;
    if (items.length >= max) return items;
    items.push({
      n: startAt + items.length + 1,
      criteriaId: c.criteriaId,
      file: primary.file,
      line: primary.line ?? 1,
      selector: primary.selector ?? "",
      // The claim under trial is the justification the agent wrote. Attacking a paraphrase
      // of it would let a bad justification survive by never being read.
      claim: (c.justification ?? "").replace(/\s+/g, " ").trim(),
      verdict: null,
      note: "",
      kind: "c",
      citations,
    });
  }
  return items;
}

const T = {
  fr: {
    title: "# Vérification des non-conformités (ultra11y)",
    intro: "Pour CHAQUE entrée, ouvrez le fichier à la ligne citée et attribuez un verdict dans\n`VERIFY.todo.json` (champ `verdict`), avec une `note` :",
    supported: "- `supported` — la non-conformité est réelle et correctement rattachée au critère ;",
    partial: "- `partial` — réelle mais le critère/la formulation est imprécis ;",
    refuted: "- `refuted` — fausse (l'élément cité est en réalité conforme) ;",
    unsupported: "- `unsupported` — l'élément cité ne permet pas de trancher.",
    semantic: "> Mode --semantic : vérifiez que l'extrait cité **étaye** réellement la non-conformité.",
    conformityTitle: "## Conformités revendiquées (adjugées par un agent)",
    conformityIntro:
      "La question est INVERSÉE. Pour chaque entrée, ouvrez le fichier à la ligne citée et demandez-vous : cette évidence **établit-elle** le critère, ou montre-t-elle seulement que son sujet EXISTE ? Un `alt` présent n'est pas un `alt` pertinent ; un `<title>` présent n'est pas un titre qui décrit la page.",
    conformitySupported: "- `supported` — l'évidence citée établit bien la conformité ;",
    conformityPartial: "- `partial` — elle l'établit pour l'élément cité, mais la justification déborde sur des cas qu'elle ne couvre pas ;",
    conformityRefuted: "- `refuted` — l'évidence n'établit pas la conformité (elle constate une présence, pas une pertinence) ;",
    conformityUnsupported: "- `unsupported` — l'évidence citée ne permet pas de trancher.",
    refuteRole:
      "Vous êtes le SECOND lecteur d'un audit d'accessibilité. Vous n'auditez pas : vous mettez à l'épreuve des constats déjà écrits. Pour chaque entrée, ouvrez le fichier à la ligne citée, lisez l'élément, et dites si l'évidence citée étaye la revendication :",
    refuteInverted:
      "Les entrées marquées « conformité revendiquée » posent la question INVERSE : l'évidence ÉTABLIT-elle le critère, ou constate-t-elle seulement que son sujet EXISTE ? Un `alt` présent n'est pas un `alt` pertinent ; un `<title>` présent n'est pas un titre qui décrit la page.",
    refuteAttach:
      "Vérifiez aussi le RATTACHEMENT : le référentiel sépare l'existence d'une chose et sa pertinence en deux critères distincts. Un constat d'absence rangé sous le critère de pertinence est `refuted` — il est réel, mais il appartient au critère voisin.",
    refuteDoubt: "Dans le doute, réfutez. Un constat retiré à tort coûte une relecture ; un constat gardé à tort part dans un document opposable.",
    refuteNever: "Ne réécrivez rien, ne corrigez rien, n'auditez aucun critère absent de la liste. Répondez uniquement par les verdicts demandés.",
    conformityCheck:
      "- [ ] Aucune conformité inventée : un `C` réfuté ou non étayé retourne « à évaluer » — il ne devient PAS une non-conformité, car réfuter une conformité ne prouve rien contre le critère.",
    then: "Puis : `ultra11y verify --apply VERIFY.todo.json` (échoue si un verdict est refuted/unsupported).",
    understand: "Comprendre",
    moreTests: (n: number, id: string) => `… +${n} autre(s) test(s) — voir \`criteria --standard <pack> ${id}\``,
    checklistTitle: "## Liste de contrôle avant clôture",
    checklist: [
      "- [ ] Chaque entrée porte un verdict (aucun `null`).",
      "- [ ] Aucune non-conformité inventée : chaque verdict `supported` cite un élément réel à la ligne indiquée.",
      "- [ ] Non-conformité UNIQUEMENT si un test précis du référentiel actif échoue — citez-le. Une bonne pratique sans test normatif est une recommandation ; une simple préoccupation UX n'est ni l'un ni l'autre.",
      "- [ ] Les critères « à évaluer » (rendu / jugement) ont été adjugés par l'agent (`verify --manual` → `--apply`), ou laissés en risque résiduel explicite (rendu → `scan`).",
      "- [ ] Pour un code rendu par une bibliothèque (DSFR…), le verdict s'appuie sur le HTML **produit** (build / `scan`), pas sur la source JSX.",
      "- [ ] `ultra11y verify --apply VERIFY.todo.json` repasse au vert.",
    ],
  },
  en: {
    title: "# Non-conformity verification (ultra11y)",
    intro: "For EACH entry, open the file at the cited line and assign a verdict in\n`VERIFY.todo.json` (field `verdict`), with a `note`:",
    supported: "- `supported` — the non-conformity is real and correctly tied to the criterion;",
    partial: "- `partial` — real but the criterion/wording is imprecise;",
    refuted: "- `refuted` — false (the cited element is actually conforming);",
    unsupported: "- `unsupported` — the cited element is not enough to decide.",
    semantic: "> --semantic mode: confirm the cited snippet actually **supports** the non-conformity.",
    conformityTitle: "## Claimed conformities (agent-adjudicated)",
    conformityIntro:
      "The question is INVERTED. For each entry, open the file at the cited line and ask: does this evidence **establish** the criterion, or does it only show that its subject EXISTS? A present `alt` is not a relevant `alt`; a present `<title>` is not a title that describes the page.",
    conformitySupported: "- `supported` — the cited evidence does establish conformity;",
    conformityPartial: "- `partial` — it establishes it for the cited element, but the justification reaches beyond what it covers;",
    conformityRefuted: "- `refuted` — the evidence does not establish conformity (it observes a presence, not a relevance);",
    conformityUnsupported: "- `unsupported` — the cited evidence is not enough to decide.",
    refuteRole:
      "You are the SECOND reader of an accessibility audit. You are not auditing: you are putting already-written observations on trial. For each entry, open the file at the cited line, read the element, and say whether the cited evidence supports the claim:",
    refuteInverted:
      "Entries marked “claimed conformity” ask the INVERTED question: does the evidence ESTABLISH the criterion, or does it only show that its subject EXISTS? A present `alt` is not a relevant `alt`; a present `<title>` is not a title that describes the page.",
    refuteAttach:
      "Check the ATTACHMENT too: the standard splits the existence of a thing and its relevance into two separate criteria. An observation of absence filed under the relevance criterion is `refuted` — it is real, but it belongs to the neighbouring criterion.",
    refuteDoubt: "When in doubt, refute. An observation wrongly withdrawn costs a second look; an observation wrongly kept ships in a legal deliverable.",
    refuteNever: "Rewrite nothing, fix nothing, audit no criterion absent from the list. Answer only with the verdicts asked for.",
    conformityCheck:
      "- [ ] No invented conformity: a refuted or unsupported `C` goes back to “to assess” — it does NOT become a non-conformity, because refuting a conformity proves nothing against the criterion.",
    then: "Then: `ultra11y verify --apply VERIFY.todo.json` (fails if any verdict is refuted/unsupported).",
    understand: "Understanding",
    moreTests: (n: number, id: string) => `… +${n} more test(s) — see \`criteria --standard <pack> ${id}\``,
    checklistTitle: "## Pre-completion checklist",
    checklist: [
      "- [ ] Every entry has a verdict (no `null`).",
      "- [ ] No invented non-conformity: every `supported` verdict cites a real element at the given line.",
      "- [ ] Report NC ONLY if a precise test of the active standard fails — cite it. A good practice without a normative test is a recommendation; a purely UX concern is neither.",
      "- [ ] The “to assess” criteria (rendering / judgment) have been adjudicated by the agent (`verify --manual` → `--apply`), or left as an explicit residual risk (rendering → `scan`).",
      "- [ ] For component-library-rendered code (DSFR…), the verdict relies on the **produced** HTML (build / `scan`), not the JSX source.",
      "- [ ] `ultra11y verify --apply VERIFY.todo.json` is green again.",
    ],
  },
} as const;

export function formatWorklist(items: VerifyItem[], semantic: boolean, standard: StandardId = "wcag", lang: Lang = "en"): string {
  const s = T[lang];
  const core = isCore(standard);
  const pack = core ? null : loadPack(standard);
  const out: string[] = [];
  out.push(s.title, "");
  out.push(s.intro, "");
  out.push(s.supported, s.partial, s.refuted, s.unsupported, "");
  if (semantic) out.push(s.semantic, "");
  out.push(s.then, "");
  // THE CONFORMITIES GET THEIR OWN SECTION AND THEIR OWN QUESTION. Same verdict vocabulary
  // — the question is always « does the cited evidence support the claim? » — but the claim
  // is inverted, and an adjudicator handed both in one undifferentiated list would read the
  // second half through the first half's framing and clear it.
  const ncItems = items.filter((it) => it.kind !== "c");
  const cItems = items.filter((it) => it.kind === "c");
  const render = (list: VerifyItem[]) => {
    for (const it of list) renderItem(it);
  };
  const renderItem = (it: VerifyItem) => {
    out.push(`- [ ] #${it.n} **${it.criteriaId}** @ \`${it.file}:${it.line}\` (\`${it.selector}\`) — ${it.claim}`);
    if (it.kind === "c" && (it.citations?.length ?? 0) > 1) {
      out.push(lang === "fr" ? "  - Faisceau complet à vérifier ensemble :" : "  - Complete evidence set to verify together:");
      for (const cite of it.citations ?? []) {
        out.push(`    - \`${cite.file}:${cite.line}\` (\`${cite.selector}\`)${cite.snippet ? ` — \`${cite.snippet.slice(0, 160)}\`` : ""}`);
      }
    }
    // Ground the judgment in the active standard's reference so the verdict is checked
    // against real conditions, not a guess.
    if (core) {
      const sc = getSC(it.criteriaId);
      if (sc) {
        out.push(`      WCAG ${sc.sc} — ${scTitle(sc.sc, lang)} [${sc.level}] · ${s.understand}: ${sc.understanding}`);
        if (sc.techniques?.length) out.push(`      Techniques: ${sc.techniques.join(", ")}`);
      }
    } else if (pack) {
      const c = getPackCriterion(pack, it.criteriaId);
      const tests = Object.values(c?.tests ?? {}).flat();
      if (tests.length) {
        out.push(`      ${pack.name} ${it.criteriaId} :`);
        for (const test of tests.slice(0, 6)) out.push(`      - ${plain(test)}`);
        // Honest overflow count instead of a silent drop — point at the full list.
        if (tests.length > 6) out.push(`      - ${s.moreTests(tests.length - 6, it.criteriaId)}`);
      }
    }
  };
  render(ncItems);
  if (cItems.length) {
    out.push("", s.conformityTitle, "");
    out.push(s.conformityIntro, "");
    out.push(s.conformitySupported, s.conformityPartial, s.conformityRefuted, s.conformityUnsupported, "");
    render(cItems);
  }
  out.push("");
  out.push(s.checklistTitle, "");
  for (const line of s.checklist) out.push(line);
  if (cItems.length) out.push(s.conformityCheck);
  out.push("");
  return out.join("\n");
}

export interface ApplyResult {
  ok: boolean;
  total: number;
  refuted: number;
  unsupported: number;
  unadjudicated: number;
  invalid: number;
  missing: number; // report NCs with no verdict at all (coverage gap) — only when `expected` is given
  failures: VerifyItem[];
  /** The failures that were CLAIMED CONFORMITIES. Reported separately because the remedy is
   *  different in kind: a refuted non-conformity is deleted from the report, a refuted
   *  conformity sends its criterion back to « to assess » — nobody has established it, and
   *  that is not the same as having established it fails. */
  conformitiesRefused: VerifyItem[];
}

// `kind` is part of the key: one criterion can be BOTH claimed non-conformant on one element
// and claimed conformant on another (RGAA 1.3 clearing four images and failing a fifth), and
// with the same anchor the two claims would collide — the coverage gate would then read a
// conformity verdict as covering the non-conformity, and let it through unadjudicated.
// Absent `kind` means `nc`, so every verdicts file written before this still keys identically.
const canonicalFile = (file: string): string => {
  const posix = file.replace(/\\/g, "/");
  const marker = ".ultra11y/pages/";
  const at = posix.lastIndexOf(marker);
  return at >= 0 ? posix.slice(at) : posix;
};
const citationKey = (cite: CriterionCitation): string => {
  const file = canonicalFile(cite.file);
  let snippet = cite.snippet;
  if (file.startsWith(".ultra11y/pages/") && snippet.startsWith("<!-- ultra11y:capture ")) snippet = snippet.replace(/\surl="[^"]*"/, "");
  return `${file}:${cite.line}:${cite.selector}:${snippet}`;
};
const citationSetKey = (it: VerifyItem): string => (it.kind === "c" ? (it.citations ?? []).map(citationKey).sort().join("||") : "");
const itemKey = (it: VerifyItem): string => `${it.kind ?? "nc"}|${it.criteriaId}|${it.file}|${it.line}|${it.selector}|${citationSetKey(it)}`;

/** Exact claim identity used only to resume an interrupted/re-generated trial. Unlike the
 * coverage key above, this includes the claim text: a changed assertion must be reviewed
 * again even when it still points at the same element. Snapshot paths are checkout-neutral,
 * so a worklist produced in another runner can still resume safely. */
const resumableItemKey = (it: VerifyItem): string => {
  return `${it.kind ?? "nc"}|${it.criteriaId}|${canonicalFile(it.file)}|${it.line}|${it.selector}|${it.claim}|${citationSetKey(it)}`;
};
const legacyConformityKey = (criteriaId: string, file: string, line: number, selector: string, claim: string): string =>
  `${criteriaId}|${canonicalFile(file)}|${line}|${selector}|${claim}`;

/** Every source anchor a passing claim asks the grounding gate to re-open. */
export function verifyGroundingInputs(items: VerifyItem[]): Array<{ file: string; line: number; selector?: string; snippet?: string }> {
  return items.flatMap((it) =>
    it.kind === "c" && it.citations?.length
      ? it.citations.map((cite) => ({ file: cite.file, line: cite.line, selector: cite.selector, snippet: cite.snippet }))
      : [{ file: it.file, line: it.line, selector: it.selector, snippet: (it as { snippet?: string }).snippet }],
  );
}

// Only these two verdicts clear the gate. Everything else — refuted, unsupported,
// null/unadjudicated, AND any unknown/typo/mis-cased token — must FAIL, so a
// fat-fingered verdict can never produce a false-green gate.
const PASSING: ReadonlySet<string> = new Set(["supported", "partial"]);

/** Canonicalise a stored verdict for gating: trim + lowercase, null if not a
 *  non-empty string. Does not coerce unknown tokens to a valid verdict. */
function normalizeVerdict(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return s ? s : null;
}

/** Adjudicate a verdicts file. When `expected` (the worklist derived from the report via
 *  buildWorklist) is provided, ALSO fail on any report NC the verdicts file does not cover
 *  — so a truncated/empty verdicts set can't slip a to-be-refuted finding past the gate. */
export function applyVerdicts(items: VerifyItem[], expected?: VerifyItem[]): ApplyResult {
  let refuted = 0;
  let unsupported = 0;
  let unadjudicated = 0;
  let invalid = 0;
  let missing = 0;
  const failures: VerifyItem[] = [];
  for (const it of items) {
    const v = normalizeVerdict(it.verdict);
    if (v !== null && PASSING.has(v)) continue;
    failures.push(it);
    if (v === "refuted") refuted++;
    else if (v === "unsupported") unsupported++;
    else if (v === null) unadjudicated++;
    else invalid++; // unknown/typo token — counted as a failure, not silently passed
  }
  if (expected) {
    const covered = new Set(items.map(itemKey));
    for (const e of expected) {
      if (!covered.has(itemKey(e))) {
        failures.push(e);
        missing++;
      }
    }
  }
  const total = expected ? expected.length : items.length;
  return {
    ok: failures.length === 0,
    total,
    refuted,
    unsupported,
    unadjudicated,
    invalid,
    missing,
    failures,
    conformitiesRefused: failures.filter((f) => f.kind === "c"),
  };
}

export interface WriteWorklistResult {
  todoPath: string;
  mdPath: string;
  count: number;
}

export function writeWorklist(items: VerifyItem[], outDir: string, semantic: boolean, standard: StandardId = "wcag", lang: Lang = "en"): WriteWorklistResult {
  mkdirSync(outDir, { recursive: true });
  const todoPath = join(outDir, "VERIFY.todo.json");
  const mdPath = join(outDir, "VERIFY.md");
  // Preserve completed decisions when a repaired audit regenerates the same claims. This is
  // both a resume mechanism and a token bound: only new or materially changed claims go back
  // to the refuter. Malformed/foreign files are ignored; generation itself never fails because
  // an old cache cannot be read.
  let carried = items;
  if (existsSync(todoPath)) {
    try {
      const previous = JSON.parse(readFileSync(todoPath, "utf8")) as VerifyItem[];
      const byClaim = new Map(previous.map((it) => [resumableItemKey(it), it]));
      const legacyConformities = new Map(
        previous
          .filter((it) => it.kind === "c" && !it.citations?.length)
          .map((it) => [legacyConformityKey(it.criteriaId, it.file, it.line, it.selector, it.claim), it]),
      );
      carried = items.map((it) => {
        const old = byClaim.get(resumableItemKey(it));
        const verdict = normalizeVerdict(old?.verdict);
        if (old && verdict && ["supported", "partial", "refuted", "unsupported"].includes(verdict)) {
          return { ...it, verdict: verdict as Exclude<Verdict, null>, note: typeof old.note === "string" ? old.note : "" };
        }
        // Safe one-time migration from the historical one-item-per-citation shape: only carry
        // when EVERY citation was independently upheld. Any refuted/unsupported/missing anchor
        // leaves the new evidence-set claim open so the reviewer can assess the combination.
        if (it.kind === "c" && it.citations?.length) {
          const oldSet = it.citations.map((cite) => legacyConformities.get(legacyConformityKey(it.criteriaId, cite.file, cite.line, cite.selector, it.claim)));
          const verdicts = oldSet.map((candidate) => normalizeVerdict(candidate?.verdict));
          if (oldSet.every(Boolean) && verdicts.every((candidate) => candidate === "supported" || candidate === "partial")) {
            const notes = [...new Set(oldSet.map((candidate) => candidate?.note?.trim()).filter(Boolean))];
            return { ...it, verdict: verdicts.includes("partial") ? "partial" : "supported", note: notes.join(" ") };
          }
        }
        return it;
      });
    } catch {
      // A stale worklist is expendable; the new one remains the source of truth.
    }
  }
  writeFileSync(todoPath, JSON.stringify(carried, null, 2) + "\n");
  writeFileSync(mdPath, formatWorklist(carried, semantic, standard, lang));
  return { todoPath, mdPath, count: items.length };
}

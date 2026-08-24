// `fix` — put the fixes in place. Hybrid by design (anti-hallucination first):
//   • auto codemods are applied deterministically;
//   • placeholders insert a valid attribute with a TODO sentinel the agent fills;
//   • proposals are judgment-only and never auto-written.
// --dry-run (default) prints a unified diff; --write applies, but ONLY after a
// re-audit proves no NEW non-conformity was introduced (regression gate). JSX/TSX
// parsed to a real AST is editable (jsxSafe codemods only); the lossy JSX fallback
// stays proposal-only (its offsets index the transformed string, not the file).
import { writeFileSync } from "node:fs";
import type { Finding, Lang } from "./types.js";
import { discover, hasUnstagedChanges, gitAdd } from "./discover.js";
import { parseSource } from "./parse/source.js";
import { runRules } from "./rules/registry.js";
import { readText } from "./util.js";
import { applyEdits, type Edit } from "./fix/edits.js";
import { CODEMODS, fixabilityOf, type Fixability } from "./fix/codemods.js";
import { unifiedDiff } from "./fix/diff.js";
import { CORE, isCore, loadPack, packCriteriaForFinding, type StandardId } from "./standards/index.js";

export interface FixInput {
  inputs: string[];
  stdin?: string;
  forceJsx?: boolean;
  include?: string[];
  exclude?: string[];
  ext?: string[];
  changed?: boolean;
  since?: string;
  staged?: boolean; // fix exactly the staged index snapshot; re-stage written files
  safe?: boolean; // apply only genuinely-automatic codemods (skip placeholder/proposal)
  only?: string[]; // limit to these ruleIds
  write?: boolean; // default false → dry-run
  noDefaultExcludes?: boolean; // also fix test/spec/story/__tests__ markup
  /** The standard whose criteria the output names. Absent ⇒ the WCAG core. It selects
   *  VOCABULARY only: which rules run and what they find is the engine's business, and no
   *  standard changes a codemod. */
  standard?: StandardId;
  onWarn?: (m: string) => void;
}

export interface FixItem {
  ruleId: string;
  /** The success criterion the rule is tied to. Always WCAG-keyed: the rules ARE WCAG rules,
   *  and this is the engine's own identifier for one. */
  criteriaId: string;
  /** The ACTIVE STANDARD's criteria for the same rule — `["8.4"]` under RGAA where
   *  `criteriaId` reads "3.1.1", and several ids where one rule fires on several criteria.
   *  Absent under the core, where it would only repeat `criteriaId`.
   *
   *  Carried rather than substituted because `fix` is the one command whose output an agent
   *  acts on directly: it needs the criterion the project is audited against to write the
   *  ticket, and the engine's own id to look the rule up. */
  packCriteriaIds?: string[];
  line: number;
  selectorHint: string;
  fixability: Fixability;
}

export interface FileFix {
  file: string;
  lossy: boolean;
  items: FixItem[];
  diff: string;
  applied: number; // edits applied (auto + placeholder)
  written: boolean;
  regression: boolean; // gate tripped → not written
  restaged?: boolean; // staged mode: written fix re-staged (git add)
  skippedPartialStage?: boolean; // staged mode: had unstaged edits → not written (unsafe to re-stage)
}

export interface FixResult {
  files: FileFix[];
  totals: {
    auto: number;
    placeholder: number;
    proposal: number;
    filesWritten: number;
    regressions: number;
    filesRestaged: number;
    partialStageSkipped: number;
  };
}

function itemOf(f: Finding, standard: StandardId): FixItem {
  const packIds = isCore(standard) ? [] : packCriteriaForFinding(loadPack(standard), f);
  return {
    ruleId: f.ruleId,
    criteriaId: f.criteriaId,
    ...(packIds.length ? { packCriteriaIds: packIds } : {}),
    line: f.line,
    selectorHint: f.selectorHint,
    fixability: fixabilityOf(f.ruleId),
  };
}

function fixOne(file: string, source: string, opts: FixInput, canWrite = true): FileFix {
  const doc = parseSource(source, file, { forceJsx: opts.forceJsx });
  // Rendered captures are GENERATED output (serialized DOM). A codemod on them is
  // meaningless and would be clobbered on the next test run — and in --staged mode we
  // must never rewrite/re-stage a capture. Skip entirely (no items, no edits).
  if (doc.capture) return { file, lossy: doc.lossy, items: [], diff: "", applied: 0, written: false, regression: false };
  const findings = runRules(doc);
  const items = findings.map((f) => itemOf(f, opts.standard ?? CORE));

  const edits: Edit[] = [];
  // Real-AST docs (HTML or jsx-ast) carry accurate file offsets, so codemods edit
  // by range. On jsx-ast we apply only codemods marked jsxSafe (attribute removal /
  // insertion of React-valid props); name-rewriting codemods stay off so we never
  // turn tabIndex={5} into tabindex="0". The lossy fallback (jsx-lossy) edits nothing.
  const isJsxAst = doc.kind === "jsx-ast";
  if (!doc.lossy) {
    for (const f of findings) {
      if (opts.only && !opts.only.includes(f.ruleId)) continue;
      // --safe: apply only genuinely-automatic codemods. Placeholder inserts (alt="TODO",
      // lang="und", title="TODO") mechanically clear a finding with a stub that still
      // needs a human/AI value — so skip them here, leaving those findings for the gate.
      if (opts.safe && fixabilityOf(f.ruleId) !== "auto") continue;
      const cm = CODEMODS[f.ruleId];
      if (!cm?.build || f.sourceStart === undefined) continue;
      if (isJsxAst && !cm.jsxSafe) continue;
      edits.push(...cm.build(source, f.sourceStart));
    }
  } else if (opts.write && findings.some((f) => CODEMODS[f.ruleId]?.build)) {
    opts.onWarn?.(`ultra11y fix: ${file} is JSX/TSX (lossy parse fallback) — fixes are proposal-only here; edit the source by hand.`);
  }

  let diff = "";
  let applied = 0;
  let written = false;
  let regression = false;
  let skippedPartialStage = false;

  if (edits.length) {
    const { output, applied: n } = applyEdits(source, edits);
    applied = n;
    diff = unifiedDiff(file, source, output);
    // regression gate: re-audit the fixed text; a fix must never add an NC — not
    // just in total count, but also no NEW kind of finding (catches one-NC-for-another
    // swaps, e.g. a bad placeholder value that trips a different rule).
    const after = runRules(parseSource(output, file, { forceJsx: opts.forceJsx }));
    const beforeKinds = new Set(findings.map((f) => f.ruleId));
    regression = after.length > findings.length || after.some((f) => !beforeKinds.has(f.ruleId));
    if (opts.write && !regression && file !== "<stdin>") {
      if (canWrite) {
        writeFileSync(file, output);
        written = true;
      } else {
        // Staged mode + unstaged edits: writing index-derived output over the working
        // tree (and re-staging it) would silently stage those edits. Leave it to a human.
        skippedPartialStage = true;
        opts.onWarn?.(`ultra11y fix: ${file} has unstaged edits — not auto-fixed/re-staged; fix and stage it manually.`);
      }
    }
    if (regression) opts.onWarn?.(`ultra11y fix: ${file} not written — fix would introduce a new non-conformity (regression gate).`);
  }

  return { file, lossy: doc.lossy, items, diff, applied, written, regression, ...(skippedPartialStage ? { skippedPartialStage } : {}) };
}

export function runFix(opts: FixInput): FixResult {
  const { files, gitUnavailable, stagedContent } = discover(opts.inputs, {
    include: opts.include,
    exclude: opts.exclude,
    ext: opts.ext,
    changed: opts.changed,
    since: opts.since,
    staged: opts.staged,
    noDefaultExcludes: opts.noDefaultExcludes,
    onWarn: opts.onWarn,
  });
  const useStaged = opts.staged === true && !gitUnavailable;

  const out: FileFix[] = [];
  for (const file of files) {
    let src: string;
    if (useStaged) {
      const c = stagedContent?.get(file);
      if (c === undefined) continue;
      src = c;
    } else {
      try {
        src = readText(file);
      } catch {
        continue;
      }
    }
    // Only auto-fix + re-stage files whose working tree already matches the index;
    // a partially-staged file is left untouched (its findings keep the gate blocking).
    const canWrite = !(useStaged && hasUnstagedChanges(file));
    const ff = fixOne(file, src, opts, canWrite);
    if (useStaged && ff.written) {
      gitAdd(file);
      ff.restaged = true;
    }
    out.push(ff);
  }
  if (opts.inputs.includes("-") && opts.stdin !== undefined) {
    out.push(fixOne("<stdin>", opts.stdin, { ...opts, write: false }));
  }

  const totals = { auto: 0, placeholder: 0, proposal: 0, filesWritten: 0, regressions: 0, filesRestaged: 0, partialStageSkipped: 0 };
  for (const ff of out) {
    for (const it of ff.items) totals[it.fixability]++;
    if (ff.written) totals.filesWritten++;
    if (ff.regression) totals.regressions++;
    if (ff.restaged) totals.filesRestaged++;
    if (ff.skippedPartialStage) totals.partialStageSkipped++;
  }
  return { files: out, totals };
}

const FIX_LABEL: Record<Fixability, { fr: string; en: string }> = {
  auto: { fr: "auto", en: "auto" },
  placeholder: { fr: "à compléter", en: "fill-in" },
  proposal: { fr: "jugement", en: "judgment" },
};

/** Human summary for the CLI. */
/** The criterion a fix item is announced under: the active standard's own ids when it has
 *  them, else the success criterion the rule is tied to. */
function itemCriterion(it: FixItem, standard: StandardId): string {
  if (it.packCriteriaIds?.length) return `${loadPack(standard).name} ${it.packCriteriaIds.join(", ")}`;
  return `WCAG ${it.criteriaId}`;
}

export function fixSummary(r: FixResult, lang: Lang = "fr", write = false, standard: StandardId = CORE): string {
  const out: string[] = [];
  const t = r.totals;
  const head =
    lang === "fr"
      ? `${write ? "Corrections appliquées" : "Corrections proposées (dry-run)"} : ${t.auto} auto, ${t.placeholder} à compléter, ${t.proposal} jugement · ${t.filesWritten} fichier(s) écrit(s)${t.filesRestaged ? `, ${t.filesRestaged} re-stagé(s)` : ""}${t.regressions ? `, ${t.regressions} bloqué(s) par le garde anti-régression` : ""}${t.partialStageSkipped ? `, ${t.partialStageSkipped} ignoré(s) (modifs non-stagées)` : ""}.`
      : `${write ? "Fixes applied" : "Proposed fixes (dry-run)"}: ${t.auto} auto, ${t.placeholder} fill-in, ${t.proposal} judgment · ${t.filesWritten} file(s) written${t.filesRestaged ? `, ${t.filesRestaged} re-staged` : ""}${t.regressions ? `, ${t.regressions} blocked by the regression gate` : ""}${t.partialStageSkipped ? `, ${t.partialStageSkipped} skipped (unstaged edits)` : ""}.`;
  out.push(head, "");
  for (const ff of r.files) {
    const fixable = ff.items.filter((i) => i.fixability !== "proposal");
    if (!fixable.length && !ff.items.length) continue;
    out.push(`### ${ff.file}${ff.lossy ? " (JSX/TSX — " + (lang === "fr" ? "proposition seule" : "proposal-only") + ")" : ""}`);
    for (const it of ff.items)
      out.push(`- [${FIX_LABEL[it.fixability][lang]}] ${it.ruleId} (${itemCriterion(it, standard)}) — \`${it.selectorHint}\` @ ${ff.file}:${it.line}`);
    if (ff.diff) out.push("", "```diff", ff.diff, "```");
    if (ff.regression) out.push(`> ⚠️ ${lang === "fr" ? "non écrit : régression détectée" : "not written: regression detected"}`);
    out.push("");
  }
  return out.join("\n");
}

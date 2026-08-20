---
name: review-a11y
description: "Use to REVIEW code changes for accessibility — '/review-a11y', 'review my changes/PR/branch for a11y', 'accessibility review of this diff'. Scopes to exactly the code under change (staged files, working diff, or branch vs merge-base), runs the bundled install-free ultra11y engine (node scripts/ultra11y.mjs, no keys; static WCAG 2.2 AA checks tied to success criteria, cross-file JSX/TSX via --graph), then adds YOUR judgment: refute false positives (SFC/library-source findings are preliminary), decide alt relevance and link purpose, name the rendering criteria (contrast, focus, zoom) as residual risks — never invent a non-conformity. Output: a severity-ranked review (blocking → major → minor) with file:line, concrete fixes, residual risks and a one-line verdict, in the conversation's language (technical tokens stay in English). Companion of the ultra11y skill (full audits, reports, PRD, RGAA packs). Triggers: 'review a11y', 'a11y review', 'accessibility review'."
when_to_use: "Invoke WITHOUT being asked whenever changed front-end code should be checked: the user just finished or modified a component, template, page or stylesheet; is about to commit, push or open a pull request; asks 'is this accessible?' or 'anything to fix before merge?'; a diff, branch or PR is under discussion; or a hook or CI reports accessibility findings on the change. NOT for a whole-repo audit, a dated conformance report, an RGAA/Section 508 deliverable or a PRD backlog — that is the `ultra11y` skill."
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/ultra11y.mjs *), Read, Grep, Glob
license: MIT
metadata:
  version: 5.19.1
---

# review-a11y — accessibility review of changed code

The review counterpart of the `ultra11y` skill: where `ultra11y` produces full audits and
compliance deliverables, **this skill reviews exactly the code under change** — a diff, a
branch, a PR — and reports like a code reviewer. Same division of labour: the
deterministic, install-free engine bundled with this skill does the *mechanical* work
(machine-checkable WCAG 2.2 AA non-conformities, each tied to a success criterion, cited
`file:line`), and **the AI agent** *adjudicates the judgment* — refute false positives, decide
alt relevance/link purpose/focus logic statically from the code, and route what needs a rendered
DOM to `scan`. A human is at most optional oversight.

**Engine resolution:** every command below is `node scripts/ultra11y.mjs …` where
`scripts/ultra11y.mjs` lives **next to this SKILL.md** (the engine ships inside the skill;
no install, no key). Run it with the reviewed project as the working directory. In the
ultra11y repository itself, the repo root's `scripts/ultra11y.mjs` is the same file.
On Claude Code that path is `${CLAUDE_SKILL_DIR}/scripts/ultra11y.mjs`; on Codex and
OpenCode it is the skill directory the plugin installed. If neither resolves — a harness
with no skill system — `npx -y ultra11y <command>` is the same engine. Per-harness deltas:
`references/harnesses.md` in the `ultra11y` skill.

> **Core rules** (shared with `ultra11y`):
> 1. **Never invent a non-conformity**: report only what the engine found or what you can
>    see and cite in the code under review.
> 2. **Review the change, not the world**: findings outside the reviewed scope are noted in
>    one line at most ("pre-existing, out of scope"), never mixed into the verdict.
> 3. **Residual is explicit, never silently conforming**: the *rendering* criteria (contrast,
>    focus visibility, zoom/reflow, content-on-hover) are named as residual risks for the changed
>    components — never asserted from source, resolved in the rendered page (`scan`). The
>    *judgment* criteria (alt relevance, link purpose, reading order) the AI agent adjudicates
>    from the code itself, recording a reason — no status without a justified verdict.
> 4. **Language**: write the review in the conversation's language, but technical tokens
>    stay in English even in French prose — `aria-live` stays `aria-live` (never
>    « région live »), same for `tabindex`, `alt`, `role="alert"`, landmark role names.

## 1. Scope — review what changed

Pick the FIRST that applies (ask only when genuinely ambiguous):

```
node scripts/ultra11y.mjs audit <files the user named> --jsx --json     # explicit files
node scripts/ultra11y.mjs audit --staged --graph --json                 # staged snapshot (pre-commit review)
node scripts/ultra11y.mjs audit --changed --graph --json                # working diff
node scripts/ultra11y.mjs audit --since origin/main --graph --json     # the whole branch (PR review) — use the repo's default branch
```

- Always pass `--graph` for JSX/TSX (real AST + cross-file rules: icon-only component used
  without a name, anchor target defined in another file…); it also suppresses a class of
  single-file false positives.
- Pass `--lang` matching the conversation so the engine's message/remediation strings are
  in the review's language (unset, the CLI auto-detects — a fallback, not a substitute).
- Whole-repo review is an **audit**, not a review — offer the `ultra11y` skill instead.
- Test/story markup (`*.test.*`, `*.stories.*`, `__tests__/`) is excluded by default; name
  such a file explicitly to include it, or pass `--no-default-excludes`.

## 2. Judge — the engine's findings are candidates, not verdicts

For each finding (`--json` gives `criteria`, `severity`, `file:line`, `message`,
`remediation`):

- **Confirm the occurrence**: open the cited line; the offending element must really be
  there in the change under review.
- **`preliminary: true` findings** (`.vue`/`.svelte`/`.astro` source, library components):
  the template parser cannot see slots, conditionals or provide/inject wiring. Confirm
  against the rendered DOM if captures exist (`.ultra11y/captures`, from the `ultra11y`
  skill's `render --setup` harvester), otherwise report them as **provisional** with that
  caveat — or refute them with evidence from the code.
- **Library-rendered JSX (DSFR, MUI…)**: a clean source review can still ship broken HTML
  (false negatives) — say so explicitly when the change touches such components, and
  recommend a rendered-DOM check (`scan`, or the `ultra11y` capture pipeline).
- **The judgment criteria are the AI agent's to adjudicate**: alt text relevance, link purpose
  in context, visible label vs accessible name, keyboard/focus logic of the changed component
  (read the full component source, not just the flagged line), recording a reason for each call.
- Refuting a finding requires **cited evidence** (the code that disproves it); silently
  dropping findings is forbidden.

## 3. Report — a review, not a compliance document

Render in the conversation's language (Core rule 4), grouped by severity:

```
## Accessibility review — <scope, e.g. branch feat/x vs main, 12 files>

### 🔴 Blocking
- `src/components/Form.tsx:42` — **3.3.2 Labels or Instructions** — input has no
  label and placeholder is its only hint → associate a real <label for>, keep the
  placeholder as an example only.

### 🟠 Major / 🟡 Minor
- …same shape…

### Residual risks (rendering-dependent — resolve in the rendered page via scan)
- contrast of the new button variants (1.4.3), focus visibility on the custom menu (2.4.7)

### Verdict
1 blocking, 2 major to fix before merge; 2 provisional SFC findings to confirm on the
rendered DOM; residual risks listed above.
```

- Keep the engine's `remediation` text as the base of each fix — it is already localized
  and criterion-grounded.
- Pre-existing issues spotted in passing go in ONE final line, out of the verdict.

**Running as a subagent.** This skill is often dispatched rather than typed: by the plugin
hook on a pending `git commit` / `git push` / `gh pr create`, or by the `ultra11y` skill once
its audit has produced fixes. When it is, the report above **is** the return value — it
becomes a tool result for the caller, not a message to a human. So return it whole and
nothing else: no preamble, no "I ran the engine and found…", no offer to fix. A caller that
receives a summary has to guess at the findings, which is the one thing this skill exists to
stop. Everything in §4 stays opt-in and belongs to the caller, not to you.

## 4. After the review (opt-in)

- **Safe mechanical fixes**: `fix --staged --write --safe` (auto-applies the safe codemods
  to staged files and re-stages them) or `node scripts/ultra11y.mjs fix <files> --write`;
  dry-run without `--write`.
- **Formal deliverables** (dated report, auditor conformance blocks, PRD backlog, GitHub
  issues, RGAA/country-standard vocabulary): that is the `ultra11y` skill — same engine,
  same findings (`report`, `prd`, `check`/`verify` gates).
- **Make it automatic**: installed as a **Claude Code plugin**, a `PreToolUse` hook stops a
  pending `git commit` / `git push` / `gh pr create` that carries findings and hands them
  over — that is what invokes this skill without anyone asking. It never fires twice for the
  same findings, so a retry lands. For a gate that does not need an agent at all, the
  `ultra11y` skill's `init --hook` installs a mechanical pre-commit run of this same staged
  audit.

## Do not

- Invent a non-conformity the engine did not find and you cannot cite.
- Assert contrast/focus/zoom from source — they are residual risks until rendered (resolve via `scan`).
- Mix pre-existing repo issues into the verdict on the change.
- Translate technical tokens in French prose (`aria-live`, never « région live »).

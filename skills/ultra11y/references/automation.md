# Automate in the repo — `init` (hook)

ultra11y can stay an **on-demand** skill, or become a **gate** that runs on its own.
`init` wires it (zero-dependency, no husky):

```
node scripts/ultra11y.mjs init --hook          # .git/hooks/pre-commit — strict STAGED gate (default)
node scripts/ultra11y.mjs init                 # same as --hook
node scripts/ultra11y.mjs init --fail-on major # the same gate, at another threshold
```

## Three gates, three different jobs

| | what runs | when | who decides |
|---|---|---|---|
| `init --hook` | the engine, mechanically | every `git commit` | the engine's `--fail-on` |
| iterion's `rgaa-audit` bot | the engine + read-only agents, in CI | when the workflow runs it | its agents, adjudicating and refuting, then the engine's gates |
| the **agent-harness hook** | the `review-a11y` **skill** | a pending commit / push / PR, inside an agent session | the AI agent, adjudicating |

The first blocks on what a machine can decide. The other two exist because most of WCAG is
*judgment* — is this `alt` relevant, is this link's purpose clear — which no exit code
settles. See below.

`init` writes no CI workflow: the adjudicated, refuted audit in CI is
iterion's [`rgaa-audit` bot](https://github.com/SocialGouv/iterion/tree/main/bots/rgaa-audit)
(`references/ci.md`).

## The agent-harness hook — the agent review, unprompted

Shipped by the plugin (`hooks/hooks.json` → `hooks/pre-tool-use.mjs` → `ultra11y hook
--claude-code`), not by `init`. **No** harness has a git event, so it listens on `PreToolUse`
for the shell tool and recognises the commands that **publish** work — `git commit` (scoped
to `--staged`), `git push` and `gh pr create` (scoped to `--since <default branch>`). When
the change carries findings at or above the threshold it returns `permissionDecision:
"deny"` with the findings attached, and the agent invokes `review-a11y` to adjudicate them.

The same file serves Claude Code and Codex (Codex exports `${CLAUDE_PLUGIN_ROOT}` and reads
the same envelope); OpenCode has no decision channel, so there the gate throws and the
findings arrive as the tool error. Per-harness install, deltas and off-switches:
**`references/harnesses.md`**.

Two invariants make it liveable:

- **It never fires twice for the same findings.** The finding set is fingerprinted per
  session, so the retry after a review always goes through — a review that refutes
  everything still lets the commit land.
- **It never breaks a git flow.** Git's own `no-verify` bypass, a dry run, a cwd outside a
  repository, an unresolvable base ref, an engine error or a timeout all resolve to silence,
  never to an error the user has to work around.

Threshold and off-switches: `ULTRA11Y_HOOK_FAIL_ON=blocking|major|minor|off` (env, wins),
then `"hook": { "failOn": … }` in `.ultra11yrc.json`, else `blocking`. `SKIP_A11Y=1` (the
same bypass as the pre-commit hook) and `ULTRA11Y_HOOK=off` disable it outright.

A hook **cannot force** a skill invocation — it blocks and hands over the reason, the agent
invokes. And a plugin's hooks are enabled by enabling the plugin, not by the install alone.

## Default: strict staged snapshot + safe auto-fix

The default pre-commit hook operates on **exactly what is about to be committed** — the
**staged index blobs**, read with `git show :./<path>`, *not* the working-tree copy.
It runs (fix first, then gate — so safe fixes are always applied, and only the judgment
issues that remain can block):

```
node scripts/ultra11y.mjs fix   --staged --write --safe            # auto-apply SAFE fixes to the staged snapshot, re-stage
node scripts/ultra11y.mjs audit --staged --fail-on blocking        # gate: block only if issues remain (need judgment)
```

Why fix-first: every auto-fixable rule (positive `tabindex`, redundant `role`,
zoom-blocking viewport) is `major`/`minor`, while the `blocking` findings (missing `alt`,
missing label) are exactly the ones a codemod must **not** guess. So the safe pass cleans
up and re-stages what it can, and the gate blocks only on the judgment remainder for the AI
agent to adjudicate.

- **`--staged`** scopes to staged adds/mods only (not untracked, not unstaged-only edits)
  and audits the exact bytes a commit would record — including `.gitattributes` clean
  filters. `--staged` wins over `--changed`/`--since`.
- **`--safe`** applies only genuinely-**automatic** codemods. Placeholder inserts
  (`alt="TODO"`, `lang="und"`, `title="TODO"`) are **not** applied: a stub would clear the
  finding mechanically while still needing a real value, so those (and judgment proposals)
  are left in place and keep the gate blocking.
- **Auto-fix + re-stage** happens only for **fully-staged** files (working tree == index).
  A **partially-staged** file (unstaged edits present) is left untouched — writing
  index-derived output over it and `git add`-ing would silently stage those edits — so its
  findings keep the gate blocking with a message to stage/fix it manually.
- The commit proceeds only when no blocking issue remains after the safe pass. One-off
  bypass: `SKIP_A11Y=1 git commit …`. Engine path override: `ULTRA11Y=/path/to/ultra11y.mjs`.

**When the hook blocks on judgment issues** (alt relevance, link purpose, labels,
heading structure) the agent should: open the cited **staged** code, apply the *real*
fix (not a placeholder), `git add` the file, and re-commit — or run `fix --staged
--write` to lay down placeholders and then fill them in.

## MUST: the FINAL, rendered semantic HTML has to be correct

The static engine only sees **source**. When markup comes from a **component library**
(DSFR, MUI, Chakra…) or a `.vue`/`.svelte`/`.astro` SFC, the real **semantic HTML** only
exists **after rendering** — the source `<Button/>` tells you nothing about the `<button>`
(or `<div role>`) it emits. A green staged gate on opaque component source is **not**
proof of an accessible result.

**So make the produced semantic HTML the thing you gate — with rendered CAPTURES.** A
capture is the *rendered* DOM serialized to `.html` and committed, so the gate audits the
true markup, not the component call. ultra11y's render engine produces them, without
reading or running your tests (`references/rendered.md`):

```
node scripts/ultra11y.mjs render .                    # every component, page and story → .ultra11y/captures/*.html (provenance-tagged)
node scripts/ultra11y.mjs audit --require-captures    # gate: every opaque/control component must have a capture
```

- **Attribution + coverage.** A finding on a capture is reported against the SOURCE
  component (via its `<!-- ultra11y:capture … -->` provenance), not the capture file.
  `render --coverage` shows covered vs blind-spot components; `--require-captures` turns any
  remaining blind spot into a failure. `.vue`/`.svelte`/`.astro` components now count in this
  coverage too, so a previously-green gate can newly report blind spots on an SFC-heavy repo —
  intended (a named blind spot beats invisibility); capture those components or scope the gate.
- **The gate sees the captures for the diffed components automatically.** In
  `--changed`/`--staged`/`--since` mode the audit pulls in the committed captures whose
  provenance points at a diffed source file (a capture is rarely itself part of the diff —
  the SOURCE changed, its capture usually didn't), so the pre-commit gate audits the real
  `<button>`/`<nav>`/heading structure/labels for every touched component, catching
  regressions the opaque source hides. After a component change, re-run `render` so its
  capture refreshes, and stage the refreshed capture with the source. `fix` never rewrites
  captures (generated output). Storybook/build HTML also
  work — anything under `.ultra11y/captures`, or point `--captures <dir>` (`--no-captures`
  opts out entirely).
- In CI, audit the **built** output (`audit "dist/**/*.html"`), and use `scan` for the
  computed rendering criteria (contrast, focus, zoom). See `references/rendered.md`.

Treat this as a hard rule: **do not sign off on a component/SFC change from the source
audit alone — verify the rendered semantic HTML, and prefer committed captures so the
gate keeps verifying it.**

> The pre-commit gate relies on the **static** engine. The **rendering** (contrast, focus, zoom) criteria
> go to `scan` and the **judgment** criteria are adjudicated by the AI agent (`verify --manual`,
> gated) in the full audit — the gate stops mechanical regressions, it is not the full audit
> (a human is at most optional oversight).

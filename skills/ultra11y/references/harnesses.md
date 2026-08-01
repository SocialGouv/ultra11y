# Where this runs — Claude Code, Codex CLI, OpenCode, and everything else

The skills speak in **actions** — run the engine, invoke the review skill, adjudicate the
findings. On each harness those resolve as below. Only the **deltas** are listed; anything
not mentioned here is identical everywhere, because the engine is one zero-dependency
bundle and the CLI it exposes is the same on all of them.

Two things are worth knowing before the table:

- **No harness has a git event.** None of them can hook "about to commit". So the automatic
  review rides the *shell tool* on every one of them, recognising the commands that publish
  work — `git commit`, `git push`, `gh pr create`. That is a deliberate design constraint,
  not a Claude Code quirk.
- **A hook cannot force a skill to be invoked.** It blocks the command and hands over the
  reason and the findings; the agent is what invokes `review-a11y`. In practice a motivated
  block is enough — it is not a guarantee, on any harness.

## Claude Code

```
/plugin marketplace add maxgfr/ultra11y
/plugin install ultra11y@ultra11y
```

The plugin carries both skills *and* the hook. `hooks/hooks.json` → `hooks/pre-tool-use.mjs`
→ `ultra11y hook --claude-code`. The engine resolves from `${CLAUDE_SKILL_DIR}/scripts/ultra11y.mjs`.

The review arrives as `permissionDecision: "deny"` on the pending command, with the findings
in `additionalContext`.

Skills only, no hook: `npx skills add maxgfr/ultra11y`. Gate only, for an npm install:
`ultra11y install --claude-code`.

## OpenAI Codex CLI

```
codex plugin marketplace add maxgfr/ultra11y
codex plugin add ultra11y@ultra11y
```

Codex's hook engine is a near-clone of Claude Code's — same events, same payload fields,
same `hookSpecificOutput` envelope — and it exports `${CLAUDE_PLUGIN_ROOT}` alongside its own
`${PLUGIN_ROOT}`, so **`hooks/hooks.json` is shared verbatim** between the two.

The deltas that actually matter:

- Its shell tool is **`shell`**, not `Bash`, and its `command` is an **argv array**
  (`["bash","-lc","git commit -m x"]`). `commandOf` in `src/hook.ts` extracts the script
  argument rather than joining the array — joining would put `git` off a command position
  and the gate would silently never fire.
- On `PreToolUse` Codex accepts **only** `permissionDecision: "deny"`, with a non-empty
  reason. That is exactly and only what this engine emits, so the envelope needs no branch.
- `.codex-plugin/plugin.json` must not declare `hooks` — Codex's manifest validator rejects
  any key outside its allowlist. `hooks/hooks.json` is found by convention at the plugin root.
- Hooks are behind a feature flag: **`[features] hooks = true`** in `~/.codex/config.toml`.
- Codex asks you to **trust** a hook command the first time it fires. Accept it, or review
  it with `/hooks`.

Gate only, without the marketplace: `ultra11y install --codex` (it sets the feature flag and
copies both skills into `~/.codex/skills/`).

## OpenCode

```
ultra11y install --opencode
```

…or pin it in `~/.config/opencode/opencode.json`: `"plugin": ["ultra11y@latest"]`.

The delta: OpenCode has **no permission-decision channel**. Its plugin blocks a tool call by
throwing, so the review arrives as a **failed bash call whose error message carries the
findings**. Same content, different envelope — read the error, do not retry blindly.

Skills live under `~/.config/opencode/skills/`; the plugin also registers the bundled
`skills/` directory via `config.skills.paths`.

## Everything else (Cursor, Amp, Zed, Gemini CLI, Windsurf, aider…)

```
ultra11y install --agents-md
```

Writes a managed block into the repository's `AGENTS.md`. Be clear-eyed about what that is:
there is no hook API, so **nothing is automatic**. The block makes the engine discoverable
and hands over the adjudication protocol. What actually enforces anything on these harnesses
is the repo's own gate — `ultra11y init --hook` (git pre-commit) and `ultra11y init --ci`.

There is also **MCP**, which carries the method where nothing else does — `SKILL.md` and
every `references/*.md` are exposed as `skill://` resources, plus three prompts
(`audit_wcag`, `adjudicate_criteria`, `review_diff_a11y`):

```
claude mcp add ultra11y -- npx -y ultra11y mcp
```

On a harness with no skill system at all, **reading `SKILL.md` directly with the file-read
tool is the blessed path**, not a workaround. Discover what exists by listing
`skills/*/SKILL.md` and reading the frontmatter.

## The matrix

| | skills | automatic review | how it blocks | MCP | repo gate |
|---|---|---|---|---|---|
| Claude Code | plugin / `skills add` | yes | `permissionDecision: "deny"` | yes | yes |
| Codex CLI | plugin / `skills add` | yes | `permissionDecision: "deny"` | yes | yes |
| OpenCode | plugin / `skills add` | yes | thrown tool error | yes | yes |
| Cursor, Amp, Zed, Gemini… | AGENTS.md | **no** | — | yes | yes |

`ultra11y status` reports which of these are actually wired on this machine — including the
one silent failure worth naming, a Codex hook sitting behind a disabled feature flag.

## Off-switches (identical everywhere)

They live in the engine, not in any harness, so one answer covers all of them:
`ULTRA11Y_HOOK_FAIL_ON=blocking|major|minor|off` (env, wins), then
`"hook": { "failOn": … }` in `.ultra11yrc.json`, else `blocking`. `SKIP_A11Y=1` bypasses
once; `ULTRA11Y_HOOK=off` disables the gate for the session.

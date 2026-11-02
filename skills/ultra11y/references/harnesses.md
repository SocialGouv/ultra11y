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
/plugin marketplace add SocialGouv/ultra11y
/plugin install ultra11y@ultra11y
```

The plugin carries both skills *and* the hook. `hooks/hooks.json` → `hooks/pre-tool-use.mjs`
→ `ultra11y hook --claude-code`. The engine resolves from `${CLAUDE_SKILL_DIR}/scripts/ultra11y.mjs`.

For a requested full audit, Claude Code follows `references/claude-code-report.md`: it acts as
the auditor directly, then publishes the evidenced Markdown, HTML and per-page dossiers. The
headless `judge --runner claude` transport is for CI or another unattended caller; nesting it
inside the active Claude Code session wastes context and gives the report a weaker reader.

The review arrives as `permissionDecision: "deny"` on the pending command, with the findings
in `additionalContext`.

Skills only, no hook: `npx skills add SocialGouv/ultra11y`. Gate only, for an npm install:
`ultra11y install --claude-code`.

## OpenAI Codex CLI

```
codex plugin marketplace add SocialGouv/ultra11y
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

The installed skill can also delegate an unattended local judgment pass to the same signed-in
Codex account:

```sh
ultra11y judge --in audits/audit-latest.json --standard rgaa --runner codex --apply
```

That command uses `codex exec` with an ephemeral, read-only, offline session and ignores user
config, repository rules and hooks. No API key is required; Codex reuses its ChatGPT login.
For Claude CLI use `--runner claude` (`--runner cli` is the legacy alias).

## OpenCode (1.x and 2.x)

```
ultra11y install --opencode                      # the major is asked of `opencode --version`
ultra11y install --opencode --opencode-version 2 # …or stated
```

OpenCode 2 replaced the plugin API, and V1 plugins do not run on it. ultra11y ships **one
plugin file that both majors load**: OpenCode 2 reads its default export's `{ id, setup }`,
OpenCode 1 (≥ 1.18.28) calls the `server()` on that same object, and older V1 releases call
the named `Ultra11yPlugin`. The gate runs once per shell call on every one of them.

| | OpenCode 1 | OpenCode 2 |
|---|---|---|
| `install --opencode` writes | `~/.config/opencode/plugin/ultra11y.js` | `~/.config/opencode/plugins/ultra11y.js` |
| …or pin it in `opencode.json` | `"plugin": ["ultra11y@latest"]` | `"plugins": ["ultra11y@latest"]` |
| the gate hooks | `tool.execute.before` on `bash` | `ctx.tool.hook("execute.before")` on `shell` |
| the two skills are registered by | `config.skills.paths` | `ctx.skill.transform` |

When no `opencode` is on PATH, the installer writes `plugin/`, which both majors read; an
earlier copy of ours in the other directory is removed so the gate never loads twice. A pin
in `opencode.json` and the file together would load it twice — the installer says so.

The delta: OpenCode has **no permission-decision channel**. Its plugin blocks a tool call by
throwing, so the review arrives as a **failed shell call whose error message carries the
findings**. Same content, different envelope — read the error, do not retry blindly.

The engine runs on the `node` from PATH (OpenCode itself is a Bun binary); with no Node
there the gate is silent rather than broken. Skills also live under
`~/.config/opencode/skills/` once `install --opencode` has copied them there.

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

# better: dedicate it to one project, so `cwd` is optional on every tool AND that
# project's own standards packs (.ultra11yrc.json) are loaded at startup
claude mcp add ultra11y -- npx -y ultra11y mcp --cwd /abs/path/to/project
```

It also carries the **standards themselves** — the reference block (`ultra11y_standards`,
`ultra11y_criteria`, `ultra11y_glossary`, `ultra11y_guidance`, `ultra11y_method`) and the
`std://` resources. That is the half that turns the server into a rule engine rather than a
linter: an agent can read a criterion's numbered tests and the terms it defines instead of
recalling them. See `references/mcp.md`.

On a harness with no skill system at all, **reading `SKILL.md` directly with the file-read
tool is the blessed path**, not a workaround. Discover what exists by listing
`skills/*/SKILL.md` and reading the frontmatter.

## The matrix

| | skills | automatic review | how it blocks | MCP | repo gate |
|---|---|---|---|---|---|
| Claude Code | plugin / `skills add` | yes | `permissionDecision: "deny"` | yes | yes |
| Codex CLI | plugin / `skills add` | yes | `permissionDecision: "deny"` | yes | yes |
| OpenCode 1.x · 2.x | plugin / `skills add` | yes | thrown tool error | yes | yes |
| Cursor, Amp, Zed, Gemini… | AGENTS.md | **no** | — | yes | yes |

`ultra11y status` reports which of these are actually wired on this machine — including the
one silent failure worth naming, a Codex hook sitting behind a disabled feature flag.

## Off-switches (identical everywhere)

They live in the engine, not in any harness, so one answer covers all of them:
`ULTRA11Y_HOOK_FAIL_ON=blocking|major|minor|off` (env, wins), then
`"hook": { "failOn": … }` in `.ultra11yrc.json`, else `blocking`. `SKIP_A11Y=1` bypasses
once; `ULTRA11Y_HOOK=off` disables the gate for the session.

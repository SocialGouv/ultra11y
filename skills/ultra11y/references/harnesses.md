# Where this runs — Claude Code, Codex CLI, OpenCode, and everything else

The skills speak in **actions** — run the engine, invoke the review skill, adjudicate the
findings. On each harness those resolve as below. Only the **deltas** are listed; anything
not mentioned here is identical everywhere, because the engine is one zero-dependency
bundle and the CLI it exposes is the same on all of them.

Three things are worth knowing before the table:

- **The full audit is the same everywhere.** A requested full or detailed audit follows
  `references/full-audit.md` on every harness: the active session is the auditor, rules on the
  worklists directly (or fans them out to subagents where the harness has them, see
  `references/orchestration.md`), then publishes the evidenced Markdown, HTML and per-page
  dossiers and passes the `check` gates. The engine runs no model of its own; in CI the
  unattended caller is iterion's `rgaa-audit` bot (`references/ci.md`). Only the engine's path
  differs (below).

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
Claude Code's own fan-out tools are the Agent tool and, where available, the Workflow tool
that runs the `orchestrate`-emitted `*.workflow.mjs` scripts (Claude Code only). Every harness,
Claude Code included, can instead hand the per-batch prompt files `orchestrate` writes to its
own subagents (`references/orchestration.md`).

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

- Its shell tool varies by build. Codex 0.172 offers the model `exec_command` and hands the
  hook `tool_name: "Bash"` with a string `command`, exactly as Claude Code does. Older builds
  used **`shell`** with an **argv array** (`["bash","-lc","git commit -m x"]`). `commandOf`
  in `src/hook.ts` extracts the script argument rather than joining the array, because
  joining would put `git` off a command position and the gate would silently never fire.
  The matcher in `hooks/hooks.json` covers every one of these names.
- On `PreToolUse` Codex accepts **only** `permissionDecision: "deny"`, with a non-empty
  reason. That is exactly and only what this engine emits, so the envelope needs no branch.
- `.codex-plugin/plugin.json` must not declare `hooks` — Codex's manifest validator rejects
  any key outside its allowlist. `hooks/hooks.json` is found by convention at the plugin root.
- Hooks sit behind a feature flag: **`[features] hooks = true`** in `~/.codex/config.toml`.
  Codex 0.172 lists `hooks` as stable and on by default (`codex features list`), and older
  builds still need the line.
- Codex asks you to **trust** a hook command the first time it fires. Accept it, or review
  it with `/hooks`. An untrusted hook does not run, and nothing says so: `codex exec` runs the
  command as if no hook existed. Headless automation that already vets its hooks passes
  `codex exec --dangerously-bypass-hook-trust`, which is what the `codex-smoke` CI job does.
- A local marketplace (`codex plugin marketplace add ./path`) is installed from that
  repository's **git HEAD**, not its working tree. Commit a change to `hooks/` before
  reinstalling it to try it out.

Gate only, without the marketplace: `ultra11y install --codex` (it sets the feature flag and
copies both skills into `~/.codex/skills/`, or `$CODEX_HOME/skills/`). The engine then resolves
from the installed skill directory's `scripts/ultra11y.mjs` — the plugin's copy, or
`~/.codex/skills/ultra11y/scripts/ultra11y.mjs` after `install --codex`.

CI checks both routes in a real Codex (`tests/codex-smoke.e2e.test.ts`, `pnpm test:codex`). It
installs a pinned Codex CLI into a throwaway `CODEX_HOME`, then has `codex exec` run `git commit`
on a staged blocking finding against a local mock of the Responses API, with no login and no
model. The test checks that the hook resolves `${CLAUDE_PLUGIN_ROOT}` to the installed plugin,
that it denies the commit and that no commit lands. It also checks that the retry in the same
session (`codex exec resume`) goes through.

### The browser tier under the Codex sandbox

`scan` launches Chromium and loads the pages it audits. Here is what was measured with Codex
CLI 0.172.0 on macOS (Seatbelt), scanning a page served on `127.0.0.1`:

| how the command ran | result |
|---|---|
| `--sandbox workspace-write` (the default for an agent that may edit) | **fails**: Chromium does not launch |
| `--sandbox workspace-write -c sandbox_workspace_write.network_access=true` | **fails**, the same way |
| `--sandbox danger-full-access` | runs |

Turning on network access does not help, because the sandbox stops Chromium before any page
loads. `codex sandbox --log-denials -- node …/ultra11y.mjs scan <url>` shows why: Seatbelt
refuses `mach-register org.chromium.Chromium.MachPortRendezvousServer.*` and the macOS
services the browser looks up. The engine reports this as a browser it cannot launch ("…is not
installed, and no installed Google Chrome was found either"). Under the sandbox that message
does **not** mean anything is missing. So run the browser tier **outside the sandbox**:

- start the session that scans with `codex --sandbox danger-full-access` (or set
  `sandbox_mode = "danger-full-access"` in `~/.codex/config.toml`); or
- keep `workspace-write`, start with `--ask-for-approval on-request`, and approve the
  escalation when Codex asks to rerun `scan` outside the sandbox; or
- run `scan` yourself in a terminal, then hand the agent the merged `audit-latest.json`.

`[sandbox_workspace_write] network_access = true` is still what a sandboxed command needs to
reach the network at all, but it is not enough for Chromium. `render` and `report --evidence`
launch the same Chromium; only `scan` was measured. Codex's Linux sandbox (bubblewrap and
Landlock) was not measured. Treat it as unverified, and use the same workaround if `scan`
reports that it cannot launch a browser.

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
`~/.config/opencode/skills/` (honouring `$XDG_CONFIG_HOME`) once `install --opencode` has copied
them there, and the engine resolves from that skill directory's `scripts/ultra11y.mjs` — or from
the npm package's `skills/ultra11y/` when the plugin is pinned in `opencode.json`.

## Everything else (Cursor, Amp, Zed, Gemini CLI, Windsurf, aider…)

```
ultra11y install --agents-md
```

Writes a managed block into the repository's `AGENTS.md`. Be clear-eyed about what that is:
there is no hook API, so **nothing is automatic**. The block makes the engine discoverable
and hands over the adjudication protocol. What actually enforces anything on these harnesses
is the repo's own gate — `ultra11y init --hook` (git pre-commit) — and, in CI, iterion's
`rgaa-audit` bot.

The criteria themselves are on the CLI on every harness: `criteria <id>`
prints a criterion's numbered tests, `criteria --glossary <term>` the terms it
defines, and `criteria --plan` the work plan — so an agent reads them instead
of recalling them.

On a harness with no skill system at all, **reading `SKILL.md` directly with the file-read
tool is the blessed path**, not a workaround. Discover what exists by listing
`skills/*/SKILL.md` and reading the frontmatter.

## The matrix

| | skills | automatic review | how it blocks | repo gate |
|---|---|---|---|---|
| Claude Code | plugin / `skills add` | yes | `permissionDecision: "deny"` | yes |
| Codex CLI | plugin / `skills add` | yes | `permissionDecision: "deny"` | yes |
| OpenCode 1.x · 2.x | plugin / `skills add` | yes | thrown tool error | yes |
| Cursor, Amp, Zed, Gemini… | AGENTS.md | **no** | — | yes |

`ultra11y status` reports which of these are actually wired on this machine — including the
one silent failure worth naming, a Codex hook sitting behind a disabled feature flag.

## Off-switches (identical everywhere)

They live in the engine, not in any harness, so one answer covers all of them:
`ULTRA11Y_HOOK_FAIL_ON=blocking|major|minor|off` (env, wins), then
`"hook": { "failOn": … }` in `.ultra11yrc.json`, else `blocking`. `SKIP_A11Y=1` bypasses
once; `ULTRA11Y_HOOK=off` disables the gate for the session.

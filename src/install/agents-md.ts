// The AGENTS.md fallback — for harnesses with no skill system AND no hook system
// (Cursor, Amp, Zed, Gemini CLI, Windsurf, aider…).
//
// Be honest about what this is: it CANNOT make anything automatic. There is no channel to
// deny a command on, so nothing stops a commit. What it can do is two things the agent
// cannot do for itself — make the engine discoverable, and hand over the adjudication
// protocol so the findings are ruled on instead of pasted at the user. The real enforcement
// on such a harness is the repo's own git hook (`init --hook`), which is why the block
// closes by saying so.
//
// The block is GENERATED rather than committed as a static .md so `--dry-run` and the
// writer emit the same bytes, and so the engine invocation is resolved for the reader's
// actual checkout rather than guessed.
import type { EditReport } from "./json-edit.js";
import { engineInvocation } from "../init.js";
import { hasManagedBlock, removeManagedBlock, upsertManagedBlock } from "./text-edit.js";
import { join } from "node:path";

/** Where the block goes: the repository root, next to the agent instructions already there. */
export function agentsMdPath(root: string): string {
  return join(root, "AGENTS.md");
}

/** The managed block's body, with the engine invocation resolved for `root`. */
export function agentsMdBlock(root: string): string {
  const e = engineInvocation(root);
  return `## Accessibility (ultra11y)

This repository is checked against **WCAG 2.2 AA** with \`ultra11y\`: a zero-dependency
static engine — no install, no API key, no network.

**Before you commit, push, or open a pull request**, whenever you changed HTML, CSS,
JSX/TSX, Vue, Svelte or Astro:

\`\`\`sh
${e} audit --staged --graph            # exactly what the commit would record
${e} audit --since origin/main --graph # the whole branch, for a pull request
\`\`\`

\`--graph\` is not optional on JSX/TSX: it turns on the real cross-file analysis (an
icon-only component used without a name, a label defined in another file) and it suppresses
a whole class of single-file false positives.

Then **adjudicate**. Do not paste the output at the user.

1. Read every finding at its \`file:line\` in the real code. Refute the ones the code
   disproves, and say what disproves them. Findings inside library sources or single-file
   components are **preliminary**: the audited artifact is the RENDERED HTML.
2. Rule on the judgment criteria yourself, from the code — is this \`alt\` relevant, is this
   link's purpose clear in context, is the reading order right.
   \`${e} verify --report <md> --in <audit.json> --manual\` emits the worklist and the
   per-criterion decision protocol.
3. Name what source cannot decide — computed contrast, visible focus, zoom and reflow,
   content on hover — as **residual risks**. Never call them conforming.
4. **Never invent a non-conformity.** \`${e} check --report <file>\` fails the report when a
   cited element does not resolve. Run it before claiming anything.
5. Apply the safe deterministic fixes with \`${e} fix --staged --write --safe\` and re-stage.
   What remains needs judgment and the user's agreement.

Severity vocabulary: \`blocking\` > \`major\` > \`minor\`. Block the work on \`blocking\`.

To make this automatic without relying on an agent, wire the repo itself — \`${e} init --hook\`
(git pre-commit) and \`${e} init --ci\` (GitHub Actions) are harness-independent and are the
real safety net here. Full audits, dated conformance reports, RGAA packs and remediation
backlogs: \`${e} --help\`.`;
}

export function installAgentsMd(root: string): EditReport {
  return upsertManagedBlock(agentsMdPath(root), agentsMdBlock(root));
}

export function uninstallAgentsMd(root: string): EditReport {
  return removeManagedBlock(agentsMdPath(root));
}

export function agentsMdWired(root: string): boolean {
  return hasManagedBlock(agentsMdPath(root));
}

# The standards as a rule engine — the MCP reference surface

The audit tools tell you what a page *does*. The reference tools tell you what the standard
*requires*. Without the second half an agent audits from memory, and a criterion recalled
from memory is how an invented non-conformity gets written.

This page is that second half: five read-only tools and a `std://` resource scheme that hand
you any registered standard's criteria, its normative wording, the terms it defines, the
before/after patterns that implement it, and an up-front plan for how much of it any tool can
decide at all.

Everything here works offline, from data vendored into the bundle. Nothing calls a network
service, and no key is needed.

## The one rule that makes it a rule engine

**Look the criterion up. Do not recall it.**

`ultra11y_criteria` returns the criterion's own words and its own numbered tests. RGAA 8.3 is
not "the page needs a lang attribute" — it is a numbered test with two alternative
conditions, and the glossary decides what its terms mean. An auditor block that cites
`8.3.1` after reading `8.3.1` is grounded; one that cites it from memory is a guess wearing a
reference.

## The five tools

| Tool | Answers |
|---|---|
| `ultra11y_standards` | Which standards exist here, and how much of each any engine can decide |
| `ultra11y_criteria` | One criterion in full — wording, numbered tests, techniques, mapping, defined terms — or the index, or one theme |
| `ultra11y_glossary` | What a term the standard **defines** actually means, and which criteria it governs |
| `ultra11y_guidance` | The before/after implementation pattern for a criterion |
| `ultra11y_method` | The work plan: what the engine settles, what needs a render, what is yours |

All five are read-only and closed-world. All five take an **optional** `cwd` — they read the
standard, not your files. `cwd` still matters, because *which standards exist* is a fact
about a project (see **Packs are per-project** below).

### `ultra11y_criteria` — the lookup

```jsonc
{ "standard": "rgaa", "sc": "8.3", "lang": "fr" }
```

Returns the criterion's theme, its localized title, its **numbered tests** (`8.3.1` and its
sub-conditions, verbatim), its W3C technique codes, the WCAG success criteria it maps to, the
**glossary definitions its tests cite**, the per-SC decision protocol, and a `coverage` block
saying what it would take to decide it. `text` is byte-identical to what
`criteria --standard rgaa 8.3` prints, so the two can never drift.

- `sc` and `criterion` are aliases. "8.3" is not a *success criterion*, and a worldwide tool
  should not force a country criterion to be called one.
- Omit the id for the index; pass `theme: 8` for one theme.
- `glossary: "<term>"` looks a defined term up; `glossary: ""` lists them all.
- `include_guidance: true` attaches the before/after patterns (off by default — they are large).

For the WCAG core the same call returns the criterion's **normative text**, verbatim from the
W3C source, with its exceptions and notes kept as labelled lines, plus the WCAG terms that
wording links to. `lang: "fr"` resolves the W3C **authorized French translation** — title,
requirement prose and glossary together, never a French heading over English requirements.

### `ultra11y_method` — read this before auditing anything

The plan, derived rather than guessed. Every criterion of the standard lands in exactly one
**evidence tier**:

| Tier | What decides it | Who produces the evidence |
|---|---|---|
| `source` | an engine rule, from the source tree | `ultra11y_audit` |
| `cross-file` | an engine rule, across the dependency graph | `ultra11y_audit` with `graph: true` |
| `rendered-page` | computed styles, laid-out boxes, the screenshot | `ultra11y render` / `dev` / an E2E capture, then audit again |
| `browser` | a live rendered DOM | `ultra11y scan <target> --merge` (CLI — this server does not drive a browser) |
| `judgment` | a reading of meaning | `ultra11y_adjudicate`, then you |
| `out-of-scope` | nothing — every mapped SC is outside the AA core | declare it; never claim it |

The buckets **partition** the standard: 106 RGAA criteria in, 106 out. The classification is a
lookup over data the repo already ships — each criterion's declared rule applicability, the
WCAG automatability class, the pack's own judgment flags — never a regex over the wording of a
test.

Two counts are deliberately separate, and the distinction is easy to lose:

- **`sourceIsEnough`** — the source tree can prove it **conformant**.
- **`canFailFromSource`** — an engine rule can **fail** it, even though source cannot pass it.

RGAA 4.10 is flagged `judgment` (no tool may declare it conformant) and still carries
`autoplay-media`, which can fail it outright. Collapsing the two axes into one boolean throws
that coverage away.

The headline number for RGAA: **58 of its 106 criteria declare that no engine rule can
evidence them at all.** That is not a gap in the tool — it is the standard saying those are
yours. A plan that hides it reads as coverage that does not exist.

### `ultra11y_glossary` — the definitions are normative

A standard's tests lean constantly on terms it defines itself. RGAA ships 119; WCAG defines
101 of its own in English and 102 in the authorized French translation. "Relevant", "if necessary", "large scale", "pure decoration" mean what the
glossary says they mean, and that is what decides the verdict — not the everyday sense of the
word.

Each lookup also returns `citedBy`: the criteria whose tests actually cite that definition.

### `ultra11y_guidance` — illustration, never detection

The before/after pattern for a criterion: a non-compliant snippet, the compliant fix, the note
explaining the difference.

A criterion with no guidance of its own **inherits** what is keyed to the WCAG success
criteria it maps to, and every inherited entry is marked `inherited: true` with
`via: "wcag:<sc>"`. That is what makes a newly added country pack useful the day it lands —
but an inherited example is not the national standard's own doctrine, and a report must never
present it as one.

**Guidance never decides a verdict.** It illustrates. A pattern earns a detector only when it
is statically decidable *and* maps to a criterion in the WCAG 2.2 AA core; everything else
lives here. See `references/guidance.md` for the honesty rule in full.

## Packs are per-project

A standards pack is project configuration — it arrives with a `--pack` flag or a
`.ultra11yrc.json`. So a long-lived server serves many projects, and which standards exist
depends on whose project is asking.

- Every tool's `cwd` selects the project whose packs are visible. They are resolved once per
  root and cached.
- Two projects may each define a different pack under the **same key** without either
  shadowing the other.
- A project's `secondaryMappings` are applied to a **copy** of the built-in pack, never to the
  shared one — one project cannot re-key RGAA for every other project the server is serving.
- A pack that does not validate is a **hard error**. The server refuses to answer for that
  project rather than quietly answering about WCAG instead, because being answered about a
  different standard than the one you asked about is the failure this tool exists to prevent.

`standard` therefore carries **no enum**. An enum pinned when the tool list was built would
reject a pack that is perfectly valid for the project being asked about. The handler
validates against the registry instead and names the standards it does know.

Start the server dedicated to one project when you can:

```bash
claude mcp add ultra11y -- npx -y ultra11y mcp --cwd /abs/path/to/project
```

## The `std://` resources

Documentation in MCP is a *resource*, not a tool call. `resources/list` carries a small,
bounded index per standard; the per-item URIs are **templates**, because enumerating RGAA's
106 criteria and 119 terms would bloat every client's listing and go stale the moment a
project's own pack registers.

```
std://rgaa/criteria              the criterion index
std://rgaa/criteria/8.3          one criterion, in full
std://rgaa/themes/8              one theme
std://rgaa/glossary              every term the standard defines
std://rgaa/glossary/lien         one definition
std://rgaa/guidance/13.2         before/after patterns
std://rgaa/method                the work plan
std://rgaa/pack.json             the pack as loaded, with its licence and attribution
std://wcag/criteria/1.4.3        the same, for the worldwide core
```

`resources/templates/list` declares the four templated forms.

A `std://` read carries no `cwd` of its own, so it resolves against the **server's** project
root — the same packs its tools serve, when you started it with `--cwd`. Without a default
project it sees the built-ins only. That is one more reason to dedicate the server.

A `std://` read never touches the filesystem: the `skill://` scheme and its realpath
containment live in a separate module, because a non-filesystem branch inside a
path-containment function is exactly where a traversal bug hides later.

## The gate that follows from all this

`ultra11y_check` refuses a criterion declared **conformant** whose evidence tier this audit
never ran. Claiming 1.4.3 Contrast conformant from a source-only audit is refused by name,
with the command that would produce the evidence.

Scoped tight, so it refuses only what is unambiguously wrong: it needs the audit in hand, it
reads only the engine-decided half of the conformity list, and an absent `pagesAudited` is
read as *unknown*, never as zero. An agent's own ruling is left alone — that claim is bound by
the semantic gate instead (`references/judgment.md`).

`not-tested` and `not-applicable` are exempt throughout, and for the same reason: they assert
nothing.

## Driving it as an RGAA rule engine

```
1. ultra11y_standards                              → confirm rgaa is loaded here
2. ultra11y_method   { standard: "rgaa" }          → 39 source · 4 rendered · 3 browser · 59 judgment · 1 out of scope
3. ultra11y_audit    { cwd, graph: true }          → settles the source tier
4. ultra11y render / scan --merge                  → produces the rendered and browser tiers
5. ultra11y_adjudicate { standard: "rgaa" }        → the judgment tier, with its evidence
   ├─ ultra11y_criteria { standard:"rgaa", sc }    → the numbered tests you rule against
   ├─ ultra11y_glossary { standard:"rgaa", term }  → what its terms normatively mean
   └─ ultra11y_guidance { standard:"rgaa", ... }   → the fix to recommend
6. ultra11y_report   { standard: "rgaa" }          → the dated deliverable
7. ultra11y_check    { standard: "rgaa" }          → nothing claimed beyond the evidence
```

Steps 2 and 5 are the ones that make it a rule engine rather than a linter. Skipping step 2
means auditing without knowing that 59 of 106 criteria were never going to be decided by a
tool; skipping the lookups in step 5 means ruling on criteria from memory.

**A criterion nobody tested is untested, never conformant.** Every tool description repeats
it, because the failure mode here is not a wrong answer — it is a confident silence.

## Related

- `references/harnesses.md` — wiring the server into Claude Code, Codex, OpenCode, Cursor
- `references/packs.md` — authoring and runtime-loading a country pack
- `references/guidance.md` — the guidance dataset and its honesty rule
- `references/standards.md` — the pack format, and adding your country
- `references/adjudication.md` — the decision protocol the judgment tier works from

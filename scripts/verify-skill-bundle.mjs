#!/usr/bin/env node
// Install-bundle gate: prove the repo is shaped so that `npx skills add
// maxgfr/<name>` installs WORKING skills — engine + references included, not
// just a lone SKILL.md.
//
// The `skills` CLI (skills.sh) early-returns the moment it sees a SKILL.md at
// the repository ROOT and then installs that file ALONE — the sibling
// scripts/ and references/ are dropped. A skill is only bundled whole when its
// SKILL.md lives in a SUBDIRECTORY (skills/<name>/). This script asserts that
// shape for EVERY skill under skills/ and that each embedded engine is
// byte-identical to the tested bundle.
//
// Run by CI and by `pnpm run verify:bundle`. Pure Node, no deps, no network.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Claude Code truncates the COMBINED `description` + `when_to_use` text at 1536
// chars in the skill listing — that listing is what the model matches a task
// against, so anything past the cut is invisible and the skill silently stops
// auto-invoking. 1500 leaves a safety margin. NOTE: the budget is shared, not
// per-field: growing `description` eats into `when_to_use` and vice versa.
const LISTING_MAX = 1500;

// Frontmatter keys Claude Code understands, plus the two this repo carries
// (`license`, `metadata`). An unknown key at the root is almost always a typo
// — `when-to-use` for `when_to_use` costs the whole automatic trigger and
// otherwise fails silently, so it is a hard error here.
const KNOWN_KEYS = new Set([
  "name",
  "description",
  "when_to_use",
  "argument-hint",
  "arguments",
  "disable-model-invocation",
  "user-invocable",
  "allowed-tools",
  "disallowed-tools",
  "model",
  "effort",
  "context",
  "agent",
  "background",
  "hooks",
  "paths",
  "shell",
  "license",
  "metadata",
]);

/** A single-line, optionally quoted frontmatter scalar. The frontmatter here is
 *  deliberately kept single-line-per-key (no folded `>-` blocks) so this regex
 *  read stays honest — `sync-version.mjs` relies on the same shape. */
const scalar = (fm, key) =>
  fm
    .match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, "") ?? null;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const engine = `scripts/${pkg.name}.mjs`;
const errors = [];
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => {
  errors.push(m);
  console.log(`  FAIL ${m}`);
};

// 1. No SKILL.md at the repo root (would make `skills add` install it alone).
existsSync(join(root, "SKILL.md"))
  ? bad("a SKILL.md exists at the repo ROOT — `skills add` would install it alone, dropping the engine. Move it under skills/<name>/SKILL.md")
  : ok("no root SKILL.md");

const rootEngine = join(root, engine);
if (!existsSync(rootEngine)) bad(`missing ${engine} at repo root — run \`pnpm run build\``);

const skillNames = readdirSync(join(root, "skills")).filter((d) => statSync(join(root, "skills", d)).isDirectory());
if (skillNames.length === 0) bad("skills/ contains no skill directory");

for (const name of skillNames) {
  const skillDir = join(root, "skills", name);
  console.log(`skill ${name}:`);

  // 2. The packaged SKILL.md exists with valid, installable frontmatter.
  const skillMd = join(skillDir, "SKILL.md");
  if (!existsSync(skillMd)) {
    bad(`missing skills/${name}/SKILL.md — the skill package has no SKILL.md`);
    continue;
  }
  const raw = readFileSync(skillMd, "utf8");
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fm) bad(`skills/${name}/SKILL.md has no frontmatter block`);
  else {
    ok("packaged SKILL.md present with frontmatter");
    const nameLine = scalar(fm[1], "name");
    nameLine === name ? ok(`frontmatter name "${name}" matches its directory`) : bad(`frontmatter name "${nameLine}" != skill directory "${name}"`);

    // Only root-level keys: `metadata:`'s children are indented, so ^ under /m skips them.
    const unknown = [...fm[1].matchAll(/^([A-Za-z][\w-]*):/gm)].map((m) => m[1]).filter((k) => !KNOWN_KEYS.has(k));
    unknown.length === 0
      ? ok("frontmatter keys are all recognised")
      : bad(`skills/${name}: unknown frontmatter key(s) ${unknown.map((k) => `"${k}"`).join(", ")} — a typo here fails silently (e.g. "when-to-use" instead of "when_to_use")`);

    const desc = scalar(fm[1], "description");
    const when = scalar(fm[1], "when_to_use");
    if (!desc) bad(`skills/${name}: frontmatter has no description`);
    else {
      const total = desc.length + (when?.length ?? 0);
      const parts = `description ${desc.length}${when ? ` + when_to_use ${when.length}` : ""} = ${total}`;
      total <= LISTING_MAX
        ? ok(`${parts} chars (<= ${LISTING_MAX} safety cap)`)
        : bad(`skills/${name}: ${parts} chars exceeds the ${LISTING_MAX}-char safety cap — Claude Code truncates the listing at 1536 and the tail stops matching`);
    }
  }

  // 3. Every references/*.md mentioned exists, and every file is mentioned.
  const refsDir = join(skillDir, "references");
  if (existsSync(refsDir)) {
    const mentioned = new Set(raw.match(/references\/[a-z0-9-]+\.md/g) ?? []);
    for (const ref of mentioned) existsSync(join(skillDir, ref)) ? ok(`mentioned ${ref} exists`) : bad(`skills/${name}: ${ref} is mentioned in SKILL.md but missing from the package`);
    for (const f of readdirSync(refsDir).filter((f) => f.endsWith(".md"))) raw.includes(`references/${f}`) ? null : bad(`skills/${name}: references/${f} exists but SKILL.md never mentions it`);
    ok(`references/ present (${readdirSync(refsDir).filter((f) => f.endsWith(".md")).length} playbooks)`);
  }

  // 4. The embedded engine is byte-identical to the committed root bundle.
  const pkgEngine = join(skillDir, engine);
  if (!existsSync(rootEngine)) continue; // already reported above
  if (!existsSync(pkgEngine)) bad(`missing skills/${name}/${engine} — run \`node scripts/copy-bundle.mjs\``);
  else
    readFileSync(rootEngine).equals(readFileSync(pkgEngine))
      ? ok(`embedded engine skills/${name}/${engine} is byte-identical to ${engine}`)
      : bad(`skills/${name}/${engine} differs from ${engine} — run \`node scripts/copy-bundle.mjs\` and commit`);
}

// 5. The Claude Code PLUGIN shape, which is what carries the hooks. `skills add`
//    installs skills only; the automatic pre-PR review needs the plugin manifests
//    and the hook guard to ship together, so their absence is a hard failure.
console.log("plugin:");
const readJson = (rel) => {
  const p = join(root, rel);
  if (!existsSync(p)) {
    bad(`missing ${rel} — the plugin would not install (no hooks, so no automatic review)`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    bad(`${rel} is not valid JSON: ${e.message}`);
    return null;
  }
};

const plugin = readJson(".claude-plugin/plugin.json");
if (plugin) {
  plugin.name === pkg.name ? ok(`plugin.json name "${plugin.name}" matches the package`) : bad(`.claude-plugin/plugin.json name "${plugin.name}" != package name "${pkg.name}"`);
  plugin.version === pkg.version
    ? ok(`plugin.json version ${plugin.version} matches the package`)
    : bad(`.claude-plugin/plugin.json version "${plugin.version}" != package version "${pkg.version}" — add it to scripts/sync-version.mjs`);
  plugin.description ? ok("plugin.json has a description") : bad(".claude-plugin/plugin.json has no description (required)");
}

const marketplace = readJson(".claude-plugin/marketplace.json");
if (marketplace) {
  Array.isArray(marketplace.plugins) && marketplace.plugins.some((p) => p.name === pkg.name)
    ? ok(`marketplace.json lists the "${pkg.name}" plugin`)
    : bad(`.claude-plugin/marketplace.json does not list a plugin named "${pkg.name}"`);
}

const hooksJson = readJson("hooks/hooks.json");
if (hooksJson) {
  Array.isArray(hooksJson.hooks?.PreToolUse) && hooksJson.hooks.PreToolUse.length > 0
    ? ok("hooks.json declares a PreToolUse hook")
    : bad("hooks/hooks.json declares no PreToolUse hook — nothing would trigger the review before a commit/push/PR");
}

existsSync(join(root, "hooks/pre-tool-use.mjs"))
  ? ok("hooks/pre-tool-use.mjs present")
  : bad("missing hooks/pre-tool-use.mjs — hooks.json points at a guard that does not exist");

for (const f of [".claude-plugin", "hooks"])
  (pkg.files ?? []).includes(f) ? ok(`package.json files[] carries ${f}/`) : bad(`package.json "files" is missing "${f}" — the npm tarball would ship without it`);

if (errors.length) {
  console.error(`\nverify-skill-bundle: ${errors.length} problem(s) — a published skill would not install correctly.`);
  process.exit(1);
}
console.log(`\nverify-skill-bundle: ok — ${skillNames.map((n) => `skills/${n}/`).join(", ")} install as complete skills.`);

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
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Codex accepts descriptions up to 1024 characters. Keep the gate at the
// official limit so the same frontmatter remains discoverable across hosts.
const DESCRIPTION_MAX = 1024;
const CLAUDE_LISTING_MAX = 1500;

// Accept the union of the Codex keys and the Claude Code keys supported by this
// multi-host repository. The installable skills themselves are tested below
// against the stricter portable subset.
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

const gitlabTemplate = readFileSync(join(root, "skills/ultra11y/templates/gitlab-ci.yml"), "utf8");
const gitlabVersion = gitlabTemplate.match(/ULTRA11Y_VERSION:\s*'([^']+)'/)?.[1];
gitlabVersion === pkg.version
  ? ok(`GitLab template pins package ${gitlabVersion}`)
  : bad(`GitLab template pin "${gitlabVersion ?? "missing"}" != package version "${pkg.version}" — keep it in scripts/sync-version.mjs and the release assets`);
const releaseConfig = JSON.parse(readFileSync(join(root, ".releaserc.json"), "utf8"));
const gitRelease = releaseConfig.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "@semantic-release/git");
const releaseAssets = new Set(gitRelease?.[1]?.assets ?? []);
releaseAssets.has("skills/ultra11y/templates/gitlab-ci.yml")
  ? ok("release commit carries the version-pinned GitLab template")
  : bad("@semantic-release/git omits skills/ultra11y/templates/gitlab-ci.yml — every release would leave its exact package pin behind");

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
      desc.length <= DESCRIPTION_MAX
        ? ok(`description ${desc.length} chars (<= ${DESCRIPTION_MAX} Codex limit)`)
        : bad(`skills/${name}: description ${desc.length} chars exceeds the ${DESCRIPTION_MAX}-char Codex limit`);
      const listingLength = desc.length + (when?.length ?? 0);
      listingLength <= CLAUDE_LISTING_MAX
        ? ok(`Claude listing ${listingLength} chars (<= ${CLAUDE_LISTING_MAX} safety cap)`)
        : bad(`skills/${name}: Claude listing ${listingLength} chars exceeds the ${CLAUDE_LISTING_MAX}-char safety cap`);
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

for (const f of [".claude-plugin", ".codex-plugin", ".agents", "hooks"])
  (pkg.files ?? []).includes(f) ? ok(`package.json files[] carries ${f}/`) : bad(`package.json "files" is missing "${f}" — the npm tarball would ship without it`);

// --- 6. the multi-harness shape -------------------------------------------------------
// Codex resolves plugin manifests .codex-plugin/ -> .claude-plugin/ -> .cursor-plugin/, so
// the Claude manifest already works there. .codex-plugin/plugin.json exists to add what
// Codex alone reads (the `interface` block a marketplace renders), and its validator is
// STRICTER than Claude Code's: it rejects any key outside this list, so a typo that would
// merely be ignored on Claude Code makes the plugin uninstallable on Codex. These are the
// exact allowlists read out of the codex 0.146.0 binary's own validator.
console.log("codex plugin:");
const CODEX_KNOWN_KEYS = new Set(["id", "name", "version", "description", "skills", "apps", "mcpServers", "interface", "author", "homepage", "repository", "license", "keywords"]);
const CODEX_INTERFACE_KEYS = new Set([
  "displayName",
  "shortDescription",
  "longDescription",
  "developerName",
  "category",
  "capabilities",
  "websiteURL",
  "privacyPolicyURL",
  "termsOfServiceURL",
  "brandColor",
  "composerIcon",
  "logo",
  "logoDark",
  "screenshots",
  "defaultPrompt",
  "default_prompt",
]);
const CODEX_INTERFACE_REQUIRED = ["displayName", "shortDescription", "longDescription", "developerName", "category"];

const codex = readJson(".codex-plugin/plugin.json");
if (codex) {
  const unknown = Object.keys(codex).filter((k) => !CODEX_KNOWN_KEYS.has(k));
  unknown.length === 0 ? ok("plugin.json keys are all accepted by Codex's validator") : bad(`.codex-plugin/plugin.json has key(s) Codex rejects: ${unknown.join(", ")} — the plugin would not install`);

  codex.name === pkg.name ? ok(`plugin.json name "${codex.name}" matches the package`) : bad(`.codex-plugin/plugin.json name "${codex.name}" != package name "${pkg.name}"`);
  codex.version === pkg.version
    ? ok(`plugin.json version ${codex.version} matches the package`)
    : bad(`.codex-plugin/plugin.json version "${codex.version}" != package version "${pkg.version}" — add it to scripts/sync-version.mjs`);
  /^\d+\.\d+\.\d+$/.test(codex.version ?? "") ? ok("plugin.json version is strict semver, as Codex requires") : bad(`.codex-plugin/plugin.json version "${codex.version}" is not strict semver — Codex rejects it`);

  // One plugin, one description. Two manifests that describe it differently is a bug the
  // moment a user compares the two marketplaces.
  codex.description === plugin?.description ? ok("plugin.json description matches the Claude manifest") : bad(".codex-plugin/plugin.json description differs from .claude-plugin/plugin.json — they describe the same plugin");

  // Codex pins these to fixed contract paths and rejects anything else.
  codex.skills === undefined || codex.skills.replace(/^\.\//, "").replace(/\/$/, "") === "skills"
    ? ok('plugin.json skills resolves to "skills", as Codex requires')
    : bad(`.codex-plugin/plugin.json skills "${codex.skills}" must resolve to "skills"`);
  if (codex.skills !== undefined)
    existsSync(join(root, "skills")) ? ok("the declared skills/ directory exists") : bad(".codex-plugin/plugin.json declares skills/ but the directory is missing");

  // `hooks` is deliberately ABSENT: it is not in Codex's allowlist, so declaring it makes
  // the manifest invalid. Codex discovers hooks/hooks.json by convention at the plugin
  // root and sets ${CLAUDE_PLUGIN_ROOT} for it, exactly as Claude Code does.
  codex.hooks === undefined ? ok("plugin.json does not declare hooks (Codex rejects the key; discovery is by convention)") : bad(".codex-plugin/plugin.json declares `hooks`, which Codex's validator rejects — remove it, hooks/hooks.json is found by convention");

  const iface = codex.interface;
  if (!iface || typeof iface !== "object") bad(".codex-plugin/plugin.json has no `interface` object — Codex requires one");
  else {
    const unknownIface = Object.keys(iface).filter((k) => !CODEX_INTERFACE_KEYS.has(k));
    unknownIface.length === 0 ? ok("plugin.json interface keys are all accepted") : bad(`.codex-plugin/plugin.json interface has key(s) Codex rejects: ${unknownIface.join(", ")}`);
    const missing = CODEX_INTERFACE_REQUIRED.filter((k) => typeof iface[k] !== "string" || !iface[k].trim());
    missing.length === 0 ? ok(`plugin.json interface carries ${CODEX_INTERFACE_REQUIRED.join(", ")}`) : bad(`.codex-plugin/plugin.json interface is missing required field(s): ${missing.join(", ")}`);
    iface.defaultPrompt || iface.default_prompt ? ok("plugin.json interface has a defaultPrompt") : bad(".codex-plugin/plugin.json interface needs `defaultPrompt` (or `default_prompt`) — Codex requires it");
    !iface.brandColor || /^#[0-9A-Fa-f]{6}$/.test(iface.brandColor) ? ok("plugin.json interface brandColor is well formed") : bad(`.codex-plugin/plugin.json interface.brandColor "${iface.brandColor}" must be #RRGGBB`);
    !iface.capabilities || (Array.isArray(iface.capabilities) && iface.capabilities.every((c) => typeof c === "string" && c.trim()))
      ? ok("plugin.json interface capabilities is a list of strings")
      : bad(".codex-plugin/plugin.json interface.capabilities must be an array of non-empty strings");
  }
}

// The file `codex plugin marketplace add <repo>` reads. Versionless by design: it points at
// the repo, and the plugin manifest inside is the single source of the number.
const codexMarket = readJson(".agents/plugins/marketplace.json");
if (codexMarket) {
  codexMarket.interface?.displayName ? ok("marketplace.json has interface.displayName") : bad(".agents/plugins/marketplace.json needs an `interface.displayName` object — Codex requires it");
  const entry = Array.isArray(codexMarket.plugins) ? codexMarket.plugins.find((p) => p.name === pkg.name) : undefined;
  entry ? ok(`marketplace.json lists the "${pkg.name}" plugin`) : bad(`.agents/plugins/marketplace.json does not list a plugin named "${pkg.name}"`);
  if (entry) {
    entry.source && typeof entry.source === "object" ? ok("marketplace.json entry has an object source") : bad(".agents/plugins/marketplace.json entry needs an object `source` (e.g. { source: \"url\", url: \"./\" })");
    const inst = entry.policy?.installation;
    !inst || ["NOT_AVAILABLE", "AVAILABLE", "INSTALLED_BY_DEFAULT"].includes(inst) ? ok("marketplace.json installation policy is valid") : bad(`.agents/plugins/marketplace.json installation policy "${inst}" is not one of NOT_AVAILABLE, AVAILABLE, INSTALLED_BY_DEFAULT`);
    const auth = entry.policy?.authentication;
    !auth || ["ON_INSTALL", "ON_USE"].includes(auth) ? ok("marketplace.json authentication policy is valid") : bad(`.agents/plugins/marketplace.json authentication policy "${auth}" is not one of ON_INSTALL, ON_USE`);
  }
}

// --- 7. the OpenCode plugin -----------------------------------------------------------
// Committed JavaScript that no type-checker covers and that OpenCode loads straight off
// disk — from ~/.config/opencode/plugin/, where there is no node_modules to resolve a bare
// import and no build step to catch a syntax error. Both failures are silent: the plugin
// simply never loads and the gate never fires.
console.log("opencode plugin:");
const OC_REL = ".opencode/plugins/ultra11y.js";
const ocPath = join(root, OC_REL);
if (!existsSync(ocPath)) bad(`missing ${OC_REL} — OpenCode would have no plugin to load`);
else {
  const src = readFileSync(ocPath, "utf8");
  src.includes("ULTRA11Y_OPENCODE_PLUGIN") ? ok("plugin carries the ownership marker") : bad(`${OC_REL} has no ULTRA11Y_OPENCODE_PLUGIN marker — the installer would refuse to manage it`);
  src.includes('"tool.execute.before"') ? ok("plugin declares tool.execute.before") : bad(`${OC_REL} declares no "tool.execute.before" — nothing would gate a commit`);

  const foreign = [...src.matchAll(/^import .*? from ["']([^"']+)["']/gm)].map((m) => m[1]).filter((s) => !s.startsWith("node:"));
  foreign.length === 0 ? ok("plugin imports only node: builtins") : bad(`${OC_REL} imports ${foreign.join(", ")} — it must stay zero-dependency, it is loaded from outside any node_modules`);

  const checked = spawnSync(process.execPath, ["--check", ocPath], { encoding: "utf8" });
  checked.status === 0 ? ok("plugin parses on this Node") : bad(`${OC_REL} is not valid JavaScript: ${(checked.stderr ?? "").trim().split("\n")[0]}`);

  const declared = /ULTRA11Y_PLUGIN_VERSION = "([^"]+)"/.exec(src)?.[1];
  declared === pkg.version ? ok(`plugin version ${declared} matches the package`) : bad(`${OC_REL} declares version "${declared}" != package version "${pkg.version}" — add it to scripts/sync-version.mjs`);

  // `main` is how an opencode.json npm pin resolves the plugin. Pointing it at a path that
  // is not in files[] publishes a package whose pin route is broken.
  pkg.main === OC_REL ? ok(`package.json main points at ${OC_REL}`) : bad(`package.json "main" is "${pkg.main ?? "unset"}" — it must be "${OC_REL}" or the opencode.json npm pin cannot resolve the plugin`);
  existsSync(join(root, pkg.main ?? "")) ? ok("package.json main resolves on disk") : bad(`package.json "main" points at a file that does not exist`);
  (pkg.files ?? []).includes(pkg.main?.split("/")[0]) ? ok("package.json files[] carries main's directory") : bad(`package.json "files" is missing "${pkg.main?.split("/")[0]}" — main would not be published`);

  // Two prefilters that disagree mean one harness silently reviews less than the other.
  const guardSrc = readFileSync(join(root, "hooks/pre-tool-use.mjs"), "utf8");
  const PREFILTER = String.raw`/\bgit\b|\bgh\b/`;
  src.includes(PREFILTER) && guardSrc.includes(PREFILTER)
    ? ok("the OpenCode plugin and the Claude/Codex guard share one prefilter literal")
    : bad(`${OC_REL} and hooks/pre-tool-use.mjs must both carry the literal ${PREFILTER} — they gate the same commands`);
}

// Codex's skill validator is looser than Claude Code's (it accepts unknown frontmatter
// keys) but it does hard-fail on these three, so assert them rather than assume.
for (const name of skillNames) {
  const fm = readFileSync(join(root, "skills", name, "SKILL.md"), "utf8");
  const dmi = /^disable[-_]model[-_]invocation:\s*(\S+)/m.exec(fm)?.[1];
  !dmi || dmi === "false" ? ok(`${name}: disable-model-invocation is unset or false, as Codex requires`) : bad(`skills/${name}/SKILL.md sets disable-model-invocation: ${dmi} — Codex rejects anything but false`);
}

if (errors.length) {
  console.error(`\nverify-skill-bundle: ${errors.length} problem(s) — a published skill would not install correctly.`);
  process.exit(1);
}
console.log(`\nverify-skill-bundle: ok — ${skillNames.map((n) => `skills/${n}/`).join(", ")} install as complete skills.`);

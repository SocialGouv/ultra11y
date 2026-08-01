// Codex resolves plugin manifests .codex-plugin/ -> .claude-plugin/ -> .cursor-plugin/, so
// ultra11y already installs there off the Claude manifest. .codex-plugin/plugin.json exists
// to add what Codex alone reads — the `interface` block a marketplace renders — and it is
// held to a STRICTER contract: Codex's validator rejects any key outside a fixed allowlist,
// so a stray field that Claude Code would ignore makes the plugin uninstallable on Codex.
//
// scripts/verify-skill-bundle.mjs enforces the same rules at build time. This file covers
// the version lockstep across EVERY manifest, which is the failure that ships silently: a
// released plugin reporting the wrong engine version.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../src/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = (rel: string) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));

const pkg = json("package.json") as { name: string; version: string; files: string[] };
const codex = json(".codex-plugin/plugin.json");
const claude = json(".claude-plugin/plugin.json");
const market = json(".agents/plugins/marketplace.json");

// Read out of the codex 0.146.0 binary's own validator.
const KNOWN_KEYS = new Set([
  "id",
  "name",
  "version",
  "description",
  "skills",
  "apps",
  "mcpServers",
  "interface",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
]);
const INTERFACE_KEYS = new Set([
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

describe("every version-carrying file stays in lockstep", () => {
  // One table, so a new manifest is one line rather than a forgotten assertion.
  const carriers: Array<[string, string | undefined]> = [
    ["src/types.ts (the value the bundle reports)", VERSION],
    [".claude-plugin/plugin.json", claude.version],
    [".claude-plugin/marketplace.json", json(".claude-plugin/marketplace.json").plugins?.[0]?.version],
    [".codex-plugin/plugin.json", codex.version],
  ];
  it.each(carriers)("%s matches package.json", (_label, version) => {
    expect(version).toBe(pkg.version);
  });

  it("keeps .agents/plugins/marketplace.json versionless on purpose", () => {
    // It points at the repo; the plugin manifest inside is the single source of the number.
    // A version here would be a second place to forget.
    expect(market.plugins?.[0]?.version).toBeUndefined();
  });
});

describe(".codex-plugin/plugin.json satisfies Codex's validator", () => {
  it("uses only accepted top-level keys", () => {
    expect(Object.keys(codex).filter((k) => !KNOWN_KEYS.has(k))).toEqual([]);
  });

  it("does not declare `hooks`", () => {
    // Not in the allowlist — declaring it makes the manifest invalid. Codex finds
    // hooks/hooks.json by convention at the plugin root and sets ${CLAUDE_PLUGIN_ROOT}.
    expect(codex.hooks).toBeUndefined();
  });

  it("uses strict semver", () => {
    expect(codex.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("describes the plugin exactly as the Claude manifest does", () => {
    expect(codex.description).toBe(claude.description);
  });

  it('declares skills at the fixed contract path "skills"', () => {
    expect(String(codex.skills).replace(/^\.\//, "").replace(/\/$/, "")).toBe("skills");
  });

  it("gives author.url an absolute https URL", () => {
    if (codex.author?.url) expect(codex.author.url).toMatch(/^https:\/\/\S+/);
  });

  describe("interface", () => {
    it("uses only accepted keys", () => {
      expect(Object.keys(codex.interface).filter((k) => !INTERFACE_KEYS.has(k))).toEqual([]);
    });

    it.each(["displayName", "shortDescription", "longDescription", "developerName", "category"])("requires a non-empty %s", (field) => {
      expect(typeof codex.interface[field]).toBe("string");
      expect(codex.interface[field].trim()).not.toBe("");
    });

    it("carries a defaultPrompt", () => {
      expect(codex.interface.defaultPrompt ?? codex.interface.default_prompt).toBeTruthy();
    });

    it("keeps capabilities a list of non-empty strings", () => {
      if (codex.interface.capabilities === undefined) return;
      expect(Array.isArray(codex.interface.capabilities)).toBe(true);
      for (const c of codex.interface.capabilities) expect(typeof c === "string" && c.trim()).toBeTruthy();
    });
  });
});

describe(".agents/plugins/marketplace.json is what `codex plugin marketplace add` reads", () => {
  it("has an interface.displayName", () => {
    expect(market.interface?.displayName).toBeTruthy();
  });

  it("lists the plugin with an object source", () => {
    const entry = market.plugins?.find((p: { name: string }) => p.name === pkg.name);
    expect(entry).toBeTruthy();
    expect(typeof entry.source).toBe("object");
  });

  it("uses policy values Codex accepts", () => {
    const policy = market.plugins?.[0]?.policy ?? {};
    if (policy.installation) expect(["NOT_AVAILABLE", "AVAILABLE", "INSTALLED_BY_DEFAULT"]).toContain(policy.installation);
    if (policy.authentication) expect(["ON_INSTALL", "ON_USE"]).toContain(policy.authentication);
  });
});

describe("the npm tarball ships every harness's manifest", () => {
  it.each([".claude-plugin", ".codex-plugin", ".agents", "hooks", "skills"])("files[] carries %s", (dir) => {
    expect(pkg.files).toContain(dir);
  });
});

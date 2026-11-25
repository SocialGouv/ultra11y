import { describe, expect, it } from "vitest";
import { HELP_EN, HELP_FR, helpText } from "../src/help.js";
import { main } from "../src/cli.js";

const flagsOf = (s: string): Set<string> => new Set(s.match(/--[a-z][a-z-]+/g) ?? []);
// A usage line with its trailing prose comment, "(…)", removed: the part a user types.
const usageOf = (s: string): string[] =>
  s
    .split("\n")
    .filter((l) => l.startsWith("  ultra11y "))
    .map((l) => l.replace(/\s{2,}\(.*\)$/, "").trimEnd());

async function run(argv: string[]): Promise<string> {
  const out: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  try {
    await main(argv);
  } finally {
    console.log = orig;
  }
  return out.join("\n");
}

describe("help text (#214: French by default, English with --lang en)", () => {
  it("lists exactly the same flags in both languages", () => {
    expect([...flagsOf(HELP_FR)].sort()).toEqual([...flagsOf(HELP_EN)].sort());
  });

  it("keeps every usage line identical — only the prose comments differ", () => {
    expect(usageOf(HELP_FR)).toEqual(usageOf(HELP_EN));
  });

  it("selects the language", () => {
    expect(helpText("fr")).toBe(HELP_FR);
    expect(helpText("en")).toBe(HELP_EN);
  });

  it("prints the French help by default, the English one with --lang en", async () => {
    expect(await run(["--help"])).toBe(HELP_FR);
    expect(await run(["--help", "--lang", "en"])).toBe(HELP_EN);
    expect(await run(["-h", "--lang=en"])).toBe(HELP_EN);
    expect(await run(["check", "--help"])).toBe(HELP_FR);
    expect(await run(["check", "--help", "--lang", "en"])).toBe(HELP_EN);
  });
});

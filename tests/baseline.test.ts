import { describe, it, expect } from "vitest";
import { findingId, parseFailOn } from "../src/baseline.js";
import type { Finding } from "../src/types.js";

const F = (over: Partial<Finding> = {}): Finding => ({
  ruleId: "img-alt-missing",
  criteriaId: "1.1",
  file: "a.html",
  line: 1,
  col: 1,
  selectorHint: "img",
  severity: "bloquant",
  message: "",
  remediation: "",
  snippet: "",
  sourceStart: 10,
  sourceEnd: 20,
  ...over,
});

describe("finding identity", () => {
  it("is stable across line drift (keyed by source range, not line)", () => {
    expect(findingId(F({ line: 1 }))).toBe(findingId(F({ line: 99 })));
  });
  it("falls back to line/col/selector when no source range (JSX/stdin)", () => {
    const j = F({ sourceStart: undefined, sourceEnd: undefined });
    expect(findingId(j)).toContain("l1:1:img");
  });
  it("distinguishes different elements", () => {
    expect(findingId(F({ sourceStart: 10 }))).not.toBe(findingId(F({ sourceStart: 50 })));
  });
});

describe("--fail-on parsing", () => {
  it("parseFailOn: default bloquant, aliases, and STRICT null on an unrecognized value", () => {
    expect(parseFailOn(undefined)).toBe("bloquant"); // flag absent → default
    expect(parseFailOn(true)).toBe("bloquant"); // present, no value → default
    expect(parseFailOn("blocking")).toBe("bloquant");
    expect(parseFailOn("majeur")).toBe("majeur");
    expect(parseFailOn("major")).toBe("majeur");
    expect(parseFailOn("minor")).toBe("mineur");
    expect(parseFailOn("nonsense")).toBeNull(); // a typo must NOT silently degrade the gate
    expect(parseFailOn("majr")).toBeNull();
  });
});

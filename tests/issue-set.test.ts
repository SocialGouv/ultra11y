// The tracker-agnostic issue set — the same items `--gh-issues` files, minus the transport.
//
// The point of this seam is that the GitHub path and the JSON export cannot drift: a board
// that is not GitHub must file the SAME de-duplicated, criterion-keyed items, with the same
// titles (the de-dupe grain) and the same labels. So the tests assert equality against what
// `pushIssues` actually hands to `gh`, not against a second copy of the expected strings.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
import { execFileSync } from "node:child_process";
import { issueSet, issueLabels, issueTitle, issueBody, pushIssues } from "../src/gh.js";
import type { PrdUnit } from "../src/prd.js";
import type { Severity } from "../src/types.js";

const mock = execFileSync as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => mock.mockReset());

function unit(criteriaId: string, title: string, severity: Severity = "bloquant", advisory = false): PrdUnit {
  return {
    criteriaId,
    title,
    label: `${criteriaId} — ${title}`,
    refs: ["1.1.1"],
    severity,
    advisory,
    findings: [
      {
        ruleId: "cross-icon-only-unnamed",
        criteriaId,
        file: "src/page.tsx",
        line: 5,
        col: 7,
        selectorHint: "IconButton",
        severity,
        message: "icon-only control with no accessible name",
        remediation: "Give it an aria-label",
        snippet: "<IconButton/>",
      },
    ],
  };
}

/** The (title, labels) pairs `pushIssues` actually sent to `gh`. */
function whatGithubGot(units: PrdUnit[], standard: "wcag" | "rgaa" = "wcag"): { title: string; labels: string[] }[] {
  const sent: { title: string; labels: string[] }[] = [];
  mock.mockImplementation((...callArgs: unknown[]) => {
    const args = (callArgs[1] as string[] | undefined) ?? [];
    if (args.includes("list")) return JSON.stringify([]);
    const t = args[args.indexOf("--title") + 1] as string;
    const l = args.includes("--label") ? (args[args.indexOf("--label") + 1] as string).split(",") : [];
    sent.push({ title: t, labels: l });
    return "";
  });
  pushIssues(units, "en", standard);
  return sent;
}

describe("issueSet — one item per criterion, ready for any tracker", () => {
  const units = [unit("4.1.2", "Name, Role, Value"), unit("1.1.1", "Non-text Content", "majeur")];

  it("renders title, body, labels, severity and occurrences for every unit", () => {
    const issues = issueSet(units, "en");
    expect(issues).toHaveLength(2);
    const first = issues[0]!;
    expect(first.criteriaId).toBe("4.1.2");
    expect(first.title).toBe(issueTitle(units[0]!));
    expect(first.body).toBe(issueBody(units[0]!, "en", "wcag"));
    expect(first.labels).toEqual(issueLabels(units[0]!));
    expect(first.severity).toBe("bloquant");
    expect(first.advisory).toBe(false);
    expect(first.occurrences).toEqual([{ file: "src/page.tsx", line: 5, selector: "IconButton", message: "icon-only control with no accessible name" }]);
  });

  it("carries the occurrences a tracker needs to anchor its own inline comments", () => {
    const [issue] = issueSet([unit("4.1.2", "Name, Role, Value")], "en");
    expect(issue!.occurrences.every((o) => o.file && o.line > 0)).toBe(true);
  });

  it("marks an advisory unit as such instead of smuggling a good practice in as a non-conformity", () => {
    const [issue] = issueSet([unit("1.3.1", "Info and Relationships", "mineur", true)], "en");
    expect(issue!.advisory).toBe(true);
    expect(issue!.labels).toContain("recommendation");
    expect(issue!.title).toContain("(recommendation)");
  });
});

describe("the export and the GitHub transport cannot drift", () => {
  it("produces the same titles and labels `pushIssues` sends to gh (WCAG core)", () => {
    const units = [unit("4.1.2", "Name, Role, Value"), unit("1.3.1", "Info and Relationships", "mineur", true)];
    const exported = issueSet(units, "en").map((i) => ({ title: i.title, labels: i.labels }));
    expect(whatGithubGot(units)).toEqual(exported);
  });

  it("agrees under a country standard too — the pack's tag and label, not WCAG's", () => {
    const units = [unit("8.3", "Langue de page")];
    const exported = issueSet(units, "fr", "rgaa").map((i) => ({ title: i.title, labels: i.labels }));
    expect(whatGithubGot(units, "rgaa")).toEqual(exported);
    expect(exported[0]!.title).toContain("RGAA");
    expect(exported[0]!.labels).toContain("rgaa");
  });

  it("titles are the de-dupe grain: stable across runs, so re-filing is a no-op anywhere", () => {
    const u = unit("4.1.2", "Name, Role, Value");
    expect(issueSet([u], "en")[0]!.title).toBe(issueSet([u], "en")[0]!.title);
    // …and independent of the number of occurrences behind it.
    const withMore: PrdUnit = { ...u, findings: [...u.findings, { ...u.findings[0]!, line: 42 }] };
    expect(issueSet([withMore], "en")[0]!.title).toBe(issueSet([u], "en")[0]!.title);
  });
});

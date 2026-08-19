// Splitting a rendered report back into its SECTIONS, so a surface with a byte budget can drop
// whole ones instead of slicing a document at an offset.
//
// Cutting a rendered document at a byte offset lands mid-table (GFM then renders a broken
// grid), or inside an unterminated fence, where everything after it is swallowed into code.
// The pull-request comment already refused to do that with rows; carrying the REPORT into a
// comment needs the same refusal one level up.
//
// The one thing this must not get wrong is a `##` that is not a heading. A report embeds
// snippets of the audited source, and a snippet inside a fenced block may legitimately start
// with `## ` — treating it as a section boundary would split a document in the middle of the
// evidence for a non-conformity.
import { describe, expect, it } from "vitest";

import { splitReportSections } from "../src/report.js";

describe("splitReportSections", () => {
  it("returns the preamble and one entry per `##` heading", () => {
    const md = ["# Title", "", "- **Date** : 2026-08-19", "", "## 1. One", "", "body one", "", "## 2. Two", "", "body two"].join("\n");
    const { preamble, sections } = splitReportSections(md);
    expect(preamble.join("\n")).toContain("**Date**");
    expect(sections.map((s) => s.heading)).toEqual(["## 1. One", "## 2. Two"]);
    expect(sections[0]!.lines.join("\n")).toContain("body one");
    expect(sections[1]!.lines.join("\n")).toContain("body two");
  });

  it("keeps each section's own heading inside it, so a block travels whole", () => {
    const { sections } = splitReportSections(["## A", "", "x"].join("\n"));
    expect(sections[0]!.text).toBe("## A\n\nx");
  });

  it("never splits on a `##` inside a fenced code block", () => {
    // The evidence for a non-conformity is the audited source, and the audited source is
    // allowed to contain anything at all.
    const md = ["## 2. Non-conformities", "", "```html", '<h2 class="x">## not a heading</h2>', "```", "", "after"].join("\n");
    const { sections } = splitReportSections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.text).toContain("## not a heading");
    expect(sections[0]!.text).toContain("after");
  });

  it("handles a report with no heading at all", () => {
    const { preamble, sections } = splitReportSections("just prose\n");
    expect(sections).toEqual([]);
    expect(preamble.join("\n")).toContain("just prose");
  });

  it("round-trips: preamble plus every section is the document it was given", () => {
    // The property that makes dropping safe — what is kept is exactly what was rendered, never
    // a re-rendering that could disagree with the artifact a reader opens next.
    const md = ["# T", "", "intro", "", "## 1. A", "", "a", "", "## 2. B", "", "b", ""].join("\n");
    const { preamble, sections } = splitReportSections(md);
    expect([...preamble, ...sections.flatMap((s) => s.lines)].join("\n")).toBe(md);
  });
});

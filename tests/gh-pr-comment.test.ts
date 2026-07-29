import { describe, it, expect } from "vitest";
import { COMMENT_MARKER, prNumberFromEnv, stickyBody, pickExistingComment } from "../src/gh.js";

describe("finding the pull request to comment on", () => {
  it("reads the number out of a pull_request ref", () => {
    expect(prNumberFromEnv({ GITHUB_REF: "refs/pull/123/merge" })).toBe(123);
    expect(prNumberFromEnv({ GITHUB_REF: "refs/pull/7/head" })).toBe(7);
  });

  it("prefers an explicit override", () => {
    expect(prNumberFromEnv({ GITHUB_REF: "refs/pull/123/merge", ULTRA11Y_PR: "9" })).toBe(9);
  });

  it("returns undefined off a pull request, rather than guessing one", () => {
    expect(prNumberFromEnv({ GITHUB_REF: "refs/heads/main" })).toBeUndefined();
    expect(prNumberFromEnv({})).toBeUndefined();
  });

  it("ignores a non-numeric override instead of crashing", () => {
    expect(prNumberFromEnv({ ULTRA11Y_PR: "not-a-number", GITHUB_REF: "refs/pull/5/merge" })).toBe(5);
  });
});

describe("the sticky comment body", () => {
  it("carries a hidden marker so the next run updates instead of piling up", () => {
    const body = stickyBody("hello", "wcag");
    expect(body).toContain(COMMENT_MARKER("wcag"));
    expect(body).toContain("hello");
    // The marker must be invisible to a reader.
    expect(body).toMatch(/<!--[^>]*-->/);
  });

  it("keeps one comment per standard, so a WCAG and an RGAA run do not overwrite each other", () => {
    expect(COMMENT_MARKER("wcag")).not.toBe(COMMENT_MARKER("rgaa"));
  });
});

describe("choosing which comment to update", () => {
  const marker = COMMENT_MARKER("rgaa");
  const comments = [
    { id: 1, body: "unrelated review note" },
    { id: 2, body: `${COMMENT_MARKER("wcag")}\nprevious WCAG run` },
    { id: 3, body: `${marker}\nprevious RGAA run` },
  ];

  it("finds this standard's own previous comment", () => {
    expect(pickExistingComment(comments, marker)?.id).toBe(3);
  });

  it("never adopts another standard's comment", () => {
    expect(pickExistingComment([comments[1]!], marker)).toBeUndefined();
  });

  it("never adopts a human's comment", () => {
    expect(pickExistingComment([comments[0]!], marker)).toBeUndefined();
  });

  it("tolerates a malformed comment list rather than throwing", () => {
    expect(pickExistingComment([{ id: 4 } as { id: number; body?: string }], marker)).toBeUndefined();
    expect(pickExistingComment([], marker)).toBeUndefined();
  });
});

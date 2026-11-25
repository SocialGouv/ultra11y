// `affected` (src/affected.ts): from the changed files, the reverse import graph up to the route
// files and the sample's declared sources, then the URLs those pages answer at.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAffectedGraph, changedSince, routeOfFile, selectAffected, type AffectedInput } from "../src/affected.js";
import { readRoutes } from "../src/routes.js";
import { main } from "../src/cli.js";
import type { DepGraph } from "../src/graph/graph.js";

const ROOT = new URL("./fixtures/affected-app/", import.meta.url).pathname.replace(/\/$/, "");

describe("routeOfFile", () => {
  it.each([
    ["src/app/page.tsx", { kind: "page", pattern: "/" }],
    ["src/app/contact/page.tsx", { kind: "page", pattern: "/contact" }],
    ["app/(public)/aide/page.tsx", { kind: "page", pattern: "/aide" }],
    ["app/@modal/photo/page.tsx", { kind: "page", pattern: "/photo" }],
    ["src/app/actualites/[id]/page.tsx", { kind: "page", pattern: "/actualites/[id]" }],
    ["src/app/admin/layout.tsx", { kind: "layout", pattern: "/admin", dir: "src/app/admin" }],
    ["pages/index.tsx", { kind: "page", pattern: "/" }],
    ["src/pages/blog/index.tsx", { kind: "page", pattern: "/blog" }],
    ["src/pages/_app.tsx", { kind: "layout", pattern: "/", dir: "src/pages" }],
  ])("%s", (file, expected) => {
    expect(routeOfFile(file)).toEqual(expected);
  });

  it.each(["src/components/Button.tsx", "pages/api/hello.ts", "src/pages/_helpers/x.tsx", "src/app/page.test.tsx"])("%s is no route file", (file) => {
    expect(routeOfFile(file)).toBeNull();
  });
});

describe("selectAffected on a Next.js App Router fixture", () => {
  let graph: DepGraph;
  beforeAll(() => {
    graph = buildAffectedGraph(ROOT);
  });
  const select = (changed: string[], over: Partial<AffectedInput> = {}) => selectAffected({ root: ROOT, changed, graph, inventory: readRoutes(ROOT), ...over });
  const paths = (changed: string[], over: Partial<AffectedInput> = {}) => select(changed, over).routes.map((r) => r.path);

  it("a component reaches every page importing it, through a barrel and another component", () => {
    // Button is re-exported by the components barrel (the home page) and imported by
    // ContactForm (the contact page).
    expect(paths(["src/components/Button.tsx"])).toEqual(["/", "/contact"]);
  });

  it("a page file reaches its own route, and nothing else", () => {
    expect(paths(["src/app/contact/page.tsx"])).toEqual(["/contact"]);
  });

  it("a route group adds no URL segment", () => {
    expect(paths(["src/app/(public)/aide/page.tsx"])).toEqual(["/aide"]);
  });

  it("a dynamic route resolves to the inventory's concrete URLs", () => {
    const r = select(["src/lib/format.ts"]);
    expect(r.routes.map((x) => x.path)).toEqual(["/actualites/101", "/actualites/102"]);
    expect(r.routes[0]!.entry).toBe("src/app/actualites/[id]/page.tsx");
    expect(r.routes[0]!.changed).toEqual(["src/lib/format.ts"]);
    expect(r.unresolved).toEqual([]);
  });

  it("a dynamic route nothing resolves is listed, never guessed", () => {
    const r = select(["src/lib/format.ts"], { inventory: undefined });
    expect(r.routes).toEqual([]);
    expect(r.unresolved).toEqual([{ entry: "src/app/actualites/[id]/page.tsx", pattern: "/actualites/[id]" }]);
  });

  it("an unresolved dynamic page is named once, by its own route file, however it was reached", () => {
    const r = select(["src/lib/format.ts", "src/app/layout.tsx"], { inventory: undefined });
    expect(r.unresolved).toEqual([{ entry: "src/app/actualites/[id]/page.tsx", pattern: "/actualites/[id]" }]);
  });

  it("a layout reaches every page below it", () => {
    expect(paths(["src/app/admin/layout.tsx"])).toEqual(["/admin", "/admin/users"]);
  });

  it("the root layout — or a component only it imports — reaches every page", () => {
    const all = ["/", "/actualites/101", "/actualites/102", "/admin", "/admin/users", "/aide", "/contact"];
    expect(paths(["src/app/layout.tsx"])).toEqual(all);
    expect(paths(["src/components/Header.tsx"])).toEqual(all);
  });

  it("changed markup no page reaches is reported as unmapped", () => {
    const r = select(["src/components/Orphan.tsx"]);
    expect(r.routes).toEqual([]);
    expect(r.unmapped).toEqual(["src/components/Orphan.tsx"]);
  });

  it("a file outside the graph (a README, a deleted file) selects nothing and is not unmapped", () => {
    const r = select(["README.md", "src/components/Gone.tsx"]);
    expect(r.routes).toEqual([]);
    expect(r.unmapped).toEqual([]);
  });

  it("rebases every URL onto --base-url, keeping the inventory's path", () => {
    const r = select(["src/components/Button.tsx"], { baseUrl: "https://pr-42.preview.example/" });
    expect(r.routes.map((x) => x.url)).toEqual(["https://pr-42.preview.example/", "https://pr-42.preview.example/contact"]);
  });

  it("without --base-url, the inventory URL is kept as is", () => {
    expect(select(["src/app/contact/page.tsx"]).routes[0]!.url).toBe("https://prod.example.fr/contact");
  });

  it("a sample page's declared source selects that page, for a router the files do not reveal", () => {
    const r = select(["src/components/Orphan.tsx"], {
      sample: [{ id: "orphelin", url: "https://prod.example.fr/orphelin", sources: ["src/components/Orphan.tsx"] }],
    });
    expect(r.routes).toEqual([
      {
        path: "/orphelin",
        url: "https://prod.example.fr/orphelin",
        entry: "src/components/Orphan.tsx",
        kind: "sample",
        sampleId: "orphelin",
        changed: ["src/components/Orphan.tsx"],
      },
    ]);
    expect(r.unmapped).toEqual([]);
  });

  it("no change, no page", () => {
    expect(select([])).toEqual({ changed: [], routes: [], unresolved: [], unmapped: [] });
  });
});

describe("changedSince", () => {
  let dir: string;
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "u11y-affected-"));
    cpSync(ROOT, dir, { recursive: true });
    git("init", "-q", "-b", "main");
    // A throwaway repository under the OS temp dir, like the harness smoke tests use: no
    // identity or signing key is assumed on the machine running the suite.
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    git("checkout", "-q", "-b", "feature");
    appendFileSync(join(dir, "src/components/Button.tsx"), "// changed on the branch\n");
    git("commit", "-q", "-am", "change");
    // Not committed yet, and untracked: both are part of the change under review.
    writeFileSync(join(dir, "src/lib/format.ts"), `${readFileSync(join(dir, "src/lib/format.ts"), "utf8")}// wip\n`);
    writeFileSync(join(dir, "src/components/New.tsx"), "export const New = () => <p>new</p>;\n");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("lists the branch's commits since the merge-base, the uncommitted edits and the untracked files", () => {
    expect(changedSince("main", dir)).toEqual(["src/components/Button.tsx", "src/components/New.tsx", "src/lib/format.ts"]);
  });

  it("fails with a readable message on a ref that does not exist", () => {
    expect(() => changedSince("origin/nope", dir)).toThrow(/no merge-base/);
  });

  it("`affected --json` prints the pages the branch reaches", async () => {
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await main(["affected", "--since", "main", "--root", dir, "--base-url", "http://localhost:3000", "--json"]);
    vi.restoreAllMocks();
    expect(code).toBe(0);
    const doc = JSON.parse(out.join("\n")) as { since: string; routes: { url: string }[]; unmapped: string[] };
    expect(doc.since).toBe("main");
    // Button (committed), format.ts (uncommitted) — and New.tsx, untracked, reaches no page.
    expect(doc.routes.map((r) => r.url)).toEqual([
      "http://localhost:3000/",
      "http://localhost:3000/actualites/101",
      "http://localhost:3000/actualites/102",
      "http://localhost:3000/contact",
    ]);
    expect(doc.unmapped).toEqual(["src/components/New.tsx"]);
  });

  it("`affected` without --json lists the pages in French under --lang fr", async () => {
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await main(["affected", "--since", "main", "--root", dir, "--lang", "fr"]);
    vi.restoreAllMocks();
    expect(code).toBe(0);
    expect(out[0]).toBe("3 fichier(s) modifié(s) depuis main → 4 page(s) touchée(s) :");
  });
});

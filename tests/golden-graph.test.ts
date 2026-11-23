// GOLDEN snapshots of the `audit --graph` component-graph machine artifact on a
// purpose-built fixture (tests/fixtures/golden-graph) that exercises every risky
// discovery/resolution surface at once:
//   - a tsconfig "@/*" path-alias import        (alias resolution)
//   - a plain-TS barrel re-export               (graph-only .ts discovery + hop)
//   - an import into a .gitignored tree         (walker ignore semantics)
//   - an extensionless import of a .vue SFC     (.vue candidate probing)
//   - comma-separated --exclude globs           (glob dialect + splitting)
// The goldens predate every change to the walker, the glob matcher and the
// resolver: a diff here is a behaviour change to investigate, never a snapshot
// to refresh. The one adjudicated diff since capture: src/generated/Ignored.tsx
// (a .gitignored tree) is out of discovery, the graph and the findings, because
// the walk (src/walk.ts) honours .gitignore. Alias, barrel, extensionless-.vue
// resolution and the comma-split exclude globs are byte-identical.
import { describe, expect, it } from "vitest";
import { runAudit } from "../src/audit.js";
import { discover } from "../src/discover.js";
import { GRAPH_ONLY_EXT, toPosix } from "../src/glob.js";
import { buildGraphStreaming } from "../src/graph/build.js";
import { resolveUsage } from "../src/graph/graph.js";

const FIX = "tests/fixtures/golden-graph";
// Comma-separated on purpose: both halves must apply (ultra11y splits glob flag
// values on commas). Matched against the cwd-relative posix path, as the CLI does.
const EXCLUDE = ["**/excluded/**,**/skipme/**"];
const INCLUDE = [`${FIX}/src/**`];

const rel = (f: string): string => toPosix(f).replace(`${FIX}/`, "");

function graphFiles(): string[] {
  return discover([FIX], { ext: GRAPH_ONLY_EXT, include: INCLUDE, exclude: EXCLUDE }).files;
}

describe("golden: audit --graph on tests/fixtures/golden-graph", () => {
  it("discovered graph file list (include/exclude scoped)", () => {
    expect(graphFiles().map(rel)).toMatchSnapshot();
  });

  it("component-graph nodes (imports, components, star re-exports, ids)", () => {
    const graph = buildGraphStreaming(graphFiles());
    const dump = [...graph.nodes.values()].map((n) => ({
      file: rel(n.file),
      imports: n.imports,
      components: [...new Map([...n.components].map(([name, def]) => [name, { ...def, file: rel(def.file) }]))].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
      definesIds: n.definesIds,
      providesHtmlLang: n.providesHtmlLang,
      starReexports: n.starReexports,
      opaqueComponents: n.opaqueComponents,
    }));
    expect(dump).toMatchSnapshot();
  });

  it("cross-file usage resolution (alias, barrel, gitignored tree, extensionless .vue)", () => {
    const graph = buildGraphStreaming(graphFiles());
    const app = [...graph.nodes.keys()].find((f) => f.endsWith("App.tsx"))!;
    const host = [...graph.nodes.keys()].find((f) => f.endsWith("WidgetHost.tsx"))!;
    const resolve = (from: string, name: string): string | null => {
      const def = resolveUsage(graph, from, name);
      return def ? `${rel(def.file)}#${def.name}` : null;
    };
    expect({
      "App#SaveButton (tsconfig @/* alias)": resolve(app, "SaveButton"),
      "App#Card (barrel re-export)": resolve(app, "Card"),
      "App#Gen (.gitignored tree)": resolve(app, "Gen"),
      "WidgetHost#Widget (extensionless .vue)": resolve(host, "Widget"),
    }).toMatchSnapshot();
  });

  it("audit --graph findings (the CLI's machine artifact, cross rules included)", () => {
    const findings = runAudit({ inputs: [FIX], include: INCLUDE, exclude: EXCLUDE, dedup: "off", graph: true }).findings.map((f) => ({
      ruleId: f.ruleId,
      file: rel(f.file),
      line: f.line,
      ...(f.related ? { related: `${rel(f.related.file)}:${f.related.line}` } : {}),
    }));
    findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.ruleId < b.ruleId ? -1 : 1)));
    expect(findings).toMatchSnapshot();
  });
});

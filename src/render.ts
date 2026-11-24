// `render --detect` and `render --storybook` — the framework recipe (build → audit) and the
// attribution of per-story HTML a Storybook run already produced. Rendering itself is
// ultra11y's own engine, `render [<dir>]` (src/render-engine.ts): it renders the project's
// components with the project's own react-dom/server, without reading its tests.
import type { Lang } from "./types.js";
import type { CaptureProvenance } from "./parse/html.js";

export interface FrameworkHit {
  name: string;
  buildCmd: string;
  outDir: string; // directory of emitted HTML to audit
}

export interface Detection {
  frameworks: FrameworkHit[];
  componentLibraries: string[]; // design systems whose rendered output source-audit can't see
}

const KNOWN_LIBS: Record<string, string> = {
  "@codegouvfr/react-dsfr": "DSFR (Système de Design de l'État)",
  "@gouvfr/dsfr": "DSFR",
  "@mui/material": "MUI",
  "@chakra-ui/react": "Chakra UI",
  antd: "Ant Design",
  "@mantine/core": "Mantine",
  "react-bootstrap": "React-Bootstrap",
  "@radix-ui/react-dropdown-menu": "Radix UI",
};

/** Pure detection from a merged deps map + a "does this config file exist" probe. */
export function detectFrameworks(deps: Record<string, string>, has: (file: string) => boolean): Detection {
  const dep = (n: string): boolean => Object.hasOwn(deps, n);
  const anyConfig = (...files: string[]): boolean => files.some((f) => has(f));
  const frameworks: FrameworkHit[] = [];

  if (dep("next") || anyConfig("next.config.js", "next.config.mjs", "next.config.ts"))
    frameworks.push({ name: "Next.js", buildCmd: "npx next build   # set `output: 'export'` in next.config to emit static HTML", outDir: "out" });
  if (dep("astro") || anyConfig("astro.config.mjs", "astro.config.ts", "astro.config.js"))
    frameworks.push({ name: "Astro", buildCmd: "npx astro build", outDir: "dist" });
  if (dep("@sveltejs/kit")) frameworks.push({ name: "SvelteKit", buildCmd: "npx vite build", outDir: "build" });
  if (dep("react-scripts")) frameworks.push({ name: "CRA", buildCmd: "npx react-scripts build", outDir: "build" });
  if (Object.keys(deps).some((d) => d === "storybook" || d.startsWith("@storybook/")) || has(".storybook"))
    frameworks.push({ name: "Storybook", buildCmd: "npx storybook build", outDir: "storybook-static" });
  // Vite last (generic) so a more specific framework above is preferred in guidance.
  if (dep("vite") || anyConfig("vite.config.js", "vite.config.ts", "vite.config.mjs"))
    frameworks.push({ name: "Vite", buildCmd: "npx vite build", outDir: "dist" });

  const componentLibraries: string[] = [];
  for (const [pkg, label] of Object.entries(KNOWN_LIBS)) if (dep(pkg)) componentLibraries.push(label);

  return { frameworks, componentLibraries };
}

const L = {
  fr: {
    title: "Obtenir du HTML rendu à auditer (render)",
    why: "Auditer les sources JSX d'une bibliothèque de composants donne des faux négatifs : il faut auditer le HTML réellement produit.",
    libNote: (libs: string) =>
      `Bibliothèque(s) détectée(s) : ${libs}. Leur sortie n'est PAS visible en analyse de source — auditez le build ou le rendu (\`render\`).`,
    detected: "Frameworks détectés",
    none: "Aucun framework détecté.",
    build: "Build",
    then: "puis auditer",
    sbReco: "Le plus simple pour un design-system : un build Storybook statique, puis auditer chaque story rendue.",
    ssr: "Composants : `render [<dir>]` les rend avec le react-dom/server du projet, sans lire ses tests, vers .ultra11y/captures.",
    dyn: "Pour les critères de rendu (contraste calculé, focus, reflow) : `scan <url>` (tier navigateur).",
  },
  en: {
    title: "Get rendered HTML to audit (render)",
    why: "Auditing the JSX sources of a component library yields false negatives: audit the HTML it actually produces.",
    libNote: (libs: string) => `Detected library(ies): ${libs}. Their output is NOT visible to source analysis — audit the build or the render (\`render\`).`,
    detected: "Detected frameworks",
    none: "No framework detected.",
    build: "Build",
    then: "then audit",
    sbReco: "Easiest for a design system: a static Storybook build, then audit each rendered story.",
    ssr: "Components: `render [<dir>]` renders them with the project's own react-dom/server, without reading its tests, into .ultra11y/captures.",
    dyn: "For rendering criteria (computed contrast, focus, reflow): `scan <url>` (browser tier).",
  },
} as const;

export function renderPlan(d: Detection, lang: Lang = "fr"): string {
  const s = L[lang];
  const out: string[] = [`# ${s.title}`, "", `> ${s.why}`, ""];
  if (d.componentLibraries.length) out.push(`> 🧩 ${s.libNote(d.componentLibraries.join(", "))}`, "");
  out.push(`## ${s.detected}`, "");
  if (!d.frameworks.length) out.push(s.none, "");
  else
    for (const f of d.frameworks) {
      out.push(`- **${f.name}** — ${s.build} : \`${f.buildCmd}\``);
      out.push(`  - ${s.then} : \`node scripts/ultra11y.mjs audit "${f.outDir}/**/*.html"\``);
    }
  out.push("", `- ${s.sbReco}`, `- ${s.ssr}`, `- ${s.dyn}`, "");
  return out.join("\n");
}

export interface StorybookStory {
  id: string;
  title?: string;
  name?: string;
  importPath?: string;
}

/** Parse a Storybook `index.json` (v7+, `entries`) or `stories.json` (v6, `stories`) into
 *  its story entries (docs/MDX entries dropped). Returns [] on anything malformed. */
export function parseStorybookIndex(json: string): StorybookStory[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const rec = data as { entries?: Record<string, unknown>; stories?: Record<string, unknown> } | null;
  const entries = rec?.entries ?? rec?.stories;
  if (!entries || typeof entries !== "object") return [];
  const out: StorybookStory[] = [];
  for (const [id, raw] of Object.entries(entries)) {
    if (!raw || typeof raw !== "object") continue; // tolerate null/garbage entry values
    const e = raw as { id?: string; title?: string; name?: string; importPath?: string; type?: string };
    if (e.type && e.type !== "story") continue; // skip docs/MDX entries (v7 `type`)
    out.push({ id: e.id ?? id, title: e.title, name: e.name, importPath: e.importPath });
  }
  return out;
}

/** Best-effort provenance for a Storybook story: source from importPath (a `.stories.*`
 *  file → its sibling component file), component from the title's last segment. */
export function storyProvenance(story: StorybookStory): CaptureProvenance | undefined {
  const imp = story.importPath;
  if (!imp) return undefined;
  const sourceFile = imp.replace(/^\.\//, "").replace(/\.stories\.([jt]sx?)$/i, ".$1");
  const fromTitle = story.title ? story.title.split("/").pop()?.trim() : undefined;
  const component = fromTitle || sourceFile.replace(/^.*\//, "").replace(/\.[jt]sx?$/i, "");
  return { v: 1, sourceFile, ...(component ? { component } : {}), ...(story.name ? { name: story.name } : {}) };
}

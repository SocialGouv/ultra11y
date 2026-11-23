// `render` — get auditable RENDERED HTML for a project, so component libraries
// (DSFR, MUI…) are audited as the HTML they actually produce, not their JSX
// sources. ultra11y is install-free and cannot import a project's components
// itself (no React, no toolchain), so `render` does the two things it honestly
// can: DETECT the framework and advise the exact build→audit path, and SCAFFOLD a
// runnable SSR-snapshot harness that uses the PROJECT'S OWN react-dom/server. The
// emitted HTML is then audited by the normal `audit` command.
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
      `Bibliothèque(s) détectée(s) : ${libs}. Leur sortie n'est PAS visible en analyse de source — auditez le build ou un snapshot SSR.`,
    detected: "Frameworks détectés",
    none: "Aucun framework détecté.",
    build: "Build",
    then: "puis auditer",
    sbReco: "Le plus simple pour un design-system : un build Storybook statique, puis auditer chaque story rendue.",
    ssr: "Sinon, snapshot SSR : `render --scaffold` écrit un harnais react-dom/server à compléter.",
    dyn: "Pour les critères de rendu (contraste calculé, focus, reflow) : `scan <url>` (tier navigateur).",
    scaffoldWrote: (p: string) => `Harnais SSR écrit : ${p}`,
    scaffoldRun: "Complétez COMPONENTS, exécutez-le avec votre toolchain (ex. `npx tsx`), puis auditez le dossier produit.",
  },
  en: {
    title: "Get rendered HTML to audit (render)",
    why: "Auditing the JSX sources of a component library yields false negatives: audit the HTML it actually produces.",
    libNote: (libs: string) => `Detected library(ies): ${libs}. Their output is NOT visible to source analysis — audit the build or an SSR snapshot.`,
    detected: "Detected frameworks",
    none: "No framework detected.",
    build: "Build",
    then: "then audit",
    sbReco: "Easiest for a design system: a static Storybook build, then audit each rendered story.",
    ssr: "Otherwise, SSR snapshot: `render --scaffold` writes a react-dom/server harness to fill in.",
    dyn: "For rendering criteria (computed contrast, focus, reflow): `scan <url>` (browser tier).",
    scaffoldWrote: (p: string) => `SSR harness written: ${p}`,
    scaffoldRun: "Fill in COMPONENTS, run it with your toolchain (e.g. `npx tsx`), then audit the produced folder.",
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

/** The SSR-snapshot harness written by `render --scaffold`. Uses the PROJECT'S own
 *  React + components; ultra11y bundles none of it. */
export function ssrHarness(): string {
  return `// ultra11y SSR snapshot harness — render your components to static HTML for audit.
// 1. Fill in COMPONENTS with your real components (DSFR, design-system, pages…).
// 2. Run it with your project's toolchain, e.g.:  npx tsx ultra11y-render.tsx
// 3. Audit the produced HTML:  node scripts/ultra11y.mjs audit "audits/rendered/**/*.html"
import { mkdirSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
// import { Button } from "@codegouvfr/react-dsfr/Button";

const COMPONENTS: { name: string; element: JSX.Element }[] = [
  // { name: "button-icon", element: <Button iconId="fr-icon-add-line" title="Ajouter" /> },
];

const OUT = "audits/rendered";
mkdirSync(OUT, { recursive: true });
for (const { name, element } of COMPONENTS) {
  const body = renderToStaticMarkup(element);
  const html = \`<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>\${name}</title></head>
<body>
\${body}
</body>
</html>
\`;
  writeFileSync(\`\${OUT}/\${name}.html\`, html);
  console.log(\`ultra11y-render: wrote \${OUT}/\${name}.html\`);
}
if (COMPONENTS.length === 0) console.error("ultra11y-render: COMPONENTS is empty — add your components, then re-run.");
`;
}

export interface TestRunner {
  runner: "vitest" | "jest" | null;
  dom: "jsdom" | "happy-dom" | null;
}

/** Detect the test runner + DOM implementation from a deps map + config-file probe, so
 *  `render --setup` can print the exact wiring (and warn when a DOM env is missing). */
export function detectTestRunner(deps: Record<string, string>, has: (file: string) => boolean): TestRunner {
  const dep = (n: string): boolean => Object.hasOwn(deps, n);
  const runner: TestRunner["runner"] =
    dep("vitest") || has("vitest.config.ts") || has("vitest.config.js") || has("vitest.config.mjs")
      ? "vitest"
      : dep("jest") || has("jest.config.ts") || has("jest.config.js") || has("jest.config.cjs") || has("jest.config.mjs")
        ? "jest"
        : null;
  const dom: TestRunner["dom"] = dep("jsdom") ? "jsdom" : dep("happy-dom") ? "happy-dom" : null;
  return { runner, dom };
}

/** The zero-touch capture harvester written by `render --setup`. Added ONCE to the test
 *  runner's setup, its global afterEach serializes every rendered component's DOM to a
 *  provenance-tagged .html the static engine audits. Dependency-free; runs in the user's
 *  test process (jsdom/happy-dom document + node fs), embeds no framework. */
export function captureSetup(): string {
  return `// ultra11y capture harvester — zero-touch rendered-DOM snapshots for accessibility audit.
// Add this ONCE to your test runner's setup; every component your tests render is then
// serialized to .ultra11y/captures/*.html and audited by \`ultra11y audit\`. No per-test code.
//   Vitest: test: { environment: "jsdom", globals: true, setupFiles: [".ultra11y/capture-setup.mjs"] }
//   Jest:   testEnvironment: "jsdom", setupFilesAfterEnv: ["<rootDir>/.ultra11y/capture-setup.mjs"]
// List it LAST so its afterEach runs BEFORE Testing-Library cleanup empties the DOM.
// Off: ULTRA11Y_CAPTURES=off. Custom dir: ULTRA11Y_CAPTURES=path/to/dir.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, relative, basename } from "node:path";

const OUT = process.env.ULTRA11Y_CAPTURES || ".ultra11y/captures";
const afterEachFn = typeof globalThis.afterEach === "function" ? globalThis.afterEach : null;
const hasDom = typeof document !== "undefined";

// Optional per-test override, consumed by the NEXT capture — for a test file whose name
// doesn't match the component, or a single test rendering several distinct components.
//   import { captureAs } from ".ultra11y/capture-setup.mjs"; captureAs("Button", "src/Button.tsx")
//   (or globalThis.ultra11yCaptureAs("Button")).
let __override = null;
export function captureAs(component, source) { __override = { component: component, source: source }; }
if (typeof globalThis !== "undefined") globalThis.ultra11yCaptureAs = captureAs;

if (OUT !== "off" && OUT !== "0") {
  if (!hasDom) {
    // Not a DOM test environment — nothing to serialize. Set environment: "jsdom".
  } else if (!afterEachFn) {
    process.stderr.write("ultra11y capture: afterEach is not global — enable Vitest \\\`globals: true\\\` (or use Jest setupFilesAfterEnv) so captures can register.\\n");
  } else {
    let written = 0;
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/--/g, "&#45;&#45;");
    afterEachFn(() => {
      try {
        if (typeof document === "undefined" || !document.body) return;
        const html = document.body.innerHTML;
        if (!html || !html.trim()) return;
        const st = (globalThis.expect && globalThis.expect.getState && globalThis.expect.getState()) || {};
        const testPath = typeof st.testPath === "string" ? st.testPath : "";
        const name = typeof st.currentTestName === "string" ? st.currentTestName : "";
        const rel = testPath ? relative(process.cwd(), testPath).split("\\\\").join("/") : "";
        let source = rel ? rel.replace(/\\.(test|spec)\\.([jt]sx?)$/i, ".$2") : "";
        let component = source ? basename(source).replace(/\\.[jt]sx?$/i, "") : "";
        if (__override) {
          if (__override.component) component = __override.component;
          if (__override.source) source = __override.source;
          __override = null;
        }
        const attrs = ['v="1"'];
        if (source) attrs.push('source="' + esc(source) + '"');
        if (component) attrs.push('component="' + esc(component) + '"');
        if (rel) attrs.push('test="' + esc(rel) + '"');
        if (name) attrs.push('name="' + esc(name) + '"');
        const content = "<!-- ultra11y:capture " + attrs.join(" ") + " -->\\n" + html + "\\n";
        let h = 5381;
        const keyStr = testPath + "::" + name;
        for (let i = 0; i < keyStr.length; i++) h = ((h << 5) + h + keyStr.charCodeAt(i)) >>> 0;
        const file = OUT + "/" + (component || "capture") + "__" + h.toString(36) + ".html";
        mkdirSync(dirname(file), { recursive: true });
        if (existsSync(file) && readFileSync(file, "utf8") === content) return; // unchanged — keep byte-stable
        writeFileSync(file, content);
        written++;
      } catch {
        // never fail a user's test because a capture could not be written
      }
    });
    if (typeof process.on === "function")
      process.on("exit", () => {
        if (written === 0)
          process.stderr.write("ultra11y capture: 0 captures written — ensure a DOM env (jsdom) and that this setup runs before Testing-Library cleanup (list it LAST in setupFiles).\\n");
      });
  }
}
`;
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

/** Instructions printed by `render --setup` after writing the harvester. */
export function captureSetupPlan(tr: TestRunner, path: string, lang: Lang = "en"): string {
  const fr = lang === "fr";
  const out: string[] = [];
  out.push(fr ? `Harnais de capture écrit : ${path}` : `Capture harvester written: ${path}`);
  out.push("");
  if (tr.runner === "jest") {
    out.push(fr ? "Jest — ajoutez à votre config :" : "Jest — add to your config:");
    out.push(`  testEnvironment: "jsdom",`);
    out.push(`  setupFilesAfterEnv: ["<rootDir>/${path}"]   // ${fr ? "PAS setupFiles (afterEach doit exister)" : "NOT setupFiles (afterEach must exist)"}`);
  } else {
    out.push(fr ? "Vitest — ajoutez à vitest.config.ts (test:) :" : "Vitest — add to vitest.config.ts (test:):");
    out.push(`  environment: "jsdom",`);
    out.push(
      `  globals: true,   // ${fr ? "requis : sans ça, afterEach n'est pas global et rien n'est capturé" : "required: without it afterEach is not global and nothing is captured"}`,
    );
    out.push(`  setupFiles: ["${path}"],   // ${fr ? "en DERNIER (avant le cleanup Testing-Library)" : "list LAST (before Testing-Library cleanup)"}`);
  }
  out.push("");
  if (!tr.dom)
    out.push(
      fr
        ? "⚠️ Aucun jsdom/happy-dom détecté — installez-en un et activez l'environnement DOM."
        : "⚠️ No jsdom/happy-dom detected — install one and enable the DOM environment.",
    );
  out.push(fr ? "Puis : lancez vos tests, committez .ultra11y/captures, et auditez :" : "Then: run your tests, commit .ultra11y/captures, and audit:");
  out.push(`  node scripts/ultra11y.mjs audit --require-captures        # ${fr ? "gate : composants sans capture" : "gate: components lacking a capture"}`);
  out.push(
    `  git add .ultra11y .gitattributes   # ${fr ? "committez les captures (+ .gitattributes généré)" : "commit the captures (+ generated .gitattributes)"}`,
  );
  return out.join("\n");
}

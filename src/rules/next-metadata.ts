// The Next.js App Router metadata API, shared by the single-file title rule, the graph
// extraction and the audit's no-graph fallback.
//
// App Router sets the document <title> via `export const metadata = { title }` or
// `generateMetadata`, not a literal <title> in JSX, so source analysis never sees it. The
// export usually sits in a route file (`app/**/layout.tsx`, `app/**/page.tsx`) while the
// `<html><head>` it fills is often rendered by a component that file imports.

const NEXT_METADATA = /export\s+(?:const\s+(?:metadata|generateMetadata)\b|(?:async\s+)?function\s+generateMetadata\b)/;
const TITLE_KEY = /\btitle\s*:/;

/** Does this module export Next.js metadata (`metadata` or `generateMetadata`) carrying a
 *  `title`? A source-level signal: what it proves is that the framework, not the markup,
 *  owns the document title of every page this module wraps. */
export function exportsMetadataTitle(source: string): boolean {
  return NEXT_METADATA.test(source) && TITLE_KEY.test(source);
}

// `app/**/layout.*` / `app/**/page.*`, at any depth (`src/app/**`, `apps/web/app/**`).
const APP_ROUTE_FILE = /(?:^|\/)app\/(?:.+\/)?(?:layout|page)\.(?:tsx|jsx|ts|js)$/;
const APP_LAYOUT_FILE = /(?:^|\/)app\/(?:.+\/)?layout\.(?:tsx|jsx|ts|js)$/;
const UNDER_APP_DIR = /(?:^|\/)app\//;

const posix = (file: string): string => file.replace(/\\/g, "/");

/** An App Router route file whose metadata export Next.js applies: a `layout` or a `page`. */
export function isAppRouteFile(file: string): boolean {
  return APP_ROUTE_FILE.test(posix(file));
}

/** An App Router `layout`: it wraps every page below it. */
export function isAppLayoutFile(file: string): boolean {
  return APP_LAYOUT_FILE.test(posix(file));
}

/** Is the file inside an App Router `app/` directory? */
export function isUnderAppDir(file: string): boolean {
  return UNDER_APP_DIR.test(posix(file));
}

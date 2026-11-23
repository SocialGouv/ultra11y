// THE UNIT-TEST HALF of the integration — what `ultra11y/vitest` and `ultra11y/jest` share.
//
// A unit test has already rendered the component, with the project's own renderer, in the state
// the test built (a variant, an error, an open menu). This audits that DOM, in-process, without
// a browser and without ultra11y importing any framework:
//
//   import { checkA11y, toBeAccessible } from "ultra11y/vitest";   // or "ultra11y/jest"
//   expect.extend({ toBeAccessible });
//
//   const { container } = render(<Button variant="primary" />);
//   await checkA11y(container, { as: "button-primary", failOn: "major" });
//   expect(container).toBeAccessible();
//
// Same design as the Playwright fixture, one level down. The helper serializes the render and
// pipes it to the engine (`capture write`), which writes the capture, its provenance comment and
// the audit; the helper holds no knowledge of either. The durable half is the CAPTURE:
// `.ultra11y/captures/<id>.html`, re-read offline by every later `ultra11y audit` — commit it.
//
// A COMPONENT, NOT A PAGE. The capture is a fragment, so the page-scoped rules (title, lang)
// stay off, and it never enters the per-page grid. And jsdom/happy-dom compute no style and lay
// out no box: the engine marks the capture `styles="none"`, and colour, contrast, reflow and
// focus visibility stay « à évaluer ». Those are measured in a browser — `ultra11y/playwright`.
import { basename, isAbsolute, relative } from "node:path";
import { type AuditLike, type ComponentCapturePayload, type FindingLike, auditCapture, failingFindings, formatFailure } from "./core.js";

/** Options of `checkA11y` and `toBeAccessible`. */
export interface UnitCheckOptions {
  /** Capture id — the file stem under `.ultra11y/captures/`. Defaults to the test file and title. */
  as?: string;
  /** Human name for the capture. Defaults to the current test's title. */
  name?: string;
  /** The component rendered, when the test file's name does not say it. */
  component?: string;
  /** Repo-relative source of the component, so findings are reported against YOUR code.
   *  Defaults to the test file without `.test`/`.spec`, when that file exists. */
  source?: string;
  /** Severity at which the check fails (default `blocking`), or `false` to record only. */
  failOn?: "blocking" | "major" | "minor" | false;
  /** Project root the capture is written under (default: the current directory). */
  root?: string;
}

/** What can be checked: an element (`container`, `baseElement`), a Document, a DocumentFragment
 *  (`asFragment()`), a Testing Library render result, or an HTML string you rendered yourself. */
export type Renderable = string | NodeLike | { container: NodeLike };

// The DOM is not a dependency of this package (the test environment provides it), so nodes are
// typed structurally to exactly what is read.
interface NodeLike {
  nodeType?: number;
  outerHTML?: string;
  textContent?: string | null;
  data?: string;
  childNodes?: ArrayLike<NodeLike>;
  body?: NodeLike | null;
  innerHTML?: string;
  documentElement?: NodeLike | null;
  ownerDocument?: { defaultView?: { navigator?: { userAgent?: string } } | null } | null;
  defaultView?: { navigator?: { userAgent?: string } } | null;
}

const escText = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function nodeHtml(n: NodeLike): string {
  if (n.nodeType === 1 && typeof n.outerHTML === "string") return n.outerHTML;
  if (n.nodeType === 3) return escText(n.textContent ?? "");
  if (n.nodeType === 8) return `<!--${n.data ?? ""}-->`;
  return "";
}

/** Serialize what the test rendered. A Document contributes its body's content, never its
 *  `<html>`: the test document is jsdom's empty shell, and auditing its missing title as the
 *  component's would be a finding about nothing. */
export function serializeRender(target: Renderable): string {
  if (typeof target === "string") return target;
  if (target && typeof target === "object") {
    if ("container" in target && target.container) return serializeRender(target.container);
    const n = target as NodeLike;
    if (n.nodeType === 9) return n.body?.innerHTML ?? "";
    if (n.nodeType === 11) return Array.from(n.childNodes ?? [], nodeHtml).join("");
    if (typeof n.outerHTML === "string") return n.outerHTML;
  }
  throw new TypeError(
    "ultra11y: checkA11y expects an Element, a Document, a DocumentFragment, a Testing Library render result ({ container }) or an HTML string.",
  );
}

/** Which DOM implementation rendered it, read from the node's own window — never assumed. */
function domEnv(target: Renderable): string | undefined {
  let node: NodeLike | undefined;
  if (typeof target === "object" && target) node = "container" in target ? target.container : (target as NodeLike);
  const g = globalThis as { navigator?: { userAgent?: string }; happyDOM?: unknown };
  const ua = node?.ownerDocument?.defaultView?.navigator?.userAgent ?? node?.defaultView?.navigator?.userAgent ?? g.navigator?.userAgent ?? "";
  if (/jsdom/i.test(ua)) return "jsdom";
  if (/happy-?dom/i.test(ua) || g.happyDOM) return "happy-dom";
  return undefined;
}

/** The running test, as the runner's own `expect` state reports it. Vitest installs its `expect`
 *  under `Symbol.for("expect-global")` whether or not globals are on; Jest exposes `expect`. */
export interface TestContext {
  testPath?: string;
  currentTestName?: string;
}

function currentTest(): TestContext {
  const g = globalThis as Record<string | symbol, unknown>;
  const ex = (g.expect ?? g[Symbol.for("expect-global")]) as { getState?: () => TestContext } | undefined;
  try {
    return ex?.getState?.() ?? {};
  } catch {
    return {};
  }
}

/** A file-safe id from a test file stem and title — accent-folded like a page id. A long
 *  `describe` chain is cut and suffixed with a hash of the whole, so it stays a usable file name
 *  and two titles sharing a prefix never share a capture (nor depend on which ran first). */
function idSlug(s: string): string {
  const slug = s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= 80) return slug;
  let h = 5381;
  for (let i = 0; i < slug.length; i++) h = ((h << 5) + h + slug.charCodeAt(i)) >>> 0;
  return `${slug.slice(0, 72).replace(/-+$/, "")}-${h.toString(36)}`;
}

// Per process: how many captures each id has had, so two checks in one test are two captures.
const seen = new Map<string, number>();

/** Build the capture payload for a render — exported for tests and for callers that pipe it. */
export function capturePayload(target: Renderable, opts: UnitCheckOptions, runner: string, ctx: TestContext = currentTest()): ComponentCapturePayload {
  const html = serializeRender(target);
  const root = opts.root ?? process.cwd();
  // Repo-relative, like every path in an audit; a root the test file sits outside of (a scratch
  // directory) falls back to the runner's working directory rather than a `../..` chain.
  const rel = (p: string): string => {
    if (!isAbsolute(p)) return p;
    const fromRoot = relative(root, p);
    return fromRoot.startsWith("..") ? relative(process.cwd(), p) : fromRoot;
  };
  const test = ctx.testPath ? rel(ctx.testPath).split("\\").join("/") : undefined;
  const title = ctx.currentTestName;
  let id = opts.as;
  if (!id) {
    const stem = test ? basename(test).replace(/\.(test|spec)\.[cm]?[jt]sx?$|\.[cm]?[jt]sx?$/i, "") : "";
    const base = idSlug([stem, title].filter(Boolean).join(" ")) || "capture";
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    id = n === 1 ? base : `${base}-${n}`;
  }
  const env = domEnv(target);
  return {
    meta: {
      id,
      ...((opts.name ?? title) ? { name: opts.name ?? title } : {}),
      ...(opts.component ? { component: opts.component } : {}),
      ...(opts.source ? { source: opts.source } : {}),
      ...(test ? { test } : {}),
      runner,
      ...(env ? { env } : {}),
    },
    html,
  };
}

const CAPTURES = ".ultra11y/captures/";

/** The shared implementation, bound to a runner name ("vitest" | "jest"). */
export function createUnitIntegration(runner: string) {
  /** Capture the render, audit it, return the findings and the ones over the threshold. */
  function record(target: Renderable, opts: UnitCheckOptions, ctx?: TestContext): { result: AuditLike; failing: FindingLike[]; name: string } {
    const payload = capturePayload(target, opts, runner, ctx ?? currentTest());
    const result = auditCapture(payload, opts.root ? { root: opts.root } : {});
    const failOn = opts.failOn === undefined ? "blocking" : opts.failOn;
    const failing = failOn === false ? [] : failingFindings(result, failOn);
    return { result, failing, name: payload.meta.name ?? payload.meta.id };
  }

  /** Audit a rendered component; throws when a finding reaches `failOn`. Returns the audit. */
  async function checkA11y(target: Renderable, opts: UnitCheckOptions = {}): Promise<AuditLike> {
    const { result, failing, name } = record(target, opts);
    if (failing.length) throw new Error(formatFailure(name, failing, CAPTURES));
    return result;
  }

  /** The matcher: `expect.extend({ toBeAccessible })`, then `expect(container).toBeAccessible()`. */
  function toBeAccessible(this: (TestContext & { isNot?: boolean }) | undefined, received: Renderable, opts: UnitCheckOptions = {}) {
    const ctx: TestContext = this?.testPath || this?.currentTestName ? { testPath: this.testPath, currentTestName: this.currentTestName } : currentTest();
    const { failing, name } = record(received, opts, ctx);
    const pass = failing.length === 0;
    return {
      pass,
      message: () =>
        pass
          ? `ultra11y: expected "${name}" to carry a non-conformity at failOn "${opts.failOn ?? "blocking"}", and it carries none.`
          : formatFailure(name, failing, CAPTURES),
    };
  }

  return { checkA11y, toBeAccessible };
}

export type { AuditLike, FindingLike };

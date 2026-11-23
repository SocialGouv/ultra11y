/** Options of `checkA11y` and `toBeAccessible`. */
interface UnitCheckOptions {
    /** Capture id — the file stem under `.ultra11y/captures/`. Defaults to the test file's repo-relative path and title. */
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
type Renderable = string | NodeLike | {
    container: NodeLike;
};
interface NodeLike {
    nodeType?: number;
    outerHTML?: string;
    textContent?: string | null;
    data?: string;
    childNodes?: ArrayLike<NodeLike>;
    body?: NodeLike | null;
    innerHTML?: string;
    documentElement?: NodeLike | null;
    ownerDocument?: {
        defaultView?: {
            navigator?: {
                userAgent?: string;
            };
        } | null;
    } | null;
    defaultView?: {
        navigator?: {
            userAgent?: string;
        };
    } | null;
}
/** The running test, as the runner's own `expect` state reports it. Vitest installs its `expect`
 *  under `Symbol.for("expect-global")` whether or not globals are on; Jest exposes `expect`. */
interface TestContext {
    testPath?: string;
    currentTestName?: string;
}

export type { Renderable as R, TestContext as T, UnitCheckOptions as U };

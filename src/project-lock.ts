// Serialize work that touches one project root.
//
// `fix --write` rewrites source files and then RE-AUDITS them to prove it
// introduced no new non-conformity. An audit running concurrently reads that
// tree mid-rewrite and reports findings for a state that never existed. The
// handlers also chdir into the project so globs resolve the way the CLI
// resolves them, and process.cwd() is per-process, not per-call: two
// overlapping handlers would fight over it.
//
// The CLI never hit either problem because one process runs one command to
// completion. The MCP server can have several tool calls in flight at once.
//
// The fix is a promise chain per project root — the smallest thing that is
// actually correct. It is deliberately coarse: a `criteria` lookup needs no
// project at all and is dispatched before the lock, while different projects
// stay fully parallel.
const chains = new Map<string, Promise<unknown>>();

export function withProjectLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(dir) ?? Promise.resolve();
  // Chain off `prev` however it settled: a failed predecessor must not poison
  // every later call for the same repo.
  const next = prev.then(fn, fn);
  // The tail the NEXT caller waits on never rejects, so one thrown tool call
  // can't reject the whole queue behind it.
  const tail = next.then(noop, noop);
  chains.set(dir, tail);
  // Drop the entry once the tail is still us, so a long-lived server doesn't
  // accumulate a settled promise per repo it ever touched.
  tail.then(() => {
    if (chains.get(dir) === tail) chains.delete(dir);
  }, noop);
  return next;
}

function noop(): void {}

// Test seam: drop every pending chain. Never call this from product code — an
// in-flight lock holder would stop serializing against later arrivals.
export function resetProjectLocks(): void {
  chains.clear();
}

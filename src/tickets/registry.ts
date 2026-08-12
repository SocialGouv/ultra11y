// THE PROVIDER REGISTRY — a static map, deliberately NOT a runtime plugin registry.
//
// Standards packs get a runtime registry because a pack is DATA (a JSON file a country can
// drop in). A tracker provider is CODE: there is nowhere to put a plugin that a bundled,
// zero-dependency engine could load, and a `switch` over a closed union buys exhaustiveness
// checking from the compiler. Adding a tracker = one file plus one line here — the same
// shape src/install/index.ts uses for its harness targets.
import { createGithubProvider } from "./providers/github.js";
import { createGitlabProvider } from "./providers/gitlab.js";
import { createJiraProvider } from "./providers/jira.js";
import { providerFromRemote } from "./providers/remote.js";
import { ALL_PROVIDERS, type ProviderId, type TicketProvider, type TransportMode } from "./types.js";

export interface ResolveOptions {
  transport?: TransportMode;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function isProviderId(v: string): v is ProviderId {
  return (ALL_PROVIDERS as readonly string[]).includes(v);
}

/** Build the named provider. Throws on an unknown id — never silently falls back to GitHub. */
export function createProvider(id: ProviderId, opts: ResolveOptions = {}): TicketProvider {
  switch (id) {
    case "github":
      return createGithubProvider(opts);
    case "gitlab":
      return createGitlabProvider(opts);
    case "jira":
      return createJiraProvider(opts);
  }
}

/** `--provider auto`: an explicit env override, then the config's choice, then the git remote.
 *  Jira is never auto-detected — it owns no remote — so it must always be named. Returns
 *  undefined when nothing decides, and the CLI then asks for `--provider`. */
export function autoProvider(env: Record<string, string | undefined> = process.env, configured?: string): ProviderId | undefined {
  const fromEnv = env.ULTRA11Y_TICKET_PROVIDER;
  if (fromEnv && isProviderId(fromEnv)) return fromEnv;
  if (configured && isProviderId(configured)) return configured;
  return providerFromRemote();
}

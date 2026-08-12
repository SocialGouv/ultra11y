// Git remote detection — the last resort when CI did not tell us which project we are in.
//
// Deliberately narrow: it reads `remote.origin.url` and returns the `group/project` slug for
// a given host, or undefined. It never guesses across hosts (a GitHub remote must not resolve
// a GitLab project) and it never throws — outside a git checkout there simply is no remote.
import { execFileSync } from "node:child_process";

/** The raw `remote.origin.url`, or undefined outside a checkout / with no origin. */
export function originUrl(): string | undefined {
  try {
    const url = execFileSync("git", ["config", "--get", "remote.origin.url"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return url || undefined;
  } catch {
    return undefined;
  }
}

/** The `owner/repo` (or `group/subgroup/project`) slug of `origin`, when it points at `host`.
 *  Handles both SSH (`git@host:a/b.git`) and HTTPS (`https://host/a/b.git`) remotes, and any
 *  `host` suffix so a self-managed `gitlab.acme.com` matches `gitlab.`. */
export function gitRemoteSlug(host: string): string | undefined {
  const url = originUrl();
  if (!url) return undefined;
  const m = /^(?:git@|ssh:\/\/git@|https?:\/\/)(?:[^@/]*@)?([^:/]+)[:/](.+?)(?:\.git)?\/?$/.exec(url);
  if (!m) return undefined;
  const [, remoteHost, path] = m;
  if (!remoteHost || !path) return undefined;
  const matches = host.endsWith(".") ? remoteHost.startsWith(host) : remoteHost === host || remoteHost.endsWith(`.${host}`);
  return matches ? path : undefined;
}

/** Which provider this checkout's `origin` points at, for `--provider auto`. Jira is never
 *  returned: it owns no git remote, so it is always named explicitly. */
export function providerFromRemote(): "github" | "gitlab" | undefined {
  const url = originUrl();
  if (!url) return undefined;
  if (/github\.com|github\./i.test(url)) return "github";
  if (/gitlab\.com|gitlab\./i.test(url)) return "gitlab";
  return undefined;
}

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

describe("portable CI template", () => {
  const path = "skills/ultra11y/templates/gitlab-ci.yml";
  const raw = read(path);
  const doc = parse(raw) as {
    variables: Record<string, string>;
    "ultra11y:audit": { script: string[]; artifacts: { when: string } };
  };

  it("is valid YAML and defaults to an exhaustive, batched crawl", () => {
    expect(doc.variables.ULTRA11Y_CRAWL_MAX).toBe("0");
    expect(doc.variables.ULTRA11Y_GRAIN).toBe("batch");
    expect(doc["ultra11y:audit"].artifacts.when).toBe("always");
  });

  it("uses the selected standard at every document-producing phase", () => {
    expect(raw).toMatch(/audit \. --standard "\$ULTRA11Y_STANDARD"/);
    expect(raw).toMatch(/scan --crawl "\$ULTRA11Y_URL"[\s\S]*--standard "\$ULTRA11Y_STANDARD"/);
    expect(raw).toMatch(/report --in audits\/audit-latest\.json[\s\S]*--standard "\$ULTRA11Y_STANDARD"/);
  });

  it("re-gates the saved audit without mixing source paths with --in", () => {
    expect(raw).toContain('audit --in audits/audit-latest.json --standard "$ULTRA11Y_STANDARD" --fail-on bloquant');
    expect(raw).not.toMatch(/audit\s+\.\s+--in/);
  });

  it("pins the package version owned by this checkout", () => {
    const pkg = JSON.parse(read("package.json")) as { version: string };
    expect(doc.variables.ULTRA11Y_VERSION).toBe(pkg.version);
    expect(raw).toContain('"ultra11y@' + "$" + '{ULTRA11Y_VERSION}"');
  });
});

describe("GitHub workflow economy", () => {
  it("runs the ledger fixture through one unbounded scan", () => {
    const raw = read(".github/workflows/ci.yml");
    const job = raw.slice(raw.indexOf("  ledger-gate:"), raw.indexOf("\n  action:"));
    expect(job.match(/scan --crawl/g)).toHaveLength(1);
    expect(job).toContain("--max 0");
  });

  it("isolates every stateful composite-action scenario", () => {
    const raw = read(".github/workflows/ci.yml");
    for (const dir of ["code", "keyless", "pages", "browser", "coverage"]) {
      expect(raw).toContain(`working-directory: \${{ runner.temp }}/ultra11y-action-e2e/${dir}`);
    }
  });

  it("releases only after CI has validated the exact SHA", () => {
    const release = read(".github/workflows/release.yml");
    expect(release).toContain("workflow_run:");
    expect(release).toContain("github.event.workflow_run.head_sha");
    expect(release).not.toMatch(/^\s{2}push:/m);
    for (const workflow of ["standards-refresh.yml", "act-refresh.yml", "engine-repin.yml"]) {
      expect(read(`.github/workflows/${workflow}`)).not.toContain("gh workflow run release.yml");
    }
  });
});

import { defineConfig } from "vitest/config";

// The real-Codex smoke only (see vitest.config.ts for why it is excluded from the main run).
// Each case drives `codex exec` against a mock living in the test process; one at a time keeps
// the Codex homes and the mock's transcript of one case apart from the other's.
export default defineConfig({
  test: {
    include: ["tests/codex-smoke.e2e.test.ts"],
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 60_000,
  },
});

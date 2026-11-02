import { defineConfig } from "vitest/config";

// The real-OpenCode smoke only (see vitest.config.ts for why it is excluded from the main
// run). Each case boots an OpenCode server; one at a time keeps the ports, the CPU and the
// logs of one major apart from the other's.
export default defineConfig({
  test: {
    include: ["tests/opencode-smoke.e2e.test.ts"],
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 60_000,
  },
});

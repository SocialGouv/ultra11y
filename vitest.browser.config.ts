import { defineConfig } from "vitest/config";

// The real-browser tier only (see vitest.config.ts for why it is excluded from the main run).
// One fork, no parallelism: `checkA11y` writes its snapshot relative to the CURRENT DIRECTORY,
// so the test has to move there, and `process.chdir` is process-wide — sharing a worker with
// anything else moves the cwd out from under it.
export default defineConfig({
  test: {
    include: ["tests/browser-tier.e2e.test.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});

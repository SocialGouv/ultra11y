import { defineConfig } from "vitest/config";

// The perf-shape guard only (see vitest.config.ts for why it is excluded from the main
// run). Forced onto a single fork with no parallelism so both cost curves are measured
// under the same CPU conditions — the whole point of the comparison.
export default defineConfig({
  test: {
    include: ["tests/perf-shape.test.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
  },
});

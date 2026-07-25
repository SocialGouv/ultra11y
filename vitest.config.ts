import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Fixtures are sample HTML/JSX audited by the engine, and audits/ holds
    // generated reports — never collect tests from those trees.
    //
    // tests/perf-shape.test.ts is excluded here and run on its own (`pnpm run test:perf`,
    // wired into CI): it compares the SHAPE of two cost curves, and vitest's default
    // parallel file execution puts them under wildly different CPU contention, which turns
    // a real signal into a coin flip. Measuring timing needs the machine to itself.
    exclude: [...configDefaults.exclude, "tests/fixtures/**", "audits/**", "tests/perf-shape.test.ts"],
  },
});

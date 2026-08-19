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
    //
    // tests/browser-tier.e2e.test.ts is excluded for a different reason and run the same way
    // (`pnpm run test:browser`, its own CI job): it drives a real browser through `checkA11y`,
    // which writes its snapshot relative to the CURRENT DIRECTORY — so the test has to move
    // there, and `process.chdir` is process-wide. Run alongside the others it silently moved
    // the cwd out from under whichever file happened to share its worker, and the failures
    // landed somewhere else entirely (language resolution, which reads the repo it is in).
    exclude: [...configDefaults.exclude, "tests/fixtures/**", "audits/**", "tests/perf-shape.test.ts", "tests/browser-tier.e2e.test.ts"],
  },
});

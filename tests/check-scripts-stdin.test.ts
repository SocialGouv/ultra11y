import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The `--check` gates are run by CI and by agents from background shells, whose stdin is
// often a pipe nobody ever closes. A gate that reads that stdin, or hands it to a child that
// does, waits forever. Each one here is started with an OPEN stdin pipe that this test never
// writes to and never ends, and has to finish on its own, well inside the timeout.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const GATES = ["build-pack-rgaa.mjs", "build-standards.mjs", "build-guidance-wcag.mjs", "build-adjudication.mjs", "build-site.mjs"];
const LIMIT_MS = 60_000;

function runWithOpenStdin(script: string): Promise<{ code: number | null; timedOut: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(root, "scripts", script), "--check"], {
      cwd: root,
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, LIMIT_MS);
    child.on("exit", (code) => {
      clearTimeout(timer);
      child.stdin.destroy();
      resolve({ code, timedOut, stderr });
    });
  });
}

describe("check scripts never wait on stdin", () => {
  it.each(GATES)(
    "%s --check exits with stdin left open",
    async (script) => {
      const r = await runWithOpenStdin(script);
      expect(r.timedOut, `${script} --check was still running after ${LIMIT_MS} ms with stdin open`).toBe(false);
      expect(r.code, r.stderr).toBe(0);
    },
    LIMIT_MS + 10_000,
  );
});

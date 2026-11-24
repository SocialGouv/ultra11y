// DEV-ONLY helper shared by the build-*.mjs generators: format a generated text through the
// repo's biome, so a rebuild is byte-stable against the committed (biome-formatted) file.
// `relPath` (project-relative, e.g. "src/data/wcag.json") only picks the formatter; no file
// is read or written.
//
// The child's stdio is spelled out and bounded on purpose. These generators run as CI gates
// (`--check`) and from agents' background shells, whose stdin is often a pipe that nobody
// ever closes. The text goes in through a pipe of our own that is closed once written, the
// output comes back through pipes, and nothing is inherited from this process — so neither
// biome nor anything it starts can sit waiting on the caller's stdin, or hold one of the
// caller's streams open. The timeout turns any other stall into a loud failure instead of a
// job that never ends.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIOME_JS = join(root, "node_modules", "@biomejs", "biome", "bin", "biome");

export function biomeFormat(text, relPath) {
  return execFileSync(process.execPath, [BIOME_JS, "format", `--stdin-file-path=${relPath}`], {
    input: text,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
    timeout: 120_000,
    killSignal: "SIGKILL",
    cwd: root,
  });
}

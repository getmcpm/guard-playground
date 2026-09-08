// Shared core for build-engine.mjs and check-engine.mjs — the drift guard
// must build with EXACTLY the same steps as the real build, or a divergence
// between the two would let drift go undetected.
import { rmSync, writeFileSync, readFileSync, mkdirSync, mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as esbuild from "esbuild";

const ROOT = path.resolve(import.meta.dirname, "..");

// Hardcoded upstream source of truth — never read from the lockfile. A lock
// that also carried the repo URL could point buildEngine at an attacker- or
// mistake-controlled remote while still "matching" its own commit field.
// CLI_REPO stays available as a local-dev override (see README), but the
// commit-pin check below runs unconditionally regardless of override.
const CLI_REPO_URL = "https://github.com/getmcpm/cli.git";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
}

/**
 * Fetches the pinned cli tag and bundles engine.mjs + engine-meta.json into
 * `outDir`. Returns the meta object that was written.
 *
 * Fail-closed on the locked commit: a moved tag (or an overridden repo that
 * doesn't carry the pinned history) makes the build THROW rather than quietly
 * bundling whatever the tag now resolves to.
 */
export async function buildEngine(outDir, { lock: lockOverride } = {}) {
  const lock = lockOverride ?? JSON.parse(readFileSync(path.join(ROOT, "engine.lock.json"), "utf8"));
  const repo = process.env.CLI_REPO || CLI_REPO_URL;
  if (process.env.CLI_REPO) {
    console.warn(`⚠ CLI_REPO override active — fetching from ${repo} instead of ${CLI_REPO_URL}.`);
  }
  const tag = lock.cli.tag;

  const tmp = mkdtempSync(path.join(tmpdir(), "guard-playground-cli-src-"));
  try {
    console.log(`Fetching ${repo} @ ${tag} ...`);
    git(["init", "-q"], tmp);
    git(["remote", "add", "origin", repo], tmp);
    git(["fetch", "--depth", "1", "origin", tag], tmp);
    git(["checkout", "-q", "FETCH_HEAD"], tmp);
    const commit = git(["rev-parse", "HEAD"], tmp);

    if (commit !== lock.cli.commit) {
      throw new Error(
        `engine.lock.json pins cli commit ${lock.cli.commit} for tag ${tag}, but ${repo} @ ${tag} ` +
          `now resolves to ${commit}. The tag no longer points at the locked commit — investigate ` +
          "before re-pinning engine.lock.json (this is not something to silently re-lock and commit).",
      );
    }

    const guardDir = path.join(tmp, "src", "guard");
    const entryPath = path.join(guardDir, "_playground-entry.ts");
    writeFileSync(
      entryPath,
      [
        'export { inspectFrame } from "./inspect-frame.js";',
        "export {",
        "  owaspPinFor,",
        "  OWASP_MCP_TOP_10_REF,",
        "  OWASP_MCP_TOP_10_URL,",
        "  OWASP_MCP_TOP_10_TAXA,",
        '} from "./owasp.js";',
        'export { OWASP_MCP_TOP_10 as SIGNATURES } from "./signatures.js";',
        "",
      ].join("\n"),
    );

    // Byte-determinism across machines: esbuild writes each bundled module's
    // path RELATIVE TO absWorkingDir as a comment. Everything the bundle sees
    // must therefore live under one root — the checkout — including the shim
    // (copied in), and absWorkingDir must be that root, so the comments read
    // `src/guard/...` on every machine instead of a path through the tmpdir.
    const shimPath = path.join(tmp, "_buffer-shim.js");
    copyFileSync(path.join(ROOT, "scripts", "buffer-shim.js"), shimPath);

    mkdirSync(outDir, { recursive: true });
    await esbuild.build({
      absWorkingDir: tmp,
      entryPoints: [entryPath],
      outfile: path.join(outDir, "engine.mjs"),
      bundle: true,
      platform: "browser",
      format: "esm",
      target: "es2022",
      inject: [shimPath],
      logLevel: "info",
    });

    const meta = {
      package: "@getmcpm/cli",
      // package.json's own "version" field is a stale placeholder (CI derives
      // the real published version from the git tag at publish time). The
      // tag IS the version.
      version: tag.replace(/^v/, ""),
      tag,
      commit,
      builtAt: new Date().toISOString(),
    };
    writeFileSync(path.join(outDir, "engine-meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
    return meta;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export { ROOT };

// Review finding [HIGH]: buildEngine() must fail closed when the fetched cli
// tag resolves to a commit other than the one pinned in engine.lock.json — a
// moved tag (or a repo override that doesn't carry the pinned history) must
// never silently bundle whatever the tag happens to point at today.
//
// Source of the cli history, in order: an explicit CLI_REPO from the
// environment; else the maintainer's local read-only checkout when it exists
// (no network); else the public GitHub URL the build script defaults to —
// which is what CI uses, exactly as `npm run check:engine` does there. The
// tag v0.39.1 resolves to the same commit in every clone, so any of the three
// is a valid oracle; the test injects a deliberately wrong `commit` into the
// lock it passes to buildEngine and never touches engine.lock.json on disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildEngine } from "../scripts/lib-build-engine.mjs";

const LOCAL_CLI_CHECKOUT = "/Users/mingshum/repos/getmcpm/cli";
const LOCKED_COMMIT = "52d7d2b203901e77d769a457511bfe4a6647ba12";

/** Run `fn` with CLI_REPO pointing at the best available cli source, then restore the env. */
async function withCliSource(fn) {
  const previous = process.env.CLI_REPO;
  if (previous === undefined && existsSync(LOCAL_CLI_CHECKOUT)) process.env.CLI_REPO = LOCAL_CLI_CHECKOUT;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.CLI_REPO;
    else process.env.CLI_REPO = previous;
  }
}

test("buildEngine rejects when the tag resolves to a commit other than the locked one", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "guard-playground-lock-integrity-"));
  try {
    await withCliSource(() =>
      assert.rejects(
        () =>
          buildEngine(outDir, {
            lock: {
              cli: { tag: "v0.39.1", commit: "0000000000000000000000000000000000000000" },
              guardbench: { commit: "0".repeat(40) },
            },
          }),
        /no longer points at the locked commit/,
      ),
    );
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("buildEngine succeeds when the tag resolves to the locked commit (sanity check for the test above)", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "guard-playground-lock-integrity-ok-"));
  try {
    const meta = await withCliSource(() =>
      buildEngine(outDir, {
        lock: { cli: { tag: "v0.39.1", commit: LOCKED_COMMIT }, guardbench: { commit: "0".repeat(40) } },
      }),
    );
    assert.equal(meta.commit, LOCKED_COMMIT);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

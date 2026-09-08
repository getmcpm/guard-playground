// Review finding [HIGH]: buildEngine() must fail closed when the fetched cli
// tag resolves to a commit other than the one pinned in engine.lock.json — a
// moved tag (or a repo override that doesn't carry the pinned history) must
// never silently bundle whatever the tag happens to point at today.
//
// Uses the read-only local cli checkout via CLI_REPO (never modified — see
// README "Both build scripts default to the public GitHub repos... override")
// so this test needs no network and can inject a deliberately wrong `commit`
// into the lock without touching engine.lock.json on disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildEngine } from "../scripts/lib-build-engine.mjs";

const LOCAL_CLI_CHECKOUT = "/Users/mingshum/repos/getmcpm/cli";

test("buildEngine rejects when the tag resolves to a commit other than the locked one", async (t) => {
  if (process.env.CLI_REPO) t.skip("CLI_REPO already overridden by the environment; skipping to avoid confusion");

  const outDir = mkdtempSync(path.join(tmpdir(), "guard-playground-lock-integrity-"));
  const previousCliRepo = process.env.CLI_REPO;
  process.env.CLI_REPO = LOCAL_CLI_CHECKOUT;
  try {
    await assert.rejects(
      () =>
        buildEngine(outDir, {
          lock: {
            cli: { tag: "v0.39.1", commit: "0000000000000000000000000000000000000000" },
            guardbench: { commit: "0".repeat(40) },
          },
        }),
      /no longer points at the locked commit/,
    );
  } finally {
    if (previousCliRepo === undefined) delete process.env.CLI_REPO;
    else process.env.CLI_REPO = previousCliRepo;
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("buildEngine succeeds when the tag resolves to the locked commit (sanity check for the test above)", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "guard-playground-lock-integrity-ok-"));
  const previousCliRepo = process.env.CLI_REPO;
  process.env.CLI_REPO = LOCAL_CLI_CHECKOUT;
  try {
    const meta = await buildEngine(outDir, {
      lock: {
        cli: { tag: "v0.39.1", commit: "52d7d2b203901e77d769a457511bfe4a6647ba12" },
        guardbench: { commit: "0".repeat(40) },
      },
    });
    assert.equal(meta.commit, "52d7d2b203901e77d769a457511bfe4a6647ba12");
  } finally {
    if (previousCliRepo === undefined) delete process.env.CLI_REPO;
    else process.env.CLI_REPO = previousCliRepo;
    rmSync(outDir, { recursive: true, force: true });
  }
});

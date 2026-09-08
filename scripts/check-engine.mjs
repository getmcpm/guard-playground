#!/usr/bin/env node
// CI drift guard: rebuilds the engine into a scratch dir and byte-compares it
// against the committed site/engine.mjs. Exits 1 on drift (a stale bundle
// checked in after engine.lock.json or the cli tag moved on).
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildEngine, ROOT } from "./lib-build-engine.mjs";

const tmp = mkdtempSync(path.join(tmpdir(), "guard-playground-check-"));
try {
  const fresh = await buildEngine(tmp);

  const committedEnginePath = path.join(ROOT, "site", "engine.mjs");
  if (!existsSync(committedEnginePath)) {
    console.error("site/engine.mjs is missing — run `npm run build:engine` first.");
    process.exit(1);
  }
  const committedEngine = readFileSync(committedEnginePath, "utf8");
  const freshEngine = readFileSync(path.join(tmp, "engine.mjs"), "utf8");
  if (committedEngine !== freshEngine) {
    console.error("DRIFT: site/engine.mjs does not match a fresh build from engine.lock.json.");
    console.error("Run `npm run build:engine` and commit the result.");
    process.exit(1);
  }

  const committedMeta = JSON.parse(readFileSync(path.join(ROOT, "site", "engine-meta.json"), "utf8"));
  // builtAt is a timestamp, not part of the engine's identity — every other
  // field must match, or engine-meta.json is lying about what produced the
  // committed bundle.
  const { builtAt: _builtAt, ...committedIdentity } = committedMeta;
  const { builtAt: _freshBuiltAt, ...freshIdentity } = fresh;
  if (JSON.stringify(committedIdentity) !== JSON.stringify(freshIdentity)) {
    console.error("DRIFT: site/engine-meta.json does not match engine.lock.json.");
    console.error("committed:", committedIdentity);
    console.error("fresh:    ", freshIdentity);
    process.exit(1);
  }

  console.log(`OK — site/engine.mjs matches a fresh build of ${fresh.tag} @ ${fresh.commit.slice(0, 7)}.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

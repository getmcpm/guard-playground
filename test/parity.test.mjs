// Doctrine constraint 2 (docs/PLAN.md): "a parity test proves the bundle
// agrees with the PUBLISHED binary" — for every corpus case, inspectFrame()
// in the browser bundle must return the same action and the same set of
// signature_ids as `mcpm guard inspect --json` (the exact pinned
// @getmcpm/cli devDependency) on the same frame. Feeds the binary all 56
// frames as NDJSON in ONE process and zips verdicts back by position, mirroring
// mcp-guardbench's own adapters/mcpm/adapter.mjs positional-correlation contract.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { inspectFrame } from "../site/engine.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MCPM_BIN = path.join(ROOT, "node_modules", ".bin", "mcpm");

function runMcpmInspect(ndjson) {
  return new Promise((resolve, reject) => {
    const child = spawn(MCPM_BIN, ["guard", "inspect", "--json"], { cwd: ROOT, stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("error", reject);
    child.on("close", () => resolve(out));
    child.stdin.end(ndjson);
  });
}

let cases;
let verdicts;

before(async () => {
  cases = JSON.parse(readFileSync(path.join(ROOT, "site", "corpus.json"), "utf8"));
  const ndjson = `${cases.map((c) => JSON.stringify(c.message)).join("\n")}\n`;
  const stdout = await runMcpmInspect(ndjson);
  verdicts = stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
});

test("engine-meta.json matches engine.lock.json (minus builtAt)", () => {
  const lock = JSON.parse(readFileSync(path.join(ROOT, "engine.lock.json"), "utf8"));
  const meta = JSON.parse(readFileSync(path.join(ROOT, "site", "engine-meta.json"), "utf8"));
  assert.equal(meta.tag, lock.cli.tag);
  assert.equal(meta.commit, lock.cli.commit);
  assert.equal(meta.version, lock.cli.tag.replace(/^v/, ""));
});

test("mcpm produced one verdict per corpus case", () => {
  assert.equal(verdicts.length, cases.length);
});

test("bundle parity: every corpus case agrees with the published mcpm binary", () => {
  const mismatches = [];
  cases.forEach((kase, i) => {
    const binary = verdicts[i];
    const bundle = inspectFrame(kase.message);
    const binarySigs = new Set((binary.findings ?? []).map((f) => f.signature_id));
    const bundleSigs = new Set(bundle.findings.map((f) => f.signature_id));
    const sameSigs = binarySigs.size === bundleSigs.size && [...binarySigs].every((s) => bundleSigs.has(s));
    if (binary.action !== bundle.action || !sameSigs) {
      mismatches.push({
        id: kase.id,
        binary: { action: binary.action, signature_ids: [...binarySigs] },
        bundle: { action: bundle.action, signature_ids: [...bundleSigs] },
      });
    }
  });
  assert.equal(mismatches.length, 0, `parity mismatches:\n${JSON.stringify(mismatches, null, 2)}`);
});

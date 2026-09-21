// Doctrine constraint 2 (docs/PLAN.md): "a parity test proves the bundle
// agrees with the PUBLISHED binary" — for every corpus case, inspectFrame()
// in the browser bundle must return the same action and the same set of
// signature_ids as `mcpm guard inspect --json` (the exact pinned
// @getmcpm/cli devDependency) on the same frame. Feeds the binary all
// frames as NDJSON in ONE process and zips verdicts back by position, mirroring
// mcp-guardbench's own adapters/mcpm/adapter.mjs positional-correlation contract.
//
// Review finding [MED]: the corpus alone never exercises scripts/buffer-shim.js's
// install branch, because this test process already has Node's real Buffer
// global before site/engine.mjs is ever imported — so 0 of the corpus's frames
// reach the base64 decode-and-rescan path through anything but the real
// Buffer. test/extra-frames.ndjson adds frames that DO exercise that path, and
// a separate child process (test/helpers/no-buffer-runner.mjs) forces
// globalThis.Buffer to be undefined before importing the engine, so the
// shim's install branch actually runs — then every frame's verdict from that
// child process is compared against this process's real-Buffer verdict.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
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

function loadExtraFrames() {
  const raw = readFileSync(path.join(ROOT, "test", "extra-frames.ndjson"), "utf8");
  return raw
    .trim()
    .split("\n")
    .map((line, i) => ({ id: `extra-frame-${i}`, message: JSON.parse(line) }));
}

function signatureSet(findings) {
  return new Set((findings ?? []).map((f) => f.signature_id));
}

function sameSet(a, b) {
  return a.size === b.size && [...a].every((s) => b.has(s));
}

let cases; // corpus.json only — used by the engine-meta test
let allEntries; // corpus + test/extra-frames.ndjson, [{id, message}]
let verdicts; // mcpm binary verdicts, positionally aligned to allEntries

before(async () => {
  // Historical failure this guards against: from the v0.40.0 re-pin through
  // v0.42.0, engine.lock.json's cli.tag moved four times while package.json's
  // @getmcpm/cli devDependency stayed at 0.39.2, so every "parity against the
  // published binary" run below silently ran against 0.39.2 instead.
  const lockTag = JSON.parse(readFileSync(path.join(ROOT, "engine.lock.json"), "utf8")).cli.tag;
  const lockedVersion = lockTag.replace(/^v/, "");
  const installedVersion = spawnSync(MCPM_BIN, ["--version"], { encoding: "utf8" }).stdout.trim();
  if (installedVersion !== lockedVersion) {
    throw new Error(
      `installed @getmcpm/cli binary is ${installedVersion}, but engine.lock.json pins ${lockTag} — ` +
        `bump package.json's @getmcpm/cli devDependency to ${lockedVersion} and run npm install.`,
    );
  }

  cases = JSON.parse(readFileSync(path.join(ROOT, "site", "corpus.json"), "utf8"));
  const corpusEntries = cases.map((c) => ({ id: c.id, message: c.message }));
  allEntries = [...corpusEntries, ...loadExtraFrames()];

  const ndjson = `${allEntries.map((e) => JSON.stringify(e.message)).join("\n")}\n`;
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

test("mcpm produced one verdict per frame (corpus + extra-frames.ndjson)", () => {
  assert.equal(verdicts.length, allEntries.length);
});

test("bundle parity: every corpus + extra frame agrees with the published mcpm binary", () => {
  const mismatches = [];
  allEntries.forEach((entry, i) => {
    const binary = verdicts[i];
    const bundle = inspectFrame(entry.message);
    const binarySigs = signatureSet(binary.findings);
    const bundleSigs = signatureSet(bundle.findings);
    if (binary.action !== bundle.action || !sameSet(binarySigs, bundleSigs)) {
      mismatches.push({
        id: entry.id,
        binary: { action: binary.action, signature_ids: [...binarySigs] },
        bundle: { action: bundle.action, signature_ids: [...bundleSigs] },
      });
    }
  });
  assert.equal(mismatches.length, 0, `parity mismatches:\n${JSON.stringify(mismatches, null, 2)}`);
});

test("at least one extra frame's decoded base64 payload produces a decoded:true finding", () => {
  // Proves the base64 decode-and-rescan path (and therefore the Buffer
  // shim, exercised below) is actually reached by this test suite, not just
  // by the corpus's own frames (which never touch it — see file header).
  const decodedFindings = allEntries
    .flatMap((entry) => inspectFrame(entry.message).findings)
    .filter((f) => f.decoded === true);
  assert.ok(
    decodedFindings.length > 0,
    "expected at least one decoded:true finding across corpus + extra frames — " +
      "the base64 decode-and-rescan path was never exercised",
  );
});

test("buffer-shim parity: forcing globalThis.Buffer undefined before importing the engine matches the real-Buffer verdicts", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "guard-playground-no-buffer-"));
  try {
    const framesPath = path.join(tmp, "frames.json");
    writeFileSync(framesPath, JSON.stringify(allEntries.map((e) => e.message)));

    const result = spawnSync(
      process.execPath,
      [path.join(ROOT, "test", "helpers", "no-buffer-runner.mjs"), framesPath],
      { cwd: ROOT, encoding: "utf8" },
    );
    assert.equal(result.status, 0, `no-buffer-runner.mjs failed (exit ${result.status}):\n${result.stderr}`);

    const shimVerdicts = result.stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line));
    assert.equal(shimVerdicts.length, allEntries.length);

    const mismatches = [];
    allEntries.forEach((entry, i) => {
      const real = inspectFrame(entry.message); // this process: Node's real Buffer
      const shim = shimVerdicts[i]; // child process: buffer-shim.js installed
      const realSigs = [...signatureSet(real.findings)].sort();
      const shimSigs = [...signatureSet(shim.findings)].sort();
      const realDecodedExcerpts = real.findings
        .filter((f) => f.decoded === true)
        .map((f) => f.matched_text_excerpt)
        .sort();
      const shimDecodedExcerpts = (shim.findings ?? [])
        .filter((f) => f.decoded === true)
        .map((f) => f.matched_text_excerpt)
        .sort();
      const same =
        real.action === shim.action &&
        JSON.stringify(realSigs) === JSON.stringify(shimSigs) &&
        JSON.stringify(realDecodedExcerpts) === JSON.stringify(shimDecodedExcerpts);
      if (!same) {
        mismatches.push({
          id: entry.id,
          real: { action: real.action, signature_ids: realSigs, decoded_excerpts: realDecodedExcerpts },
          shim: { action: shim.action, signature_ids: shimSigs, decoded_excerpts: shimDecodedExcerpts },
        });
      }
    });
    assert.equal(mismatches.length, 0, `real-Buffer vs shim mismatches:\n${JSON.stringify(mismatches, null, 2)}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

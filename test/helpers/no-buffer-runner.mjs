// Runs site/engine.mjs's inspectFrame() in a process where globalThis.Buffer
// does NOT exist before the import — this forces scripts/buffer-shim.js's
// install branch to actually run, which never happens when the bundle is
// imported inside a normal Node test process (Node's real Buffer is already
// a global by then, so `typeof globalThis.Buffer === "undefined"` is false
// and the shim's guard skips installing).
//
// Reads a JSON array of frames from the file path in argv[2], writes one
// JSON verdict per line to stdout (same shape as inspectFrame's return
// value), and throws (nonzero exit) if the shim did not actually install —
// so a silent no-op here can't be mistaken for a passing comparison.
import { readFileSync } from "node:fs";

delete globalThis.Buffer;

const { inspectFrame } = await import("../../site/engine.mjs");

if (typeof globalThis.Buffer === "undefined") {
  throw new Error("buffer-shim did not install: globalThis.Buffer is still undefined after importing the engine");
}
if (typeof globalThis.Buffer.alloc === "function") {
  // Node's real Buffer has .alloc; the shim only ever defines { from }.
  throw new Error("globalThis.Buffer looks like Node's real Buffer, not the shim — this harness is broken");
}

const framesPath = process.argv[2];
const frames = JSON.parse(readFileSync(framesPath, "utf8"));
for (const frame of frames) {
  process.stdout.write(`${JSON.stringify(inspectFrame(frame))}\n`);
}

// docs/PLAN.md: site/frames.js must mirror @getmcpm/cli's inspect-cli.ts
// frame-splitting exactly: whole-parse first, NDJSON fallback, input order
// preserved, blank lines skipped, a bad line becomes an error entry, a
// top-level array (JSON-RPC batch) is rejected, and a `__proto__` key
// survives as an own property without throwing or polluting the prototype.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrames } from "../site/frames.js";

test("whole-input parse: a single pretty-printed frame", () => {
  const frames = parseFrames('{\n  "jsonrpc": "2.0",\n  "id": 1\n}\n');
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0], { frame: { jsonrpc: "2.0", id: 1 } });
});

test("NDJSON fallback: multiple frames, one per line, input order preserved", () => {
  const input = '{"jsonrpc":"2.0","id":1}\n{"jsonrpc":"2.0","id":2}\n{"jsonrpc":"2.0","id":3}\n';
  const frames = parseFrames(input);
  assert.equal(frames.length, 3);
  assert.deepEqual(
    frames.map((f) => f.frame.id),
    [1, 2, 3],
  );
});

test("blank lines are skipped, not treated as frames or errors", () => {
  const input = '{"jsonrpc":"2.0","id":1}\n\n   \n{"jsonrpc":"2.0","id":2}\n';
  const frames = parseFrames(input);
  assert.equal(frames.length, 2);
});

test("a bad NDJSON line becomes an error entry, not a thrown exception", () => {
  const input = '{"jsonrpc":"2.0","id":1}\nnot json\n{"jsonrpc":"2.0","id":2}\n';
  const frames = parseFrames(input);
  assert.equal(frames.length, 3);
  assert.ok("frame" in frames[0]);
  assert.ok("error" in frames[1]);
  assert.ok("frame" in frames[2]);
});

test("a top-level JSON-RPC batch array is rejected as an error", () => {
  const frames = parseFrames('[{"jsonrpc":"2.0","id":1},{"jsonrpc":"2.0","id":2}]');
  assert.equal(frames.length, 1);
  assert.ok("error" in frames[0]);
});

test("empty input yields zero frames", () => {
  assert.deepEqual(parseFrames(""), []);
  assert.deepEqual(parseFrames("   \n  "), []);
});

test("a __proto__ key survives as an own property and does not throw or pollute", () => {
  const frames = parseFrames('{"jsonrpc":"2.0","__proto__":{"polluted":true}}');
  assert.equal(frames.length, 1);
  const { frame } = frames[0];
  assert.equal(Object.hasOwn(frame, "__proto__"), true);
  assert.deepEqual(frame.__proto__, { polluted: true });
  // The real Object prototype must be untouched.
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.getPrototypeOf(frame), Object.prototype);
});

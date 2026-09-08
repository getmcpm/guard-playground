// Mirrors @getmcpm/cli's `parseFrames`/`asFrame` (src/guard/inspect-cli.ts)
// exactly, so this page's "one card per frame" behaviour matches
// `mcpm guard inspect --json` bit for bit. Pure, no DOM — importable from
// both site/app.js and test/ndjson.test.mjs.
//
// A parsed JSON object is passed straight through to the caller (which feeds
// it to inspectFrame) rather than spread-copied into a fresh object first:
// JSON.parse already creates an OWN `__proto__` property for that key (it
// does not set the prototype), so a `{"__proto__": {...}}` frame survives
// untouched and does not throw or pollute anything here.

/**
 * @typedef {{ frame: object }} ParsedOk
 * @typedef {{ error: string }} ParsedErr
 */

/**
 * A JSON-RPC frame must be a plain object. Arrays (JSON-RPC batches) are
 * rejected rather than silently mis-inspected.
 * @param {unknown} value
 * @returns {ParsedOk | ParsedErr}
 */
export function asFrame(value) {
  if (typeof value !== "object" || value === null) {
    return { error: `expected a JSON-RPC object, got ${value === null ? "null" : typeof value}` };
  }
  if (Array.isArray(value)) {
    return {
      error: "expected a single JSON-RPC object, got an array (send batch members as separate NDJSON lines)",
    };
  }
  return { frame: value };
}

/**
 * Split input into frames: a whole-input parse is tried FIRST so a
 * pretty-printed single frame works; NDJSON falls through to per-line
 * parsing. Blank lines are skipped. Input order is preserved.
 * @param {string} rawSource
 * @returns {ReadonlyArray<ParsedOk | ParsedErr>}
 */
export function parseFrames(rawSource) {
  const source = rawSource.replace(/^﻿/, "");
  if (source.trim() === "") return [];

  try {
    return [asFrame(JSON.parse(source))];
  } catch {
    // Not a single JSON document — treat as NDJSON.
  }

  const frames = [];
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      frames.push(asFrame(JSON.parse(trimmed)));
    } catch (err) {
      frames.push({ error: err instanceof Error ? err.message : String(err) });
    }
  }
  return frames;
}

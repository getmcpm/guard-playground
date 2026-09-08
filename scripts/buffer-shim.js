// Browser shim for the ONE Node global the bundled engine needs: `Buffer`.
// src/guard/patterns.ts calls `Buffer.from(std, "base64").toString("utf8")` in
// its decode-and-rescan path (F10 Detector-B). `std` has already had `-`/`_`
// swapped to `+`/`/` by the caller, but this shim also accepts raw base64url
// characters directly (matches Node's own leniency) since it is a general
// standalone replacement, not a call-site-specific one.
//
// Mimics Node's `Buffer.from(str, "base64")` decoder, measured directly
// against Node 24 (see test/buffer-shim.test.mjs):
//   - characters outside the base64(url) alphabet are IGNORED (skipped), not
//     an error — includes whitespace and arbitrary junk
//   - the FIRST `=` seen terminates scanning entirely; nothing after it
//     (valid or not) is consumed, even if it's a legal continuation
//   - the collected valid-character stream is decoded in groups of 4 (3
//     bytes each); a final partial group of 2 chars yields 1 byte, 3 chars
//     yields 2 bytes, 1 char yields 0 bytes (dropped — not enough bits)
//
// ponytail: manual alphabet loop, not `atob` — atob throws on inputs Node
// tolerates (junk, missing padding), which is exactly the leniency this path
// depends on.
const ALPHABET = new Int8Array(128).fill(-1);
{
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < chars.length; i++) ALPHABET[chars.charCodeAt(i)] = i;
  ALPHABET["-".charCodeAt(0)] = 62; // base64url alias for '+'
  ALPHABET["_".charCodeAt(0)] = 63; // base64url alias for '/'
}

function decodeBase64ToBytes(str) {
  const values = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 0x3d /* '=' */) break; // first '=' terminates the whole scan
    if (code < 128 && ALPHABET[code] !== -1) values.push(ALPHABET[code]);
    // else: junk/whitespace outside the alphabet — skip
  }

  const bytes = [];
  let i = 0;
  for (; i + 4 <= values.length; i += 4) {
    const [a, b, c, d] = [values[i], values[i + 1], values[i + 2], values[i + 3]];
    bytes.push((a << 2) | (b >> 4));
    bytes.push(((b & 0xf) << 4) | (c >> 2));
    bytes.push(((c & 0x3) << 6) | d);
  }
  const remainder = values.length - i;
  if (remainder === 2) {
    const [a, b] = [values[i], values[i + 1]];
    bytes.push((a << 2) | (b >> 4));
  } else if (remainder === 3) {
    const [a, b, c] = [values[i], values[i + 1], values[i + 2]];
    bytes.push((a << 2) | (b >> 4));
    bytes.push(((b & 0xf) << 4) | (c >> 2));
  }
  // remainder === 1 (or 0): dropped — not enough bits for a byte.
  return bytes;
}

class BufferShim {
  constructor(bytes) {
    this._bytes = bytes;
    this.length = bytes.length;
  }
  toString(encoding) {
    if (encoding !== "utf8" && encoding !== "utf-8") {
      throw new Error(`buffer-shim: unsupported encoding ${String(encoding)}`);
    }
    // Node's Buffer#toString("utf8") replaces invalid sequences with U+FFFD,
    // matching TextDecoder's default (fatal: false) behaviour exactly
    // (verified against Node 24 for overlong/truncated/stray-continuation
    // byte sequences — see test/buffer-shim.test.mjs).
    return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(this._bytes));
  }
}

export function from(str, encoding) {
  if (encoding !== "base64") throw new Error(`buffer-shim: unsupported encoding ${String(encoding)}`);
  return new BufferShim(decodeBase64ToBytes(str));
}

// Only define the global if it is not already present (Node test runner,
// or a future browser that ships one) — never shadow a real Buffer.
if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = { from };
}

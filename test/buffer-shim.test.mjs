// docs/PLAN.md: "A test compares the shim to Node's real Buffer.from on:
// valid, base64url, missing padding, embedded whitespace/junk, length%4==1,
// empty, '=' mid-string, multi-byte UTF-8, invalid UTF-8 bytes."
import { test } from "node:test";
import assert from "node:assert/strict";
import { from as shimFrom } from "../scripts/buffer-shim.js";

function compare(label, base64Str) {
  test(label, () => {
    const real = Buffer.from(base64Str, "base64");
    const shim = shimFrom(base64Str, "base64");
    assert.equal(shim.length, real.length, `${label}: byte length differs`);
    assert.equal(shim.toString("utf8"), real.toString("utf8"), `${label}: decoded text differs`);
  });
}

compare("valid, with padding", "aGVsbG8=");
compare("valid, no padding", "aGVsbG8");
compare("base64url characters, raw (unswapped -/_)", "aGVs-bG8_");
compare("missing padding on a 3-char remainder", "aGVsbG8x".slice(0, 7));
compare("embedded junk characters", "aGVs!!bG8=");
compare("embedded whitespace", "aGVs\n \tbG8=");
compare("length % 4 == 1", "QQQQQ");
compare("empty string", "");
compare("'=' appearing mid-string", "aGVs=bG8=");
compare("multi-byte UTF-8 (accents + CJK)", Buffer.from("héllo wörld 日本語", "utf8").toString("base64"));
compare("invalid UTF-8 byte sequence", Buffer.from([0xff, 0xfe, 0x41, 0xe2, 0x28, 0xa1]).toString("base64"));

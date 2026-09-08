// docs/PLAN.md doctrine constraint 4: pasted frames and corpus text are
// attacker-controlled, so site/app.js must render every string through
// textContent-safe DOM APIs only, never an HTML-parsing sink.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(ROOT, "site", "app.js"), "utf8");

const BANNED = ["innerHTML", "insertAdjacentHTML", "outerHTML", "document.write"];

for (const needle of BANNED) {
  test(`site/app.js does not contain ${needle}`, () => {
    assert.equal(source.includes(needle), false, `found forbidden sink "${needle}" in site/app.js`);
  });
}

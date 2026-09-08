// docs/PLAN.md doctrine constraint 4: pasted frames and corpus text are
// attacker-controlled, so every hand-written file under site/ must render
// strings through textContent-safe DOM APIs only, never an HTML-parsing or
// script-evaluating sink.
//
// Review finding [MED]: the previous version of this test grepped only
// site/app.js. An innerHTML sink added to site/frames.js (imported by
// app.js) or an inline event-handler attribute added to site/index.html
// stayed green. Now every site/**/*.js and site/**/*.html file is scanned,
// EXCEPT site/engine.mjs — the built bundle, whose four `new Function(`
// hits are inside its own source comments (from the vendored cli code), not
// live sinks in code this repo hand-writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_DIR = path.join(ROOT, "site");
const EXCLUDED = new Set([path.join(SITE_DIR, "engine.mjs")]);

function collectFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectFiles(full));
    } else if ((name.endsWith(".js") || name.endsWith(".html")) && !EXCLUDED.has(full)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = collectFiles(SITE_DIR);

// Sanity check: the scan must actually find the files we expect it to police
// (and stay in sync if a new file is added under site/).
test("the scan covers site/app.js, site/frames.js, and site/index.html", () => {
  const relative = FILES.map((f) => path.relative(SITE_DIR, f)).sort();
  assert.deepEqual(relative, ["app.js", "frames.js", "index.html"]);
});

// Sink needles that apply to both .js and .html files.
const COMMON_SINKS = [
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
  "setHTMLUnsafe",
  "createContextualFragment",
  "document.write",
  "document.writeln",
  "eval(",
  "new Function(",
  "srcdoc",
  "javascript:",
];

// A bare needle search for "on[a-z]+=" would false-positive on ordinary
// prose/attributes (e.g. "notification="), so this one is regex-anchored to
// an HTML attribute position and scoped to .html files only.
const INLINE_HANDLER_ATTR = /\bon[a-z]+\s*=/i;

for (const file of FILES) {
  const source = readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file);

  for (const needle of COMMON_SINKS) {
    test(`${rel} does not contain ${needle}`, () => {
      assert.equal(source.includes(needle), false, `found forbidden sink "${needle}" in ${rel}`);
    });
  }

  if (file.endsWith(".html")) {
    test(`${rel} does not contain an inline event-handler attribute (on*=)`, () => {
      assert.equal(INLINE_HANDLER_ATTR.test(source), false, `found an inline on*= handler attribute in ${rel}`);
    });
  }
}

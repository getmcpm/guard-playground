# PLAN — `getmcpm/guard-playground` (PoC)

**Decided 2026-09-09 (Fable).** A static, zero-backend web page that runs mcpm's real
stateless guard engine in the visitor's browser: paste an MCP JSON-RPC frame, see the
verdict, the findings, and the OWASP MCP Top 10 pin. Preloaded with the mcp-guardbench
corpus so the Deadbugz frames are one click away. Nothing pasted leaves the tab.

## Why this and not something else

The plan of record (vault: "Plan 2026-09-08 — five weeks to the kill review") found the
project has **zero exposure** — never announced anywhere — and that the one action that
can move three of four kill cells is a single distribution event anchored on the Deadbugz
reproducible test. Its stated bar for the anchor is "something a reader can run in five
minutes". A playground makes that thirty seconds and no install, and every reader who
tries to break it in the comments is inbound (a kill cell) plus a candidate corpus case.
It is the headroom lesson applied ("visible value", "guard output that shows what it
caught matters") without a new detector, a backend, telemetry or a competing static
scanner — all of which the plan forbids.

Considered and not chosen: a registry-wide trust index site (the 2026-07-12 sweep found
registry metadata is the wrong surface, 152/152 FPs; public per-server verdicts would
burn credibility); a PR-comment audit Action (needs org adoption, which needs exposure
first, and a `scan a config file` cli feature that does not exist); `mcpm scan <dir>` for
skills (explicitly gated behind the kill review's KILL branch).

## Doctrine constraints (each is a hard requirement)

1. **Static, local, silent.** GitHub Pages-deployable `site/` dir. No server, no
   analytics, no fonts/CDN, no fetch at runtime except same-origin JSON. `<meta
   http-equiv="Content-Security-Policy" content="default-src 'self'">`.
2. **The engine is built from a pinned cli tag, never hand-copied.** The v0.25.0
   decision log records why a vendored engine is poison (it drifts from what users run).
   Mitigations, all three: (a) `scripts/build-engine.mjs` shallow-clones
   `https://github.com/getmcpm/cli.git` at the tag in `engine.lock.json` (override with
   env `CLI_REPO` for a local path) and esbuilds `src/guard/inspect-frame.ts` +
   `src/guard/owasp.ts` + `src/guard/signatures.ts` for the browser into
   `site/engine.mjs`, stamping `site/engine-meta.json` = `{ package, version, tag, commit,
   builtAt }`; (b) `scripts/check-engine.mjs` rebuilds and byte-compares against the
   committed bundle (CI drift guard, exit 1 on drift); (c) a **parity test** proves the
   bundle agrees with the PUBLISHED binary: for every corpus case, `inspectFrame(msg)` in
   the bundle must return the same `action` and the same set of `signature_id`s as
   `node_modules/.bin/mcpm guard inspect --json` (the exact pinned version as a
   devDependency) on the same frame.
3. **A demo, not a score.** The page never publishes recall/FP numbers; it links to
   mcp-guardbench for scores. Copy on the page (use these sentences, they are checked
   for truth): "Runs entirely in your browser. Nothing you paste leaves this tab — there
   is no server, no analytics, no telemetry." · "Engine: the stateless detector set from
   @getmcpm/cli vX (commit abc1234), built from the tag. Single-frame verdicts with the
   catalog's default actions; no local policy applied. The same-session pin/drift
   defense — the part that catches a Deadbugz-style flip — needs the relay (`mcpm guard
   enable`) and is not in this page." · "This page is a demo, not a score. Scores come
   from mcp-guardbench, where every guard runs through its own published CLI."
4. **Untrusted input everywhere.** Pasted frames and corpus text are attacker-controlled.
   Render every string with `textContent` (never `innerHTML` / `insertAdjacentHTML` /
   `outerHTML`); a test greps `site/app.js` for those and fails if present. JSON parsing
   of a frame with `__proto__` keys must not throw or pollute (JSON.parse creates own
   properties; do not spread-copy into `{}` before inspecting — pass the parsed object
   straight to `inspectFrame`).

## Verified facts (Fable, 2026-09-09 — do not re-derive)

- Pins: cli tag **`v0.39.1` = `37aae7ef7b0bfb637194eab38ad6176e0f72515f`**; `src/guard`
  is byte-identical between that tag and `origin/main`. guardbench **`main` =
  `d2250f4bbb8f6781779410e2863a934474283bf0`** (corpus v5, 56 cases + `index.json`).
- The stateless engine bundles cleanly for the browser: esbuild 0.28.1,
  `--bundle --platform=browser --format=esm`, entry re-exporting `inspectFrame` from
  `src/guard/inspect-frame.ts`, `owaspPinFor` from `src/guard/owasp.ts`, `SIGNATURES`
  from `src/guard/signatures.ts` → 83 KB, no `node:` imports. Smoke: a poisoned
  `tools/list` → `block`/critical; a benign one → `pass`/0 findings.
- **One Node global is used: `Buffer`**, in `src/guard/patterns.ts` `decodeBase64Run`:
  `Buffer.from(std, "base64")`, then `.length` and `.toString("utf8")`. Without a shim the
  base64 decode-and-rescan path THROWS in the browser (verified). Provide
  `scripts/buffer-shim.js` via esbuild `--inject`, defining `globalThis.Buffer = { from }`
  ONLY if undefined, where `from(s,"base64")` mimics Node's lenient decoder: ignore
  characters outside `A-Za-z0-9+/`, stop at the first `=`, drop a dangling 6-bit
  remainder; return an object with `length` and `toString("utf8")` (use `TextDecoder`,
  non-fatal, same U+FFFD behaviour as Node). Do it as a manual alphabet loop, not
  `atob` (atob throws on the inputs Node tolerates). A test compares the shim to Node's
  real `Buffer.from` on: valid, base64url (`-`/`_` already swapped by the caller — but
  test raw too), missing padding, embedded whitespace/junk, length%4==1, empty, `=`
  mid-string, multi-byte UTF-8, invalid UTF-8 bytes.
- Finding shape (`src/guard/types.ts`): `InspectResult = { action: "pass"|"warn"|"block",
  findings: InspectFinding[], replyToOrigin? }`; `InspectFinding = { signature_id,
  category, severity: critical|high|medium|low, target, matched_text_excerpt,
  remediation, decoded? }`. `owaspPinFor(signature_id)` → `{ status:
  "pinned"|"unknown"|"unpinnable", id?, ref }` (ref = mapping commit `165fe0f7`; link it
  to `https://github.com/getmcpm/cli/blob/<ref>/docs/owasp-mcp-mapping.md`).
- `mcpm guard inspect --json` semantics to mirror (from `src/guard/inspect-cli.ts`):
  whole-input JSON parse first (so a pretty-printed frame works), else NDJSON one frame
  per non-blank line; one verdict per frame in INPUT ORDER; an unparseable or
  non-object frame yields `{action:"error"}` for that frame, never a silent skip; JSON-RPC
  batch arrays are rejected as an error verdict; exit code = worst action.
- guardbench case file: `{ id, bucket: attacks|warn|benign, name, category, expected:
  {action, signature_id?}, source, provenance, message }` in `cases/<bucket>/<id>.json`;
  `cases/index.json` lists them. The published result files in `out/` carry only
  aggregate metrics + `misses`/`abstained` arrays, not per-case verdicts for every case.
- Node: `@getmcpm/cli@0.39.1` declares `engines.node ^22.22.2 || ^24.15.0 || >=26.0.0`.
  The maintainer's default Node is OUTSIDE that range. In every shell command run:
  `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24 >/dev/null` (24.20.0 is
  installed). Shell state does not persist between commands.

## Scope of the PoC (build exactly this)

Repo at `/Users/mingshum/repos/getmcpm/guard-playground/` — `git init`, MIT, plain
HTML/CSS/vanilla-JS ES modules, **no framework**, devDependencies only: `esbuild`
(exact 0.28.1) and `@getmcpm/cli` (exact 0.39.1). Tests use Node's built-in `node --test`.

```
README.md  LICENSE  package.json  engine.lock.json
scripts/build-engine.mjs   scripts/buffer-shim.js   scripts/sync-corpus.mjs   scripts/check-engine.mjs
site/index.html  site/style.css  site/app.js  site/engine.mjs  site/engine-meta.json  site/corpus.json
test/parity.test.mjs  test/buffer-shim.test.mjs  test/no-innerhtml.test.mjs  test/ndjson.test.mjs
.github/workflows/pages.yml
docs/PLAN.md   (this file, verbatim)
```

`package.json` scripts: `build:engine`, `sync:corpus` (shallow-clone guardbench at the
locked commit, or `GUARDBENCH_REPO` local path; write `site/corpus.json` = the 56 cases
with `id,bucket,name,category,expected,source,provenance,message`, Deadbugz ids first),
`check:engine`, `test` (runs all four), `serve` (`python3 -m http.server 8080 -d site`).

UI (one page):
- Header: title "mcpm guard playground", the engine badge from `engine-meta.json`
  (version · tag · short commit, linking to the tag on GitHub), links to getmcpm/cli,
  mcp-guardbench, and the pinned OWASP mapping doc.
- Left: the corpus list grouped **Start here (Deadbugz)** / attacks / warn / benign, each
  row = name + expected action chip. Click → loads the frame into the editor and
  inspects it; shows `expected` vs `live` with ✓ match / ✗ **MISS** (state the miss
  plainly: "expected warn, got pass — a documented single-frame miss; see the case's
  source"). Show the case's `source` text under the result.
- Right: textarea (one frame or NDJSON), **Inspect** button, result panel: one card per
  frame in input order — action chip (pass/warn/block/error) and a findings table:
  signature_id, severity, target, OWASP (id + status; `unknown`/`unpinnable` shown as
  such, never blank), excerpt, remediation, `decoded` marker. Error verdicts show the
  parse error text.
- **Copy as CLI**: a code block with `npx --yes @getmcpm/cli@0.39.1 guard inspect --json`
  fed the current frame(s) via a heredoc, and a copy button.
- **Share**: writes `#f=<base64url(input)>` to the URL; on load, restores it. Cap 64 KB;
  above that show a note and skip.
- Auto-inspect on paste/typing with a 300 ms debounce is fine; keep the button too.
- `prefers-color-scheme` dark/light; usable at 375 px wide; no external assets.

Tests (must all pass; each must FAIL if its guard is removed — check that once):
1. `parity`: every corpus case through the bundle vs the pinned binary; assert same
   `action` and same set of `signature_id`s. Feed the binary NDJSON once (all 56 frames
   in one process) and zip by position.
2. `buffer-shim`: the equivalence set above vs real `Buffer.from`.
3. `no-innerhtml`: `site/app.js` contains none of `innerHTML`, `insertAdjacentHTML`,
   `outerHTML`, `document.write`.
4. `ndjson`: the page's frame-splitting function (export it from a small pure module the
   page imports, e.g. `site/frames.js`) mirrors inspect-cli: whole-parse first, NDJSON
   fallback, input order preserved, blank lines skipped, bad line → error entry, batch
   array → error, `__proto__` key survives as an own property and does not throw.

Also: `check:engine` exits 0 on the committed bundle; `engine-meta.json` matches
`engine.lock.json` (assert in the parity test's setup).

## Process

Commit locally with conventional-commit messages as you go; **do not push, do not
create a GitHub repo, do not touch the cli or guardbench working trees**. When done,
leave `npm test`, `npm run check:engine` and `npm run serve` all working from a clean
clone-equivalent (`rm -rf node_modules && npm ci`). Report: what was built, the test
output, anything skipped and why, and any place where the engine's browser behaviour
differed from the CLI (that is the finding that matters most).

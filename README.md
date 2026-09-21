# guard-playground

Paste an MCP JSON-RPC frame, see mcpm guard's real verdict — runs entirely in
your browser. No server, no analytics, no telemetry; nothing you paste leaves
the tab. Preloaded with the [mcp-guardbench](https://github.com/getmcpm/mcp-guardbench)
case corpus so the Deadbugz frames are one click away.

This page is a **demo, not a score**. For recall/false-positive numbers, see
mcp-guardbench, which scores every guard through its own published CLI.

The page is framable (the CSP meta tag can't set `frame-ancestors`; that
needs a real HTTP header) and shares the `getmcpm.github.io` origin with any
other getmcpm GitHub Pages project — both are properties of being hosted on
GitHub Pages, not choices this repo made.

See [`docs/PLAN.md`](docs/PLAN.md) for the full design, doctrine constraints,
and verified technical facts this repo was built against.

## How the engine gets here

The page never hand-copies mcpm's detection code. `scripts/build-engine.mjs`
shallow-clones [`getmcpm/cli`](https://github.com/getmcpm/cli) at the tag
pinned in `engine.lock.json`, and bundles the three stateless entry modules
(`inspect-frame.ts`, `owasp.ts`, `signatures.ts`) for the browser with
esbuild into `site/engine.mjs` + `site/engine-meta.json` — pulling in
everything those three import, 13 `src/guard/*` modules in total (run
`grep -c '^// src/' site/engine.mjs` to recount). `scripts/check-engine.mjs`
rebuilds into a scratch dir and byte-compares against the committed bundle —
CI's drift guard.

A parity test (`test/parity.test.mjs`) then proves the bundle isn't just "a
build that succeeded" but agrees with the **published binary**: it feeds
every corpus case to the pinned `@getmcpm/cli` devDependency via
`mcpm guard inspect --json` and asserts the bundle's `inspectFrame()` returns
the same action and the same set of `signature_id`s, case by case.

## Commands

```
npm ci
npm run build:engine   # rebuild site/engine.mjs from the pinned cli tag
npm run sync:corpus    # rebuild site/corpus.json from the pinned guardbench commit
npm run check:engine   # CI drift guard — fails if the committed bundle is stale
npm test                # parity, buffer-shim, no-innerhtml, ndjson
npm run serve           # http://localhost:8080
```

Both build scripts default to the public GitHub repos. For a local,
network-free run against sibling checkouts, override:

```
CLI_REPO=/path/to/getmcpm/cli npm run build:engine
GUARDBENCH_REPO=/path/to/getmcpm/mcp-guardbench npm run sync:corpus
```

## Re-pinning to a new cli release

1. Update `engine.lock.json` (`cli.tag` + `cli.commit`).
2. Bump the `@getmcpm/cli` devDependency in `package.json` to the same version and run `npm install`.
3. `npm run build:engine`.
4. `npm run sync:corpus` if guardbench moved (and update `guardbench.commit`).
5. Commit the bundle and lock together.

`npm test` now fails if the installed `mcpm` binary and `engine.lock.json`'s `cli.tag` disagree, so skipping step 2 is caught rather than silently comparing against the old binary.

## Layout

```
site/            the deployable static page (GitHub Pages root)
scripts/         build-engine, sync-corpus, check-engine, the Buffer shim
test/            node --test suite
engine.lock.json pins the cli tag + guardbench commit this repo builds from
```

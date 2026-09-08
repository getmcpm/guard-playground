#!/usr/bin/env node
// Builds site/engine.mjs from the pinned @getmcpm/cli tag in engine.lock.json —
// never hand-copied (see docs/PLAN.md, "The engine is built from a pinned cli
// tag, never hand-copied").
//
// Default source: the public GitHub repo, at the locked tag. Override with
// env CLI_REPO (a URL or a local filesystem path — `git fetch` treats both
// the same way) to build from a local checkout instead, e.g. for a
// network-free / faster local run.
import path from "node:path";
import { buildEngine, ROOT } from "./lib-build-engine.mjs";

const meta = await buildEngine(path.join(ROOT, "site"));
console.log(`Wrote site/engine.mjs + site/engine-meta.json (${meta.tag} @ ${meta.commit.slice(0, 7)})`);

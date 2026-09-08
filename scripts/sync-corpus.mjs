#!/usr/bin/env node
// Builds site/corpus.json from the pinned mcp-guardbench commit in
// engine.lock.json. Default source: the public GitHub repo. Override with env
// GUARDBENCH_REPO (a URL or local path) to sync from a local checkout instead.
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const lock = JSON.parse(readFileSync(path.join(ROOT, "engine.lock.json"), "utf8"));
const repo = process.env.GUARDBENCH_REPO || lock.guardbench.repo;
const commit = lock.guardbench.commit;

function git(args, cwd) {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
}

const tmp = mkdtempSync(path.join(tmpdir(), "guard-playground-guardbench-"));
try {
  console.log(`Fetching ${repo} @ ${commit} ...`);
  git(["init", "-q"], tmp);
  git(["remote", "add", "origin", repo], tmp);
  git(["fetch", "--depth", "1", "origin", commit], tmp);
  git(["checkout", "-q", "FETCH_HEAD"], tmp);
  const resolved = git(["rev-parse", "HEAD"], tmp);
  if (resolved !== commit) {
    throw new Error(`resolved commit ${resolved} != locked commit ${commit}`);
  }

  const cases = [];
  for (const bucket of ["attacks", "warn", "benign"]) {
    const dir = path.join(tmp, "cases", bucket);
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const kase = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
      cases.push({
        id: kase.id,
        bucket: kase.bucket,
        name: kase.name ?? null,
        category: kase.category ?? null,
        expected: kase.expected,
        source: kase.source ?? null,
        // Absent predates the field — case.schema.json's own documented
        // default (see schema/case.schema.json "provenance" description).
        provenance: kase.provenance ?? "extracted",
        message: kase.message,
      });
    }
  }

  // Deadbugz cases first (the plan's "Start here" group), original order
  // otherwise preserved.
  cases.sort((a, b) => Number(b.id.startsWith("deadbugz")) - Number(a.id.startsWith("deadbugz")));

  writeFileSync(path.join(ROOT, "site", "corpus.json"), `${JSON.stringify(cases, null, 2)}\n`);
  console.log(`Wrote site/corpus.json (${cases.length} cases, from ${repo} @ ${resolved.slice(0, 7)})`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

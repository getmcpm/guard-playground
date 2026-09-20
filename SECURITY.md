# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities through
[GitHub's private vulnerability reporting](https://github.com/getmcpm/guard-playground/security/advisories/new)
rather than opening a public issue. We aim to acknowledge a report within **48 hours**
and will coordinate a fix and disclosure timeline with you.

## Scope

**In scope:** the build pipeline (`scripts/build-engine.mjs`, `scripts/sync-corpus.mjs`)
and the static site (`site/`) — anything that could let a crafted input or a compromised
build step run unintended code, either at build time or in a visitor's browser.

**Not a vulnerability:** the playground lets a visitor paste an arbitrary MCP JSON-RPC
frame to see the guard's verdict on it, including deliberately malicious frames drawn
from the same corpus as `getmcpm/mcp-guardbench`. The whole point is to try attack
payloads against the engine; a payload producing an unexpected verdict is a detection
question, not a vulnerability in this site. Everything runs client-side in the
visitor's own browser — no server executes or stores what is pasted.

## Supported versions

This is a static site with no versioned releases; only `main` is supported.

## See also

[getmcpm/cli's `SECURITY.md`](https://github.com/getmcpm/cli/blob/main/SECURITY.md)
documents the disclosure process for the mcpm CLI itself, whose guard engine this
playground runs (pinned per `engine.lock.json`).

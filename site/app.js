// mcpm guard playground — vanilla ES modules, no framework, no build step for
// this file (only the engine bundle itself is built). All pasted/corpus text
// is attacker-controlled: every string below reaches the DOM only through
// `textContent` / `el()` (which itself only ever calls createElement,
// setAttribute, and appendChild/createTextNode) or `replaceChildren` with
// plain strings — never through an HTML-parsing sink.
import { inspectFrame, owaspPinFor, OWASP_MCP_TOP_10_URL } from "./engine.mjs";
import { parseFrames } from "./frames.js";

const CLI_REPO_URL = "https://github.com/getmcpm/cli";
const GUARDBENCH_URL = "https://github.com/getmcpm/mcp-guardbench";
const SHARE_LIMIT_BYTES = 64 * 1024;

/** Minimal safe element builder — never touches an HTML-parsing sink. */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) {
      if (typeof v !== "function") throw new TypeError(`el(): ${k} must be a function, never a string`);
      node.addEventListener(k.slice(2), v);
    } else node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function actionChip(action) {
  return el("span", { class: `chip chip-${action}` }, action);
}

function owaspCell(signatureId) {
  const pin = owaspPinFor(signatureId);
  if (pin.status === "pinned") {
    return el("a", { href: OWASP_MCP_TOP_10_URL, target: "_blank", rel: "noopener" }, pin.id);
  }
  // "unknown" / "unpinnable" — shown as such, never left blank.
  return el("span", {}, pin.status);
}

function findingsTable(findings) {
  if (findings.length === 0) return el("p", { class: "hint" }, "No findings.");
  const rows = findings.map((f) =>
    el("tr", {}, [
      el("td", {}, el("code", {}, f.signature_id)),
      el("td", {}, f.severity),
      el("td", {}, f.target),
      el("td", {}, owaspCell(f.signature_id)),
      el("td", {}, f.matched_text_excerpt),
      el("td", {}, f.remediation),
      el("td", {}, f.decoded === true ? "decoded" : "—"),
    ]),
  );
  return el("div", { class: "findings-scroll" }, [
    el("table", { class: "findings" }, [
      el(
        "thead",
        {},
        el("tr", {}, [
          el("th", {}, "Signature"),
          el("th", {}, "Severity"),
          el("th", {}, "Target"),
          el("th", {}, "OWASP"),
          el("th", {}, "Excerpt"),
          el("th", {}, "Remediation"),
          el("th", {}, "Decoded"),
        ]),
      ),
      el("tbody", {}, rows),
    ]),
  ]);
}

function frameCard(index, entry) {
  if ("error" in entry) {
    return el("div", { class: "frame-card" }, [
      el("h3", {}, [`frame ${index + 1}`, actionChip("error")]),
      el("p", { class: "error-text" }, entry.error),
    ]);
  }
  const result = inspectFrame(entry.frame);
  return el("div", { class: "frame-card" }, [
    el("h3", {}, [`frame ${index + 1}`, actionChip(result.action)]),
    findingsTable(result.findings),
  ]);
}

function cliSnippet(rawInput, version) {
  const body = rawInput.length === 0 ? "" : rawInput.endsWith("\n") ? rawInput : `${rawInput}\n`;
  return `npx --yes @getmcpm/cli@${version} guard inspect --json <<'EOF'\n${body}EOF`;
}

// ---- base64url share encoding (browser-native, no Buffer needed here) -----
function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(b64url) {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function main() {
  const [corpus, meta] = await Promise.all([
    fetch("corpus.json").then((r) => r.json()),
    fetch("engine-meta.json").then((r) => r.json()),
  ]);

  const engineBadge = document.getElementById("engine-badge");
  engineBadge.textContent = `Engine: ${meta.package}@${meta.version} · ${meta.tag} · ${meta.commit.slice(0, 7)}`;

  const headerLinks = document.getElementById("header-links");
  headerLinks.replaceChildren(
    el("a", { href: `${CLI_REPO_URL}/tree/${meta.tag}`, target: "_blank", rel: "noopener" }, "getmcpm/cli"),
    el("a", { href: GUARDBENCH_URL, target: "_blank", rel: "noopener" }, "mcp-guardbench"),
    el(
      "a",
      { href: `${CLI_REPO_URL}/blob/${meta.commit}/docs/owasp-mcp-mapping.md`, target: "_blank", rel: "noopener" },
      "OWASP MCP Top 10 mapping",
    ),
  );

  const textarea = document.getElementById("frame-input");
  const resultsEl = document.getElementById("results");
  const cliBlock = document.getElementById("cli-block");
  const shareNote = document.getElementById("share-note");
  const corpusListEl = document.getElementById("corpus-list");

  let activeRow = null;

  function clearActiveCase() {
    if (activeRow) {
      activeRow.classList.remove("active");
      activeRow = null;
    }
    const ctx = document.getElementById("case-context");
    if (ctx) ctx.remove();
  }

  function renderResults(rawText) {
    const frames = parseFrames(rawText);
    if (frames.length === 0) {
      resultsEl.replaceChildren(el("p", { class: "hint" }, "No frames — paste a JSON-RPC frame above."));
    } else {
      resultsEl.replaceChildren(...frames.map((entry, i) => frameCard(i, entry)));
    }
    cliBlock.textContent = cliSnippet(rawText, meta.version);
    return frames;
  }

  function runInspect() {
    renderResults(textarea.value);
  }

  function loadCase(kase, row) {
    clearActiveCase();
    activeRow = row;
    row.classList.add("active");

    textarea.value = JSON.stringify(kase.message, null, 2);
    const frames = renderResults(textarea.value);
    const live = "error" in frames[0] ? "error" : inspectFrame(frames[0].frame).action;
    const expected = kase.expected.action;
    const isMatch = live === expected;
    // Three honest outcomes: exact match; flagged at a weaker action than the corpus
    // expects (not a miss — the guard saw it); or not flagged at all (a miss). Every
    // one is reproducible with the CLI command at the bottom of the page.
    const bannerText = isMatch
      ? `✓ match — expected ${expected}, got ${live}.`
      : live === "pass"
        ? `✗ MISS — expected ${expected}, got pass: this engine version does not flag this frame. Reproduce it with the CLI command below.`
        : `△ flagged as ${live}, expected ${expected}: detected, but at a weaker action than the corpus expects. Reproduce it with the CLI command below.`;
    const banner = el("p", { class: `match-banner ${isMatch ? "match" : live === "pass" ? "miss" : "weaker"}` }, bannerText);
    const source = el("p", { class: "case-source", id: "case-context" }, [
      banner,
      kase.source ? el("span", {}, kase.source) : el("span", { class: "hint" }, "No source recorded."),
    ]);
    resultsEl.before(source);
  }

  function corpusRow(kase) {
    const row = el(
      "button",
      { type: "button", class: "corpus-row", onclick: () => loadCase(kase, row) },
      [el("span", { class: "name" }, kase.name || kase.id), actionChip(kase.expected.action)],
    );
    return row;
  }

  function corpusGroup(title, cases) {
    if (cases.length === 0) return null;
    return el("div", { class: "corpus-group" }, [el("h3", {}, title), ...cases.map(corpusRow)]);
  }

  const deadbugz = corpus.filter((c) => c.id.startsWith("deadbugz"));
  const rest = corpus.filter((c) => !c.id.startsWith("deadbugz"));
  const byBucket = (bucket) => rest.filter((c) => c.bucket === bucket);
  corpusListEl.replaceChildren(
    ...[
      corpusGroup("Start here (Deadbugz)", deadbugz),
      corpusGroup("Attacks", byBucket("attacks")),
      corpusGroup("Warn", byBucket("warn")),
      corpusGroup("Benign", byBucket("benign")),
    ].filter((g) => g !== null),
  );

  // ---- inspector wiring -----------------------------------------------
  let debounceHandle = null;
  textarea.addEventListener("input", () => {
    clearActiveCase();
    if (debounceHandle !== null) clearTimeout(debounceHandle);
    debounceHandle = setTimeout(runInspect, 300);
  });
  document.getElementById("inspect-btn").addEventListener("click", () => {
    if (debounceHandle !== null) clearTimeout(debounceHandle);
    runInspect();
  });

  document.getElementById("share-btn").addEventListener("click", () => {
    const bytes = new TextEncoder().encode(textarea.value).length;
    if (bytes > SHARE_LIMIT_BYTES) {
      shareNote.hidden = false;
      shareNote.textContent = `Too large to share (${bytes} bytes > 64 KB) — link not updated.`;
      return;
    }
    location.hash = `f=${toBase64Url(textarea.value)}`;
    shareNote.hidden = false;
    shareNote.textContent = "Shareable link updated — copy it from the address bar.";
  });

  const copyBtn = document.getElementById("copy-cli-btn");
  const copyNote = document.getElementById("copy-cli-note");
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(cliBlock.textContent);
      copyNote.hidden = false;
      copyNote.textContent = "Copied.";
    } catch {
      copyNote.hidden = false;
      copyNote.textContent = "Could not copy automatically — select the text and copy manually.";
    }
  });

  // ---- restore from a shared link, if present --------------------------
  if (location.hash.startsWith("#f=")) {
    try {
      textarea.value = fromBase64Url(location.hash.slice(3));
      runInspect();
    } catch {
      resultsEl.replaceChildren(el("p", { class: "hint" }, "Could not decode the shared link."));
    }
  } else {
    runInspect();
  }
}

main().catch((err) => {
  document.getElementById("results").replaceChildren(
    el("p", { class: "error-text" }, `Failed to load the engine or corpus: ${err.message}`),
  );
});

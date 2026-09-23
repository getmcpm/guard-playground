// _buffer-shim.js
var ALPHABET = new Int8Array(128).fill(-1);
{
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < chars.length; i++) ALPHABET[chars.charCodeAt(i)] = i;
  ALPHABET["-".charCodeAt(0)] = 62;
  ALPHABET["_".charCodeAt(0)] = 63;
}
function decodeBase64ToBytes(str) {
  const values = [];
  for (let i2 = 0; i2 < str.length; i2++) {
    const code = str.charCodeAt(i2);
    if (code === 61) break;
    if (code < 128 && ALPHABET[code] !== -1) values.push(ALPHABET[code]);
  }
  const bytes = [];
  let i = 0;
  for (; i + 4 <= values.length; i += 4) {
    const [a, b, c, d] = [values[i], values[i + 1], values[i + 2], values[i + 3]];
    bytes.push(a << 2 | b >> 4);
    bytes.push((b & 15) << 4 | c >> 2);
    bytes.push((c & 3) << 6 | d);
  }
  const remainder = values.length - i;
  if (remainder === 2) {
    const [a, b] = [values[i], values[i + 1]];
    bytes.push(a << 2 | b >> 4);
  } else if (remainder === 3) {
    const [a, b, c] = [values[i], values[i + 1], values[i + 2]];
    bytes.push(a << 2 | b >> 4);
    bytes.push((b & 15) << 4 | c >> 2);
  }
  return bytes;
}
var BufferShim = class {
  constructor(bytes) {
    this._bytes = bytes;
    this.length = bytes.length;
  }
  toString(encoding) {
    if (encoding !== "utf8" && encoding !== "utf-8") {
      throw new Error(`buffer-shim: unsupported encoding ${String(encoding)}`);
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(this._bytes));
  }
};
function from(str, encoding) {
  if (encoding !== "base64") throw new Error(`buffer-shim: unsupported encoding ${String(encoding)}`);
  return new BufferShim(decodeBase64ToBytes(str));
}
if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = { from };
}

// src/guard/patterns.ts
var MAX_LEAF_WALK_NODES = 1e5;
function* stringLeaves(node, budget) {
  const stack = [node];
  let visited = 0;
  while (stack.length > 0) {
    if (++visited > MAX_LEAF_WALK_NODES) {
      if (budget !== void 0) budget.exhausted = true;
      return;
    }
    const current = stack.pop();
    if (typeof current === "string") {
      yield current;
      continue;
    }
    if (Array.isArray(current)) {
      for (let i = current.length - 1; i >= 0; i--) stack.push(current[i]);
      continue;
    }
    if (current !== null && typeof current === "object") {
      const values = Object.values(current);
      for (let i = values.length - 1; i >= 0; i--) stack.push(values[i]);
    }
  }
}
function unhandledTarget(_) {
  return null;
}
function objectElements(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((e) => typeof e === "object" && e !== null);
}
function targetSubtree(msg, target) {
  switch (target) {
    case "tool_response": {
      const error = msg.error ?? null;
      if ("result" in msg) {
        const result = msg.result;
        return [result?.content ?? null, result?.structuredContent ?? null, error];
      }
      return error;
    }
    case "tool_call_args": {
      if ("method" in msg && msg.method === "tools/call" && "params" in msg) {
        const params = msg.params;
        return params?.arguments ?? null;
      }
      return null;
    }
    case "tool_description": {
      if ("result" in msg) {
        const tools = msg.result?.tools;
        if (!tools) return null;
        return objectElements(tools).map((t) => [t.description ?? "", t.title ?? "", t.inputSchema ?? null]);
      }
      return null;
    }
    case "tool_annotations": {
      if ("result" in msg) {
        const tools = msg.result?.tools;
        if (!tools) return null;
        return objectElements(tools).map((t) => t.annotations ?? null);
      }
      return null;
    }
    case "resource_content": {
      if ("result" in msg) {
        const contents = msg.result?.contents;
        if (!Array.isArray(contents)) return null;
        return objectElements(contents).map((c) => c.text ?? null);
      }
      return null;
    }
    case "prompt_content": {
      if ("result" in msg) {
        const messages = msg.result?.messages;
        if (!Array.isArray(messages)) return null;
        return objectElements(messages).map((m) => m.content ?? null);
      }
      return null;
    }
    case "initialize_instructions": {
      if ("result" in msg) {
        const result = msg.result;
        if (typeof result?.protocolVersion !== "string") return null;
        return [result.instructions ?? null, result.serverInfo ?? null];
      }
      return null;
    }
    case "sampling_prompt":
      return null;
    default:
      return unhandledTarget(target);
  }
}
var MAX_EXCERPT = 200;
function truncate(s) {
  return s.length > MAX_EXCERPT ? `${s.slice(0, MAX_EXCERPT)}\u2026` : s;
}
function worstAction(findings) {
  return findings.reduce((acc, f) => {
    const a = defaultActionForFinding(f);
    return ACTION_RANK[a] > ACTION_RANK[acc] ? a : acc;
  }, "pass");
}
function redactSecret(s) {
  return `\u2039redacted ${s.length}-char secret\u203A`;
}
var MATCH_SEGMENT_CAP = 32 * 1024;
var PATTERN_BREAKERS = /[­​-‏‪-‮⁠-⁯﻿]|[\u{E0000}-\u{E007F}]/gu;
var CONFUSABLES = {
  // ── Cyrillic → Latin ──
  "\u0430": "a",
  "\u0410": "A",
  // а А
  "\u0435": "e",
  "\u0415": "E",
  // е Е
  "\u043E": "o",
  "\u041E": "O",
  // о О
  "\u0440": "p",
  "\u0420": "P",
  // р Р
  "\u0441": "c",
  "\u0421": "C",
  // с С
  "\u0443": "y",
  "\u0423": "Y",
  // у У
  "\u0445": "x",
  "\u0425": "X",
  // х Х
  "\u0456": "i",
  "\u0406": "I",
  // і І
  "\u0458": "j",
  "\u0408": "J",
  // ј Ј
  "\u0501": "d",
  // ԁ
  "\u051B": "q",
  // ԛ
  "\u0455": "s",
  "\u0405": "S",
  // ѕ Ѕ
  "\u04BB": "h",
  // һ
  // ── Greek → Latin ──
  "\u03BF": "o",
  "\u039F": "O",
  // ο Ο
  "\u03B1": "a",
  "\u0391": "A",
  // α Α
  "\u03B5": "e",
  "\u0395": "E",
  // ε Ε
  "\u03B9": "i",
  "\u0399": "I",
  // ι Ι
  "\u03BD": "v",
  "\u039D": "N",
  // ν Ν
  "\u03C1": "p",
  "\u03A1": "P",
  // ρ Ρ
  "\u03C4": "t",
  "\u03A4": "T",
  // τ Τ
  "\u03C5": "u",
  "\u03A5": "Y",
  // υ Υ
  "\u03C7": "x",
  "\u03A7": "X",
  // χ Χ
  "\u03BA": "k",
  "\u039A": "K",
  // κ Κ
  "\u03B7": "n",
  "\u0397": "H"
  // η Η
};
function foldConfusables(s) {
  let out = "";
  for (const ch of s) out += CONFUSABLES[ch] ?? ch;
  return out;
}
function normalizeSegment(segment) {
  return foldConfusables(segment.normalize("NFKC").replace(PATTERN_BREAKERS, ""));
}
var WINDOW_SEAM = "\0".repeat(48);
function normalizeForMatch(leaf) {
  if (leaf.length <= MATCH_SEGMENT_CAP) {
    return normalizeSegment(leaf);
  }
  const head = normalizeSegment(leaf.slice(0, MATCH_SEGMENT_CAP));
  const tail = normalizeSegment(leaf.slice(-MATCH_SEGMENT_CAP));
  return `${head}${WINDOW_SEAM}${tail}`;
}
var LEADING_ANCHOR = "(?:^|[\\s.,;:!?])";
var relaxedPatterns = /* @__PURE__ */ new Map();
function relaxLeadingAnchor(pattern) {
  const cached = relaxedPatterns.get(pattern);
  if (cached !== void 0) return cached;
  const relaxed = pattern.source.startsWith(LEADING_ANCHOR) ? new RegExp(pattern.source.slice(LEADING_ANCHOR.length), pattern.flags) : pattern;
  relaxedPatterns.set(pattern, relaxed);
  return relaxed;
}
function findingKey(f) {
  return `${f.signature_id}\0${f.matched_text_excerpt.replace("\u2039decoded:unicode-tag\u203A ", "")}`;
}
var MAX_COUNTED_MATCHES = 1e5;
var CONCEALMENT_MASK = "\0";
var relaxedGlobalPatterns = /* @__PURE__ */ new Map();
function relaxedGlobal(pattern) {
  const cached = relaxedGlobalPatterns.get(pattern);
  if (cached !== void 0) return cached;
  const relaxed = relaxLeadingAnchor(pattern);
  const global = relaxed.flags.includes("g") ? relaxed : new RegExp(relaxed.source, `${relaxed.flags}g`);
  relaxedGlobalPatterns.set(pattern, global);
  return global;
}
function countOccurrences(leaf, signatures, target) {
  const normalized = normalizeForMatch(leaf);
  const counts = /* @__PURE__ */ new Map();
  for (const sig of signatures) {
    if (sig.target !== target) continue;
    for (const rawPattern of sig.patterns) {
      const pattern = relaxedGlobal(rawPattern);
      pattern.lastIndex = 0;
      let seen = 0;
      let match;
      while ((match = pattern.exec(normalized)) !== null) {
        const key = `${sig.id}\0${match[0]}`;
        const prev = counts.get(key);
        if (prev === void 0) {
          counts.set(key, { count: 1, sig, text: match[0] });
        } else {
          prev.count++;
        }
        pattern.lastIndex = match.index + 1;
        if (++seen >= MAX_COUNTED_MATCHES) break;
      }
    }
  }
  return counts;
}
function concealmentSurplus(decoded, masked) {
  const surplus = [];
  for (const [key, entry] of decoded) {
    if (entry.count > (masked.get(key)?.count ?? 0)) surplus.push(entry);
  }
  return surplus;
}
function inspectAgainstSignatures(leaf, signatures, target) {
  const normalized = normalizeForMatch(leaf);
  const findings = [];
  for (const sig of signatures) {
    if (sig.target !== target) continue;
    for (const rawPattern of sig.patterns) {
      rawPattern.lastIndex = 0;
      const match = rawPattern.exec(normalized);
      if (match) {
        findings.push({
          signature_id: sig.id,
          category: sig.category,
          severity: sig.severity,
          target: sig.target,
          matched_text_excerpt: sig.redact ? redactSecret(match[0]) : truncate(match[0]),
          remediation: sig.remediation
        });
        break;
      }
    }
  }
  return findings;
}
var HIDDEN_CHAR_TARGETS = /* @__PURE__ */ new Set([
  "tool_description",
  "tool_annotations",
  // initialize.instructions is block-capable PRE-INVOCATION context (H1). An
  // invisible separator embedded there to obfuscate keywords would otherwise go
  // unreported, so it's in scope. resource_content / prompt_content stay OUT of
  // scope — invisible chars in fetched files/emails are common and benign. (H2)
  "initialize_instructions"
]);
var HIDDEN_CHAR_CLASS = /[\u200b-\u200f\u2060-\u2064\ufeff\u00ad\u202a-\u202e\u2066-\u2069]|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|[\u0080-\u009f]|[\u{E0000}-\u{E007F}]/gu;
function classifyHiddenChar(ch) {
  const cp = ch.codePointAt(0) ?? 0;
  const hex = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
  let kind;
  if (cp === 27) kind = "ANSI-ESC";
  else if (cp === 65279 || cp === 8288) kind = "zero-width";
  else if (cp === 8203 || cp === 8204 || cp === 8205) kind = "zero-width";
  else if (cp >= 8289 && cp <= 8292) kind = "invisible-math";
  else if (cp === 173) kind = "soft-hyphen";
  else if (cp === 8206 || cp === 8207) kind = "bidi-control";
  else if (cp >= 8234 && cp <= 8238 || cp >= 8294 && cp <= 8297) kind = "bidi-control";
  else if (cp >= 917504 && cp <= 917631) kind = "unicode-tag";
  else if (cp >= 128 && cp <= 159) kind = "C1-control";
  else kind = "control";
  return `${kind} (${hex})`;
}
var TAG_CHAR_CLASS = /[\u{E0000}-\u{E007F}]/gu;
var RGI_TAG_SEQUENCE_BODIES = /* @__PURE__ */ new Set(["gbeng", "gbsct", "gbwls"]);
var EMOJI_TAG_SEQUENCE = /\u{1F3F4}\u{FE0F}?[\u{E0020}-\u{E007E}]{1,32}\u{E007F}/gu;
function tagToAscii(cp) {
  return cp >= 917536 && cp <= 917630 ? String.fromCharCode(cp - 917504) : "";
}
function rgiTagSequenceMask(s) {
  let mask = null;
  EMOJI_TAG_SEQUENCE.lastIndex = 0;
  for (let m = EMOJI_TAG_SEQUENCE.exec(s); m !== null; m = EMOJI_TAG_SEQUENCE.exec(s)) {
    let body = "";
    for (const ch of m[0]) body += tagToAscii(ch.codePointAt(0) ?? 0);
    if (!RGI_TAG_SEQUENCE_BODIES.has(body)) continue;
    mask ??= new Uint8Array(s.length);
    mask.fill(1, m.index, m.index + m[0].length);
  }
  return mask;
}
function isSkipped(mask, index) {
  return mask !== null && mask[index] === 1;
}
function hasTagChar(s) {
  TAG_CHAR_CLASS.lastIndex = 0;
  return TAG_CHAR_CLASS.test(s);
}
function scanWindow(leaf) {
  return leaf.length <= MATCH_SEGMENT_CAP * 2 ? leaf : leaf.slice(0, MATCH_SEGMENT_CAP) + leaf.slice(-MATCH_SEGMENT_CAP);
}
function matchWindow(leaf) {
  return leaf.length <= MATCH_SEGMENT_CAP * 2 ? leaf : `${leaf.slice(0, MATCH_SEGMENT_CAP)}${WINDOW_SEAM}${leaf.slice(-MATCH_SEGMENT_CAP)}`;
}
function isEmojiJoinComponent(cp) {
  if (cp === void 0) return false;
  if (cp === 65039) return true;
  if (cp >= 127995 && cp <= 127999) return true;
  return /\p{Extended_Pictographic}/u.test(String.fromCodePoint(cp));
}
function detectHiddenChars(leaf, target) {
  const scanned = scanWindow(leaf);
  let tagSkip;
  HIDDEN_CHAR_CLASS.lastIndex = 0;
  for (let m = HIDDEN_CHAR_CLASS.exec(scanned); m !== null; m = HIDDEN_CHAR_CLASS.exec(scanned)) {
    if (m[0].codePointAt(0) === 8205) {
      const before = codePointBefore(scanned, m.index);
      const after = scanned.codePointAt(m.index + 1);
      if (isEmojiJoinComponent(before) && isEmojiJoinComponent(after)) continue;
    }
    const cp = m[0].codePointAt(0) ?? 0;
    if (cp >= 917504 && cp <= 917631) {
      if (tagSkip === void 0) tagSkip = rgiTagSequenceMask(scanned);
      if (isSkipped(tagSkip, m.index)) continue;
    }
    return [
      {
        signature_id: "hidden-chars-in-metadata",
        category: "OWASP-MCP-1",
        severity: "high",
        target,
        matched_text_excerpt: `${classifyHiddenChar(m[0])} in ${target}`,
        remediation: "Tool metadata contains invisible/control characters that hide content from human review (tool-poisoning indicator). Inspect the server's source; if legitimate (rare), mute via `mcpm guard mute hidden-chars-in-metadata`."
      }
    ];
  }
  return [];
}
function codePointBefore(s, index) {
  if (index <= 0) return void 0;
  const prev = s.charCodeAt(index - 1);
  if (prev >= 56320 && prev <= 57343 && index >= 2) {
    return s.codePointAt(index - 2);
  }
  return prev;
}
function detectTagConcealment(leaf, target) {
  const scanned = scanWindow(leaf);
  if (!hasTagChar(scanned)) return [];
  const skip = rgiTagSequenceMask(scanned);
  TAG_CHAR_CLASS.lastIndex = 0;
  for (let m = TAG_CHAR_CLASS.exec(scanned); m !== null; m = TAG_CHAR_CLASS.exec(scanned)) {
    if (isSkipped(skip, m.index)) continue;
    return [
      {
        signature_id: "unicode-tag-concealment",
        category: "OWASP-MCP-1",
        severity: "high",
        target,
        // Deliberately does NOT name the carrier: inspectServerInitiated
        // RE-TAGS findings from prompt_content to sampling_prompt, so an
        // embedded carrier name would contradict the finding's own `target`
        // field on the one path that matters most.
        matched_text_excerpt: `${classifyHiddenChar(m[0])} outside an emoji tag sequence`,
        remediation: "Content contains Unicode tag-block characters (U+E0000\u2013U+E007F), which render as nothing but are readable by a model \u2014 the documented 'ASCII smuggling' concealment technique. They essentially never occur in real text except in the three emoji subdivision flags clients actually render (England, Scotland, Wales), which are excluded. Another well-formed subdivision flag will warn here. Inspect the server's output; if legitimate, mute via `mcpm guard mute unicode-tag-concealment`."
      }
    ];
  }
  return [];
}
function inspectTagEncoded(leaf, signatures, target) {
  const segments = leaf.length <= MATCH_SEGMENT_CAP * 2 ? [leaf] : [leaf.slice(0, MATCH_SEGMENT_CAP), leaf.slice(-MATCH_SEGMENT_CAP)];
  const findings = [];
  const seen = /* @__PURE__ */ new Set();
  for (const segment of segments) {
    if (!hasTagChar(segment)) continue;
    const skip = rgiTagSequenceMask(segment);
    let decoded = "";
    let masked = "";
    let recovered = false;
    for (let i = 0; i < segment.length; ) {
      const cp = segment.codePointAt(i) ?? 0;
      const width = cp > 65535 ? 2 : 1;
      if (cp >= 917504 && cp <= 917631 && !isSkipped(skip, i)) {
        const ascii = tagToAscii(cp);
        if (ascii !== "") {
          decoded += ascii;
          masked += CONCEALMENT_MASK;
          recovered = true;
        }
      } else {
        decoded += segment.slice(i, i + width);
        masked += segment.slice(i, i + width);
      }
      i += width;
    }
    if (!recovered) continue;
    const emittedHere = /* @__PURE__ */ new Set();
    for (const entry of concealmentSurplus(
      countOccurrences(decoded, signatures, target),
      countOccurrences(masked, signatures, target)
    )) {
      const key = `${entry.sig.id}\0${entry.text}`;
      if (seen.has(key) || emittedHere.has(entry.sig.id)) continue;
      seen.add(key);
      emittedHere.add(entry.sig.id);
      findings.push({
        signature_id: entry.sig.id,
        category: entry.sig.category,
        severity: entry.sig.severity,
        target: entry.sig.target,
        matched_text_excerpt: entry.sig.redact ? redactSecret(entry.text) : truncate(entry.text),
        remediation: entry.sig.remediation
      });
    }
  }
  return findings.map((f) => ({
    ...f,
    matched_text_excerpt: `\u2039decoded:unicode-tag\u203A ${f.matched_text_excerpt}`,
    remediation: `${f.remediation} NOTE: the payload was written in the Unicode tag block (invisible to a human reviewer) and decoded by mcpm-guard before matching (concealment attempt).`
  }));
}
var ACTION_RANK = { pass: 0, warn: 1, block: 2 };
var WARN_ONLY_TARGETS = /* @__PURE__ */ new Set([
  "resource_content",
  "prompt_content"
]);
function severityToAction(sev) {
  if (sev === "critical") return "block";
  if (sev === "high") return "warn";
  return "pass";
}
function defaultActionForFinding(f) {
  const native = severityToAction(f.severity);
  if (f.decoded === true && ACTION_RANK[native] > ACTION_RANK.warn) {
    return "warn";
  }
  if (WARN_ONLY_TARGETS.has(f.target) && ACTION_RANK[native] > ACTION_RANK.warn) {
    return "warn";
  }
  return native;
}
var DECODE_TARGETS = /* @__PURE__ */ new Set([
  "tool_response",
  "resource_content",
  "prompt_content"
]);
var MAX_DECODE_RUNS = 8;
var MAX_DECODE_ATTEMPTS = 64;
var TEXTY_MIN_RATIO = 0.85;
var BASE64_RUN = /[A-Za-z0-9+/_-]{24,}={0,2}/g;
function printableRatio(s) {
  if (s.length === 0) return 0;
  let printable = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13 || c >= 32 && c <= 126) printable++;
  }
  return printable / s.length;
}
function decodeBase64Run(run) {
  const std = run.replace(/-/g, "+").replace(/_/g, "/");
  const buf = Buffer.from(std, "base64");
  if (buf.length === 0) return null;
  return buf.toString("utf8").slice(0, MATCH_SEGMENT_CAP);
}
function inspectDecoded(leaf, signatures, target) {
  const scan = matchWindow(leaf);
  const out = [];
  let synthBudget = MAX_DECODE_RUNS;
  let attempts = 0;
  BASE64_RUN.lastIndex = 0;
  for (let m = BASE64_RUN.exec(scan); m !== null && synthBudget > 0 && attempts < MAX_DECODE_ATTEMPTS; m = BASE64_RUN.exec(scan)) {
    attempts++;
    const decoded = decodeBase64Run(m[0]);
    if (decoded === null || printableRatio(decoded) < TEXTY_MIN_RATIO) continue;
    synthBudget--;
    const syntheticPlain = inspectAgainstSignatures(decoded, signatures, target);
    const syntheticSeen = new Set(syntheticPlain.map(findingKey));
    const fromSynthetic = [
      ...syntheticPlain,
      ...inspectTagEncoded(decoded, signatures, target).filter(
        (f) => !syntheticSeen.has(findingKey(f))
      )
    ];
    for (const f of fromSynthetic) {
      out.push({
        ...f,
        decoded: true,
        matched_text_excerpt: `\u2039decoded:base64\u203A ${f.matched_text_excerpt}`,
        remediation: `${f.remediation} NOTE: the payload was base64-encoded inside the response and decoded by mcpm-guard before matching (evasion attempt).`
      });
    }
  }
  return out;
}
function truncationFinding(target) {
  return {
    signature_id: "guard-inspection-truncated",
    category: "MCP-GUARD-INTEGRITY",
    severity: "critical",
    target,
    matched_text_excerpt: `inspection budget exhausted after ${MAX_LEAF_WALK_NODES} nodes in ${target}`,
    remediation: "The frame was too large to inspect completely, so the guard cannot vouch for it \u2014 padding a response with junk nodes is a known way to hide a payload behind the budget. Inspect the server's output by hand. If this server legitimately emits frames this large, mute via `mcpm guard mute guard-inspection-truncated`."
  };
}
function inspectMessage(msg, signatures) {
  const targets = [
    "tool_response",
    "tool_call_args",
    "tool_description",
    "tool_annotations",
    "resource_content",
    "prompt_content",
    "initialize_instructions"
  ];
  const findings = [];
  for (const target of targets) {
    const subtree = targetSubtree(msg, target);
    if (subtree === null || subtree === void 0) continue;
    const budget = { exhausted: false };
    for (const leaf of stringLeaves(subtree, budget)) {
      if (HIDDEN_CHAR_TARGETS.has(target)) {
        findings.push(...detectHiddenChars(leaf, target));
      } else {
        findings.push(...detectTagConcealment(leaf, target));
      }
      const plain = inspectAgainstSignatures(leaf, signatures, target);
      findings.push(...plain);
      const plainSeen = new Set(plain.map(findingKey));
      findings.push(
        ...inspectTagEncoded(leaf, signatures, target).filter(
          (f) => !plainSeen.has(findingKey(f))
        )
      );
      if (DECODE_TARGETS.has(target)) {
        findings.push(...inspectDecoded(leaf, signatures, target));
      }
    }
    if (budget.exhausted) findings.push(truncationFinding(target));
  }
  if (findings.length === 0) return { action: "pass", findings: [] };
  return { action: worstAction(findings), findings };
}

// src/guard/key-canon.ts
function canonicalizeKey(rawKey) {
  const folded = normalizeForMatch(rawKey);
  const camelSplit = folded.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  return camelSplit.toLowerCase().replace(/[\s-]+/g, "_").replace(/_{2,}/g, "_");
}
function canonicalToolName(rawName) {
  return normalizeForMatch(rawName).toLowerCase();
}

// src/guard/exfil-names.ts
var EXFIL_PARAM_DENY = [
  /^_system_prompt_$/,
  /^_conversation_history_$/,
  /^_chat_history_$/,
  /^_chain_of_thought_$/,
  /^_reasoning_trace_$/,
  /^_(?:full_)?context_window_$/,
  /^_exfil(?:trate)?(?:_[a-z0-9]+)*_$/
];
function classifyParamName(rawKey) {
  const canonical = canonicalizeKey(rawKey);
  return EXFIL_PARAM_DENY.some((re) => re.test(canonical)) ? "deny" : null;
}

// src/guard/exfil-params.ts
var EXFIL_PARAM_SIGNATURE_ID = "exfil-param-in-schema";
var PASS = { action: "pass", findings: [] };
var REMEDIATION = "A tool's input schema declares a parameter named like a context-exfiltration sigil (e.g. `_system_prompt_`) that the model would silently auto-fill from the conversation / system prompt \u2014 a zero-interaction prompt leak. No legitimate tool names a parameter this way. The server's ENTIRE tools/list was blocked before the agent saw it. This is a tripwire for the documented underscore-sigil convention \u2014 a renamed parameter evades it. If you trust this server, mute via `mcpm guard mute exfil-param-in-schema` (re-enables the whole server).";
function* exfilKeys(schema, depth) {
  if (depth > 1 || schema === null || typeof schema !== "object") return;
  const props = schema.properties;
  if (props === null || typeof props !== "object" || Array.isArray(props)) return;
  for (const key of Object.keys(props)) {
    if (!Object.hasOwn(props, key)) continue;
    if (classifyParamName(key) === "deny") yield key;
    yield* exfilKeys(props[key], depth + 1);
  }
}
function makeFinding(toolName, rawKey) {
  return {
    signature_id: EXFIL_PARAM_SIGNATURE_ID,
    category: "OWASP-MCP-1",
    severity: "critical",
    target: "tool_description",
    // block-capable carrier (NOT in WARN_ONLY_TARGETS)
    matched_text_excerpt: truncate(`parameter "${rawKey}" in tool "${toolName}"`),
    remediation: REMEDIATION
  };
}
function detectExfilParams(msg) {
  if (!("result" in msg)) return PASS;
  const tools = msg.result?.tools;
  if (!Array.isArray(tools)) return PASS;
  const findings = [];
  for (const tool of tools) {
    if (tool === null || typeof tool !== "object") continue;
    const rawName = tool.name;
    const toolName = typeof rawName === "string" ? rawName : "<unnamed>";
    for (const key of exfilKeys(tool.inputSchema, 0)) {
      findings.push(makeFinding(toolName, key));
    }
  }
  if (findings.length === 0) return PASS;
  return { action: worstAction(findings), findings };
}

// src/guard/tool-call-args-walk.ts
var MAX_DEPTH = 1;
function* stringArgLeaves(node, depth = 0) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) yield* stringArgLeaves(item, depth);
    return;
  }
  if (depth > MAX_DEPTH) return;
  for (const key of Object.keys(node)) {
    if (!Object.hasOwn(node, key)) continue;
    const value = node[key];
    if (typeof value === "string") {
      yield { key, value };
    } else if (value !== null && typeof value === "object") {
      yield* stringArgLeaves(value, depth + 1);
    }
  }
}
function toolCallArguments(msg) {
  if (msg === null || typeof msg !== "object") return null;
  if (!("method" in msg) || msg.method !== "tools/call") return null;
  if (!("params" in msg)) return null;
  const params = msg.params;
  const args = params?.arguments;
  if (args === null || typeof args !== "object" || Array.isArray(args)) return null;
  const toolName = typeof params?.name === "string" ? params.name : "<unnamed>";
  return { toolName, args };
}

// src/guard/shell-metachar-args.ts
var SHELL_METACHAR_ARG_SIGNATURE_ID = "shell-metachar-in-identifier-arg";
var PASS2 = { action: "pass", findings: [] };
var IDENTIFIER_KEY_SUFFIXES = /* @__PURE__ */ new Set([
  "id",
  "number",
  "num",
  "path",
  "slug",
  "uuid",
  "identifier",
  "namespace"
]);
function isIdentifierLikeArgKey(rawKey) {
  const tokens = canonicalizeKey(rawKey).split("_").filter(Boolean);
  const last = tokens.at(-1);
  return last !== void 0 && IDENTIFIER_KEY_SUFFIXES.has(last);
}
var SHELL_METACHAR_PATTERNS = [
  /\$\(/,
  // $(...) command substitution
  /`/,
  // backtick command substitution
  /;/,
  // statement separator
  /&&/
  // command chaining (AND)
];
var REMEDIATION2 = "A tool call argument named like a bare identifier or filesystem path (an id, number, path, slug, uuid, or namespace field) contains shell-metacharacter or command-substitution syntax ($(...), a backtick, ;, or &&). Two real, disclosed CVEs (github-kanban-mcp-server CVE-2025-53818, godot-mcp CVE-2026-25546) reach command injection through exactly this shape \u2014 the value is spliced unescaped into a shell command. The call was blocked. If this tool legitimately accepts shell syntax in this field, mute via `mcpm guard mute shell-metachar-in-identifier-arg`.";
function matchesShellMetachar(value) {
  const normalized = normalizeForMatch(value);
  return SHELL_METACHAR_PATTERNS.some((re) => re.test(normalized));
}
function makeFinding2(toolName, key, value) {
  return {
    signature_id: SHELL_METACHAR_ARG_SIGNATURE_ID,
    category: "MCP-COMMAND-INJECTION",
    severity: "critical",
    target: "tool_call_args",
    // block-capable carrier (NOT in WARN_ONLY_TARGETS)
    matched_text_excerpt: truncate(`argument "${key}" of tool "${toolName}": ${value}`),
    remediation: REMEDIATION2
  };
}
var SIGNATURE = {
  id: SHELL_METACHAR_ARG_SIGNATURE_ID,
  category: "MCP-COMMAND-INJECTION",
  severity: "critical",
  description: SHELL_METACHAR_ARG_SIGNATURE_ID,
  target: "tool_call_args",
  patterns: SHELL_METACHAR_PATTERNS,
  remediation: REMEDIATION2
};
function detectShellMetacharArgs(msg) {
  const call = toolCallArguments(msg);
  if (call === null) return PASS2;
  const findings = [];
  for (const { key, value } of stringArgLeaves(call.args)) {
    if (!isIdentifierLikeArgKey(key)) continue;
    if (matchesShellMetachar(value)) {
      findings.push(makeFinding2(call.toolName, key, value));
    }
    for (const f of inspectTagEncoded(value, [SIGNATURE], "tool_call_args")) {
      findings.push({
        ...f,
        matched_text_excerpt: truncate(
          `argument "${key}" of tool "${call.toolName}": ${value} (${f.matched_text_excerpt})`
        )
      });
    }
  }
  if (findings.length === 0) return PASS2;
  return { action: worstAction(findings), findings };
}

// src/guard/query-control-args.ts
var QUERY_CONTROL_ARG_SIGNATURE_ID = "query-control-syntax-in-identifier-arg";
var PASS3 = { action: "pass", findings: [] };
var RESOURCE_NOUN_TOKENS = /* @__PURE__ */ new Set([
  "table",
  "column",
  "field",
  "collection",
  "database",
  "schema",
  "index",
  "view",
  "dataset"
]);
var GENERIC_IDENTIFIER_SUFFIXES = /* @__PURE__ */ new Set(["id", "identifier", "uuid", "slug"]);
function isQueryScopedArgKey(rawKey) {
  const tokens = canonicalizeKey(rawKey).split("_").filter(Boolean);
  if (tokens.some((t) => RESOURCE_NOUN_TOKENS.has(t))) return true;
  const last = tokens.at(-1);
  return last !== void 0 && GENERIC_IDENTIFIER_SUFFIXES.has(last);
}
var QUERY_CONTROL_PATTERNS = [
  /\|\s*(project|take|where|summarize|extend|distinct|limit|top|sort|join|union|delete|drop)\b/i,
  // pipe re-scoping (KQL/Splunk-shaped)
  /;\s*(drop|delete|truncate|alter|create|insert|update)\b/i,
  // statement separator + DDL/DML
  /\.\s*drop\b/i,
  // KQL management command (`.drop table ...`)
  /(?:^|\s)--/,
  // SQL-style line comment (not a bare mid-token double-hyphen)
  /(?:^|\s)\/\//
  // KQL/C-style line comment (not a URI scheme's `://`)
];
var REMEDIATION3 = "A tool call argument named like a bare table, column, database, schema, or resource identifier contains query-control syntax: a pipe followed by a query verb (project, take, where, ...), a statement separator followed by a DDL/DML keyword, a `.drop` management command, or a line-comment token (--, //). CVE-2026-33980 (adx-mcp-server) reaches data exfiltration and destructive table drops through exactly this shape \u2014 a tool marketed as a safe read-only metadata inspector interpolates the argument unescaped into a live query. The call was blocked. If this tool legitimately accepts query syntax in this field, mute via `mcpm guard mute query-control-syntax-in-identifier-arg`.";
function matchesQueryControlSyntax(value) {
  const normalized = normalizeForMatch(value);
  return QUERY_CONTROL_PATTERNS.some((re) => re.test(normalized));
}
function makeFinding3(toolName, key, value) {
  return {
    signature_id: QUERY_CONTROL_ARG_SIGNATURE_ID,
    category: "MCP-QUERY-INJECTION",
    severity: "critical",
    target: "tool_call_args",
    // block-capable carrier (NOT in WARN_ONLY_TARGETS)
    matched_text_excerpt: truncate(`argument "${key}" of tool "${toolName}": ${value}`),
    remediation: REMEDIATION3
  };
}
var SIGNATURE2 = {
  id: QUERY_CONTROL_ARG_SIGNATURE_ID,
  category: "MCP-QUERY-INJECTION",
  severity: "critical",
  description: QUERY_CONTROL_ARG_SIGNATURE_ID,
  target: "tool_call_args",
  patterns: QUERY_CONTROL_PATTERNS,
  remediation: REMEDIATION3
};
function detectQueryControlArgs(msg) {
  const call = toolCallArguments(msg);
  if (call === null) return PASS3;
  const findings = [];
  for (const { key, value } of stringArgLeaves(call.args)) {
    if (!isQueryScopedArgKey(key)) continue;
    if (matchesQueryControlSyntax(value)) {
      findings.push(makeFinding3(call.toolName, key, value));
    }
    for (const f of inspectTagEncoded(value, [SIGNATURE2], "tool_call_args")) {
      findings.push({
        ...f,
        matched_text_excerpt: truncate(
          `argument "${key}" of tool "${call.toolName}": ${value} (${f.matched_text_excerpt})`
        )
      });
    }
  }
  if (findings.length === 0) return PASS3;
  return { action: worstAction(findings), findings };
}

// src/guard/cli-flag-injection-args.ts
var CLI_FLAG_INJECTION_ARG_SIGNATURE_ID = "cli-flag-injection-in-identifier-arg";
var PASS4 = { action: "pass", findings: [] };
var FLAG_INJECTION_KEY_SUFFIXES = /* @__PURE__ */ new Set([
  "namespace",
  "id",
  "identifier",
  "uuid",
  "slug"
]);
function isFlagInjectionScopedArgKey(rawKey) {
  const tokens = canonicalizeKey(rawKey).split("_").filter(Boolean);
  const last = tokens.at(-1);
  return last !== void 0 && FLAG_INJECTION_KEY_SUFFIXES.has(last);
}
var CLI_FLAG_PATTERN = /(?:^|\s)--[A-Za-z][\w-]*(?:=\S*)?/;
var REMEDIATION4 = "A tool call argument named like a bare namespace or opaque identifier contains a `--`-prefixed CLI flag token (e.g. `--address=0.0.0.0`). CVE-2026-39884 (mcp-server-kubernetes `port_forward`) reaches this exact shape: the argument is whitespace-split into a shell command, so an embedded flag is interpreted as a second command-line option rather than part of the identifier \u2014 turning a normally localhost-only operation into one exposed on all interfaces. The call was blocked. If this tool legitimately accepts flag-shaped text in this field, mute via `mcpm guard mute cli-flag-injection-in-identifier-arg`.";
function matchesCliFlagInjection(value) {
  return CLI_FLAG_PATTERN.test(normalizeForMatch(value));
}
function makeFinding4(toolName, key, value) {
  return {
    signature_id: CLI_FLAG_INJECTION_ARG_SIGNATURE_ID,
    category: "MCP-ARGUMENT-INJECTION",
    severity: "critical",
    target: "tool_call_args",
    // block-capable carrier (NOT in WARN_ONLY_TARGETS)
    matched_text_excerpt: truncate(`argument "${key}" of tool "${toolName}": ${value}`),
    remediation: REMEDIATION4
  };
}
var SIGNATURE3 = {
  id: CLI_FLAG_INJECTION_ARG_SIGNATURE_ID,
  category: "MCP-ARGUMENT-INJECTION",
  severity: "critical",
  description: CLI_FLAG_INJECTION_ARG_SIGNATURE_ID,
  target: "tool_call_args",
  patterns: [CLI_FLAG_PATTERN],
  remediation: REMEDIATION4
};
function detectCliFlagInjectionArgs(msg) {
  const call = toolCallArguments(msg);
  if (call === null) return PASS4;
  const findings = [];
  for (const { key, value } of stringArgLeaves(call.args)) {
    if (!isFlagInjectionScopedArgKey(key)) continue;
    if (matchesCliFlagInjection(value)) {
      findings.push(makeFinding4(call.toolName, key, value));
    }
    for (const f of inspectTagEncoded(value, [SIGNATURE3], "tool_call_args")) {
      findings.push({
        ...f,
        matched_text_excerpt: truncate(
          `argument "${key}" of tool "${call.toolName}": ${value} (${f.matched_text_excerpt})`
        )
      });
    }
  }
  if (findings.length === 0) return PASS4;
  return { action: worstAction(findings), findings };
}

// src/guard/sanitize.ts
var ANSI_AND_C1_CONTROL = (
  // ESC followed by single-char dispatch (@-Z, \, -, _) OR CSI [..letter
  // eslint-disable-next-line no-control-regex
  /\x1B(?:[@-Z\\\-_]|\[[0-9;]*[a-zA-Z])/g
);
var C0_C1_CONTROL = (
  // C0 (0x00-0x1F) + DEL (0x7F) + C1 (0x80-0x9F)
  // eslint-disable-next-line no-control-regex
  /[\x00-\x1F\x7F\x80-\x9F]/g
);
var DEFAULT_MAX_LEN = 256;
function sanitizeForTerminal(s, maxLen = DEFAULT_MAX_LEN) {
  const stripped = s.replace(ANSI_AND_C1_CONTROL, "").replace(C0_C1_CONTROL, "");
  return stripped.length > maxLen ? `${stripped.slice(0, maxLen)}\u2026` : stripped;
}

// src/guard/tool-name-confusable.ts
var CONFUSABLE_TOOL_NAME_SIGNATURE_ID = "tool-name-confusable-duplicate";
var DECEPTIVE_TOOL_NAME_SIGNATURE_ID = "tool-name-deceptive-characters";
var INVISIBLE_CHARS = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]|[\u{E0000}-\u{E007F}]/u;
function isMixedScript(name) {
  if (!/[A-Za-z]/.test(name)) return false;
  for (const ch of name) {
    if (ch.charCodeAt(0) < 128) continue;
    if (/\p{L}|\p{M}/u.test(ch)) return true;
  }
  return false;
}
var PASS5 = { action: "pass", findings: [] };
function toolNames(msg) {
  const result = msg.result;
  if (!Array.isArray(result?.tools)) return null;
  const names = [];
  for (const t of result.tools) {
    if (t === null || typeof t !== "object") continue;
    const name = t.name;
    if (typeof name === "string") names.push(name);
  }
  return names;
}
function detectConfusableToolNames(msg) {
  const names = toolNames(msg);
  if (names === null || names.length === 0) return PASS5;
  const findings = [];
  const firstRawFor = /* @__PURE__ */ new Map();
  const reported = /* @__PURE__ */ new Set();
  for (const name of names) {
    const canon = canonicalToolName(name);
    const prior = firstRawFor.get(canon);
    if (prior === void 0) {
      firstRawFor.set(canon, name);
      continue;
    }
    if (prior === name || reported.has(canon)) continue;
    reported.add(canon);
    findings.push({
      signature_id: CONFUSABLE_TOOL_NAME_SIGNATURE_ID,
      category: "OWASP-MCP-1",
      severity: "high",
      target: "tool_description",
      matched_text_excerpt: `${sanitizeForTerminal(name, 64)} vs ${sanitizeForTerminal(prior, 64)}`,
      remediation: `This tools/list advertises two tools whose names are visually indistinguishable after Unicode normalization ("${sanitizeForTerminal(name, 64)}" and "${sanitizeForTerminal(prior, 64)}"). A look-alike name is how a poisoned tool definition is smuggled past a same-session drift check. Confirm with the server's publisher that BOTH tools are intended; if not, remove the server.`
    });
  }
  for (const name of names) {
    const invisible = INVISIBLE_CHARS.test(name);
    if (!invisible && !isMixedScript(name)) continue;
    findings.push({
      signature_id: DECEPTIVE_TOOL_NAME_SIGNATURE_ID,
      category: "OWASP-MCP-1",
      severity: "high",
      target: "tool_description",
      matched_text_excerpt: sanitizeForTerminal(name, 64),
      remediation: invisible ? `Tool name "${sanitizeForTerminal(name, 64)}" contains an invisible character (zero-width, bidi control, or Unicode TAG). Such a character does not render, so its only effect is to make this name look identical to another one. Report it to the server's publisher.` : `Tool name "${sanitizeForTerminal(name, 64)}" mixes Latin letters with letters from another script \u2014 the standard way to build a look-alike of a trusted tool name (e.g. a Cyrillic "\u043E" for an ASCII "o"). Report it to the server's publisher.`
    });
  }
  if (findings.length === 0) return PASS5;
  return { action: worstAction(findings), findings };
}

// src/guard/signatures.ts
var SOLICIT_VERB = "(?:enter|re-?enter|type|paste|provide|input|share|submit|confirm|reveal|supply|restore|recover|verify|key[\\s-]*in|fill[\\s-]*in)";
var solicits = (noun) => new RegExp(`${SOLICIT_VERB}[\\s\\S]{0,40}(?:${noun})`, "i");
var ELECTRON_MCP_BRIDGE_CALL = "electron\\s*\\.\\s*mcp\\s*\\.\\s*(?:activate|addServer)\\s*\\(";
var TOOL_METADATA_INJECTION_PATTERNS = [
  /(?:^|[\s.,;:!?])ignore[\s]*(?:all[\s]*|any[\s]*|the[\s]*)?(?:previous|prior|above)[\s]*instructions?/i,
  /(?:disregard|forget)[\s]*(?:all[\s]*|any[\s]*|the[\s]*)?(?:previous|prior|above)[\s]*instructions?/i,
  /<important>|<system>/i,
  /when[\s]*(?:the[\s]*)?user[\s]*asks,?[\s]*(?:you[\s]*(?:must|should|always|never)|always|never|exfil|read|access|send|email|do[\s]*not)/i
];
var OWASP_MCP_TOP_10 = [
  {
    id: "owasp-mcp-2-instruction-injection-in-response",
    category: "OWASP-MCP-2",
    severity: "critical",
    description: "Imperative instructions embedded in tool response content",
    target: "tool_response",
    // Internal token separators are [\s]* (not +), parity with the credential
    // family's [\s-]* fix: [\s]* still matches newline / tab / multi-space evasions
    // ("ignore\nprevious instructions") AND a stripped zero-width separator that
    // collapses to adjacency ("ignore<U+200B>previous" → "ignoreprevious" after
    // PATTERN_BREAKERS). tool_response is not in HIDDEN_CHAR_TARGETS, so [\s]+ here
    // would let that invisible-separator bypass through. (review HIGH)
    patterns: [
      /(?:^|[\s.,;:!?])ignore[\s]*(?:all[\s]*|any[\s]*|the[\s]*)?(?:previous|prior|above)[\s]*instructions?/i,
      /(?:disregard|forget)[\s]*(?:all[\s]*|any[\s]*|the[\s]*)?(?:previous|prior|above)[\s]*instructions?/i,
      /you[\s]*are[\s]*now[\s]*(?:in[\s]*|operating[\s]*in[\s]*|entering[\s]*)?(?:developer|debug|admin|jailbreak|dan)[\s]*mode/i,
      /<\|system\|>|<\|im_start\|>system/
    ],
    remediation: "Tool response contained injection-shaped text. Review the upstream data source (message, web page, file). If legitimate, allow via `mcpm guard mute owasp-mcp-2-instruction-injection-in-response --for 5m`."
  },
  {
    id: "owasp-mcp-7-path-exfil-in-args",
    category: "OWASP-MCP-7",
    severity: "high",
    description: "Sensitive filesystem paths in tool call arguments",
    target: "tool_call_args",
    patterns: [
      /\.ssh\/|\.aws\/credentials|\.env(\b|$)|id_rsa|\.gnupg\/|\.kube\/config/i
    ],
    remediation: "Tool call argument referenced a sensitive file path. Common in exfil chains after a tool-poisoning attack. Verify the agent's intent before allowing."
  },
  {
    id: "owasp-mcp-1-tool-description-injection",
    category: "OWASP-MCP-1",
    severity: "critical",
    description: "Instruction-shaped text in tool descriptions (poisoning / rug-pull)",
    target: "tool_description",
    // The previous version included /when (?:the )?user asks/ which false-positives
    // on legitimate descriptions like "Returns X when the user asks for Y." Tightened
    // to require an imperative verb following the phrase, which is the actual
    // tool-poisoning shape (e.g., "when the user asks, exfiltrate ~/.ssh/").
    // Shared verbatim with the sibling tool_annotations signature below — same
    // attack class on an adjacent tools/list surface; keep the two in sync.
    patterns: TOOL_METADATA_INJECTION_PATTERNS,
    remediation: "A tool description contains imperative or system-prompt-style text. Tool-poisoning pattern (Invariant Labs disclosure, 2025). Re-review the server; if legitimate, run `mcpm guard accept-drift <server>`."
  },
  {
    id: "owasp-mcp-2-instruction-injection-in-resource",
    category: "OWASP-MCP-2",
    severity: "critical",
    description: "Imperative instructions embedded in retrieved resource content",
    // resources/read content is RETRIEVED DATA — inspectMessage clamps a match
    // here to `warn` (annotate + forward), so a poisoned/quoted README is flagged
    // but never dropped. Severity stays critical (pattern confidence is honest).
    target: "resource_content",
    patterns: [
      /(?:^|[\s.,;:!?])ignore[\s]*(?:all[\s]*|any[\s]*|the[\s]*)?(?:previous|prior|above)[\s]*instructions?/i,
      /(?:disregard|forget)[\s]*(?:all[\s]*|any[\s]*|the[\s]*)?(?:previous|prior|above)[\s]*instructions?/i,
      /you[\s]*are[\s]*now[\s]*(?:in[\s]*|operating[\s]*in[\s]*|entering[\s]*)?(?:developer|debug|admin|jailbreak|dan)[\s]*mode/i,
      /<\|system\|>|<\|im_start\|>system/
    ],
    remediation: "Retrieved resource content contained injection-shaped text. This is annotated and forwarded (not blocked) so legitimate documents aren't corrupted. Review the source resource; if hostile, stop reading from it."
  },
  {
    id: "owasp-mcp-2-instruction-injection-in-prompt",
    category: "OWASP-MCP-2",
    severity: "critical",
    description: "Imperative instructions embedded in a server-provided prompt",
    // prompts/get content is RETRIEVED DATA — warn-only via the inspectMessage clamp.
    target: "prompt_content",
    patterns: [
      /(?:^|[\s.,;:!?])ignore[\s]*(?:all[\s]*|any[\s]*|the[\s]*)?(?:previous|prior|above)[\s]*instructions?/i,
      /(?:disregard|forget)[\s]*(?:all[\s]*|any[\s]*|the[\s]*)?(?:previous|prior|above)[\s]*instructions?/i,
      /you[\s]*are[\s]*now[\s]*(?:in[\s]*|operating[\s]*in[\s]*|entering[\s]*)?(?:developer|debug|admin|jailbreak|dan)[\s]*mode/i,
      /<\|system\|>|<\|im_start\|>system/
    ],
    remediation: "A server-provided prompt template contained injection-shaped text. Annotated and forwarded (not blocked). Review the prompt's source server."
  },
  {
    // TODOS #16 (security review F12) — the tool_annotations target was wired
    // in patterns.ts from v0.5.0 but no signature ever used it. Annotations
    // (the standard `title`/`readOnlyHint`/etc. fields, and any custom field a
    // server chooses to add — it's an unconstrained JSON object) are an MCP
    // extension surface a tool-poisoning attack can use to carry injection text
    // that a description-only scan would miss (Invariant Labs disclosure).
    // Reuses the same patterns as the sibling tool_description signature —
    // same attack class, same block-capable pre-invocation carrier.
    id: "owasp-mcp-1-tool-annotation-injection",
    category: "OWASP-MCP-1",
    severity: "critical",
    description: "Instruction-shaped text in tool annotations (title or a custom annotation field)",
    target: "tool_annotations",
    patterns: TOOL_METADATA_INJECTION_PATTERNS,
    remediation: "A tool's annotations (title or a custom annotation field) contain imperative or system-prompt-style text. Tool-poisoning pattern (Invariant Labs disclosure, 2025), carried via the annotations extension surface instead of the description. Re-review the server; if legitimate, run `mcpm guard accept-drift <server>`."
  },
  {
    id: "owasp-mcp-1-initialize-instruction-injection",
    category: "OWASP-MCP-1",
    severity: "critical",
    description: "Instruction-shaped text in initialize instructions / serverInfo (line-jumping)",
    // initialize instructions + serverInfo are PRE-INVOCATION CONTEXT injected
    // into the agent before any tool call — block-capable (T2 line-jumping).
    target: "initialize_instructions",
    // Use genuine prompt-delimiter tokens (<|system|>, <|im_start|>system) like the
    // resource/prompt signatures — NOT a bare `<important>`/`<system>` tag. This
    // carrier is block-capable, so a loose emphasis tag in legitimate instruction
    // prose would hard-fail the server connection with an opaque JSON-RPC error.
    // (security: FP-2 over-block)
    patterns: [
      /(?:^|[\s.,;:!?])ignore[\s]*(?:all[\s]*|any[\s]*|the[\s]*)?(?:previous|prior|above)[\s]*instructions?/i,
      /(?:disregard|forget)[\s]*(?:all[\s]*|any[\s]*|the[\s]*)?(?:previous|prior|above)[\s]*instructions?/i,
      /<\|system\|>|<\|im_start\|>system/,
      /you[\s]*are[\s]*now[\s]*(?:in[\s]*|operating[\s]*in[\s]*|entering[\s]*)?(?:developer|debug|admin|jailbreak|dan)[\s]*mode/i
    ],
    remediation: "A server's initialize instructions/serverInfo contain imperative or system-prompt-style text \u2014 a line-jumping attack that injects context before any tool runs. Re-review the server; if legitimate, run `mcpm guard accept-drift <server>`."
  },
  {
    // F6 credential-phishing wedge. Targets `prompt_content` so it rides the
    // existing server-initiated scan path (run-inner.ts inspectServerInitiated
    // wraps a sampling/elicitation request into a synthetic prompts/get frame and
    // RE-TAGS findings to the block-capable `sampling_prompt` carrier). Net effect:
    // a server that PROMPTS the user (via elicitation/create or sampling) to enter a
    // wallet secret is BLOCKED with the error routed back to the server; the same
    // string in a passive prompts/get template is warn-only (retrieved data).
    //
    // Every pattern is built with solicits() (imperative cue + credential noun) — see
    // the SOLICIT_VERB note above for why mention-vs-ask anchoring is load-bearing.
    //
    // FP discipline: only credential types no legitimate MCP server ever solicits are
    // in the block tier. Generic api-key / password / token / access-token /
    // client-secret / bearer are DELIBERATELY EXCLUDED — a server asking for ITS OWN
    // config secret during first-run setup is the single most common (and
    // spec-intended) elicitation, so hard-blocking it would break the feature.
    // "private key" is additionally anchored to crypto-wallet co-occurrence so an
    // SSH/cert/GPG key-manager that elicits "paste your private key" to import a key
    // is NOT blocked (bare "private key" never matches). "mnemonic" requires crypto
    // context too (an assembly/flashcard server legitimately says "enter the
    // mnemonic"). The confusable fold is partial (CONFUSABLES covers s/e/d/o/p/c…
    // but not every anchor letter, e.g. m), so this catches the literal/homoglyph
    // string, not semantic rephrasing (V2 LLM-judge). OTP / verification-code is
    // intentionally NOT here: a legit device-flow / email-verification server
    // elicits "enter the code we sent you" during its own pairing and the relay
    // can't tell self-pairing from a third-party-login relay without provenance.
    id: "credential-phishing-wallet-solicitation",
    category: "MCP-CREDENTIAL-PHISHING",
    severity: "critical",
    description: "Server-initiated prompt soliciting a crypto-wallet seed/recovery phrase, mnemonic, or wallet private key (drainer phishing)",
    target: "prompt_content",
    patterns: [
      solicits("seed[\\s-]*(?:phrase|words)"),
      solicits("recovery[\\s-]*(?:phrase|seed|words)"),
      solicits("\\bbip[\\s-]?0?39\\b"),
      // mnemonic must ALSO carry crypto/wallet/phrase context (either order) — bare
      // "mnemonic" is legitimate (assembly opcode, memory aid, flashcard). (review HIGH)
      solicits("(?:wallet|crypto|seed|recovery|metamask|ledger|trezor)[\\s\\S]{0,25}mnemonic"),
      solicits("mnemonic[\\s\\S]{0,25}(?:phrase|words?|seed|recovery|wallet|crypto)"),
      // "private key" ONLY with a crypto-wallet cue within a bounded window (either
      // order). Bare "private key" (SSH / TLS cert / GPG / JWT signing) never matches
      // — those are legitimate key-import elicitations. (critique CRITICAL #1)
      solicits(
        "(?:wallet|crypto(?:currency)?|seed|mnemonic|recovery|metamask|ledger|trezor|bitcoin|ethereum|solana|phantom)[\\s\\S]{0,40}private[\\s-]*key"
      ),
      solicits(
        "private[\\s-]*key[\\s\\S]{0,40}(?:wallet|crypto(?:currency)?|seed|mnemonic|recovery|metamask|ledger|trezor|bitcoin|ethereum|solana|phantom)"
      )
    ],
    remediation: "A server prompted the user to enter a crypto-wallet seed/recovery phrase, mnemonic, or wallet private key. No legitimate MCP server asks for these \u2014 it is a wallet-drainer phishing pattern. The request was blocked and a JSON-RPC error returned to the server. If you are certain this is legitimate, mute via `mcpm guard mute credential-phishing-wallet-solicitation`."
  },
  {
    // F6 financial-secret tier — same solicits() anchoring + prompt_content/
    // sampling_prompt path as the wallet signature above. Block tier = card CVV/CVC,
    // a solicited SSN, and a card/bank/ATM PIN. PIN REQUIRES a financial qualifier
    // (card/bank/atm/debit/credit) so "pin this message" never matches (critique
    // MAJOR #3); CVC requires a card cue so a bare acronym ("CVC Capital") doesn't
    // fire. The SSN acronym is gated by solicits() so "map the ssn field" / "the SSN
    // column" — common field-name prose — does NOT block; only an actual ask does
    // (review HIGH). SSN is the one block-tier item a narrow set of legitimate
    // servers (tax / payroll / healthcare intake) may genuinely need, so the
    // remediation points those users at the mute path.
    id: "credential-phishing-financial-solicitation",
    category: "MCP-CREDENTIAL-PHISHING",
    severity: "critical",
    description: "Server-initiated prompt soliciting a card CVV/CVC, SSN, or card/bank PIN (financial phishing)",
    target: "prompt_content",
    patterns: [
      solicits("\\bcvv2?\\b"),
      solicits("\\bcvc\\b[\\s\\S]{0,20}card|card[\\s\\S]{0,20}\\bcvc\\b"),
      solicits("card[\\s-]*(?:security|verification)[\\s-]*(?:code|value|number)"),
      solicits("social[\\s-]*security[\\s-]*number"),
      solicits("\\bssn\\b"),
      solicits("(?:card|bank|atm|debit|credit)[\\s-]*(?:card[\\s-]*)?pin\\b")
    ],
    remediation: "A server prompted the user to enter a card CVV/CVC, Social Security Number, or card/bank PIN. Almost no legitimate MCP server solicits these via a prompt \u2014 it is a phishing pattern. The request was blocked and a JSON-RPC error returned to the server. Tax-filing, payroll, or healthcare-intake servers are the rare exception that may legitimately elicit an SSN; if you trust such a server, mute via `mcpm guard mute credential-phishing-financial-solicitation`."
  },
  {
    // F10 credential-egress DLP. A high-confidence credential appearing in a TOOL
    // RESPONSE is a data-loss signal — a compromised/buggy server leaking secrets,
    // or a tool returning a .env / key file through its output.
    //
    // WARN-tier (severity high → forward + log, NOT block): a secrets-manager or
    // auth tool legitimately returns credentials, and tools returning docs/code
    // carry EXAMPLE keys — so blocking would break legit flows. Promote-to-block is
    // opt-in per-server via policy. (This overrides the ROADMAP's "deny-tier only"
    // on the same benign-corpus evidence that a full-registry sweep gave the Tier-1
    // scanner: match real shapes, warn don't break.)
    //
    // FP discipline (the 2026-07 "Bearer token" phrase lesson applies directly):
    // ONLY prefix-anchored STRUCTURAL credential shapes are here — they cannot
    // match prose. AWS's literal docs key (AKIAIOSFODNN7EXAMPLE) is excluded.
    // Generic Bearer is now covered separately by `generic-bearer-token-disclosure`
    // below (TODOS #53). Bare JWT / 40-char base64 (no distinctive prefix at all,
    // not even a "Bearer " anchor) remain the SUSPECT tier and are still DEFERRED —
    // they false-positive on legitimate auth tools that return a token the user
    // asked for. `redact: true` keeps the caught secret out of the event log and
    // the warning message.
    id: "credential-egress-in-response",
    category: "MCP-CREDENTIAL-EXFIL",
    severity: "high",
    description: "High-confidence credential material in a tool response (credential egress / DLP)",
    target: "tool_response",
    redact: true,
    patterns: [
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
      /\bgh[pousr]_[A-Za-z0-9]{30,}/,
      // GitHub fine-grained PAT — a distinct `github_pat_` prefix the `gh[pousr]_`
      // pattern does not cover (gh + p/o/u/s/r, not "github").
      /\bgithub_pat_[A-Za-z0-9_]{40,}/,
      // GitLab personal/project/group access token = `glpat-` + exactly 20
      // base64url chars. Exact length + a trailing non-token assertion (not `{20,}`)
      // so a `glpat-`-prefixed multi-word kebab slug in prose can't match — while
      // still accepting the `-`/`_` a real 20-char token body may contain.
      /\bglpat-[A-Za-z0-9_-]{20}(?![A-Za-z0-9_-])/,
      /\bsk-ant-[A-Za-z0-9_-]{80,}/,
      /\bsk-(?:proj-)?[A-Za-z0-9]{40,}/,
      // Stripe live/test secret + restricted keys (underscore prefix, so the
      // hyphen-anchored sk- above does not match them).
      /\b[sr]k_(?:live|test)_[A-Za-z0-9]{20,}/,
      /\bxox[baprs]-[0-9A-Za-z-]{10,}/,
      /\bnpm_[A-Za-z0-9]{36}\b/,
      /\bAIza[0-9A-Za-z_-]{35}\b/,
      // AWS access key id — exclude AWS's documentation example keys (there are
      // several, all AKIA + a 16-char body ending in EXAMPLE, e.g.
      // AKIAIOSFODNN7EXAMPLE / AKIAI44QH8DHBEXAMPLE) so a tool returning AWS
      // docs/tutorials doesn't warn. A real key ending in "EXAMPLE" is ~2^-93.
      /\bAKIA(?![0-9A-Z]{9}EXAMPLE\b)[0-9A-Z]{16}\b/
    ],
    remediation: "A tool response contained high-confidence credential material (private key, cloud/API token). This is a credential-egress (DLP) signal \u2014 a server may be leaking secrets through tool output. The response was forwarded with a warning and the secret is redacted in the log. If this tool legitimately returns credentials (e.g. a secrets manager), promote-to-block is opt-in per policy, or mute via `mcpm guard mute credential-egress-in-response`."
  },
  {
    // TODOS #53 — the deferred "suspect tier" from the comment above, now
    // motivated by a real CVE: CVE-2026-25650 (smn2gnt/MCP-Salesforce
    // `get_record`) passes a caller-supplied `object_name` into
    // `getattr(sf_client.sf, object_name)` unchecked; `object_name="headers"`
    // returns the live Salesforce client's `Authorization: Bearer <session
    // token>` header dict verbatim in the tool's own response text (CVSS 7.5).
    // Verified against shipped 0.30.0: scored `pass`, no findings.
    //
    // A generic "Bearer <token>" shape has no distinctive prefix (unlike the
    // sibling entry's gh_/sk-/AKIA patterns), so it is lower-confidence and
    // gets its OWN signature id — muteable independently of the always-safe
    // prefix-anchored patterns above. Severity stays `high` (→ warn, same
    // "forward + log, don't block" tier), because this is exactly the shape
    // that produced the 2026-07 registry sweep's 164 CRITICAL "Bearer token"
    // false positives on documentation prose (see scanner/patterns.ts's
    // `SECRET_PATTERNS` "Bearer token" entry, src/scanner/patterns.test.ts's
    // "sweep 2026-07" suite). Pattern reused VERBATIM from that
    // already-corpus-validated fix rather than reinvented: it requires a
    // real-looking credential after "Bearer " — >=20 token chars AND at least
    // one digit — which the English phrase "Bearer token" / "Bearer
    // credential" (short, no digits) and multi-word prose (spaces break the
    // token) cannot satisfy, while a real JWT or opaque session token can.
    //
    // Deliberately NOT extended to bare JWTs or generic 40-char base64 with no
    // "Bearer " anchor — the CVE's own PoC only needs the Bearer-prefixed
    // shape, and those two carry meaningfully higher FP risk (base64 blobs are
    // common in ordinary responses) with no concrete CVE motivating them yet.
    //
    // KNOWN, ACCEPTED GAP: the CVE's own PoC token is a real Salesforce session
    // id, shaped `<15-char org id>!<signature>`. An earlier version of this
    // pattern added `!` to the reused character class specifically to match
    // that literal shape. A pre-merge adversarial review measured that
    // widening (not just read it) and found it FALSE-POSITIVES on real benign
    // text the un-widened, registry-sweep-validated pattern never matched:
    // webpack's loader-chaining syntax (`Bearer style-loader!css-loader!v2`),
    // a PEP-440-style version string immediately after the word "Bearer", and
    // — the closest parallel to the sibling signature's own AWS
    // `AKIAIOSFODNN7EXAMPLE` carve-out — Salesforce's OWN documentation
    // explaining the `<org-id>!<signature>` token FORMAT with an example
    // token, which is prose about a shape, not a leaked secret. None of these
    // are in the tiny 6-7 phrase benign corpus this signature was tested
    // against, which is exactly the "corpus tests the wrong slice of the
    // input space" lesson TODOS #52's own review already logged for this
    // detector family. The `!` was REMOVED rather than patched around it (same
    // choice as TODOS #56/#57: prefer a narrower, unmodified, already-validated
    // pattern over an unmeasured widening). Accepted cost, stated plainly: the
    // CVE's own literal PoC token (with `!`) now scores `pass` against this
    // signature — see TODOS #53's writeup. The signature still generalizes to
    // any OTHER Bearer-disclosed JWT or opaque session token, which is the
    // majority shape this class of vulnerability takes outside Salesforce's
    // own token format.
    //
    // Overlap, not a bug: a vendor-prefixed token disclosed with a literal
    // "Bearer " prefix (e.g. `Bearer ghp_...`) matches BOTH this signature and
    // the sibling `credential-egress-in-response` above — two findings for one
    // secret. Both are correctly redacted and both resolve to the same `warn`
    // action, so this is redundant signal (two remediation lines instead of
    // one), not incorrect signal. Not scoped away deliberately: doing so would
    // require this signature to hardcode (and keep in sync with) every vendor
    // prefix the sibling signature knows about, which is more state than the
    // noise it would save.
    id: "generic-bearer-token-disclosure",
    category: "MCP-CREDENTIAL-EXFIL",
    severity: "high",
    description: "A generic Bearer-prefixed credential (typically no distinctive vendor prefix) in a tool response",
    target: "tool_response",
    redact: true,
    // The trailing two assertions are a TRUNCATION-MARKER suppression, added
    // after a measured FP: API documentation writes `Authorization: Bearer
    // eyJhbGciOiJIUzI1NiIs...` to show the header's shape, and `.` is inside the
    // token class, so the elided sample read as a live credential (found in a
    // public third-party skill file, 2026-09-19).
    //   (?![A-Za-z0-9._~+/=-])  forces the token run to be MAXIMAL. Without it
    //     the engine simply backtracks off the dots and matches the prefix, which
    //     is why a bare lookbehind on its own does nothing here.
    //   (?<!\.\.\.)              rejects a run ending in an ellipsis.
    // U+2026 needs NO clause of its own: `normalizeSegment` NFKC-normalizes every
    // leaf before matching, and NFKC folds U+2026 to the three ASCII periods the
    // lookbehind already rejects. A dedicated `(?!\u2026)` was written, measured
    // to be unreachable (deleting it left the whole suite green), and DELETED
    // rather than left in with a test that cannot fail — the v0.31.0 unpinned-
    // pattern lesson. The U+2026 case is still pinned, through this lookbehind.
    // A single trailing period is sentence punctuation, not truncation, and is
    // deliberately still matched. Measured before shipping: over 385 files of a
    // 200-skill public corpus the one documentation FP goes 1 -> 0, and over all
    // 86 guard fixtures the one attack that fires this signature still fires
    // (1 -> 1). Cost stated plainly: a real credential that genuinely ends in
    // "..." now passes this signature.
    patterns: [/Bearer\s+(?=[A-Za-z0-9._~+/=-]{20,})[A-Za-z0-9._~+/=-]*[0-9][A-Za-z0-9._~+/=-]*(?![A-Za-z0-9._~+/=-])(?<!\.\.\.)/],
    remediation: "A tool response contained a generic `Bearer <token>` credential (e.g. an OAuth session token or API bearer token, typically with no distinctive vendor prefix). CVE-2026-25650 (MCP-Salesforce `get_record`) reaches this general shape: an unchecked argument lets a caller read the live client's own `Authorization` header back through the tool's response. This is a lower-confidence heuristic than the prefix-anchored credential signature above \u2014 it was forwarded with a warning and the secret is redacted in the log. If this tool legitimately returns bearer tokens (e.g. an OAuth helper), mute via `mcpm guard mute generic-bearer-token-disclosure`."
  },
  {
    // F5 — STRUCTURAL exfil-param detector. The finding is emitted by
    // detectExfilParams (a property-KEY walker over tools/list inputSchemas, NOT a
    // content regex), so this catalog entry carries NO patterns. It exists only so
    // the id is recognized by `guard mute exfil-param-in-schema`, `guard
    // list-signatures`, and policy signature_overrides — all of which enumerate
    // OWASP_MCP_TOP_10 ids. `inspectAgainstSignatures` safely no-ops on an empty
    // patterns array (its inner pattern loop never runs). (The
    // hidden-chars-in-metadata entry below uses this same empty-patterns pattern.)
    id: "exfil-param-in-schema",
    category: "OWASP-MCP-1",
    severity: "critical",
    description: "Tool input schema declares a context-exfiltration sigil parameter (e.g. _system_prompt_) the model auto-fills",
    target: "tool_description",
    patterns: [],
    remediation: "A tool's input schema declares a parameter named like a context-exfiltration sigil (e.g. `_system_prompt_`) that the model would silently auto-fill \u2014 a zero-interaction prompt leak. No legitimate tool names a parameter this way. The server's whole tools/list was blocked. Tripwire for the documented underscore-sigil convention; a renamed param evades it. If trusted, mute via `mcpm guard mute exfil-param-in-schema`."
  },
  {
    // guard-inspection-truncated — emitted by inspectMessage when stringLeaves
    // hits MAX_LEAF_WALK_NODES on a carrier, i.e. the guard did NOT finish
    // reading that frame. Synthesized from a walk-budget signal, not a content
    // regex, so like the two entries above it carries NO patterns. The entry
    // exists so the id is recognized by `guard mute guard-inspection-truncated`
    // (which refuses ids outside this catalog — F7), `guard list-signatures`,
    // and policy signature_overrides.
    //
    // `critical` is deliberate: it rides the normal carrier policy, so it BLOCKS
    // on block-capable carriers (an uninspected payload would otherwise reach
    // the model pre-invocation) and defaultActionForFinding clamps it to warn on
    // retrieved-data carriers. Budget exhaustion used to fail OPEN, which was a
    // complete detection bypass — ~73 KB of junk padding hid a critical
    // injection. (security 2026-07-25)
    id: "guard-inspection-truncated",
    category: "MCP-GUARD-INTEGRITY",
    severity: "critical",
    description: "The frame exceeded the inspection walk budget, so part of it was never scanned (padding is a known way to hide a payload)",
    target: "tool_response",
    patterns: [],
    remediation: "The frame was too large to inspect completely, so the guard cannot vouch for it \u2014 padding a response with junk nodes is a known way to hide a payload behind the budget. Inspect the server's output by hand. If this server legitimately emits frames this large, mute via `mcpm guard mute guard-inspection-truncated`."
  },
  {
    // hidden-chars-in-metadata — the H2 PRESENCE detector (detectHiddenChars in
    // patterns.ts) emits this finding INLINE from a codepoint scan of raw metadata
    // leaves, NOT a content regex, so like exfil-param-in-schema above it carries NO
    // patterns. The entry exists only so the id is recognized by `guard mute
    // hidden-chars-in-metadata` (the block message instructs exactly that),
    // `guard list-signatures`, and policy signature_overrides — all of which
    // enumerate OWASP_MCP_TOP_10 ids. `inspectAgainstSignatures` no-ops on the empty
    // patterns array. Keep `patterns: []`: a regex here would double-fire alongside
    // the detectHiddenChars emission.
    id: "hidden-chars-in-metadata",
    category: "OWASP-MCP-1",
    severity: "high",
    description: "Invisible/control characters in tool metadata (description, title, inputSchema text, annotations) that hide content from human review",
    target: "tool_description",
    patterns: [],
    remediation: "Tool metadata contains invisible/control characters that hide content from human review (tool-poisoning indicator). Inspect the server's source; if legitimate (rare), mute via `mcpm guard mute hidden-chars-in-metadata`."
  },
  {
    // TODOS #50 — shell-metachar-in-identifier-arg. STRUCTURAL key+value
    // detector (detectShellMetacharArgs in shell-metachar-args.ts), NOT a
    // content regex — like exfil-param-in-schema and guard-inspection-truncated
    // above, this entry carries NO patterns and exists only so the id is
    // recognized by `guard mute shell-metachar-in-identifier-arg`, `guard
    // list-signatures`, and policy signature_overrides. `inspectAgainstSignatures`
    // no-ops on the empty patterns array.
    id: "shell-metachar-in-identifier-arg",
    category: "MCP-COMMAND-INJECTION",
    severity: "critical",
    description: "A tools/call argument named like a bare identifier or path contains shell-metacharacter / command-substitution syntax (CVE-2025-53818, CVE-2026-25546 shape)",
    target: "tool_call_args",
    patterns: [],
    remediation: "A tool call argument named like a bare identifier or filesystem path (an id, number, path, slug, uuid, or namespace field) contains shell-metacharacter or command-substitution syntax ($(...), a backtick, ;, or &&). Two real, disclosed CVEs reach command injection through exactly this shape \u2014 the value is spliced unescaped into a shell command. The call was blocked. If this tool legitimately accepts shell syntax in this field, mute via `mcpm guard mute shell-metachar-in-identifier-arg`."
  },
  {
    // TODOS #51 — query-control-syntax-in-identifier-arg. STRUCTURAL key+value
    // detector (detectQueryControlArgs in query-control-args.ts), same shape
    // as shell-metachar-in-identifier-arg above — this entry carries NO
    // patterns and exists only so the id is recognized by `guard mute
    // query-control-syntax-in-identifier-arg`, `guard list-signatures`, and
    // policy signature_overrides.
    id: "query-control-syntax-in-identifier-arg",
    category: "MCP-QUERY-INJECTION",
    severity: "critical",
    description: "A tools/call argument named like a bare table/column/database name contains query-language control syntax (CVE-2026-33980 shape)",
    target: "tool_call_args",
    patterns: [],
    remediation: "A tool call argument named like a bare table, column, database, schema, or resource identifier contains query-control syntax (a pipe re-scoping operator, a statement separator before a DDL/DML keyword, a `.drop` management command, or a line-comment token). A real, disclosed CVE reaches data exfiltration and destructive table drops through exactly this shape. If this tool legitimately accepts query syntax in this field, mute via `mcpm guard mute query-control-syntax-in-identifier-arg`."
  },
  {
    // TODOS #52 — cli-flag-injection-in-identifier-arg. STRUCTURAL key+value
    // detector (detectCliFlagInjectionArgs in cli-flag-injection-args.ts), same
    // shape as shell-metachar-in-identifier-arg / query-control-syntax-in-
    // identifier-arg above — this entry carries NO patterns and exists only so
    // the id is recognized by `guard mute cli-flag-injection-in-identifier-arg`,
    // `guard list-signatures`, and policy signature_overrides.
    id: "cli-flag-injection-in-identifier-arg",
    category: "MCP-ARGUMENT-INJECTION",
    severity: "critical",
    description: "A tools/call argument named like a bare namespace or opaque identifier contains an embedded `--`-prefixed CLI flag token (CVE-2026-39884 shape)",
    target: "tool_call_args",
    patterns: [],
    remediation: "A tool call argument named like a bare namespace or opaque identifier contains a `--`-prefixed CLI flag token (e.g. `--address=0.0.0.0`). A real, disclosed CVE reaches this shape when the argument is whitespace-split into a shell command, letting the embedded flag override intended behavior. If this tool legitimately accepts flag-shaped text in this field, mute via `mcpm guard mute cli-flag-injection-in-identifier-arg`."
  },
  {
    // tool-name-confusable-duplicate / tool-name-deceptive-characters — emitted by
    // detectConfusableToolNames (tool-name-confusable.ts) from a NAME comparison,
    // not the regex engine, so like the structural entries above these carry NO
    // patterns and exist so the ids are recognized by `guard mute`,
    // `guard list-signatures`, and policy signature_overrides.
    id: "tool-name-confusable-duplicate",
    category: "OWASP-MCP-1",
    severity: "high",
    description: "One tools/list advertises two tools whose names are visually indistinguishable after Unicode normalization (TODOS #58 look-alike residual)",
    target: "tool_description",
    patterns: [],
    remediation: "This server advertises two tools whose names differ only by case, an invisible character, or a homoglyph \u2014 the shape used to smuggle a poisoned definition past a same-session drift check by making it look like a brand-new tool. Confirm with the publisher that BOTH tools are intended; if not, remove the server. If this server legitimately ships such a pair, mute via `mcpm guard mute tool-name-confusable-duplicate`."
  },
  {
    id: "tool-name-deceptive-characters",
    category: "OWASP-MCP-1",
    severity: "high",
    description: "A tool name contains an invisible character, or mixes Latin with another script \u2014 the out-of-table homoglyph class the confusable table cannot fold",
    target: "tool_description",
    patterns: [],
    remediation: "A tool name contains an invisible character (zero-width, bidi, Unicode TAG), or mixes Latin letters with letters from another script. Both are ways to build a name that looks identical to a trusted tool's, and neither is folded by the guard's scoped confusable table. A name written wholly in one non-Latin script impersonates nothing and is NOT flagged. Report it to the server's publisher. If this server legitimately uses such names, mute via `mcpm guard mute tool-name-deceptive-characters`."
  },
  {
    // unicode-tag-concealment — the tag-block PRESENCE floor on the carriers H2
    // deliberately skips (tool_response / tool_call_args / retrieved data, and
    // sampling_prompt by re-tagging). Emitted inline by detectTagConcealment from
    // a codepoint scan, so like the entries above it carries NO patterns.
    //
    // Disjoint from hidden-chars-in-metadata by carrier, so a tag character is
    // reported once, under whichever id matches where it was found. `high` → warn:
    // this is the floor that fires when a payload is concealed but matches no
    // signature. When it DOES match, inspectTagEncoded recovers the payload and the
    // real signature decides the action at its own severity. (TODOS #31)
    id: "unicode-tag-concealment",
    category: "OWASP-MCP-1",
    severity: "high",
    description: "Unicode tag-block characters (U+E0000\u2013U+E007F) outside an emoji subdivision flag \u2014 invisible text a model can still read ('ASCII smuggling')",
    target: "tool_response",
    patterns: [],
    remediation: "Content contains Unicode tag-block characters (U+E0000\u2013U+E007F), which render as nothing but are readable by a model \u2014 the documented 'ASCII smuggling' concealment technique. Outside an emoji subdivision flag these do not occur in real text. Inspect the server's output; if legitimate (rare), mute via `mcpm guard mute unicode-tag-concealment`."
  },
  {
    // TODOS #54 — renderer-code-execution-in-response. See the
    // ELECTRON_MCP_BRIDGE_CALL comment above for the full CVE grounding, the
    // pre-merge adversarial review's 28 findings, and why this gate is
    // narrower than an earlier draft. Three structural shapes share one
    // signature id, all requiring the SAME literal bridge-call gate:
    //
    //  1. An HTML tag with an inline event-handler attribute (a generic
    //     `\son[a-z]+\s*=`, not an enumerated handler list — HTML has no
    //     non-event `on*` attribute, and this closes a review-found gap where
    //     `onmouseout`/`onblur`/etc. weren't on the original enumerated list)
    //     whose VALUE contains the bridge call — the CVE-2025-68669 shape.
    //     Value-scoped via a lookahead so the token must be INSIDE the
    //     attribute's own value; the bare/unquoted branch additionally
    //     requires `(?!["'])` so it cannot fall through past a real quoted
    //     value into an ADJACENT attribute when the two abut with no
    //     separating whitespace (review-found regex-correctness bug).
    //  2. A <script>...<\/script> block whose body (bounded to 2000 chars,
    //     never crossing a closing <\/script>) contains the bridge call. The
    //     tag-open matcher is quote-aware (`(?:"[^"]*"|'[^']*'|[^>"'])*`) so a
    //     literal `>` inside a quoted attribute value can't be mistaken for
    //     the tag's own close and misalign where the 2000-char body budget
    //     starts counting from (review-found: this could push a real call
    //     just past the budget, causing a missed detection).
    //  3. A markdown code fence tagged `mermaid` or `echarts` (the two plugin
    //     types both disclosed CVEs abuse) containing the bridge call
    //     ANYWHERE in the fence body — the CVE-2026-22793 shape. An earlier
    //     draft instead matched `new Function(`/IIFE syntax with NO call
    //     gate, on the premise that legitimate diagram/option content never
    //     contains a function definition; the review found that premise FALSE
    //     for ECharts specifically (formatter callbacks persisted via
    //     `new Function(...)`, option data computed via an IIFE, are both
    //     standard documented idioms) and, independently, that requiring
    //     IIFE/`new Function(` syntax at all was unnecessarily narrow: the
    //     vulnerable `parseOption` wraps the ENTIRE fence body in
    //     `new Function('return {' + body + '}')()`, so a bridge call placed
    //     directly as an object-literal property value (no wrapper at all)
    //     executes identically. Requiring only the bridge call is both safer
    //     (fixes the ECharts false-positive class) and strictly more complete.
    //
    // All three regexes use bounded lazy quantifiers ({0,4000}?/{0,2000}?)
    // with a `(?!` "does not cross a fence/tag-close boundary" guard rather
    // than an unbounded `[\s\S]*` scan — measured against multi-hundred-KB
    // adversarial padding (including many non-matching `electron.mcp.`-prefixed
    // near-misses) with no backtracking blowup (sub-millisecond).
    //
    // Severity is `high` (→ warn, forward + log, never block on its own): a
    // documentation/CVE-lookup tool can legitimately return prose QUOTING this
    // exact literal call (a GHSA/NVD advisory explaining the vulnerability) —
    // an accepted, low-frequency residual the review confirmed and this
    // signature does not try to special-case away, the same "ambiguous but
    // real" tier as credential-egress-in-response, and the project's own
    // repeated lesson that a wrong BLOCK on a block-capable carrier is the
    // worse failure direction (v0.29.0 / v0.31.0).
    //
    // `redact: true` — a review finding (not merely FP/evasion) caught that
    // shapes 2-3's lazily-bounded match can capture arbitrary attacker-placed
    // text between the tag/fence open and the bridge call verbatim into the
    // excerpt (e.g. a secret the injected script reads before exfiltrating
    // it), which would otherwise land unredacted in guard-events.jsonl and the
    // public `guard inspect` seam even while a co-firing credential signature
    // on the SAME leaf correctly redacts it — silently defeating the
    // redaction guarantee tool_response carries elsewhere in this file.
    id: "renderer-code-execution-in-response",
    category: "MCP-RENDERER-CODE-EXECUTION",
    severity: "high",
    redact: true,
    description: "HTML/script content in a tool response calling the electron.mcp privileged IPC bridge (CVE-2025-68669, CVE-2026-22793 shape)",
    target: "tool_response",
    patterns: [
      new RegExp(
        `<[a-zA-Z][\\w-]*\\b[^<>]*?\\son[a-z]+\\s*=\\s*(?:"(?=[^"]*(?:${ELECTRON_MCP_BRIDGE_CALL}))[^"]*"|'(?=[^']*(?:${ELECTRON_MCP_BRIDGE_CALL}))[^']*'|(?!["'])(?=[^\\s>]*(?:${ELECTRON_MCP_BRIDGE_CALL}))[^\\s>]*)[^<>]*>`,
        "i"
      ),
      new RegExp(
        `<script\\b(?:"[^"]*"|'[^']*'|[^>"'])*>(?:(?!<\/script>)[\\s\\S]){0,2000}?(?:${ELECTRON_MCP_BRIDGE_CALL})`,
        "i"
      ),
      new RegExp(
        "```\\s*(?:mermaid|echarts)\\b(?:(?!```)[\\s\\S]){0,4000}?(?:" + ELECTRON_MCP_BRIDGE_CALL + ")",
        "i"
      )
    ],
    remediation: "A tool response contained HTML/script content calling the electron.mcp privileged IPC bridge (electron.mcp.activate(...) / electron.mcp.addServer(...)) \u2014 either from an inline HTML event-handler attribute, a <script> body, or a mermaid/echarts diagram fence. Two real, disclosed CVEs (CVE-2025-68669, CVE-2026-22793) reach RCE this way in a vulnerable client renderer. This was forwarded with a warning, not blocked, because a documentation or CVE-lookup tool can legitimately return prose quoting this exact call. If this tool legitimately returns such content, mute via `mcpm guard mute renderer-code-execution-in-response`."
  }
];

// src/guard/inspect-frame.ts
function withReplyToOrigin(result, replyToOrigin) {
  if (replyToOrigin && result.action === "block") return { ...result, replyToOrigin: true };
  return result;
}
function mergeInspect(a, b) {
  const action = ACTION_RANK[a.action] >= ACTION_RANK[b.action] ? a.action : b.action;
  return withReplyToOrigin(
    { action, findings: [...a.findings, ...b.findings] },
    a.replyToOrigin === true || b.replyToOrigin === true
  );
}
function isServerInitiatedMethod(msg) {
  if (!("method" in msg)) return false;
  const m = msg.method;
  return m === "sampling/createMessage" || m === "elicitation/create";
}
function serverInitiatedContent(msg) {
  const params = msg.params;
  if (params === null || typeof params !== "object") return [];
  const p = params;
  const out = [];
  if (typeof p.systemPrompt === "string") out.push(p.systemPrompt);
  if (Array.isArray(p.messages)) {
    for (const m of p.messages) {
      if (m !== null && typeof m === "object" && "content" in m) out.push(m.content);
    }
  }
  if (typeof p.message === "string") out.push(p.message);
  if (p.requestedSchema !== null && typeof p.requestedSchema === "object") out.push(p.requestedSchema);
  return out;
}
function inspectServerInitiated(msg) {
  if (!isServerInitiatedMethod(msg)) return null;
  const contentLeaves = serverInitiatedContent(msg);
  if (contentLeaves.length === 0) return null;
  const synthetic = {
    jsonrpc: "2.0",
    id: 0,
    // dummy — the scan reads only the result subtree, never the id.
    result: { messages: contentLeaves.map((c) => ({ role: "user", content: c })) }
  };
  const scan = inspectMessage(synthetic, OWASP_MCP_TOP_10);
  if (scan.findings.length === 0) return null;
  const findings = scan.findings.map((f) => ({ ...f, target: "sampling_prompt" }));
  const action = worstAction(findings);
  const hasId = "id" in msg && msg.id !== void 0;
  return action === "block" && hasId ? { action, findings, replyToOrigin: true } : { action, findings };
}
function inspectStatelessDetectors(msg) {
  return [
    inspectMessage(msg, OWASP_MCP_TOP_10),
    detectExfilParams(msg),
    detectShellMetacharArgs(msg),
    detectQueryControlArgs(msg),
    detectCliFlagInjectionArgs(msg),
    detectConfusableToolNames(msg)
  ].reduce(mergeInspect);
}
function inspectFrame(msg) {
  const serverInitiated = inspectServerInitiated(msg);
  if (serverInitiated !== null) return serverInitiated;
  return inspectStatelessDetectors(msg);
}

// src/guard/owasp.ts
var OWASP_MCP_TOP_10_REF = "165fe0f78ef104459237b4a8e0f6e78db9b02391";
var OWASP_MCP_TOP_10_URL = `https://github.com/OWASP/www-project-mcp-top-10/tree/${OWASP_MCP_TOP_10_REF}`;
var CONFINE_EVENT_OWASP = {
  "confine-applied": "unpinnable",
  "confine-marker-stripped": "unpinnable",
  "confine-hash-mismatch": "unpinnable",
  "confine-backend-missing": "unpinnable",
  "confine-profile-missing": "unpinnable",
  "confine-marker-malformed": "unpinnable"
};
var _SIGNATURE_OWASP_TABLE = Object.freeze({
  // ── MCP01 — Token Mismanagement & Secret Exposure ─────────────────────────
  "credential-egress-in-response": "MCP01",
  "generic-bearer-token-disclosure": "MCP01",
  // ── MCP02 — Privilege Escalation via Scope Creep ──────────────────────────
  "handshake-drift-capability": "MCP02",
  // ── MCP03 — Tool Poisoning ─────────────────────────────────────────────────
  "owasp-mcp-1-tool-description-injection": "MCP03",
  "owasp-mcp-2-instruction-injection-in-response": "MCP03",
  "hidden-chars-in-metadata": "MCP03",
  "unicode-tag-concealment": "MCP03",
  "exfil-param-in-schema": "MCP03",
  "schema-drift": "MCP03",
  "schema-drift-cosmetic": "MCP03",
  "schema-drift-in-session": "MCP03",
  "owasp-mcp-1-tool-annotation-injection": "MCP03",
  "tool-name-confusable-duplicate": "MCP03",
  "tool-name-deceptive-characters": "MCP03",
  // ── MCP05 — Command Injection & Execution ─────────────────────────────────
  "shell-metachar-in-identifier-arg": "MCP05",
  "query-control-syntax-in-identifier-arg": "MCP05",
  "cli-flag-injection-in-identifier-arg": "MCP05",
  // ── MCP06 — Intent Flow Subversion ─────────────────────────────────────────
  "owasp-mcp-2-instruction-injection-in-resource": "MCP06",
  "owasp-mcp-2-instruction-injection-in-prompt": "MCP06",
  "owasp-mcp-1-initialize-instruction-injection": "MCP06",
  "credential-phishing-wallet-solicitation": "MCP06",
  "credential-phishing-financial-solicitation": "MCP06",
  // ── unknown — not yet classified against OWASP_MCP_TOP_10_REF ─────────────
  // (docs/owasp-mcp-mapping.md "Not yet classified" subsection)
  "owasp-mcp-7-path-exfil-in-args": "unknown",
  "renderer-code-execution-in-response": "unknown",
  // The doc explicitly refuses to count identity drift under MCP07 (anti-
  // impersonation, not authentication/authorization) and does not count it
  // anywhere else.
  "handshake-drift-identity": "unknown",
  // Compares the WHOLE handshake hash (hashHandshake() of BOTH capabilities
  // AND serverName field hashes together — see HandshakeFieldHashes,
  // src/guard/pins.ts) against the same-session baseline, so it fires on
  // EITHER dimension changing, not exclusively capability. Not the clean
  // in-session variant of MCP02 the spec asked to confirm.
  "handshake-drift-in-session": "unknown",
  // ── unpinnable — guard/relay health signals, not an attack class ──────────
  "guard-inspection-truncated": "unpinnable",
  "pins-integrity-failure": "unpinnable",
  "orig-hash-mismatch": "unpinnable",
  "spawn-failure": "unpinnable",
  "inspect-rejected": "unpinnable",
  "malformed-frame": "unpinnable",
  ...CONFINE_EVENT_OWASP
});
function owaspPinFor(signatureId) {
  const state = Object.hasOwn(_SIGNATURE_OWASP_TABLE, signatureId) ? _SIGNATURE_OWASP_TABLE[signatureId] : void 0;
  if (state === void 0 || state === "unknown") {
    return { status: "unknown", ref: OWASP_MCP_TOP_10_REF };
  }
  if (state === "unpinnable") return { status: "unpinnable", ref: OWASP_MCP_TOP_10_REF };
  return { status: "pinned", id: state, ref: OWASP_MCP_TOP_10_REF };
}
export {
  OWASP_MCP_TOP_10_URL,
  inspectFrame,
  owaspPinFor
};

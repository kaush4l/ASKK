// Structured response — the response base class.
//
// A response method is a CONFIGURATION, not engine code:
//
//   const method = new StructuredResponse({
//     id: "my-method",
//     keys: [
//       { key: "thought", description: "the model's reasoning" },
//       { key: "answer", description: "the final answer" },
//     ],
//   });
//   method.generate({ thought: "…", answer: "…" });
//   // "thought: …\nanswer: …" — keys in configuration order.
//
// generate() reads the keys IN ORDER, with their descriptions
// available via describe(). Adding a new response method means
// adding a configuration — no engine change, no new parser.
// parse() reads lines back into values for the configured keys
// (first "key: rest" line per key wins; unconfigured lines are
// kept under the last configured key's continuation, so text is
// never silently dropped — a value that spans lines stays whole).
//
// TOON is one configuration of this base, not a second parser:
// toonResponseMethod() returns a StructuredResponse whose
// generate/parse delegate to toon.js (formatReply/parseReply),
// because TOON's wire shape (repeated call: lines) is not the
// generic one-line-per-key shape. No TOON parsing is duplicated
// here — the delegation is the reuse.

import { formatReply, parseReply } from "./toon.js";

function checkKey(entry, index) {
  if (!entry || typeof entry.key !== "string" || entry.key.trim() === "") {
    throw new Error(`response key ${index} needs a non-empty key name`);
  }
  if (typeof entry.description !== "string" || entry.description.trim() === "") {
    throw new Error(`response key "${entry.key}" needs a description`);
  }
  return { key: entry.key, description: entry.description };
}

function formatValue(value) {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export class StructuredResponse {
  constructor({ id = "response", keys = [] } = {}) {
    if (typeof id !== "string" || id.trim() === "") {
      throw new Error("response method needs an id");
    }
    if (!Array.isArray(keys) || keys.length === 0) {
      throw new Error(`response method "${id}" needs at least one key`);
    }
    const seen = new Set();
    const checked = keys.map(checkKey);
    for (const entry of checked) {
      if (seen.has(entry.key)) {
        throw new Error(`response method "${id}" has two keys named "${entry.key}"`);
      }
      seen.add(entry.key);
    }
    this.id = id;
    this.keys = Object.freeze(checked.map((entry) => Object.freeze({ ...entry })));
  }

  // Keys in configuration order.
  keyNames() {
    return this.keys.map((entry) => entry.key);
  }

  // Each key with its description, in order — what the prompt
  // shows the model so it knows the format.
  describe() {
    return this.keys.map((entry) => `${entry.key}: ${entry.description}`).join("\n");
  }

  // The string response: one "key: value" line per configured
  // key that has a value, IN CONFIGURATION ORDER, regardless of
  // the order the values object lists them. Keys with no value
  // are omitted, never rendered empty.
  generate(values = {}) {
    const lines = [];
    for (const entry of this.keys) {
      const value = values?.[entry.key];
      if (value === undefined || value === null || value === "") continue;
      lines.push(`${entry.key}: ${formatValue(value)}`);
    }
    return lines.join("\n");
  }

  // Read a generated string back into values for the configured
  // keys. A line starting with a configured "key:" starts that
  // key's value; following lines without a configured key are
  // appended to the current key's value, so multi-line values
  // survive. Unknown leading lines (before any key) are dropped
  // — they match no configured key — and the result never
  // invents a key that was not configured.
  parse(text) {
    const out = {};
    if (typeof text !== "string") return out;
    const keySet = new Set(this.keyNames());
    let current = null;
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z0-9_.-]+):\s?(.*)$/);
      if (match && keySet.has(match[1])) {
        current = match[1];
        out[current] = match[2];
        continue;
      }
      if (current !== null) {
        out[current] = `${out[current]}\n${line}`;
      }
    }
    for (const key of Object.keys(out)) {
      out[key] = out[key].trim();
    }
    return out;
  }
}

export function createResponseMethod(configuration) {
  return new StructuredResponse(configuration);
}

// TOON as a configuration of this base. The key order and
// descriptions are the configuration; the wire format (repeated
// call: lines, JSON call inputs) stays in toon.js, delegated to
// here — not re-implemented — so a TOON change lands in one place.
export function toonResponseMethod() {
  const method = new StructuredResponse({
    id: "toon",
    keys: [
      { key: "thought", description: "free-text reasoning before any call" },
      { key: "call", description: "a tool call line: call: <name> {json input}" },
      { key: "answer", description: "the final answer text" },
    ],
  });
  method.generate = (values) => formatReply(values ?? {});
  method.parse = (text) => parseReply(text);
  return method;
}

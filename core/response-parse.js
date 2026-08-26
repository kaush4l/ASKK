/**
 * Reading a model's reply — the TOON and JSON scanners.
 *
 * Split out of `core/response-base.js` only for the 200-line rule; these are
 * the second half of `responses.py` and nothing else may call them.
 *
 * Neither scanner ever throws on shape, only on genuinely invalid JSON: an
 * empty result means "this format was not it", and `BaseResponse.parse` moves
 * on to the next one.
 */

/** @typedef {import("./response-base.js").FieldSpec} FieldSpec */

/** @param {string} text @param {string} chars @returns {string} */
export function ltrimChars(text, chars) {
  let i = 0;
  while (i < text.length && chars.includes(text[i])) i += 1;
  return text.slice(i);
}

/** Python's `str.strip(chars)`, which JavaScript's argument-less `trim` is not.
 * @param {string} text @param {string} chars @returns {string} */
export function trimChars(text, chars) {
  const left = ltrimChars(text, chars);
  let end = left.length;
  while (end > 0 && chars.includes(left[end - 1])) end -= 1;
  return left.slice(0, end);
}

/** The bare word a model meant when it wrote ``**'Tool'**``.
 * @param {string} value @returns {string} */
export function bareWord(value) {
  return trimChars(value.trim(), "'\"`* ").toLowerCase();
}

/** Python's `splitlines`, which does not leave a phantom last line.
 * @param {string} text @returns {string[]} */
export function splitLines(text) {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Split `a, b(c, d), e` on top-level commas only.
 * @param {string} inner @returns {string[]} */
export function splitItems(inner) {
  /** @type {string[]} */
  const items = [];
  let current = "";
  let depth = 0;
  for (const char of inner) {
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    if (char === "," && depth === 0) {
      items.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current) items.push(current.trim());
  return items.filter((item) => item);
}

/** Coerce a field value to a list: `[a, b]`, or one item per line.
 * @param {string} value @returns {string[]} */
export function asList(value) {
  const text = value.trim();
  if (text.startsWith("[") && text.endsWith("]")) return splitItems(text.slice(1, -1).trim());
  if (!text) return [];
  return splitLines(text)
    .filter((line) => line.trim())
    .map((line) => line.replace(/^\s*(\d+[.)]|[-*])\s*/, "").trim());
}

/** @param {readonly FieldSpec[]} fields @param {string} text @returns {Record<string, unknown>} */
export function parseJson(fields, text) {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) return coerceJson(fields, JSON.parse(text.slice(start, i + 1)));
    }
  }
  return {};
}

/** @param {readonly FieldSpec[]} fields @param {Record<string, unknown>} data @returns {Record<string, unknown>} */
function coerceJson(fields, data) {
  const known = new Map(fields.map((f) => [f.name, f]));
  if (!Object.keys(data).some((key) => known.has(key))) return {};
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    // a model may write a list field as one string — coerce it
    const field = known.get(key);
    out[key] = field?.list && typeof value === "string" ? asList(value) : value;
  }
  return out;
}

/** Two-pass parse: locate field lines, then take everything up to the next one.
 * @param {readonly FieldSpec[]} fields @param {string} text @returns {Record<string, unknown>} */
export function parseToon(fields, text) {
  const lines = splitLines(text);
  const starts = fieldLines(fields, lines);
  /** @type {Record<string, unknown>} */
  const data = {};
  for (let i = 0; i < starts.length; i += 1) {
    const [start, name, firstLine] = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1][0] : lines.length;
    const block = (firstLine ? [firstLine] : []).concat(lines.slice(start + 1, end));
    const value = block.join("\n").trim();
    data[name] = fields.find((f) => f.name === name)?.list ? asList(value) : value;
  }
  return data;
}

/** @param {readonly FieldSpec[]} fields @param {string[]} lines @returns {[number, string, string][]} */
function fieldLines(fields, lines) {
  const known = new Set(fields.map((f) => f.name));
  /** @type {[number, string, string][]} */
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const at = line.indexOf(":");
    if (at < 0) continue;
    const key = line.slice(0, at);
    let value = line.slice(at + 1);
    const cleaned = trimChars(key.replace(/^[\s\-*#\d.]+/, ""), "*` ").trim().toLowerCase();
    if (!known.has(cleaned)) continue;
    // `**Thinking:** text` leaves the closing marker on the value — drop it,
    // but only when the key itself was decorated, so a real `*` bullet survives.
    if (/[*`]/.test(key)) value = ltrimChars(value, "*` ");
    starts.push([index, cleaned, value.trim()]);
  }
  return starts;
}

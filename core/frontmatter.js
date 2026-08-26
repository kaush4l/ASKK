/**
 * YAML frontmatter for agent and skill files — the subset those files use.
 *
 * The Python called `yaml.safe_load`. There is no YAML parser in a browser, and agent
 * files are edited by the user at runtime, so the parse has to happen in the page
 * (PORT-MAP R7). Supported: scalars quoted and bare, inline lists `[a, b]`, block lists,
 * nested block mappings, `#` comments, blank lines, and the YAML 1.2 core scalars — which
 * is why `yes` and `on` stay the strings they look like. Anything else is a parse error
 * naming the line.
 *
 * **This is not a YAML implementation and must never grow into one.** Anchors, aliases, block
 * scalars, tags, multiple documents: a file needing one of those is the wrong file.
 */

/** Lists and mappings hold `unknown` rather than `YamlValue`: a TypeScript 5.9 JSDoc typedef may
 * not reference itself at all, where a `.ts` `type` alias may. Callers narrow what they read. */
/** @typedef {null | boolean | number | string | unknown[] | { [key: string]: unknown }} YamlValue */
/** @typedef {{ n: number, indent: number, text: string }} Line */
/** @typedef {{ items: Line[], i: number, source: string }} Cursor */

/** Malformed frontmatter. Thrown, not returned: an agent file is config, and a bad one cannot run. */
export class FrontmatterError extends Error {
  /** @param {string} message */
  constructor(message) { super(message); this.name = "FrontmatterError"; }
}

/** Split agent file text into (metadata, system message). Throws on missing or malformed
 * frontmatter — a silently empty config would only surface later as a confusing bad model call.
 * @param {string} text @param {string} [source] @returns {{ metadata: Record<string, YamlValue>, body: string }} */
export function parseAgentFile(text, source = "<string>") {
  if (!text.startsWith("---")) throw new FrontmatterError(`${source}: missing YAML frontmatter (file must start with '---')`);
  const rest = text.slice(3);
  const fence = rest.indexOf("\n---");
  if (fence === -1) throw new FrontmatterError(`${source}: unterminated YAML frontmatter (no closing '---')`);
  return { metadata: parseYaml(rest.slice(0, fence), source), body: rest.slice(fence + 4).trim() };
}

/** @param {string} src @param {string} source @returns {Record<string, YamlValue>} */
function parseYaml(src, source) {
  const items = scan(src, source);
  if (items.length === 0) return {};
  const cursor = { items, i: 0, source };
  const bare = bareValue(cursor, items[0]);
  if (bare) throw new FrontmatterError(`${source}: frontmatter must be a YAML mapping, got ${bare}`);
  const map = parseMap(cursor, items[0].indent);
  if (cursor.i < items.length) throw fail(cursor, items[cursor.i].n, "expected 'key: value'");
  return map;
}

/** Blank lines and whole-line comments never reach the parser, so every line it sees must mean something. @param {string} src @param {string} source @returns {Line[]} */
function scan(src, source) {
  const out = /** @type {Line[]} */ ([]);
  const raw = src.split("\n");
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i].replace(/\r$/, "");
    const text = line.trim();
    if (text === "" || text.startsWith("#")) continue;
    if (line.startsWith("\t")) throw new FrontmatterError(`${source}:${i + 1}: a tab may not indent YAML`);
    out.push({ n: i + 1, indent: line.length - line.trimStart().length, text });
  }
  return out;
}

/** The YAML type name of frontmatter that is a value rather than a mapping — `- a` is a list,
 * `hello` a string, `false` a boolean, `~` null — because a person reads this, and the Python
 * named the type too. Refusing the falsy ones at all is D-3. "" for a key line, which is the
 * ordinary parse's to take from here. @param {Cursor} c @param {Line} it @returns {string} */
function bareValue(c, it) {
  if (isDash(it.text)) return "list";
  if (it.text.indexOf(": ") > 0 || (it.text.length > 1 && it.text.endsWith(":"))) return "";
  const value = parseScalar(c, it.n, it.text);
  return Array.isArray(value) ? "list" : value === null ? "null" : typeof value;
}

/** @param {Cursor} c @param {number} indent @returns {Record<string, YamlValue>} */
function parseMap(c, indent) {
  const map = /** @type {Record<string, YamlValue>} */ ({});
  while (c.i < c.items.length) {
    const it = c.items[c.i];
    if (it.indent < indent || isDash(it.text)) break;
    if (it.indent > indent) throw fail(c, it.n, "unexpected indentation");
    const { key, rest } = splitKey(c, it);
    c.i++;
    map[key] = rest === "" ? parseNested(c, indent) : parseScalar(c, it.n, rest);
  }
  return map;
}

/** The value of a `key:` with nothing after it: whatever is indented under it, or null. @param {Cursor} c @param {number} indent @returns {YamlValue} */
function parseNested(c, indent) {
  const next = c.i < c.items.length ? c.items[c.i] : null;
  if (!next || next.indent < indent) return null;
  // A sequence may sit at its parent key's own indentation; a mapping may not.
  if (next.indent === indent) return isDash(next.text) ? parseSeq(c, indent) : null;
  return isDash(next.text) ? parseSeq(c, next.indent) : parseMap(c, next.indent);
}

/** @param {Cursor} c @param {number} indent @returns {YamlValue[]} */
function parseSeq(c, indent) {
  const out = /** @type {YamlValue[]} */ ([]);
  while (c.i < c.items.length) {
    const it = c.items[c.i];
    if (it.indent !== indent || !isDash(it.text)) break;
    if (it.text === "-") throw fail(c, it.n, "a list item must carry its value on the same line");
    const item = it.text.slice(2).trim();
    const quoted = item[0] === '"' || item[0] === "'";
    if (!quoted && item.includes(": ")) throw fail(c, it.n, "a list of mappings is outside this subset");
    c.i++;
    out.push(parseScalar(c, it.n, item));
  }
  return out;
}

/** @param {Cursor} c @param {Line} it @returns {{ key: string, rest: string }} */
function splitKey(c, it) {
  if (it.text[0] === '"' || it.text[0] === "'") {
    const [key, after] = readQuoted(c, it.n, it.text);
    if (!after.startsWith(":")) throw fail(c, it.n, "expected ':' after a quoted key");
    return { key, rest: after.slice(1).trim() };
  }
  const at = it.text.indexOf(": ");
  if (at > 0) return { key: it.text.slice(0, at).trim(), rest: it.text.slice(at + 2).trim() };
  if (it.text.length > 1 && it.text.endsWith(":")) return { key: it.text.slice(0, -1).trim(), rest: "" };
  throw fail(c, it.n, "expected 'key: value'");
}

/** @param {Cursor} c @param {number} n @param {string} rest @returns {YamlValue} */
function parseScalar(c, n, rest) {
  if (rest.startsWith("[")) return parseInline(c, n, rest);
  if ("{>|".includes(rest[0])) throw fail(c, n, "a flow mapping or block scalar is outside this subset");
  if (rest[0] === '"' || rest[0] === "'") {
    const [value, after] = readQuoted(c, n, rest);
    if (uncomment(after).trim() !== "") throw fail(c, n, "unexpected text after a quoted value");
    return value;
  }
  return coerce(uncomment(rest).trim());
}

/** @param {Cursor} c @param {number} n @param {string} rest @returns {YamlValue[]} */
function parseInline(c, n, rest) {
  const parts = /** @type {string[]} */ ([]);
  let cur = "", i = 1;
  for (; i < rest.length && rest[i] !== "]"; i++) {
    const ch = rest[i];
    if (ch === '"' || ch === "'") {
      const [, after] = readQuoted(c, n, rest.slice(i));
      const width = rest.length - i - after.length;
      cur += rest.slice(i, i + width);
      i += width - 1;
    } else if (ch === "[" || ch === "{") throw fail(c, n, "a nested flow collection is outside this subset");
    else if (ch === ",") {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (rest[i] !== "]") throw fail(c, n, "unterminated inline list");
  if (uncomment(rest.slice(i + 1)).trim() !== "") throw fail(c, n, "unexpected text after an inline list");
  if (parts.length === 0 && cur.trim() === "") return [];
  parts.push(cur);
  return parts.map((part) => parseScalar(c, n, part.trim()));
}

/** @param {Cursor} c @param {number} n @param {string} s @returns {[string, string]} */
function readQuoted(c, n, s) {
  let out = "";
  for (let i = 1; i < s.length; i++) {
    const ch = s[i];
    if (s[0] === "'") {
      if (ch !== "'") out += ch;
      else if (s[i + 1] === "'") (out += "'"), i++;
      else return [out, s.slice(i + 1)];
    } else if (ch === "\\") out += ESCAPES[s[++i]] ?? bad(c, n, s[i]);
    else if (ch === '"') return [out, s.slice(i + 1)];
    else out += ch;
  }
  throw fail(c, n, "unterminated quoted string");
}

const ESCAPES = /** @type {Record<string, string>} */ ({ n: "\n", t: "\t", r: "\r", "0": "\0", '"': '"', "\\": "\\", "/": "/" });

/** @param {Cursor} c @param {number} n @param {string | undefined} ch @returns {never} */
function bad(c, n, ch) { throw fail(c, n, `unsupported escape '\\${ch ?? ""}'`); }

/** YAML 1.2 core schema: `yes`, `no`, `on`, `off` are strings, and only these spellings are not. @param {string} s @returns {YamlValue} */
function coerce(s) {
  if (s === "" || s === "~" || s === "null" || s === "Null" || s === "NULL") return null;
  if (s === "true" || s === "True" || s === "TRUE") return true;
  if (s === "false" || s === "False" || s === "FALSE") return false;
  if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  return s;
}

/** A `#` opens a comment only at the start or after a space — `a#b` is the string it looks like. @param {string} s @returns {string} */
const uncomment = (s) => (s.search(/(^|\s)#/) === -1 ? s : s.slice(0, s.search(/(^|\s)#/)));

/** @param {string} text @returns {boolean} */
const isDash = (text) => text === "-" || text.startsWith("- ");

/** @param {Cursor} c @param {number} n @param {string} message @returns {FrontmatterError} */
const fail = (c, n, message) => new FrontmatterError(`${c.source}:${n}: ${message}`);

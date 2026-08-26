/**
 * Python's `str()`, `repr()` and truthiness, for values the model reads back.
 *
 *     pyStr(["a", "b"])          -> [ 'a', 'b' ]  (Python's list repr)
 *     pyStr({ goal: "x" })       -> {'goal': 'x'}
 *     pyStrOr(0)                 -> ""            (`str(value or "")`)
 *
 * Three places interpolate an arbitrary JSON value into a string the model then
 * reads: the sub-agent goal rescue (`tools.py:98`), the no-calls-found error
 * (`tools.py:267`) and a list answer field (`responses.py:51`). All three are
 * Python `str()` calls, and JavaScript's `String()` agrees with none of them —
 * `String({})` is `"[object Object]"`, `String(["a","b"])` is `"a,b"`, and both
 * `??` and `||` disagree with Python about what counts as empty. The bytes are
 * the product (PORTING-GUIDE Rule 1), so the coercion is written out here once
 * instead of being approximated three times.
 *
 * This is the subset Python's `str` reaches over JSON — objects, arrays,
 * strings, numbers, booleans and null. It must never grow into a repr of
 * JavaScript's own types; nothing else can arrive from `JSON.parse`.
 *
 * One divergence sits below this layer and cannot be closed from here:
 * `JSON.parse` reads `1.0` as the integer `1`, so it renders `1` where Python
 * renders `1.0`. That is the JSON reader disagreeing, not `str`.
 */

/** Python truthiness. `""`, `0`, `false`, `null` and an **empty container** are
 * all empty — the container half is what `??` and `||` both miss, and it is the
 * difference between skipping an argument and starting a sub-agent on it.
 *
 * `NaN` is truthy in Python and empty here; it cannot arrive from `JSON.parse`,
 * and a goal rescued as the string `nan` would help nobody.
 * @param {unknown} value @returns {boolean} */
export function pyTruthy(value) {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  if (typeof value === "string" || Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

/** @param {number} n @returns {string} */
function numberStr(n) {
  if (Number.isNaN(n)) return "nan";
  if (n === Infinity) return "inf";
  if (n === -Infinity) return "-inf";
  return String(n);
}

/** Escapes Python's `repr` writes as two characters. Order does not matter
 * because each key is one character and the lookup is exact. */
const ESCAPES = { "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t" };

/** Python's `repr()` of a string: single quotes, **unless** the string holds a
 * single quote and no double quote — then double quotes, so a critique finding
 * with an apostrophe in it comes out as `"it's broken"` and not the malformed
 * `'it's broken'` that a fixed quote character would produce.
 * @param {string} s @returns {string} */
function strRepr(s) {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    if (ch === quote) out += `\\${ch}`;
    else if (ch in ESCAPES) out += ESCAPES[/** @type {keyof ESCAPES} */ (ch)];
    else if (ch < " " || ch === "\x7f") out += `\\x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`;
    else out += ch;
  }
  return out + quote;
}

/** Python's `repr()`. Only a string differs from `str()`; every container
 * renders its items with this, which is why the two call each other.
 * @param {unknown} value @returns {string} */
export function pyRepr(value) {
  return typeof value === "string" ? strRepr(value) : pyStr(value);
}

/** Python's `str()`. @param {unknown} value @returns {string} */
export function pyStr(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return numberStr(value);
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(", ")}]`;
  if (typeof value === "object") {
    const pairs = Object.entries(value).map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`);
    return `{${pairs.join(", ")}}`;
  }
  return String(value);
}

/** Python's `str(value or "")`, which is written that way in three places and
 * means the same thing in all three: an empty value is skipped, and anything
 * else is rendered the way Python renders it.
 * @param {unknown} value @returns {string} */
export function pyStrOr(value) {
  return pyTruthy(value) ? pyStr(value) : "";
}

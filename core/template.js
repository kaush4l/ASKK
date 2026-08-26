/**
 * The mini template renderer.
 *
 * The Python rendered components with jinja2:
 * `Environment(autoescape=False, keep_trailing_newline=True)`. This is the
 * subset those templates actually use, written out rather than depended on —
 * `{{ name }}`, `{{ list | join('sep') }}`, `{% if name %}`, `{% for x in xs %}`
 * and the two-target `{% for a, b in pairs %}` that SkillCatalog needs.
 *
 * Autoescaping stays OFF. This text is a prompt, not HTML; escaping it would
 * corrupt the very bytes the model reads. And nothing is trimmed at either end:
 * that is what `keep_trailing_newline=True` bought, and every component's
 * trailing blank line is load-bearing because the assembler joins with "".
 *
 * It must never grow into a template language. A construct no TEMPLATE in
 * `core/components.js`, `core/responses.js` or `core/tools.js` uses is a
 * construct this file refuses at compile time.
 */

/** @typedef {{ t: "text", v: string }} TextNode */
/** @typedef {{ t: "var", name: string, join: string | null }} VarNode */
/** @typedef {{ t: "if", name: string, body: Node[] }} IfNode */
/** @typedef {{ t: "for", targets: string[], name: string, body: Node[] }} ForNode */
/** @typedef {TextNode | VarNode | IfNode | ForNode} Node */
/** @typedef {Record<string, unknown>} Scope */

const TAG = /\{\{([\s\S]*?)\}\}|\{%([\s\S]*?)%\}/g;
const VAR = /^([A-Za-z_]\w*)(?:\s*\|\s*join\(\s*(['"])([\s\S]*?)\2\s*\))?$/;
const IF = /^if\s+([A-Za-z_]\w*)$/;
const FOR = /^for\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+in\s+([A-Za-z_]\w*)$/;

/**
 * A template compiled once and rendered many times.
 * @param {string} source
 * @returns {(data: Scope) => string}
 */
export function compile(source) {
  const nodes = parse(source);
  return (data) => render(nodes, data);
}

/**
 * @param {string} source
 * @returns {Node[]}
 */
function parse(source) {
  /** @type {Node[][]} */
  const stack = [[]];
  /** @type {(IfNode | ForNode)[]} */
  const open = [];
  let cursor = 0;
  TAG.lastIndex = 0;
  for (let m = TAG.exec(source); m; m = TAG.exec(source)) {
    pushText(stack[stack.length - 1], source.slice(cursor, m.index));
    cursor = m.index + m[0].length;
    if (m[1] !== undefined) stack[stack.length - 1].push(variable(m[1]));
    else statement(m[2].trim(), stack, open);
  }
  pushText(stack[stack.length - 1], source.slice(cursor));
  if (open.length) throw new Error(`Unclosed {% ${open[open.length - 1].t} %}`);
  return stack[0];
}

/**
 * @param {string} body
 * @param {Node[][]} stack
 * @param {(IfNode | ForNode)[]} open
 */
function statement(body, stack, open) {
  const close = body === "endif" ? "if" : body === "endfor" ? "for" : "";
  if (close) {
    const node = open.pop();
    if (!node || node.t !== close) throw new Error(`Unexpected {% ${body} %}`);
    stack.pop();
    return;
  }
  const ifMatch = IF.exec(body);
  const forMatch = FOR.exec(body);
  /** @type {IfNode | ForNode} */
  let node;
  if (ifMatch) node = { t: "if", name: ifMatch[1], body: [] };
  else if (forMatch)
    node = { t: "for", targets: forMatch[1].split(",").map((s) => s.trim()), name: forMatch[2], body: [] };
  else throw new Error(`Unsupported tag {% ${body} %}`);
  stack[stack.length - 1].push(node);
  stack.push(node.body);
  open.push(node);
}

/**
 * @param {Node[]} out
 * @param {string} text
 */
function pushText(out, text) {
  if (text) out.push({ t: "text", v: text });
}

/**
 * @param {string} expr
 * @returns {VarNode}
 */
function variable(expr) {
  const m = VAR.exec(expr.trim());
  if (!m) throw new Error(`Unsupported expression {{ ${expr.trim()} }}`);
  return { t: "var", name: m[1], join: m[3] === undefined ? null : unescape(m[3]) };
}

/**
 * jinja's lexer decodes backslash escapes inside a string literal, so
 * `join('\n')` is a newline whichever way the template source spelled it.
 * @param {string} raw
 * @returns {string}
 */
function unescape(raw) {
  return raw.replace(/\\(n|t|r|\\|'|")/g, (_, c) =>
    c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c,
  );
}

/**
 * @param {Node[]} nodes
 * @param {Scope} scope
 * @returns {string}
 */
function render(nodes, scope) {
  let out = "";
  for (const node of nodes) {
    if (node.t === "text") out += node.v;
    else if (node.t === "var") out += renderVar(node, scope[node.name]);
    else if (node.t === "if") out += truthy(scope[node.name]) ? render(node.body, scope) : "";
    else out += renderFor(node, scope);
  }
  return out;
}

/**
 * @param {VarNode} node
 * @param {unknown} value
 * @returns {string}
 */
function renderVar(node, value) {
  if (node.join !== null) return items(value).map(text).join(node.join);
  return text(value);
}

/**
 * @param {ForNode} node
 * @param {Scope} scope
 * @returns {string}
 */
function renderFor(node, scope) {
  let out = "";
  for (const item of items(scope[node.name])) {
    /** @type {Scope} */
    const inner = Object.create(scope);
    if (node.targets.length === 1) inner[node.targets[0]] = item;
    else node.targets.forEach((name, i) => (inner[name] = items(item)[i]));
    out += render(node.body, inner);
  }
  return out;
}

/**
 * Python truthiness, because the `{% if %}` tests are all "is this empty".
 * @param {unknown} value
 * @returns {boolean}
 */
function truthy(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Map || value instanceof Set) return value.size > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function items(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (typeof value === "string") return [...value];
  return [];
}

/**
 * An absent variable renders as nothing — jinja's Undefined does the same, and
 * a component that left a field unset has nothing to say about it.
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
  return value === null || value === undefined ? "" : String(value);
}

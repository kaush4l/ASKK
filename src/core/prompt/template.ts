/**
 * The mini template renderer — the subset of jinja2 the component templates use.
 *
 * The Python rendered every component through
 * `Environment(autoescape=False, keep_trailing_newline=True)`. This is that
 * environment, written out rather than depended on: `{{ name }}`,
 * `{{ list | join('sep') }}` and `{% if name %}`.
 *
 * Autoescaping stays off and nothing is trimmed at either end. Both matter to
 * the byte: this text is a prompt and not HTML, and every component's trailing
 * blank line is load-bearing because the assembler joins the parts with no
 * separator.
 *
 * **It must never grow into a template language.** A construct no `TEMPLATE` in
 * `components.ts` uses is a construct this file refuses at compile time — so a
 * template reaching for one is a load error naming the tag, not a silently
 * wrong prompt. `{% for %}` is therefore absent: the three components that
 * needed it (skills, critique findings) have no data source in this tree yet,
 * and it comes back with them.
 */

type Node =
  | { t: 'text'; v: string }
  | { t: 'var'; name: string; join: string | null }
  | { t: 'if'; name: string; body: Node[] }

export type Scope = Record<string, unknown>

const TAG = /\{\{([\s\S]*?)\}\}|\{%([\s\S]*?)%\}/g
const VAR = /^([A-Za-z_]\w*)(?:\s*\|\s*join\(\s*(['"])([\s\S]*?)\2\s*\))?$/
const IF = /^if\s+([A-Za-z_]\w*)$/

/** A template compiled once and rendered many times. */
export function compile(source: string): (data: Scope) => string {
  const nodes = parse(source)
  return (data) => render(nodes, data)
}

/** The innermost open block's body. Empty is impossible: the root is pushed first. */
function top(stack: Node[][]): Node[] {
  const body = stack[stack.length - 1]
  if (body === undefined) throw new Error('template: unbalanced block stack')
  return body
}

function parse(source: string): Node[] {
  const root: Node[] = []
  const stack: Node[][] = [root]
  const open: string[] = []
  let cursor = 0
  TAG.lastIndex = 0
  for (let m = TAG.exec(source); m; m = TAG.exec(source)) {
    pushText(top(stack), source.slice(cursor, m.index))
    cursor = m.index + m[0].length
    if (m[1] !== undefined) top(stack).push(variable(m[1]))
    else statement((m[2] ?? '').trim(), stack, open)
  }
  pushText(top(stack), source.slice(cursor))
  if (open.length) throw new Error(`Unclosed {% ${open[open.length - 1] ?? ''} %}`)
  return root
}

function statement(body: string, stack: Node[][], open: string[]): void {
  if (body === 'endif') {
    if (open.pop() !== 'if') throw new Error(`Unexpected {% ${body} %}`)
    stack.pop()
    return
  }
  const ifMatch = IF.exec(body)
  if (!ifMatch || ifMatch[1] === undefined) throw new Error(`Unsupported tag {% ${body} %}`)
  const node: Node = { t: 'if', name: ifMatch[1], body: [] }
  top(stack).push(node)
  stack.push(node.body)
  open.push('if')
}

function pushText(out: Node[], text: string): void {
  if (text) out.push({ t: 'text', v: text })
}

function variable(expr: string): Node {
  const m = VAR.exec(expr.trim())
  if (!m || m[1] === undefined) throw new Error(`Unsupported expression {{ ${expr.trim()} }}`)
  return { t: 'var', name: m[1], join: m[3] === undefined ? null : unescape(m[3]) }
}

/**
 * jinja's lexer decodes backslash escapes inside a string literal, so
 * `join('\n')` is a newline whichever way the template source spelled it.
 */
function unescape(raw: string): string {
  return raw.replace(/\\(n|t|r|\\|'|")/g, (_, c: string) =>
    c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c,
  )
}

function render(nodes: readonly Node[], scope: Scope): string {
  let out = ''
  for (const node of nodes) {
    if (node.t === 'text') out += node.v
    else if (node.t === 'var') out += renderVar(node.join, scope[node.name])
    else out += truthy(scope[node.name]) ? render(node.body, scope) : ''
  }
  return out
}

function renderVar(join: string | null, value: unknown): string {
  if (join !== null) return items(value).map(text).join(join)
  return text(value)
}

/** Python truthiness, because every `{% if %}` in this tree tests "is this empty". */
function truthy(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return value.length > 0
  if (value instanceof Map || value instanceof Set) return value.size > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return Boolean(value)
}

function items(value: unknown): unknown[] {
  if (Array.isArray(value)) return value as unknown[]
  if (value instanceof Set) return [...value]
  if (typeof value === 'string') return [...value]
  return []
}

/**
 * An absent variable renders as nothing — jinja's Undefined does the same, and
 * a component that left a field unset has nothing to say about it.
 */
function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

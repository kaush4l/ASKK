import { Outcome } from '../Outcome.js'

/**
 * The tools an agent has, and how a written call becomes a result.
 *
 * The model writes calls as text — `search({"q": "x"})` — because that is what
 * every model can do, including ones with no function-calling API. Parsing them
 * lives here so the engine never learns the syntax and a transport never has to
 * support one.
 *
 * Calls on one line run together; each line runs after the one above it. That
 * is the whole scheduling model, and it is written into the response contract
 * so the model can express "these are independent" without a second field.
 */
export class Toolbox {
  constructor(tools = []) {
    this.tools = new Map()
    for (const tool of tools) {
      if (tool?.name) this.tools.set(tool.name, tool)
    }
  }

  get isEmpty() {
    return this.tools.size === 0
  }

  get names() {
    return [...this.tools.keys()]
  }

  /** The `# TOOLS` block, or empty when there are none to offer. */
  render() {
    if (this.isEmpty) return ''
    const entries = [...this.tools.values()].map((tool) => tool.render()).join('\n')
    return [
      '# TOOLS',
      '',
      'Call a tool by writing it in the result field, exactly as shown:',
      '',
      entries,
      '',
      'Calls on one line run at the same time; a call that needs an earlier result goes on its own line.',
    ].join('\n')
  }

  /**
   * Find the calls in a block of text.
   *
   * Scans for `name(` and then matches balanced brackets, rather than using a
   * regular expression: an argument object can contain parentheses inside a
   * string, and a regex that stops at the first `)` truncates those calls into
   * silent nonsense.
   *
   * @returns {Array<Array<{name: string, argText: string, raw: string}>>} one
   *   inner array per line, preserving the run-together / run-after grouping.
   */
  static parse(text) {
    return String(text ?? '')
      .split('\n')
      .map((line) => Toolbox._parseLine(line))
      .filter((calls) => calls.length > 0)
  }

  static _parseLine(line) {
    const calls = []
    const pattern = /([A-Za-z_][\w-]*)\s*\(/g
    let match = pattern.exec(line)
    while (match) {
      const open = match.index + match[0].length - 1
      let depth = 0
      let end = -1
      let inString = false
      let escaped = false
      for (let i = open; i < line.length; i++) {
        const char = line[i]
        if (inString) {
          if (escaped) escaped = false
          else if (char === '\\') escaped = true
          else if (char === '"') inString = false
          continue
        }
        if (char === '"') inString = true
        else if (char === '(') depth++
        else if (char === ')') {
          depth--
          if (depth === 0) {
            end = i
            break
          }
        }
      }
      if (end < 0) break
      calls.push({
        name: match[1],
        argText: line.slice(open + 1, end).trim(),
        raw: line.slice(match.index, end + 1).trim(),
      })
      pattern.lastIndex = end + 1
      match = pattern.exec(line)
    }
    return calls
  }

  /**
   * Run one call. Never fails the turn: an unknown tool, unreadable arguments
   * and a tool that reports a failure all come back as text the agent reads and
   * can act on, because "that did not work" is information, not an ending.
   */
  async runOne({ name, argText, raw }) {
    const tool = this.tools.get(name)
    if (!tool) {
      return `${raw} -> there is no tool called ${name}. Available: ${this.names.join(', ') || 'none'}`
    }

    let args = {}
    if (argText) {
      const parsed = await Outcome.attempt(() => JSON.parse(argText))
      if (!parsed.ok) {
        return `${raw} -> the arguments were not valid JSON (${parsed.failure.message}). Write them as {"key": "value"}.`
      }
      args = parsed.value
    }

    const result = await tool.call(args)
    return result.ok
      ? `${name} -> ${result.value}`
      : `${name} -> failed: ${result.failure.message}${result.failure.hint ? ` (${result.failure.hint})` : ''}`
  }

  /**
   * Run everything written in `text` and return what the agent should read.
   *
   * @returns {Promise<{observation: string, count: number}>}
   */
  async run(text) {
    const lines = Toolbox.parse(text)
    if (lines.length === 0) {
      return {
        observation:
          'no tool call was found in that result. Write the call itself, like tool_name({"key": "value"}), or set act to answer.',
        count: 0,
      }
    }

    const observations = []
    let count = 0
    for (const line of lines) {
      // Together, not one by one: calls the model put on one line said they do
      // not need each other, and running them in sequence would waste the fact.
      const results = await Promise.all(line.map((call) => this.runOne(call)))
      observations.push(...results)
      count += line.length
    }
    return { observation: observations.join('\n'), count }
  }
}

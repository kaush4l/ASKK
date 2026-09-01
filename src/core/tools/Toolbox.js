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

  /**
   * The `# TOOLS` block, or empty when there are none to offer.
   *
   * There used to be a lead-in line here — "Call a tool by writing it in the
   * result field, exactly as shown:" — and it is gone because the response
   * contract already says it, in the description of the very field it is about:
   * "When act is 'tool': the tool calls and nothing else — tool_name({...}) — no
   * explanation, no prose around them." Two spellings of one instruction, about
   * 130 tokens apart, on every turn of every run. The scheduling line below is
   * NOT a duplicate and stays: nothing else in the prompt says that calls on one
   * line run together.
   *
   * What it saved is measured rather than asserted (`bun scripts/dryrun.js`,
   * same task, before and after): the tools section falls 1,038 chars / 259
   * tokens to 972 / 242, and the REUSABLE PREFIX falls by the same 17 tokens —
   * 702 to 685 — so it is 17 tokens off every turn of every run and not only
   * off the uncached ones. What it cost is NOT measured; no compliance arm was
   * run. So this is a cut on the ground that the rule is stated once and is
   * still stated, not on the ground that stating it twice bought nothing.
   */
  render() {
    if (this.isEmpty) return ''
    const entries = [...this.tools.values()].map((tool) => tool.render()).join('\n')
    return [
      '# TOOLS',
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
  async runOne({ name, argText, raw }, signal = null) {
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

    const result = await tool.call(args, signal)
    if (!result.ok) {
      return `${name} -> failed: ${result.failure.message}${result.failure.hint ? ` (${result.failure.hint})` : ''}`
    }
    // Notes come through. They were dropped here, which made every note any
    // tool threads on its way up write-only — carefully carried the whole way
    // and then binned one statement before the only reader there is. A note is
    // a tool saying what it repaired or lost, and that changes what the agent
    // should believe about the value printed beside it.
    const said = result.notes.map((note) => `\n   (${note})`).join('')
    return `${name} -> ${result.value}${said}`
  }

  /**
   * Run everything written in `text` and return what the agent should read.
   *
   * `signal` is passed down and not acted on here. This class has nothing to
   * abort — it parses and dispatches — and the loop does not wait on it
   * indefinitely either: `ReActEngine` races this call against the stop, so a
   * tool that ignores the signal delays nobody, it just finishes into a
   * scratchpad the run has already left behind.
   *
   * @returns {Promise<{observation: string, count: number}>}
   */
  async run(text, signal = null) {
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
      const results = await Promise.all(line.map((call) => this.runOne(call, signal)))
      observations.push(...results)
      count += line.length
    }

    // How much of the text was actually calls, reported and never enforced.
    //
    // It exists because of a measured incident: a model's raw reasoning reached
    // this class as a `result` field, the scanner did its job on it, and a
    // command written down as an EXAMPLE of what it might do was executed. The
    // scanner was not wrong — finding `name(...)` anywhere in a line is what
    // makes a call wrapped in a sentence still work — but a result that is 5%
    // call and 95% prose lost an argument with its own contract. Refusing here
    // would be guessing about English in the one class that must never guess,
    // and the actual cause is upstream: `OpenAICompatible._state` is what stops
    // a reasoning dump reaching anybody as an answer. This is the line in the
    // transcript that says it happened anyway.
    //
    // A quarter is not a tuned threshold and is not claimed to be one: it is low
    // enough that a call with a sentence of explanation around it passes
    // silently, and the dumps measured on the testbed sat between 2% and 8%. No
    // division guard is needed — `lines` is non-empty above, so a parsed call
    // survived `.trim()` and `whole` cannot be zero.
    const whole = String(text).trim().length
    const written = lines.flat().reduce((total, call) => total + call.raw.length, 0)
    if (written / whole < 0.25) {
      observations.push(
        `(most of that result was prose rather than calls, and ${count} call(s) were taken out of it and run.)`,
      )
    }
    return { observation: observations.join('\n'), count }
  }
}

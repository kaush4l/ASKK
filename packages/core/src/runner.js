/**
 * ONE TOOL RUNNER'S OUTER SHELL: its arguments read, and its failures said.
 *
 * The JSON parse lives here so no runner repeats it, and a call whose arguments
 * will not parse is a RESULT the model can act on rather than a throw it never
 * sees. Every runner in this build wraps in it — a port that throws comes back
 * as `ok: false` carrying the error's own sentence, because the loop is waiting
 * on this call and a throw is a round that never closes.
 * @module
 */

/** @typedef {import('./app.js').ToolRun} ToolRun */

/**
 * @param {string} name the tool, so a refusal says which call it is refusing
 * @param {(args: Record<string, unknown>, opts: {signal: AbortSignal}) => Promise<{ok: boolean, output: string}>} run
 * @returns {ToolRun}
 */
export function answered(name, run) {
  return async (raw, opts) => {
    /** @type {unknown} */
    let said
    try {
      said = JSON.parse(raw === '' ? '{}' : raw)
    } catch {
      return { ok: false, output: `${name} needs JSON arguments, and "${raw.slice(0, 80)}" is not JSON.` }
    }
    if (!said || typeof said !== 'object') return { ok: false, output: `${name} needs a JSON object of arguments.` }
    try {
      return await run(/** @type {Record<string, unknown>} */ (said), opts)
    } catch (cause) {
      return { ok: false, output: cause instanceof Error ? cause.message : String(cause) }
    }
  }
}

/** An identifier argument: trimmed once, because surrounding space in a NAME is a typo and a blank one names nothing. @param {Record<string, unknown>} args @param {string} key */
export function nameArg(args, key) {
  return String(args[key] ?? '').trim()
}

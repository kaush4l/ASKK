/**
 * A `ModelPort` that reads from a script instead of a network. The whole point
 * of the pure core: a turn's behaviour is testable on the host by writing what
 * the model says (I3, I7).
 * @module
 */

import { ModelError } from '@harness/kernel'

/** @typedef {import('@harness/kernel').ModelPort} ModelPort */
/** @typedef {import('@harness/kernel').ModelReply} ModelReply */

/**
 * One scripted turn: either text, tool calls, or a failure.
 * @typedef {{
 *   text?: string, reasoning?: string,
 *   calls?: Array<{id?: string, tool: string, args: string}>,
 *   finish?: import('@harness/kernel').FinishReason,
 *   fail?: ModelError, usage?: import('@harness/kernel').Usage,
 * }} Scripted
 */

/**
 * @param {Scripted[]} script one entry per call, in order
 * @param {{onCall?: (body: Record<string, unknown>) => void}} [opts]
 * @returns {ModelPort & {calls: Array<Record<string, unknown>>, remaining: () => number}}
 */
export function scriptedModel(script, opts = {}) {
  /** @type {Array<Record<string, unknown>>} */
  const calls = []
  let next = 0
  return {
    calls,
    remaining: () => script.length - next,
    resolves(asked) {
      return { endpoint: 'scripted', model: asked || 'scripted-model' }
    },
    async call(endpoint, body, callOpts) {
      void endpoint // the script answers whoever asks; the endpoint is the real port's business
      calls.push(body)
      opts.onCall?.(body)
      const turn = script[next++]
      if (!turn) throw new ModelError('server', `the script ran out after ${next - 1} call(s)`)
      if (turn.fail) throw turn.fail
      if (callOpts?.signal?.aborted) throw new ModelError('refused', 'the turn was cancelled')
      const text = turn.text ?? ''
      const reasoning = turn.reasoning ?? ''
      if (callOpts?.onDelta && text) callOpts.onDelta({ text })
      return {
        text,
        reasoning,
        finish: turn.finish ?? ((turn.calls ?? []).length > 0 ? 'tool_calls' : 'stop'),
        calls: (turn.calls ?? []).map((c, i) => ({ id: c.id ?? `call-${next}-${i}`, tool: c.tool, args: c.args })),
        usage: turn.usage ?? null,
        raw: turn,
      }
    },
  }
}

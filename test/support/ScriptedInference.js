import { Inference } from '../../src/core/inference/Inference.js'
import { Outcome, Reason } from '../../src/core/Outcome.js'

/**
 * An `Inference` that answers from a list instead of from a model, and keeps
 * every prompt it was handed.
 *
 * It lives in `test/support/` rather than in `src/core/inference/`, and that is
 * a decision rather than an accident. Anything in `src/core/inference/` is a
 * transport the app can be configured to use, reached through `createInference`
 * and named in `Kind`; a provider that returns canned text is not something a
 * user should ever be able to select, and one that is shipped but unreachable
 * would be a tenth entry on the list of declared-and-never-wired capabilities
 * `CAPABILITIES.md` already keeps. It is a measuring instrument, so it lives
 * with the other instruments, and `scripts/dryrun.js` imports it from here for
 * the same reason it imports a test helper rather than shipping one.
 *
 * Two things make it useful beyond returning strings:
 *
 * `calls` is the record of what the transport was ACTUALLY given — the prompt
 * string, the attachments and the options. Every claim about what the model
 * receives can then be checked against the argument at the boundary rather than
 * against a second assembly of the same blocks, which would only prove the
 * assembler agrees with itself.
 *
 * Running out of replies is a failure, not a repeated answer. `ReActEngine` has
 * no step ceiling by design — the agent decides when it is done — so a scripted
 * model that answered forever would hang a test rather than fail one. The
 * script's length is the only bound in the loop, and exhausting it says so.
 */
export class ScriptedInference extends Inference {
  /**
   * Read by `Inference.stream` and `_postJson` for every message they build.
   * The base class reads it off `this.constructor`, so a subclass that does not
   * set one is announced to the reader as `inference`.
   */
  static LABEL = 'scripted'

  /**
   * @param {{replies?: string[]}} [options] each reply is returned verbatim, in
   *   order, as though the model had produced it. The argument itself is
   *   optional: an instrument that throws when constructed with nothing is one
   *   more thing to get right in a tree whose one rule is that nothing throws.
   */
  constructor({ replies = [] } = {}) {
    super()
    this.replies = [...replies]
    /** @type {Array<{prompt: string, multimodal: object[], options: object}>} */
    this.calls = []
  }

  /** The prompts, in the order the engine sent them. */
  get prompts() {
    return this.calls.map((call) => call.prompt)
  }

  async invoke(prompt, multimodal = [], options = {}) {
    this.calls.push({ prompt, multimodal, options })
    if (!this.replies.length) {
      return Outcome.failed(
        Reason.UNAVAILABLE,
        `scripted: the script ran out after ${this.calls.length} call(s)`,
        { hint: 'The loop was still going. Supply another reply, or one that answers.' },
      )
    }
    return Outcome.ok(this.replies.shift())
  }
}

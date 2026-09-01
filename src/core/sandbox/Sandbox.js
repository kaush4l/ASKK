import { Outcome, Reason } from '../Outcome.js'

/**
 * Somewhere to run a command.
 *
 * A port, so the tool that uses it does not know whether the command ran in an
 * emulator in this tab, in a container over a network, or nowhere at all. What
 * every implementation must promise is the shape of the answer: an Outcome
 * whose value is `{ stdout, code }`, where a non-zero exit is a RESULT and not
 * a failure — a command that fails is something the agent should read and
 * reason about, and hiding it behind an error would take that away.
 *
 * A failure here means the sandbox itself could not run anything: no image, no
 * boot, a timeout.
 */
export class Sandbox {
  /** Stable name for messages. NOT `constructor.name`; the bundle renames. */
  static LABEL = 'sandbox'

  /** Whether this sandbox can run anything at all right now. */
  get available() {
    return false
  }

  /**
   * @param {string} _command a shell command line
   * @param {{timeout?: number}} [_options]
   * @returns {Promise<Outcome>} value is `{stdout: string, code: number}`
   */
  async run(_command, _options = {}) {
    return Outcome.failed(Reason.NOT_IMPLEMENTED, `${this.constructor.LABEL} cannot run commands`, {
      hint: 'No sandbox is configured.',
    })
  }

  /** Release whatever is held open. */
  async close() {}
}

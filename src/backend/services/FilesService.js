import { Outcome, Reason } from '../../core/Outcome.js'

/**
 * The agent's workspace, as routes the page can call.
 *
 * `Workspace` is the store and takes positional arguments the way a domain
 * object should; the Kernel calls every handler with one params object off the
 * wire. This class is the whole of that translation, which is why it is three
 * statements and a page of argument.
 *
 * ## Two writers, and how they were going to disagree
 *
 * The agent writes here through `WriteFileTool` and the guest writes here
 * through `ShellTool`'s harvest, both inside the backend worker, both through
 * the single `Workspace` that `composition.js` constructs. The page gets
 * `list` and `read` and nothing else.
 *
 * The reason is NOT that a concurrent write would corrupt the store. It would
 * not: a write is one whole-record `put` in one IndexedDB transaction
 * (`repositories/IndexedDbRepository.js`), so a reader sees the record before
 * that write or the record after it, never half of one. `Workspace` says the
 * same thing from the other side — there is no appending and no partial read,
 * because a file is a whole record.
 *
 * The reason is the LOST UPDATE, which no transaction anywhere stops. A person
 * opens `plan.md`, reads it for two minutes, and saves; the agent rewrote it
 * ninety seconds ago; the save is a `put` of text that never saw the agent's
 * version, and the agent's work is gone with nothing anywhere recording that it
 * existed. That is the same shape as the defect this tree already shipped when
 * two writers disagreed about a schema and one silently erased `thinking` —
 * `services/ChatService.js` carries the account of it.
 *
 * What makes a save safe was described here for two waves as "small and
 * deliberately not here", and it is now here because the caller arrived: the
 * reader is already handed the exact text it is looking at, so a `write` that
 * carries that text back as a precondition — refuse unless what is stored is
 * still what was read, and say what changed — is a compare-and-set with no new
 * stored field and no version number to become a second author of a fact the
 * text already holds. `app/FilesPanel.jsx` edits and uploads through it, and
 * `Workspace.write` states the bound the precondition does and does not have.
 *
 * The rule that kept it out until now is unchanged and is why it arrived in
 * this shape: a route with no caller is this tree's signature defect — it has
 * shipped as `AgentState::phase`, as `## observations`, and as
 * `AgentWorkerPool.terminate`. What changed is not the rule, it is that a
 * person can now hand the agent a file, which is the half of "we have files"
 * that was missing.
 *
 * **The page must always state a precondition; the agent never does.** That
 * asymmetry is the whole safety argument, so it is enforced here rather than
 * trusted: a `write` off the wire with no `expect` is refused. The agent's own
 * writers reach `Workspace` directly and are not affected.
 *
 * ## What a reader is told about a file that moved under it
 *
 * Nothing here, and that is the division of labour rather than a gap. A read is
 * a snapshot and the store cannot say whether it is still current without being
 * asked again, so the page stamps every open with the moment it was read, can
 * re-read on demand, and re-lists when a turn ends — see `app/FilesPanel.jsx`.
 * A route that tried to help by pushing changes would be a subscription to
 * unwind and a second, quieter copy of the transcript's own account of the run.
 */
export class FilesService {
  /** @param {import('../files/Workspace.js').Workspace} workspace */
  constructor(workspace) {
    this.workspace = workspace
  }

  /**
   * Every file's name, in order.
   *
   * Names and no sizes, which is `Workspace.list`'s own decision and is left
   * alone here. Putting a size back would cost a `TextEncoder` pass over the
   * whole workspace, and this route is called on every turn's end — while the
   * one place a size is actually wanted, beside an open file, gets it from
   * `read` for free.
   */
  async list() {
    return this.workspace.list()
  }

  /**
   * One file, whole.
   *
   * Whole because it can be: `core/tools/FilesPort.js` caps a file at 64 KiB,
   * so there is no size at which a range request, a cursor or a stream would
   * buy anything — the cap is below the point where any of them start to pay,
   * and it is the same cap the prompt reads against. Nothing here truncates,
   * and nothing here needs to say that it did.
   *
   * A file that is not there comes back as `ok(null)`, exactly as
   * `Repository.get` reports a missing record. Asking for something that has
   * gone is an ordinary answer — it is what the page gets when a listing it
   * drew a second ago named a file the store no longer has — and a failure
   * there would put a red error on screen for a question that was answered.
   */
  async read({ path } = {}) {
    return this.workspace.read(path)
  }

  /**
   * Put a file into the workspace, on the reader's own terms.
   *
   * `expect` is required and may be `null`, which is the difference between
   * *this is new* and *this is the text I was shown*. It is not defaulted:
   * a defaulted precondition is no precondition, and the one caller that would
   * have benefited from the convenience is exactly the one whose lost update
   * this route exists to refuse.
   *
   * The check is on the VALUE and not on `'expect' in params`, which was the
   * first version and was wrong in the one direction that matters: `{expect:
   * undefined}` satisfies `in`, so a page that built its params object with an
   * undefined in it — the shape a missing state variable produces — was handed
   * an unconditional write while believing it had asked for a safe one. A
   * precondition has exactly two legal shapes, `null` and a string, and
   * anything else is refused rather than interpreted.
   */
  async write(params = {}) {
    const { expect } = params
    if (expect !== null && typeof expect !== 'string') {
      return Outcome.failed(
        Reason.BAD_REQUEST,
        'a write from the page must say what it expects to find',
        { hint: 'Pass expect: null for a new file, or the exact text that was read.' },
      )
    }
    const { path, text } = params
    return this.workspace.write(path, text, { expect })
  }
}

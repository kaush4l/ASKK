/**
 * The agent's workspace, as routes the page can call.
 *
 * `Workspace` is the store and takes positional arguments the way a domain
 * object should; the Kernel calls every handler with one params object off the
 * wire. This class is the whole of that translation, which is why it is four
 * lines of body and a page of argument.
 *
 * ## Read-only, and how the two writers were going to disagree
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
 * What would make a save safe is small and is deliberately not here: the reader
 * is already handed the exact text it is looking at, so a `write` that carried
 * that text back as a precondition — refuse unless what is stored is still what
 * was read, and say what changed — is a compare-and-set with no new stored
 * field, and no version number to become a second author of a fact the text
 * already holds. It is maybe fifteen lines. It is not written because nothing
 * asks for it: the owner asked to *view* files and code, no component would
 * call a `write` route today, and a route with no caller is this tree's
 * signature defect — it has shipped as `AgentState::phase`, as
 * `## observations`, and as `AgentWorkerPool.terminate`. The day the view
 * edits, the route arrives with its caller and the precondition above is the
 * design it arrives with.
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
}

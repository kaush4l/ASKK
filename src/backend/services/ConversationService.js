import { Conversation } from '../../core/Conversation.js'
import { Outcome, Reason } from '../../core/Outcome.js'

/**
 * Use cases for conversations.
 *
 * The service owns the transaction script: load, enforce, save. It knows about
 * the domain and the persistence port, and nothing about transports — no
 * postMessage, no Request, no worker. That is what lets the same service run
 * unchanged if the boundary moves.
 *
 * It is also the ONLY writer of the conversation store. `ChatService` used to be
 * a second one, pushing plain rows onto the record it had loaded, and the two
 * disagreed about what a message is. A schema with two writers is a schema with
 * two versions of itself, and the loser is whichever wrote first.
 */
export class ConversationService {
  constructor(repository) {
    this.repository = repository
    /**
     * Conversation id -> the tail of that conversation's write queue.
     *
     * Load-mutate-save is three awaits and two of them yield. Two appends
     * started together therefore both loaded the same record, and the second
     * `put` wrote a transcript that had never seen the first message — a
     * silently lost turn, measured in `ConversationService.test.js`. Every write
     * now queues behind the last one for the same conversation.
     *
     * This serialises writes within ONE realm, which is all a promise can do.
     * Two tabs are two workers holding two of these against one database, and
     * nothing in the tree arbitrates between them; `docs/LEDGER.md` row 2B
     * records the single-writer lock as absent.
     */
    this._writes = new Map()
  }

  async _require(id) {
    const found = await this.repository.get(id)
    if (!found.ok) return found
    if (!found.value) {
      return Outcome.failed(Reason.NOT_FOUND, `no conversation ${id}`, {
        // Not "deleted in another tab". `page.jsx` calls `conversations.list`
        // and `conversations.create` and nothing else, so no tab can delete a
        // conversation and a hint naming that cause describes something that
        // cannot happen. What does reach here: site data cleared, a record
        // written by an older build, or an IndexedDB the browser refused —
        // `composition.js` falls back to `MemoryRepository`, which forgets
        // everything the moment the worker restarts.
        hint: 'This browser no longer has that conversation. Start a new chat.',
      })
    }
    return Outcome.ok(Conversation.fromJSON(found.value))
  }

  /**
   * Run `work` with nothing else in this realm touching that conversation's
   * record at the same time.
   *
   * Every route that writes the store goes through here, and `_write` is only
   * the commonest of them. `remove` used to write outside the queue, so an
   * append that had already loaded landed its `put` AFTER the delete and
   * re-created the conversation the user had just deleted — both calls
   * reporting `ok`, measured with a 20 ms `put`. A queue one writer may step
   * around is not a queue.
   */
  _serialise(id, work) {
    const queued = (this._writes.get(id) ?? Promise.resolve()).then(work)

    // The queue carries neither value nor failure. A write that failed has
    // already reported to its own caller, and letting its rejection become the
    // next writer's problem would turn one storage error into every later
    // append failing for a reason that is not its own.
    const tail = queued.then(
      () => {},
      () => {},
    )
    this._writes.set(id, tail)
    // Dropped once it is nobody's predecessor, so the map is as big as the
    // conversations being written right now rather than every one ever touched.
    tail.then(() => {
      if (this._writes.get(id) === tail) this._writes.delete(id)
    })
    return queued
  }

  /**
   * Load, mutate, save — with nothing else writing this conversation in
   * between. `mutate` is handed the loaded `Conversation` and returns the notes
   * its own change produced; the load, the queue and the `put` are this
   * method's business, and the caller reads the result off `value.saved`.
   */
  async _write(id, mutate) {
    return this._serialise(id, async () => {
      const loaded = await this._require(id)
      if (!loaded.ok) return loaded

      const conversation = loaded.value
      const notes = mutate(conversation)
      const saved = await this.repository.put(conversation.toJSON())
      return Outcome.ok({ conversation, saved }, notes)
    })
  }

  async create({ title } = {}) {
    // Outside the queue, and that is not the hole `remove` was. The id is
    // minted on the line above, so at the moment of the `put` no other caller
    // can hold it and there is nothing to serialise against.
    const conversation = new Conversation({ title: title || 'Untitled' })
    const written = await this.repository.put(conversation.toJSON())
    // A conversation that could not be saved is still usable right now, so it
    // is returned with the storage failure as a note rather than withheld.
    return written.ok
      ? Outcome.ok(conversation.toJSON())
      : Outcome.ok(conversation.toJSON(), [`not saved: ${written.failure.message}`])
  }

  async list() {
    const found = await this.repository.list()
    if (!found.ok) return found
    // Through the domain model, because this is the read path that restores a
    // transcript: `page.jsx` boots off `conversations.list` and never calls
    // `get`. Returning the raw stored row meant a record written by an older
    // build reached the page in whatever shape it was written in, while `get`
    // returned the repaired one — one schema with two answers, depending on
    // which route you took to it.
    const conversations = found.value.map((row) => Conversation.fromJSON(row).toJSON())
    // Newest first — the list is a menu, and the thing you just touched is the
    // thing you most likely want next.
    return Outcome.ok(conversations.sort((a, b) => b.createdAt - a.createdAt))
  }

  async get({ id }) {
    const loaded = await this._require(id)
    return loaded.ok ? Outcome.ok(loaded.value.toJSON()) : loaded
  }

  async appendMessage({ id, role, text, thinking, attachments }) {
    const done = await this._write(
      id,
      (conversation) => conversation.append({ role, text, thinking, attachments }).repairs,
    )
    if (!done.ok) return done

    // Read back off the saved conversation rather than captured out of the
    // callback. Assigning it from inside `mutate` gave `_write` two output
    // channels — its return value and a closure — for one result.
    const { conversation, saved } = done.value
    const message = conversation.messages.at(-1)
    // The note names the role because one caller appends twice in a turn —
    // `ChatService` writes the question, calls the model, then writes the reply
    // — and two lines both reading "not saved" tell the user nothing about
    // which half of their turn is gone.
    const notes = saved.ok
      ? done.notes
      : [...done.notes, `the ${message.role} message was not saved: ${saved.failure.message}`]
    return Outcome.ok(message.toJSON(), notes)
  }

  async rename({ id, title }) {
    const done = await this._write(id, (conversation) => {
      const before = conversation.title
      return conversation.rename(title) === before
        ? ['the new title was empty; the old one was kept']
        : []
    })
    if (!done.ok) return done

    const { conversation, saved } = done.value
    const notes = saved.ok ? done.notes : [...done.notes, `not saved: ${saved.failure.message}`]
    return Outcome.ok(conversation.toJSON(), notes)
  }

  async remove({ id }) {
    // Through the queue, like every other write of this record. It used to go
    // straight to the repository, so an append already in flight put its copy
    // back after the delete and the conversation returned from the dead with
    // both calls reporting success.
    return this._serialise(id, async () => {
      const removed = await this.repository.remove(id)
      if (!removed.ok) return removed
      // Deleting something already gone is the state the caller wanted.
      // Reporting it as a failure would make a retry look broken.
      return Outcome.ok({ id }, removed.value ? [] : ['it was already gone'])
    })
  }
}

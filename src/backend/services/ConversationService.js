import { Conversation } from '../../core/Conversation.js'
import { Outcome, Reason } from '../../core/Outcome.js'

/**
 * Use cases for conversations.
 *
 * The service owns the transaction script: load, enforce, save. It knows about
 * the domain and the persistence port, and nothing about transports — no
 * postMessage, no Request, no worker. That is what lets the same service run
 * unchanged if the boundary moves.
 */
export class ConversationService {
  constructor(repository) {
    this.repository = repository
  }

  async _require(id) {
    const found = await this.repository.get(id)
    if (!found.ok) return found
    if (!found.value) {
      return Outcome.failed(Reason.NOT_FOUND, `no conversation ${id}`, {
        hint: 'It may have been deleted in another tab. Start a new chat.',
      })
    }
    return Outcome.ok(Conversation.fromJSON(found.value))
  }

  async create({ title } = {}) {
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
    // Newest first — the list is a menu, and the thing you just touched is the
    // thing you most likely want next.
    return Outcome.ok([...found.value].sort((a, b) => b.createdAt - a.createdAt))
  }

  async get({ id }) {
    const loaded = await this._require(id)
    return loaded.ok ? Outcome.ok(loaded.value.toJSON()) : loaded
  }

  async appendMessage({ id, role, text }) {
    const loaded = await this._require(id)
    if (!loaded.ok) return loaded

    const conversation = loaded.value
    const message = conversation.append(role, text)
    const written = await this.repository.put(conversation.toJSON())
    const notes = [
      ...message.repairs,
      ...(written.ok ? [] : [`not saved: ${written.failure.message}`]),
    ]
    return Outcome.ok(message.toJSON(), notes)
  }

  async rename({ id, title }) {
    const loaded = await this._require(id)
    if (!loaded.ok) return loaded

    const conversation = loaded.value
    const before = conversation.title
    const after = conversation.rename(title)
    const written = await this.repository.put(conversation.toJSON())
    const notes = []
    if (after === before) notes.push('the new title was empty; the old one was kept')
    if (!written.ok) notes.push(`not saved: ${written.failure.message}`)
    return Outcome.ok(conversation.toJSON(), notes)
  }

  async remove({ id }) {
    const removed = await this.repository.remove(id)
    if (!removed.ok) return removed
    // Deleting something already gone is the state the caller wanted. Reporting
    // it as a failure would make a retry look broken.
    return Outcome.ok({ id }, removed.value ? [] : ['it was already gone'])
  }
}

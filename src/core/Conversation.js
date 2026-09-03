import { newId } from './ids.js'
import { Message } from './Message.js'

/**
 * A conversation is its id, never its field values: two loads of the same
 * conversation are the same conversation even after one of them is renamed or
 * appended to. `toJSON` carries that id because the object store is keyed on it
 * (see `IndexedDb`), so a record that drops `id` cannot be written at all.
 *
 * This is the single owner of what a message is. It used not to be:
 * `ChatService` pushed plain rows onto the record it had loaded and never
 * constructed a `Message`, so two writers held two spellings of one schema and
 * the fields only one of them knew about — `thinking` one way, `repairs` the
 * other — were dropped by whichever wrote last.
 */
export class Conversation {
  constructor({ id = newId(), title = 'Untitled', messages = [], createdAt = Date.now() } = {}) {
    this.id = id
    this.title = title
    this.createdAt = createdAt
    // A record this module did not write is still evidence — that is the whole
    // doctrine of `Message`, which repairs an unknown role and a non-string
    // body rather than refusing. The doctrine used to stop at the container: a
    // `messages` that was not a list threw out of `map`, out of `fromJSON`, out
    // of `ConversationService.list` — which maps the WHOLE store through here —
    // and one damaged row therefore hid every other conversation from the menu.
    // `page.jsx` boots off `list` and opens the first row, so the user was
    // shown a brand-new empty chat and no way back to any of them.
    const rows = Array.isArray(messages) ? messages : []
    this._messages = rows.map((m) => (m instanceof Message ? m : Message.fromJSON(m)))
  }

  /** A copy, so callers cannot mutate history by holding the array. */
  get messages() {
    return [...this._messages]
  }

  /**
   * Append and return the stored message, so the caller learns its id.
   * `Message` repairs an unknown role or a non-string body rather than
   * refusing, and records what it changed.
   *
   * Named rather than positional. All three are strings, so a transposed pair
   * is accepted in silence and arrives as a transcript with the model's private
   * reasoning where the reply should be.
   */
  append({ role, text, thinking, attachments } = {}) {
    const message = new Message({ role, text, thinking, attachments })
    this._messages.push(message)
    return message
  }

  /**
   * Rename, or keep the current title when the new one is empty. Refusing would
   * mean an error path for something with an obvious correct answer: a
   * conversation the user did not really rename.
   */
  rename(title) {
    const cleaned = typeof title === 'string' ? title.trim() : ''
    if (cleaned) this.title = cleaned
    return this.title
  }

  static fromJSON(raw) {
    const record = raw ?? {}
    // Rehydrating is not creating, so a record written before `createdAt`
    // existed keeps the oldest time there is rather than the moment it was
    // read. `list` sorts newest first: minting `Date.now()` here put the one
    // record too old to have the field at the top of the menu.
    return new Conversation({ ...record, createdAt: record.createdAt ?? 0 })
  }

  /**
   * The persisted record, and the only shape that leaves this module: the
   * service writes it and the worker posts it. The instance is never stored or
   * cloned, so this literal is the schema, not the field order above.
   */
  toJSON() {
    return {
      id: this.id,
      title: this.title,
      createdAt: this.createdAt,
      messages: this._messages.map((m) => m.toJSON()),
    }
  }
}

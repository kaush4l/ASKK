import { newId } from './ids.js'
import { Message } from './Message.js'

/**
 * A conversation is its id, never its field values: two loads of the same
 * conversation are the same conversation even after one of them is renamed or
 * appended to. `toJSON` carries that id because the object store is keyed on it
 * (see `IndexedDb`), so a record that drops `id` cannot be written at all.
 *
 * This is not yet the single owner of message invariants. `ConversationService`
 * is its only caller; `ChatService` pushes plain rows onto the record it loaded
 * and never constructs a `Message`, so the repair path below does not run on
 * the live chat path.
 */
export class Conversation {
  constructor({ id = newId(), title = 'Untitled', messages = [], createdAt = Date.now() } = {}) {
    this.id = id
    this.title = title
    this.createdAt = createdAt
    this._messages = messages.map((m) => (m instanceof Message ? m : Message.fromJSON(m)))
  }

  /** A copy, so callers cannot mutate history by holding the array. */
  get messages() {
    return [...this._messages]
  }

  /**
   * Append and return the stored message, so the caller learns its id.
   * `Message` repairs an unknown role or a non-string body rather than
   * refusing, and records what it changed.
   */
  append(role, text) {
    const message = new Message({ role, text })
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
    return new Conversation(raw)
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

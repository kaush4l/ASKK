import { Entity } from './Entity.js'
import { newId } from './ids.js'
import { Message } from './Message.js'

/**
 * Aggregate root. Messages are only ever reachable through the conversation
 * that owns them, so every invariant about ordering and membership has exactly
 * one place to live.
 */
export class Conversation extends Entity {
  constructor({ id = newId(), title = 'Untitled', messages = [], createdAt = Date.now() }) {
    super(id)
    this.title = title
    this.createdAt = createdAt
    this._messages = messages.map((m) => (m instanceof Message ? m : Message.fromJSON(m)))
  }

  /** A copy, so callers cannot mutate history by holding the array. */
  get messages() {
    return [...this._messages]
  }

  get messageCount() {
    return this._messages.length
  }

  get lastMessage() {
    return this._messages[this._messages.length - 1] ?? null
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

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      createdAt: this.createdAt,
      messages: this._messages.map((m) => m.toJSON()),
    }
  }
}

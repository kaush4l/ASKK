import { Entity } from './Entity.js'
import { newId } from './ids.js'

/** Who produced a message. Anything outside this set is repaired, not rejected. */
export const Role = Object.freeze({
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
})

const ROLES = new Set(Object.values(Role))

export class Message extends Entity {
  constructor({ id = newId(), role, text, createdAt = Date.now(), repairs = [] } = {}) {
    super(id)

    // Repaired rather than refused. A malformed message is still evidence of
    // something the user or the model did, and losing it to a constructor
    // teaches nobody anything. What was changed is recorded on the message, so
    // a correction can be seen instead of merely assumed.
    const noted = [...repairs]
    let finalRole = role
    if (!ROLES.has(finalRole)) {
      noted.push(`role ${JSON.stringify(role)} was not recognised; treated as ${Role.USER}`)
      finalRole = Role.USER
    }
    let finalText = typeof text === 'string' ? text : String(text ?? '')
    if (typeof text !== 'string' && text != null) {
      noted.push('text was not a string; converted')
      finalText = String(text)
    }

    this.role = finalRole
    this.text = finalText
    this.createdAt = createdAt
    this.repairs = noted
    // Frozen because a message is a record of something that happened. Editing
    // history in place is how a log stops being evidence.
    Object.freeze(this)
  }

  static fromJSON(raw) {
    return new Message(raw ?? {})
  }

  get isEmpty() {
    return this.text.trim().length === 0
  }

  toJSON() {
    return {
      id: this.id,
      role: this.role,
      text: this.text,
      createdAt: this.createdAt,
      ...(this.repairs.length ? { repairs: this.repairs } : {}),
    }
  }
}

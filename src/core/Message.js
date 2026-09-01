import { newId } from './ids.js'

/** Who produced a message. Anything outside this set is repaired, not rejected. */
export const Role = Object.freeze({
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
})

const ROLES = new Set(Object.values(Role))

/**
 * One rule for every text field on the record, written once.
 *
 * It was written twice — once inline for `text`, and not at all for `thinking`,
 * which is how `thinking` came to be a field only one of the two writers had
 * heard of. A second spelling of the same rule is how the next field diverges.
 */
function asText(value, field, noted) {
  if (typeof value === 'string') return value
  // `== null`, not `=== undefined`, because a JSON or IndexedDB round trip is
  // where an absent field comes back as `null` — and `String(null)` is the
  // four-character string "null", stored as the message body and reported as a
  // conversion the user is supposed to understand.
  if (value == null) return ''
  noted.push(`${field} was not a string; converted`)
  return String(value)
}

export class Message {
  constructor({ id = newId(), role, text, thinking, createdAt = Date.now(), repairs = [] } = {}) {
    this.id = id

    // Repaired rather than refused. A malformed message is still evidence of
    // something the user or the model did, and losing it to a constructor
    // teaches nobody anything. What was changed is recorded on the message, so
    // a correction can be seen instead of merely assumed.
    //
    // The trail itself gets the same treatment as `text`, for the same reason:
    // a `repairs` that was not a list threw out of the spread, which made the
    // one field that is ABOUT damage the one field damage could not survive.
    // The guard is `Array.isArray` and not truthiness because a STRING spreads
    // — `repairs: 'ab'` used to rehydrate as `['a', 'b']`, an audit trail
    // forged out of characters.
    const noted = Array.isArray(repairs) ? [...repairs] : []
    if (repairs != null && !Array.isArray(repairs)) {
      noted.push('repairs was not a list; the earlier trail was lost')
    }
    let finalRole = role
    if (!ROLES.has(finalRole)) {
      noted.push(`role ${JSON.stringify(role)} was not recognised; treated as ${Role.USER}`)
      finalRole = Role.USER
    }

    this.role = finalRole
    this.text = asText(text, 'text', noted)
    // The model's own working-out, kept beside the reply it produced rather
    // than in a parallel store: it is part of the turn, it is written by the
    // same call, and a second home for it is what let one writer drop it.
    this.thinking = asText(thinking, 'thinking', noted)
    this.createdAt = createdAt
    // The array too, and not only the object around it. `repairs` is the one
    // field on a message reachable by reference, and it is the field that is
    // about evidence: a line pushed onto it by anyone holding the message round
    // trips through `toJSON` into storage and out to the user as a note.
    this.repairs = Object.freeze(noted)
    // Frozen because a message is a record of something that happened. Editing
    // history in place is how a log stops being evidence.
    Object.freeze(this)
  }

  static fromJSON(raw) {
    const record = raw ?? {}
    // Rehydrating is not creating. A record written before `createdAt` existed
    // would otherwise be stamped with the moment it was READ, which makes an
    // old message look like the newest thing in the transcript.
    return new Message({ ...record, createdAt: record.createdAt ?? 0 })
  }

  /**
   * The plain, structured-cloneable form written to storage and sent over the
   * wire. Nothing outside this module ever holds an instance, so this literal
   * is the schema — changing it changes the record on disk.
   *
   * `thinking` and `repairs` are elided when empty rather than written as `''`
   * and `[]`. Most messages have neither, and a user turn carrying two empty
   * fields is two fields of storage and wire traffic per turn for nothing.
   */
  toJSON() {
    return {
      id: this.id,
      role: this.role,
      text: this.text,
      createdAt: this.createdAt,
      ...(this.thinking ? { thinking: this.thinking } : {}),
      ...(this.repairs.length ? { repairs: this.repairs } : {}),
    }
  }
}

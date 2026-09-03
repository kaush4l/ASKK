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

/**
 * Enough of a refused attachment to recognise it, and no more.
 *
 * The trail this lands in is frozen onto the message, written to storage and
 * read back to the user as a note, so what goes into it is bounded on purpose:
 * an entry gets refused for not being the short `data:` prefix this field
 * expects, which means it can be any length at all. A string is quoted and cut;
 * anything else is named by its TYPE, because both of the obvious ways to print
 * an unknown value throw on something — `String()` on a symbol, `JSON.stringify`
 * on a bigint — and this is a file whose whole argument is that a malformed
 * message is repaired rather than lost. `JSON.stringify` is safe on the branch
 * it is used, which is the one where the value is already known to be a string.
 */
function nameRefused(value) {
  if (typeof value !== 'string') return value === null ? 'null' : typeof value
  return value.length > 40 ? `${JSON.stringify(value.slice(0, 40))}…` : JSON.stringify(value)
}

export class Message {
  constructor({
    id = newId(),
    role,
    text,
    thinking,
    attachments = [],
    createdAt = Date.now(),
    repairs = [],
  } = {}) {
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
    /**
     * What was sent ALONGSIDE the words: data URLs, in the order they were
     * attached.
     *
     * Every layer under this one has taken attachments since it was written and
     * no caller ever passed any — `CAPABILITIES.md` names it as the standing
     * example of a capability declared and never wired. It is stored on the
     * message rather than held for the length of a turn because a transcript
     * that shows only the words makes a person's own screenshot vanish from
     * their history the moment they reload.
     *
     * Filtered rather than refused, like every other field here: a bad entry is
     * dropped with a line saying so, because an attachment nobody can read must
     * not cost the question it came with. `Array.isArray` and not truthiness
     * for the reason `repairs` gives — a string spreads into its characters.
     *
     * The rule is `data:` and not "a non-empty string", which is what it used
     * to be. The doc above this said data URLs and the filter said something
     * far weaker, so `attachments: ['https://example.com/cat.png']` was kept
     * whole with no repair recorded — and a remote URL is precisely the entry
     * that must not survive: something downstream fetching it is this app
     * making a request on the user's behalf to a host nobody named, from a page
     * whose whole claim is that nothing leaves the browser except the model
     * call they configured. The real check did exist, in `ChatService.send`,
     * which is one caller of one route; `conversations.appendMessage` is on the
     * Kernel and reaches this constructor with nothing in between. A rule the
     * field documents belongs where the field is.
     *
     * The line NAMES what went, because a count alone tells someone holding a
     * half-sent question that something was dropped and gives them no way to
     * work out which of the things they attached it was.
     */
    const files = Array.isArray(attachments) ? attachments : []
    if (attachments != null && !Array.isArray(attachments)) {
      noted.push('attachments was not a list; it was dropped')
    }
    const kept = []
    const refused = []
    for (const one of files) {
      if (typeof one === 'string' && one.startsWith('data:')) kept.push(one)
      else refused.push(one)
    }
    if (refused.length) {
      noted.push(
        `${refused.length} attachment(s) were not data URLs and were dropped: ` +
          refused.map(nameRefused).join(', '),
      )
    }
    this.attachments = Object.freeze(kept)
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
      // Omitted when there are none, like `thinking` above: a record carrying
      // an empty list for every message it has ever held is bytes in the store
      // saying nothing, and the constructor's default puts it back on the way
      // out.
      ...(this.attachments.length ? { attachments: this.attachments } : {}),
      ...(this.repairs.length ? { repairs: this.repairs } : {}),
    }
  }
}

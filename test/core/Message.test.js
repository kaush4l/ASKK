import { describe, expect, test } from 'bun:test'
import { Marker, Message, Role } from '../../src/core/Message.js'

/**
 * `Message` used to get its id from an `Entity` base class whose `super(id)`
 * ran before anything else. The base class is gone and the constructor assigns
 * `this.id` itself, so what that deletion could have broken is pinned here: a
 * message has an id, it is unique, and `toJSON` carries it.
 *
 * `toJSON` is the only shape that leaves the module — nothing persists, spreads
 * or clones the instance — and the object store is keyed `{ keyPath: 'id' }`,
 * so a record that drops `id` cannot be written at all. That is the reason
 * these assertions read the record and not the instance's own key order, which
 * no consumer in the tree observes.
 */

describe('Message identity', () => {
  test('the given id is kept', () => {
    expect(new Message({ id: 'm-1', role: Role.USER, text: 'hi' }).id).toBe('m-1')
  })

  test('an id is minted when none is given', () => {
    const message = new Message({ role: Role.USER, text: 'hi' })

    expect(typeof message.id).toBe('string')
    expect(message.id.length).toBeGreaterThan(0)
  })

  test('two messages built the same way still have different ids', () => {
    const one = new Message({ role: Role.USER, text: 'hi' })
    const other = new Message({ role: Role.USER, text: 'hi' })

    expect(one.id).not.toBe(other.id)
  })

  test('toJSON carries the id, which is the store key', () => {
    const record = new Message({ id: 'm-1', role: Role.USER, text: 'hi' }).toJSON()

    expect(record.id).toBe('m-1')
    // `repairs` is elided when empty, so the record is not the instance.
    expect(record.repairs).toBeUndefined()
  })

  test('id survives the repair path, which runs after the assignment', () => {
    // The repair branch sits between `this.id = id` and every other field. A
    // message that had to be repaired is the case where a constructor that
    // dropped the assignment would show up first.
    const message = new Message({ id: 'm-1', role: 'wizard', text: 7 })

    expect(message.toJSON().id).toBe('m-1')
    expect(message.toJSON().repairs).toHaveLength(2)
  })

  test('a stored message cannot be edited in place', () => {
    // The freeze is the claim that a message is evidence of something that
    // happened. Under ESM's strict mode the refused write throws, but the
    // assertion that matters either way is that the text did not change.
    const message = new Message({ id: 'm-1', role: Role.USER, text: 'hi' })

    expect(() => {
      message.text = 'tampered'
    }).toThrow()
    expect(message.text).toBe('hi')
  })

  test('a round trip through JSON keeps the id', () => {
    const message = new Message({ id: 'm-1', role: Role.ASSISTANT, text: 'hi' })

    expect(Message.fromJSON(JSON.parse(JSON.stringify(message))).id).toBe('m-1')
  })
})

describe('what a message is made of', () => {
  test('the scratchpad is a field of the record, emitted only when there is one', () => {
    const withThought = new Message({ role: Role.ASSISTANT, text: 'linux', thinking: 'because' })
    const without = new Message({ role: Role.ASSISTANT, text: 'linux' })

    expect(withThought.toJSON().thinking).toBe('because')
    expect('thinking' in without.toJSON()).toBe(false)
  })

  test('a non-string scratchpad is converted and the conversion is recorded', () => {
    // The same rule as `text`, written once and applied to both. It used to be
    // written inline for `text` and not at all for `thinking`, which is how
    // `thinking` came to be a field only one of the two writers had heard of.
    const message = new Message({ role: Role.ASSISTANT, text: 'linux', thinking: 7 })

    expect(message.thinking).toBe('7')
    expect(message.toJSON().repairs).toEqual(['thinking was not a string; converted'])
  })

  test('an absent scratchpad is empty and is not a repair', () => {
    const message = new Message({ role: Role.USER, text: 'hi' })

    expect(message.thinking).toBe('')
    expect(message.repairs).toEqual([])
  })

  test('a field stored as null is empty too, not the four letters of "null"', () => {
    // `undefined` is what the case above passes, and it is not the case that
    // reaches a stored record: a JSON or IndexedDB round trip hands back
    // `null`. With the guard written `=== undefined` every assertion in this
    // file stayed green while `String(null)` became the message body.
    const message = new Message({ role: Role.USER, text: null, thinking: null })

    expect(message.text).toBe('')
    expect(message.thinking).toBe('')
    expect(message.repairs).toEqual([])
  })

  test('a repairs field that is not a list costs the trail, not the message', () => {
    // The audit trail is the one field that is ABOUT damage, and it was the one
    // field damage could not survive: a non-iterable `repairs` threw out of the
    // spread in the constructor, out of `fromJSON`, and out of every read of
    // the conversation holding it.
    const forged = Message.fromJSON({ id: 'm-1', role: Role.USER, text: 'hi', repairs: 'ab' })

    // Not `['a', 'b']`, which is what spreading a string produced: an audit
    // trail invented out of characters.
    expect(forged.repairs).toEqual(['repairs was not a list; the earlier trail was lost'])
    expect(forged.text).toBe('hi')
    expect(Message.fromJSON({ role: Role.USER, text: 'hi', repairs: 5 }).repairs).toHaveLength(1)
    // An absent trail is absent, not damaged.
    expect(Message.fromJSON({ role: Role.USER, text: 'hi', repairs: null }).repairs).toEqual([])
  })

  test('the audit trail cannot be added to by whoever is holding the message', () => {
    // The freeze on the object leaves the array reachable by reference, and
    // `toJSON` emits whatever is in it — so a line pushed here round trips into
    // storage and reaches the user as a note the service never wrote.
    const message = new Message({ role: Role.ASSISTANT, text: 'linux', thinking: 7 })

    expect(() => message.repairs.push('forged')).toThrow()
    expect(message.toJSON().repairs).toEqual(['thinking was not a string; converted'])
  })

  test('a stored message survives a full round trip with everything on it', () => {
    const original = new Message({ role: 'wizard', text: 7, thinking: 'hmm' })

    const back = Message.fromJSON(original.toJSON())

    expect(back.toJSON()).toEqual(original.toJSON())
    expect(back.thinking).toBe('hmm')
    // The repairs are carried, not re-derived: the second pass has nothing left
    // to repair, so a record that re-earned them would be one that lost them.
    expect(back.repairs).toEqual(original.repairs)
  })

  test('a message that predates createdAt keeps the oldest time, not the time it was read', () => {
    expect(Message.fromJSON({ id: 'm-1', role: Role.USER, text: 'ancient' }).createdAt).toBe(0)
    expect(
      Message.fromJSON({ id: 'm-1', role: Role.USER, text: 'x', createdAt: 5 }).createdAt,
    ).toBe(5)
  })
})

describe('what was attached to a message', () => {
  test('data URLs are kept in order and anything else is dropped with a repair', () => {
    // The one field on a message that is not text. It exists because the whole
    // inference chain below it — `Engine.step`, both providers, `Multimodality`
    // — has taken attachments since it was written and no caller ever passed
    // any; `CAPABILITIES.md` names it as the standing example of a capability
    // declared and never wired. A transcript that shows only the words would
    // make a person's own screenshot vanish from their history on reload.
    //
    // TWO survivors, with the refused entries BETWEEN them, because "in order"
    // is the claim in the name and one survivor cannot be out of order. The
    // fixture used to be `[png, 7, '']`, which the weaker rule this test is
    // about — any non-empty string — dropped exactly as the documented one
    // does, so the assertion could not tell the two rules apart.
    const png = 'data:image/png;base64,iVBORw0KGgo='
    const wav = 'data:audio/wav;base64,UklGRhwAAABXQVZF'
    const message = new Message({
      role: 'user',
      text: 'what is this?',
      attachments: [png, 'https://example.com/cat.png', wav, 'not a url at all', 7, ''],
    })

    expect(message.attachments).toEqual([png, wav])
    // The trail NAMES what went. A count on its own tells the person holding a
    // half-sent question that something was dropped and gives them no way to
    // find out which of the six things they attached it was.
    expect(message.repairs).toEqual([
      '4 attachment(s) were not data URLs and were dropped: ' +
        '"https://example.com/cat.png", "not a url at all", number, ""',
    ])
  })

  test('a remote URL is dropped here, not one layer up where only one caller looks', () => {
    // The probe from the review, and the reason the rule moved. The field's own
    // doc says data URLs; the filter said "non-empty string", so both of these
    // were KEPT with zero repairs. The real check lived in `ChatService`, which
    // is one caller of one route — `conversations.appendMessage` is exposed on
    // the Kernel and reaches this constructor with no guard between.
    //
    // A remote URL is the entry that matters: kept, it is a request the app
    // would make on the user's behalf to a host nobody named, from a page whose
    // whole claim is that nothing leaves the browser except the model call they
    // configured.
    const message = new Message({
      role: 'user',
      text: 'read these',
      attachments: ['https://example.com/cat.png', 'not a url at all'],
    })

    expect(message.attachments).toEqual([])
    expect(message.repairs).toHaveLength(1)
  })

  test('a refused entry is named by its type or a cut quotation, never by String()', () => {
    // The trail is frozen onto the message, written to storage and read back to
    // the user as a note, so what goes in it is bounded on purpose: a dropped
    // entry can be any size — being long and not a data URL is the whole of
    // what makes it refusable — and `String(Symbol())` throws in a file whose
    // one rule is that nothing here does.
    const long = `https://example.com/${'a'.repeat(80)}.png`
    const message = new Message({ role: 'user', text: 'x', attachments: [long, Symbol('s')] })

    expect(message.attachments).toEqual([])
    const [trail] = message.repairs
    expect(trail).toContain('"https://example.com/aaaaaaaaaaaaaaaaaaaa"…')
    expect(trail).toContain('symbol')
    expect(trail.length).toBeLessThan(120)
  })

  test('a message with nothing attached carries an empty list, never undefined', () => {
    // Read on every render of every turn. `undefined` would make each reader
    // write its own `?? []`, which is the way `thinking` became a field only
    // one of two writers had heard of.
    expect(new Message({ role: 'user', text: 'hello' }).attachments).toEqual([])
    expect(Message.fromJSON({ role: 'user', text: 'hello' }).attachments).toEqual([])
  })

  test('the list survives a JSON round trip and cannot be edited in place', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    const there = Message.fromJSON(
      new Message({ role: 'user', text: 'x', attachments: [png] }).toJSON(),
    )
    expect(there.attachments).toEqual([png])
    expect(Object.isFrozen(there.attachments)).toBe(true)
  })
})

/**
 * What happened to a turn, asked of the record rather than of the page.
 *
 * The three facts here — a turn that failed, a turn the user stopped, a
 * question a schedule asked — all used to live in a toast, and a toast is
 * dismissed by the next thing that happens. A reviewer sent a second question
 * after a failed one and watched the first turn become indistinguishable from a
 * message that was never sent; another pressed stop and, after a reload, found
 * their question sitting there with no answer and no reason beside it. A record
 * that quietly rewrites itself is worse than no record at all, so the fact goes
 * where the words go.
 */
describe('what happened to a turn, kept on the turn', () => {
  test('the marker is a field of the record, emitted only when there is one', () => {
    const stopped = new Message({ role: Role.ASSISTANT, text: '', marker: Marker.STOPPED })
    const ordinary = new Message({ role: Role.ASSISTANT, text: 'linux' })

    expect(stopped.toJSON().marker).toBe('stopped')
    // Elided like `thinking` and `attachments`, and for the same reason: almost
    // every message in a transcript has nothing to say here, and a field
    // written as `''` on all of them is storage and wire traffic per turn for
    // nothing.
    expect('marker' in ordinary.toJSON()).toBe(false)
  })

  test('all three of the markers are recognised, because one field carries all three', () => {
    for (const one of [Marker.FAILED, Marker.STOPPED, Marker.SCHEDULED]) {
      expect(new Message({ role: Role.USER, text: 'hi', marker: one }).marker).toBe(one)
    }
  })

  test('an unrecognised marker is dropped, and the drop is recorded', () => {
    // Dropped rather than repaired to a default, which is what `role` does. A
    // role has a right answer when it is wrong — somebody said this, and it was
    // more likely the user than the model — and a marker has none: inventing
    // one would draw a sentence about a turn that never happened. Nothing is
    // the honest reading, and the trail says a reading was refused.
    const message = new Message({ role: Role.USER, text: 'hi', marker: 'cancelled' })

    expect(message.marker).toBe('')
    expect(message.repairs).toEqual(['marker "cancelled" was not recognised; it was dropped'])
  })

  test('a marker that is not a string at all is named by its type, never by String()', () => {
    // The same bound the attachment trail is under, and for the same reason:
    // this line is frozen onto the message, written to storage and read back to
    // a person, and `String(Symbol())` throws in a file whose whole argument is
    // that a malformed message is repaired rather than lost.
    const message = new Message({ role: Role.USER, text: 'hi', marker: Symbol('nope') })

    expect(message.marker).toBe('')
    expect(message.repairs).toEqual(['marker symbol was not recognised; it was dropped'])
  })

  test('an absent marker is empty and is not a repair', () => {
    // `null` and not only `undefined`: absent is what a JSON or IndexedDB round
    // trip hands back for a field that was elided, which is every message that
    // ever ran normally. Reporting a repair on all of them would put a note on
    // screen for the ordinary case.
    for (const nothing of [undefined, null, '']) {
      const message = new Message({ role: Role.USER, text: 'hi', marker: nothing })
      expect(message.marker).toBe('')
      expect(message.repairs).toEqual([])
    }
  })

  test('the marker survives a round trip, which is the whole of what makes it a record', () => {
    // The claim the toast could not make. A page reload rebuilds the transcript
    // out of these records and nothing else, so a marker that did not come back
    // through `fromJSON` would be a marker that vanishes exactly when the user
    // returns to look for it.
    const original = new Message({ role: Role.ASSISTANT, text: '', marker: Marker.FAILED })

    const back = Message.fromJSON(JSON.parse(JSON.stringify(original)))

    expect(back.marker).toBe('failed')
    expect(back.toJSON()).toEqual(original.toJSON())
  })

  test('a marked message cannot have its marker edited in place', () => {
    const message = new Message({ role: Role.USER, text: 'hi', marker: Marker.SCHEDULED })

    expect(() => {
      message.marker = Marker.FAILED
    }).toThrow()
    expect(message.marker).toBe('scheduled')
  })
})

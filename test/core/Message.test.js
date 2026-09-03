import { describe, expect, test } from 'bun:test'
import { Message, Role } from '../../src/core/Message.js'

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
    const png = 'data:image/png;base64,iVBORw0KGgo='
    const message = new Message({ role: 'user', text: 'what is this?', attachments: [png, 7, ''] })

    expect(message.attachments).toEqual([png])
    expect(message.repairs.join(' ')).toContain('attachment')
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

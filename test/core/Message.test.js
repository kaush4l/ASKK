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

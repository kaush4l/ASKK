import { describe, expect, test } from 'bun:test'
import { Conversation } from '../../src/core/Conversation.js'
import { Role } from '../../src/core/Message.js'

/**
 * A conversation is its id, never its field values, and that id used to be
 * assigned by an `Entity` base class. With the base class gone the constructor
 * assigns it, so the same properties `Message.test.js` pins are pinned here:
 * the id is kept, it is unique, and the record `ConversationService` writes
 * carries it.
 *
 * The record is `toJSON()`, not the instance. Nothing in the tree stores,
 * spreads or clones a `Conversation`, so the instance's own key order is not
 * asserted — it has no consumer to break.
 */

describe('Conversation identity', () => {
  test('the given id is kept', () => {
    expect(new Conversation({ id: 'c-1' }).id).toBe('c-1')
  })

  test('an id is minted when none is given', () => {
    const conversation = new Conversation({})

    expect(typeof conversation.id).toBe('string')
    expect(conversation.id.length).toBeGreaterThan(0)
  })

  test('two conversations built the same way still have different ids', () => {
    // Without this the minted id could be a constant, and the second `put`
    // would silently overwrite the first: the store is keyed on `id`.
    expect(new Conversation({}).id).not.toBe(new Conversation({}).id)
  })

  test('a conversation can be built from nothing', () => {
    // `fromJSON` is fed whatever the repository returned. Nothing in `src/`
    // throws, so a missing record has to come back as a value.
    expect(typeof Conversation.fromJSON(undefined).id).toBe('string')
  })

  test('toJSON is the persisted record: keyed by id, messages flattened', () => {
    const conversation = new Conversation({ id: 'c-1', title: 'Chat', createdAt: 1 })
    conversation.append({ role: Role.USER, text: 'hi' })

    const record = conversation.toJSON()

    expect(record.id).toBe('c-1')
    expect(record.messages).toHaveLength(1)
    // Asserted because `append` takes one object and every field in it is a
    // string: called positionally it repairs rather than refusing, and every
    // assertion in this file about ids and lengths stays green over a message
    // whose text is ''.
    expect(record.messages[0].text).toBe('hi')
    expect(record.messages[0].role).toBe(Role.USER)
    expect(record.messages[0].repairs).toBeUndefined()
    // The record is not the instance: the instance holds `_messages` of
    // `Message`, the record holds `messages` of plain rows.
    expect(record._messages).toBeUndefined()
    expect(Object.getPrototypeOf(record.messages[0])).toBe(Object.prototype)
  })

  test('mutating the conversation does not change which conversation it is', () => {
    // The sentence the docstring makes: identity is the id, not the fields.
    const conversation = new Conversation({ id: 'c-1', title: 'Chat' })
    conversation.rename('Renamed')
    conversation.append({ role: Role.USER, text: 'hi' })

    expect(conversation.id).toBe('c-1')
    expect(conversation.toJSON().title).toBe('Renamed')
  })

  test('an empty rename keeps the old title', () => {
    const conversation = new Conversation({ id: 'c-1', title: 'Chat' })

    expect(conversation.rename('   ')).toBe('Chat')
    expect(conversation.rename('Renamed')).toBe('Renamed')
  })

  test('holding the messages array cannot rewrite history', () => {
    // The getter copies on read. If it returned `_messages` this push would
    // land in the record.
    const conversation = new Conversation({ id: 'c-1' })
    conversation.append({ role: Role.USER, text: 'hi' })

    conversation.messages.push('forged')

    expect(conversation.toJSON().messages).toHaveLength(1)
  })

  test('a round trip through JSON keeps the conversation and message ids', () => {
    const conversation = new Conversation({ id: 'c-1', title: 'Chat' })
    const appended = conversation.append({ role: Role.USER, text: 'hi' })

    const reloaded = Conversation.fromJSON(JSON.parse(JSON.stringify(conversation)))

    expect(reloaded.id).toBe('c-1')
    expect(reloaded.messages[0].id).toBe(appended.id)
  })
})

describe('the scratchpad a reply was written with', () => {
  test('it is part of the message, not a field beside it', () => {
    // `ChatService` needed somewhere to keep the model's working-out and wrote
    // it onto a literal of its own, which `Message.toJSON` did not emit: one
    // schema, two writers, and the field belonged to the one that wrote last.
    const conversation = new Conversation({ id: 'c-1' })

    conversation.append({ role: Role.ASSISTANT, text: 'linux', thinking: 'one\ntwo' })

    expect(conversation.toJSON().messages[0].thinking).toBe('one\ntwo')
  })

  test('a reply with nothing behind it does not carry an empty field', () => {
    const conversation = new Conversation({ id: 'c-1' })

    conversation.append({ role: Role.ASSISTANT, text: 'linux' })

    expect('thinking' in conversation.toJSON().messages[0]).toBe(false)
  })

  test('a record whose messages field is not a list keeps the conversation', () => {
    // `Message` repairs an unknown role and a non-string body rather than
    // refusing; the container did not, and threw out of `map`. Everything that
    // reads a conversation goes through this constructor, so the throw was not
    // confined to the damaged record — see `ConversationService.test.js` for
    // what it cost the menu.
    const reloaded = Conversation.fromJSON({ id: 'c-1', title: 'Corrupt', messages: null })

    expect(reloaded.id).toBe('c-1')
    expect(reloaded.title).toBe('Corrupt')
    expect(reloaded.messages).toEqual([])
    expect(Conversation.fromJSON({ id: 'c-2', messages: 'hi' }).messages).toEqual([])
  })

  test('a record that predates createdAt keeps the oldest time, not the time it was read', () => {
    // The constructor's default is right for a conversation being made and
    // wrong for one being rehydrated. `ConversationService.list` sorts newest
    // first, and `page.jsx` opens the first row.
    const reloaded = Conversation.fromJSON({ id: 'c-1', title: 'Ancient', messages: [] })

    expect(reloaded.createdAt).toBe(0)
  })
})

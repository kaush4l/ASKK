import { describe, expect, test } from 'bun:test'
import { MemoryRepository } from '../../src/backend/repositories/MemoryRepository.js'
import { ConversationService } from '../../src/backend/services/ConversationService.js'
import { Outcome, Reason } from '../../src/core/Outcome.js'

/**
 * The class had no test file at all, and it is the only thing in the tree that
 * enforces the load/mutate/save script and the only caller of `Conversation`.
 *
 * So these are not smoke tests. Each one is a way the script can be wrong that
 * a test of the domain model cannot see, because the domain model has no
 * storage and no concurrency: a record read before another write landed, two
 * writes that overlap, and a record on disk older than the code reading it.
 *
 * `MemoryRepository` is the real one — the adapter the app itself falls back to
 * when IndexedDB is refused. Its `get` returns the stored object BY REFERENCE,
 * which is the harsher of the two ports to test against: a service that
 * accidentally mutates what it loaded looks correct here and loses the mutation
 * against IndexedDB, so every assertion below reads `rows` after a `put`.
 */

const store = (rows = []) => {
  const repository = new MemoryRepository('conversation')
  for (const row of rows) repository.rows.set(row.id, row)
  return repository
}

const chat = (messages = []) => ({ id: 'c1', title: 'Chat', createdAt: 10, messages })
const stored = (repository, id = 'c1') => repository.rows.get(id)

/** A store that accepts reads and refuses every write. */
const readOnly = (rows) => {
  const repository = store(rows)
  repository.put = async () => Outcome.failed(Reason.UNAVAILABLE, 'the disk is full')
  return repository
}

describe('the field the other writer knew about', () => {
  test('one round trip does not erase the thinking on an assistant message', async () => {
    // The defect, at its smallest. `ChatService` wrote `thinking`;
    // `Message.toJSON` did not emit it; the first load/mutate/save through this
    // service therefore rewrote the message without it. Nothing failed and
    // nothing was reported — the field was simply not in the record any more.
    const repository = store([
      chat([
        { id: 'm1', role: 'user', text: 'what kernel?', createdAt: 2 },
        { id: 'm2', role: 'assistant', text: 'linux', createdAt: 3, thinking: 'one\ntwo' },
      ]),
    ])

    await new ConversationService(repository).rename({ id: 'c1', title: 'Kernels' })

    expect(stored(repository).messages[1].thinking).toBe('one\ntwo')
  })

  test('and it survives every other route that rewrites the record', async () => {
    // `rename` is not special. Any route that loads and saves rewrites every
    // message in the conversation, so each one is its own chance to drop a field.
    const repository = store([
      chat([{ id: 'm1', role: 'assistant', text: 'linux', createdAt: 3, thinking: 'why' }]),
    ])
    const conversations = new ConversationService(repository)

    await conversations.appendMessage({ id: 'c1', role: 'user', text: 'and the arch?' })

    expect(stored(repository).messages[0].thinking).toBe('why')
    expect((await conversations.get({ id: 'c1' })).value.messages[0].thinking).toBe('why')
    expect((await conversations.list()).value[0].messages[0].thinking).toBe('why')
  })

  test('an empty scratchpad is not written down as an empty string', async () => {
    // The elision is the reason `thinking` can be absorbed at all: without it
    // every user turn ever stored grows a field that is always ''.
    const repository = store([chat()])

    await new ConversationService(repository).appendMessage({
      id: 'c1',
      role: 'user',
      text: 'hi',
    })

    expect(Object.keys(stored(repository).messages[0])).toEqual(['id', 'role', 'text', 'createdAt'])
  })
})

describe('two writes that overlap', () => {
  test('two appends started together both land', async () => {
    // Load-mutate-save is three awaits and two of them yield. Started together,
    // both calls loaded the same empty transcript and the second `put` wrote
    // one that had never seen the first message. Measured before the queue:
    // `['second']`.
    const repository = store([chat()])
    const conversations = new ConversationService(repository)

    await Promise.all([
      conversations.appendMessage({ id: 'c1', role: 'user', text: 'first' }),
      conversations.appendMessage({ id: 'c1', role: 'user', text: 'second' }),
    ])

    expect(stored(repository).messages.map((m) => m.text)).toEqual(['first', 'second'])
  })

  test('an append and a rename started together keep both changes', async () => {
    // The lost update is not symmetric between two appends. A rename that loads
    // a transcript, has a message appended underneath it, and then writes its
    // own copy back deletes a message while reporting success.
    const repository = store([chat()])
    const conversations = new ConversationService(repository)

    await Promise.all([
      conversations.appendMessage({ id: 'c1', role: 'user', text: 'kept?' }),
      conversations.rename({ id: 'c1', title: 'Renamed' }),
    ])

    expect(stored(repository).title).toBe('Renamed')
    expect(stored(repository).messages.map((m) => m.text)).toEqual(['kept?'])
  })

  test('ten appends started at once arrive in the order they were made', async () => {
    const repository = store([chat()])
    const conversations = new ConversationService(repository)
    const texts = Array.from({ length: 10 }, (_, i) => `m${i}`)

    await Promise.all(
      texts.map((text) => conversations.appendMessage({ id: 'c1', role: 'user', text })),
    )

    expect(stored(repository).messages.map((m) => m.text)).toEqual(texts)
  })

  test('two conversations are not made to wait for each other', async () => {
    // The queue is per conversation, not per service. One queue for everything
    // would serialise unrelated work behind whichever write is slowest.
    const repository = store([chat(), { ...chat(), id: 'c2' }])
    const order = []
    const put = repository.put.bind(repository)
    repository.put = async (record) => {
      order.push(record.id)
      return put(record)
    }
    const conversations = new ConversationService(repository)
    // `c1` is made slow on the READ, so a shared queue would show up as `c2`
    // waiting behind it.
    const get = repository.get.bind(repository)
    repository.get = async (id) => {
      if (id === 'c1') await new Promise((resolve) => setTimeout(resolve, 20))
      return get(id)
    }

    await Promise.all([
      conversations.appendMessage({ id: 'c1', role: 'user', text: 'slow' }),
      conversations.appendMessage({ id: 'c2', role: 'user', text: 'fast' }),
    ])

    expect(order).toEqual(['c2', 'c1'])
  })

  test('a write that fails does not fail the write queued behind it', async () => {
    // The queue carries no failure on purpose. One full disk must not turn
    // every later append into an error whose reason belongs to another call.
    const repository = store([chat()])
    const put = repository.put.bind(repository)
    let first = true
    repository.put = async (record) => {
      if (first) {
        first = false
        return Outcome.failed(Reason.UNAVAILABLE, 'the disk is full')
      }
      return put(record)
    }
    const conversations = new ConversationService(repository)

    const [failed, after] = await Promise.all([
      conversations.appendMessage({ id: 'c1', role: 'user', text: 'lost' }),
      conversations.appendMessage({ id: 'c1', role: 'user', text: 'kept' }),
    ])

    expect(failed.ok).toBe(true)
    expect(failed.notes).toEqual(['the user message was not saved: the disk is full'])
    // The second call is unharmed and says nothing about the first: its own
    // write worked. Nothing about the failure leaked into it.
    expect(after.ok).toBe(true)
    expect(after.notes).toEqual([])
    // And `lost` really is lost, which is what its note said. It never reached
    // the store, so the append behind it loaded a transcript without it. This
    // is the honest outcome of a refused write, not a second defect: the
    // alternative is a service that keeps unsaved messages in memory and lies
    // about which of them are on disk.
    expect(stored(repository).messages.map((m) => m.text)).toEqual(['kept'])
  })

  test('a defect in one write does not brick every later write on that conversation', async () => {
    // Nothing in `src/` throws, so this is a defect and not a state. It still
    // has to be survivable: a rejected promise left in the queue is a
    // predecessor every later write chains off, so ONE thrown error would make
    // every future append to that conversation reject for a reason belonging to
    // a call that finished long ago. The queue therefore carries neither value
    // nor failure. Without that, the second call below rejects too.
    const repository = store([chat()])
    const put = repository.put.bind(repository)
    let first = true
    repository.put = (record) => {
      if (first) {
        first = false
        throw new Error('a defect in the adapter')
      }
      return put(record)
    }
    const conversations = new ConversationService(repository)

    const [crashed, after] = await Promise.allSettled([
      conversations.appendMessage({ id: 'c1', role: 'user', text: 'boom' }),
      conversations.appendMessage({ id: 'c1', role: 'user', text: 'kept' }),
    ])

    expect(crashed.status).toBe('rejected')
    expect(after.status).toBe('fulfilled')
    expect(after.value.ok).toBe(true)
    expect(stored(repository).messages.map((m) => m.text)).toEqual(['kept'])
  })

  test('a delete is not undone by an append that was already in flight', async () => {
    // `remove` wrote the store outside the queue, so it was not "load, mutate,
    // save with nothing else writing in between" — it was that, plus one writer
    // allowed to step around it. An append that had already loaded landed its
    // `put` AFTER the delete and re-created the conversation, both calls
    // reporting ok. A real IndexedDB `put` is slower than a memory one, which
    // is what the delay stands in for.
    const repository = store([chat()])
    const put = repository.put.bind(repository)
    repository.put = async (record) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return put(record)
    }
    const conversations = new ConversationService(repository)

    const append = conversations.appendMessage({ id: 'c1', role: 'user', text: 'in flight' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const removed = await conversations.remove({ id: 'c1' })
    await append

    expect(removed.ok).toBe(true)
    expect(repository.rows.has('c1')).toBe(false)
  })

  test('the queue is emptied once nothing is waiting on it', async () => {
    // Otherwise the map is every conversation the worker ever touched, held for
    // the life of the tab.
    const repository = store([chat()])
    const conversations = new ConversationService(repository)

    await conversations.appendMessage({ id: 'c1', role: 'user', text: 'hi' })
    await Promise.resolve()

    expect(conversations._writes.size).toBe(0)
  })
})

describe('a caller holding a stale record', () => {
  test('a mutation is addressed by id, so what it did not read is not overwritten', async () => {
    // A caller reads, something else appends, and only then does the caller
    // make its change. The change has to land on the CURRENT record: this is
    // exactly the shape of a chat turn, where the model call sits between the
    // read and the write and can take minutes.
    const repository = store([chat()])
    const conversations = new ConversationService(repository)

    const stale = await conversations.get({ id: 'c1' })
    await conversations.appendMessage({ id: 'c1', role: 'assistant', text: 'arrived meanwhile' })
    await conversations.rename({ id: 'c1', title: stale.value.title.toUpperCase() })

    expect(stored(repository).title).toBe('CHAT')
    expect(stored(repository).messages.map((m) => m.text)).toEqual(['arrived meanwhile'])
  })

  test('what a caller was handed cannot be written back through it', async () => {
    // `get` returns a record, not the live conversation. Editing it is editing
    // a copy — there is no route on this service that takes a record at all.
    const repository = store([chat([{ id: 'm1', role: 'user', text: 'hi', createdAt: 1 }])])
    const conversations = new ConversationService(repository)

    const held = await conversations.get({ id: 'c1' })
    held.value.title = 'forged'
    held.value.messages.push({ id: 'm2', role: 'user', text: 'forged' })
    await conversations.rename({ id: 'c1', title: 'Renamed' })

    expect(stored(repository).title).toBe('Renamed')
    expect(stored(repository).messages).toHaveLength(1)
  })

  test('a conversation deleted under a caller fails by name, once, on every route', async () => {
    const repository = store([chat()])
    const conversations = new ConversationService(repository)
    await conversations.remove({ id: 'c1' })

    for (const call of [
      conversations.get({ id: 'c1' }),
      conversations.appendMessage({ id: 'c1', role: 'user', text: 'hi' }),
      conversations.rename({ id: 'c1', title: 'x' }),
    ]) {
      const answered = await call
      expect(answered.ok).toBe(false)
      expect(answered.failure.code).toBe(Reason.NOT_FOUND)
      expect(answered.failure.message).toBe('no conversation c1')
      expect(answered.failure.hint).toContain('Start a new chat')
    }
    // Removing it again is the state the caller wanted, not a failure.
    const again = await conversations.remove({ id: 'c1' })
    expect(again.ok).toBe(true)
    expect(again.notes).toEqual(['it was already gone'])
  })
})

describe('a record on disk older than the code reading it', () => {
  test('a message written before createdAt existed is the oldest, not the newest', async () => {
    // The constructor mints `Date.now()` for a missing timestamp, which is
    // right for a message being CREATED and wrong for one being rehydrated: it
    // stamps an old message with the moment it was read.
    const before = Date.now()
    const repository = store([chat([{ id: 'm1', role: 'user', text: 'ancient' }])])

    const loaded = await new ConversationService(repository).get({ id: 'c1' })

    expect(loaded.value.messages[0].createdAt).toBe(0)
    expect(loaded.value.messages[0].createdAt).toBeLessThan(before)
  })

  test('a conversation written before createdAt existed sorts last in the menu', async () => {
    // `list` is newest first, so a minted `Date.now()` put the one record too
    // old to have the field at the top — and `page.jsx` opens `list()[0]`,
    // which means the oldest conversation would greet every reload.
    const repository = store([
      { id: 'old', title: 'Ancient', messages: [] },
      { id: 'new', title: 'Recent', createdAt: 100, messages: [] },
    ])

    const listed = await new ConversationService(repository).list()

    expect(listed.value.map((c) => c.id)).toEqual(['new', 'old'])
  })

  test('a record missing every optional field is repaired rather than refused', async () => {
    const repository = store([{ id: 'c1', messages: [{ text: 'who said this?' }] }])

    const loaded = await new ConversationService(repository).get({ id: 'c1' })

    expect(loaded.ok).toBe(true)
    expect(loaded.value.title).toBe('Untitled')
    expect(loaded.value.messages[0].role).toBe('user')
    expect(loaded.value.messages[0].text).toBe('who said this?')
    expect(typeof loaded.value.messages[0].id).toBe('string')
    expect(loaded.value.messages[0].repairs).toEqual([
      'role undefined was not recognised; treated as user',
    ])
  })

  test('a row whose messages field is not a list costs that row, not the whole menu', async () => {
    // Routing `list` through the domain model is what makes one schema have one
    // answer, and it is also what made one damaged row catastrophic: the
    // constructor threw out of `map`, the Kernel caught it as "a handler
    // threw", and `page.jsx` — which boots off `list` and opens `value[0]` —
    // saw a failed call, opened nothing, and created a fresh empty chat. Every
    // real conversation was invisible on every load, and `conversations.remove`
    // and `.get` have no page-realm caller to recover one with.
    const repository = store([
      { id: 'good', title: 'Fine', createdAt: 2, messages: [{ role: 'user', text: 'hi' }] },
      { id: 'bad', title: 'Corrupt', createdAt: 1, messages: null },
    ])

    const listed = await new ConversationService(repository).list()

    expect(listed.ok).toBe(true)
    expect(listed.value.map((c) => c.id)).toEqual(['good', 'bad'])
    expect(listed.value[0].messages[0].text).toBe('hi')
    expect(listed.value[1].messages).toEqual([])
  })

  test('list and get answer with the same record, not two versions of it', async () => {
    // They used to disagree: `list` returned the raw stored row and `get`
    // returned the row put back through the domain model. `page.jsx` restores
    // its transcript from `list` and never calls `get`, so the unrepaired shape
    // was the one the user actually saw.
    const repository = store([
      {
        id: 'c1',
        messages: [
          { id: 'm1', text: 'who said this?' },
          { id: 'm2', role: 'wizard', text: 7 },
        ],
      },
    ])
    const conversations = new ConversationService(repository)

    const [listed, got] = await Promise.all([conversations.list(), conversations.get({ id: 'c1' })])

    expect(listed.value[0]).toEqual(got.value)
    expect(got.value.messages[1].text).toBe('7')
    expect(got.value.messages[1].repairs).toHaveLength(2)
  })

  test('but a message with no id at all gets a different one on every read', async () => {
    // Found by writing the test above with id-less rows and watching it fail on
    // the ids alone. Repair on read is idempotent for every field except this
    // one, because a minted id cannot be derived from the record. Nothing in
    // the tree has ever written a message without an id — `Message` mints one
    // in its constructor — so this is reachable only from a hand-edited store,
    // and the cost is that `page.jsx`, which keys the transcript by message id,
    // would re-key such a message on every reload. Written down rather than
    // fixed: deriving a stable id means hashing the content, and a message
    // whose id changes when it is corrected is worse than one that has none.
    const repository = store([{ id: 'c1', messages: [{ text: 'anonymous' }] }])
    const conversations = new ConversationService(repository)

    const once = await conversations.get({ id: 'c1' })
    const twice = await conversations.get({ id: 'c1' })

    expect(once.value.messages[0].id).not.toBe(twice.value.messages[0].id)
  })

  test('reading an old record does not rewrite it', async () => {
    // Repair on read, not migration on read. A `list` that wrote back would
    // make opening the app a write to every conversation in the store, and on
    // a refused IndexedDB it would be a write that fails on every boot.
    const ancient = { id: 'c1', messages: [{ text: 'untouched' }] }
    const repository = store([ancient])

    await new ConversationService(repository).list()

    expect(stored(repository)).toBe(ancient)
    expect(Object.keys(ancient)).toEqual(['id', 'messages'])
  })
})

describe('what the caller is told when storage refuses', () => {
  test('an append that was not saved says which half of the turn is gone', async () => {
    const repository = readOnly([chat()])
    const conversations = new ConversationService(repository)

    const user = await conversations.appendMessage({ id: 'c1', role: 'user', text: 'q' })
    const assistant = await conversations.appendMessage({ id: 'c1', role: 'assistant', text: 'a' })

    expect(user.notes).toEqual(['the user message was not saved: the disk is full'])
    expect(assistant.notes).toEqual(['the assistant message was not saved: the disk is full'])
    // Still ok: the message is real and the caller can show it. Only its
    // durability is in doubt, and that is what the note is.
    expect(user.ok).toBe(true)
    expect(user.value.text).toBe('q')
  })

  test('a rename that was not saved says so, and an empty one says something else', async () => {
    const conversations = new ConversationService(readOnly([chat()]))

    const renamed = await conversations.rename({ id: 'c1', title: 'Kernels' })
    const empty = await conversations.rename({ id: 'c1', title: '   ' })

    expect(renamed.notes).toEqual(['not saved: the disk is full'])
    expect(empty.notes).toEqual([
      'the new title was empty; the old one was kept',
      'not saved: the disk is full',
    ])
    expect(empty.value.title).toBe('Chat')
  })

  test('a repair and a storage failure are two notes, not one instead of the other', async () => {
    const conversations = new ConversationService(readOnly([chat()]))

    const appended = await conversations.appendMessage({ id: 'c1', role: 'wizard', text: 'hi' })

    expect(appended.notes).toEqual([
      'role "wizard" was not recognised; treated as user',
      'the user message was not saved: the disk is full',
    ])
  })

  test('a store that cannot be read at all fails rather than inventing a conversation', async () => {
    const repository = store([chat()])
    repository.get = async () => Outcome.failed(Reason.UNAVAILABLE, 'the database is closed')
    const conversations = new ConversationService(repository)

    const appended = await conversations.appendMessage({ id: 'c1', role: 'user', text: 'hi' })

    expect(appended.ok).toBe(false)
    expect(appended.failure.message).toBe('the database is closed')
  })
})

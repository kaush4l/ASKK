import { describe, expect, test } from 'bun:test'
import { Workspace } from '../../../src/backend/files/Workspace.js'
import { MemoryRepository } from '../../../src/backend/repositories/MemoryRepository.js'
import { Repository } from '../../../src/backend/repositories/Repository.js'
import { Outcome, Reason } from '../../../src/core/Outcome.js'
import { MAX_FILE_BYTES } from '../../../src/core/tools/FilesPort.js'

/**
 * The store the agent's files live in, over the real `Repository` port.
 *
 * `MemoryRepository` and not a fake: it is one of the two adapters that ship,
 * it is the one a private window actually gets, and a hand-written stub would
 * only prove this class agrees with itself about a shape neither of them owns.
 * The IndexedDB adapter is proved against a real database in a real browser by
 * `scripts/smoke.js`, which is the only place it can be.
 */
const workspace = () => new Workspace(new MemoryRepository('File'))

describe('Workspace', () => {
  test('a file written comes back byte for byte', async () => {
    const files = workspace()

    const wrote = await files.write('notes.md', '# plan\n\nstep one\n')
    const read = await files.read('notes.md')

    expect(wrote.ok).toBe(true)
    expect(wrote.value).toEqual({ path: 'notes.md', bytes: 17, created: true })
    expect(read.value).toEqual({ path: 'notes.md', text: '# plan\n\nstep one\n', bytes: 17 })
  })

  test('writing twice replaces, and says which it did', async () => {
    const files = workspace()

    await files.write('a.txt', 'first')
    const again = await files.write('a.txt', 'second')

    expect(again.value.created).toBe(false)
    expect((await files.read('a.txt')).value.text).toBe('second')
    expect((await files.list()).value).toHaveLength(1)
  })

  test('a file that is not there is null, not a failure', async () => {
    // The distinction the tools depend on. A missing file has to be sayable to
    // a model in a sentence it can act on, and a failed Outcome would put it on
    // the same channel as a database that will not open.
    const missing = await workspace().read('nope.md')

    expect(missing.ok).toBe(true)
    expect(missing.value).toBe(null)
  })

  test('the listing is names, in order, and nothing else', async () => {
    const files = workspace()
    await files.write('z.md', 'x')
    await files.write('a.md', 'é')

    // Insertion order would put z first — `MemoryRepository` is a Map — so this
    // is the assertion that the two adapters cannot disagree about order.
    // `toEqual` on the whole array, not a `map` to paths: a `bytes` that came
    // back would be a field nothing reads, computed over every file on every
    // turn, and only a whole-shape assertion notices one arriving.
    expect((await files.list()).value).toEqual([{ path: 'a.md' }, { path: 'z.md' }])
  })

  test('one record holds the path once, as the key the store already has', async () => {
    // The path used to be written twice into the same record — as `id` and as
    // `path` — and `list` then read the copy rather than the key, behind a
    // filter that could only ever fire if the two disagreed. `IndexedDb` gives
    // every store `keyPath: 'id'`, so this is the assertion that the second
    // author is gone and does not come back on the next write.
    const repository = new MemoryRepository('File')
    const files = new Workspace(repository)

    await files.write('src/main.c', 'int main(){}')

    expect(repository.rows.get('src/main.c')).toEqual({ id: 'src/main.c', text: 'int main(){}' })
  })

  test('a path that could not survive a shell word or a harvest line is refused', async () => {
    const files = workspace()

    for (const path of ['../escape', 'a b.md', "quote'.md", 'back\\slash', 'two\nlines', '..']) {
      const wrote = await files.write(path, 'x')
      expect(wrote.ok).toBe(false)
      expect(wrote.failure.code).toBe(Reason.BAD_REQUEST)
    }
    expect((await files.list()).value).toEqual([])
  })

  test('a leading slash is applied rather than argued with', async () => {
    // A model that writes `/notes.md` means the file it can see. Refusing costs
    // a whole round trip to teach it a convention that can be applied instead.
    const files = workspace()

    await files.write('/notes.md', 'hi')

    expect((await files.list()).value).toEqual([{ path: 'notes.md' }])
    expect((await files.read('notes.md')).value.text).toBe('hi')
  })

  test('folders are allowed, because a workspace that cannot hold src/ is not one', async () => {
    const files = workspace()

    expect((await files.write('src/main.c', 'int main(){}')).ok).toBe(true)
    expect((await files.read('src/main.c')).value.text).toBe('int main(){}')
  })

  test('a file over the limit is refused with both numbers and nothing is stored', async () => {
    const files = workspace()

    const wrote = await files.write('big.txt', 'x'.repeat(MAX_FILE_BYTES + 1))

    expect(wrote.ok).toBe(false)
    expect(wrote.failure.message).toBe(
      `big.txt would be ${MAX_FILE_BYTES + 1} bytes and the limit is ${MAX_FILE_BYTES}`,
    )
    expect((await files.list()).value).toEqual([])
  })

  test('a store that cannot be reached is reported, not swallowed', async () => {
    // The abstract `Repository` answers NOT_IMPLEMENTED to everything, which is
    // exactly the shape of an adapter that is not working. The failure has to
    // reach the caller: a `list` that answered "no files" over a broken
    // database would tell the agent its work had vanished.
    const broken = new Workspace(new Repository('File'))

    expect((await broken.list()).ok).toBe(false)
    expect((await broken.read('a.md')).ok).toBe(false)
    expect((await broken.write('a.md', 'x')).ok).toBe(false)
  })

  test('a write that the store refuses is not reported as a write', async () => {
    // Quota. `IndexedDbRepository.put` fails and the record is not there, so a
    // caller told "wrote 5 bytes" would have been lied to about the one thing
    // it asked for.
    class FullDisk extends MemoryRepository {
      async put() {
        return Outcome.failed(Reason.UNAVAILABLE, 'storage readwrite on files failed: quota')
      }
    }
    const files = new Workspace(new FullDisk('File'))

    const wrote = await files.write('a.md', 'hello')

    expect(wrote.ok).toBe(false)
    expect(wrote.failure.message).toContain('quota')
  })
})

/**
 * The precondition, and the writer it was added for.
 *
 * `Workspace.write` was unconditional for two waves and that was correct while
 * both writers ran inside one turn. A person is the third writer and is the
 * slow one: they open a file, read it for two minutes, and save over work the
 * agent did ninety seconds ago. Nothing recorded that the agent's version had
 * ever existed, which is the same defect this tree already shipped when two
 * writers disagreed about a schema and one silently erased `thinking`.
 */
describe('writing against what the writer last saw', () => {
  test('an unconditional write is still unconditional, which is the agent’s path', async () => {
    const files = workspace()
    await files.write('notes.md', 'first')
    const again = await files.write('notes.md', 'second')
    expect(again.ok).toBe(true)
    expect((await files.read('notes.md')).value.text).toBe('second')
  })

  test('expect null creates, and refuses to overwrite', async () => {
    const files = workspace()
    const made = await files.write('new.md', 'hello', { expect: null })
    expect(made.ok).toBe(true)
    expect(made.value.created).toBe(true)

    const again = await files.write('new.md', 'clobber', { expect: null })
    expect(again.ok).toBe(false)
    expect(again.failure.code).toBe(Reason.BAD_REQUEST)
    expect(again.failure.message).toContain('already exists')
    // And the refusal is a refusal: the store still holds the first text.
    expect((await files.read('new.md')).value.text).toBe('hello')
  })

  test('expect text saves when nothing moved', async () => {
    const files = workspace()
    await files.write('plan.md', 'one')
    const saved = await files.write('plan.md', 'two', { expect: 'one' })
    expect(saved.ok).toBe(true)
    expect(saved.value.created).toBe(false)
    expect((await files.read('plan.md')).value.text).toBe('two')
  })

  test('the lost update is refused, and the message says how far it moved', async () => {
    const files = workspace()
    await files.write('plan.md', 'what the person read')
    // The agent rewrites it while the person is reading.
    await files.write('plan.md', 'what the agent wrote instead, which is longer')

    const saved = await files.write('plan.md', 'the person’s edit', {
      expect: 'what the person read',
    })
    expect(saved.ok).toBe(false)
    expect(saved.failure.message).toContain('changed since it was read')
    // Both byte counts, because "it changed" does not tell a person whether to
    // re-read or to give up.
    expect(saved.failure.message).toContain('45 bytes now')
    expect(saved.failure.message).toContain('not 20')
    expect(saved.failure.hint).toContain('Re-read it')
    // The agent's version survives, which is the entire point.
    expect((await files.read('plan.md')).value.text).toBe(
      'what the agent wrote instead, which is longer',
    )
  })

  test('a file that went away under the reader says so, and is not recreated', async () => {
    const files = workspace()
    const saved = await files.write('gone.md', 'my edit', { expect: 'what I read' })
    expect(saved.ok).toBe(false)
    expect(saved.failure.message).toContain('not in the workspace any more')
    expect((await files.read('gone.md')).value).toBe(null)
  })

  test('an empty file is a text, not an absence', async () => {
    const files = workspace()
    await files.write('empty.md', '')
    // `'' !== null` is the whole assertion: a truthiness test here would read an
    // empty file as a missing one and let a create clobber it.
    const clobber = await files.write('empty.md', 'x', { expect: null })
    expect(clobber.ok).toBe(false)
    const saved = await files.write('empty.md', 'x', { expect: '' })
    expect(saved.ok).toBe(true)
  })

  test('the size cap is checked before the precondition, so a refusal names the real fault', async () => {
    const files = workspace()
    await files.write('big.md', 'small')
    const huge = await files.write('big.md', 'x'.repeat(MAX_FILE_BYTES + 1), { expect: 'stale' })
    expect(huge.ok).toBe(false)
    // Not "it changed since you read it" — a person who fixed that and saved
    // again would be refused a second time for the reason nobody mentioned.
    expect(huge.failure.message).toContain('limit is')
  })
})

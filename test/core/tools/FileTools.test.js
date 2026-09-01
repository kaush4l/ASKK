import { describe, expect, test } from 'bun:test'
import { Workspace } from '../../../src/backend/files/Workspace.js'
import { MemoryRepository } from '../../../src/backend/repositories/MemoryRepository.js'
import { MAX_FILE_BYTES } from '../../../src/core/tools/FilesPort.js'
import { ReadFileTool } from '../../../src/core/tools/ReadFileTool.js'
import { WriteFileTool } from '../../../src/core/tools/WriteFileTool.js'

/**
 * What the model READS when it uses its own files.
 *
 * Every assertion here is on a whole sentence, because the sentence is the
 * interface: a tool that answers `[object Object]` or an empty string is a tool
 * that has silently stopped working, and a `toContain` on a fragment would pass
 * over both. The real `Workspace` is behind them for the reason
 * `ChatService.test.js` uses the real `ConversationService` — a fake port would
 * be this test agreeing with itself about a shape neither side owns.
 */
const workspace = () => new Workspace(new MemoryRepository('File'))

describe('write_file', () => {
  test('a new file and a replaced one are different events, and it says which', async () => {
    const files = workspace()
    const write = new WriteFileTool({ files })

    expect((await write.call({ path: 'notes.md', content: 'hello' })).value).toBe(
      'wrote notes.md, 5 bytes',
    )
    expect((await write.call({ path: 'notes.md', content: 'hello again' })).value).toBe(
      'replaced notes.md, 11 bytes',
    )
  })

  test('a call with no content writes nothing at all', async () => {
    // The dangerous default. `content = ''` would make a forgotten argument
    // truncate a file the agent spent a turn writing, and report success.
    const files = workspace()
    await files.write('notes.md', 'work worth keeping')

    const said = await new WriteFileTool({ files }).call({ path: 'notes.md' })

    expect(said.value).toBe('nothing was written: write_file needs content as well as a path')
    expect((await files.read('notes.md')).value.text).toBe('work worth keeping')
  })

  test('an empty string is a legitimate file and is not confused with a missing argument', async () => {
    const files = workspace()

    expect((await new WriteFileTool({ files }).call({ path: 'e.txt', content: '' })).value).toBe(
      'wrote e.txt, 0 bytes',
    )
  })

  test('a refusal reaches the model as a sentence with the fix in it', async () => {
    const said = await new WriteFileTool({ files: workspace() }).call({
      path: 'big.txt',
      content: 'x'.repeat(MAX_FILE_BYTES + 1),
    })

    // ok, not failed: `Toolbox` renders a failure without its hint, and the
    // hint is the half that says what to do instead.
    expect(said.ok).toBe(true)
    expect(said.value).toBe(
      `could not write that: big.txt would be ${MAX_FILE_BYTES + 1} bytes and the limit is ${MAX_FILE_BYTES} (Split it across several files, or write less of it.)`,
    )
  })

  test('a build with nowhere to keep files says so instead of throwing', async () => {
    // `NO_FILES`. Without it this is `this.files.write is not a function`, which
    // the Kernel turns into "this is a bug: a handler threw" and the agent
    // cannot work around.
    const said = await new WriteFileTool().call({ path: 'a.md', content: 'x' })

    expect(said.ok).toBe(true)
    expect(said.value).toBe('could not write that: this build has nowhere to keep files')
  })

  test('a null port is the one this tree actually passes, and it is answered too', async () => {
    // NOT hypothetical. `ChatService`'s `files` defaults to `null` and goes
    // straight into the services object the tool factories are spread over, and
    // a parameter default fires only on `undefined` — so `null` reached
    // `this.files.write` and threw the exact TypeError `NO_FILES` exists to
    // prevent. Every tool that takes this port checks the value it was handed.
    for (const files of [null, {}, { read: 'not a function' }]) {
      const wrote = await new WriteFileTool({ files }).call({ path: 'a.md', content: 'x' })
      const read = await new ReadFileTool({ files }).call({ path: 'a.md' })

      expect(wrote.value).toBe('could not write that: this build has nowhere to keep files')
      expect(read.value).toBe('could not read that: this build has nowhere to keep files')
    }
  })
})

describe('read_file', () => {
  test('a file comes back as itself, with nothing wrapped around it', async () => {
    const files = workspace()
    await files.write('notes.md', 'line one\nline two\n')

    expect((await new ReadFileTool({ files }).call({ path: 'notes.md' })).value).toBe(
      'line one\nline two\n',
    )
  })

  test('a miss says so and does not render the listing a second time', async () => {
    // This used to answer with the names, capped at its own private forty —
    // `list_files` under another name, against a context block that named the
    // same files in the same prompt. Measured with `estimateTokens` over
    // ordinary paths, that sentence cost 13 tokens at one file and 151 at
    // forty; this one costs 15 whatever is there. The assertion is on the WHOLE
    // sentence, so a listing creeping back in fails here.
    const files = workspace()
    await files.write('notes.md', 'x')
    await files.write('plan.txt', 'y')

    expect((await new ReadFileTool({ files }).call({ path: 'notes.txt' })).value).toBe(
      'there is no file called notes.txt — check the names in your files.',
    )
    // Nothing was listed to say it, either: a store round trip on the miss path
    // is what the old sentence cost even before it was rendered.
    expect((await new ReadFileTool({ files: workspace() }).call({ path: 'a.md' })).value).toBe(
      'there is no file called a.md — check the names in your files.',
    )
  })

  test('an empty file is said, not returned as silence', async () => {
    const files = workspace()
    await files.write('e.txt', '')

    expect((await new ReadFileTool({ files }).call({ path: 'e.txt' })).value).toBe('e.txt is empty')
  })

  test('a long file is cut and the cut is stated with what is missing', async () => {
    const files = workspace()
    await files.write('long.txt', 'x'.repeat(4200))

    const said = await new ReadFileTool({ files }).call({ path: 'long.txt' })

    expect(said.value).toBe(
      `${'x'.repeat(4000)}\n[... 200 more characters of 4200 bytes, not shown]`,
    )
  })

  test('an unusable path is answered, not thrown', async () => {
    const said = await new ReadFileTool({ files: workspace() }).call({ path: '../../etc/passwd' })

    expect(said.ok).toBe(true)
    expect(said.value).toContain('is not a usable path')
  })
})

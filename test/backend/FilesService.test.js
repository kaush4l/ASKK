import { describe, expect, test } from 'bun:test'
import { Workspace } from '../../src/backend/files/Workspace.js'
import { MemoryRepository } from '../../src/backend/repositories/MemoryRepository.js'
import { FilesService } from '../../src/backend/services/FilesService.js'
import { Reason } from '../../src/core/Outcome.js'

/**
 * The page's half of the workspace.
 *
 * Over the real `Workspace` and the real `MemoryRepository`, because this class
 * is three statements of translation and a fake store underneath would leave
 * the only interesting behaviour — the precondition — asserted against a stub
 * that agrees with whatever it is told.
 */
const service = () => new FilesService(new Workspace(new MemoryRepository('File')))

describe('what the page may do', () => {
  test('reads, and a missing file is an answer rather than a failure', async () => {
    const files = service()
    const missing = await files.read({ path: 'nope.md' })
    expect(missing.ok).toBe(true)
    expect(missing.value).toBe(null)
  })

  test('writes a new file when it says it expects nothing there', async () => {
    const files = service()
    const made = await files.write({ path: 'in.md', text: 'handed over', expect: null })
    expect(made.ok).toBe(true)
    expect(made.value.created).toBe(true)
    expect((await files.read({ path: 'in.md' })).value.text).toBe('handed over')
  })

  /**
   * The asymmetry that is the whole safety argument: the agent writes
   * unconditionally through `Workspace` inside one turn, and the page — the
   * slow writer, the one holding text it read two minutes ago — may not.
   */
  test('is refused a write that states no precondition at all', async () => {
    const files = service()
    const blind = await files.write({ path: 'in.md', text: 'no idea what is there' })
    expect(blind.ok).toBe(false)
    expect(blind.failure.code).toBe(Reason.BAD_REQUEST)
    expect(blind.failure.message).toContain('must say what it expects')
    expect((await files.read({ path: 'in.md' })).value).toBe(null)
  })

  /**
   * `undefined` does not survive a structured clone as a key, so a page that
   * sent `expect: undefined` and one that forgot the field arrive here
   * identically. A value test would hand the first an UNCONDITIONAL write while
   * it believed it had asked for a safe one — which is the failure the check
   * exists to prevent, arriving through the door nobody watches.
   */
  test('an explicit undefined is refused exactly like a missing key', async () => {
    const files = service()
    const blind = await files.write({ path: 'in.md', text: 'x', expect: undefined })
    expect(blind.ok).toBe(false)
    expect(blind.failure.message).toContain('must say what it expects')
  })

  test('passes a real precondition through, and the refusal keeps the stored text', async () => {
    const files = service()
    await files.write({ path: 'plan.md', text: 'mine', expect: null })
    const stale = await files.write({ path: 'plan.md', text: 'theirs', expect: 'something else' })
    expect(stale.ok).toBe(false)
    expect((await files.read({ path: 'plan.md' })).value.text).toBe('mine')
  })
})

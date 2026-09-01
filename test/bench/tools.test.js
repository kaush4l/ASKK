import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_OUTPUT, makeTools } from '../../bench/tools.js'

/**
 * `bench/tools.js` is the fairness guarantee: one implementation of four
 * capabilities that every scaffold's adapters end at, so a difference in the
 * results is a difference in scaffolding and never in what the tools can do.
 *
 * What is tested here is the part of that guarantee a scaffold could break
 * without meaning to — the escape refusal, the truncation, the call record, and
 * the fact that a failing command comes back as a READABLE RESULT rather than as
 * a tool failure. That last one is not a nicety: `ok: false` and `ok: true`
 * reach the two arms through different branches, so getting it wrong would move
 * a failing command onto a different path in one arm than in the other.
 */

const fresh = () => makeTools(mkdtempSync(join(tmpdir(), 'askk-bench-tools-')))

describe('the workspace boundary', () => {
  test('a path that climbs out is refused, and nothing is written', async () => {
    const tools = fresh()
    for (const path of ['../escape.txt', '../../etc/hosts', '/etc/hosts']) {
      const wrote = await tools.write_file({ path, content: 'x' })
      expect(wrote.ok).toBe(false)
      expect(wrote.output).toContain('must stay inside')
    }
    expect((await tools.read_file({ path: '../../etc/hosts' })).ok).toBe(false)
    expect((await tools.list_files({ path: '..' })).ok).toBe(false)
  })

  test('an absolute path INSIDE the workspace is allowed, because a scaffold’s prompt gives it one', async () => {
    const tools = fresh()
    const wrote = await tools.write_file({ path: join(tools.workdir, 'a.txt'), content: 'hi' })
    expect(wrote.ok).toBe(true)
    expect((await tools.read_file({ path: 'a.txt' })).output).toBe('hi')
  })

  test('a missing path is refused rather than defaulting to the root', async () => {
    const tools = fresh()
    expect((await tools.write_file({ content: 'x' })).ok).toBe(false)
    // list_files is the one that defaults, and says so in its own description.
    expect((await tools.list_files({})).ok).toBe(true)
  })
})

describe('what comes back', () => {
  test('an empty file is described rather than returned as nothing', async () => {
    const tools = fresh()
    await tools.write_file({ path: 'empty.txt', content: '' })
    expect((await tools.read_file({ path: 'empty.txt' })).output).toBe('(the file is empty)')
  })

  test('a missing file is a readable result, not a tool failure', async () => {
    // "that failed" is information the agent can act on; `ok: false` is reserved
    // for the tool itself being unusable.
    const said = await fresh().read_file({ path: 'nope.txt' })
    expect(said.ok).toBe(true)
    expect(said.output).toContain('could not read nope.txt')
  })

  test('output past the ceiling is truncated, says by how much, and stays under the ceiling', async () => {
    const tools = fresh()
    const body = 'x'.repeat(MAX_OUTPUT + 250)
    await tools.write_file({ path: 'big.txt', content: body })
    const said = await tools.read_file({ path: 'big.txt' })

    // The notice is INSIDE the ceiling. It used to be appended past it, which
    // made every clipped string 4,000-and-a-bit long — and `ShellTool` clips at
    // 4,000 of its own, so our arm's shell output was clipped a second time and
    // the second clip ate the first one's count.
    expect(said.output.length).toBeLessThanOrEqual(MAX_OUTPUT)

    // Kept plus dropped is the original, re-derived rather than pinned: the
    // count has to be the true one, not a number that merely looks plausible.
    const notice = /\n\[\.\.\. (\d+) more characters, output truncated\]$/.exec(said.output)
    expect(notice).not.toBeNull()
    const dropped = Number(notice[1])
    expect(said.output.length - notice[0].length + dropped).toBe(body.length)
  })

  test('a listing shows directories with a slash and files with a size', async () => {
    const tools = fresh()
    await tools.write_file({ path: 'sub/one.txt', content: 'abc' })
    const said = await tools.list_files({ path: '.' })
    expect(said.output).toContain('sub/')
    expect((await tools.list_files({ path: 'sub' })).output).toContain('one.txt  3 bytes')
  })
})

describe('the shell', () => {
  test('the exit code is always stated, zero or not', async () => {
    const tools = fresh()
    // The command's own trailing newline is kept, then the status line is
    // appended — so the model sees the output exactly as a terminal wrote it.
    expect((await tools.run({ command: 'echo hi' })).output).toBe('hi\n\n[exit code 0]')
    expect((await tools.run({ command: 'exit 3' })).output).toBe('(no output)\n[exit code 3]')
  })

  test('a non-zero exit is ok:true — it is a result the agent reads', async () => {
    expect((await fresh().run({ command: 'false' })).ok).toBe(true)
  })

  test('stderr is interleaved, because that is what a terminal shows', async () => {
    const said = await fresh().run({ command: 'echo out; echo err 1>&2' })
    expect(said.output).toContain('out')
    expect(said.output).toContain('err')
  })

  test('it runs in the workspace and cannot see the repository', async () => {
    const tools = fresh()
    await tools.write_file({ path: 'here.txt', content: 'x' })
    expect((await tools.run({ command: 'ls' })).output).toContain('here.txt')
    expect((await tools.run({ command: 'pwd' })).output).toContain(tools.workdir)
  })

  test('a command that will not finish is killed and says so', async () => {
    const said = await fresh().run({ command: 'sleep 5', timeout_ms: 150 })
    expect(said.output).toContain('killed after 150ms without finishing')
  })

  test('an empty command runs nothing', async () => {
    const tools = fresh()
    expect((await tools.run({ command: '  ' })).output).toBe('no command was given, so nothing ran')
  })
})

describe('the call record', () => {
  test('every call is recorded once, whichever tool it was', async () => {
    const tools = fresh()
    await tools.write_file({ path: 'a.txt', content: 'x' })
    await tools.read_file({ path: 'a.txt' })
    await tools.list_files({})
    await tools.run({ command: 'true' })
    expect(tools.calls.map((c) => c.name)).toEqual(['write_file', 'read_file', 'list_files', 'run'])
    // A refused call is still a call: a scaffold that spends its turns being
    // refused has told us something and `results.json` counts it.
    await tools.read_file({ path: '../out' })
    expect(tools.calls.length).toBe(5)
    expect(tools.calls.at(-1).ok).toBe(false)
  })
})

describe('the exit code is a field, not a line of the text', () => {
  test('a failing command that overflows the ceiling still reports its status', async () => {
    const tools = fresh()
    // The status used to be readable only from the end of the string, and
    // `clip` truncates from the end — so this exact command reached our arm as
    // exit 0 while agent-zero read the same text unchanged. Both arms read the
    // text; only ours reads the code, and it cannot be truncated away.
    const said = await tools.run({
      command: `head -c ${MAX_OUTPUT + 1000} /dev/zero | tr '\\0' x; exit 3`,
    })
    expect(said.output.length).toBeLessThanOrEqual(MAX_OUTPUT)
    expect(said.output).not.toContain('[exit code')
    expect(said.code).toBe(3)
  })

  test('a short command carries the code in both places', async () => {
    const said = await fresh().run({ command: 'echo hi; exit 3' })
    expect(said.output).toBe('hi\n\n[exit code 3]')
    expect(said.code).toBe(3)
  })
})

describe('one run cannot see another’s files', () => {
  test('two toolsets rooted apart do not share a workspace', async () => {
    const a = fresh()
    const b = fresh()
    await a.write_file({ path: 'mine.txt', content: 'a' })
    expect((await b.list_files({})).output).toBe('(the directory is empty)')
  })

  test('a fixture written before the run is visible to it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'askk-bench-seeded-'))
    writeFileSync(join(dir, 'seed.txt'), 'here')
    expect((await makeTools(dir).read_file({ path: 'seed.txt' })).output).toBe('here')
  })
})

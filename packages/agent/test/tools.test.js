import { expect, test, describe } from 'bun:test'
import { NOTHING_RAN, arg, check, grant, onlyTools, NO_TOOLS, readArgs, tool, usage, usages } from '@harness/agent'

const WRITE = tool({
  name: 'write_file',
  description: 'Write a file in the space.',
  args: [arg('path', 'string', 'where to write it'), arg('text', 'string', 'the whole contents'), arg('mode', 'number', 'the file mode', { required: false })],
  mutates: true,
})

const EXEC = tool({
  name: 'exec',
  description: 'Run a command.',
  args: [arg('command', 'string', 'the command')],
  evidence: true,
})

const BOX = [WRITE, EXEC]

/** @param {string} tool @param {string} args @returns {import('@harness/agent').ToolCall} */
const call = (tool, args) => ({ id: 'c1', tool, args })

describe('a descriptor states what it wants and what it does', () => {
  test('the usage line is generated from the schema: every type, and the optional one says so', () => {
    expect(usage(WRITE)).toBe(
      'write_file({"path": "<string>", "text": "<string>", "mode": "<number, optional>"}): Write a file in the space.',
    )
  })

  test('a tool with no arguments is still a call, not a bare name', () => {
    expect(usage(tool({ name: 'now', description: 'The time here.' }))).toBe('now({}): The time here.')
  })

  test('mutation and evidence are DECLARED, not read off a list of names elsewhere', () => {
    expect([WRITE.mutates, WRITE.evidence]).toEqual([true, false])
    expect([EXEC.mutates, EXEC.evidence]).toEqual([false, true])
    // The safe half of each is the default: a tool nobody described as an edit
    // is not counted as one, and one nobody called evidence cannot be cited.
    const plain = tool({ name: 'read_file', description: 'Read a file.' })
    expect([plain.mutates, plain.evidence]).toEqual([false, false])
  })
})

describe('the arguments, read against the schema', () => {
  test('a missing required argument is named, with what it is for', () => {
    const read = readArgs(WRITE, '{"path":"a.md"}')
    expect(read).toEqual({ problem: '"text" is missing, and it is required — the whole contents' })
  })

  test('a missing OPTIONAL argument is not a failure', () => {
    expect(readArgs(WRITE, '{"path":"a.md","text":"hello"}')).toEqual({ values: { path: 'a.md', text: 'hello' } })
  })

  test('an argument of the wrong type is named — the Rust could only ask whether the JSON parsed', () => {
    expect(readArgs(WRITE, '{"path":"a.md","text":"hi","mode":"644"}'))
      .toEqual({ problem: '"mode" is string where number was expected' })
  })

  test('a spare key is left alone: it is not a mistake this layer can be sure about', () => {
    expect(readArgs(EXEC, '{"command":"ls","cwd":"/tmp"}')).toEqual({ values: { command: 'ls', cwd: '/tmp' } })
  })

  test('arguments that are not an object are refused as such, never coerced to none', () => {
    expect(readArgs(EXEC, '["ls"]')).toEqual({ problem: 'they are array where one JSON object was expected' })
  })
})

describe('the toolbox refuses a call, in words the model can act on', () => {
  test('a blank tool name gets the terse rejection and NOT the catalogue', () => {
    const refused = check(BOX, call('', '{}'))
    expect(refused).toEqual({ refusal: 'That was data, not a call: no tool was named.' })
    expect(usages(BOX).some((line) => JSON.stringify(refused).includes(line))).toBe(false)
  })

  test('an unknown tool gets the catalogue, because that is the one refusal a model can look up', () => {
    const refused = check(BOX, call('delete_everything', '{}'))
    expect(refused).toEqual({ refusal: 'Tool not found: delete_everything. Available: write_file, exec' })
  })

  test('a tool outside the allowlist a stage granted is refused in the toolbox own words, and never runs', () => {
    const narrowed = grant(onlyTools(['exec']), BOX)
    expect(narrowed).toEqual([EXEC])
    const refused = check(narrowed, call('write_file', '{"path":"a.md","text":"x"}'))
    expect(refused).toEqual({ refusal: 'Tool not found: write_file. Available: exec' })
    expect('tool' in refused).toBe(false)
  })

  test('a scope of none leaves nothing to name, and the refusal says none rather than an empty list', () => {
    expect(grant(NO_TOOLS, BOX)).toEqual([])
    expect(check([], call('exec', '{}'))).toEqual({ refusal: 'Tool not found: exec. Available: none' })
  })

  test('arguments that will not parse quote the usage line back, so the next call can be right', () => {
    const refused = check(BOX, call('exec', '{"command": "ls'))
    if (!('refusal' in refused)) throw new Error('a broken argument object was accepted')
    expect(refused.refusal).toContain('Could not read the arguments: they are not JSON')
    expect(refused.refusal).toContain(usage(EXEC))
  })

  test('a value ending in the terminator of the call holding it is refused with nothing run (R14-P0-2)', () => {
    const swallowed = check(BOX, call('write_file', '{"path":"b.csv","text":"item,cost\\ncoffee,4.50\\"})"}'))
    if (!('refusal' in swallowed)) throw new Error('the swallowed terminator was accepted')
    expect(swallowed.refusal.startsWith(NOTHING_RAN)).toBe(true)
    expect(swallowed.refusal).toContain(usage(WRITE))
  })

  test('a well-formed call comes back with its tool and its values, and nothing else has to be looked up', () => {
    expect(check(BOX, call('exec', '{"command":"ls -1"}'))).toEqual({ tool: EXEC, values: { command: 'ls -1' } })
  })
})

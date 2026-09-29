import { expect, test } from 'bun:test'
import { resolveCommandReference } from '../src/core/command-reference.js'
import { normalizeCompletion } from '../src/core/completion.js'

const exact = '  node -e "assert.equal(parse(\'2x\'), 2)"\n'
const contract = () => ({ checks: [{ capability: 'workspace.commands', options: { commands: [exact, 'npm test'] } }] })

test('required references preserve exact command bytes in an independent frozen result', () => {
  const configuration = contract()
  const completion = normalizeCompletion(configuration)
  configuration.checks[0].options.commands[0] = 'echo replaced'
  const args = { requiredCheck: 0 }
  const result = resolveCommandReference(args, completion)
  args.requiredCheck = 1
  expect(result).toEqual({ command: exact, requiredCheck: 0 })
  expect(Object.isFrozen(result)).toBe(true)
  expect(resolveCommandReference({ requiredCheck: 1 }, completion)).toEqual({ command: 'npm test', requiredCheck: 1 })
})

test('raw proposals reject mixed, absent, malformed, out-of-range and extra fields', () => {
  for (const args of [null, [], 'npm test', {}, { command: exact, requiredCheck: 0 }, { requiredCheck: '0' }, { requiredCheck: null }, { requiredCheck: true }, { requiredCheck: -1 }, { requiredCheck: 0.5 }, { requiredCheck: Infinity }, { requiredCheck: 2 }, { requiredCheck: 0, other: 1 }, { command: '' }, { command: '  ' }, { command: 'a\0b' }, { command: 1 }, { command: 'npm test', other: 1 }, { requiredCheck: 0, [Symbol('extra')]: true }]) {
    expect(() => resolveCommandReference(args, contract())).toThrow()
  }
})

test('references require a valid configured command capability', () => {
  for (const completion of [undefined, {}, { checks: [] }, { checks: [{ capability: 'workspace.command' }] }, { checks: [{ capability: 'workspace.commands', options: { commands: [] } }] }, { checks: [{ capability: 'workspace.commands', options: { commands: [''] } }] }, { checks: [{ capability: 'workspace.commands', options: { commands: ['npm test', 'npm test'] } }] }]) {
    expect(() => resolveCommandReference({ requiredCheck: 0 }, completion)).toThrow()
  }
})

test('adapter mode requires the resolved exact pair and authoritative contract', () => {
  const args = resolveCommandReference({ requiredCheck: 0 }, contract())
  expect(resolveCommandReference(args, contract(), { resolved: true })).toEqual(args)
  expect(() => resolveCommandReference({ requiredCheck: 0 }, contract(), { resolved: true })).toThrow()
  expect(() => resolveCommandReference({ ...args, command: exact.trim() }, contract(), { resolved: true })).toThrow()
  expect(() => resolveCommandReference(args, { checks: [] }, { resolved: true })).toThrow()
  expect(() => resolveCommandReference({ ...args, requiredCheck: 1 }, contract(), { resolved: true })).toThrow()
})

test('ordinary commands remain available without a required completion suite', () => {
  for (const resolved of [false, true]) {
    const args = { command: ' npm test\n' }
    const result = resolveCommandReference(args, undefined, { resolved })
    expect(result).toEqual(args)
    expect(result).not.toBe(args)
    expect(Object.isFrozen(result)).toBe(true)
  }
})

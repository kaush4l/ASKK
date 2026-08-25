import { expect, test, describe } from 'bun:test'
import { NO_TOOLS, ALL_TOOLS, onlyTools, grant, WORK } from '@harness/agent'

describe('a phase grants tools', () => {
  const toolbox = [{ name: 'exec' }, { name: 'read_file' }, { name: 'write_file' }]

  test('none yields an empty toolbox, so a phase that may not act cannot name a tool', () => {
    expect(grant(NO_TOOLS, toolbox)).toEqual([])
  })

  test('all yields whatever this agent was given, and does not alias it', () => {
    const granted = grant(ALL_TOOLS, toolbox)
    expect(granted).toEqual(toolbox)
    expect(granted).not.toBe(toolbox)
  })

  test('only yields exactly the named tools, in the TOOLBOX order the agent file set', () => {
    expect(grant(onlyTools(['write_file', 'exec']), toolbox)).toEqual([{ name: 'exec' }, { name: 'write_file' }])
  })

  test('naming a tool this agent does not hold grants nothing rather than inventing it', () => {
    expect(grant(onlyTools(['launch_missiles']), toolbox)).toEqual([])
  })

  test('the one working phase asks for an envelope, this agent’s whole toolbox, and 8192 tokens', () => {
    expect(WORK.contract).toBe('tool_envelope')
    expect(grant(WORK.tools, toolbox)).toEqual(toolbox)
    expect(WORK.budget.maxTokens).toBe(8192)
  })
})

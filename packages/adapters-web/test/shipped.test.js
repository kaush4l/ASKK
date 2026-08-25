/**
 * THE FILE THIS DEPLOY ACTUALLY SHIPS, RUN THROUGH THE REAL CATALOGUE.
 *
 * Two claims this tree has been making in prose and could not execute (I17):
 * that no two tools in the assembled catalogue answer to one name, and that the
 * door out of the shelf is open to the agent the page talks to. Both were
 * false at some point this increment and neither failed anything — the first
 * because `toolboxFor` takes the FIRST name match and shadows in silence, the
 * second because a non-empty `tools:` list is the whole allowlist and the
 * shelf's tool was not in it.
 *
 * It reads `apps/web/public/agents/main/agent.md` off disk on purpose. A
 * fixture would test a file nobody ships.
 */
import { describe, expect, test } from 'bun:test'
import { CAPABILITIES } from '@harness/kernel'
import { FACULTIES, facultyTools, parseAgentFile } from '@harness/agent'
import { bootFresh } from '@harness/core'
import { fakeClock, testPorts } from '@harness/adapters-test'

import { CATALOGUE } from '../src/toolset.js'
import { adopted } from '../src/adopt.js'
import { makeEndpoint } from '../src/endpoint.js'
import { memorySegments } from './doubles.js'

const AGENT_FILE = new URL('../../../apps/web/public/agents/main/agent.md', import.meta.url).pathname

/** The shipped entry agent, parsed and adopted exactly as `bootBrowser` adopts it. */
async function shipped() {
  const text = await Bun.file(AGENT_FILE).text()
  const read = parseAgentFile('agents/main/agent.md', text)
  if (!('spec' in read)) throw new Error(`the shipped agent file did not parse: ${JSON.stringify(read)}`)
  // Through `adopted` and not `adoptSpec`: the roster the pane reads is
  // assembled there, and a test that skipped it would prove the toolbox while
  // the sentence about what did NOT resolve stayed prose.
  const shelf = { specs: [read.spec], refusals: [], paths: { main: 'agents/main/agent.md' } }
  const taken = adopted(shelf, 'main', [...CAPABILITIES], makeEndpoint())
  const app = bootFresh({
    ports: testPorts({ clock: fakeClock(), script: [] }),
    available: [...CAPABILITIES],
    segments: memorySegments(),
    agent: taken.agent,
    roster: taken.roster,
  })
  return { spec: read.spec, app }
}

describe('the catalogue the allowlist picks from', () => {
  test('no two tools answer to one name, so nothing can shadow anything', () => {
    // `adopt.js` assembles `[...catalogue, ...facultyTools(declared)]` and
    // `toolboxFor` takes the FIRST match. Core's `read_artifact` over the blob
    // store and the artifacts faculty's `read_artifact` over the space shelf
    // were both in this list, with different arguments and different units, and
    // the model was told one contract while the runner enforced the other.
    const assembled = [...CATALOGUE, ...facultyTools(FACULTIES)]
    const names = assembled.map((t) => t.name)
    expect(names.length).toBe(new Set(names).size)
  })
})

describe('the agent this page talks to', () => {
  test('is adopted from the shipped file, and every name it declares is granted or REPORTED', async () => {
    const { spec, app } = await shipped()
    expect(spec.name).toBe('main')
    const named = app.agent.toolbox.map((t) => t.name)
    const said = app.roster.refusals.map((r) => r.message).join(' ')
    // A name this build has no descriptor for is not silently dropped — it is a
    // roster refusal, which is the only reason a person ever finds out. Nothing
    // may fall between the two lists, and BOTH branches are executed: the shelf
    // above holds `main` alone, so the peer it names is the reported half.
    for (const want of spec.tools) expect(named.includes(want) || said.includes(want)).toBe(true)
    expect(said).toContain('critic')
    // …and the two the roster acts through are granted rather than reported.
    // They were the last names this file asked for that nothing answered to.
    expect(named).toContain('write_agent')
    expect(named).toContain('spawn_agent')
    // And nothing is granted that the file did not name, bar the shelf's door.
    for (const got of named) expect(got === 'read_result' || spec.tools.includes(got)).toBe(true)
  })

  test('can read back a result the shelf spilled, whatever its tools: list allowed', async () => {
    const { spec, app } = await shipped()
    // The claim `core/boot.js` makes in words. The file does NOT name this tool
    // — that is the point: the runner is installed unconditionally, so the
    // descriptor is too, or the receipt promises a call the model is not told
    // it may make.
    expect(spec.tools).not.toContain('read_result')
    expect(app.agent.toolbox.map((t) => t.name)).toContain('read_result')
    expect(typeof app.tools.read_result).toBe('function')
  })

  test('the space shelf and the spill shelf are two tools with two contracts', async () => {
    const { app } = await shipped()
    const byName = new Map(app.agent.toolbox.map((t) => [t.name, t]))
    // Addressed by NAME, in bytes — the artifacts faculty's.
    expect(byName.get('read_artifact')?.args.map((a) => a.name)).toEqual(['name', 'offset', 'limit'])
    // Addressed by HANDLE, in characters — the spill's.
    expect(byName.get('read_result')?.args.map((a) => a.name)).toEqual(['handle', 'offset', 'limit'])
  })
})

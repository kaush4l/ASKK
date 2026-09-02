import { describe, expect, test } from 'bun:test'
import { AgentCatalogue } from '../../../src/core/agent/AgentCatalogue.js'
import { DELEGABLE_TOOLS, delegableTools } from '../../../src/core/agent/delegable.js'
import { resolveTools } from '../../../src/core/agent/loadAgent.js'

const catalogue = new AgentCatalogue(new URL('../../..', import.meta.url).href.replace(/\/$/, ''))

/**
 * What a sub-agent thread may hold.
 *
 * The rule this encodes is a resource argument, not a taste: a sub-agent runs in
 * a second realm, so a tool it keeps is a SECOND live instance of whatever that
 * tool reaches. Two of those cost something the parent did not agree to — a
 * second writer over one IndexedDB store, and a second 143 MB guest — and
 * `delegable.js` argues each one.
 */
describe('what a sub-agent may keep', () => {
  test('the network pair survives, because a request holds nothing', () => {
    const { names, notes } = delegableTools(['search', 'fetch'])
    expect(names).toEqual(['search', 'fetch'])
    expect(notes).toEqual([])
  })

  test('the file tools are dropped, and the note says a second writer is why', () => {
    const { names, notes } = delegableTools(['read_file', 'write_file', 'search'])
    expect(names).toEqual(['search'])
    expect(notes).toHaveLength(2)
    for (const note of notes) expect(note).toContain('second writer over the file store')
  })

  test('shell is dropped, and the note says the guest image is why', () => {
    const { names, notes } = delegableTools(['shell'])
    expect(names).toEqual([])
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('second copy of the guest image')
  })

  /**
   * A name this table has never heard of is NOT a refusal. `resolveTools` is
   * what decides a name resolves to nothing, and it says so in its own words; a
   * second sentence here would report a tool as withheld when it was simply
   * never found, which is a different thing for the model to act on.
   */
  test('an unknown name passes through, to be judged by the resolver instead', () => {
    const { names, notes } = delegableTools(['nonsense'])
    expect(names).toEqual(['nonsense'])
    expect(notes).toEqual([])
    const resolved = resolveTools({ names })
    expect(resolved.value).toEqual([])
    expect(resolved.notes[0]).toContain('was not found')
  })

  /**
   * The third kind of refusal, and the only one that is not about resources: a
   * sub-agent is given no peers, so it can hand no work over, so a task reader
   * would resolve to a tool that says "you have not handed any work over" on
   * every call — prompt bytes for a capability that cannot act.
   */
  test('the task reader is dropped, because a sub-agent has nothing to read', () => {
    const { names, notes } = delegableTools(['check_task', 'search'])
    expect(names).toEqual(['search'])
    expect(notes[0]).toContain('no peers to hand work to')
  })

  /**
   * The list is not a preference, and this is the assertion that keeps it that
   * way: a tool added to `DELEGABLE_TOOLS` must be one that costs a request and
   * holds nothing between calls. Both of these build with an HTTP port alone,
   * which is the whole of what a sub-agent thread is given.
   */
  test('every delegable tool builds with an HTTP port alone', () => {
    const resolved = resolveTools({
      names: [...DELEGABLE_TOOLS],
      services: { http: async () => ({}) },
    })
    expect(resolved.notes).toEqual([])
    expect(resolved.value.map((tool) => tool.name).sort()).toEqual([...DELEGABLE_TOOLS].sort())
  })
})

/**
 * And the file that is actually delegated to.
 *
 * `agents/researcher/agent.md` is the first sub-agent this tree has, and the
 * whole point of it is that it can find something out. A file whose every tool
 * this policy drops would be a thread that starts, thinks, and answers from
 * memory — the delegation costing a thread and buying nothing.
 */
describe('the researcher file, against the policy', () => {
  test('every tool it declares survives delegation', async () => {
    const spec = await catalogue.spec('researcher')
    expect(spec.ok).toBe(true)
    expect(spec.value.tools.length).toBeGreaterThan(0)

    const { names, notes } = delegableTools(spec.value.tools)
    expect(names).toEqual(spec.value.tools)
    expect(notes).toEqual([])
  })

  test('it declares a budget of its own, which is what a delegated run spends', async () => {
    const spec = await catalogue.spec('researcher')
    // The parent's budget is not shared — `agentWorker.js` passes this one — so
    // a file with no budget would delegate at the 24-step default and its
    // author would never know they had not asked for it.
    expect(spec.value.budget.steps).toBeGreaterThan(0)
  })
})

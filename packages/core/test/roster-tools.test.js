/**
 * THE TWO TOOLS THAT ACT ON THE ROSTER. One writes an agent into this browser
 * and the other sets one working, and between them they are the last two names
 * the shipped `main/agent.md` asked for that nothing answered to.
 */
import { expect, test, describe } from 'bun:test'
import { get } from '@harness/kernel'
import { loadAgents } from '@harness/agent'
import { AUTHORED, handle } from '@harness/core'
import { harness } from './harness.js'

/** @param {import('@harness/core').App} app @param {string} name @param {Record<string, unknown>} args */
function call(app, name, args) {
  const runner = app.tools[name]
  if (!runner) throw new Error(`no runner for ${name}`)
  return runner(JSON.stringify(args), { signal: new AbortController().signal })
}

/** @param {import('@harness/core').App} app @returns {Array<{name: string, text: string}>} */
const written = (app) => /** @type {Array<{name: string, text: string}>} */ (app.log.read(AUTHORED))

describe('write_agent', () => {
  test('writes a file that this build can actually load, and the roster shows it at once', async () => {
    const { app } = harness()
    const ran = await call(app, 'write_agent', {
      name: 'haiku', description: 'writes haiku', prompt: 'You answer only in haiku.', tools: 'now, list_agents',
    })
    expect(ran.ok).toBe(true)

    // THE FILE, READ BACK BY THE ONLY READER THERE IS. A renderer and a parser
    // that disagree produce an agent that is written, listed, and refuses to
    // load at the next boot — which is a row in the agents pane and not an
    // error anybody sees today.
    const file = written(app)[0]
    const read = loadAgents([{ path: `${file?.name}/agent.md`, text: file?.text ?? '' }])
    expect(read.refusals).toEqual([])
    expect(read.specs[0]?.name).toBe('haiku')
    expect(read.specs[0]?.tools).toEqual(['now', 'list_agents'])
    expect(read.specs[0]?.prompt).toBe('You answer only in haiku.')

    const rows = /** @type {Array<{name: string, originLabel: string}>} */ (handle(app, get('/agents')).data.rows)
    expect(rows.map((r) => [r.name, r.originLabel])).toEqual([['haiku', 'written here']])
  })

  test('refuses a name three subsystems would spell differently, and records nothing', async () => {
    const { app } = harness()
    const ran = await call(app, 'write_agent', { name: 'my agent', description: 'x', prompt: 'Do things.' })
    expect(ran.ok).toBe(false)
    expect(ran.output).toContain('letters, digits')
    expect(written(app)).toEqual([])
  })

  test('refuses an agent with no instructions at all', async () => {
    const { app } = harness()
    const ran = await call(app, 'write_agent', { name: 'blank', description: 'x', prompt: '   ' })
    expect(ran.ok).toBe(false)
    expect(ran.output).toContain('no system prompt')
    expect(written(app)).toEqual([])
  })

  test('a prompt whose newlines are still escaped becomes lines, not a paragraph', async () => {
    // Measured against small local models: a multi-line string inside a
    // one-line call arrives double-escaped often enough that the agents they
    // write are one 400-character paragraph.
    const { app } = harness()
    await call(app, 'write_agent', { name: 'stepper', description: 'x', prompt: 'First, read.\\nThen, write.' })
    expect(written(app)[0]?.text).toContain('First, read.\nThen, write.')
  })
})

describe('spawn_agent', () => {
  test('hands the goal to that agent and brings its answer back as the result', async () => {
    const { app, ports } = harness({ agents: { scout: 'three results, all from 2024' } })
    const ran = await call(app, 'spawn_agent', { agent: 'scout', goal: 'find the release date' })
    expect(ran).toEqual({ ok: true, output: 'three results, all from 2024' })
    expect(/** @type {any} */ (ports.agents).sent).toEqual([{ agent: 'scout', goal: 'find the release date' }])
  })

  test('an empty goal is refused HERE and never delivered', async () => {
    // A sub-agent handed an empty goal answers it regardless, which spends a
    // whole turn of somebody else's loop to learn nothing.
    const { app, ports } = harness({ agents: { scout: 'never asked' } })
    const ran = await call(app, 'spawn_agent', { agent: 'scout', goal: '  ' })
    expect(ran.ok).toBe(false)
    expect(ran.output).toContain('answers it anyway')
    expect(/** @type {any} */ (ports.agents).sent).toEqual([])
  })

  test("an agent this build cannot run comes back as the port's own sentence, not a throw", async () => {
    // The loop is waiting on this call: a typed error thrown past it is a round
    // that never closes, and a refusal the model can read costs one round.
    const { app } = harness({ agents: {} })
    const ran = await call(app, 'spawn_agent', { agent: 'ghost', goal: 'anything' })
    expect(ran.ok).toBe(false)
    expect(ran.output).toContain('ghost')
  })
})

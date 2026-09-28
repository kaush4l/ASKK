import { expect, test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { listing } from '../scripts/listing.js'
import { Hub } from '../src/runtime/hub.js'
import { CompactReAct, responseModel } from '../src/core/responses.js'

test('production main uses version 2 prompts and the host-owned completion gate through a real worker', async () => {
  const site = await mkdtemp(join(tmpdir(), 'askk-production-contract-'))
  let hub
  try {
    const fixtureContent = `Fixture environment\n${'Exact tool evidence survives the compact display log.\n'.repeat(120)}`
    await cp(join(import.meta.dir, '../public'), site, { recursive: true, filter: path => !['browser-linux', 'runtime'].includes(path.split('/').at(-1)) })
    // Keep production agents unchanged; only inference and external effects are fixtures.
    await writeFile(join(site, 'models.json'), JSON.stringify({ default: 'fixture', models: { fixture: {
      provider: 'scripted', model: 'fixture', max_output_tokens: 256,
      script: { main: [
        '{"do":"done","act":"Premature claim"}',
        '{"do":"tool","act":[[{"name":"workspace_read","args":{"path":"fixture.txt"}},{"name":"todo_write","args":{"items":[{"text":"Verify the fixture environment","status":"doing"}]}}]]}',
        '{"do":"done","act":"Fixture evidence accepted"}',
      ] },
    } } }))
    await writeFile(join(site, 'agents/index.json'), JSON.stringify(await listing(site)))
    hub = new Hub({ base: `${pathToFileURL(site).href}/`, storeName: `production-${crypto.randomUUID()}` })
    let inspected = false
    let proposals = 0
    hub.externalOps = {
      'workspace.goal': () => ({ text: inspected ? 'Deliver the inspected evidence' : 'Inspect before claiming completion', revision: inspected ? 2 : 1 }),
      'workspace.environment': () => ({ target: 'fixture', status: 'ready', capabilities: [] }),
      'workspace.read': () => { inspected = true; return { path: 'fixture.txt', content: fixtureContent, revision: '1' } },
      'workspace.acceptance': () => { proposals++; return { ok: inspected, reason: inspected ? 'Fixture environment inspected' : 'Read the fixture environment first' } },
    }
    const events = []
    hub.subscribe((event) => events.push(event))
    await hub.start()
    const context = { binding: { runtimeId: 'fixture-browser-session', target: 'browser' } }
    const run = hub.startRun('main', 'Read fixture.txt to inspect the fixture environment.', { context })
    context.binding.runtimeId = 'changed-after-dispatch'
    expect(await run.answer).toBe('Fixture evidence accepted')
    expect(run.slot.status).toBe('done')
    expect(proposals).toBe(2)
    expect(run.turns.some((turn) => turn.content.includes('Completion was rejected'))).toBe(true)
    const prompts = events.filter((event) => event.kind === 'prompt')
    expect(prompts.length).toBe(3)
    expect(prompts[0].requestSnapshot.contractVersion).toBe(2)
    expect(prompts[0].value).toContain('Contract version 2')
    const examples = prompts[0].value.match(/^Tool example: (.+)$/m)
    expect(examples).not.toBeNull()
    const protocol = responseModel(CompactReAct, 'json')
    const parsed = protocol.parse(examples[1])
    expect(parsed.faults).toEqual([])
    const mainTools = hub.manifest().find(agent => agent.path === 'main').tools
    for (const call of protocol.calls(parsed.value).flat()) {
      expect(call.name).toStartWith('workspace_')
      const available = mainTools.find(tool => tool.name === call.name)
      expect(available).toBeDefined()
      expect(Object.keys(call.args).sort()).toEqual(Object.keys(available.parameters).sort())
    }
    expect(mainTools.some(tool => ['add', 'multiply', 'haiku', 'create_agent'].includes(tool.name))).toBe(false)
    expect(hub.specs.has('main/haiku')).toBe(false)
    for (const path of ['main', 'coder']) {
      expect(hub.specs.get(path).body).toContain('Call workspace_environment only when that context is missing or later evidence shows it may be stale')
      expect(hub.specs.get(path).body).not.toContain('Inspect workspace_environment first')
    }
    expect(prompts[0].value).toContain('fixture-browser-session')
    expect(prompts[0].value).not.toContain('changed-after-dispatch')
    expect(prompts[0].value).not.toContain('there is no shell')
    expect(prompts[0].value).toContain('Inspect before claiming completion')
    expect(prompts[2].value).toContain('Deliver the inspected evidence')
    expect(prompts[2].value).toContain('Current task plan:')
    expect(prompts[2].value).toContain('Verify the fixture environment')
    expect((await hub.runsApi.get(run.id)).context.binding.runtimeId).toBe('fixture-browser-session')
    expect(new Set(prompts.map((event) => event.attemptId)).size).toBe(3)
    const callEvent = run.toolEvents.find(event => event.kind === 'call' && event.name === 'workspace_read')
    const observation = run.toolEvents.find(event => event.kind === 'observation' && event.callId === callEvent.callId)
    expect(callEvent.args).toEqual({ path: 'fixture.txt' })
    expect(JSON.parse(observation.value).content).toBe(fixtureContent)
    expect(observation.value.length).toBeGreaterThan(4000)
    expect(Object.isFrozen(callEvent.args)).toBe(true)
    expect(Object.isFrozen(observation)).toBe(true)
    expect(run.toolEvents.map(event => event.sequence)).toEqual([1, 2, 3, 4])
    expect(run.log.some(event => event.kind === 'observation' && event.value.length === 4000)).toBe(true)
    await hub.persist(run)
    const stored = await hub.store.get('runs', run.id)
    expect(stored.toolEvents).toBeUndefined()
    expect(stored.toolEventCount).toBe(run.toolEvents.length)
    expect(await hub.store.readToolEvents(run.id)).toEqual(run.toolEvents)
    const exported = await hub.traces.export(run.trace)
    expect(exported.runs.find(item => item.id === run.id).toolEvents).toEqual(run.toolEvents)
    const proof = structuredClone(run.toolEvents)
    const assertImmutableEvidence = record => {
      expect(Object.isFrozen(record.toolEvents)).toBe(true)
      expect(() => record.toolEvents.pop()).toThrow()
      const call = record.toolEvents.find(event => event.args)
      expect(() => { call.args.path = 'tampered.txt' }).toThrow()
      expect(record.toolEvents).toEqual(proof)
    }
    assertImmutableEvidence(await hub.runsApi.get(run.id))
    assertImmutableEvidence(exported.runs.find(item => item.id === run.id))
    await hub.persist(run)
    expect(await hub.store.readToolEvents(run.id)).toEqual(proof)
    // A reloaded run is served from durable storage, with the same immutable
    // public boundary even though structured cloning removes Object.freeze.
    hub.runs.delete(run.id)
    assertImmutableEvidence(await hub.runsApi.get(run.id))
    assertImmutableEvidence((await hub.runsApi.list()).find(item => item.id === run.id))
    assertImmutableEvidence((await hub.traces.export(run.trace)).runs.find(item => item.id === run.id))
    expect(await hub.store.readToolEvents(run.id)).toEqual(proof)
  } finally {
    hub?.stop()
    await rm(site, { recursive: true, force: true })
  }
}, 15000)

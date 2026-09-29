import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { listing } from '../scripts/listing.js'
import { Hub } from '../src/runtime/hub.js'
import { CompactReAct, responseModel } from '../src/core/responses.js'
import { loadDeskPackages } from '../src/runtime/desk-packages.js'

test('published starter validates local resources and refuses a mismatched supplied lock without rewriting it', async () => {
  const site = await mkdtemp(join(tmpdir(), 'askk-starter-lock-'))
  try {
    for (const name of ['packages', 'tools']) await cp(join(import.meta.dir, '../public', name), join(site, name), { recursive: true })
    await cp(join(import.meta.dir, '../public/desk.json'), join(site, 'desk.json'))
    await mkdir(join(site, 'agents'), { recursive: true })
    await mkdir(join(site, 'prompts'), { recursive: true })
    await writeFile(join(site, 'agents/soul.md'), 'This global soul must not enter any package.')
    await writeFile(join(site, 'prompts/workbench.md'), 'This global prompt must not enter any package.')
    const options = {
      base: `${pathToFileURL(site).href}/`, catalogue: { default: 'fixture', models: { fixture: { provider: 'scripted' } } },
      fetch: async url => new Response(await readFile(fileURLToPath(url))),
    }
    const loaded = await loadDeskPackages({ ...options, index: await listing(site) })
    expect(loaded.defaultAgent).toBe('bundled/starter/assistant')
    expect(loaded.specs.map(spec => spec.package.agentId).sort()).toEqual(['assistant', 'builder', 'coder', 'compactor', 'critic', 'dreamer', 'main', 'planner', 'researcher', 'reviewer', 'synthesizer'])
    for (const spec of loaded.specs) {
      expect(spec.soul).not.toContain('global soul')
      expect(String(JSON.stringify(spec.engine.promptTemplate))).not.toContain('global prompt')
      expect(spec.inference.model).toBe('$default')
    }
    const lockPath = join(site, 'packages/starter/askk.lock.json')
    await expect(readFile(lockPath)).rejects.toMatchObject({ code: 'ENOENT' })
    const mismatched = '{"revisionDigest":"wrong-supplied-lock"}\n'
    await writeFile(lockPath, mismatched)
    await expect(loadDeskPackages({ ...options, index: await listing(site) })).rejects.toThrow('supplied lock does not match')
    expect(await readFile(lockPath, 'utf8')).toBe(mismatched)
  } finally { await rm(site, { recursive: true, force: true }) }
})

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
    const roles = ['assistant', 'builder', 'main', 'coder', 'coder/reviewer', 'researcher', 'planner', 'critic', 'synthesizer', 'compactor', 'dreamer']
    const residents = new Set(['assistant', 'main', 'coder', 'reviewer'])
    expect(hub.specs.size).toBe(11)
    for (const legacyPath of roles) {
      const id = legacyPath.split('/').at(-1)
      const spec = hub.specs.get(`bundled/starter/${id}`)
      expect(spec.package.namespace).toBe('bundled')
      expect(spec.package.packageId).toBe('org.askk.starter')
      expect(spec.soul).toBe(spec.packageResources[spec.soulFrom])
      expect(spec.soulFrom).toBe(id === 'assistant' ? 'soul.md' : `agents/${legacyPath}/soul.md`)
      expect(spec.engine.session).toBe(residents.has(id) ? 'agent' : 'task')
      expect(spec.localTools).toEqual([])
      const authored = await readFile(join(site, 'packages/starter', id === 'assistant' ? 'agent.md' : `agents/${legacyPath}/agent.md`), 'utf8')
      const bodyStart = authored.indexOf('\n---\n', 4) + '\n---\n'.length
      // Packages preserve authored whitespace; the legacy Markdown reader unwraps it.
      expect(bodyStart).toBeGreaterThan(4)
      expect(spec.body).toBe(authored.slice(bodyStart))
      if (!['compactor', 'dreamer', 'builder'].includes(id)) expect(spec.services).toEqual({ compaction: 'bundled/starter/compactor', retrospective: 'bundled/starter/dreamer' })
      expect(hub.specs.has(legacyPath)).toBe(false)
    }
    expect(hub.specs.get('bundled/starter/coder').delegates.map(row => row.path)).toEqual(['bundled/starter/reviewer'])
    const compactor = hub.specs.get('bundled/starter/compactor')
    expect(compactor.grants).toEqual([])
    expect(compactor.delegates).toEqual([])
    expect(compactor.services).toEqual({})
    expect(compactor.engine.requireVerification).not.toBe(true)
    const dreamer = hub.specs.get('bundled/starter/dreamer')
    expect(dreamer.commonTools).toEqual({ reflection: 'tools/reflection.js' })
    expect(dreamer.body).not.toContain('skill_save')
    for (const id of ['researcher', 'dreamer']) {
      expect(hub.specs.get(`bundled/starter/${id}`).engine.contractVersion).toBe(1)
      expect(hub.specs.get(`bundled/starter/${id}`).engine.responseFormat).toBe('toon')
    }
    const reviewer = hub.specs.get('bundled/starter/reviewer')
    expect(reviewer.engine).toMatchObject({ contractVersion: 2, responseFormat: 'json', observationFormat: 'compact' })
    expect(reviewer.grants).toEqual(['workspace'])
    expect(reviewer.context).toEqual(['runtime', 'workspace', 'budget'])
    expect(reviewer.permissions).toEqual({ workspace_write: 'deny', workspace_run: 'deny', workspace_build: 'deny', workspace_check: 'deny' })
    const builder = hub.specs.get('bundled/starter/builder')
    expect(builder.engine).toMatchObject({ session: 'task', contractVersion: 2, responseFormat: 'json', observationFormat: 'compact', maxSteps: 24 })
    expect(builder.grants).toEqual(['workspace'])
    expect(builder.delegates).toEqual([])
    expect(builder.services).toEqual({})
    expect(builder.engine.requireVerification).not.toBe(true)
    const context = { binding: { runtimeId: 'fixture-browser-session', target: 'browser' } }
    const run = hub.startRun('bundled/starter/main', 'Read fixture.txt to inspect the fixture environment.', { context })
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
    const mainTools = hub.manifest().find(agent => agent.path === 'bundled/starter/main').tools
    for (const call of protocol.calls(parsed.value).flat()) {
      expect(call.name).toStartWith('workspace_')
      const available = mainTools.find(tool => tool.name === call.name)
      expect(available).toBeDefined()
      expect(Object.keys(call.args).sort()).toEqual(Object.keys(available.parameters).sort())
    }
    expect(mainTools.some(tool => ['add', 'multiply', 'haiku', 'create_agent'].includes(tool.name))).toBe(false)
    expect(hub.specs.has('main/haiku')).toBe(false)
    for (const path of ['bundled/starter/main', 'bundled/starter/coder']) {
      expect(hub.specs.get(path).engine.promptTemplate.system).toContain('Call workspace_environment only when that context is missing or later evidence shows it may be stale')
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

test('production builder worker writes and runs through declared tools, retains activity receipts and requires the command checker', async () => {
  const site = await mkdtemp(join(tmpdir(), 'askk-builder-worker-'))
  let hub
  try {
    await cp(join(import.meta.dir, '../public'), site, { recursive: true, filter: path => !['browser-linux', 'runtime'].includes(path.split('/').at(-1)) })
    const content = 'console.log(6 * 7)\n'
    const reply = (doValue, act) => JSON.stringify({ do: doValue, act })
    await writeFile(join(site, 'models.json'), JSON.stringify({ default: 'fixture', models: { fixture: {
      provider: 'scripted', model: 'fixture', max_output_tokens: 512,
      script: { builder: [
        reply('done', 'Unverified proposal'),
        reply('tool', [[{ name: 'workspace_write', args: { path: 'answer.js', content, expect: 0 } }]]),
        reply('tool', [[{ name: 'workspace_run', args: { command: 'node answer.js' } }]]),
        reply('done', 'The recorded command exited zero and printed 42.'),
      ] },
    } } }))
    await writeFile(join(site, 'agents/index.json'), JSON.stringify(await listing(site)))
    hub = new Hub({ base: `${pathToFileURL(site).href}/`, storeName: `builder-${crypto.randomUUID()}` })
    const files = new Map(), calls = [], events = []
    let executedRun, proposals = 0
    // These effects are explicit fixtures; this proves worker dispatch, not real shell execution.
    hub.externalOps = {
      'workspace.environment': () => ({ target: 'fixture', status: 'ready', capabilities: ['files', 'commands'], files: [...files.keys()] }),
      'workspace.write': (args, run) => {
        expect(args).toEqual({ path: 'answer.js', content, expect: 0 })
        calls.push(['write', run.id]); files.set(args.path, args.content)
        return { ok: true, path: args.path, rev: 'fixture-revision-1' }
      },
      'workspace.run': (args, run) => {
        expect(args).toEqual({ command: 'node answer.js' })
        expect(files.get('answer.js')).toBe(content)
        calls.push(['run', run.id]); executedRun = run.id
        return { id: 'fixture-command-1', code: 0, output: '42\n' }
      },
      'workspace.build': () => { throw new Error('Unexpected app build') },
      'workspace.check': () => { throw new Error('Unexpected artifact inspection') },
    }
    hub.completionAdapters = {
      'workspace.command': (options, run) => {
        expect(options).toEqual({ requireFresh: true }); proposals++
        return { ok: executedRun === run.id, reason: executedRun === run.id ? 'Recorded fixture command belongs to this run' : 'Execute the requested script first', commandId: executedRun === run.id ? 'fixture-command-1' : null }
      },
    }
    hub.subscribe(event => { events.push(event); if (event.type === 'approval') hub.approvalsApi.answer(event.approval.id, { approved: true }) })
    await hub.start()
    const authored = JSON.parse(await readFile(join(site, 'packages/starter/workflows.json'), 'utf8')).workflows.find(row => row.id === 'project')
    const run = hub.startRun('bundled/starter/builder', 'Write answer.js and execute it.', { context: { workflow: { workspace: true, completion: authored.completion }, binding: { runtimeId: 'fixture-runtime', target: 'local' } } })
    expect(await run.answer).toBe('The recorded command exited zero and printed 42.')
    expect(run.slot.status).toBe('done')
    expect(proposals).toBe(2)
    expect(calls).toEqual([['write', run.id], ['run', run.id]])
    expect(run.completionReceipts.map(row => row.ok)).toEqual([false, true])
    expect(run.completionReceipts.every(row => row.checks[0].capability === 'workspace.command')).toBe(true)
    const prompts = events.filter(event => event.kind === 'prompt' && event.run === run.id)
    expect(prompts).toHaveLength(4)
    for (const prompt of prompts) {
      expect([...prompt.requestSnapshot.toolNames].sort()).toEqual(['workspace_environment', 'workspace_list', 'workspace_read', 'workspace_run', 'workspace_write'])
      expect(prompt.value).not.toContain('workspace_build(')
      expect(prompt.value).not.toContain('workspace_check(')
      expect(prompt.value).not.toContain('Configure output:')
      expect(prompt.value.match(/## RESPONSE FORMAT/g)).toHaveLength(1)
    }
    const observations = run.toolEvents.filter(event => event.kind === 'observation')
    expect(observations).toHaveLength(2)
    expect(observations[0]).toMatchObject({ ok: true, activity: { path: 'answer.js' } })
    expect(observations[1]).toMatchObject({ ok: true, activity: { commandId: 'fixture-command-1' } })
    expect(JSON.parse(observations[1].value)).toMatchObject({ code: 0, output: '42\n' })
  } finally { hub?.stop(); await rm(site, { recursive: true, force: true }) }
}, 15000)

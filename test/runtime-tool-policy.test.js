import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { listing } from '../scripts/listing.js'
import { Hub } from '../src/runtime/hub.js'
import { hasToolRequirement, normalizeToolPolicy, scopedToolDecision } from '../src/runtime/tool-policy.js'
import { web_fetch, web_search } from '../src/builtin/web.js'

const selected = overrides => ({ disabledTools: [], approvalRisks: [], allowDelegation: true, ...overrides })
const action = (name, args = {}) => JSON.stringify({ do: 'tool', act: [[{ name, args }]] })
const done = JSON.stringify({ do: 'done', act: 'Finished the observed attempt.' })
const write = action('workspace_write', { path: 'note.txt', content: 'hello', expect: 0 })

async function fixture(scripts, extra = '') {
  const site = await mkdtemp(join(tmpdir(), 'askk-run-policy-')); let hub
  try {
    for (const name of ['main', 'child', 'compactor']) {
      await mkdir(join(site, 'agents', name), { recursive: true })
      await writeFile(join(site, 'agents', name, 'agent.md'), `---\nname: ${name}\ncontract_version: 2\nresponse_format: json\nobservation_format: compact\nmax_steps: 2\n${name === 'compactor' ? 'tools: []' : 'tools: [workspace, host, web]\npermissions:\n  workspace_write: allow'}\n${name === 'main' ? `agents: [child]\n${extra}` : ''}\n---\nUse only the configured tools.`)
    }
    await writeFile(join(site, 'models.json'), JSON.stringify({ default: 'fixture', models: { fixture: { provider: 'scripted', max_output_tokens: 512, script: { compactor: [done], ...scripts } } } }))
    await writeFile(join(site, 'agents/index.json'), JSON.stringify(await listing(site)))
    hub = new Hub({ base: `${pathToFileURL(site).href}/`, storeName: `run-policy-${crypto.randomUUID()}` })
    const effects = []; const approvals = []
    hub.externalOps = { 'workspace.write': args => { effects.push(args); return { revision: 'committed' } } }
    hub.subscribe(event => {
      if (event.type === 'approval') { approvals.push(event.approval); hub.approvalsApi.answer(event.approval.id, { approved: true, always: true }) }
    })
    await hub.start()
    return { hub, effects, approvals, close: async () => { hub.stop(); await rm(site, { recursive: true, force: true }) } }
  } catch (error) { hub?.stop(); await rm(site, { recursive: true, force: true }); throw error }
}

test('run policy is bounded, immutable, rejects malformed inputs and cannot override a denial', () => {
  expect(normalizeToolPolicy(undefined)).toBeNull()
  for (const invalid of [null, [], {}, selected({ allowDelegation: 'false' }), selected({ disabledTools: [''] }), selected({ disabledTools: Array(257).fill('x') }), selected({ disabledTools: Array(1) }), selected({ approvalRisks: Array(1) }), selected({ approvalRisks: ['other'] }), { ...selected(), typo: true }]) expect(() => normalizeToolPolicy(invalid)).toThrow('Invalid run tool policy')
  const input = selected({ disabledTools: ['one'], approvalRisks: ['read', 'write'] }); const frozen = normalizeToolPolicy(input)
  input.disabledTools.push('two'); expect(frozen.disabledTools).toEqual(['one']); expect(Object.isFrozen(frozen.disabledTools)).toBe(true)
  expect(scopedToolDecision({ name: 'one', risk: 'write' }, {}, { toolPolicy: frozen }).action).toBe('deny')
  expect(scopedToolDecision({ name: 'other', risk: 'read' }, {}, { toolPolicy: frozen }).action).toBe('ask')
  expect(scopedToolDecision({ name: 'other', risk: 'write' }, {}, { toolPolicy: frozen, policy: { defaults: { write: 'deny' } } }).action).toBe('deny')
  expect(scopedToolDecision({ name: 'child', tier: 'agent' }, {}, { toolPolicy: normalizeToolPolicy(selected({ allowDelegation: false })) }).action).toBe('deny')
})

test('real resident worker filters disabled tools and restores them for its next invocation', async () => {
  const f = await fixture({ main: [write, done, write, done] })
  try {
    const policy = selected({ disabledTools: ['workspace_write'] })
    const first = f.hub.startRun('main', 'Attempt one write.', { context: { toolPolicy: policy } })
    policy.disabledTools.length = 0 // Mutating UI selection cannot change an already queued run.
    await first.answer
    expect(f.effects).toHaveLength(0)
    expect(first.prompts[0].sheet).not.toContain('- workspace_write(')
    expect(first.toolEvents.find(event => event.kind === 'observation')).toMatchObject({ ok: false })
    const second = f.hub.startRun('main', 'Try with the normal configured tools.')
    await second.answer
    expect(f.effects).toHaveLength(1)
    expect(second.prompts[0].sheet).toContain('- workspace_write(')
    const count = f.hub.runs.size
    expect(() => f.hub.startRun('main', 'Malformed policy.', { context: { toolPolicy: null } })).toThrow('Invalid run tool policy')
    expect(f.hub.runs.size).toBe(count)
  } finally { await f.close() }
}, 15000)

test('forced approval survives an Always rule and binds each approval to the exact call', async () => {
  const f = await fixture({ main: [write] }, 'max_steps: 1')
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const run = f.hub.startRun('main', 'Write only after approval.', { context: { toolPolicy: selected({ approvalRisks: ['write'] }) } })
      await run.answer
      expect(f.approvals[attempt].callId).toBe(run.toolEvents.find(event => event.kind === 'call').callId)
    }
    expect(f.approvals).toHaveLength(2); expect(f.effects).toHaveLength(2)
    const manifest = f.hub.manifest({ toolPolicy: selected({ approvalRisks: ['write'] }) }).find(row => row.path === 'main')
    expect(manifest.tools.find(row => row.name === 'workspace_write').effectiveAction).toBe('ask')
    expect(manifest.composition).toMatchObject({ loop: 'react', contractVersion: 2, maxSteps: 1, requireVerification: false })
    expect(manifest.unavailable.find(row => row.name === 'host_exec')).toMatchObject({ available: false, requires: ['host:legacy-bridge', 'host:exec'] })
    const spec = f.hub.specs.get('main'); spec.context = { time: { zone: 'UTC' } }
    const configured = f.hub.manifest().find(row => row.path === 'main')
    expect(configured.composition.context).toEqual({ time: { zone: 'UTC' } })
    expect(Object.isFrozen(configured.composition.context.time)).toBe(true)
  } finally { await f.close() }
}, 15000)

test('delegation is filtered and denied in the hub, inherited restrictions reach children, internal compaction still works', async () => {
  const f = await fixture({ main: [action('child', { query: 'Try writing.' }), done, action('child', { query: 'Try writing.' }), done], child: [write, done] })
  try {
    const first = f.hub.startRun('main', 'Stay in one agent.', { context: { toolPolicy: selected({ allowDelegation: false }) } })
    await first.answer
    expect(first.children).toHaveLength(0); expect(first.prompts[0].sheet).not.toContain('- child(')
    await expect(f.hub.ops.call.call(f.hub, { agent: 'child', query: 'Bypass worker.' }, first)).rejects.toThrow('delegation is disabled')
    await expect(f.hub.ops.call.call(f.hub, { agent: 'compactor', query: 'Summarize.', call: 'compactor(history)', infrastructure: 'compaction' }, first)).resolves.toBe('Finished the observed attempt.')
    const second = f.hub.startRun('main', 'Delegate with the same restricted tools.', { context: { toolPolicy: selected({ disabledTools: ['workspace_write'] }) } })
    await second.answer
    expect(second.children).toHaveLength(1); expect(f.effects).toHaveLength(0)
    const child = f.hub.runs.get(second.children[0]); expect(child.context.toolPolicy).toEqual(second.context.toolPolicy)
    expect(child.prompts[0].sheet).not.toContain('- workspace_write(')
  } finally { await f.close() }
}, 15000)

test('a real worker can compact history with delegation disabled', async () => {
  const f = await fixture({ main: [done] }, 'compact_at: 0.001\nkeep: 1')
  try {
    f.hub.retire(f.hub.threads.get('main'))
    await f.hub.store.put('sessions', { agent: 'main', turns: Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? 'observation' : 'user', content: `Historical evidence ${i}. ${'Keep the observed facts. '.repeat(40)}`, at: i })) })
    const run = f.hub.startRun('main', 'Answer after preserving historical evidence.', { context: { toolPolicy: selected({ allowDelegation: false, disabledTools: ['compactor'] }) } })
    await run.answer
    expect(run.slot.status).toBe('done')
    expect(run.children).toHaveLength(1)
    expect(f.hub.runs.get(run.children[0])).toMatchObject({ agent: 'compactor', kind: 'compact', slot: { status: 'done' } })
    expect(f.effects).toHaveLength(0)
  } finally { await f.close() }
}, 15000)

test('bridge capabilities do not imply legacy routes, execution, web access, or unknown requirements', () => {
  const relay = { name: 'askk-companion', capabilities: ['model-relay', 'network-relay'] }
  expect(hasToolRequirement('host', relay)).toBe(true)
  for (const need of ['host:fetch', 'host:exec', 'host:legacy-bridge', 'browser-control', 'other']) expect(hasToolRequirement(need, relay)).toBe(false)
  expect(hasToolRequirement('host:exec', { ...relay, capabilities: ['exec'] })).toBe(true)
  expect(hasToolRequirement('host:legacy-bridge', { name: 'harness-bridge' })).toBe(true)
})

test('answering bridge grant changes refresh real workers and revoke stale host dispatch immediately', async () => {
  const f = await fixture({ main: [done] })
  const waitFor = async predicate => {
    const start = Date.now()
    while (!predicate()) { if (Date.now() - start > 2000) throw new Error('worker refresh timed out'); await new Promise(resolve => setTimeout(resolve, 5)) }
  }
  try {
    let health = { name: 'askk-companion', root: '/same-root', capabilities: ['model-relay'] }
    let hostRequests = 0
    f.hub.fetch = async url => {
      if (url.endsWith('/health')) return Response.json(health)
      if (url.endsWith('/whoami')) return Response.json({ ok: true })
      hostRequests++; return Response.json({ status: 200, text: 'read' })
    }
    await f.hub.bridgeCheck('http://fixture.test', 'fixture-token')
    await waitFor(() => f.hub.readyInfo.get('main')?.unavailable.some(row => row.name === 'web_search'))
    await f.hub.threads.get('main').ready
    const before = f.hub.threads.get('main')
    await f.hub.bridgeCheck('http://fixture.test', 'fixture-token')
    expect(f.hub.threads.get('main')).toBe(before) // An unchanged heartbeat must not reset conversation workers.
    health = { ...health, capabilities: ['model-relay', 'fetch'] }
    await f.hub.bridgeCheck('http://fixture.test', 'fixture-token')
    await waitFor(() => f.hub.manifest().find(row => row.path === 'main').tools.some(row => row.name === 'web_search' && row.available))
    const loaded = f.hub.threads.get('main'); loaded.busy = true
    health = { ...health, capabilities: ['model-relay'] }
    await f.hub.bridgeCheck('http://fixture.test', 'fixture-token')
    expect(loaded.stale).toBe(true)
    expect(f.hub.manifest().find(row => row.path === 'main').tools.find(row => row.name === 'web_search')).toMatchObject({ available: false, missing: ['host:fetch'] })
    expect(() => f.hub.ops.host.call(f.hub, { endpoint: '/fetch', body: { url: 'https://example.test' } })).toThrow('host:fetch')
    expect(hostRequests).toBe(0)
    loaded.busy = false
  } finally { await f.close() }
}, 15000)

test('web tools report network/HTTP failures honestly and cancellation never falls back to a host', async () => {
  const original = globalThis.fetch; let fallbacks = 0
  const ctx = { host: { capabilities: ['fetch'] }, request: async () => { fallbacks++; return { status: 503, text: 'unavailable' } } }
  try {
    globalThis.fetch = async () => new Response('missing', { status: 404 })
    await expect(web_fetch.run({ url: 'https://example.test' }, ctx)).rejects.toThrow('HTTP 404')
    expect(fallbacks).toBe(0)
    globalThis.fetch = async () => { throw new TypeError('CORS') }
    await expect(web_fetch.run({ url: 'https://example.test' }, { ...ctx, host: { capabilities: ['model-relay'] } })).rejects.toThrow('No paired host')
    await expect(web_fetch.run({ url: 'https://example.test' }, ctx)).rejects.toThrow('HTTP 503')
    const controller = new AbortController(); controller.abort()
    await expect(web_fetch.run({ url: 'https://example.test' }, { ...ctx, signal: controller.signal })).rejects.toThrow('CORS')
    expect(fallbacks).toBe(1)
    await expect(web_search.run({ query: 'anything' }, ctx)).rejects.toThrow('HTTP 503')
  } finally { globalThis.fetch = original }
})

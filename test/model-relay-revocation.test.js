import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { Hub } from './helpers/trusted-fixture-hub.js'
import { listing } from '../scripts/listing.js'

for (const session of ['agent', 'task']) test(`disconnect revokes an active ${session} worker's model transport`, async () => {
  const site = await mkdtemp(join(tmpdir(), 'askk-revocation-'))
  let started; const firstRequest = new Promise(resolve => { started = resolve })
  let cancelled; const cancellation = new Promise(resolve => { cancelled = resolve })
  let generationCalls = 0, hub
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = await request.json()
    if (body.url.endsWith('/models')) return Response.json({ data: [{ id: 'fixture' }] })
    generationCalls++; started()
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Pending"},"finish_reason":null}]}\n\n')) },
      cancel() { cancelled() },
    }), { headers: { 'content-type': 'text/event-stream' } })
  } })
  try {
    await mkdir(join(site, 'agents', 'assistant'), { recursive: true })
    await writeFile(join(site, 'agents/assistant/agent.md'), `---\nname: assistant\nsession: ${session}\ntools: []\ncontext: []\nmax_steps: 2\n---\nReply briefly.`)
    await writeFile(join(site, 'models.json'), JSON.stringify({ default: 'chosen', models: { chosen: { provider: 'openai', model: 'fixture', base_url: 'https://provider.invalid/v1', via: 'bridge' } } }))
    await writeFile(join(site, 'agents/index.json'), JSON.stringify(await listing(site)))
    hub = new Hub({ base: `${pathToFileURL(site).href}/`, storeName: `revocation-${crypto.randomUUID()}` })
    hub.bridgeState = { status: 'answering', generation: 1, url: server.url.origin, token: 'fixture-token', health: { name: 'askk-companion', capabilities: ['model-relay'], modelRelay: { version: 1, endpoint: '/model/fetch', status: 'configured', endpoints: ['https://provider.invalid/v1'] } } }
    await hub.start()
    const run = hub.startRun('assistant', 'Fixture request.')
    await firstRequest
    await hub.bridge.disconnect()
    await run.answer.catch(() => {})
    await cancellation
    expect(run.slot.status).toBe('cancelled')
    const next = hub.startRun('assistant', 'Do not reuse the old companion.')
    await next.answer.catch(() => {})
    expect(next.slot.status).toBe('failed')
    expect(generationCalls).toBe(1)
  } finally { hub?.stop(); server.stop(true); await rm(site, { recursive: true, force: true }) }
}, 5000)

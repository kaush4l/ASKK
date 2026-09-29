import { afterEach, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { listing } from '../scripts/listing.js'
import { Hub } from './helpers/trusted-fixture-hub.js'
import { openStore } from '../src/runtime/store.js'

const fixtures = []
afterEach(async () => {
  for (const row of fixtures.splice(0)) {
    row.release?.()
    row.hub?.stop()
    row.server?.stop(true)
    if (row.site) await rm(row.site, { recursive: true, force: true })
  }
})
const deferred = () => {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { promise, resolve }
}
async function storedUntil(hub, id, check) {
  const start = Date.now()
  while (Date.now() - start < 5000) {
    const record = await hub.store.get('runs', id)
    if (record && check(record)) return record
    await Bun.sleep(5)
  }
  throw new Error('Run evidence was not persisted before the deadline')
}
const sse = (text, finishReason = 'stop', usage = null) => new Response([
  `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: finishReason }] })}\n\n`,
  ...(usage === null ? [] : [`data: ${JSON.stringify({ choices: [], usage })}\n\n`]),
  'data: [DONE]\n\n',
].join(''), { headers: { 'content-type': 'text/event-stream' } })

async function fixture(answer) {
  const row = {}; fixtures.push(row)
  let requests = 0
  row.server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => {
    if (new URL(request.url).pathname === '/v1/chat/completions') return answer(++requests, request)
    return Response.json({ data: [{ id: 'evidence-fixture', context_length: 16384 }] })
  } })
  row.site = await mkdtemp(join(tmpdir(), 'askk-runtime-evidence-'))
  // Guest images and served copies of runtime modules are irrelevant to this real-worker fixture.
  await cp(join(import.meta.dir, '../public'), row.site, { recursive: true, filter: path => !['browser-linux', 'runtime'].includes(path.split('/').at(-1)) })
  await mkdir(join(row.site, 'agents/main'), { recursive: true })
  await writeFile(join(row.site, 'agents/main/agent.md'), '---\nname: main\ncontract_version: 2\nresponse_format: json\nmax_steps: 4\ncontext: []\ntools: []\nagents: []\n---\nUse the fixture tool when needed and report the result.')
  await writeFile(join(row.site, 'agents/main/tools.js'), 'export const fixture_wait = { description: "Wait for the fixture", parameters: {}, risk: "read", run: (_, ctx) => ctx.request("fixture.wait") }\n')
  await writeFile(join(row.site, 'models.json'), JSON.stringify({ default: 'fixture', models: { fixture: { provider: 'openai', model: 'evidence-fixture', base_url: `http://127.0.0.1:${row.server.port}/v1`, context_length: 16384, max_output_tokens: 256 } } }))
  await writeFile(join(row.site, 'agents/index.json'), JSON.stringify(await listing(row.site)))
  row.hub = new Hub({ base: `${pathToFileURL(row.site).href}/`, storeName: `evidence-${crypto.randomUUID()}` })
  await row.hub.start()
  return row
}

test('provider requests and exact completion metadata survive stored reads while the real worker is still running', async () => {
  const responseWaiting = deferred(); const respond = deferred(); const toolWaiting = deferred(); const finish = deferred(); const finalWaiting = deferred(); const respondFinal = deferred()
  const reported = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, prompt_tokens_details: { cached_tokens: 2 }, completion_tokens_details: { reasoning_tokens: 3 } }
  const row = await fixture(async number => {
    if (number === 1) return new Response('Temporary fixture failure', { status: 503 })
    if (number === 2) {
      responseWaiting.resolve(); await respond.promise
      return sse(JSON.stringify({ do: 'tool', act: [[{ name: 'fixture_wait', args: {} }]] }), 'stop', reported)
    }
    finalWaiting.resolve(); await respondFinal.promise
    return sse(JSON.stringify({ do: 'done', act: 'Evidence fixture finished' }))
  })
  row.release = () => { respond.resolve(); finish.resolve('released'); respondFinal.resolve() }
  const { hub } = row
  hub.externalOps['fixture.wait'] = () => { toolWaiting.resolve(); return finish.promise }
  const events = []; hub.subscribe(event => events.push(event))
  const run = hub.startRun('main', 'Wait for the fixture, then finish')
  await responseWaiting.promise
  const pending = await storedUntil(hub, run.id, record => record.requests.length === 2)
  expect(run.ended).not.toBe(true)
  expect(pending.prompts).toHaveLength(1)
  expect(pending.completions).toEqual([])
  expect(pending.requests.map(event => event.request.transportAttempt)).toEqual([1, 2])
  expect(pending.requests.every(event => event.attemptId === pending.prompts[0].attemptId)).toBe(true)
  expect(pending.log.some(event => event.kind === 'retry')).toBe(true)
  respond.resolve(); await toolWaiting.promise
  const saved = await storedUntil(hub, run.id, record => record.completions.length === 1)
  expect(run.ended).not.toBe(true)
  expect(saved.completions[0]).toMatchObject({ kind: 'completion', finishReason: 'stop', usage: reported, attemptId: saved.prompts[0].attemptId, requestIndex: 1 })
  expect(saved.log.find(event => event.kind === 'completion')).toMatchObject({ finishReason: 'stop', attemptId: saved.prompts[0].attemptId })
  expect(Object.isFrozen(run.completions[0].usage.completion_tokens_details)).toBe(true)
  // Subscribers cannot mutate the recorded provider metadata after publication.
  events.find(event => event.kind === 'completion').usage.prompt_tokens = 999
  expect(run.completions[0].usage.prompt_tokens).toBe(11)
  const reader = new Hub(); reader.store = hub.store
  const restored = await reader.runsApi.get(run.id)
  expect(restored.completions).toEqual(saved.completions)
  const trace = await reader.traces.export(run.trace)
  expect(trace.usage).toEqual({ attempts: 2, reportedAttempts: 1, unknownAttempts: 1, reportedTokens: { inputTokens: 11, outputTokens: 7, totalTokens: 18, cachedInputTokens: 2, reasoningOutputTokens: 3 }, tokenCoverage: { inputTokens: 1, outputTokens: 1, totalTokens: 1, cachedInputTokens: 1, reasoningOutputTokens: 1 } })
  expect(trace.runs[0].completions).toEqual(saved.completions)
  finish.resolve('Fixture completed')
  await finalWaiting.promise
  const afterTool = await storedUntil(hub, run.id, record => record.requests.length === 3 && record.turns.some(turn => turn.role === 'observation'))
  expect(run.ended).not.toBe(true)
  expect(afterTool.log.some(event => event.kind === 'observation')).toBe(true)
  expect(afterTool.turns.find(turn => turn.role === 'observation').content).toContain('Fixture completed')
  respondFinal.resolve()
  expect(await run.answer).toBe('Evidence fixture finished')
  await storedUntil(hub, run.id, record => record.result === 'Evidence fixture finished')
  const final = await reader.traces.export(run.trace)
  expect(final.usage).toMatchObject({ attempts: 3, reportedAttempts: 1, unknownAttempts: 2, reportedTokens: trace.usage.reportedTokens })
  expect(final.runs[0].turns.some(turn => turn.role === 'observation')).toBe(true)
}, 15000)

test('an empty provider reply stopped by the token limit exports its actual finish reason and usage', async () => {
  const usage = { prompt_tokens: 21, completion_tokens: 256, total_tokens: 277, completion_tokens_details: { reasoning_tokens: 256 } }
  const { hub } = await fixture(() => sse('', 'length', usage))
  const run = hub.startRun('main', 'Exercise a truncated empty completion')
  await run.answer
  const saved = await storedUntil(hub, run.id, record => record.slot.status === 'failed')
  expect(saved.slot.error).toContain('length')
  expect(saved.completions).toHaveLength(1)
  expect(saved.completions[0]).toMatchObject({ finishReason: 'length', usage, requestIndex: 0, attemptId: saved.requests[0].attemptId })
  const exported = await hub.traces.export(run.trace)
  expect(exported.usage).toMatchObject({ attempts: 1, reportedAttempts: 1, unknownAttempts: 0, reportedTokens: { inputTokens: 21, outputTokens: 256, totalTokens: 277, reasoningOutputTokens: 256 } })
  expect(exported.runs[0].completions[0].usage).toEqual(usage)
}, 15000)

test('trace aggregates only reported counters, keeps real zeroes, and exposes partial coverage', async () => {
  const hub = new Hub(); hub.store = await openStore('usage-fixture')
  await hub.store.put('runs', { id: 'r1', trace: 't1', at: 1, prompts: [{ tokens: 99999 }], requests: [{ attemptId: 'a' }, { attemptId: 'b' }, { attemptId: 'c' }], completions: [
    { attemptId: 'a', requestIndex: 0, finishReason: 'end_turn', usage: { input_tokens: 7, cache_read_input_tokens: 5, cache_creation_input_tokens: 4 } },
    { attemptId: 'b', requestIndex: 1, finishReason: 'stop', usage: { total_tokens: 0, completion_tokens: -1 } },
  ] })
  await hub.store.put('runs', { id: 'r2', trace: 't1', at: 2, requests: [], completions: [{ requestIndex: null, usage: {} }] })
  const trace = await hub.traces.export('t1')
  expect(trace.usage).toEqual({ attempts: 4, reportedAttempts: 2, unknownAttempts: 2, reportedTokens: { inputTokens: 7, cachedInputTokens: 5, cacheCreationInputTokens: 4, totalTokens: 0 }, tokenCoverage: { inputTokens: 1, cachedInputTokens: 1, cacheCreationInputTokens: 1, totalTokens: 1 } })
  expect(Object.hasOwn(trace.usage.reportedTokens, 'outputTokens')).toBe(false)
})

test('older trace records with missing completion metadata count unknown attempts without inventing usage', async () => {
  const hub = new Hub(); hub.store = await openStore('legacy-usage-fixture')
  await hub.store.put('runs', { id: 'legacy-network', trace: 'legacy', at: 1, requests: [{ attemptId: 'a' }, { attemptId: 'a' }], log: [{ kind: 'completion', value: '' }] })
  await hub.store.put('runs', { id: 'legacy-scripted', trace: 'legacy', at: 2, log: [{ kind: 'completion', value: '' }] })
  expect((await hub.traces.export('legacy')).usage).toEqual({ attempts: 3, reportedAttempts: 0, unknownAttempts: 3, reportedTokens: {}, tokenCoverage: {} })
})

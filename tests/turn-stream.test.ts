import { afterAll, describe, expect, test } from 'bun:test'
import { serve } from '@/engine/host'
import type { Scope } from '@/engine/host'
import { receive, snapshot } from '@/client/store'
import type { FromEngine, Request } from '@/protocol/messages'

/**
 * A turn, from a click to a token and back, across the whole switch.
 *
 * **Everything below drives the real thing.** The real `engine/host.ts` switch,
 * the real `engine/turns.ts` resident, the real `core/agent/react.ts` loop, the
 * real `OpenAiInference` over a real socket, and the real `client/store.ts`.
 * Nothing is stubbed but `navigator.locks`, which Bun does not have.
 *
 * **The streaming assertions are causal and not counted, and that distinction
 * is this increment's whole defence.** This project has already measured that a
 * chunk-count assertion stays green when streaming collapses into
 * buffer-then-chop, because the count is the same either way. So the model
 * server below **refuses to send its second frame until the first delta has
 * been observed in the client's store**. A buffering engine never produces that
 * delta, the server never sends frame two, the turn never ends, and the test
 * fails on its own deadline. It cannot pass by accident.
 *
 * `tests/inference-http.test.ts` makes the same assertion one layer down, about
 * the transport. This one makes it about the boundary: `postMessage` in the
 * middle is exactly where a well-meaning "batch the deltas" would land.
 */

Object.defineProperty(navigator, 'locks', {
  configurable: true,
  value: {
    request: (name: string, _options: unknown, callback: (lock: unknown) => Promise<unknown>) => callback({ name }),
  },
})

const servers: { stop: (force?: boolean) => void }[] = []
afterAll(() => {
  for (const server of servers) server.stop(true)
})

/** How long any single wait below gets before the failure is "it never happened". */
const BUDGET_MS = 10_000

/** A served engine whose every outbound message also reaches the real client store. */
function engine(): {
  send: (request: Request) => Promise<FromEngine>
  seen: FromEngine[]
  waitFor: (test: (message: FromEngine) => boolean) => Promise<FromEngine>
} {
  const seen: FromEngine[] = []
  const waiting = new Map<number, (message: FromEngine) => void>()
  const scope: Scope = {
    onmessage: null,
    postMessage: (message: FromEngine) => {
      seen.push(message)
      receive(message)
      if ('id' in message) waiting.get(message.id)?.(message)
    },
  }
  serve(scope)
  const send = (request: Request): Promise<FromEngine> =>
    new Promise<FromEngine>((settle) => {
      waiting.set(request.id, settle)
      scope.onmessage?.({ data: request } as MessageEvent)
    })
  return { send, seen, waitFor: (test) => waitFor(() => seen.find(test)) }
}

/** Polls for something to become true, and gives up loudly rather than hanging. */
async function waitFor<T>(produce: () => T | undefined, what = 'the thing waited for'): Promise<T> {
  const deadline = Date.now() + BUDGET_MS
  for (;;) {
    const value = produce()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`${what} never arrived in ${BUDGET_MS / 1000}s`)
    await Bun.sleep(5)
  }
}

/** One `data:` frame carrying one content delta, as every OpenAI-compatible server writes it. */
function frame(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
}

interface Model {
  baseUrl: string
  /** Every request body the model was sent, so a test can assert what left the tab. */
  bodies: string[]
}

/**
 * A model that streams `chunks`, and **stops before `held` until `release`
 * resolves**. `release` is the causal half: a test resolves it only once the
 * far end has proved it saw what came before, so a buffered implementation
 * deadlocks here instead of passing.
 */
function model(chunks: readonly string[], held: number, release: Promise<void>): Model {
  const bodies: string[] = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      bodies.push(await request.text())
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder()
          for (const [index, chunk] of chunks.entries()) {
            if (index === held) await release
            controller.enqueue(encoder.encode(frame(chunk)))
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      })
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
    },
  })
  servers.push(server)
  return { baseUrl: `http://127.0.0.1:${server.port}/v1`, bodies }
}

/** A model that opens a stream and never says anything, so a turn can be caught mid-flight. */
function silentModel(): string {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response(new ReadableStream<Uint8Array>({ start: () => {} }), { headers: { 'Content-Type': 'text/event-stream' } }),
  })
  servers.push(server)
  return `http://127.0.0.1:${server.port}/v1`
}

async function booted() {
  const started = engine()
  await started.send({ id: 1, type: 'boot' })
  return started
}

const endpointFor = (baseUrl: string) => ({ baseUrl, model: 'test-model' })

describe('a turn crosses the switch and streams back', () => {
  test('the second token is only sent once the first has been seen at the far end', async () => {
    const gate = Promise.withResolvers<void>()
    const model2 = model(['Hel', 'lo world'], 1, gate.promise)
    const { send, seen, waitFor: awaitMessage } = await booted()

    const started = await send({ id: 2, type: 'turn/start', text: 'say hello', endpoint: endpointFor(model2.baseUrl) })
    expect(started.type).toBe('turn/started')

    // Causal, not counted: the model is holding chunk two, and only the store
    // having the first one lets it go. Buffer the stream and this never fires.
    const first = await awaitMessage((message) => message.type === 'turn/delta')
    expect(first).toEqual({ type: 'turn/delta', turnId: snapshot().turn?.turnId ?? '', seq: 1, text: 'Hel' })
    expect(snapshot().turn?.text).toBe('Hel')
    expect(snapshot().turn?.status).toBe('streaming')
    gate.resolve()

    const done = await awaitMessage((message) => message.type === 'turn/done')
    expect(done.type === 'turn/done' && done.answer).toBe('Hello world')
    expect(snapshot().turn?.text).toBe('Hello world')
    expect(snapshot().turn?.deltas).toBe(2)
    expect(snapshot().turn?.status).toBe('done')
    // Every delta crossed before the terminal did, in order.
    expect(seen.filter((m) => m.type === 'turn/delta').map((m) => m.type === 'turn/delta' && m.seq)).toEqual([1, 2])
  })

  test('the prompt the model was sent is the assembled one, built in this realm', async () => {
    const gate = Promise.withResolvers<void>()
    gate.resolve()
    const model1 = model(['ok'], 1, gate.promise)
    const { send, waitFor: awaitMessage } = await booted()
    await send({ id: 2, type: 'turn/start', text: 'remember the milk', endpoint: endpointFor(model1.baseUrl) })
    await awaitMessage((message) => message.type === 'turn/done')
    expect(model1.bodies).toHaveLength(1)
    // The user's words reach the model inside a rendered transcript line, not
    // as a raw string the transport made up: this is the assembler's output.
    expect(JSON.parse(model1.bodies[0] ?? '{}').messages[0].content).toContain('[USER]: remember the milk')
  })

  test('the conversation outlives the turn — the second prompt holds the first exchange', async () => {
    const open = Promise.withResolvers<void>()
    open.resolve()
    const model1 = model(['first answer'], 1, open.promise)
    const { send, waitFor: awaitMessage } = await booted()
    await send({ id: 2, type: 'turn/start', text: 'one', endpoint: endpointFor(model1.baseUrl) })
    await awaitMessage((message) => message.type === 'turn/done')
    await send({ id: 3, type: 'turn/start', text: 'two', endpoint: endpointFor(model1.baseUrl) })
    await waitFor(() => (model1.bodies.length === 2 ? model1.bodies[1] : undefined), 'the second prompt')
    const second = JSON.parse(model1.bodies[1] ?? '{}').messages[0].content as string
    expect(second).toContain('[USER]: one')
    expect(second).toContain('[ASSISTANT]: first answer')
    expect(second).toContain('[USER]: two')
  })
})

describe('a turn ends three ways, and they are three different facts', () => {
  test('abort mid-stream is aborted, not failed, and stops the deltas', async () => {
    const held = Promise.withResolvers<void>()
    const model2 = model(['half ', 'never arrives'], 1, held.promise)
    const { send, seen, waitFor: awaitMessage } = await booted()
    const started = await send({ id: 2, type: 'turn/start', text: 'go', endpoint: endpointFor(model2.baseUrl) })
    const turnId = started.type === 'turn/started' ? started.turnId : ''

    // Again causal: the stop is only sent once a delta has actually landed, so
    // this is a cancellation of something in flight and not of something that
    // had not started.
    await awaitMessage((message) => message.type === 'turn/delta')
    const ack = await send({ id: 3, type: 'turn/abort', turnId })
    expect(ack).toEqual({ type: 'turn/abort:ok', id: 3, turnId })
    expect(snapshot().turn?.status).toBe('stopping')

    const ended = await awaitMessage((message) => message.type === 'turn/aborted')
    expect(ended.type === 'turn/aborted' && ended.turnId).toBe(turnId)
    expect(seen.some((m) => m.type === 'turn/done')).toBe(false)
    expect(snapshot().turn?.status).toBe('aborted')
    expect(snapshot().turn?.text).toBe('half ')
    held.resolve()
  })

  test('a model that cannot be reached is turn/failed, carrying the reason', async () => {
    const { send, waitFor: awaitMessage } = await booted()
    await send({ id: 2, type: 'turn/start', text: 'go', endpoint: endpointFor('http://127.0.0.1:1/v1') })
    const failed = await awaitMessage((message) => message.type === 'turn/failed')
    expect(failed.type === 'turn/failed' && failed.message).not.toBe('')
    expect(snapshot().turn?.status).toBe('failed')
    expect(snapshot().turn?.detail).toBe(failed.type === 'turn/failed' ? failed.message : '')
  })

  test('a second turn while one is live is refused by name, never queued or run beside it', async () => {
    const { send } = await booted()
    await send({ id: 2, type: 'turn/start', text: 'one', endpoint: endpointFor(silentModel()) })
    const refused = await send({ id: 3, type: 'turn/start', text: 'two', endpoint: endpointFor(silentModel()) })
    expect(refused.type).toBe('failed')
    expect(refused.type === 'failed' && refused.message).toContain('is already running')
  })

  test('aborting a turn id nothing is running is refused by name, never silence', async () => {
    const { send } = await booted()
    const refused = await send({ id: 2, type: 'turn/abort', turnId: 'no-such-turn' })
    expect(refused.type).toBe('failed')
    expect(refused.type === 'failed' && refused.message).toContain('no turn no-such-turn is running')
  })
})

describe('the boot handler cannot fail silently', () => {
  test('an election that throws becomes failed, not an unhandled rejection in a worker', async () => {
    const locks = navigator.locks
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: () => {
          throw new TypeError('locks are gone')
        },
      },
    })
    try {
      const reply = await engine().send({ id: 1, type: 'boot' })
      expect(reply.type).toBe('failed')
      expect(reply.type === 'failed' && reply.message).toBe('locks are gone')
    } finally {
      Object.defineProperty(navigator, 'locks', { configurable: true, value: locks })
    }
  })
})

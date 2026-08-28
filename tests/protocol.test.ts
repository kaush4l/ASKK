import { afterAll, describe, expect, test } from 'bun:test'
import { serve, WORKER_MARK } from '@/engine/host'
import type { Scope } from '@/engine/host'
import { receive, snapshot } from '@/client/store'
import type { FromEngine, Request } from '@/protocol/messages'

/**
 * The protocol, from both ends.
 *
 * Every message this build declares is asserted **on the side that received
 * it** — the engine's switch against a real `Scope`, and the client's store
 * against a real message. A message that is only asserted where it was sent is
 * the declared-but-never-emitted defect wearing a test.
 *
 * What this file cannot reach, and where it is reached instead:
 *
 * - **`postMessage` itself.** These messages cross a function boundary, not a
 *   realm boundary, so structured clone never runs here. `messages.ts` proves
 *   cloneability in the type system, and `scripts/verify-worker.ts` drives the
 *   real worker in a real browser.
 * - **`fatal { another-tab }`.** It comes out of a real lost election, and the
 *   election is `navigator.locks` in a browser. `verify-worker.ts` asserts it
 *   against a second instance of the whole page.
 *
 * The lock stub below exists for one reason: Bun has no `navigator.locks`, so
 * without it `boot` throws and every case after it reads `failed`. It grants,
 * which is what a first tab gets; it is not a second implementation of the
 * election, and nothing under `src/` knows it exists.
 */

Object.defineProperty(navigator, 'locks', {
  configurable: true,
  value: {
    request: (name: string, _options: unknown, callback: (lock: unknown) => Promise<unknown>) => callback({ name }),
  },
})

/** A served engine, and one send that resolves with what it answered. */
function engine(): { send: (request: Request) => Promise<FromEngine> } {
  let resolve: (message: FromEngine) => void = () => {}
  const scope: Scope = {
    onmessage: null,
    postMessage: (message: FromEngine) => resolve(message),
  }
  serve(scope)
  const send = (request: Request): Promise<FromEngine> =>
    new Promise<FromEngine>((settle) => {
      resolve = settle
      scope.onmessage?.({ data: request } as MessageEvent)
    })
  return { send }
}

const servers: { stop: (force?: boolean) => void }[] = []

/** A server that answers one way, torn down at the end of the file. */
function endpoint(handler: (request: globalThis.Request) => Response | Promise<Response>): string {
  const server = Bun.serve({ port: 0, fetch: handler })
  servers.push(server)
  return `http://127.0.0.1:${server.port}/v1`
}

afterAll(() => {
  for (const server of servers) server.stop(true)
})

describe('the engine answers', () => {
  test('boot replies ready, carrying the mark that identifies this build', async () => {
    const reply = await engine().send({ id: 1, type: 'boot' })
    expect(reply).toEqual({ type: 'ready', id: 1, mark: WORKER_MARK, schemaVersion: 1 })
  })

  test('a second boot is refused by name, never silently re-elected', async () => {
    const { send } = engine()
    await send({ id: 1, type: 'boot' })
    const reply = await send({ id: 2, type: 'boot' })
    expect(reply.type).toBe('failed')
    expect(reply.type === 'failed' && reply.message).toContain('boot arrived twice')
  })

  test('a request before boot is refused naming what is missing, never queued', async () => {
    const reply = await engine().send({ id: 1, type: 'config/probe', baseUrl: 'http://127.0.0.1:1/v1' })
    expect(reply.type).toBe('failed')
    expect(reply.type === 'failed' && reply.message).toContain('arrived before boot')
  })

  test('a handler that throws becomes failed, in the thrower\'s own words, and the engine keeps serving', async () => {
    const { send } = engine()
    await send({ id: 1, type: 'boot' })
    const reply = await send({ id: 2, type: 'config/probe', baseUrl: 'not an address' })
    expect(reply.type).toBe('failed')
    expect(reply.type === 'failed' && reply.id).toBe(2)
    const after = await send({ id: 3, type: 'config/probe', baseUrl: endpoint(() => Response.json({ data: [] })) })
    expect(after.type).toBe('config/probed')
  })
})

describe('the probe reports what it measured', () => {
  async function probed(baseUrl: string) {
    const { send } = engine()
    await send({ id: 1, type: 'boot' })
    const reply = await send({ id: 2, type: 'config/probe', baseUrl })
    if (reply.type !== 'config/probed') throw new Error(`expected config/probed, got ${JSON.stringify(reply)}`)
    return reply.result
  }

  test('a model list is ok, and the models come back', async () => {
    const result = await probed(endpoint(() => Response.json({ data: [{ id: 'gemma-3' }, { id: 'qwen' }] })))
    expect(result.outcome).toBe('ok')
    expect(result.models).toEqual(['gemma-3', 'qwen'])
  })

  test('a non-2xx is http, and the status is in the detail', async () => {
    const result = await probed(endpoint(() => new Response('nope', { status: 401, statusText: 'Unauthorized' })))
    expect(result.outcome).toBe('http')
    expect(result.detail).toContain('401')
  })

  test('nothing listening is unreachable', async () => {
    const result = await probed('http://127.0.0.1:1/v1')
    expect(result.outcome).toBe('unreachable')
  })

  test(
    'a server that never answers is a timeout, and the deadline aborts the real fetch',
    async () => {
      const result = await probed(endpoint(() => new Promise<Response>(() => {})))
      expect(result.outcome).toBe('timeout')
      expect(result.elapsedMs).toBeGreaterThan(4_000)
    },
    15_000,
  )

  test('the key is sent as a bearer token and never comes back', async () => {
    const seen: { authorization: string | null } = { authorization: null }
    const url = endpoint((request) => {
      seen.authorization = request.headers.get('authorization')
      return Response.json({ data: [] })
    })
    const { send } = engine()
    await send({ id: 1, type: 'boot' })
    const reply = await send({ id: 2, type: 'config/probe', baseUrl: url, apiKey: 'sk-secret' })
    expect(seen.authorization).toBe('Bearer sk-secret')
    expect(JSON.stringify(reply)).not.toContain('sk-secret')
  })
})

describe('the client writes down what it received', () => {
  test('ready becomes the boot state the page renders', () => {
    receive({ type: 'ready', id: 1, mark: WORKER_MARK, schemaVersion: 1 })
    expect(snapshot().boot).toEqual({ kind: 'ready', mark: WORKER_MARK, schemaVersion: 1 })
  })

  test('config/probed becomes the probe the page renders', () => {
    receive({ type: 'config/probed', id: 2, result: { outcome: 'ok', models: ['gemma-3'], elapsedMs: 12, detail: 'answered' } })
    expect(snapshot().probe?.models).toEqual(['gemma-3'])
  })

  test('failed becomes a failure the page can show, not a rejected promise nobody caught', () => {
    receive({ type: 'failed', id: 3, message: 'not an address' })
    expect(snapshot().failure).toBe('not an address')
  })

  test('fatal replaces the boot state, so a lost election is a rendered refusal', () => {
    receive({ type: 'fatal', reason: 'another-tab', message: 'open in another tab' })
    expect(snapshot().boot).toEqual({ kind: 'fatal', reason: 'another-tab', message: 'open in another tab' })
  })

  test('a new snapshot object per message, or useSyncExternalStore renders once and never again', () => {
    const before = snapshot()
    receive({ type: 'failed', id: 4, message: 'second' })
    expect(snapshot()).not.toBe(before)
  })
})

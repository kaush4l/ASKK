import { describe, expect, test } from 'bun:test'
import { ScriptedInference } from '@/core/inference/scripted'
import type { ScriptedReply } from '@/core/inference/scripted'
import { stubPorts } from '@/core/ports'
import type { InferenceConfig } from '@/core/inference/base'
import type { MessageRecord, NewEvent, NewMessage, Ports, SessionRecord } from '@/core/ports'

/**
 * 2.2's acceptance is "a scripted fake drives a full turn in a host test", so
 * `runTurn` below is a turn and not a method call: it reads the session, writes
 * the user's words, records what left the tab, streams the reply, and writes it
 * back. The store allocates every `seq` (§5.1) and the clock is pinned, so the
 * turn is reproducible byte for byte.
 *
 * The `fetch` port handed to the transport is `stubPorts().fetch`, which throws
 * `no fetch port configured`. That is the assertion, not a convenience: if the
 * scripted transport ever reaches the network this suite goes red naming it.
 */

/** The golden date, pinned. Its weekday is not derived from it anywhere. */
const PINNED_AT = Date.parse('2026-08-16T10:00:00Z')

const CONFIG: InferenceConfig = {
  model: 'test-model',
  baseUrl: 'http://127.0.0.1:8873/v1',
  apiKey: 'none',
  temperature: 0.7,
  maxTokens: 4096,
}

/** An in-memory `StorePort`. `adapters/test/store.ts` is not this increment's file. */
function memoryPorts(): Ports & { events: { turn: number; event: NewEvent }[] } {
  const sessions = new Map<string, SessionRecord>()
  const messages: MessageRecord[] = []
  const events: { turn: number; event: NewEvent }[] = []
  let ids = 0
  return {
    ...stubPorts(),
    clock: { now: () => new Date(PINNED_AT), zone: () => 'America/Los_Angeles' },
    newId: () => `id-${++ids}`,
    events,
    store: {
      putSession: async (s) => void sessions.set(s.id, { ...s }),
      readSession: async (id) => sessions.get(id) ?? null,
      appendMessage: async (sessionId, m) => {
        const session = sessions.get(sessionId)
        if (!session) throw new Error(`no session ${sessionId}`)
        const seq = session.nextSeq
        session.nextSeq += 1
        messages.push({ ...m, id: `${sessionId}:${seq}`, sessionId, seq })
        return seq
      },
      readMessages: async (sessionId, afterSeq = 0) =>
        messages.filter((m) => m.sessionId === sessionId && m.seq > afterSeq),
      appendEvent: async (_sessionId, turnOrdinal, event) => void events.push({ turn: turnOrdinal, event }),
    },
  }
}

async function openSession(ports: Ports, id: string): Promise<void> {
  await ports.store.putSession({
    id,
    agent: 'main',
    createdAt: ports.clock.now().getTime(),
    updatedAt: ports.clock.now().getTime(),
    status: 'idle',
    runningTurnId: null,
    nextSeq: 1,
    nextTurnOrdinal: 1,
  })
}

interface TurnOutcome {
  deltas: string[]
  text: string
  requestBody: string
}

/** One whole turn: user in, request recorded, reply streamed, both messages durable. */
async function runTurn(ports: Ports, inference: ScriptedInference, sessionId: string, said: string): Promise<TurnOutcome> {
  const session = await ports.store.readSession(sessionId)
  if (!session) throw new Error(`no session ${sessionId}`)
  const turnId = ports.newId()
  const at = ports.clock.now().getTime()
  const user: NewMessage = { role: 'user', content: said, turnId, at }
  await ports.store.appendMessage(sessionId, user)

  const history = await ports.store.readMessages(sessionId)
  const req = { prompt: history.map((m) => `${m.role}: ${m.content}`).join('\n') }

  const record = inference.describeRequest(req)
  await ports.store.appendEvent(sessionId, session.nextTurnOrdinal, { kind: 'request', data: record, at })

  const deltas: string[] = []
  const result = await inference.infer(req, (chunk) => void deltas.push(chunk))

  await ports.store.appendMessage(sessionId, { role: 'assistant', content: result.text, turnId, at })
  await ports.store.appendEvent(sessionId, session.nextTurnOrdinal, { kind: 'usage', data: result.usage, at })
  return { deltas, text: result.text, requestBody: record.body }
}

const SCRIPT: ScriptedReply[] = [
  {
    chunks: ['The ', 'harness ', 'never ', 'tells ', 'the model ', 'something it has not done.'],
    stopReason: 'stop',
    usage: { promptTokens: 12, completionTokens: 9 },
  },
]

describe('a scripted fake drives a full turn', () => {
  test('the turn streams, persists both messages, and never touches the network', async () => {
    const ports = memoryPorts()
    const inference = new ScriptedInference(CONFIG, ports.fetch, SCRIPT)
    await openSession(ports, 's1')

    const outcome = await runTurn(ports, inference, 's1', 'what is the rule?')

    expect(outcome.deltas.length).toBeGreaterThan(1)
    expect(outcome.deltas.join('')).toBe(outcome.text)
    expect(outcome.text).toBe('The harness never tells the model something it has not done.')

    const stored = await ports.store.readMessages('s1')
    expect(stored.map((m) => [m.seq, m.role])).toEqual([
      [1, 'user'],
      [2, 'assistant'],
    ])
    expect(stored[1]?.content).toBe(outcome.text)
    expect(ports.events.map((e) => e.event.kind)).toEqual(['request', 'usage'])
  })

  test('describeRequest reports what the fake actually received', async () => {
    const ports = memoryPorts()
    const inference = new ScriptedInference(CONFIG, ports.fetch, SCRIPT)
    await openSession(ports, 's1')

    const outcome = await runTurn(ports, inference, 's1', 'what is the rule?')

    const arrived = inference.received[0]
    expect(arrived).toBeDefined()
    expect(JSON.parse(outcome.requestBody)).toEqual({
      model: 'test-model',
      prompt: arrived?.prompt,
      temperature: 0.7,
      max_tokens: 4096,
    })
    expect(arrived?.prompt).toBe('user: what is the rule?')
  })

  test('the record names no url it did not call', () => {
    const inference = new ScriptedInference(CONFIG, stubPorts().fetch, SCRIPT)
    const record = inference.describeRequest({ prompt: 'hi' })
    expect(record.method).toBeNull()
    expect(record.url).toBe('scripted:test-model')
    expect(record.url).not.toContain(CONFIG.baseUrl)
  })

  test('a fixture that runs out says so rather than inventing a reply', async () => {
    const inference = new ScriptedInference(CONFIG, stubPorts().fetch, SCRIPT)
    await inference.infer({ prompt: 'one' })
    await expect(inference.infer({ prompt: 'two' })).rejects.toThrow(
      'scripted inference has no reply 2 — the fixture holds 1',
    )
  })

  test('an abort mid-stream stops the stream', async () => {
    const inference = new ScriptedInference(CONFIG, stubPorts().fetch, SCRIPT)
    const controller = new AbortController()
    const deltas: string[] = []
    const pending = inference.infer(
      { prompt: 'hi' },
      (chunk) => {
        deltas.push(chunk)
        controller.abort()
      },
      controller.signal,
    )
    await expect(pending).rejects.toThrow('inference aborted')
    expect(deltas).toEqual(['The '])
  })
})

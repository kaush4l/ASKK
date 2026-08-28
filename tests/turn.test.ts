import { describe, expect, test } from 'bun:test'
import { buildAgent } from '@/core/agent/build'
import { react } from '@/core/agent/react'
import type { Message } from '@/core/agent/transcript'
import type { InferenceConfig, InferenceRequest, InferenceResult, OnDelta } from '@/core/inference/base'
import { ScriptedInference } from '@/core/inference/scripted'
import type { ScriptedReply } from '@/core/inference/scripted'
import type { AssembledEvent, Observer } from '@/core/observer'
import { stubPorts } from '@/core/ports'
import type { Ports } from '@/core/ports'
import { utf8Bytes } from '@/core/prompt/assembler'
import { HARNESS_LABEL, historyLines } from '@/core/prompt/recipe'
import type { Recipe } from '@/core/prompt/recipe'
import { CORE_MARK } from '@/core/prompt/slots'
import { ReActResponse } from '@/core/response/responses'

/**
 * 2.8's acceptance: one real turn, end to end, with **no prompt double
 * anywhere in this file**.
 *
 * Until this file existed, `promptFor` and `new Agent` had never run in the
 * same process (`docs/scratch/FLOW.md`): every check in the gate had a *file*
 * for its subject and none had a *relationship*, so eighty-six green tests
 * were entirely consistent with a harness that could not assemble a prompt and
 * send it. The agent came from `buildAgent`, the response class is the real
 * `ReActResponse`, and the transport is `ScriptedInference` holding a recorded
 * reply.
 *
 * **What assertion (a) proves, and what it does not.** It proves
 * `promptFor → Agent.turn → Inference` for one path, with a fake transport and
 * a handed-in context — it compares what the **transport received** against
 * the golden, which is the difference between proving a part and proving a
 * path. It says nothing about core ↔ page or agent ↔ worker; both seams are
 * still unjoined and 3.1/3.3 are where they are not.
 *
 * The clock trap is the same one `tests/prompt.test.ts` asserts both halves of:
 * the goldens pin `2026-08-16 12:00:00 PDT` beside `day: Saturday` and that
 * date is a **Sunday**. No clock can derive the pair, so the context is handed
 * in fixed. A byte that differs is this port being wrong, never the oracle.
 */

const CONFIG: InferenceConfig = {
  model: 'test-model',
  baseUrl: 'http://127.0.0.1:8873/v1',
  apiKey: 'none',
  temperature: 0.7,
  maxTokens: 4096,
}

const GOLDEN = new URL('./golden/', import.meta.url)

const golden = (name: string): Promise<string> => Bun.file(new URL(name, GOLDEN)).text()

/** The first differing character, with enough either side to recognise it. */
function diff(actual: string, expected: string): string {
  if (actual === expected) return ''
  let i = 0
  while (i < actual.length && i < expected.length && actual[i] === expected[i]) i++
  const show = (s: string): string => JSON.stringify(s.slice(Math.max(0, i - 40), i + 40))
  return [
    `first difference at character ${i}`,
    `  expected: ${show(expected)}`,
    `  actual:   ${show(actual)}`,
  ].join('\n')
}

/** The recorded instant and the recorded weekday, which do not agree with each other. */
const FIXED_CONTEXT = { 'current time': '2026-08-16 12:00:00 PDT', day: 'Saturday' }

const USAGES = ['echo({"text": "<text>"}): Echo the text back.', 'weather({"city": "<city>"}): Report the weather for a city.']

/** Exactly the recipe `render-full.prompt` was recorded from. */
const FULL: Recipe = {
  system: 'You are helpful.\nBe brief.',
  context: () => ({ ...FIXED_CONTEXT }),
  usages: USAGES,
  model: ReActResponse,
}

/** And exactly the conversation it was recorded with. */
const SEED: readonly Message[] = [
  { role: 'user', content: 'hi' },
  { role: 'assistant', content: 'hello there' },
]

const CALL = 'echo({"text": "hey"})'
const TOOL_REPLY = `think: [it wants an echo]\n\nplan: [call echo]\n\nact: tool\n\nresult: ${CALL}`
const ANSWER_REPLY = 'think: [it is a greeting]\n\nplan: []\n\nact: answer\n\nresult: Hello back.'

/** Ports with a pinned id allocator. Everything else still throws on contact. */
function testPorts(): Ports {
  let ids = 0
  return { ...stubPorts(), newId: () => `turn-${++ids}` }
}

function replies(script: readonly string[]): ScriptedReply[] {
  return script.map((text) => ({ chunks: [text], stopReason: 'stop', usage: null }))
}

function scripted(script: readonly string[]): ScriptedInference {
  return new ScriptedInference(CONFIG, stubPorts().fetch, replies(script))
}

/** The real transport, announcing each call into the same log the observer writes. */
class LoggedInference extends ScriptedInference {
  readonly log: string[] = []

  override async infer(req: InferenceRequest, onDelta?: OnDelta, signal?: AbortSignal): Promise<InferenceResult> {
    this.log.push('infer')
    return await super.infer(req, onDelta, signal)
  }
}

describe('one turn, joined', () => {
  test('(a) the prompt the transport received is the golden, byte for byte', async () => {
    const expected = await golden('render-full.prompt')
    const inference = scripted([ANSWER_REPLY])
    const agent = buildAgent({ recipe: FULL, inference, ports: testPorts(), messages: SEED })

    // `turn` and not `react`, because `react` records the query as a third
    // history line and the fixture was recorded from these two. The seam under
    // test is the same one either way.
    const reply = await agent.turn(agent.open('anything'))

    expect(inference.received).toHaveLength(1)
    const sent = inference.received[0]?.prompt ?? ''
    expect(diff(sent, expected)).toBe('')
    expect(sent).toBe(expected)
    expect(reply.answer).toBe('Hello back.')
  })

  test('(b) assembled fires before inference, and before the first delta', async () => {
    const inference = new LoggedInference(CONFIG, stubPorts().fetch, [
      { chunks: ['act: ans', 'wer\n\nresult: hi'], stopReason: 'stop', usage: null },
    ])
    const observer: Observer = {
      assembled: () => inference.log.push('assembled'),
      delta: (e) => inference.log.push(`delta ${e.text}`),
    }
    const agent = buildAgent({ recipe: FULL, inference, ports: testPorts(), messages: SEED, observer })

    await agent.turn(agent.open('anything'))

    expect(inference.log).toEqual(['assembled', 'infer', 'delta act: ans', 'delta wer\n\nresult: hi'])
  })

  test('assembled carries the breakdown of the prompt it reports, not a bare string', async () => {
    const inference = scripted([ANSWER_REPLY])
    const seen: AssembledEvent[] = []
    const agent = buildAgent({
      recipe: FULL,
      inference,
      ports: testPorts(),
      messages: SEED,
      observer: { assembled: (e) => seen.push(e) },
    })

    await agent.turn(agent.open('anything'))

    const event = seen[0]
    expect(seen).toHaveLength(1)
    expect(event?.prompt).toBe(inference.received[0]?.prompt ?? '')
    expect(event?.breakdown.build).toBe(CORE_MARK)
    expect(event?.breakdown.bytes).toBe(utf8Bytes(event?.prompt ?? ''))
    expect(event?.breakdown.bands.map((b) => b.name)).toEqual([
      'SystemInstructions',
      'ContextBlock',
      'History',
      'ToolboxComponent',
      'ResponseContract',
    ])
  })

  test('(c) the reply parsed through ReActResponse routes the loop', async () => {
    // The `BaseResponse` -> `ReplyModel` seam, which FLOW §4 records as never
    // once crossed: `isAnswer` here is `ReActResponse`'s own, computed from the
    // `act` field its own instructions asked the model for.
    const calling = scripted([TOOL_REPLY])
    const agent = buildAgent({ recipe: FULL, inference: calling, ports: testPorts(), messages: SEED })
    const reply = await agent.turn(agent.open('please echo hey'))
    expect(reply.isAnswer).toBe(false)
    expect(reply.answer).toBe(CALL)

    const second = scripted([ANSWER_REPLY])
    const plain = buildAgent({ recipe: FULL, inference: second, ports: testPorts(), messages: SEED })
    const answered = await plain.turn(plain.open('hello'))
    expect(answered.isAnswer).toBe(true)
    expect(answered.answer).toBe('Hello back.')
  })

  test('(d) a signal aborted mid-stream ends the turn as `inference aborted`', async () => {
    const controller = new AbortController()
    const chunks = ['one ', 'two ', 'three']
    const seen: string[] = []
    const inference = new ScriptedInference(CONFIG, stubPorts().fetch, [
      { chunks, stopReason: 'stop', usage: null },
    ])
    const agent = buildAgent({
      recipe: FULL,
      inference,
      ports: testPorts(),
      messages: SEED,
      signal: controller.signal,
      observer: {
        delta: (e) => {
          seen.push(e.text)
          controller.abort()
        },
      },
    })

    await expect(agent.turn(agent.open('anything'))).rejects.toThrow('inference aborted')
    // Mid-stream, not before it: one chunk was delivered and the rest were not.
    expect(seen).toEqual(['one '])
    expect(agent.transcript.messages).toHaveLength(SEED.length)
  })

  test('(d control) the same script with no abort runs to the end', async () => {
    const chunks = ['act: answer', '\n\nresult: all three']
    const inference = new ScriptedInference(CONFIG, stubPorts().fetch, [
      { chunks, stopReason: 'stop', usage: null },
    ])
    const agent = buildAgent({ recipe: FULL, inference, ports: testPorts(), messages: SEED })
    const reply = await agent.turn(agent.open('anything'))
    expect(reply.answer).toBe('all three')
  })
})

describe('(e) the harness does not speak in a voice that is not its own', () => {
  /** Two identical tool calls against `repeatLimit: 1` reach the third tier. */
  async function giveUp(): Promise<{
    agent: ReturnType<typeof buildAgent>
    inference: ScriptedInference
    answer: string
  }> {
    const inference = scripted([TOOL_REPLY, TOOL_REPLY, ANSWER_REPLY])
    const agent = buildAgent({
      recipe: FULL,
      inference,
      ports: testPorts(),
      messages: SEED,
      repeatLimit: 1,
    })
    const reply = await react(agent, 'please echo hey')
    return { agent, inference, answer: reply.answer }
  }

  test('the give-up line is the only entry marked harness-written', async () => {
    const { agent } = await giveUp()
    const messages = agent.transcript.messages
    const last = messages[messages.length - 1]

    expect(last?.role).toBe('user')
    expect(last?.content).toBe(`Result: Stopping — ${CALL} was tried 2 times without progress.`)
    expect(last?.origin).toBe('harness')
    expect(messages.filter((m) => m.origin === 'harness')).toHaveLength(1)
  })

  test('historyLines renders it behind the marker, and nothing else behind it', async () => {
    const { agent } = await giveUp()
    const lines = historyLines(agent.transcript)

    expect(lines[lines.length - 1]).toBe(
      `[${HARNESS_LABEL}]: Result: Stopping — ${CALL} was tried 2 times without progress.`,
    )
    expect(lines.filter((l) => l.startsWith(`[${HARNESS_LABEL}]: `))).toHaveLength(1)
    for (const line of lines.slice(0, -1)) expect(line).toMatch(/^\[(USER|ASSISTANT)\]: /)
  })

  test('the marker reaches the bytes the transport is handed on the next turn', async () => {
    const { agent, inference } = await giveUp()

    await agent.turn(agent.open('and now?'))

    const sent = inference.received[2]?.prompt ?? ''
    expect(inference.received).toHaveLength(3)
    expect(sent).toContain(`[${HARNESS_LABEL}]: Result: Stopping — ${CALL} was tried 2 times without progress.`)
    // The whole point: the model is never handed its harness's words as a
    // person's. `LESSONS.md` defect 3, at the one seam that can render it back.
    expect(sent).not.toContain('[USER]: Result: Stopping')
  })

  test('the synthesised answer keeps the response class and is not transcribed', async () => {
    const { agent, answer } = await giveUp()
    // `answerOf` on the real `ReActResponse`, so the agent gives up in the same
    // class it was answering in.
    expect(answer).toBe(`I could not complete this. ${CALL} failed every time I tried it.`)
    // Recorded rather than asserted about: the give-up reply is returned to the
    // caller and never written to the transcript, so nothing renders it back.
    // `AGENT.md` §0.1 E4 says `Agent.turn` writes it as an `assistant` message;
    // it does not, and `FLOW.md` §5 measured the same thing.
    const contents = agent.transcript.messages.map((m) => m.content)
    expect(contents).not.toContain(`I could not complete this. ${CALL} failed every time I tried it.`)
  })
})

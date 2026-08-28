import { describe, expect, test } from 'bun:test'
import { Agent, PLAIN_TEXT } from '@/core/agent/agent'
import type { ReplyModel } from '@/core/agent/agent'
import type { Session } from '@/core/agent/session'
import { NO_TOOLS, OUTCOMES, TERMINAL, outcomeOf, react } from '@/core/agent/react'
import { ScriptedInference } from '@/core/inference/scripted'
import type { InferenceRequest, InferenceResult, OnDelta } from '@/core/inference/base'
import type { InferenceConfig } from '@/core/inference/base'
import { stubPorts } from '@/core/ports'
import type { Ports } from '@/core/ports'
import type { AssembledEvent, DeltaEvent, DoneEvent, Observer, RetryEvent } from '@/core/observer'

/**
 * 2.4's acceptance is that the loop runs, emits its lifecycle events, and
 * terminates. Two of those three are only observable from outside the core, so
 * this file asserts them the way they will actually be consumed: an event log
 * the **transport writes into as well**, so `assembled fires before inference`
 * is a claim about one ordered list rather than about two lists compared by
 * eye. An implementation that posted `assembled` after `infer` resolved would
 * still emit every event, in the right count, with the right payloads.
 *
 * The prompt and the tools are seams here, because the assembler is 2.6 and the
 * toolbox is 4.2. Neither is faked in `src/` — the doubles are in this file,
 * where they are obviously doubles.
 */

const CONFIG: InferenceConfig = {
  model: 'test-model',
  baseUrl: 'http://127.0.0.1:8873/v1',
  apiKey: 'none',
  temperature: 0.7,
  maxTokens: 4096,
}

/** The double's convention: a reply that opens with this is a tool call, and the rest is the call. */
const CALL = 'call: '

/**
 * A stand-in for 2.5's `ReActResponse` — the two things the loop needs and
 * nothing else. `answerOf` is what the give-up is built from, so a give-up is a
 * reply of the same class the model was answering in.
 */
const CALLS_TOOLS: ReplyModel = {
  parse: (raw) =>
    raw.startsWith(CALL)
      ? { isAnswer: false, answer: raw.slice(CALL.length) }
      : { isAnswer: true, answer: raw },
  answerOf: (text) => ({ isAnswer: true, answer: text }),
}

/** Ports with only what 2.4 uses wired: a pinned id allocator. Everything else still throws. */
function testPorts(): Ports {
  let ids = 0
  return { ...stubPorts(), newId: () => `turn-${++ids}` }
}

/** The scripted transport, announcing each call into the same log the observer writes. */
class LoggedInference extends ScriptedInference {
  readonly log: string[]

  constructor(script: readonly string[], log: string[]) {
    super(
      CONFIG,
      stubPorts().fetch,
      script.map((text) => ({ chunks: [text], stopReason: 'stop', usage: null })),
    )
    this.log = log
  }

  override async infer(req: InferenceRequest, onDelta?: OnDelta, signal?: AbortSignal): Promise<InferenceResult> {
    this.log.push('infer')
    return await super.infer(req, onDelta, signal)
  }
}

/** An observer that writes every event into one ordered log. */
function logging(log: string[]): Observer {
  return {
    assembled: (e) => log.push(`assembled ${e.phase} ${e.turnId}`),
    entered: (e) => log.push(`entered ${e.phase} round=${e.round}`),
    delta: (e) => log.push(`delta ${e.text}`),
    results: (e) => log.push(`results ${e.observation}`),
    retry: (e) => log.push(`retry seen=${e.seen} gaveUp=${e.gaveUp}`),
    done: (e) => log.push(`done rounds=${e.rounds}`),
  }
}

/** The prompt seam. It renders the session, so a prompt built once would show. */
const prompt = (session: Session): string => `${session.query}|${session.transcript.length}`

describe('the react loop', () => {
  test('runs to the declared terminal and leaves the turns behind', async () => {
    const log: string[] = []
    const inference = new LoggedInference([`${CALL}echo({"text": "hey"})`, 'done: hey'], log)
    const ran: string[] = []
    const agent = new Agent({
      inference,
      ports: testPorts(),
      prompt,
      model: CALLS_TOOLS,
      tools: async (call) => {
        ran.push(call)
        return 'echo: hey'
      },
    })

    const reply = await react(agent, 'please echo hey')

    expect(reply.answer).toBe('done: hey')
    expect(outcomeOf(reply)).toBe(TERMINAL)
    expect(ran).toEqual(['echo({"text": "hey"})'])
    expect(agent.transcript.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'please echo hey'],
      ['assistant', 'echo({"text": "hey"})'],
      ['user', 'Result: echo: hey'],
      ['assistant', 'done: hey'],
    ])
  })

  test('the prompt is rendered again each pass, against the transcript as it now stands', async () => {
    const log: string[] = []
    const inference = new LoggedInference([`${CALL}x()`, 'finished'], log)
    const agent = new Agent({
      inference,
      ports: testPorts(),
      prompt,
      model: CALLS_TOOLS,
      tools: async () => 'ok',
    })

    await react(agent, 'go')

    // One user line at the first turn; user + assistant + result at the second.
    expect(inference.received.map((r) => r.prompt)).toEqual(['go|1', 'go|3'])
  })

  test('every lifecycle event fires, in order, with assembled before the model is called', async () => {
    const log: string[] = []
    const inference = new LoggedInference([`${CALL}x()`, 'finished'], log)
    const agent = new Agent({
      inference,
      ports: testPorts(),
      prompt,
      model: CALLS_TOOLS,
      observer: logging(log),
      tools: async () => 'ok',
    })

    await react(agent, 'go')

    expect(log).toEqual([
      'entered react round=0',
      'assembled react turn-1',
      'infer',
      'delta call: x()',
      'results ok',
      'entered react round=1',
      'assembled react turn-1',
      'infer',
      'delta finished',
      'done rounds=1',
    ])
  })

  test('assembled reports the prompt that is about to go out, not one that already did', async () => {
    const log: string[] = []
    const inference = new LoggedInference(['answered'], log)
    const seenBy: AssembledEvent[] = []
    const deltas: DeltaEvent[] = []
    const agent = new Agent({
      inference,
      ports: testPorts(),
      prompt,
      observer: {
        // Causal, not positional: at the moment this fires the transport must
        // not yet hold the request it is reporting.
        assembled: (e) => {
          expect(inference.received).toEqual([])
          seenBy.push(e)
        },
        delta: (e) => deltas.push(e),
      },
    })

    await react(agent, 'go')

    expect(seenBy.map((e) => e.prompt)).toEqual(['go|1'])
    expect(inference.received.map((r) => r.prompt)).toEqual(['go|1'])
    expect(deltas).toEqual([{ turnId: 'turn-1', text: 'answered' }])
  })

  test('a plain-text agent has no tool outcome, so it ends on the first pass', async () => {
    const log: string[] = []
    const inference = new LoggedInference([`${CALL}x()`], log)
    const agent = new Agent({ inference, ports: testPorts(), prompt, model: PLAIN_TEXT })

    const reply = await react(agent, 'go')

    // PLAIN_TEXT answers with the model's words, whatever they look like.
    expect(reply.answer).toBe(`${CALL}x()`)
    expect(outcomeOf(reply)).toBe(OUTCOMES.ANSWER)
    expect(inference.received).toHaveLength(1)
  })

  test('a tool call with no tool runner reads back the toolbox sentence', async () => {
    const log: string[] = []
    const inference = new LoggedInference([`${CALL}echo({})`, 'gave up on that'], log)
    const agent = new Agent({ inference, ports: testPorts(), prompt, model: CALLS_TOOLS })

    await react(agent, 'go')

    expect(agent.transcript.messages[2]).toEqual({ role: 'user', content: `Result: ${NO_TOOLS}` })
  })
})

describe('the repeat guard', () => {
  test('a repeated call is scolded and the tool does NOT run again', async () => {
    const log: string[] = []
    const inference = new LoggedInference([`${CALL}echo({})`, `${CALL}echo({})`, 'fine, done'], log)
    const ran: string[] = []
    const agent = new Agent({
      inference,
      ports: testPorts(),
      prompt,
      model: CALLS_TOOLS,
      observer: logging(log),
      tools: async (call) => {
        ran.push(call)
        return 'echoed'
      },
    })

    const reply = await react(agent, 'go')

    expect(reply.answer).toBe('fine, done')
    expect(ran).toEqual(['echo({})'])
    expect(agent.transcript.messages[4]?.content).toBe(
      'Result: You already made this exact call 1 time(s) and the outcome will not change. ' +
        'Do something different: a different tool, different arguments, or answer with what you have.',
    )
    expect(log.filter((line) => line.startsWith('retry'))).toEqual(['retry seen=2 gaveUp=false'])
    // The scolded pass reports no results, because nothing ran.
    expect(log.filter((line) => line.startsWith('results'))).toEqual(['results echoed'])
  })

  test('past the limit the loop ends with a synthesised reply, not an exception', async () => {
    const log: string[] = []
    const stubborn = `${CALL}echo({"text": "same"})`
    // Ten replies for a loop that must stop at three: an unguarded loop runs
    // out of fixture and fails loudly rather than hanging this suite.
    const inference = new LoggedInference(Array.from({ length: 10 }, () => stubborn), log)
    const dones: DoneEvent[] = []
    const retries: RetryEvent[] = []
    const agent = new Agent({
      inference,
      ports: testPorts(),
      prompt,
      model: CALLS_TOOLS,
      repeatLimit: 2,
      observer: { done: (e) => dones.push(e), retry: (e) => retries.push(e) },
      tools: async () => 'echoed',
    })

    const reply = await react(agent, 'loop forever')

    expect(reply.isAnswer).toBe(true)
    expect(reply.answer).toBe('I could not complete this. echo({"text": "same"}) failed every time I tried it.')
    // The give-up is synthesised, so it is not a fourth exchange with the model:
    // the observation handed out on the way is the last line of the transcript.
    expect(inference.received).toHaveLength(3)
    expect(agent.transcript.messages.at(-1)?.content).toBe(
      'Result: Stopping — echo({"text": "same"}) was tried 3 times without progress.',
    )
    expect(retries.map((r) => `${r.seen}/${r.gaveUp}`)).toEqual(['2/false', '3/true'])
    expect(dones).toEqual([{ turnId: 'turn-1', answer: reply.answer, rounds: 2 }])
  })

  test('the give-up is a reply of the model’s own class', async () => {
    const log: string[] = []
    const marked: ReplyModel = {
      parse: CALLS_TOOLS.parse,
      answerOf: (text) => ({ isAnswer: true, answer: `[marked] ${text}` }),
    }
    const inference = new LoggedInference(Array.from({ length: 4 }, () => `${CALL}same()`), log)
    const agent = new Agent({ inference, ports: testPorts(), prompt, model: marked, repeatLimit: 1 })

    const reply = await react(agent, 'go')

    expect(reply.answer.startsWith('[marked] ')).toBe(true)
    expect(inference.received).toHaveLength(2)
  })

  test('two different calls are two ledger entries, so alternating never gives up', async () => {
    const log: string[] = []
    const inference = new LoggedInference([`${CALL}a()`, `${CALL}b()`, `${CALL}a()`, 'done'], log)
    const ran: string[] = []
    const agent = new Agent({
      inference,
      ports: testPorts(),
      prompt,
      model: CALLS_TOOLS,
      repeatLimit: 2,
      tools: async (call) => {
        ran.push(call)
        return 'ok'
      },
    })

    const reply = await react(agent, 'go')

    expect(reply.answer).toBe('done')
    // `a()` ran once and was scolded on its second ask; `b()` ran once.
    expect(ran).toEqual(['a()', 'b()'])
  })
})

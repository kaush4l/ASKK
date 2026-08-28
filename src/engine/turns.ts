// REALM: worker
/**
 * THE RESIDENT (`docs/RESIDENT.md` §2.2). It owns the conversation, the warm
 * assembler memo, the endpoint, the live `AbortController` and the one-turn
 * rule, **for the life of the worker realm**. Turns are its subroutines.
 *
 * This is the missing arrow `RESIDENT.md` §5.3 names: `FLOW.md` traces a turn
 * and starts at `react()`, §5's boot trace ends at hop 21 idle, and until this
 * file existed the two did not meet at any point. The junction is
 * `host.ts case 'turn/start' → here → react(agent, text)`, and it is one call.
 *
 * **Why there is no loop here, stated because its absence is the design.**
 * `RESIDENT.md` §2.6: the event loop is already the resident loop. An idle
 * resident holds one Web Lock, one `onmessage` and zero timers, and burns
 * nothing until a message arrives. A `while (true) { await queue.next() }`
 * written over that idles identically — parked on a promise either way — while
 * needing a queue port, an idle-wait port and a waker port, each with one
 * caller, and none of which `src/core/**` may have. Control inside a turn stays
 * in `core/agent/react.ts`'s `loop`, exactly as `FLOW.md` traces it.
 *
 * **What survives what** (§2.5): the transcript, the memo and the endpoint
 * survive a turn. The `Agent` is composed per turn and that is not a weakening
 * of the ruling but its own mechanism — §2.7 threads cancellation
 * `AgentOptions → Session → turn → infer`, and `Agent.signal` is fixed at
 * construction, so a per-realm `Agent` could only ever be cancelled once, after
 * which every later turn would start already-aborted. §2.8's own table calls
 * per-turn construction "fine either way; not a reason". What the composition
 * costs is one object; what it carries over is the whole conversation and the
 * memo, which is what §2.7 says residency actually buys.
 *
 * The `Session` stays per-run and is not promoted, because `Session.seen` is
 * the repeat guard's ledger and a session-lifetime one would fire the guard
 * across unrelated turns.
 *
 * The transport is built here rather than injected: `serve(scope)` takes no
 * seam for it, so a host test drives the **real** `OpenAiInference` against a
 * real HTTP server it controls (`tests/turn-stream.test.ts`). A factory
 * parameter would be a knob with one caller, and would let a test pass against
 * a transport the page never runs.
 */

import { buildAgent } from '@/core/agent/build'
import type { Agent } from '@/core/agent/agent'
import { OpenAiInference } from '@/core/inference/openai'
import { react } from '@/core/agent/react'
import { PromptAssembler } from '@/core/prompt/assembler'
import { stubPorts } from '@/core/ports'
import type { Ports } from '@/core/ports'
import type { Message } from '@/core/agent/transcript'
import type { FromEngine } from '@/protocol/messages'
import type { Endpoint } from '@/protocol/shapes'

/** Sampling nobody can choose yet. `config/set` (3.4) is where these become the user's. */
const TEMPERATURE = 0.7
const MAX_TOKENS = 2048

/**
 * Who the agent is, until 4.1 reads it from `public/seed/agents/main/agent.md`.
 *
 * **These bytes are not this file's to invent and they were not invented.**
 * They are copied character for character from
 * `git show pre-workbench:agents/main/agent.md`, which is `AGENT.md` row 1's
 * own source for the file 4.1 will ship. It is here at all because
 * `PromptAssembler` **raises** without a SOUL or a SYSTEM — *an agent must be
 * someone* — so a turn cannot be run at 3.3 without one.
 *
 * **What was left out, and why that is not an edit.** That file's `## Tools`,
 * `## The shared space` and `## Scheduling` sections describe tools, a board
 * and a scheduler this build does not have. Whole sections are omitted; no
 * sentence is rewritten and no word is changed. Telling a model about machinery
 * it cannot reach is `LESSONS.md` defect 3, and it is the one thing worse than
 * having no identity at all. `## Conversation format` went with them: its one
 * sentence names "the response format below", and this build's response class
 * is `null`, which renders no such block.
 */
const SOUL = 'You are a helpful assistant. Answer clearly, accurately, and concisely.'
const SYSTEM = `## Reasoning discipline

- Use the earlier turns — the user expects you to remember them.
- Answer at the length the question deserves; no filler, no restating the question.
- Never fabricate. If you do not know or are unsure, say so plainly.`

/** The turn in flight, and everything needed to end it and to label what it emits. */
interface LiveTurn {
  turnId: string
  controller: AbortController
  startedAt: number
  /** How many deltas have crossed, so `turn/delta.seq` is an order the receiver can check. */
  deltas: number
  rounds: number
}

/**
 * The worker realm's environment, as the core's port seam.
 *
 * `store` is `stubPorts()`'s — it throws if called, and nothing calls it:
 * `RESIDENT.md` §4.4 rules that `engine/` persists from the observer and
 * `StorePort` leaves `Ports` at 3.4. `clock` is the stub for a similar reason
 * one level down: its only caller would be the recipe's context facts, whose
 * rendering needs `Intl`, which no realm allowlist permits and which
 * `adapters/browser/clock.ts` is what will own.
 */
function workerPorts(): Ports {
  return { ...stubPorts(), fetch: (input, init) => fetch(input, init), newId: () => crypto.randomUUID() }
}

export class Resident {
  readonly #emit: (message: FromEngine) => void
  readonly #ports = workerPorts()
  /**
   * One assembler for the realm, not one per turn. It holds the memo, which is
   * the whole reason the expensive head of the prompt stays byte-stable turn
   * after turn; one built per render would hit it never.
   */
  readonly #assembler = new PromptAssembler()
  /** The conversation, which is older than any turn and outlives every one of them. */
  #messages: readonly Message[] = []
  #live: LiveTurn | null = null

  constructor(emit: (message: FromEngine) => void) {
    this.#emit = emit
  }

  /**
   * Reply `turn/started`, then run the turn.
   *
   * The reply is emitted **here and not returned to `dispatch`**, because this
   * is the only place that can order it against the stream it opens: §6.2 says
   * `turn/started`, then the events, and a `turn/delta` that overtook its own
   * `turn/started` would reach a store with no turn to write it into.
   *
   * Throws when a turn is already live. §7.5 serialises turns, and `dispatch`
   * turns the throw into `failed` carrying these words.
   */
  start(id: number, text: string, endpoint: Endpoint): void {
    if (this.#live !== null) {
      throw new Error(`turn ${this.#live.turnId} is already running — §7.5 runs one turn at a time, which is what makes a single transcript coherent`)
    }
    const live: LiveTurn = { turnId: this.#ports.newId(), controller: new AbortController(), startedAt: Date.now(), deltas: 0, rounds: 0 }
    this.#live = live
    this.#emit({ type: 'turn/started', id, turnId: live.turnId })
    void this.#run(this.agentFor(endpoint, live), text, live)
  }

  /** Stop the live turn. `false` when the id names no turn — `host.ts` refuses it by name (§6.6). */
  abort(turnId: string): boolean {
    const live = this.#live
    if (live === null || live.turnId !== turnId) return false
    live.controller.abort()
    return true
  }

  /**
   * The agent for this turn: this endpoint's transport, the conversation so far,
   * the realm's assembler, and this turn's signal.
   *
   * The endpoint is read per turn rather than pinned at the first one. The
   * conversation is the person's and does not belong to the server that was
   * answering it, so changing endpoints continues the conversation instead of
   * starting a second one.
   */
  private agentFor(endpoint: Endpoint, live: LiveTurn): Agent {
    const config = { model: endpoint.model, baseUrl: endpoint.baseUrl, apiKey: endpoint.apiKey ?? '', temperature: TEMPERATURE, maxTokens: MAX_TOKENS }
    return buildAgent({
      inference: new OpenAiInference(config, this.#ports.fetch),
      ports: this.#ports,
      assembler: this.#assembler,
      messages: this.#messages,
      signal: live.controller.signal,
      observer: {
        delta: (event) => this.#emit({ type: 'turn/delta', turnId: live.turnId, seq: (live.deltas += 1), text: event.text }),
        done: (event) => {
          live.rounds = event.rounds
        },
      },
      // No context facts: their rendering needs a clock adapter, so the block
      // elides rather than carrying a time this realm cannot format. The model
      // is told nothing false about the hour; it is told nothing at all.
      recipe: { soul: SOUL, system: SYSTEM, context: () => ({}) },
    })
  }

  /**
   * The turn, and its three terminals. Nothing throws out of here: an unhandled
   * rejection in a worker is silence, and silence is a page waiting forever.
   *
   * `turn/aborted` is a distinct terminal from `turn/failed` (§6.3): collapsing
   * them would paint the operator's own decision as a break, and would make
   * "did it fail or did I stop it" unanswerable afterwards.
   */
  async #run(agent: Agent, text: string, live: LiveTurn): Promise<void> {
    try {
      const reply = await react(agent, text)
      this.#emit({ type: 'turn/done', turnId: live.turnId, answer: reply.answer, rounds: live.rounds, ms: Date.now() - live.startedAt })
    } catch (error) {
      if (live.controller.signal.aborted) this.#emit({ type: 'turn/aborted', turnId: live.turnId, ms: Date.now() - live.startedAt })
      else this.#emit({ type: 'turn/failed', turnId: live.turnId, message: error instanceof Error ? error.message : String(error) })
    } finally {
      // Whatever ended it, the conversation keeps what was said. On an abort or
      // a failure that is the user's line and nothing else: `agent.turn` writes
      // the assistant line only from a parsed reply, so a half-streamed answer
      // is shown to the person and never told to the model as if it were said.
      this.#messages = agent.transcript.messages
      this.#live = null
    }
  }
}

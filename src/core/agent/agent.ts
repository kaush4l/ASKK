/**
 * The Agent — one turn: assemble, infer, parse, record.
 *
 *     const reply = await react(new Agent({ ... }), "please echo hey")
 *
 * A turn is the whole of one exchange with the model and it is all this file
 * does. What to do with the reply — run the tools, come round again, stop — is
 * the loop's decision and lives in `react.ts`, which imports this and is never
 * imported by it. The old tree had the agent call its own loop and the loop
 * call back into the agent; that cycle was made by the file layout and is not
 * ported.
 *
 * Two collaborators are **seams and not implementations**:
 *
 * - `prompt` renders the session as the string that goes to the model. Nothing
 *   here invents prompt bytes. `core/agent/build.ts` is the one place the real
 *   assembler is fitted to it (2.8); before that the seam had only doubles.
 * - `tools` runs the calls the model wrote and returns what the model reads
 *   next. The toolbox is 4.2 and still has none.
 *
 * Both are declared here so the loop can be finished and exercised now, and
 * neither has a plausible-looking stand-in, which is how an increment ends up
 * shipping a fake it later has to find again.
 */

import type { Inference } from '@/core/inference/base'
import type { Breakdown } from '@/core/prompt/assembler'
import { Session } from '@/core/agent/session'
import { Transcript } from '@/core/agent/transcript'
import type { Message } from '@/core/agent/transcript'
import { SILENT } from '@/core/observer'
import type { Observer } from '@/core/observer'
import type { Ports } from '@/core/ports'

/** What the loop needs of a reply: whether it is final, and what its text is. */
export interface Reply {
  readonly isAnswer: boolean
  readonly answer: string
}

/**
 * What the loop needs of a response class: read a reply, and make one.
 *
 * `answerOf` is what the repeat guard's give-up is built from, so the give-up
 * is *of the same response class the model was already answering in* — a react
 * agent gives up in a react reply and the transcript stays one shape.
 * `ReActResponse` (2.5) satisfies this; so does `PLAIN_TEXT` below.
 */
export interface ReplyModel {
  parse(raw: string): Reply
  answerOf(text: string): Reply
}

/**
 * No structured contract: the model's words are the answer, and the loop ends
 * on the first pass. This is the Python's `response_model: None`, which is a
 * real configuration and not a placeholder.
 */
export const PLAIN_TEXT: ReplyModel = {
  parse: (raw) => ({ isAnswer: true, answer: raw }),
  answerOf: (text) => ({ isAnswer: true, answer: text }),
}

/**
 * What the prompt seam produces: the bytes that go to the model, and the
 * account of how they were built.
 *
 * The breakdown is not extra work — `PromptAssembler.detail()` computes every
 * band, both memo counters and the bundle sentinel on every turn and the old
 * seam threw them away (`AGENT.md` §3.5). Returning them costs nothing and is
 * what `AssembledEvent` carries to the Prompt surface. The alternative — a
 * second, cheaper assemble path — would put two code paths through the one
 * function whose byte-exactness is the oracle.
 */
export interface Assembled {
  prompt: string
  breakdown: Breakdown
}

/** The prompt seam. `promptFor` (2.6's recipe) is what fills it; `build.ts` is where they meet. */
export type RenderPrompt = (session: Session) => Assembled

/** The tool seam. 4.2's `Toolbox.invoke` is what fills it; the string is what the model reads next. */
export type ToolRunner = (call: string) => Promise<string>

export interface AgentOptions {
  name?: string
  inference: Inference
  ports: Ports
  prompt: RenderPrompt
  model?: ReplyModel
  tools?: ToolRunner
  observer?: Observer
  /** Reaches into a call already in flight. Threaded to `infer` through the session. */
  signal?: AbortSignal
  /** Identical calls allowed before the guard gives up on one. The Python's default. */
  repeatLimit?: number
  messages?: readonly Message[]
}

export class Agent {
  readonly name: string
  readonly inference: Inference
  readonly ports: Ports
  readonly transcript: Transcript
  readonly model: ReplyModel
  readonly observer: Observer
  readonly repeatLimit: number
  readonly tools: ToolRunner | null
  readonly signal: AbortSignal | null
  readonly #prompt: RenderPrompt

  constructor(options: AgentOptions) {
    this.name = options.name ?? 'agent'
    this.inference = options.inference
    this.ports = options.ports
    this.transcript = new Transcript(options.messages ?? [])
    this.model = options.model ?? PLAIN_TEXT
    this.observer = options.observer ?? SILENT
    this.repeatLimit = options.repeatLimit ?? 3
    this.tools = options.tools ?? null
    this.signal = options.signal ?? null
    this.#prompt = options.prompt
  }

  /** Open a run. The id comes through the port, so a test can pin it. */
  open(query: string): Session {
    return new Session({ id: this.ports.newId(), query, transcript: this.transcript, signal: this.signal })
  }

  /**
   * Assemble, infer, parse, record. The whole of one exchange.
   *
   * `assembled` is posted before `infer` is called and that order is the
   * contract, not an implementation detail — see `observer.ts`.
   */
  async turn(session: Session): Promise<Reply> {
    const { prompt, breakdown } = this.#prompt(session)
    this.observer.assembled?.({ turnId: session.id, phase: session.phase, prompt, breakdown })
    const result = await this.inference.infer(
      { prompt },
      (text) => {
        this.observer.delta?.({ turnId: session.id, text })
      },
      // The third argument is the whole of the cancellation seam: the
      // transports have honoured it since 2.3 and nothing could pass one.
      session.signal ?? undefined,
    )
    const parsed = this.model.parse(result.text)
    // The answer field holds the reply — or the tool calls. Bare, line breaks
    // intact: prefixing it would teach the model to copy the prefix.
    session.transcript.add('assistant', parsed.answer.trim())
    return parsed
  }
}

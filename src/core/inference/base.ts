/**
 * The inference contract — one prompt string in, the model's whole reply out,
 * with every partial handed to `onDelta` as it lands.
 *
 * ARCHITECTURE.md §5.2 is the contract of record. Conversation history is the
 * caller's job: the assembler has already put it in the prompt, so a transport
 * never has an opinion about what a conversation is.
 *
 * Two things the old tree's base had are deliberately absent.
 * `InferenceRequest.attachments` is gone — no `Attachment` type was ever
 * defined and `SALVAGE.md` records remote attachments as a known-broken
 * `{data:"", format:""}`. `InferenceConfig.timeoutMs` is gone — §6 forbids a
 * timeout that cannot cancel, and the honest canceller is the `signal` below.
 */

import type { FetchPort } from '@/core/ports'

/** The endpoint and the sampling, as one value. A new server is a new config, not a new class. */
export interface InferenceConfig {
  model: string
  baseUrl: string
  apiKey: string
  temperature: number
  maxTokens: number
}

/** One call. A single assembled prompt — see the note about history above. */
export interface InferenceRequest {
  prompt: string
}

/** The whole reply. `usage` is `null` where the server did not account for it, never a guessed zero. */
export interface InferenceResult {
  text: string
  stopReason: string
  usage: { promptTokens: number; completionTokens: number } | null
}

/** Each partial as it lands. The concatenation of every chunk is the final text. */
export type OnDelta = (chunk: string) => void

/**
 * A transport's own account of what it sent.
 *
 * This is what DESIGN §4.4's Context surface renders, and it is on the base
 * rather than reconstructed by the caller because "what left the tab" is a
 * property of the wire protocol. `LESSONS.md` defect 3 is a harness that told
 * its model about a container it did not have; a surface that renders the
 * interface's *idea* of the request cannot catch that class of lie.
 *
 * There is no `headers` field. The key lives in `InferenceConfig` and the
 * Authorization header is the one part of a request that must not reach the
 * render realm — §7.2 makes the same ruling for `config/listed`'s `hasKey`.
 */
export interface RequestRecord {
  /**
   * Where the call goes. A transport that makes no network call names itself
   * instead of naming a URL it never fetched.
   */
  url: string
  /** The HTTP method, or `null` where nothing leaves the tab at all. */
  method: string | null
  /** The literal body, byte for byte as it would be serialized onto the wire. */
  body: string
}

/**
 * Abstract inference. A concrete implements one wire protocol.
 *
 * The base is earned on day one by two concretes: `ScriptedInference` (2.2)
 * and the HTTP one (2.3). It holds the config and the one way out of the
 * process, and decides nothing else.
 */
export abstract class Inference {
  protected readonly config: InferenceConfig
  /**
   * The only way out. `ScriptedInference` never calls it — that is the point of
   * passing it explicitly rather than reaching for a global: a fake handed
   * `stubPorts().fetch` turns a test red the instant it touches the network.
   */
  protected readonly fetchPort: FetchPort

  constructor(config: InferenceConfig, fetchPort: FetchPort) {
    this.config = config
    this.fetchPort = fetchPort
  }

  abstract infer(req: InferenceRequest, onDelta?: OnDelta, signal?: AbortSignal): Promise<InferenceResult>

  abstract describeRequest(req: InferenceRequest): RequestRecord
}

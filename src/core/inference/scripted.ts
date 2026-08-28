/**
 * Concrete #1 — a transport that replays a fixture, and drives every host test.
 *
 * It exists so a full turn can be exercised on the host with no network, no
 * endpoint and no clock. It is a fake and it says so: `describeRequest` reports
 * `method: null` and a `scripted:` url, because a fake that reported a POST to
 * a base URL it never called would be `LESSONS.md` defect 3 — a harness telling
 * its reader something it has not done.
 *
 * The fixture declares its own chunk boundaries. A transport that split a reply
 * into chunks by some rule of its own would be testing that rule rather than
 * the streaming contract, and 2.3's real chunks are whatever the server sent.
 */

import { Inference } from '@/core/inference/base'
import type {
  InferenceConfig,
  InferenceRequest,
  InferenceResult,
  OnDelta,
  RequestRecord,
} from '@/core/inference/base'
import type { FetchPort } from '@/core/ports'

/** One reply, as the fixture writes it. `chunks` joined is the reply text. */
export interface ScriptedReply {
  chunks: string[]
  stopReason: string
  usage: { promptTokens: number; completionTokens: number } | null
}

export class ScriptedInference extends Inference {
  private readonly script: readonly ScriptedReply[]
  private consumed = 0
  /** Every request handed to `infer`, in order, so a test can assert on what actually arrived. */
  readonly received: InferenceRequest[] = []

  constructor(config: InferenceConfig, fetchPort: FetchPort, script: readonly ScriptedReply[]) {
    super(config, fetchPort)
    this.script = script
  }

  async infer(req: InferenceRequest, onDelta?: OnDelta, signal?: AbortSignal): Promise<InferenceResult> {
    this.received.push(req)
    const reply = this.script[this.consumed]
    if (!reply) {
      throw new Error(
        `scripted inference has no reply ${this.consumed + 1} — the fixture holds ${this.script.length}`,
      )
    }
    this.consumed += 1
    let text = ''
    for (const chunk of reply.chunks) {
      // Between chunks, not only before the first: an abort arriving mid-stream
      // is the one this has to honour, and it is what `turn/abort` will send.
      if (signal?.aborted === true) throw new Error('inference aborted')
      text += chunk
      onDelta?.(chunk)
    }
    return { text, stopReason: reply.stopReason, usage: reply.usage }
  }

  /**
   * What this transport did with the request. There is no wire, so the body is
   * the fixture call as data — the same fields a real request would carry, so
   * the Context surface renders the same shape for both.
   */
  describeRequest(req: InferenceRequest): RequestRecord {
    return {
      url: `scripted:${this.config.model}`,
      method: null,
      body: JSON.stringify(
        {
          model: this.config.model,
          prompt: req.prompt,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
        },
        null,
        2,
      ),
    }
  }
}

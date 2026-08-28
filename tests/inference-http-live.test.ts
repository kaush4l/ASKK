import { describe, expect, test } from 'bun:test'
import { OpenAiInference } from '@/core/inference/openai'
import type { InferenceConfig } from '@/core/inference/base'

/**
 * PLAN 2.3's acceptance is *tokens arrive incrementally from a **real**
 * endpoint*, so this file is the acceptance and `tests/inference-http.test.ts`
 * is the regression guard. A fake stream is a weaker claim and both are here on
 * purpose.
 *
 * It skips — loudly, naming the endpoint — when no server answers, because a
 * suite that goes red on a machine without a local model is a suite that gets
 * ignored. `ASKK_LIVE_BASE_URL` and `ASKK_LIVE_MODEL` point it elsewhere.
 */

const BASE_URL = process.env.ASKK_LIVE_BASE_URL ?? 'http://127.0.0.1:8873/v1'
const MODEL = process.env.ASKK_LIVE_MODEL ?? 'granite-4.2-30b-MLX-8bit'
const PROBE_MS = 2000
/** A cold model load on this machine was measured at 19s for the first call. */
const CALL_MS = 180_000

const CONFIG: InferenceConfig = {
  model: MODEL,
  baseUrl: BASE_URL,
  apiKey: process.env.ASKK_LIVE_API_KEY ?? 'none',
  temperature: 0,
  // Large enough that a reasoning model reaches its answer: the measured omlx
  // endpoint flushes accumulated `reasoning_content` as one `content` chunk
  // when a turn is cut off by `length`, which is one delta and not a stream.
  maxTokens: 600,
}

async function endpointAnswers(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/models`, { signal: AbortSignal.timeout(PROBE_MS) })
    return response.ok
  } catch {
    return false
  }
}

const live = await endpointAnswers()
if (!live) console.log(`live inference: SKIPPED — nothing answered ${BASE_URL}/models within ${PROBE_MS}ms`)

describe('a real endpoint streams', () => {
  test.skipIf(!live)(
    'more than one chunk arrives, and the chunks are the reply',
    async () => {
      const deltas: string[] = []
      const arrivals: number[] = []
      const inference = new OpenAiInference(CONFIG, fetch)
      const result = await inference.infer({ prompt: 'Count from one to ten, in words, separated by commas. Answer only with the list.' }, (chunk) => {
        deltas.push(chunk)
        arrivals.push(performance.now())
      })

      expect(deltas.length).toBeGreaterThan(1)
      expect(deltas.join('')).toBe(result.text)
      expect(result.text.length).toBeGreaterThan(0)
      // Not one buffered burst: the first and last deltas are separated in time
      // by the model actually generating between them.
      expect((arrivals.at(-1) ?? 0) - (arrivals[0] ?? 0)).toBeGreaterThan(0)
      expect(result.usage?.completionTokens ?? 0).toBeGreaterThan(0)
    },
    CALL_MS,
  )

  test.skipIf(!live)(
    'an abort stops a real generation mid-stream',
    async () => {
      const controller = new AbortController()
      const deltas: string[] = []
      const inference = new OpenAiInference({ ...CONFIG, maxTokens: 512 }, fetch)
      const pending = inference.infer(
        { prompt: 'Write a long paragraph about the sea.' },
        (chunk) => {
          deltas.push(chunk)
          controller.abort()
        },
        controller.signal,
      )

      await expect(pending).rejects.toThrow('inference aborted')
      const atAbort = deltas.length
      await Bun.sleep(500)
      expect(deltas.length).toBe(atAbort)
      expect(atAbort).toBe(1)
    },
    CALL_MS,
  )
})

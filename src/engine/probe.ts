// REALM: worker
/**
 * The endpoint probe (ARCHITECTURE.md §6.2). It exists because the **main
 * realm cannot fetch** — `client` and `ui` may not import `adapters`, and
 * DESIGN §4.1's Door is built entirely on a probe result — and because §6.6
 * gives it the one precondition that is nothing but `ready`: no session, no
 * config, no store. That is what makes it the second message this protocol can
 * honestly carry at 3.2.
 *
 * It reads the endpoint's model list, which is the same `GET {baseUrl}/models`
 * every OpenAI-compatible server answers — omlx, LM Studio, vLLM, llama.cpp
 * and api.openai.com differ only in `baseUrl` (`core/inference/openai.ts`).
 * §6.2's payload also carries a `kind`; it is not here, because this build has
 * exactly one HTTP transport, so branching on it would be a knob with one
 * caller and a field nobody reads. It arrives with the second wire kind.
 *
 * **The deadline reports, it does not pretend to cancel** (§6.5): it drives
 * `AbortController.abort()` on the real `fetch`, which is real cancellation,
 * and the outcome says the endpoint did not answer in time rather than
 * claiming the request was stopped by a `Promise.race` that stopped nothing.
 *
 * `self.setTimeout` and not bare `setTimeout`: §3.4's `src/engine/**` allowlist
 * is closed and does not name the timer functions, and extending an
 * architectural allowlist is not this increment's to do. `self` is on the list,
 * the member access is not a realm question, and the timer is the same timer.
 */

import type { ProbeResult } from '@/protocol/shapes'

/** How long an endpoint gets to answer before the outcome is `timeout`. */
const PROBE_DEADLINE_MS = 5_000

/** The path every OpenAI-compatible server answers a model list on. */
const MODELS_PATH = 'models'

/**
 * Ask an endpoint what it is. Throws only when `baseUrl` is not a URL at all —
 * `engine/host.ts` catches that and replies `failed` with the URL parser's own
 * words, because "you typed something that is not an address" is a request
 * that could not be served, not a connection outcome.
 */
export async function probe(baseUrl: string, apiKey?: string): Promise<ProbeResult> {
  const url = new URL(MODELS_PATH, `${baseUrl.replace(/\/+$/, '')}/`)
  const controller = new AbortController()
  const timer = self.setTimeout(() => controller.abort(), PROBE_DEADLINE_MS)
  const started = Date.now()
  try {
    const response = await fetch(url, { headers: authorization(apiKey), signal: controller.signal })
    const body = await response.text()
    const elapsedMs = Date.now() - started
    if (!response.ok) {
      return { outcome: 'http', models: [], elapsedMs, detail: `${url.href} answered ${response.status} ${response.statusText}` }
    }
    const models = modelsIn(body)
    return { outcome: 'ok', models, elapsedMs, detail: `${url.href} answered ${response.status} with ${models.length} model(s)` }
  } catch (error) {
    return failure(url.href, Date.now() - started, controller.signal.aborted, error)
  } finally {
    self.clearTimeout(timer)
  }
}

/** The key never leaves the worker realm (§7.2); this is the only place it is spelled. */
function authorization(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

/**
 * A `fetch` that threw. The deadline is distinguishable because we set it; a
 * connection refused and a CORS block are **not** distinguishable here, which
 * is why `ProbeOutcome` has no `refused` and the detail says what was seen
 * rather than why (`protocol/shapes.ts`).
 */
function failure(href: string, elapsedMs: number, aborted: boolean, error: unknown): ProbeResult {
  if (aborted) {
    return { outcome: 'timeout', models: [], elapsedMs, detail: `${href} did not answer in ${PROBE_DEADLINE_MS / 1000}s` }
  }
  const reason = error instanceof Error ? error.message : String(error)
  return { outcome: 'unreachable', models: [], elapsedMs, detail: `${href} could not be reached: ${reason}` }
}

/**
 * The `{ data: [{ id }] }` list, defensively. A 200 whose body is not that is
 * still a 200 — the outcome stays `ok` and the model list is empty, because
 * inventing an outcome for "answered, but not in a shape I know" would be a
 * fifth state nothing renders.
 */
function modelsIn(body: string): readonly string[] {
  try {
    const parsed = JSON.parse(body) as { data?: { id?: unknown }[] }
    return (parsed.data ?? []).map((entry) => String(entry.id)).filter((id) => id !== 'undefined')
  } catch {
    return []
  }
}

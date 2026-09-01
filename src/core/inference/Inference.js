import { Failure, Outcome, Reason } from '../Outcome.js'

/**
 * Abstract inference client. One subclass per wire protocol.
 *
 * `invoke(prompt, multimodal)` takes one already-assembled prompt string and
 * returns an `Outcome` carrying the model's text. It never throws: a model
 * endpoint is the least reliable thing this app touches, and a caller must be
 * able to react to that in the ordinary flow rather than around it.
 *
 * Conversation history is the caller's job — the Engine renders it into the
 * prompt — which is what keeps this class a transport and nothing more.
 *
 * Lives in `core/` and performs I/O. That is deliberate: the rule this tree
 * keeps is that core is *realm-agnostic*, not that it is side-effect free.
 * `fetch` exists in the page and the worker alike, so this code runs unchanged
 * in both. DOM and storage are what core may not touch.
 */
export class Inference {
  /**
   * Stable name for messages. NOT `constructor.name`: the production bundle
   * renames classes, so a message built from it is unreliable in exactly the
   * build where a user would be reading it.
   */
  static LABEL = 'inference'

  constructor({
    model = '',
    baseUrl = '',
    apiKey = '',
    temperature = 0.7,
    maxTokens = 4096,
    timeout = 300_000,
  } = {}) {
    this.model = model
    this.baseUrl = String(baseUrl).replace(/\/+$/, '')
    this.apiKey = apiKey
    this.temperature = temperature
    this.maxTokens = maxTokens
    this.timeout = timeout
  }

  /**
   * @param {string} _prompt
   * @param {import('./Multimodality.js').Multimodality[]} [_multimodal]
   * @returns {Promise<Outcome>} an Outcome whose value is the model's text
   */
  async invoke(_prompt, _multimodal = [], _options = {}) {
    return Outcome.failed(
      Reason.NOT_IMPLEMENTED,
      `${this.constructor.LABEL} does not implement invoke()`,
      { hint: 'Choose a different model kind in settings.' },
    )
  }

  /**
   * Same call, delivered as it is produced.
   *
   * Default: run `invoke` and emit the whole answer as one chunk. A subclass
   * that cannot stream is therefore still correct here — the caller sees one
   * large delta instead of many small ones and needs no branch of its own. That
   * is the point: streaming is a difference in *timing*, never in result, so
   * nothing downstream may depend on chunks arriving.
   *
   * @param {string} prompt
   * @param {object[]} multimodal
   * @param {{onDelta?: (chunk: string, kind: 'text'|'reasoning') => void,
   *   onUsage?: (usage: object) => void, cacheAt?: number}} options
   * @returns {Promise<Outcome>} value is the complete text, same as `invoke`
   */
  async stream(prompt, multimodal = [], { onDelta, ...rest } = {}) {
    const answered = await this.invoke(prompt, multimodal, rest)
    if (answered.ok && answered.value) onDelta?.(answered.value, 'text')
    return answered.ok
      ? answered.withNote(`${this.constructor.LABEL} does not stream; the reply arrived at once`)
      : answered
  }

  /**
   * What the call actually cost, in the only tokenizer whose opinion counts.
   *
   * Reported rather than returned, because it is accounting and not the answer:
   * a caller that does not care does not have to unwrap it, and a transport
   * that cannot report it simply never calls this.
   *
   * `cached` is the part of the prompt the provider reused. It is the one
   * number that says whether the prompt's arrangement is working — everything
   * else about caching is inference from theory.
   *
   * `latency` is present only when the endpoint sent some. Every duration in
   * this repository until now was an assertion; these are the endpoint's own
   * numbers about the call that just happened, and they were arriving in the
   * usage frame and being discarded one line above here.
   *
   * It shipped once with nowhere to go. `grep -rn latency src/` matched only the
   * three lines that PRODUCE it — `Budget.measure` reads `prompt` and
   * `completion`, and the page rendered `prompt` and `cached` — so a field the
   * comment called the first measured timing in this application was collected,
   * serialised across `EventName.USAGE`, and dropped. That is the exact
   * declared-but-never-read defect this tree keeps rebuilding to escape, and the
   * fix was not to delete it: `page.jsx` now prints the generation rate beside
   * the token counts, which is where somebody can act on it.
   */
  static _usage(raw) {
    if (!raw) return null
    const prompt = raw.prompt_tokens ?? raw.input_tokens ?? 0
    const usage = {
      prompt,
      completion: raw.completion_tokens ?? raw.output_tokens ?? 0,
      cached:
        raw.prompt_tokens_details?.cached_tokens ??
        raw.cache_read_input_tokens ??
        raw.cached_tokens ??
        0,
      written: raw.cache_creation_input_tokens ?? 0,
    }
    const latency = Inference._latency(raw)
    if (latency) usage.latency = latency
    return usage
  }

  /**
   * How long the endpoint says it took, in seconds and tokens per second.
   *
   * Absent keys are LEFT OUT rather than defaulted to zero, and the whole
   * object is omitted when a provider reports none. A zero here would read as
   * "measured, and instant", which is the exact confusion between an estimate
   * and a measurement that this tree keeps being rebuilt to escape — and it
   * would be indistinguishable from the truth on a fast local model.
   *
   * Sent by the testbed endpoint in the usage frame, which arrives only when
   * `stream_options: {include_usage: true}` was asked for. The non-streaming
   * reply carries `total_time` alone, so a call that reports one field and a
   * call that reports six are both normal and neither is an error.
   */
  static _latency(raw) {
    // NOT called `seconds`. Two of the six fields below are rates, and a
    // validator named for the unit of the other four is a lie in a file whose
    // whole subject is the difference between a measurement and an assertion.
    const positiveNumber = (value) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
    const measured = {
      firstToken: positiveNumber(raw.time_to_first_token),
      prefill: positiveNumber(raw.prompt_eval_duration),
      generation: positiveNumber(raw.generation_duration),
      total: positiveNumber(raw.total_time),
      prefillRate: positiveNumber(raw.prompt_tokens_per_second),
      generationRate: positiveNumber(raw.generation_tokens_per_second),
    }
    const kept = Object.entries(measured).filter(([, value]) => value !== null)
    return kept.length ? Object.fromEntries(kept) : null
  }

  /** Release anything held open. Override where there is something to close. */
  async close() {}

  /**
   * Two reasons to abort the same request, and fetch takes one signal.
   *
   * The deadline is this class's own; `stop` is the user's, and it arrives from
   * a button on a page, through the protocol, through the loop, to here. They
   * mean opposite things to whoever reads the failure — one is an endpoint that
   * went quiet, the other is something somebody chose — so they are combined
   * for fetch and told apart in the catch.
   *
   * TAKES THE CONTROLLER RATHER THAN ITS SIGNAL, because of what happens on a
   * browser without `AbortSignal.any`. That method is recent — Chrome 116,
   * Safari 17.4, Firefox 124 — and `Kernel.handle` makes a controller for EVERY
   * call, so `stop` is always truthy and this branch is always taken. Shipped
   * bare, an older browser therefore lost not its stop button but every turn,
   * with `AbortSignal.any is not a function` wearing the hint that says to check
   * whether your server sends CORS headers. Measured, by deleting the method.
   *
   * The fallback forwards one abort into the other, which needs the controller.
   * It is a listener per call on a signal that lives for one call, so nothing
   * accumulates; and `stop.aborted` still reads true in the catch either way,
   * which is what keeps a stopped call from being reported as a dead endpoint.
   */
  static _either(stop, controller) {
    if (!stop) return controller.signal
    if (typeof AbortSignal.any === 'function') return AbortSignal.any([stop, controller.signal])
    if (stop.aborted) controller.abort()
    else stop.addEventListener('abort', () => controller.abort(), { once: true })
    return controller.signal
  }

  /**
   * POST JSON with a deadline, reporting every failure as an Outcome.
   *
   * fetch has no timeout of its own, so a server that accepts a connection and
   * then says nothing would hang the turn for ever. An abort is the only thing
   * that ends that, and it is reported as a timeout rather than as the generic
   * abort the browser raises.
   */
  async _postJson(url, headers, body, stop) {
    const label = this.constructor.LABEL
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(), this.timeout)

    let response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: Inference._either(stop, controller),
      })
    } catch (err) {
      if (err?.name === 'AbortError') {
        // Asked before the timeout is reported, because a stopped call is not a
        // broken endpoint and telling a user their server is unreachable when
        // they pressed stop is the kind of lie this tree exists to stop telling.
        if (stop?.aborted) {
          return Outcome.failed(Reason.UNAVAILABLE, `${label}: the call was stopped`, {
            hint: 'You ended this run.',
          })
        }
        return Outcome.failed(Reason.UNAVAILABLE, `${label}: no answer within ${this.timeout}ms`, {
          hint: 'The endpoint accepted the connection but sent nothing. Check the server, or raise the timeout.',
        })
      }
      // A cross-origin refusal reaches script as an opaque TypeError with no
      // detail, so the likely causes are named rather than surfacing the bare
      // "Failed to fetch" the browser gives us.
      return Outcome.failed(Reason.UNAVAILABLE, `${label}: ${err?.message ?? String(err)}`, {
        hint: `Could not reach ${url}. Check the base URL, that the server is running, and that it sends CORS headers.`,
      })
    } finally {
      clearTimeout(deadline)
    }

    if (!response.ok) {
      const detail = await response
        .text()
        .then((t) => t.slice(0, 500))
        .catch(() => '')
      return Outcome.failed(Reason.UNAVAILABLE, `${label}: HTTP ${response.status} ${detail}`, {
        hint:
          response.status === 401 || response.status === 403
            ? 'The endpoint rejected the API key.'
            : 'The endpoint answered, but not with a result.',
      })
    }

    // A 200 carrying malformed JSON is rarer than a bad URL and far more
    // confusing, so it gets its own message rather than a parse stack.
    return Outcome.attempt(() => response.json(), {
      code: Reason.UNAVAILABLE,
      hint: `${label}: the endpoint answered with something that is not JSON.`,
    })
  }

  /**
   * POST and read a server-sent-event stream, handing each parsed payload to
   * `onEvent`.
   *
   * Streaming trades one guarantee away: an error can arrive *after* a 200,
   * mid-body, once some text has already been shown. So a failure here reports
   * what was received before it broke — throwing that away would leave the user
   * with a blank turn and no idea how far it got.
   *
   * The deadline is a gap timer, not a total one. A long answer is not a stuck
   * connection, and a total timeout would kill exactly the slow honest replies
   * streaming exists to make bearable.
   *
   * @returns {Promise<Outcome>} value is `{ text }`, the accumulated result
   */
  async _postStream(url, headers, body, onEvent, stop) {
    const label = this.constructor.LABEL
    const controller = new AbortController()
    let idle = null
    const restartDeadline = () => {
      clearTimeout(idle)
      idle = setTimeout(() => controller.abort(), this.timeout)
    }
    restartDeadline()

    let response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...headers },
        body: JSON.stringify(body),
        signal: Inference._either(stop, controller),
      })
    } catch (err) {
      clearTimeout(idle)
      if (err?.name === 'AbortError') {
        if (stop?.aborted) {
          return Outcome.failed(Reason.UNAVAILABLE, `${label}: the call was stopped`, {
            hint: 'You ended this run.',
          })
        }
        return Outcome.failed(Reason.UNAVAILABLE, `${label}: no answer within ${this.timeout}ms`, {
          hint: 'The endpoint accepted the connection but sent nothing.',
        })
      }
      return Outcome.failed(Reason.UNAVAILABLE, `${label}: ${err?.message ?? String(err)}`, {
        hint: `Could not reach ${url}. Check the base URL, that the server is running, and that it sends CORS headers.`,
      })
    }

    if (!response.ok || !response.body) {
      clearTimeout(idle)
      const detail = await response
        .text()
        .then((t) => t.slice(0, 500))
        .catch(() => '')
      return Outcome.failed(Reason.UNAVAILABLE, `${label}: HTTP ${response.status} ${detail}`, {
        hint: response.body
          ? 'The endpoint answered, but not with a result.'
          : 'The endpoint answered without a readable body, so it cannot be streamed.',
      })
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''

    // Chunk boundaries fall wherever the network puts them, so a frame can be
    // split mid-line and even mid-character. `buffer` holds the incomplete tail
    // and the decoder is told the stream continues; parsing a partial frame
    // would silently drop tokens.
    const drain = (flush) => {
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = flush ? '' : (frames.pop() ?? '')
      for (const frame of frames) {
        for (const line of frame.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          // The end marker is a literal, not JSON, and parsing it would look
          // like a malformed frame.
          if (!payload || payload === '[DONE]') continue
          let parsed
          try {
            parsed = JSON.parse(payload)
          } catch {
            // One unreadable frame is not a failed turn: skip it and keep
            // reading. Ending here would discard everything still to come.
            continue
          }
          const piece = onEvent(parsed)
          if (piece) text += piece
        }
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        restartDeadline()
        buffer += decoder.decode(value, { stream: true })
        drain(false)
      }
      buffer += decoder.decode()
      drain(true)
    } catch (err) {
      const aborted = err?.name === 'AbortError'
      const stopped = aborted && stop?.aborted
      return new Outcome(
        false,
        // The value survives the failure on purpose: a partial answer is worth
        // more than a blank turn, and the caller decides whether to keep it.
        // That matters most here: a stopped stream is exactly the case where
        // what already arrived is the whole of what the user gets.
        { text },
        new Failure(
          Reason.UNAVAILABLE,
          stopped
            ? `${label}: the stream was stopped`
            : aborted
              ? `${label}: the stream went quiet for ${this.timeout}ms`
              : `${label}: the stream broke — ${err?.message ?? String(err)}`,
          text ? 'Part of the reply arrived before the connection failed.' : '',
        ),
      )
    } finally {
      clearTimeout(idle)
      reader.cancel().catch(() => {})
    }

    return Outcome.ok({ text })
  }
}

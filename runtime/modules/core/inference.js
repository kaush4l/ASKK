/**
 * LLM inference — one shape, several providers.
 *
 *     const llm = inference({provider: 'openai', model, baseUrl}, {fetch})
 *     for await (const delta of llm.stream(messages, {signal})) ...   // text/reasoning deltas
 *     stream(messages, {nativeTools}) also emits unexecuted tool_fragment and completed tool_call
 *     await llm.models()                                              // [{id, contextLength}]
 *
 * Port of the skeleton's `core/inference.py`. Providers implement `deltas()` and never think
 * about retries: `stream()` retries with backoff while nothing has been said yet, because a
 * call that fails before its first delta is usually the endpoint. Once a delta is out it has
 * been shown, and retrying would repeat it.
 *
 * Providers:
 *   openai     any OpenAI-compatible /chat/completions — LM Studio, Ollama, vLLM, OpenRouter, OpenAI
 *   anthropic  /v1/messages, with the header that allows a browser to call it
 *   cli        a model CLI on the owner's machine (claude, codex, gemini) run by the host bridge
 *   scripted   canned replies, for tests and for trying the page without a model
 *
 * `base_url` overrides where openai and anthropic send: a proxy, a gateway, OpenRouter, Azure,
 * a local server. Either may be written with or without its version suffix. `headers` adds
 * fixed headers to every request (an OpenRouter referer, an Azure `api-key`).
 *
 * `via: 'bridge'` sends a provider's requests through the host bridge, for servers that do not
 * answer CORS. Each provider sends only its own headers: Gemini's OpenAI endpoint refuses a
 * preflight that lists headers it does not know.
 */

import { snapshot } from './prompt.js'
import { schemaResponseFormat } from './responses.js'
import { validateNativeTools, nativeToolAccumulator } from './native-tools.js'

import { modelRelayIssue } from './model-relay.js'

export const DEFAULT_CONTEXT = 32768

export class InferenceError extends Error {
  constructor(message, code = 'provider_error', metadata = null) {
    super(message)
    this.code = code
    this.metadata = metadata
  }
}

/** Model transport authority is distinct from tool or native execution authority. */
export function assertModelRelay(host) {
  const issue = modelRelayIssue(host)
  if (issue) throw new InferenceError(issue.message, issue.code)
}

/** Prefer the authenticated scoped route; older companions retain their legacy transport. */
export function modelRelayPath(host) {
  assertModelRelay(host)
  return host.modelRelay ? '/model/fetch' : '/fetch'
}

/**
 * Build the inference a settings object asks for. `onRetry(attempt, error)` is told about each
 * failed attempt, so the thread can say "retrying" instead of looking stuck.
 */
export function inference(settings = {}, { fetch: fetcher = globalThis.fetch?.bind(globalThis), bridge = null, bridgeURL = null, pageURL = globalThis.location?.href, run = null, onRetry } = {}) {
  const provider = PROVIDERS[settings.provider ?? 'openai']
  if (!provider) throw new InferenceError(`unknown provider "${settings.provider}"; known: ${Object.keys(PROVIDERS).join(', ')}`)
  const send = settings.via === 'bridge' ? bridge ?? (async () => { throw new InferenceError('The selected model relay is disconnected. Reconnect it before requesting inference.', 'relay_unavailable') }) : fetcher
  const self = {
    settings,
    model: settings.model || settings.alias || settings.command || '',
    retries: Math.max(1, Math.min(5, Number(settings.retries) || 3)),
    retryDelay: settings.retryDelay ?? 1000,

    stream(messages, { signal, onRequest, onFinish, maxOutputTokens, strictCompletion = false, responseSchema, nativeTools } = {}) {
      // Capture descriptors before the lazy iterator starts, including nested parameter schemas.
      nativeTools = nativeTools === undefined ? undefined : snapshot(nativeTools)
      return (async function* () {
        if (nativeTools !== undefined) validateNativeTools(nativeTools, settings, (message, code) => { throw new InferenceError(message, code) })
        if (signal?.aborted) throw new InferenceError('Model request cancelled.', 'aborted')
        if (settings.requestParams != null && (typeof settings.requestParams !== 'object' || Array.isArray(settings.requestParams))) throw new InferenceError('request_params must be an object', 'configuration')
        if (settings.structuredOutput !== undefined && (settings.structuredOutput !== 'json_schema' || (settings.provider ?? 'openai') !== 'openai')) throw new InferenceError('structured_output json_schema requires an OpenAI-compatible endpoint', 'configuration')
        if (settings.structuredOutput && Object.hasOwn(settings.requestParams ?? {}, 'response_format')) throw new InferenceError('structured_output conflicts with request_params.response_format', 'configuration')
        if (settings.structuredOutput && !responseSchema) throw new InferenceError('The agent did not supply a response schema for this request', 'configuration')
        let last
        const frozenMessages = snapshot(messages)
        // Scripted cursors intentionally remain stateful; provider configuration does not.
        const requestSettings = settings.provider === 'scripted' ? settings : { ...settings, ...(settings.structuredOutput ? { requestParams: { ...settings.requestParams, response_format: schemaResponseFormat(snapshot(responseSchema)) } } : {}), headers: { ...settings.headers }, ...(maxOutputTokens != null ? { maxOutputTokens } : {}) }
        for (let attempt = 0; attempt < self.retries; attempt += 1) {
          let spoken = false
          // Character counts are UTF-16 string lengths, never estimates of token usage.
          // Retain no reasoning and at most 512 characters of response content.
          let reasoningChars = 0
          let contentChars = 0
          let contentSuffix = ''
          let completion = null
          const recordCompletion = (metadata) => {
            const truncated = ['length', 'max_tokens', 'missing'].includes(metadata.finishReason)
            completion = snapshot({ ...metadata, diagnostics: { reasoningChars, contentChars, ...(truncated ? { contentSuffix } : {}) } })
            onFinish?.(completion)
          }
          try {
            const trackedFetch = async (url, init) => {
              onRequest?.(snapshot({ provider: settings.provider ?? 'openai', transportAttempt: attempt + 1, url: redactedURL(url), method: init.method, headers: redactedHeaders(init.headers), body: JSON.parse(init.body) }))
              return send(url, init)
            }
            const trackedRun = run && (async (body, options) => {
              onRequest?.(snapshot({ provider: 'cli', transportAttempt: attempt + 1, body }))
              return run(body, options)
            })
            for await (const delta of provider.deltas(requestSettings, frozenMessages, { fetch: trackedFetch, run: trackedRun, signal, onFinish: recordCompletion, strictCompletion, nativeTools })) {
              if (signal?.aborted) throw new InferenceError('Model request cancelled.', 'aborted')
              spoken = true
              if (delta.kind === 'reasoning') reasoningChars += delta.text.length
              else if (delta.kind === 'text') {
                contentChars += delta.text.length
                contentSuffix = (contentSuffix + delta.text).slice(-512)
              }
              yield delta
            }
            return
          } catch (error) {
            if (signal?.aborted) throw new InferenceError('Model request cancelled.', 'aborted')
            const transientHTTP = error.code === 'provider_http' && (error.metadata?.status === 429 || error.metadata?.status >= 500)
            if (error instanceof InferenceError && !transientHTTP) {
              if (!completion && (error.code === 'truncated' || (nativeTools !== undefined && spoken))) recordCompletion({ finishReason: 'missing', usage: null })
              if (completion) error.metadata = error.metadata?.rejectedNativeReply ? { ...error.metadata, ...completion } : completion
              throw error
            }
            last = unreadable(error, settings, { pageURL, bridgeURL })
            if (spoken) {
              if (!completion) recordCompletion({ finishReason: 'missing', usage: null })
              throw new InferenceError(`${self.model} stopped mid-reply: ${error.message}`, 'truncated', completion)
            }
            if (attempt + 1 < self.retries) {
              onRetry?.(attempt + 1, error)
              await sleep(self.retryDelay * 2 ** attempt, signal)
            }
          }
        }
        throw new InferenceError(`${self.model || settings.provider} did not answer after ${self.retries} tries: ${last?.message ?? last}`, last?.code ?? 'provider_error', last?.metadata)
      })()
    },

    async invoke(messages, options) {
      let text = ''
      for await (const delta of self.stream(messages, options)) if (delta.kind === 'text') text += delta.text
      return text
    },

    async models({ signal } = {}) {
      if (signal?.aborted) throw new InferenceError('Model request cancelled.', 'aborted')
      try { return provider.models ? await provider.models(settings, { fetch: send, run, signal }) : [] }
      catch (error) { throw unreadable(error, settings, { pageURL, bridgeURL }) }
    },

    /** Configured wins; otherwise ask the provider; otherwise a default. */
    async context({ signal } = {}) {
      if (settings.contextLength) return Number(settings.contextLength)
      try {
        const listed = await self.models({ signal })
        const found = listed.find((model) => model.id === settings.model)
        if (found?.contextLength) return (settings.contextLength = found.contextLength)
      } catch {
        // The models endpoint is a convenience; its absence is not an error.
      }
      return (settings.contextLength = DEFAULT_CONTEXT)
    },
  }
  return self
}

/**
 * Fetch TypeError does not reveal whether network, browser policy, or the server refused it.
 * Name the actual selected route and context; do not diagnose server availability from it.
 */
function unreadable(error, settings, { pageURL, bridgeURL } = {}) {
  if (!(error instanceof TypeError) || !/fetch|load failed|network/i.test(error.message)) return error
  const parse = value => { try { return new URL(value) } catch { return null } }
  const page = parse(pageURL)
  const relayed = settings.via === 'bridge' || settings.provider === 'cli'
  const target = parse(relayed ? bridgeURL : settings.baseUrl)
  const label = target ? `${target.origin}${target.pathname}` : relayed ? 'the configured companion relay' : 'the configured model endpoint'
  const route = relayed ? `the configured companion relay (${label})` : label
  const origin = page && page.origin !== 'null' ? ` from page origin ${page.origin}` : ''
  const reasons = relayed
    ? 'Check the companion connection, trusted HTTPS certificate, and allowed page origin. The model request is routed through the companion.'
    : 'Possible causes include network reachability, CORS, or an authentication/error response without CORS headers.'
  const loopback = target && (/^127\./.test(target.hostname) || ['localhost', '[::1]'].includes(target.hostname) || target.hostname.endsWith('.localhost'))
  const browserPolicy = loopback && page && page.origin !== target.origin
    ? ` A browser-to-loopback request can also require local-network permission.${page.protocol === 'https:' && target.protocol === 'http:' ? ' This HTTPS page is calling HTTP loopback; mixed-content protection may block that route. Check the browser console and use a trusted HTTPS companion relay when required.' : ''}`
    : ''
  return new InferenceError(`The browser could not read a reply from ${route}${origin}. ${reasons}${browserPolicy} This failure does not establish that the model server is offline.`, 'browser_unreadable')
}

/** Rough token count — four characters to a token, no tokenizer to load. */
export function tokens(text) {
  return Math.ceil(String(text ?? '').length / 4)
}

const CONTEXT_KEYS = ['context_length', 'max_context_length', 'max_model_len', 'context_window', 'loaded_context_length']

const openai = {
  async *deltas(settings, messages, { fetch, signal, onFinish, strictCompletion, nativeTools }) {
    const base = openaiBase(settings)
    const headers = { 'content-type': 'application/json', ...extraHeaders(settings) }
    if (settings.apiKey) headers.authorization = `Bearer ${settings.apiKey}`
    const extras = settings.requestParams ?? {}
    if (!extras || typeof extras !== 'object' || Array.isArray(extras)) throw new InferenceError('request_params must be an object', 'configuration')
    const reserved = ['model', 'messages', 'stream', 'stream_options', 'max_tokens', 'max_completion_tokens', 'temperature']
    if (reserved.some(key => Object.hasOwn(extras, key))) throw new InferenceError('request_params cannot override model, messages, streaming or configured token/temperature limits', 'configuration')
    const body = { ...extras, model: settings.model, messages, stream: true, stream_options: { include_usage: true } }
    const native = nativeTools !== undefined
    const calls = native ? nativeToolAccumulator(nativeTools, (message, metadata) => { throw new InferenceError(message, 'provider_response', metadata) }) : null
    if (nativeTools?.length) Object.assign(body, { tools: nativeTools, parallel_tool_calls: false, tool_choice: 'auto' })
    if (settings.temperature != null) body.temperature = Number(settings.temperature)
    if (settings.maxOutputTokens != null) body.max_tokens = Number(settings.maxOutputTokens)
    const response = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal })
    await ok(response)
    let finishReason = null
    let usage = null
    let ended = false
    let nativeText = ''
    for await (const data of sse(response.body, { signal })) {
      if (data === '[DONE]') { ended = true; break }
      const event = json(data)
      if (native && (!event || typeof event !== 'object' || Array.isArray(event))) throw new InferenceError('Invalid native streaming event', 'provider_response')
      if (event?.error) throw new Error(event.error.message ?? JSON.stringify(event.error))
      if (event?.usage) usage = event.usage
      if (event?.choices?.[0]?.finish_reason) finishReason = event.choices[0].finish_reason
      const delta = event?.choices?.[0]?.delta ?? {}
      if (native && delta.tool_calls !== undefined) {
        if (!Array.isArray(delta.tool_calls)) throw new InferenceError('Native tool_calls must be an array', 'provider_response')
        for (const fragment of delta.tool_calls) {
          yield { kind: 'tool_fragment', fragment: snapshot(fragment) }
          calls.add(fragment)
        }
      }
      const reasoning = delta.reasoning_content ?? delta.reasoning
      if (reasoning) yield { text: String(reasoning), kind: 'reasoning' }
      if (delta.content) {
        if (native) nativeText += String(delta.content)
        yield { text: String(delta.content), kind: 'text' }
      }
    }
    if (native) {
      const metadata = { finishReason: !ended || !finishReason ? 'missing' : finishReason, usage }
      if (metadata.finishReason !== 'tool_calls') complete(metadata, onFinish)
      else onFinish?.(snapshot(metadata))
      if (calls.size && metadata.finishReason !== 'tool_calls') throw new InferenceError('Native tool calls require tool_calls finish reason', 'provider_response')
      if (!calls.size && metadata.finishReason !== 'stop') throw new InferenceError('Native final text requires stop finish reason', 'provider_response')
      let call
      try { call = calls.finish() } catch (error) {
        if (ended && finishReason === 'tool_calls' && error.metadata?.rejectedNativeCall) {
          error.metadata = { transportComplete: true, rejectedNativeReply: { text: nativeText, call: error.metadata.rejectedNativeCall } }
        }
        throw error
      }
      if (call) yield { kind: 'tool_call', call }
    } else complete({ finishReason: strictCompletion && (!ended || !finishReason) ? 'missing' : finishReason ?? (ended ? 'stop' : 'missing'), usage }, onFinish)
  },
  async models(settings, { fetch, signal }) {
    const base = openaiBase(settings)
    const headers = { ...extraHeaders(settings), ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}) }
    const response = await fetch(`${base}/models`, { headers, signal })
    await ok(response)
    const listed = await response.json()
    const rows = listed.data ?? listed.models
    if (!Array.isArray(rows)) throw new InferenceError('The provider returned an invalid model list.', 'provider_response')
    return rows.map((model) => ({
      id: model.id ?? model.name,
      contextLength: CONTEXT_KEYS.map((key) => model[key]).find(Boolean) ?? null,
    }))
  },
}

const anthropic = {
  async *deltas(settings, messages, { fetch, signal, onFinish, strictCompletion }) {
    const base = anthropicBase(settings)
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n')
    const body = {
      model: settings.model,
      max_tokens: Number(settings.maxOutputTokens ?? 8192),
      system,
      messages: messages.filter((message) => message.role !== 'system'),
      stream: true,
    }
    if (settings.temperature != null) body.temperature = Number(settings.temperature)
    const response = await fetch(`${base}/messages`, { method: 'POST', headers: anthropicHeaders(settings), body: JSON.stringify(body), signal })
    await ok(response)
    let finishReason = null
    let usage = {}
    let ended = false
    for await (const data of sse(response.body, { signal })) {
      const event = json(data)
      if (event?.type === 'error') throw new Error(event.error?.message ?? 'anthropic error')
      if (event?.type === 'message_start' && event.message?.usage) usage = { ...usage, ...event.message.usage }
      if (event?.type === 'message_delta') {
        finishReason = event.delta?.stop_reason ?? finishReason
        usage = { ...usage, ...event.usage }
      }
      if (event?.type === 'message_stop') ended = true
      if (event?.type !== 'content_block_delta') continue
      if (event.delta?.type === 'text_delta') yield { text: event.delta.text, kind: 'text' }
      else if (event.delta?.type === 'thinking_delta') yield { text: event.delta.thinking, kind: 'reasoning' }
    }
    complete({ finishReason: strictCompletion && (!ended || !finishReason) ? 'missing' : finishReason ?? (ended ? 'end_turn' : 'missing'), usage }, onFinish)
  },
  async models(settings, { fetch, signal }) {
    const base = anthropicBase(settings)
    const response = await fetch(`${base}/models`, { headers: anthropicHeaders(settings), signal })
    await ok(response)
    const listed = await response.json()
    if (!Array.isArray(listed.data)) throw new InferenceError('The provider returned an invalid model list.', 'provider_response')
    return listed.data.map((model) => ({ id: model.id, contextLength: null }))
  },
}

/**
 * Where an OpenAI-compatible server lives. `/chat/completions` is appended, so a base written
 * with the endpoint already on it is cut back; a bare host gets `/v1`, which every
 * OpenAI-compatible server serves (Azure and Gemini name their own paths and keep them).
 */
export function openaiBase(settings) {
  const base = trim(settings.baseUrl ?? 'http://127.0.0.1:1234/v1').replace(/\/chat\/completions$/, '')
  return /^https?:\/\/[^/]+$/.test(base) ? `${base}/v1` : base
}

/** Anthropic's base, with or without `/v1` written: `/v1/messages` either way. */
export function anthropicBase(settings) {
  const base = trim(settings.baseUrl ?? 'https://api.anthropic.com').replace(/\/messages$/, '')
  return /\/v1$/.test(base) ? base : `${base}/v1`
}

function extraHeaders(settings) {
  const headers = settings.headers
  return headers && typeof headers === 'object' ? Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)])) : {}
}

function anthropicHeaders(settings) {
  return {
    ...extraHeaders(settings),
    'content-type': 'application/json',
    'x-api-key': settings.apiKey ?? '',
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  }
}

/**
 * A model CLI on the owner's machine, run by the host bridge's `/run`. The prompt goes in on
 * stdin; each preset knows its program's flags and how to read what it prints. The CLI is used
 * as a model and nothing more: its own tools are switched off where the CLI allows it, so the
 * harness's loop, tools and permissions stay the only ones.
 *
 *     {"provider": "cli", "cli": "claude", "model": "sonnet"}
 *     {"provider": "cli", "command": "llm", "args": ["-m", "gpt-5"]}      text on stdout
 */
export const CLI_PRESETS = {
  claude: {
    program: 'claude',
    args: (settings, system) => [
      '-p',
      '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--setting-sources', '',
      ...(system ? ['--system-prompt', system] : []),
      ...(settings.model && settings.model !== 'default' ? ['--model', settings.model] : []),
    ],
    system: 'flag',
    read: 'claude-stream',
    models: ['default', 'sonnet', 'opus', 'haiku'],
  },
  codex: {
    program: 'codex',
    args: (settings) => ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', ...(settings.model && settings.model !== 'default' ? ['--model', settings.model] : []), '-'],
    read: 'text',
    models: ['default'],
  },
  gemini: {
    program: 'gemini',
    args: (settings) => ['--output-format', 'text', ...(settings.model && settings.model !== 'default' ? ['--model', settings.model] : [])],
    read: 'text',
    models: ['default', 'gemini-2.5-pro', 'gemini-2.5-flash'],
  },
}

/** The messages as one text for a CLI's stdin: the system first unless the CLI takes a flag. */
export function cliPrompt(messages, { systemAsFlag = false } = {}) {
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n')
  const rest = messages.filter((message) => message.role !== 'system')
  const body = rest.length === 1 ? String(rest[0].content) : rest.map((message) => `## ${message.role}\n\n${message.content}`).join('\n\n')
  return { system, stdin: systemAsFlag || !system ? body : `${system}\n\n${body}` }
}

const cli = {
  async *deltas(settings, messages, { run, signal, onFinish }) {
    if (!run) throw new Error('a CLI model needs the host bridge: pair it in Settings → Bridge')
    const preset = CLI_PRESETS[settings.cli ?? (settings.command ? '' : 'claude')]
    const program = settings.command ?? preset?.program
    if (!program) throw new Error(`unknown cli "${settings.cli}"; known: ${Object.keys(CLI_PRESETS).join(', ')}, or set command`)
    const { system, stdin } = cliPrompt(messages, { systemAsFlag: !settings.command && preset?.system === 'flag' })
    const args = settings.command ? (settings.args ?? []).map(String) : preset.args(settings, system)
    const response = await run({ program, args, stdin, timeout: settings.timeout ?? 600 }, { signal })
    await ok(response)
    const reader = settings.command ? 'text' : preset.read
    let pending = ''
    let spoke = false
    let stderr = ''
    let completion = { finishReason: 'stop', usage: null }
    for await (const event of ndjson(response.body)) {
      if (event.error) throw new Error(event.error)
      if (event.err) stderr = (stderr + event.err).slice(-2000)
      if (event.code != null) {
        if (reader === 'claude-stream' && pending.trim()) yield* claudeLines(pending, () => (spoke = true))
        if (event.code !== 0 || event.timedOut) throw new InferenceError(`${program} exited ${event.code}${event.timedOut ? ' (timed out)' : ''}: ${stderr.trim().slice(-400) || 'no output'}`)
        complete(completion, onFinish)
        return
      }
      if (event.out == null) continue
      if (reader === 'text') {
        spoke = true
        yield { text: event.out, kind: 'text' }
        continue
      }
      pending += event.out
      const cut = pending.lastIndexOf('\n')
      if (cut === -1) continue
      const whole = pending.slice(0, cut)
      pending = pending.slice(cut + 1)
      for (const delta of claudeLines(whole, () => (spoke = true))) yield delta
    }
    throw new InferenceError(`${program} stream ended without an exit status`, 'truncated')
    function* claudeLines(text, spoken) {
      for (const line of text.split('\n')) {
        const item = json(line)
        if (!item) continue
        if (item.type === 'stream_event' && item.event?.type === 'message_delta') {
          completion = { finishReason: item.event.delta?.stop_reason ?? completion.finishReason, usage: { ...completion.usage, ...item.event.usage } }
        } else if (item.type === 'stream_event' && item.event?.type === 'content_block_delta') {
          const delta = item.event.delta
          if (delta?.type === 'text_delta' && delta.text) {
            spoken()
            yield { text: delta.text, kind: 'text' }
          } else if (delta?.type === 'thinking_delta' && delta.thinking) yield { text: delta.thinking, kind: 'reasoning' }
        } else if (item.type === 'result') {
          if (item.is_error) throw new Error(`claude: ${item.result ?? item.subtype ?? 'error'}`)
          completion = { finishReason: item.stop_reason ?? completion.finishReason, usage: item.usage ?? completion.usage }
          if (!spoke && item.result) {
            spoken()
            yield { text: String(item.result), kind: 'text' }
          }
        }
      }
    }
  },
  async models(settings) {
    const preset = CLI_PRESETS[settings.cli ?? 'claude']
    return (preset?.models ?? [settings.model ?? 'default']).map((id) => ({ id, contextLength: settings.contextLength ?? null }))
  },
}

/**
 * Canned replies for tests and for trying the page without a model. `replies` is taken in turn;
 * a reply may be a function of the messages. Replies may also be keyed by agent name through
 * `script: {main: [...], coder: [...]}` so one catalogue entry scripts a whole team.
 */
const scripted = {
  async *deltas(settings, messages, { signal, onFinish }) {
    const script = settings.script?.[settings.agent] ?? settings.replies ?? ['do: done\n\nact: (scripted model: no reply configured)']
    const key = `cursor:${settings.agent ?? ''}`
    settings[key] = settings[key] ?? 0
    const reply = script[Math.min(settings[key], script.length - 1)]
    settings[key] += 1
    const text = typeof reply === 'function' ? await reply(messages) : String(reply)
    for (let index = 0; index < text.length; index += 24) {
      if (signal?.aborted) throw new Error('aborted')
      if (settings.delay) await sleep(settings.delay, signal)
      yield { text: text.slice(index, index + 24), kind: 'text' }
    }
    complete({ finishReason: 'stop', usage: null }, onFinish)
  },
  async models(settings) {
    return [{ id: settings.model ?? 'scripted', contextLength: settings.contextLength ?? DEFAULT_CONTEXT }]
  },
}

export const PROVIDERS = { openai, anthropic, cli, scripted }

function complete(metadata, onFinish) {
  const record = snapshot(metadata)
  onFinish?.(record)
  if (!['stop', 'end_turn', 'stop_sequence'].includes(metadata.finishReason)) {
    throw new InferenceError(`provider did not complete the reply (${metadata.finishReason})`, ['length', 'max_tokens', 'missing'].includes(metadata.finishReason) ? 'truncated' : 'provider_stopped', record)
  }
}

function redactedHeaders(headers = {}) {
  const visible = new Set(['content-type', 'accept', 'anthropic-version', 'anthropic-dangerous-direct-browser-access'])
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, visible.has(key.toLowerCase()) ? value : '[redacted]']))
}

export function redactedURL(value) {
  const url = new URL(value)
  url.username = ''
  url.password = ''
  for (const key of url.searchParams.keys()) if (/key|token|auth|secret|password/i.test(key)) url.searchParams.set(key, '[redacted]')
  return url.href
}

/** Server-sent events from a byte stream: yields each event's joined `data:` lines. */
export async function* sse(body, { signal } = {}) {
  if (!body) throw new InferenceError('The provider returned no response stream.', 'truncated')
  const reader = body.pipeThrough(new TextDecoderStream()).getReader()
  const abort = () => { reader.cancel(signal.reason).catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      let cut = buffer.search(/\r?\n\r?\n/)
      while (cut !== -1) {
        const data = dataOf(buffer.slice(0, cut))
        buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, '')
        if (data != null) yield data
        cut = buffer.search(/\r?\n\r?\n/)
      }
    }
    const data = dataOf(buffer)
    if (data != null) yield data
  } finally {
    signal?.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** Newline-delimited JSON from a byte stream. */
export async function* ndjson(body) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      let cut = buffer.indexOf('\n')
      while (cut !== -1) {
        const item = json(buffer.slice(0, cut))
        buffer = buffer.slice(cut + 1)
        if (item) yield item
        cut = buffer.indexOf('\n')
      }
    }
    const item = json(buffer)
    if (item) yield item
  } finally {
    reader.releaseLock()
  }
}

function dataOf(raw) {
  const lines = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
  return lines.length ? lines.join('\n') : null
}

async function ok(response) {
  if (response.ok) return
  let detail = ''
  try {
    detail = (await response.text()).slice(0, 300)
  } catch {
    // The body is a courtesy.
  }
  const body = json(detail)
  const relayCodes = { 'bridge.auth': 'relay_auth', 'bridge.origin': 'relay_origin', 'capability.unavailable': 'relay_capability', 'relay.model_scope_required': 'relay_scope', 'relay.model_scope_denied': 'relay_scope', 'relay.model_redirect': 'relay_scope', 'relay.model_scope_invalid': 'relay_scope', 'relay.upstream_unreachable': 'relay_upstream', 'relay.upstream_timeout': 'relay_timeout' }
  const code = relayCodes[body?.code] ?? ([401, 403].includes(response.status) ? 'provider_auth' : 'provider_http')
  throw new InferenceError(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`, code, { status: response.status })
}

function json(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function trim(url) {
  return String(url).replace(/\/+$/, '')
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('aborted'))
      },
      { once: true },
    )
  })
}

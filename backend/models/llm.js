// LLM inference — one call shape, two wire protocols. Called directly from
// the browser; the server must allow CORS.
//
//   await complete({ model, prompt, signal, onDelta })  -> { raw, reasoning, usage }
//   await listModels(model)                             -> [{ id, contextLength }]
//   await contextWindow(model)                          -> number | null
//
// `model` is a connection from the model catalogue (catalog.js):
//   { provider: "openai" | "anthropic", base_url, api_key, id, context_length, max_tokens }
//
// openai     any OpenAI-compatible /chat/completions (oMLX, LM Studio, Ollama,
//            vLLM, llama.cpp, OpenRouter, OpenAI)
// anthropic  any Anthropic-compatible /messages (Anthropic, or a local server
//            that speaks it), with the header that allows browser calls
//
// The prompt is sent whole, as a single user message. onDelta receives
// { content, reasoning } per chunk; `reasoning` is the model's thinking.
// `usage` is { inputTokens, outputTokens, tokensPerSecond? } when the server
// reports it, else null.

const CONTEXT_KEYS = ["context_length", "max_context_length", "max_model_len", "context_window", "max_input_tokens", "loaded_context_length"]

const trim = (url) => String(url ?? "").trim().replace(/\/+$/, "")

// A bare host gets /v1; a URL already ending in the endpoint is cut back.
function openaiBase(model) {
  const base = trim(model.base_url).replace(/\/chat\/completions$/, "")
  return /^https?:\/\/[^/]+$/.test(base) ? `${base}/v1` : base
}

function anthropicBase(model) {
  const base = trim(model.base_url || "https://api.anthropic.com").replace(/\/messages$/, "")
  return /\/v1$/.test(base) ? base : `${base}/v1`
}

const openaiHeaders = (model) => ({
  "content-type": "application/json",
  ...(model.api_key ? { authorization: `Bearer ${model.api_key}` } : {}),
})

const anthropicHeaders = (model) => ({
  "content-type": "application/json",
  "x-api-key": model.api_key ?? "",
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
})

// fetch, with failures that say where the request went.
async function request(url, init) {
  let response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (error.name === "AbortError") throw error
    throw new Error(
      `Could not reach ${new URL(url).origin}. Check that the server is running and allows CORS from this page.`
    )
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300)
    throw new Error(`LLM request failed (${response.status}) ${detail}`.trim())
  }
  return response
}

// Server-sent events: yields each event's joined `data:` payload.
async function* sse(body) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  const dataOf = (block) => {
    const lines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
    return lines.length ? lines.join("\n") : null
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      let cut = buffer.search(/\r?\n\r?\n/)
      while (cut !== -1) {
        const data = dataOf(buffer.slice(0, cut))
        buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, "")
        if (data != null) yield data
        cut = buffer.search(/\r?\n\r?\n/)
      }
    }
    const data = dataOf(buffer)
    if (data != null) yield data
  } finally {
    reader.releaseLock()
  }
}

const parse = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const PROTOCOLS = {
  openai: {
    async stream(model, prompt, { signal, emit }) {
      const response = await request(`${openaiBase(model)}/chat/completions`, {
        method: "POST",
        headers: openaiHeaders(model),
        body: JSON.stringify({
          model: model.id,
          stream: true,
          stream_options: { include_usage: true },
          ...(model.max_tokens ? { max_tokens: Number(model.max_tokens) } : {}),
          messages: [{ role: "user", content: prompt }],
        }),
        signal,
      })
      let usage = null
      for await (const data of sse(response.body)) {
        if (data === "[DONE]") break
        const event = parse(data)
        if (event?.error) throw new Error(event.error.message ?? JSON.stringify(event.error))
        if (event?.usage) {
          usage = {
            inputTokens: event.usage.prompt_tokens ?? event.usage.input_tokens ?? null,
            outputTokens: event.usage.completion_tokens ?? event.usage.output_tokens ?? null,
            // Some local servers (oMLX) report their own measured speed.
            tokensPerSecond: event.usage.generation_tokens_per_second ?? null,
          }
        }
        const delta = event?.choices?.[0]?.delta
        const reasoning = delta?.reasoning_content ?? delta?.reasoning
        if (delta?.content || reasoning) emit(delta.content ?? "", reasoning ?? "")
      }
      return usage
    },

    async models(model, { signal } = {}) {
      const response = await request(`${openaiBase(model)}/models`, { headers: openaiHeaders(model), signal })
      const listed = await response.json()
      return (listed.data ?? listed.models ?? []).map((m) => ({
        id: m.id ?? m.name,
        contextLength: CONTEXT_KEYS.map((key) => m[key]).find(Boolean) ?? null,
      }))
    },
  },

  anthropic: {
    async stream(model, prompt, { signal, emit }) {
      const response = await request(`${anthropicBase(model)}/messages`, {
        method: "POST",
        headers: anthropicHeaders(model),
        body: JSON.stringify({
          model: model.id,
          stream: true,
          max_tokens: Number(model.max_tokens) || 8192,
          messages: [{ role: "user", content: prompt }],
        }),
        signal,
      })
      let usage = null
      for await (const data of sse(response.body)) {
        const event = parse(data)
        if (event?.type === "error") throw new Error(event.error?.message ?? "Anthropic stream error")
        if (event?.type === "message_start" || event?.type === "message_delta") {
          const reported = event.message?.usage ?? event.usage ?? {}
          usage = {
            inputTokens: reported.input_tokens ?? usage?.inputTokens ?? null,
            outputTokens: reported.output_tokens ?? usage?.outputTokens ?? null,
            tokensPerSecond: null,
          }
        }
        if (event?.type !== "content_block_delta") continue
        if (event.delta?.type === "text_delta") emit(event.delta.text, "")
        else if (event.delta?.type === "thinking_delta") emit("", event.delta.thinking)
      }
      return usage
    },

    async models(model, { signal } = {}) {
      const response = await request(`${anthropicBase(model)}/models`, { headers: anthropicHeaders(model), signal })
      const listed = await response.json()
      return (listed.data ?? []).map((m) => ({
        id: m.id,
        contextLength: CONTEXT_KEYS.map((key) => m[key]).find(Boolean) ?? null,
      }))
    },
  },
}

function protocol(model) {
  if (!model) throw new Error("No model connection.")
  const found = PROTOCOLS[model?.provider]
  if (!found) throw new Error(`Unknown provider "${model?.provider}". Use openai or anthropic.`)
  if (!model.id) throw new Error("No model selected. Set one in Settings.")
  return found
}

export async function complete({ model, prompt, signal, onDelta }) {
  let raw = ""
  let reasoning = ""
  const usage = await protocol(model).stream(model, prompt, {
    signal,
    emit: (content, thinking) => {
      raw += content
      reasoning += thinking
      onDelta?.({ content, reasoning: thinking })
    },
  })
  return { raw, reasoning, usage }
}

export function listModels(model, options) {
  const found = PROTOCOLS[model?.provider]
  if (!found) throw new Error(`Unknown provider "${model?.provider}".`)
  return found.models(model, options)
}

// Context window of a model: the configured value, else what the server's
// model list says. Lookups are cached per server; null when unknown.
const windows = new Map()

export async function contextWindow(model) {
  if (Number(model.context_length) > 0) return Number(model.context_length)
  const key = `${model.provider}|${trim(model.base_url)}|${model.api_key ? "key" : ""}`
  if (!windows.has(key)) {
    // A failed lookup is retried next time.
    windows.set(key, listModels(model).catch(() => (windows.delete(key), [])))
  }
  const listed = await windows.get(key)
  return listed.find((m) => m.id === model.id)?.contextLength ?? null
}

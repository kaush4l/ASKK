// The app's REAL model requests, verbatim in shape.
// Loadable as a classic <script> in the page AND via importScripts() in a worker,
// because the app issues these from a nested worker (page -> worker.js -> agentWorker.js).
//
// Shapes copied from:
//   src/core/inference/Inference.js       _postStream()  -> method/headers/body/ReadableStream read
//   src/core/inference/AnthropicCompatible.js stream()   -> x-api-key + anthropic-version +
//                                                           anthropic-dangerous-direct-browser-access
//   src/core/inference/OpenAICompatible.js stream()      -> authorization: Bearer, stream_options

// Endpoints are read at CALL time, never at load time: calls.js is also loaded
// by importScripts() into a nested worker, where a global set on the page would
// not be visible. Defaults are the local testbed this experiment used.
const LOCAL = () => (self.PROBE_LOCAL || "http://127.0.0.1:8873") + "/v1";
const LOCAL_MODEL = () => self.PROBE_LOCAL_MODEL || "Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp";
const ECHO = () => (self.PROBE_ECHO || "http://127.0.0.1:8814") + "/v1/chat/completions";

// Inference._postStream: fetch(url, {method:'POST', headers:{content-type, accept:text/event-stream, ...extra}, body:JSON, signal})
// then response.body.getReader() read to done, TextDecoder({stream:true}), split on blank line, "data:" frames.
async function postStream(url, headers, body, onFrame, timeoutMs) {
  const controller = new AbortController();
  let idle = null;
  const restart = () => { clearTimeout(idle); idle = setTimeout(() => controller.abort(), timeoutMs); };
  restart();
  const t0 = (self.performance || Date).now ? performance.now() : Date.now();

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(idle);
    // This is the branch that matters: a COEP/CORS refusal reaches script as an
    // opaque TypeError. Inference.js turns it into Reason.UNAVAILABLE.
    return { phase: "fetch", arrived: false, err_name: err && err.name, err: String(err && err.message || err) };
  }

  const meta = {
    arrived: true, status: res.status, type: res.type, ok: res.ok,
    has_readable_body: !!res.body,
    ct: res.headers.get("content-type"),
    acao: res.headers.get("access-control-allow-origin"),
    corp: res.headers.get("cross-origin-resource-policy"),
  };
  if (!res.body) { clearTimeout(idle); return { phase: "no-body", ...meta }; }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buffer = "", text = "", bytes = 0, chunks = 0, frames = 0, first_chunk_ms = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      restart();
      chunks++;
      bytes += value.byteLength;
      if (first_chunk_ms === null) first_chunk_ms = Math.round(((self.performance||Date).now ? performance.now() : Date.now()) - t0);
      buffer += dec.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || "";
      for (const frame of parts) {
        for (const line of frame.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          frames++;
          let parsed; try { parsed = JSON.parse(payload); } catch { continue; }
          const piece = onFrame(parsed);
          if (piece) text += piece;
        }
      }
    }
    buffer += dec.decode();
  } catch (err) {
    clearTimeout(idle);
    return { phase: "read", ...meta, stream_broke: true,
             err_name: err && err.name, err: String(err && err.message || err),
             chunks, frames, bytes, text_len: text.length,
             ms: Math.round(((self.performance||Date).now ? performance.now() : Date.now()) - t0) };
  } finally { clearTimeout(idle); try { reader.cancel(); } catch {} }

  return { phase: "complete", ...meta, chunks, frames, bytes, text_len: text.length,
           first_chunk_ms,
           ms: Math.round(((self.performance||Date).now ? performance.now() : Date.now()) - t0),
           text_head: text.slice(0, 90) };
}

// Non-stream body reader, for endpoints that answer an error as plain JSON.
async function bodyOf(url, headers, body, timeoutMs) {
  const r = await postStream(url, headers, body, () => "", timeoutMs);
  return r;
}

self.REAL_CALLS = {
  // 1. api.anthropic.com/v1/messages -- FOUR headers, three of them non-simple,
  //    so this is PREFLIGHTED. No valid key on purpose: a 401 that ARRIVES = pass.
  anthropic: () => postStream(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": "sk-ant-not-a-real-key-deliberately",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true" },
    { model: "claude-3-5-haiku-latest", max_tokens: 64, temperature: 0.7, stream: true,
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] },
    (f) => (f && f.type === "content_block_delta" && f.delta && f.delta.text) || "",
    30000),

  // 2. api.openai.com/v1/chat/completions -- authorization header => PREFLIGHTED.
  openai: () => postStream(
    "https://api.openai.com/v1/chat/completions",
    { authorization: "Bearer sk-not-a-real-key-deliberately" },
    { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }],
      temperature: 0.7, max_tokens: 64, stream: true, stream_options: { include_usage: true } },
    (f) => (f && f.choices && f.choices[0] && f.choices[0].delta && f.choices[0].delta.content) || "",
    30000),


  // 2b. OpenAI-compatible with NO key -- a REAL app configuration
  //     (OpenAICompatible.js: `this.apiKey ? {authorization: ...} : {}`).
  //     Still preflighted (content-type: application/json is not a CORS-safelisted
  //     value), and unlike the invalid-key branch this response DOES carry ACAO,
  //     so it isolates COEP instead of tripping over OpenAI's own CORS quirk.
  openai_noauth: () => postStream(
    "https://api.openai.com/v1/chat/completions",
    {},
    { model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }],
      temperature: 0.7, max_tokens: 64, stream: true, stream_options: { include_usage: true } },
    (f) => (f && f.choices && f.choices[0] && f.choices[0].delta && f.choices[0].delta.content) || "",
    30000),

  // 5. RECORDING ECHO SERVER, cross-origin, ACAO but NO CORP -- same header
  //    profile as api.anthropic.com and the omlx testbed. It logs every request
  //    it receives, so the server itself says whether the OPTIONS preflight
  //    reached the network under each COEP mode.
  echo: () => postStream(
    ECHO(),
    { "x-api-key": "sk-ant-not-a-real-key-deliberately",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true" },
    { model: "echo", max_tokens: 64, stream: true, messages: [{ role: "user", content: "hi" }] },
    (f) => (f && f.choices && f.choices[0] && f.choices[0].delta && f.choices[0].delta.content) || "",
    20000),

  // 3. THE LOCAL TESTBED. No key => Inference omits authorization => only
  //    content-type + accept, but accept:text/event-stream is a non-simple VALUE?
  //    No: content-type application/json IS non-simple, so this preflights too.
  local_short: () => postStream(
    LOCAL() + "/chat/completions",
    {},
    { model: LOCAL_MODEL(), messages: [{ role: "user", content: "Say OK." }],
      temperature: 0.7, max_tokens: 32, stream: true, stream_options: { include_usage: true } },
    (f) => (f && f.choices && f.choices[0] && f.choices[0].delta && f.choices[0].delta.content) || "",
    60000),

  // 4. A LONG STREAM read to the very end.
  local_long: () => postStream(
    LOCAL() + "/chat/completions",
    {},
    { model: LOCAL_MODEL(),
      messages: [{ role: "user", content: "Write a detailed 600-word explanation of how a CPU cache works. Do not stop early." }],
      temperature: 0.7, max_tokens: 800, stream: true, stream_options: { include_usage: true } },
    (f) => (f && f.choices && f.choices[0] && f.choices[0].delta && f.choices[0].delta.content) || "",
    120000),
};

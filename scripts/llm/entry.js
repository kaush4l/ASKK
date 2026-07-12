// Local-LLM worker: in-browser text generation via @huggingface/transformers.
// Runs as a module Web Worker (generation never blocks the UI thread).
//
// Protocol (JSON strings in, plain objects out):
//   in:  {type:"init", mjs, wasm}                       — ONNX runtime URLs
//   in:  {type:"generate", model, messages, max_tokens} — one generation
//   out: {type:"progress", file, pct}                   — model download
//   out: {type:"delta", text}                           — one streamed chunk
//   out: {type:"done", usage:{input_tokens,output_tokens}}
//   out: {type:"error", message}
//
// Model weights stream from the HF hub on first use and land in the browser
// Cache API — never committed. Call shape follows the gemma4-browser-extension
// reference: text-generation pipeline + chat template + TextStreamer,
// device webgpu (dtype q4f16) with a wasm (q4) fallback.
import { pipeline, TextStreamer, env } from "@huggingface/transformers";

// Self-hosted ONNX runtime (no CDN). Dioxus hashes asset filenames, so the
// host passes explicit URLs instead of a directory prefix.
function init(wasmMjsUrl, wasmUrl) {
  env.backends.onnx.wasm.wasmPaths = { mjs: wasmMjsUrl, wasm: wasmUrl };
  if (!globalThis.crossOriginIsolated) {
    env.backends.onnx.wasm.numThreads = 1; // no SharedArrayBuffer without COOP/COEP
  }
}

// Singleton per model id: a second generate on the same model reuses the
// loaded pipeline (weights come from the Cache API, never re-downloaded).
const pipes = new Map();

function load(model) {
  if (pipes.has(model)) return pipes.get(model);
  const opts = (device) => ({
    device,
    dtype: device === "webgpu" ? "q4f16" : "q4",
    progress_callback: (p) => {
      if (p.status === "progress" && p.total) {
        postMessage({
          type: "progress",
          file: p.file || "",
          pct: Math.round((p.loaded / p.total) * 100),
        });
      }
    },
  });
  const promise = (async () => {
    try {
      if (!navigator.gpu) throw new Error("WebGPU unavailable");
      return await pipeline("text-generation", model, opts("webgpu"));
    } catch (e) {
      console.warn(`askk-llm: webgpu failed (${e?.message ?? e}); using wasm`);
      return await pipeline("text-generation", model, opts("wasm"));
    }
  })();
  pipes.set(model, promise);
  promise.catch(() => pipes.delete(model)); // a failed load is not cached
  return promise;
}

async function generate(msg) {
  const pipe = await load(msg.model);
  let outputTokens = 0;
  const streamer = new TextStreamer(pipe.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text) => {
      if (text) postMessage({ type: "delta", text });
    },
    token_callback_function: () => {
      outputTokens += 1;
    },
  });
  const input = pipe.tokenizer.apply_chat_template(msg.messages, {
    add_generation_prompt: true,
    return_dict: true,
  });
  await pipe(msg.messages, {
    max_new_tokens: msg.max_tokens || 1024,
    do_sample: false,
    streamer,
  });
  postMessage({
    type: "done",
    usage: {
      input_tokens: Number(input?.input_ids?.dims?.at(-1) ?? 0),
      output_tokens: outputTokens,
    },
  });
}

self.onmessage = async (e) => {
  const msg = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
  try {
    if (msg.type === "init") init(msg.mjs, msg.wasm);
    else if (msg.type === "generate") await generate(msg);
  } catch (err) {
    postMessage({ type: "error", message: String(err?.message ?? err) });
  }
};

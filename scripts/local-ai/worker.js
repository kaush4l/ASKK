// ASKK local-ai — module Web Worker source.
//
// Built by `bun run build:worker` into assets/local_ai_worker.js with
// --format=esm (never edit the bundle by hand; edit this file and rebuild).
// The main thread loads it with `new Worker(url, { type: "module" })` — see
// entry.js. It runs transformers.js v4 entirely in the browser:
//   - ASR: Whisper via pipeline("automatic-speech-recognition", ...)
//   - LLM: Gemma 4 ONNX via AutoProcessor + Gemma4ForConditionalGeneration
//
// API verified against live sources on 2026-06-10:
//   - https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX
//       model card snippet: AutoProcessor.from_pretrained(id);
//       Gemma4ForConditionalGeneration.from_pretrained(id, { dtype: "q4f16",
//       device: "webgpu" }); processor.apply_chat_template(messages,
//       { enable_thinking: false, add_generation_prompt: true });
//       inputs = await processor(prompt, image, audio, { add_special_tokens:
//       false }); model.generate({ ...inputs, max_new_tokens, streamer });
//       processor.batch_decode(outputs.slice(null,
//       [inputs.input_ids.dims.at(-1), null]), { skip_special_tokens: true }).
//   - https://huggingface.co/onnx-community/whisper-base
//       pipeline('automatic-speech-recognition', 'onnx-community/whisper-base')
//   - https://github.com/huggingface/transformers.js (v4 README: dtype/device
//       pipeline options, env.allowRemoteModels / env.localModelPath /
//       env.backends.onnx.wasm.wasmPaths)
//   - installed package source (node_modules/@huggingface/transformers@4.2.0):
//       src/pipelines/automatic-speech-recognition.js (chunk_length_s,
//       stride_length_s, language, task, return_timestamps options) and
//       src/env.js (allowLocalModels / allowRemoteModels / localModelPath).
//
// ONNX wasm asset strategy (verified in the installed sources):
//   @huggingface/transformers@4.2.0's web build imports
//   "onnxruntime-web/webgpu" -> dist/ort.webgpu.bundle.min.mjs, which inlines
//   the JS side of ort but fetches the .wasm at runtime from
//   env.backends.onnx.wasm.wasmPaths. transformers.js itself defaults that to
//   the jsdelivr CDN pinned to the exact bundled ort version
//   (src/backends/onnx.js: `https://cdn.jsdelivr.net/npm/onnxruntime-web@
//   ${env.versions.web}/dist/` + the right mjs/wasm pair for the platform)
//   whenever wasmPaths is unset and we are not in a ServiceWorker. That logic
//   survives bundling (the version string is baked into ort's JS), so we rely
//   on it. As a belt-and-braces guard we ALSO pin the same CDN directory with
//   the literal version below in case a future bundle drops the default.
//   ORT_WEB_VERSION comes from node_modules/onnxruntime-web/package.json (the
//   exact version @huggingface/transformers@4.2.0 resolves to); both
//   .../ort-wasm-simd-threaded.asyncify.wasm and .../ort-wasm-simd-threaded
//   .jsep.mjs under that prefix returned HTTP 200 + `access-control-allow-
//   origin: *` when checked.
//
// Wire protocol (request -> this worker, structured clone):
//   { id, op: "init", modelBase? }                    -> { id, ok, result: { device } }
//   { id, op: "transcribe", pcm: Float32Array,        -> { id, ok, result: { text, model } }
//     task?, language?, model? }                         (pcm transferred, 16 kHz mono)
//   { id, op: "generate", model?, messages,           -> { id, ok, result: { text, model } }
//     maxTokens?, temperature? }
// Unsolicited events (no reply expected):
//   { event: "progress", file, loaded, total, status }   // model download progress
//   { event: "delta", id, text }                         // streamed generation text
// Every failure replies { id, ok: false, error: String(e) }.
//
// Model output is untrusted DATA for the agent; this worker only produces and
// returns text, never interprets it.

import {
  env,
  pipeline,
  AutoProcessor,
  Gemma4ForConditionalGeneration,
  TextStreamer,
  load_image,
} from "@huggingface/transformers";

const DEFAULT_ASR_MODEL = "onnx-community/whisper-base";
const DEFAULT_LLM_MODEL = "onnx-community/gemma-4-E2B-it-ONNX";

// The exact onnxruntime-web version @huggingface/transformers@4.2.0 depends on
// (read from node_modules/onnxruntime-web/package.json at vendoring time).
const ORT_WEB_VERSION = "1.26.0-dev.20260416-b7804b056c";

// ---------------------------------------------------------------------------
// Environment: same-origin staged models win, HF Hub is the fallback.
// ---------------------------------------------------------------------------
env.allowRemoteModels = true;
// allowLocalModels defaults to false in workers; init() flips it on when the
// host provides a modelBase (same-origin URL serving pre-staged weights).
env.allowLocalModels = false;
// Guard: transformers.js already set wasmPaths to its pinned CDN at import
// time (see header). Only if that ever stops happening, pin the directory
// ourselves so ort resolves its .wasm/.mjs from the matching CDN dist.
if (env.backends?.onnx?.wasm && !env.backends.onnx.wasm.wasmPaths) {
  env.backends.onnx.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_WEB_VERSION}/dist/`;
}

// ---------------------------------------------------------------------------
// Device probe: WebGPU if an adapter is obtainable, else wasm. Cached.
// ---------------------------------------------------------------------------
let devicePromise = null;
function pickDevice() {
  devicePromise ??= (async () => {
    try {
      if (self.navigator?.gpu && (await navigator.gpu.requestAdapter())) {
        return "webgpu";
      }
    } catch {
      // fall through to wasm
    }
    return "wasm";
  })();
  return devicePromise;
}

/** Forward model-download progress to the main thread. */
function forwardProgress(info) {
  self.postMessage({
    event: "progress",
    file: info?.file ?? info?.name ?? "",
    loaded: info?.loaded ?? 0,
    total: info?.total ?? 0,
    status: info?.status ?? "",
  });
}

// ---------------------------------------------------------------------------
// ASR: cached pipeline per model id.
// ---------------------------------------------------------------------------
const asrCache = new Map(); // model id -> Promise<pipeline>

function getAsr(model) {
  if (!asrCache.has(model)) {
    const p = (async () => {
      const device = await pickDevice();
      // dtype: whisper-web convention — on webgpu keep the encoder fp32 (fp16
      // encoders misbehave on some GPUs) and quantize the decoder; on wasm use
      // q8 throughout. (The onnx-community whisper cards only show defaults.)
      const dtype =
        device === "webgpu"
          ? { encoder_model: "fp32", decoder_model_merged: "q4" }
          : "q8";
      return pipeline("automatic-speech-recognition", model, {
        dtype,
        device,
        progress_callback: forwardProgress,
      });
    })();
    p.catch(() => asrCache.delete(model)); // don't cache a failed load
    asrCache.set(model, p);
  }
  return asrCache.get(model);
}

async function doTranscribe({ pcm, task, language, model }) {
  if (!(pcm instanceof Float32Array)) {
    throw new Error("transcribe: pcm must be a Float32Array (16 kHz mono)");
  }
  const id = model || DEFAULT_ASR_MODEL;
  const asr = await getAsr(id);
  const opts = { chunk_length_s: 30, return_timestamps: false };
  // English-only checkpoints (e.g. whisper-base.en) reject task/language.
  if (!/\.en$/.test(id)) {
    if (task) opts.task = task; // "transcribe" | "translate" (translate = X -> English)
    if (language) opts.language = language;
  }
  const out = await asr(pcm, opts);
  return { text: (out?.text ?? "").trim(), model: id };
}

// ---------------------------------------------------------------------------
// LLM: cached processor + model per model id (Gemma 4 ONNX, per model card).
// ---------------------------------------------------------------------------
const llmCache = new Map(); // model id -> Promise<{ processor, lm }>

function getLlm(model) {
  if (!llmCache.has(model)) {
    const p = (async () => {
      const device = await pickDevice();
      const processor = await AutoProcessor.from_pretrained(model, {
        progress_callback: forwardProgress,
      });
      const lm = await Gemma4ForConditionalGeneration.from_pretrained(model, {
        // Model card uses q4f16 on webgpu; q4f16 needs fp16 support, so fall
        // back to plain q4 on wasm (functional but slow for a 2B model).
        dtype: device === "webgpu" ? "q4f16" : "q4",
        device,
        progress_callback: forwardProgress,
      });
      return { processor, lm };
    })();
    p.catch(() => llmCache.delete(model)); // don't cache a failed load
    llmCache.set(model, p);
  }
  return llmCache.get(model);
}

/**
 * Normalize messages into the chat-template shape and collect media.
 * Content may be a plain string or an array of parts:
 *   { type: "text", text }
 *   { type: "image", url }            (fetched in-worker via load_image)
 *   { type: "audio", pcm }            (Float32Array pre-decoded on the main
 *                                      thread at 16 kHz mono — workers have no
 *                                      AudioContext)
 * v1 limit: at most one image and one audio per request, mirroring the model
 * card's `processor(prompt, image, audio, ...)` single-media signature.
 */
function normalizeMessages(messages) {
  const images = [];
  const audios = [];
  const norm = (messages ?? []).map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: [{ type: "text", text: m.content }] };
    }
    const parts = (m.content ?? []).map((part) => {
      switch (part.type) {
        case "text":
          return { type: "text", text: part.text ?? "" };
        case "image":
          images.push(part.url ?? part.image);
          return { type: "image" };
        case "audio":
          audios.push(part.pcm);
          return { type: "audio" };
        default:
          throw new Error(`generate: unknown content part type "${part.type}"`);
      }
    });
    return { role: m.role, content: parts };
  });
  if (images.length > 1 || audios.length > 1) {
    throw new Error("generate: at most one image and one audio part per request (v1)");
  }
  return { norm, imageUrl: images[0] ?? null, audioPcm: audios[0] ?? null };
}

async function doGenerate({ model, messages, maxTokens, temperature }, requestId) {
  const id = model || DEFAULT_LLM_MODEL;
  const { processor, lm } = await getLlm(id);
  const { norm, imageUrl, audioPcm } = normalizeMessages(messages);

  // Chat template + preprocessing, verbatim from the Gemma 4 model card.
  const prompt = processor.apply_chat_template(norm, {
    enable_thinking: false,
    add_generation_prompt: true,
  });
  const image = imageUrl ? await load_image(imageUrl) : null;
  const inputs = await processor(prompt, image, audioPcm ?? null, {
    add_special_tokens: false,
  });

  const genOpts = { ...inputs, max_new_tokens: maxTokens ?? 512 };
  if (typeof temperature === "number" && temperature > 0) {
    genOpts.do_sample = true;
    genOpts.temperature = temperature;
  } else {
    genOpts.do_sample = false;
  }
  // Stream decoded text back as it is produced (best-effort nicety).
  genOpts.streamer = new TextStreamer(processor.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text) =>
      self.postMessage({ event: "delta", id: requestId, text }),
  });

  const outputs = await lm.generate(genOpts);
  const decoded = processor.batch_decode(
    outputs.slice(null, [inputs.input_ids.dims.at(-1), null]),
    { skip_special_tokens: true },
  );
  return { text: (decoded[0] ?? "").trim(), model: id };
}

// ---------------------------------------------------------------------------
// Message loop: one request at a time (the main thread serializes anyway).
// ---------------------------------------------------------------------------
self.onmessage = async (e) => {
  const msg = e.data ?? {};
  const { id, op } = msg;
  try {
    let result;
    switch (op) {
      case "init":
        if (msg.modelBase) {
          env.allowLocalModels = true;
          env.localModelPath = msg.modelBase; // same-origin staged weights win
        }
        result = { device: await pickDevice() };
        break;
      case "transcribe":
        result = await doTranscribe(msg);
        break;
      case "generate":
        result = await doGenerate(msg, id);
        break;
      default:
        throw new Error(`local-ai worker: unknown op "${op}"`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.stack || err) });
  }
};

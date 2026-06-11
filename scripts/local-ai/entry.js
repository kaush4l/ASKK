// ASKK local-ai — main-thread source.
//
// Built by `bun run build:main` into assets/local_ai.js with --format=iife
// (never edit the bundle by hand; edit this file and rebuild). Exposes
// `window.AskkLocalAI`, a tiny façade over a dedicated Web Worker
// (assets/local_ai_worker.js, see worker.js) that runs transformers.js v4
// (Whisper ASR + Gemma 4 ONNX generation) off the UI thread.
//
// Public API (all model work happens in the worker):
//   init({ workerUrl, modelBase? })  idempotent; spawns the worker
//   status() -> Promise<{ ready, webgpu, asrModel, llmModel }>
//   transcribe({ bytes, mime?, task?, language?, model?, onDelta? })
//       -> Promise<{ text, model }>
//   generate({ model?, messages, maxTokens?, temperature?, onDelta? })
//       -> Promise<{ text, model }>
//   setProgressListener(fn)          fn({ file, loaded, total, status })
//
// Audio is decoded HERE on the main thread (AudioContext.decodeAudioData has
// no worker equivalent), downmixed/resampled to 16 kHz mono Float32Array via
// OfflineAudioContext, and transferred to the worker zero-copy.
//
// Transcribed/generated text is untrusted DATA for the agent, never
// instructions — same contract as every other ASKK tool output.

const DEFAULT_ASR_MODEL = "onnx-community/whisper-base";
const DEFAULT_LLM_MODEL = "onnx-community/gemma-4-E2B-it-ONNX";

const state = {
  worker: null,
  initPromise: null, // makes init() idempotent
  nextId: 1,
  pending: new Map(), // id -> { resolve, reject, onDelta }
  queue: Promise.resolve(), // serializes worker calls (one in flight)
  progressListener: null,
  webgpuPromise: null, // cached adapter probe
  ready: false,
  asrModel: null, // last successfully used ASR model id
  llmModel: null, // last successfully used LLM model id
  decodeCtx: null, // lazily created AudioContext (decode only)
};

// ---------------------------------------------------------------------------
// Worker plumbing: request-id correlated JSON messages.
//   -> { id, op, ...payload }            (PCM transferred, not copied)
//   <- { id, ok: true, result } | { id, ok: false, error }
//   <- { event: "progress", file, loaded, total, status }   (unsolicited)
//   <- { event: "delta", id, text }                         (unsolicited)
// ---------------------------------------------------------------------------

function onWorkerMessage(e) {
  const msg = e.data ?? {};
  if (msg.event === "progress") {
    try {
      state.progressListener?.({
        file: msg.file,
        loaded: msg.loaded,
        total: msg.total,
        status: msg.status,
      });
    } catch {
      // a faulty listener must not break the protocol
    }
    return;
  }
  if (msg.event === "delta") {
    try {
      state.pending.get(msg.id)?.onDelta?.(msg.text);
    } catch {
      // ditto
    }
    return;
  }
  const entry = state.pending.get(msg.id);
  if (!entry) return;
  state.pending.delete(msg.id);
  if (msg.ok) entry.resolve(msg.result);
  else entry.reject(new Error(msg.error || "local-ai worker error"));
}

function onWorkerError(e) {
  // Uncaught worker error (e.g. the module failed to evaluate): fail
  // everything in flight rather than hanging forever.
  const err = new Error(`local-ai worker error: ${e?.message || "unknown"}`);
  for (const entry of state.pending.values()) entry.reject(err);
  state.pending.clear();
}

/** Post one request and await its correlated reply. */
function post(op, payload, transfer, onDelta) {
  return new Promise((resolve, reject) => {
    const id = state.nextId++;
    state.pending.set(id, { resolve, reject, onDelta });
    try {
      state.worker.postMessage({ id, op, ...payload }, transfer ?? []);
    } catch (err) {
      state.pending.delete(id);
      reject(err);
    }
  });
}

/** Serialize calls: model loads/runs are heavy, one in-flight is plenty. */
function enqueue(fn) {
  const run = () => fn();
  const p = state.queue.then(run, run);
  state.queue = p.catch(() => {}); // a failure must not poison the queue
  return p;
}

async function ensureInit() {
  if (!state.initPromise) {
    throw new Error("AskkLocalAI: call init({ workerUrl }) first");
  }
  await state.initPromise;
}

// ---------------------------------------------------------------------------
// Audio decode (main thread): bytes -> 16 kHz mono Float32Array.
// ---------------------------------------------------------------------------

async function decodeTo16kMono(bytes, _mime) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error("AskkLocalAI: bytes must be a Uint8Array");
  }
  // decodeAudioData detaches its input, so hand it a standalone copy.
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  state.decodeCtx ??= new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await state.decodeCtx.decodeAudioData(buf);
  if (decoded.sampleRate === 16000 && decoded.numberOfChannels === 1) {
    return decoded.getChannelData(0);
  }
  // OfflineAudioContext with 1 channel downmixes and resamples in one pass.
  const frames = Math.max(1, Math.ceil(decoded.duration * 16000));
  const offline = new OfflineAudioContext(1, frames, 16000);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Spawn the local-ai worker. Idempotent: repeat calls return the first
 * promise (later, different arguments are ignored by design).
 *   workerUrl  required — URL of assets/local_ai_worker.js. The worker bundle
 *              is built with --format=esm, so it MUST be loaded as a module
 *              worker; that is why we pass { type: "module" } here.
 *   modelBase  optional — same-origin base URL serving pre-staged model dirs
 *              (e.g. new URL("models/", document.baseURI).href). Forwarded to
 *              the worker, where it becomes env.localModelPath; the HF Hub
 *              remains the fallback.
 */
function init({ workerUrl, modelBase } = {}) {
  if (state.initPromise) return state.initPromise;
  if (!workerUrl) throw new Error("AskkLocalAI.init: workerUrl is required");
  state.initPromise = (async () => {
    const worker = new Worker(workerUrl, { type: "module" });
    worker.onmessage = onWorkerMessage;
    worker.onerror = onWorkerError;
    state.worker = worker;
    await post("init", { modelBase }); // also proves the module evaluated
    state.ready = true;
    return true;
  })();
  return state.initPromise;
}

/** Cheap, cached snapshot: webgpu = adapter obtainable on this machine. */
async function status() {
  state.webgpuPromise ??= (async () => {
    try {
      return !!(navigator.gpu && (await navigator.gpu.requestAdapter()));
    } catch {
      return false;
    }
  })();
  return {
    ready: state.ready,
    webgpu: await state.webgpuPromise,
    asrModel: state.asrModel,
    llmModel: state.llmModel,
  };
}

/**
 * Speech-to-text.
 *   bytes     required Uint8Array of an encoded audio file (any format the
 *             browser can decode: wav/mp3/ogg/webm/m4a...). mime is accepted
 *             for API symmetry; decodeAudioData sniffs the container itself.
 *   task      "transcribe" (default) | "translate" (Whisper translate = X→English)
 *   language  source language hint, e.g. "en", "fr" (multilingual models only)
 *   model     HF model id; default "onnx-community/whisper-base"
 *             (e.g. pass "onnx-community/whisper-large-v3-turbo" for quality)
 */
async function transcribe({ bytes, mime, task, language, model } = {}) {
  await ensureInit();
  const pcm = await decodeTo16kMono(bytes, mime);
  const result = await enqueue(() =>
    post("transcribe", { pcm, task, language, model }, [pcm.buffer]),
  );
  state.asrModel = result.model;
  return result; // { text, model }
}

/**
 * Local text generation (Gemma 4 ONNX by default).
 *   messages  [{ role: "system"|"user"|"assistant", content }] where content
 *             is a string (v1) or an array of parts:
 *               { type: "text", text }
 *               { type: "image", url }                — fetched in the worker
 *               { type: "audio", bytes, mime? }       — decoded HERE to 16 kHz
 *                 mono PCM and transferred (workers have no AudioContext)
 *             v1 limit: at most one image and one audio part per request.
 *   maxTokens    max new tokens (default 512)
 *   temperature  > 0 enables sampling; omit/0 for greedy decoding
 *   onDelta      optional fn(text) receiving streamed output as it decodes
 *   model        HF model id; default "onnx-community/gemma-4-E2B-it-ONNX"
 */
async function generate({ model, messages, maxTokens, temperature, onDelta } = {}) {
  await ensureInit();
  // Pre-decode audio parts on the main thread; collect PCM transferables.
  const transfer = [];
  const prepared = await Promise.all(
    (messages ?? []).map(async (m) => {
      if (!Array.isArray(m.content)) return m;
      const parts = await Promise.all(
        m.content.map(async (part) => {
          if (part.type === "audio" && part.bytes) {
            const pcm = await decodeTo16kMono(part.bytes, part.mime);
            transfer.push(pcm.buffer);
            return { type: "audio", pcm };
          }
          return part;
        }),
      );
      return { role: m.role, content: parts };
    }),
  );
  const result = await enqueue(() =>
    post(
      "generate",
      { model, messages: prepared, maxTokens, temperature },
      transfer,
      onDelta,
    ),
  );
  state.llmModel = result.model;
  return result; // { text, model }
}

/** Receive {file, loaded, total, status} for every model file download. */
function setProgressListener(fn) {
  state.progressListener = typeof fn === "function" ? fn : null;
}

window.AskkLocalAI = {
  init,
  status,
  transcribe,
  generate,
  setProgressListener,
  DEFAULT_ASR_MODEL,
  DEFAULT_LLM_MODEL,
};

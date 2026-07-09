// STT bundle: whisper-family ASR via @huggingface/transformers (v4).
// Exposes window.askkStt — load(modelId, onProgress), transcribe(Float32Array).
// Engine-module pattern (RealtimeSTT): the model id IS the module switch;
// any HF ASR id (onnx-community/whisper-tiny.en, whisper-small, distil-*)
// loads through the same pipeline seam.
import { pipeline, env } from "@huggingface/transformers";

// Self-hosted ONNX runtime (no CDN). Dioxus hashes asset filenames, so the
// host passes explicit URLs instead of a directory prefix.
function init(wasmMjsUrl, wasmUrl) {
  env.backends.onnx.wasm.wasmPaths = { mjs: wasmMjsUrl, wasm: wasmUrl };
  if (!globalThis.crossOriginIsolated) {
    env.backends.onnx.wasm.numThreads = 1; // no SharedArrayBuffer without COOP/COEP
  }
}

const DEFAULT_MODEL = "onnx-community/whisper-tiny.en";

let asr = null;
let loadedId = null;

// q8 whisper exports trip a DequantizeLinear bug in ort 1.26 wasm; fp32
// encoder + q4 merged decoder is the working combo (and still small for
// tiny/base). `dtype` stays overridable for future models.
const DEFAULT_DTYPE = { encoder_model: "fp32", decoder_model_merged: "q4" };

async function load(modelId, onProgress, dtype) {
  const id = modelId || DEFAULT_MODEL;
  const kind = JSON.stringify(dtype || DEFAULT_DTYPE);
  if (asr && loadedId === id + kind) return { model: id, cached: true };
  asr = await pipeline("automatic-speech-recognition", id, {
    dtype: dtype || DEFAULT_DTYPE,
    device: "wasm",
    progress_callback: (p) => {
      if (onProgress && p.status === "progress" && p.total) {
        onProgress(p.file || "", Math.round((p.loaded / p.total) * 100));
      }
    },
  });
  loadedId = id + kind;
  return { model: id, cached: false };
}

// audio: Float32Array mono PCM at 16 kHz.
async function transcribe(audio) {
  if (!asr) await load(null, null);
  const out = await asr(audio);
  return out.text ?? "";
}

// Mic capture: records until stop() is called, resamples to 16 kHz mono.
let recorder = null;

async function recordStart() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext({ sampleRate: 16000 });
  const source = ctx.createMediaStreamSource(stream);
  const chunks = [];
  const node = ctx.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  source.connect(node);
  node.connect(ctx.destination);
  recorder = { stream, ctx, node, chunks };
}

async function recordStop() {
  if (!recorder) return new Float32Array(0);
  const { stream, ctx, node, chunks } = recorder;
  recorder = null;
  node.disconnect();
  stream.getTracks().forEach((t) => t.stop());
  await ctx.close();
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const audio = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    audio.set(c, off);
    off += c.length;
  }
  return audio;
}

window.askkStt = { init, load, transcribe, recordStart, recordStop, DEFAULT_MODEL };

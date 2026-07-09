// TTS bundle: kokoro-js (Kokoro-82M ONNX) over its pinned transformers.
// Exposes window.askkTts — load(modelId, onProgress), speak(text, voice).
// The model id is the module switch: any kokoro-compatible ONNX HF id loads
// through the same seam (default onnx-community/Kokoro-82M-v1.0-ONNX).
// kokoro-js pins its own transformers (v3.x) and re-exports its env — that
// is the one to configure, not the top-level v4 the STT bundle uses.
import { KokoroTTS, env } from "kokoro-js";

// Dioxus hashes asset filenames, so the host passes explicit URLs. kokoro's
// env is a facade: assigning wasmPaths proxies to its transformers' ort env
// (threads auto-fall to 1 without crossOriginIsolated).
function init(wasmMjsUrl, wasmUrl) {
  env.wasmPaths = { mjs: wasmMjsUrl, wasm: wasmUrl };
}

const DEFAULT_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const DEFAULT_VOICE = "af_heart";

let tts = null;
let loadedId = null;

async function load(modelId, onProgress) {
  const id = modelId || DEFAULT_MODEL;
  if (tts && loadedId === id) return { model: id, cached: true };
  tts = await KokoroTTS.from_pretrained(id, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p) => {
      if (onProgress && p.status === "progress" && p.total) {
        onProgress(p.file || "", Math.round((p.loaded / p.total) * 100));
      }
    },
  });
  loadedId = id;
  return { model: id, cached: false };
}

let playing = null;

// Returns sample count; plays through the default output.
async function speak(text, voice) {
  if (!tts) await load(null, null);
  const audio = await tts.generate(text, { voice: voice || DEFAULT_VOICE });
  const ctx = new AudioContext({ sampleRate: audio.sampling_rate });
  const buf = ctx.createBuffer(1, audio.audio.length, audio.sampling_rate);
  buf.copyToChannel(audio.audio, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  stop();
  playing = { ctx, src };
  src.onended = () => {
    ctx.close();
    if (playing && playing.src === src) playing = null;
  };
  src.start();
  return audio.audio.length;
}

// Synthesis without playback — for headless verification and piping into
// other engines (the audio field stays page-side; never serialize it out).
async function synthesize(text, voice) {
  if (!tts) await load(null, null);
  const audio = await tts.generate(text, { voice: voice || DEFAULT_VOICE });
  return {
    samples: audio.audio.length,
    sampleRate: audio.sampling_rate,
    audio: audio.audio,
  };
}

function stop() {
  if (playing) {
    try {
      playing.src.stop();
      playing.ctx.close();
    } catch (_) {}
    playing = null;
  }
}

function voices() {
  return tts ? Object.keys(tts.voices ?? {}) : [];
}

window.askkTts = { init, load, speak, synthesize, stop, voices, DEFAULT_MODEL, DEFAULT_VOICE };

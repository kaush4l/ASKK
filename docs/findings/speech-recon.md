# Speech recon — RealtimeTTS / RealtimeSTT architecture + browser mapping

Read 2026-07-09 from the KoljaB repos' code (not docs) + transformers.js/kokoro-js
source. Basis for ADR-014.

## RealtimeTTS (the pattern we copy)

- Layout: one orchestrator (`TextToAudioStream`) + `engines/` with a lazy registry
  (name → loader; 28 engines whose deps cost nothing until instantiated) + one
  `BaseEngine` ABC per-engine file.
- **Engine contract is a queue, not a return value**: `synthesize(text)` pushes raw
  audio chunks into the engine's own queue; the player drains concurrently —
  time-to-first-audio decouples from synthesis time.
- `get_stream_info() -> (format, channels, rate)` is the whole format negotiation;
  the player adapts (resample/decode), engines emit whatever is natural.
- Fallback = an ordered engine list + a while-loop at sentence granularity: failure
  rotates to the next engine, rebuilds the player, retries the same sentence.
- Engine-specific knobs (model, voice, api key) live only in engine constructors;
  the pipeline never sees them. Model download is engine-owned.

## RealtimeSTT (the pattern we copy)

- **One-method engine seam**: `transcribe(float32 mono 16 kHz) -> {text, language}`.
  15 backends fit behind it; streaming is an opt-in capability flag.
- **Model ids are opaque strings** ("tiny", a path, an HF id) routed through a shared
  config object; only the engine interprets them. Factory maps normalized name →
  lazy-imported class; unknown name errors listing available engines.
- Pipeline: mic (16 kHz/512-sample chunks) → two-tier VAD (cheap WebRTC gate, Silero
  confirm on onset only) → pre-roll ring buffer → frames → final transcription
  re-transcribes the FULL raw buffer (realtime partials are advisory only).
- Two engine slots (cheap realtime in-thread, accurate final in a spawned process)
  + an executor escape hatch (any `.transcribe()`-shaped object).

## Browser mapping (what shipped)

- The seam: `window.askkStt.transcribe(Float32Array 16k mono) -> text` and
  `window.askkTts.speak(text, voice)`; **the HF model id is the module switch** —
  `load(modelId)` accepts any compatible hub id, `null` = default.
- Defaults (small, run-anywhere): STT `onnx-community/whisper-tiny.en` (q8),
  TTS `onnx-community/Kokoro-82M-v1.0-ONNX` (q8, 92 MB).
- transformers.js v4.2.0 (STT) downloads from the HF hub and caches via the browser
  Cache API (`transformers-cache`), including the ort wasm itself since v4.
  kokoro-js 1.2.1 pins transformers v3.5.1 → two ort runtimes; each bundle gets its
  own staged wasm pair (`stt-ort.*` = 1.26.0-dev, `tts-ort.*` = 1.22.0-dev).
- Dioxus hashes asset names → `env.backends.onnx.wasm.wasmPaths` is set to an
  explicit `{mjs, wasm}` URL object passed from Rust, not a directory prefix.
- kokoro-js voice `.bin`s fetch from a hardcoded HF URL (cached in `kokoro-voices`);
  offline self-host would need URL patching — accepted, online-first.
- Deviations from the references, accepted for v1: no VAD/wake-word (mic is
  push-to-talk), no sentence-streamed synthesis (kokoro speaks whole answers;
  `TextSplitterStream` exists in kokoro-js when we want it), engines run on the main
  thread (old ASKK proved the module-worker split; do it when blocking hurts).

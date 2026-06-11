# Local models — in-browser inference (Gemma 4 + Whisper)

> Status: SHIPPED 2026-06-11 (text generation, transcription, translation;
> multimodal parts supported by the runtime, provider wiring for image/audio
> parts is the next step). Everything runs client-side: weights download to the
> browser, audio/frames never leave the machine.

## What ships

| Piece | Where | What it does |
|---|---|---|
| `scripts/local-ai/` → `assets/local_ai.js` + `assets/local_ai_worker.js` | vendored bun bundles | transformers.js **4.2.0** in a dedicated Web Worker (WebGPU, wasm fallback); main-thread façade `window.AskkLocalAI` decodes audio (16 kHz mono PCM) and correlates requests |
| `capabilities::local_ai` | Rust bridge | injects the bundle, calls `transcribe` / `generate` |
| `worker::page_proxy` + `PageOp::{Transcribe, Generate}` | proxy | local-AI calls (and all device capture) reach the page thread even from worker-hosted agent runs |
| `inference::LocalGemmaInference` | provider | `local/...` model ids run Gemma 4 in-browser behind the same `InferenceProvider` trait — the loop never changes |
| `transcribe_audio` tool | tool | OPFS audio → text (or English translation), pairs with `mic_record` |
| `models/` + `scripts/models/{fetch,stage}.sh` | weight cache | pre-download weights and stage them same-origin for a deploy; Hub fallback otherwise |

## Choosing a model

Set the provider model id to:

| Model id | Resolves to | Size (q4f16) | Modalities |
|---|---|---|---|
| `local/e2b` (alias `local/gemma-4`) | `onnx-community/gemma-4-E2B-it-ONNX` | ~3.4 GB | text + image + audio |
| `local/e4b` | `onnx-community/gemma-4-E4B-it-ONNX` | ~5 GB | text + image + audio |
| `local/<org>/<repo>` | that ONNX repo verbatim | — | — |

ASR (the `transcribe_audio` tool): `onnx-community/whisper-base` (~80 MB)
by default; pass `model: "onnx-community/whisper-large-v3-turbo"` (~560 MB)
for quality. Whisper's `translate` task produces English from ~100 languages.

## Why this stack (decisions, June 2026)

- **Gemma 4 is real** (E2B/E4B/12B-Unified/26B/31B, released 2026-03-31;
  Apache-2.0, ungated on HF — no token needed for browser fetch).
- **transformers.js v4 is the only browser runtime with Gemma 4
  image + audio today.** Google's LiteRT-LM web runtime
  (`gemma-4-*-it-web.litertlm`, 2.0 GB) is faster for *text-only* and is the
  documented upgrade path if a text-only fast tier is wanted; MediaPipe
  `tasks-genai` is in maintenance mode (multimodal limited to Gemma 3n, whose
  repos are still license-gated); WebLLM has no Gemma 4.
- **Gemma 4 12B is not browser-practical** (≈7 GB at q4 + 256K-context KV;
  most devices' WebGPU buffers won't hold it). E2B/E4B are the browser
  targets, per the MatFormer design intent.
- **WebGPU is required** for usable speed; the runtime falls back to wasm but
  multi-GB models are effectively WebGPU-only. The Capabilities page shows the
  adapter status.
- **ort wasm assets** resolve from jsdelivr pinned to the exact onnxruntime-web
  version baked into the bundle (CORS-verified); staging them same-origin is a
  follow-up if full offline is needed.

## Weight resolution order

1. Same-origin `models/<repo-id>/<file>` — the staged cache
   (`env.localModelPath`), for offline/no-third-party deploys.
2. `huggingface.co` direct (CORS + Range verified; browser-cached after first
   download).

```bash
scripts/models/fetch.sh                                  # fill models/
dx build --release --platform web
scripts/models/stage.sh target/dx/askk/release/web/public  # ship same-origin
```

## Known limitations (deliberate v1 cuts)

- Local generation is **non-streaming** through the page-op proxy (the runtime
  streams deltas; forwarding them across the worker channel is wired-ready —
  `PageOpAck` leaves room for a delta event leg).
- The provider sends **text-only transcripts** today; the runtime already
  accepts `{type:"image"|"audio"}` parts (≤1 each per request), so wiring
  `InferenceRequest::parts` through `PageOp::Generate` is the natural next
  increment for full native multimodality.
- First-call latency is dominated by the weight download; the Capabilities
  page and `setProgressListener` expose progress.

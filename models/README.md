# models/ — local model cache

Converted, browser-ready model weights live here, laid out exactly as the
runtime requests them: one directory per Hugging Face repo id.

```
models/
  onnx-community/
    gemma-4-E2B-it-ONNX/        # Gemma 4 E2B, ONNX q4f16 (~3.4 GB) — text+image+audio
      config.json
      tokenizer.json
      onnx/…
    whisper-base/               # Whisper ASR (~80 MB)
  litert-community/             # optional: LiteRT-LM .litertlm builds (fast text-only tier)
```

Everything here except this README is **gitignored** — weights are multi-GB and
never belong in the repo.

## Why this folder exists

The in-browser AI runtime (`scripts/local-ai/`, surfaced as the `local/...`
model provider and the `transcribe_audio` tool) resolves weights in two steps:

1. **Same-origin first**: `<deploy base>/models/<repo-id>/<file>` — this folder,
   staged next to the published site. Offline-capable, no third-party traffic.
2. **Hugging Face Hub fallback**: direct browser fetch (Gemma 4 and
   onnx-community repos are ungated and CORS-enabled), cached by the browser
   after first download.

## Workflow

```bash
# 1. Fill the cache (resumable; pass extra repo ids to add models)
scripts/models/fetch.sh

# 2. Build the site
dx build --release --platform web

# 3. Stage the cache into the publish output before deploying
scripts/models/stage.sh target/dx/askk/release/web/public
```

If you skip fetch/stage entirely, the app still works — it just pulls weights
from the Hub at first use.

---
name: add-model
description: Add a local model to ASKK (speech-to-text, text-to-speech or image generation) — download it, place its weights, write its model.md (and a wrapper when it has no ready command line or server), test it live and leave it ready in the model panel. Use when asked to "add / try / wire up / install" a model such as Whisper, Parakeet, Kokoro, F5-TTS, FLUX, a Hugging Face repo id, or "a new STT/TTS/image model".
---

# Add a local model

ASKK runs every local model the same way: one folder per model under `models/`, one `model.md` that says how to run
it, read by `companion/models/registry.js` on every call (no restart). The voice settings and the studio show it in
the model panel, where the owner picks it and changes its options. Your job: get the model onto this Mac, write the
folder, prove it works through the live server, report.

## Where everything goes

| What | Where | Committed? |
|---|---|---|
| The model's config | `models/<kind>/<name>/model.md` — kind `stt`, `tts` or `image`; name lowercase-with-dashes | never (git-ignored) |
| Weights a tool downloads itself (mlx-audio, mflux, any Hugging Face id) | the Hugging Face cache, `~/.cache/huggingface/hub` — leave them there; name the repo in `weights:` | no |
| Weights you download by hand (a `.safetensors`, `.gguf`, `.onnx`, a repo snapshot) | `models/<kind>/<name>/weights/` — `hf download <repo> --local-dir models/<kind>/<name>/weights` | never |
| A wrapper (when no command line or server fits) | `models/<kind>/<name>/run.py` (or `run.sh`), executable, named `bin: ./run.py` | never |
| Programs (`uv tool install …`, `brew install …`) | `~/.local/bin`, Homebrew — found automatically | — |
| Which model is in use | `models/models.md` (`stt: …`, `tts: …`, `image: …`) — the panel writes it | never |
| A reusable entry other machines can add | `companion/models/catalog/<kind>/<name>.md` — only for a model that needs no wrapper and no hand-placed weights | yes (core) |

`ASKK_MODELS` moves the `models/` folder. Never commit `models/`, `custom/` or `.model-test/`.

## 1. Pick the engine

Read the model's page (Hugging Face card, GitHub README) and choose the first that fits:

1. **`command`, mlx-audio's command lines** (no server — the owner's choice, 2026-10-24): any STT/TTS model mlx-audio
   supports (Whisper, Parakeet, Qwen3-ASR, Granite, Voxtral; Kokoro, Qwen3-TTS, Chatterbox, CSM, Dia, Spark, Orpheus …).
   Copy `companion/models/catalog/stt/parakeet.md` (`mlx_audio.stt.generate … --output-path "{dir}/{stem}"`, `output:
   file:{dir}/{stem}.txt`) or `tts/kokoro.md` (`mlx_audio.tts.generate`, `stdin: text`, `--output_path "{dir}"
   --file_prefix "{stem}"`, `--join_audio`) and change `title`, `about`, `weights` and the `--model` repo id. A model
   with a language code per voice takes `lang_from_voice: true` and `--lang_code "{lang}"`; its own controls (an
   expressiveness, a style line) become options with a `flag:`.
2. **`openai`, another OpenAI-compatible server** (whisper.cpp server, a vLLM/LM Studio speech endpoint, a cloud API):
   `url` (ending in `/v1`), `model`, `serve: {bin, args}` if the helper should start it, `key_env: SOME_API_KEY` for a
   key (the value stays in `.env`, never in model.md; sent only over https or to this machine).
3. **`command`**: a program that runs once per call — a CLI such as `mflux-generate-…` or `whisper-cli`. Write
   `bin` + `args` (or `modes:` for several, e.g. image `generate` and `edit`), `{name}` placeholders filled from the
   call, `inputs: {name: flag}` for inputs that are sometimes there, `output:` for STT.
4. **A wrapper** (`command`, or `openai` + `serve`): when the model has only a Python API, or its CLI needs reshaping.
   See step 3.

Placeholders a call fills — stt: `{audio}` (16 kHz mono WAV path), `{dir}`, `{stem}`, `{language}`, `{locale}`;
tts: `{text}`, `{out}` (the WAV to write), `{voice}`, `{speed}`; image: `{prompt}`, `{negative}`, `{width}`,
`{height}`, `{steps}`, `{seed}`, `{guidance}`, `{out}` (the PNG to write), `{init}`, `{strength}`, `{references}`,
`{mask}`. An option's value fills `{its name}` too.

## 2. Download

- An install line goes in `install:` — only `uv tool install …` or `brew install …` (the panel's Install button runs
  it as an argument list; nothing else runs from there). Run it yourself in a terminal the first time:
  `uv tool install --python 3.13 <package>[extras] --with <dep> …`. Pin versions known to break (mflux needs
  `--with pillow==12.3.0`; Kokoro needs `--with "spacy>=3.8,<4"` and the `en_core_web_sm` wheel URL — see
  `companion/models/catalog/tts/kokoro.md`).
- Weights: let the tool fetch them on the first call (say so in `weights:` with the size), or fetch them first so the
  first call is fast: `hf download <repo-id>` (into the cache) or `hf download <repo-id> --local-dir
  models/<kind>/<name>/weights` (a folder the wrapper reads). A gated repo needs the owner's `hf auth login` — ask,
  never handle the token yourself.
- Never `curl … | sh`; download only from the model's official repo.

## 3. Write a wrapper (only when needed)

`models/<kind>/<name>/run.py`, `chmod +x`, referenced as `bin: ./run.py` (resolved inside the model's folder only;
`check` reports it missing until it exists and is executable). A self-contained script declares its own
dependencies, so nothing else gets installed:

```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["<package>==<version>"]
# ///
import argparse
from pathlib import Path

weights = Path(__file__).parent / "weights"  # hand-placed weights, if any
p = argparse.ArgumentParser()
p.add_argument("--text")
p.add_argument("--out")
p.add_argument("--voice", default=None)
a = p.parse_args()
# … load the model from `weights` (or its repo id), synthesise a.text, write a WAV to a.out …
```

The contract per kind (what the host expects back):

| kind | gets | must | then in model.md |
|---|---|---|---|
| stt | `--audio {audio}` (16 kHz mono WAV) | print the transcript on stdout (or JSON, or a file) | `output: stdout` (or `json:text`, `file:{dir}/{stem}.txt`) |
| tts | `--text {text} --out {out}` | write a WAV to `out`, exit 0 | — |
| image | `--prompt {prompt} --out {out} --width … --steps …` | write a PNG to `out`; print `step/total` lines for the progress bar | `progress:` regex if not `N/M` |

Exit non-zero with the reason on stderr when it fails (the host shows the end of stderr). A model that loads slowly
and is called often (speech): make the wrapper a small OpenAI-compatible server instead (`POST
/v1/audio/transcriptions` → `{text}`, `POST /v1/audio/speech` → WAV bytes, `GET /v1/models`), engine `openai` with
`serve: {bin: ./serve.py, args: [--port, "8330"]}` and `url: http://127.0.0.1:8330/v1` — the helper starts it once and
keeps it up.

## 4. Write model.md

Copy the closest catalogue entry (`companion/models/catalog/<kind>/`) and edit it. The full schema is the header of
`companion/models/registry.js`. Shape:

```yaml
---
kind: tts
title: Human name
engine: command
about: "One line: what it is good at"
weights: org/repo (~1.2 GB, in models/tts/<name>/weights/)
install: uv tool install --python 3.13 <pkg>
bin: ./run.py
args: [--text, "{text}", --out, "{out}", --voice, "{voice}"]
options:
  voice: {type: choice, choices: [a, b], default: a, about: "the speaker"}
  speed: {type: number, default: 1, min: 0.5, max: 2, step: 0.1, about: "how fast it speaks"}
values: {}
---
# Human name

How it runs here, how to try it from a terminal, its quirks.
```

Quote every `about:` (commas and colons break YAML flow maps). A text-to-speech model also takes `script:` — how to write a script for it (plain prose or tags, what punctuation does,
how emotion is carried, which option steers the style, how numbers should be written). The audio artifact shows it to
the agent that writes a script for that model, so write it from what you tested, not from the model card alone.

Options: `flag:` puts the option on a command line
(`--quantize 8`; a bool the flag alone), `field:` sends it under that name in an openai request (Chatterbox's
`language` as `lang_code`). The owner's changes land in `values:`.

## 5. Check, test, report

```bash
bun scripts/model.js check <kind>/<name>
```

Fix until it says ready (a missing program: install it; a problem: the YAML or a key). Then test it on the live desk
server (port 1111, never a side copy of ASKK):

```bash
bun scripts/model.js test <kind>/<name>
```

It calls the model twice (first: loading or downloading; warm: its real speed), writes the output to `.model-test/`
and puts the kind's selection back. Check the output itself — read the PNG; for a WAV, transcribe it with an stt
model. The first call of a new model may run for minutes while the weights download: a timeout then is not a bug, so
run the test again.

When it fails, find the real error before changing anything:
- a command engine: run the argv `check` prints, by hand.
- an mlx-audio model: run the argv `check` prints (text on stdin for tts) and read its traceback. (2026-10-23:
  Chatterbox failed silently; the traceback said mlx-audio defaults `lang_code` to Kokoro's "a" → a language option
  with `flag: --lang_code`.)
- a 200 with an empty body from a streaming server: the model raised mid-stream.

Report to the owner: the folder added, the install line, the weights' size and where they live, first and warm times,
the output file, and that it is in the panel — not selected (the owner picks it) unless they asked you to select it
(`POST /__askk/models/select {kind, name}`).

## 6. Make it reusable (optional)

A model that needs no wrapper and no hand-placed weights, tested and working: copy its `model.md` to
`companion/models/catalog/<kind>/<name>.md` (with `values: {}`), so every machine can add it from the panel's "Add a
model". That file is core: commit it only when the owner asks for a commit.

## Rules

- Code under `companion/` takes effect only after a restart of `askk.desks`, and only when `GET /__askk/desks` shows
  `"work": []` for every desk. A model.md, a wrapper or weights need no restart.
- Never commit `models/`, weights, wrappers or `custom/`; never put a key or token in a file.
- A model that must stay loaded (an engine `openai` server you add) gets its own port; mlx-audio models need none.
- One GPU: an image test waits behind the studio's running job; never stop the owner's jobs to test.

# R2 — Multimodal content-block formats + token counting in Wasm

G0 research for PROMPT §8.1/§8.6 and §18 ("multimodal content-block formats across the providers in
scope, and the smallest `render` serving them all"; "token counting in Wasm without shipping a large
tokenizer"). All sources fetched 2026-07-29.

---

## A. Content-block formats per provider

### A.1 What each provider actually accepts

**OpenAI Chat Completions** (developers.openai.com/api/docs/guides/images-vision, /guides/audio):

- Text: `{"type":"text","text":...}`.
- Image: `{"type":"image_url","image_url":{"url":..., "detail":"auto|low|high"}}` — `url` accepts
  both remote HTTPS URLs and base64 data URLs (`data:image/jpeg;base64,...`).
- Audio: `{"type":"input_audio","input_audio":{"data":"<b64>","format":"wav"}}` — audio-capable
  models only (e.g. `gpt-audio-*`); docs examples show `wav` (with `mp3` for output config).
- File: `{"type":"file","file":{...}}` with `file_id` (Files API) or `file_data` as a
  `data:application/pdf;base64,...` string plus `filename`. No `detail` control (Responses-only).
- System prompt: a message with role `system`/`developer`; content is a string or text parts only.

**OpenAI Responses API** — the divergence (developers.openai.com/api/docs/guides/file-inputs,
/guides/images-vision, /guides/migrate-to-responses):

- Different part type NAMES: `input_text`, `input_image`, `input_file` (not `text`/`image_url`/`file`).
- `input_image` flattens the nesting: `{"type":"input_image","image_url":<string>,"detail":...}` or
  `file_id`; adds a detail level `original` that Chat Completions lacks.
- `input_file` takes `file_id` | `file_url` | `file_data` (base64 data URL) and supports `detail`.
- No audio input part — OpenAI's own docs say to use Chat Completions for audio-in chat.
- System guidance moves to a top-level `instructions` param (or an input message).
- Output axis differs too (`output[]` items vs `choices[].message`).

**Anthropic Messages** (platform.claude.com/docs/en/api/messages):

- Text: `{"type":"text","text":...}` (optionally `cache_control`).
- Image: `{"type":"image","source":{...}}` with source `{"type":"base64","media_type":
  "image/jpeg|png|gif|webp","data":...}` or `{"type":"url","url":...}`.
- Document: `{"type":"document","source":{...}}` — base64 PDF (`media_type:"application/pdf"`),
  URL PDF, plain text (`type:"text"`), or nested content blocks.
- **No audio input part exists.**
- System prompt: top-level `system` param (string or text-block array); there is no `system` role
  in `messages`.

**Google Gemini** (ai.google.dev/api/generate-content):

- `contents[]` of `{role:"user"|"model", parts:[...]}`; parts are `{text}`, `{inlineData:
  {mimeType, data<b64>}}`, or `{fileData:{mimeType, fileUri}}` (REST also accepts snake_case
  `inline_data`/`file_data`).
- **No remote-URL image part.** Images/audio/PDF go inline base64 or via a prior Files-API upload
  referenced by `fileUri`. Audio (`audio/mpeg` etc.) and PDF are first-class part mime types —
  Gemini is the only provider in scope with native audio understanding on the standard endpoint.
- System prompt: top-level `systemInstruction: {parts:[{text}]}` — "Currently, text only."

**The "OpenAI-compatible" dialect as actually served:**

- **OpenRouter** (openrouter.ai/docs/guides/overview/multimodal/overview): closest to true
  superset — `image_url` (URL or data URI), `file` with `data:application/pdf;base64,...` (own PDF
  parsing layer, works even for models with no native PDF support), `input_audio` (b64 + format),
  plus a nonstandard `video_url`. `system` role works.
- **Ollama** (docs.ollama.com/api/openai-compatibility): text + vision via `image_url` with
  **base64 data URI only — "Image URL" is explicitly listed unsupported**. No `input_audio`, no
  `file` part at all. Also drops `logprobs`, `tool_choice`, `logit_bias`, `n`, `user`.
- **vLLM** (docs.vllm.ai/en/latest/features/multimodal_inputs.html): `image_url` (URL and data
  URI), `input_audio`, plus nonstandard `audio_url`/`video_url`/`image_embeds` extensions —
  all gated on the loaded model + its chat template. No `file`/PDF part.

**What is true:** base64-inline is the only image encoding every provider in scope accepts; remote
image URLs fail on Ollama and Gemini. `file`/document parts exist only on OpenAI, Anthropic, Gemini,
OpenRouter. Audio input exists only on OpenAI CC (audio models), Gemini, OpenRouter, and vLLM
(model-dependent) — never on Anthropic, Ollama, or Responses. System placement splits three ways:
role-message (OpenAI CC + all compat), top-level `system` (Anthropic), `systemInstruction` (Gemini).

**What is uncertain:** vLLM/OpenRouter behavior is ultimately per-model (chat template / routed
model), so "supported part type" ≠ "this model accepts it"; Ollama's compat layer moves fast (its
Responses-API vision support was still an open issue in 2026). Exact audio format lists (wav/mp3/…)
per provider are under-documented.

**What it constrains:** the real "OpenAI-compatible" intersection is just
**text + base64-data-URI `image_url` + `system` role** — plan the compat `ProviderFormat` around
that, not around OpenAI's full surface. Canonical image/file storage must be **bytes, not URLs**:
render can always emit base64, and pass a URL through only where the target supports it.

### A.2 Smallest render target set

Three `ProviderFormat` targets serve everything in scope:

1. `OpenAiChat` — also serves OpenRouter, Ollama, vLLM via per-target capability flags
   (`url_images`, `audio`, `file_parts`). Same wire shapes, different allow-lists; not worth
   separate renderers.
2. `AnthropicMessages` — different block names, `source` nesting, top-level `system`.
3. `GeminiGenerateContent` — different envelope entirely (`contents/parts`, `systemInstruction`).

The Responses API is **not needed as a v1 target**: everything reachable through it is reachable
through Chat Completions (audio only through CC), and every compat vendor mimics CC, not Responses.
Add it later as a fourth mapping of the same Document if hosted tools ever matter.

### A.3 Part enum → per-provider mapping

```rust
enum Part {
    Text(String),
    Image { media: ImageType /* jpeg|png|gif|webp */, data: Vec<u8> },
    Audio { format: AudioFormat /* wav|mp3 */, data: Vec<u8>,
            transcript: Option<String> },            // fallback text, see below
    File  { name: String, media: FileType /* pdf|plain */, data: Vec<u8> },
    Fragment(Html),                                   // §8.4 module output; renders as Text
}
```

| Part | OpenAiChat (OpenAI) | …compat: OpenRouter | …compat: Ollama | …compat: vLLM | AnthropicMessages | GeminiGenerateContent |
|---|---|---|---|---|---|---|
| `Text` / `Fragment` | `text` | `text` | `text` | `text` | `text` | `{text}` |
| `Image` | `image_url` data URI | `image_url` data URI | `image_url` data URI | `image_url` data URI | `image` source base64 | `inlineData` |
| `Audio` | `input_audio` (audio models) | `input_audio` | **degrade** | `input_audio` (model-dep) | **degrade** | `inlineData` audio/* |
| `File` (pdf) | `file{file_data,filename}` | `file` (parser plugin) | **degrade** | **degrade** | `document` source base64 | `inlineData` application/pdf |
| system section | `system` role msg | `system` role | `system` role | `system` role | top-level `system` | `systemInstruction` |

Degradation policy (per I15 — capabilities may be absent, never break):

- `Audio` on a non-audio target: if `transcript` is `Some`, render as a `Text` part
  `"[audio: <transcript>]"`; else render a `Text` placeholder naming the omission **and** record
  the degradation in the §8.5 ledger (the model must know it is missing input). Hard-error only if
  the section declares the part load-bearing (`priority` = must-keep).
- `File` on Ollama/vLLM: same shape — degrade to extracted text if the section provides it,
  placeholder + ledger entry otherwise.
- `Image` on a text-only model: no lossless fallback exists — placeholder + ledger, or refuse the
  call if the section is must-keep. Never silently drop a part: silent loss violates §8.5's "the
  agent is told what was compacted".

Note the §8.3 interaction: a multi-megabyte base64 image early in the document is inside the
cacheable prefix (good) but re-uploaded on every cache miss (expensive) — placement stays a
per-section decision, which the bytes-not-URLs canonical form keeps possible.

---

## B. Token counting in Wasm

### B.1 Options

**Exact — tiktoken-rs / tokenizers crate.** tiktoken-rs is MIT (github.com/zurawiki/tiktoken-rs),
crate payload ~8.8 MB (crates.io) because the BPE rank tables ship inside it; the o200k vocabulary
is ~200k entries (~4 MB raw). Measured JS/Wasm analogues: `@dqbd/tiktoken` wasm ~1.2 MB,
`js-tiktoken` ~200 KB code + rank data, `gpt-tokenizer` ~50 KB + data
(pkgpulse.com/guides/gpt-tokenizer-vs-js-tiktoken-vs-xenova-transformers-llm-2026). HF `tokenizers`
is Apache-2.0 but needs a per-model `tokenizer.json` (2–9 MB each). Licensing is a non-issue; size
is. The deeper problem: **tiktoken is only exact for OpenAI models.** The same PkgPulse guide is
blunt that none of these libraries count Claude or Gemini tokens accurately, and OpenRouter/Ollama
route to models with arbitrary tokenizers — "exact" across the provider set means shipping N
tokenizers, several MB each, to phones (violates §19 "dependency drift").

**Approximate — chars/token heuristic.** The naive chars÷4 rule averages ~27.8% error vs tiktoken's
~0.2% (lune.dev/questions/6165, measuring text+code mix). A lightly calibrated heuristic does far
better: `tokenx` (MIT, 2 kB, zero deps) claims ~96% average accuracy against `o200k_base` using
per-script chars-per-token constants (CJK, Cyrillic, emoji handled separately)
(github.com/johannschopplich/tokenx). English prose sits near 4 chars/token; code and non-Latin
scripts are the outliers the calibration exists for.

**Provider-reported usage.** Every provider in scope returns actual counts in the response
(`usage.prompt_tokens` OpenAI-shape, `usage.input_tokens` Anthropic, `usageMetadata.promptTokenCount`
Gemini), and Anthropic/Gemini additionally expose free pre-call counting endpoints
(`/v1/messages/count_tokens`, `models.countTokens`). Exact — but post-hoc arrives after the call,
and the counting endpoints are network I/O.

**What is true:** exact-everywhere is impossible without per-model tokenizer data; a calibrated
heuristic is ~2 kB-class and ~4–15% off; provider usage is free ground truth after every call.

**What is uncertain:** heuristic error on this system's actual mix (prompt sections are
markdown+code-heavy, worse than prose); tokenx's 96% is measured against o200k only.

**What it constrains:** §8.1 says `assemble` is **pure, no I/O** — the counting endpoints are
therefore ineligible for budget enforcement, whatever their accuracy. And §8.5 requires
degradation to be **deterministic**: the estimator must be a pure function of section content,
which a heuristic trivially is.

### B.2 Recommendation for v1

**Calibrated heuristic at assemble time; provider-reported usage as the feedback loop.**

- A pure `estimate_tokens(&str) -> u32`: per-script chars-per-token table in the tokenx style,
  ~a page of Rust, zero deps, zero data files. Fixed per-part surcharges for non-text parts
  (image ≈ provider-documented tile/patch cost, done in the renderer's cost table; audio/file
  likewise).
- After every call, compare the estimate against reported `usage` and keep a per-model correction
  ratio (EMA) in state. The estimator stays pure — the ratio is an *input* to `assemble` like any
  other state, so determinism and golden tests (§8.7) hold.
- Enforce budgets with headroom instead of precision: set the assembly budget at ≤80% of the
  model's context window. §8.5 budget enforcement does not need exactness — it needs **monotone,
  deterministic, never-overflow**. With 20% headroom, even a 15% underestimate cannot overflow the
  real window, and compaction order (Full→Summarized→Pointer→Elided) is unaffected by absolute
  error since all sections are measured with the same ruler.
- Do **not** ship tiktoken in v1. Revisit only if calibrated error observed via usage feedback
  exceeds ~20% on real traffic — then prefer `gpt-tokenizer`-class data (~50 KB code + one
  encoding) for OpenAI targets only, keeping the heuristic elsewhere.

---

## Summary for RESEARCH.md

- R2A: universal multimodal intersection is base64-inline; remote image URLs fail on Ollama + Gemini — canonical Part storage must be bytes, URL passthrough is an optimization.
- R2A: smallest render set = 3 targets: OpenAiChat (+capability flags covering OpenRouter/Ollama/vLLM), AnthropicMessages, GeminiGenerateContent; Responses API not needed in v1 (audio only lives on Chat Completions anyway).
- R2A: audio input exists nowhere on Anthropic/Ollama/Responses — Audio parts carry an optional transcript and degrade to text with a recorded ledger entry (I15 + §8.5), never silent drops.
- R2B: exact tokenization across providers means shipping N multi-MB tokenizers (tiktoken is OpenAI-only exact) — rejected; counting endpoints are I/O and assemble is pure — rejected.
- R2B v1: pure per-script chars/token heuristic (tokenx-style, ~96% claimed on o200k) + per-model EMA correction from provider-reported usage + budgets at ≤80% of context window.

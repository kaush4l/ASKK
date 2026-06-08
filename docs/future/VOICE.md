# Voice space assistant (FUTURE scope)

> **Status: FUTURE — not MVP.** This is a design sketch, not a build plan. Nothing
> here is implemented and nothing here should be built until the curated owner path
> (see [`../CURATION_STRATEGY.md`](../CURATION_STRATEGY.md)) reaches MVP. The current
> prototype is text-first; voice is an additive surface layered on the *existing*
> ReAct loop, not a redesign of it.

> "Humans are quicker at talking and faster at seeing things."

The intent: let the user *speak* a goal and *hear* the agent's answer, while the rich
visual artifact surface (chat transcript, workspace files, run inspector) stays the
primary place results live. Voice is a faster input/output channel onto the same
agent, not a separate agent.

See also: [`../VISION.md`](../VISION.md) for the product north star, and
[`../agent-prompting.md`](../agent-prompting.md) for how the loop already streams.

## Design stance: voice is a transducer, the loop is unchanged

The single most important constraint: **voice does not touch the ReAct loop, the
orchestrator, or prompt assembly.** Speech-to-text (STT) produces the same `goal`
string the chat box produces today; text-to-speech (TTS) consumes the same streamed
answer text the chat panel already renders. Voice sits *at the edges* of the existing
pipeline:

```
mic ──STT──▶ goal:String ──▶ [unchanged ReAct loop + streaming provider] ──▶ answer text ──TTS──▶ speaker
                                                                              │
                                                                              └──▶ visual artifact surface (unchanged)
```

This respects the invariants: the loop stays a typed FSM (invariant 1); voice adds no
new control flow inside it; spoken tool results are still untrusted **data** (invariant
3) — we never let transcribed audio or a spoken web result be treated as a command,
exactly as today.

## Two technology paths

### Path A — Web Speech API (browser-native, zero dependency)

The browser ships `SpeechRecognition` (STT) and `SpeechSynthesis` (TTS) via
`web-sys` / `wasm-bindgen`. This is the natural first step because it adds **no new
provider, no new key, no new network call**, and stays inside the client-only,
BYOK-respecting model ASKK is built on.

- **STT:** `webkitSpeechRecognition` / `SpeechRecognition` yields interim and final
  transcripts as events. The final transcript becomes the `goal`.
- **TTS:** `SpeechSynthesisUtterance` + `speechSynthesis.speak()` reads answer text
  aloud, with selectable `voice`, `rate`, and `pitch`.

Trade-offs:

- **Pros:** zero dependencies (a core ASKK value), no extra key, no audio leaves the
  device for TTS, works on the hosted static page.
- **Cons:** quality and availability vary by browser/OS (strongest on Chrome; Firefox
  STT is weak/absent); some implementations route audio to a vendor cloud anyway, so
  the privacy story must be *disclosed*, not assumed; limited control over latency and
  voices.

Per invariant 4/5, all of this `web-sys` usage lives behind a `platform` capability
(a `VoiceCapability` trait), so `core` never imports `web-sys` and a native target
could later supply its own implementation.

### Path B — streaming STT/TTS providers (BYOK, higher quality)

For users who want better quality or consistent cross-browser behavior, voice becomes
*another BYOK provider class*, mirroring how LLM providers already work: a
`VoiceProvider` trait with concrete impls (e.g. an OpenAI-compatible
transcription/speech endpoint, Deepgram, ElevenLabs), selected and keyed exactly like
`ProviderProfile` is today ([`../../src/state/provider.rs`](../../src/state/provider.rs)).

- **Streaming STT:** open a WebSocket / chunked-fetch to the provider, push mic audio
  frames, receive partial transcripts. The final transcript becomes the `goal`.
- **Streaming TTS:** send answer text (ideally *as it streams* from the LLM — see
  below), receive audio chunks, play them through `AudioContext`.

Trade-offs:

- **Pros:** higher quality, consistent across browsers, real control over latency and
  voice; fits the existing BYOK + profile mental model.
- **Cons:** another key to manage (same client-side disclosure rules as LLM keys,
  invariant 6 — never log it, never put it in a URL), audio *does* leave the device, a
  new dependency/transport to maintain.

**Recommended sequencing:** ship Path A first (it is free and proves the UX), and add
Path B as an opt-in provider once the interaction model is validated. Both paths
produce/consume the same `goal` string and the same answer text, so the loop never
learns which one is active.

## How voice plugs into streaming

ASKK already streams partial answers. `InferenceProvider::invoke_react_streaming`
takes an `on_partial_answer: &mut dyn FnMut(String)` callback
([`../../src/inference/mod.rs`](../../src/inference/mod.rs)), and the OpenAI-compatible
provider drives it from SSE deltas
([`../../src/inference/openai.rs`](../../src/inference/openai.rs),
`send_chat_completion_stream` in
[`../../src/inference/transport.rs`](../../src/inference/transport.rs)). The chat panel
renders those partials live today.

Voice reuses that exact hook. The same `on_partial_answer` callback that updates the
visual transcript also feeds TTS:

- **Path A (Web Speech):** buffer partials into sentence-ish chunks and enqueue each
  as a `SpeechSynthesisUtterance` so the user hears the answer *as it forms*, rather
  than waiting for the full turn. (Web Speech has no token-stream input, so we
  chunk on sentence boundaries.)
- **Path B (streaming TTS provider):** forward partial text to the TTS stream as it
  arrives, for true low-latency spoken streaming.

Critically, **the callback is shared, not replaced** — visual rendering and spoken
output are two consumers of one partial-answer stream. The visual surface never goes
away because voice is on. No change to `inference/`'s trait or transport is required;
voice subscribes alongside the existing UI consumer.

Tool-call turns (the ReAct `action: tool` steps) produce observations, not answers, so
they are *not* spoken by default — only the final `action: answer` text is. The voice
layer may optionally announce short status cues ("searching the web…") derived from
emitted run events, but tool *observations themselves* are never read aloud as
authoritative speech, keeping the untrusted-data boundary (invariant 3) intact.

## Push-to-talk vs continuous

Two interaction modes, both worth supporting; default to push-to-talk for safety and
clarity:

- **Push-to-talk (default, recommended for MVP-of-voice):** the user holds a key or
  presses a mic button to speak; release ends the utterance and submits the `goal`.
  Deterministic, no hot-mic privacy surprise, no accidental triggers. Best fit for the
  approval-gated model — the user is deliberately initiating.
- **Continuous / wake-driven (later):** the mic stays open; a wake phrase or
  voice-activity detection segments utterances. Faster for back-and-forth, but it is a
  standing privacy cost (the mic is always live) and risks mis-triggering tool runs.
  Because every destructive write and outbound fetch is still approval-gated
  (invariant 7), continuous listening cannot *act* without the gate — but it should
  still be an explicit opt-in, off by default, and clearly indicated when live.

A barge-in affordance (start speaking to interrupt TTS playback) is desirable in
continuous mode and should pause `speechSynthesis` / the TTS audio stream when the mic
detects speech.

## Coexistence with the visual artifact surface

Voice is **additive**, never a replacement. The principle "humans are faster at seeing
things" means the screen stays the source of truth for anything dense:

- **Spoken output is a summary channel; the screen is the record.** Long answers, code
  blocks, file diffs, tables, and run traces are *shown*, not read aloud in full. TTS
  may read a short spoken synthesis ("I updated three files; the test passes") while
  the full artifact lands in the transcript / workspace.
- **Everything spoken is also written.** Every transcribed `goal` appears in the chat
  transcript as the user turn; every spoken answer is the same text rendered visually.
  There is no audio-only state — the visual surface is always a complete record, which
  also keeps the agent auditable.
- **Visual cues for voice state.** A mic indicator (idle / listening / transcribing)
  and a speaking indicator, plus a live interim-transcript display so the user can see
  what was heard before it is submitted (catch mis-hearings before they become a
  goal).
- **The workspace IDE and inspector are untouched.** Files, the run inspector, and the
  event log remain visual-only. Voice never tries to narrate a file tree.

## Where the pieces would live (boundary sketch)

- **`platform` crate:** a `VoiceCapability` trait wrapping `web-sys`
  `SpeechRecognition` / `SpeechSynthesis` (Path A) behind
  `#[cfg(target_arch = "wasm32")]`, keeping `web-sys` out of `core` (invariants 4/5).
- **`providers` (Path B):** a `VoiceProvider` trait + concrete BYOK impls, keyed and
  profiled like LLM providers, with the same key-handling rules (invariant 6).
- **UI (`src/components/`):** a voice control (mic button / push-to-talk, voice-state
  indicators, interim transcript) that submits the transcribed `goal` through the
  *same* path the chat box uses, and subscribes to the *same* `on_partial_answer`
  stream for TTS.
- **`core` / engine / orchestrator / `agent_prompt`:** **no changes.** They never learn
  that input arrived by voice or that output is being spoken.

## Explicit non-goals (for the future build, when it happens)

- No always-listening default. Push-to-talk first; continuous is opt-in.
- No voice-driven approval bypass. Spoken intent does not relax invariant 7 — the
  approval gate still asks.
- No reading untrusted content as authoritative. Tool observations and fetched web
  text are not spoken as the agent's voice (invariant 3).
- No redesign of the ReAct loop or streaming contract. Voice subscribes to what
  exists.

# INVARIANTS

Hard invariants. Reference by ID in every module spec. Source: `docs/PROMPT.md` §12.

- **I1 Static.** Builds to static assets; no server runtime required to function.
- **I2 Local.** All user data lives in browser storage; outbound traffic only to configured endpoints.
  **One exception, and it is a user's own key press:** pressing *Dictate* in the composer hands
  microphone audio to the browser's speech service, which in Chrome is Google's. Nobody configured
  that endpoint and nobody can point it elsewhere. It is opt-in per press, it is off until pressed,
  and the control says so on screen beside itself — see the I5 exception below for why it is here
  at all, and `docs/ALIGNMENT.md` §7.2 for the port that removes it.
- **I3 Pure core.** Core crates test on the host with no browser, no Wasm, no network.
- **I4 One seam.** All UI interaction goes through `handle(Request) -> Response`.
- **I5 Dumb frontend.** No application logic in JS. A behavior needing JS needs a reason in writing.

  **The reason, in writing — voice (increment 19).** Two browser APIs are used and no others:
  `SpeechRecognition`, to put dictated words in the composer's draft, and `speechSynthesis`, to read
  an answer aloud on request. Both are called from Rust through `web-sys`; the only JavaScript is
  one line in `web/index.html` aliasing Chrome's `webkitSpeechRecognition` onto the standard name,
  which is a spelling, not a behaviour.

  *Why it is confined to `crates/ui`.* Voice touches neither the agent loop nor the seam. Dictation
  writes the same draft typing writes and stops there — the person still presses Send. Speaking
  reads text the core already rendered. No `Request`, no `Response`, no event kind, no tool: I4
  stands and the pure core still tests on the host with no browser (I3). The code lives in
  `crates/ui/src/composer/voice.rs` and its one child, reachable from nothing else in the tree.

  *What it must never grow into.* No always-on listening, no wake word, no auto-send, no reading a
  reply nobody asked to hear, no voice in the agent's own toolset, and nothing that makes a turn
  depend on a microphone. The moment voice wants to be a capability the agent can *use* rather than
  a way a person types, it stops being an I5 exception and becomes a port.

  *The upgrade path.* `ModelPort` roles for transcription and speech, so voice is BYO-endpoint like
  every other model call and the exception above disappears with the API it excuses
  (`docs/ALIGNMENT.md` §7.2). Not built here; recorded there.
- **I6 Capability-gated, default deny.** Modules receive nothing they were not granted; secrets never
  enter a module's environment.
- **I7 Deterministic core.** `step()` is pure; time, randomness, IDs, and network are injected.
- **I8 Observable.** Every transition emits an event; every view is a projection of the log.
- **I9 Uniform modules.** Built-in and forged modules are indistinguishable to the system.
- **I10 Reversible.** Every installation, migration, and improvement can be undone.
- **I11 Updatable.** Any release is reachable by refresh, with migrations, without data loss.
- **I12 Small.** Files ≤ 200 lines. Functions ≤ 40 lines. Enforced by
  `scripts/check-size.py` over `crates/*/src` (files; `--functions` reports the
  function rule, not yet gated) and by `scripts/check-selectors.py` over `web/`.
  Integration tests under `crates/*/tests` are out of scope, as they have been
  since G4.
- **I13 Sectioned context.** Nothing reaches a model except as an assembled Document. No ad-hoc string
  building anywhere in the codebase.
- **I14 Pure assembly.** `assemble` is deterministic and golden-tested; declared-static sections render
  byte-identically.
- **I15 Degradable.** Every capability may be absent; the environment advertises only what is actually
  available and never breaks when a substrate is missing.

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
- **I16 Stated truth (PROVISIONAL — the owner may strike it).** A truth the system holds and
  does not state is a defect, whether or not anything is wrong underneath it.

  It is the converse of `docs/CRITIQUE-04.md`'s through-line, and the pair is the whole idea:
  *an assertion that a capability resolves is not an assertion that its description is true*,
  **and** a truth never asserted is not a safe default — it is a lie of omission that the
  model then reasons from. A model told nothing about a constraint does not treat it as
  unknown; it treats it as absent, and plans accordingly.

  Five instances were open when this was written, and they differ in depth rather than kind:
  prose describing a computer we do not ship (T20), a block true of the agent and false of the
  turn (T25), four true things about the workspace the agent is never told (T48), a
  verification ceiling nobody stated (T50), and a freeze exemption whose precondition can
  vanish silently (T52). Every one of them ships green. That is the point: **no test in this
  tree asserted PROSE against the MACHINE**, so the class was unfalsifiable and accumulated
  without one red gate.

  *What it demands.* Where the system holds a fact in a form a machine can read, the prose
  shown to a model or a person must be checkable against it, and checked. Where it holds a
  fact only in prose — a comment, a doc, a Dockerfile — that is the defect to fix first: a
  truth no test can reach is a truth that will drift. `image/Dockerfile:25-40` is the worked
  example. It carries a complete, correct, carefully argued inventory of every binary the
  guest has, and it is a COMMENT, so neither the model nor the suite can read it.

  *What it does not demand.* Not that everything true be said — a prompt is a budget, and
  saying everything is its own failure. It demands that what IS said be true, and that a fact
  the system depends on the reader knowing be said at all.

  *The boundary, as a worked example — the law needs one or it will be misread.* This does NOT
  say "delete every sentence about a capability we lack". `crates/core/src/files/permitted.rs`
  carries a live `durable == true` arm reading *"What is written there survives a reload."* It
  is unreachable in this build, because this guest does not persist and the owner has ruled
  that permanently. **It stays.** `WorkspacePort::durable()` is a PORT CONTRACT, not a
  constant: the ruling is that THIS GUEST does not persist, not that no workspace port ever
  could. Deleting the true branch of a correctly-gated conditional would encode a product
  ruling into a port abstraction, and the next engine would rediscover it by being surprised.
  **A string gated on a fact is what this invariant asks for; a string gated on nothing is what
  it forbids.** The test is not whether a sentence could be false — it is whether anything
  checks before saying it.

  *The honest limit, recorded with the law.* Checking prose against a DECLARATION is not
  checking the declaration against REALITY. `crates/agent/src/environment.rs` says what the
  guest contains; only the image can settle whether that is so, and confirming it needs a
  build this project has deliberately frozen. So this invariant closes the gap between what we
  say and what we have written down, and leaves open the gap between what we have written down
  and what we ship. Naming that second gap is part of obeying the first.

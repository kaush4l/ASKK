# INVARIANTS

Hard invariants. Reference by ID in every module spec. A violation is a bug,
not a preference.

**This file was rewritten for the JavaScript build on 2026-08-25.** The Rust
tree's version is reachable at tag `pre-rewrite-js`. Every change from it is
recorded at the bottom under *What changed and why*, because an invariant that
is quietly relaxed is worse than one that was never written.

---

- **I1 Static.** The product builds to static assets. No server runtime is
  required for it to function, and no feature may be added that needs one.

- **I2 Local.** All user data lives in browser storage. Outbound traffic goes
  only to endpoints the person configured.
  *One exception, and it is a key press:* pressing **Dictate** hands microphone
  audio to the browser's speech service. Nobody configured that endpoint and
  nobody can point it elsewhere. It is off until pressed, opt-in per press, and
  the control says so on screen beside itself.

- **I3 Pure core.** Every package except `adapters-web` and `apps/web` runs and
  tests on the host with `bun test` — no browser, no DOM, no network. The gate
  executes this: a package that imports a browser global fails it.

- **I4 One seam.** All UI interaction goes through `handle(request) -> response`.
  There is no second door, and no component may reach into state directly.

- **I5 Dumb frontend.** A `Response` carries a NAMED TYPED PROJECTION. The UI
  renders `data`; it may not compute it. A view that needs a number the core did
  not send is a core bug. Presentation belongs to the UI, and every fact in it
  belongs to the core — a component that derives a status, sorts a transcript,
  or counts anything has taken work that the log is the authority on.

- **I6 Capability-gated, default deny.** A module receives nothing it was not
  granted, and the grant is the intersection of what it asked for with what this
  build offers. Secrets never enter a module's environment: no capability
  carries a credential, and the brokered ports attach them downstream of every
  grant.

- **I7 Deterministic core.** `step()` is pure. Time, randomness, ids, and
  network are injected. A test that reads a real clock or draws real random
  bytes has failed this before it has run.

- **I8 Observable.** Every transition emits a fact. Every view is a projection
  of the log. State that is not a fold of facts is state that will disagree with
  the history a person is reading.

- **I9 Uniform modules.** Built-in and authored modules are indistinguishable to
  the system. No manifest field records origin — that absence is the invariant.

- **I10 Reversible.** Every installation, migration, and improvement can be
  undone.

- **I11 Updatable.** Any release is reachable by refresh, with migrations, with
  no data loss.

- **I12 Small.** Files ≤ 200 lines. Functions ≤ 40 lines. Enforced by
  `scripts-js/check-size.js` over `packages/` and `apps/`, in the gate.

- **I13 Sectioned context.** Nothing reaches a model except as an assembled
  Document. No ad-hoc string building anywhere in the codebase.

- **I14 Pure assembly.** Assembly is deterministic and golden-tested. Components
  declared static render byte-identically across runs.

- **I15 Degradable.** Every capability may be absent. The environment advertises
  only what is actually available and never breaks when a substrate is missing.
  A port that cannot stream simply never calls `onDelta`.

- **I16 Stated truth.** A truth the system holds and does not state is a defect,
  whether or not anything is wrong underneath it. Where the system holds a fact
  in a form a machine can read, the prose shown to a model or a person must be
  checkable against it, and checked. Where it holds a fact only in prose — a
  comment, a doc — that is the defect to fix first: a truth no test can reach is
  a truth that will drift.

- **I17 Executable gate.** A claim the gate cannot execute is not a verified
  claim. `bun run gate` is the whole standard, and every sentence in it either
  runs or is deleted.

- **I18 Versioned facts.** Every persisted fact carries an envelope version.
  A reader that cannot understand a record says which record and why; it never
  drops it and never guesses. Adding a field is additive by construction — the
  payload is a nested object, so it cannot collide with the envelope.

- **I19 Typed at the boundary.** Every module is checked by `tsc --checkJs`
  under `strict`. `any` is a defect with a written reason or it is a bug. The
  source that runs is the source that ships: no package below the UI has a
  build step.

---

## What changed and why

| ID | Rust build | JavaScript build | Why |
|---|---|---|---|
| I3 | "no browser, no Wasm, no network" | same, plus the gate executes it | The claim was prose; now a package importing `window` fails the gate. |
| I5 | "No application logic in JS" | "The UI renders `data`; it may not compute it" | The old wording was about a language. The real rule is about a direction, and it is now stricter: the core owes the UI every fact it renders. |
| I5 | HTML fragments cross the seam | Named typed projections cross the seam | Shipping markup out of a state machine puts the design system inside the core and makes every visual change a core change. |
| I12 | files ≤ 200, functions ≤ 40 (function half not gated) | both halves gated | An ungated half of a standard is not a standard (I17). |
| I18 | — | new | The predecessor's closed enum bricked a browser on any field added without a serde default. It is a migration hazard that structure can remove, so structure removes it. |
| I19 | — | new | Rust's type system was load-bearing. Dropping it without replacing it would be the rewrite's one unforced error. |
| — | I2's voice exception | unchanged | Still true, still opt-in, still stated on screen. |

## What was retired

Nothing. Every Rust-era invariant survives in some form; two were sharpened and
two were added.

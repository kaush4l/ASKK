# LESSONS — what the two prior trees prove

> Working note for the architect and standing ammunition for the ringmaster.
> ASKK contributes the **core**. Powerhouse contributes the **shape** and a
> catalogue of exactly how this kind of system rots.

## The overlap is the answer

Both trees independently converged on the same prompt architecture — an integer
`Slot` order, components that render/elide/hash themselves, an assembler with
executable invariants, and a response class whose `FIELDS` table generates both
the prompt instructions and the parser. Two teams arriving at the same design
from different directions is the strongest evidence available that it is right.

Where they differ, ASKK is further along: a **validated** flow graph (powerhouse
encodes edges inside `run()` bodies, so a typo is a runtime surprise), real
batch semantics, a real gate, and real golden fixtures.

**Ruling: the core comes from ASKK. The shell comes from powerhouse. Neither is
copied whole.**

## The nine defects to design against

Each is a real, located failure in powerhouse. Each becomes a rule.

1. **Realm-duplicated singletons.** `db.js` guarded with
   `if (typeof window === 'undefined') return null;`, intending to skip the
   database outside a browser.
   > **CORRECTED 2026-08-28 by measurement — see `MEASURED.md` M3.** That guard
   > does not survive the build. webpack folds `typeof window` to a constant
   > and eliminates the branch, so the shipped worker chunk calls `openDB`
   > unconditionally. Powerhouse's worker **did** have IndexedDB; the
   > "amnesiac loop" diagnosis was read from source and is false in the
   > artifact. What remains true and worse: the guard is decorative, it
   > protects nothing, and it vanishes in the realm you most need it in.
   → **RULE: never branch on `typeof window`.** It is not a runtime check; it
   is a token the bundler substitutes before your code runs. Determine realm by
   *physics* instead — `localStorage` is genuinely absent in a worker and
   `indexedDB` genuinely present, both measured, and neither foldable.
   → **RULE: every singleton names its owning realm, in writing**, and the
   check that enforces it greps **source**, not the bundle — the bundle will
   never contain the idiom.

2. **A method that does not exist, called defensively.** Every phase read
   `ResponseContract.of ? ResponseContract.of(X) : new ResponseContract()`.
   `of` was never defined, so *every* phase silently shipped an empty response
   contract and the model was never told the format.
   → **RULE: no defensive `x.y ? x.y() : fallback` on our own code. If it is
   our API, call it. A missing method must crash.**

3. **The harness lied to its model.** An "Alpine WASM container" with an empty
   asset directory, no `WebAssembly` call anywhere, and a `default:` branch
   returning **exit code 0** with `Executed: <cmd>` for every unrecognised
   command. The default space recorded the fake runtime as a *fact the model
   reads*. A "transformers" inference class that imported no library and
   string-matched the prompt.
   → **RULE: the harness never tells the model something it has not done. An
   unimplemented capability is absent, not stubbed. A stub that returns success
   is the worst artifact this project can produce.**

4. **A sandbox that is not one.** `new AsyncFunction(...)` running in the page
   realm with full closure over `fetch`, `window`, `indexedDB` — the shadowed
   `console`/`Math`/`JSON` were only parameters — and a `Promise.race` timeout
   that cancels nothing, so `while(true)` freezes the tab permanently.
   → **RULE: isolation is structural or it is not claimed. A different realm
   with a different global object, or the word "sandbox" does not appear.**

5. **Tool declaration was advisory.** After honouring the agent's declared
   `tools:` list, the loader unconditionally re-registered every container and
   space tool. An agent could add capabilities but never withhold them.
   → **RULE: the declaration is authoritative. What is not named is not
   present.**

6. **Wired but dead.** Roughly a fifth of the logic layer: a `skills` store
   never read or written, `SkillCatalog`/`LoadedSkills` never constructed,
   `compact_at`/`keep_recent` threaded three layers deep to no compaction at
   all, four cron tools with no scheduler, `Tool.fromMCP` with no transport,
   `cacheable` declared and never read, `EXEC_REACT_STEP` with no caller.
   → **RULE: a declaration with no consumer is deleted, not kept for later.
   The gate counts orphans and fails on them.**

7. **A test suite that cannot fail.** The E2E driver had no `throw`, no
   `expect`, no non-zero exit — every check `console.log`ed its result and the
   script printed `All ... PASSED!` unconditionally. It would report PASS on a
   blank page. The unit suite touched no orchestration code at all.
   → **RULE: every check must be shown to fail. A new assertion is not accepted
   until someone has watched it go red.**

8. **The wrong answer returned.** `RespondPhase` computed the final answer,
   emitted it, and returned without storing it; the caller then returned the
   *verifier's evidence text* instead. And `WorkPhase` recorded `ok: true`
   unconditionally, so the verifier reviewed a report structurally incapable of
   reporting failure.
   → **RULE: a success flag that is never false is not a flag. Every status
   field must have a test that produces its failure value.**

9. **No streaming, in a UI built around a "Live Execution Stream."** Zero hits
   for `stream`/`ReadableStream` in the whole tree. Every turn was a silent
   block up to a 120s timeout followed by one event.
   → **RULE: streaming is a wave-2 requirement, not a later polish. A turn that
   shows nothing for thirty seconds is a broken turn regardless of its result.**

## Two Next.js traps this operator has already been bitten by

Both are present in powerhouse and both must be checked in a real browser
before anything is built on the shell:

- A **manual `<head>` in the App Router layout** — previously observed to stop
  Next's client runtime entirely.
- **`reactStrictMode: true`** with a static export — previously observed to stop
  this build flushing passive effects.

Also present: `Cross-Origin-Opener-Policy`/`Embedder-Policy` headers set on
every response to enable `SharedArrayBuffer` for a WASM runtime that did not
exist — which blocks any cross-origin subresource without CORP, silently
killing the Google-Fonts `@import` the stylesheet opened with.

## What to take from powerhouse, positively

- **`output: 'export'` + Bun + `idb`, and nothing else.** Two runtime deps
  beyond React was the right call and it held.
- **The block registry + slot layout shell.** A block is a one-line registry
  entry. Good idiom — but make the *grid* data-driven; powerhouse hard-coded
  four slot names, so the layout store could only swap contents inside a fixed
  frame.
- **The two best UI affordances in either tree: the prompt inspector and the
  "Prompt Context" tab** — both show the operator the actual bytes the model
  receives. Most harnesses never build this. Keep both, prominently.
- **Uniform store modules** — same subscriber set, same reconstruct-from-record
  shape, seven times over. Boring in the good way.
- **`Tool`'s three named constructors** — function, sub-agent, external
  protocol — behind one uniform call surface, and `call()` that never throws.

## Storage correction

Powerhouse stored the entire transcript as **one IndexedDB record**, so every
appended message was a read-modify-write of the whole array — quadratic over a
conversation and a lost-update race between overlapping turns.
→ **Messages are their own keyed store, appended.**

# MEASURED — facts, not assumptions

> Every line here was produced by running something in this environment on
> 2026-08-28. Nothing in this file is inferred. The probe is at
> `scratchpad/wprobe` (Next 15.5.24, `output: 'export'`, `basePath: '/ASKK'`,
> a worker constructed with `new Worker(new URL('./x.worker.js', import.meta.url), {type:'module'})`,
> served under `/ASKK/` and driven headless).

> **Compression, at the eleven-increment retro.** M1 and M5 are now asserted by
> `scripts/verify-worker.ts` on every deploy, so their bodies are pointers —
> a standing check is better evidence than a recorded probe. **M2 and M3 are
> kept in full: no check in this tree asserts either, and both are load-bearing.**
> M2 is why the engine may not use runtime ESM; M3 is why a realm is never
> feature-detected. A fact with no check is a fact that must stay written down.

## M1 — A module worker DOES survive static export at a subpath

**Superseded by a standing check.** `scripts/verify-worker.ts` asserts this on
every deploy: a worker loads, runs and replies from the built export served at
`/ASKK/`, with zero console errors. The one-off measurement is no longer the
evidence — the check is, and it runs every time rather than once.

## M2 — webpack DROPS `type: 'module'`

The emitted call site is, verbatim:

```js
new Worker(n.tu(new URL(n.p+n.u(424),n.b)),{type:void 0})
```

`{type: 'module'}` in source became `{type: void 0}` in the build — a
**classic** worker, not a module worker. It works because webpack has already
bundled the worker's whole dependency graph into one IIFE chunk.

**Consequence:** the engine worker cannot rely on runtime ESM at all — no
top-level `import`, no dynamic `import()` of application code, no import maps.
Everything the worker needs must be reachable statically at build time. Any
design that assumes a module worker is designing against something this
toolchain does not emit.

## M3 — `typeof window` is NOT a runtime check. It is a build-time constant.

**This overturns the premise of LESSONS defect 1.**

The probe worker's `typeof window !== "undefined"` compiled to the literal
`!0` — the whole chunk is:

```js
(()=>{"use strict";self.onmessage=e=>{self.postMessage({echo:e.data,
sentinel:"ZZ_WORKER_SENTINEL_ZZ",hasIDB:"undefined"!=typeof indexedDB,
hasLS:"undefined"!=typeof localStorage,hasWindow:!0})}})(),_N_E={};
```

`indexedDB` and `localStorage` were left as real runtime checks. **`window` was
substituted.** Confirmed against powerhouse's own shipped bundle: its source

```js
export async function getDB() {
  if (typeof window === 'undefined') return null;
  ...
}
```

compiles, in the **worker** chunk, to:

```js
async function r(){ return a || (a = openDB("powerhouse_db",2,{upgrade(e,t){...}})) }
```

The guard is **gone** — folded true, branch eliminated. `grep -c "typeof window"`
on that chunk returns **0**.

### What this means

1. **Powerhouse's worker DID have IndexedDB.** The "worker realm silently has
   no database, the ReAct loop is amnesiac" diagnosis was derived from source
   and is **false in the shipped artifact**. It has been corrected in
   `LESSONS.md`. The tree's *other* defects — the assertion-free E2E suite, the
   `ResponseContract.of` that never existed, the fake container returning exit
   0, the doubled Anthropic URL, `ok: true` unconditional — are independent and
   stand.
2. **The rule survives, and gets sharper.** `typeof window` is not a realm
   check; it is a token the bundler replaces before your code ever runs. It
   cannot protect anything, and it silently disappears in the realm you most
   need it in. **Never branch on it.**
3. **The realm map is now better justified, not worse.** It should rest on
   *physics* rather than on a guard: `localStorage` is genuinely absent in a
   worker (`hasLS: false`, a real runtime check that survived compilation), and
   `indexedDB` is genuinely present (`hasIDB: true`). Those are properties of
   the platform that no compiler can fold away.
4. **`checks/realm.ts` grepping SOURCE for `typeof window` is the right check**
   — precisely because the built output will never contain it. A check that
   grepped the bundle for that idiom would find nothing and pass forever.

### The generalised rule

> **A behaviour you have only read in source is not a measured behaviour.**
> Between the source and the realm sits a compiler that substitutes constants,
> eliminates branches, renames identifiers, and inlines strings. Any claim
> about what a bundled artifact does at runtime must be checked against the
> artifact.

This applies directly to the architecture's `checks/bundle.ts`, which greps
built main-thread chunks for a sentinel defined only in the core. The sentinel
must be chosen so the compiler cannot fold, inline, or rename it away — the
probe's own sentinel survived only because it was a string literal in a
`postMessage` payload.

## M4 — Toolchain present

`bun 1.4.0` · `node v22.22.3` · `tsc 5.9.3` · `next 15.5.24` ·
`docker 28.5.1` · `c2w` on PATH at `/opt/homebrew/bin/c2w`

Note: a prior finding in this operator's notes records Homebrew's `c2w` as
broken (deleted upstream tag). Presence on PATH is not proof it builds. Wave 5
must measure it before designing on it.

## M5 — `navigator.locks` works in the worker, under static export at a subpath

**Superseded by a standing check.** `scripts/verify-worker.ts` asserts all three
behaviours the election needs, including the one this probe did **not** test.

**The correction stays, because the lesson generalises.** This probe was
originally cited as proof that §7.3's single-writer election works. It is not.
Its callback *returned*, so the lock released — which is exactly why the
follow-up `{ifAvailable:true}` was granted. It measured that the **API** is
present and well-behaved in a classic worker; it did not measure the
**election**, because it did not implement one. `navigator.locks.request`
releases when the callback's promise settles, so the election must return a
promise that never resolves, and `verify-worker.ts` now asserts the case that
proves it: a second `{ifAvailable:true}` request made *while the first callback
is still pending* receives `null`.

> **A measurement proves what it did, not what you hoped it was about.** Citing
> a probe as evidence for a mechanism it never exercised is how a broken design
> acquires a defence. This one was caught in review; it would have shipped two
> tabs writing one database.

**Note the realm subtlety:** this worked in a *classic* worker (M2 — webpack
drops `type:'module'`). `navigator` is present there; `localStorage` is not.
Availability is per-API, not per-realm-tier, which is another reason a realm
cannot be inferred from any single global.


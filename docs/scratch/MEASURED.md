# MEASURED — facts, not assumptions

> Every line here was produced by running something in this environment on
> 2026-08-28. Nothing in this file is inferred. The probe is at
> `scratchpad/wprobe` (Next 15.5.24, `output: 'export'`, `basePath: '/ASKK'`,
> a worker constructed with `new Worker(new URL('./x.worker.js', import.meta.url), {type:'module'})`,
> served under `/ASKK/` and driven headless).

## M1 — A module worker DOES survive static export at a subpath

Built clean, served at `http://localhost:4599/ASKK/`, driven headless. The
worker loaded, ran, and replied:

```
{"echo":"ping","sentinel":"ZZ_WORKER_SENTINEL_ZZ","hasIDB":true,"hasLS":false,"hasWindow":true}
```

**Zero console errors.** The worker chunk was emitted as its own file
(`chunks/424.*.js`) and requested successfully under the basePath.

→ The realm map's central premise is **sound**. PLAN increment 1.5 is still
worth running as a regression guard, but it is no longer an open risk.

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

§7.3's two-tab single-writer election rests on Web Locks being available in a
dedicated worker. Measured, same probe harness, same `basePath=/ASKK` export:

```
{"hasLocks":true,
 "lockAcquired":true,
 "ifAvailable":true,
 "lockSteal":"correctly-null-when-held"}
```

Zero console errors. All three behaviours the election needs are present:

1. `navigator.locks.request(name, cb)` **grants** in a classic worker.
2. `{ifAvailable: true}` **grants** when the lock is free.
3. `{ifAvailable: true}` **yields `null`** when the lock is already held — the
   callback receives `null` rather than being granted a second time. This is the
   one that matters: it is how a second tab learns it is not the writer without
   blocking forever.

→ The single-writer election is viable as designed. §11's worse fallback is not
needed. PLAN 1.5 should still assert this so a browser regression is caught.

**Note the realm subtlety:** this worked in a *classic* worker (M2 — webpack
drops `type:'module'`). `navigator` is present there; `localStorage` is not.
Availability is per-API, not per-realm-tier, which is another reason a realm
cannot be inferred from any single global.

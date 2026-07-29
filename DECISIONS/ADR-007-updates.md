# ADR-007 — Update and versioning strategy

**Status:** Proposed — pends ADR-002 (transport: if Option A ever puts a service worker in the
request path, the caching SW described here is the same file and must stay a stateless
router) and ADR-005 (the migration ladder this ADR triggers).

## Context

"Updates by refresh" is a hard product requirement and a real subsystem (§2): you ship, the
user refreshes, they are current — while the app also stays installable and works offline.
I11 makes it law: any release reachable by refresh, with migrations, without data loss. §5
confines the service worker to **caching and updates only**. §7 adds the twist that makes
this subsystem load-bearing: L3 self-improvement — the agent's own compiled proposals, merged
via PR and built by CI — arrives through this exact channel. The update path is also the
self-improvement path; there is no second mechanism.

Prior art is concrete: the predecessor's `git show '80564a2:docs/askk-sw.js'` shipped
content-versioned chunk URLs (the URL embeds the content version, so a new build is a cache
miss by construction), a sha256-manifest asset cache (cached copy remembers the sha it was
fetched under; sha match serves with zero network; mismatch refetches; network failure with a
cached copy degrades to the cache — availability over freshness), and
`skipWaiting()`/`clients.claim()` for a one-reload activation. That worked; steal it.

## Options

**A — No service worker; HTTP caching only.** Zero SW tax, refresh trivially gets the newest
bytes. But GitHub Pages sends short-lived cache headers, so every load re-downloads the Wasm
binary (MBs) — and there is no offline at all, which fails "installable and cached" (§2)
outright. Not viable alone; listed because it is the null hypothesis the SW must beat.

**B — Version-manifest SW, cache-first, sha-addressed (preferred).** Build emits
`version.json`: `{app_version, assets: {path: sha256}}`. The SW serves all app assets
cache-first, keyed by sha; it fetches `version.json` `no-store` on activation and
periodically. New manifest ⇒ fetch changed assets (sha mismatch only — an unchanged Wasm
binary is zero bytes), populate a new cache, `skipWaiting` + `claim`, prompt-or-perform one
reload. Old caches deleted on activate. Offline = serve current cache, full stop.

**C — Workbox (or similar) precache library.** Solves B with maintained code. But it is a
build-time dependency plus generated runtime JS in the one place we promised holds no logic
we didn't write (I5, §13: dependencies are debt, this ships to phones). B is ~150 lines of
our own SW, and the predecessor already wrote and shipped the hard parts.

**Case against B (the preferred):** service workers are a debugging tax the project explicitly
wants to minimize — activation races, stale-SW-serving-stale-manifest loops, and the
double-load subtlety on first install are all real, and the predecessor's memory logs an
actual field bug (SW update dropping client state mid-session). B also makes "refresh" mean
"refresh, and the SW noticed" — a lie if the update check races the reload. Mitigations: the
SW stays a dumb cache with no state worth dropping (the Wasm Worker owns state, and it
survives an SW swap); `version.json` is always fetched `no-store` so there is no
stale-manifest loop; and the UI shows the running `app_version` so staleness is visible, not
silent.

## Decision (proposed)

Option B, stolen from the predecessor with the roles simplified (no ingress relay, no COI
injection — caching only, per §5):

- **Versioning:** monotonic `app_version` (date+counter or semver) baked into `version.json`
  and into the Wasm core at build time; `handle(get("/system/version"))` renders it so the
  dashboard shows what is actually running.
- **Invalidation:** sha-addressed. Asset identity is its hash, not its mtime; caches compare
  shas, never dates. Cache name includes `app_version`; activate deletes other caches.
- **Update flow:** detect (manifest poll) → fetch deltas → `skipWaiting`/`claim` → one
  reload. In-page "update available, refresh" affordance rather than silent mid-session swap
  — an agent mid-task should not have the floor moved under it.
- **Data migrations on skew:** the SW moves *code* only. On boot the core compares stored
  `meta/schema_version` against its own expectation and runs the ADR-005 ladder
  (export-snapshot first, forward-only, refuse-to-boot on downgrade). Code-newer-than-data is
  the normal update case; data-newer-than-code (user cleared SW but not storage, or a rolled
  back deploy) is the refuse-and-offer-export case. No migration logic in the SW, ever.
- **L3 self-improvement (§7):** an agent-authored PR that CI builds lands as… a new
  `version.json`. Identical path, identical gates, identical rollback (redeploy previous
  build; data untouched because migrations are decoupled and reversible via snapshot). The
  symmetry is the feature: no privileged self-update channel exists to secure or to break.
- **Scope discipline:** `web/sw.js` contains cache logic only — no routing to the core, no
  state, no message queues. If ADR-002 later flips transport to SW-as-router, that router
  clause is added *there* and this file's caching contract is unchanged.

## Consequences

- First visit works with no SW (plain fetch); second visit is installed and offline-capable.
  The bootstrap path costs nothing because the SW never sits between htmx and the core in v1.
- Every release must ship a correct `version.json`; the deploy script gates on it (the
  predecessor's `publish.sh` verified manifest-vs-disk byte sizes — keep that gate, add sha).
- Rollback of a bad release is a redeploy of the old build; clients converge on next refresh.
- The event log records `app_version` per session (I8), so "which version did this" is
  answerable from history.

## Reversal cost

Dropping the SW entirely (to Option A) is deleting one file and losing offline — hours, no
core impact, no data impact. Moving to Workbox is a rewrite of the same one file. The
decisions that would be expensive to reverse — where migrations run, and that L3 shares this
channel — are cheap *now* and were chosen for that: both live behind the §3 seam and ADR-005's
ladder, not in the SW.

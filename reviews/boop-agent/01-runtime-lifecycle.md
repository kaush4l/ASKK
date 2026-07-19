# 01 — Runtime & Lifecycle Review: boop-agent

Review unit 1 of 8. Scope: where boop runs, what keeps it alive, and what of
that survives a browser-only target. State lives in [02-state.md], sync in
[03-sync.md], LLM calls in [04-llm.md], the proactivity toolbox in
[05-proactivity.md].

## 1. Boop's runtime model

Boop is a Node ≥20 long-running daemon (`package.json:125`). One process hosts
everything: an Express HTTP server plus a `ws` WebSocketServer on `:3456`
(`server/index.ts:58,191,201`). At boot it starts six in-process
`setInterval` loops (`server/index.ts:37-41`):

| Loop | Interval | Source |
|---|---|---|
| Memory cleanup (decay/prune) | 6h | `server/memory/clean.ts:84` |
| Automation poll (croner cron parse, fire due automations) | 30s | `server/automations.ts:123` |
| Heartbeat stale-agent sweep (STALE_MS=15min, ORPHANED_MS=90s) | 60s | `server/heartbeat.ts:6-7,37` |
| Memory consolidation | 24h | `server/consolidation.ts:481` |
| Image GC | 12h | `server/images/clean.ts:5,171` |

Inbound proactivity (iMessage via Sendblue) arrives as webhooks, so the local
port must be publicly reachable — the README setup requires an ngrok tunnel
and the dev script re-registers the webhook every restart because free ngrok
rotates URLs (`README.md:46,156-161`). Electron optionally wraps the same
Node processes as spawned children (`electron/main.cjs:2,344`) — a shell
around the daemon, not a different runtime.

**What the daemon lifetime buys:** always-on proactivity (a 30s poll is one
`setInterval`), webhook receivability (a socket that is always listening),
and trivially cheap timers — every schedule is in-process, no external
scheduler, no persistence of "next run" beyond croner's computation.

**What it costs:** one always-on host that must stay awake (laptop lid down =
agent dead); single point of failure; a tunnel dependency for any inbound
event; and a hard single-process assumption — `ARCHITECTURE.md:258` states
outright that deploying multiple instances double-fires the automation loop
("add a lock in Convex or run a dedicated scheduler pod"). The scheduler's
correctness rests on there being exactly one of it.

## 2. Browser lifetime tiers — what survives where

The browser has no tier equivalent to "daemon". Each tier below is weaker
than the last; the design question is which boop responsibility lands on
which tier.

### 2a. Foreground tab (visible)

Full JS, real timers, WebSockets, workers. Everything boop's loops do runs
here unmodified — a 30s `setInterval` automation poll, a 60s sweep, croner
compiled to the browser. This is the strongest tier and ASKK already proves
its ceiling: a whole c2w/Bochs VM runs in a tab behind a SW relay.

Caveat the moment the tab is hidden: Chrome throttles timers in background
tabs to 1/s, and under **intensive throttling** (hidden >5min, chained
timers) `setTimeout`/`setInterval` wake at most ~once per minute. A 30s poll
degrades to ~60s in a backgrounded tab — acceptable for boop-style
automations (croner semantics are "fire when due", and a due check that runs
at 60s granularity still fires everything, just up to 30s late). Audible
tabs and pages holding a Web Lock get partial exemptions, but do not design
around exemptions.

### 2b. ServiceWorker

Event-driven only. The browser kills an idle SW aggressively (idle timeout
~30s, hard event-execution caps around 5min); there is **no** persistent
`setInterval` — a timer scheduled in a SW dies with the SW. A SW is not a
daemon; it is a wake target. It can be woken by:

- `fetch` (any page traffic — ASKK's SW ingress already lives on this),
- `push` (Web Push from a server, works with the page closed),
- `periodicsync` (Periodic Background Sync — see 2d),
- `message` from a client.

Boop's loops do not port to a SW. What ports is the *dispatch on wake*
pattern: on any wake event, read `nextRunAt` from storage, fire what is due.
ASKK's SW already carries timeout bookkeeping (queue orphan timeouts), so
"stateless, storage-backed, wake-driven" is the established local idiom.

### 2c. SharedWorker

Lives as long as **any** same-origin tab/window lives — the closest thing to
a mini-daemon the browser offers, and the natural home for a scheduler that
should survive individual tab refreshes. Two hard limits:

- **Platform support:** no SharedWorker in Chrome for Android (desktop
  Chrome/Firefox/Safari≥16 have it). Access-anywhere therefore cannot
  *require* it; it can only be an enhancement.
- It still dies when the last tab closes. It extends tab lifetime, it does
  not transcend it.

This tier is exactly ASKK's open ADR gate (SharedWorker refresh-survival
spike for VM re-extraction). Same verdict here: valuable, optional,
Chromium-desktop-first, never load-bearing.

### 2d. Closed browser

Dead, with two narrow exceptions:

- **Web Push** (`PushManager` + SW `push` event): a server-sent message wakes
  the SW even with no page open. Requires an external push service (the
  browser vendor's) and a server that sends — but from the app's side that
  server contact is an HTTPS API call, inside the user's constraint.
  Chrome/Firefox/Edge; Safari ≥16.4 for web apps added to Home Screen /
  with notification permission.
- **Periodic Background Sync** (`periodicsync`): Chromium-only, requires an
  installed PWA, interval is engagement-gated (in practice ≥12h and often
  less frequent), best-effort with no delivery guarantee. Useful as opportunistic
  catch-up, never as a scheduler.

Everything else — the 30s cron, the heartbeat sweep, the WS connection — is
simply off while the browser is closed.

### 2e. Multi-tab = boop's multi-instance hazard, mirrored

`ARCHITECTURE.md:258`'s double-fire warning reappears in the browser as soon
as two tabs are open: two tabs each running the 30s poll fire every
automation twice. The browser has a native fix boop lacks: the **Web Locks
API** (`navigator.locks.request("scheduler", ...)` — supported in all
modern engines). One tab wins the lock and runs the scheduler; the lock is
auto-released when that tab dies, and a waiting tab is promoted immediately.
Leader election is ~10 lines and structurally eliminates the hazard boop
documents as an open deployment footgun.

## 3. Honest limits table

| Boop capability | Best browser equivalent | Degradation |
|---|---|---|
| 30s automation poll, machine awake | Leader tab `setInterval` 30s | ~60s granularity when every tab is hidden (intensive throttling); fine for "fire when due" |
| 30s poll, app closed | Periodic Background Sync | Chromium-only, installed PWA, ≥hours not seconds, best-effort. **Cannot be guaranteed. Full stop.** |
| Receive webhooks (Sendblue inbound) | None. A browser cannot listen on a port. | **Impossible purely in-browser.** Substitutes: Web Push (needs a sending server), a client-initiated WebSocket to a relay (only while open), or poll-on-open. |
| Always-listening WS server on :3456 | Outbound WS *client* connection | Direction inverts: browser dials out. Alive only while a tab (or its SW, briefly) is. |
| Heartbeat sweep (60s, 15min/90s thresholds) | Leader-tab interval + on-wake sweep | Sweeps pause while closed; run a catch-up sweep on next open — staleness detection is late, not lost |
| 24h consolidation / 6h decay / 12h GC | On-open catch-up ("is it ≥24h since last run?") | Runs late, at next visit. For daily-scale jobs this is a non-issue |
| ngrok/Cloudflare tunnel | Not needed | Genuine *win*: no inbound surface, no tunnel rotation, no exposed port |
| Electron always-on wrapper | Installed PWA | PWA install gives an icon and (Chromium) periodicsync eligibility, not a background process |
| Single-process scheduler assumption (documented hazard) | Web Locks leader election | Genuine *win*: the browser primitive solves what boop punts on |

The two things a pure browser **cannot** do, ever: accept an unsolicited
inbound network connection, and guarantee any timer while the browser is
closed. Every architecture claiming otherwise is smuggling in a server.

## 4. Recommendation for the browser-only target

Three-layer lifecycle, weakest layer only ever *improves* on the guarantees
of the layer below it:

1. **Leader-elected tab scheduler (the workhorse).** All boop loops become
   one Web-Locks-guarded tick loop in whichever tab holds the `scheduler`
   lock. Persist `nextRunAt` per job (croner's `nextRun()` computes it —
   boop already uses exactly this at `server/automations.ts:32`); the tick
   fires everything with `nextRunAt <= now`. Interval jitter and throttling
   are harmless because due-ness lives in storage, not in the timer.
2. **Catch-up-on-open semantics (the honesty layer).** On every
   app open / SW wake / leader change: run all jobs whose `nextRunAt` is in
   the past, then advance `nextRunAt` croner-style past `now` (fire once per
   missed job, not once per missed occurrence — decide per job whether
   missed occurrences coalesce). Missed automations run late and visibly
   late; nothing silently vanishes. This is the load-bearing semantic change
   from boop: proactivity degrades from "on time" to "at next opportunity".
3. **SW as wake surface, SharedWorker as enhancement.** The SW handles
   `push` and `periodicsync` by running the same catch-up routine — it never
   owns schedules, it only triggers the storage-driven dispatch. A
   SharedWorker (where available) may host the leader loop so it survives
   tab refreshes — which is the same question as ASKK's open SharedWorker
   ADR gate, and this review is input to it, not a pre-emption of it.

**External-service boundary (per the user's constraint, API/WS calls only):**

- Wake-while-closed requires Web Push, i.e. an external push endpoint the
  app talks to over HTTPS and that can send on a schedule or on events.
  This is the only external dependency the lifecycle layer needs.
- Anything webhook-shaped (boop's Sendblue inbound) requires an external
  receiver that the browser then reaches by outbound poll, WS, or push —
  covered in [03-sync.md]/[05-proactivity.md].
- With zero external services the system is still coherent: it is boop with
  "always on" honestly replaced by "on whenever you are", which for a
  personal agent whose owner opens the app daily covers the 6h/12h/24h jobs
  entirely and delays only the 30s-class automations.

**Verdict:** boop's runtime model does not port; its *schedule semantics* do.
Drop the daemon, keep croner's `nextRunAt` math, move due-ness into storage,
elect a leader with Web Locks, and treat every wake event — timer, fetch,
push, periodicsync, tab open — as the same "dispatch what is due" entry
point. The browser forces the persistence-backed scheduler design that
boop's own ARCHITECTURE.md admits it needs anyway.

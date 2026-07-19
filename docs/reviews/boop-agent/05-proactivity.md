# 05 — Proactivity review

Scope: how boop-agent initiates work without a user message, and what each of
those mechanisms degrades to in a browser-only target where all state, logic,
and application live in the page and only fetch/WebSocket may leave it.
Siblings: 01 (app lifetime), 03 (leader election / sync), 04 (LLM + channel
polling). Cross-referenced, not duplicated.

## 1. What boop actually does

Boop has three distinct proactive mechanisms. All three assume a daemon that
never stops and (for one of them) a public HTTPS endpoint.

### 1a. Scheduled automations: cron rows + a 30s poll loop

- Rows live in Convex with `schedule` (cron expr), `timezone` (IANA),
  `nextRunAt`, `lastRunAt` (`server/automations.ts:39-48`, `97-101`).
- `nextRunFor()` evaluates the cron expression with the croner library in the
  stored IANA zone (`server/automations.ts:17-25`); falls back to the user's
  current timezone setting for pre-TZ rows (`server/automations.ts:93-96`).
- `startAutomationLoop()` polls every 30s (`server/automations.ts:123-128`);
  `tickAutomations()` selects `nextRunAt <= now` and fires each due row
  fire-and-forget (`server/automations.ts:104-121`).
- Each run spawns a fresh execution agent (`server/automations.ts:57-62`),
  records a run row, and texts the result to the user over iMessage when
  `notifyConversationId` is an `sms:` id (`server/automations.ts:70-81`).
- Wired at boot in `server/index.ts:38` alongside the heartbeat sweeper
  (`server/index.ts:39`, `server/heartbeat.ts:37-42`) that fails stale/orphaned
  agent rows after restarts.

This design is worth stealing regardless of substrate: schedule state is
*rows*, not in-memory timers. Restart-safe by construction — after any outage,
the very next tick sees every row whose `nextRunAt` passed during the gap and
runs it late ("catch-up"). The 30s loop is dumb on purpose; croner is only a
next-fire-time calculator, never a live timer.

### 1b. Event-driven: Gmail webhook → classifier → nudge

The genuinely "proactive" part — reacting to the world, not the clock:

- Composio `GMAIL_NEW_GMAIL_MESSAGE` trigger posts to a public webhook
  (`server/proactive-email.ts:18`, subscription bootstrap at
  `server/proactive-email.ts:346-359`, registered at boot only when a stable
  `PUBLIC_URL` exists — `server/index.ts:52-57`).
- A cheap haiku-class classifier (`server/proactive-email.ts:19`,
  `classifyEmailImportance` at `183`) decides important/ignore against user
  preferences; malformed JSON drops the email (`server/proactive-email.ts:240`).
- Important → the summary is injected into the interaction agent as a
  synthetic `[proactive notice]` turn, and the reply (or the raw summary as
  fallback) goes out via iMessage
  (`server/proactive-email.ts:291-322`).

### 1c. Self-modifying: the agent manages its own automations

`create_automation`, `list_automations`, `delete_automation` are LLM-facing
tools (`server/automation-tools.ts:23,99,131`), so "text me a digest every
morning" becomes a DB row mid-conversation. Schedule strings are validated
before insert (`server/automations.ts:27-37`).

### Verdict on boop's design

Simple, durable, correct — and 100% daemon-shaped. (a) needs a process awake
every 30s; (b) needs a routable HTTPS endpoint; delivery needs a paid iMessage
relay (Sendblue). None of that exists in a browser tab. The question is not
"how do we port this" but "what does each mechanism degrade to per tier of
browser liveness".

## 2. The browser proactive toolbox, audited

| Primitive | Works when | Browser support | Honest assessment |
|---|---|---|---|
| In-tab timers (`setTimeout`/`setInterval`) | Tab open | Universal | Full fidelity in a foreground tab. Background tabs are throttled: minimum ~1s, and Chrome collapses inactive-tab timers to ~1/min after 5 min (intensive throttling). A 30s poll loop in a backgrounded tab effectively becomes a ~1min loop — acceptable for minute-granularity automations. |
| Notification API | Tab or SW alive | Universal (desktop); iOS Safari only in installed PWA | Needs one-time permission. Delivery only; not a wake-up mechanism by itself. |
| **Web Push** (Push API + SW) | Tab closed, browser process running | Desktop Chrome/Edge/Firefox: yes, incl. all tabs closed while the browser runs. Safari macOS 16+: yes. iOS: 16.4+, **installed-to-homescreen PWA only** | The only way to wake app code with no tab open. Nuance 1: if the browser process itself isn't running, pushes queue at the push service until it is (Chrome on some platforms keeps a background process; don't rely on it — verify per-OS). Nuance 2: someone must *send* the push — a push service delivers it, but an external sender must call the push endpoint. That sender can be a dumb hosted scheduler (cron service, Supabase/DB function scheduler): schedule registered by the browser via one API call, payload is just "wake up", **all logic stays browser-side in the SW**. This preserves the target's constraint — outbound API calls only — at the cost of one thin external trigger. |
| Periodic Background Sync | Tab closed, installed PWA | **Chromium only**, gated on site-engagement score; requested interval is a floor, real cadence is best-effort and in practice ≥12h for most sites | A free bonus for daily-digest-class automations on Chrome. Never a foundation: not on Firefox/Safari, cadence not contractual. |
| Catch-up-on-open | Every app open | Universal | Recompute all `nextRunAt` on load; run everything that's past due, late. Zero external dependencies, works everywhere, and is exactly boop's own restart-recovery semantics promoted to the primary path. The reliable baseline. |
| Leader-tab polling | Any tab open | Universal | Event-driven proactivity without webhooks: the elected leader tab (see 03) polls HTTP APIs — Gmail `history.list`, Telegram `getUpdates` long-poll (see 04 for channel/CORS specifics). Replaces boop's webhook with pull; latency = poll interval instead of instant. |

Ruled out: inbound webhooks (a page has no listening socket), raw IMAP (no
arbitrary TCP from a page; HTTP APIs only).

## 3. Degradation ladder — the centerpiece

What each boop capability degrades to, per tier of browser liveness:

| Boop capability | Tab open | Tab closed, PWA installed, browser running | Browser fully closed |
|---|---|---|---|
| 30s automation loop | Same loop in the leader tab (~1min effective when backgrounded — fine for cron granularity) | Web Push from external scheduler wakes SW → SW runs the automation or shows "open me" notification; Periodic BG Sync as Chromium bonus | Nothing fires. Catch-up on next open runs all missed rows late |
| Gmail webhook watcher | Leader tab polls `history.list` (latency = interval) | Push-capable only if an external sender watches Gmail — that reintroduces a hosted watcher; honest answer: not available, degrade to catch-up | Catch-up classification of everything since `lastSeen` on open |
| Classifier → nudge | Classifier API call from tab; Notification API locally | SW shows notification from push payload, or SW makes the classifier call itself on wake | Deferred to open |
| iMessage result delivery | Notification API, or outbound API to a messaging service (§4) | Same via SW | Only server-sent channels (Telegram/ntfy called by the external trigger) reach the user — but with no logic running, there's nothing to send |
| Agent self-CRUD of automations | Identical: tool writes a row in local/synced store — pure data, ports 1:1 | n/a (rows are data; the runner tier is what varies) | n/a |
| Heartbeat/orphan sweep | On-load sweep (boop's own restart semantics, `server/heartbeat.ts:9-35`) — no live sweeper needed | — | — |

Reading the ladder honestly: **clock-driven proactivity survives every tier**
(degraded to late-on-open at worst; push-punctual with one external trigger).
**Event-driven proactivity with sub-minute latency requires either an open tab
or an external watcher** — there is no browser primitive that receives
third-party events with the browser closed. Say this in the product: "instant"
email reactions exist only while a tab lives or if the user opts into the
hosted trigger.

## 4. Delivery channels (iMessage substitute), ranked

1. **Notification API** — device-local, free, no account. First choice for
   tab-open and push tiers.
2. **Web Push** — same UX with the tab closed; carries the automation result
   in the payload.
3. **ntfy** (`POST https://ntfy.sh/<topic>`, CORS-open, no auth for public
   topics) — reaches the user's phone via the ntfy app; callable directly from
   the page or SW. Cheapest cross-device "text me" substitute.
4. **Telegram bot `sendMessage`** — `api.telegram.org` is CORS-callable from a
   page (verify: Bot API generally permits browser calls; token exposure in a
   local-first app is the user's own bot token — acceptable). Doubles as an
   *inbound* channel via `getUpdates` long-poll from the leader tab (see 04).
5. Email-out — only via a provider with a CORS-callable HTTP API; most
   transactional senders block browser origins. Verify per provider; not
   recommended.

Sendblue/iMessage has no browser-callable equivalent; drop it.

## 5. Recommendation

Adopt boop's schema, replace its runtime:

1. **Core (no external anything):** automations table (schedule, IANA tz,
   `nextRunAt`, `lastRunAt`, run rows) in the local/synced store, exactly
   boop's shape. Runner = leader-tab loop (03 owns election) with 30–60s
   ticks + **catch-up on every app open** as first-class semantics, not error
   recovery. Cron evaluation via a small vendored cron-parser (croner itself
   runs in browsers). Agent self-CRUD tools port unchanged — they are row
   writes.
2. **Event tier (still no external anything):** leader-tab polling of HTTP
   sources (04) feeding the same classifier → synthetic-turn → notification
   pipeline as boop's 1b.
3. **Opt-in "true proactive" tier:** SW + Web Push. Browser registers each
   automation's next fire time with a dumb hosted scheduler by one API call;
   scheduler's only job is to send an empty push at that time; SW wakes, runs
   the logic, renotifies. Logic and state never leave the browser — only the
   alarm clock is external. Periodic Background Sync layered on as a
   Chromium-only backstop for daily-class jobs. iOS users must install the
   PWA to participate in this tier at all.

The degradation ladder should be shown to the user in-product per automation:
"runs on time while a tab is open / on push if enabled / late on next open
otherwise." Boop never has to say this because its daemon never sleeps; a
browser app that hides it is lying.

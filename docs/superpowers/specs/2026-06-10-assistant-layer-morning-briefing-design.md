# Assistant layer — milestone 1: the morning-briefing slice

**Date:** 2026-06-10
**Status:** Approved (brainstorm complete; awaiting implementation plan)

## Context: where the project stands against the vision

ASKK's runtime vision — the whole backend living inside a browser tab — is largely
built or in flight: the ReAct engine and strategy layer, 13 registry-based tools,
in-browser MCP (module servers, shellized servers, in-process workspace server,
compiled user functions), multi-agent fan-out over Web Workers, the VS Code-style
workspace, and full snapshot persistence with reload-and-resume.

The gaps, ordered by how much exists today:

1. **General in-browser code execution** — seam built (`run_in_sandbox`,
   `BrowserExecutor`), substrate undecided (WASI shim / WASIX / container2wasm
   spikes in `experiments/`).
2. **Computer-access session** — exists as the dev bridge
   (`scripts/askk-local-bridge.mjs`) but currently documented as a crutch to sunset.
3. **Assistant layer** — planned (Phase 3 curation) but not started: no proactivity,
   no personal services, no durable personal context.
4. **Browser extension / tab co-browsing** — no trace.
5. **GPU/WebGPU compute** — no trace; docs scope it out.

## Decision: reprioritize the assistant layer first

The owner's daily-use blocker is the assistant layer, not code execution.
In-browser execution returns later as the capability behind a "programmer" persona.
`docs/VISION.md` should be updated to reflect this ordering when milestone 1 lands.

Decisions made during brainstorming:

- **Jobs to cover:** research/briefings, proactivity, personal memory, external
  services — all four, built incrementally.
- **Proactivity model:** pinned tab / installed PWA. An in-tab scheduler fires
  timers and Web Notifications while the tab lives; a catch-up pass on open covers
  time the tab was closed. No backend, no push service in v1.
- **Services path:** browser-direct tools (hand-built `fetch` + OAuth in the tab),
  not remote MCP, not bridge-proxied.
- **Services v1:** Gmail, Google Calendar, Telegram. Notion rejected (API blocks
  browser CORS).
- **Build sequence:** vertical slice first ("the morning briefing"), then deepen.

## Roadmap: assistant-layer sub-projects

Each sub-project gets its own spec → plan → implementation cycle.

1. **Morning-briefing slice** (this spec) — thin thread through scheduler,
   services, and persona.
2. **Deepen services** — Gmail send/draft and Calendar event creation (both
   approval-gated); Telegram inbound so the owner can message the assistant from a
   phone.
3. **Personal memory** — durable user-context store beyond per-agent rolling
   summaries.
4. **Assistant surface** — a briefing/dashboard home surface instead of chat-only.

Deferred, unchanged on the roadmap: execution substrate (Phase 1/2 docs),
browser extension, computer-access sessions, GPU.

## Milestone 1 design

### Principles

Everything rides existing extensibility contracts: new tools are registry
descriptors (no loop edits), the persona is a Markdown agent manifest, schedules
are snapshot data. The only genuinely new subsystem is the in-tab scheduler.
No new crates: Google and Telegram are plain `fetch` + serde; PKCE's SHA-256 comes
from SubtleCrypto.

### Components

**Schedule state — `src/state/schedule.rs`.** `ScheduleEntry`: id, kind (one-shot
reminder or recurring trigger), fire time or recurrence (M1 recurrence is
daily-at-local-time only — no cron syntax), payload (notification
text, or an agent goal to run), enabled flag, last-fired watermark. Persisted in
`AppSnapshot`, so entries survive reloads with no extra machinery.

**In-tab scheduler — new module beside the engine.** A coroutine ticks while the
tab lives (order of every 30 s), compares due entries against watermarks, and
fires effects: Web Notification, optional Telegram nudge, and/or enqueue an agent
run. On app start a catch-up pass fires anything missed while closed, deduped per
entry (one "missed briefing", never seven). Due/watermark/catch-up logic is pure
functions over an injected clock so it is host-testable.

**Google auth — `src/tools/google/`.** Google Identity Services token flow (PKCE,
no client secret). Access tokens stored in IndexedDB under existing BYOK rules:
origin-scoped, never logged, never in URLs, disclosed once. Scopes minimal and
read-only for M1: `gmail.readonly`, `calendar.readonly`. The OAuth app stays in
testing mode with the owner as sole test user, avoiding Google's restricted-scope
verification. Browser-app access tokens expire after ~1 hour: tools must surface
an explicit "reconnect Google" action, never fail silently.

**Service tools** (descriptor-registered like the existing 13):

- `gmail_search` — list/search messages, fetch bodies.
- `gcal_events` — upcoming events over a date range.
- `telegram_send` — Bot API send-message; bot token + chat id are BYOK config;
  approval-gated (it is an outbound write).

Telegram nudges reach the owner's phone; Web Notifications cover presence at the
computer. Both are fired from the open tab — neither implies background execution.

**Schedule management tool — `manage_schedule`.** Create / list / cancel schedule
entries from conversation ("remind me tomorrow at 9").

**Assistant persona — `agents/assistant.md` + a briefing skill.** Bundled,
default-enabled agent. Allowlist: the three service tools, `manage_schedule`,
`web_search`, `web_fetch`, and the file tools. The morning briefing is a skill
recipe (calendar today, unread-email summary, news on configured topics, pending
reminders) — data, not code.

**PWA manifest.** Installable app window; notification permission requested on
first schedule creation, not at startup. No service worker in v1 — an open tab
can show notifications without one; push-while-closed is a later sub-project.

### Data flow

Briefing: scheduler fires the daily trigger → enqueues a run for the assistant
persona with the briefing goal → ordinary ReAct run calls `gcal_events`,
`gmail_search`, `web_search`, `manage_schedule` (list) → composed briefing lands
in chat → Web Notification + optional one-line Telegram summary.

Reminder: scheduler fires a one-shot entry → notification (+ Telegram if
configured); no agent run unless the entry carries a goal.

### Security

- **Email is the canonical prompt-injection vector.** Message bodies enter the
  loop as untrusted tool-result data (invariant 3), exactly like fetched web
  pages. Required test case: an email instructing the agent to take an action
  must be summarized, not obeyed.
- **Reads are free; writes are gated** (invariant 7). M1 Google scopes are
  read-only, bounding the blast radius of a leaked token. `telegram_send` passes
  the approval gate.
- **Tokens** (Google access token, Telegram bot token) follow existing BYOK
  handling (invariant 6).

### Error handling

- Expired Google token → tool result and UI surface a one-click reconnect; no
  silent failure, no retry loop.
- Failed briefing run → ordinary failed agent run: visible in the event log,
  resumable like any other.
- Telegram or network failure → degrade to Web Notification only.
- Long tab closure → catch-up digest, deduped per recurring entry.

### Testing and acceptance

Host-side `cargo test`: scheduler due/watermark/catch-up logic with injected
clock; `ScheduleEntry` snapshot round-trip; Gmail/Calendar/Telegram response
parsing from fixture JSON; prompt-injection framing test for email bodies.

Verification gate as usual: `cargo fmt --check`, `clippy -D warnings`,
`cargo test`, `dx build --platform web`.

Browser smoke demos (acceptance criteria):

1. "Remind me in 2 minutes" in chat → entry visible, Web Notification fires.
2. Reload mid-schedule → entries persist; closing the tab past a fire time and
   reopening produces a catch-up notification.
3. End-to-end briefing against real Google + Telegram accounts: scheduled run
   produces calendar + email + news briefing in chat and a Telegram summary.

### Known risks

- **Hourly Google token expiry** in the SPA token model is the main UX friction;
  if re-auth prompts prove too annoying in a pinned tab, revisit (e.g. auth-code
  flow variants) in sub-project 2.
- **Telegram chat-id bootstrap** (the bot must learn where to send) needs a small
  guided setup in Tools/Settings.
- **Notification permission denial** must leave everything functional minus
  notifications (briefing still lands in chat).

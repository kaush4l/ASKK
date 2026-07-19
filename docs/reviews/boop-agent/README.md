# boop-agent review series

Study + architectural review of [raroque/boop-agent](https://github.com/raroque/boop-agent)
(MIT, v0.2.0, commit 3197913, 2026-07-13), targeting a browser-only rebuild:
state, application, and logic all in the browser; external contact limited to
API/WS calls. All boop claims carry file:line cites verified against that
commit.

## Reading order

| Doc | Question it answers |
|---|---|
| [00-study](00-study.md) | Where boop runs, where state lives, how it spans devices — the descriptive study |
| [01-runtime-lifecycle](01-runtime-lifecycle.md) | Daemon/timers → tab/SW/SharedWorker lifetimes, Web Locks leader election |
| [02-state-memory](02-state-memory.md) | Convex schema → IndexedDB/OPFS split, in-browser embeddings + cosine recall |
| [03-cross-device-sync](03-cross-device-sync.md) | No-sync-of-its-own → single-device-first, sync-ready schema, duty-sync (who runs the scheduler) |
| [04-llm-integrations](04-llm-integrations.md) | Subscription child-process runtimes → BYOK fetch+SSE transports; Composio → PKCE/polling |
| [05-proactivity](05-proactivity.md) | Cron rows + webhooks → the browser degradation ladder (tab open / PWA / closed) |
| [06-agent-loop-tools](06-agent-loop-tools.md) | Dispatcher/executor, RuntimeTool, draft gate → plain-JS loop in a Worker |
| [07-target-architecture](07-target-architecture.md) | **The synthesis**: component diagram, mapping/gap tables, mini-ADRs, placement, P0–P3 roadmap |

## Reconciled verdict

- **The study answers:** boop runs as one always-on Node daemon on one machine;
  truth lives in hosted Convex (13 tables); its "multi-device" is iMessage as
  the UI fabric plus Convex reactive dashboards — the agent brain itself is
  single-host.
- **What ports verbatim:** the agent loop, dispatcher/executor split with
  per-spawn tool scoping, draft-before-send gate, memory
  tier/segment/decay/consolidation model, append-only usage/log tables — all
  plain JS + fetch.
- **What must be replaced:** subscription child-process LLM runtimes → BYOK
  fetch (Anthropic browser-CORS header, OpenRouter, localhost, transformers.js
  tier); inbound webhooks → polling; iMessage → in-app chat + notifications +
  optional Telegram; Composio breadth → per-service PKCE, added as needed.
- **What is honestly lost:** closed-browser cron (mitigated by
  catch-up-on-open + optional push tier), instant webhook latency, Apple-native
  readers, flat-rate subscription billing.
- **Placement:** standalone zero-build PWA, borrowing ASKK patterns (SW shell,
  OPFS split, BYOK proxy, transformers.js) but not its VM runtime.
- **Phasing (canonical, from 07):** P0 chat+memory+BYOK LLM → P1 leader
  scheduler+drafts+notifications → P2 polling integrations (Gmail PKCE,
  Telegram) → P3 push tier + hosted sync spine. Where 03 says "phase 2" for
  the sync spine, 07's P3 numbering governs.

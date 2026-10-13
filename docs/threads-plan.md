# Engine threads: what they cost, how they run, and the plan

Measured 2026-10-11 on a Mac running two desks (idle).

## How engines run today

| Mode | Threads | Where state lives |
| --- | --- | --- |
| **local / desks (default)** | ONE Bun Worker per desk (`companion/team/team-worker.js`), every engine of the desk in-process in it. Not a thread per agent. | `custom/<desk>/memory/agents/<engine>/memory.md`, `artifacts.json`; state streamed to tabs as patches (SSE `team/stream`). |
| demo / `--browser-engines` | ONE Web Worker per engine per tab (`engine-proxy.js` → `engine-worker.js`). | OPFS in that browser. |
| headless `askk ask` | in-process, no workers. | the runtime folder. |

## Measured cost

- The desks process (Next dev server + Turbopack + 19 engines across two desks) has a **526 MB physical footprint (620 MB peak)** and 49 OS threads (Bun/JSC pool and GC, not one per engine).
- Engine memory files are 8–160 KB each (a 16-engine desk: 8.1 MB including histories).
- So in desk mode an idle engine is a JS object holding its message log, near-free. The Next dev compiler dominates the footprint.
- **The heavy path is per-tab mode.** Each Web Worker is its own JS realm that loads the whole engine bundle again: about 10–25 MB each. That is roughly 160–400 MB per tab for 16 agents, multiplied by every open tab, while about 90% of the agents sit idle.

Idle work that still runs: the supervisor tick (15 s), the wake book (30 s), any background code a desk starts on `listen`, the compaction check (before steps only), and a state patch per change to every tab.

## Plan: actors that hibernate (Durable Objects / Orleans grains)

An engine is either **awake** (in memory, has a letter or worked in the last N minutes) or **dormant** (definition + files on disk only). A letter wakes it, and the work wakes it with all of its context.

1. **Lossless save first.**
   - memory.md and artifacts.json are already saved every turn.
   - Add `inbox.jsonl` per engine: letters waiting and the open quests it handed out, written on deposit and settled on finish.
   - Then a dormant engine (and a restart) loses nothing. Today quests are not persisted across reloads.
2. **Desk mode: evict idle engines.**
   - After `idle_minutes` (default 20) with an empty inbox, the registry drops the engine object and keeps a stub: id, name, status `dormant`, last activity, memory size.
   - `deposit()` on a stub re-creates the engine (`restore()` from memory.md + inbox.jsonl) and then delivers.
   - The SSE snapshot sends stubs, not full message logs, so a new tab loads in KB.
   - Full messages are fetched when a tab opens that agent's chat.
3. **Tab mode: a worker pool, not a worker per engine.**
   - `min(4, hardwareConcurrency / 2)` workers.
   - An engine is placed on the least-busy worker when it wakes and leaves it when it goes dormant.
   - Engines already never block on each other (letters), so several share a thread safely.
   - The bundle loads per worker (4×), not per engine (16×).
4. **Keep lead/required engines warm:** the first agent in `index.json`, plus any agent with `warm: true` in agent.md.
5. **Measure.** Add to the status bar: the process footprint (`process.memoryUsage()` via `GET whoami`), awake vs dormant count, and per-engine memory size, so the owner sees the saving.

Order and risk:
- 1 is a prerequisite: without it eviction loses quests.
- 2 gives the biggest UI win (snapshot size).
- 3 is the biggest memory win for browser-only users.
- 4 and 5 are small.

None of this changes the letter or quest contract.

## Status

- Step 1 built (2026-10-11):
  - agent.md `inbox: keep` saves unsettled requests and quests to `agents/<engine>/inbox.json` (`backend/core/engine/inbox.js` `_keepLetter` / `_dropKept`, `Memory.saveInbox` / `loadInbox`).
  - `restore()` re-delivers them.
  - It is opt-in: a re-delivered run starts over, so agents whose tools act outside stay off.
  - Tested: save → settle → redeliver, and off by default.
- Step 2 built in a light form (2026-10-11): `ASKK_HIBERNATE_MINUTES` (off by default).
  - An idle engine keeps only its newest 20 messages in memory and in tab snapshots. memory.md keeps the full log, and the next letter loads it back before any work.
  - Clear and summarize wake it first.
  - The engine object stays; only its log is dropped.
  - Tested: sleep → persist skips → wake restores all messages; busy or waiting engines don't sleep.
  - On by default (30 min) on the server since 2026-10-11; `ASKK_HIBERNATE_MINUTES=0` turns it off. Live test: all 19 engines slept, a letter woke one with its full 40-message log.
- Steps 3–5 not built: the browser worker pool, warm flags and the status-bar meter.

## Done in this pass (live follow)

- Tools can now `record(fields)` onto their tool message (`backend/core/engine/tools-run.js`).
- `fs.write` / `fs.edit` / `fs.append` record `change: {path, created, added, removed, rows, cut}`. This is a folded whole-file line diff with file line numbers, computed from the exact text the tool replaced, capped at `LIMITS.diff.changeRows` (300) rows.
- It is persisted in memory.md (`META_FIELDS`), carried by the live feed, and rendered by `components/live/views/file-call.jsx` as GitHub-style +/− rows.
- Before this, the "before" text was read by the open tab and raced the write: missing when no tab was open, wrong when the write landed first, and fs.edit had no file line numbers. Old messages keep that fallback.
- Pause: clicking any call or the Following button stops the follow, and the list and the selected call stay put while new calls arrive.

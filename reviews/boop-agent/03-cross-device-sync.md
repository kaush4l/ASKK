# 03 — Cross-device & sync review: boop-agent

Siblings: runtime/lifecycle in `01-runtime-lifecycle.md`, storage engines in
`02-storage.md`, LLM dependency in `04-llm.md`. This document covers only how
boop reaches the user across devices, where shared truth lives, and what a
browser-only ASKK target should do instead.

## 1. How boop "does" cross-device: it doesn't

Boop has no sync layer of its own. It sidesteps the problem twice:

1. **The user interface is outsourced to iMessage.** The user's "device" is
   any Apple device signed into their Apple ID; Sendblue bridges iMessage to a
   webhook on one always-on Node host (`ARCHITECTURE.md:11`, replies chunked
   back out through Sendblue, `ARCHITECTURE.md:40`). Apple syncs the
   conversation across the user's phones/laptops; boop never sees a device.
2. **State sync is outsourced to a hosted DB.** Convex is the shared truth;
   any dashboard client — the Vite debug app or the Electron embed —
   subscribes reactively via the browser SDK (`ConvexReactClient`,
   `debug/src/main.tsx:3,25`; reactive queries called out as the reason for
   choosing Convex, `ARCHITECTURE.md:251`).

Elegant for a single-user template: two mature sync fabrics (Apple's and
Convex's) do all the work, and boop ships zero sync code. But the agent
*brain* — interaction agent, execution agents, automation scheduler — is
pinned to exactly one machine. Consequences:

- **Host down = agent gone.** iMessage still delivers, Convex still serves
  reads, but nothing thinks. Webhooks dropped while the host is down are lost
  turns.
- **Two hosts = double-fire.** The automation loop is an in-process
  `setInterval` (`server/automations.ts:123-128`) with no cross-instance
  lock; the repo warns explicitly: "If you deploy multiple instances, you'll
  double-fire — add a lock in Convex or run a dedicated scheduler pod"
  (`ARCHITECTURE.md:258`). Note the loop *reads* due rows, fires
  fire-and-forget, and only writes `nextRunAt` after the run completes
  (`server/automations.ts:97-121`) — so two hosts both see the same due row.
- **Local state diverges silently.** The ~1.3GB embedding model cache lives
  under the host's local data folder (`server/embeddings.ts:7,19-26`), the
  Patchright Chrome profile is a host directory (`server/browser/launcher.ts:325-328`),
  and `.env.local` plus the Claude/Codex CLI logins are per-machine
  (`README.md:11-12,201`). Move hosts and you re-download, re-login, and lose
  every browser session cookie. None of this is in Convex, so none of it
  syncs.

One nuance in boop's favor: it already contains the two primitives a
multi-writer world needs, just not applied to scheduling. The Sendblue
webhook dedup is a conditional-insert claim (`convex/sendblueDedup.ts:4-18`),
and agents have a stale-heartbeat sweep (`server/heartbeat.ts:30,39`). The
patterns exist; they guard against webhook retries and crashed agents, not
against a second host.

## 2. Browser-only options for ASKK, ranked

Constraint restated: app + logic + state run in the browser; external
services reachable only via API/WS calls. A **hosted DB is allowed** — what's
excluded is application logic running server-side. Boop's Convex *functions*
(mutations with logic in them) sit right on that line; the browser-only
version keeps the DB as dumb-ish storage/relay and moves all decisions into
the page.

| Rank | Option | What syncs | Cost of adoption | Failure/conflict story | Verdict |
|---|---|---|---|---|---|
| 1 | **Single-device-first** (IndexedDB/OPFS only; export/import if anything) | Nothing, by design | ~0 — matches ASKK today | None; state is where the tab is | Ship this first |
| 2 | **Hosted realtime DB as sync spine** (Convex browser SDK, Supabase Realtime, Firebase, InstantDB) | All tables, reactively, to every open browser | Account/auth, schema mirror, offline queue | Server-ordered writes; conflicts resolved by DB write order + per-row rules | Opt-in phase 2 |
| 3 | **CRDT + dumb relay** (Yjs/Automerge over any WS relay or WebRTC) | Document state, merge-free | Largest: CRDT types per table, relay hosting, compaction | True local-first; automatic merges for sets/maps/text, painful for counters and schedules | Only if offline-first multi-writer becomes a real requirement |

**2a. Hosted realtime DB as sync spine.** Every browser runs the full app;
the DB only stores rows and pushes change notifications. This is boop's
Convex usage minus the Node host — the same reactive-subscription model the
debug dashboard already proves works from a plain browser client
(`debug/src/main.tsx:25`). Needs: per-user auth (a per-user key/JWT the page
holds; anon-key + row-level security in the Supabase case), an offline queue
(writes buffered in IndexedDB, flushed on reconnect — none of these SDKs
make offline writes durable across a tab close for free), and reactive
subscriptions as the read path so no polling loop lives in the page. The DB
is a rented service, but it executes no agent logic — within the stated
constraint.

**2b. CRDT + dumb relay.** Yjs or Automerge docs in every browser, synced
over any WebSocket relay (or WebRTC, though signaling still needs a server).
Genuinely local-first: the relay can be swapped, self-hosted, or down without
data loss. Merges are free for append-only sets, maps, and text. They are
*not* free for the things an agent platform actually fights over: decay
counters want CRDT counters (Yjs has none built-in; Automerge counters exist
but importance/decay math is last-writer semantics anyway), and "which
device runs this schedule" is not a data-merge problem at all — see §3. You
pay the highest integration cost and still need the leader-election machinery
below.

**2c. Single-device-first.** IndexedDB/OPFS, no sync, optional export/import
of a state snapshot. Ships immediately, zero external accounts, and — the
important part — it is not a dead end *if the schema is written sync-ready
from day one* (§5).

## 3. The hard part is duty sync, not data sync

Data sync is a solved, rentable problem — rank-2a is mostly SDK glue. What no
hosted DB solves for you is **which device is on duty**: who runs the
automation scheduler, the memory-consolidation jobs, the proactive loops.
Boop dodges this by decree (one Node host, `ARCHITECTURE.md:258`); a
browser-only multi-device ASKK cannot decree it, because browsers open and
close constantly and any of the user's three devices may have a tab up.

This is the multi-device analog of the single-device problem in
`01-runtime-lifecycle.md`: there, Web Locks elects one tab per device; here, a
**heartbeat row with TTL in the shared DB** elects one device per user.

**Leader election, concretely.** One `leader` row: `{holder: deviceId,
expiresAt}`. A tab that already won its local Web Locks election tries a
conditional write: claim iff the row is absent or `expiresAt < now`. The
winner renews `expiresAt = now + TTL` every TTL/3; everyone else watches the
row reactively and re-contends when it goes stale. Boop already ships both
halves of this pattern separately — the conditional-insert claim
(`convex/sendblueDedup.ts:4-18`) and the stale-heartbeat sweep
(`server/heartbeat.ts:30,39`) — it just never composes them into an election
because it never has two candidates. TTL sizing: long enough to survive a
laptop lid-close blip (~30-60s), short enough that "agent moved to my phone"
feels prompt. Clock skew between devices means comparing against DB server
time where the platform offers it, or padding the TTL where it doesn't.

**Election alone is not enough — jobs must be idempotent**, because leadership
can change mid-job and TTL expiry can briefly overlap two leaders. The rule:
*the claim is the write, not the read.* Boop's scheduler gets this backwards —
it reads due rows, fires, and writes `nextRunAt` only afterwards
(`server/automations.ts:105-121`), which is exactly why two instances
double-fire. The fix is a per-job conditional write: atomically set
`nextRunAt = next(schedule)` (or a `claimedBy/claimedAt` pair) *iff
`nextRunAt <= now` still holds*, and only the writer that won the mutation
runs the job. A second device racing on the same row loses the conditional
write and does nothing. With that in place, double-fire is harmless even when
election overlaps — the election is an optimization (avoids N devices all
racing every 30s), the conditional claim is the correctness guarantee.

Degraded modes fall out cleanly: no device online → jobs simply wait,
`nextRunAt` in the past fires on next leader wake (a browser platform must
accept "agent runs when a tab is open" — see `01-runtime-lifecycle.md` for
what background execution a browser can and cannot promise). One device
offline holding leadership → TTL expires, another device claims. This is the
piece to build carefully and test adversarially; everything else in this
review is configuration.

## 4. Conflict cases per table class

Using boop's Convex schema as the reference taxonomy (`ARCHITECTURE.md:196`,
`convex/schema.ts`):

| Table class | Boop examples | Conflict story under multi-device |
|---|---|---|
| Append-only logs | `messages`, `memoryEvents`, `agents` step logs, `usageRecords` | Trivial. Client-generated unique ids, insert-only; readers order by timestamp. No merge exists because no row is ever edited. |
| Mutable records with counters | `memoryRecords` — `importance`, `decayRate`, `accessCount`, `lastAccessedAt` (`convex/schema.ts:27-44`) | The ugly class. `accessCount` wants a CRDT/atomic increment; `lastAccessedAt` is max-wins; importance/decay recomputation is job output, not user edit. Pragmatic answer: last-writer-wins per field for phase 2 (decay drift of a few accesses is cosmetically wrong, never corrupting), and route recomputation through the leader (§3) so only one device runs it anyway. |
| Scheduled/claimable rows | `automations` (`nextRunAt`) | Never merged — **single-writer via conditional claim** (§3). Conflict is resolved by the DB's atomicity, not by data reconciliation. |
| Config/settings | `settings`, `conversations` metadata | Low-frequency, human-edited; last-writer-wins with `updatedAt`, surface a "changed on another device" notice if it ever matters. |

The taxonomy is the point: only one class (counters) genuinely needs
conflict thought, and even it degrades gracefully under LWW. This is why
rank-3 CRDTs are overkill for this workload.

## 5. Recommendation

**Phased. Verdict: single-device-first now, hosted-DB spine as opt-in
phase 2, CRDTs not on the roadmap.**

- **Phase 1 (ship now):** IndexedDB/OPFS only, no sync, matching ASKK today.
  But write the schema sync-ready from the first migration:
  - client-generated ULIDs for every row id (no DB-assigned ids to remap),
  - append-only wherever possible (logs, events, turns),
  - `updatedAt` on every mutable row (LWW needs it),
  - scheduler rows shaped for conditional claim (`nextRunAt` + claim
    semantics) even while there is only one device.
- **Phase 2 (opt-in):** hosted realtime DB as the sync spine — Convex browser
  SDK / Supabase Realtime / InstantDB, chosen at implementation time. Per-user
  auth key, offline write queue, reactive reads. Leader election via
  TTL-heartbeat row plus idempotent conditional-claim jobs (§3) lands here and
  is the only genuinely new machinery.
- **Not planned:** CRDT layer. Revisit only if simultaneous offline editing
  on multiple devices becomes a real user story; nothing in the boop-shaped
  workload requires it.

Boop's lesson, distilled: renting sync fabrics is the right instinct — it
rented two and wrote zero sync code. Its mistake for our purposes is renting
the *runtime* location too (one blessed host), which is precisely the thing
the browser-only target refuses to do. Keep the rented pipe, move the brain
into every browser, and let a heartbeat row decide which brain is on duty.

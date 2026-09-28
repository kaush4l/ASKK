# Implementation status

Evidence checkpoint: 2026-09-28. The workbench completed a guided native application verification. Browser Linux has core execution evidence, but the latest private candidate's Next production build timed out and its uncached npm installation failed. No browser-built application has passed acceptance. The candidate's normal startup/reload path, current Safari checks and VoiceOver remain unverified. These are engineering-preview results, not production readiness or one-shot reliability.

## Source, build, and published site

| Checkpoint | Recorded result | Scope |
| --- | --- | --- |
| Latest completed regression suite | `bun test ./test`: **361 passed, 1 skipped, 0 failed, 2620 assertions**, 34 files. | Completed source checkpoint; later changes need another run. The skipped test is the opt-in real CLI check. |
| Currently published Pages export | Build/deployment check passed: **802,850,265 bytes, 131 files**; artifact hash `3dcdd9a70a05bbbbd037a17cf8f03191449ea73d043c8706971edcabf60ad2d2`. | Published as **`93509b3`**. Public runtime remains `c2w-node24-38d093f4a38002db`. Asset validation is not browser-runtime acceptance. |
| Next source export/update | Publication pending. | New source fixes and the append-only storage migration are not yet verified as a hosted application update. The private runtime candidate has not been promoted. |
| Hosted browser smoke checkpoint | Earlier commit **`65fa913`**, artifact hash beginning `b31d26`, **802,844,496 bytes**. | The complete hosted Chrome smoke receipt applies to this earlier version; cached clients can still receive its HTML. |

A cache-busting actual Pages GET at 21:07:08 UTC confirmed the newer deployment: 29,961-byte index, SHA-256 `2e7d8e1404662694ed261945284913e6485ea8713c7072cb626f474774d40339`, Next build `djYgwGNyMIdJm_Ij2ACrU`. An existing legacy service-worker client still returned the older index hash beginning `e43b`. Publication is confirmed; migration of that cached client remains pending. A compatibility `sw.js` entry point is in source for a subsequent release. A subsequent hosted guest attempt failed its supervisor handshake; the measured result is recorded below.

The [hosted receipt](evidence/workbench-pages-chrome.json) records matching bytes/hashes for the published index, agent catalogue, agent worker, and isolation worker. The shell hydrated, six agents became idle, and worker paths resolved beneath `/ASKK/`. A composer draft survived actual reload. Blocking application chunks in a disposable tab produced the startup diagnostic and reload link without touching the paired tab.

The page was secure and cross-origin isolated, but retained a legacy `sw.js` controller. This does **not** prove clean installation of `coi-serviceworker.js` or migration from the old cache. Source migration handling and regression tests are present, but existing cached clients still require browser migration proof. The narrow desktop drawer correction has separate [Chrome evidence](evidence/workbench-drawer-chrome.json); this does not establish that an old cached client has migrated.

Pages paired through trusted HTTPS loopback with only `model-relay` and `network-relay` capabilities. Settings successfully listed the selected local Qwen model. No native execution was granted, no hosted generation was sent, and no browser guest started during this smoke test.

## Guided native application completion

The [sixth continuation audit](evidence/native-run-rmulp44n21.md) records local Qwen verification of the existing Daylight application through Local Bun. Revision **26** passed **37 ordered steps: 20 outcome assertions and 17 actions**, including reload. The complete receipt matches the artifact/build identity and records **39,901.135 ms** within a 115,000 ms budget.

The run took **23 minutes 58.546 seconds**. Eight earlier checks repeated the same wrong task-order expectation; one targeted owner message explained it. The successful plan corrected expected titles but still used positional `nth-child` selectors despite the requested stable identity strategy. This run made eight reads, one build, nine checks, and no application writes. It continued earlier work; it was not fresh-goal or one-shot generation.

The main agent completed 16 model requests and three compactor children completed one each, all with `stop` and no format repairs. Each version-2, tool-free compactor summary appeared in later main prompts. The audit preserves provider metrics, intervention, failed checks, and final evidence. Public home paths are redacted; numeric receipts remain original and raw files remain local with mode `0600`.

The running release incorrectly marked failed workspace receipts as successful transport observations although their inner `ok` was false. Newer source propagates typed failure status, preserves full failed receipts, prevents arbitrary tool text from spoofing status, reports bounded expected/actual text from captured native DOM operations, and rejects cancelled zero-exit builds. Those fixes were not patched into the live trial.

## Browser Linux: core checks pass, npm/Next blocked

The native ARM64 guest image includes Node 24.21.0/npm and passed native offline Next and PTY probes. That does not replace browser acceptance.

Image **`c2w-node24-38d093f4a38002db`** passed actual Chrome boot, a real `node -e` Unicode file read, binary snapshot round trip, stale revision rejection, PTY resize, and process cancellation. The [core receipt](evidence/browser-linux-chrome-core-38d.json) records cached-asset Ready at **236.423 seconds** and the Node command at **31.601 seconds**. Adaptive mailbox polling reduced measured supervisor CPU use. Companions were present for independent tests but unauthorized to this guest; this is not a companion-stopped cold boot.

A later cached reload reached Ready at **61.228 seconds** and restored an acknowledged Unicode file. Exact pinned-lock `npm ci --offline --no-audit --no-fund` then failed its 15-minute bound: **924,814.885 ms** including cancellation, ending with `SIGKILL`, no output, and no subsequent Next build. A comparison launching only npm with `--jitless` also failed at **919,999.565 ms** with the same cancelled/no-output outcome. Neither is a successful install or a clean performance comparison.

These later local receipts remain ignored and unpublished: `.cache/browser-linux/chrome-20260928-2021-locked-ci-failure.json` and `chrome-20260928-2040-jitless-ci-failure.json`. The first includes brief coordinated browser QA interruptions. Early file counts in the second may include restored leftovers and do not prove extraction progress.

The [first hosted guest receipt](evidence/browser-linux-pages-38d-first-boot.json) records a failed attempt on actual GitHub Pages with both companion processes stopped. Download/verification finished at **98.832 seconds**. Linux boot, mounts, DHCP and runc progressed to launching the Node supervisor, but no readiness handshake arrived. The adapter failed at **699.068 seconds**, removed its frame, and retained the goal draft. This used the legacy cached shell and integrity-checked `38d093f4a38002db` runtime. It does not establish the cause as Pages-specific; local build work continued during the attempt. [The failure screenshot](evidence/browser-linux-pages-38d-first-boot.jpg) is retained.

The private data-only candidate **`c2w-node24-8f08d6cef80797be`**, **903,638,559 bytes**, includes the exact template dependencies already installed. Native activation, dependency mutation guards, PTY and npm-run Next static export passed. In actual Chrome, a diagnostic-shell boot reached Ready at **64.531 seconds**; a Unicode Node command exited successfully in **24.620 seconds**. Binary round trip, stale CAS rejection, PTY resize to **37 rows × 103 columns**, and live process cancellation passed. Template activation exited zero in **42.221 seconds**, and its checkpoint succeeded. The normal production startup path and clean reload restoring its dependency symlink have not yet been verified; these results do not establish cold production readiness.

The candidate's direct Next 16.3.6 CLI with webpack reached “Creating an optimized production build” but exceeded its 15-minute bound: **909,320.090 ms** including cancellation, ending with `SIGKILL` and **no application artifact**. A separate small uncached npm install exited **1** after **146,520.005 ms** with a synthetic **503** from the browser network path. Optional npm telemetry headers and CORS preflight are under investigation; a plain browser registry GET returned 200. The synthetic error is not evidence of a registry outage, and the install did not pass.

The complete candidate receipt remains private at `.cache/browser-linux/chrome-20260928-2134-candidate-final.json`, with separate `candidate-core` and `candidate-next-timeout` receipts alongside it. The candidate is **unpromoted**; public image `38d093f4a38002db` is unchanged. Installed template dependencies do not prove arbitrary npm installation performance.

Browser readiness still requires both requested browsers to demonstrate cold boot and memory/timing bounds, the supported install/build/test workflow with network mode stated, output/exits/descendant cancellation, PTY lifecycle, broad binary/Unicode fidelity, revision conflicts, durable acknowledgement and failure recovery, and a guest-produced export passing opaque-preview checks against unchanged source. One restored file does not establish crash durability or complete backups. Optional relays must be named; host commands must never count as browser execution.

## Implementation and browser evidence

The full-suite count above is the current aggregate checkpoint. These fixtures describe coverage, not new claims about every historical targeted test count.

| Area | Evidence | Limit |
| --- | --- | --- |
| Core and workers | `core-safety`, `runtime-production`, `runtime-binding`, and `runtime-compactor` tests: v2/repair boundaries, truncation, full prompt budgets, mutable tools, typed status, completion gates, exact requests, inherited bindings/plans, child cancellation, compaction preservation, no automatic replay. | Scripted inference/local streams and in-memory persistence are not general model or browser durability proof. |
| Raw evidence storage | Append-only event storage, bounded export, immutable views, legacy inline records, persistence failures and retention races have runtime regressions. [Actual Chrome IndexedDB migration](evidence/indexeddb-v2-chrome.json): **14 checks passed in 40.9 ms**. | Isolated source-adapter proof on HTTP loopback; not a full hosted application upgrade or Safari proof. |
| Companion and guest ports | `companion`, `browser-linux`, and `browser-linux-assets` tests: auth/origin, streaming, CAS/path checks, real exits/cancellation/PTY, byte snapshots, manifests, relay selection and admission cancellation. | Native/unit tests do not instantiate browser QEMU. Filesystem API confinement is not an OS sandbox or installer. |
| Workspace coordination | Controller tests use explicit asynchronous barriers for transfers, nonempty destinations, snapshot/source mutation, reservations, checkpoints, persisted root review/re-pair, stale builds/checks, task bindings, credentials, durable goals and cancelled-build rejection. | Real `ProjectFiles` with controlled ports and in-memory storage. Real adapter interleavings remain separate. |
| Artifact packaging and inspection | Packaging/artifact tests cover bounded resources, CSS metadata, unsupported profiles, ordered checks, finite deadlines, no replay and captured-native diagnostics. | General routes, external runtime assets and arbitrary Next hosting remain unsupported. |
| Workbench performance | [Virtualized explorer/terminal](evidence/workbench-performance-after-chrome.json), [terminal delivery](evidence/terminal-delivery-chrome.json), and corresponding tests. | Tested bounded datasets. Command snapshot batching is not interactive PTY backpressure. |

Actual Chrome [forms/isolation checks](evidence/artifact-chrome-forms-and-isolation.json) pass Next CSS hydration, client form handlers, asynchronous scoped storage/reload, fresh inspection storage, URL/Blob behavior, and rejection of port/DOM forgery, forbidden fetches, and native external/harness-origin form POSTs. That Next fixture was built natively. DOM blur is synthetic; keyboard focus acceptance is separate.

The [background-tab fixture](evidence/artifact-background-chrome.json) passed 37 check steps and 12 form submissions in 40.09 seconds within an 82.25-second budget; its earlier settling failure is retained separately. Deadlines count elapsed time and never replay timed-out actions.

[Responsive](evidence/workbench-responsive-chrome.json) and [editor-group](evidence/workbench-editor-groups-chrome.json) receipts cover narrow screens, draft/undo preservation, focus restoration, divider resizing, quota failure preventing reload until retry, independent groups and restored drafts. These are not VoiceOver or Safari results. Earlier Safari artifact checks used a different opaque HTTP-shell renderer; current isolated `srcdoc` acceptance remains pending.

The latest source preserves complete paired tool calls/results separately from compact model observations and the bounded UI log. IndexedDB v2 appends raw events under run/sequence identities instead of rewriting the entire event array with each run save. Full frozen exports remain available; pending or failed evidence writes cannot produce a successful partial export. Legacy inline runs remain readable, and retention removes a run and its event records together. The [storage contract](EVIDENCE-STORAGE.md) documents failure handling and remaining copy costs: prompts, requests, spans and other run fields still reside in rewritten records, and total evidence/live memory is not byte-bounded.

The real Chrome migration fixture preserved an existing file, setting and legacy run, verified concurrent/idempotent appends and replacement rejection, checked bounded reads and deletion isolation, and exercised blocked old-tab and newer-schema refusal/recovery without an empty-memory replacement. All three synthetic databases were removed. This does not prove a full application upgrade against the user's existing workspace.

The audited nine check observations shrink from 56,599 to 6,019 characters after projection; this measures those blocks only, not token savings, speed or model reliability. Configuration chooses the projection; exact transmitted prompts and raw receipts remain separate evidence.

Runtime failure handling now invalidates readiness and verification, preserves the last artifact, and rejects a crash during durable workspace binding publication. Model relay loss clears model connection success while retaining the selected execution target. Download progress uses known byte totals, and Output exposes bounded actual guest console text. These source changes still require deployment checks.

The shared modal shell passed [Chrome scrolling and focus checks](evidence/workbench-modal-scroll-chrome.json) at 1280×720, 390×844 and 320×400: its heading and Close button remained visible with the last field focused; Escape restored the opener. This used the real component with synthetic long content, not a successful guest boot.

## Critical pending gates

| Gate | Remaining evidence |
| --- | --- |
| Browser coding | Verify the private candidate's normal startup and clean symlink-restoring reload, complete its Next build, and check the exported application. Diagnose the uncached npm network failure. Browser npm/Next is the primary blocking capability; core guest checks do not satisfy it. |
| Reliable model completion | Repeat representative fresh goals without targeted owner repair. Guided native success does not establish stable selectors, efficient recovery or one-shot results. |
| Hosted update and Safari | Publish the new source export, prove fresh isolation and legacy-cache/storage migration, preserve drafts, and verify hosted generation through the authorized relay. Current Safari and VoiceOver sessions are locked; their renderer/workbench/accessibility acceptance remains pending. |
| Real races and durability | Adapter/browser interleavings, native output mutation during snapshot, revoked pairing, active-work reload/disposal, broad binary/font/image fidelity, oversized-file rejection and quota/crash recovery. |
| Companion packaging | Bundled Bun, Apple Silicon launch/trust setup, explicit capabilities, token lifecycle and reconnect. A source command is not an installer. |
| General browser automation | Owned Chrome, explicit existing-tab attachment, the agreed Safari route, selected-tab identity and MCP contract. Worker/iframe tests do not establish this. |
| Remote contributions | Preserve all 13 [remote commit decisions](REMOTE-RECONCILIATION.md). Unread/ack inbox behavior remains pending; linked continuation without automatic process replay is intentional. |

## Reproduction and evidence handling

```sh
bun test ./test
bun run build:pages
bun scripts/check-deployment.js out
```

The deployment check validates size/hash/path constraints and expects complete runtime assets. `--without-runtime` is a UI-only inspection. Missing browser verification in the manifest remains a warning, not a passed gate.

Runtime instructions: [scripts/browser-linux/README.md](../../scripts/browser-linux/README.md). `scripts/verify-artifacts.js` uses a local static export, defaulting to `.cache/artifact-fixture/out`. Record browser/version, origin, image/build, model/settings, revisions, repairs, intervention, usage and concrete outcomes. Keep raw receipts local; redact public text explicitly without recalculating original lengths or token measurements from the redacted copy.

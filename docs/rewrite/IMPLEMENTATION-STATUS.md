# Implementation status

Evidence checkpoint: 2026-09-28. The rewrite is changing actively. “Implemented” describes inspected code; “verified” names an actual check and its scope. Neither means production readiness. Update measurements rather than inferring readiness from a successful compile or a status badge.

## Measured or inspected now

| Area | Evidence | Scope and limit |
| --- | --- | --- |
| Regression suite | Last completed run: `bun test ./test` → **259 passed, 1 skipped, 0 failed, 1755 assertions**, 26 files. | This records the completed run at the reconciliation checkpoint; later concurrent changes need a fresh run. The skipped test is the opt-in real CLI check. |
| Core loop | `test/core-safety.test.js`: malformed replies, v2 actions, mutable tools, call IDs, completion rejection, truncation/EOF/CLI failure, redacted retries, full prompt estimates, compaction preservation. | Deterministic fixtures/local streams, not arbitrary model reliability. |
| Production worker | `test/runtime-production.test.js`: production main and completion gate through a real worker. | Scripted v2 model; production wiring, not a real-model coding benchmark. |
| Bun companion | `test/companion.test.js`: auth/origin, pairing POST, streamed relay, CAS, path/symlink confinement, real output/exit, process-group cancellation, duplicate identity, PTY input/resize/close. | Ephemeral local HTTP tests. No certificate trust, hosted Safari pairing, installer, or OS sandbox proof. |
| Artifact packaging | `test/artifact-packaging.test.js`, `test/workspace-artifacts.test.js`: source metadata, CSS/local resources, unsupported-profile rejection, resulting-state assertions. | Unit/package checks; runtime-created assets and arbitrary routes remain unsupported. |
| Actual Next artifact: Chrome | Chrome 153 CUA: **10/10 checks passed** with `crossOriginIsolated:true`: Next hydration/reload, fresh inspection storage, React onBlur persistence, forbidden storage failure, port/DOM forgery rejection, normal URL/Blob behavior, and parent composer focus/draft preservation. | Opaque `srcdoc` renderer; the repeated suite now includes emitted CSS imports and measured applied styles in `evidence/artifact-chrome-forms-and-isolation.json`. Earlier fixtures omitted CSS and forms, missing two failures exposed by the live task. The current suite proves client form handlers and rejects external/harness-origin native POSTs; a real mouse click also increments the form counter. Next 16.3.6 built natively, not inside the browser guest. DOM blur is synthetic; native keyboard focus remains separate acceptance. |
| Actual Next artifact: Safari | Earlier opaque HTTP-shell fixture passed locally. | This does **not** verify the new isolated `srcdoc` renderer. Current Safari checks are pending while the Mac is locked. |
| Adversarial artifact cases | Root Chrome probes rejected private-port forgery, replaced DOM accessors, and CSP-forbidden fetch. Fixture: `scripts/verify-artifacts.js`. | Bounded cases, not a complete security audit. Re-run after shell/inspection changes. |
| Native guest protocol | `test/browser-linux.test.js`: supervisor files, revisions, process output/exit, cancellation, binary snapshots/transfers. | Supervisor executed with native Node. Does not instantiate Wasm, QEMU, IDBFS, or Safari. Some transfer cases were added after the recorded suite. |
| Runtime assets | `test/browser-linux-assets.test.js`: chunk/manifest integrity, unsafe/truncated assets, explicit network relay, cancellation during job admission. | Recently added; include in next recorded suite. Does not prove guest boot. |
| Workspace coordination | `bun test ./test/workspace-controller.test.js --timeout 5000` → **33 passed, 0 failed, 168 assertions**. | Real `ProjectFiles` and controller with a deterministic in-memory transaction store, controlled execution/inspection ports, and a fake Hub for dispatch boundaries. No guest, shell, browser, or Next process is started. |
| Worker binding and cancellation | `bun test ./test/runtime-binding.test.js --timeout 15000` → **4 passed, 0 failed, 59 assertions**. Real workers inherit detached context into child prompts, stored records, and exported traces; persisted resume/invoke retain context and saved plans; continuation has a separate linked attempt; stopping one child preserves sibling/parent completion; shutdown settles callers and reload never replays work automatically. | Scripted inference and controlled external operations. Persistence uses the in-memory store; this does not prove browser reload durability or controller/Hub capability enforcement. |
| Boot and connection diagnostics | Inline-watchdog tests execute without React; inference diagnostics test direct HTTPS→HTTP loopback, relay routing, and explicit HTTP errors. | Fixture evidence only; missing-chunk and hosted connection behavior still require browser checks. |
| Real local model diagnostic | Earlier probe called an in-memory read tool once and returned `42`: two steps, about 20.4 seconds, no repairs. | Compact JSON example with 4096 output budget. Earlier failures used different limits; no causal prompt-improvement claim. Not a generated application. |

## Browser guest is not yet ready

The container2wasm/QEMU image has compiled and its native Linux guest passed Node/npm, offline Next export, and PTY probes. The runtime owner reports Chrome reaching Linux, 9p, DHCP, runc, and Node. The preceding image failed while creating its ready receipt: pinned QEMU passed Emscripten ENOENT=44 through the Linux 9p boundary, where ENOENT must be 2. A symbolic errno translation fix compiled and passed a native mapping regression. Image `c2w-node24-f1ad7720a3169805` removed the errno mismatch and reached Node, exposing a second measured failure: QEMU chmod through `/proc/self/fd/34` returned EPERM because the generated Emscripten lookup node omitted symlink mode. The bounded generated-code correction is published as `c2w-node24-a65a214ffe694729` with its regression and provenance. The new image emitted its structured supervisor handshake from actual Linux arm64 / Node 24.21.0. Diagnostic `ps` and `/bin/echo` children produced output and real process exits. However, preparation failed at **900,284 ms (15 minutes)** while `npm --version` remained CPU-running (observed elapsed 07:59). npm and Next acceptance have not passed. A subsequent Chrome run reached Ready at **291.740 seconds** with cached assets: supervisor at 231.778s, real Node version child completed at 276.761s, then shared-file write/read/remove and durable checkpoint. Companions were stopped before those command/file checks, but were present when that run began booting. npm, arbitrary Node JavaScript startup, and Next performance are still being investigated. A completed compile and native guest tests do not establish browser runtime readiness.

The earlier `.cache/browser-linux/chrome-proof.json` explicitly records **failure because the Linux image was not installed**. That is historical failure evidence, not the status of the newly compiled image. There is no successful full browser-guest acceptance receipt yet. Native supervisor tests and the separate artifact fixture do not replace it.

Before marking Browser Linux ready, record on both requested browsers:

1. Image identity/integrity, cold boot, actual Node/npm versions, memory requirements, and timings.
2. One filesystem across independent jobs; binary/Unicode round trips; revision conflicts; no prompt-based completion.
3. Real install/build/test with the stated network mode. Prove browser-contained execution independently of optional host commands.
4. Real stdout/stderr/exit, cancellation including descendants, and PTY input/resize/close.
5. Durable acknowledgement after synchronization; reload restores exact bytes. Storage failures reject acknowledgement and permit honest recovery/retry.
6. Guest-produced Next export → immutable package → opaque Chrome/Safari preview → meaningful interaction checks against unchanged source.

An optional network relay must be named in the receipt. Host command execution must never be counted as browser execution.

## Workbench browser evidence

`evidence/workbench-responsive-chrome.json` records 12 actual Chrome observations: 320/390px phone surfaces without horizontal overflow, preserved drafts and undo across surfaces, modal focus restoration, desktop editor/explorer widths, keyboard divider resizing, and injected storage-quota failure cancelling isolation reload until retry succeeds. `evidence/workbench-editor-groups-chrome.json` separately records twelve two-group checks for shared drafts, independent undo, diff/save behavior, width collapse, phone group switching, and reload recovery. These checks do not stand in for VoiceOver or Safari.

A dedicated compactor JSON v2 prompt and Hub completion-status guard now prevent an incomplete child from replacing parent history with a step-limit message. The real-worker regression reproduced this loss before the fix, then proved the original six turns survive.

## Critical pending gates

| Gate | Required evidence |
| --- | --- |
| Real local Qwen application task | Four actual Local Bun attempts recorded in `evidence/native-run-*.json`. Second attempt created Daylight files, installed dependencies, and completed Next export, but failed the action contract before verification. Its generated persistence was also incorrect. The third repaired asynchronous artifact storage and rebuilt source revision 17, but exposed the harness CSS hydration bug; it was cancelled to repair that bug. The fourth rebuilt revision 21 but exposed the missing form-event permission; it was cancelled for the harness repair. A fifth continuation is running against both corrected contracts. A completed application goal with matching interaction/persistence receipts remains pending; these attempts are neither one-shot success nor browser execution. |
| Transfer/build concurrency | The 33 controller cases below pass. Remaining evidence includes real adapter/browser interleavings, output mutation during native snapshot capture, revoked pairing, and reload/disposal during active work. |
| Byte fidelity and complete manifests | PNG/font/random-byte round trips and destination comparison. Oversized/unsupported files cannot disappear silently. Editor text reads remain separate from transfer bytes. |
| Build provenance | A success-exit command producing no fresh export cannot reuse old `out` with a new revision. Concurrent output writes make snapshot capture fail/retry. |
| Checkpoint failures | Controller fixtures now reject a failed checkpoint while preserving real mutation/invalidation, and roll back failed transfer bindings. Browser IndexedDB quota/crash/reload behavior remains unverified. Partial recovery copies cannot be called complete backups. |
| Hosted Chrome/Safari | Exact `/ASKK` export, asset integrity/size, isolation reload and draft preservation, shell/worker paths, and trusted HTTPS companion access from the published origin. |
| Companion packaging | Bundled Bun, Apple Silicon launch/trust setup, explicit capabilities, token lifecycle, reconnect/failure behavior. A source command is not an installer. |
| General browser automation | Owned Chrome plus explicit existing-tab attachment and the agreed Safari route, selected-tab identity, and MCP contract. Worker/iframe tests do not prove it. |
| Remote contributions | Goal/plan context and UI, per-agent cancellation, explicit linked continuation, pre-hydration watchdog, loopback guidance, and the source archive are ported. Unread/ack inbox and current-browser acceptance remain pending; no automatic replay is an intentional policy. See all 13 [commit decisions](REMOTE-RECONCILIATION.md). |

## Controller concurrency evidence

The 33 tests in `test/workspace-controller.test.js` use explicit asynchronous barriers to control operation ordering. The final targeted run passed with 168 assertions. Coverage includes endpoint-scoped credentials, model-specific request options, pairing reservations/restarted-runtime identity, and durable revision-checked conversation goals, plus:

- Required explicit transfer, nonempty-destination preservation, binary byte fidelity, and successful binding changes.
- External source mutation during snapshot capture or copying, destination write conflicts, and failed checkpoint rollback without deleting copied destination files.
- Transfer reservations against writes, commands, terminal opening, runtime starts, and another transfer; active writes, runtime preparation, jobs, and opening/open/closing terminals against transfers.
- Source commits during builds or artifact capture, failed replacement builds, and preservation of the previous immutable preview.
- Successful inspection bound to the exact artifact/build/command/runtime, and rejection after editor commits, external edits, or replacement builds.
- Relay-only denial of native execution and explicit PTY authority checks.
- Runtime identity changes during command or transfer checkpoints, plus a storage failure after a real file mutation that still invalidates old evidence.
- Missing/stale bindings rejected at all eight workspace Hub operations before effects, invalid model transport rejected before task dispatch, one frozen binding exported for a valid goal, and restored/refreshed companion capabilities preserved without changing the selected execution target.

These tests exposed three bugs fixed before the final run: command receipts and transfers were not revalidating runtime identity after checkpoint awaits, and terminal opening lacked an explicit PTY capability check. Their failure-first results and final passes exercise controller behavior; they do not prove browser durability or generated-page correctness. Inspection itself is a controlled port in these tests, while packaging uses the real artifact packager.

Browser fixtures still need repeated inspection, reload/disposal, target switching, revoked pairing, storage failures, narrow screens, focus, and reduced motion. Actual build-output snapshot consistency and the complete browser controller/Hub launch path remain separate integration checks.

## Reproduction and evidence

```sh
bun test ./test
bun run build:pages
bun scripts/check-deployment.js out
```

The deployment check expects complete runtime assets. `--without-runtime` permits a **UI-only** inspection; it cannot prove full readiness. The check currently warns when a manifest lacks browser verification, which does not pass the missing browser gate.

`scripts/verify-artifacts.js` uses an actual local static export (default `.cache/artifact-fixture/out`). Runtime build/probe instructions are in [scripts/browser-linux/README.md](../../scripts/browser-linux/README.md). Keep generated caches separate from source and retain sanitized receipts when promoting a gate to verified.

Record browser/version, origin, image/build identity, model/settings, source/artifact revisions, loop passes, repairs, provider usage when available, and concrete outcomes. Transport authentication is redacted; prompts/files may still contain private user data and need review before sharing.

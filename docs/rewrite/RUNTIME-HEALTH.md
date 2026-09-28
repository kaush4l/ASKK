# Browser runtime health and delayed receipts

Lifecycle and responsiveness are separate. A guest can remain alive, with the
same workspace and terminal sessions, after a request exceeds its response
deadline. That deadline is not evidence of process exit, a failed write, or a
crash. The retained guest demonstrated this distinction: a file listing arrived
several minutes after its caller's 60-second deadline.

## Adapter contract

The capability descriptor carries `state`, `health`, `ready`, and sanitized
`unresolvedRequests`. `ready` requires a ready lifecycle and responsive health.
Request summaries identify the method, request, and relevant path or session;
they must not contain file contents, command arguments, terminal input, or
relay credentials.

When a posted request misses its response deadline:

- Publish `runtime.health` with `health: unresponsive` and retain the request
  identity until its actual reply arrives.
- Read-only calls may reject with `RPC_TIMEOUT`. Their late replies still
  reconcile the health journal.
- Mutations and process/session admissions continue awaiting their actual
  receipt. The caller cannot report a durable save, failed admission, or
  cancellation solely from the deadline.
- Stop admitting new normal work. Existing cancellation, terminal close and
  resize controls remain available; terminal input is limited to Ctrl+C.
- Keep the frame, boot identity, output subscriptions and completion tracking.
  Do not replay a request or restart the guest automatically.

Once every delayed request has an actual outcome, publish a sanitized
`runtime.reconciled` record and responsive health. A successful cancellation
request is still distinct from a process exit receipt. Cancellation errors do
not remove a process from tracking.

An explicit disposal or abort ends the lifecycle. Disposal attempts a bounded
durable checkpoint, reports an unacknowledged checkpoint on failure, and then
releases the frame. Initial startup also has an explicit bound. Neither action
is the automatic response to a slow request in an established session.

## Workbench contract

The workbench displays delayed responsiveness separately from an unavailable
environment. It invalidates artifact verification, preserves the preview and
existing sessions, and blocks new execution, mutation and workspace-transfer
admission. Local drafts remain editable. Existing receipt processing continues
against the original binding.

Background file refreshes have at most one outstanding request. They pause
while the environment is delayed. Recovery checks the original binding and
refreshes files before restoring Ready; it does not transfer or remount an
already established workspace. If initial mounting never completed, setup must
finish before Ready can be shown.

This contract does not promise progress in a crashed, suspended or indefinitely
slow guest. It preserves uncertainty and tracking so the UI cannot turn that
condition into false success or silently execute the same action twice.

## Evidence boundaries

The [actual Chrome MessageChannel receipt](evidence/runtime-health-message-channel-chrome.json)
records 11 passing checks in 725.3 ms using the production adapter and controlled
guest replies. It covers late read/write/job/PTY receipts, blocked new admission,
retained identity and output, and cancellation without an invented exit. No
guest ran in this fixture; its synthetic write receipt is not a durability test.
After adding explicit failure/disposal health reset, the
[final adapter repetition](evidence/runtime-health-message-channel-chrome-final.json)
passed the same 11 checks in 401.5 ms. Its source SHA-256 is
`f9366a33b492a785b4d2b6d98870e56ed41be4d191e2461759e3375e50dd6281`.
The [workbench component receipt](evidence/workbench-runtime-health-chrome.json)
also checks retained editor/terminal instances, drafts, visible delay/error
messages and blocked keyboard submission. It uses a synthetic controller.
Ctrl+C processing was checked with an explicitly synthetic DOM event; native
keyboard delivery remains unverified.

If a file mutation was acknowledged but its later verification read or local
cache update fails, `WORKSPACE_RECONCILIATION_FAILED` carries `committed: true`,
the operation/path and, for a write, `writtenRevision`. It does not acknowledge
the entire save workflow or advance the editor to an unrelated writer's revision.
The error explains the committed operation; it never replays it automatically.

Controlled delayed receipts test these state transitions without running QEMU.
Actual guest performance, persistence and crash recovery require separate
browser evidence. Browser tab visibility must be recorded in future timing
experiments: [Chrome documents timer throttling for hidden pages](https://developer.chrome.com/blog/timer-throttling-in-chrome-88).
That behavior is a possible confounder, not an established explanation for the
observed guest latency.

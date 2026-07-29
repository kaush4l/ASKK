# ADR-005 — Storage layout, quota, migrations

**Status:** Proposed — pending spike/idb evidence (a sibling worker is measuring
IndexedDB-from-Rust ergonomics, cost, quota, and eviction right now; the Decision below is
written to survive either outcome but must not be Accepted before that report lands).

## Context

I2: all user data lives in browser storage — identity, history, memory, module definitions,
keys, the event log. I10/I11: every migration reversible, any release reachable by refresh
without data loss. The predecessor already proved the shape that works: two narrow traits,
`KvStore` (key → JSON) and `BlobStore` (path → bytes), with in-memory impls for host tests and
browser impls behind them (`git show 'pre-rewrite-rust:crates/state/src/store.rs'`,
`.../browser/src/opfs.rs`). Namespacing was by key-prefix convention, one owner per prefix.
That seam maps directly onto `StorePort` in §11 and keeps I3 (pure core) intact: the core
never knows which browser API is underneath.

The real question is not "trait or no trait" — it is which substrate backs each trait.

## Options

**A — IndexedDB for everything.** One API, one quota bucket, one migration story
(`onupgradeneeded` is even built in). Blobs go in as `Blob`/`ArrayBuffer` records. Universally
supported, survives in every browser including private-mode Safari (where OPFS has been
flakier). Cost: the API is callback/transaction-shaped and miserable from Rust — exactly what
the sibling spike is measuring — and large-blob read/write throughput is historically worse
than OPFS. Structured clone of big buffers can double peak memory.

**B — OPFS for everything.** Files are the simplest mental model; the predecessor's
`OpfsKv`/`OpfsBlob` percent-encoded keys into flat filenames and it worked. Fast for blobs
(sync access handles in workers). Cost: KV-as-one-file-per-key makes `list_prefix` a directory
scan, there are no transactions at all, and the predecessor's own memory records OPFS
returning spurious quota errors at KB scale in embedded/preview contexts. No built-in
versioning hook.

**C — Split: KV in IndexedDB, blobs in OPFS (preferred).** Small structured records (session
state, module manifests, section definitions, config, schema version) in IndexedDB; large
append-heavy byte payloads (event-log segments, forged-module bundles, export snapshots) in
OPFS. Each substrate does the thing it is good at.

**Case against C (the preferred):** two backends means two failure modes, two quota behaviors,
two things to mock, and a torn-write window between them — a module install that writes a blob
then a manifest can crash in between, and no transaction spans the seam. Option A is one
system and one story; if the sibling spike shows IndexedDB-from-Rust is tolerable and blob
throughput is adequate at our sizes (an event segment is KBs, not GBs), A's simplicity should
win. C is only right if the ergonomics or blob numbers are genuinely bad.

## Decision (proposed)

Keep the two-trait seam verbatim: `KvStore` + `BlobStore` behind `StorePort`, in-memory impls
in `adapters_test`, browser impls in `adapters_web`. Default the backing to **Option A
(IndexedDB for both)** unless the sibling spike reports it hostile, in which case fall to C.
The traits make this a swap, not a rewrite — that is the point of deciding the seam now and
the substrate after evidence.

**Key schema (prefix convention, one owner per prefix):**

```
kv:   meta/schema_version        u32, the migration ladder position
      meta/app_version           last version that touched this store
      module/<id>/<version>      manifest + logic + view (a module is data, §7)
      section/<id>/<version>     section-provider definitions (§8.4)
      state/agent/<id>           serialized AgentState snapshots
      config/*                   provider profiles, settings (keys: see ADR-006)
blob: events/seg-<epoch>.jsonl   append-only event-log segments (I8)
      export/<timestamp>         export snapshots
```

IndexedDB layout: one database, two object stores (`kv`, `blob`), key = the string above. No
per-domain object stores — `onupgradeneeded` schema churn is exactly the migration surface we
want to keep near zero; prefixes migrate in data, not in DDL.

**Quota and eviction:** call `navigator.storage.persist()` once, at the first durable write,
and surface the returned bool plus `storage.estimate()` on the dashboard as a built-in module
panel. Treat "best-effort" as the truth everywhere: any write can fail with quota, the error
surfaces as a typed `StoreError` event (I8), never a silent drop. No automatic eviction of
user data by us — the only thing the app self-prunes is compacted event segments already
summarized into memory, and that is an explicit, logged, reversible-by-export operation (I10).

**Migrations (I11):** `meta/schema_version` gates boot. On version skew the core runs a ladder
of pure `migrate_vN_to_vN+1(kv, blob)` functions — each one host-testable against the
in-memory stores, each one emitting an event, forward-only. Before the first migration step
runs, write an export snapshot to `blob:export/` so "undo" is "import the snapshot" (I10).
A stored version *newer* than the code refuses to boot with an export offered — never
silently downgrade.

**Export/import:** one file, versioned: `{schema_version, kv: {...}, blobs: {path: base64}}`.
Import runs through the same migration ladder as boot, so an old export restores into a new
release for free. This is also the multi-device story we deliberately don't build (§2): the
user carries a file.

## Consequences

- Core storage code tests on the host in milliseconds (I3); adapters are thin.
- No cross-store transactions: multi-write operations (module install) must be ordered
  manifest-last, so a crash leaves an orphaned blob, not a dangling manifest — orphans are
  garbage-collectable, dangling references are corruption.
- Every migration doubles as documentation of what changed between releases.
- Dashboard always shows real quota numbers; the agent's `environment` section (§8.2) can
  include them.

## Reversal cost

Swapping the backing substrate (A ↔ C, or OPFS later) is contained in `adapters_web` — days,
no core change, plus a one-time data migration written on the same ladder. Abandoning the
two-trait seam itself would touch every persisting module — that is the expensive direction,
which is why the seam, not the substrate, is the real decision here.

# Unified shipped and imported agent packages

This document describes the current source contract. It does not claim a new
build, deployment or browser acceptance result. Release evidence is recorded
separately in [implementation status](IMPLEMENTATION-STATUS.md).

Shipped definitions and owner imports now take the same path:

```text
exact folder bytes → importAgentPackage / restoreAgentPackage
                  → validated {data, source.list/read}
                  → compileAgentPackage → frozen AgentSpecs → workers
```

The compiler consumes validated settings and exact Markdown bodies; it does not
reparse them through the older tolerant folder loader. Trusted application tool
implementations remain in the desk registry. Both sources reject executable
package modules and credential/transport settings.

## Desk configuration and identity

[`public/desk.json`](../../public/desk.json) declares the shipped packages, the
default agent and explicit desk bindings. A minimal example is:

```json
{
  "version": 1,
  "defaultAgent": "bundled/starter/assistant",
  "packages": [{
    "id": "starter",
    "path": "packages/starter",
    "models": {"$default": "$default"},
    "tools": ["todo"]
  }]
}
```

The example's tool list applies to a package requesting `todo`; the shipped
starter has a larger explicit list. Every granted group must be requested by at
least one role, and each role receives only its own requests intersected with
that list. An unsupported requested group fails compilation even if ungranted.
Model and tool declarations do not create an adapter or waive owner policy.

The root `agent.md` declares `package_id`, `package_version` and `id`. Every
additional `agent.md` declares a unique local `id`. Display names and directory
nesting confer no authority. For example, `agents: {review: fact_checker}` grants
a delegation tool named `review` targeting the local ID `fact_checker`.

Compiled identities are `bundled/<desk-id>/<agent-id>` for shipped packages and
`installed/<installation-id>/<agent-id>` for owner imports. Specs and run records
retain namespace, installation ID, authored package ID/version and revision
digest. Installing the same source again creates a separate installation.
The owner may select any included role as an installed lead. The shipped default
must name a definition in a configured shipped package; no `main` fallback is
used. Workbench workflows are explicitly declared separately.

## Models and effective authority

The `models` mapping is from authored aliases to saved desk profile aliases.
A role without `model` requests the authored alias `$default`; it still needs an
explicit binding. A binding *value* of `$default` means follow the desk's current
`catalogue.default`. The current default must name a valid configured profile at
compilation and execution. An explicit profile alias stays pinned to that alias.
Neither form falls back to a raw provider model ID when the binding disappears.
The import UI currently offers configured profiles; a follow-default binding is
also available to explicit desk/compiler configuration.

Tool grants are narrowed by owner policy, run tool policy and current adapter
availability. Authored permissions may add restrictions; an authored `allow`
cannot weaken an owner denial or required approval. Schedule tools remain
unsupported for both declarative package sources because deferred authority is
not yet preserved. Imported skill text is readable through its declared package
resources; agents cannot publish or overwrite global skills.

This is not yet a complete credential-isolating broker. Agent workers still
receive transport configuration needed by the existing inference/host adapters.
Redacted request receipts do not change that runtime boundary.

## Sessions, resources and services

`session: task` is the default. `session: agent` explicitly retains conversation
history in a resident worker. Declared legacy `remembers: true` selects an agent
session only when `session` is absent. File-writing capabilities do not imply
residency. Fresh graph-role and service invocations do not reuse or overwrite a
resident session even if their definition requests one.

Each role's adjacent `soul.md` and `learned.md` stay local to that role.
`prompt_template` and explicit `skills` references are **package-root-relative**,
including references from nested roles. No global soul or prompt folder is
inherited. The compiler passes only referenced, rehashed text resources to the
worker. Package bytes and instruction bodies remain unchanged.

Optional services are local agent IDs, independent of role names:

```yaml
services:
  compaction: digest
  retrospective: reflect
```

Unknown service kinds, missing/self targets and service cycles fail validation.
A compaction target must request no tools, delegates, services, skills or
verification. The Hub checks that again and starts a fresh worker through a
dedicated `service.compact` channel. The model cannot choose another target or
impersonate infrastructure through a delegation call. The source run pins the
service's compiled hash and package revision. Only a completed, usable summary
may replace old history; incomplete or cancelled compaction preserves it.

Retrospectives review a live completed source task, preserve its run policy and
context, disable further delegation, and use a fresh session. Automatic reviews
depend on the desk's dreaming setting; restoring old records does not schedule
them. Review input is scoped to the source package/task. Proposal targets are
source participants with pinned hashes; dispatch and owner acceptance reject a
changed target. Proposals do not alter instructions before owner acceptance.
Cancellation intent blocks later child/service admission, and existing children
receive cancellation.

Private memories and session lookup use namespaced agent identities. Shared
memories use a package/task scope. Bundled shared keys include `bundled`;
installed shared keys retain their previous persisted format for compatibility.
Those two forms cannot collide. Retrospectives use their source task's shared
scope, not a global shared store.

## Integrity, bounds and activation

`importAgentPackage` validates normalized safe paths, collisions, metadata,
references, roles and exact bytes. Defaults allow 256 source files, 8 MiB per
file, 32 MiB expanded content including a generated lock, and 64 roles.
`askk.lock.json` inventories every other file with full SHA-256 and byte length;
the revision digest covers canonical schema/package identity and inventory.
A missing lock is generated in memory. A supplied lock must match exactly after
canonical comparison; it is never silently regenerated or written over.
Restoration rederives metadata from the stored original bytes and verifies it.
Hashes detect identity/corruption, not publisher authenticity.

`loadDeskPackages` reads only explicitly listed `packages/` roots and rejects
overlapping roots or duplicate desk IDs. It validates every selected published
path before package downloads, then checks each response against the published
index: current 10-hex-character SHA-1 prefixes or a full SHA-256 entry. That
delivery check is separate from the full package SHA-256 inventory. The loader
accepts at most 32 shipped packages and 128 MiB of downloaded package bytes,
with at most eight concurrent file reads per batch. `desk.json` is limited to
64 KiB; individual package files retain the importer limit.

One 30-second deadline covers `loadDeskPackages`, including candidate download
and validation; an explicit override must be 1–120,000 ms. Caller cancellation
and the deadline abort fetch/stream reads and race promises even if a fetch
adapter ignores its signal. Expiry cannot publish a late candidate. This is
not a deadline for the earlier index/model reads or all Hub startup work.

The build preparation script uses this same loader and compiler before writing
the content index. It does not rewrite authored files or add generated locks to
source. Runtime restoration stages shipped and installed specs before replacing
the active catalogue. A failed installed-record read preserves the previous
catalogue; individually invalid saved packages stay visibly disabled and retain
their stored bytes. Restoring installations only replaces the installed
namespace. Owner installation still requires an acknowledged durable storage
transaction before activation; installation alone starts no agent task.

## Migration and remaining work

Legacy `main`/`assistant` paths and their stored conversations, memories, learned
text and evidence are preserved under their old identities. They are not
automatically copied into `bundled/starter/...` or renamed in historical records.
The new default starts its own agent session; the workbench marks a session
boundary while retaining earlier conversation text for review. Reload restores
records without replaying interrupted processes or approvals.

Unified definitions do not yet make entire workflows portable. These remain
pending: package-local executable strategies and completion-check references;
explicit imported execution bindings; browser source/visual editing, replacement,
removal and backup export; optional script execution descriptors; and a broker
that keeps credentials outside agent workers. Existing role graphs still resolve
published desk strategies/templates, imported workflows remain general-purpose,
and coding verification still uses the existing workspace acceptance adapter.

Implementation: `src/core/agent-package.js`, `src/core/package-spec.js`,
`src/core/models.js`, `src/runtime/desk-packages.js`,
`src/runtime/agent-installations.js`, `src/runtime/hub.js` and
`src/runtime/agent.worker.js`. Focused fixtures cover renamed roles/services,
shipped/imported equivalence, default-model changes, restoration isolation,
rejected service escalation and cancellation races. They are contract evidence,
not a substitute for release-specific browser acceptance.

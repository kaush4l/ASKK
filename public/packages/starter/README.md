# Starter agent package

`agent.md` is the general assistant. Every nested agent declares its stable ID,
session, delegates and optional service roles. Folder nesting does not grant
delegation. Each role carries its own `soul.md`; prompts and skills use explicit
paths relative to this package root.

The desk binds this package in `desk.json`. `$default` follows the desk's selected
default model profile. Tool requests are still restricted by the desk bindings,
owner policy and actual connected capabilities. Included files never install
executable tools. `reflection` is a separate trusted desk tool group.

Package memories are agent-scoped, with shared memories limited to the originating
package task. Package skills are read-only resources; saving skills is currently
unavailable. Retrospective proposals require owner review and do not apply edits
automatically. Compaction has no tools, delegates, nested services or verification
requirement.

The importer computes an immutable content lock from these exact files. An
optional supplied `askk.lock.json` must match; the build never silently rewrites it.
The older definitions under `public/agents` are retained for legacy fixtures and
diagnostics. They are not a fallback for this package.

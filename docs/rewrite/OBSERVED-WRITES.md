# Writes bound to observed files

The workspace capability supports two explicit preconditions:

- `{path, content, expect: 0}` creates a file only when it does not exist. Exact literal revisions remain supported.
- Read with `workspace_read({path})`, then write with `{path, content, observed: true}` to use that exact read revision without copying its opaque value.

The worker resolves the second form before policy and approval into the concrete expected revision and an immutable observation ID. The desk independently validates that ID against the same run, path, revision, and execution identity. A later read does not retarget an already-approved write. The filesystem's existing compare-and-swap still decides whether a write can commit.

Only successful explicit reads mint references. A confirmed missing file returns `found: false`, `content: null`, and revision `0`; its observation can create the file, but conflicts if another actor creates it before the write. Read errors and unknown results never count as absence. Absence is not counted as reading source content in activity or repair checks. Listings, writes, conflict receipts, conversation history, restored runs, and other agents cannot supply them. References are not inherited by a new run. Read errors and write conflicts/errors revoke that path's references; the agent must read again and reconcile. Neither branch retries or overwrites automatically. Literal `expect: 0` is never converted into an update.

The same shared adapter wraps the workbench and evaluation environment. The scaffold agent's folder instructions describe the contract; the engine has no coding-specific branch. Original proposals and resolved arguments remain separate in tool evidence. Failed writes do not create successful file activity, so the UI continues to update only from committed workspace state.

Model-facing conflict feedback preserves the receipt and adds a recovery instruction. It distinguishes an ordinary uncommitted conflict from the existing committed-then-changed race; it never labels the latter as “nothing saved.”

Automated coverage includes cross-run/path/runtime rejection, immutable observation selection, stale writes, conflict invalidation, approval refusal, owner edits during approval, and runtime replacement during an awaited read. Live model results remain separate from those contract guarantees.

A missing observation rejects the write before execution and names the exact `workspace_read` arguments needed for that path. This is recovery guidance, not an automatically executed read or evidence that the file exists. Repeating the rejected write cannot mint an observation.

Successful observed writes include `contentChangedFromRead`: an exact comparison between submitted text and the immutable content of that read observation. Creating a file after observed absence is a change even when its content is empty. Literal-revision writes and failed/conflicting receipts do not receive this comparison from the observation adapter. The field does not describe metadata, unrelated writers, or general correctness. Identical-content writes still execute and are acknowledged normally; they are not cached or converted into failures. Model-facing guidance explains that an identical rewrite is not evidence of repairing a failing check.

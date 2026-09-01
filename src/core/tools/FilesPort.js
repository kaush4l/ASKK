import { Outcome, Reason } from '../Outcome.js'

/**
 * The agent's own files, as a capability handed in from outside.
 *
 * A port for the same reason `HttpPort` is one: the tools that use it must be
 * testable without a browser, and the only implementation needs IndexedDB. The
 * contract:
 *
 *     port.list()              -> Outcome<Array<{path}>>          sorted by path
 *     port.read(path)          -> Outcome<{path, text, bytes} | null>
 *     port.write(path, text)   -> Outcome<{path, bytes, created}>
 *
 * An absent file is `null` and not a failure, exactly as `Repository.get`
 * reports a missing record: asking for something that is not there is an
 * ordinary answer, and a tool has to be able to say "there is no such file"
 * without the turn ending. An `Outcome.failed` here means the STORE is unusable
 * — no quota, no database — which is the only thing a caller cannot work
 * around.
 *
 * There is no `remove`. Not an oversight: nothing would call it. No tool
 * deletes, no page renders these files, and a method with no caller is this
 * tree's signature defect — it has shipped as `AgentState::phase`, as
 * `## observations`, and as `AgentWorkerPool.terminate`, which
 * `CAPABILITIES.md` still counts. The day something deletes a file, the method
 * arrives with its caller.
 */

/**
 * The largest file this workspace will hold.
 *
 * 64 KiB, and the number comes from the reader rather than from storage.
 * Everything written here is written to be read back into a prompt, and 64 KiB
 * is already ~16k tokens — half of a whole measured run's prompt budget
 * (31,939 tokens across a full run, `bench/README.md`). A store that accepted
 * more would be accepting files that can only ever be read in fragments.
 */
export const MAX_FILE_BYTES = 64 * 1024

/** Long enough for a real tree, short enough to stay one line of a prompt. */
const MAX_PATH_LENGTH = 128

/**
 * One path segment.
 *
 * Deliberately narrow, and every exclusion is load-bearing rather than
 * defensive. A path in this workspace has to survive three hostile places: an
 * IndexedDB key, a single-quoted word on the guest's command line, and a line
 * of the harvest frame `ShellTool` reads back out of stdout. Spaces, quotes,
 * newlines and backslashes each break at least one of those, and a grammar that
 * admits them would need three separate escapes that no test would ever
 * disagree about until a model wrote one.
 *
 * `.` and `..` are excluded by the same rule that excludes everything else: a
 * segment must contain something other than dots.
 */
const SEGMENT = /^(?!\.+$)[A-Za-z0-9._-]+$/

/**
 * A path this workspace will accept, or the reason it will not.
 *
 * Returns an Outcome so the refusal carries a sentence the model can act on.
 * The caller turns it into an observation; nothing here decides how it is said.
 */
export function workspacePath(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) {
    return Outcome.failed(Reason.BAD_REQUEST, 'a path is required')
  }
  // Leading slashes are stripped rather than refused. A model that writes
  // `/notes.md` means the file it can see, and refusing it would spend a whole
  // round trip teaching it a convention instead of applying one.
  const trimmed = raw.replace(/^\/+/, '')
  if (trimmed.length > MAX_PATH_LENGTH) {
    return Outcome.failed(
      Reason.BAD_REQUEST,
      `the path is ${trimmed.length} characters and at most ${MAX_PATH_LENGTH} are allowed`,
    )
  }
  const segments = trimmed.split('/')
  if (!segments.every((segment) => SEGMENT.test(segment))) {
    return Outcome.failed(
      Reason.BAD_REQUEST,
      `${JSON.stringify(raw)} is not a usable path: write it as letters, digits, dot, dash and underscore, in folders separated by /`,
    )
  }
  return Outcome.ok(trimmed)
}

/**
 * The port used when nobody supplied one.
 *
 * Present for the reason `NO_HTTP` is: a tool built without a store must answer
 * rather than fail on `this.files.read is not a function`. "There is nowhere to
 * keep files in this build" is something an agent can work around; a TypeError
 * three frames down is not. Every tool that takes this port therefore CHECKS
 * the one it was given rather than defaulting on it — `ChatService` passes
 * `null` when composition handed it nothing, and a parameter default fires only
 * on `undefined`, so `null` went straight through to `this.files.read` and
 * threw the exact TypeError this object exists to prevent.
 *
 * There is no `list` on it, and that is the same rule the missing `remove`
 * above is refused by: nothing would call it. `ShellTool._budget` asks whether
 * the port can be listed and sends the command bare when it cannot, `read_file`
 * does not list at all, and `ChatService` guards before it reaches one. A
 * method here with no caller would be a method that only its own absence could
 * ever be noticed by.
 */
const unavailable = async () =>
  Outcome.failed(Reason.UNAVAILABLE, 'this build has nowhere to keep files')

export const NO_FILES = Object.freeze({
  read: unavailable,
  write: unavailable,
})

/** The port a tool was handed, or `NO_FILES` when it was handed something unusable. */
export const filesOr = (files) =>
  files && typeof files.read === 'function' && typeof files.write === 'function' ? files : NO_FILES

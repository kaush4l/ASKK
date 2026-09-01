import { Outcome, Reason } from '../../core/Outcome.js'
import { MAX_FILE_BYTES, workspacePath } from '../../core/tools/FilesPort.js'

/**
 * The agent's files, kept in the same database as everything else.
 *
 * IndexedDB and not OPFS, and the choice is worth the paragraph because both
 * were available and the mining round measured OPFS at 408 MB/s through a sync
 * access handle (`docs/MINING.md`) — a number this workload cannot spend.
 *
 * What is actually stored here is agent-authored text, measured in kilobytes
 * and capped at 64 KiB a file because that is what a prompt can read back. The
 * bottleneck on every path this store feeds is the guest's command channel,
 * measured at a thousand characters per boot and roughly one boot a second:
 * about a kilobyte a second, five orders of magnitude under either store's
 * throughput.
 * So throughput is not the deciding question, and what is left decides it —
 * `IndexedDbRepository` and `MemoryRepository` already exist behind
 * `Repository`, already degrade to memory when a private window refuses storage
 * and already say so in the boot notes, and already report a quota failure with
 * a sentence a user can act on. OPFS would be a second storage system with a
 * second set of those, for a speed nothing here can use.
 *
 * The cost, stated rather than discovered later: a write is a whole-record
 * `put`, so there is no appending to a file and no partial read. For files
 * written by a model in one piece that is exactly the shape of the work. For a
 * 100 MB artifact it would be the wrong store, and that is the day OPFS earns
 * its second failure mode.
 *
 * A record is `{ id, text }` and nothing else. `bytes` is derived on the way
 * out rather than stored beside the text, because a stored length is a second
 * author of a fact the text already holds — which is how `thinking` became a
 * field one writer had heard of and the other erased.
 *
 * The path obeys the same rule, and it took a bar-raiser to notice: this store
 * wrote `path` beside `id` with the same string in both, then had to `filter`
 * its own listing on records whose `path` was missing — a guard that can only
 * fire when two authors of one fact disagree. `IndexedDb` gives every store
 * `keyPath: 'id'`, so the key is there by construction and the copy bought
 * nothing. Removed while it is free: `DB_VERSION` is moving to 3 in this same
 * change and no browser holds a `files` record yet.
 */
export class Workspace {
  /** @param {import('../repositories/Repository.js').Repository} repository */
  constructor(repository) {
    this.repository = repository
  }

  /** UTF-8, because that is what is stored and what the guest will receive. */
  static bytesOf(text) {
    return new TextEncoder().encode(text).length
  }

  /**
   * Every file's NAME, in order.
   *
   * Names and nothing else. It used to carry a `bytes` beside each one, and a
   * comment in `ShellTool` said those sizes were what let the common case avoid
   * reading a file — which was false: what avoids the read is a test on the
   * path. Counted across `src/` and `scripts/`, `.bytes` off a listing had zero
   * readers and the only assertions on it were in this file's own test. It also
   * cost a `TextEncoder` pass over the whole workspace on every turn, since
   * `Repository.list` is `getAll()` and the text has already crossed out of the
   * store by the time it could be measured.
   *
   * Sorted here rather than by the caller: IndexedDB returns records in key
   * order and `MemoryRepository` in insertion order, and a listing that differs
   * between the two stores would make the in-memory fallback a different
   * product from the real one.
   */
  async list() {
    const found = await this.repository.list()
    if (!found.ok) return found
    const files = (found.value ?? [])
      .map((record) => ({ path: record.id }))
      .sort((a, b) => a.path.localeCompare(b.path))
    return Outcome.ok(files)
  }

  async read(path) {
    const named = workspacePath(path)
    if (!named.ok) return named

    const found = await this.repository.get(named.value)
    if (!found.ok) return found
    if (!found.value) return Outcome.ok(null)

    const text = found.value.text ?? ''
    return Outcome.ok({ path: named.value, text, bytes: Workspace.bytesOf(text) })
  }

  /**
   * Write a whole file.
   *
   * `created` comes back because "wrote 40 bytes to notes.md" and "replaced
   * notes.md" are different events to the thing that asked, and a caller that
   * has to read before writing to tell them apart pays a round trip for a fact
   * the write already knew.
   */
  async write(path, content) {
    const named = workspacePath(path)
    if (!named.ok) return named

    const text = typeof content === 'string' ? content : String(content ?? '')
    const bytes = Workspace.bytesOf(text)
    if (bytes > MAX_FILE_BYTES) {
      return Outcome.failed(
        Reason.BAD_REQUEST,
        `${named.value} would be ${bytes} bytes and the limit is ${MAX_FILE_BYTES}`,
        { hint: 'Split it across several files, or write less of it.' },
      )
    }

    const existing = await this.repository.get(named.value)
    if (!existing.ok) return existing

    const written = await this.repository.put({ id: named.value, text })
    if (!written.ok) return written
    return Outcome.ok({ path: named.value, bytes, created: !existing.value })
  }
}

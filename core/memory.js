/** Memory — the transcript, its log on disk, and the rolling-summary compactor.
 *
 * Extracted from `engine.py` so an Agent can own one. Every message is appended
 * to `logPath` — `agents/<name>/log.txt` — off the turn, so an agent's
 * conversation lives in its own folder and is read back at startup. Once the
 * history reaches `compactAt` a summarizer is handed everything except the
 * newest `keepRecent`, and the window rolls: each compaction folds the previous
 * summary into the new one. Compaction rewrites the log to match, so the file is
 * what the agent holds rather than a record of turns it can no longer see. What
 * the summary replaced is gone from disk too — the summary is meant to be the
 * only copy, and a file still holding the originals would contradict it.
 */

import { History } from "./components.js"
import { Message } from "./inference.js"

/** @typedef {import("./ports.js").Ports} Ports */

/** Anything with `invoke(prompt)` — a sub-agent satisfies it with no adapter.
 * @typedef {{ invoke(prompt: string): Promise<unknown> }} Summarizer */

/** Where `logging.getLogger` went: a pure core does not own a logger, so one
 * arrives at construction and defaults to nothing (see SILENT).
 * @typedef {{ warning(m: string): void, info(m: string): void }} Log */

export const SUMMARY_HEADING = "Summary of the conversation so far:"

export const COMPACT_PROMPT =
  "Summarise the conversation transcript below. Your summary replaces it entirely, so the " +
  "assistant will have nothing else to work from.\n\n" +
  "If the transcript opens with an earlier summary, fold it into yours — what it records " +
  "still counts, and yours is the only copy that survives.\n\n" +
  "Keep: what the user asked for, decisions made, facts established, tool results that still " +
  "matter, and anything left unfinished. Drop: greetings, failed attempts that were retried, " +
  "tool results that were later superseded, and commentary.\n\n" +
  "Write it as plain notes in the third person. No preamble, no sign-off.\n\n" +
  "TRANSCRIPT:\n\n"

/** @type {Log} */ const SILENT = { warning() {}, info() {} }

/** @param {Message} message @returns {string} */
function format(message) {
  return `[${message.role.toUpperCase()}]: ${message.content}`
}

/** The summarizer's reply as text: a response object's `answer` field, or the
 * reply itself when it is a bare string. @param {unknown} result @returns {string} */
function answerOf(result) {
  if (result !== null && typeof result === "object" && "answer" in result) {
    return String(/** @type {{ answer: unknown }} */ (result).answer)
  }
  return String(result)
}

/** The conversation: messages in memory, lines cached, the log on disk. */
export class Transcript {
  /** @param {object} options
   * @param {string} options.name
   * @param {string} [options.logPath]
   * @param {boolean} [options.stateless]
   * @param {number} [options.compactAt]
   * @param {number} [options.keepRecent]
   * @param {Pick<Ports, "fs">} [options.ports] only `fs` is reached for; a full Ports fits
   * @param {Log} [options.log] */
  constructor(options) {
    this.name = options.name
    this.logPath = options.logPath ?? ""
    this.stateless = options.stateless ?? false
    this.compactAt = options.compactAt ?? 75
    this.keepRecent = options.keepRecent ?? 24
    this.ports = options.ports
    this.log = options.log ?? SILENT
    /** @type {Message[]} */ this.messages = []
    /** cached rendered lines, one per message @type {string[]} */ this.lines = []
    // The serialized write queue. The Python held a lock because two appends
    // on two worker threads race and the reply lands before the question; a
    // worker has one JS thread, so a promise chain each write appends to is the
    // same guarantee by the mechanism the platform provides (PORT-MAP R3).
    this.writes = Promise.resolve()
    if (this.compactAt && this.keepRecent >= this.compactAt) {
      // Nothing would ever be old enough to summarise, so say so now rather
      // than let the prompt grow forever with the setting looking sane.
      const setting = `keep_recent=${this.keepRecent} is not below compact_at=${this.compactAt}`
      this.log.warning(`${this.name}: ${setting}, so this agent will never compact`)
    }
  }

  /** Append one turn, cache its line, record it on disk.
   * @param {Message["role"]} role @param {string} content @returns {Message} */
  add(role, content) {
    const message = new Message({ role, content })
    this.messages.push(message)
    const line = format(message)
    this.lines.push(line)
    this.record(line)
    return message
  }

  /** Drop the history. The system block survives — it is not a turn. @returns {void} */
  clear() {
    this.messages.length = 0
    this.lines.length = 0
  }

  /** The transcript as a prompt component, from the cached lines. @returns {History} */
  component() {
    return new History({ lines: [...this.lines] })
  }

  /** Append one entry to the log, off the turn. The turn never waits on the disk,
   * but the write stays on the queue so `drain` can collect it — a write dropped
   * at shutdown loses the end of the conversation. @param {string} line @returns {void} */
  record(line) {
    const fs = this.ports?.fs
    if (this.stateless || !this.logPath || !fs) return
    this.writes = this.writes.then(async () => {
      try {
        await fs.append(this.logPath, `${line}\n\n`)
      } catch (error) {
        // losing the log must not cost the conversation
        this.log.warning(`${this.name}: could not append to the log: ${String(error)}`)
      }
    })
  }

  /** Wait for every append still in flight. @returns {Promise<void>} */
  async drain() {
    await this.writes
  }

  /** Replace the log with the conversation as it now stands. Drains first: an
   * append scheduled before this call belongs in the file, and letting it land
   * afterwards would put it below the summary that already covers it. `replace`
   * is atomic, so a reader sees the old file or the new one, never half of
   * either. @returns {Promise<void>} */
  async rewriteLog() {
    const fs = this.ports?.fs
    if (this.stateless || !this.logPath || !fs) return
    await this.drain()
    const text = this.lines.map((line) => `${line}\n\n`).join("")
    try {
      await fs.replace(this.logPath, text)
    } catch (error) {
      // an unwritable log must not cost the conversation
      this.log.warning(`${this.name}: could not rewrite the log: ${String(error)}`)
    }
  }

  /** Summarise the older messages and keep the newest `keep` verbatim.
   *
   * `keep` defaults to `keepRecent` and must not be zero. Compaction runs at the
   * top of a turn, when the question just asked is already in the history;
   * summarise that away and the model answers a question it can no longer see,
   * which is exactly what it then does, confidently. The log is rewritten only
   * once the summary is in hand: a failed summarizer must leave the file alone,
   * or a conversation would be lost to an error that cost nothing else. The
   * summarizer reads the transcript and nothing else, so this agent's tools and
   * system block cannot steer it, and a failure is not fatal — carrying on
   * uncompacted is far better than stopping.
   * @param {Summarizer} summarizer @param {number} [keep] @returns {Promise<boolean>} */
  async compact(summarizer, keep) {
    const wanted = keep === undefined ? this.keepRecent : keep
    if (this.messages.length <= wanted) return false
    const cut = this.messages.length - wanted
    const recent = this.messages.slice(cut)
    const transcript = this.lines.slice(0, cut).join("\n\n")
    /** @type {unknown} */ let result
    try {
      result = await summarizer.invoke(`${COMPACT_PROMPT}${transcript}`)
    } catch (error) {
      this.log.warning(`${this.name}: could not compact history: ${String(error)}`)
      return false
    }
    const summary = answerOf(result).trim()
    if (!summary) {
      this.log.warning(`${this.name}: summarizer returned nothing, keeping the history`)
      return false
    }
    // F-4: the Python rebound `self.messages` to a new list here, leaving
    // `Agent.messages` and `Session.messages` pointing at the pre-compaction one
    // — a public attribute that silently lied. Mutating in place is what makes
    // every holder of the reference see the compaction.
    const head = new Message({ role: "system", content: `${SUMMARY_HEADING}\n${summary}` })
    this.messages.splice(0, this.messages.length, head, ...recent)
    this.lines.splice(0, this.lines.length, ...this.messages.map(format))
    await this.rewriteLog()
    this.log.info(`${this.name}: compacted ${cut} messages into ${summary.length} characters`)
    return true
  }

  /** Compact once the history reaches `compactAt` messages. 0 never compacts.
   * Runs before rendering, not after: a prompt too long to send is no use.
   * @param {Summarizer} summarizer @returns {Promise<boolean>} */
  async maybeCompact(summarizer) {
    if (!this.compactAt || this.messages.length < this.compactAt) return false
    return await this.compact(summarizer)
  }
}

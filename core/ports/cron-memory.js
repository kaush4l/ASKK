/** The in-memory schedule every test runs on.
 *
 * The Python pointed `AGENT_CRONTAB` at something other than the real crontab
 * so its tests would stay off the machine's actual schedule; this is that, as a
 * port. It holds the lines and nothing else — no cron syntax, no launch line,
 * no opinion about which lines are ours. That is `core/schedule.js`'s job, and
 * keeping it there is what lets the same rules run against a `crontab` binary
 * on the host and a `schedule.json` in a page (PORT-MAP R8).
 *
 * What this adapter is careful about is the one guarantee the rules lean on:
 * `readLines` **throws** when a schedule exists but cannot be read, and the
 * caller must not write in that case, because it would replace jobs it never
 * saw. "No schedule yet" is `[]`, not a throw. The fault hook exists so a test
 * can prove that a failed read leaves the file exactly as it was.
 */

/** @typedef {import("../ports.js").CronPort} CronPort */

/** Turns one operation into a failure. Return an Error to fail, null to proceed.
 * @typedef {(op: "readLines" | "writeLines") => (Error | null | undefined)} CronFault */

/** A cron port over an array, plus the array. @typedef {CronPort & { lines: string[] }} MemoryCron */

/**
 * @param {{ lines?: string[], fault?: CronFault }} [options]
 * @returns {MemoryCron}
 */
export function memoryCron(options = {}) {
  let stored = [...(options.lines ?? [])]
  const check = (/** @type {"readLines" | "writeLines"} */ op) => {
    const failure = options.fault?.(op)
    if (failure) throw failure
  }
  return {
    async readLines() {
      check("readLines")
      return [...stored]
    },
    async writeLines(lines) {
      check("writeLines")
      // A copy, because the caller edits the array it read: a store that aliased
      // it would apply half an edit that the write later failed to complete.
      stored = [...lines]
    },
    get lines() {
      return [...stored]
    },
  }
}

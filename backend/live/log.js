// The desk's background log as the UI sees it: every line the desk's own code writes — watchers, the schedule,
// the wake book, the Telegram bridge — streamed as {type: "log", at, source, text}; the snapshot brings the newest
// ones (companion/team/kernel-team.js). The registry feeds it every event. Newest last.

const KEEP = 300

let lines = []
const listeners = new Set()

export const deskLog = {
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  getSnapshot: () => lines,
  getServerSnapshot: () => lines,
  apply(e) {
    if (e.type === "snapshot") lines = e.log ?? []
    else if (e.type === "log") lines = [...lines, { at: e.at, source: e.source, text: e.text }].slice(-KEEP)
    else return
    for (const fn of listeners) fn()
  },
}

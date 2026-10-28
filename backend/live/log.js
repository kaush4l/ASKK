// The desk's background log as the UI sees it: every line the desk's own code writes — watchers, the schedule,
// the wake book, the Telegram bridge — streamed as {type: "log", at, source, text}; the snapshot brings the newest
// ones (companion/team/kernel-team.js). The registry feeds it every event. Newest last.

import { signal } from "@/backend/live/signal"

const KEEP = 300
const lines = signal([])

export const deskLog = {
  ...lines,
  apply(e) {
    if (e.type === "snapshot") lines.set(e.log ?? [])
    else if (e.type === "log") lines.set([...lines.get(), { at: e.at, source: e.source, text: e.text }].slice(-KEEP))
  },
}

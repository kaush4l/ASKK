// The audio view's model (components/views/audio.jsx), pure: the kernel's audio artifact (backend/kernel/builtin/audio.js:
// scripts made into audio files on this Mac's speech models, files transcribed, a file sent to the owner's Telegram chat)
// → what the view draws, and the owner's calls on it (team call target artifact).
//   audioCall(id, method, extra)   make {text, title?, model?, voice?} | send {audio} | transcribe {audio} | stop {audio} |
//                                  delete {audio}
//   audioUrl(job)                  the file's address (the host's audio/file), null until it is done
//   lengthText(seconds)            "42 s" | "3 min 05 s"
//   heardOf(state, id)             the newest transcript of that file: {text, match, model} | null
//   ttsModel(state)                the text-to-speech model in use, with its voices, options and script format
//   chapterUrl(job, chapter)       a chapter's own file while the piece streams out (a job of several chapters), else null
//   partsShare(job)                0..1 of its parts made

import { withBase } from "@/backend/live/base-path"
import { teamCall } from "./stream"

export const audioCall = (id, method, extra = {}) => teamCall("artifact", method, [{ id, ...extra }])

export const audioUrl = (job) => (job?.status === "done" && job.url ? withBase(job.url) : null)

export function lengthText(seconds) {
  const s = Math.round(Number(seconds) || 0)
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`
}

export const heardOf = (state, id) => state?.transcripts?.find((t) => t.of === id) ?? null

export const ttsModel = (state) => state?.models?.tts?.find((m) => m.name === state?.tts) ?? null

export const chapterUrl = (job, c) => ((job?.chapters?.length ?? 0) > 1 && c?.status === "done" ? withBase(c.url ?? `/__askk/audio/file?id=${job.id}&chapter=${c.n}`) : null)

export const partsShare = (job) => (job?.parts?.total ? Math.min(1, job.parts.done / job.parts.total) : 0)

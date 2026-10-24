"use client"

import * as React from "react"
import { AudioLinesIcon, FileTextIcon, SendIcon, SquareIcon, Trash2Icon } from "lucide-react"

import { audioCall, audioUrl, chapterUrl, heardOf, lengthText, partsShare, ttsModel } from "@/backend/live/audio"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// Audio (kernel builtin/audio.js; 2026-10-24 owner: "an audio generation pipeline such that, even the lead is able to use
// TTS model to create audio files … the audio transcription can be a tool as well … The telegram personal chat will be
// the default channel"): closed, the newest file playing in place; open, every file with its player, who made it on which
// model and voice, how much of its script was heard back, where it was sent — Send to Telegram, Transcribe, Stop,
// Delete — and a box to make one now, on the model in use, with its script format shown. A long piece (2026-10-24 owner:
// "something that can be long as well … a change in narrative style") shows its chapters, each playable as soon as it is
// made, the parts made so far, and the voice styles with their writing guides and the changes made from feedback.

const field = "w-full rounded-md border bg-background px-2 py-1.5 text-base md:text-sm"

function useCall(id) {
  const [busy, setBusy] = React.useState(false)
  const [note, setNote] = React.useState(null)
  const call = async (method, extra, done) => {
    setBusy(true)
    setNote(null)
    try {
      const r = await audioCall(id, method, extra)
      setNote({ ok: true, text: r?.deleted ? `deleted ${r.deleted.join(", ")}` : String(r?.result ?? "done").split("\n")[0] })
      done?.()
      return true
    } catch (error) {
      setNote({ ok: false, text: error.message })
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, note, call }
}

function Job({ id, state, job }) {
  const { busy, note, call } = useCall(id)
  const [asking, setAsking] = React.useState(false)
  const url = audioUrl(job)
  const heard = heardOf(state, job.id)
  const live = ["queued", "running"].includes(job.status)
  return (
    <li className="flex flex-col gap-1.5 rounded-md border px-2 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-sm">{job.title}</span>
        <span className="text-[11px] text-muted-foreground">
          {job.id} · {job.model}
          {job.voice ? `/${job.voice}` : ""} · by {job.by}
          {job.seconds ? ` · ${lengthText(job.seconds)}` : ""} · {job.chars} chars
        </span>
      </div>
      {job.status === "running" && job.parts?.total > 1 && (
        <div className="h-1 overflow-hidden rounded bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={job.parts.total} aria-valuenow={job.parts.done} aria-label="Parts made">
          <div className="h-full bg-yellow-500 transition-[width] duration-500" style={{ width: `${partsShare(job) * 100}%` }} />
        </div>
      )}
      {job.chapters?.length > 1 && (
        <ol className="flex flex-col gap-1">
          {job.chapters.map((c) => (
            <li key={c.n} className="flex flex-col gap-0.5 rounded border px-2 py-1">
              <span className="text-xs">
                {c.n}. {c.title ?? `Part ${c.n}`}
                <span className="text-muted-foreground">
                  {" "}
                  · {c.status}
                  {c.seconds ? ` · ${lengthText(c.seconds)}` : ""}
                  {c.styles?.length ? ` · ${c.styles.join(", ")}` : ""}
                  {c.sent?.length ? " · sent" : ""}
                </span>
              </span>
              {chapterUrl(job, c) && (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <audio controls preload="none" src={chapterUrl(job, c)} className="h-9 w-full" aria-label={`Play chapter ${c.n}`} />
              )}
              {c.error && <span className="text-[11px] text-destructive">{c.error}</span>}
            </li>
          ))}
        </ol>
      )}
      {url ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio controls preload="none" src={url} className="h-10 w-full" aria-label={`Play ${job.title}`} />
      ) : (
        <p className={cn("text-xs", ["failed", "interrupted", "stopped"].includes(job.status) ? "text-destructive" : "text-muted-foreground")}>
          {live ? (job.status === "running" ? "being made…" : "waiting its turn…") : job.status}
          {job.error ? ` — ${job.error}` : ""}
        </p>
      )}
      {heard && (
        <p className="text-[11px] text-muted-foreground">
          heard back
          {heard.match != null ? <span className={cn("tabular-nums", heard.match >= 0.9 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}> {Math.round(heard.match * 100)}% of its script</span> : null} ({heard.model}): <span className="line-clamp-2 break-words">{heard.text}</span>
        </p>
      )}
      {job.sent?.length > 0 && <p className="text-[11px] text-muted-foreground">sent to Telegram {new Date(job.sent.at(-1).at).toLocaleString()}</p>}
      <div className="flex flex-wrap items-center gap-1">
        {job.status === "done" && (
          <>
            <Button size="sm" variant="outline" className="pointer-coarse:h-10" disabled={busy} onClick={() => call("send", { audio: job.id })}>
              <SendIcon /> {job.sent?.length ? "Send again" : "Send to Telegram"}
            </Button>
            <Button size="sm" variant="ghost" className="pointer-coarse:h-10" disabled={busy} onClick={() => call("transcribe", { audio: job.id })} title="Read it back with the speech-to-text model and compare it with its script">
              <FileTextIcon /> Transcribe
            </Button>
          </>
        )}
        {live && (
          <Button size="sm" variant="ghost" className="text-destructive pointer-coarse:h-10" disabled={busy} onClick={() => call("stop", { audio: job.id })}>
            <SquareIcon /> Stop
          </Button>
        )}
        {asking ? (
          <>
            <Button size="sm" variant="destructive" className="pointer-coarse:h-10" disabled={busy} onClick={() => call("delete", { audio: job.id }, () => setAsking(false))}>
              <Trash2Icon /> Delete for good?
            </Button>
            <Button size="sm" variant="ghost" className="pointer-coarse:h-10" disabled={busy} onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" className="text-destructive pointer-coarse:h-10" disabled={busy} onClick={() => setAsking(true)}>
            <Trash2Icon /> Delete
          </Button>
        )}
      </div>
      {note && <p className={cn("text-xs", note.ok ? "text-muted-foreground" : "text-destructive")}>{note.text}</p>}
    </li>
  )
}

function MakeNow({ id, state }) {
  const { busy, note, call } = useCall(id)
  const [text, setText] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [voice, setVoice] = React.useState("")
  const tts = ttsModel(state)
  const count = text.trim().split(/\s+/).filter(Boolean).length
  return (
    <details className="rounded-md border px-2 py-1.5 text-xs">
      <summary className="cursor-pointer text-muted-foreground">Make audio now — on {tts?.title ?? state?.tts ?? "the model in use"} (no agent)</summary>
      <div className="mt-2 flex flex-col gap-2">
        {tts?.script && <p className="whitespace-pre-wrap text-[11px] text-muted-foreground">How to write for it: {tts.script}</p>}
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" className={field} />
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="The script, as it should be spoken" aria-label="Script" className={field} />
        {tts?.voices?.length > 0 && (
          <select value={voice} onChange={(e) => setVoice(e.target.value)} aria-label="Voice" className={cn(field, "h-10")}>
            <option value="">voice: its default</option>
            {tts.voices.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-2">
          <Button size="sm" className="pointer-coarse:h-10" disabled={busy || !text.trim()} onClick={() => call("make", { text, title: title.trim() || undefined, voice: voice || undefined }, () => (setText(""), setTitle("")))}>
            <AudioLinesIcon /> Make
          </Button>
          <span className="text-[11px] text-muted-foreground">
            {count} words ≈ {lengthText((count / 150) * 60)}
          </span>
        </div>
        {note && <p className={cn("text-xs", note.ok ? "text-muted-foreground" : "text-destructive")}>{note.text}</p>}
      </div>
    </details>
  )
}

function Styles({ state }) {
  const styles = state?.styles ?? []
  if (!styles.length) return null
  return (
    <details className="rounded-md border px-2 py-1.5 text-xs">
      <summary className="cursor-pointer text-muted-foreground">Voice styles ({styles.length}) — how each part of a long piece is voiced and written; tune them with feedback</summary>
      <ul className="mt-2 flex flex-col gap-2">
        {styles.map((st) => (
          <li key={st.name} className="flex flex-col gap-0.5">
            <span>
              {st.title} <span className="text-muted-foreground">[style: {st.name}]</span>
              {!st.ok && <span className="text-destructive"> · {st.problem}</span>}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {st.use || st.about} — {st.model}
              {st.voice ? ` · ${st.voice}` : ""}
              {st.speed ? ` · speed ${st.speed}` : ""}
              {Object.keys(st.options ?? {}).length ? ` · ${Object.entries(st.options).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}
            </span>
            <details>
              <summary className="cursor-pointer text-[11px] text-muted-foreground">writing guide{st.changes?.length ? ` · ${st.changes.length} change${st.changes.length === 1 ? "" : "s"}` : ""}</summary>
              <p className="whitespace-pre-wrap text-[11px]">{st.writing}</p>
              {st.changes?.length > 0 && (
                <ul className="mt-1 text-[11px] text-muted-foreground">
                  {st.changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </details>
          </li>
        ))}
      </ul>
    </details>
  )
}

export function AudioView({ id, state, expanded }) {
  const jobs = state?.jobs ?? []
  const newest = jobs.find((j) => j.status === "done") ?? jobs[0] ?? null
  if (!expanded) {
    const url = audioUrl(newest)
    return (
      <div className="mt-1 flex flex-col gap-1 text-xs">
        {newest ? (
          <>
            <span className="truncate">{newest.title}</span>
            {url ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <audio controls preload="none" src={url} className="h-9 w-full" aria-label={`Play ${newest.title}`} />
            ) : (
              <span className="text-muted-foreground">{newest.status}…</span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">
            No audio yet — tts {state?.tts ?? "?"}, stt {state?.stt ?? "?"}
          </span>
        )}
      </div>
    )
  }
  return (
    <div className="mt-1 flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Text to speech: {ttsModel(state)?.title ?? state?.tts ?? "?"} · speech to text: {state?.stt ?? "?"} · a file goes to your Telegram chat when sent
      </p>
      {jobs.length ? (
        <ul className="flex flex-col gap-2">
          {jobs.map((j) => (
            <Job key={j.id} id={id} state={state} job={j} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No audio yet. Ask the lead for a story, a talk, a class, an explanation or a narrative — or make one below.</p>
      )}
      <Styles state={state} />
      <MakeNow id={id} state={state} />
    </div>
  )
}

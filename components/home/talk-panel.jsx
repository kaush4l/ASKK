"use client"

import * as React from "react"
import { MicIcon, MicOffIcon, Settings2Icon, Volume2Icon, VolumeXIcon } from "lucide-react"

import { SpeechToSpeech } from "@/backend/hardware/speech/pipeline"
import { askChat, chatAnswer } from "@/backend/live/agent"
import { conversation, deskGoal, deskPhase, ownerFrom } from "@/backend/live/focus"
import { ChatPair } from "@/components/agents/thread"
import { Composer } from "@/components/chat/composer"
import { SettingsSheet } from "@/components/sts/settings/settings-sheet"
import { Caption } from "@/components/sts/stage/caption"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The dashboard's one place to talk to the desk (2026-10-23 owner: "make the landing dashboard page the way to interact
// … this dashboard itself will have all of the options, including the STS page features"): what the desk works toward
// and the phase it is in (backend/live/focus.js), the last few things said between the owner and the lead as a rolling
// window, the message box (Send · Ask · Guide · Queue) and the voice bar — continuous (every word transcribed, what follows
// the wake word sent at a long pause) or single (one command, then the mic closes), the pause that ends a command, the
// speech settings. Behaviour stays in the agents' methods and the speech pipeline; this draws and calls.

const STATUS_TONE = {
  working: "text-sky-600 dark:text-sky-400",
  answered: "text-emerald-600 dark:text-emerald-400",
  failed: "text-destructive",
}
const SEGMENT = {
  done: "bg-emerald-500",
  reused: "bg-emerald-500/50",
  running: "bg-sky-500 motion-safe:animate-pulse",
  failed: "bg-destructive",
  stopped: "bg-amber-500",
  interrupted: "bg-amber-500",
  skipped: "bg-amber-300/60", // skipped at the deadline, or a plan item skipped
  waiting: "bg-muted-foreground/25",
}

function ago(iso, now) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (!Number.isFinite(s)) return ""
  if (s < 45) return "just now"
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

// ── goal and phase ────────────────────────────────────────────────────────

function GoalPhase({ goal, phase, lead, now }) {
  const [open, setOpen] = React.useState(false)
  if (!goal && !phase) return <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No goal yet. Tell {lead} what you need below.</p>
  return (
    <section aria-label="Goal and phase" className="flex flex-col gap-3 rounded-xl border p-4">
      {goal && (
        <div className="flex flex-col gap-1">
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="uppercase tracking-wide">Goal</span>
            <span className={STATUS_TONE[goal.status]}>{goal.status}</span>
            <span>· from {goal.from}</span>
            {goal.at && <span>· {ago(goal.at, now)}</span>}
          </p>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={cn("text-left text-sm whitespace-pre-wrap break-words pointer-coarse:min-h-10", !open && "line-clamp-3")}>
            {goal.text}
          </button>
          {/* a run the owner did not start (a schedule, a wake, a quest): its answer is nowhere else on the dashboard */}
          {goal.answer && !ownerFrom(goal.from === "you" ? null : goal.from) && (
            <p className={cn("border-l-2 pl-2 text-sm text-muted-foreground whitespace-pre-wrap break-words", goal.status === "failed" && "border-destructive text-destructive", !open && "line-clamp-2")}>{goal.answer}</p>
          )}
        </div>
      )}
      {phase && phase.kind !== "activity" && (
        <div className="flex flex-col gap-1.5">
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="uppercase tracking-wide">Phase</span>
            <span className="text-foreground/80">{phase.title}</span>
            {phase.total > 0 && <span className="tabular-nums">· {phase.done}/{phase.total}</span>}
          </p>
          {phase.segments.length > 0 && (
            <div className="flex h-1.5 gap-0.5" aria-hidden>
              {phase.segments.map((s) => (
                <span key={s.id} title={`${s.id}: ${s.status}`} className={cn("flex-1 rounded-full", SEGMENT[s.status] ?? SEGMENT.waiting)} />
              ))}
            </div>
          )}
          {phase.now && <p className="text-sm">{phase.now}</p>}
        </div>
      )}
    </section>
  )
}

// ── the rolling conversation ─────────────────────────────────────────────

function Bubble({ item, now }) {
  const [open, setOpen] = React.useState(false)
  const you = item.side === "you"
  return (
    <li className={cn("flex", you ? "justify-end" : "justify-start")}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "flex max-w-[85%] flex-col gap-0.5 rounded-2xl px-3 py-2 text-left text-sm",
          you ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border",
          item.error && "border-destructive text-destructive"
        )}
      >
        <span className={cn("whitespace-pre-wrap break-words", !open && "line-clamp-3")}>{item.text}</span>
        <span className={cn("text-[10px]", you ? "text-primary-foreground/70" : "text-muted-foreground")}>
          {item.kind === "ask" ? "asked" : item.kind === "reply" ? "replied" : item.kind === "request" ? "sent" : "answered"}
          {item.at ? ` · ${ago(item.at, now)}` : ""}
        </span>
      </button>
    </li>
  )
}

function Conversation({ items, now, engine }) {
  const ref = React.useRef(null)
  const last = items.at(-1)?.id
  React.useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [last])
  if (!items.length) return null
  return (
    <ol ref={ref} aria-label="Recent conversation" className="flex max-h-72 flex-col gap-2 overflow-auto px-1">
      {items.map((item) =>
        item.kind === "chat" ? (
          // an ask and its reply whole: a visual it drew, work it proposes (Queue it), a note it passed to the run
          <li key={item.id}>
            <ChatPair engine={engine} question={item.question} answer={item.answer} taken={item.taken} />
          </li>
        ) : (
          <Bubble key={item.id} item={item} now={now} />
        )
      )}
    </ol>
  )
}

// ── voice ────────────────────────────────────────────────────────────────

const PAUSES = [1500, 2000]

function VoiceBar({ lead }) {
  const [model] = React.useState(() => new SpeechToSpeech())
  const state = React.useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  // listening and speaking are separate switches (2026-10-23 owner: "I might want to speak but watch the output"): the
  // mic sends what is said to the lead; the speaker (settings.speak, off by default, kept in this browser) reads its
  // work aloud — with or without the mic
  React.useEffect(() => {
    model.init()
    return () => model.dispose()
  }, [model])
  React.useEffect(() => {
    model.attach(lead)
  }, [model, lead])
  const { settings, listening, phase, error, speaking } = state
  const newest = state.turns?.at(-1)
  const lastNote = newest && ["error", "system"].includes(newest.kind) && newest.text !== error ? newest : null
  const usable = state.ready && !!settings.asr
  const listen = settings.listen
  const speaks = !!settings.speak && !!settings.voice
  const toggle = () => {
    if (listening) return model.stop()
    model.attach(lead) // before the first words: a command sent now goes to the lead
    model.start()
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={listening ? "secondary" : "outline"}
          size="icon"
          className={cn("size-10 rounded-full", listening && "border-sky-400 text-sky-600 dark:text-sky-300", phase === "hearing" && "ring-2 ring-cyan-400")}
          onClick={toggle}
          disabled={!usable}
          aria-pressed={listening}
          aria-label={listening ? "Stop listening" : "Start listening"}
        >
          {listening ? <MicIcon /> : <MicOffIcon />}
        </Button>
        <div role="radiogroup" aria-label="Transcription" className="flex rounded-md border p-0.5 text-xs">
          {[
            { value: "wake", label: "Continuous" },
            { value: "once", label: "Single" },
          ].map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={listen === o.value}
              onClick={() => model.setSettings({ listen: o.value })}
              className={cn("rounded px-2 py-1 pointer-coarse:min-h-9", listen === o.value ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Pause that sends" className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>sends after</span>
          {PAUSES.map((ms) => (
            <button
              key={ms}
              type="button"
              role="radio"
              aria-checked={settings.commandPauseMs === ms}
              onClick={() => model.setSettings({ commandPauseMs: ms })}
              className={cn("rounded border px-1.5 py-0.5 tabular-nums pointer-coarse:min-h-9", settings.commandPauseMs === ms ? "border-primary text-foreground" : "border-transparent hover:text-foreground")}
            >
              {ms / 1000} s
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10"
            onClick={() => model.setSettings({ speak: !settings.speak })}
            disabled={!settings.voice}
            aria-pressed={speaks}
            aria-label={speaks ? "Stop speaking the lead's work" : "Speak the lead's work"}
            title={!settings.voice ? "No voice here" : speaks ? `Speaking the lead's work (${state.support?.mac?.tts?.title ?? settings.voice}): click to silence` : "Speak the lead's work aloud (separate from the mic)"}
          >
            {speaks ? <Volume2Icon /> : <VolumeXIcon />}
          </Button>
          <Button type="button" variant="ghost" size="icon" className="size-10" onClick={() => setSettingsOpen(true)} aria-label="Voice settings">
            <Settings2Icon />
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        <span className="text-foreground/80">{listening ? "Mic on" : "Mic off"} · {speaks ? "speaking answers" : "answers on screen only"}</span>
        {settings.asr === "mac" && state.support?.mac?.stt ? ` · hears with ${state.support.mac.stt.title}` : ""}
        {" — "}
        {!state.ready
          ? "Checking this device's speech…"
          : !usable
            ? "No speech recognizer here: open ASKK from its server on this Mac, or use Safari."
            : listen === "wake"
              ? `Continuous: every word is transcribed; say “${settings.wakeWord}”, then your command — a ${settings.commandPauseMs / 1000} s pause sends it, a shorter one waits for more.`
              : listen === "once"
                ? `Single: one command — a ${settings.commandPauseMs / 1000} s pause sends it, then the mic closes.`
                : "Direct: every utterance is a command (voice settings)."}
      </p>
      {(listening || speaking) && (
        <div className="min-h-6 text-sm" aria-live="polite">
          <Caption state={state} />
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {/* what the voice did last that the caption does not show: not recognized, not spoken, an echo ignored, cancelled */}
      {lastNote && <p className={cn("text-xs", lastNote.kind === "error" ? "text-destructive" : "text-muted-foreground")}>{lastNote.text}</p>}
      {state.settingsError && <p className="text-xs text-amber-600 dark:text-amber-400">Voice settings {state.settingsError}</p>}
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} state={state} model={model} />
    </div>
  )
}

// ── the panel ─────────────────────────────────────────────────────────────

export function TalkPanel({ engine, state, artifacts, talking = false, now }) {
  const [text, setText] = React.useState("")
  const [sent, setSent] = React.useState(null) // what became of the last message: queued, or guidance not delivered
  const [chat, setChat] = React.useState(null) // the question on its way (askChat); its pair shows in the window once back
  const running = state?.status === "running"
  const goal = React.useMemo(() => deskGoal(state), [state])
  const phase = React.useMemo(() => deskPhase(artifacts, state), [artifacts, state])
  // with the desk's talk panel below, the asks and replies are there; here the requests and their answers
  const items = React.useMemo(() => conversation(state?.messages ?? []).filter((x) => !talking || x.kind !== "chat"), [state?.messages, talking])
  // "Queued: …" is true until the run it waited behind ends (audit 19: it stayed up after the queued run had run)
  const workingOn = state?.working?.request ?? null
  React.useEffect(() => setSent(null), [workingOn])
  const lead = engine?.name ?? "the lead"
  return (
    <section aria-labelledby="talk-title" className="flex w-full max-w-2xl flex-col gap-3">
      <h2 id="talk-title" className="flex items-center gap-2 text-sm text-muted-foreground">
        <span aria-hidden className={cn("size-2 rounded-full", running ? "animate-pulse bg-emerald-500" : "bg-muted-foreground/40")} />
        Talk to <span className="text-foreground">{lead}</span>
        <span>· {running ? "working" : "ready"}</span>
      </h2>
      <GoalPhase goal={goal} phase={phase} lead={lead} now={now} />
      <Conversation items={items} now={now} engine={engine} />
      {chat && (chat.pending || chat.error) && (
        <ChatPair engine={engine} question={chat.question} answer={chatAnswer(chat)} pending={!!chat.pending} error={chat.error} onDismiss={() => setChat(null)} />
      )}
      <Composer
        value={text}
        onChange={setText}
        onSend={(query) => {
          setSent(running ? `Queued: ${lead} runs it after the current run.` : null)
          // a refusal (the desk down, a reload, a full queue) says so and puts the text back (audit 19)
          engine.send(query).catch((error) => (setText((t) => t || query), setSent(`Not sent: ${error.message}`)))
        }}
        onGuide={async (note) => {
          // Read at its next step; a run that ended first gives the text back.
          setSent(null)
          const back = (why) => (setText((t) => t || note), setSent(why))
          try {
            const { delivered } = (await engine.guide(note)) ?? {}
            if (!delivered) back(`${lead} finished before your note arrived: it is back in the box, send it as new work.`)
          } catch (error) {
            back(`Guidance not sent: ${error.message}`)
          }
        }}
        onAsk={async (question) => {
          // Answered beside the run (no new run); a failure gives the text back.
          setChat({ question, pending: true })
          const outcome = await askChat(engine, question)
          if (outcome.error) setText((t) => t || question)
          setChat(outcome)
        }}
        onStop={() => engine.stop()}
        running={running}
        disabled={!engine}
        label={`Message ${lead}`}
        placeholder={engine ? (running ? `Ask ${lead} about the work, or guide it…` : `Tell ${lead} what you need…`) : "Connecting to the desk…"}
      />
      {sent && (
        <p className="px-1 text-xs text-muted-foreground" aria-live="polite">
          {sent}
        </p>
      )}
      {engine && <VoiceBar lead={engine} />}
    </section>
  )
}

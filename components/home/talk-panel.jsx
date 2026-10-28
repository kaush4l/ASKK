"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { AudioLinesIcon, MicIcon, MicOffIcon, Settings2Icon, SquareIcon, Volume2Icon, VolumeXIcon } from "lucide-react"

import { SpeechToSpeech } from "@/backend/hardware/speech/pipeline"
import { describeActivity } from "@/backend/live/activity"
import { askChat, chatAnswer } from "@/backend/live/agent"
import { ago, conversation, deskGoal, deskPhase, lastTool, since } from "@/backend/live/focus"
import { goalLine, requestFrame, ROUTE, standingGoal } from "@/backend/live/goal"
import { sameJson } from "@/backend/live/signal"
import { deskChat, talkOf } from "@/backend/live/talk"
import { SpeakButton } from "@/components/agents/speak-button"
import { ChatPair } from "@/components/agents/thread"
import { Composer } from "@/components/chat/composer"
import { voiceRowClasses } from "@/components/home/voice-row"
import { Rewritten } from "@/components/input/rewritten"
import { Caption } from "@/components/sts/stage/caption"
import { DeskMessage, useSeen } from "@/components/talk/desk-talk"
import { Button } from "@/components/ui/button"
import { useDesk, useEngineState } from "@/hooks/use-engines"
import { useNow } from "@/hooks/use-now"
import { cn } from "@/lib/utils"

// The voice settings sheet (ModelPanel, views/kit, ui/sheet) is its own client chunk, fetched on its first open (home-speed)
const SettingsSheet = dynamic(() => import("@/components/sts/settings/settings-sheet").then((m) => m.SettingsSheet), { ssr: false })

// The voice row's controls at 375: 40px targets below sm, and a row that wraps (2026-10-26, components/home/voice-row.js)
const VOICE_ROW = voiceRowClasses()

// The dashboard's talk with the desk (2026-10-23 owner: "make the landing dashboard page the way to interact"; 2026-10-25
// owner: "Make the chat window short and to the side and focus on the agent flow live dashboard at the center with the
// text box"), in three parts the page places: LeadGoal (what the lead works toward now), ChatRail (one scrolling
// timeline — your requests, the lead's answers, your questions and its replies, what the desk tells and asks you, the
// run's live status, what waits in its inbox) and MessageBox (Send · Ask · Guide · Queue, the voice on demand).
// Behaviour stays in the agents' methods and the speech pipeline; this draws and calls.

const STATE = {
  working: { dot: "bg-violet-500 motion-safe:animate-pulse", text: "text-violet-500 dark:text-violet-400" },
  answered: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  failed: { dot: "bg-destructive", text: "text-destructive" },
}
const SEGMENT = {
  done: "bg-emerald-500",
  reused: "bg-emerald-500/50",
  running: "bg-violet-500 motion-safe:animate-pulse",
  failed: "bg-destructive",
  stopped: "bg-amber-500",
  interrupted: "bg-amber-500",
  skipped: "bg-amber-300/60", // skipped at the deadline, or a plan item skipped
  waiting: "bg-muted-foreground/25",
}
const LIVE = new Set(["active", "paused"]) // a standing goal worth the strip; a dropped or met one lives in its view

// ── the goal strip: what the lead works toward now ──────────────────────

function GoalStrip({ goal, frame, phase, standing, now }) {
  if (!goal && !phase && !standing) return null
  // the lead's frame of this request (goal.frame): its outcome, else the request itself
  const framed = goal && frame && (!goal.at || frame.at >= goal.at) ? frame : null
  const tone = STATE[goal?.status] ?? STATE.answered
  return (
    <section aria-label="Goal and phase" className="flex flex-col gap-1.5 rounded-xl border px-4 py-2.5 text-sm">
      {goal && (
        <p className="flex min-w-0 items-center gap-2">
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", tone.dot)} />
          {framed ? (
            <span title={ROUTE[framed.route]?.says} className="shrink-0 rounded-full border px-1.5 text-[11px] text-muted-foreground">{ROUTE[framed.route]?.label ?? framed.route}</span>
          ) : (
            goal.status === "working" && <span className="shrink-0 text-[11px] text-muted-foreground motion-safe:animate-pulse">framing…</span>
          )}
          <span className="min-w-0 truncate" title={framed ? `done when: ${framed.done}` : goal.text}>{framed?.intent ?? goal.text}</span>
          <span className={cn("ml-auto shrink-0 text-[11px]", tone.text)}>{goal.status}</span>
        </p>
      )}
      {phase && phase.kind !== "activity" && (
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">{phase.title}</span>
          {phase.segments.length > 0 && (
            <span className="flex h-1.5 min-w-12 flex-1 gap-0.5" aria-hidden>
              {phase.segments.map((s) => <span key={s.id} title={`${s.id}: ${s.status}`} className={cn("flex-1 rounded-full", SEGMENT[s.status] ?? SEGMENT.waiting)} />)}
            </span>
          )}
          {phase.total > 0 && <span className="shrink-0 tabular-nums">{phase.done}/{phase.total}</span>}
        </div>
      )}
      {standing && (
        <p className="truncate text-xs text-muted-foreground" title={standing.state.goal.text}>
          <span className="text-foreground/80">Standing goal</span> · {standing.state.goal.text} · {goalLine(standing.state, now)}
        </p>
      )}
    </section>
  )
}

// ── the timeline ─────────────────────────────────────────────────────────

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
        <span className={cn("whitespace-pre-wrap break-words", !open && "line-clamp-6")}>{item.text}</span>
        {item.original && <Rewritten original={item.original} rewrite={item.rewrite} shown={open} />}
        <span className={cn("text-[10px]", you ? "text-primary-foreground/70" : "text-muted-foreground")}>
          {you ? (item.from && item.from !== "owner" ? `via ${item.from}` : "you") : "answered"}
          {item.at ? ` · ${ago(item.at, now)}` : ""}
        </span>
      </button>
      {!you && !item.error && item.text && <SpeakButton text={item.text} className="ml-1 self-end text-[11px] text-muted-foreground" />}
    </li>
  )
}

// The run in progress, as the lead's last bubble: what it does now, its last call, how long — and Stop.
function LiveStatus({ engine, state }) {
  const now = useNow(1000)
  const tool = lastTool(state)
  return (
    <li className="flex items-start gap-2" aria-live="polite">
      <div className="flex max-w-[85%] min-w-0 flex-col gap-0.5 rounded-2xl rounded-bl-sm border border-dashed border-violet-500/60 px-3 py-2 text-sm">
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-violet-500 motion-safe:animate-pulse" />
          <span className="min-w-0 truncate">{describeActivity(state.activity)}</span>
          {state.working?.at && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{since(state.working.at, now)}</span>}
        </span>
        {tool && <span className="truncate text-xs text-muted-foreground">last: {tool.kind === "agent" ? "quest to " : ""}{tool.name}{tool.ok ? "" : " (failed)"}</span>}
      </div>
      <Button variant="ghost" size="sm" className="shrink-0 text-destructive pointer-coarse:h-10" onClick={() => engine.stop()} aria-label={`Stop ${engine.name}`}>
        <SquareIcon /> Stop
      </Button>
    </li>
  )
}

// What waits behind the run (kernel Agent.inbox): your next bubbles, faded until their turn.
const Waiting = ({ m, now }) => (
  <li className="flex justify-end motion-safe:animate-in motion-safe:slide-in-from-bottom-1">
    <span className="flex max-w-[85%] flex-col gap-0.5 rounded-2xl rounded-br-sm border border-dashed px-3 py-2 text-sm text-muted-foreground">
      <span className="line-clamp-3 break-words">{m.text}</span>
      <span className="text-[10px]">waiting · {m.from === "owner" ? "you" : m.from} · {ago(m.at, now)}</span>
    </span>
  </li>
)

function Timeline({ items, engine, state, talk, now }) {
  const ref = React.useRef(null)
  const running = state?.status === "running"
  const tail = `${items.at(-1)?.id}:${running}:${state?.inbox?.length ?? 0}`
  // newest at the bottom: follow it as it comes
  React.useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [tail])
  const askedBy = (id) => talk?.state?.messages?.find((x) => x.id === id)?.from ?? "the desk"
  return (
    <ol ref={ref} aria-label="Conversation with the desk" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-4 py-3">
      {!items.length && !running && <li className="m-auto max-w-xs text-center text-sm text-muted-foreground">Tell {engine?.name ?? "the lead"} what you need below. Its answers, its questions for you and what it is doing now show here.</li>}
      {items.map((item) =>
        item.kind === "desk" ? (
          <li key={item.id} className={cn("flex", item.message.kind === "reply" ? "justify-end" : "justify-start")}>
            <DeskMessage talk={talk} message={item.message} askedBy={askedBy} />
          </li>
        ) : item.kind === "chat" ? (
          // an ask and its reply whole: a visual it drew, work it proposes (Queue it), a note it passed to the run
          <li key={item.id}>
            <ChatPair engine={engine} question={item.question} answer={item.answer} taken={item.taken} />
          </li>
        ) : (
          <Bubble key={item.id} item={item} now={now} />
        )
      )}
      {running && <LiveStatus engine={engine} state={state} />}
      {state?.inbox?.map((m) => <Waiting key={m.id} m={m} now={now} />)}
    </ol>
  )
}

// ── the parts the dashboard places ───────────────────────────────────────

// What the lead works toward now: the request's frame, its workflow or plan, an active standing goal.
export function LeadGoal({ engine }) {
  const state = useEngineState(engine)
  const now = useNow()
  const goal = React.useMemo(() => deskGoal(state), [state])
  // an artifact's patch redraws the strip only when what it shows changed
  const phase = useDesk((d) => deskPhase(d?.artifacts, state), sameJson)
  const standing = useDesk((d) => {
    const g = standingGoal(d?.artifacts)
    return LIVE.has(g?.state?.status) ? g : null
  })
  const frame = useDesk((d) => requestFrame(d?.artifacts, engine?.name), sameJson)
  return <GoalStrip goal={goal} frame={frame} phase={phase} standing={standing} now={now} />
}

// The chat with the lead as a side rail: its state on top, then the timeline (newest at the bottom).
export function ChatRail({ engine, className }) {
  const state = useEngineState(engine)
  const now = useNow()
  const running = state?.status === "running"
  const talk = useDesk((d) => talkOf(d?.artifacts))
  useSeen(talk)
  const items = React.useMemo(() => deskChat(conversation(state?.messages ?? [], { limit: 40 }), talk), [state?.messages, talk])
  return (
    <section aria-label={`Chat with ${engine?.name ?? "the lead"}`} className={cn("flex min-h-0 flex-col", className)}>
      <header className="flex items-center gap-2 border-b px-4 py-2 text-sm">
        <span aria-hidden className={cn("size-2 rounded-full", running ? "bg-violet-500 motion-safe:animate-pulse" : state?.status === "error" ? "bg-destructive" : "bg-muted-foreground/40")} />
        <span>{engine?.name ?? "the lead"}</span>
        <span className="text-xs text-muted-foreground">{running ? "working" : state?.status === "error" ? "stopped on an error" : "ready"}</span>
      </header>
      <Timeline items={items} engine={engine} state={state} talk={talk} now={now} />
    </section>
  )
}

// ── the voice on demand ──────────────────────────────────────────────────

const PAUSES = [1500, 2000]

function VoiceBar({ lead }) {
  const [model] = React.useState(() => new SpeechToSpeech())
  const state = React.useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [settingsUsed, setSettingsUsed] = React.useState(false) // the sheet's chunk is fetched on its first open (home-speed)
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
      <div className={VOICE_ROW.row}>
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
              className={cn("rounded px-2 py-1 pointer-coarse:min-h-9", VOICE_ROW.choice, listen === o.value ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
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
              className={cn("rounded border px-1.5 py-0.5 tabular-nums pointer-coarse:min-h-9", VOICE_ROW.pause, settings.commandPauseMs === ms ? "border-primary text-foreground" : "border-transparent hover:text-foreground")}
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
          <Button type="button" variant="ghost" size="icon" className="size-10" onClick={() => (setSettingsUsed(true), setSettingsOpen(true))} aria-label="Voice settings">
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
      {settingsUsed && <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} state={state} model={model} />}
    </div>
  )
}

// The message box (Send · Ask · Guide · Queue), an Ask on its way, and the voice on demand.
export function MessageBox({ engine, className }) {
  const running = useEngineState(engine, (s) => s?.status === "running")
  const [text, setText] = React.useState("")
  const [sent, setSent] = React.useState(null) // what became of the last message when it did not go: refused, or guidance not delivered
  const [chat, setChat] = React.useState(null) // the question on its way (askChat); its pair shows in the chat once back
  const [voice, setVoice] = React.useState(false)
  const lead = engine?.name ?? "the lead"
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {chat && (chat.pending || chat.error) && (
        <ChatPair engine={engine} question={chat.question} answer={chatAnswer(chat)} pending={!!chat.pending} error={chat.error} onDismiss={() => setChat(null)} />
      )}
      {voice && engine && <VoiceBar lead={engine} />}
      <div className="flex items-start gap-2">
        <Composer
          className="min-w-0 flex-1"
          value={text}
          onChange={setText}
          onSend={(query) => {
            setSent(null) // a request behind the run shows in the chat as waiting
            // a refusal (the desk down, a reload, a full queue) says so and puts the text back (audit 19)
            engine.send(query, { via: "typed" }).catch((error) => (setText((t) => t || query), setSent(`Not sent: ${error.message}`)))
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
        <Button type="button" variant={voice ? "secondary" : "ghost"} size="icon" className="mt-1 size-10 shrink-0" onClick={() => setVoice((v) => !v)} aria-pressed={voice} aria-label={voice ? "Hide the voice controls" : "Talk by voice"}>
          <AudioLinesIcon />
        </Button>
      </div>
      {sent && <p className="px-1 text-xs text-muted-foreground" aria-live="polite">{sent}</p>}
    </div>
  )
}

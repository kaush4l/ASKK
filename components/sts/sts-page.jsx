"use client"

import * as React from "react"
import {
  AlertTriangleIcon,
  BotIcon,
  CheckIcon,
  CpuIcon,
  HandIcon,
  LoaderIcon,
  MicIcon,
  MicOffIcon,
  SendIcon,
  Settings2Icon,
  UndoIcon,
  Volume2Icon,
  VolumeXIcon,
  XIcon,
} from "lucide-react"

import { describeActivity } from "@/backend/core/activity"
import { HARDWARE } from "@/backend/hardware"
import { NARRATION, SpeechToSpeech } from "@/backend/hardware/speech/pipeline"
import { browserVoices, macVoices } from "@/backend/hardware/speech/voices"
import { VoiceOrb } from "@/components/sts/voice-orb"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useEngineStates, useEngines } from "@/hooks/use-engines"
import { cn } from "@/lib/utils"

const PHASE_LABEL = {
  idle: "Tap the mic to talk",
  listening: "Listening",
  hearing: "Hearing you",
  armed: "Go ahead",
  transcribing: "Writing it down",
  working: "Working",
  speaking: "Speaking",
}

const PHASE_TEXT = {
  idle: "text-muted-foreground",
  listening: "text-sky-600 dark:text-sky-300",
  hearing: "text-cyan-600 dark:text-cyan-300",
  armed: "text-fuchsia-600 dark:text-fuchsia-300",
  transcribing: "text-violet-600 dark:text-violet-300",
  working: "text-amber-600 dark:text-amber-300",
  speaking: "text-emerald-600 dark:text-emerald-300",
}

const time = (at) =>
  new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })

// ── the stage: orb, live caption, controls ──────────────────────────────

function Caption({ state }) {
  const { phase, partial, speaking, lead, settings } = state
  if (speaking?.sentence) {
    const { sentence, word = 0 } = speaking
    const said = settings.voice === "browser" ? sentence.slice(0, word) : ""
    return (
      <p key={sentence} className="animate-in fade-in-0 slide-in-from-bottom-1 text-xl leading-snug duration-300 sm:text-2xl">
        <span>{said}</span>
        <span className={cn(said && "text-muted-foreground")}>{sentence.slice(said.length)}</span>
      </p>
    )
  }
  if (settings.listen === "wake" && (state.parts || state.armed)) {
    const { before = "", wake = "", command = null } = state.parts ?? {}
    const captured = state.armed ? state.command : null
    return (
      <p className="leading-snug">
        {before && !captured ? <span className="text-base text-muted-foreground sm:text-lg">{before}</span> : null}
        {wake ? <span className="text-xl text-fuchsia-600 sm:text-2xl dark:text-fuchsia-300">{wake} </span> : null}
        {captured != null || command != null ? (
          <span className="text-xl sm:text-2xl">
            {captured || command || <span className="text-muted-foreground">…</span>}
            <span className="ml-0.5 inline-block h-[1em] w-0.5 translate-y-[0.15em] animate-pulse bg-current" />
          </span>
        ) : null}
      </p>
    )
  }
  if (partial) {
    return (
      <p className="text-xl leading-snug sm:text-2xl">
        {partial}
        <span className="ml-0.5 inline-block h-[1em] w-0.5 translate-y-[0.15em] animate-pulse bg-current" />
      </p>
    )
  }
  if (phase === "working" && lead?.activity)
    return <p className="text-lg text-muted-foreground sm:text-xl">{describeActivity(lead.activity)}</p>
  return null
}

function ApprovalCard({ state, model }) {
  const approval = state.approvals?.[0]
  if (!approval) return null
  const path = approval.inputs?.path
  return (
    <div className="animate-in fade-in-0 zoom-in-95 w-full max-w-md rounded-xl border border-amber-500/60 p-4">
      <div className="flex items-center gap-2 text-amber-600 dark:text-amber-300">
        <HandIcon className="size-4" />
        <span className="text-base">Approval needed</span>
      </div>
      <p className="mt-1 text-lg break-words">
        {approval.tool}
        {path ? <span className="text-muted-foreground"> · {path}</span> : null}
      </p>
      <p className="text-sm text-muted-foreground">Say “yes” or “no”, or tap.</p>
      <div className="mt-3 flex gap-2">
        <Button variant="outline" className="flex-1 pointer-coarse:h-10" onClick={() => model.approve(approval.id, false)}>
          <XIcon /> Decline
        </Button>
        <Button className="flex-1 pointer-coarse:h-10" onClick={() => model.approve(approval.id, true)}>
          <CheckIcon /> Approve
        </Button>
      </div>
    </div>
  )
}

function MicButton({ state, model }) {
  const { listening, settings, phase } = state
  const push = listening && settings.listen !== "wake" && settings.mode === "push" && settings.asr === "mac"
  const holding = React.useRef(false)
  const down = (e) => {
    if (!push) return
    e.preventDefault()
    holding.current = true
    model.hold(true)
  }
  const up = () => {
    if (!holding.current) return
    holding.current = false
    model.hold(false)
  }
  return (
    <button
      type="button"
      onClick={() => !push && (listening ? model.stop() : model.start())}
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={up}
      aria-pressed={listening}
      aria-label={push ? "Hold to talk" : listening ? "Stop listening" : "Start listening"}
      className={cn(
        "relative grid size-20 touch-none place-items-center rounded-full border-2 transition-all duration-300 outline-none select-none focus-visible:ring-4 focus-visible:ring-ring/50 active:scale-95",
        listening ? "border-sky-400 text-sky-600 dark:text-sky-300" : "border-border text-muted-foreground hover:text-foreground",
        phase === "hearing" && "scale-110 border-cyan-400 shadow-[0_0_40px_-6px] shadow-cyan-400/70",
      )}
    >
      {listening ? <MicIcon className="size-8" /> : <MicOffIcon className="size-8" />}
      {listening && phase === "listening" ? (
        <span className="absolute inset-0 animate-ping rounded-full border border-sky-400/40 [animation-duration:2.4s]" />
      ) : null}
    </button>
  )
}

function TypeBox({ model, disabled }) {
  const [text, setText] = React.useState("")
  return (
    <form
      className="flex w-full max-w-md gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!text.trim()) return
        model.send(text.trim())
        setText("")
      }}
    >
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Or type to the lead"
        className="text-base md:text-sm"
        disabled={disabled}
        aria-label="Type a message to the lead"
      />
      <Button
        type="submit"
        size="icon-lg"
        variant="outline"
        disabled={disabled || !text.trim()}
        aria-label="Send"
        className="pointer-coarse:size-10"
      >
        <SendIcon />
      </Button>
    </form>
  )
}

function Stage({ state, model, offered, onSettings }) {
  const { phase, settings, lead, latency, error, speaking } = state
  const asrLabel = settings.asr === "mac" ? "This Mac · on-device" : settings.asr === "safari" ? "Safari dictation" : "no recognizer"
  const voiceLabel = settings.voice ? (settings.voiceName ?? (settings.voice === "mac" ? "Mac voice" : "Browser voice")) : "no voice"
  return (
    <section className="relative flex flex-col items-center gap-4 border-b px-4 pt-3 pb-6 lg:min-h-0 lg:flex-[1.15] lg:overflow-y-auto lg:border-r lg:border-b-0">
      <header className="flex w-full items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl leading-tight">Speech to speech</h1>
          <p className="truncate text-sm text-muted-foreground">
            Talking to <span className="text-foreground">{lead?.name ?? "…"}</span>
          </p>
        </div>
        <Button variant="ghost" size="icon-lg" onClick={onSettings} aria-label="Speech settings" className="pointer-coarse:size-10">
          <Settings2Icon />
        </Button>
      </header>

      <div className="flex w-full flex-wrap gap-1.5">
        <Badge variant="outline" className="gap-1">
          <CpuIcon className="size-3" /> {asrLabel}
        </Badge>
        <Badge variant="outline" className="gap-1">
          <Volume2Icon className="size-3" /> {voiceLabel}
        </Badge>
        {latency ? (
          <Badge variant="outline" className="tabular-nums">
            {latency.utterance?.toFixed(1)} s heard in {latency.asr} ms
          </Badge>
        ) : null}
      </div>

      <div className="relative w-full">
        <VoiceOrb model={model} phase={phase} className="mx-auto block h-[32svh] w-full max-w-xl sm:h-[38svh] lg:h-[42svh]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-1 text-center">
          <span className={cn("text-lg tracking-wide transition-colors duration-500", PHASE_TEXT[phase])}>{PHASE_LABEL[phase]}</span>
        </div>
      </div>

      <div className="flex min-h-[4.5rem] w-full max-w-xl items-start justify-center text-center" aria-live="polite">
        <Caption state={state} />
      </div>

      {settings.listen === "wake" && state.transcript.length ? (
        <div className="-mt-2 flex w-full max-w-xl flex-col gap-0.5 text-center text-sm" aria-label="Live transcript">
          {state.transcript.slice(-3).map((line) => (
            <p
              key={line.id}
              className={cn("truncate", line.command ? "text-fuchsia-600/90 dark:text-fuchsia-300/90" : "text-muted-foreground/70")}
            >
              {line.text}
            </p>
          ))}
        </div>
      ) : null}

      <ApprovalCard state={state} model={model} />

      {error ? (
        <p className="flex max-w-md items-start gap-2 text-sm text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      ) : null}

      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="icon-lg"
          className="size-12 rounded-full"
          onClick={() => model.interrupt()}
          disabled={!speaking}
          aria-label="Stop speaking"
        >
          <VolumeXIcon />
        </Button>
        <MicButton state={state} model={model} />
        <Button
          variant="outline"
          size="icon-lg"
          className="size-12 rounded-full"
          onClick={() => model.recall()}
          disabled={phase !== "working"}
          aria-label="Call the lead's work back"
        >
          <UndoIcon />
        </Button>
      </div>
      <p className="-mt-2 text-center text-xs text-muted-foreground">
        {settings.listen === "wake"
          ? `Say “${settings.wakeWord}”, then your command · a ${(settings.commandPauseMs / 1000).toFixed(1)} s pause sends it`
          : settings.mode === "push" && settings.asr === "mac"
            ? "Hold the mic or Space to talk"
            : "Hands-free · say “stop” to interrupt"}{" "}
        · Esc silences
      </p>

      <TypeBox model={model} disabled={!lead} />

      {!settings.asr ? (
        <p className="max-w-md text-center text-sm text-muted-foreground">
          {offered && !offered.microphone
            ? "This browser gives no microphone access."
            : "No recognizer here. Open ASKK from its server on your Mac (on-device recognition in any browser), or use Safari."}{" "}
          Typed messages still get spoken answers.
        </p>
      ) : null}
    </section>
  )
}

// ── the conversation: what you said, what it did, what it answered ──────

function Turn({ turn }) {
  if (turn.kind === "you") {
    return (
      <div className="animate-in fade-in-0 slide-in-from-right-2 flex flex-col items-end gap-0.5">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm border border-sky-500/40 px-3 py-2 text-base break-words">{turn.text}</div>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {time(turn.at)}
          {turn.ms != null ? ` · ${turn.seconds?.toFixed(1)} s heard, ${turn.ms} ms` : ""}
        </span>
      </div>
    )
  }
  if (turn.kind === "answer") {
    return (
      <div className="animate-in fade-in-0 slide-in-from-left-2 flex flex-col gap-0.5">
        <div className="max-w-[92%] rounded-2xl rounded-bl-sm border border-emerald-500/40 px-3 py-2 text-base whitespace-pre-wrap break-words">
          {turn.text}
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums">{time(turn.at)} · answer</span>
      </div>
    )
  }
  if (turn.kind === "approval") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 px-3 py-2 text-sm">
        <HandIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <span className="min-w-0 flex-1 break-words">{turn.text}</span>
        <span className="text-xs text-muted-foreground">{turn.resolved == null ? "waiting" : turn.resolved ? "approved" : "declined"}</span>
      </div>
    )
  }
  const quiet = turn.kind === "system" || turn.level === 3
  return (
    <div
      className={cn(
        "animate-in fade-in-0 flex items-center gap-2 text-sm",
        turn.kind === "error" ? "text-destructive" : quiet ? "text-muted-foreground" : "text-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          turn.kind === "error"
            ? "bg-destructive"
            : turn.status === "quest" || turn.status === "report"
              ? "bg-amber-500"
              : "bg-muted-foreground/60",
        )}
      />
      <span className="min-w-0 flex-1 truncate" title={turn.text}>
        {turn.text}
      </span>
      {turn.spoken ? <Volume2Icon className="size-3 shrink-0 text-emerald-500" aria-label="Spoken" /> : null}
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{time(turn.at)}</span>
    </div>
  )
}

function TeamStrip() {
  const { engines } = useEngines()
  const states = useEngineStates(engines)
  if (engines.length < 2) return null
  return (
    <div className="flex gap-1.5 overflow-x-auto border-b px-4 py-2 [scrollbar-width:none]">
      {engines.map((engine, i) => {
        const s = states[i]
        const busy = s?.status === "running"
        const waiting = s?.activity?.phase === "waiting"
        return (
          <span
            key={engine.id}
            title={busy ? describeActivity(s.activity) : (s?.status ?? "")}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors duration-500",
              busy ? "border-amber-500/60 text-foreground" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                busy
                  ? "animate-pulse bg-amber-500"
                  : waiting
                    ? "bg-sky-500"
                    : s?.status === "error"
                      ? "bg-destructive"
                      : "bg-muted-foreground/40",
              )}
            />
            {engine.name}
          </span>
        )
      })}
    </div>
  )
}

function Timeline({ state }) {
  const endRef = React.useRef(null)
  const count = state.turns.length
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" })
  }, [count])
  return (
    <section className="flex min-h-[50svh] min-w-0 flex-1 flex-col lg:min-h-0">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <BotIcon className="size-4 text-muted-foreground" />
        <h2 className="text-lg">Conversation</h2>
        <span className="ml-auto text-xs text-muted-foreground">{count} events</span>
      </div>
      <TeamStrip />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {count === 0 ? (
          <p className="pt-8 text-center text-sm text-muted-foreground">
            What you say goes to the lead. Its progress is spoken as it works, then its answer.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {state.turns.map((turn) => (
              <Turn key={turn.id} turn={turn} />
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>
    </section>
  )
}

// ── settings ────────────────────────────────────────────────────────────

function Choice({ value, options, onChange }) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg border p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-2 py-1.5 text-sm transition-colors disabled:opacity-40 pointer-coarse:min-h-10",
            value === o.value ? "bg-foreground text-background" : "hover:bg-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  )
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>
        {label}
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-5 accent-foreground" />
    </label>
  )
}

function useVoiceNames(open, engine, locale) {
  const [names, setNames] = React.useState([])
  React.useEffect(() => {
    if (!open || !engine) return
    let live = true
    const lang = (locale ?? "en").slice(0, 2)
    if (engine === "mac") {
      macVoices()
        .then((list) => live && setNames(list.filter((v) => v.lang.startsWith(lang)).map((v) => v.name)))
        .catch(() => live && setNames([]))
      return () => {
        live = false
      }
    }
    const read = () =>
      live &&
      setNames(
        browserVoices()
          .filter((v) => v.lang.startsWith(lang))
          .map((v) => v.name),
      )
    read()
    speechSynthesis.addEventListener?.("voiceschanged", read)
    return () => {
      live = false
      speechSynthesis.removeEventListener?.("voiceschanged", read)
    }
  }, [open, engine, locale])
  return names
}

function Settings({ open, onOpenChange, state, model }) {
  const { settings, support } = state
  const voices = useVoiceNames(open, settings.voice, settings.locale)
  const set = (patch) => model.setSettings(patch)
  const mac = support?.mac ?? {}
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-xl">Speech settings</SheetTitle>
          <SheetDescription>Saved in this browser.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-6">
          <h3 className="text-lg">Listening</h3>
          <Field
            label="Recognizer"
            hint={
              mac.recognize
                ? "This Mac: Apple's on-device model; the audio never leaves the Mac."
                : (mac.error ?? "On-device recognition needs the ASKK server on a Mac with macOS 26.")
            }
          >
            <Choice
              value={settings.asr}
              onChange={(asr) => set({ asr })}
              options={[
                { value: "mac", label: "This Mac", disabled: !mac.recognize },
                {
                  value: "safari",
                  label: "Safari",
                  disabled: !support?.safari,
                },
              ]}
            />
          </Field>
          <Field
            label="Listen mode"
            hint={
              settings.listen === "wake"
                ? "Everything is transcribed live; only what follows the wake word is sent, after the pause below."
                : "Every utterance is sent as a command."
            }
          >
            <Choice
              value={settings.listen}
              onChange={(listen) => set({ listen })}
              options={[
                { value: "wake", label: "Wake word" },
                { value: "direct", label: "Direct" },
              ]}
            />
          </Field>
          {settings.listen === "wake" ? (
            <>
              <Field label="Wake word" hint="One word or a short phrase the recognizer spells reliably (e.g. computer, hey desk).">
                <Input
                  value={settings.wakeWord}
                  onChange={(e) => set({ wakeWord: e.target.value })}
                  className="text-base md:text-sm"
                  aria-label="Wake word"
                />
              </Field>
              <Field label={`Send the command after ${(settings.commandPauseMs / 1000).toFixed(1)} s of silence`}>
                <input
                  type="range"
                  min={1000}
                  max={5000}
                  step={250}
                  value={settings.commandPauseMs}
                  onChange={(e) => set({ commandPauseMs: Number(e.target.value) })}
                  className="accent-foreground"
                  aria-label="Command pause"
                />
              </Field>
            </>
          ) : null}
          {settings.listen === "direct" ? (
            <>
              <Field label="Turn-taking" hint={settings.asr === "safari" ? "Safari listens hands-free only." : null}>
                <Choice
                  value={settings.mode}
                  onChange={(mode) => set({ mode })}
                  options={[
                    { value: "auto", label: "Hands-free" },
                    {
                      value: "push",
                      label: "Push to talk",
                      disabled: settings.asr !== "mac",
                    },
                  ]}
                />
              </Field>
              <Field label={`End of speech after ${(settings.endSilenceMs / 1000).toFixed(1)} s of silence`}>
                <input
                  type="range"
                  min={400}
                  max={2000}
                  step={100}
                  value={settings.endSilenceMs}
                  onChange={(e) => set({ endSilenceMs: Number(e.target.value) })}
                  className="accent-foreground"
                  aria-label="End of speech pause"
                />
              </Field>
              <Toggle
                label="Interrupt by speaking"
                hint="Louder speech stops the voice (headphones help)."
                checked={settings.bargeIn}
                onChange={(bargeIn) => set({ bargeIn })}
              />
            </>
          ) : null}
          <Field label="Language">
            <Input
              value={settings.locale ?? ""}
              onChange={(e) => set({ locale: e.target.value })}
              className="text-base md:text-sm"
              aria-label="Language"
            />
          </Field>

          <h3 className="pt-2 text-lg">Speaking</h3>
          <Field label="Voice engine">
            <Choice
              value={settings.voice}
              onChange={(voice) => set({ voice, voiceName: null })}
              options={[
                { value: "mac", label: "Mac voices", disabled: !mac.voice },
                {
                  value: "browser",
                  label: "Browser",
                  disabled: !support?.browserVoice,
                },
              ]}
            />
          </Field>
          <Field label="Voice" hint="Premium and Enhanced voices sound best (System Settings → Accessibility → Spoken Content).">
            <select
              value={settings.voiceName ?? ""}
              onChange={(e) => set({ voiceName: e.target.value || null })}
              className="h-9 rounded-lg border bg-background px-2 text-base md:text-sm pointer-coarse:h-10"
              aria-label="Voice"
            >
              <option value="">System default</option>
              {voices.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Speed ${settings.rate.toFixed(2)}×`}>
            <input
              type="range"
              min={0.7}
              max={1.6}
              step={0.05}
              value={settings.rate}
              onChange={(e) => set({ rate: Number(e.target.value) })}
              className="accent-foreground"
              aria-label="Speed"
            />
          </Field>
          <Button
            variant="outline"
            className="pointer-coarse:h-10"
            onClick={() => model.preview("Hello. I'll tell you what the desk is doing as it works.")}
          >
            <Volume2Icon /> Test the voice
          </Button>

          <h3 className="pt-2 text-lg">What it says</h3>
          <Field label="Narration" hint={NARRATION.find((n) => n.value === settings.narration)?.hint}>
            <Choice value={settings.narration} onChange={(narration) => set({ narration })} options={NARRATION} />
          </Field>
          <Toggle
            label="Ask for spoken-length answers"
            hint="Adds a short note to what you say: plain sentences, no tables."
            checked={settings.short}
            onChange={(short) => set({ short })}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ── page ────────────────────────────────────────────────────────────────

export function StsPage() {
  const [model] = React.useState(() => new SpeechToSpeech())
  const state = React.useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot)
  const { engines, requiredId } = useEngines()
  const lead = engines.find((e) => e.id === requiredId) ?? engines[0] ?? null
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [offered, setOffered] = React.useState(null)

  React.useEffect(() => {
    model.init()
    HARDWARE.find((h) => h.id === "speech")
      ?.detect()
      .then(setOffered)
      .catch(() => {})
    return () => model.dispose()
  }, [model])

  React.useEffect(() => {
    model.attach(lead)
  }, [model, lead])

  // Space: hold to talk (push mode) · Esc: silence the voice.
  React.useEffect(() => {
    const typing = (e) => /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target?.tagName) || e.target?.isContentEditable
    const down = (e) => {
      if (e.key === "Escape") model.interrupt()
      const { listen, mode } = model.getSnapshot().settings
      if (e.code === "Space" && !typing(e) && !e.repeat && listen !== "wake" && mode === "push") {
        e.preventDefault()
        model.hold(true)
      }
    }
    const up = (e) => {
      if (e.code === "Space" && !typing(e)) model.hold(false)
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [model])

  if (!state.ready) {
    return (
      <div className="grid flex-1 place-items-center p-8 text-muted-foreground">
        <span className="flex items-center gap-2">
          <LoaderIcon className="size-4 animate-spin" /> Checking this device's speech…
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
      <Stage state={state} model={model} offered={offered} onSettings={() => setSettingsOpen(true)} />
      <Timeline state={state} />
      <Settings open={settingsOpen} onOpenChange={setSettingsOpen} state={state} model={model} />
    </div>
  )
}

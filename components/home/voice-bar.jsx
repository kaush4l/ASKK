"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { MicIcon, MicOffIcon, Settings2Icon, Volume2Icon, VolumeXIcon } from "lucide-react"

import { SpeechToSpeech } from "@/backend/hardware/speech/pipeline"
import { Caption } from "@/components/sts/stage/caption"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// The voice settings sheet (ModelPanel, views/kit, ui/sheet) is its own client chunk, fetched on its first open (home-speed)
const SettingsSheet = dynamic(() => import("@/components/sts/settings/settings-sheet").then((m) => m.SettingsSheet), { ssr: false })

// The dashboard's voice on demand: the mic sends what is said to the lead, the speaker reads its work aloud. talk-panel
// loads this file only once voice is on (home-speed-voice), so the speech pipeline stays out of the home's first bundle.
// Behaviour stays in the speech pipeline; this draws and calls.

const PAUSES = [1500, 2000]

export function VoiceBar({ lead }) {
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

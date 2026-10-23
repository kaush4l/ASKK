"use client"

import { AlertTriangleIcon, CpuIcon, Settings2Icon, UndoIcon, Volume2Icon, VolumeXIcon } from "lucide-react"

import { Caption } from "@/components/sts/stage/caption"
import { MicButton } from "@/components/sts/stage/mic-button"
import { TypeBox } from "@/components/sts/stage/type-box"
import { VoiceOrb } from "@/components/sts/voice-orb"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { LIMITS } from "@/lib/config"
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

// The stage: orb, live caption, controls.
export function Stage({ state, model, offered, onSettings }) {
  const { phase, settings, lead, latency, error, speaking } = state
  const mac = state.support?.mac ?? {}
  const asrLabel = settings.asr === "mac" ? `This Mac · ${mac.stt?.title ?? "on-device"}` : settings.asr === "safari" ? "Safari dictation" : "no recognizer"
  const voiceLabel = settings.voice ? (settings.voice === "mac" ? (mac.tts?.title ?? "Mac voice") : (settings.voiceName ?? "Browser voice")) : "no voice"
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
        {/* speaking is its own switch, apart from the mic (2026-10-23 owner) */}
        <button type="button" onClick={() => model.setSettings({ speak: !settings.speak })} disabled={!settings.voice} aria-pressed={!!settings.speak} className="rounded-md pointer-coarse:min-h-10" title={settings.speak ? "Answers are spoken: click for on screen only" : "Answers on screen only: click to speak them"}>
          <Badge variant="outline" className={cn("gap-1", !settings.speak && "text-muted-foreground")}>
            {settings.speak ? <Volume2Icon className="size-3" /> : <VolumeXIcon className="size-3" />} {settings.speak ? voiceLabel : "voice off"}
          </Badge>
        </button>
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
          {state.transcript.slice(-LIMITS.ui.sts.transcriptLines).map((line) => (
            <p
              key={line.id}
              className={cn("truncate", line.command ? "text-fuchsia-600/90 dark:text-fuchsia-300/90" : "text-muted-foreground/70")}
            >
              {line.text}
            </p>
          ))}
        </div>
      ) : null}

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

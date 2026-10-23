"use client"

import * as React from "react"
import { LoaderIcon } from "lucide-react"

import { HARDWARE } from "@/backend/hardware"
import { SpeechToSpeech } from "@/backend/hardware/speech/pipeline"
import { SettingsSheet } from "@/components/sts/settings/settings-sheet"
import { Stage } from "@/components/sts/stage/stage"
import { Timeline } from "@/components/sts/timeline/timeline"
import { useEngines } from "@/hooks/use-engines"

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
      if (e.code === "Space" && !typing(e) && !e.repeat && listen === "direct" && mode === "push") {
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
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} state={state} model={model} />
    </div>
  )
}

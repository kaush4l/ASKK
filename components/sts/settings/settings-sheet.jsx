"use client"

import { Volume2Icon } from "lucide-react"

import { NARRATION } from "@/backend/hardware/speech/pipeline"
import { Choice, Field, Toggle } from "@/components/sts/settings/controls"
import { useVoiceNames } from "@/components/sts/settings/use-voice-names"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { LIMITS } from "@/lib/config"

export function SettingsSheet({ open, onOpenChange, state, model }) {
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
                  min={LIMITS.ui.sts.commandPauseMinMs}
                  max={LIMITS.ui.sts.commandPauseMaxMs}
                  step={LIMITS.ui.sts.commandPauseStepMs}
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
                  min={LIMITS.ui.sts.endSilenceMinMs}
                  max={LIMITS.ui.sts.endSilenceMaxMs}
                  step={LIMITS.ui.sts.endSilenceStepMs}
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
              min={LIMITS.ui.sts.voiceRateMin}
              max={LIMITS.ui.sts.voiceRateMax}
              step={LIMITS.ui.sts.voiceRateStep}
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

// Hardware features, browser side: optional features that depend on the
// machine (its microphone, speakers, on-device models) rather than on an
// agent. Each one detects what this device and host offer and degrades when
// something is missing; the host side lives in companion/hardware/.
//
//   speech/   speech to speech: mic → on-device recognition → the lead →
//             narrated progress → a voice (page /sts)
//   apple/    apple.* tools: the owner's Mac (Shortcuts, speech, clipboard,
//             Spotlight, Reminders, …) through the host API, with approval
//
// An entry may bring agent tools: `tools` (specs by name, like a feature's)
// and `capability` (the host capability they need). The feature catalogue
// (features/index.js) merges them into every host's tool contract; where the
// capability is missing the tools stay listed and fail with "not available
// here" when called.
//
// Add one = a folder here (+ companion/hardware/<name>/ when it needs the
// host) and an entry below.

import { APPLE_TOOLS } from "@/backend/hardware/apple/tools"
import { detectHost, hasCapability } from "@/backend/platform/host"

export const HARDWARE = [
  {
    id: "speech",
    label: "Speech",
    description: "Talk to the lead and hear it work: on-device recognition on this Mac, voices to speak back.",
    page: "/sts",
    // What this device offers.
    async detect() {
      const host = await detectHost()
      const browser = typeof window !== "undefined"
      return {
        host: !!host.capabilities?.includes("speech"),
        microphone: browser && !!navigator.mediaDevices?.getUserMedia,
        voices: browser && typeof speechSynthesis !== "undefined",
        recognition: browser && !!(window.SpeechRecognition ?? window.webkitSpeechRecognition),
      }
    },
  },
  {
    id: "apple",
    label: "Apple",
    description: "The owner's Mac: Shortcuts, speech, notifications, clipboard, Spotlight, Reminders, links.",
    capability: "apple",
    tools: APPLE_TOOLS,
    async detect() {
      return { host: hasCapability(await detectHost(), "apple") }
    },
  },
]

// Every hardware tool spec by name, each marked with the capability it needs.
export const HARDWARE_TOOLS = Object.fromEntries(
  HARDWARE.flatMap(({ tools = {}, capability = null }) =>
    Object.entries(tools).map(([name, spec]) => [name, { ...spec, capability }])
  )
)

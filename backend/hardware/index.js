// Hardware features, browser side: optional features that depend on the
// machine (its microphone, speakers, on-device models) rather than on an
// agent. Each one detects what this device and host offer and degrades when
// something is missing; the host side lives in companion/hardware/.
//
//   speech/   speech to speech: mic → on-device recognition → the lead →
//             narrated progress → a voice (page /sts)
//
// Add one = a folder here (+ companion/hardware/<name>/ when it needs the
// host) and an entry below.

import { detectHost } from "@/backend/platform/host"

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
]

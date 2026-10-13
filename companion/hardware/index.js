// Hardware features: optional capabilities that exist only when this machine
// has the hardware and system support for them. Each folder here detects
// itself and returns null when it cannot run (wrong OS, missing tool, turned
// off in .env); the host API then leaves its endpoints and capability out,
// and the app falls back (backend/hardware/ is the browser side).
//
//   speech/   on-device speech recognition (Apple SpeechAnalyzer) and voices
//             (`say`), capability `speech`
//
// Add one = a folder with an index.js whose create function returns the
// feature or null, listed below, plus its endpoints in host-api.js.

import { createSpeech } from "./speech/index.js"

// Once per process: several desks' host APIs share one recognizer.
let loaded = null
export function loadHardware({ env = process.env, log = () => {} } = {}) {
  loaded ??= Promise.all([createSpeech({ env, log }).catch(() => null)]).then(([speech]) => ({ speech }))
  return loaded
}

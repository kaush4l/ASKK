// The voice bar's control classes (2026-10-26 voice-bar-375): at 375 its row may shrink below its content and wraps
// (min-w-0 flex-wrap), so the page never scrolls sideways. Below sm the Continuous/Single radios and the 1 s/2 s pause
// buttons are 40px targets on any pointer, not only a coarse one (PHONE_TAP, the one standard in lib/tap-target.js).
import { PHONE_TAP } from "../../lib/tap-target.js"

export function voiceRowClasses() {
  return {
    row: "flex min-w-0 flex-wrap items-center gap-2",
    choice: PHONE_TAP,
    pause: PHONE_TAP,
  }
}

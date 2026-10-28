import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// home-speed-voice rolled back (/ 486 ms at r14 against the 432 ms bar): voice-bar.jsx is parked, nothing imports it,
// and the voice bar lives inline in talk-panel.jsx again (its cases are in talk-panel.test.js)
const panel = readFileSync(join(import.meta.dir, "talk-panel.jsx"), "utf8")

describe("voice-bar (home-speed-voice rolled back)", () => {
  test("talk-panel neither imports nor lazy-loads voice-bar; the speech pipeline is a static import there", () => {
    expect(panel).not.toMatch(/voice-bar/)
    expect(panel).toMatch(/^import \{ SpeechToSpeech \} from "@\/backend\/hardware\/speech\/pipeline"/m)
    expect(panel).toMatch(/^function VoiceBar\(\{ lead \}\)/m)
  })
})

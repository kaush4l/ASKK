import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// home-speed: the voice settings sheet (ModelPanel, views/kit, ui/sheet) must not sit in the home's static import graph.
// The voice bar and its speech pipeline stay inline (home-speed-voice rolled back: / 486 ms at r14 against 432 ms).
const source = readFileSync(join(import.meta.dir, "talk-panel.jsx"), "utf8")

describe("talk-panel (home-speed)", () => {
  test("no static import of settings-sheet; it loads through next/dynamic, client only", () => {
    expect(source).not.toMatch(/^import[^\n]*settings-sheet/m)
    expect(source).toMatch(/^import dynamic from "next\/dynamic"/m)
    expect(source).toMatch(/dynamic\(\(\) => import\("@\/components\/sts\/settings\/settings-sheet"\)[^\n]*ssr: false/)
  })

  test("the voice bar is inline: the pause choices and the settings sheet mounted after its first open", () => {
    expect(source).toMatch(/^const PAUSES = \[1500, 2000\]/m)
    expect(source).toMatch(/const \[settingsUsed, setSettingsUsed\] = React\.useState\(false\)/)
    expect(source).toMatch(/\{settingsUsed && <SettingsSheet /)
    expect(source).toMatch(/\{voice && engine && <VoiceBar lead=\{engine\} \/>\}/)
  })
})

describe("talk-panel (voice-bar-375)", () => {
  test("the inline voice bar draws its row, radios and pause buttons with voiceRowClasses", () => {
    expect(source).toMatch(/^import \{ voiceRowClasses \} from "@\/components\/home\/voice-row"/m)
    expect(source).toMatch(/^const VOICE_ROW = voiceRowClasses\(\)/m)
    expect(source).toMatch(/className=\{VOICE_ROW\.row\}/)
    expect(source).toMatch(/VOICE_ROW\.choice, listen === o\.value/)
    expect(source).toMatch(/VOICE_ROW\.pause, settings\.commandPauseMs === ms/)
  })
})

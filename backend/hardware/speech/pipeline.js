// Speech to speech (STS): talk to the lead, hear it work.
//
//   mic ─▶ voice detector ─▶ recognizer (ASR) ─▶ lead's inbox
//   lead's state ─▶ narrator ─▶ speech queue ─▶ voice (TTS) ─▶ speaker
//
// One object per page, a live model the UI subscribes to (subscribe /
// getSnapshot, like an engine). Level and spectrum are read per frame
// (level(), spectrum()), never pushed through React.
//
// Two ways to listen:
//   wake    (default) everything said is transcribed live, but only what
//           follows the wake word ("computer …", configurable) is a command;
//           it is sent after a long pause (commandPauseMs, 2 s), so a short
//           breath mid-sentence never cuts it. Saying the wake word while the
//           voice speaks interrupts it.
//   direct  every utterance is a command: hands-free (it ends after
//           endSilenceMs of silence) or push to talk; louder speech
//           interrupts the voice (barge-in).
// What was heard is dropped when it is only the voice's own echo. "Stop"
// silences it; "yes" / "no" answer a pending approval.

import { detectHost } from "@/backend/platform/host"
import { Microphone } from "@/backend/hardware/speech/microphone"
import { narrate } from "@/backend/hardware/speech/narrator"
import { hostGet, MacRecognizer, SafariRecognizer } from "@/backend/hardware/speech/recognizers"
import { createVoice, speakable } from "@/backend/hardware/speech/voices"
import { speechSupport } from "@/lib/speech"

const SETTINGS_KEY = "askk.sts"
const MAX_TURNS = 80
const MAX_SPOKEN_ANSWER = 700 // characters read aloud; the rest stays on screen

// Added to what the owner says, so the lead answers for the ear.
export const VOICE_NOTE =
  "\n\n(Said by voice on the speech-to-speech page; your answer is read aloud: a few plain spoken sentences, no tables or code unless asked.)"

const STOP = /^(stop|quiet|be quiet|silence|stop talking|shut up|enough)[.!]*$/i
const YES = /^(yes|yeah|yep|approve|approved|go ahead|do it|ok|okay|sure|confirm)\b/i
const NO = /^(no|nope|decline|don't|do not|deny|cancel)\b/i

export const NARRATION = [
  { value: 1, label: "Answers", hint: "the answer, approvals, errors" },
  { value: 2, label: "Milestones", hint: "+ quests, reports, failed steps" },
  { value: 3, label: "Every step", hint: "+ each tool and thought (newest only)" },
]

// Where the wake word is in `text`: { before, wake, command } (command null
// when it was not said). Punctuation the recognizer adds around it is skipped.
export function splitWake(text, wakeWord) {
  const word = (wakeWord ?? "").trim()
  if (!word) return { before: "", wake: "", command: text }
  const pattern = word
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s,.!?-]+")
  const match = new RegExp(`(^|[^\\p{L}\\p{N}])(${pattern})(?![\\p{L}\\p{N}])[\\s,.!?:;-]*`, "iu").exec(text)
  if (!match) return { before: text, wake: "", command: null }
  const at = match.index + match[1].length
  return { before: text.slice(0, at), wake: match[2], command: text.slice(match.index + match[0].length) }
}

const DEFAULTS = {
  asr: null, // "mac" | "safari" (null: best available)
  voice: null, // "mac" | "browser"
  voiceName: null,
  rate: 1.05,
  narration: 3,
  listen: "wake", // "wake" (only what follows the wake word) | "direct"
  wakeWord: "computer",
  commandPauseMs: 2000, // wake: the pause that ends a command
  mode: "auto", // direct: "auto" (hands-free) | "push"
  endSilenceMs: 1200, // direct: the pause that ends an utterance
  bargeIn: true,
  short: true, // ask the lead for spoken-length answers
  locale: null,
}

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") }
  } catch {
    return { ...DEFAULTS }
  }
}

const words = (text) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []

// Share of `heard`'s words found in `spoken` (an echo of the voice?).
function overlap(heard, spoken) {
  const h = words(heard)
  if (!h.length) return 0
  const s = new Set(words(spoken))
  return h.filter((w) => s.has(w)).length / h.length
}

function clipAnswer(text) {
  const plain = speakable(text)
  if (plain.length <= MAX_SPOKEN_ANSWER) return plain
  const cut = plain.slice(0, MAX_SPOKEN_ANSWER)
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "))
  return `${end > 200 ? cut.slice(0, end + 1) : cut}… The rest is on screen.`
}

let turnSeq = 0

// The pause that ends what is being said: a command (wake) or an utterance.
const pauseOf = (settings) => (settings.listen === "wake" ? settings.commandPauseMs : settings.endSilenceMs)

// A short rising two-note chime: the wake word was heard.
let chimeContext = null
function chime() {
  try {
    chimeContext ??= new AudioContext()
    const now = chimeContext.currentTime
    for (const [i, freq] of [660, 990].entries()) {
      const osc = chimeContext.createOscillator()
      const gain = chimeContext.createGain()
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, now + i * 0.09)
      gain.gain.linearRampToValueAtTime(0.08, now + i * 0.09 + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.18)
      osc.connect(gain).connect(chimeContext.destination)
      osc.start(now + i * 0.09)
      osc.stop(now + i * 0.09 + 0.2)
    }
  } catch {}
}

export class SpeechToSpeech {
  #listeners = new Set()
  #state = {
    ready: false,
    support: null, // { host, mac: { recognize, voice }, safari, browserVoice, microphone }
    settings: { ...DEFAULTS },
    listening: false,
    hearing: false,
    transcribing: false,
    phase: "idle", // idle | listening | hearing | armed | transcribing | working | speaking
    partial: "",
    parts: null, // wake mode, live: { before, wake, command } of what is being said
    armed: false, // wake word heard: the command is being captured
    command: "", // wake mode: the command so far (across forced cuts)
    transcript: [], // wake mode: the last lines heard [{ id, text, command, at }]
    speaking: null, // { text, sentence, kind, word }
    turns: [],
    approvals: [],
    lead: null, // { name, status, activity }
    latency: null, // { asr (ms), utterance (s) }
    error: null,
  }
  #mic = null
  #recognizer = null
  #voice = null
  #engine = null
  #engineState = null
  #unsubscribe = null
  #queue = [] // [{ text, kind, turnId }]
  #speakingNow = null
  #echoText = "" // what the voice said lately (echo filter)
  #carry = null // wake mode: command text kept across a forced cut, or "" after a bare wake word
  #disarm = null
  #level = 0

  // ── store ────────────────────────────────────────────────────────────

  getSnapshot = () => this.#state
  subscribe = (listener) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #set(patch) {
    const next = { ...this.#state, ...patch }
    next.phase = next.speaking
      ? "speaking"
      : next.armed
        ? "armed"
        : next.transcribing
          ? "transcribing"
          : next.hearing
            ? "hearing"
          : next.lead && (next.lead.status === "running" || next.lead.activity?.phase === "waiting")
            ? "working"
            : next.listening
              ? "listening"
              : "idle"
    this.#state = next
    for (const listener of this.#listeners) listener()
  }

  #turn(kind, text, extra = {}) {
    const turn = { id: `t${++turnSeq}`, kind, text, at: Date.now(), ...extra }
    this.#set({ turns: [...this.#state.turns, turn].slice(-MAX_TURNS) })
    return turn
  }

  #patchTurn(id, patch) {
    this.#set({ turns: this.#state.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
  }

  // ── setup ────────────────────────────────────────────────────────────

  async init() {
    const host = await detectHost()
    let mac = { recognize: false, voice: false, error: null }
    if (host.capabilities?.includes("speech")) {
      try {
        const status = await hostGet("speech/status") // also warms the recognizer
        mac = { recognize: status.recognize && status.ready, voice: status.voice, error: status.error }
      } catch (error) {
        mac.error = error.message
      }
    }
    const safari = (await speechSupport()).supported
    const browserVoice = typeof speechSynthesis !== "undefined"
    const support = { host: host.mode === "local", mac, safari, browserVoice, microphone: !!navigator.mediaDevices?.getUserMedia }
    const saved = loadSettings()
    const pick = (wanted, options) => options.find(([id, ok]) => id === wanted && ok)?.[0] ?? options.find(([, ok]) => ok)?.[0] ?? null
    const settings = {
      ...saved,
      asr: pick(saved.asr, [["mac", mac.recognize], ["safari", safari]]),
      voice: pick(saved.voice, [["mac", mac.voice], ["browser", browserVoice]]),
      locale: saved.locale ?? navigator.language ?? "en-US",
    }
    this.#set({ ready: true, support, settings })
  }

  setSettings(patch) {
    const settings = { ...this.#state.settings, ...patch }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {}
    this.#set({ settings })
    if (this.#mic && settings.asr === "mac") {
      this.#mic.mode = settings.listen === "wake" ? "auto" : settings.mode
      this.#mic.endSilenceMs = pauseOf(settings)
    }
    if (this.#recognizer?.pauseMs) this.#recognizer.pauseMs = pauseOf(settings)
    if ("listen" in patch || "wakeWord" in patch) this.#disarmNow()
    if ("voice" in patch || "voiceName" in patch || "rate" in patch) {
      this.#voice?.cancel()
      this.#voice = null
    }
    if (("asr" in patch || "locale" in patch) && this.#state.listening) {
      this.stop()
      this.start()
    }
  }

  // The lead (the desk's default agent) whose inbox gets what is said.
  attach(engine) {
    if (engine === this.#engine) return
    this.#unsubscribe?.()
    this.#engine = engine ?? null
    this.#engineState = engine?.getSnapshot() ?? null
    this.#unsubscribe = engine?.subscribe(() => this.#leadChanged()) ?? null
    this.#set({ lead: this.#leadSummary(), approvals: this.#engineState?.approvals ?? [] })
  }

  #leadSummary() {
    const s = this.#engineState
    return this.#engine && s ? { name: this.#engine.name, status: s.status, activity: s.activity ?? null } : null
  }

  // ── listening ────────────────────────────────────────────────────────

  async start() {
    const { settings } = this.#state
    if (this.#state.listening) return
    this.#set({ error: null })
    try {
      if (!settings.asr) throw new Error("No speech recognizer here: open ASKK from its local server on this Mac, or use Safari.")
      const mac = settings.asr === "mac"
      // The mic: utterances for the Mac's recognizer; the level for the visual.
      this.#mic = new Microphone({
        onLevel: (level) => (this.#level = level),
        onSpeechStart: () => mac && this.#speechStarted(),
        onPartial: (pcm) => mac && this.#partial(pcm),
        onUtterance: (pcm, info) => mac && this.#utterance(pcm, info),
      })
      this.#mic.mode = mac && settings.listen !== "wake" ? settings.mode : "auto"
      this.#mic.endSilenceMs = pauseOf(settings)
      try {
        await this.#mic.start()
      } catch (error) {
        if (mac) throw error
        this.#mic = null // Safari listens itself; the meter is optional
      }
      if (mac) this.#recognizer = new MacRecognizer({ locale: settings.locale })
      else {
        this.#recognizer = new SafariRecognizer({
          locale: settings.locale,
          pauseMs: pauseOf(settings),
          onSpeechStart: () => this.#speechStarted(),
          onPartial: (text) => this.#partialText(text),
          onUtterance: (text) => this.#heard(text, {}),
          onError: (message) => this.#fail(message),
        })
        this.#recognizer.start()
      }
      this.#set({ listening: true })
      this.#turn(
        "system",
        settings.listen === "wake"
          ? `Listening. Say “${settings.wakeWord}”, then your command; a ${(settings.commandPauseMs / 1000).toFixed(1)} s pause sends it.`
          : mac && settings.mode === "push"
            ? "Listening: hold the button (or Space) to talk."
            : "Listening."
      )
    } catch (error) {
      this.stop()
      this.#fail(error.name === "NotAllowedError" ? "Microphone access was denied." : error.message)
    }
  }

  stop() {
    this.#mic?.stop()
    this.#mic = null
    this.#recognizer?.stop?.()
    this.#recognizer = null
    this.#level = 0
    if (this.#state.listening) this.#turn("system", "Stopped listening.")
    this.#disarmNow()
    this.#set({ listening: false, hearing: false, transcribing: false, partial: "", parts: null })
  }

  hold(down) {
    this.#mic?.hold(down)
  }

  // 0..1 for the visual: the voice while it speaks, else the mic.
  level() {
    if (this.#voice?.speaking) {
      const measured = this.#voice.level()
      return measured ?? 0.3 + 0.25 * Math.abs(Math.sin(performance.now() / 150)) // no meter: a speaking pulse
    }
    return this.#level
  }

  spectrum(out) {
    return this.#mic?.spectrum(out) ?? false
  }

  get #wake() {
    return this.#state.settings.listen === "wake"
  }

  #speechStarted() {
    if (this.#voice?.speaking && !this.#wake) {
      if (!this.#state.settings.bargeIn) return this.#mic?.cancel() // half duplex
      this.interrupt("barge-in")
    }
    clearTimeout(this.#disarm) // still talking: a bare wake word stays armed
    this.#set({ hearing: true, partial: "", parts: null })
  }

  async #partial(pcm) {
    try {
      const result = await this.#recognizer?.partial?.(pcm)
      if (result?.text && this.#state.hearing) this.#partialText(result.text)
    } catch {}
  }

  // Live text of what is being said. Wake mode: find the wake word; once it
  // is heard the command is armed (chime), and it interrupts the voice.
  #partialText(text) {
    if (!this.#wake) return this.#set({ partial: text, hearing: true })
    const parts = this.#carry != null ? { before: "", wake: "", command: text } : splitWake(text, this.#state.settings.wakeWord)
    const armed = parts.command != null
    if (armed && !this.#state.armed) {
      if (this.#voice?.speaking && !this.#echo(text)) this.interrupt("wake")
      chime()
    }
    this.#set({ partial: text, parts, hearing: true, armed: armed || this.#state.armed, command: this.#joinCarry(parts.command ?? "") })
  }

  #joinCarry(text) {
    return [this.#carry, text].filter((t) => t?.trim()).join(" ").trim()
  }

  async #utterance(pcm, { forced = false } = {}) {
    const recognizer = this.#recognizer
    if (!recognizer) return
    this.#set({ hearing: forced, transcribing: true })
    const started = performance.now()
    try {
      const { text, seconds } = await recognizer.final(pcm)
      const ms = Math.round(performance.now() - started)
      this.#set({ transcribing: false, latency: { asr: ms, utterance: seconds } })
      this.#heard(text, { seconds, ms }, forced)
    } catch (error) {
      this.#set({ transcribing: false, partial: "", parts: null })
      this.#turn("error", `Could not recognize that: ${error.message}`)
    }
  }

  // ── what was said ────────────────────────────────────────────────────

  #echo(text) {
    return !!this.#echoText && words(text).length >= 2 && overlap(text, this.#echoText) >= 0.7
  }

  #line(text, command) {
    const line = { id: `l${++turnSeq}`, text, command, at: Date.now() }
    this.#set({ transcript: [...this.#state.transcript, line].slice(-12) })
  }

  #disarmNow() {
    clearTimeout(this.#disarm)
    this.#carry = null
    this.#set({ armed: false, command: "", parts: null })
  }

  // A finished stretch of speech (it ended with the pause, or was cut while
  // still going: forced).
  #heard(raw, meta, forced = false) {
    const text = (raw ?? "").trim()
    this.#set({ partial: "", hearing: forced, parts: null })
    if (!words(text).length) return
    // The voice's own words, picked up by the mic: not the owner.
    if (this.#echo(text) && this.#carry == null) {
      if (this.#wake) this.#line(text, false)
      else this.#turn("system", `Ignored an echo of the voice: “${text}”`)
      return
    }
    if (!this.#wake) return this.#command(text, meta)

    const approval = this.#engineState?.approvals?.[0]
    const continued = this.#carry != null
    const { command } = continued ? { command: text } : splitWake(text, this.#state.settings.wakeWord)
    // An approval waiting: a bare "yes" / "no" answers it, no wake word needed.
    if (command == null && approval && (YES.test(text) || NO.test(text)) && words(text).length <= 4) {
      this.#line(text, true)
      this.#turn("you", text, meta)
      return this.approve(approval.id, YES.test(text))
    }
    this.#line(text, command != null)
    if (command == null) return this.#set({ armed: false, command: "" }) // just talk: shown, never sent
    const full = this.#joinCarry(command)
    if (forced) {
      this.#carry = full // still speaking: keep capturing
      return this.#set({ armed: true, command: full })
    }
    if (!full) {
      // The wake word alone: wait for the command a little longer.
      this.#carry = ""
      this.#set({ armed: true, command: "" })
      clearTimeout(this.#disarm)
      this.#disarm = setTimeout(() => this.#disarmNow(), 8000)
      return
    }
    this.#disarmNow()
    if (/^(never ?mind|cancel( that)?|forget it)[.!]*$/i.test(full)) return this.#turn("system", "Cancelled.")
    this.#command(full, meta)
  }

  #command(text, meta) {
    if (STOP.test(text)) {
      this.#turn("you", text, meta)
      this.interrupt("asked")
      return
    }
    const approval = this.#engineState?.approvals?.[0]
    if (approval && (YES.test(text) || NO.test(text))) {
      this.#turn("you", text, meta)
      this.approve(approval.id, YES.test(text))
      return
    }
    this.send(text, meta)
  }

  // Send to the lead (spoken or typed).
  send(text, meta = {}) {
    if (!this.#engine) return this.#fail("No lead to talk to yet.")
    this.#turn("you", text, meta)
    this.#engine.send(this.#state.settings.short ? `${text}${VOICE_NOTE}` : text)
  }

  approve(id, ok) {
    this.#engine?.resolveApproval(id, ok)
    this.#set({ turns: this.#state.turns.map((t) => (t.approval?.id === id ? { ...t, resolved: ok } : t)) })
    this.#say(ok ? "Approved." : "Declined.", "system")
  }

  // Stop speaking now and forget what was queued.
  interrupt(reason = "asked") {
    this.#queue = []
    this.#speakingNow = null
    this.#voice?.cancel()
    if (this.#mic) this.#mic.guard = false
    this.#recognizer?.pause?.(false)
    this.#set({ speaking: null })
    if (reason === "asked") this.#turn("system", "Stopped speaking.")
  }

  // Call the lead's work back (the chat's "Call back").
  recall() {
    this.#engine?.stop?.()
    this.interrupt("recall")
    this.#turn("system", "Called the lead's work back.")
  }

  // Speak a test line (the voice settings).
  preview(text) {
    this.interrupt("preview")
    this.#say(text, "system")
  }

  // ── the lead's progress, spoken ──────────────────────────────────────

  #leadChanged() {
    const before = this.#engineState
    const after = this.#engine?.getSnapshot() ?? null
    if (after === before) return
    this.#engineState = after
    const lines = narrate(before, after)
    this.#set({ lead: this.#leadSummary(), approvals: after?.approvals ?? [] })
    for (const line of lines) {
      if (line.kind === "answer") {
        this.#turn("answer", line.text)
        this.#say(clipAnswer(line.text), "answer")
      } else if (line.kind === "approval") {
        this.#turn("approval", line.text, { approval: line.approval, resolved: null })
        this.#say(line.text, "approval")
      } else {
        const turn = this.#turn("status", line.text, { level: line.level, status: line.kind, spoken: false })
        if (line.level <= this.#state.settings.narration) this.#say(line.text, line.kind === "error" ? "error" : "status", turn.id)
      }
    }
  }

  // Queue speech. A status line replaces any status still waiting (only the
  // newest is worth hearing) and is dropped while an answer waits.
  #say(text, kind, turnId = null) {
    if (!this.#state.settings.voice || !text) return
    if (kind === "status") {
      if (this.#queue.some((q) => q.kind === "answer")) return
      this.#queue = this.#queue.filter((q) => q.kind !== "status")
    }
    this.#queue.push({ text, kind, turnId })
    this.#drain()
  }

  async #drain() {
    if (this.#speakingNow) return
    const item = this.#queue.shift()
    if (!item) return
    const { settings } = this.#state
    this.#voice ??= createVoice(settings.voice, { name: settings.voiceName, rate: settings.rate })
    this.#speakingNow = item
    if (this.#mic) this.#mic.guard = true
    this.#recognizer?.pause?.(true)
    this.#set({ speaking: { text: item.text, sentence: "", kind: item.kind, word: 0 } })
    if (item.turnId) this.#patchTurn(item.turnId, { spoken: true })
    try {
      await this.#voice.speak(item.text, {
        onSentence: (sentence) => {
          this.#echoText = `${this.#echoText} ${sentence}`.slice(-600)
          if (this.#speakingNow === item) this.#set({ speaking: { text: item.text, sentence, kind: item.kind, word: 0 } })
        },
        onWord: (word) => this.#speakingNow === item && this.#set({ speaking: { ...this.#state.speaking, word } }),
      })
    } catch (error) {
      this.#turn("error", `Could not speak: ${error.message}`)
    }
    if (this.#speakingNow !== item) return // interrupted
    this.#speakingNow = null
    if (this.#mic) this.#mic.guard = false
    this.#recognizer?.pause?.(false)
    setTimeout(() => {
      if (!this.#speakingNow) this.#echoText = ""
    }, 2000)
    this.#set({ speaking: null })
    this.#drain()
  }

  #fail(message) {
    this.#set({ error: message })
    this.#turn("error", message)
  }

  // Page unmounted (React may mount it again: attach() then subscribes anew).
  dispose() {
    this.stop()
    this.interrupt("dispose")
    this.#unsubscribe?.()
    this.#unsubscribe = null
    this.#engine = null
  }
}

// The microphone as 16 kHz mono PCM, with a voice detector (VAD) that cuts
// it into utterances.
//
//   const mic = new Microphone({ onLevel, onSpeechStart, onPartial, onUtterance })
//   await mic.start()        asks for the mic (echo cancellation on)
//   mic.mode = "auto"        hands-free: speech starts and ends on its own
//   mic.mode = "push"        push to talk: mic.hold(true) … mic.hold(false)
//   onUtterance(pcm, { forced }) forced: cut at 55 s while still speaking
//   mic.guard = true         a voice is speaking back: only louder speech
//                            counts (barge-in), so its echo does not
//   mic.spectrum(out)        frequency bins (0..255) for a visual
//   mic.stop()
//
// Utterances are Int16Array at 16 kHz with a 300 ms pre-roll, so the first
// syllable is not cut. The noise floor adapts while nobody speaks.

const RATE = 16000
const FRAME = 320 // 20 ms at 16 kHz
const PREROLL_FRAMES = 15 // 300 ms kept before speech starts
const START_FRAMES = 4 // 80 ms above the threshold = speech
const MAX_SECONDS = 55 // a longer stretch is cut (onUtterance gets forced = true) and goes on
const PARTIAL_MS = 450 // how often the audio so far goes out for live text

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) this.port.postMessage(channel.slice(0))
    return true
  }
}
registerProcessor("askk-tap", Tap)
`

export const SAMPLE_RATE = RATE

// Int16 PCM as base64 (the host's speech/transcribe body).
export function pcmToBase64(pcm) {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

const concat = (parts, Type = Int16Array) => {
  const out = new Type(parts.reduce((n, f) => n + f.length, 0))
  let at = 0
  for (const f of parts) {
    out.set(f, at)
    at += f.length
  }
  return out
}

export class Microphone {
  mode = "auto"
  guard = false
  endSilenceMs = 800
  sensitivity = 1 // > 1 hears quieter speech

  #stream = null
  #context = null
  #node = null
  #analyser = null
  #ratio = 1
  #carry = new Float32Array(0) // input samples not yet downsampled
  #rest = new Float32Array(0) // 16 kHz samples not yet a full frame
  #pre = [] // recent frames (pre-roll)
  #frames = null // the utterance being recorded, or null
  #above = 0
  #below = 0
  #floor = 0.004
  #held = false
  #lastPartial = 0

  constructor({ onLevel, onSpeechStart, onPartial, onUtterance } = {}) {
    Object.assign(this, { onLevel, onSpeechStart, onPartial, onUtterance })
  }

  get on() {
    return !!this.#stream
  }

  get recording() {
    return !!this.#frames
  }

  async start() {
    if (this.#stream) return
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser gives no microphone access.")
    this.#stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    })
    const context = new AudioContext()
    this.#context = context
    this.#ratio = context.sampleRate / RATE
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }))
    try {
      await context.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }
    const source = context.createMediaStreamSource(this.#stream)
    this.#analyser = context.createAnalyser()
    this.#analyser.fftSize = 256
    this.#analyser.smoothingTimeConstant = 0.75
    source.connect(this.#analyser)
    this.#node = new AudioWorkletNode(context, "askk-tap")
    this.#node.port.onmessage = (event) => this.#samples(event.data)
    source.connect(this.#node)
    // A worklet runs only when connected to the output; it sends silence.
    const mute = context.createGain()
    mute.gain.value = 0
    this.#node.connect(mute).connect(context.destination)
    if (context.state === "suspended") await context.resume()
  }

  stop() {
    if (this.#node) this.#node.port.onmessage = null
    this.#stream?.getTracks().forEach((t) => t.stop())
    this.#context?.close().catch(() => {})
    this.#stream = this.#context = this.#node = this.#analyser = null
    this.#frames = null
    this.#pre = []
    this.#held = false
    this.onLevel?.(0)
  }

  // Push to talk: record while held; release ends the utterance.
  hold(down) {
    if (this.mode !== "push" || !this.#stream || down === this.#held) return
    this.#held = down
    if (down) this.#begin()
    else this.#end()
  }

  // Drop the utterance being recorded.
  cancel() {
    this.#frames = null
    this.#above = this.#below = 0
  }

  spectrum(out) {
    if (!this.#analyser) return false
    this.#analyser.getByteFrequencyData(out)
    return true
  }

  // ── audio ────────────────────────────────────────────────────────────

  // Downsample to 16 kHz (each output sample averages its input span), then
  // cut 20 ms frames.
  #samples(input) {
    const joined = concat([this.#carry, input], Float32Array)
    const count = Math.floor(joined.length / this.#ratio)
    const out = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const from = Math.floor(i * this.#ratio)
      const to = Math.max(from + 1, Math.floor((i + 1) * this.#ratio))
      let sum = 0
      for (let j = from; j < to; j++) sum += joined[j]
      out[i] = sum / (to - from)
    }
    this.#carry = joined.slice(Math.floor(count * this.#ratio))
    let rest = concat([this.#rest, out], Float32Array)
    while (rest.length >= FRAME) {
      this.#frame(rest.subarray(0, FRAME))
      rest = rest.slice(FRAME)
    }
    this.#rest = rest
  }

  #frame(floats) {
    let sum = 0
    const pcm = new Int16Array(FRAME)
    for (let i = 0; i < FRAME; i++) {
      const s = Math.max(-1, Math.min(1, floats[i]))
      sum += s * s
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    const rms = Math.sqrt(sum / FRAME)
    this.onLevel?.(Math.min(1, rms * 12))

    if (this.mode === "push") {
      if (this.#frames) this.#record(pcm)
      return
    }

    const threshold = (Math.max(0.01, this.#floor * 3.2) * (this.guard ? 2.6 : 1)) / this.sensitivity
    const loud = rms > threshold
    if (!this.#frames) {
      if (!loud) this.#floor = Math.max(0.0015, this.#floor * 0.97 + rms * 0.03)
      this.#pre.push(pcm)
      if (this.#pre.length > PREROLL_FRAMES) this.#pre.shift()
      this.#above = loud ? this.#above + 1 : 0
      if (this.#above >= START_FRAMES) this.#begin()
      return
    }
    this.#record(pcm)
    this.#below = loud ? 0 : this.#below + 1
    if (this.#below * 20 >= this.endSilenceMs) this.#end()
  }

  #begin(continued = false) {
    this.#frames = continued ? [] : [...this.#pre]
    this.#pre = []
    this.#above = this.#below = 0
    this.#lastPartial = performance.now()
    if (!continued) this.onSpeechStart?.()
  }

  #record(pcm) {
    this.#frames.push(pcm)
    if (this.#frames.length * FRAME >= RATE * MAX_SECONDS) return this.#end(true)
    const now = performance.now()
    if (now - this.#lastPartial >= PARTIAL_MS) {
      this.#lastPartial = now
      this.onPartial?.(concat(this.#frames))
    }
  }

  #end(forced = false) {
    const frames = this.#frames
    this.#frames = null
    this.#below = 0
    if (!frames) return
    if (forced) {
      // Still speaking: the next frames start the next piece at once.
      this.onUtterance?.(concat(frames), { forced: true })
      this.#begin(true)
      return
    }
    // The silence that ended it is not speech: keep 200 ms of it.
    const trailing = this.mode === "push" ? 0 : Math.max(0, Math.floor(this.endSilenceMs / 20) - 10)
    this.onUtterance?.(concat(frames.slice(0, Math.max(1, frames.length - trailing))))
  }
}

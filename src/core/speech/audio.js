/**
 * The arithmetic every speech model needs done to its input before it will
 * look at it.
 *
 * It lives in `core/` because it is arithmetic and nothing else — no
 * AudioContext, no DOM, no worker API. The microphone is opened in the page and
 * the model runs in a worker, so this code has to be callable from both, and
 * the only way to guarantee that is for it to touch neither.
 *
 * Every speech model in this tree wants **16 kHz mono float32**, and none of
 * them resample: transformers.js hands the samples to the feature extractor as
 * given, so audio at the device's native 48 kHz is transcribed as a recording
 * played at a third speed. That is the failure this file exists to prevent, and
 * it is silent — the model returns confident nonsense rather than an error.
 */

/** What every model here is trained on. Not a preference; the feature extractors assume it. */
export const MODEL_SAMPLE_RATE = 16_000

/**
 * Resample by linear interpolation.
 *
 * Not a windowed-sinc filter: the input is already band-limited by the
 * browser's own capture chain, the ratio is a downsample by 3 in the common
 * 48 kHz case, and the consumer is a log-mel filterbank that throws away far
 * more detail than the interpolation error introduces. A better filter would
 * cost frames of latency on the live path to improve a number no model reads.
 */
export function resample(samples, from, to = MODEL_SAMPLE_RATE) {
  if (!samples?.length || from === to || !from || !to) return samples ?? new Float32Array(0)
  const ratio = from / to
  const out = new Float32Array(Math.max(1, Math.floor(samples.length / ratio)))
  for (let i = 0; i < out.length; i++) {
    const at = i * ratio
    const left = Math.floor(at)
    const right = Math.min(left + 1, samples.length - 1)
    const weight = at - left
    out[i] = samples[left] * (1 - weight) + samples[right] * weight
  }
  return out
}

/** Join captured blocks into the one contiguous buffer a model is given. */
export function concat(blocks) {
  let total = 0
  for (const block of blocks) total += block.length
  const out = new Float32Array(total)
  let at = 0
  for (const block of blocks) {
    out.set(block, at)
    at += block.length
  }
  return out
}

/**
 * Loudness, as the only thing here that resembles voice detection.
 *
 * A real VAD is a model of its own, and running one to decide whether to run
 * the other model doubles the cost of the quiet case it is supposed to make
 * cheap. Root-mean-square over a block separates "the microphone is open in a
 * quiet room" from "somebody is talking" well enough to skip a transcription
 * pass, which is all it is asked to do.
 */
export function loudness(samples) {
  if (!samples?.length) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

/**
 * Wrap float32 samples as a 16-bit PCM WAV.
 *
 * Only the page plays audio, but the encoding is arithmetic and the worker is
 * where the samples are produced, so it belongs on this side of the boundary.
 * A WAV rather than raw samples because a Blob URL can be handed to an `Audio`
 * element and to a download alike, and because 16-bit halves what crosses the
 * wire against no audible difference at speech bandwidth.
 */
export function toWav(samples, sampleRate = MODEL_SAMPLE_RATE) {
  const bytes = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(bytes)
  const ascii = (at, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    // Clamped before scaling: a sample above 1 wraps to the opposite extreme in
    // two's complement, which is heard as a click rather than as clipping.
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }
  return bytes
}

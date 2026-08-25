/**
 * Injected time and randomness, made boring on purpose (I7): a test that reads
 * a real clock is a test that fails at midnight, and a test that draws real
 * random bytes has no golden file.
 * @module
 */

/** @typedef {import('@harness/kernel').ClockPort} ClockPort */
/** @typedef {import('@harness/kernel').RngPort} RngPort */

/**
 * A clock that starts at `start` and advances by `step` on every read, so
 * successive facts get distinct, ordered, predictable timestamps.
 * @param {{start?: number, step?: number}} [opts]
 * @returns {ClockPort & {set: (t: number) => void, advance: (ms: number) => void}}
 */
export function fakeClock(opts = {}) {
  let t = opts.start ?? 1_700_000_000_000
  const step = opts.step ?? 1
  return {
    now() {
      const at = t
      t += step
      return at
    },
    set(next) {
      t = next
    },
    advance(ms) {
      t += ms
    },
  }
}

/**
 * A counting "random" source: byte i of call n is (n + i) & 0xff. Not random
 * and not pretending to be — it exists so an id is reproducible.
 * @returns {RngPort}
 */
export function fakeRng() {
  let call = 0
  return {
    bytes(n) {
      call += 1
      return Uint8Array.from({ length: n }, (_, i) => (call + i) & 0xff)
    },
  }
}

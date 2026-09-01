/**
 * The smallest guest that still drives the whole WASI shim.
 *
 * `public/sandbox/vm-worker.js` is a realm entry point no bundler ever sees: a
 * classic worker that pulls three vendored files in with `importScripts` and
 * then uses the classes they leave on the global. Nothing resolves those names,
 * so a missing one is invisible until a command actually runs. Measured on this
 * tree — emptying `wasi-util.js`, and emptying the shim that defines `WASI`
 * itself — both passed lint, tests, build and the smoke, because the smoke only
 * asked the worker to refuse a command it had no image for, and the refusal is
 * returned before a single shim symbol is touched.
 *
 * The real guest is ~100 MB and cannot be a gate's dependency. So this builds a
 * wasm module by hand, in bytes, that calls exactly the three imports the
 * worker patches — `fd_write`, `fd_read`, `poll_oneoff` — and then exits. That
 * path runs `new WASI` (the shim), `Ciovec` (`wasi_defs.js`) and `Subscription`
 * / `Event` / `EventType` (`wasi-util.js`). With any of the three files missing
 * the run comes back saying a name is not defined, instead of saying `!`.
 *
 * Hand-assembled rather than compiled, because a toolchain is a dependency and
 * a checked-in binary is a thing nobody can read. The module is five imports
 * and one function; the part of the spec it uses is a table of small integers,
 * and the encoder below is that table.
 */

/** LEB128 for the lengths and counts the format is made of: small and positive. */
const size = (n) => (n < 128 ? [n] : [(n & 0x7f) | 0x80, n >> 7])

/**
 * `i32.const n`, signed LEB128. Under 64 the sign bit is clear and one byte
 * says it; from 64 up a second byte is needed or the value reads as negative.
 * Every constant here is an address in the first page, so two bytes is enough.
 */
const konst = (n) => (n < 64 ? [0x41, n] : [0x41, (n & 0x7f) | 0x80, n >> 7])

const I32 = 0x7f
const CALL = 0x10
const DROP = 0x1a
const END = 0x0b
const STORE = [0x36, 0x02, 0x00] // i32.store, 4-byte alignment, no offset

const WASI = 'wasi_snapshot_preview1'

/** `\0asm`, then the format version, which has been 1 since 2017. */
const MAGIC = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]

const name = (text) => [text.length, ...Array.from(text, (c) => c.charCodeAt(0))]
const section = (id, body) => [id, ...size(body.length), ...body]
const signature = (params, results) => [0x60, params.length, ...params, results.length, ...results]
const imported = (fn, type) => [...name(WASI), ...name(fn), 0x00, type]
const store = (address, value) => [...konst(address), ...konst(value), ...STORE]
const call = (index, args) => [...args.flatMap((n) => konst(n)), CALL, index]

/**
 * Where the module keeps its words. The 48-byte subscription `poll_oneoff`
 * reads is left as the zeroes a fresh page already is: a clock subscription is
 * tag 0, and tag 0 is what an untouched page says.
 */
const NWRITTEN = 0
const NREAD = 4
const IOVEC = 8
const TEXT = 16
const NEVENTS = 20
const SUBSCRIPTION = 24
const EVENTS = 128

/** The one byte the guest writes to stdout, so the caller has something to compare. */
export const TINY_GUEST_STDOUT = '!'

/**
 * The module, ready for `WebAssembly.compile`.
 *
 * The last import is the point of the fifth one: `sock_accept` is a call the
 * shim does not implement, so it exercises the worker's loop that stubs
 * unimplemented socket calls to ENOTSUP. Without an import like it that loop
 * never runs and a break in it links nothing wrong.
 */
export function tinyGuest() {
  const types = section(1, [
    4,
    ...signature([I32, I32, I32, I32], [I32]),
    ...signature([I32], []),
    ...signature([I32, I32, I32], [I32]),
    ...signature([], []),
  ])

  const imports = section(2, [
    5,
    ...imported('fd_write', 0),
    ...imported('fd_read', 0),
    ...imported('poll_oneoff', 0),
    ...imported('proc_exit', 1),
    ...imported('sock_accept', 2),
  ])

  const functions = section(3, [1, 3])
  const memory = section(5, [1, 0x00, 1])
  const exports = section(7, [2, ...name('memory'), 0x02, 0, ...name('_start'), 0x00, 5])

  const body = [
    // the iovec fd_write is handed: one byte, at TEXT
    ...store(IOVEC, TEXT),
    ...store(IOVEC + 4, 1),
    ...store(TEXT, TINY_GUEST_STDOUT.charCodeAt(0)),
    // through Ciovec, and out as the result the caller reads
    ...call(0, [1, IOVEC, 1, NWRITTEN]),
    DROP,
    // the closed stdin queue
    ...call(1, [0, IOVEC, 1, NREAD]),
    DROP,
    // through Subscription, Event and EventType
    ...call(2, [SUBSCRIPTION, EVENTS, 1, NEVENTS]),
    DROP,
    // the shim signals a clean exit by throwing its code, which the worker reads
    ...call(3, [0]),
    END,
  ]
  const code = section(10, [1, ...size(body.length + 1), 0, ...body])

  return Uint8Array.from([
    ...MAGIC,
    ...types,
    ...imports,
    ...functions,
    ...memory,
    ...exports,
    ...code,
  ])
}

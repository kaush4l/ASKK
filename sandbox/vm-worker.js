// REALM: worker (classic, not a module)
//
// Hosts the container2wasm guest: an x86 emulator compiled to wasm, with an
// Alpine image inside it.
//
// CLASSIC on purpose. The WASI shim below is vendored verbatim from upstream as
// UMD, and `importScripts` is how UMD loads. Rewriting it into modules would
// mean maintaining a fork of somebody else's bundle to gain nothing.
//
// Served from `public/` rather than bundled, for the same reason the agent files
// are: this file is paired with a 100 MB artifact no bundler should ever walk
// into, so the pair is fetched at runtime and the app is told where to find it.
//
// NO SharedArrayBuffer, and none is needed. Measured: the guest boots to its
// first output in 814 ms with `crossOriginIsolated = false`. Upstream's browser
// example needs SAB twice — xterm-pty blocking on `Atomics.wait` for interactive
// stdin, and the network stack — and this uses neither. That is what makes it
// deployable to a static host that cannot set COOP/COEP headers.
//
// The consequence, stated plainly because it shapes the tool above it: with no
// blocking stdin there is no interactive shell, so ONE BOOT RUNS ONE COMMAND.
// The filesystem does not persist between calls. In exchange, none of the
// failure modes of a long-lived pty exist here — no sentinel parsing, no shell
// wedged by an unclosed quote for every later caller, no shared fate.

importScripts('./browser_wasi_shim/index.js')
importScripts('./browser_wasi_shim/wasi_defs.js')
importScripts('./wasi-util.js')

const ERRNO_INVAL = 28
const ERRNO_NOTSUP = 58

// Fetched and compiled once. Compiling is 15 ms and the download is 100 MB, so
// the module is the thing worth keeping; an instance is 9 ms and is built fresh
// for every command, which is also what makes each command's filesystem clean.
let compiled = null

/**
 * The image may arrive gzipped, and it does on the deploy.
 *
 * MEASURED, and it is the whole reason this project's own host answered 404 for
 * the guest: `wc -c public/sandbox/sandbox.wasm` is 107,054,914 bytes, which is
 * 2,197,314 over GitHub's 100 MiB per-file block, so the file could be in
 * neither the repository nor the Pages deploy. `gzip -9` takes it to 40,029,960
 * — 38.2 MiB — and a file that size is one GitHub accepts. The limit is on the
 * file AT REST, so edge compression cannot reach it and only a compressed
 * artifact can.
 *
 * SNIFFED, not switched on the extension, and that is not defensive coding: a
 * static host is free to answer a `.gz` with `Content-Encoding: gzip`, in which
 * case `fetch` has already inflated it and there is nothing left to do. Both
 * arrivals are correct and the magic number is the only thing that says which
 * one happened. It also means one loader serves the compressed deploy artifact
 * and a developer's raw `sandbox.wasm` with no flag between them.
 *
 * `DecompressionStream` is the platform's, so no inflater ships here.
 */
async function inflated(buffer) {
  const head = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength))
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buffer
  const gunzip = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(gunzip).arrayBuffer()
}

/**
 * The body, read a chunk at a time, saying how much has arrived.
 *
 * `response.arrayBuffer()` is one await that returns tens of megabytes later
 * with nothing said in between, and this is the largest single download the
 * app makes: the guest is 52,602,121 bytes on the wire, so the first `shell`
 * call a person ever makes sat silent for as long as their connection took.
 * There is no other way to report it — a `fetch` has no progress event, only a
 * readable body.
 *
 * `content-length` is what a static host sends and what GitHub Pages sends;
 * when it is absent — a chunked response, or one the host is compressing on
 * the fly — the total is reported as 0 and the reader must draw a count rather
 * than a bar. Reporting a made-up total would be worse than reporting none.
 *
 * The pieces are joined once, at the end, into one buffer, because that is
 * what `WebAssembly.compile` and the gzip sniff both want.
 */
async function counted(response) {
  const total = Number(response.headers.get('content-length') ?? 0)
  if (!response.body) return await response.arrayBuffer()

  const reader = response.body.getReader()
  const pieces = []
  let loaded = 0
  // Throttled by BYTES, not by time: a chunk here is tens of kilobytes and a
  // message per chunk is thousands of postMessages for one download, each one
  // waking the page to recompute a width that moved a fraction of a pixel.
  let announced = 0
  const step = 1024 * 1024

  post({ type: 'boot-progress', loaded: 0, total })
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    pieces.push(value)
    loaded += value.byteLength
    if (loaded - announced >= step) {
      announced = loaded
      post({ type: 'boot-progress', loaded, total })
    }
  }
  post({ type: 'boot-progress', loaded, total })

  const joined = new Uint8Array(loaded)
  let at = 0
  for (const piece of pieces) {
    joined.set(piece, at)
    at += piece.byteLength
  }
  return joined.buffer
}

self.onmessage = async (event) => {
  const { type, id } = event.data ?? {}

  if (type === 'boot') {
    const { wasmUrl } = event.data
    try {
      const response = await fetch(wasmUrl)
      if (!response.ok) {
        post({ type: 'boot-failed', message: `HTTP ${response.status} for ${wasmUrl}` })
        return
      }
      const transferred = await counted(response)
      const bytes = await inflated(transferred)
      compiled = await WebAssembly.compile(bytes)
      post({ type: 'booted', bytes: bytes.byteLength, transferred: transferred.byteLength })
    } catch (err) {
      post({ type: 'boot-failed', message: String(err?.message ?? err) })
    }
    return
  }

  if (type === 'run') {
    if (!compiled) {
      post({ type: 'result', id, ok: false, message: 'the guest image is not loaded' })
      return
    }
    try {
      post({ type: 'result', id, ok: true, ...runOnce(event.data.argv) })
    } catch (err) {
      post({ type: 'result', id, ok: false, message: String(err?.message ?? err) })
    }
  }
}

function post(message) {
  self.postMessage(message)
}

/**
 * One command, one instance, start to finish.
 *
 * `wasi.start` runs the whole guest synchronously, so this worker is blocked
 * for the duration. That is the reason it is a worker: a 900 ms block on the
 * page would be 900 ms of frozen interface.
 */
function runOnce(argv) {
  const wasi = new WASI(['arg0'].concat(argv), [], [])
  const decoder = new TextDecoder()
  let out = ''

  patchStdio(wasi, {
    onWrite: (bytes) => {
      out += decoder.decode(new Uint8Array(bytes), { stream: true })
    },
  })

  // The guest imports WASI socket calls because c2w links them for its optional
  // networking mode, which is not used here. They are stubbed to ENOTSUP and
  // reported — a socket that claims success and delivers nothing is the worst
  // of the available answers.
  const stubbed = []
  for (const imported of WebAssembly.Module.imports(compiled)) {
    if (imported.module !== 'wasi_snapshot_preview1') continue
    if (typeof wasi.wasiImport[imported.name] !== 'function') {
      wasi.wasiImport[imported.name] = () => ERRNO_NOTSUP
      stubbed.push(imported.name)
    }
  }

  const instance = new WebAssembly.Instance(compiled, {
    wasi_snapshot_preview1: wasi.wasiImport,
  })

  let code = 0
  try {
    wasi.start(instance)
  } catch (err) {
    // The shim signals a normal exit by throwing. A real trap arrives the same
    // way, so the two are told apart by the message rather than by the throw.
    const text = String(err?.message ?? err)
    const status = text.match(/exit code[: ]+(\d+)/i)
    if (status) code = Number(status[1])
    else return { stdout: out, code: -1, trap: text, stubbed }
  }
  return { stdout: out, code, stubbed }
}

/**
 * The three WASI calls the guest needs that the shim does not provide.
 *
 * Kept as close to the boot probe that first ran this artifact as it can be:
 * this is the exact shape that was measured booting in 814 ms, and a clever
 * rewrite here would be a change to the one part of this file that is known to
 * work and cannot be reasoned about from first principles.
 *
 * stdin is a closed queue: `fd_read` on 0 returns zero bytes and `poll_oneoff`
 * reports only clock subscriptions. That is what removes the need for
 * SharedArrayBuffer — there is nothing to block on. A read subscription
 * reported as ready would send the guest into a read that returns nothing, for
 * ever.
 */
function patchStdio(wasi, tty) {
  wasi.wasiImport.fd_read = (fd, _iovs, _len, nread) => {
    if (fd !== 0) return ERRNO_INVAL
    new DataView(wasi.inst.exports.memory.buffer).setUint32(nread, 0, true)
    return 0
  }

  wasi.wasiImport.fd_write = (fd, iovs, len, nwritten) => {
    if (fd !== 1 && fd !== 2) return ERRNO_INVAL
    const view = new DataView(wasi.inst.exports.memory.buffer)
    const memory = new Uint8Array(wasi.inst.exports.memory.buffer)
    let total = 0
    for (const iovec of Ciovec.read_bytes_array(view, iovs, len)) {
      const chunk = memory.slice(iovec.buf, iovec.buf + iovec.buf_len)
      if (chunk.length) {
        tty.onWrite(chunk)
        total += chunk.length
      }
    }
    view.setUint32(nwritten, total, true)
    return 0
  }

  wasi.wasiImport.poll_oneoff = (inPtr, outPtr, nsubscriptions, nevents) => {
    if (nsubscriptions === 0) return ERRNO_INVAL
    const view = new DataView(wasi.inst.exports.memory.buffer)
    const events = []
    for (const subscription of Subscription.read_bytes_array(view, inPtr, nsubscriptions)) {
      if (subscription.u.tag.variant !== 'clock') continue
      const event = new Event()
      event.userdata = subscription.userdata
      event.error = 0
      event.type = new EventType('clock')
      events.push(event)
    }
    Event.write_bytes_array(view, outPtr, events)
    view.setUint32(nevents, events.length, true)
    return 0
  }
}

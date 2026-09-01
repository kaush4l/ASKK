// ------------------------------------------------------------ sandbox realm
// public/sandbox/vm-worker.js with ONE change: stdin blocks.
//
// Everything else — classic worker, importScripts of the vendored UMD shim,
// fetch + compile of the same 107 MB module, the ENOTSUP stub sweep over
// unimplemented WASI socket imports — is the tree's own file. What is replaced
// is `patchStdio`, whose fd_read on fd 0 writes 0 and returns success (EOF),
// and whose poll_oneoff answers only clock subscriptions.
//
// The replacement is upstream container2wasm's `wasiHack`
// (examples/wasi-browser/htdocs/worker.js:65-191) driven by upstream
// xterm-pty's `TtyClient` (workerTools.js, vendored beside this file, byte for
// byte as published). TtyClient.req() is:
//
//     this.streamCtrl[0] = 0; self.postMessage(t); Atomics.wait(this.streamCtrl, 0, 0)
//
// which is the primitive the C1 refutation measured, called from the third
// realm down.

importScripts('./workerTools.js')
importScripts('./browser_wasi_shim/index.js')
importScripts('./browser_wasi_shim/wasi_defs.js')
importScripts('./wasi-util.js')

const ERRNO_INVAL = 28
const ERRNO_NOTSUP = 58

let sab = null
let ttyClient = null

function note(text) { self.postMessage({ type: 'note', text }) }

self.onmessage = async (event) => {
  const d = event.data || {}
  if (d.type === 'init') { sab = d.buf; return }
  if (d.type !== 'start') return

  try {
    const t0 = performance.now()
    const response = await fetch(d.wasmUrl)
    if (!response.ok) { note('boot-failed HTTP ' + response.status); return }
    const bytes = await response.arrayBuffer()
    note('fetched ' + bytes.byteLength + ' bytes in ' + Math.round(performance.now() - t0) + ' ms')

    const t1 = performance.now()
    const compiled = await WebAssembly.compile(bytes)
    note('compiled in ' + Math.round(performance.now() - t1) + ' ms')

    ttyClient = new TtyClient(sab)

    const argv = ['arg0'].concat(d.argv || [])
    const wasi = new WASI(argv, [], [])
    wasiHack(wasi, ttyClient)

    const stubbed = []
    for (const imported of WebAssembly.Module.imports(compiled)) {
      if (imported.module !== 'wasi_snapshot_preview1') continue
      if (typeof wasi.wasiImport[imported.name] !== 'function') {
        wasi.wasiImport[imported.name] = () => ERRNO_NOTSUP
        stubbed.push(imported.name)
      }
    }
    if (stubbed.length) note('stubbed ENOTSUP: ' + stubbed.join(' '))

    const t2 = performance.now()
    const instance = new WebAssembly.Instance(compiled, { wasi_snapshot_preview1: wasi.wasiImport })
    note('instantiated in ' + Math.round(performance.now() - t2) + ' ms; guest memory pages = ' +
      (instance.exports.memory ? instance.exports.memory.buffer.byteLength : 'n/a'))

    note('running argv=' + JSON.stringify(argv))
    // Never returns while the shell is alive. The worker is blocked from here
    // on, inside Atomics.wait, which is the point.
    try { wasi.start(instance) }
    catch (err) { self.postMessage({ type: 'exit', text: String(err && err.message || err) }) }
    self.postMessage({ type: 'exit', text: 'wasi.start returned' })
  } catch (err) {
    note('THREW ' + String(err && err.stack || err))
  }
}

// Verbatim shape of upstream's wasiHack, minus the socket connfd branches this
// build has no network for.
function wasiHack(wasi, ttyClient) {
  const _fd_read = wasi.wasiImport.fd_read
  wasi.wasiImport.fd_read = (fd, iovs_ptr, iovs_len, nread_ptr) => {
    if (fd == 0) {
      const buffer = new DataView(wasi.inst.exports.memory.buffer)
      const buffer8 = new Uint8Array(wasi.inst.exports.memory.buffer)
      const iovecs = Iovec.read_bytes_array(buffer, iovs_ptr, iovs_len)
      let nread = 0
      for (let i = 0; i < iovecs.length; i++) {
        const iovec = iovecs[i]
        if (iovec.buf_len == 0) continue
        const data = ttyClient.onRead(iovec.buf_len)   // BLOCKS on Atomics.wait
        buffer8.set(data, iovec.buf)
        nread += data.length
      }
      buffer.setUint32(nread_ptr, nread, true)
      return 0
    }
    return _fd_read.apply(wasi.wasiImport, [fd, iovs_ptr, iovs_len, nread_ptr])
  }

  const _fd_write = wasi.wasiImport.fd_write
  wasi.wasiImport.fd_write = (fd, iovs_ptr, iovs_len, nwritten_ptr) => {
    if (fd == 1 || fd == 2) {
      const buffer = new DataView(wasi.inst.exports.memory.buffer)
      const buffer8 = new Uint8Array(wasi.inst.exports.memory.buffer)
      const iovecs = Ciovec.read_bytes_array(buffer, iovs_ptr, iovs_len)
      let wtotal = 0
      for (let i = 0; i < iovecs.length; i++) {
        const iovec = iovecs[i]
        const buf = buffer8.slice(iovec.buf, iovec.buf + iovec.buf_len)
        if (buf.length == 0) continue
        ttyClient.onWrite(Array.from(buf))
        wtotal += buf.length
      }
      buffer.setUint32(nwritten_ptr, wtotal, true)
      return 0
    }
    return _fd_write.apply(wasi.wasiImport, [fd, iovs_ptr, iovs_len, nwritten_ptr])
  }

  wasi.wasiImport.poll_oneoff = (in_ptr, out_ptr, nsubscriptions, nevents_ptr) => {
    if (nsubscriptions == 0) return ERRNO_INVAL
    const buffer = new DataView(wasi.inst.exports.memory.buffer)
    const in_ = Subscription.read_bytes_array(buffer, in_ptr, nsubscriptions)
    let isReadPollStdin = false
    let isClockPoll = false
    let pollSubStdin
    let clockSub
    let timeout = Number.MAX_VALUE
    for (const sub of in_) {
      if (sub.u.tag.variant == 'fd_read') {
        if (sub.u.data.fd != 0) return ERRNO_INVAL
        isReadPollStdin = true
        pollSubStdin = sub
      } else if (sub.u.tag.variant == 'clock') {
        if (sub.u.data.timeout < timeout) { timeout = sub.u.data.timeout; isClockPoll = true; clockSub = sub }
      } else {
        return ERRNO_INVAL
      }
    }
    const events = []
    if (isReadPollStdin || isClockPoll) {
      let readable = false
      if (isReadPollStdin || (isClockPoll && timeout > 0)) {
        readable = ttyClient.onWaitForReadable(timeout / 1000000000)  // BLOCKS
      }
      if (readable && isReadPollStdin) {
        const event = new Event()
        event.userdata = pollSubStdin.userdata
        event.error = 0
        event.type = new EventType('fd_read')
        events.push(event)
      }
      if (isClockPoll) {
        const event = new Event()
        event.userdata = clockSub.userdata
        event.error = 0
        event.type = new EventType('clock')
        events.push(event)
      }
    }
    Event.write_bytes_array(buffer, out_ptr, events)
    buffer.setUint32(nevents_ptr, events.length, true)
    return 0
  }
}

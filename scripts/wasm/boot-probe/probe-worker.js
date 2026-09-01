// Runs a container2wasm WASI guest with no SharedArrayBuffer.
//
// The upstream browser example needs SAB twice: xterm-pty blocks the worker on
// Atomics.wait for interactive stdin, and the networking stack passes frames
// through a SharedArrayBuffer. Neither is needed to boot the guest and run one
// command, which is what this measures. stdin is a closed queue: fd_read on 0
// returns 0 bytes and poll_oneoff never reports it readable.
importScripts("./browser_wasi_shim/index.js");
importScripts("./browser_wasi_shim/wasi_defs.js");
importScripts("./wasi-util.js");

const ERRNO_INVAL = 28;
let firstOut = 0;

function say(text) { postMessage({ type: "log", text }); }

onmessage = async (msg) => {
  const { wasmUrl, argv } = msg.data;
  try {
    const tFetch = performance.now();
    const bytes = await (await fetch(wasmUrl)).arrayBuffer();
    say("wasm bytes = " + bytes.byteLength);
    say("fetch ms = " + Math.round(performance.now() - tFetch));

    const wasi = new WASI(["arg0"].concat(argv), [], []);
    const decoder = new TextDecoder();
    let buffered = "";
    const tty = {
      onRead: () => new Uint8Array(0),          // stdin is permanently empty
      onWaitForReadable: () => false,
      onWrite: (bytes) => {
        if (!firstOut) { firstOut = performance.now(); }
        buffered += decoder.decode(new Uint8Array(bytes), { stream: true });
        if (buffered.length > 200) { postMessage({ type: "stdout", text: buffered }); buffered = ""; }
      },
    };
    patch(wasi, tty);

    const tCompile = performance.now();
    const mod = await WebAssembly.compile(bytes);
    say("compile ms = " + Math.round(performance.now() - tCompile));

    // The guest imports the WASI socket calls (c2w links them for its optional
    // networking mode). The shim does not define them. Stub them to ENOTSUP and
    // SAY SO, rather than pretending they work: a socket that reports success
    // and delivers nothing is LESSONS.md defect 3 in library clothing.
    const stubbed = [];
    for (const imp of WebAssembly.Module.imports(mod)) {
      if (imp.module !== "wasi_snapshot_preview1") { continue; }
      if (typeof wasi.wasiImport[imp.name] !== "function") {
        wasi.wasiImport[imp.name] = () => 58;   // ENOTSUP
        stubbed.push(imp.name);
      }
    }
    if (stubbed.length) { say("stubbed ENOTSUP: " + stubbed.join(" ")); }

    const tInst = performance.now();
    const inst = await WebAssembly.instantiate(mod, { wasi_snapshot_preview1: wasi.wasiImport });
    say("instantiate ms = " + Math.round(performance.now() - tInst));

    const tStart = performance.now();
    let code = 0;
    try { wasi.start(inst); } catch (e) { code = String(e); }
    if (buffered) { postMessage({ type: "stdout", text: buffered }); }
    say("first guest output at ms = " + (firstOut ? Math.round(firstOut - tStart) : "never"));
    say("run ms = " + Math.round(performance.now() - tStart));
    postMessage({ type: "done", code });
  } catch (e) {
    postMessage({ type: "error", text: String(e && e.stack || e) });
  }
};

// Same shape as the upstream wasiHack, minus every socket path.
function patch(wasi, tty) {
  wasi.wasiImport.fd_read = (fd, iovs_ptr, iovs_len, nread_ptr) => {
    if (fd !== 0) { return ERRNO_INVAL; }
    const view = new DataView(wasi.inst.exports.memory.buffer);
    view.setUint32(nread_ptr, 0, true);
    return 0;
  };
  wasi.wasiImport.fd_write = (fd, iovs_ptr, iovs_len, nwritten_ptr) => {
    if (fd !== 1 && fd !== 2) { return ERRNO_INVAL; }
    const view = new DataView(wasi.inst.exports.memory.buffer);
    const mem = new Uint8Array(wasi.inst.exports.memory.buffer);
    const iovecs = Ciovec.read_bytes_array(view, iovs_ptr, iovs_len);
    let total = 0;
    for (const iovec of iovecs) {
      const buf = mem.slice(iovec.buf, iovec.buf + iovec.buf_len);
      if (buf.length) { tty.onWrite(Array.from(buf)); total += buf.length; }
    }
    view.setUint32(nwritten_ptr, total, true);
    return 0;
  };
  wasi.wasiImport.poll_oneoff = (in_ptr, out_ptr, nsubscriptions, nevents_ptr) => {
    if (nsubscriptions === 0) { return ERRNO_INVAL; }
    const view = new DataView(wasi.inst.exports.memory.buffer);
    const subs = Subscription.read_bytes_array(view, in_ptr, nsubscriptions);
    const events = [];
    for (const sub of subs) {
      if (sub.u.tag.variant === "clock") {
        const ev = new Event();
        ev.userdata = sub.userdata; ev.error = 0; ev.type = new EventType("clock");
        events.push(ev);
      }
    }
    Event.write_bytes_array(view, out_ptr, events);
    view.setUint32(nevents_ptr, events.length, true);
    return 0;
  };
}

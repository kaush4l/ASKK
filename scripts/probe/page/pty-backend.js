// ------------------------------------------------------------ backend realm
// Mirrors src/backend/worker.js: the middle realm. It spawns the sandbox
// worker as a NESTED worker (page -> backend -> sandbox), exactly the shape
// C2wSandbox.js:89 produces, and it owns the host half of the tty protocol.
//
// The host half is upstream xterm-pty's TtyServer protocol, reimplemented here
// against the SAME wire format that the vendored `workerTools.js` TtyClient
// speaks (Int32Array ctrl at byte 0, Int32Array data at byte 4; the host
// answers with Atomics.store(ctrl,0,1) + Atomics.notify). Upstream's own
// TtyServer is coupled to an xterm Terminal and a line discipline; upstream's
// index.html then turns that discipline OFF (ECHO/ICANON/OPOST all cleared)
// because the guest is a Linux with its own tty layer. What is left after
// that is a raw byte pipe, which is what this is.

const CTRL_BYTES = 4;
const DATA_INTS = 8192;              // 8192 bytes per read, one byte per int
let sab, streamCtrl, streamData;

let sandbox = null;                  // the nested worker
let state = "idle";                  // 'idle' | 'input' | 'poll'
let toGuest = [];                    // bytes waiting to be read by the guest
let fromGuest = [];                  // bytes the guest has written
let pollTimer = null;
let lastOutputAt = 0;
let readCount = 0, writeCount = 0, pollCount = 0;
let pendingReadLen = 0;              // how many bytes the guest last asked for
const readLens = new Map();          // histogram, to see what the guest requests

function say(text) { self.postMessage({ type: "log", text }); }
function reply(id, value) { self.postMessage({ type: "reply", id, value }); }

// ---------------------------------------------------------- tty host half
function ack() {
  Atomics.store(streamCtrl, 0, 1);
  Atomics.notify(streamCtrl, 0);
  state = "idle";
}

function feedToGuest(len) {
  if (len > streamData.length - 1) len = streamData.length - 1;
  const chunk = toGuest.splice(0, len);
  streamData[0] = chunk.length;
  streamData.set(chunk, 1);
  ack();
}

function waitForReadable(seconds) {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  if (toGuest.length > 0) { streamData[0] = 1; ack(); return; }
  if (seconds < 0) return;                       // block for ever, no ack
  if (seconds > 0) {
    // Clamped. Upstream passes `Number.MAX_VALUE / 1e9` when the guest polls
    // with no clock deadline, and setTimeout overflows int32 on that. A short
    // re-poll is the same answer, delivered on a timer that exists.
    const ms = Math.min(1000, Math.max(1, Math.round(seconds * 1000)));
    pollTimer = setTimeout(() => { pollTimer = null; state = "poll"; waitForReadable(0); }, ms);
    return;
  }
  streamData[0] = 2;                             // 2 = not readable (upstream)
  ack();
}

function onTtyRequest(req) {
  switch (req.ttyRequestType) {
    case "read":
      readCount++;
      pendingReadLen = req.length;
      readLens.set(req.length, (readLens.get(req.length) || 0) + 1);
      state = "input";
      if (toGuest.length > 0) feedToGuest(req.length);
      return;                                     // else: guest stays blocked
    case "write":
      writeCount++;
      for (const b of req.buf) fromGuest.push(b);
      lastOutputAt = Date.now();
      ack();
      return;
    case "poll":
      pollCount++;
      state = "poll";
      waitForReadable(req.timeout);
      return;
    case "tcgets":
      // Never reached on the WASI path (ioctl is the emscripten path), kept so
      // a surprise request is answered rather than deadlocking.
      streamData.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
      ack();
      return;
    case "tcsets": ack(); return;
    case "tiocgwinsz": streamData[0] = 24; streamData[1] = 80; ack(); return;
    default:
      say("UNKNOWN tty request " + JSON.stringify(req));
      ack();
  }
}

function pushInput(text) {
  const bytes = new TextEncoder().encode(text);
  for (const b of bytes) toGuest.push(b);
  // Cap at what the guest actually asked for. Upstream's TtyServer calls
  // feedToWorker(toWorkerBuf.length) here, ignoring the request size; the
  // client then does buffer8.set(data, iovec.buf) with however much it was
  // handed, which writes past the guest's buffer when that is more than
  // iovec.buf_len.
  if (state === "input") feedToGuest(pendingReadLen || streamData.length - 1);
  else if (state === "poll") waitForReadable(0);
}

function drain() {
  const text = new TextDecoder().decode(new Uint8Array(fromGuest));
  fromGuest = [];
  return text;
}

// ------------------------------------------------------------------ ops
const ops = {
  // Step 1: the tree's own one-shot worker, verbatim or streaming, nested.
  async oneshot({ file, wasmUrl, command, measure }) {
    const w = new Worker(file, { name: "sandbox" });
    const t = {};
    const out = { file, command };
    const boot = new Promise((res) => {
      w.onmessage = (e) => {
        const d = e.data;
        if (d.type === "booted") { t.booted = performance.now(); out.bytes = d.bytes; res(true); }
        else if (d.type === "boot-failed") { out.bootError = d.message; res(false); }
      };
      w.onerror = (e) => { out.bootError = "worker error: " + e.message; res(false); };
    });
    t.start = performance.now();
    w.postMessage({ type: "boot", wasmUrl });
    const ok = await boot;
    out.bootMs = Math.round((t.booted || performance.now()) - t.start);
    if (!ok) { w.terminate(); return out; }
    if (measure) out.memoryAfterCompile = await ops.memory();

    const ran = new Promise((res) => {
      w.onmessage = (e) => { if (e.data.type === "result") res(e.data); };
    });
    const t2 = performance.now();
    w.postMessage({ type: "run", id: "c1", argv: ["sh", "-c", command] });
    const r = await ran;
    out.runMs = Math.round(performance.now() - t2);
    out.stdout = r.stdout;
    out.code = r.code;
    out.trap = r.trap;
    out.stubbed = r.stubbed;
    if (measure) out.memoryAfterRun = await ops.memory();
    w.terminate();
    return out;
  },

  async memory() {
    if (!self.crossOriginIsolated) return "not isolated";
    if (!performance.measureUserAgentSpecificMemory) return "unsupported";
    try {
      const m = await performance.measureUserAgentSpecificMemory();
      const by = {};
      for (const b of m.breakdown) {
        if (!b.bytes) continue;
        const k = (b.types || []).join("+") + "|" + (b.attribution || []).map((a) => a.scope).join(",");
        by[k] = (by[k] || 0) + b.bytes;
      }
      return { total: m.bytes, breakdown: by };
    } catch (e) { return "throw: " + String(e && e.message || e); }
  },

  env() {
    return {
      backend_coi: self.crossOriginIsolated,
      backend_SAB: typeof SharedArrayBuffer,
      measureUASM: typeof performance.measureUserAgentSpecificMemory,
      deviceMemory: self.navigator.deviceMemory,
      hardwareConcurrency: self.navigator.hardwareConcurrency,
    };
  },

  // Step 3/4: boot ONE guest with blocking stdin and keep it alive.
  async ptyBoot({ wasmUrl, argv }) {
    sab = new SharedArrayBuffer(CTRL_BYTES + DATA_INTS * 4);
    streamCtrl = new Int32Array(sab, 0, 1);
    streamData = new Int32Array(sab, CTRL_BYTES);
    toGuest = []; fromGuest = []; state = "idle";
    readCount = writeCount = pollCount = 0;

    sandbox = new Worker("./sandbox-pty.js", { name: "sandbox" });
    const started = new Promise((res) => {
      sandbox.onmessage = (e) => {
        const d = e.data;
        if (d && d.ttyRequestType) { onTtyRequest(d); return; }
        if (d && d.type === "note") { say("[sandbox] " + d.text); if (d.text.startsWith("running")) res(d); return; }
        if (d && d.type === "exit") { say("[sandbox] EXIT " + d.text); return; }
      };
      sandbox.onerror = (e) => { say("[sandbox] ERROR " + e.message); res({ error: e.message }); };
    });
    const t0 = performance.now();
    sandbox.postMessage({ type: "init", buf: sab });
    sandbox.postMessage({ type: "start", wasmUrl, argv });
    const s = await started;
    return { startedMs: Math.round(performance.now() - t0), note: s };
  },

  // Wait until the guest has been quiet for `quiet` ms (a prompt has been
  // printed and nothing more is coming), or `max` ms have passed.
  async settle({ quiet = 900, max = 120000 }) {
    const t0 = Date.now();
    lastOutputAt = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 100));
      if (Date.now() - lastOutputAt >= quiet) break;
      if (Date.now() - t0 >= max) return { text: drain(), timedOut: true, ms: Date.now() - t0 };
    }
    return { text: drain(), timedOut: false, ms: Date.now() - t0 };
  },

  async type({ text }) { pushInput(text); return { queued: text.length, state }; },

  // Send a line and wait for the guest to go quiet again. Returns the raw
  // terminal bytes produced, including the echo and the next prompt.
  async line({ text, quiet = 900, max = 120000 }) {
    drain();
    const t0 = performance.now();
    pushInput(text);
    const r = await ops.settle({ quiet, max });
    return { text: r.text, ms: Math.round(performance.now() - t0 - quiet), wallMs: Math.round(performance.now() - t0), timedOut: r.timedOut };
  },

  // Prompt-anchored wait. Quiescence is wrong for a long command: a busybox
  // awk loop prints nothing for its whole run, so "no output for N ms" fires
  // while the guest is still working. ash re-emits ESC[6n after every prompt,
  // so that is the anchor.
  async lineP({ text, anchor = "\u001b[6n", max = 900000 }) {
    drain();
    const t0 = performance.now();
    pushInput(text);
    for (;;) {
      await new Promise((r) => setTimeout(r, 40));
      const s = new TextDecoder().decode(new Uint8Array(fromGuest));
      if (s.endsWith(anchor)) { fromGuest = []; return { text: s, ms: Math.round(performance.now() - t0), timedOut: false }; }
      if (performance.now() - t0 > max) { fromGuest = []; return { text: s, ms: Math.round(performance.now() - t0), timedOut: true }; }
    }
  },

  stats() { return { state, readCount, writeCount, pollCount, pendingToGuest: toGuest.length, pendingFromGuest: fromGuest.length, readLens: Object.fromEntries(readLens) }; },

  // Push a big payload in chunks and report throughput.
  async feed({ text, chunk = 512, anchor = "\u001b[6n", max = 900000 }) {
    drain();
    const t0 = performance.now();
    for (let i = 0; i < text.length; i += chunk) {
      pushInput(text.slice(i, i + chunk));
      // let the guest drain before queueing more
      for (let g = 0; g < 20000 && toGuest.length > 0; g++) await new Promise((r) => setTimeout(r, 5));
    }
    for (;;) {
      await new Promise((r) => setTimeout(r, 40));
      const s = new TextDecoder().decode(new Uint8Array(fromGuest));
      if (s.endsWith(anchor)) { fromGuest = []; return { bytes: text.length, ms: Math.round(performance.now() - t0), tail: s.slice(-300), timedOut: false }; }
      if (performance.now() - t0 > max) { fromGuest = []; return { bytes: text.length, ms: Math.round(performance.now() - t0), tail: s.slice(-300), timedOut: true }; }
    }
  },

  close() { sandbox?.terminate(); sandbox = null; return true; },
};

self.onmessage = async (e) => {
  const { id, op, args } = e.data;
  try { reply(id, await ops[op](args)); }
  catch (err) { reply(id, { error: String(err && err.stack || err) }); }
};

say("backend up: coi=" + self.crossOriginIsolated + " SAB=" + (typeof SharedArrayBuffer));
